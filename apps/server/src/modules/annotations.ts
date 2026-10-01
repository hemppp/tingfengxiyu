// ============================================================
// 标注路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createAnnotation,
  getAnnotation,
  listAnnotations,
  updateAnnotation,
  deleteAnnotation,
} from '../services/annotation-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createAnnotationSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  type: z.enum(['character', 'item', 'location', 'foreshadow', 'event', 'relation', 'custom']),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  selectedText: z.string(),
  color: z.string().optional(),
  targetId: z.string().optional(),
  targetType: z.enum(['character', 'item', 'location', 'event', 'foreshadow']).optional(),
  description: z.string().optional(),
  foreshadowType: z.enum(['identity', 'motivation', 'relation', 'trauma', 'turning', 'fate']).optional(),
  foreshadowStatus: z.enum(['planted', 'hinted', 'payed_off', 'abandoned']).optional(),
});

const updateAnnotationSchema = createAnnotationSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const annotations = await listAnnotations(projectId);
  return c.json({ data: annotations });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const annotation = await getAnnotation(id, projectId);
  if (!annotation) return c.json({ error: { code: 'NOT_FOUND', message: '标注不存在' } }, 404);
  return c.json({ data: annotation });
});

router.post('/', requireAuth, zValidator('json', createAnnotationSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createAnnotationSchema>;
  const annotation = await createAnnotation({ ...data, projectId } as Parameters<typeof createAnnotation>[0], projectId);
  return c.json({ data: annotation }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateAnnotationSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getAnnotation(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createAnnotation({ id, ...data, projectId } as Parameters<typeof createAnnotation>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateAnnotationSchema>;
  await updateAnnotation(id, data, projectId);
  const annotation = await getAnnotation(id, projectId);
  return c.json({ data: annotation });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteAnnotation(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
