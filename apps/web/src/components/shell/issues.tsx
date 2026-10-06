// ============================================================
// issues.tsx —— 底部细条「N 条问题」与问题清单的**真实数据源**（t1 外壳改造）
//
// 截图下端：左「▸ 底部面板」、右「3 条问题 Ctrl+J」。
// N 不允许写死，取值链（自上而下，第一个命中的生效）：
//   1. **外部 provider**：t2 的「本章未解决批注数」接口 / t4 的集成层经
//      `registerIssueCountProvider(fn)` 注入（fn 返回 null 表示「不接管」）；
//   2. **回落**：`useAnnotationStore`（真实 store，由 /api/annotations 经 syncService
//      同步而来）中当前章节的批注条数 —— 即 mock 里批注块「已入问题清单」的那份清单。
// 无项目 / 无章节 / 无批注 ⇒ 0，绝不伪造数字。
// ============================================================

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAnnotationStore, useChapterStore } from '@/stores';
import type { Annotation } from '@novel/shared';

// ============================================================
// ★ t4（集成接线）：中栏「内嵌批注块」计数的**零 import 通道**
//
// 为什么不用 import：t2 的实现位于 `apps/plugins/manual/workbench/web/editor/`，
// 而本文件属于 kernel（`apps/web/src/`）。kernel 直接 import 插件目录会造出一条
// kernel→plugin 的静态模块边（既有一模块一包的边界约束不允许），所以走 t2
// **已经公开**的两个跨区接口（t2 交付契约原文）：
//   · `window.__novelmuseAnnotationBlocks = { chapterId, total, open }`
//   · `window.addEventListener('novelmuse:annotation-blocks', e => e.detail)`
//     （同步派发同一对象；**值不变不换引用**，故这里用内部 version 计数订阅）
//
// `open` 即「本章未解决批注块数」= 底部细条「N 条问题」里 N 的优先取值。
// 桥缺席（无手写台 / 编辑器未挂载）⇒ 全部返回 null，静默回落到 annotation store。
// ============================================================

/** t2 交付的批注块汇总快照（字段与 `AnnotationBlockSummary` 一致）。 */
export interface AnnotationBlockSummary {
  chapterId: string | null;
  total: number;
  open: number;
}

export const ANNOTATION_BLOCKS_GLOBAL_KEY = '__novelmuseAnnotationBlocks';
export const ANNOTATION_BLOCKS_EVENT = 'novelmuse:annotation-blocks';

function isAnnotationBlockSummary(v: unknown): v is AnnotationBlockSummary {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.total !== 'number' || typeof o.open !== 'number') return false;
  return o.chapterId === null || o.chapterId === undefined || typeof o.chapterId === 'string';
}

/** 读取桥的当前快照；桥不存在 / 形状不符 ⇒ null（绝不伪造数字）。 */
export function readAnnotationBlocks(): AnnotationBlockSummary | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as unknown as Record<string, unknown>)[ANNOTATION_BLOCKS_GLOBAL_KEY];
  if (!isAnnotationBlockSummary(raw)) return null;
  const snap = raw as AnnotationBlockSummary;
  return { chapterId: snap.chapterId ?? null, total: snap.total, open: snap.open };
}

let blockVersion = 0;
const blockListeners = new Set<() => void>();

function onAnnotationBlocksEvent(): void {
  blockVersion += 1;
  blockListeners.forEach((l) => l());
}

/** 订阅桥事件（首个订阅者挂 window 监听，最后一个注销时移除）。 */
export function subscribeAnnotationBlocks(listener: () => void): () => void {
  blockListeners.add(listener);
  if (blockListeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener(ANNOTATION_BLOCKS_EVENT, onAnnotationBlocksEvent);
  }
  return () => {
    blockListeners.delete(listener);
    if (blockListeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener(ANNOTATION_BLOCKS_EVENT, onAnnotationBlocksEvent);
    }
  };
}

/** 订阅快照：单调递增的版本号（桥「值不变不换引用」，只能靠它触发重算）。 */
export function annotationBlocksVersion(): number {
  return blockVersion;
}

/**
 * ★ t4：订阅「本章批注块计数」。仅当快照的 chapterId 与入参**完全一致**时返回，
 * 否则 null（切章瞬间、编辑器卸载后的 reset 都不会串台）。
 */
export function useAnnotationBlocks(chapterId: string | null): AnnotationBlockSummary | null {
  const version = useSyncExternalStore(
    subscribeAnnotationBlocks,
    annotationBlocksVersion,
    annotationBlocksVersion,
  );
  return useMemo(() => {
    const snap = readAnnotationBlocks();
    if (!snap || !chapterId) return null;
    return snap.chapterId === chapterId ? snap : null;
  }, [chapterId, version]);
}

/** 外部条数 provider：入参为当前章节 id，返回 null 表示「本 provider 不接管」。 */
export type IssueCountProvider = (chapterId: string | null) => number | null;

let provider: IssueCountProvider | null = null;
const listeners = new Set<() => void>();

/**
 * 注册 / 注销条数 provider（返回注销函数）。同一时刻只保留最后一个。
 * t2 / t4 用它接管「本章未解决批注数」；注销后自动回落到 annotation store。
 */
export function registerIssueCountProvider(fn: IssueCountProvider | null): () => void {
  provider = fn;
  listeners.forEach((l) => l());
  return () => {
    if (provider === fn) provider = null;
    listeners.forEach((l) => l());
  };
}

/** 当前章节 id（真实 store）。 */
export function useCurrentChapterId(): string | null {
  return useChapterStore((s) => s.currentChapterId);
}

/** 底部细条右端的 N：provider 优先，其次 t2 批注块桥，最后回落当前章节批注条数。 */
export function useIssueCount(): number {
  const chapterId = useChapterStore((s) => s.currentChapterId);
  const annotations = useAnnotationStore((s) => s.annotations);
  const [tick, setTick] = useState(0);
  // ★ t4：桥「值不变不换引用」，只能订阅它的版本号来触发重算
  const blocksVersion = useSyncExternalStore(
    subscribeAnnotationBlocks,
    annotationBlocksVersion,
    annotationBlocksVersion,
  );

  useEffect(() => {
    const l = () => setTick((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return useMemo(() => {
    const fromProvider = provider?.(chapterId);
    if (typeof fromProvider === 'number') return fromProvider;
    // ★ t4（跨区契约①）：N = 中栏本章**未解决**内嵌批注块数（真实 DOM 节点计数，
    //   由 t2 的 useAnnotationBlockBridge 发布）。这是截图里「已入问题清单」的那份数。
    const snap = readAnnotationBlocks();
    if (snap && chapterId && snap.chapterId === chapterId) return snap.open;
    if (!chapterId) return 0;
    return annotations.filter((a) => a.chapterId === chapterId).length;
  }, [chapterId, annotations, tick, blocksVersion]);
}

/** 当前章节的批注（问题清单）原始列表。 */
export function useChapterIssues(chapterId: string | null): Annotation[] {
  const annotations = useAnnotationStore((s) => s.annotations);
  return useMemo(
    () => (chapterId ? annotations.filter((a) => a.chapterId === chapterId) : []),
    [annotations, chapterId],
  );
}

const TYPE_LABEL: Record<string, string> = {
  character: '人物',
  item: '物品',
  location: '地点',
  event: '事件',
  foreshadow: '伏笔',
  general: '待核',
  note: '笔记',
};

/** 底部面板展开后的内容：当前章节的问题清单（真实批注；无数据给空态文案）。 */
export function BottomIssueList() {
  const chapterId = useCurrentChapterId();
  const issues = useChapterIssues(chapterId);
  // ★ t4：与底部细条「N 条问题」同源 —— 展开后能看到 N 是怎么算出来的
  const blocks = useAnnotationBlocks(chapterId);

  if (!chapterId) {
    return <div className="shell-bottom-empty">未打开章节。</div>;
  }
  return (
    <div className="shell-bottom-body">
      {blocks ? (
        <div className="shell-bottom-blocks" data-testid="bottom-annotation-blocks">
          内嵌批注块 {blocks.total} 条 · 未解决 {blocks.open} 条
        </div>
      ) : null}
      {issues.length === 0 ? (
        <div className="shell-bottom-empty">当前章节没有问题。</div>
      ) : (
        <ul className="shell-bottom-issues" aria-label="问题清单">
          {issues.map((a) => (
            <li key={a.id} className="shell-bottom-issue">
              <span className="shell-bottom-issue-type">{TYPE_LABEL[a.type] ?? a.type}</span>
              <span className="shell-bottom-issue-text">{a.description || a.selectedText}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
