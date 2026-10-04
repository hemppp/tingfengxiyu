// ============================================================
// apps/desktop/src/updater/plugins.ts
// 插件目录扫描（`updaterGetState().plugins[]`）。
//
// 契约来源：ADR D14.4 ——
//   `updaterGetState().plugins[]`：扫描 `<userData>/plugins/{auto,manual,shared,local}/*/plugin.json`，
//   每项 `{ id, version: string | null, dir }`；无 `plugin.json` ⇒ `version: null`。
// ============================================================

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { PLUGIN_MODES, type InstalledPlugin, type PluginMode } from './types.js';

/**
 * 扫描单个模式目录下的插件。
 *
 * 注意（ADR D7.4 实测 F20）：`<pluginsRoot>/node_modules` 是 **junction**，
 * junction 的 `lstat().isDirectory()` 返回 false ⇒ 一律用 `stat` / `withFileTypes`
 * 的目录判定，并显式排除 `node_modules` 条目本身。
 */
async function scanModeDir(pluginsRoot: string, mode: PluginMode): Promise<InstalledPlugin[]> {
  const modeDir = path.join(pluginsRoot, mode);
  let dirents;
  try {
    dirents = await fsp.readdir(modeDir, { withFileTypes: true });
  } catch {
    return []; // 目录缺失是正常的（如 local/ 首启才创建）
  }

  const out: InstalledPlugin[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name === 'node_modules') continue;
    if (dirent.name.startsWith('.')) continue;

    const dir = path.join(modeDir, dirent.name);
    const manifestPath = path.join(dir, 'plugin.json');
    let id: string | null = null;
    let version: string | null = null;
    try {
      const raw = await fsp.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as { id?: unknown; version?: unknown };
      if (typeof parsed.id === 'string' && parsed.id.length > 0) id = parsed.id;
      if (typeof parsed.version === 'string' && parsed.version.length > 0) version = parsed.version;
    } catch {
      // 无 plugin.json / 损坏 ⇒ version: null（ADR D14.4）
    }
    // 无 plugin.json 时用目录名兜底作为 id（UI 直接展示 id）
    out.push({ id: id ?? dirent.name, version, dir });
  }

  // 稳定排序，便于 UI 展示与测试断言
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** 扫描全部模式目录（auto / manual / shared / local）。 */
export async function scanInstalledPlugins(pluginsRoot: string): Promise<InstalledPlugin[]> {
  const results = await Promise.all(PLUGIN_MODES.map((mode) => scanModeDir(pluginsRoot, mode)));
  return results.flat();
}

/**
 * 定位某个已安装插件的物理目录（供 `updaterInstallPlugin` 替换）。
 * 返回 `null` 表示未安装。
 */
export async function findInstalledPluginDir(
  pluginsRoot: string,
  pluginId: string,
): Promise<{ mode: PluginMode; dir: string; version: string | null } | null> {
  for (const mode of PLUGIN_MODES) {
    const modeDir = path.join(pluginsRoot, mode);
    let dirents;
    try {
      dirents = await fsp.readdir(modeDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || dirent.name === 'node_modules' || dirent.name.startsWith('.')) continue;
      const dir = path.join(modeDir, dirent.name);
      let version: string | null = null;
      try {
        const raw = await fsp.readFile(path.join(dir, 'plugin.json'), 'utf8');
        const parsed = JSON.parse(raw) as { id?: unknown; version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.length > 0) version = parsed.version;
        if (parsed.id === pluginId) return { mode, dir, version };
      } catch {
        // 继续
      }
      // 目录名即 id 的兜底
      if (dirent.name === pluginId) return { mode, dir, version };
    }
  }
  return null;
}

/**
 * 把解压出的插件包根定位到真正含 `plugin.json` 的目录。
 *
 * 插件 zip 由 `build-update.mjs` 以**包根相对路径**产出，但为容忍
 * 「多套了一层目录」的常见打包方式，这里向下探一层查找 plugin.json。
 */
export async function locatePluginRoot(extractDir: string, pluginId: string): Promise<string> {
  const direct = path.join(extractDir, 'plugin.json');
  try {
    await fsp.access(direct);
    return extractDir;
  } catch {
    // 探一层
  }
  const dirents = await fsp.readdir(extractDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const nested = path.join(extractDir, dirent.name);
    try {
      await fsp.access(path.join(nested, 'plugin.json'));
      return nested;
    } catch {
      // 继续
    }
  }
  throw new Error(`解压结果中未找到 plugin.json（插件 ${pluginId}）`);
}