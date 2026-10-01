// ============================================================
// 写作统计路由
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  listStats,
  createStats,
  getStats,
  deleteStats,
} from '../services/stats-service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectScope, type ProjectScopedVariables } from '../lib/project-scope.js';

const createStatsSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须YYYY-MM-DD'),
  wordCount: z.number().int().min(0),
  chapterId: z.string().optional(),
  duration: z.number().int().min(0).nullish(),
});

const router = new Hono<{ Variables: ProjectScopedVariables }>();

router.get('/projects/:projectId', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const stats = await listStats(projectId);
  return c.json({ data: stats });
});

router.post('/', requireAuth, zValidator('json', createStatsSchema), async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const data = c.req.valid('json') as z.infer<typeof createStatsSchema>;
  const stat = await createStats({
    id: data.id,
    projectId,
    date: data.date,
    wordCount: data.wordCount,
    chapterId: data.chapterId,
    duration: data.duration ?? undefined,
  }, projectId);
  return c.json({ data: stat }, 201);
});

router.delete('/:id', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;
  const id = c.req.param('id');
  if (!id) return c.json({ error: { code: 'BAD_REQUEST', message: '缺少 ID' } }, 400);
  const existing = await getStats(id, projectId);
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: '统计记录不存在' } }, 404);
  await deleteStats(id, projectId);
  return c.json({ data: { success: true } });
});

// GET /api/stats/projects/:projectId/summary - 写作统计汇总
router.get('/projects/:projectId/summary', requireAuth, async (c) => {
  const denial = await requireProjectScope(c);
  if (denial) return denial;
  const projectId = c.get('projectId')!;

  const stats = await listStats(projectId);

  const totalWords = stats.reduce((sum, s) => sum + (s.wordCount || 0), 0);
  const totalDays = new Set(stats.map(s => s.date)).size;

  const today = new Date().toISOString().split('T')[0];
  const todayWords = stats
    .filter(s => s.date === today)
    .reduce((sum, s) => sum + (s.wordCount || 0), 0);

  const last7Days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(d.toISOString().split('T')[0]);
  }
  const last7DaysWords = last7Days.map(date => {
    const dayWords = stats
      .filter(s => s.date === date)
      .reduce((sum, s) => sum + (s.wordCount || 0), 0);
    return { date, words: dayWords };
  });
  const last7DaysTotal = last7DaysWords.reduce((sum, d) => sum + d.words, 0);

  const byDate = new Map<string, number>();
  for (const s of stats) {
    const curr = byDate.get(s.date) ?? 0;
    byDate.set(s.date, curr + (s.wordCount || 0));
  }
  let streakDays = 0;
  let maxStreak = 0;
  const sortedDates = Array.from(byDate.keys()).sort();
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      streakDays = 1;
    } else {
      const prev = new Date(sortedDates[i - 1]!);
      const curr = new Date(sortedDates[i]!);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        streakDays++;
      } else {
        maxStreak = Math.max(maxStreak, streakDays);
        streakDays = 1;
      }
    }
  }
  maxStreak = Math.max(maxStreak, streakDays);

  const avgPerDay = totalDays > 0 ? Math.round(totalWords / totalDays) : 0;

  return c.json({
    data: {
      totalWords,
      totalDays,
      todayWords,
      last7Days: last7DaysWords,
      last7DaysTotal,
      maxStreak,
      avgPerDay,
    },
  });
});

export default router;
