// ============================================================
// Web 插件宿主 —— 挂载 Web 面插件（构建期清单驱动）
//
// 插件入口 = { name, apply(ctx) }，apply 里调用 ctx.register* 注册扩展点。
// 所有注册写入 Zustand 注册表，React 组件（面板宿主/命令面板/路由表）订阅渲染。
// 插件 apply 抛错只禁用该插件（log + 跳过），不拖垮 GUI。
// ============================================================

import { createPluginLogger, DisposerBag, EventBus, HookBus, type BasePluginContext } from '@novel/core/web';
import type { LucideIcon } from 'lucide-react';
import type { WebPluginContext, WebPluginModule, PluginMode } from './types';
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
} from './types';
import { pluginRegistryApi } from './registry';
import { registerSkillIcons as registerSharedSkillIcons } from '@novel-plugins/data-core';
import { getToken, getCurrentProjectId } from '../services/api/apiClient';

/**
 * 把宿主推导出的适用模式盖到插件注册的条目上。
 * 条目自身声明的 modes 优先（缺省时用宿主推导值）—— 保证「目录即事实来源」，
 * 同时允许条目级覆盖（例如同一插件内个别面板仅手写台可见）。
 */
function withModes<T extends { modes?: PluginMode[] }>(def: T, modes?: PluginMode[]): T {
  return { ...def, modes: def.modes ?? modes };
}

export function createWebPluginContext(id: string, modes?: PluginMode[]): WebPluginContext {
  const bag = new DisposerBag();
  // 上下文基础：events/hooks 为页面级单例（同宿主共享），config 为空
  const events = new EventBus();
  const hooks = new HookBus();
  const base: Pick<BasePluginContext, 'id' | 'config' | 'events' | 'hooks' | 'effect' | 'logger'> = {
    id,
    config: {},
    events,
    hooks,
    effect: (fn, label) => bag.add(fn, label),
    logger: createPluginLogger(id),
  };

  // ★ 带鉴权的 API fetch（C7）：自动附加 JWT Authorization + 当前项目 X-Project-Id 头。
  //   服务端 /api/plugins/* 默认要求登录（requireAuth），插件 Web 面必须走此封装而非裸 fetch。
  const api: WebPluginContext['api'] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const pid = getCurrentProjectId();
    if (pid) headers.set('X-Project-Id', pid);
    return fetch(path, { ...init, headers });
  };

  // ★ ADR D9 类型空档（本文件唯一的类型断言，附理由）：
  //   宿主运行时对象**同时**提供新名 `registerBuiltinPanel` 与 deprecated 别名
  //   `registerBuiltinBubble`，但 `WebPluginContext`（@novel/core，packages/ 不在本次
  //   改动范围）只声明了旧名 ⇒ 对象字面量直接写新名会被 TS2353 拒绝。
  //   故先把 ctx 断言成「含新名可选成员」的交叉类型再赋值；断言在**运行时是恒真**的
  //   （下方对象确实带了该键），且退场条件明确：@novel/core 补上新名后删掉本断言。
  type CtxWithNewName = WebPluginContext & {
    registerBuiltinPanel?: (def: BuiltinPanelDef) => () => void;
  };
  const ctx = {
    ...base,
    api,
    registerProjectPanel: (panel) => {
      // core 契约的 panel（icon/Component 为 unknown）→ 本地具体类型
      const concrete = withModes(panel as unknown as FloatingPanelDef, modes);
      const unregister = pluginRegistryApi.registerProjectPanel(concrete);
      bag.add(unregister, `${id}: panel ${panel.key}`);
      return unregister;
    },
    registerCommand: (cmd) => {
      const unregister = pluginRegistryApi.registerCommand(withModes(cmd as CommandDef, modes));
      bag.add(unregister, `${id}: command ${cmd.id}`);
      return unregister;
    },
    registerRoute: (def) => {
      const unregister = pluginRegistryApi.registerRoute(withModes(def as PluginRouteDef, modes));
      bag.add(unregister, `${id}: route ${def.path}`);
      return unregister;
    },
    registerSettingsSection: (def) => {
      const unregister = pluginRegistryApi.registerSettingsSection(withModes(def as unknown as SettingsSectionDef, modes));
      bag.add(unregister, `${id}: settings ${def.key}`);
      return unregister;
    },
    registerEditorExtension: (def) => {
      const unregister = pluginRegistryApi.registerEditorExtension(withModes(def as unknown as EditorExtensionDef, modes));
      bag.add(unregister, `${id}: editor-ext ${def.key}`);
      return unregister;
    },
    registerEditorToolbarItem: (def) => {
      const unregister = pluginRegistryApi.registerEditorToolbarItem(withModes(def as unknown as EditorToolbarItemDef, modes));
      bag.add(unregister, `${id}: toolbar ${def.key}`);
      return unregister;
    },
    registerSelectionAction: (def) => {
      const unregister = pluginRegistryApi.registerSelectionAction(withModes(def as unknown as SelectionActionDef, modes));
      bag.add(unregister, `${id}: selection ${def.key}`);
      return unregister;
    },
    registerSkillIcons: (icons) => {
      const unregister = pluginRegistryApi.registerSkillIcons(icons as Record<string, LucideIcon>);
      bag.add(unregister, `${id}: skill-icons`);
      // ★ D46：图标表同时推入 shared 的 data-core 技能注册表（方向恒为 kernel → shared）。
      //   技能列表与图标解析已下沉 shared（供 auto 模块与 novel.autowrite 共用），
      //   shared 不得反向依赖 kernel registry，故由宿主主动转发。
      const unregisterShared = registerSharedSkillIcons(icons as Record<string, LucideIcon>);
      bag.add(unregisterShared, `${id}: skill-icons(shared)`);
      return unregister;
    },
    registerChatRail: (def) => {
      const unregister = pluginRegistryApi.registerChatRail(withModes(def as unknown as ChatRailDef, modes));
      bag.add(unregister, `${id}: chat-rail ${def.key}`);
      return unregister;
    },
    registerWorkbench: (def) => {
      const concrete = withModes(def as unknown as WorkbenchDef, modes);
      const unregister = pluginRegistryApi.registerWorkbench(concrete);
      bag.add(unregister, `${id}: workbench ${def.key}`);
      return unregister;
    },
    // ADR D9：扩展点更名 registerBuiltinBubble → registerBuiltinPanel。
    //   `registerBuiltinPanel` 是**新名（契约推荐名）**，本宿主对象直接实现它。
    //   `registerBuiltinBubble` 保留为 **deprecated 别名**（同落点），
    //   保证已发布插件 / AI 生成的落盘插件继续可用。
    registerBuiltinPanel: (def) => {
      const concrete = withModes(def as unknown as BuiltinPanelDef, modes);
      const unregister = pluginRegistryApi.registerBuiltinPanel(concrete);
      bag.add(unregister, `${id}: builtin-panel ${def.key}`);
      return unregister;
    },
    /** @deprecated ADR D9：改用 `registerBuiltinPanel`。别名保证已发布插件不炸。 */
    registerBuiltinBubble: (def) => {
      const unregister = pluginRegistryApi.registerBuiltinPanel(
        withModes(def as unknown as BuiltinPanelDef, modes),
      );
      bag.add(unregister, `${id}: builtin-panel ${def.key}`);
      return unregister;
    },
    registerCapability: (name, impl) => {
      // ★ AI 接口是**两边模块都可引用的共享面**（core 契约：一个模块提供实现、
      //   另一个模块按名消费，缺席时静默降级），故这里**不**盖宿主模式；
      //   模式隔离只作用于 UI 扩展点与模块间静态 import。
      const unregister = pluginRegistryApi.registerCapability(name as WebCapabilityName, impl);
      bag.add(unregister, `${id}: capability ${name}`);
      return unregister;
    },
    getCapability: <T = unknown>(name: WebCapabilityName): T | null =>
      pluginRegistryApi.getCapability<T>(name),
  } satisfies CtxWithNewName;
  return ctx;
}

/**
 * ADR D9 契约层垫片：**以新名为首选**拿到内置面板注册入口。
 *
 * 为什么需要它：宿主对象（上方 `ctx`）已同时实现 `registerBuiltinPanel`（新名）
 * 与 `registerBuiltinBubble`（deprecated 别名），但**编译期类型**来自
 * `@novel/core` 的 `WebPluginContext`，而该接口目前只声明了旧名
 * （`packages/` 不是本任务 inScope）。于是「运行时新名可用」与「类型上只有旧名」
 * 出现空档，插件侧直接写 `ctx.registerBuiltinPanel(...)` 会被 TS 拒绝。
 *
 * 本垫片按 **新名优先、旧名兜底** 解析 —— 新名一旦在 `@novel/core` 落地，
 * 这里无需改动即自动切到新名；`packages/core` 补齐后本函数可直接删除，
 * 调用点改回 `ctx.registerBuiltinPanel(...)`。
 *
 * ```ts
 * registerBuiltinPanelAsContext(ctx, { key: 'chapters', Component: LeftSidebar });
 * ```
 */
export function registerBuiltinPanelAsContext(
  ctx: WebPluginContext,
  def: BuiltinPanelDef,
): () => void {
  const c = ctx as WebPluginContext & {
    registerBuiltinPanel?: (d: BuiltinPanelDef) => () => void;
  };
  const register = c.registerBuiltinPanel ?? ctx.registerBuiltinBubble;
  return register(def as never);
}

export interface WebPluginLoadResult {
  id: string;
  status: 'ok' | 'error';
  error?: string;
}

/**
 * 挂载一个 Web 面插件模块。
 * @param id 插件 id
 * @param load 模块加载器（构建期静态 import 的封装）
 * @param modes 该插件适用的创作模式（由父目录名推导）；缺省/空 → shared（两种模式都适用）
 */
export async function mountWebPlugin(
  id: string,
  load: () => Promise<WebPluginModule>,
  modes?: PluginMode[],
): Promise<WebPluginLoadResult> {
  const ctx = createWebPluginContext(id, modes);
  try {
    const mod = await load();
    if (typeof mod.apply !== 'function') {
      throw new Error('插件模块缺少 apply() 导出');
    }
    await mod.apply(ctx);
    console.debug(`[plugin:${id}] Web 面已挂载${modes ? `（modes: ${modes.join(',')}）` : ''}`);
    return { id, status: 'ok' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugin:${id}] Web 面挂载失败（已隔离）:`, msg);
    return { id, status: 'error', error: msg };
  }
}

/** 构建期插件清单条目：id + 加载器 + 适用模式（由父目录名推导） */
export interface WebPluginEntry {
  id: string;
  load: () => Promise<WebPluginModule>;
  modes?: PluginMode[];
}

/**
 * 批量挂载 Web 面插件（构建期清单）。
 * 返回结果数组；失败插件不影响其他插件。
 */
export async function mountWebPlugins(entries: WebPluginEntry[]): Promise<WebPluginLoadResult[]> {
  const results: WebPluginLoadResult[] = [];
  for (const entry of entries) {
    results.push(await mountWebPlugin(entry.id, entry.load, entry.modes));
  }
  return results;
}
