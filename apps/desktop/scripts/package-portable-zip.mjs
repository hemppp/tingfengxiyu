#!/usr/bin/env node
/**
 * 打包「标准便携版」zip（D4.4，2026-10-06）
 * ========================================
 *
 * 产物：release/desktop/NovelMuse-Portable-<version>-x64.zip
 * 形态：解压得到一个 NovelMuse/ 顶层目录，进去双击 NovelMuse.exe 即可运行。
 *
 * 为什么不直接用 electron-builder 的 `zip` target：
 *   它的 zip 是**平铺**的（6273 个文件直接铺在压缩包根），用户解压会把
 *   Downloads 目录炸成一片；而标准绿色便携版应有一个顶层文件夹。
 *   所以这里自己打：electron-builder 只负责产出 win-unpacked/，
 *   本脚本负责加壳（顶层目录 + 使用说明.txt）再压缩。
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
 *   压缩包内含 `使用说明.txt`。bsdtar 默认按本地 ANSI（GBK）写 zip 条目名，
 *   且**不设**语言编码标志位（general purpose bit 11）⇒ 用 UTF-8 解压的
 *   第三方工具（7-Zip、Bandizip、macOS 归档实用工具等）会显示成乱码。
 *   故显式加 `--options hdrcharset=UTF-8`（条目名按 UTF-8 编码 + 置 0x0800 位）。
 *   打完包后脚本会**回读校验**该标志位，不通过直接失败。
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
const zipName = `${productName}-Portable-${version}-x64.zip`;
const zipPath = path.join(outDir, zipName);
const TOP_DIR = productName;
const README_NAME = '使用说明.txt';

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

if (!fs.existsSync(path.join(unpackedDir, `${productName}.exe`))) {
  fail(
    `未找到 ${path.relative(repoRoot, unpackedDir)}\\${productName}.exe。\n` +
      '  请先执行：pnpm exec electron-builder --win --x64 --dir',
  );
}

const README = `听风细雨（NovelMuse）便携版 v${version}
=====================================

【怎么用】
1. 把整个 ${TOP_DIR} 文件夹解压到任意位置（建议非系统盘，例如 D:\\${TOP_DIR}）。
   注意：要解压，不要在压缩包里直接双击运行。
2. 进入 ${TOP_DIR} 文件夹，双击 ${productName}.exe 即可运行。
3. 不需要安装，不会写入注册表，删除文件夹即可卸载。

【第一次启动会慢一点】
首次运行需要把内置的服务端解压到用户数据目录，大约需要 1~2 分钟，
期间窗口可能短暂空白，请不要关闭，耐心等待即可。之后就快了。

【默认管理员账号】
用户名：admin
密码：  Admin1234!
（首次登录后建议尽快在「管理员后台」里改掉密码。）

【数据放在哪】
程序数据（数据库、插件、日志）保存在：
    %APPDATA%\\${productName}
即  C:\\Users\\<你的用户名>\\AppData\\Roaming\\${productName}

这样做的好处：升级时直接解压新版本覆盖文件夹，原来的书稿和设置都不会丢。
如果要彻底清空，删掉上面那个文件夹即可（请先备份 data 子目录）。

【系统要求】
- Windows 10 / 11 64 位
- 无需预装 Node.js 或数据库

【版本】
${productName} ${version}（听风细雨）
`;

console.log(`▸ 源目录：${path.relative(repoRoot, unpackedDir)}`);

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'novelmuse-portable-'));
const stageTop = path.join(stageRoot, TOP_DIR);
try {
  console.log('▸ 复制到干净暂存区（顺带剥离仓库树 ACL）…');
  fs.cpSync(unpackedDir, stageTop, { recursive: true, force: true });

  fs.writeFileSync(path.join(stageTop, README_NAME), README, 'utf8');

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

  assertUtf8EntryName(zipPath, README_NAME);
  console.log(`▸ 编码校验：${README_NAME} 以 UTF-8 存储（bit 11 已置位）✓`);

  const stat = fs.statSync(zipPath);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  console.log('');
  console.log(`✔ 完成：${zipName}`);
  console.log(`  体积   ：${stat.size} B（${(stat.size / 1024 / 1024).toFixed(2)} MB）`);
  console.log(`  耗时   ：${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`  SHA256 ：${sha}`);
  console.log(`  用法   ：解压 → 进 ${TOP_DIR}/ → 双击 ${productName}.exe`);
} finally {
  fs.rmSync(stageRoot, { recursive: true, force: true });
}
