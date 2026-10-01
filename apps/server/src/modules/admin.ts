// ============================================================
// 管理员后台路由模块 - 用户管理
//
// 所有路由都需要 requireAuth + requireAdmin
//
// GET    /api/admin/users                  - 用户列表
// PATCH  /api/admin/users/:id/password     - 重置用户密码
// DELETE /api/admin/users/:id              - 删除用户
// PATCH  /api/admin/users/:id/admin        - 设置/取消管理员权限
// GET    /api/admin/stats                  - 系统统计（用户数/项目数等）
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, requireAdmin, type AuthVariables } from '../middleware/auth.js';
import {
  listAllUsers,
  adminResetUserPassword,
  adminDeleteUser,
  adminSetUserAdminStatus,
} from '../services/auth-service.js';
import { getDb, schema, eq, getProjectDbSync, initProjectDb, getProjectDbPath } from '@novel/db';

/** 管理员操作已知的业务错误消息白名单 */
const ADMIN_KNOWN_NOT_FOUND = new Set(['用户不存在']);
const ADMIN_KNOWN_BAD_REQUEST = new Set([
  '密码至少 6 个字符',
  '不能删除最后一个管理员账号',
  '不能取消最后一个管理员账号的权限',
]);

/**
 * 管理员操作的统一错误映射：
 * - 命中 404 白名单 → NOT_FOUND
 * - 命中 400 白名单 → BAD_REQUEST
 * - 其余 → 500 INTERNAL_ERROR（脱敏）
 */
type MappedAdminError =
  | { status: 404; code: 'NOT_FOUND'; message: string }
  | { status: 400; code: 'BAD_REQUEST'; message: string }
  | { status: 500; code: 'INTERNAL_ERROR'; message: string };

function mapAdminError(error: unknown, fallbackMessage: string, logPrefix: string): MappedAdminError {
  const message = error instanceof Error ? error.message : '';
  if (message && ADMIN_KNOWN_NOT_FOUND.has(message)) {
    return { status: 404, code: 'NOT_FOUND', message };
  }
  if (message && ADMIN_KNOWN_BAD_REQUEST.has(message)) {
    return { status: 400, code: 'BAD_REQUEST', message };
  }
  // 未分类异常统一脱敏为 500，服务端打印完整错误
  console.error(`${logPrefix} 未分类异常（隐藏详情）:`, error);
  return { status: 500, code: 'INTERNAL_ERROR', message: fallbackMessage };
}

const router = new Hono<{ Variables: AuthVariables }>();

// ---- 路由：所有路径都需 requireAuth + requireAdmin ----
router.use('*', requireAuth, requireAdmin);

// ---- Schemas ----

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, '密码至少 6 个字符').max(128, '密码最多 128 个字符'),
});

const setAdminSchema = z.object({
  isAdmin: z.boolean(),
});

// ---- 路由定义 ----

/**
 * GET /api/admin/users
 * 获取所有用户列表（不含密码哈希）
 */
router.get('/users', async (c) => {
  try {
    const users = await listAllUsers();
    return c.json({ data: users });
  } catch (error) {
    const mapped = mapAdminError(error, '获取用户列表失败', '[Admin /users]');
    return c.json({ error: { code: mapped.code, message: mapped.message } }, mapped.status);
  }
});

/**
 * PATCH /api/admin/users/:id/password
 * 重置指定用户的密码
 */
router.patch('/users/:id/password', zValidator('json', resetPasswordSchema), async (c) => {
  const userId = c.req.param('id');
  const body = c.req.valid('json') as z.infer<typeof resetPasswordSchema>;
  const currentUser = c.get('user');

  try {
    await adminResetUserPassword(userId, body.newPassword);
    console.log(`[Admin] 用户 ${currentUser.username} 重置了用户 ${userId} 的密码`);
    return c.json({ data: { success: true } });
  } catch (error) {
    const mapped = mapAdminError(error, '重置密码失败', '[Admin /users/:id/password]');
    return c.json({ error: { code: mapped.code, message: mapped.message } }, mapped.status);
  }
});

/**
 * DELETE /api/admin/users/:id
 * 删除指定用户
 */
router.delete('/users/:id', async (c) => {
  const userId = c.req.param('id');
  const currentUser = c.get('user');

  // 防止管理员删除自己
  if (userId === currentUser.id) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: '不能删除当前登录的管理员账号',
        },
      },
      400,
    );
  }

  try {
    await adminDeleteUser(userId);
    console.log(`[Admin] 用户 ${currentUser.username} 删除了用户 ${userId}`);
    return c.json({ data: { success: true } });
  } catch (error) {
    const mapped = mapAdminError(error, '删除用户失败', '[Admin /users/:id]');
    return c.json({ error: { code: mapped.code, message: mapped.message } }, mapped.status);
  }
});

/**
 * PATCH /api/admin/users/:id/admin
 * 设置或取消用户的管理员权限
 */
router.patch('/users/:id/admin', zValidator('json', setAdminSchema), async (c) => {
  const userId = c.req.param('id');
  const body = c.req.valid('json') as z.infer<typeof setAdminSchema>;
  const currentUser = c.get('user');

  try {
    await adminSetUserAdminStatus(userId, body.isAdmin);
    console.log(
      `[Admin] 用户 ${currentUser.username} ${body.isAdmin ? '授予' : '撤销'}了用户 ${userId} 的管理员权限`,
    );
    return c.json({ data: { success: true } });
  } catch (error) {
    const mapped = mapAdminError(error, '设置管理员权限失败', '[Admin /users/:id/admin]');
    return c.json({ error: { code: mapped.code, message: mapped.message } }, mapped.status);
  }
});

/**
 * GET /api/admin/stats
 * 系统统计：用户数、项目数、章节数、总字数等
 *
 * 注意：章节、字数存储在每个项目独立的 SQLite 文件中（per-project DB），
 * 主库 novelmuse.db 的 chapters 表在迁移后已不再使用（始终为空）。
 * 因此必须遍历所有项目，分别打开项目库并聚合统计。
 */
router.get('/stats', async (c) => {
  const db = getDb();
  if (!db) {
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: '数据库不可用' } },
      500,
    );
  }

  try {
    const userCount = db.select().from(schema.users).all().length;
    const projectCount = db.select().from(schema.projects).all().length;
    const adminCount = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.isAdmin, true))
      .all().length;

    // 聚合所有项目库的章节数与字数
    let chapterCount = 0;
    let totalWordCount = 0;
    const projects = db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .all();

    const fs = await import('fs');
    for (const project of projects) {
      try {
        // 仅统计已存在的项目库文件，避免为缺失的项目创建空库
        const dbPath = await getProjectDbPath(project.id);
        if (!fs.existsSync(dbPath)) continue;

        await initProjectDb(project.id);
        const projectDb = getProjectDbSync(project.id);
        if (!projectDb) continue;

        // 仅统计未软删除的章节（deleted_at IS NULL）
        const rows = (projectDb as unknown as {
          select: (config: unknown) => { from: (table: unknown) => { where: (cond: unknown) => { all: () => Array<{ wordCount: number | null; deletedAt: number | null }> } } };
        })
          .select({ wordCount: schema.chapters.wordCount, deletedAt: schema.chapters.deletedAt })
          .from(schema.chapters)
          .where(eq(schema.chapters.projectId, project.id))
          .all();

        for (const row of rows) {
          if (row.deletedAt == null) {
            chapterCount += 1;
            totalWordCount += row.wordCount ?? 0;
          }
        }
      } catch (projectErr) {
        // 单个项目库失败不影响整体统计
        console.warn(`[Admin /stats] 项目 ${project.id} 统计失败:`, projectErr);
      }
    }

    return c.json({
      data: {
        users: userCount,
        admins: adminCount,
        projects: projectCount,
        chapters: chapterCount,
        totalWordCount,
      },
    });
  } catch (error) {
    const mapped = mapAdminError(error, '获取统计失败', '[Admin /stats]');
    return c.json({ error: { code: mapped.code, message: mapped.message } }, mapped.status);
  }
});

export default router;
