// ============================================================
// @novel/core/web - 浏览器面入口
//
// 只导出浏览器安全内容（无 node / 无 zod / 无 cordis）：
//  - 轻量运行时：EventBus / HookBus / Registry / DisposerBag / logger
//  - 插件 Web 面契约类型：WebPluginContext / WebPluginModule 等
// 浏览器里没有 cordis 内核；扩展点注册表等价于 DSH client slots 的简化版。
// ============================================================

export { Registry, DisposerBag } from './registry.js';
export type { RegistryEntry } from './registry.js';

export { EventBus, EVENTS } from './events.js';
export type { EventHandler } from './events.js';

export { HookBus } from './hooks.js';
export type { HookContext, BeforeHook, AfterHook, AroundHook } from './hooks.js';

export { createBaseContext, createPluginLogger } from './context.js';
export type { BasePluginContext, Logger, PluginModule, PluginModuleFactory } from './context.js';

export type {
  ToolDefinition,
  ToolContext,
  ToolHandler,
  ToolHandlerResult,
  KvService,
  FloatingPanelDef,
  WebCommandDef,
  WebRouteGuard,
  WebRouteDef,
  SettingsCategory,
  SettingsSectionDef,
  EditorExtensionDef,
  EditorToolbarItemDef,
  SelectionActionDef,
  WebApiFetch,
  WebPluginContext,
  WebPluginModule,
} from './plugin-context.js';
