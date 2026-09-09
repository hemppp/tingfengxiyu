// ============================================================
// 搜索路由
// POST /api/search - 代理外部搜索 API（DuckDuckGo）
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth, type AuthVariables } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { searchWeb, type SearchResultItem } from '../services/search-service.js';

const searchSchema = z.object({
  query: z.string().min(1, '搜索关键词不能为空').max(500, '搜索关键词过长'),
  maxResults: z.number().int().min(1).max(20).optional(),
});

const router = new Hono<{ Variables: AuthVariables }>();

// 搜索速率限制：每用户每分钟最多 10 次
const searchRateLimit = rateLimit({ maxRequests: 10, windowMs: 60_000, keyBy: 'user' });

router.post('/', requireAuth, searchRateLimit, zValidator('json', searchSchema), async (c) => {
  const body = c.req.valid('json') as z.infer<typeof searchSchema>;
  const signal = c.req.raw.signal;

  const maxResults = body.maxResults ?? 5;
  const results: SearchResultItem[] = await searchWeb(body.query, maxResults, signal);

  return c.json({ data: { results } });
});

export default router;
