// ============================================================
// 自动写作 flow 型技能 —— 装配
//
// ⚠️ 已废弃（标注于 2026-09-12）：这是一条**与现役链路脱节**的批次流水线。
//
//   现役链路是 `server/discuss/*`（`POST /api/plugins/autowrite/session`，SSE），
//   以**单章**为单位：讨论 → 收敛本章结论 → 落笔 → 意图门 → 交付 → 实体沉淀。
//   这里的 8 个工具在 AI 写作模式（`project.mode === 'auto'`）下**根本调不到** ——
//   讨论链路给子代理的工具白名单只有 `list_chapters` / `read_chapter`；
//   它们只可能被**手写模式**的 AI 对话（ChatPanel 开工具）调起。
//
//   `AutoWriteWorkbench` 已不连这套流程（其计划卡读的是会话结论，不是 `/batches`）。
//   保留原因：`/batches` 状态路由与 FlowStore 的审计台账将来可能迁到讨论链路复用。
//   → 取舍决策见 `docs/ai-writing-handover.md` §2 / §8-1。**新代码不要再往这里加东西。**
//
// FlowSpec（声明）+ 8 个流程工具（裁决式执行）。
// 工具注册走 ctx.effect 包裹，插件禁用/卸载时随 DisposerBag 自动注销。
// ============================================================

import type { ServerPluginContext } from '@novel/core';
import type { FlowSpec } from '../framework/types.js';
import { planBatchDef, planBatchHandler } from './tool-plan.js';
import { writeDraftDef, writeDraftHandler } from './tool-write.js';
import { checkDraftDef, polishDraftDef, checkDraftHandler, polishDraftHandler } from './tool-review.js';
import { confirmChapterDef, confirmChapterHandler } from './tool-deliver.js';
import { resumeBatchDef, statusDef, auditDef, resumeBatchHandler, statusHandler, auditHandler } from './tools-admin.js';
import { buildOrchestratorPrompt } from './prompts.js';
import { GOVERNANCE } from './helpers.js';

/** 自动写作 FlowSpec（治理见 helpers.ts GOVERNANCE） */
export const AUTOWRITE_SPEC: FlowSpec = {
  steps: ['plan', 'write', 'check', 'polish', 'deliver'],
  gate: 'per-chapter',
  governance: GOVERNANCE,
};

/** 自动写作技能定义（编排器协议由 FlowSpec 生成） */
export const AUTOWRITE_SKILL = {
  id: 'auto-write',
  name: '自动写作',
  description: 'AI 自动写作：按大纲多代理流水线逐章写作（规划→写作→校对→润色→交付）',
  color: 'hsl(0 0% 12%)', // 水墨化：原 #2383C7；自动写作是「主笔」，给最重的一档墨
  ownerAgent: 'writer', // 2026-09-15 显式声明归属（此前靠种子逻辑硬编码）
  contextKeys: [],
  systemPrompt: buildOrchestratorPrompt(AUTOWRITE_SPEC.gate),
};

/** 注册全部流程工具（每工具一个 effect，可独立注销） */
export function registerAutowrite(ctx: ServerPluginContext): void {
  const tools: Array<[typeof planBatchDef, ReturnType<typeof planBatchHandler>]> = [
    [planBatchDef, planBatchHandler(ctx)],
    [writeDraftDef, writeDraftHandler(ctx)],
    [checkDraftDef, checkDraftHandler(ctx)],
    [polishDraftDef, polishDraftHandler(ctx)],
    [confirmChapterDef, confirmChapterHandler(ctx)],
    [resumeBatchDef, resumeBatchHandler(ctx)],
    [statusDef, statusHandler(ctx)],
    [auditDef, auditHandler(ctx)],
  ];
  for (const [def, handler] of tools) {
    ctx.effect(() => ctx.ai.tools.register(def, handler), `autowrite: ${def.function.name}`);
  }
}
