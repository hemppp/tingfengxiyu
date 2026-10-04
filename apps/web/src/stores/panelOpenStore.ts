// ============================================================
// 面板导航状态 —— 停靠系统（dockview）下的「打开 / 聚焦 / 关闭」唯一真源
//
// 契约真源：docs/architecture/dock-protocol-adr.md
//   §2.3.1  PanelNavigation 接口 + getPanelNavigation() 命令式单例（冻结）
//   §2.3.2  'nm:open-panel' 事件桥迁移（保留监听、回调体改调命令式入口、排队回放）
//   §4.2    MAX_OPEN_PANELS **删除**：无限打开，容量由 dockview 布局承担
//   §4.3    迁移动作清单（1–5）
//
// ## 双入口（ADR §2.3.1 冻结理由）
//   · React 组件 → `usePanelOpenStore(selector)`（zustand hook，订阅式）
//   · 非 React   → `getPanelNavigation()`（命令式单例）
//   'nm:open-panel' 的 5 个派发点**全部**在非 React 上下文（插件 apply(ctx) 的 run
//   回调、Tiptap 扩展工厂、DOM 事件回调），只暴露 hook 会逼它们再发明一套事件，
//   故命令式入口是硬需求。
//
// ## 与 DockShell 的关系（ADR §2.4）
//   `PanelNavigation`（store 层，稳定，插件可见）
//     → 内部转发到 `DockShellApi`（视图层，dockview 绑定）
//
//   DockShell 未挂载时（例如书架页、或在插件 apply(ctx) 阶段调用），
//   `open()` **必须静默排队**、不得抛错，挂载后回放。
//
// ## 无上限
//   打开第 N 个面板**永不关闭**任何已打开面板；可见性由 dockview 的
//   标签堆叠 / 停靠区分割 / 悬浮组承担。`opened()` 仍返回**打开顺序**，
//   作为 DockShell 首次构建布局与「最近使用」排序的输入，但顺序不再触发淘汰。
// ============================================================

import { create } from 'zustand';

/**
 * 打开状态的形状。
 *
 * `keys` 与 `activeKey` **分离**（ADR §4.3-4）：
 * 在 dockview 里「一个面板被打开」与「一个面板被聚焦」是两个独立维度 ——
 * 多标签堆叠时可以有 N 个打开但只有 1 个聚焦。
 */
export interface PanelOpenState {
  /** 已打开的 key（按打开顺序；**无上限**，见 ADR §4.2） */
  keys: string[];
  /** 当前聚焦（dockview active panel）的 key；无则 null */
  activeKey: string | null;
  /** 打开或聚焦面板。已打开 ⇒ 只聚焦（不新增、不重排、不关闭任何面板） */
  open: (key: string) => void;
  /** 已打开则聚焦，未打开则打开。语义等同 `open`（保留旧名仅为对称，ADR §2.3.1） */
  focus: (key: string) => void;
  /** 切换：未打开 → 打开；已打开 → 关闭 */
  toggle: (key: string) => void;
  /** 关闭。不存在则 no-op */
  close: (key: string) => void;
  /** 关闭全部；`opts.except` 内的 key 保留 */
  closeAll: (opts?: { except?: string[] }) => void;
  /** 当前已打开 key（打开顺序） */
  opened: () => string[];
  /** 当前聚焦 key，无则 null */
  active: () => string | null;
  /**
   * 聚焦态由**视图层**（DockShell / dockview）回写。
   * 不是公开契约的一部分，命名带 `_` 前缀与其它内部操作一致。
   */
  _setActive: (key: string | null) => void;
  /**
   * 视图层（DockShell 的用户交互：点标签 × 、拖走、关闭组）回写打开集合。
   * activeKey 只在它仍存在于新集合中时保留。
   */
  _syncFromView: (keys: string[]) => void;
}

// ---- 视图层桥接（模块级单例；不放进 store state，避免每次渲染换引用） ----

/** 视图层「打开/聚焦」执行器：由 DockShell 挂载时注册，卸载时注销。 */
let viewOpen: ((key: string) => void) | null = null;

/**
 * 视图层「整集合覆写」执行器（关闭 / closeAll 这类**减少**操作无法表示为
 * 单个 open 调用，只能把闭包结果推过去）。
 */
let viewSync: ((keys: string[]) => void) | null = null;

/** DockShell 未挂载期间收到的打开请求（静默排队，ADR §2.4） */
const pendingOpens: string[] = [];

/** 同一 key 重复排队只保留一次，且保持首次排队顺序 */
function enqueueOpen(key: string): void {
  if (!pendingOpens.includes(key)) pendingOpens.push(key);
}

/**
 * §2.4 冻结：DockShell 挂载时注册执行器 → 立刻**回放**排队请求
 * （插件 `apply(ctx)` 里调 `open()` 时 shell 还没挂上，不能丢）。
 */
export function registerPanelViewOpener(fn: (key: string) => void): () => void {
  viewOpen = fn;
  if (pendingOpens.length) {
    const replay = pendingOpens.splice(0, pendingOpens.length);
    for (const k of replay) fn(k);
  }
  return () => {
    if (viewOpen === fn) viewOpen = null;
  };
}

/**
 * 当前是否已挂载视图层。
 * 诊断 / 测试用；产品代码读它没用（排队是透明的）。
 */
export function hasPanelView(): boolean {
  return viewOpen !== null;
}

/** 未回放的排队请求（只读快照，测试用） */
export function pendingPanelOpens(): readonly string[] {
  return pendingOpens;
}

/** 打开**或聚焦**：视图层可用就直接执行，否则排队 */
function openOrFocus(key: string): void {
  if (viewOpen) viewOpen(key);
  else enqueueOpen(key);
}

/** 关闭 / 批量关闭：视图层可用就推集合；缺席时 store 已是真源，下次挂载自然对齐 */
function pushKeysToView(): void {
  viewSync?.(usePanelOpenStore.getState().keys);
}

/** DockShell 注册「集合同步」回调（关闭路径用；打开路径走 openOrFocus）。 */
export function registerPanelViewSync(fn: ((keys: string[]) => void) | null): void {
  viewSync = fn;
}

export const usePanelOpenStore = create<PanelOpenState>((set, get) => ({
  keys: [],
  activeKey: null,

  // ADR §4.3-2：已打开 ⇒ 只更新焦点；否则 concat，**不做任何截断**
  open: (key) =>
    set((state) => {
      if (state.keys.includes(key)) return { activeKey: key };
      return { keys: state.keys.concat(key), activeKey: key };
    }),

  // ADR §2.3.1：语义等同 open（保留旧名仅为对称）
  focus: (key) => get().open(key),

  // ADR §4.3-3：已存在 → 关闭；不存在 → concat，**不做任何截断**
  toggle: (key) =>
    set((state) => {
      if (state.keys.includes(key)) {
        return {
          keys: state.keys.filter((k) => k !== key),
          activeKey: state.activeKey === key ? null : state.activeKey,
        };
      }
      return { keys: state.keys.concat(key), activeKey: key };
    }),

  close: (key) =>
    set((state) => ({
      keys: state.keys.filter((k) => k !== key),
      activeKey: state.activeKey === key ? null : state.activeKey,
    })),

  closeAll: (opts) =>
    set((state) => {
      const except = opts?.except;
      if (!except || except.length === 0) {
        return { keys: [], activeKey: null };
      }
      const kept = state.keys.filter((k) => except.includes(k));
      return { keys: kept, activeKey: kept.includes(state.activeKey ?? '') ? state.activeKey : null };
    }),

  opened: () => get().keys,
  active: () => get().activeKey,

  _setActive: (key) => set({ activeKey: key }),

  _syncFromView: (keys) =>
    set((state) => ({
      keys,
      activeKey: state.activeKey && keys.includes(state.activeKey) ? state.activeKey : null,
    })),
}));

/**
 * §2.3.1 冻结：面板导航句柄（命令式，非 React 组件可直接调用）。
 * 与 `DockShellApi`（§2.4）是同一套能力的两层视图。
 */
export interface PanelNavigation {
  /** 打开或聚焦面板。已存在则只聚焦（ADR §4.2 缺省 allowMultiple=false） */
  open(key: string): void;
  /** 已打开则聚焦，未打开则打开（语义等同 open —— 保留旧名仅为对称） */
  focus(key: string): void;
  /** 切换：未打开→打开，已打开→关闭 */
  toggle(key: string): void;
  /** 关闭。不存在则 no-op */
  close(key: string): void;
  /** 关闭全部；opts.except 内的 key 保留 */
  closeAll(opts?: { except?: string[] }): void;
  /** 当前已打开 key（打开顺序，**不再有上限**） */
  opened(): string[];
  /** 当前聚焦 key（dockview active panel），无则 null */
  active(): string | null;
}

/**
 * ★ 冻结：命令式单例入口（非 React 环境唯一可用入口）。
 *
 * 派发 `'nm:open-panel'` 的 5 个调用点（ADR §2.1）全部是非 React 上下文，
 * 它们**不需要**改；事件桥的回调体会转发到这里。
 */
export function getPanelNavigation(): PanelNavigation {
  const s = () => usePanelOpenStore.getState();
  return {
    open: (key) => {
      s().open(key);
      openOrFocus(key);
    },
    focus: (key) => {
      s().focus(key);
      openOrFocus(key);
    },
    toggle: (key) => {
      // 先读旧态判定方向：toggle 的语义依赖「当前是否已打开」
      const wasOpen = s().keys.includes(key);
      s().toggle(key);
      if (wasOpen) pushKeysToView();
      else openOrFocus(key);
    },
    close: (key) => {
      s().close(key);
      pushKeysToView();
    },
    closeAll: (opts) => {
      s().closeAll(opts);
      pushKeysToView();
    },
    opened: () => s().opened(),
    active: () => s().active(),
  };
}

/**
 * §2.3.3（ADR 注：便利项，非验收项）：命令式「打开设置页」。
 *
 * **刻意不在此落地** —— 本 store 属数据层，`PATHS` / `navigate` 属路由层，
 * 在此 import 会让 store 依赖 react-router，违反分层。
 * 因此 `'nm:open-settings'` 事件（由 ProjectLayout 监听并 `navigate(PATHS.settings)`）
 * 仍是插件触达设置页的**唯一路径**，长期保留（ADR D7）。
 */

// ---- 调试辅助（非契约） ----------------------------------------------------

/** 重置 store 与视图层桥接（测试用） */
export function _resetPanelOpenStore(): void {
  usePanelOpenStore.setState({ keys: [], activeKey: null });
  pendingOpens.length = 0;
  viewOpen = null;
  viewSync = null;
}
