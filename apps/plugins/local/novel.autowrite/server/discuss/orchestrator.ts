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
import { resolveSettingsDigest, type SettingsDigest } from '../framework/context-resolver.js';
import { persistChapterEntities } from '../framework/entity-sink.js';
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
  | { type: 'delivered'; order: number; title: string; wordCount: number; created: boolean }
  | { type: 'deliver_blocked'; order: number; title: string; reason: string }
  /** 实体沉淀结果：本章交付后写入项目库的角色/物品/地点/伏笔条数 */
  | { type: 'entities'; created: number; updated: number; skipped: number; notes: string[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface DiscussionOpts {
  projectId: string;
  userId: string;
  /** 作者这一轮说的话 */
  message: string;
  /** 可选：在意第几章（写进输入，帮助角色聚焦） */
  chapterOrder?: number;
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
  opts: { projectId: string; message: string; order?: number; draft: string },
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
    emit({ type: 'delivered', order, title: row.title, wordCount, created: false });
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
  emit({ type: 'delivered', order, title, wordCount, created: true });
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
  const factBlock = [
    '【项目现状（框架直接读取项目库得到的真实数据，不是你的记忆）】',
    `项目：${digest.projectName || '未命名'}${digest.genre ? ' · ' + digest.genre : ''}`,
    '',
    '角色：',
    digest.characters,
    '',
    '伏笔：',
    digest.foreshadows,
    '',
    '大纲：',
    digest.outline,
    '',
    '章节：',
    digest.chapters,
  ].join('\n');

  /** 现状块上限：设定很长时截断，并明确告知「被截断了」，避免它以为没写就是没有 */
  const MAX_FACT_CHARS = 6000;
  const facts = factBlock.length > MAX_FACT_CHARS
    ? factBlock.slice(0, MAX_FACT_CHARS) + '\n…（项目数据过长，此处已截断；需要细节请用工具查）'
    : factBlock;

  const header = [
    '【作者要求】',
    message,
    chapterOrder ? `（针对第 ${chapterOrder} 章）` : '',
    '',
    facts,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const buildInput = (role: DesignRole, extra?: string): string => {
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
    const result = await ctx.ai.agents.run({
      system: role.system,
      input: buildInput(role, extra),
      tools: role.tools,
      maxTurns: turnsFor(role),
      ...(opts?.maxTokens != null ? { maxTokens: opts.maxTokens } : {}),
      context: { projectId, userId },
    });
    const text = String(result.text ?? '').trim();
    if (!text) throw new Error(`${role.name}未产出内容（可能是模型调用失败）`);
    transcript.push({ name: role.name, text });
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
        const expanded = await speak(
          ROLE_WRITER,
          `【本轮任务】你上一稿只有 ${initialLen} 字，未达 ${WRITER_MIN_CHARS} 字下限。`
          + `请在**现有内容基础上补写**（不要重写、不要压缩已有段落，只增加细节、动作、对话与描写），`
          + `把篇幅补到 ${WRITER_TARGET_CHARS} 字以上。直接输出补写后的**完整正文**。`,
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
    if (!approved) {
      emit({ type: 'phase', label: '未通过意图门，本章不交付（可在对话里调整后重跑）' });
    } else {
      // 只有过了意图门才落库 —— 别把没过门的东西写进章节
      emit({ type: 'phase', label: '交付中…' });
      const delivered = await deliver(ctx, { projectId, message, order: chapterOrder, draft: currentDraft }, emit);

      // —— 实体沉淀：把本章新出现/变动的角色·物品·地点·伏笔写进项目库 ——
      // 只跟着**真交付**走：被治理拦下的（已有正文不覆盖 / 没认出章号）绝不沉淀，
      // 否则设定库里会出现正文里根本没有的实体。
      if (delivered.delivered) {
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

    emit({ type: 'done' });
  } catch (e) {
    emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    emit({ type: 'done' });
  }
}
