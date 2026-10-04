// ============================================================
// apps/desktop/src/updater-manifest.ts
// `manifest.json` 的解析、校验与「已安装 vs 清单」比对。
//
// 契约来源（只读，不得改名）：
//   docs/architecture/desktop-packaging-adr.md  D14.2 —— manifest 字段冻结
//   apps/web/src/components/settings/UpdateSection.tsx:18-25 —— PluginUpdateInfo
//     `{ id, name, version, url, sha256, notes? }`（UI 直接读这 6 个字段）
//   D14.3-1 —— sha256 为**小写十六进制**（比较语义冻结）
//   D14.2 —— `appOutdated = compareVersions(manifest.version, appVersion) > 0`
//
// 本文件**不** import electron，也不碰磁盘：纯函数，便于 tsx 下直接跑正反用例。
// 类型一律从 `./updater/types.js` import，**不重新定义**。
// ============================================================

import { compareVersions } from './updater/semver.js';
import type {
  InstalledPlugin,
  ManifestPluginEntry,
  UpdaterManifest,
} from './updater/types.js';

/** `parseManifest()` 的结果（判别联合；任何不合规都走 `ok:false`，**不抛异常**）。 */
export type ParseManifestResult =
  | { ok: true; manifest: UpdaterManifest }
  | { ok: false; error: string };

/** D14.3-1 冻结：sha256 必须是 64 位**小写**十六进制。 */
const SHA256_LOWER_HEX_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 人类可读的取值描述，用于错误信息（绝不回显整个大对象）。 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    const clipped = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    return `字符串 ${JSON.stringify(clipped)}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${typeof value} ${String(value)}`;
  }
  if (Array.isArray(value)) return `数组（长度 ${value.length}）`;
  return `类型 ${typeof value}`;
}

/**
 * 取一个**非空字符串**字段。
 * @param where 出错时用于定位的前缀，如 `app` / `plugins[0]`
 */
function readNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
  where: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = obj[field];
  if (value === undefined) {
    return { ok: false, error: `manifest 缺少必填字段 ${where}.${field}` };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: `manifest 字段 ${where}.${field} 必须是字符串（实际 ${describe(value)}）`,
    };
  }
  if (value.trim().length === 0) {
    return { ok: false, error: `manifest 字段 ${where}.${field} 不能为空字符串` };
  }
  return { ok: true, value };
}

/**
 * 取一个**可选字符串**字段（缺省合法；给了但类型不对则拒绝）。
 */
function readOptionalString(
  obj: Record<string, unknown>,
  field: string,
  where: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const value = obj[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: `manifest 字段 ${where}.${field} 若存在必须是字符串（实际 ${describe(value)}）`,
    };
  }
  return { ok: true, value };
}

/** D14.3-1：sha256 必须是 64 位小写十六进制。 */
function readSha256(
  obj: Record<string, unknown>,
  where: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = obj.sha256;
  if (value === undefined) {
    return { ok: false, error: `manifest 缺少必填字段 ${where}.sha256` };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: `manifest 字段 ${where}.sha256 必须是字符串（实际 ${describe(value)}）`,
    };
  }
  if (!SHA256_LOWER_HEX_RE.test(value)) {
    const reason =
      value.length !== 64
        ? `长度应为 64（实际 ${value.length}）`
        : '含非 [0-9a-f] 字符（大写或非法字符均不接受）';
    return {
      ok: false,
      error: `manifest 字段 ${where}.sha256 必须为 64 位小写十六进制：${reason}（实际 ${describe(value)}）`,
    };
  }
  return { ok: true, value };
}

/**
 * 解析并校验 `manifest.json`（ADR D14.2 冻结结构）。
 *
 * 冻结字段：
 * ```
 * { version, notes?, publishedAt?, app: { url, sha256 }, plugins: [{ id, name, version, url, sha256, notes? }] }
 * ```
 * - 顶层 `version` 非空字符串；
 * - `app.url` / `app.sha256` 非空 / 合法；
 * - `plugins` 可缺省（视为 `[]`）；给了则必须是数组，且每个条目 6 字段逐字对齐 UI。
 *
 * @param raw 已 `JSON.parse` 的对象；为便于测试也接受 JSON 字符串。
 * @returns 判别联合；**任何不合规都返回 `{ ok:false, error }`，绝不抛异常**。
 */
export function parseManifest(raw: unknown): ParseManifestResult {
  let value: unknown = raw;

  // 容错：允许直接喂 JSON 文本（check() 走对象路径；临时脚本走文本路径）。
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch (err) {
      return {
        ok: false,
        error: `manifest.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (!isPlainObject(value)) {
    return {
      ok: false,
      error: `manifest 顶层必须是 JSON 对象（实际 ${describe(value)}）`,
    };
  }

  // ---- 顶层 version ----
  const version = readNonEmptyString(value, 'version', 'manifest');
  if (!version.ok) return version;

  const notes = readOptionalString(value, 'notes', 'manifest');
  if (!notes.ok) return notes;

  const publishedAt = readOptionalString(value, 'publishedAt', 'manifest');
  if (!publishedAt.ok) return publishedAt;

  // ---- app ----
  if (value.app === undefined) {
    return { ok: false, error: 'manifest 缺少必填字段 app' };
  }
  if (!isPlainObject(value.app)) {
    return {
      ok: false,
      error: `manifest 字段 app 必须是对象（实际 ${describe(value.app)}）`,
    };
  }
  const appUrl = readNonEmptyString(value.app, 'url', 'app');
  if (!appUrl.ok) return appUrl;
  const appSha = readSha256(value.app, 'app');
  if (!appSha.ok) return appSha;

  // ---- plugins（可缺省 ⇒ []）----
  const plugins: ManifestPluginEntry[] = [];
  const rawPlugins = value.plugins;
  if (rawPlugins !== undefined) {
    if (!Array.isArray(rawPlugins)) {
      return {
        ok: false,
        error: `manifest 字段 plugins 必须是数组（实际 ${describe(rawPlugins)}）`,
      };
    }
    for (let i = 0; i < rawPlugins.length; i += 1) {
      const where = `plugins[${i}]`;
      const item: unknown = rawPlugins[i];
      if (!isPlainObject(item)) {
        return {
          ok: false,
          error: `manifest 字段 ${where} 必须是对象（实际 ${describe(item)}）`,
        };
      }
      // 字段名逐字来自 ADR D14.2 / UpdateSection.tsx:18-25，**不得改名**。
      const id = readNonEmptyString(item, 'id', where);
      if (!id.ok) return id;
      const name = readNonEmptyString(item, 'name', where);
      if (!name.ok) return name;
      const pluginVersion = readNonEmptyString(item, 'version', where);
      if (!pluginVersion.ok) return pluginVersion;
      const url = readNonEmptyString(item, 'url', where);
      if (!url.ok) return url;
      const sha256 = readSha256(item, where);
      if (!sha256.ok) return sha256;
      const entryNotes = readOptionalString(item, 'notes', where);
      if (!entryNotes.ok) return entryNotes;

      const entry: ManifestPluginEntry = {
        id: id.value,
        name: name.value,
        version: pluginVersion.value,
        url: url.value,
        sha256: sha256.value,
      };
      if (entryNotes.value !== undefined) entry.notes = entryNotes.value;
      plugins.push(entry);
    }
  }

  const manifest: UpdaterManifest = {
    version: version.value,
    app: { url: appUrl.value, sha256: appSha.value },
    plugins,
  };
  if (notes.value !== undefined) manifest.notes = notes.value;
  if (publishedAt.value !== undefined) manifest.publishedAt = publishedAt.value;

  return { ok: true, manifest };
}

// ------------------------------------------------------------------
// 已安装插件 vs manifest.plugins
// ------------------------------------------------------------------

/**
 * 同一 `id` 可能在多个模式目录（`auto`/`manual`/`shared`/`local`）下各有一份，
 * 取版本最高的那一份作为「本地生效版本」；`version === null`（无 `plugin.json`）
 * 视为最低优先级。
 */
function pickHighestVersion(list: InstalledPlugin[]): InstalledPlugin {
  let best = list[0];
  for (let i = 1; i < list.length; i += 1) {
    const candidate = list[i];
    if (best.version === null) {
      best = candidate;
      continue;
    }
    if (candidate.version === null) continue;
    if (compareVersions(candidate.version, best.version) > 0) best = candidate;
  }
  return best;
}

/**
 * 产出 `updaterCheck().pluginUpdates[]`（`manifest.plugins` 的子集）。
 *
 * 判定规则（ADR D14.2 + 任务书）：
 *  1. 已安装且 `installed.version === null`（无 `plugin.json`）⇒ **可安装**，纳入；
 *  2. 已安装且有版本 ⇒ 仅当 `compareVersions(entry.version, installed.version) > 0` 才纳入；
 *  3. **未安装** ⇒ 视为可安装，纳入。
 *
 * 规则 3 的依据：任务书要求 `installPlugin()` 支持「未安装则用 … 默认 `local`」的
 * 全新安装路径，而 `installPlugin()` 的候选集正是本函数的返回值 ⇒ 未安装插件
 * 必须出现在 `pluginUpdates` 里，否则永远无法通过 UI 安装一个更新源提供的新插件。
 *
 * 返回值元素即 `manifest.plugins` 的条目本身（字段名与 UI 的 `PluginUpdateInfo`
 * 逐字一致），可直接结构化克隆。
 */
export function selectPluginUpdates(
  entries: ManifestPluginEntry[],
  installed: InstalledPlugin[],
): ManifestPluginEntry[] {
  const byId = new Map<string, InstalledPlugin[]>();
  for (const plugin of installed) {
    const bucket = byId.get(plugin.id);
    if (bucket) bucket.push(plugin);
    else byId.set(plugin.id, [plugin]);
  }

  const updates: ManifestPluginEntry[] = [];
  for (const entry of entries) {
    const matches = byId.get(entry.id);
    if (!matches || matches.length === 0) {
      updates.push(entry); // 未安装 ⇒ 可安装
      continue;
    }
    const local = pickHighestVersion(matches);
    if (local.version === null) {
      updates.push(entry); // 无 plugin.json ⇒ 可安装
      continue;
    }
    if (compareVersions(entry.version, local.version) > 0) updates.push(entry);
  }
  return updates;
}

/** 便捷包装：`selectPluginUpdates` 的单 id 查询（供 `installPlugin()` 用）。 */
export function findPluginUpdate(
  entries: ManifestPluginEntry[],
  installed: InstalledPlugin[],
  pluginId: string,
): ManifestPluginEntry | null {
  return selectPluginUpdates(entries, installed).find((p) => p.id === pluginId) ?? null;
}