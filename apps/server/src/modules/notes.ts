// ============================================================
// 笔记路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createNote,
  getNote,
  listNotes,
  updateNote,
  deleteNote,
} from '../services/note-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createNoteSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
  linkedChapterId: z.string().optional(),
});

const updateNoteSchema = createNoteSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const notes = await listNotes(projectId);
  return c.json({ data: notes });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const note = await getNote(id, projectId);
  if (!note) return c.json({ error: { code: 'NOT_FOUND', message: '笔记不存在' } }, 404);
  return c.json({ data: note });
});

router.post('/', requireAuth, zValidator('json', createNoteSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createNoteSchema>;
  const note = await createNote({ ...data, projectId } as Parameters<typeof createNote>[0], projectId);
  return c.json({ data: note }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateNoteSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getNote(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createNote({ id, ...data, projectId } as Parameters<typeof createNote>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateNoteSchema>;
  await updateNote(id, data, projectId);
  const note = await getNote(id, projectId);
  return c.json({ data: note });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteNote(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
