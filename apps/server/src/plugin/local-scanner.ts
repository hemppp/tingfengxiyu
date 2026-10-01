// ============================================================
// 本地插件扫描器 —— apps/plugins/{manual,auto,shared,local}/{dirName}/ 目录即插件
//
// 按创作模式物理拆分：父目录名即插件的适用模式（事实来源）：
//   apps/plugins/manual/{dir}/  → manual（仅手写台）
//   apps/plugins/auto/{dir}/    → auto  （仅 AI 写作）
//   apps/plugins/shared/{dir}/  → shared（两种模式共享）
//   apps/plugins/local/{dir}/   → shared（AI 对话创建，默认共享）
// 由父目录名经 @novel/core 的 pluginModeFromDir() 推导，写入 PluginEntry.modes；
// manifest.modes 必须与目录一致，否则安装门 G2.5 拒绝（MODE_MISMATCH）。
//
// 目录名 {dirName} 允许两种形态（见 docs/architecture/plugin-standard.md G2 身份门）：
//   完整 id（如 novel.bookscan，AI create_plugin 形态）或 id 尾段（如 typography，手写形态）。
// 目录结构：
//   apps/plugins/{mode}/{dirName}/
//     plugin.json          # manifest（含 serverEntry/webEntry 相对路径）
//     server/index.ts      # Server 面（exports "." 语义）
//     web/index.tsx        # Web 面（构建期由 vite glob 收集）
//
// 无需修改任何宿主文件 —— 新插件 = 在某个模式目录下新建子目录，重启 server 自动加载。
// ============================================================

import { readdirSync, existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, isAbsolute, join, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { PluginEntry, PluginManifest, InstallErrorCode, PluginMode } from '@novel/core';
import {
  validateManifest,
  checkManifestPolicy,
  localDirMatchesId,
  pluginModeFromDir,
  PLUGIN_MODE_DIRS,
  HOST_VERSION,
} from '@novel/core';

/**
 * 校验 manifest 的 entry 路径：仅允许插件目录内的相对路径。
 * 拒绝绝对路径、`..` 穿越；加载前再做 realpath 符号链接逃逸检查。
 */
function isSafeEntryPath(metaDir: string, entry: string): boolean {
  if (typeof entry !== 'string' || !entry.trim()) return false;
  if (isAbsolute(entry)) return false;
  const normalized = entry.replace(/\\/g, '/');
  if (normalized.split('/').some((seg) => seg === '..')) return false;
  const full = resolve(metaDir, normalized);
  return full.startsWith(resolve(metaDir) + sep);
}

/** realpath 级包含校验（加载前执行；entry 文件必须已存在） */
function isRealPathInsidePluginDir(metaDir: string, entry: string): boolean {
  try {
    const full = resolve(metaDir, entry.replace(/\\/g, '/'));
    const realRoot = realpathSync(resolve(metaDir)) + sep;
    return realpathSync(full).startsWith(realRoot);
  } catch {
    return false;
  }
}

// 插件根目录（含 manual/auto/shared/local 四个模式子目录）：
//  - 桌面端：PLUGINS_DIR / PLUGINS_ROOT 环境变量指向 userData/plugins（可写、可远程更新）
//  - 开发模式：相对本文件源码定位（apps/server/src/plugin → 仓库根），与进程 cwd 无关
// 注：esbuild CJS 打包（桌面端）会把 import.meta.url 置为 undefined，需兜底
const HERE = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url)); // .../apps/server/src/plugin
  } catch {
    return process.cwd(); // CJS bundle 下的兜底（桌面端实际用 PLUGINS_DIR）
  }
})();

/**
 * 插件根目录：含 {manual,auto,shared,local} 四个模式子目录。
 * 解析顺序：PLUGINS_ROOT ?? PLUGINS_DIR ?? <repo>/apps/plugins
 * （PLUGINS_DIR 为历史名，语义升级为「根」；桌面端仍可继续使用）
 */
export const PLUGINS_ROOT = process.env.PLUGINS_ROOT
  ? process.env.PLUGINS_ROOT
  : process.env.PLUGINS_DIR
    ? process.env.PLUGINS_DIR
    : join(HERE, '..', '..', '..', '..', 'apps', 'plugins');

/**
 * AI 动态创建插件的落盘目录（local 模式，默认 shared）。
 * 保留导出以兼容既有调用（plugin-tools 的 create_plugin）。
 */
export const LOCAL_PLUGINS_DIR = join(PLUGINS_ROOT, 'local');

/** 读取 plugin.json（返回原始 manifest + serverEntry/webEntry + 由父目录推导的 mode） */
export interface LocalPluginMeta {
  id: string;
  dir: string;
  /** 父目录名（manual/auto/shared/local），mode 的事实来源 */
  parentDirName: string;
  /** 由父目录名推导的适用模式（写入 PluginEntry.modes） */
  mode: PluginMode;
  rawManifest: Record<string, unknown>;
  /** 已通过标准校验的 manifest（扫描管线填入；plugin-tools 直调时缺省会在 entry 构造时补校验） */
  manifest?: PluginManifest;
  serverEntry: string;
  webEntry: string;
}

/** 枚举已存在的模式根目录（跳过不存在的，保持宽容） */
function* pluginModeRoots(): Generator<{ root: string; parentDirName: string }> {
  for (const dirName of PLUGIN_MODE_DIRS) {
    const root = join(PLUGINS_ROOT, dirName);
    if (existsSync(root)) yield { root, parentDirName: dirName };
  }
}

/** 列出本地插件元信息（不加载；遍历全部模式目录） */
export function listLocalPlugins(): LocalPluginMeta[] {
  const metas: LocalPluginMeta[] = [];
  for (const { root, parentDirName } of pluginModeRoots()) {
    for (const name of readdirSync(root, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const dir = join(root, name.name);
      const manifestPath = join(dir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const serverEntry = typeof raw.serverEntry === 'string' ? raw.serverEntry : './server/index.ts';
        const webEntry = typeof raw.webEntry === 'string' ? raw.webEntry : './web/index.tsx';
        // ★ entry 路径边界：拒绝绝对路径与 `..` 穿越（realpath 符号链接检查在加载时执行）
        if (!isSafeEntryPath(dir, serverEntry) || !isSafeEntryPath(dir, webEntry)) {
          console.warn(`[local-plugins] 插件 ${raw.id ?? name.name} 的 serverEntry/webEntry 非法（仅允许插件目录内相对路径），已跳过`);
          continue;
        }
        const mode = pluginModeFromDir(parentDirName) ?? 'shared';
        metas.push({ id: raw.id ?? name.name, dir, parentDirName, mode, rawManifest: raw, serverEntry, webEntry });
      } catch (err) {
        console.warn(`[local-plugins] 读取 ${manifestPath} 失败:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return metas;
}

/** 构造 PluginEntry（load 用文件路径 import，无需 pnpm 链接） */
export function localEntryFromMeta(meta: LocalPluginMeta): PluginEntry {
  const manifest = meta.manifest ?? validateManifest(meta.rawManifest);
  return {
    id: meta.id,
    source: 'local',
    sourcePath: meta.dir,
    manifest,
    // ★ 由父目录名推导的适用模式（事实来源），供宿主 HOST_MODE 过滤与运行时门禁就近读取
    modes: [meta.mode],
    load: async () => {
      // ★ 加载前 realpath 符号链接逃逸检查（扫描时 entry 文件可能尚不存在）
      if (existsSync(join(meta.dir, meta.serverEntry)) && !isRealPathInsidePluginDir(meta.dir, meta.serverEntry)) {
        throw new Error(`插件 ${meta.id} 的 serverEntry 指向插件目录之外（已拦截）`);
      }
      const mod = await import(pathToFileURL(join(meta.dir, meta.serverEntry)).href);
      return mod;
    },
  };
}

/** 扫描拒绝报告：标准错误码 + 可读原因（管理界面 / 健康接口可见） */
export interface LocalPluginRejection {
  id: string;
  dir: string;
  code: InstallErrorCode;
  message: string;
}

export interface LocalScanResult {
  entries: PluginEntry[];
  rejected: LocalPluginRejection[];
}

/**
 * 扫描全部模式目录下的本地插件 → { entries, rejected }（novel-plugin-standard/1.0 安装门）：
 *   G0 Manifest 门 → G1 结构门（路径安全 + 入口存在）→ G2 身份门（目录名匹配）
 *   → G2.5 模式门（目录推导 mode 与 manifest.modes 一致，MODE_MISMATCH）
 *   → G3 版本门 + G4 静态依赖门。
 * 任何一门失败都只拒绝该插件并写进 rejected，绝不炸掉整批扫描。
 */
export function scanLocalPluginsDetailed(): LocalScanResult {
  const result: LocalScanResult = { entries: [], rejected: [] };
  for (const { root, parentDirName } of pluginModeRoots()) {
    for (const name of readdirSync(root, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const dir = join(root, name.name);
      const manifestPath = join(dir, 'plugin.json');
      if (!existsSync(manifestPath)) continue; // 无 plugin.json 的目录不是插件，静默忽略
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch (err) {
        result.rejected.push({
          id: name.name,
          dir,
          code: 'MANIFEST_INVALID',
          message: `plugin.json 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      const id = typeof raw.id === 'string' && raw.id ? raw.id : name.name;
      // G0 Manifest 门（含 serverEntry/webEntry 路径规则）
      let manifest: PluginManifest;
      try {
        manifest = validateManifest(raw);
      } catch (err) {
        result.rejected.push({ id, dir, code: 'MANIFEST_INVALID', message: err instanceof Error ? err.message : String(err) });
        continue;
      }
      // G1 结构门：entry 路径边界 + Server 入口文件存在（realpath 逃逸检查在 load() 前再做一次）
      const serverEntry = manifest.serverEntry ?? './server/index.ts';
      const webEntry = manifest.webEntry ?? './web/index.tsx';
      if (!isSafeEntryPath(dir, serverEntry) || !isSafeEntryPath(dir, webEntry)) {
        result.rejected.push({
          id,
          dir,
          code: 'ENTRY_UNSAFE',
          message: 'serverEntry/webEntry 非法（仅允许插件目录内相对路径，禁止绝对路径与 .. 穿越）',
        });
        continue;
      }
      if (!existsSync(join(dir, serverEntry))) {
        result.rejected.push({ id, dir, code: 'ENTRY_MISSING', message: `Server 入口文件不存在: ${serverEntry}` });
        continue;
      }
      // G2 身份门：目录名必须为完整 id 或 id 尾段（兼容 AI create_plugin 与手写两种形态）
      if (!localDirMatchesId(name.name, id)) {
        result.rejected.push({
          id,
          dir,
          code: 'ID_MISMATCH',
          message: `目录名 "${name.name}" 与插件 id "${id}" 不匹配（标准要求目录名为完整 id 或 id 尾段）`,
        });
        continue;
      }
      // G2.5 模式门 + G3 版本门 + G4 静态依赖门（parentDirName 触发模式一致性校验）
      const policyIssues = checkManifestPolicy(manifest, { hostVersion: HOST_VERSION, parentDirName });
      if (policyIssues.length > 0) {
        result.rejected.push({
          id,
          dir,
          code: policyIssues[0].code,
          message: policyIssues.map((i) => `${i.code}: ${i.message}`).join('; '),
        });
        continue;
      }
      const mode = pluginModeFromDir(parentDirName) ?? 'shared';
      result.entries.push(
        localEntryFromMeta({ id, dir, parentDirName, mode, rawManifest: raw, manifest, serverEntry, webEntry }),
      );
    }
  }
  return result;
}

/** 扫描全部本地插件 → PluginEntry[]（兼容旧调用；需要拒绝报告时用 scanLocalPluginsDetailed） */
export function scanLocalPlugins(): PluginEntry[] {
  return scanLocalPluginsDetailed().entries;
}
