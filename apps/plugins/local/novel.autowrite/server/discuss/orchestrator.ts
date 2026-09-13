// ============================================================
// 设计讨论编排 —— 一轮会话
//
// 与 autowrite 原有的「规划官 → 写作官 → 校对官」流水线不同：
// 这里是**多角色来回讨论**，然后把讨论收敛成「本章结论」。
// 讨论记录（transcript）在本轮内共享 —— 每个角色都看得到前面人说了什么，
// 这是「交流」与「各交一份报告」的分界线。
//
// 会话顺序：
//   剧情设计师提案 → 角色设计师回应 → 设定管家查库质疑
//   → 剧情设计师二次回应（针对质疑）→ 定稿官收敛成本章结论
//
// 事件流（SSE）：
//   { type:'phase', label }      正在做什么
//   { type:'turn', agent, ... }  某个角色的完整发言
//   { type:'conclusion', text }  收敛出的本章结论
//   { type:'error' | 'done' }
//
// 说明：本版只做「讨论 + 收敛」。写作官出稿与意图复核在下一版接。
// ============================================================

import type { ServerPluginContext } from '@novel/core';
import {
  DESIGN_ROLES, CONVENER_ROLE, ROLE_WRITER, ROLE_REVIEWER,
  WRITER_TARGET_CHARS, WRITER_MIN_CHARS, type DesignRole,
} from './roles.js';
import {
  resolveSettingsDigest, resolvePreviousChapter, persistChapterStoryTime, type SettingsDigest,
} from '../framework/context-resolver.js';
import { readDigestFor } from '../framework/memory/digest-gate.js';
import {
  createAgentMemory, createMemoryGate, createOwnWheel, experience, factRef,
  renderWheelWithin, WHEEL_CAPACITY_DEFAULT, evictPrompt, fingerprintOf, writeAudit, allRolePolicies,
} from '../framework/memory/index.js';
import { persistChapterEntities } from '../framework/entity-sink.js';
import { runConsistencyGate, runPolishGate, POLISH_PASS_SCORE } from '../framework/gates.js';
import { WRITER_MAX_TOKENS } from '../autowrite/helpers.js';
import { schema, eq, and, isNull, getProjectDb, type DrizzleDb } from '@novel/db';
import { randomUUID } from 'node:crypto';

export type SessionEvent =
  | { type: 'phase'; label: string }
  | {
      type: 'turn';
      agent: string;
      name: string;
      color: string;
      short: string;
      text: string;
      meta?: string;
    }
  | { type: 'conclusion'; text: string }
  | { type: 'draft'; text: string; revision: number }
  | { type: 'review'; text: string; attempt: number; passed: boolean }
  /**
   * 方案 §5 的三道门：意图门用 review 事件，校对门 / 润色门用本事件。
   *   check  —— 硬门（全文 × 设定库一致性）：passed=false 时 detail 是冲突清单；
   *             它只允许一次定向修订，仍未消除也**不阻塞交付**（随交付交人工）。
   *   polish —— 软门（质量评分）：**从不阻塞**，passed 表示是否达到 POLISH_PASS_SCORE。
   */
  | { type: 'gate'; name: 'check' | 'polish'; passed: boolean; detail: string; score?: number }
  /**
   * 交付成功。`warnings` 非空 = 交付了但有需人工复核之处（例如意图门打回上限用尽）。
   * **连写场景下不能因为门没过就丢章**：缺一章会让后面所有章失去前情，
   * 比带瑕疵的一章糟得多（实测 30 章连写丢了 2/7 章，就是这么来的）。
   */
  | { type: 'delivered'; order: number; title: string; wordCount: number; created: boolean; warnings?: string[] }
  | { type: 'deliver_blocked'; order: number; title: string; reason: string }
  /** 实体沉淀结果：本章交付后写入项目库的角色/物品/地点/伏笔条数 */
  | { type: 'entities'; created: number; updated: number; skipped: number; notes: string[] }
  /** 连写模式：一章开始（前端据此插分段并重置本轮的结论/正文/阶段状态） */
  | { type: 'chapter_start'; order: number; index: number; total: number }
  /** 连写模式：一章收尾（不论该章是否交付成功都会发） */
  | { type: 'chapter_done'; order: number; index: number; total: number; delivered: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface DiscussionOpts {
  projectId: string;
  userId: string;
  /** 作者这一轮说的话 */
  message: string;
  /** 可选：在意第几章（写进输入，帮助角色聚焦） */
  chapterOrder?: number;
  /**
   * 是否在本轮结束时发 `done`（默认 true）。
   * 连写模式下由 `runChapters` 统一收尾，单章调用要传 false ——
   * 否则前端会在第一章结束时就把整轮判成「跑完了」。
   */
  finalDone?: boolean;
}

/** 单角色发言的 maxTurns：带工具的角色需要多转几轮查库 */
function turnsFor(role: DesignRole): number {
  return role.tools && role.tools.length > 0 ? 6 : 2;
}

/** 意图门打回上限 —— 超限停下问人，不无限循环 */
const MAX_REVISIONS = 2;

/** 正文字数口径：与交付时写入 word_count 的算法保持一致（去空白字符数） */
function proseLength(s: string): number {
  return s.replace(/\s/g, '').length;
}

/** 中文数字 → 阿拉伯数字（只处理「第 X 章」里的常见写法，够用即可） */
const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function cnToNum(s: string): number | null {
  if (!s) return null;
  if (s === '十') return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) {
    const tens = m[1] ? (CN_DIGIT[m[1]] ?? 1) : 1;
    const ones = m[2] ? (CN_DIGIT[m[2]] ?? 0) : 0;
    return tens * 10 + ones;
  }
  if (/^[一二三四五六七八九]$/.test(s)) return CN_DIGIT[s] ?? null;
  return null;
}

/** 从作者指令里识别目标章号（「第3章」「第三章」都认） */
function parseChapterOrder(message: string): number | null {
  const arabic = message.match(/第\s*(\d+)\s*章/);
  if (arabic?.[1]) return Number(arabic[1]);
  const cn = message.match(/第\s*([一二三四五六七八九十]+)\s*章/);
  if (cn?.[1]) return cnToNum(cn[1]);
  return null;
}

/**
 * 交付：把定稿正文写入章节。
 *
 * 治理原则（沿用核心「章节写入默认封锁」的基调）：
 *   · 目标章**为空**（空章或不存在）→ 直接写入，没有覆写风险
 *   · 目标章**已有正文** → **不自动覆盖**，emit `deliver_blocked` 交人工
 *   · 听不出章号 → 明说，不猜（猜错的代价是往错误章节写一整章）
 *
 * 返回是否真的写入了库（被治理拦下时为 false）—— 实体沉淀只许跟着真交付走，
 * 否则会把「正文里根本没有」的实体写进设定库。
 */
async function deliver(
  ctx: ServerPluginContext,
  opts: { projectId: string; message: string; order?: number; draft: string; warnings?: string[] },
  emit: (e: SessionEvent) => void,
): Promise<{ delivered: boolean; order: number; title: string }> {
  const order = opts.order ?? parseChapterOrder(opts.message);
  if (!order) {
    emit({
      type: 'deliver_blocked',
      order: 0,
      title: '',
      reason: '没能从指令里认出要写第几章 —— 请写明「第 N 章」。正文已产出，但未入库。',
    });
    return { delivered: false, order: 0, title: '' };
  }

  const db = ctx.db.project(opts.projectId) as DrizzleDb;
  const content = opts.draft.trim();
  const wordCount = proseLength(content);
  const now = new Date();

  const existing = await db
    .select({ id: schema.chapters.id, title: schema.chapters.title, content: schema.chapters.content })
    .from(schema.chapters)
    .where(and(
      eq(schema.chapters.projectId, opts.projectId),
      eq(schema.chapters.order, order),
      isNull(schema.chapters.deletedAt),
    ))
    .limit(1);

  const row = existing[0];
  if (row) {
    if (row.content && row.content.trim().length > 0) {
      emit({
        type: 'deliver_blocked',
        order,
        title: row.title,
        reason: '该章已有正文，按治理原则不自动覆盖 —— 请到编辑器确认内容后再决定是否替换。',
      });
      return { delivered: false, order, title: row.title };
    }
    await db.update(schema.chapters)
      .set({ content, wordCount, updatedAt: now })
      .where(eq(schema.chapters.id, row.id));
    emit({ type: 'delivered', order, title: row.title, wordCount, created: false, ...(opts.warnings?.length ? { warnings: opts.warnings } : {}) });
    return { delivered: true, order, title: row.title };
  }

  const title = `第${order}章`;
  await db.insert(schema.chapters).values({
    id: randomUUID(),
    projectId: opts.projectId,
    title,
    content,
    order,
    wordCount,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });
  emit({ type: 'delivered', order, title, wordCount, created: true, ...(opts.warnings?.length ? { warnings: opts.warnings } : {}) });
  return { delivered: true, order, title };
}

export async function runDiscussion(
  ctx: ServerPluginContext,
  opts: DiscussionOpts,
  emit: (e: SessionEvent) => void,
): Promise<void> {
  const { projectId, userId, message, chapterOrder } = opts;

  // ★ 先确保项目库已打开（治本）。
  //   `ctx.db.project()` 是**同步**接口，只读缓存 —— 而**全新项目**从没写过数据，
  //   它的库还没进缓存，于是返回 null，后面任何读/写都会炸。
  //   这个坑已经踩过两次（设定读取、交付），所以统一在这里开一次。
  try {
    await getProjectDb(projectId);
  } catch (e) {
    console.warn('[discuss] 打开项目库失败（后续按空库处理）:', e);
  }

  /** 本轮讨论记录 —— 所有角色共享，这是「来回」的载体 */
  const transcript: Array<{ name: string; text: string }> = [];

  // ★ 强制注入（2026-09-11 修幻觉）：把项目库现状**直接喂给所有角色**。
  //   此前只给了「可查库」的权限，结果设定管家在一个**空项目**里凭常识编出了
  //   「我查到祠堂和主角家是同村设定」。让 agent「自己去查」防不住幻觉 ——
  //   事实必须由框架直接提供，并且明确标注「这是真的；没有就是真没有」。
  // ★ 注意：项目库是在**首次写入**时才创建的。空项目下 `ctx.db.project()` 返回 null，
  //   resolveSettingsDigest 会抛错 —— 这里必须按「库确实是空的」兜底，
  //   否则一个新项目连讨论都跑不起来。
  let digest: SettingsDigest;
  try {
    digest = await resolveSettingsDigest(ctx, projectId);
  } catch (e) {
    console.warn('[discuss] 读取项目设定失败（多为空项目库未创建），按空库处理:', e);
    digest = {
      projectName: '',
      genre: '',
      characters: '（暂无角色设定）',
      foreshadows: '（暂无伏笔）',
      outline: '（暂无大纲）',
      chapters: '（暂无章节）',
    };
  }
  /**
   * 渲染「项目现状」块。
   * ★ 参数化是因为现在**每个角色各拿一份**（按自己的记忆白名单裁剪，见下）：
   *   没拿到的字段整段省略 —— 不要留空标题让模型猜「是不是没有」。
   */
  const renderFacts = (d: Partial<SettingsDigest>): string => [
    '【项目现状（框架直接读取项目库得到的真实数据，不是你的记忆）】',
    `项目：${d.projectName || '未命名'}${d.genre ? ' · ' + d.genre : ''}`,
    // ★ 开书设定（新书向导产出）：开局 / 世界观 / 笔风 / 主角 / 女主 / 流派。
    //   它在**主库**的 projects.brief 上，角色的工具读不到 —— 只能由框架直接给。
    ...(d.brief
      ? ['', '【创作设定（作者开书时写下的硬设定 —— 与设定库同等效力，不得违背）】', d.brief]
      : []),
    ...(d.characters ? ['', '角色：', d.characters] : []),
    ...(d.foreshadows ? ['', '伏笔：', d.foreshadows] : []),
    ...(d.outline ? ['', '大纲：', d.outline] : []),
    ...(d.chapters ? ['', '章节：', d.chapters] : []),
  ].join('\n');

  /** 现状块上限：设定很长时截断，并明确告知「被截断了」，避免它以为没写就是没有 */
  const MAX_FACT_CHARS = 6000;
  const clipFacts = (t: string): string => (t.length > MAX_FACT_CHARS
    ? t.slice(0, MAX_FACT_CHARS) + '\n…（项目数据过长，此处已截断；需要细节请用工具查）'
    : t);

  // ★ 强制注入（架构 §7）：**上一章全文**。
  //   只给现状摘要时，模型知道「发生了什么」，却不知道「上一章是怎么写的」——
  //   文风、语气、结尾那一刻的处境全靠猜，连着读就会断层。§7 把它列为
  //   「不注入必然写错、不能交给自主判断」的一类（此前只注入了 digest 摘要）。
  //   没有已交付章节时**明确说明**，避免模型凭类型套路幻想前情。
  /**
   * 取**最近 N 章**（N = 水车容量，2026-09-13 从 1 扩到 3）。
   * 每章一次 DB 读、**不调模型**；循环用 `beforeOrder` 往前退（语义见 resolvePreviousChapter 注释）。
   * 拿到之后不是"直接拼给所有人"，而是——每人各自入**自己的**水车（见下 headerFor）。
   */
  const wheelCapacity = WHEEL_CAPACITY_DEFAULT;
  const recentChapters: Array<{ order: number; content: string; storyTime?: string }> = [];
  try {
    let cursor: number | undefined = chapterOrder;
    for (let i = 0; i < wheelCapacity; i++) {
      const p = await resolvePreviousChapter(ctx, projectId, cursor);
      if (!p) break;
      recentChapters.push({ order: p.order, content: p.content });
      cursor = p.order;
    }
  } catch (e) {
    console.warn('[discuss] 读取最近章节失败（按无前文处理）:', e);
  }

  /**
   * 记忆闸门 + 每角色一份的上下文（2026-09-13 接线）。
   *
   * 为什么按角色裁：`memory_audit` 里要能回答「这个角色当时**被允许**看到什么」。
   * 但**宽度原则**是「凡不注入就会编的都必须给」（角色卡/伏笔/约束/前情）——
   * 所以只有意图复核是刻意窄的，其余角色的差异只在「要不要地点/物品」这一档。
   *
   * `load: async () => digest` —— 复用上面已经取好的共享 digest，
   * 因此裁剪**不产生额外查询**，闸门只做过滤与记账。
   */
  const gate = createMemoryGate(ctx);
  const gatedCache = new Map<string, string>();
  /** 出界压缩的按章缓存：同一章只调一次模型 */
  const evictSummaryCache = new Map<number, string>();
  const compressEvicted = async (ev: { chapterNo: number; text: string }): Promise<string> => {
    const hit = evictSummaryCache.get(ev.chapterNo);
    if (hit !== undefined) return hit;
    const r = await ctx.ai.agents.run({
      system: '你是文本压缩器。只输出一句话，不加任何前后缀、不加标题、不解释。',
      input: evictPrompt(ev as never),
      maxTokens: 200,
      context: { projectId, userId },
    });
    const text = String(r.text ?? '').trim();
    if (text) evictSummaryCache.set(ev.chapterNo, text);
    return text;
  };
  const headerFor = async (agentId: string): Promise<string> => {
    const cached = gatedCache.get(agentId);
    if (cached !== undefined) return cached;

    const { digest: allowed, narrativeGranted } = await readDigestFor(ctx, projectId, agentId, 'discuss-context', {
      narrative: true,                       // 讨论阶段要带上一章（它在下面的 prevBlock 里）
      load: async () => digest,
    });
    /**
     * 前情段：**用这个 agent 自己的水车**渲染（2026-09-13 扩到 3 斗后改的）。
     *
     * 为什么改成水车而不是"统一注入上一章"：
     *   · 水车是**记忆的迭代方式** —— 它读到的前情成为它自己记忆的一部分，各转各的；
     *   · 扩了容量就得让注入真的用上：否则"容量 3"只是个永不生效的数字。
     * 幂等：同一章重复入斗不会占两个斗位（同章号先摘旧的）。
     */
    let prev = '';
    if (!narrativeGranted) {
      prev = '';                                  // 未获准读叙事：一段都不给（不影响事实部分）
    } else if (recentChapters.length === 0) {
      prev = '【前情】本项目还没有已交付的章节 —— 这是第一章，直接从开局写起，不要假设前情。';
    } else {
      try {
        const wheel = createOwnWheel(memoryOf(agentId), wheelCapacity);
        /**
         * ★ 舀水策略（2026-09-13 抽查后修正）：
         *   之前每次都把"最近 N 章"重播一遍 —— 斗位刚好填满，**永不发生出界**，
         *   于是"循环复用 + 出界压梗概"这套迭代机制等于死代码（抽查里 summary 一条都没有）。
         *   现在：**空斗才播种**（拿最近 N 章垫底，保证连续性），之后**只舀新章** ——
         *   这样斗满就真的会挤掉最老一斗、真的会压成一句话，迭代才发生。
         */
        const existing = await wheel.slots();
        const newestInWheel = existing[0]?.chapterNo ?? 0;
        const toIngest = existing.length === 0
          ? [...recentChapters].reverse()                       // 旧 → 新（播种）
          : recentChapters.filter((c) => c.order > newestInWheel); // 只舀比斗 1 更新的
        for (const c of toIngest) {
          await wheel.ingest(
            { chapterNo: c.order, text: c.content, ingestedAt: Date.now(), storyTime: c.storyTime },
            // ★ 出界一斗压成一句话（架构 §6：倒掉不等于丢）。**同一章只压一次**：
            //   各 agent 的水车在同一时刻挤掉的往往是同一章，按章号缓存，省掉重复的模型调用。
            { compress: compressEvicted },
          );
        }
        const { text } = renderWheelWithin(await wheel.slots());
        prev = [
          `【最近章节（你自己的水车 · 斗 1 最新 · 最多 ${wheelCapacity} 斗）】`,
          '**文风与衔接必须与斗 1 连续**：接着它的结尾往下写，不要复述它已经写过的内容，也不要换一种语气。',
          text,
        ].join('\n');
      } catch (e) {
        console.warn('[discuss] 水车入斗/渲染失败（退化为无前情）:', e);
        prev = '';
      }
    }

    const text = [
      '【作者要求】',
      message,
      chapterOrder ? `（针对第 ${chapterOrder} 章）` : '',
      '',
      clipFacts(renderFacts(allowed)),
      '',
      prev,
      '',
    ].filter(Boolean).join('\n');
    gatedCache.set(agentId, text);

    // ★ A4/I6：记本次**注入内容的指纹**（hash + 字数）—— 同 (项目,章,角色,授权集)
    //   两次装配指纹是否一致，就是"装配可复现"的可执行形式。
    try {
      await writeAudit(ctx, {
        projectId, agentId, action: 'assemble', keys: Object.keys(allowed),
        reason: 'discuss-context', allow: true,
        detail: `注入 ${text.length} 字${narrativeGranted ? '' : '（未含前情）'}`,
        fingerprint: fingerprintOf(text),
      });
    } catch (e) {
      console.warn('[discuss] 装配指纹写入失败（不影响讨论）:', e);
    }

    // ★ A1：把「它获准读到的全局事实」记成该角色自己的**事实引用（指针）**——
    //   L2 的"双式"里 fact_ref 这一式此前没有任何写入方（只有 experience 在跑）。
    //   只给"以查库为职责"的角色记（设定管家 l1Wide）：否则每个角色每轮都写一堆族名，纯噪音。
    const policy = allRolePolicies().find((r) => r.agentId === agentId)?.policy;
    if (policy?.l1Wide) {
      try {
        const mem = memoryOf(agentId);
        for (const key of Object.keys(allowed)) {
          await mem.writeOwn(factRef(`fref.ch${chapterOrder ?? 0}.${key}`, {
            factId: key, why: 'continuity-check：它据这些事实核对本章设定', sourceChapter: chapterOrder ?? undefined,
          }));
        }
      } catch (e) {
        console.warn('[discuss] 事实引用写入失败（不影响讨论）:', e);
      }
    }
    return text;
  };

  /**
   * ★ A2「按需回读」（`recall-by-need`）—— 此前这个 reason 在枚举里但**零调用方**，等于没实现。
   *
   * 真实触发点：**篇幅不足要补写时**。补写要加细节，最需要的恰恰是**斗位之外**的更早前情
   * （斗位里已有最近 3 章）。所以这里回读"比最老一斗更早的那一章"，走闸门、带 reason、记账。
   * 拿不到就返回空串 —— 回读失败绝不能反过来卡住交付。
   */
  const recallEarlier = async (agentId: string): Promise<string> => {
    try {
      const wheel = await createOwnWheel(memoryOf(agentId));
      const slots = await wheel.slots();
      const oldest = slots[slots.length - 1]?.chapterNo;
      if (!oldest || oldest <= 1) return '';          // 斗位里已经覆盖到第 1 章，没有更早的了
      const decision = await gate.authorize({
        projectId, agentId, keys: ['chapter.*'], reason: 'recall-by-need',
        narrative: true, mode: 'strict',
      });
      if (!decision.allow) return '';
      const earlier = await resolvePreviousChapter(ctx, projectId, oldest);   // order < oldest
      if (!earlier) return '';
      return [
        `【按需回读（第 ${earlier.order} 章《${earlier.title}》—— 比你最近三章更早的前情）】`,
        '以下是你主动回读的更早章节，用于避免补写时与前文冲突。',
        earlier.content,
      ].join('\n');
    } catch (e) {
      console.warn('[discuss] 按需回读失败（按无此段处理）:', e);
      return '';
    }
  };

  /** L2：把这次发言记进该角色自己的经历流（只记「自己说的」；heard 可由 transcript 复现，不重复落盘） */
  const memoryOf = (agentId: string) =>
    createAgentMemory({ ctx, projectId, agentId, gate });

  /**
   * 校对门（不是讨论角色，agentId 用 'proofreader'）用的 digest。
   * 它的白名单覆盖全部键族，所以**内容与共享 digest 等价** —— 这里过闸门是为了：
   *   ① 审计里留下「门禁在 gate-review 用途下读过 L1」这条记录
   *   ② 以后若要收窄校对的可见范围，改策略即可生效，不用再动调用点
   */
  let proofreadDigest: Partial<SettingsDigest> | null = null;
  const getProofreadDigest = async (): Promise<Partial<SettingsDigest>> => {
    if (!proofreadDigest) {
      const r = await readDigestFor(ctx, projectId, 'proofreader', 'gate-review', {
        narrative: true, load: async () => digest,
      });
      proofreadDigest = r.digest;
    }
    return proofreadDigest;
  };

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

  const speak = async (
    role: DesignRole,
    extra?: string,
    opts?: { maxTokens?: number },
  ): Promise<string> => {
    emit({ type: 'phase', label: `${role.name}发言中` });
    const roleHeader = await headerFor(role.key);
    const result = await ctx.ai.agents.run({
      system: role.system,
      input: buildInput(roleHeader, role, extra),
      tools: role.tools,
      maxTurns: turnsFor(role),
      ...(opts?.maxTokens != null ? { maxTokens: opts.maxTokens } : {}),
      context: { projectId, userId },
    });
    const text = String(result.text ?? '').trim();
    if (!text) throw new Error(`${role.name}未产出内容（可能是模型调用失败）`);
    transcript.push({ name: role.name, text });
    // L2 经历流：记「它自己说了什么」。失败不影响讨论（记忆是旁路，不能反过来废掉这一轮）
    try {
      // ★ key 必须**带上章号**：只用 `turn.9` 这种编号的话，每章都会算出同样的 key，
      //   后一章会把前一章的经历**覆盖**掉（实测：4 章只留下 13 条，本该 ~40 条）。
      await memoryOf(role.key).writeOwn(experience(`exp.ch${chapterOrder ?? 0}.turn${transcript.length}`, {
        kind: 'said', text: text.slice(0, 2000), ref: `ch${chapterOrder ?? 0}#turn${transcript.length}`,
      }));
    } catch (e) {
      console.warn('[discuss] 写 L2 经历失败（不影响讨论）:', e);
    }
    emit({
      type: 'turn',
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
    // ——— 第一轮：各自从自己那一维发言 ———
    for (const role of DESIGN_ROLES) {
      await speak(role);
    }

    // ——— 第二轮：剧情设计师针对质疑正面回应 ———
    // 没有这一轮，三个角色就只是各交一份报告，不构成讨论。
    const plot = DESIGN_ROLES[0];
    if (plot) {
      await speak(
        plot,
        '【本轮任务】同伴已对你的方案提出补充与质疑。请**正面回应**：接受的说明怎么改，'
        + '不接受的说明为什么。不要重述原方案，不要客套。',
      );
    }

    // ——— 收敛 ———
    emit({ type: 'phase', label: '收敛本章结论' });
    const conclusion = await speak(CONVENER_ROLE);
    emit({ type: 'conclusion', text: conclusion });

    // ——— 落笔：写作官据结论写正文 ———
    // 它与设计角色的区别：**不参与争论**，只把结论当契约执行 —— 避免被过程中
    // 已被否决的方案带偏。它仍然看得到完整讨论记录（要"总结上面的讨论"）。
    emit({ type: 'phase', label: `写作官落笔中（目标 ${WRITER_TARGET_CHARS} 字以上，需要一会儿）` });
    let currentDraft = await speak(
      ROLE_WRITER,
      '【本轮任务】按上面的「本章结论」写出本章正文。'
      + '结论的节拍 / 关键物 / 角色 / 伏笔 / 禁项都是硬约束，逐条落实。直接输出正文。',
      { maxTokens: WRITER_MAX_TOKENS },
    );

    // ——— 篇幅自检：低于下限先补一次，再进意图门 ———
    //   必须排在意图门**之前**：门只该验收最终稿，补写出来的内容也得过门。
    //   只补一次，且**取更长的一稿** —— 补写不可能让结果比初稿更短。
    //   注：意图门打回触发的重写不重复这道检查（避免调用次数失控），
    //   重写指令里已写明「篇幅不得少于 X 字」。
    const initialLen = proseLength(currentDraft);
    if (initialLen < WRITER_MIN_CHARS) {
      emit({ type: 'phase', label: `篇幅不足（${initialLen} 字），请写作官补写…` });
      try {
        // 补写前先按需回读一段更早的前情（斗位之外），给"加细节"提供素材
        const recalled = await recallEarlier(ROLE_WRITER.key);
        const expanded = await speak(
          ROLE_WRITER,
          `【本轮任务】你上一稿只有 ${initialLen} 字，未达 ${WRITER_MIN_CHARS} 字下限。`
          + `请在**现有内容基础上补写**（不要重写、不要压缩已有段落，只增加细节、动作、对话与描写），`
          + `把篇幅补到 ${WRITER_TARGET_CHARS} 字以上。直接输出补写后的**完整正文**。`
          + (recalled ? `\n\n${recalled}` : ''),
          { maxTokens: WRITER_MAX_TOKENS },
        );
        const expandedLen = proseLength(expanded);
        // 补写失败（更短）就保留初稿 —— 不能把「短稿」换成「更短的稿」
        if (expandedLen > initialLen) {
          currentDraft = expanded;
          console.log(`[discuss] 篇幅补写 ${initialLen} → ${expandedLen} 字`);
        } else {
          console.warn(`[discuss] 篇幅补写未变长（${initialLen} → ${expandedLen} 字），保留初稿`);
        }
      } catch (e) {
        console.warn('[discuss] 篇幅补写失败，按初稿继续:', e);
      }
    }
    emit({ type: 'draft', text: currentDraft, revision: 0 });

    // ——— 意图复核：对照结论验收，不合格打回重写 ———
    // 这道门防的是「白写了」—— 方向错了整章作废，比事实性错误贵得多，所以排在最前。
    let approved = false;
    for (let attempt = 1; attempt <= MAX_REVISIONS; attempt++) {
      emit({ type: 'phase', label: `意图复核（第 ${attempt} 次）` });
      const review = await speak(
        ROLE_REVIEWER,
        '【本轮任务】对照上面的「本章结论」验收**写作官最新一稿**（讨论记录里最后一条写作官正文；'
        + '若前面还有更早的稿子，那是被替代的旧稿，不要拿它作数）。按格式输出判定与逐维结论。',
      );
      // 判定行解析：只有明确写「打回」才重写 —— 解析不到一律当通过，避免格式跑偏导致死循环
      const passed = !/判定\s*[：:]\s*打回/.test(review);
      emit({ type: 'review', text: review, attempt, passed });
      if (passed) {
        approved = true;
        break;
      }

      if (attempt === MAX_REVISIONS) {
        // 超限不硬撑：停下交给作者，别让它在循环里烧钱
        emit({ type: 'phase', label: `已达重写上限（${MAX_REVISIONS} 次），停在待人工处理` });
        break;
      }

      emit({ type: 'phase', label: `第 ${attempt} 次打回，写作官按修改要求重写中…` });
      // 修改要求就在 transcript 里（复核的话），写作官能看到 —— 不必另传
      currentDraft = await speak(
        ROLE_WRITER,
        '【本轮任务】你上一稿没过意图复核。按上文「意图复核」给出的**修改要求**重写。'
        + '**能局部改就不要整章重来**，只动需要动的地方；直接输出修改后的**完整正文**。'
        + `注意：修改后篇幅仍不得少于 ${WRITER_MIN_CHARS} 字。`,
        { maxTokens: WRITER_MAX_TOKENS },
      );
      emit({ type: 'draft', text: currentDraft, revision: attempt });
    }
    /**
     * 未过意图门时的交付警示。
     *
     * ★ 这里曾经是「不通过就不交付」，实测 30 章连写时**丢了 2/7 章** —— 缺章会让
     *   后面所有章失去前情（比带瑕疵的一章糟得多），而且脚本/后台跑的时候作者根本
     *   看不到那份没入库的稿子。现在改为**带警示照常交付**，由作者事后复核。
     */
    const warnings: string[] = [];
    if (!approved) {
      warnings.push(`意图门未通过（打回 ${MAX_REVISIONS} 次），请人工复核本章`);
      emit({
        type: 'phase',
        label: `已达重写上限（${MAX_REVISIONS} 次）仍未通过意图门 —— 仍会交付（缺章比带瑕疵更糟），交付结果里会标注`,
      });
    }

    {
      /** 目标章号：后面两道门与交付都要用（deliver 内部会再算一次，规则相同） */
      const targetOrder = chapterOrder ?? parseChapterOrder(message) ?? 0;

      // ——— 校对门（硬门 · 全文 × 设定库）———
      // 与意图门的分工：意图门是「答应的事做了吗」（点，对照本章结论），
      // 校对门是「有没有说错话」（面，全文扫描设定库）。
      // 治理上刻意只给它**一次定向修订**：第二个打回循环会引来第三、第四个，
      // 而两次打回后整章作废的代价（实测 2026-09-12：3333 字全废）远大于残留一处小冲突。
      emit({ type: 'phase', label: '校对门：全文对照设定库…' });
      let gate = await runConsistencyGate(ctx, { order: targetOrder, draft: currentDraft, digest: await getProofreadDigest() as SettingsDigest, userId });
      emit({
        type: 'gate',
        name: 'check',
        passed: gate.pass,
        // ★ 执行失败（两次都没解析成功）要标出来：passed=true 是"不拦交付"的取舍，
        //   但绝不能让它看起来像是"检查通过了"
        ...(gate.error ? { skipped: true } : {}),
        detail: gate.error
          ? gate.error
          : (gate.pass ? '未发现与设定库冲突' : (gate.conflicts.join('；') || '未给出具体冲突')),
      });
      if (!gate.pass) {
        emit({ type: 'phase', label: `校对门发现 ${gate.conflicts.length || 1} 处冲突，写作官定向修订中…` });
        try {
          const fixed = await speak(
            ROLE_WRITER,
            '【本轮任务】校对官把正文与设定库逐条比对，发现下列冲突，请**定向修正**：\n'
            + (gate.conflicts.map((c, i) => `${i + 1}. ${c}`).join('\n') || '（校对官未列出具体条目）')
            + (gate.instructions ? `\n校对官的修正指令：${gate.instructions}` : '')
            + '\n\n只改涉及处，不要重写全章；直接输出修正后的**完整正文**。'
            + `篇幅不得少于 ${WRITER_MIN_CHARS} 字。`,
            { maxTokens: WRITER_MAX_TOKENS },
          );
          if (fixed.trim()) currentDraft = fixed;
          emit({ type: 'draft', text: currentDraft, revision: MAX_REVISIONS + 1 });
          const recheck = await runConsistencyGate(ctx, { order: targetOrder, draft: currentDraft, digest: await getProofreadDigest() as SettingsDigest, userId });
          emit({
            type: 'gate',
            name: 'check',
            passed: recheck.pass,
            detail: recheck.error
              ? recheck.error
              : (recheck.pass
                ? '定向修订后冲突已消除'
                : `定向修订后仍有冲突：${recheck.conflicts.join('；')}`),
          });
          gate = recheck;
        } catch (e) {
          console.warn('[discuss] 校对门定向修订失败，按原稿继续:', e);
        }
      }
      if (!gate.pass) {
        // 不阻塞：宁可带着一处标注交付，也不要让整章作废
        emit({
          type: 'phase',
          label: `校对门仍有 ${gate.conflicts.length || 1} 处冲突未消除 —— 不拦交付，请在成稿里人工确认`,
        });
      }

      // ——— 润色门（软门 · 评分）——从不阻塞交付 ———
      emit({ type: 'phase', label: '润色门：质量评分中…' });
      const polish = await runPolishGate(ctx, { order: targetOrder, draft: currentDraft, userId });
      emit({
        type: 'gate',
        name: 'polish',
        passed: !polish.error && polish.score >= POLISH_PASS_SCORE,
        ...(polish.error ? { skipped: true } : {}),
        score: polish.score,
        detail: polish.error ?? (polish.comments || '（无评语）'),
      });

      // 只有过了意图门才落库 —— 别把没过门的东西写进章节
      emit({ type: 'phase', label: '交付中…' });
      const delivered = await deliver(ctx, { projectId, message, order: chapterOrder, draft: currentDraft }, emit);

      // —— 实体沉淀：把本章新出现/变动的角色·物品·地点·伏笔写进项目库 ——
      // 只跟着**真交付**走：被治理拦下的（已有正文不覆盖 / 没认出章号）绝不沉淀，
      // 否则设定库里会出现正文里根本没有的实体。
      if (delivered.delivered) {
        // ★ A3：故事内时间（水车三层时间戳的第三层）—— 从定稿官契约里抽，抽不到就不写
        const storyTime = await persistChapterStoryTime(ctx, projectId, delivered.order, conclusion);
        if (storyTime) emit({ type: 'phase', label: `故事内时间：${storyTime}` });
        emit({ type: 'phase', label: '沉淀本章实体中…' });
        const sink = await persistChapterEntities(ctx, {
          projectId,
          order: delivered.order,
          draft: currentDraft,
          conclusion,
          existingForeshadows: digest.foreshadows,
          userId,
        });
        emit({
          type: 'entities',
          created: sink.created,
          updated: sink.updated,
          skipped: sink.skipped,
          notes: sink.notes,
        });
      }
    }

    if (opts.finalDone !== false) emit({ type: 'done' });
  } catch (e) {
    emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    if (opts.finalDone !== false) emit({ type: 'done' });
  }
}

// ============================================================
// 连写多章（P1-2）
//
// 动机：在此之前一轮会话只能处理一章 —— 想写 10 章就得有人守着敲 10 次，
// 那不叫「自动写作」。这里把单章闭环串成循环。
//
// 设计要点：
//   · **逐章串行**：每章都完整跑讨论 → 结论 → 落笔 → 三道门 → 交付 → 沉淀，
//     不给它「跳过某步省事」的机会（多章连写最容易在这里偷工减料）。
//   · **一章失败不拖垮后面**：单章内部已把异常收敛成 error 事件，
//     这里只统计成败、继续下一章，最后汇总 —— 30 章跑到第 17 章崩掉不该全废。
//   · **后续章的指令由上一章自然延续**：不重复作者的原始口头指令（那是指向第 1 章的），
//     改发「接着上一章往下写第 N 章」，并靠「上一章全文注入」保证衔接。
//   · 事件带 index/total，前端据此分段显示。
// ============================================================

export interface MultiChapterOpts extends DiscussionOpts {
  /** 连写章数（1 = 单章） */
  chapterCount: number;
}

export async function runChapters(
  ctx: ServerPluginContext,
  opts: MultiChapterOpts,
  emit: (e: SessionEvent) => void,
): Promise<void> {
  const total = Math.max(1, Math.min(50, Math.floor(opts.chapterCount) || 1));
  const from = opts.chapterOrder ?? parseChapterOrder(opts.message) ?? 1;
  let ok = 0;

  for (let i = 0; i < total; i++) {
    const order = from + i;
    const index = i + 1;
    emit({ type: 'chapter_start', order, index, total });

    // 第 1 章用作者原话；之后各章自动续写（作者的指令是写给第 1 章的，不能一路照抄）
    const message = i === 0
      ? opts.message
      : `接着上一章往下写第 ${order} 章。保持人物、伏笔与文风的连续性，不要重述上一章已经写过的内容。`;

    let failed = false;
    const wrapped = (e: SessionEvent) => {
      if (e.type === 'error') failed = true;
      emit(e);
    };

    try {
      await runDiscussion(
        ctx,
        { ...opts, message, chapterOrder: order, finalDone: false },
        wrapped,
      );
    } catch (e) {
      failed = true;
      const detail = e instanceof Error ? e.message : String(e);
      emit({ type: 'error', message: `第 ${order} 章异常中止：${detail}` });
    }

    if (!failed) ok++;
    emit({ type: 'chapter_done', order, index, total, delivered: !failed });
  }

  console.log(`[discuss] 连写结束：${ok}/${total} 章无错（起始第 ${from} 章）`);
  emit({ type: 'done' });
}
