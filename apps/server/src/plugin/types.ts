// ============================================================
// Server 插件类型 —— 宿主侧 re-export + host 特有类型
//
// 插件作者使用的契约类型（ServerPluginContext/KvService/ToolDefinition 等）
// 统一来自 @novel/core（见 packages/core/src/plugin-context.ts）。
// 本文件只保留 host 实现特有的类型。
// ============================================================

import type { Hono } from 'hono';

export type {
  ServerPluginContext,
  KvService,
  ToolDefinition,
  ToolHandler,
  ToolContext,
} from '@novel/core';

/** host 实现特有：路由注册条目 */
export interface RouteRegistration {
  prefix: string;
  router: Hono;
}

/** host 实现特有：AI 工具注册条目 */
export interface ToolRegistration {
  definition: import('@novel/core').ToolDefinition;
  handler: import('@novel/core').ToolHandler;
}
