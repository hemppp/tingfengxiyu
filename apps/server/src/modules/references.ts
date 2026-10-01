// ============================================================
// 参考书路由
// 持久化参考书（替代前端 IndexedDB 方案）
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createReferenceBook,
  getReferenceBook,
  listReferenceBooks,
  updateReferenceBook,
  deleteReferenceBook,
} from '../services/reference-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const chapterSchema = z.object({
  title: z.string(),
  content: z.string(),
});

const createReferenceBookSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  title: z.string().min(1),
  author: z.string().optional(),
  content: z.string().optional(),
  chapters: z.array(chapterSchema).optional(),
  currentChapter: z.number().int().min(0).optional(),
  source: z.string().optional(),
});

const updateReferenceBookSchema = createReferenceBookSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const books = await listReferenceBooks(projectId);
  return c.json({ data: books });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 ID' } }, 400);
  const book = await getReferenceBook(id, projectId);
  if (!book) return c.json({ error: { code: 'NOT_FOUND', message: '参考书不存在' } }, 404);
  return c.json({ data: book });
});

router.post('/', requireAuth, zValidator('json', createReferenceBookSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createReferenceBookSchema>;
  // 强制以 URL/header 中的 projectId 为准
  const book = await createReferenceBook({
    id: data.id,
    projectId,
    title: data.title,
    author: data.author,
    content: data.content ?? '',
    chapters: data.chapters ?? [],
    currentChapter: data.currentChapter ?? 0,
    source: data.source,
  } as Parameters<typeof createReferenceBook>[0], projectId);
  return c.json({ data: book }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateReferenceBookSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 ID' } }, 400);
  const existing = await getReferenceBook(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json') as z.infer<typeof updateReferenceBookSchema>;
    const created = await createReferenceBook({
      id,
      projectId,
      title: data.title ?? '',
      author: data.author,
      content: data.content ?? '',
      chapters: data.chapters ?? [],
      currentChapter: data.currentChapter ?? 0,
      source: data.source,
    } as Parameters<typeof createReferenceBook>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateReferenceBookSchema>;
  await updateReferenceBook(id, data, projectId);
  const book = await getReferenceBook(id, projectId);
  return c.json({ data: book });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 ID' } }, 400);
  await deleteReferenceBook(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
