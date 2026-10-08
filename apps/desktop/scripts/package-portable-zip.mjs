#!/usr/bin/env node
/**
 * 打包「标准便携版」zip（D4.4，2026-10-06；便携运行时预置 2026-10-08）
 * ================================================================
 *
 * 产物：release/desktop/NovelMuse-Portable-<version>-x64.zip
 * 形态：解压得到一个 NovelMuse/ 顶层目录，进去双击「启动便携版.cmd」即运行。
 *
 * 两种运行方式（同一份产物，用户自选）：
 *   ① 「启动便携版.cmd」—— 向 Electron 传
 *      `--user-data-dir=<解压目录>\portable-data`，于是数据库、插件、日志、
 *      缓存全部落在**本文件夹内**（真正的绿色便携，不写 %APPDATA%）。
 *      且 zip 内已**预置播种好的运行时** ⇒ 首启零等待（无需再复制 76 MB）。
 *   ② 直接双击 NovelMuse.exe —— 退回传统模式：数据在 %APPDATA%\<产品名>，
 *      首启需要 D7.2 播种（实测约 12 s）。
 *
 * 预置的 portable-data/ 必须与 resources/ **逐字一致**，否则启动时
 * `shouldReseed()` 会判成 `payload-changed` 而重新播种、白等一场：
 *   portable-data/app-runtime/app-server   ← resources/app-server
 *   portable-data/app-runtime/web-dist     ← resources/web-dist
 *   portable-data/app-runtime/version.json { appVersion, updatedAt, buildId }
 *   portable-data/plugins/{auto,manual,shared} ← resources/seed-plugins/*
 *   portable-data/plugins/local            （空目录，D7.2 步骤 4）
 *
 * ★ `version.json` 的 `buildId` **必须**取自 resources/app-server/build-stamp.json，
 *   `appVersion` 必须等于 apps/desktop 的 version —— 二者与 D7.5 的闸门同源。
 *   （`shouldReseed()`：version.json 缺失 ⇒ missing；版本更高 ⇒ shell-newer；
 *    同版本但指纹不同 ⇒ payload-changed。三者都不命中才跳过播种。）
 *
 * 为什么不直接用 electron-builder 的 `zip` target：
 *   它的 zip 是**平铺**的（6273 个文件直接铺在压缩包根），用户解压会把
 *   Downloads 目录炸成一片；而标准绿色便携版应有一个顶层文件夹。
 *   所以这里自己打：electron-builder 只负责产出 win-unpacked/，
 *   本脚本负责加壳（顶层目录 + 使用说明.txt + 启动器 + 便携运行时）再压缩。
 *
 * 为什么先复制到临时目录再压：
 *   直接对 release/desktop/win-unpacked 打包会连带把该目录上的 ACL 一起带走。
 *   在受限/沙箱环境里仓库树会被注入低完整性标签，解压后的副本会因此启动失败
 *   （Electron 加载 V8 snapshot 时 CHECK 失败，EXCEPTION_BREAKPOINT）。
 *   复制到 %TEMP% 再压，产出的 zip 里条目权限是干净的标准 ACL。
 *
 * 前置：先跑 `pnpm exec electron-builder --win --x64 --dir` 生成 win-unpacked/。
 *
 * 中文文件名必须走 UTF-8（踩坑记录）：
 *   压缩包内含 `使用说明.txt` 与 `启动便携版.cmd`。bsdtar 默认按本地 ANSI（GBK）
 *   写 zip 条目名，且**不设**语言编码标志位（general purpose bit 11）⇒ 用 UTF-8
 *   解压的第三方工具（7-Zip、Bandizip、macOS 归档实用工具等）会显示成乱码。
 *   故显式加 `--options hdrcharset=UTF-8`（条目名按 UTF-8 编码 + 置 0x0800 位）。
 *   打完包后脚本会**逐个回读校验**这些中文条目名，不通过直接失败。
 *
 * 用法：node scripts/package-portable-zip.mjs
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');

const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const version = pkg.version;
const productName = pkg.build?.productName ?? 'NovelMuse';

const outDir = path.join(repoRoot, 'release', 'desktop');
const unpackedDir = path.join(outDir, 'win-unpacked');
const resourcesDir = path.join(unpackedDir, 'resources');
const zipName = `${productName}-Portable-${version}-x64.zip`;
const zipPath = path.join(outDir, zipName);
const TOP_DIR = productName;
const README_NAME = '使用说明.txt';
const LAUNCHER_NAME = '启动便携版.cmd';
const PORTABLE_DIR = 'portable-data';
const SEED_MODES = ['auto', 'manual', 'shared'];

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/**
 * 回读 zip 中央目录，确认指定条目名以 UTF-8 存储（general purpose bit 11 置位）。
 * bsdtar 默认按 GBK 写条目名且不置该位，会让第三方解压工具显示乱码。
 */
function assertUtf8EntryName(zipFile, entryName) {
  const buf = fs.readFileSync(zipFile);
  const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]); // PK\x01\x02 中央目录头
  let idx = buf.lastIndexOf(sig);
  let seen = false;
  while (idx >= 0) {
    const flag = buf.readUInt16LE(idx + 8);
    const nameLen = buf.readUInt16LE(idx + 28);
    const raw = buf.subarray(idx + 46, idx + 46 + nameLen);
    if (raw.toString('utf8') === `${TOP_DIR}/${entryName}`) {
      seen = true;
      if (!(flag & 0x0800)) {
        fail(
          `zip 条目「${entryName}」未置 UTF-8 标志位（flag=0x${flag.toString(16).padStart(4, '0')}）。\n` +
            '  中文名会被第三方解压工具显示为乱码；请确认 tar 调用带 `--options hdrcharset=UTF-8`。',
        );
      }
      break;
    }
    idx = buf.lastIndexOf(sig, idx - 1);
  }
  if (!seen) fail(`zip 中未找到条目「${TOP_DIR}/${entryName}」`);
}

/** 回读 zip 中央目录，确认某个（ASCII）条目存在。 */
function assertEntryExists(zipFile, entryName) {
  const buf = fs.readFileSync(zipFile);
  const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const needle = Buffer.from(`${TOP_DIR}/${entryName}`, 'utf8');
  let idx = buf.lastIndexOf(sig);
  while (idx >= 0) {
    const nameLen = buf.readUInt16LE(idx + 28);
    if (buf.subarray(idx + 46, idx + 46 + nameLen).equals(needle)) return;
    idx = buf.lastIndexOf(sig, idx - 1);
  }
  fail(`zip 中未找到条目「${TOP_DIR}/${entryName}」（便携运行时预置不完整）`);
}

if (!fs.existsSync(path.join(unpackedDir, `${productName}.exe`))) {
  fail(
    `未找到 ${path.relative(repoRoot, unpackedDir)}\\${productName}.exe。\n` +
      '  请先执行：pnpm exec electron-builder --win --x64 --dir',
  );
}

// ── 读载荷指纹（D7.5）：portable-data/app-runtime/version.json 的 buildId 必须与它一致 ──
const stampPath = path.join(resourcesDir, 'app-server', 'build-stamp.json');
if (!fs.existsSync(stampPath)) {
  fail(
    `未找到 ${path.relative(repoRoot, stampPath)}。\n` +
      '  载荷生成器应写入该文件；请先执行：node scripts/build-server-payload.mjs',
  );
}
let buildId;
try {
  buildId = JSON.parse(fs.readFileSync(stampPath, 'utf8')).buildId;
} catch (error) {
  fail(`解析 build-stamp.json 失败：${error.message}`);
}
if (typeof buildId !== 'string' || buildId.length === 0) {
  fail('build-stamp.json 缺少 buildId 字段。');
}

const README = `听风细雨（NovelMuse）便携版 v${version}
=====================================

【怎么用】
1. 把整个 ${TOP_DIR} 文件夹解压到任意位置（建议非系统盘，例如 D:\\${TOP_DIR}）。
   注意：要解压，不要在压缩包里直接双击运行。
2. 进入 ${TOP_DIR} 文件夹，双击「${LAUNCHER_NAME}」即可运行（推荐）。
3. 不需要安装，不会写入注册表，删除文件夹即可卸载。

【两种运行方式】
· 双击「${LAUNCHER_NAME}」—— 便携模式（推荐）
  书稿、插件、日志、设置全部保存在本文件夹内的 ${PORTABLE_DIR}\\ 里，
  真正「拷走文件夹就是拷走全部」。不写系统盘的用户目录。
· 直接双击 ${productName}.exe —— 传统模式
  数据保存在 %APPDATA%\\${productName}（即 C:\\Users\\<你的用户名>\\AppData\\Roaming\\${productName}），
  与安装版一致，升级时覆盖文件夹即可保留书稿。
两种模式的数据**互相独立**，不要混用；选定一种后请一直用它启动。

【第一次启动快不快】
· 便携模式：**无需等待**。运行时已随包预置在 ${PORTABLE_DIR}\\ 内，
  启动即可用（不会再把内置服务端解压一遍）。
· 传统模式：首启需要把内置服务端释放到用户数据目录，约 10~20 秒，
  期间窗口可能短暂空白，请不要关闭，耐心等待即可。之后就快了。

【第一次登录】
管理员用户名固定为：admin
密码是**首次启动时随机生成**的：启动后会弹出一个一次性对话框显示它，
同时写入数据目录下的 logs\\initial-admin-password.txt。
请登录后立即在「管理员后台」修改密码。
（不预置固定口令是安全设计 —— 避免人人可登录管理员。）

【数据放在哪】
· 便携模式：${TOP_DIR}\\${PORTABLE_DIR}\\data\\novelmuse.db（外加 data\\projects\\ 里的各项目库）
  管理员初始密码：${TOP_DIR}\\${PORTABLE_DIR}\\logs\\initial-admin-password.txt
· 传统模式：%APPDATA%\\${productName}\\data\\novelmuse.db
  管理员初始密码：%APPDATA%\\${productName}\\logs\\initial-admin-password.txt
要彻底清空，删掉对应的 data 目录即可（请先备份）。

【想把以前的书稿搬进来】
把旧的 %APPDATA%\\${productName}\\data 整个目录，覆盖到
    ${TOP_DIR}\\${PORTABLE_DIR}\\data
然后重启即可（先关掉程序再复制）。

【磁盘占用】
解压后约 583 MB（含便携模式预置的运行时约 93 MB；因此便携模式启动时
不会再额外复制一份到用户目录）。传统模式会在 %APPDATA% 下再占约 76 MB。

【系统要求】
- Windows 10 / 11 64 位
- 无需预装 Node.js 或数据库

【版本】
${productName} ${version}（听风细雨）
`;

/** 便携模式启动器：把 userData 钉在本文件夹的 portable-data 上。 */
const LAUNCHER = [
  '@echo off',
  'rem NovelMuse 便携版启动器：数据目录 = 本文件夹 portable-data（数据随身，不写 APPDATA）。',
  'setlocal',
  'set "HERE=%~dp0"',
  `if not exist "%HERE%${productName}.exe" (`,
  `  echo [错误] 未找到 ${productName}.exe，请确认已完整解压本文件夹。`,
  '  pause',
  '  exit /b 1',
  ')',
  `start "" "%HERE%${productName}.exe" --user-data-dir="%HERE%${PORTABLE_DIR}"`,
  '',
].join('\r\n');

console.log(`▸ 源目录：${path.relative(repoRoot, unpackedDir)}`);
console.log(`▸ 载荷指纹：${buildId}`);

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'novelmuse-portable-'));
const stageTop = path.join(stageRoot, TOP_DIR);
try {
  console.log('▸ 复制到干净暂存区（顺带剥离仓库树 ACL）…');
  fs.cpSync(unpackedDir, stageTop, { recursive: true, force: true });

  // ── 预置便携运行时（免首启播种）────────────────────────────
  console.log(`▸ 预置便携运行时 ${PORTABLE_DIR}/（免首启播种）…`);
  const pd = path.join(stageTop, PORTABLE_DIR);
  const pdRuntime = path.join(pd, 'app-runtime');
  fs.mkdirSync(pdRuntime, { recursive: true });

  fs.cpSync(path.join(resourcesDir, 'app-server'), path.join(pdRuntime, 'app-server'), {
    recursive: true,
    force: true,
  });
  fs.cpSync(path.join(resourcesDir, 'web-dist'), path.join(pdRuntime, 'web-dist'), {
    recursive: true,
    force: true,
  });

  fs.writeFileSync(
    path.join(pdRuntime, 'version.json'),
    `${JSON.stringify(
      { appVersion: version, updatedAt: new Date().toISOString(), buildId },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const pdPlugins = path.join(pd, 'plugins');
  fs.mkdirSync(path.join(pdPlugins, 'local'), { recursive: true });
  for (const mode of SEED_MODES) {
    const src = path.join(resourcesDir, 'seed-plugins', mode);
    if (!fs.existsSync(src)) {
      console.warn(`  ⚠ 缺少 resources/seed-plugins/${mode}（跳过）`);
      continue;
    }
    fs.cpSync(src, path.join(pdPlugins, mode), { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(stageTop, README_NAME), README, 'utf8');
  fs.writeFileSync(path.join(stageTop, LAUNCHER_NAME), LAUNCHER, 'utf8');

  fs.rmSync(zipPath, { force: true });
  console.log(`▸ 压缩 → ${path.relative(repoRoot, zipPath)}`);
  const t0 = Date.now();
  const r = spawnSync(
    'tar',
    ['-c', '-f', zipPath, '--format=zip', '--options', 'hdrcharset=UTF-8', TOP_DIR],
    { cwd: stageRoot, stdio: 'inherit' },
  );
  if (r.error) fail(`调用 tar 失败：${r.error.message}（Windows 10+ 自带 bsdtar）`);
  if (r.status !== 0) fail(`tar 退出码 ${r.status}`);

  for (const name of [README_NAME, LAUNCHER_NAME]) {
    assertUtf8EntryName(zipPath, name);
    console.log(`▸ 编码校验：${name} 以 UTF-8 存储（bit 11 已置位）✓`);
  }
  assertEntryExists(zipPath, `${PORTABLE_DIR}/app-runtime/version.json`);
  assertEntryExists(zipPath, `${PORTABLE_DIR}/app-runtime/app-server/build-stamp.json`);
  assertEntryExists(zipPath, `${PORTABLE_DIR}/plugins/manual/workbench/package.json`);
  console.log(`▸ 预置校验：${PORTABLE_DIR}/ 运行时与插件条目齐备 ✓`);

  const stat = fs.statSync(zipPath);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  console.log('');
  console.log(`✔ 完成：${zipName}`);
  console.log(`  体积   ：${stat.size} B（${(stat.size / 1024 / 1024).toFixed(2)} MB）`);
  console.log(`  耗时   ：${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`  SHA256 ：${sha}`);
  console.log(`  用法   ：解压 → 进 ${TOP_DIR}/ → 双击「${LAUNCHER_NAME}」`);
} finally {
  fs.rmSync(stageRoot, { recursive: true, force: true });
}
