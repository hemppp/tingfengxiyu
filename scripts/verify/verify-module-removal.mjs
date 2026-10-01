#!/usr/bin/env node
/**
 * scripts/verify/verify-module-removal.mjs
 *
 * 「任一模块缺席另一模块仍可用」的**唯一合格证据**（D44-1）。
 *
 * 为什么不用门禁的「0 违规」：门禁是**静态规则匹配**，规则本身可失明
 *   （t6-F2 实测：`export … from` 不被 `IMPORT_RE` 识别 + 相对路径域判定落空 ⇒ 双重假阴性）。
 * 本脚本改为**端到端可执行事实**：真实把模块目录移走，在该状态下跑
 *   type-check / build / test，再用 `finally` 无条件还原。事实不可伪造。
 *
 * ⚠️ **本脚本禁止并发运行**（D47 补充事实，实测踩过）：
 *   运行期间模块目录会被 `renameSync` 移走再还原。若同时有第二个进程在跑
 *   （本脚本或任何读模块目录的验证），它会落在「模块已移走」的窗口内，读到
 *   **错误的基线/移除态**。实测假象：并发时曾读到「基线 12 文件 / 170 通过」，
 *   一度被误判为「测试被删」——真值是 14 文件 / 182 通过；12 = 14 − manual 的 2 个
 *   测试文件，170 = 182 − 12。凡见此现象，先确认是否并发。
 *   本脚本已加跨进程互斥锁（见下方 LOCK 段）从机制上杜绝该假象；
 *   其它脚本/t30 复验请**串行**执行。
 *
 * 用法：
 *   node scripts/verify/verify-module-removal.mjs              # auto + manual 各跑一次
 *   node scripts/verify/verify-module-removal.mjs --module auto
 *   node scripts/verify/verify-module-removal.mjs --module manual
 *
 * 每个模块须同时满足（四条证据缺一不可，D44 升级版 + t29 契约第 1 条 (a1)/(a2)）：
 *   (a1) `pnpm --filter @novel/web type-check` exit 0；
 *       ★ 覆盖范围诚实说明：`@novel/web` 的 tsconfig `include: ["src"]`，实测
 *       `--listFiles` 中 `plugins/{auto,manual}/workbench` 命中 **0** 个
 *       ⇒ 本步**只覆盖 kernel + shared**，**看不见模块内部**的类型错误。
 *       脚本会打印实测覆盖数（模块内 N 个 / shared M 个）以免误读。
 *   (a2) **在场模块的内部** type-check exit 0：跑
 *       `apps/plugins/<mod>/workbench/tsconfig.typecheck.json`
 *       （include 模块 `web/**`+`stores/**`，**exclude 测试文件** —— 本仓
 *       `apps/web/tsconfig.json` 的 `types` 未含 `@testing-library/jest-dom`，
 *       纳入测试文件会冒出约 50 条 `TS2339: toBeInTheDocument does not exist` 噪声，
 *       属既有配置缺口非真缺陷）。此步使**模块内部**也进图，补 (a1) 的盲区。
 *   (b) `pnpm --filter @novel/web build` exit 0 **且输出无 `[vite:load-fallback]`/ENOENT**
 *       —— 硬编码模块入口说明符会让 vite 在 load-fallback 阶段硬失败，type-check 看不见；
 *   (c) `pnpm --filter @novel/web test` exit 0 且
 *       · **收集到的测试文件数 == 树中现存的测试文件数**（防 vitest 对不存在目录静默匹配 0 文件的空转），
 *       · **通过用例数 == 182 − 该模块自身用例数**（减数**实测**得出，不硬编码猜测；
 *         模块被移走时它自带的测试也随之消失，故固定阈值 182 数学上不可达）。
 * 还原后须校验目录**文件数 + 总字节数**与移走前逐字节一致，并复跑 type-check。
 *
 * 退出码：0 = 全部满足；1 = 任一断言失败；2 = 参数/环境错误（含**并发锁被占用**）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/* ------------------------------------------------------------------ argv */
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i < 0 ? null : argv[i + 1] ?? '';
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      '模块移除验证（可分离性唯一合格证据）· 用法：',
      '  node scripts/verify/verify-module-removal.mjs [--module auto|manual]',
      '',
      '对每个模块：真实移走其 workbench 目录 → type-check + build + test → finally 还原。',
      '断言：(a) type-check exit 0；(b) build exit 0 且无 [vite:load-fallback] ENOENT；',
      '      (c) test exit 0 + 收集文件数==现存测试文件数 + 通过数==182−该模块自身用例数（实测）。',
    ].join('\n'),
  );
  process.exit(0);
}
const ONLY = argOf('--module');
if (ONLY !== null && !['manual', 'auto'].includes(ONLY)) {
  console.error(`[移除验证] --module 只接受 manual|auto，收到: ${ONLY === '' ? '(空)' : ONLY}`);
  process.exit(2);
}

/* ======================= 跨进程互斥锁（禁止并发运行，D47） ======================= */
// 本脚本会 renameSync 移走模块目录再还原。两个进程并发时，后到者会读到
// 「模块已移走」的窗口态，产出**错误基线**（实测假象：12 文件 / 170 通过，
// 真值 14 文件 / 182 通过）。此处用 `fs.openSync(..., 'wx')` 独占创建锁文件，
// 已存在即立刻报错退出，从机制上杜绝并发。
// 注意：`wx` 的排他性对**本地文件系统**成立；网络盘/同步盘上不保证。
const LOCK_PATH = path.join(ROOT, '.workbuddy/split-workbenches/.vmr.lock');
let lockFd = null;
function acquireLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
    lockFd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeSync(lockFd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), module: ONLY })}\n`);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      let holder = '';
      try {
        holder = fs.readFileSync(LOCK_PATH, 'utf8').trim();
      } catch {
        /* ignore */
      }
      console.error(
        `[移除验证] ✗ 已有另一个进程在运行本脚本（锁文件: ${path.relative(ROOT, LOCK_PATH)}）。\n` +
          `  持有者信息: ${holder || '(未读到)'}\n` +
          `  **本脚本禁止并发运行**：它会把模块目录 renameSync 移走再还原，\n` +
          `  并发进程会落在「模块已移走」窗口内读到错误的基线/移除态（D47 实测假象）。\n` +
          `  请等待其结束；若确认无进程在跑（上次异常中断残留），手动删除该锁文件后重试。`,
      );
      process.exit(2);
    }
    console.error(`[移除验证] ✗ 无法创建锁文件 ${LOCK_PATH}: ${err && err.message ? err.message : String(err)}`);
    process.exit(2);
  }
}
function releaseLock() {
  try {
    if (lockFd !== null) fs.closeSync(lockFd);
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    /* ignore */
  }
}
acquireLock();
// 正常退出、异常退出、被信号打断都要释放锁（还原逻辑另有 try/finally 兜底）
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    releaseLock();
    process.exit(2);
  });
}
process.on('uncaughtException', (err) => {
  console.error(`[移除验证] ✗ 未捕获异常: ${err && err.stack ? err.stack : String(err)}`);
  releaseLock();
  process.exit(2);
});

/* --------------------------------------------------------------- 常量/口径 */
/**
 * 基线：两模块俱在时的通过用例数（t3/t4/t5 冻结；红线「不得删测」）。
 * ★ t10（AI 写作模块剥离）：本脚本的语义是「把模块**真实移走**→ 验证 → 还原」。
 *   剥离后 auto 的实现已**永久**移出仓外（见 .workbuddy/strip-auto-research/MANIFEST.json），
 *   其 `apps/plugins/auto/workbench/web` 不在场 ⇒ 本脚本若仍拿「两模块俱在」的 182
 *   当基线，阶段 1 必然红（实测 124）。故基线改为**按在场模块动态推导**：
 *     基线 = 两模块俱在总数 − Σ(缺席模块自身用例数)
 *   ⇒ 剥离态（auto 缺席）= 182 − 58 = 124，与实测一致；装回后自动回到 182。
 */
const BASE_ALL_PRESENT = 182;
const MODULES = [
  { id: 'manual', dir: 'apps/plugins/manual/workbench' },
  { id: 'auto', dir: 'apps/plugins/auto/workbench' },
];
/** 各模块自身用例数（实测口径：manual 2 文件/12 用例，auto 4 文件/58 用例） */
const MODULE_OWN_TESTS = { manual: 12, auto: 58 };
/**
 * 受支持缺席的模块（实现已剥离）：其目录缺席是**设计状态**，不是违规。
 * ★ manual（手写台）**不在**此列 —— 它是基线模块，缺席必须判失败（不得无差别放行）。
 */
const SUPPORTED_ABSENT = new Set(['auto']);
const REQUIRED_MODULES = ['manual'];
/**
 * 检测专用负向控制：`VERIFY_FORCE_ABSENT=manual` 时把指定模块**当作缺席**处理，
 * 用于证明「手写台缺席仍会致红」（本脚本禁止真去改 apps/plugins/** 目录名）。
 */
const FORCE_ABSENT = new Set(
  String(process.env.VERIFY_FORCE_ABSENT ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);
/**
 * 模块「在场」的规范判据 = 该模块的 **Web 面目录**（`.../workbench/web`）存在。
 * ★ 为什么不是 `.../workbench` 本身：剥离后骨架仍保留 `workbench/server/index.ts`
 *   （为过 G1 结构门），故 `workbench` 目录**仍存在**；只有 `web/` 整目录被移走。
 *   这与全仓规范判据一致（`verify-workbench-isolation.mjs` 的 `MODULE_DIRS`、
 *   `moduleEntries.ts` 的 `ENTRY_SUFFIX`/`hasModule` 都以 `web/index.tsx` 为准）。
 */
const moduleWebDir = (mod) => path.join(ROOT, mod.dir, 'web');
/** 模块 Web 面是否在场（受 FORCE_ABSENT 注入影响） */
const moduleDirExists = (mod) => fs.existsSync(moduleWebDir(mod)) && !FORCE_ABSENT.has(mod.id);
const absentModules = MODULES.filter((m) => !moduleDirExists(m));
const presentModules = MODULES.filter((m) => moduleDirExists(m));
/** 动态基线：剥离态 = 182 − 缺席模块自身用例数 */
const BASELINE_TESTS = BASE_ALL_PRESENT - absentModules.reduce((s, m) => s + (MODULE_OWN_TESTS[m.id] ?? 0), 0);
/** 模块自身测试的所在子树（用于「实测该模块用例数」） */
const MODULE_TEST_SUBTREES = {
  manual: ['apps/plugins/manual/workbench'],
  auto: ['apps/plugins/auto/workbench'],
};
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.cache']);
const TEST_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/;

const WEB_DIR = path.join(ROOT, 'apps/web');
const log = (s = '') => console.log(s);
const hr = (t) => log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

/* --------------------------------------------------------------- 工具函数 */
function walkFiles(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkFiles(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

/** 目录完整性指纹：文件数 + 总字节数（还原后须逐项一致） */
function fingerprint(absDir) {
  const files = walkFiles(absDir);
  let bytes = 0;
  for (const f of files) {
    try {
      bytes += fs.statSync(f).size;
    } catch {
      /* ignore */
    }
  }
  return { files: files.length, bytes };
}

/** 收集某组根目录下的测试文件（仓库根相对路径） */
function collectTestFiles(roots) {
  const out = [];
  for (const r of roots) {
    for (const abs of walkFiles(path.join(ROOT, r))) {
      if (TEST_RE.test(abs)) out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const pnpm = (script) => run('pnpm', ['--config.verify-deps-before-run=false', '--filter', '@novel/web', script]);

/**
 * ★ t29 / 验收 (a2)：**模块内部专用**类型检查。
 *
 * 为什么必须有：`pnpm --filter @novel/web type-check` = `tsc --noEmit` +
 *   `apps/web/tsconfig.json` 的 `include: ["src"]`。实测 `--listFiles` 共 999 个
 *   .ts/.tsx，其中 `plugins/{auto,manual}/workbench` 命中 **0** 个（命中 shared 44 个）。
 *   ⇒ (a1) **只覆盖 kernel + shared**，模块内部的死导入/悬空引用它完全看不见
 *   （该盲区实际掩盖了 `ChatPanel.tsx` 的 lucide `X` 死导入）。
 *
 * 本函数跑 `<mod>/workbench/tsconfig.typecheck.json`（include 模块 web/**+stores/**，
 * exclude 测试文件），使**模块内部**也进图。测试文件必须 exclude：本仓
 * `apps/web/tsconfig.json` 的 `types` 未含 `@testing-library/jest-dom`，纳入会冒出
 * `TS2339: Property 'toBeInTheDocument' does not exist` 噪声（既有配置缺口、非真缺陷）。
 *
 * ★ 在**移除态**下运行：移走模块 X 时 X 自己的 tsconfig 随之消失，故此处跑的是
 * **仍在场**的模块（Y）的 tsconfig —— 这恰好验证「Y 的内部在 X 缺席时仍类型干净」，
 * 正是可分离性要的结论。该 tsconfig 不含 kernel 业务源码（仅一个第三方 d.ts），
 * 故不受 X 缺席影响。
 */
function moduleTypecheck(modId) {
  const cfg = path.join(ROOT, `apps/plugins/${modId}/workbench/tsconfig.typecheck.json`);
  const tsc = path.join(ROOT, 'node_modules/typescript/bin/tsc');
  if (!fs.existsSync(cfg)) return { status: null, out: `未找到配置 ${cfg}`, missing: true };
  if (!fs.existsSync(tsc)) return { status: null, out: `未找到 tsc ${tsc}`, missing: true };
  return run('node', [tsc, '-p', cfg, '--noEmit']);
}

/** (a1) 覆盖范围实测：kernel+shared 的 type-check 图里有多少个模块内文件（诚实标注用）。 */
function typecheckCoverage() {
  const r = run('pnpm', [
    PNPM_GUARD_FLAG, '--filter', '@novel/web', 'exec', 'tsc', '--noEmit', '--listFiles',
  ]);
  const files = (r.out.match(/^\S+\.(?:ts|tsx|d\.ts)$/gm) ?? []).map((s) => s.replace(/\\/g, '/'));
  const moduleFiles = files.filter((f) => /plugins\/(auto|manual)\/workbench/.test(f)).length;
  const sharedFiles = files.filter((f) => /plugins\/shared\//.test(f)).length;
  return { total: files.length, moduleFiles, sharedFiles };
}

/**
 * ★ 为什么必须带 `--config.verify-deps-before-run=false`（诚实说明，勿删）：
 *
 * pnpm 在跑任何 script 前会做一次「依赖状态校验」：读 `apps/web/package.json` 的
 * `@novel-plugins/<mod>-workbench: workspace:*`，再要求该 workspace 包**存在**。
 * 模块目录被移走后该包消失，pnpm 于是在**启动编译器之前**就报
 *   `[ERR_PNPM_WORKSPACE_PKG_NOT_FOUND] … no package named "@novel-plugins/manual-workbench"`
 * 并以 exit 1 结束 —— 此时 `tsc` / `vite` / `vitest` **根本没有被启动**，
 * 报出的不是任何代码缺陷，而是「包清单与磁盘不一致」这一**安装状态**问题。
 *
 * 本脚本要验证的是「**代码层面**模块缺席时另一模块仍可编译/构建/测试」，故需把
 * 这层与代码无关的安装校验让开，让编译器真正跑起来给出结论。同时保留
 * 第二层证据（见下方 reinstallProbe）：用一次真实 `pnpm install` 证明
 * 「清单里仍声明着已消失的模块」确实会被 pnpm 拒绝 —— 这是**清单卫生**问题，
 * 由「模块缺席时应同步移除清单声明」这一独立事项承担，不属本断言口径。
 */
const PNPM_GUARD_FLAG = '--config.verify-deps-before-run=false';

/** 无该开关时的原始报错特征（用于把两类失败明确区分开） */
const PNPM_MANIFEST_GUARD_RE = /ERR_PNPM_WORKSPACE_PKG_NOT_FOUND|no package named/;

/** 跑 vitest 并取 JSON 报告 → { files, passed, failed, total } */
function runVitestJson(extraArgs = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't29-vitest-'));
  const outFile = path.join(tmp, 'report.json');
  const r = run('pnpm', [
    PNPM_GUARD_FLAG,
    '--filter',
    '@novel/web',
    'exec',
    'vitest',
    'run',
    '--reporter=json',
    `--outputFile=${outFile}`,
    ...extraArgs,
  ]);
  let report = null;
  if (fs.existsSync(outFile)) {
    try {
      report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    } catch {
      report = null;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return {
    status: r.status,
    out: r.out,
    files: report?.testResults?.length ?? null,
    passed: report?.numPassedTests ?? null,
    failed: report?.numFailedTests ?? null,
    total: report?.numTotalTests ?? null,
  };
}

/* ============================ 阶段 0：静态终态审计 ============================ */
hr('阶段 0 · 静态终态审计（残留垫片 / 硬编码模块入口说明符）');

const shimResidual = [];
for (const abs of walkFiles(path.join(ROOT, 'apps/web/src'))) {
  if (!/\.(ts|tsx)$/.test(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  for (const m of src.matchAll(/(?:^|\n)[^\S\n]*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    const resolved = spec.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(rel.replace(/^apps\/web\/src\//, 'src/')), spec))
      : spec.startsWith('@/')
        ? spec.slice(2)
        : null;
    const hitsModuleInternals =
      /plugins\/(auto|manual)\/workbench/.test(spec) ||
      (resolved !== null && /^(src\/)?(components|services|stores|hooks|utils)\//.test(resolved) === false && false);
    if (hitsModuleInternals) shimResidual.push(`${rel} → ${spec}`);
  }
}
log(`· apps/web/src 残留垫片数 = ${shimResidual.length}`);
for (const s of shimResidual) log(`    ✗ ${s}`);

/** kernel 内「硬编码模块入口说明符」= 直接写模块包名/相对深层路径（绕过 glob 与注册表） */
const MODULE_ENTRY_LITERAL_RE =
  /(?:import|export)\s*(?:\(|\s)[^'"`]*?['"](?:@novel-plugins\/(?:auto|manual)-workbench(?:\/[^'"]*)?|(?:\.\.\/)+plugins\/(?:auto|manual)\/[^'"]+)['"]/g;
const kernelLiterals = [];
for (const abs of walkFiles(path.join(ROOT, 'apps/web/src'))) {
  if (!/\.(ts|tsx)$/.test(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  // 逐行扫描并剔除注释行（注释里的说明符不产生依赖）
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    MODULE_ENTRY_LITERAL_RE.lastIndex = 0;
    if (MODULE_ENTRY_LITERAL_RE.test(line)) kernelLiterals.push(`${rel}:${i + 1}  ${t}`);
  });
}
log(`· kernel 内模块入口硬编码说明符数 = ${kernelLiterals.length}`);
for (const s of kernelLiterals) log(`    ✗ ${s}`);

const staticAuditOk = shimResidual.length === 0 && kernelLiterals.length === 0;

/* ==================== 阶段 1：全局基线（两模块俱在） ==================== */
hr('阶段 1 · 全局基线（两模块俱在）');

const baselineActiveRoots = ['apps/web/src', 'apps/plugins/shared', ...MODULES.map((m) => m.dir)];
const baselineDiskTests = collectTestFiles(baselineActiveRoots);
log(`现存测试文件（树中实测）: ${baselineDiskTests.length} 个`);

const bTc = pnpm('type-check');
log(`(a) 基线 type-check exit ${bTc.status}`);
const bBuild = pnpm('build');
const bBuildHasFallback = /vite:load-fallback|ENOENT/.test(bBuild.out);
log(`(b) 基线 build exit ${bBuild.status}${bBuildHasFallback ? '  ⚠ 含 load-fallback/ENOENT' : ''}`);
const bTest = runVitestJson();
log(
  `(c) 基线 test exit ${bTest.status}；收集文件 ${bTest.files}；通过 ${bTest.passed}；总计 ${bTest.total}`,
);

const baselineOk =
  bTc.status === 0 &&
  bBuild.status === 0 &&
  !bBuildHasFallback &&
  bTest.status === 0 &&
  bTest.files === baselineDiskTests.length &&
  bTest.passed === BASELINE_TESTS;

if (!baselineOk) {
  console.error('\n✗ 基线不成立：当前在场模块集合下基线未达标，后续移除验证无意义。');
  console.error(
    `  在场模块: ${presentModules.map((m) => m.id).join(', ') || '(无)'}；` +
      `受支持缺席: ${absentModules.map((m) => m.id).join(', ') || '(无)'}`,
  );
  console.error(
    `  期望 type-check=0 / build=0(无 fallback) / test 收集=${baselineDiskTests.length} 通过=${BASELINE_TESTS}` +
      `（= ${BASE_ALL_PRESENT} − 缺席模块自身用例）`,
  );
  process.exit(1);
}
log(
  `✓ 基线成立（type-check 0 / build 0 / test 收集数=现存数 / 通过 ${BASELINE_TESTS}` +
    `${absentModules.length ? `；受支持缺席 ${absentModules.map((m) => m.id).join(',')}（已剥离态）` : ''}）`,
);

/* ==================== 阶段 2：逐模块「移走 → 验证 → 还原」 ==================== */
const targets = ONLY ? MODULES.filter((m) => m.id === ONLY) : MODULES;
const results = [];

// (a1) 覆盖范围实测一次（诚实标注用；不进判定，仅打印事实）
const a1Coverage = typecheckCoverage();
log(
  `\n(a1) 覆盖范围实测：apps/web type-check 图共 ${a1Coverage.total} 个文件，` +
    `其中模块内 ${a1Coverage.moduleFiles} 个 / shared ${a1Coverage.sharedFiles} 个` +
    `${a1Coverage.moduleFiles === 0 ? ' ⇒ **确实看不见模块内部**（由 (a2) 补）' : ''}`,
);
// (a2) 基线：在场模块其内部应类型干净（缺席模块无从检查，跳过）
const a2Baseline = presentModules.map((m) => ({ id: m.id, r: moduleTypecheck(m.id) }));
for (const m of absentModules) {
  log(`(a2) 基线 ${m.id} 模块**不在场**（已剥离态）⇒ 跳过其内部 type-check，不计违规`);
}
for (const { id, r } of a2Baseline) {
  log(`(a2) 基线 ${id} 模块内部 type-check exit ${r.status}  ${r.status === 0 ? '✓' : '✗'}`);
}
if (a2Baseline.some(({ r }) => r.status !== 0)) {
  console.error('\n✗ (a2) 基线不成立：在场模块其内部类型检查未达标。');
  process.exit(1);
}

for (const mod of targets) {
  hr(`阶段 2 · 移除 ${mod.id} 模块（${mod.dir}）`);

  const absDir = path.join(ROOT, mod.dir);
  const stashDir = path.join(ROOT, '.workbuddy/split-workbenches/.t29-stash', `${mod.id}-workbench`);
  // ★ t10：在场判据用 **web/ 子目录**（见 moduleDirExists 注释），与全仓一致。
  if (!moduleDirExists(mod)) {
    // ★ t10：区分「受支持缺席（已剥离态）」与「真缺失（违规）」。
    //   auto 的实现已移出仓外 ⇒ 无从演练「移走→还原」，跳过是**如实反映**，
    //   而非掩盖：auto 的可分离性由 task-11 的「装回演练」覆盖。
    //   manual 若缺席（含 VERIFY_FORCE_ABSENT 注入）⇒ **仍然判失败**（不得无差别放行）。
    if (SUPPORTED_ABSENT.has(mod.id) && !REQUIRED_MODULES.includes(mod.id) && !FORCE_ABSENT.has(mod.id)) {
      log(`· 模块 ${mod.id} 不在场（已剥离态）⇒ 跳过「移走→验证→还原」演练，不计违规`);
      results.push({ id: mod.id, ok: true, reason: '受支持缺席（已剥离态），跳过演练' });
    } else {
      console.error(`✗ 模块目录不存在: ${mod.dir}${FORCE_ABSENT.has(mod.id) ? '（VERIFY_FORCE_ABSENT 注入）' : ''}`);
      results.push({ id: mod.id, ok: false, reason: '模块目录不存在' });
    }
    continue;
  }
  fs.rmSync(stashDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stashDir), { recursive: true });

  const before = fingerprint(absDir);
  log(`移走前指纹: files=${before.files} bytes=${before.bytes}`);

  // 实测该模块自身用例数（模块俱在时单独跑它的测试文件）——不得硬编码猜测
  const ownTestFiles = collectTestFiles(MODULE_TEST_SUBTREES[mod.id]);
  const ownRun = runVitestJson(
    ownTestFiles.map((f) => path.relative(WEB_DIR, path.join(ROOT, f)).replace(/\\/g, '/')),
  );
  const ownCases = ownRun.passed;
  log(`该模块自身测试: ${ownTestFiles.length} 文件 / ${ownCases} 用例（实测）`);
  if (ownRun.status !== 0 || ownRun.files !== ownTestFiles.length || ownCases === null) {
    console.error(`✗ 无法实测 ${mod.id} 自身用例数（exit ${ownRun.status}，收集 ${ownRun.files}）`);
    results.push({ id: mod.id, ok: false, reason: '无法实测自身用例数' });
    continue;
  }

  const expectFiles = baselineDiskTests.length - ownTestFiles.length;
  const expectPassed = BASELINE_TESTS - ownCases;
  log(`期望（移除后）: 收集文件 ${expectFiles} / 通过 ${expectPassed}  [= 182 − ${ownCases}]`);

  let moved = false;
  let checks = null;
  try {
    fs.renameSync(absDir, stashDir);
    moved = true;
    log(`→ 已移走 ${mod.dir}（模拟该模块缺席）`);

    // (a1) kernel+shared type-check —— ★ 覆盖范围须显式标注，不得过度解读
    const tc = pnpm('type-check');
    const tcOk = tc.status === 0;
    log(`(a1) kernel+shared type-check exit ${tc.status}  ${tcOk ? '✓' : '✗'}`);
    log(
      `     ⚠ 覆盖范围：apps/web/tsconfig.json include=["src"] ⇒ 本步**只覆盖 kernel + shared**，` +
        `**看不见模块内部**（实测 ${a1Coverage.moduleFiles} 个模块内文件进图 / shared ${a1Coverage.sharedFiles} 个）。` +
        `模块内部由 (a2) 覆盖。`,
    );
    if (!tcOk) {
      const errs = tc.out.split(/\r?\n/).filter((l) => /error TS/.test(l)).slice(0, 12);
      for (const e of errs) log(`      ${e.trim()}`);
    }

    // (a2) 在场模块的**内部**类型检查（模块内专用 tsconfig，exclude 测试文件）
    // ★ t10：改为在**在场**模块里找「另一个」（原实现假设两模块俱在，剥离后 otherMod
    //   可能是缺席的 auto）。缺席则跳过并打印，不计违规。
    const otherMod = presentModules.find((m) => m.id !== mod.id);
    let a2Ok = true; // 无其它在场模块可交叉检查时视为「不适用 ⇒ 不判失败」
    if (!otherMod) {
      log(`(a2) 已无其它在场模块可交叉检查（当前在场: ${presentModules.map((m) => m.id).join(',') || '无'}）⇒ 跳过`);
    } else {
      const a2 = moduleTypecheck(otherMod.id);
      a2Ok = a2.status === 0;
      log(
        `(a2) ${otherMod.id} 模块内部 type-check exit ${a2.status}  ${a2Ok ? '✓' : '✗'}` +
          `  （${otherMod.id}/workbench/tsconfig.typecheck.json，exclude 测试文件）`,
      );
      if (!a2Ok) {
        const errs = a2.out.split(/\r?\n/).filter((l) => /error TS/.test(l)).slice(0, 12);
        for (const e of errs) log(`      ${e.trim()}`);
      }
    }
    // 被移走模块自身的 tsconfig 也应随目录一起消失（不残留悬空配置）
    const removedCfg = path.join(ROOT, `apps/plugins/${mod.id}/workbench/tsconfig.typecheck.json`);
    log(`      （被移走的 ${mod.id} 其 tsconfig.typecheck.json 是否存在: ${fs.existsSync(removedCfg)}，期望 false）`);

    // (b) build（必须 exit 0 且无 load-fallback/ENOENT）
    const build = pnpm('build');
    const fallbackHits = build.out
      .split(/\r?\n/)
      .filter((l) => /vite:load-fallback|ENOENT/.test(l))
      .slice(0, 8);
    const buildOk = build.status === 0 && fallbackHits.length === 0;
    log(`(b) build exit ${build.status}；load-fallback/ENOENT 命中 ${fallbackHits.length}  ${buildOk ? '✓' : '✗'}`);
    for (const h of fallbackHits) log(`      ${h.trim()}`);

    // (b') 清单卫生探针：证明「模块缺席但 package.json 仍声明它」会被 pnpm 拒绝，
    //      从而把「安装状态问题」与「代码问题」明确分开（不混入上面的 (a)(b)(c) 判定）。
    const guardProbe = run('pnpm', ['--filter', '@novel/web', 'exec', 'node', '-e', 'process.exit(0)']);
    const manifestGuardFired = PNPM_MANIFEST_GUARD_RE.test(guardProbe.out);
    log(
      `(b') 清单卫生探针：pnpm 无开关时 ${manifestGuardFired ? '拒绝执行' : '放行'}（exit ${guardProbe.status}）` +
        `${manifestGuardFired ? ' — 属安装/清单卫生问题，已由开关让开，不参与本断言' : ''}`,
    );

    // (c) test：exit 0 + 收集文件数==现存数 + 通过数==期望
    const diskTestsNow = collectTestFiles(
      ['apps/web/src', 'apps/plugins/shared', ...MODULES.filter((m) => m.id !== mod.id).map((m) => m.dir)],
    );
    const test = runVitestJson();
    const collectedOk = test.files === diskTestsNow.length;
    const passedOk = test.passed === expectPassed;
    const testOk = test.status === 0 && collectedOk && passedOk;
    log(
      `(c) test exit ${test.status}；收集文件 ${test.files}（现存 ${diskTestsNow.length}）${collectedOk ? '✓' : '✗'}；` +
        `通过 ${test.passed}（期望 ${expectPassed}）${passedOk ? '✓' : '✗'}  ${testOk ? '✓' : '✗'}`,
    );
    if (!collectedOk) {
      log('      ⚠ 收集文件数与现存测试文件数不符 ⇒ vitest 空转（对不存在目录静默匹配 0 文件）');
    }

    checks = { tcOk, a2Ok, buildOk, testOk, collectedOk, passedOk, manifestGuardFired };
  } finally {
    if (moved) {
      fs.renameSync(stashDir, absDir);
      log(`← 已还原 ${mod.dir}`);
    }
    const after = fingerprint(absDir);
    const intact = after.files === before.files && after.bytes === before.bytes;
    log(
      `还原后指纹: files=${after.files} bytes=${after.bytes}  ` +
        `${intact ? '✓ 与移走前一致' : '✗ 不一致（完整性受损！）'}`,
    );
    if (!intact) {
      console.error(`✗ 还原后目录不一致：before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
    checks = { ...(checks ?? {}), intact };
    // 还原后复跑 type-check（证明树确实回到可用状态）
    const restoreTc = pnpm('type-check');
    const restoreOk = restoreTc.status === 0;
    log(`还原后 type-check exit ${restoreTc.status}  ${restoreOk ? '✓' : '✗'}`);
    checks = { ...checks, restoreOk };
  }

  const ok =
    checks.tcOk && checks.a2Ok && checks.buildOk && checks.testOk && checks.intact && checks.restoreOk;
  results.push({ id: mod.id, ok, checks, ownCases, expectFiles, expectPassed });
}

/* ============================== 汇总 ============================== */
hr('汇总');
log(`· 静态终态审计：残留垫片 ${shimResidual.length} 个；kernel 硬编码模块入口说明符 ${kernelLiterals.length} 个`);
for (const r of results) {
  if (!r.checks) {
    // ★ t10：无 checks 的条目有两种 —— 「受支持缺席，跳过演练」(ok:true) 与
    //   「真缺失/无法实测」(ok:false)。按 r.ok 选择 glyph，避免把跳过误标成 ✗。
    log(`  ${r.ok ? '·' : '✗'} [${r.id}] ${r.reason}`);
    continue;
  }
  const c = r.checks;
  log(
    `  ${r.ok ? '✓' : '✗'} [${r.id}] ` +
      `(a1)kernel+shared type-check=${c.tcOk ? 'ok' : 'FAIL'} ` +
      `(a2)模块内部 type-check=${c.a2Ok ? 'ok' : 'FAIL'} ` +
      `build=${c.buildOk ? 'ok' : 'FAIL'} ` +
      `test=${c.testOk ? 'ok' : 'FAIL'}（收集文件数一致=${c.collectedOk ? 'yes' : 'NO'}，` +
      `通过 ${r.expectPassed}）还原完整=${c.intact ? 'yes' : 'NO'} 还原后 type-check=${c.restoreOk ? 'ok' : 'FAIL'}`,
  );
}

const allOk = staticAuditOk && results.length === targets.length && results.every((r) => r.ok);

// 收尾清理：移除本次运行留下的空 stash 目录（模块内容已由 finally 的 renameSync 全部还原）。
try {
  fs.rmSync(path.join(ROOT, '.workbuddy/split-workbenches/.t29-stash'), { recursive: true, force: true });
} catch {
  /* ignore */
}

log(
  allOk
    ? `\n✓ 模块移除验证通过：${targets.map((t) => t.id).join(' / ')} 各在缺席状态下 ` +
        `(a1) kernel+shared type-check exit 0、(a2) 在场模块**内部** type-check exit 0、` +
        `build exit 0（无 load-fallback）、测试达标，且已完整还原。`
    : '\n✗ 模块移除验证失败（见上）。',
);
process.exit(allOk ? 0 : 1);