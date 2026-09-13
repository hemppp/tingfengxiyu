// ============================================================
// 阶段编排 —— 一轮「立设定」会话
//
// 事件流（SSE）：
//   { type:'stage_start' }      → { type:'stage_phase' } 正在做什么
//   → { type:'stage_turn' }     某个角色的完整发言（交流流）
//   → { type:'stage_summary' }  定稿官的契约文本（中栏卡片）
//   → { type:'awaiting_user' }  停下来等作者确认（G1/G2/G3）
//
// ★ 与 discuss/orchestrator 的分工：那个跑**一章**，这个跑**一段设定**。
//   共用 context-resolver（供数防幻觉）、entity-sink 的思路（保守落库）、相同的失败取向。
// ★ 闸门之前**不落库**：被作者否掉的东西不该进项目库（approveStage 才落）。
// ============================================================

import type { ServerPluginContext } from '@novel/core';
import { getProjectDb } from '@novel/db';
import type { DesignRole } from '../discuss/roles.js';
import { formatBrief, resolveSettingsDigest, type SettingsDigest } from '../framework/context-resolver.js';
import { readDigestFor } from '../framework/memory/digest-gate.js';
import { createAgentMemory, createMemoryGate, experience, writeAudit, fingerprintOf } from '../framework/memory/index.js';
import { REVISION_LIMIT, STAGE_LABEL, type PipelineEvent, type PipelineState, type SinkStats, type StageKey } from './types.js';
import { STAGE_SPEAK_MAX_TOKENS, specFor } from './roles-phase.js';
import { PipelineStore, computeBriefHash } from './store.js';
import { sinkStageArtifact } from './sink.js';

/** 单个前置阶段产出物注入上限：三段都塞进上下文会贵到离谱，也要防被截断误导 */
const ARTIFACT_INJECT_MAX = 4000;
/** 全部前置产出物的总上限 */
const ARTIFACT_TOTAL_MAX = 9000;

/** 带工具的角色需要多转几轮查库（与单章链路同口径） */
function turnsFor(role: DesignRole): number {
  return role.tools && role.tools.length > 0 ? 6 : 2;
}

function cut(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…（已截断）';
}

export interface StageRunOpts {
  stage: StageKey;
  projectId: string;
  userId: string;
  /** 作者为本轮补的话（可选） */
  extra?: string;
  /** 上一轮「带批注打回」的批注：重跑时必须进提示词，否则改了等于没改 */
  revisionNote?: string;
}

/**
 * 跑一个阶段：讨论 → 收敛 → 存契约 → 停下等作者。
 *
 * 所有阶段的产出物（artifact）都存进流水线状态，**不落项目库**。
 * 落库发生在 `approveStage()`（作者点头之后）。
 */
export async function runStage(
  ctx: ServerPluginContext,
  opts: StageRunOpts,
  emit: (e: PipelineEvent) => void,
): Promise<void> {
  const { stage, projectId, userId } = opts;
  const store = new PipelineStore(ctx.db.kv, projectId);

  // ★ 全项目第一个动作：确保项目库已打开（`ctx.db.project()` 是同步只读，新项目返回 null）
  try {
    await getProjectDb(projectId);
  } catch (e) {
    console.warn('[pipeline] 打开项目库失败（后续按空库处理）:', e);
  }

  let digest: SettingsDigest;
  try {
    digest = await resolveSettingsDigest(ctx, projectId);
  } catch (e) {
    console.warn('[pipeline] 读取项目设定失败（多为空项目库），按空库处理:', e);
    digest = {
      projectName: '', genre: '', characters: '（暂无角色设定）',
      foreshadows: '（暂无伏笔）', outline: '（暂无大纲）', chapters: '（暂无章节）',
    };
  }

  const briefText = digest.brief ?? '';
  if (!briefText) {
    emit({
      type: 'stage_failed',
      stage,
      message: '这本书还没有开书设定（书名/开局/世界观/笔风/主角/女主/流派）。'
        + '这条流水线的起点就是它 —— 请先在「编辑书籍」里补全，否则立出来的设定会凭空长出来。',
    });
    return;
  }

  const spec = specFor(stage);
  if (!spec) {
    emit({ type: 'stage_failed', stage, message: `「${STAGE_LABEL[stage]}」阶段尚未实现` });
    return;
  }

  // ---- 组装输入（作者设定 + 已定稿的前置阶段 + 本轮批注）----
  // ★ 记忆闸门（2026-09-13 接线）：**每个角色各拿一份被裁剪过的项目现状**，
  //   并在 memory_audit 留下「谁在讨论用途下读了什么」。复用已取到的 digest，
  //   所以裁剪本身不产生额外查询；宽度原则见 roles.ts 的 memory 声明注释。
  const gate = createMemoryGate(ctx);
  const headerCache = new Map<string, string>();
  const headerFor = async (agentId: string): Promise<string> => {
    const hit = headerCache.get(agentId);
    if (hit !== undefined) return hit;
    const { digest: allowed } = await readDigestFor(ctx, projectId, agentId, 'discuss-context', {
      narrative: false,          // 流水线是"立设定"阶段，不带章节正文
      load: async () => digest,
    });
    const text = buildHeader({
      digest: allowed as SettingsDigest,
      briefText: (allowed.brief as string | undefined) ?? '',
      state: store.load(), stage, extra: opts.extra, revisionNote: opts.revisionNote,
    });
    headerCache.set(agentId, text);

    // ★ A4：装配指纹（与写章链路同一口径）。此前只接在 discuss 侧，
    //   流水线这边漏了 → 面板上一条 assemble 都没有（GUI 走查发现）。
    try {
      await writeAudit(ctx, {
        projectId, agentId, action: 'assemble', keys: Object.keys(allowed),
        reason: 'discuss-context', allow: true,
        detail: `注入 ${text.length} 字（${stage}）`,
        fingerprint: fingerprintOf(text),
      });
    } catch (e) {
      console.warn('[pipeline] 装配指纹写入失败（不影响本段）:', e);
    }
    return text;
  };
  /** L2：记「这个角色这一轮说了什么」（失败不影响本段讨论） */
  const memoryOf = (agentId: string) => createAgentMemory({ ctx, projectId, agentId, gate });

  const transcript: Array<{ name: string; text: string }> = [];
  const buildInput = (header: string, role: DesignRole, extra?: string): string => {
    const parts: string[] = [header];
    if (transcript.length > 0) {
      parts.push('【本轮讨论记录】');
      for (const t of transcript) parts.push(`◆ ${t.name}：\n${t.text}\n`);
    }
    if (extra) parts.push(extra);
    parts.push(`现在轮到你（${role.name}）发言。`);
    return parts.join('\n');
  };

  const speak = async (role: DesignRole, extra?: string): Promise<string> => {
    emit({ type: 'stage_phase', stage, label: `${role.name}发言中` });
    const roleHeader = await headerFor(role.key);
    const result = await ctx.ai.agents.run({
      system: role.system,
      input: buildInput(roleHeader, role, extra),
      tools: role.tools,
      maxTurns: turnsFor(role),
      maxTokens: STAGE_SPEAK_MAX_TOKENS,
      context: { projectId, userId },
    });
    const text = String(result.text ?? '').trim();
    if (!text) throw new Error(`${role.name}未产出内容（可能是模型调用失败）`);
    transcript.push({ name: role.name, text });
    // L2 经历流：记「它自己说了什么」（失败不影响本段讨论 —— 记忆是旁路）
    try {
      await memoryOf(role.key).writeOwn(experience(`exp.stage.${stage}.turn${transcript.length}`, {
        kind: 'said', text: text.slice(0, 2000), ref: `${stage}#turn${transcript.length}`,
      }));
    } catch (e) {
      console.warn('[pipeline] 写 L2 经历失败（不影响本段）:', e);
    }
    emit({
      type: 'stage_turn',
      stage,
      agent: role.key,
      name: role.name,
      color: role.color,
      short: role.short,
      text,
      meta: result.model ? `模型 ${result.model}` : undefined,
    });
    return text;
  };

  try {
    // ★ 跑之前先把状态落成 running：这是防「两个标签页/刷新后重复跑同一段」的唯一一道锁
    //   （界面上的按钮禁用只护得住当前这个标签页）。僵死 running 由 store.load() 自动收敛。
    const started = store.load();
    if (started) await store.beginStage(started, stage);

    emit({ type: 'stage_start', stage, revision: store.load()?.stages[stage]?.revision ?? 0 });

    // 主笔 → 其余角色依次回应（每个角色都能看到前面人的发言）
    for (const role of spec.speakers) {
      await speak(role);
    }

    // 主笔针对质疑正面回应 —— 没有这一轮就只是各交一份报告，不构成讨论
    if (spec.rebuttal) {
      await speak(spec.rebuttal.role, spec.rebuttal.extra);
    }

    // 收敛成契约
    emit({ type: 'stage_phase', stage, label: '收敛本段结论' });
    const artifact = await speak(spec.convener);
    emit({ type: 'stage_summary', stage, text: artifact });

    // 存状态：等作者确认（★ 此时不落库）
    const state = store.load();
    if (!state) throw new Error('流水线状态丢失，请重新启动');
    const rec = state.stages[stage];
    rec.artifact = artifact;
    rec.status = 'awaiting_user';
    rec.runningSince = undefined;
    rec.finishedAt = Date.now();
    rec.error = undefined;
    await store.save(state);

    emit({
      type: 'awaiting_user',
      stage,
      summary: artifact,
      revision: rec.revision,
      revisionLimit: REVISION_LIMIT,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const state = store.load();
    if (state) {
      state.stages[stage].status = 'failed';
      state.stages[stage].runningSince = undefined;
      state.stages[stage].error = message;
      await store.save(state);
    }
    emit({ type: 'stage_failed', stage, message });
  }
}

/** 组装阶段输入：作者设定 + 已定稿的前置阶段产出 + 本轮批注 */
function buildHeader(o: {
  digest: SettingsDigest;
  briefText: string;
  state: PipelineState | undefined;
  stage: StageKey;
  extra?: string;
  revisionNote?: string;
}): string {
  const parts: string[] = [];

  parts.push('【作者的开书设定（这是定论：与之冲突的一律以它为准）】');
  parts.push(o.briefText);
  if (o.digest.projectName) parts.push(`书名：${o.digest.projectName}`);

  // 已定稿的前置阶段：让世界圣经建立在角色宪章之上、剧情总纲建立在两者之上
  const order: StageKey[] = ['cast', 'bible', 'plot'];
  const priorTexts: string[] = [];
  let budget = ARTIFACT_TOTAL_MAX;
  for (const k of order) {
    if (k === o.stage) break;
    const art = o.state?.stages[k]?.artifact;
    if (!art || o.state?.stages[k]?.status !== 'approved') continue;
    const piece = cut(art, Math.min(ARTIFACT_INJECT_MAX, budget));
    budget -= piece.length;
    if (budget <= 0) {
      priorTexts.push(`（已定稿的《${STAGE_LABEL[k]}》因篇幅过长被省略，需要时用工具查库）`);
      break;
    }
    priorTexts.push(`【已定稿的《${STAGE_LABEL[k]}》】\n${piece}`);
  }
  if (priorTexts.length > 0) {
    parts.push('', '【前置阶段已定稿的产出（必须与它们一致，不要另起炉灶）】');
    parts.push(priorTexts.join('\n\n'));
  } else if (o.stage !== 'cast') {
    parts.push('', '【前置阶段】无 —— 说明这是第一段设定，一切从这里立起来。');
  }

  // 项目库里已有什么（供设定管家核对，且明确告知"没有就是真没有"）
  parts.push(
    '',
    '【项目库现状（框架直接读取，不是你的记忆）】',
    `已有角色：\n${o.digest.characters}`,
    '',
    `已有大纲：\n${o.digest.outline}`,
    '',
    `已有伏笔：\n${o.digest.foreshadows}`,
  );

  if (o.revisionNote) {
    parts.push(
      '',
      '【作者上一轮的批注（本轮必须按它改，改了什么要能对上）】',
      o.revisionNote,
    );
  }
  if (o.extra) {
    parts.push('', '【作者本轮补充】', o.extra);
  }
  parts.push('', `【本轮任务】立《${STAGE_LABEL[o.stage]}》。`);
  return parts.join('\n');
}

/**
 * 作者点了「批准」：把本段产出物结构化落库。
 *
 * 抽取失败**不撤销批准** —— 批准是作者的意志，落库是技术步骤；
 * 失败信息随 stats.notes 交回，作者可重跑本段。宁可留着契约文本，也不要静默什么都没有。
 */
export async function approveStage(
  ctx: ServerPluginContext,
  opts: { projectId: string; userId: string; stage: StageKey; briefText: string },
  emit: (e: PipelineEvent) => void,
): Promise<SinkStats | null> {
  const store = new PipelineStore(ctx.db.kv, opts.projectId);
  const state = store.load();
  const artifact = state?.stages[opts.stage]?.artifact;
  if (!state || !artifact) return null;

  const stats = await sinkStageArtifact(ctx, {
    projectId: opts.projectId,
    stage: opts.stage,
    artifact,
    briefText: opts.briefText,
    userId: opts.userId,
  });

  state.stages[opts.stage].sinked = stats.notes.length === 0 || stats.notes.every((n) => !n.includes('未落库'));
  await store.save(state);
  emit({ type: 'stage_sinked', stage: opts.stage, stats });
  return stats;
}

/** 供路由复用：当前 baseline hash（brief 一变就不同） */
export { computeBriefHash };
