// ============================================================
// 事件路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createEvent,
  getEvent,
  listEvents,
  updateEvent,
  deleteEvent,
} from '../services/event-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createEventSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  title: z.string().min(1, '事件标题不能为空'),
  description: z.string().optional(),
  chapter: z.number().int().min(0),
  participants: z.array(z.string()).optional(),
  relatedItems: z.array(z.string()).optional(),
  relatedLocations: z.array(z.string()).optional(),
  consequences: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const updateEventSchema = createEventSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const events = await listEvents(projectId);
  return c.json({ data: events });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const event = await getEvent(id, projectId);
  if (!event) return c.json({ error: { code: 'NOT_FOUND', message: '事件不存在' } }, 404);
  return c.json({ data: event });
});

router.post('/', requireAuth, zValidator('json', createEventSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createEventSchema>;
  const event = await createEvent({ ...data, projectId } as Parameters<typeof createEvent>[0], projectId);
  return c.json({ data: event }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateEventSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getEvent(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createEvent({ id, ...data, projectId } as Parameters<typeof createEvent>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateEventSchema>;
  await updateEvent(id, data, projectId);
  const event = await getEvent(id, projectId);
  return c.json({ data: event });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteEvent(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
