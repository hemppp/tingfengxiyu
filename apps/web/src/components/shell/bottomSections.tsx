// ============================================================
// bottomSections.tsx — 底部面板「分区」注册表（kernel 扩展点）
//
// 背景：DockShell 的底部面板（细条 + 展开区）原先只有一个内容源 ——
//   `DockShellProps.bottomPanel.children`（问题清单）。本文件让**插件**
//   也能往展开区里加一栏，并在细条右侧加一个入口（可带计数）。
//
// 契约：
//   · 注册者给出 `ThinEntry`（细条右侧入口，收 `{ open, onOpen }`）
//     与 `Component`（展开区中的一栏，由 DockShell 提供栏目标题）
//   · 展开区布局 = 已注册分区（左，按注册顺序）+ 调用方 children（右）
//   · 两个组件都必须**同步可渲染**（禁止 `React.lazy`）：底部面板内容区
//     没有任何 Suspense 边界（DockShell / DockPanelContent 都不提供），
//     懒加载挂起会一路上溯到路由级 fallback，把整页换成大转圈
//     （2026-10-07「跳转加载转圈」修复的实测结论）。
//   · 与 projectPanels / builtinPanels 不同，本注册表**不按模式隔离** ——
//     是否注册由插件自身在其 `apply()` 内决定（并用 `ctx.effect` 注销）。
// ============================================================

import { useSyncExternalStore, type ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** 细条右侧入口收到的 props。 */
export interface BottomThinEntryProps {
  /** 底部面板当前是否展开 */
  open: boolean;
  /** 请求展开底部面板（收起由内核的开关负责） */
  onOpen: () => void;
}

export interface BottomPanelSectionDef {
  /** 唯一键（重复注册 = 覆盖） */
  key: string;
  /** 栏目标题（渲染在展开区该栏顶部） */
  label: string;
  /** 栏目标题图标（可选） */
  icon?: LucideIcon;
  /** 细条右侧入口（计数 / 图标由注册者自己决定） */
  ThinEntry: ComponentType<BottomThinEntryProps>;
  /** 展开区中的一栏 */
  Component: ComponentType;
}

let sections: BottomPanelSectionDef[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * 注册一个底部面板分区，返回注销函数（幂等）。
 *
 * 同 key 重复注册视为**覆盖**并保持注册顺序中的位置语义（新条目追加在末尾）：
 * HMR / 模块重挂载时旧条目会被注销，这里再兜一层，避免出现两个同 key 栏目。
 */
export function registerBottomPanelSection(def: BottomPanelSectionDef): () => void {
  sections = [...sections.filter((s) => s.key !== def.key), def];
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    sections = sections.filter((s) => s.key !== def.key);
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BottomPanelSectionDef[] {
  return sections;
}

/** 订阅当前已注册的分区（注册 / 注销即触发重渲染）。 */
export function useBottomPanelSections(): BottomPanelSectionDef[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
