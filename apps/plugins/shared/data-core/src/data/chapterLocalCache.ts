// ============================================================
// 章节编辑器内容 —— 同步本地缓存
// ------------------------------------------------------------
// 背景：章节内容原先只有「内存 Zustand store + 异步 HTTP PUT 后端」两条路径，
// 没有任何同步本地持久化。一旦热更新（HMR 整页刷新）/ 刷新 / 关页时异步 PUT
// 尚未落地，正在写的内容就会丢失（见 useEditorInstance 的 200ms 防抖 + 异步落库）。
//
// 这里用 localStorage 按 chapterId 同步缓存最新内容，作为后端异步落库的兜底。
// 思路与 OutlineManager 的 localStorage 持久化一致：同步、即时、可跨刷新存活。
// 优先级由 updatedAt 决定——只有本地缓存比后端（store/DB）更新时才覆盖，避免回退。
// ============================================================

const PREFIX = 'nm:chapter:';

export interface CachedChapter {
  content: string;
  wordCount: number;
  updatedAt: number;
}

/** 同步写入章节内容缓存（失败静默降级，不阻塞编辑） */
export function cacheChapterContent(id: string, data: CachedChapter): void {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(data));
  } catch {
    /* 隐私模式 / 配额超限：静默降级，后端异步落库仍在进行 */
  }
}

/** 读取章节内容缓存；损坏或格式不符返回 null */
export function getCachedChapterContent(id: string): CachedChapter | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedChapter>;
    if (typeof parsed.content === 'string' && typeof parsed.updatedAt === 'number') {
      return {
        content: parsed.content,
        wordCount: typeof parsed.wordCount === 'number' ? parsed.wordCount : 0,
        updatedAt: parsed.updatedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 清除某章节的本地缓存（如确认后端已是最新时可调用） */
export function clearCachedChapterContent(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
}
