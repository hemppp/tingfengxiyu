/**
 * 章节相关的纯函数工具。
 *
 * 起因（2026-09-16）：同一次改动里出现了两处「该打开哪一章」的判断，
 * 初始实现各写了一份且口径不一致 ——
 *   · EditorPage 的「打开最近章节」按钮：取 updatedAt 最大
 *   · ChapterEditor 的失效 URL 兜底：取 chapters[0]
 * 后者等于「第一章」，与按钮语义冲突（用户从失效链接进来，期待的是接着上次写）。
 * 统一收口到这里，避免再次分叉。
 */

/** 取章节数组里 updatedAt 最大的那一章；空数组返回 undefined */
export function pickMostRecentChapter<T extends { updatedAt: number }>(
  chapters: readonly T[],
): T | undefined {
  if (chapters.length === 0) return undefined;
  return chapters.reduce((newest, c) => (c.updatedAt > newest.updatedAt ? c : newest));
}

/**
 * 「失效链接应落到哪一章」的统一口径。
 *
 * 优先最近编辑过的那章（= 用户上次写到的地方）；没有任何章节时返回 null，
 * 由调用方决定回退到项目首页。
 *
 * @param chapters 已按项目过滤好的章节列表
 */
export function pickFallbackChapterId<T extends { id: string; updatedAt: number }>(
  chapters: readonly T[],
): string | null {
  return pickMostRecentChapter(chapters)?.id ?? null;
}
