// ============================================================
// 物品路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
} from '../services/item-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createItemSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().min(1, '物品名称不能为空'),
  type: z.string().optional(),
  description: z.string().optional(),
  thumbnail: z.string().optional(),
  color: z.string().optional(),
  creditPrice: z.number().positive('积分定价必须为正数').optional(),
  states: z.array(z.object({
    chapter: z.number(),
    field: z.string(),
    oldValue: z.string().optional(),
    newValue: z.string(),
    description: z.string().optional(),
  })).optional(),
  holders: z.array(z.object({
    characterId: z.string(),
    chapter: z.number(),
    action: z.enum(['gained', 'lost', 'transferred', 'held']),
  })).optional(),
  // ★ 当前持有者：此前 schema 漏掉该字段，更新时被静默剥离，导致人物-物品归属永远存不进去
  currentHolders: z.array(z.string()).optional(),
  chapters: z.array(z.number()).optional(),
  tags: z.array(z.string()).optional(),
});

const updateItemSchema = createItemSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const items = await listItems(projectId);
  return c.json({ data: items });
});

router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const item = await getItem(id, projectId);
  if (!item) return c.json({ error: { code: 'NOT_FOUND', message: '物品不存在' } }, 404);
  return c.json({ data: item });
});

router.post('/', requireAuth, zValidator('json', createItemSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createItemSchema>;
  // 强制以 URL/header 中的 projectId 为准（防止 body 注入其他项目的 projectId）
  const item = await createItem({ ...data, projectId } as Parameters<typeof createItem>[0], projectId);
  return c.json({ data: item }, 201);
});

router.put('/:id', requireAuth, zValidator('json', updateItemSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getItem(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createItem({ id, ...data, projectId } as Parameters<typeof createItem>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateItemSchema>;
  await updateItem(id, data, projectId);
  const item = await getItem(id, projectId);
  return c.json({ data: item });
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteItem(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
