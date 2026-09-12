// ============================================================
// 自动写作工具 —— 审查双门（校对硬门 + 评审软门）
// ============================================================

import type { ServerPluginContext, ToolDefinition } from '@novel/core';
import { FlowStore } from '../framework/flow-store.js';
import { canTransition, stepAfterGateFail } from '../framework/flow-state.js';
import { resolveSettingsDigest } from '../framework/context-resolver.js';
import { GOVERNANCE, parseJsonLoose, userIdOf, ok, fail, type ToolCtx } from './helpers.js';
import { CHECKER_SYSTEM, REVIEWER_SYSTEM } from './prompts.js';

export const checkDraftDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_check_draft',
    description: '校对官（一致性硬门）：初稿对照设定机判，冲突即打回。不通过时按返回的 instructions 重写。',
    parameters: {
      type: 'object',
      properties: { batchId: { type: 'string' }, order: { type: 'number' } },
      required: ['batchId', 'order'],
    },
  },
};

export const polishDraftDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_polish_draft',
    description: '评审官（质量软门）：按网文标准评分，低于 7 分打回重写。',
    parameters: {
      type: 'object',
      properties: { batchId: { type: 'string' }, order: { type: 'number' } },
      required: ['batchId', 'order'],
    },
  },
};

/** 门打回/隔离的公共收尾：计数、隔离判定、台账 */
async function gateFail(
  ctx: ServerPluginContext, store: FlowStore, batchId: string, order: number,
  gate: 'check' | 'polish', fails: number, reason: string, model: string | undefined, ms: number,
): Promise<string> {
  const batch = store.loadBatch(batchId)!;
  let note = '';
  if (fails >= GOVERNANCE.retries) {
    batch.status = 'quarantined';
    batch.note = `第${order}章${gate === 'check' ? '校对' : '评审'}连续 ${fails} 次不通过`;
    await store.saveBatch(batch);
    note = '\n⚠ 已达重试上限，批次隔离：请向作者如实呈报，等待处理（作者同意后 autowrite_resume_batch）。';
  }
  await store.appendAudit(batchId, { ts: Date.now(), step: gate, order, model, ms, decision: `门打回（第${fails}次）：${reason}` });
  return note;
}

export function checkDraftHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const userId = userIdOf(toolCtx);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batchId = String(args.batchId ?? '');
    const order = Math.floor(Number(args.order));
    const flow = store.loadFlow(batchId, order);
    if (!flow?.draft) return fail(`第${order}章尚无草稿，请先 autowrite_write_draft`);
    const verdict = canTransition(flow.step, 'check');
    if (!verdict.ok) return fail(verdict.reason ?? '状态机拒绝');

    const digest = await resolveSettingsDigest(ctx, projectId);
    const t0 = Date.now();
    let parsed: { pass?: boolean; conflicts?: unknown; instructions?: unknown };
    try {
      const raw = await ctx.ai.complete({
        messages: [
          { role: 'system', content: CHECKER_SYSTEM },
          { role: 'user', content: `【设定摘要】\n角色：\n${digest.characters}\n\n伏笔：\n${digest.foreshadows}\n\n【章节初稿（第${order}章）】\n${flow.draft}` },
        ],
        json: true,
        userId,
      });
      parsed = parseJsonLoose(raw);
    } catch (e) {
      // 机判调用失败是基础设施错误，不算门失败：编排器可原步重试
      return fail('校对官调用失败（不算冲突，可重试本步）：' + (e as Error).message);
    }

    const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts.map(String).slice(0, 10) : [];
    if (parsed.pass === true) {
      flow.step = 'checked';
      flow.check = { pass: true, conflicts: [], instructions: undefined };
      await store.saveFlow(flow);
      await store.appendAudit(batchId, { ts: Date.now(), step: 'check', order, ms: Date.now() - t0, decision: '硬门通过' });
      return ok(`第${order}章一致性校对通过。下一步：autowrite_polish_draft`);
    }

    flow.checkFails += 1;
    flow.check = { pass: false, conflicts, instructions: String(parsed.instructions ?? conflicts.join('；')).slice(0, 300) };
    flow.step = stepAfterGateFail();
    await store.saveFlow(flow);
    const note = await gateFail(ctx, store, batchId, order, 'check', flow.checkFails, conflicts.join('；').slice(0, 120) || '未给出冲突', undefined, Date.now() - t0);
    return ok(`第${order}章校对不通过（第 ${flow.checkFails} 次）：\n- ${conflicts.join('\n- ') || '未给出具体冲突'}\n修正指令已转交写作官。请调用 autowrite_write_draft 重写。${note}`);
  };
}

export function polishDraftHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const userId = userIdOf(toolCtx);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batchId = String(args.batchId ?? '');
    const order = Math.floor(Number(args.order));
    const flow = store.loadFlow(batchId, order);
    if (!flow?.draft) return fail(`第${order}章尚无草稿`);
    const verdict = canTransition(flow.step, 'polish');
    if (!verdict.ok) return fail(verdict.reason ?? '状态机拒绝');

    const t0 = Date.now();
    let parsed: { score?: unknown; comments?: unknown };
    try {
      const raw = await ctx.ai.complete({
        messages: [
          { role: 'system', content: REVIEWER_SYSTEM },
          { role: 'user', content: `【章节初稿（第${order}章）】\n${flow.draft}` },
        ],
        json: true,
        userId,
      });
      parsed = parseJsonLoose(raw);
    } catch (e) {
      return fail('评审官调用失败（不算打回，可重试本步）：' + (e as Error).message);
    }

    const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score ?? 0))));
    const comments = String(parsed.comments ?? '').slice(0, 200);
    if (score >= GOVERNANCE.reviewer.threshold) {
      flow.step = 'polished';
      flow.polish = { score, comments };
      await store.saveFlow(flow);
      await store.appendAudit(batchId, { ts: Date.now(), step: 'polish', order, ms: Date.now() - t0, decision: `评审 ${score}/10 通过` });
      return ok(`第${order}章评审通过（${score}/10）。${comments}\n下一步：向作者呈报本章概要与审查结论，等作者同意后 autowrite_confirm_chapter(confirm=true)`);
    }

    flow.polishFails += 1;
    flow.polish = { score, comments };
    flow.step = stepAfterGateFail();
    await store.saveFlow(flow);
    const note = await gateFail(ctx, store, batchId, order, 'polish', flow.polishFails, `${score}分：${comments}`, undefined, Date.now() - t0);
    return ok(`第${order}章评审不通过（${score}/10，第 ${flow.polishFails} 次）：${comments}\n请调用 autowrite_write_draft 按意见重写。${note}`);
  };
}
