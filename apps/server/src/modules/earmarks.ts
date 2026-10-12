// ============================================================
// 书角标记路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createEarmark,
  getEarmark,
  listEarmarks,
  updateEarmark,
  deleteEarmark,
} from '../services/earmark-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createEarmarkSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  type: z.enum(['foreshadow_seed', 'foreshadow_payoff', 'possibility']),
  foreshadowId: z.string().optional(),
  description: z.string().optional(),
  outcome: z.string().optional(),
  probability: z.number().min(0).max(100).optional(),
  relatedCharacters: z.array(z.string()).optional(),
  relatedItems: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const updateEarmarkSchema = createEarmarkSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

// GET /api/projects/:projectId/earmarks
router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const earmarks = await listEarmarks(projectId);
  return c.json({ data: earmarks });
});

// GET /api/earmarks/:id
router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const earmark = await getEarmark(id, projectId);
  if (!earmark) return c.json({ error: { code: 'NOT_FOUND', message: '书角标记不存在' } }, 404);
  return c.json({ data: earmark });
});

// POST /api/earmarks
router.post('/', requireAuth, zValidator('json', createEarmarkSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createEarmarkSchema>;
  const earmark = await createEarmark({ ...data, projectId } as Parameters<typeof createEarmark>[0], projectId);
  return c.json({ data: earmark }, 201);
});

// PUT /api/earmarks/:id
router.put('/:id', requireAuth, zValidator('json', updateEarmarkSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getEarmark(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）。
    // ★ updateEarmarkSchema 是 createEarmarkSchema.partial()（缺字段也放行），
    //   创建分支必须按**完整** createEarmarkSchema 再校验一次：缺必填字段退回
    //   400（与 POST 语义一致），否则会直达 INSERT 撞 NOT NULL 约束 → 500。
    const parsed = createEarmarkSchema.safeParse({ id, ...c.req.valid('json'), projectId });
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求参数验证失败',
            details: parsed.error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
          },
        },
        400,
      );
    }
    const created = await createEarmark({ ...parsed.data, projectId } as Parameters<typeof createEarmark>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateEarmarkSchema>;
  await updateEarmark(id, data, projectId);
  const earmark = await getEarmark(id, projectId);
  return c.json({ data: earmark });
});

// DELETE /api/earmarks/:id
router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteEarmark(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
