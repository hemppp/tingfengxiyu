// ============================================================
// statusBar.ts —— 通栏状态栏的真实数据源（t1 外壳改造）
//
// 截图下端：「● 已保存 12,480 字 | 手写模式 … 墨韵 · 空山雨后 19:16」。
// 三个数字/状态都必须有真实来源，不得写死：
//   · 保存态：本地缓存（`chapterLocalCache`，由 useEditorInstance 的 200ms 防抖
//     flushPersist 同步写入）与 store 当前章节内容比对 —— 一致 = 已落盘，不一致 =
//     还在防抖窗口内（显示「保存中…」）。缓存比该章节的服务端 `updatedAt` 更旧时
//     视为服务端权威（避免上一次会话的陈旧缓存让状态卡在「保存中…」）。
//   · 总字数：`Project.currentWordCount`（服务端项目字段，经 syncService 刷新）。
//   · 当前模式：`useProjectMode()`（= project.mode）。
//   · 右端：`THEMES` 里的真实主题名 + 亮/暗档 + 浏览器实时时钟。
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { getCachedChapterContent } from '@novel-plugins/data-core/data/chapterLocalCache';
import { apiClient } from '@/services/api/apiClient';
import { useProjectStore } from '@/stores';

export interface SaveState {
  /** true = 当前章节内容已落盘（或无可比对的未落盘改动） */
  saved: boolean;
}

/**
 * 保存态的**真实**判定：本地缓存 vs store 内容。
 * `chapter` 为 null（未打开章节）时恒为「已保存」。
 */
export function useSaveState(
  chapter: { id: string; content: string; updatedAt: number } | null,
): SaveState {
  const chapterId = chapter?.id ?? null;
  const content = chapter?.content ?? '';
  const updatedAt = chapter?.updatedAt ?? 0;
  const [tick, setTick] = useState(0);

  // 缓存由编辑器的防抖 flush 写入，1s 轮询即可覆盖「输入 → 落盘」的窗口
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  return useMemo(() => {
    if (!chapterId) return { saved: true };
    const cached = getCachedChapterContent(chapterId);
    if (!cached) return { saved: true };
    if (cached.content === content) return { saved: true };
    // 缓存比服务端记录更旧 ⇒ 服务端权威，无待落盘改动
    if (updatedAt > 0 && cached.updatedAt <= updatedAt) return { saved: true };
    return { saved: false };
  }, [chapterId, content, updatedAt, tick]);
}

/** 浏览器实时时钟（HH:MM，24 小时制），用于状态栏右端。 */
export function useClock(intervalMs = 30_000): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return useMemo(
    () =>
      new Date(now).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [now],
  );
}

/** 千分位字数（截图「12,480 字」）。 */
export function formatWordCount(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN');
}

/**
 * ★ t4（跨区集成）：状态栏「总字数」的**刷新闭环**。
 *
 * 缺口（e2e 实测暴露，`scripts/e2e/e2e-ui-integration.mjs` 第 4 节）：
 *   状态栏渲染的是 `Project.currentWordCount`，但前端**没有任何一处**在编辑之后
 *   重新读取项目记录 —— 该字段只在「进入项目（读 /projects/:id）」或
 *   「切模式（PUT 的响应）」时被写进 store。逐字写正文时服务端 `current_word_count`
 *   已经涨到 23，状态栏却一直停在 `0 字`，直到刷新页面才变成真实值。
 *   这直接违反「顶栏 ↔ 标签栏 ↔ 编辑器 ↔ 面板 ↔ 状态栏五处状态一致」的验收口径。
 *
 * 修法（最小、单点）：按 `projectId` 拉一次 `/projects/:id`，把服务端
 *   `currentWordCount` 经 `updateProject` 写回 store —— 状态栏的**数据源不变**
 *   （仍是 `Project.currentWordCount`），只是让它保持新鲜。
 *   · 立即拉一次（进项目 / 切章节后立刻对齐）；
 *   · 之后 `intervalMs`（默认 5s）轮询一次，覆盖「边写边涨」的窗口；
 *   · 值未变则不写 store（不触发无谓重渲染）；项目不匹配则丢弃（防跨项目竞态）；
 *   · 失败静默 —— 一次网络抖动不该让状态栏报错（保存态另有本地缓存判定）。
 */
export function useProjectWordCountSync(projectId: string | null, intervalMs = 5000): void {
  useEffect(() => {
    if (!projectId || intervalMs <= 0) return;
    let cancelled = false;
    const sync = (): void => {
      apiClient
        .get<{ id: string; currentWordCount: number }>(`/projects/${projectId}`)
        .then((p) => {
          if (cancelled || !p || typeof p.currentWordCount !== 'number') return;
          const cur = useProjectStore.getState().currentProject;
          if (!cur || cur.id !== projectId) return;
          if (cur.currentWordCount === p.currentWordCount) return;
          useProjectStore.getState().updateProject({ currentWordCount: p.currentWordCount });
        })
        .catch(() => {
          /* 静默：见上方注释 */
        });
    };
    sync();
    const timer = window.setInterval(sync, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, intervalMs]);
}
