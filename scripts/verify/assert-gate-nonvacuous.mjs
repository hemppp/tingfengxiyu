#!/usr/bin/env node
/**
 * scripts/verify/assert-gate-nonvacuous.mjs
 *
 * 证明「工作台隔离门禁」**非空转**（non-vacuous）。
 *
 * 空转风险：若门禁扫描根写错（如把 kernel 根整根跳过），未拆分状态也会「0 违规」假通过。
 * 本脚本把门禁脚本放到**未拆分基线**（备份 zip）上重跑三种模式，要求：
 *   1. 三模式（全量 / --without auto / --without manual）**全部 exit 1**（确实报错，不是空转通过）；
 *   2. 三模式的**文件数均 = 212**（= 基线 apps/web/src 下 .ts/.tsx 数；manual/auto 模块目录尚不存在，
 *      故任何模式下都只扫到 kernel 根这 212 个文件——证明扫描根覆盖完整、未误跳过 kernel）。
 * 任一条不满足 → 本脚本 exit 1。
 *
 * 用法：node scripts/verify/assert-gate-nonvacuous.mjs
 * 退出码：0 = 门禁非空转（三模式均按预期失败且文件数 212）；1 = 任一模式空转/文件数不符/环境缺失。
 *
 * 实现：用系统 `tar`（bsdtar，可读 zip）解包基线到临时目录，把当前门禁脚本复制进去，
 *       以临时目录为工作区跑门禁。门禁脚本只用 Node 内置模块，故临时区无需 node_modules。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GATE = path.join(HERE, 'verify-workbench-isolation.mjs');
const BASELINE = path.join(
  ROOT,
  '.workbuddy/split-workbenches/backup-baseline/baseline-20260929-235002.zip',
);
const EXPECT_FILES = 212;
const MODES = [
  { label: '全量', args: [] },
  { label: '--without auto', args: ['--without', 'auto'] },
  { label: '--without manual', args: ['--without', 'manual'] },
];

const die = (msg) => {
  console.error(`✗ 非空转校验失败：${msg}`);
  process.exit(1);
};

if (!fs.existsSync(BASELINE)) die(`基线备份不存在: ${BASELINE}`);
if (!fs.existsSync(GATE)) die(`门禁脚本不存在: ${GATE}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-nonvacuous-'));
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });

try {
  // 1) 解包未拆分基线（bsdtar 可读 zip）
  const ex = spawnSync('tar', ['-xf', BASELINE, '-C', tmp], { encoding: 'utf8' });
  if (ex.status !== 0) {
    die(`解包基线失败（tar exit ${ex.status}）: ${ex.stderr || ''}`);
  }
  if (!fs.existsSync(path.join(tmp, 'apps/web/src'))) {
    die(`基线解包后未见 apps/web/src（临时区: ${tmp}）`);
  }

  // 2) 把当前门禁脚本复制进临时工作区（门禁以自身位置推断 ROOT）
  fs.mkdirSync(path.join(tmp, 'scripts/verify'), { recursive: true });
  fs.copyFileSync(GATE, path.join(tmp, 'scripts/verify/verify-workbench-isolation.mjs'));
  const gateInTmp = path.join(tmp, 'scripts/verify/verify-workbench-isolation.mjs');

  // 3) 三模式重跑：必须全部失败 + 文件数 = 212
  console.log(`[非空转] 未拆分基线上重跑门禁三模式（要求全部 exit 1 且文件数 = ${EXPECT_FILES}）`);
  let ok = true;
  for (const { label, args } of MODES) {
    const r = spawnSync(process.execPath, [gateInTmp, ...args], { cwd: tmp, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const fm = out.match(/文件数:\s*(\d+)/);
    const files = fm ? Number(fm[1]) : NaN;
    const exitOk = r.status === 1;
    const filesOk = files === EXPECT_FILES;
    if (!exitOk || !filesOk) ok = false;
    console.log(
      `  ${exitOk && filesOk ? '✓' : '✗'} [${label}] exit=${r.status}（期望 1） 文件数=${Number.isFinite(files) ? files : '未解析'}（期望 ${EXPECT_FILES}）`,
    );
    if (!exitOk) {
      const tail = out.split(/\r?\n/).slice(-3).join(' | ');
      console.log(`      末行: ${tail}`);
    }
  }

  if (!ok) {
    console.error(
      '\n✗ 门禁疑似**空转**：未拆分基线上存在未按预期失败 / 文件数不符的模式（见上）。',
    );
    cleanup();
    process.exit(1);
  }
  console.log(`\n✓ 门禁非空转：三模式在未拆分基线上均 exit 1 且文件数均为 ${EXPECT_FILES}。`);
  cleanup();
  process.exit(0);
} catch (err) {
  cleanup();
  die(`异常: ${err && err.message ? err.message : String(err)}`);
}
