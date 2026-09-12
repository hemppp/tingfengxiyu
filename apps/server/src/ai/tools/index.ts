// ============================================================
// AI 工具统一入口
//
// 导入此文件即触发所有工具注册到 registry。
// 使用方只需导入 ensureToolsRegistered() 确保注册完成。
// ============================================================

import { getAllToolDefinitions, registerTool } from './registry.js';

// 导入各模块工具文件（副作用：触发注册）
import './character-tools.js';
import './foreshadow-tools.js';
import './location-tools.js';
import './item-tools.js';
import './outline-tools.js';
import { createPlugin, createPluginToolDef, listPluginsForAI, listPluginsToolDef } from './plugin-tools.js';

// 注册插件管理工具（AI 对话创建插件的能力）
registerTool(createPluginToolDef.function.name, createPluginToolDef, async (args, ctx) => {
  const r = await createPlugin(args as unknown as Parameters<typeof createPlugin>[0], ctx);
  return r;
});
registerTool(listPluginsToolDef.function.name, listPluginsToolDef, async () => listPluginsForAI());

// 重导出常用接口
export {
  type ToolContext,
  type ToolHandlerResult,
  getAllToolDefinitions,
  getToolDefinitions,
  executeTool,
  isRegisteredTool,
  markPluginTool,
  getPluginToolNames,
} from './registry.js';

/** 确保所有工具已注册（幂等，可多次调用） */
export function ensureToolsRegistered(): void {
  // 导入即注册，此函数仅作显式标记
  void getAllToolDefinitions();
}

/** 实体写入模块需要的工具名列表（用于按需启用） */
export const ENTITY_TOOL_NAMES = [
  'create_character',
  'update_character',
  'create_foreshadow',
  'update_foreshadow',
  'create_location',
  'update_location',
  'create_item',
  'update_item',
  'set_outline_core_conflict',
  'set_chapter_outline',
  'set_outline_section',
] as const;

/** 插件管理工具名（AI 对话创建/查看插件） */
export const PLUGIN_TOOL_NAMES = ['create_plugin', 'list_local_plugins'] as const;
