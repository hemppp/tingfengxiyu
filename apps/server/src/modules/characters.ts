// ============================================================
// 角色路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  createCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
  deleteCharacter,
  searchCharacters,
  addRelation,
  removeRelation,
} from '../services/character-service.js';
import { mergeSimilarCharacters } from '../services/character-merge-service.js';
import { listItems, updateItem } from '../services/item-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createCharacterSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().min(1, '角色名称不能为空'),
  aliases: z.array(z.string()).optional(),
  thumbnail: z.string().optional(),
  color: z.string().optional(),
  role: z.enum(['protagonist', 'femaleLead', 'supporting', 'minor']).optional(),
  desire: z.string().optional(),
  fear: z.string().optional(),
  belief: z.string().optional(),
  weakness: z.string().optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  backstory: z.string().optional(),
  speechStyle: z.string().optional(),
  states: z.array(z.object({
    chapter: z.number(),
    field: z.string(),
    oldValue: z.string().optional(),
    newValue: z.string(),
    description: z.string().optional(),
  })).optional(),
  relations: z.array(z.object({
    targetId: z.string(),
    type: z.string(),
    description: z.string().optional(),
    chapter: z.number().nullish(),
    direction: z.enum(['from', 'to', 'mutual']),
  })).optional(),
  chapters: z.array(z.number()).optional(),
  tags: z.array(z.string()).optional(),
});

const updateCharacterSchema = createCharacterSchema.partial();

const addRelationSchema = z.object({
  targetId: z.string(),
  type: z.string(),
  description: z.string().optional(),
  chapter: z.number().nullish(),
  direction: z.enum(['from', 'to', 'mutual']),
});

const router = new Hono<{ Variables: ProjectScopedVariables }>();

// GET /api/projects/:projectId/characters
router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const characters = await listCharacters(projectId);
  return c.json({ data: characters });
});

// GET /api/characters/search?q=...
// projectId 通过 X-Project-Id 头部注入（前端 apiClient dynamicHeaders）
router.get('/search', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const query = c.req.query('q') || '';
  const results = await searchCharacters(projectId, query);
  return c.json({ data: results });
});

// GET /api/characters/:id
router.get('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const character = await getCharacter(id, projectId);
  if (!character) return c.json({ error: { code: 'NOT_FOUND', message: '角色不存在' } }, 404);
  return c.json({ data: character });
});

// POST /api/characters
router.post('/', requireAuth, zValidator('json', createCharacterSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createCharacterSchema>;
  // 强制以 URL/header 中的 projectId 为准（防止 body 注入其他项目的 projectId）
  const character = await createCharacter({ ...data, projectId } as Parameters<typeof createCharacter>[0], projectId);
  return c.json({ data: character }, 201);
});

// PUT /api/characters/:id
router.put('/:id', requireAuth, zValidator('json', updateCharacterSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getCharacter(id, projectId);
  if (!existing) {
    // upsert：不存在则创建（RFC 7231 PUT 幂等语义）
    const data = c.req.valid('json');
    const created = await createCharacter({ id, ...data, projectId } as Parameters<typeof createCharacter>[0], projectId);
    return c.json({ data: created }, 201);
  }
  const data = c.req.valid('json') as z.infer<typeof updateCharacterSchema>;
  await updateCharacter(id, data, projectId);
  const character = await getCharacter(id, projectId);
  return c.json({ data: character });
});

// DELETE /api/characters/:id
router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  await deleteCharacter(id, projectId);
  return c.json({ data: { success: true } });
});

// POST /api/characters/:id/relations
router.post('/:id/relations', requireAuth, zValidator('json', addRelationSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getCharacter(id, projectId);
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: '角色不存在' } }, 404);
  const relation = c.req.valid('json') as z.infer<typeof addRelationSchema> as Parameters<typeof addRelation>[1];
  await addRelation(id, relation, projectId);
  const character = await getCharacter(id, projectId);
  return c.json({ data: character });
});

// DELETE /api/characters/:id/relations/:targetId
router.delete('/:id/relations/:targetId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const existing = await getCharacter(id, projectId);
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: '角色不存在' } }, 404);
  const targetId = c.req.param('targetId')!;
  if (!targetId) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 targetId' } }, 400);
  await removeRelation(id, targetId, projectId);
  const character = await getCharacter(id, projectId);
  return c.json({ data: character });
});

// POST /api/characters/merge-similar - 自动检测并合并相似角色
router.post('/merge-similar', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;

  const [characters, items] = await Promise.all([
    listCharacters(projectId),
    listItems(projectId),
  ]);

  const result = mergeSimilarCharacters(characters, items);

  const deletedIds: string[] = [];
  for (const orig of characters) {
    if (!result.mergedCharacters.find(mc => mc.id === orig.id)) {
      deletedIds.push(orig.id);
    }
  }

  for (const mc of result.mergedCharacters) {
    await updateCharacter(mc.id, mc, projectId);
  }
  for (const id of deletedIds) {
    await deleteCharacter(id, projectId);
  }
  for (const mi of result.mergedItems) {
    await updateItem(mi.id, mi, projectId);
  }

  return c.json({
    data: {
      mergeCount: result.mergeCount,
      mergeLog: result.mergeLog,
      mergedCharacters: result.mergedCharacters,
      mergedItems: result.mergedItems,
    },
  });
});

// POST /api/characters/:id/merge/:targetId - 手动合并两个角色
const manualMergeSchema = z.object({
  deleteMerged: z.boolean().optional().default(true),
});

router.post('/:id/merge/:targetId', requireAuth, zValidator('json', manualMergeSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id')!;
  const targetId = c.req.param('targetId')!;
  const body = c.req.valid('json') as z.infer<typeof manualMergeSchema>;

  const [charA, charB] = await Promise.all([
    getCharacter(id, projectId),
    getCharacter(targetId, projectId),
  ]);
  if (!charA || !charB) {
    return c.json({ error: { code: 'NOT_FOUND', message: '角色不存在' } }, 404);
  }

  const items = await listItems(projectId);

  const { pickPrimaryCharacter: pickPrimary, mergeTwoCharacters: mergeTwo, updateItemHoldersForMerge } =
    await import('../services/character-merge-service.js');

  const primary = pickPrimary(charA, charB);
  const secondary = primary.id === charA.id ? charB : charA;
  const merged = mergeTwo(primary, secondary);
  const mergedItems = updateItemHoldersForMerge(items, secondary.id, primary.id);

  await updateCharacter(primary.id, merged, projectId);
  if (body.deleteMerged) {
    await deleteCharacter(secondary.id, projectId);
  }
  for (const mi of mergedItems) {
    if (mi.holders !== items.find(i => i.id === mi.id)?.holders ||
        mi.currentHolders !== items.find(i => i.id === mi.id)?.currentHolders) {
      await updateItem(mi.id, mi, projectId);
    }
  }

  const resultChar = await getCharacter(primary.id, projectId);
  return c.json({
    data: {
      primaryId: primary.id,
      deletedId: body.deleteMerged ? secondary.id : null,
      character: resultChar,
      mergedItems,
    },
  });
});

export default router;
