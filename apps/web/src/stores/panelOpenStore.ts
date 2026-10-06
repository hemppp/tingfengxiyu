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

// ---- ★ t4 集成：首屏「默认打开集合」种子 -------------------------------------
//
// 为什么需要它（跨区契约，t1 DockShell ↔ t4 接线）：
//   DockShell 的 `dock.defaultOpen` 只在**非受控**模式生效（DockShell.tsx:291-295
//   `openKeys ? openKeys : panels.filter(d => resolveDockMeta(d).defaultOpen)`），
//   而 ProjectLayout.tsx:153 恒以受控 `openKeys={openPanelKeys}` 传入 —— 首屏
//   `keys: []` 会让目标截图里的三栏（章节树 + 正文 + AI 对话）全部缺席。
//   真值来源只能是这里（store 是打开集合的唯一真源），所以种子落在此文件。

/**
 * ★ t4 新增：各项目模式的**首屏默认打开集合**。
 * 只列「目标截图里一打开就该在位」的面板；其余面板仍由用户/命令式入口打开。
 */
export const DEFAULT_OPEN_PANEL_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  manual: Object.freeze(['chapters', 'ai-chat']),
  auto: Object.freeze([]),
});

/** 本会话是否已经播过种（诊断 / 测试用） */
let seeded = false;

/**
 * ★ t4 集成：**尚未被视图确认**的种子 key。
 *
 * 为什么需要（冷启动实测踩到的真问题）：DockShell 在 `onReady` / `addPanel` /
 * `removePanel` 时用「视图实际面板集合」回写宿主（`emitOpenChange` → `onOpenChange`
 * → `_syncFromView`），而 `_syncFromView` 是**整集合覆写**。插件面板是异步注册的
 * （manual 插件模块图大于 auto，其 `def` 晚到），于是冷启动会出现这样的交错：
 *
 *   1. 播种 → store.keys = ['chapters','ai-chat']
 *   2. auto 的 ai-chat def 先到位 → 受控 effect 加面板 → dockview **异步**派发
 *      `onDidAddPanel`（微任务）
 *   3. 微任务落地**之前** manual 的 chapters def 也到位了
 *   4. 微任务才执行 → 上报集合 = 视图实际 = ['ai-chat'] → store 丢掉 'chapters'
 *      → 受控 effect 之后只看到 ['ai-chat']，**左栏永久缺席**（实测 groups 只剩
 *      编辑区 + AI 对话，`openStore.keys=['ai-chat']`）
 *
 * 修法：宿主只把「视图确认过」的种子 key 视为已交付；未被确认的种子 key 在回写时
 * 合并回去（有窗口上限，避免 def 永不出现时留下幽灵 key）。视图一旦上报包含它，
 * 即确认交付，此后用户手动关闭能正常上报消失（不会再被拉开）。
 */
let seedUnconfirmed: string[] = [];
let seedDeadline = 0;

/** 种子合并窗口：足够覆盖插件异步注册 + 首次布局的抖动 */
const SEED_MERGE_WINDOW_MS = 15000;

export function hasSeededPanelOpenKeys(): boolean {
  return seeded;
}

/**
 * ★ t4 新增：幂等地把 `keys` 播进「已打开集合」并请求视图层打开。
 *
 * · 只播一次（`seeded`）：用户手动关掉面板后不再被重新拉开；
 * · 合并而非覆写已存 keys（deep-link / 插件提前 open 的请求不丢）；
 * · 视图层未挂载时 `openOrFocus` 走既有的 pendingOpens 队列，挂载后回放；
 * · 未被视图确认前由 `_syncFromView` 兜住（见 `seedUnconfirmed` 注释）。
 *
 * @returns 是否真的执行了播种（`false` = 已播过 / 无 key 可播）
 */
export function seedPanelOpenKeys(keys: readonly string[] | null | undefined): boolean {
  if (seeded) return false;
  seeded = true;
  if (!keys || keys.length === 0) return false;
  const wanted = keys.filter((k, i) => keys.indexOf(k) === i);
  const opened = usePanelOpenStore.getState().keys;
  const missing = wanted.filter((k) => !opened.includes(k));
  seedUnconfirmed = wanted.slice();
  seedDeadline = Date.now() + SEED_MERGE_WINDOW_MS;
  if (missing.length) {
    usePanelOpenStore.setState({ keys: opened.concat(missing) });
    for (const key of missing) openOrFocus(key);
  }
  return true;
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

  _syncFromView: (keys) => {
    // ★ t4 集成：把「视图尚未确认交付」的种子 key 合并回去（详见 seedUnconfirmed 注释）。
    //   确认 = 视图至少上报过一次包含该 key 的集合；确认后不再兜（用户关闭能被正常上报）。
    let next = keys;
    if (seedUnconfirmed.length) {
      const reported = new Set(keys);
      seedUnconfirmed = seedUnconfirmed.filter((k) => !reported.has(k));
      if (seedUnconfirmed.length && Date.now() < seedDeadline) {
        next = keys.concat(seedUnconfirmed.filter((k) => !reported.has(k)));
      } else if (Date.now() >= seedDeadline) {
        seedUnconfirmed = [];
      }
    }
    set((state) => ({
      keys: next,
      activeKey: state.activeKey && next.includes(state.activeKey) ? state.activeKey : null,
    }));
  },
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
  seeded = false;
  seedUnconfirmed = [];
  seedDeadline = 0;
}
