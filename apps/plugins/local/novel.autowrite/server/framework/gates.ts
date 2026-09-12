// ============================================================
// 三道门之「校对门 + 润色门」—— 讨论链路的落地（架构 §5）
//
// 分工（别混，踩过）：
//   意图门（`discuss/roles.ts` 的 ROLE_REVIEWER）—— **点**：答应的事做了吗（对照本章结论）
//   校对门（本文件 runConsistencyGate）          —— **面**：有没有说错话（全文 × 设定库）
//   润色门（本文件 runPolishGate）               —— **评分**：文笔 / 节奏
//
// 治理取向（与意图门刻意不同，原因见下）：
//   · 校对门是**硬门**，但只给它**一次定向修订**的机会；修订后仍不过也**不阻塞交付**，
//     而是把冲突清单如实交给人工。理由：第二个「打回—重写」循环会带来第三、第四个，
//     而两次打回后整章作废的代价（实测 2026-09-12：3333 字全废）远大于残留一处小冲突。
//   · 润色门是**软门**：只评分、给意见，**从不阻塞** —— 评分低不该拦下一章。
//
// 探针提示词来自 `autowrite/prompts.ts`（旧流水线的 CHECKER_SYSTEM / REVIEWER_SYSTEM）。
// 那两个 prompt 本身与链路无关，直接复用；改它们会同时影响两边，改前想清楚。
// ============================================================

import type { ServerPluginContext } from '@novel/core';
import { CHECKER_SYSTEM, REVIEWER_SYSTEM } from '../autowrite/prompts.js';
import { parseJsonLoose } from '../autowrite/helpers.js';

export interface ConsistencyVerdict {
  pass: boolean;
  /** 冲突清单（含出处设定），最多 10 条 */
  conflicts: string[];
  /** 给写作官的定向修正指令 */
  instructions: string;
  /**
   * 非空表示这次比对**没能执行**（模型调用/解析失败）。
   * 此时 `pass` 一律为 `true` —— 绝不能因为基础设施抖动就让稿子被打回；
   * 但也**不能静默吞掉**：调用方必须把它透给作者看（实测踩过：静默失败
   * 会让校对门变成一个永远「跳过」的摆设，白白多烧一次调用）。
   */
  error?: string;
}

export interface PolishVerdict {
  score: number;
  comments: string;
  /** 同 ConsistencyVerdict.error：非空 = 这一步没执行成功 */
  error?: string;
}

/** 校对官对照的设定摘要（直接取 context-resolver 的 digest 三栏） */
export interface GateDigest {
  characters: string;
  foreshadows: string;
  outline: string;
}

/** 润色通过线（软门仅用于展示「是否达标」，不拦交付） */
export const POLISH_PASS_SCORE = 7;

/**
 * 校对门：全文 × 设定库一致性机判。
 *
 * **不会抛错**。执行失败时返回带 `error` 的「通过」结论 —— 调用方据此照常交付，
 * 但要把 error 透给作者（别再静默跳过）。
 */
export async function runConsistencyGate(
  ctx: ServerPluginContext,
  opts: { order: number; draft: string; digest: GateDigest; userId?: string },
): Promise<ConsistencyVerdict> {
  try {
    const raw = await ctx.ai.complete({
      messages: [
        { role: 'system', content: CHECKER_SYSTEM },
        {
          role: 'user',
          content: [
            '【设定摘要】',
            '角色：',
            opts.digest.characters,
            '',
            '伏笔：',
            opts.digest.foreshadows,
            '',
            '大纲：',
            opts.digest.outline,
            '',
            `【章节初稿（第${opts.order}章）】`,
            opts.draft,
          ].join('\n'),
        },
      ],
      json: true,
      temperature: 0.1,
      // ★ 必须给足：校对官要逐条列出「冲突描述 + 出处」，正文一长输出就上千 token。
      //   实测（2026-09-12）：设 2048 时多章跑下来会**间歇性截断** → JSON 解析失败 →
      //   整个门静默跳过（还白烧一次调用）。与 entity-sink 同量级取 4096。
      maxTokens: 4096,
      userId: opts.userId,
    });
    const parsed = parseJsonLoose<{ pass?: boolean; conflicts?: unknown; instructions?: unknown }>(raw);
    return {
      pass: parsed.pass === true,
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.map(String).slice(0, 10) : [],
      instructions: String(parsed.instructions ?? '').slice(0, 300),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[gates] 校对官调用失败（按通过处理，不拦交付）:', msg);
    return { pass: true, conflicts: [], instructions: '', error: `校对门未能执行：${msg}` };
  }
}

/** 润色门：质量评分（软门，从不阻塞交付；执行失败同样返回带 error 的结果） */
export async function runPolishGate(
  ctx: ServerPluginContext,
  opts: { order: number; draft: string; userId?: string },
): Promise<PolishVerdict> {
  try {
    const raw = await ctx.ai.complete({
      messages: [
        { role: 'system', content: REVIEWER_SYSTEM },
        { role: 'user', content: `【章节初稿（第${opts.order}章）】\n${opts.draft}` },
      ],
      json: true,
      temperature: 0.2,
      maxTokens: 1536,
      userId: opts.userId,
    });
    const parsed = parseJsonLoose<{ score?: unknown; comments?: unknown }>(raw);
    return {
      score: Math.max(0, Math.min(10, Math.round(Number(parsed.score ?? 0)))),
      comments: String(parsed.comments ?? '').slice(0, 200),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[gates] 评审官调用失败（跳过润色门）:', msg);
    return { score: 0, comments: '', error: `润色门未能执行：${msg}` };
  }
}
