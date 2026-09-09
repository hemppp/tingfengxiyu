// ============================================================
// 前端本地敏感数据生命周期
//
// 小说正文、AI 对话、thinking、大纲、参考书分析等会写入 localStorage。
// 本模块提供按项目清理与登出全清，避免：
//   - 删除项目后正文/对话/大纲残留在浏览器
//   - 多账号共用浏览器时互相看到对方内容
// ============================================================

import { useChatHistoryStore } from '@/stores/chatHistoryStore';

const OUTLINE_PREFIX = 'novel-outline-notepad:v1:';
const BOOK_ANALYSIS_PREFIX = 'nm_book_analysis_';
const CHAPTER_CACHE_PREFIX = 'nm:chapter:';

function removeKeysByPredicate(test: (key: string) => boolean): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && test(k)) keys.push(k);
    }
    for (const k of keys) {
      localStorage.removeItem(k);
      removed++;
    }
  } catch {
    // 隐私模式等环境 ignore
  }
  return removed;
}

/** 删除项目时：清理该项目前缀下的聊天历史 / 大纲 / 参考书分析 */
export function clearProjectLocalData(projectId: string): void {
  if (!projectId) return;
  try {
    useChatHistoryStore.getState().removeProject(projectId);
  } catch {
    // ignore
  }
  removeKeysByPredicate(
    (k) =>
      k === `${OUTLINE_PREFIX}${projectId}` ||
      k.startsWith(`${BOOK_ANALYSIS_PREFIX}${projectId}_`) ||
      k.startsWith(`nm-outline-notepad:v1:${projectId}`),
  );
}

/** 登出时：清空全部聊天历史 / 大纲 / 参考书分析 / 章节缓存 */
export function clearAllLocalUserData(): void {
  try {
    useChatHistoryStore.getState().clearAll();
  } catch {
    // ignore
  }
  removeKeysByPredicate(
    (k) =>
      k.startsWith(OUTLINE_PREFIX) ||
      k.startsWith('nm-outline-notepad:v1:') ||
      k.startsWith(BOOK_ANALYSIS_PREFIX) ||
      k.startsWith(CHAPTER_CACHE_PREFIX),
  );
}
