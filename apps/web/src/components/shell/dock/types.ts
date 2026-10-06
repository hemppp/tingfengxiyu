// ============================================================
// dock/types.ts — 停靠内核的公共类型（P2 · t3）
//
// 契约来源：docs/architecture/dock-protocol-adr.md
//   §1.4  FloatingPanelDockMeta（8 字段全可选）
//   §1.5  resolveDockMeta() = 缺省行为的唯一真源
//   §1.6  三类内容落位（center 是显式布尔，区别于 slot 的建议语义）
//   §2.4  DockShellApi（t3 交付给 t4 的命令接口）
//
// ⚠️ 本文件只定义类型与纯函数，不 import dockview、不 import React 运行时组件，
//    以便 t4（ProjectLayout / panelNavigation）在没有 dockview 的环境下也能安全取值。
// ============================================================

import type React from 'react';
import type { FloatingPanelDef } from '@/plugin/types';

/** 停靠区槽位（§1.4）。'center' 为建议落位，'left'|'right'|'bottom' 为停靠区。 */
export type DockSlot = 'center' | 'left' | 'right' | 'bottom';

/** 可停靠的三个侧栏槽（center 由 `center` 布尔单独表达，见 §1.6 裁定）。 */
export type DockAreaSlot = Exclude<DockSlot, 'center'>;

/**
 * dock 布局元数据（P0 新增，全字段可选）。
 * 未声明 = 宿主按 ADR §1.4「缺省行为」列处理。
 *
 * ⚠️ 该接口是 P0 冻结契约的**视图层镜像**。t4 若在 `@/plugin/types` 里落地同名接口，
 *    两边必须逐字段一致；此处刻意不 import `@/plugin/types` 的该成员，
 *    因为 P0 只冻结了文档、未落地代码（避免 t3 触碰 out-of-scope 的 plugin/ 目录）。
 */
export interface FloatingPanelDockMeta {
  /** 初始落位建议（可被用户拖拽覆盖）。缺省 → 'right' */
  slot?: DockSlot;
  /** 初始启用状态。false = 注册进候选池但默认不显示。缺省 → false */
  defaultOpen?: boolean;
  /** 同 key 多实例。缺省 false = 再次 open 只聚焦，不新开 */
  allowMultiple?: boolean;
  /** 允许用户关闭（标签上的 ×）。缺省 → true */
  closable?: boolean;
  /** 可被拖出为 floating group。缺省 → true（全部面板可拖出悬浮） */
  floatable?: boolean;
  /** 首次作为 floating group 出现时的几何建议值。缺省 → width/height → 1024×720 */
  floatingSize?: { width: number; height: number };
  /** 强制最小尺寸（用户拖拽不可突破）。缺省 → {width:240, height:160} */
  minSize?: { width: number; height: number };
  /** 该面板打开时「抢占」中心区：渲染到 center 槽而非普通侧栏槽。缺省 → false */
  center?: boolean;
}

/** `resolveDockMeta()` 的返回值：全部字段必填（缺省已填充）。 */
export type ResolvedDockMeta = Required<Omit<FloatingPanelDockMeta, 'floatingSize' | 'minSize'>> & {
  floatingSize: { width: number; height: number };
  minSize: { width: number; height: number };
};

/** 面板定义在视图层的读法：`dock` 是可选扩展，其余字段来自既有 `FloatingPanelDef`。 */
export type DockPanelDef = FloatingPanelDef & { dock?: FloatingPanelDockMeta };

/** §1.5 冻结的缺省值表 —— 逐字段与本常量一一对应，不得在别处再写 `??` 兜底。 */
export const DOCK_META_DEFAULTS = Object.freeze({
  slot: 'right' as DockSlot,
  defaultOpen: false,
  allowMultiple: false,
  closable: true,
  floatable: true,
  /** floatingSize 无静态缺省：按 §1.4 依次回落 def.width/def.height → 1024×720 */
  fallbackFloatingSize: Object.freeze({ width: 1024, height: 720 }),
  minSize: Object.freeze({ width: 240, height: 160 }),
  center: false,
});

/**
 * §1.5 缺省行为的**唯一真源**（纯函数，无副作用）。
 * `ProjectLayout` 与 `panelNavigation` 一律经它取值，不得各自写 `?? 默认值`。
 */
export function resolveDockMeta(def: DockPanelDef): ResolvedDockMeta {
  const d = def.dock;
  return {
    slot: d?.slot ?? DOCK_META_DEFAULTS.slot,
    defaultOpen: d?.defaultOpen ?? DOCK_META_DEFAULTS.defaultOpen,
    allowMultiple: d?.allowMultiple ?? DOCK_META_DEFAULTS.allowMultiple,
    closable: d?.closable ?? DOCK_META_DEFAULTS.closable,
    floatable: d?.floatable ?? DOCK_META_DEFAULTS.floatable,
    // 回落链：dock.floatingSize → 顶层 width/height → 1024×720（§1.4）
    floatingSize: d?.floatingSize ?? {
      width: def.width ?? DOCK_META_DEFAULTS.fallbackFloatingSize.width,
      height: def.height ?? DOCK_META_DEFAULTS.fallbackFloatingSize.height,
    },
    minSize: d?.minSize ?? { ...DOCK_META_DEFAULTS.minSize },
    center: d?.center ?? DOCK_META_DEFAULTS.center,
  };
}

/**
 * §2.4 `DockShellApi` —— 命令式控制句柄（经 `apiRef` 暴露）。
 * 与 store 层 `PanelNavigation` 是同一套能力的两层视图。
 */
export interface DockShellApi {
  openPanel(key: string): void;
  closePanel(key: string): void;
  focusPanel(key: string): void;
  /** 当前已打开 key 顺序 */
  listPanels(): string[];
  /** 当前聚焦 key，无则 null */
  activePanel(): string | null;
  /** 把某面板弹为 floating group（用户拖拽的程序化等价物） */
  floatPanel(key: string): void;
  /** 恢复为停靠 */
  dockPanel(key: string, slot: DockAreaSlot): void;
}

/**
 * §1.6 中心槽「可替换插槽」的接口（t3 交付给 t4）。
 * 面板来源为外部传入的面板定义数组，DockShell 不硬编码任何业务面板。
 */
export interface DockShellProps {
  /** 候选面板定义池（已按当前 project.mode 过滤） */
  panels: DockPanelDef[];
  /** 中心区默认内容（章节编辑器路由出口）；被 center panel 抢占时替换 */
  centerDefault: React.ReactNode;
  /** 当前被占用时显示的中心面板 key（null = 用 centerDefault） */
  activeCenterKey: string | null;
  /** 命令式控制句柄（经 ref 暴露，见 §2.3） */
  apiRef?: React.Ref<DockShellApi>;
  /** 可选：受控的「已打开 key 列表」。未传时 DockShell 内部按 defaultOpen 自管 */
  openKeys?: string[];
  /** 可选：面板打开 / 关闭 / 聚焦的回调（t4 用于把状态写回 panelNavigation） */
  onOpenChange?: (keys: string[]) => void;
  onActiveChange?: (key: string | null) => void;
  /**
   * 底部面板细条（t1 外壳改造）。
   *
   * 截图形态：常驻一条细条，左端「底部面板」、右端「N 条问题 Ctrl+J」，
   * 点击左端或按 Ctrl+J 展开/收起（展开高 ~200px，内容区自己滚动）。
   * 内核只负责**机制**（尺寸、开合、快捷键、无障碍），条数由调用方给真实来源
   * （见 `shell/issues.tsx`：外部 provider 优先，回落 annotation store）。
   */
  bottomPanel?: {
    /** 问题条数（真实来源由调用方给出） */
    issueCount: number;
    /** 展开后的内容（问题清单列表等） */
    children?: React.ReactNode;
  };
}
