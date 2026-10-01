// ============================================================
// 前端本地敏感数据生命周期
//
// 小说正文、AI 对话、thinking、大纲、参考书分析等会写入 localStorage。
// 本模块提供按项目清理与登出全清，避免：
//   - 删除项目后正文/对话/大纲残留在浏览器
//   - 多账号共用浏览器时互相看到对方内容
// ============================================================

// ============================================================
// ★ D44 / 设计 §4-C2：本模块**不得**静态 import auto 的 `chatHistoryStore`。
//
//   原因：`chatHistoryStore` 归 **auto** 模块（`@novel-plugins/auto-workbench/stores`），
//   而本文件在 **shared** 包内。若直接 import，会形成 **shared → auto** 静态边，
//   使「移除 auto 模块后仍可编译」不再成立（t6-F1 反例）。
//
//   消解方式（**按 localStorage 键前缀清理**）：不引用 auto 的 store，
//   改为直接操作 chat 历史的持久化键。这样：
//     · auto 缺席 → 清理照常执行，无悬空 import、无抛错；
//     · auto 在场 → 持久化数据被清；内存态由本模块提供的
//       `registerLocalDataCleaner` 注册点交由 auto 侧自清（见下）。
// ============================================================

/** chat 历史持久化键（= auto `chatHistoryStore.ts:29` 的 STORAGE_KEY，此处为**契约常量**） */
const CHAT_HISTORY_KEY = 'novelmuse_chat_histories';

const OUTLINE_PREFIX = 'novel-outline-notepad:v1:';
const BOOK_ANALYSIS_PREFIX = 'nm_book_analysis_';
const CHAPTER_CACHE_PREFIX = 'nm:chapter:';

/**
 * 模块自清注册点（D44：消解 shared→auto 静态边，保留 auto 内存态同步清理的能力）。
 *
 * auto 模块在 `apply(ctx)` 时把自己的内存态清理函数注册进来（模块内 import 自己的
 * store 是**模块内**依赖，不产生跨域边）。kernel/shared 清理时遍历调用 ——
 * auto 缺席 ⇒ 注册表为空 ⇒ 只清 localStorage，无报错。
 */
type LocalDataCleaner = (projectId: string | null) => void;
const cleaners = new Set<LocalDataCleaner>();

/**
 * 注册一个模块自清回调。
 * @param cleaner 入参：`projectId` 为具体项目 id（删项目场景）；`null` 表示「登出全清」。
 * @returns 注销函数（插件卸载时由 DisposerBag 调用）
 */
export function registerLocalDataCleaner(cleaner: LocalDataCleaner): () => void {
  cleaners.add(cleaner);
  return () => {
    cleaners.delete(cleaner);
  };
}

/** 通知所有已注册的模块自清（单个失败不影响其它，也不向上抛） */
function notifyCleaners(projectId: string | null): void {
  for (const fn of cleaners) {
    try {
      fn(projectId);
    } catch {
      // 单个模块清理失败不得影响其它模块或本函数调用方
    }
  }
}

/** 从 chat 历史持久化值中剔除某项目的键（`${projectId}:*`），返回新值；解析失败返回 null */
function pruneChatHistoryForProject(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!k.startsWith(`${projectId}:`)) next[k] = v;
    }
    return JSON.stringify(next);
  } catch {
    // 值损坏 / 非 JSON：交由 removeKeysByPredicate 整键移除（见 clearProjectLocalData）
    return null;
  }
}

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
  // 1) 聊天历史（auto 的持久化键）：按项目粒度剔除 `${projectId}:*`。
  //    值可解析 → 写回剔除后的 JSON；不可解析 → 整键移除（宁可清多，不留脏数据）。
  try {
    if (localStorage.getItem(CHAT_HISTORY_KEY) !== null) {
      const pruned = pruneChatHistoryForProject(projectId);
      if (pruned !== null) localStorage.setItem(CHAT_HISTORY_KEY, pruned);
      else localStorage.removeItem(CHAT_HISTORY_KEY);
    }
  } catch {
    // 隐私模式等环境 ignore
  }
  // 2) 通知各模块自清内存态（auto 缺席 ⇒ 无订阅者，静默跳过）
  notifyCleaners(projectId);
  // 3) 其余 kernel 自有键
  removeKeysByPredicate(
    (k) =>
      k === `${OUTLINE_PREFIX}${projectId}` ||
      k.startsWith(`${BOOK_ANALYSIS_PREFIX}${projectId}_`) ||
      k.startsWith(`nm-outline-notepad:v1:${projectId}`),
  );
}

/** 登出时：清空全部聊天历史 / 大纲 / 参考书分析 / 章节缓存 */
export function clearAllLocalUserData(): void {
  // 1) 聊天历史整键移除（auto 的持久化键）
  try {
    localStorage.removeItem(CHAT_HISTORY_KEY);
  } catch {
    // ignore
  }
  // 2) 通知各模块自清内存态（auto 在场 ⇒ 清 histories 内存态）
  notifyCleaners(null);
  // 3) 其余 kernel 自有键
  removeKeysByPredicate(
    (k) =>
      k.startsWith(OUTLINE_PREFIX) ||
      k.startsWith('nm-outline-notepad:v1:') ||
      k.startsWith(BOOK_ANALYSIS_PREFIX) ||
      k.startsWith(CHAPTER_CACHE_PREFIX),
  );
}
