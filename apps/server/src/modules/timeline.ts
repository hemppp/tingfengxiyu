// ============================================================
// 时间线路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createTimelineEvent,
  getTimelineEvent,
  listTimelineEvents,
  updateTimelineEvent,
  deleteTimelineEvent,
} from '../services/timeline-service.js';
import { dedupeEvents } from '../services/event-dedupe-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createTimelineSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  title: z.string().min(1, '时间线事件标题不能为空'),
  description: z.string().optional(),
  chapter: z.number().int().min(0).nullish(),
  timestamp: z.string().optional(),
  order: z.number().int().min(0),
  characterIds: z.array(z.string()).optional(),
  type: z.enum(['event', 'foreshadow', 'state_change']),
  color: z.string().optional(),
});

const updateTimelineSchema = createTimelineSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const events = await listTimelineEvents(projectId);
  return c.json({ data: events });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const event = await getTimelineEvent(id, projectId);
  if (!event) return c.json({ error: { code: 'NOT_FOUND', message: '时间线事件不存在' } }, 404);
  return c.json({ data: event });
});

router.post('/', requireAuth, zValidator('json', createTimelineSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as Parameters<typeof createTimelineEvent>[0];
  const event = await createTimelineEvent({ ...data, projectId }, projectId);
  return c.json({ data: event }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateTimelineSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getTimelineEvent(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createTimelineEvent({ id, ...data, projectId } as Parameters<typeof createTimelineEvent>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateTimelineSchema>;
  await updateTimelineEvent(id, data, projectId);
  const event = await getTimelineEvent(id, projectId);
  return c.json({ data: event });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteTimelineEvent(id, projectId);
  return c.json({ data: { success: true } });
});

// POST /api/timeline/dedupe - 事件去重
const dedupeSchema = z.object({
  threshold: z.number().min(0).max(1).optional().default(0.7),
});

router.post('/dedupe', requireAuth, zValidator('json', dedupeSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const body = c.req.valid('json') as z.infer<typeof dedupeSchema>;

  const events = await listTimelineEvents(projectId);
  const result = dedupeEvents(events, body.threshold);

  for (const id of result.removedIds) {
    await deleteTimelineEvent(id, projectId);
  }
  for (const ev of result.events) {
    const orig = events.find(e => e.id === ev.id);
    if (orig && (orig.description !== ev.description ||
        JSON.stringify(orig.characterIds) !== JSON.stringify(ev.characterIds))) {
      await updateTimelineEvent(ev.id, {
        description: ev.description,
        characterIds: ev.characterIds,
      }, projectId);
    }
  }

  const finalEvents = await listTimelineEvents(projectId);
  return c.json({
    data: {
      removedCount: result.removedCount,
      removedIds: result.removedIds,
      events: finalEvents,
    },
  });
});

export default router;
