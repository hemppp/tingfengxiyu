// ============================================================
// dock/layout.ts — dockview 选项 / 布局组装（P2 · t3，纯函数，便于单测）
//
// 职责：把「外部传入的面板定义数组」翻译成 dockview 的
//   components / addPanel options / 初始 layout。
// 本文件**不**触碰 DOM、不硬编码任何业务面板 key。
//
// 契约：ADR §1.4（落位与缺省）、§1.6（center 抢占中心槽）、§5.5（--dv-* → --vscode-*）。
// ============================================================

import type {
  DockAreaSlot,
  DockPanelDef,
  DockSlot,
  ResolvedDockMeta,
} from './types';
import { resolveDockMeta } from './types';

/** 侧栏 / 底部面板的初始尺寸（VS Code 侧栏量级）。 */
export const DOCK_SIDE_PANEL_DEFAULT_WIDTH = 320;
export const DOCK_BOTTOM_PANEL_DEFAULT_HEIGHT = 240;

/** dockview 侧的落位方向（`Direction` 的超集，'within' 用于同 group 堆叠）。 */
export type DropDirection = 'left' | 'right' | 'above' | 'below' | 'within';

/**
 * 把 ADR 的槽位名映射到 dockview 的 `Direction`。
 * dockview 用 above/below，本仓库契约用 top/bottom —— 这里是唯一转换点。
 */
export function slotToDockDirection(slot: DockAreaSlot): DropDirection {
  switch (slot) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'bottom':
      return 'below';
  }
}

/** 每个 dock area 承载的初始面板（§1.4 缺省 slot='right'）。 */
export interface DockAreaPlan {
  left: DockPanelDef[];
  right: DockPanelDef[];
  bottom: DockPanelDef[];
  center: DockPanelDef[];
}

/**
 * 按 `resolveDockMeta(def).slot` 把候选池分桶。
 * ★ 不修改传入数组；顺序按 `order`（缺省 0）稳定排序，保证初始布局可复现。
 */
export function planDockAreas(panels: DockPanelDef[]): DockAreaPlan {
  const sorted = panels
    .map((def, index) => ({ def, index }))
    .sort((a, b) => {
      const oa = a.def.order ?? 0;
      const ob = b.def.order ?? 0;
      if (oa !== ob) return oa - ob;
      return a.index - b.index; // 稳定：order 相同时保序
    })
    .map((x) => x.def);

  const plan: DockAreaPlan = { left: [], right: [], bottom: [], center: [] };
  for (const def of sorted) {
    const meta = resolveDockMeta(def);
    // §1.6 裁定：`center` 布尔优先于 `slot` —— center 面板不参与侧栏候选池。
    const slot: DockSlot = meta.center ? 'center' : meta.slot;
    plan[slot].push(def);
  }
  return plan;
}

/** dockview `addPanel` 的入参（这里只列出本内核会设置的字段）。 */
export interface DockPanelSpec {
  id: string;
  title: string;
  component: string;
  params: { defKey: string; def: DockPanelDef };
  position: { direction: DropDirection; referencePanel: string };
  initialWidth?: number;
  initialHeight?: number;
  minimumWidth: number;
  minimumHeight: number;
}

/** dockview 内部注册的**唯一**通用渲染器 id（见 DockPanelContent）。 */
export const DOCK_PANEL_COMPONENT_ID = 'dock:panel';

/**
 * 为一个面板生成 dockview `addPanel` 规格。
 *
 * @param def       面板定义（外部传入）
 * @param slot      目标停靠区
 * @param anchorId  参考面板 id；同区首个面板用它定位（等于先注册的兄弟 id）
 */
export function buildPanelSpec(
  def: DockPanelDef,
  slot: DockSlot,
  anchorId: string,
): DockPanelSpec {
  const meta: ResolvedDockMeta = resolveDockMeta(def);
  const spec: DockPanelSpec = {
    id: panelInstanceId(def.key),
    title: def.label,
    component: DOCK_PANEL_COMPONENT_ID,
    params: { defKey: def.key, def },
    position:
      slot === 'center'
        ? { direction: 'within', referencePanel: anchorId }
        : { direction: slotToDockDirection(slot), referencePanel: anchorId },
    minimumWidth: meta.minSize.width,
    minimumHeight: meta.minSize.height,
  };
  // 侧栏 / 底部面板给一个初始尺寸，避免首个面板占满整屏（VS Code 侧栏量级）
  if (slot === 'left' || slot === 'right') {
    spec.initialWidth = DOCK_SIDE_PANEL_DEFAULT_WIDTH;
  } else if (slot === 'bottom') {
    spec.initialHeight = DOCK_BOTTOM_PANEL_DEFAULT_HEIGHT;
  }
  return spec;
}

/** 面板实例 id（与业务 key 区分开，因为同一 key 可能多实例，ADR §1.4 allowMultiple）。 */
export function panelInstanceId(key: string): string {
  return `nm-panel:${key}`;
}

/** 从实例 id 反解业务 key。 */
export function panelKeyFromInstanceId(id: string): string {
  const prefix = 'nm-panel:';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/**
 * §1.6：中心区默认占用者的**固定参考 id**。
 * dockview 需要至少一个面板才能建立 grid；中心区先放一个「章节编辑区」占位面板，
 * 其内容由 `centerDefault` 注入（见 DockShell），被 center panel 抢占时替换。
 */
export const CENTER_DEFAULT_PANEL_ID = 'nm-center-default';

/** center 面板的实例 id 前缀（与普通面板区分，便于 activeCenterKey 反查）。 */
export function centerPanelInstanceId(key: string): string {
  return `nm-center:${key}`;
}

export function isCenterPanelInstanceId(id: string): boolean {
  return id.startsWith('nm-center:');
}

/**
 * 组装初始布局的**执行序列**：dockview 的 `addPanel` 必须串行，
 * 且首个面板不带 position（它建立 grid 根）。这里产出可直接 for 循环执行的描述数组。
 */
export interface LayoutStep {
  spec: DockPanelSpec;
  /** true = 该步是 grid 的根面板，不传 position */
  isRoot: boolean;
}

export function buildLayoutSteps(plan: DockAreaPlan, rootId: string): LayoutStep[] {
  const steps: LayoutStep[] = [];
  const anchors: Record<DockSlot, string | null> = {
    left: null,
    right: null,
    bottom: null,
    center: null,
  };

  // 顺序：center 先建根 → left → right → bottom，保证侧栏吸附到中心区两侧
  const order: DockSlot[] = ['center', 'left', 'right', 'bottom'];

  for (const slot of order) {
    for (const def of plan[slot]) {
      const anchor = anchors[slot] ?? rootId;
      const spec = buildPanelSpec(def, slot, anchor);
      // 只有第一个 center 面板（或没有 center 时第一个 left 面板）是根
      const isRoot = anchors[slot] === null && steps.length === 0;
      steps.push({ spec, isRoot });
      anchors[slot] = spec.id;
    }
  }
  return steps;
}
