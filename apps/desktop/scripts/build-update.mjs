#!/usr/bin/env node
/**
 * ============================================================
 * apps/desktop/scripts/build-update.mjs
 *
 * ADR-0008（`docs/architecture/desktop-packaging-adr.md`）**D14 / D17 冻结**的发布工具。
 *
 * 用法（在仓库根 `F:\new1.2` 执行）：
 *     node apps/desktop/scripts/build-update.mjs
 *
 * 产出（D17.2 冻结；`/release/` 已在 `.gitignore:28`，不入库）：
 *
 *     release/updates/
 *     ├─ manifest.json                              ← D14.2 冻结字段的更新源清单
 *     ├─ novelmuse-app-<version>.zip                ← 应用本体（后端 + 前端）
 *     ├─ novel.bookscan-<version>.zip
 *     ├─ novel.autowrite-<version>.zip
 *     ├─ novel.auto.workbench-<version>.zip
 *     ├─ novel.manual.workbench-<version>.zip
 *     └─ novel.typography-<version>.zip
 *
 * 输入（D17.1）：
 *   apps/web/dist/                        已构建前端（D16.2 extraResources → resources/web-dist）
 *   apps/desktop/payload/app-server/      已生成 server 负载（build-server-payload.mjs 产出）
 *   apps/plugins/**\/plugin.json          5 个磁盘插件（全部 0.1.0）
 *   apps/desktop/package.json#version     应用版本（zip 名与 manifest.version）
 *
 * 冻结要求 → 实现点对照：
 *   D17.2  输出集合恰为 manifest.json + 6 个 zip（文件名用**插件 id**，不是所在目录名）
 *   D17.3  sha256 一律 64 位**小写十六进制**，写进 manifest.json
 *   D17.3  zip 内 entry 路径**相对包根**，不得含前导 `/`、不得含 `..` 段
 *          （与 D14.3-2 的 `assertSafeEntryName` 互为正反；写包前逐条自检，违规即 fail closed）
 *   D17.3  plugins[] 恰好 **5** 个磁盘插件；builtin（`apps/server/src/plugin/builtin.ts` 的 21 条）
 *          与 `@novel-plugins/worldbuilding` **不列入**（它们随应用本体更新）
 *   D17.3  **幂等**：重复运行覆盖同名产物、清除旧版本 zip；且 zip **字节级稳定**
 *          （entry 时间戳钉死为常量，故 sha256 在复跑之间不变）
 *   D17.4  写 zip 用 **adm-zip**（`devDependencies`，跨平台确定性优先）
 *
 * 应用本体 zip 的包内形态（`updater.ts: locatePayloadRoots()` 双向容忍「扁平 / 嵌套」）：
 *   app-server/{apps,packages,node_modules,pnpm-workspace.yaml,…}
 *   web-dist/{index.html,assets/…}
 * 采用**嵌套**形态：与安装包 `resources/{app-server,web-dist}` 逐字同构，
 * 且 `web-dist` basename 判定锚点天然成立（`index.ts:350`）。
 *
 * 注意：应用更新只替换 `<userData>/app-runtime/{app-server,web-dist}`（D14.5 e/f），
 * 因此应用本体 zip **不含** Electron 壳（`release/desktop/win-unpacked/`）与
 * `seed-plugins`：壳的更新由安装包承担，插件是独立更新单元（D14.5 末段）。
 * ============================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..'); // F:\new1.2
const DESKTOP = path.resolve(REPO, 'apps', 'desktop');
const OUT_DIR = path.join(REPO, 'release', 'updates');
const APP_SERVER_DIR = path.join(DESKTOP, 'payload', 'app-server');
const WEB_DIST_DIR = path.join(REPO, 'apps', 'web', 'dist');

const log = (...a) => console.log('[update]', ...a);

/**
 * zip entry 时间戳钉死为常量 ⇒ 打包字节与 sha256 在复跑之间**逐位不变**（幂等要求）。
 * `SOURCE_DATE_EPOCH`（可复现构建惯例，秒）存在时优先采用，便于发布方显式指定。
 */
function resolveEntryTime() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw !== undefined && raw !== '') {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return new Date(secs * 1000);
    throw new Error(`SOURCE_DATE_EPOCH 不是合法秒数：${raw}`);
  }
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0)); // 2026-01-01T00:00:00Z
}
const ENTRY_TIME = resolveEntryTime();

/**
 * D17.2 冻结的 5 个磁盘插件：`id`（= zip 文件名 + manifest.plugins[].id）
 * 与**所在目录**（目录名与 id 不一致：`auto/workbench` ⇒ `novel.auto.workbench`，
 * `manual/workbench` ⇒ `novel.manual.workbench`）。
 * 顺序与 D17.2 的清单逐字一致。
 */
const PLUGIN_SOURCES = [
  { id: 'novel.bookscan', relDir: ['manual', 'novel.bookscan'] },
  { id: 'novel.autowrite', relDir: ['auto', 'novel.autowrite'] },
  { id: 'novel.auto.workbench', relDir: ['auto', 'workbench'] },
  { id: 'novel.manual.workbench', relDir: ['manual', 'workbench'] },
  { id: 'novel.typography', relDir: ['shared', 'typography'] },
];

/** builtin 插件 id 前缀域（`apps/server/src/plugin/builtin.ts`）；用于 fail-closed 兜底。 */
const BUILTIN_ONLY_IDS = new Set(['novel.worldbuilding', 'novel.auth', 'novel.projects', 'novel.ai']);
const FORBIDDEN_PLUGIN_IDS = new Set(['@novel-plugins/worldbuilding', 'novel.worldbuilding']);

// ---------------------------------------------------------------- utils

const exists = (p) => fs.existsSync(p);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** D17.3：entry 路径必须相对包根 —— 无前导 `/`、无 `..` 段、无盘符 / URL 形态、无 NUL。 */
function assertSafeEntryName(entryName) {
  const name = String(entryName ?? '');
  if (name.length === 0) throw new Error('zip entry 名为空');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error(`zip entry 含 NUL/控制字符：${name}`);
  const posix = name.replace(/\\/g, '/');
  if (posix.startsWith('/')) throw new Error(`zip entry 含前导 /：${name}`);
  if (/^[a-zA-Z]:/.test(posix)) throw new Error(`zip entry 含盘符：${name}`);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(posix)) throw new Error(`zip entry 为 URL 形态：${name}`);
  const segments = posix.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..')) throw new Error(`zip entry 含 \`..\` 段：${name}`);
  if (segments.some((s) => s === '.')) throw new Error(`zip entry 含 \`.\` 段：${name}`);
  return segments.join('/');
}

/** 递归把目录树写入 zip，entry 名以 `zipPrefix` 为包根前缀（相对路径，POSIX 分隔符）。 */
function addTree(zip, absRoot, zipPrefix) {
  let files = 0;
  let bytes = 0;

  const walk = (absDir, relDir) => {
    const names = fs.readdirSync(absDir).sort();
    for (const name of names) {
      const abs = path.join(absDir, name);
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const entry = `${zipPrefix}/${rel}`;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        zip.addFile(`${entry}/`, Buffer.alloc(0), '');
        walk(abs, rel);
      } else if (st.isFile()) {
        const data = fs.readFileSync(abs);
        zip.addFile(entry, data, '');
        files += 1;
        bytes += data.length;
      } else {
        throw new Error(`不支持的 entry 类型（非文件/目录）：${abs}`);
      }
    }
  };

  // 包根前缀为空（插件 zip：entry 直接落在包根）时不写目录 entry；
  // 否则写一条 `prefix/`（adm-zip 对空串/`'/'` 会规整成 `''` / `'./'`，必须显式带尾斜杠）。
  if (zipPrefix !== '') zip.addFile(`${zipPrefix}/`, Buffer.alloc(0), '');
  walk(absRoot, '');
  return { files, bytes };
}

/** 打包：写 entry → 钉死时间戳 → 取字节 → 逐条自检 entry 名 → 落盘 → 返回 sha256。 */
function buildZip(destPath, builders) {
  const zip = new AdmZip();
  let files = 0;
  let bytes = 0;
  for (const b of builders) {
    const s = addTree(zip, b.dir, b.prefix);
    files += s.files;
    bytes += s.bytes;
  }
  const entries = zip.getEntries();
  for (const e of entries) {
    e.header.time = ENTRY_TIME;
    assertSafeEntryName(e.entryName); // D17.3 fail closed
  }
  const buf = zip.toBuffer();
  fs.writeFileSync(destPath, buf);
  const digest = sha256(buf);
  log(
    `写出 ${path.basename(destPath)}：${entries.length} entry / ${files} 文件 / ` +
      `${bytes} B 原始（zip ${buf.length} B）sha256=${digest}`,
  );
  return {
    path: destPath,
    url: path.basename(destPath),
    sha256: digest,
    entryCount: entries.length,
    fileCount: files,
    rawBytes: bytes,
    zipBytes: buf.length,
  };
}

/**
 * `publishedAt` 解析（D14.2 字段；**必须稳定**，否则「复跑后全部 sha256 不变」不成立）。
 *
 * 优先级：
 *   1. 环境变量 `PUBLISHED_AT`（发布方显式指定，原样采用）；
 *   2. 已存在的 `release/updates/manifest.json` 中**同版本**的 `publishedAt`（复跑沿用以保幂等）；
 *   3. 当前 UTC 时间（秒精度，`YYYY-MM-DDTHH:mm:ssZ`）。
 */
function resolvePublishedAt(version) {
  const fromEnv = process.env.PUBLISHED_AT;
  if (fromEnv !== undefined && fromEnv !== '') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(fromEnv)) return fromEnv;
    throw new Error(`PUBLISHED_AT 不是 ISO-8601 UTC 时间：${fromEnv}`);
  }
  try {
    const prev = readJson(path.join(OUT_DIR, 'manifest.json'));
    if (prev && prev.version === version && typeof prev.publishedAt === 'string' && prev.publishedAt !== '') {
      return prev.publishedAt;
    }
  } catch {
    // 无既有 manifest ⇒ 回落到当前时间
  }
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 扫描磁盘上全部 `plugin.json`（排除 node_modules），用于校验冻结集合不漂移。 */
function scanDiskPluginJson() {
  const roots = ['auto', 'manual', 'shared', 'local'].map((m) => path.join(REPO, 'apps', 'plugins', m));
  const found = [];
  for (const root of roots) {
    if (!exists(root)) continue;
    const walk = (dir, mode) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (!e.isDirectory()) continue;
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        const pj = path.join(abs, 'plugin.json');
        if (exists(pj)) found.push({ mode, dir: abs, manifest: readJson(pj) });
        walk(abs, mode);
      }
    };
    walk(root, path.basename(root));
  }
  return found;
}

// ---------------------------------------------------------------- main

function main() {
  log(`仓库根：${REPO}`);
  log(`entry 时间戳钉死：${ENTRY_TIME.toISOString()}（幂等 ⇒ sha256 复跑不变）`);

  // ---- 0) 输入自检（D17.1）----
  if (!exists(APP_SERVER_DIR)) throw new Error(`缺少 server 负载：${APP_SERVER_DIR}（先跑 build-server-payload.mjs）`);
  if (!exists(WEB_DIST_DIR)) throw new Error(`缺少前端产物：${WEB_DIST_DIR}（先跑 @novel/web build）`);
  if (!exists(path.join(APP_SERVER_DIR, 'pnpm-workspace.yaml'))) {
    throw new Error('server 负载缺少 pnpm-workspace.yaml（updater 定位负载根的锚点，D7.3）');
  }
  if (!exists(path.join(WEB_DIST_DIR, 'index.html'))) {
    throw new Error('前端产物缺少 index.html（updater 定位前端根的锚点）');
  }

  const appVersion = readJson(path.join(DESKTOP, 'package.json')).version;
  if (typeof appVersion !== 'string' || appVersion.trim() === '') {
    throw new Error('apps/desktop/package.json 缺少 version');
  }
  log(`应用版本：${appVersion}`);

  // ---- 1) 插件集合校验（D17.3：恰好 5 个磁盘插件，builtin 不列入）----
  const disk = scanDiskPluginJson();
  const diskIds = disk.map((d) => d.manifest.id);
  const wanted = PLUGIN_SOURCES.map((p) => p.id);
  const expected = new Set(wanted);
  if (diskIds.length !== expected.size || diskIds.some((id) => !expected.has(id)) || new Set(diskIds).size !== diskIds.length) {
    throw new Error(`磁盘插件集合漂移：期望 ${wanted.join(', ')}；实际 ${diskIds.join(', ')}`);
  }
  for (const d of disk) {
    if (FORBIDDEN_PLUGIN_IDS.has(d.manifest.id) || BUILTIN_ONLY_IDS.has(d.manifest.id)) {
      throw new Error(`builtin 插件不得列入 plugins[]：${d.manifest.id}`);
    }
  }

  const pluginEntries = [];
  for (const spec of PLUGIN_SOURCES) {
    const dir = path.join(REPO, 'apps', 'plugins', ...spec.relDir);
    const pj = path.join(dir, 'plugin.json');
    if (!exists(pj)) throw new Error(`插件 manifest 缺失：${pj}`);
    const manifest = readJson(pj);
    if (manifest.id !== spec.id) {
      throw new Error(`插件 id 漂移：${pj} 声明 ${manifest.id}，冻结契约要求 ${spec.id}`);
    }
    const version = manifest.version;
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error(`插件 ${spec.id} 缺少 version`);
    }
    if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
      throw new Error(`插件 ${spec.id} 缺少 name（D14.2 必填）`);
    }
    pluginEntries.push({ spec, dir, manifest, version });
    log(`插件：${spec.id}（${manifest.name}）v${version} ← apps/plugins/${spec.relDir.join('/')}`);
  }

  // ---- 2) 输出目录：创建 + 清除旧产物（幂等，不残留旧版本 zip）----
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stale = fs.readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.zip'));
  for (const f of stale) {
    fs.rmSync(path.join(OUT_DIR, f), { force: true });
    log(`清除旧 zip：${f}`);
  }

  // ---- 3) 应用本体 zip（payload/app-server + apps/web/dist，包根相对路径）----
  const appZipName = `novelmuse-app-${appVersion}.zip`;
  const appZip = buildZip(path.join(OUT_DIR, appZipName), [
    { dir: APP_SERVER_DIR, prefix: 'app-server' },
    { dir: WEB_DIST_DIR, prefix: 'web-dist' },
  ]);

  // ---- 4) 5 个插件 zip（文件名用插件 id）----
  const builtPluginZips = [];
  for (const p of pluginEntries) {
    const zipName = `${p.spec.id}-${p.version}.zip`;
    const info = buildZip(path.join(OUT_DIR, zipName), [{ dir: p.dir, prefix: '' }]);
    builtPluginZips.push({ ...info, manifest: p.manifest });
  }

  // ---- 5) manifest.json（D14.2 字段，逐字；sha256 小写十六进制）----
  const publishedAt = resolvePublishedAt(appVersion);
  const manifest = {
    version: appVersion,
    notes: 'NovelMuse 桌面版发布包（应用本体 = server 负载 + 前端产物；插件为独立更新单元）。',
    publishedAt,
    app: { url: appZip.url, sha256: appZip.sha256 },
    plugins: builtPluginZips.map((z) => {
      const entry = {
        id: z.manifest.id,
        name: z.manifest.name,
        version: z.manifest.version,
        url: z.url,
        sha256: z.sha256,
      };
      if (typeof z.manifest.description === 'string' && z.manifest.description.trim() !== '') {
        entry.notes = z.manifest.description;
      }
      return entry;
    }),
  };
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log(`写出 manifest.json（version=${manifest.version} / plugins=${manifest.plugins.length}）`);

  // ---- 6) 自检（写回读 + sha256 复核 + entry 名终检）----
  const written = [appZip, ...builtPluginZips];
  const problems = [];
  const SHA_RE = /^[0-9a-f]{64}$/;
  if (!SHA_RE.test(manifest.app.sha256)) problems.push('app.sha256 非小写十六进制');
  for (const p of manifest.plugins) {
    if (!SHA_RE.test(p.sha256)) problems.push(`${p.id}.sha256 非小写十六进制`);
  }
  const table = [];
  for (const z of written) {
    const name = path.basename(z.path);
    const onDisk = sha256(fs.readFileSync(z.path));
    if (onDisk !== z.sha256) problems.push(`${name} 落盘后 sha256 不一致`);
    const reread = new AdmZip(z.path);
    for (const e of reread.getEntries()) {
      try {
        assertSafeEntryName(e.entryName);
      } catch (err) {
        problems.push(`${name} entry 违规：${err.message}`);
      }
    }
    table.push({
      文件: name,
      entry: reread.getEntries().length,
      文件数: z.fileCount,
      原始字节: z.rawBytes,
      zip字节: z.zipBytes,
      sha256: z.sha256,
    });
  }

  const names = fs.readdirSync(OUT_DIR).sort();
  const expectNames = ['manifest.json', appZipName, ...builtPluginZips.map((z) => path.basename(z.path))].sort();
  if (names.length !== expectNames.length || names.some((n, i) => n !== expectNames[i])) {
    problems.push(`release/updates/ 文件集合不符：${names.join(', ')}`);
  }

  console.log('');
  console.log('[update] ---------- release/updates/ 产物 ----------');
  console.table(table);
  console.log('[update] release/updates/ 内容：');
  for (const n of names) {
    console.log(`  ${n}  (${fs.statSync(path.join(OUT_DIR, n)).size} B)`);
  }
  console.log('[update] manifest.json：');
  console.log(JSON.stringify(manifest, null, 2));

  if (problems.length) {
    console.error('[update] 自检失败：');
    for (const p of problems) console.error(`  ✘ ${p}`);
    process.exitCode = 1;
    throw new Error(`自检失败 ${problems.length} 项`);
  }
  log('自检全部通过 ✔（entry 名 / sha256 / 文件集合）');
  log('OK');
}

main();
