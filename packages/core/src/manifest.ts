// ============================================================
// @novel/core - 插件 Manifest 规范与校验
// ============================================================

import { z } from 'zod';

// ---- 权限白名单 ----

export const PLUGIN_PERMISSIONS = [
  'routes',        // 注册后端路由
  'db:global',     // 读写主库（用户级数据）
  'db:project',    // 读写项目库（需绑定 projectId）
  'ai:tools',      // 注册 AI 工具
  'ai:skills',     // 注册 AI 技能
  'ai:agents',     // 注册 AI 智能体
  'ai:providers',  // 注册 provider 配置加载器
  'events',        // 订阅/发布事件
  'settings',      // 读写用户设置
  'scheduler',     // 注册定时任务
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

// ---- Server 面可用服务（inject 白名单） ----

export const SERVER_SERVICES = [
  'routes',
  'services',
  'db',
  'ai',
  'events',
  'hooks',
  'settings',
  'scheduler',
  'prompt',
] as const;

export type ServerServiceName = (typeof SERVER_SERVICES)[number];

// ---- Web 面可用扩展点 ----
//
// 白名单必须与 WebPluginContext 的 register* 方法一一对应 —— 曾经这里多列了
// sidebar/locale/store 等未实现项，manifest 校验放行但插件调不到任何 API，
// 等于给插件作者一个假承诺。新增扩展点时先加 ctx 方法再加这里。

export const WEB_SERVICES = [
  'routes',          // ctx.registerRoute
  'projectPanels',   // ctx.registerProjectPanel
  'commands',        // ctx.registerCommand
  'settings',        // ctx.registerSettingsSection
  'editor',          // ctx.registerEditorExtension
  'toolbar',         // ctx.registerEditorToolbarItem
  'selection',       // ctx.registerSelectionAction
  'api',             // ctx.api（带鉴权 fetch）
] as const;

export type WebServiceName = (typeof WEB_SERVICES)[number];

// ---- Manifest 定义 ----

export interface PluginManifest {
  /** 全局唯一 id（反向域名风格，如 novel.worldbuilding） */
  id: string;
  /** 展示名称 */
  name: string;
  description?: string;
  version: string;
  /** 宿主最低版本（语义化比较） */
  minHostVersion?: string;
  /** 依赖的其他插件 id（硬依赖：缺失或已禁用则该插件跳过；挂载顺序保证在依赖之后） */
  dependsOn?: string[];
  /** 权限声明（必须为白名单子集） */
  permissions: PluginPermission[];
  /** Server 面（宿主进程） */
  server?: {
    /** 入口模块路径（默认 '.'，即包 main） */
    entry?: string;
    /** 需要注入的服务 */
    inject?: ServerServiceName[];
  };
  /** Web 面（浏览器 GUI） */
  web?: {
    entry?: string;
    inject?: WebServiceName[];
  };
  /** 数据库迁移 */
  db?: {
    /** 主库迁移目录 */
    globalMigrations?: string;
    /** 项目库迁移目录 */
    projectMigrations?: string;
  };
  /** Server 面入口相对路径（本地插件用，默认 ./server/index.ts；标准 v1.0 正式字段） */
  serverEntry?: string;
  /** Web 面入口相对路径（本地插件用，默认 ./web/index.tsx） */
  webEntry?: string;
}

// ---- zod 校验 ----

/** 入口路径规则（标准 G1）：仅允许插件目录内相对路径，拒绝绝对路径与 .. 穿越 */
const safeEntryPath = z
  .string()
  .refine((v) => {
    const value = v.trim();
    if (!value) return false;
    if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false; // 绝对路径（posix / windows 盘符）
    return !value.replace(/\\/g, '/').split('/').includes('..'); // .. 穿越
  }, 'entry 必须为插件目录内的相对路径（不允许绝对路径或 .. 穿越）');

export const pluginManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9]+(\.[a-z0-9]+)+$/, 'id 必须为反向域名风格（如 novel.worldbuilding）'),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'version 必须为 semver'),
  minHostVersion: z.string().regex(/^\d+\.\d+\.\d+/, 'minHostVersion 必须为 semver').optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).default([]),
  server: z.object({
    entry: z.string().optional(),
    inject: z.array(z.enum(SERVER_SERVICES)).optional(),
  }).optional(),
  web: z.object({
    entry: z.string().optional(),
    inject: z.array(z.enum(WEB_SERVICES)).optional(),
  }).optional(),
  db: z.object({
    globalMigrations: z.string().optional(),
    projectMigrations: z.string().optional(),
  }).optional(),
  serverEntry: safeEntryPath.optional(),
  webEntry: safeEntryPath.optional(),
});

export type ParsedPluginManifest = z.infer<typeof pluginManifestSchema>;

/** 校验 manifest，失败抛出带可读信息的错误 */
export function validateManifest(raw: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`插件 manifest 校验失败: ${issues}`);
  }
  return parsed.data as unknown as PluginManifest;
}

/** 语义化版本比较：a >= b ? */
export function satisfiesMinVersion(version: string, minVersion: string): boolean {
  const parse = (v: string): number[] => {
    const parts = v.split('.');
    return [0, 1, 2].map((i) => parseInt(parts[i] ?? '0', 10) || 0);
  };
  const a = parse(version);
  const b = parse(minVersion);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}
