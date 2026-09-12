// ============================================================
// 自动写作工具 —— 规划官（批次细纲）
// ============================================================

import type { ServerPluginContext, ToolDefinition } from '@novel/core';
import { FlowStore, type BatchPlan } from '../framework/flow-store.js';
import { resolveSettingsDigest } from '../framework/context-resolver.js';
import { parseJsonLoose, nowId, batchSummary, userIdOf, ok, fail, type ToolCtx } from './helpers.js';
import { PLANNER_SYSTEM } from './prompts.js';

export const planBatchDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_plan_batch',
    description: '自动写作第一步：为指定章节区间规划逐章细纲批次。已有未完成批次时返回其状态而不重复规划（force=true 时废弃重来）。',
    parameters: {
      type: 'object',
      properties: {
        fromChapter: { type: 'number', description: '起始章节序号（含）' },
        toChapter: { type: 'number', description: '结束章节序号（含）' },
        instruction: { type: 'string', description: '作者对本批次的补充要求（可空）' },
        force: { type: 'boolean', description: '废弃现有未完成批次重新规划' },
      },
      required: ['fromChapter', 'toChapter'],
    },
  },
};

export function planBatchHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const userId = userIdOf(toolCtx);
    const store = new FlowStore(ctx.db.kv, projectId);
    const from = Math.max(1, Math.floor(Number(args.fromChapter ?? 1)));
    const to = Math.max(from, Math.floor(Number(args.toChapter ?? from)));

    const active = store.findActiveBatch();
    if (active && args.force !== true) {
      return ok('已有未完成批次（续跑即可，不必重新规划）：\n' + batchSummary(active, store));
    }
    if (active && args.force === true) {
      active.status = 'done';
      active.note = '被新规划废弃';
      await store.saveBatch(active);
    }

    const digest = await resolveSettingsDigest(ctx, projectId);
    const t0 = Date.now();
    const raw = await ctx.ai.agents.run({
      system: PLANNER_SYSTEM,
      input: `项目：${digest.projectName}（${digest.genre}）\n\n【设定摘要】\n角色：\n${digest.characters}\n\n伏笔：\n${digest.foreshadows}\n\n【大纲】\n${digest.outline}\n\n【已有章节】\n${digest.chapters}\n\n【任务】为第${from}章到第${to}章规划逐章细纲。${args.instruction ? `\n作者要求：${String(args.instruction)}` : ''}`,
      tools: ['list_chapters', 'read_chapter'],
      context: { projectId, userId },
      maxTurns: 6,
    });

    let plan: { chapters?: Array<{ order?: unknown; title?: unknown; brief?: unknown }> };
    try {
      plan = parseJsonLoose(raw.text);
    } catch (e) {
      return fail('规划输出无法解析为 JSON（可重试本步）：' + (e as Error).message);
    }
    const chapters = (plan.chapters ?? [])
      .map((c) => ({
        order: Math.floor(Number(c.order)),
        title: String(c.title ?? '').trim() || `第${Math.floor(Number(c.order))}章`,
        brief: String(c.brief ?? '').trim(),
      }))
      .filter((c) => Number.isFinite(c.order) && c.order >= from && c.order <= to && c.brief);
    if (chapters.length === 0) {
      return fail('规划结果为空或章节序号越界，可重试。原始输出前 200 字：' + raw.text.slice(0, 200));
    }

    const batch: BatchPlan = { id: nowId(), from, to, chapters, status: 'running', cursor: 0, createdAt: Date.now() };
    await store.saveBatch(batch);
    await store.appendAudit(batch.id, { ts: Date.now(), step: 'plan', model: raw.model, ms: Date.now() - t0, decision: `规划 ${chapters.length} 章（第${from}-${to}章）` });
    return ok('批次规划完成：\n' + batchSummary(batch, store) + '\n下一步：逐章 autowrite_write_draft');
  };
}
