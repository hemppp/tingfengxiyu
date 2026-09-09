// ============================================================
// 项目路由 — 带用户隔离和输入验证
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../services/project-service.js';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';

const createProjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '项目名称不能为空'),
  description: z.string().nullish(),
  coverImage: z.string().nullish(),
  penName: z.string().nullish(),
  genre: z.string().nullish(),
  targetWordCount: z.number().int().positive().nullish(),
  currentWordCount: z.number().int().min(0).nullish(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  coverImage: z.string().nullish(),
  penName: z.string().nullish(),
  genre: z.string().nullish(),
  targetWordCount: z.number().int().positive().nullish(),
  currentWordCount: z.number().int().min(0).nullish(),
});

const router = new Hono<{ Variables: AuthVariables }>();

router.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const projects = await listProjects(user.id);
  return c.json({ data: projects });
});

router.get('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少项目 ID' } }, 400);
  const user = c.get('user');
  const project = await getProject(id, user.id);
  if (!project) return c.json({ error: { code: 'NOT_FOUND', message: '项目不存在' } }, 404);
  return c.json({ data: project });
});

router.post('/', requireAuth, zValidator('json', createProjectSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  const payload = {
    id: data.id,
    name: data.name,
    description: data.description ?? undefined,
    coverImage: data.coverImage ?? undefined,
    penName: data.penName ?? undefined,
    genre: data.genre ?? undefined,
    targetWordCount: data.targetWordCount ?? undefined,
    currentWordCount: data.currentWordCount ?? 0,
  } as Parameters<typeof createProject>[1];
  const project = await createProject(user.id, payload);
  return c.json({ data: project }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateProjectSchema), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少项目 ID' } }, 400);
  const user = c.get('user');
  const existing = await getProject(id, user.id);
  const data = c.req.valid('json');
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const created = await createProject(user.id, {
      id,
      name: data.name,
      description: data.description ?? undefined,
      coverImage: data.coverImage ?? undefined,
      penName: data.penName ?? undefined,
      genre: data.genre ?? undefined,
      targetWordCount: data.targetWordCount ?? undefined,
      currentWordCount: data.currentWordCount ?? 0,
    } as Parameters<typeof createProject>[1]);
    return c.json({ data: created }, 201);
  }
  const payload = {
    name: data.name,
    description: data.description ?? undefined,
    coverImage: data.coverImage ?? undefined,
    penName: data.penName ?? undefined,
    genre: data.genre ?? undefined,
    targetWordCount: data.targetWordCount ?? undefined,
    currentWordCount: data.currentWordCount ?? undefined,
  };
  const ok = await updateProject(id, user.id, payload);
  if (!ok) return c.json({ error: { code: 'NOT_FOUND', message: '项目不存在' } }, 404);
  const project = await getProject(id, user.id);
  return c.json({ data: project });
});

router.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少项目 ID' } }, 400);
  const user = c.get('user');
  const ok = await deleteProject(id, user.id);
  if (!ok) return c.json({ error: { code: 'NOT_FOUND', message: '项目不存在' } }, 404);
  return c.json({ data: { success: true } });
});

export default router;
