// 字体排版 —— 编辑器中文字的显示粗细与颜色（用户级设置，全局 KV）
import { Hono } from 'hono';
import type { ServerPluginContext } from '@novel/core';

export const name = 'novel.typography';
export const inject = ['routes', 'db'];

/** 合法粗细档位（编辑器常规 100–900，步进 100） */
const WEIGHTS = [300, 400, 500, 600, 700] as const;
const DEFAULT_SETTINGS = { weight: 600, color: null as string | null };

const KV_KEY = 'typography.settings';

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
}

export function apply(ctx: ServerPluginContext): void {
  const router = new Hono();

  // 读取排版设置（全局 KV，无 projectId —— 用户级偏好）
  router.get('/settings', (c) => {
    const saved = ctx.db.kv.get<{ weight?: number; color?: string | null }>('novel.typography', KV_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
    return c.json({ settings });
  });

  // 保存排版设置
  router.put('/settings', async (c) => {
    const body = await c.req.json<{ weight?: number; color?: string | null }>().catch(() => ({}));
    const next: { weight: number; color: string | null } = { ...DEFAULT_SETTINGS };

    if (body.weight !== undefined) {
      if (!(WEIGHTS as readonly number[]).includes(body.weight)) {
        return c.json({ error: `weight 必须是 [${WEIGHTS.join(', ')}] 之一` }, 400);
      }
      next.weight = body.weight;
    }
    if (body.color !== undefined) {
      if (body.color !== null && !isHexColor(body.color)) {
        return c.json({ error: 'color 必须是 #hex（或 null 表示跟随主题）' }, 400);
      }
      next.color = body.color;
    }

    await ctx.db.kv.set('novel.typography', KV_KEY, next);
    return c.json({ settings: next });
  });

  // 恢复默认
  router.delete('/settings', async (c) => {
    await ctx.db.kv.delete('novel.typography', KV_KEY);
    return c.json({ settings: DEFAULT_SETTINGS });
  });

  ctx.effect(() => ctx.routes.register('/api/plugins/typography', router), 'novel.typography: routes');
  ctx.logger.info('字体排版 Server 面已挂载');
}
