// ============================================================
// 自动写作工具 —— 写作官（出稿）
// ============================================================

import type { ServerPluginContext, ToolDefinition } from '@novel/core';
import { FlowStore } from '../framework/flow-store.js';
import { canTransition, applyAction, budgetVerdict } from '../framework/flow-state.js';
import { resolveSettingsDigest } from '../framework/context-resolver.js';
import { GOVERNANCE, WRITER_MAX_TOKENS, resolvePrevSummary, userIdOf, ok, fail, type ToolCtx } from './helpers.js';
import { WRITER_SYSTEM } from './prompts.js';

export const writeDraftDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_write_draft',
    description: '写作官出稿：按批次细纲写作指定章节的正文初稿。草稿全文由框架持有，只返回摘要。',
    parameters: {
      type: 'object',
      properties: {
        batchId: { type: 'string' },
        order: { type: 'number', description: '章节序号' },
      },
      required: ['batchId', 'order'],
    },
  },
};

export function writeDraftHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const userId = userIdOf(toolCtx);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batchId = String(args.batchId ?? '');
    const order = Math.floor(Number(args.order));

    const batch = store.loadBatch(batchId);
    if (!batch) return fail('批次不存在：' + batchId + '（可用 autowrite_status 查看）');
    if (batch.status === 'quarantined') return fail('批次已隔离（' + (batch.note ?? '连续失败') + '）：需作者处理后 autowrite_resume_batch 恢复');
    if (batch.status === 'paused') return fail('批次已暂停（' + (batch.note ?? '预算超支') + '）：需作者同意后 autowrite_resume_batch 恢复');
    if (batch.status !== 'running') return fail('批次状态为 ' + batch.status + '，不能出稿');
    const chapter = batch.chapters.find((c) => c.order === order);
    if (!chapter) return fail(`批次中没有第${order}章的细纲（范围第${batch.from}-${batch.to}章）`);

    const flow = store.loadFlow(batchId, order) ?? FlowStore.newFlow(batchId, order);
    if (flow.step === 'delivered') return fail(`第${order}章已交付，不可经流水线重写（改稿请走正常编辑/快照回滚）`);
    const verdict = canTransition(flow.step, 'write');
    if (!verdict.ok) return fail(verdict.reason ?? '状态机拒绝');

    const digest = await resolveSettingsDigest(ctx, projectId);
    const prev = await resolvePrevSummary(ctx, store, projectId, batchId, order);
    const revisionNotes = [
      flow.check?.pass === false && flow.check.instructions ? `\n\n【上一稿校对修正指令（必须落实）】\n${flow.check.instructions}` : '',
      flow.polish && flow.polish.score < GOVERNANCE.reviewer.threshold && flow.polish.comments ? `\n\n【上一稿评审意见（必须改进）】\n${flow.polish.comments}` : '',
    ].join('');
    const t0 = Date.now();
    const result = await ctx.ai.agents.run({
      system: WRITER_SYSTEM,
      input: `【本章细纲（第${order}章《${chapter.title}》）】\n${chapter.brief}\n\n【前情摘要】\n${prev}\n\n【设定摘要】\n角色：\n${digest.characters}\n\n伏笔：\n${digest.foreshadows}\n\n【目标】写出第${order}章正文，篇幅约 2500-4500 字。${revisionNotes}`,
      tools: ['list_chapters', 'read_chapter'],
      context: { projectId, userId },
      maxTurns: 5,
      maxTokens: WRITER_MAX_TOKENS,
    });
    const draft = (result.text ?? '').trim();
    if (draft.length < 200) {
      return fail('写作官产出异常（不足 200 字），已丢弃未入状态。原始输出：' + draft.slice(0, 200));
    }

    flow.draft = draft;
    flow.step = applyAction(flow.step, 'write');
    flow.revisions += 1;
    flow.usedChars += draft.length;

    let budgetNote = '';
    if (budgetVerdict(flow.usedChars, GOVERNANCE.budgetPerChapter) === 'exceeded') {
      batch.status = 'paused';
      batch.note = `第${order}章累计产出 ${flow.usedChars} 字符超预算（${GOVERNANCE.budgetPerChapter}）`;
      await store.saveBatch(batch);
      budgetNote = '\n⚠ 本章预算超支，批次已暂停：请向作者呈报并等待指示。';
    }
    await store.saveFlow(flow);
    await store.appendAudit(batchId, { ts: Date.now(), step: 'write', order, model: result.model, ms: Date.now() - t0, decision: `第${flow.revisions}稿，${draft.length}字` });
    return ok(`第${order}章初稿完成（${draft.length} 字，第 ${flow.revisions} 稿）。\n开头预览：${draft.slice(0, 150)}…${budgetNote}\n下一步：autowrite_check_draft`);
  };
}
