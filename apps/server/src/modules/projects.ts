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

/** 创作模式：manual = 手写框架 / auto = AI 写作框架 —— 决定该项目加载哪一套工作台 */
const projectModeSchema = z.enum(['manual', 'auto']);

/**
 * 开书设定（AI 写作新书向导）——手写项目不带这个字段。
 * 每项都设了长度上限：这些文本会被**注入每一轮的模型输入**，不设限等于给模型塞垃圾。
 */
const novelBriefSchema = z.object({
  opening: z.string().max(4000),
  worldview: z.string().max(4000),
  style: z.string().max(1000),
  protagonist: z.string().max(200),
  multipleHeroines: z.boolean(),
  heroines: z.array(z.string().max(200)).max(20),
  genreCategory: z.enum(['system', 'none']),
  genre: z.string().max(200),
});

const createProjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '项目名称不能为空'),
  description: z.string().nullish(),
  coverImage: z.string().nullish(),
  penName: z.string().nullish(),
  genre: z.string().nullish(),
  targetWordCount: z.number().int().positive().nullish(),
  currentWordCount: z.number().int().min(0).nullish(),
  mode: projectModeSchema.optional(),
  brief: novelBriefSchema.nullish(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  coverImage: z.string().nullish(),
  penName: z.string().nullish(),
  genre: z.string().nullish(),
  targetWordCount: z.number().int().positive().nullish(),
  currentWordCount: z.number().int().min(0).nullish(),
  /** 允许创建后切换模式：两套 UI 互斥，切换只改变工作台形态，数据是同一份 */
  mode: projectModeSchema.optional(),
  /** 省略 = 不动已有设定（见下面 payload 的写法） */
  brief: novelBriefSchema.nullish(),
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
    // 新建缺省「手写」：AI 写作需用户显式选择，避免误入 AI 工作台
    mode: data.mode ?? 'manual',
    brief: data.brief ?? undefined,
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
      mode: data.mode ?? 'manual',
      brief: data.brief ?? undefined,
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
    // 仅在请求显式带了 mode 时才覆盖，避免编辑书名等操作把已有模式冲掉
    ...(data.mode ? { mode: data.mode } : {}),
    // 同理：没带 brief 就别动已有设定（undefined 会被 BaseService.update 跳过）
    ...(data.brief ? { brief: data.brief } : {}),
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
