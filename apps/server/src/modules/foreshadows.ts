// ============================================================
// 伏笔路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createForeshadow,
  getForeshadow,
  listForeshadows,
  updateForeshadow,
  deleteForeshadow,
  getActiveForeshadows,
  getOverdueForeshadows,
} from '../services/foreshadow-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createForeshadowSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  description: z.string().min(1, '伏笔描述不能为空'),
  type: z.enum(['identity', 'motivation', 'relation', 'trauma', 'turning', 'fate']),
  status: z.enum(['planted', 'hinted', 'payed_off', 'abandoned']).optional(),
  seedChapter: z.number().int().min(0),
  seedText: z.string().optional(),
  seedAnnotationId: z.string().optional(),
  hints: z.array(z.object({
    chapter: z.number(),
    text: z.string().optional(),
    annotationId: z.string().optional(),
    earmarkId: z.string().optional(),
  })).optional(),
  payoffChapter: z.number().int().min(0).nullish(),
  payoffText: z.string().optional(),
  payoffAnnotationId: z.string().optional(),
  relatedCharacters: z.array(z.string()).optional(),
  relatedItems: z.array(z.string()).optional(),
  relatedEvents: z.array(z.string()).optional(),
  earmarks: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const updateForeshadowSchema = createForeshadowSchema.partial();

const router = new Hono<{ Variables: ProjectScopedVariables }>();

// GET /api/projects/:projectId/foreshadows
router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const foreshadows = await listForeshadows(projectId);
  return c.json({ data: foreshadows });
});

// GET /api/projects/:projectId/foreshadows/active
router.get('/projects/:projectId/active', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const foreshadows = await getActiveForeshadows(projectId);
  return c.json({ data: foreshadows });
});

// GET /api/projects/:projectId/foreshadows/overdue
router.get('/projects/:projectId/overdue', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const foreshadows = await getOverdueForeshadows(projectId);
  return c.json({ data: foreshadows });
});

// GET /api/foreshadows/:id
router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const foreshadow = await getForeshadow(id, projectId);
  if (!foreshadow) return c.json({ error: { code: 'NOT_FOUND', message: '伏笔不存在' } }, 404);
  return c.json({ data: foreshadow });
});

// POST /api/foreshadows
router.post('/', requireAuth, zValidator('json', createForeshadowSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createForeshadowSchema>;
  const foreshadow = await createForeshadow({ ...data, projectId } as Parameters<typeof createForeshadow>[0], projectId);
  return c.json({ data: foreshadow }, 201);
});

// PUT /api/foreshadows/:id
router.put('/:id', requireAuth, zValidator('json', updateForeshadowSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getForeshadow(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）。
    // ★ updateForeshadowSchema 是 createForeshadowSchema.partial()（缺字段也放行），
    //   创建分支必须按**完整** createForeshadowSchema 再校验一次：缺必填字段退回
    //   400（与 POST 语义一致），否则会直达 INSERT 撞 NOT NULL 约束 → 500。
    const parsed = createForeshadowSchema.safeParse({ id, ...c.req.valid('json'), projectId });
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
    const created = await createForeshadow({ ...parsed.data, projectId } as Parameters<typeof createForeshadow>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateForeshadowSchema>;
  await updateForeshadow(id, data, projectId);
  const foreshadow = await getForeshadow(id, projectId);
  return c.json({ data: foreshadow });
});

// DELETE /api/foreshadows/:id
router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteForeshadow(id, projectId);
  return c.json({ data: { success: true } });
});

export default router;
