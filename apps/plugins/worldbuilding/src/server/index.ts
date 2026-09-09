// ============================================================
// 世界观建造师插件 —— Server 面
//
// 演示完整插件契约：
//  1. ctx.routes.register —— 注册势力 CRUD 路由（数据存 KV，无需迁移）
//  2. ctx.ai.tools.register —— 注册 AI 工具（create_faction / list_factions）
//  3. ctx.ai.skills.register —— 注册「世界观顾问」技能
//  4. ctx.events.on —— 订阅章节保存事件，自动累计势力出场次数
//  5. ctx.db.kv —— 插件 KV 存储（项目隔离）
// ============================================================

import { Hono } from 'hono';
import type { ServerPluginContext, ToolDefinition } from '@novel/core';

// 工具定义（AI 可调用）
const factionToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_faction',
    description: '创建/更新一个势力（世界观元素）。势力 = 有组织的群体（国家/教派/商行等）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '势力名称' },
        description: { type: 'string', description: '势力描述' },
        alignment: { type: 'string', enum: ['正派', '反派', '中立'], description: '阵营' },
        goals: { type: 'array', items: { type: 'string' }, description: '目标列表' },
      },
      required: ['name'],
    },
  },
};

const listFactionToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_factions',
    description: '列出当前项目的全部势力',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const name = 'novel.worldbuilding';
export const inject = ['routes', 'db', 'ai', 'events'];

export function apply(ctx: ServerPluginContext): void {
  // ── 1. 路由：势力 CRUD（KV 存储，项目隔离）──
  const router = new Hono();

  router.get('/', async (c) => {
    const projectId = c.req.header('x-project-id');
    const factions = ctx.db.kv.list('worldbuilding', 'faction:', { projectId });
    return c.json({ factions: factions.map((f) => f.value) });
  });

  router.post('/', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return c.json({ error: '缺少 X-Project-Id 头' }, 400);
    const body = await c.req.json<{ id?: string; name: string; description?: string; alignment?: string; goals?: string[] }>();
    if (!body.name) return c.json({ error: 'name 必填' }, 400);
    const id = body.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const faction = {
      id,
      name: body.name,
      description: body.description ?? '',
      alignment: body.alignment ?? '中立',
      goals: body.goals ?? [],
      appearances: ctx.db.kv.get<number>('worldbuilding', `faction:${id}:appearances`, { projectId }) ?? 0,
      createdAt: Date.now(),
    };
    await ctx.db.kv.set('worldbuilding', `faction:${id}`, faction, { projectId });
    return c.json({ faction });
  });

  router.delete('/:id', async (c) => {
    const projectId = c.req.header('x-project-id');
    const id = c.req.param('id');
    await ctx.db.kv.delete('worldbuilding', `faction:${id}`, { projectId });
    return c.json({ ok: true });
  });

  ctx.effect(() => ctx.routes.register('/api/plugins/worldbuilding', router), 'worldbuilding: routes');

  // ── 2. AI 工具（继承项目隔离 + 不暴露 delete 的安全约束）──
  ctx.ai.tools.register(factionToolDef, async (args, toolCtx) => {
    const name = String(args.name ?? '');
    if (!name) return { success: false, result: '缺少 name 参数' };
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const faction = {
      id,
      name,
      description: String(args.description ?? ''),
      alignment: String(args.alignment ?? '中立'),
      goals: Array.isArray(args.goals) ? args.goals.map(String) : [],
      appearances: 0,
      createdAt: Date.now(),
    };
    await ctx.db.kv.set('worldbuilding', `faction:${id}`, faction, { projectId: toolCtx.projectId });
    return { success: true, result: JSON.stringify(faction), entity: { type: 'faction' as never, action: 'create', id, name } };
  });

  ctx.ai.tools.register(listFactionToolDef, async (_args, toolCtx) => {
    const factions = ctx.db.kv.list('worldbuilding', 'faction:', { projectId: toolCtx.projectId });
    return { success: true, result: JSON.stringify(factions.map((f) => f.value)) };
  });

  // ── 3. AI 技能：势力顾问（name/description 随技能下发到前端技能选择器）──
  ctx.ai.skills.register({
    id: 'worldbuilding-advisor',
    name: '势力顾问',
    description: '核对势力设定一致性、补全组织与阵营空白',
    color: '#4F918C',
    systemPrompt: `【已激活技能：世界观顾问】你现在同时兼任 世界观顾问。在回答中请侧重：
1. 核对当前章节中的势力/阵营设定是否与已有记录一致（人名、组织名、立场）
2. 评估势力的动机与目标是否合理，有无前后矛盾
3. 指出世界观中尚未补全的空白（如某势力缺乏历史、某地域缺乏特征）
4. 结合注入的「势力库」数据，引用已有设定支撑分析
5. 若发现势力行为偏离设定，明确指出并提供修正建议`,
    contextKeys: [],
  });

  // ── 4. 事件订阅：章节保存时自动累计势力出场次数 ──
  ctx.events.on('chapter.saved', async (payload: { projectId: string }) => {
    const factions = ctx.db.kv.list('worldbuilding', 'faction:', { projectId: payload.projectId });
    for (const entry of factions) {
      const faction = entry.value as { id: string; appearances: number };
      if (faction && typeof faction.appearances === 'number') {
        faction.appearances += 1;
        await ctx.db.kv.set('worldbuilding', `faction:${faction.id}`, faction, { projectId: payload.projectId });
      }
    }
  });

  ctx.logger.info('世界观建造师 Server 面已挂载（路由 / 2 个 AI 工具 / 技能 / 事件订阅）');
}
