// ============================================================
// 章节路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createChapter,
  getChapter,
  listChapters,
  listTrashedChapters,
  countChapters,
  updateChapter,
  deleteChapter,
  softDeleteChapter,
  restoreChapter,
  emptyTrash,
  reorderChapters,
} from '../services/chapter-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createChapterSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  title: z.string().min(1, '章节标题不能为空'),
  content: z.string().optional(),
  // order 可选：服务端在事务内根据 MAX(order)+1 自动计算（客户端传值会被覆盖）
  order: z.number().int().min(0).optional(),
  wordCount: z.number().int().min(0).nullish(),
  summary: z.string().optional(),
  status: z.enum(['draft', 'revised', 'final', 'archived']).optional(),
  label: z.string().optional(),
  pov: z.string().optional(),
});

const updateChapterSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  order: z.number().int().min(0).nullish(),
  wordCount: z.number().int().min(0).nullish(),
  summary: z.string().optional(),
  status: z.enum(['draft', 'revised', 'final', 'archived']).optional(),
  label: z.string().optional(),
  pov: z.string().optional(),
  // 允许 updatedAt 通过校验（syncService 传整个对象时会带上）
  updatedAt: z.number().int().optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string()),
});

const router = new Hono<{ Variables: ProjectScopedVariables }>();

// GET /api/projects/:projectId/chapters — 列出未删除章节
router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const chapters = await listChapters(projectId);
  return c.json({ data: chapters });
});

// GET /api/projects/:projectId/chapters/trash — 列出回收站章节
router.get('/projects/:projectId/trash', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const chapters = await listTrashedChapters(projectId);
  return c.json({ data: chapters });
});

// GET /api/projects/:projectId/chapters/count — 章节数（轻量 COUNT，不加载正文）
router.get('/projects/:projectId/count', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const count = await countChapters(projectId);
  return c.json({ data: { count } });
});

// GET /api/chapters/:id
router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const chapter = await getChapter(id, projectId);
  if (!chapter) return c.json({ error: { code: 'NOT_FOUND', message: '章节不存在' } }, 404);
  if (chapter.deletedAt != null) {
    return c.json({ error: { code: 'NOT_FOUND', message: '章节已在回收站' } }, 404);
  }
  return c.json({ data: chapter });
});

// POST /api/chapters
router.post('/', requireAuth, zValidator('json', createChapterSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createChapterSchema> as Parameters<typeof createChapter>[0];
  // 幂等：客户端携带 id 且该 id 已存在（如网络超时后的重试）时，直接返回已有章节，
  // 避免 UNIQUE constraint failed: chapters.id 报错
  if (data.id) {
    const existing = await getChapter(data.id, projectId);
    if (existing) {
      return c.json({ data: existing }, 200);
    }
  }
  // 强制以 URL/header 中的 projectId 为准
  const chapter = await createChapter({ ...data, projectId }, projectId);
  return c.json({ data: chapter }, 201);
});

// PUT /api/chapters/:id
router.put('/:id', requireAuth, zValidator('json', updateChapterSchema, (result) => {
  // 校验失败时打印具体字段错误，便于定位 400 原因
  if (!result.success) {
    console.warn('[chapters PUT] Zod 校验失败:', z.flattenError(result.error));
  }
}), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getChapter(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createChapter({ id, ...data, projectId } as Parameters<typeof createChapter>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateChapterSchema> as Parameters<typeof updateChapter>[1];
  await updateChapter(id, data, projectId);
  const chapter = await getChapter(id, projectId);
  return c.json({ data: chapter });
});

// DELETE /api/chapters/:id — 软删除（移入回收站）
// 通过 query 参数 ?hard=true 可硬删除（仅在回收站中用）
router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getChapter(id, projectId);
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: '章节不存在' } }, 404);
  const hard = c.req.query('hard') === 'true';
  if (hard) {
    // 安全约束：硬删除前必须先软删除（移入回收站），不能跳过软删除流程直接硬删正常章节
    if (existing.deletedAt == null) {
      return c.json({ error: { code: 'BAD_REQUEST', message: '请先移入回收站' } }, 400);
    }
    await deleteChapter(id, projectId);
  } else {
    await softDeleteChapter(id, projectId);
  }
  return c.json({ data: { success: true, hard } });
});

// POST /api/chapters/:id/restore — 从回收站还原
router.post('/:id/restore', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const chapter = await restoreChapter(id, projectId);
  if (!chapter) {
    return c.json({ error: { code: 'BAD_REQUEST', message: '章节不在回收站中' } }, 400);
  }
  return c.json({ data: chapter });
});

// DELETE /api/projects/:projectId/chapters/trash — 清空回收站
router.delete('/projects/:projectId/trash', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const count = await emptyTrash(projectId);
  return c.json({ data: { success: true, removed: count } });
});

// PUT /api/chapters/:id/reorder (reorder 用独立的端点)
router.put('/:id/reorder', requireAuth, zValidator('json', reorderSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const { orderedIds } = c.req.valid('json') as { orderedIds: string[] };
  const id = c.req.param('id')!;
  // 校验起始章节存在且属于当前项目（项目库隔离已保证 projectId 一致）
  const chapter = await getChapter(id, projectId);
  if (!chapter) return c.json({ error: { code: 'NOT_FOUND', message: '章节不存在' } }, 404);
  // 校验所有涉及的章节 ID 都属于当前项目
  for (const oid of orderedIds) {
    const c2 = await getChapter(oid, projectId);
    if (!c2) {
      return c.json({ error: { code: 'NOT_FOUND', message: '章节不存在' } }, 404);
    }
  }
  await reorderChapters(projectId, orderedIds);
  return c.json({ data: { success: true } });
});

export default router;
