// ============================================================
// Web 插件宿主 —— 挂载 Web 面插件（构建期清单驱动）
//
// 插件入口 = { name, apply(ctx) }，apply 里调用 ctx.register* 注册扩展点。
// 所有注册写入 Zustand 注册表，React 组件（面板宿主/命令面板/路由表）订阅渲染。
// 插件 apply 抛错只禁用该插件（log + 跳过），不拖垮 GUI。
// ============================================================

import { createPluginLogger, DisposerBag, EventBus, HookBus, type BasePluginContext } from '@novel/core/web';
import type { WebPluginContext, WebPluginModule } from './types';
import type {
  FloatingPanelDef,
  CommandDef,
  PluginRouteDef,
  SettingsSectionDef,
  EditorExtensionDef,
  EditorToolbarItemDef,
  SelectionActionDef,
} from './types';
import { pluginRegistryApi } from './registry';
import { getToken, getCurrentProjectId } from '../services/api/apiClient';

export function createWebPluginContext(id: string): WebPluginContext {
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

  const ctx: WebPluginContext = {
    ...base,
    api,
    registerProjectPanel: (panel) => {
      // core 契约的 panel（icon/Component 为 unknown）→ 本地具体类型
      const concrete = panel as unknown as FloatingPanelDef;
      const unregister = pluginRegistryApi.registerProjectPanel(concrete);
      bag.add(unregister, `${id}: panel ${panel.key}`);
      return unregister;
    },
    registerCommand: (cmd) => {
      const unregister = pluginRegistryApi.registerCommand(cmd as CommandDef);
      bag.add(unregister, `${id}: command ${cmd.id}`);
      return unregister;
    },
    registerRoute: (def) => {
      const unregister = pluginRegistryApi.registerRoute(def as PluginRouteDef);
      bag.add(unregister, `${id}: route ${def.path}`);
      return unregister;
    },
    registerSettingsSection: (def) => {
      const unregister = pluginRegistryApi.registerSettingsSection(def as unknown as SettingsSectionDef);
      bag.add(unregister, `${id}: settings ${def.key}`);
      return unregister;
    },
    registerEditorExtension: (def) => {
      const unregister = pluginRegistryApi.registerEditorExtension(def as unknown as EditorExtensionDef);
      bag.add(unregister, `${id}: editor-ext ${def.key}`);
      return unregister;
    },
    registerEditorToolbarItem: (def) => {
      const unregister = pluginRegistryApi.registerEditorToolbarItem(def as unknown as EditorToolbarItemDef);
      bag.add(unregister, `${id}: toolbar ${def.key}`);
      return unregister;
    },
    registerSelectionAction: (def) => {
      const unregister = pluginRegistryApi.registerSelectionAction(def as unknown as SelectionActionDef);
      bag.add(unregister, `${id}: selection ${def.key}`);
      return unregister;
    },
  };
  return ctx;
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
 */
export async function mountWebPlugin(id: string, load: () => Promise<WebPluginModule>): Promise<WebPluginLoadResult> {
  const ctx = createWebPluginContext(id);
  try {
    const mod = await load();
    if (typeof mod.apply !== 'function') {
      throw new Error('插件模块缺少 apply() 导出');
    }
    await mod.apply(ctx);
    console.debug(`[plugin:${id}] Web 面已挂载`);
    return { id, status: 'ok' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugin:${id}] Web 面挂载失败（已隔离）:`, msg);
    return { id, status: 'error', error: msg };
  }
}

/**
 * 批量挂载 Web 面插件（构建期清单）。
 * 返回结果数组；失败插件不影响其他插件。
 */
export async function mountWebPlugins(entries: Array<{ id: string; load: () => Promise<WebPluginModule> }>): Promise<WebPluginLoadResult[]> {
  const results: WebPluginLoadResult[] = [];
  for (const entry of entries) {
    results.push(await mountWebPlugin(entry.id, entry.load));
  }
  return results;
}
