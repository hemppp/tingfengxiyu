// ============================================================
// 事件去重服务
// ============================================================

import type { TimelineEvent } from '@novel/shared';

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function stringSimilarity(s1: string, s2: string): number {
  const n1 = normalizeText(s1);
  const n2 = normalizeText(s2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1;
  const maxLen = Math.max(n1.length, n2.length);
  return 1 - levenshteinDistance(n1, n2) / maxLen;
}

export interface DedupeResult {
  events: TimelineEvent[];
  removedCount: number;
  removedIds: string[];
}

/**
 * 对事件列表进行去重（同章节、标题/描述相似度超过阈值的事件合并为一条）
 */
export function dedupeEvents(events: TimelineEvent[], threshold = 0.7): DedupeResult {
  if (events.length < 2) {
    return { events, removedCount: 0, removedIds: [] };
  }

  const kept: TimelineEvent[] = [];
  const removedIds: string[] = [];
  const byChapter = new Map<number | null, TimelineEvent[]>();

  for (const ev of events) {
    const key = ev.chapter ?? null;
    const list = byChapter.get(key) || [];
    list.push(ev);
    byChapter.set(key, list);
  }

  for (const [, chapterEvents] of byChapter) {
    const sorted = [...chapterEvents].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const ev of sorted) {
      let isDuplicate = false;
      for (const k of kept) {
        if ((k.chapter ?? null) !== (ev.chapter ?? null)) continue;
        const titleSim = stringSimilarity(k.title || '', ev.title || '');
        const descSim = stringSimilarity(k.description || '', ev.description || '');
        if (titleSim >= threshold || (descSim >= threshold && titleSim > 0.3)) {
          isDuplicate = true;
          removedIds.push(ev.id);
          if (ev.description && !k.description) {
            k.description = ev.description;
          } else if (ev.description && k.description && ev.description.length > k.description.length) {
            k.description = ev.description;
          }
          if (ev.characterIds?.length) {
            const merged = new Set([...(k.characterIds || []), ...ev.characterIds]);
            k.characterIds = Array.from(merged);
          }
          break;
        }
      }
      if (!isDuplicate) {
        kept.push({ ...ev });
      }
    }
  }

  return {
    events: kept,
    removedCount: removedIds.length,
    removedIds,
  };
}
