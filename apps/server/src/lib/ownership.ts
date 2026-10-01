// ============================================================
// 所有权校验工具 — 确保用户只能访问自己的项目数据
// ============================================================

import { getProject } from '../services/project-service.js';
import type { Context } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';

/**
 * 验证当前用户是否拥有指定项目。
 * 返回 null 表示校验通过（中间件已处理 404）；
 * 返回 Response 表示校验失败，调用方应直接 return 该 Response。
 */
export async function verifyProjectOwnership(
  c: Context<{ Variables: AuthVariables }>,
  projectId: string,
): Promise<Response | null> {
  const user = c.get('user');
  const project = await getProject(projectId, user.id);
  if (!project) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: '项目不存在' } },
      404,
    );
  }
  return null;
}

/**
 * 从路由参数中安全提取 projectId 并校验所有权。
 * 成功返回 projectId 字符串；失败返回 Response。
 */
export async function extractAndVerifyProject(
  c: Context<{ Variables: AuthVariables }>,
): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const projectId = c.req.param('projectId');
  if (!projectId) {
    return {
      ok: false,
      response: c.json({ error: { code: 'BAD_REQUEST', message: '缺少 projectId' } }, 400),
    };
  }
  const denial = await verifyProjectOwnership(c, projectId);
  if (denial) return { ok: false, response: denial };
  return { ok: true, projectId };
}
