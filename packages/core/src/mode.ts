// ============================================================
// @novel/core - 插件适用模式（纯函数，浏览器安全：无 zod / 无 node）
//
// 产品有两个互斥的创作模式：手写台（project.mode === 'manual'）
// 与 AI 写作（'auto'）。插件层按模式物理目录拆分，前后端一致。
//
// 本模块被 manifest.ts（契约 + zod schema）与 web.ts（浏览器面）
// 共同引用，因此不能引入 zod —— 保持纯函数以便在浏览器里过滤注册表。
// ============================================================

// ---- 适用模式白名单 ----
//
// 注意：本白名单必须与 pluginAppliesToProjectMode 的判定实现一一对应，
// 不要在此追加没有对应判定逻辑的模式值（假承诺防护）。

export const PLUGIN_MODES = [
  'manual',  // 仅手写台
  'auto',    // 仅 AI 写作
  'shared',  // 两种模式共享
] as const;

export type PluginMode = (typeof PLUGIN_MODES)[number];

/** 项目创作模式（与插件模式同名，但语义为"当前项目所处的模式"，不含 shared） */
export type ProjectMode = Exclude<PluginMode, 'shared'>;

// ---- 规范目录布局（模式的事实来源 = 父目录名） ----
//
//   apps/plugins/manual/{id}/   → manual（仅手写台）
//   apps/plugins/auto/{id}/     → auto  （仅 AI 写作）
//   apps/plugins/shared/{id}/   → shared（两种模式共享）
//   apps/plugins/local/{id}/    → shared（AI 动态创建的本地插件，默认 shared）
//
// 目录名是权威来源；manifest.modes 必须与之相容，否则安装门拒绝（MODE_MISMATCH）。

export const PLUGIN_MODE_DIRS = ['manual', 'auto', 'shared', 'local'] as const;

export type PluginModeDir = (typeof PLUGIN_MODE_DIRS)[number];

/**
 * 由插件父目录名推导其适用模式。
 * - manual / auto / shared → 同名模式
 * - local → shared（AI 动态创建的本地插件默认共享）
 * - 其他目录名 → null（未知目录，调用方据此判定为非法布局）
 */
export function pluginModeFromDir(dirName: string): PluginMode | null {
  switch (dirName) {
    case 'manual':
      return 'manual';
    case 'auto':
      return 'auto';
    case 'shared':
      return 'shared';
    case 'local':
      return 'shared';
    default:
      return null;
  }
}

/**
 * 判断某插件是否适用于指定项目模式。
 * - pluginModes 缺省（undefined 或空数组）→ 视为 ['shared']（两种模式都适用）
 * - 含 'shared' → 恒真
 * - 否则当且仅当包含 projectMode 时为真
 */
export function pluginAppliesToProjectMode(
  pluginModes: PluginMode[] | undefined,
  projectMode: ProjectMode,
): boolean {
  const modes = pluginModes && pluginModes.length > 0 ? pluginModes : (['shared'] as PluginMode[]);
  if (modes.includes('shared')) return true;
  return modes.includes(projectMode);
}
