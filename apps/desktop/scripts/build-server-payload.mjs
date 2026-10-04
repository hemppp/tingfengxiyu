#!/usr/bin/env node
/**
 * ADR-0008 D4.2 冻结的 server 负载生成器（Mode B：tsx + 真实 TS 文件）。
 *
 * 用法（在 F:\new1.2 执行）：
 *     node apps/desktop/scripts/build-server-payload.mjs
 *
 * 产出（确定性、幂等）：
 *     apps/desktop/payload/app-server/             → extraResources → resources/app-server/
 *     apps/desktop/payload/seed-plugins/{auto,manual,shared}/  → extraResources → resources/seed-plugins/
 *
 * 负载内容（D4.2 冻结清单）：
 *   app-server/apps/server/src/**                  server 全部 TS 源码
 *   app-server/packages/{core,db,shared}/**        workspace 包 src + package.json（+ db 的 drizzle/）
 *   app-server/packages/db/drizzle/**              迁移 SQL 与 meta
 *   app-server/node_modules/@novel/{core,db,shared} 实体副本（解引用 junction）
 *   app-server/node_modules/@novel-plugins/worldbuilding  实体副本（builtin.ts:55-65 的动态 import 目标）
 *   app-server/node_modules/<第三方闭包>           运行期依赖闭包（确定性闭包计算，非整目录拷贝）
 *   app-server/node_modules/tsx                     Mode B 的 TS 加载器
 *   app-server/pnpm-workspace.yaml                  仓库根同名文件逐字副本（4 处路径解析依赖该标记）
 *   seed-plugins/{auto,manual,shared}/**            5 个磁盘插件（不含 node_modules）
 *
 * 明确排除（D4.2）：
 *   - apps/plugins/**\/node_modules/**
 *   - better-sqlite3 实体（由主进程在运行期建 junction 指向 resources/app.asar.unpacked，
 *     见 D8.2；此处只保留其在 package.json 里的声明，不投递可能 ABI 错误的副本）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');           // F:\new1.2
const DESKTOP = path.resolve(REPO, 'apps', 'desktop');
const PAYLOAD = path.join(DESKTOP, 'payload');
const APP_SERVER = path.join(PAYLOAD, 'app-server');
const SEED = path.join(PAYLOAD, 'seed-plugins');
const ROOT_NM = path.join(REPO, 'node_modules');

const log = (...a) => console.log('[payload]', ...a);

// ---------------------------------------------------------------- utils

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/** 复制目录，解引用符号链接/junction（Windows 上 workspace 包是 junction）。 */
function copyDir(src, dest, filter) {
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
    filter: filter ? (s) => filter(s) : undefined,
  });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function exists(p) {
  return fs.existsSync(p);
}

/** 解析一个包名到根 node_modules 下的实体目录；找不到返回 null。 */
function resolvePkgDir(name) {
  const p = path.join(ROOT_NM, name);
  return exists(path.join(p, 'package.json')) ? p : null;
}

// ---------------------------------------------------------------- 依赖闭包

/**
 * 需要投递的「根依赖集合」——server 运行期直接依赖 + 插件 server 侧依赖 + Mode B 加载器。
 * 全部从各 package.json 的 dependencies / optionalDependencies 读取，避免硬编码漂移。
 */
function collectRootDeps() {
  const roots = new Set();
  const addFrom = (pkgJsonPath) => {
    if (!exists(pkgJsonPath)) return;
    const j = readJson(pkgJsonPath);
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(j[field] ?? {})) {
        // workspace:* 由 packages/ 与 node_modules/@novel 的实体副本单独投递
        if (typeof range === 'string' && range.startsWith('workspace:')) continue;
        roots.add(name);
      }
    }
  };

  addFrom(path.join(REPO, 'apps', 'server', 'package.json'));
  for (const p of ['core', 'db', 'shared']) {
    addFrom(path.join(REPO, 'packages', p, 'package.json'));
  }
  // builtin.ts 的动态 import 目标（D4.3 #3–23 第 21 条）
  addFrom(path.join(REPO, 'apps', 'plugins', 'manual', 'worldbuilding', 'package.json'));
  // 5 个磁盘插件的 server 侧入口（F13：依赖 <PLUGINS_ROOT>/node_modules 才能解析 hono）
  for (const rel of [
    ['auto', 'novel.autowrite'],
    ['auto', 'workbench'],
    ['manual', 'novel.bookscan'],
    ['manual', 'workbench'],
    ['shared', 'typography'],
  ]) {
    addFrom(path.join(REPO, 'apps', 'plugins', rel[0], rel[1], 'package.json'));
  }

  // Mode B 的 TS 加载器（D4.2 冻结：tsx 必须随负载投递）
  roots.add('tsx');

  return roots;
}

/** 广度优先展开传递依赖闭包（只走 dependencies / optionalDependencies）。 */
function expandClosure(roots) {
  const closure = new Map(); // name -> dir
  const queue = [...roots];
  const missing = new Set();

  while (queue.length) {
    const name = queue.shift();
    if (closure.has(name)) continue;
    const dir = resolvePkgDir(name);
    if (!dir) {
      missing.add(name);
      closure.set(name, null);
      continue;
    }
    closure.set(name, dir);
    const j = readJson(path.join(dir, 'package.json'));
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dep, range] of Object.entries(j[field] ?? {})) {
        if (typeof range === 'string' && range.startsWith('workspace:')) continue;
        if (!closure.has(dep)) queue.push(dep);
      }
    }
  }
  return { closure, missing };
}

// ---------------------------------------------------------------- main

function main() {
  if (!exists(path.join(REPO, 'pnpm-workspace.yaml'))) {
    throw new Error('仓库根缺少 pnpm-workspace.yaml');
  }

  log('清理旧负载 …');
  rmrf(PAYLOAD);
  fs.mkdirSync(APP_SERVER, { recursive: true });

  // ---- 1) server TS 源码 ----
  const serverSrc = path.join(REPO, 'apps', 'server', 'src');
  const destServerSrc = path.join(APP_SERVER, 'apps', 'server', 'src');
  fs.mkdirSync(path.dirname(destServerSrc), { recursive: true });
  copyDir(serverSrc, destServerSrc);
  log('apps/server/src → app-server/apps/server/src');

  // server 的 package.json（tsx 需要按包边界解析 "type":"module"）
  copyDir(
    path.join(REPO, 'apps', 'server', 'package.json'),
    path.join(APP_SERVER, 'apps', 'server', 'package.json'),
  );

  // ---- 2) packages/{core,db,shared}（含 drizzle 迁移）----
  const destNm = path.join(APP_SERVER, 'node_modules');
  fs.mkdirSync(path.join(destNm, '@novel'), { recursive: true });

  for (const p of ['core', 'db', 'shared']) {
    const from = path.join(REPO, 'packages', p);
    copyDir(from, path.join(APP_SERVER, 'packages', p));
    copyDir(from, path.join(destNm, '@novel', p));
    log(`packages/${p} → app-server/packages/${p} + node_modules/@novel/${p}`);
  }

  // packages/db/drizzle 必须存在（better-sqlite3-adapter.ts:488 / project-db.ts:172-173）
  const drizzle = path.join(APP_SERVER, 'packages', 'db', 'drizzle');
  if (!exists(drizzle)) throw new Error('packages/db/drizzle 未投递成功');
  const drizzleFiles = fs.readdirSync(drizzle, { recursive: true }).length;
  log(`packages/db/drizzle 就位（${drizzleFiles} 个条目）`);

  // ---- 3) builtin 插件的实体副本：@novel-plugins/worldbuilding ----
  const wbSrc = path.join(REPO, 'apps', 'plugins', 'manual', 'worldbuilding');
  if (!exists(path.join(wbSrc, 'package.json'))) throw new Error('worldbuilding 插件源缺失');
  fs.mkdirSync(path.join(destNm, '@novel-plugins'), { recursive: true });
  copyDir(
    wbSrc,
    path.join(destNm, '@novel-plugins', 'worldbuilding'),
    (s) => !s.includes(`${path.sep}node_modules`),
  );
  log('apps/plugins/manual/worldbuilding → app-server/node_modules/@novel-plugins/worldbuilding');

  // ---- 4) 第三方依赖闭包 ----
  const roots = collectRootDeps();
  const { closure, missing } = expandClosure(roots);

  // better-sqlite3 不投递实体：由主进程运行期建 junction → resources/app.asar.unpacked（D8.2）
  const EXCLUDE_FROM_PAYLOAD = new Set(['better-sqlite3']);

  const copied = [];
  for (const [name, dir] of closure) {
    if (!dir) continue;
    if (EXCLUDE_FROM_PAYLOAD.has(name)) {
      log(`跳过 ${name}（D8.2：由主进程运行期建 junction 指向 app.asar.unpacked）`);
      continue;
    }
    copyDir(dir, path.join(destNm, name));
    copied.push(name);
  }

  const unresolved = [...missing].filter((m) => !EXCLUDE_FROM_PAYLOAD.has(m));
  if (unresolved.length) {
    log(`⚠ 未在根 node_modules 解析到的依赖（${unresolved.length}）：${unresolved.join(', ')}`);
  }

  // ---- 5) pnpm-workspace.yaml 逐字副本（F11：4 处路径解析依赖该标记）----
  fs.copyFileSync(
    path.join(REPO, 'pnpm-workspace.yaml'),
    path.join(APP_SERVER, 'pnpm-workspace.yaml'),
  );
  log('pnpm-workspace.yaml → app-server/pnpm-workspace.yaml');

  // ---- 6) seed-plugins：5 个磁盘插件（排除 node_modules）----
  for (const rel of [
    ['auto', 'novel.autowrite'],
    ['auto', 'workbench'],
    ['manual', 'novel.bookscan'],
    ['manual', 'workbench'],
    ['shared', 'typography'],
  ]) {
    const from = path.join(REPO, 'apps', 'plugins', rel[0], rel[1]);
    const to = path.join(SEED, rel[0], rel[1]);
    copyDir(from, to, (s) => !s.includes(`${path.sep}node_modules`));
    log(`seed-plugins/${rel[0]}/${rel[1]}`);
  }

  // ---- 7) 自检 ----
  const checks = [
    ['server 入口', path.join(APP_SERVER, 'apps', 'server', 'src', 'index.ts')],
    ['@novel/db 实体', path.join(destNm, '@novel', 'db', 'src', 'index.ts')],
    ['drizzle 迁移', path.join(drizzle, '0000_common_lester.sql')],
    ['worldbuilding 实体', path.join(destNm, '@novel-plugins', 'worldbuilding', 'src', 'server', 'index.ts')],
    ['tsx 加载器', path.join(destNm, 'tsx', 'dist', 'cli.mjs')],
    ['sql.js wasm（D9 冻结 659730 B）', path.join(destNm, 'sql.js', 'dist', 'sql-wasm.wasm')],
    ['hono（插件依赖，F13）', path.join(destNm, 'hono', 'package.json')],
    ['drizzle-orm', path.join(destNm, 'drizzle-orm', 'package.json')],
    ['pnpm-workspace.yaml 标记', path.join(APP_SERVER, 'pnpm-workspace.yaml')],
    ['seed 插件 plugin.json ×1', path.join(SEED, 'manual', 'novel.bookscan', 'plugin.json')],
  ];
  const failed = [];
  for (const [label, p] of checks) {
    const ok = exists(p);
    log(`自检 ${ok ? '✔' : '✘'} ${label}: ${path.relative(REPO, p)}`);
    if (!ok) failed.push(label);
  }
  if (failed.length) throw new Error('负载自检失败: ' + failed.join(', '));

  // ---- 8) 体积统计 ----
  const stat = (dir) => {
    let bytes = 0;
    let files = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.isFile()) {
          bytes += fs.statSync(fp).size;
          files++;
        }
      }
    };
    walk(dir);
    return { bytes, files };
  };

  const pkgCount = fs.readdirSync(destNm, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  const scoped = fs
    .readdirSync(destNm, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('@'))
    .reduce((n, e) => n + fs.readdirSync(path.join(destNm, e.name)).length, 0);
  const total = stat(APP_SERVER);
  const seedStat = stat(SEED);

  log('---------------------------------------------');
  log(`第三方闭包投递包数: ${copied.length}（顶层目录 ${pkgCount} + scoped 展开 ${scoped}）`);
  log(`app-server 体积: ${total.bytes} B / ${total.files} 文件`);
  log(`seed-plugins 体积: ${seedStat.bytes} B / ${seedStat.files} 文件`);
  log('OK');
}

main();