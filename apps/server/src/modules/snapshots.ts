// ============================================================
// 快照路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createSnapshot,
  getSnapshot,
  listSnapshots,
  deleteSnapshot,
} from '../services/snapshot-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createSnapshotSchema = z.object({
  id: z.string().optional(),
  chapterId: z.string().min(1),
  content: z.string(),
  wordCount: z.number().int().min(0),
  label: z.string().optional(),
  auto: z.boolean().optional(),
});

const router = new Hono<{ Variables: ProjectScopedVariables }>();

// GET /api/snapshots/chapters/:chapterId — 列出某章节的所有快照
router.get('/chapters/:chapterId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const chapterId = c.req.param('chapterId');
  if (!chapterId) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 chapterId' } }, 400);
  const snapshots = await listSnapshots(chapterId, projectId);
  return c.json({ data: snapshots });
});

// GET /api/snapshots/:id
router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 ID' } }, 400);
  const snapshot = await getSnapshot(id, projectId);
  if (!snapshot) return c.json({ error: { code: 'NOT_FOUND', message: '快照不存在' } }, 404);
  return c.json({ data: snapshot });
});

// POST /api/snapshots
router.post('/', requireAuth, zValidator('json', createSnapshotSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createSnapshotSchema> as Parameters<typeof createSnapshot>[0];
  const snapshot = await createSnapshot(data, projectId);
  return c.json({ data: snapshot }, 201);
});

// DELETE /api/snapshots/:id
router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 ID' } }, 400);
  await deleteSnapshot(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
