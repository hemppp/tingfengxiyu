// ============================================================
// Web 插件注册表（Zustand 驱动）—— 前端所有扩展点的聚合中心
//
// React 组件通过 hook 订阅注册表；插件 apply 时写入注册表；
// 任何注册/注销都会触发订阅组件重渲染（面板列表、命令列表、路由表）。
// ============================================================

import { create } from 'zustand';
import type {
  FloatingPanelDef,
  CommandDef,
  PluginRouteDef,
  SettingsSectionDef,
  EditorExtensionDef,
  EditorToolbarItemDef,
  SelectionActionDef,
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

  /** 内部操作（插件宿主使用） */
  _registerProjectPanel(panel: FloatingPanelDef): () => void;
  _registerCommand(cmd: CommandDef): () => void;
  _registerRoute(def: PluginRouteDef): () => void;
  _registerSettingsSection(def: SettingsSectionDef): () => void;
  _registerEditorExtension(def: EditorExtensionDef): () => void;
  _registerEditorToolbarItem(def: EditorToolbarItemDef): () => void;
  _registerSelectionAction(def: SelectionActionDef): () => void;
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

export const usePluginRegistry = create<PluginRegistryState>((set) => ({
  projectPanels: [],
  commands: [],
  routes: [],
  settingsSections: [],
  editorExtensions: [],
  editorToolbarItems: [],
  selectionActions: [],

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

  _reset: () => {
    panelSlots = [];
    cmdSlots = [];
    routeSlots = [];
    settingsSlots = [];
    editorExtSlots = [];
    toolbarSlots = [];
    selectionSlots = [];
    set({
      projectPanels: [],
      commands: [],
      routes: [],
      settingsSections: [],
      editorExtensions: [],
      editorToolbarItems: [],
      selectionActions: [],
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
  reset: () => usePluginRegistry.getState()._reset(),
};
