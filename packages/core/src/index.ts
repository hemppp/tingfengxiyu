// ============================================================
// @novel/core - 插件契约包（聚合导出）
//
// v2（Cordis 底座版）：插件内核已替换为 @deepseek-ai/cordis，
// 本包只保留"契约"——类型定义 + manifest 校验 + 依赖分析 + 浏览器端轻量运行时。
// 宿主（apps/server）直接用 cordis 的 Context / ctx.plugin / ctx.effect。
// 浏览器端（apps/web / 插件 Web 面）请从 '@novel/core/web' 导入。
// ============================================================

export { HOST_VERSION, sortByDependencies, analyzeDependencies } from './loader.js';
export type { PluginEntry, MountedPlugin, PluginStatus, DependencyNode, DependencyAnalysis } from './loader.js';

export {
  PLUGIN_PERMISSIONS,
  SERVER_SERVICES,
  WEB_SERVICES,
  validateManifest,
  satisfiesMinVersion,
  pluginManifestSchema,
} from './manifest.js';
export type {
  PluginManifest,
  PluginPermission,
  ServerServiceName,
  WebServiceName,
  ParsedPluginManifest,
} from './manifest.js';

export {
  INSTALL_STANDARD_VERSION,
  INSTALL_ERROR_CODES,
  checkManifestPolicy,
  localDirMatchesId,
} from './install.js';
export type { InstallErrorCode, InstallIssue } from './install.js';

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
  PluginMigration,
  PluginMigrateResult,
  ServerPluginContext,
  AgentRunOptions,
  AgentRunResult,
  FloatingPanelDef,
  WebCommandDef,
  WebRouteGuard,
  WebRouteDef,
  SettingsCategory,
  SettingsSectionDef,
  EditorExtensionDef,
  EditorToolbarItemDef,
  SelectionActionDef,
  WebPluginContext,
  WebPluginModule,
} from './plugin-context.js';
