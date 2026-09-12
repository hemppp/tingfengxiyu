// ============================================================
// 自动写作工具 —— 运维三件套（恢复 / 进度 / 台账）
// ============================================================

import type { ServerPluginContext, ToolDefinition } from '@novel/core';
import { FlowStore } from '../framework/flow-store.js';
import { batchSummary, ok, fail, type ToolCtx } from './helpers.js';

export const resumeBatchDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_resume_batch',
    description: '恢复被暂停（预算超支）或隔离（连续失败）的批次。必须在作者明确要求继续后调用。',
    parameters: {
      type: 'object',
      properties: { batchId: { type: 'string' }, note: { type: 'string', description: '恢复原因（记入台账）' } },
      required: ['batchId'],
    },
  },
};

export const statusDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_status',
    description: '查看批次与各章流转进度（断点续跑前先调它）。',
    parameters: {
      type: 'object',
      properties: { batchId: { type: 'string', description: '缺省取当前项目最新活跃批次' } },
      required: [],
    },
  },
};

export const auditDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_audit',
    description: '查看批次审计台账（每步的模型、耗时、决策理由）。',
    parameters: {
      type: 'object',
      properties: { batchId: { type: 'string' }, limit: { type: 'number', description: '返回最近 N 条，缺省 20' } },
      required: ['batchId'],
    },
  },
};

export function resumeBatchHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const store = new FlowStore(ctx.db.kv, projectId);
    const batch = store.loadBatch(String(args.batchId ?? ''));
    if (!batch) return fail('批次不存在：' + String(args.batchId ?? ''));
    if (batch.status !== 'paused' && batch.status !== 'quarantined') {
      return fail(`批次状态为 ${batch.status}，无需恢复`);
    }
    batch.status = 'running';
    batch.note = undefined;
    await store.saveBatch(batch);
    await store.appendAudit(batch.id, { ts: Date.now(), step: 'resume', decision: '作者恢复批次：' + String(args.note ?? '').slice(0, 100) });
    return ok('批次已恢复。当前进度：\n' + batchSummary(batch, store));
  };
}

export function statusHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const store = new FlowStore(ctx.db.kv, projectId);
    const batch = args.batchId ? store.loadBatch(String(args.batchId)) : store.findActiveBatch();
    if (!batch) return ok('当前项目没有自动写作批次。');
    return ok(batchSummary(batch, store));
  };
}

export function auditHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const store = new FlowStore(ctx.db.kv, projectId);
    const batchId = String(args.batchId ?? '');
    if (!store.loadBatch(batchId)) return fail('批次不存在：' + batchId);
    const list = store.getAudit(batchId);
    const lim = Math.max(1, Math.min(100, Math.floor(Number(args.limit ?? 20))));
    const lines = list.slice(-lim).map((e) => {
      const time = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
      const target = e.order != null ? ` 第${e.order}章` : '';
      const model = e.model ? ` [${e.model}]` : '';
      const cost = e.ms != null ? ` ${e.ms}ms` : '';
      return `${time} ${e.step}${target}${model}：${e.decision}${cost}`;
    });
    return ok(`审计台账（最近 ${lines.length}/${list.length} 条）：\n${lines.join('\n') || '（空）'}`);
  };
}
