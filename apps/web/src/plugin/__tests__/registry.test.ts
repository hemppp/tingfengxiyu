// ============================================================
// Web 插件注册表单测
//
// 重点覆盖卸载语义：早期实现的卸载闭包捕获注册时刻的列表快照，
// 卸载任意早期条目会连带丢弃此后注册的所有条目（插件热禁用 / HMR 必踩）。
// 这里的「卸载中间条目不影响其他条目」用例就是那个回归的护栏。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePluginRegistry,
  pluginRegistryApi,
  filterByProjectMode,
  entryAppliesToProjectMode,
  projectModeOf,
} from '../registry';
import { createWebPluginContext } from '../host';
import type { FloatingPanelDef, SettingsSectionDef, PluginMode } from '../types';

const Dummy = () => null;

function panel(key: string, order?: number, modes?: PluginMode[]): FloatingPanelDef {
  return {
    key,
    label: key,
    icon: (() => null) as unknown as FloatingPanelDef['icon'],
    Component: Dummy,
    ...(order === undefined ? {} : { order }),
    ...(modes === undefined ? {} : { modes }),
  };
}

function section(key: string, category?: SettingsSectionDef['category'], order?: number): SettingsSectionDef {
  return {
    key,
    title: key,
    Component: Dummy,
    ...(category ? { category } : {}),
    ...(order === undefined ? {} : { order }),
  };
}

const panelKeys = () => usePluginRegistry.getState().projectPanels.map((p) => p.key);

describe('pluginRegistry', () => {
  beforeEach(() => {
    pluginRegistryApi.reset();
  });

  it('按注册顺序累积面板', () => {
    pluginRegistryApi.registerProjectPanel(panel('a'));
    pluginRegistryApi.registerProjectPanel(panel('b'));
    pluginRegistryApi.registerProjectPanel(panel('c'));
    expect(panelKeys()).toEqual(['a', 'b', 'c']);
  });

  it('卸载中间条目不影响此前/此后注册的条目（回归：闭包快照 bug）', () => {
    pluginRegistryApi.registerProjectPanel(panel('a'));
    const offB = pluginRegistryApi.registerProjectPanel(panel('b'));
    pluginRegistryApi.registerProjectPanel(panel('c'));
    pluginRegistryApi.registerProjectPanel(panel('d'));

    offB();

    expect(panelKeys()).toEqual(['a', 'c', 'd']);
  });

  it('卸载最早注册的条目不会清空后续条目（回归：闭包快照 bug）', () => {
    const offA = pluginRegistryApi.registerProjectPanel(panel('a'));
    pluginRegistryApi.registerProjectPanel(panel('b'));
    pluginRegistryApi.registerProjectPanel(panel('c'));

    offA();

    expect(panelKeys()).toEqual(['b', 'c']);
  });

  it('逆序全部卸载后注册表为空', () => {
    const offs = ['a', 'b', 'c'].map((k) => pluginRegistryApi.registerProjectPanel(panel(k)));
    for (const off of offs.reverse()) off();
    expect(panelKeys()).toEqual([]);
  });

  it('卸载函数重复调用是幂等的', () => {
    pluginRegistryApi.registerProjectPanel(panel('a'));
    const off = pluginRegistryApi.registerProjectPanel(panel('b'));
    off();
    off();
    expect(panelKeys()).toEqual(['a']);
  });

  it('同 key 重复注册覆盖内容并保持原位置', () => {
    pluginRegistryApi.registerProjectPanel(panel('a'));
    pluginRegistryApi.registerProjectPanel(panel('b'));
    pluginRegistryApi.registerProjectPanel(panel('c'));

    pluginRegistryApi.registerProjectPanel({ ...panel('b'), label: '改名后的 b' });

    expect(panelKeys()).toEqual(['a', 'b', 'c']);
    const b = usePluginRegistry.getState().projectPanels.find((p) => p.key === 'b');
    expect(b?.label).toBe('改名后的 b');
  });

  it('order 升序排序，同 order 按注册先后', () => {
    pluginRegistryApi.registerProjectPanel(panel('late', 10));
    pluginRegistryApi.registerProjectPanel(panel('early', -5));
    pluginRegistryApi.registerProjectPanel(panel('mid1'));
    pluginRegistryApi.registerProjectPanel(panel('mid2'));

    expect(panelKeys()).toEqual(['early', 'mid1', 'mid2', 'late']);
  });

  it('各扩展点互相独立：卸载面板不动设置区', () => {
    const offPanel = pluginRegistryApi.registerProjectPanel(panel('a'));
    pluginRegistryApi.registerSettingsSection(section('s1', 'general'));
    pluginRegistryApi.registerSettingsSection(section('s2'));

    offPanel();

    expect(panelKeys()).toEqual([]);
    expect(usePluginRegistry.getState().settingsSections.map((s) => s.key)).toEqual(['s1', 's2']);
  });

  it('reset 清空所有扩展点', () => {
    pluginRegistryApi.registerProjectPanel(panel('a'));
    pluginRegistryApi.registerSettingsSection(section('s1'));
    pluginRegistryApi.registerCommand({ id: 'cmd', title: 'cmd', run: () => {} });
    pluginRegistryApi.registerSelectionAction({ key: 'sel', label: 'sel', run: () => {} });
    pluginRegistryApi.registerEditorToolbarItem({ key: 'tb', label: 'tb', run: () => {} });
    pluginRegistryApi.registerEditorExtension({ key: 'ext', create: () => ({}) as never });

    pluginRegistryApi.reset();

    const s = usePluginRegistry.getState();
    expect(s.projectPanels).toEqual([]);
    expect(s.settingsSections).toEqual([]);
    expect(s.commands).toEqual([]);
    expect(s.selectionActions).toEqual([]);
    expect(s.editorToolbarItems).toEqual([]);
    expect(s.editorExtensions).toEqual([]);
  });

  it('reset 后仍可正常注册（内部 slot 列表已清空）', () => {
    pluginRegistryApi.registerProjectPanel(panel('a'));
    pluginRegistryApi.reset();
    pluginRegistryApi.registerProjectPanel(panel('b'));
    expect(panelKeys()).toEqual(['b']);
  });
});

describe('按项目模式过滤注册表', () => {
  beforeEach(() => {
    pluginRegistryApi.reset();
  });

  it('manual 模式命中 manual + shared；auto 模式命中 auto + shared', () => {
    const items = [panel('m', undefined, ['manual']), panel('a', undefined, ['auto']), panel('s', undefined, ['shared'])];
    expect(filterByProjectMode(items, 'manual').map((p) => p.key)).toEqual(['m', 's']);
    expect(filterByProjectMode(items, 'auto').map((p) => p.key)).toEqual(['a', 's']);
  });

  it('modes 缺省 / 空数组 → 视为 shared（两种模式都命中）', () => {
    expect(entryAppliesToProjectMode({}, 'manual')).toBe(true);
    expect(entryAppliesToProjectMode({ modes: [] }, 'auto')).toBe(true);
    expect(filterByProjectMode([panel('x')], 'auto').map((p) => p.key)).toEqual(['x']);
  });

  it('过滤只做筛选，保持注册表的 order 排序', () => {
    pluginRegistryApi.registerProjectPanel(panel('late', 10, ['shared']));
    pluginRegistryApi.registerProjectPanel(panel('early', -5, ['manual']));
    pluginRegistryApi.registerProjectPanel(panel('autoOnly', 1, ['auto']));
    const filtered = filterByProjectMode(usePluginRegistry.getState().projectPanels, 'manual');
    expect(filtered.map((p) => p.key)).toEqual(['early', 'late']);
  });

  it('projectModeOf 缺省回退 manual', () => {
    expect(projectModeOf(null)).toBe('manual');
    expect(projectModeOf({})).toBe('manual');
    expect(projectModeOf({ mode: 'auto' })).toBe('auto');
  });

  it('宿主把推导出的 modes 盖到插件注册的每个条目上', () => {
    const ctx = createWebPluginContext('demo.plugin', ['manual']);
    ctx.registerProjectPanel(panel('p1'));
    ctx.registerCommand({ id: 'c1', title: 'c1', run: () => {} });
    ctx.registerSelectionAction({ key: 's1', label: 's1', run: () => {} });

    const state = usePluginRegistry.getState();
    expect(state.projectPanels.find((p) => p.key === 'p1')?.modes).toEqual(['manual']);
    expect(state.commands.find((c) => c.id === 'c1')?.modes).toEqual(['manual']);
    expect(state.selectionActions.find((a) => a.key === 's1')?.modes).toEqual(['manual']);
  });

  it('条目自身声明的 modes 优先于宿主推导值（支持条目级覆盖）', () => {
    const ctx = createWebPluginContext('demo.plugin', ['auto']);
    ctx.registerProjectPanel(panel('override', undefined, ['shared']));
    expect(usePluginRegistry.getState().projectPanels.find((p) => p.key === 'override')?.modes).toEqual(['shared']);
  });
});
