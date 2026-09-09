// ============================================================
// 项目级请求作用域工具
//
// 在每本书独立 .db 文件的架构下，所有项目级路由都需要：
// 1. 从 URL 参数或 X-Project-Id 头部提取 projectId
// 2. 校验当前用户对该项目的所有权
// 3. 初始化（或复用缓存中的）项目库连接
// 4. 将 projectId 写入 Hono context 供下游 service 使用
//
// 本文件提供 requireProjectScope 辅助函数，收口以上 4 步，
// 让所有项目级 router 只需一行调用即可完成 scope 准备。
// ============================================================

import type { Context } from 'hono';
import { initProjectDb } from '@novel/db';
import { verifyProjectOwnership } from './ownership.js';
import type { AuthVariables } from '../middleware/auth.js';

/** Hono Variables 扩展：项目级路由可通过 c.get('projectId') 取得 projectId */
export type ProjectScopedVariables = AuthVariables & {
  /** 项目级路由注入的 projectId；非项目级路由（如 /api/auth）不存在此键 */
  projectId?: string;
};

/**
 * 从 URL 参数（:projectId）或 X-Project-Id 头部提取 projectId。
 * 两种来源都为空时返回空字符串。
 */
export function extractProjectId(c: Context): string {
  return c.req.param('projectId') || c.req.header('X-Project-Id') || '';
}

/**
 * 项目级路由的统一前置校验：
 * 1. 提取 projectId（URL > header）
 * 2. 校验所有权
 * 3. 初始化项目库连接
 * 4. 写入 c.var.projectId
 *
 * 返回 null 表示通过；返回 Response 表示失败，router 应直接 return。
 *
 * @param options.allowMissing - 为 true 时，projectId 缺失不报错（用于可选 project-scoped 的路由）
 */
export async function requireProjectScope(
  c: Context<{ Variables: ProjectScopedVariables }>,
  options?: { allowMissing?: boolean },
): Promise<Response | null> {
  const projectId = extractProjectId(c);
  if (!projectId) {
    if (options?.allowMissing) return null;
    return c.json(
      { error: { code: 'BAD_REQUEST', message: '缺少 projectId（应在 URL 参数或 X-Project-Id 头部中提供）' } },
      400,
    );
  }
  const denial = await verifyProjectOwnership(c, projectId);
  if (denial) return denial;
  await initProjectDb(projectId);
  c.set('projectId', projectId);
  return null;
}
