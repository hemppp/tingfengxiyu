// ============================================================
// Web 插件注册表（Zustand 驱动）—— 前端所有扩展点的聚合中心
//
// React 组件通过 hook 订阅注册表；插件 apply 时写入注册表；
// 任何注册/注销都会触发订阅组件重渲染（面板列表、命令列表、路由表）。
// ============================================================

import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';
import { pluginAppliesToProjectMode, type ProjectMode } from '@novel/core/web';
import { useProjectStore } from '../stores';
import type {
  FloatingPanelDef,
  CommandDef,
  PluginRouteDef,
  SettingsSectionDef,
  EditorExtensionDef,
  EditorToolbarItemDef,
  SelectionActionDef,
  ChatRailDef,
  WorkbenchDef,
  BuiltinPanelDef,
  WebCapabilityName,
  PluginMode,
} from './types';

export interface PluginRegistryState {
  /** 项目浮窗面板（按注册顺序） */
  projectPanels: FloatingPanelDef[];
  /** 命令（按注册顺序） */
  commands: CommandDef[];
  /** 顶级路由（按注册顺序） */
  routes: PluginRouteDef[];
  /** 设置页区块（按 order 升序，同 order 按注册顺序） */
  settingsSections: SettingsSectionDef[];
  /** 编辑器 Tiptap 扩展（按注册顺序） */
  editorExtensions: EditorExtensionDef[];
  /** 编辑器工具栏条目（按 order 升序） */
  editorToolbarItems: EditorToolbarItemDef[];
  /** 选区菜单动作（按 order 升序） */
  selectionActions: SelectionActionDef[];
  /** 技能图标映射（key = 技能 id；插件经 registerSkillIcons 注册） */
  skillIcons: Record<string, LucideIcon>;
  /** AI 聊天气泡栏（插件经 registerChatRail 接管；null = 走宿主内置兜底） */
  chatRail: ChatRailDef | null;
  /** 模块级工作台根组件（按模式单槽；经 registerWorkbench 注册） */
  workbenches: Record<string, WorkbenchDef>;
  /**
   * 内置面板槽（按 key 键控多槽；经 `registerBuiltinPanel` 注册）。
   *
   * ★ ADR D9/§3.3：原名 `builtinBubbles`。更名理由 —— 「bubble（气泡）」是本次
   *   重构**退役的 UI 形态词**，继续用它命名扩展点会让 t5 误以为要保留气泡。
   *   这些槽位本身作为**扩展点保留**（如 `'chapters'` → LeftSidebar）。
   */
  builtinPanels: BuiltinPanelDef[];
  /** 跨模块能力实现（name → impl；经 registerCapability 注册） */
  capabilities: Record<string, unknown>;

  /** 内部操作（插件宿主使用） */
  _registerProjectPanel(panel: FloatingPanelDef): () => void;
  _registerCommand(cmd: CommandDef): () => void;
  _registerRoute(def: PluginRouteDef): () => void;
  _registerSettingsSection(def: SettingsSectionDef): () => void;
  _registerEditorExtension(def: EditorExtensionDef): () => void;
  _registerEditorToolbarItem(def: EditorToolbarItemDef): () => void;
  _registerSelectionAction(def: SelectionActionDef): () => void;
  _registerSkillIcons(icons: Record<string, LucideIcon>): () => void;
  _registerChatRail(def: ChatRailDef): () => void;
  _registerWorkbench(def: WorkbenchDef): () => void;
  _registerBuiltinPanel(def: BuiltinPanelDef): () => void;
  /** @deprecated ADR D9：改用 `_registerBuiltinPanel` */
  _registerBuiltinBubble(def: BuiltinPanelDef): () => void;
  /**
   * 注册 AI 接口（跨模块能力）实现；name 取自 core 常量 `WEB_CAPABILITIES`。
   *
   * ★ 这是**两边模块都可引用的共享接口面**（「一个模块提供实现、另一个模块按名
   *   消费，缺席时静默降级」，见 `packages/core/src/manifest.ts` 的契约注释），
   *   因此**不**按插件模式 / 项目模式隔离 —— 模式隔离只作用于 UI 扩展点
   *   （projectPanels / builtinPanels / workbenches …）与模块间静态 import。
   */
  _registerCapability(name: string, impl: unknown): () => void;
  _reset(): void;
}

/** 全局单调递增序号：同 order 的条目按首次注册先后稳定排序 */
let seq = 0;

/** 注册表内部条目：插件条目 + 稳定排序键 */
interface Slot<T> {
  value: T;
  seq: number;
}

/** 每类扩展点的排序键记录：同 key 重复注册（HMR/重载）保持首次位置 */
type SeqMemo = Map<string, number>;

function seqFor(memo: SeqMemo, key: string): number {
  const existing = memo.get(key);
  if (existing !== undefined) return existing;
  const n = seq++;
  memo.set(key, n);
  return n;
}

/**
 * 有序注册：按 key 去重（同 key 覆盖且保持原位置），按 order 升序 + 注册序号稳定排序。
 *
 * ★ 卸载函数必须从**当前** state 重新读取列表再过滤 —— 早期实现闭包捕获了注册时刻的
 * 列表快照，卸载时用旧快照覆盖，会连带丢弃此后注册的所有条目。插件热禁用 / Vite HMR
 * 触发 DisposerBag 清理时必然踩到。
 */
function makeRegister<T>(
  memo: SeqMemo,
  keyOf: (v: T) => string,
  orderOf: (v: T) => number,
  read: () => Slot<T>[],
  write: (next: Slot<T>[]) => void,
) {
  return (value: T): (() => void) => {
    const key = keyOf(value);
    const slot: Slot<T> = { value, seq: seqFor(memo, key) };
    const current = read();
    const replaced = current.some((s) => keyOf(s.value) === key);
    const next = replaced
      ? current.map((s) => (keyOf(s.value) === key ? slot : s))
      : [...current, slot];
    write(sortSlots(next, orderOf));
    return () => {
      // 从最新 state 读取，只移除本条目（按 slot 引用）
      write(read().filter((s) => s !== slot));
    };
  };
}

function sortSlots<T>(slots: Slot<T>[], orderOf: (v: T) => number): Slot<T>[] {
  return [...slots].sort((a, b) => {
    const d = orderOf(a.value) - orderOf(b.value);
    return d !== 0 ? d : a.seq - b.seq;
  });
}

/** order 缺省值 0：未声明 order 的条目按注册先后排列（既有 12 个内置面板顺序不变） */
const DEFAULT_ORDER = 0;
const orderOfDef = (v: { order?: number }) => v.order ?? DEFAULT_ORDER;

const panelSeq: SeqMemo = new Map();
const cmdSeq: SeqMemo = new Map();
const routeSeq: SeqMemo = new Map();
const settingsSeq: SeqMemo = new Map();
const editorExtSeq: SeqMemo = new Map();
const toolbarSeq: SeqMemo = new Map();
const selectionSeq: SeqMemo = new Map();

// 各扩展点的 slot 列表（模块级，注册表本身是页面单例）。
// store 里只放派生出的纯值数组，组件订阅的引用只在真正变更时才变。
let panelSlots: Slot<FloatingPanelDef>[] = [];
let cmdSlots: Slot<CommandDef>[] = [];
let routeSlots: Slot<PluginRouteDef>[] = [];
let settingsSlots: Slot<SettingsSectionDef>[] = [];
let editorExtSlots: Slot<EditorExtensionDef>[] = [];
let toolbarSlots: Slot<EditorToolbarItemDef>[] = [];
let selectionSlots: Slot<SelectionActionDef>[] = [];

/** 技能图标合并 map（模块级单例；同 key 后注册覆盖） */
let skillIconMap: Record<string, LucideIcon> = {};

/** AI 聊天气泡栏（单槽：后注册覆盖前者，注销时回退内置） */
let chatRailDef: ChatRailDef | null = null;

/** 内核内置面板槽（按 key 键控多槽：chapters / ai-chat 等） */
let bubbleSlots: Slot<BuiltinPanelDef>[] = [];
const bubbleSeq: SeqMemo = new Map();

/** 模块级工作台（按模式单槽：'manual' | 'auto' | 'shared' → WorkbenchDef） */
let workbenchMap: Record<string, WorkbenchDef> = {};

/**
 * 跨模块能力实现（name → impl）——**AI 接口的共享面**。
 *
 * 语义依据 `packages/core/src/manifest.ts` 的 `WEB_CAPABILITIES` 契约：
 * 「一个模块提供实现、另一个模块按名消费，缺席时静默降级」，取代模块间静态 import。
 * 所以本表**不做模式隔离**：manual 与 auto 两边都可以注册与取用同一 AI 接口实现
 * （同名重复注册为「后写覆盖」，与其它全局槽一致，见 `makeRegister` 的 key 语义）。
 *
 * 必须严格隔离的是另外两层（不在此表）：
 *   · UI 扩展点 / 模块入口 —— 全部按 `modes` 过滤（见文件末尾 `filterByProjectMode`）
 *   · 模块之间的静态 import —— 由门禁 `scripts/verify/verify-workbench-isolation.mjs` 拦
 */
let capabilityMap: Record<string, unknown> = {};

export const usePluginRegistry = create<PluginRegistryState>((set) => ({
  projectPanels: [],
  commands: [],
  routes: [],
  settingsSections: [],
  editorExtensions: [],
  editorToolbarItems: [],
  selectionActions: [],
  skillIcons: {},
  chatRail: null,
  workbenches: {},
  builtinPanels: [],
  capabilities: {},

  _registerProjectPanel: makeRegister<FloatingPanelDef>(
    panelSeq,
    (p) => p.key,
    orderOfDef,
    () => panelSlots,
    (next) => { panelSlots = next; set({ projectPanels: next.map((s) => s.value) }); },
  ),

  _registerCommand: makeRegister<CommandDef>(
    cmdSeq,
    (c) => c.id,
    orderOfDef,
    () => cmdSlots,
    (next) => { cmdSlots = next; set({ commands: next.map((s) => s.value) }); },
  ),

  _registerRoute: makeRegister<PluginRouteDef>(
    routeSeq,
    (r) => r.path,
    orderOfDef,
    () => routeSlots,
    (next) => { routeSlots = next; set({ routes: next.map((s) => s.value) }); },
  ),

  _registerSettingsSection: makeRegister<SettingsSectionDef>(
    settingsSeq,
    (s) => s.key,
    orderOfDef,
    () => settingsSlots,
    (next) => { settingsSlots = next; set({ settingsSections: next.map((s) => s.value) }); },
  ),

  _registerEditorExtension: makeRegister<EditorExtensionDef>(
    editorExtSeq,
    (e) => e.key,
    orderOfDef,
    () => editorExtSlots,
    (next) => { editorExtSlots = next; set({ editorExtensions: next.map((s) => s.value) }); },
  ),

  _registerEditorToolbarItem: makeRegister<EditorToolbarItemDef>(
    toolbarSeq,
    (t) => t.key,
    orderOfDef,
    () => toolbarSlots,
    (next) => { toolbarSlots = next; set({ editorToolbarItems: next.map((s) => s.value) }); },
  ),

  _registerSelectionAction: makeRegister<SelectionActionDef>(
    selectionSeq,
    (a) => a.key,
    orderOfDef,
    () => selectionSlots,
    (next) => { selectionSlots = next; set({ selectionActions: next.map((s) => s.value) }); },
  ),

  _registerSkillIcons: (icons) => {
    skillIconMap = { ...skillIconMap, ...icons };
    set({ skillIcons: { ...skillIconMap } });
    return () => {
      for (const key of Object.keys(icons)) delete skillIconMap[key];
      set({ skillIcons: { ...skillIconMap } });
    };
  },

  _registerChatRail: (def) => {
    chatRailDef = def;
    set({ chatRail: def });
    return () => {
      if (chatRailDef === def) {
        chatRailDef = null;
        set({ chatRail: null });
      }
    };
  },

  _registerWorkbench: (def) => {
    // 按模式键控：每个 mode 一个槽位（同 mode 后注册覆盖前者）
    const modes = def.modes && def.modes.length ? def.modes : (['shared'] as PluginMode[]);
    for (const m of modes) workbenchMap = { ...workbenchMap, [m]: def };
    set({ workbenches: { ...workbenchMap } });
    return () => {
      for (const m of modes) {
        if (workbenchMap[m] === def) {
          const next = { ...workbenchMap };
          delete next[m];
          workbenchMap = next;
        }
      }
      set({ workbenches: { ...workbenchMap } });
    };
  },

  _registerBuiltinPanel: makeRegister<BuiltinPanelDef>(
    bubbleSeq,
    (b) => b.key,
    (b: BuiltinPanelDef) => b.order ?? DEFAULT_ORDER,
    () => bubbleSlots,
    (next) => { bubbleSlots = next; set({ builtinPanels: next.map((s) => s.value) }); },
  ),

  /** @deprecated ADR D9：改用 `_registerBuiltinPanel`。别名保证已发布插件不炸。 */
  _registerBuiltinBubble(def: BuiltinPanelDef): () => void {
    return usePluginRegistry.getState()._registerBuiltinPanel(def);
  },

  _registerCapability: (name, impl) => {
    capabilityMap = { ...capabilityMap, [name]: impl };
    set({ capabilities: { ...capabilityMap } });
    return () => {
      if (capabilityMap[name] === impl) {
        const next = { ...capabilityMap };
        delete next[name];
        capabilityMap = next;
        set({ capabilities: { ...capabilityMap } });
      }
    };
  },

  _reset: () => {
    panelSlots = [];
    cmdSlots = [];
    routeSlots = [];
    settingsSlots = [];
    editorExtSlots = [];
    toolbarSlots = [];
    selectionSlots = [];
    bubbleSlots = [];
    skillIconMap = {};
    chatRailDef = null;
    workbenchMap = {};
    capabilityMap = {};
    set({
      projectPanels: [],
      commands: [],
      routes: [],
      settingsSections: [],
      editorExtensions: [],
      editorToolbarItems: [],
      selectionActions: [],
      skillIcons: {},
      chatRail: null,
      workbenches: {},
      builtinPanels: [],
      capabilities: {},
    });
  },
}));

/** 插件宿主使用的注册入口 */
export const pluginRegistryApi = {
  registerProjectPanel: (panel: FloatingPanelDef) => usePluginRegistry.getState()._registerProjectPanel(panel),
  registerCommand: (cmd: CommandDef) => usePluginRegistry.getState()._registerCommand(cmd),
  registerRoute: (def: PluginRouteDef) => usePluginRegistry.getState()._registerRoute(def),
  registerSettingsSection: (def: SettingsSectionDef) => usePluginRegistry.getState()._registerSettingsSection(def),
  registerEditorExtension: (def: EditorExtensionDef) => usePluginRegistry.getState()._registerEditorExtension(def),
  registerEditorToolbarItem: (def: EditorToolbarItemDef) => usePluginRegistry.getState()._registerEditorToolbarItem(def),
  registerSelectionAction: (def: SelectionActionDef) => usePluginRegistry.getState()._registerSelectionAction(def),
  registerSkillIcons: (icons: Record<string, LucideIcon>) => usePluginRegistry.getState()._registerSkillIcons(icons),
  registerChatRail: (def: ChatRailDef) => usePluginRegistry.getState()._registerChatRail(def),
  registerWorkbench: (def: WorkbenchDef) => usePluginRegistry.getState()._registerWorkbench(def),
  /** 注册内核内置面板槽（ADR D9：原名 `registerBuiltinBubble`） */
  registerBuiltinPanel: (def: BuiltinPanelDef) => usePluginRegistry.getState()._registerBuiltinPanel(def),
  /** @deprecated ADR D9：改用 `registerBuiltinPanel` */
  registerBuiltinBubble: (def: BuiltinPanelDef) => usePluginRegistry.getState()._registerBuiltinPanel(def),
  registerCapability: (name: string, impl: unknown) =>
    usePluginRegistry.getState()._registerCapability(name, impl),
  /** 与导出函数 `getCapability` 同判据（AI 接口共享面，不做模式隔离） */
  getCapability: <T = unknown>(name: string): T | null => getCapability<T>(name as WebCapabilityName),
  reset: () => usePluginRegistry.getState()._reset(),
};

/** 非响应式读取：获取某模式的工作台定义（未注册返回 undefined） */
export function getWorkbenchForMode(mode: ProjectMode): WorkbenchDef | undefined {
  return workbenchMap[mode] ?? workbenchMap.shared;
}

/**
 * 非响应式读取：获取 AI 接口（跨模块能力）实现，未注册返回 null。
 *
 * ★ **共享面**：两个模块都可以提供与取用同一个 AI 接口实现，这里不做模式过滤
 *   （依据 `WEB_CAPABILITIES` 契约：一个模块提供实现、另一个模块按名消费）。
 *   消费点必须容忍 null（隐藏入口或走本地兜底，禁止 throw）。
 */
export function getCapability<T = unknown>(name: WebCapabilityName): T | null {
  return (capabilityMap[name] as T | undefined) ?? null;
}

// ============================================================
// 模式过滤（按当前项目创作模式筛注册表条目）
//
// 规则（与 core 的 pluginAppliesToProjectMode 一致）：
//   条目 modes 缺省/空 → 视为 ['shared'] → 两种模式都适用
//   含 'shared'        → 恒真
//   否则当且仅当包含 projectMode 时为真
// 即：manual 模式 → 命中 manual + shared；auto 模式 → 命中 auto + shared。
// ============================================================

/** 从项目对象取创作模式；缺省 manual（与 ProjectLayout 既有兜底一致） */
export function projectModeOf(project: { mode?: ProjectMode } | null | undefined): ProjectMode {
  return project?.mode ?? 'manual';
}

/** 当前项目创作模式（响应式；ProjectLayout 等消费点用它过滤注册表） */
export function useProjectMode(): ProjectMode {
  return useProjectStore((s) => projectModeOf(s.currentProject));
}

/** 判断单个条目是否适用于某项目模式（modes 缺省视为 shared） */
export function entryAppliesToProjectMode(
  entry: { modes?: PluginMode[] },
  projectMode: ProjectMode,
): boolean {
  return pluginAppliesToProjectMode(entry.modes, projectMode);
}

/**
 * 按项目模式过滤一组注册表条目。
 * 只做过滤，保持注册表的既有 order 排序与注册顺序不变。
 */
export function filterByProjectMode<T extends { modes?: PluginMode[] }>(
  items: T[],
  projectMode: ProjectMode,
): T[] {
  return items.filter((it) => entryAppliesToProjectMode(it, projectMode));
}
