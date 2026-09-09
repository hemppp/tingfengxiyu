// ============================================================
// 大纲路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createOutlineNode,
  getOutlineNode,
  listOutlineNodes,
  updateOutlineNode,
  deleteOutlineNode,
} from '../services/outline-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createOutlineSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  parentId: z.string().optional(),
  type: z.enum(['act', 'chapter', 'scene', 'beat', 'note']),
  title: z.string().min(1, '大纲标题不能为空'),
  description: z.string().optional(),
  order: z.number().int().min(0),
  linkedChapterIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const updateOutlineSchema = createOutlineSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const nodes = await listOutlineNodes(projectId);
  return c.json({ data: nodes });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const node = await getOutlineNode(id, projectId);
  if (!node) return c.json({ error: { code: 'NOT_FOUND', message: '大纲节点不存在' } }, 404);
  return c.json({ data: node });
});

router.post('/', requireAuth, zValidator('json', createOutlineSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createOutlineSchema>;
  const node = await createOutlineNode({ ...data, projectId } as Parameters<typeof createOutlineNode>[0], projectId);
  return c.json({ data: node }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateOutlineSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getOutlineNode(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createOutlineNode({ id, ...data, projectId } as Parameters<typeof createOutlineNode>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateOutlineSchema>;
  await updateOutlineNode(id, data, projectId);
  const node = await getOutlineNode(id, projectId);
  return c.json({ data: node });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteOutlineNode(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
