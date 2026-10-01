#!/usr/bin/env node
/**
 * scripts/verify/verify-workbench-isolation.mjs
 *
 * 三层插件式工作台拆分（kernel 宿主 > manual/auto 两大模块 > 子插件）· 隔离门禁。
 * 依据：
 *   - docs/architecture/web-workbench-split.md §6.3 断言 A–E（本脚本的验收契约）
 *   - docs/architecture/web-workbench-split-contract.md §5 规则表（M2A/A2M/K2M/K2A/NO-CROSS-MODULE）
 *   - .workbuddy/split-workbenches/tools/captain-isolation-check.mjs（队长独立预言机，用于对拍）
 *
 * 纯静态文本扫描器：只读文件内容 + 正则，**绝不 import 被测源码**。
 * 理由：被测代码是 React/TS 源码，含 Vite 别名 `@/…`、JSX、CSS、Tauri 等，
 *       裸 Node 无法解析；契约 §5 的规则本就是「静态 import 依赖」判定，文本扫描即可。
 *
 * 用法：
 *   node scripts/verify/verify-workbench-isolation.mjs                  # 全量（只做「两侧都可用」检查）
 *   node scripts/verify/verify-workbench-isolation.mjs --without auto    # 模拟移除 auto 模块
 *   node scripts/verify/verify-workbench-isolation.mjs --without manual  # 模拟移除 manual 模块
 *   node scripts/verify/verify-workbench-isolation.mjs --with-tests      # 追加断言 E（L2/L3，L3 ≥ 182）
 *   node scripts/verify/verify-workbench-isolation.mjs --expect M2A=0,K2M=0,缺失=0
 *   node scripts/verify/verify-workbench-isolation.mjs --help
 *
 * `--without manual|auto` 语义（D37）：
 *   **模拟该模块缺席**（其目录视为不存在）——用于证明「另一模块仍完全可用」。
 *   · 该模块根不扫描，也不要求其目录存在（缺失计数跳过它）；
 *   · 全量模式（无 --without）扫描 kernel 根 + 两模块根。
 *
 * `--expect` 语义（D37）：
 *   逗号分隔的 `计数器=期望值` 列表。**仅**校验所列计数器；所列项**全部匹配**则 exit 0，
 *   未列项一律忽略（仍打印完整报告）。用途：分阶段断言「应当清零的子集」，
 *   例如 t4 阶段只能清 M2A/K2M/缺失（K2A 由 t5 消）：
 *     --without auto --expect M2A=0,K2M=0,缺失=0
 *   可用计数器：A、A'、B、C、缺失、M2A、A2M、K2M、K2A、文件数。
 *   未知计数器名 → exit 2（参数错误）。
 *
 * 退出码：0 = 通过；1 = 有违规 / 缺失模块 / 断言失败 / --expect 不匹配；2 = 参数错误
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/* ------------------------------------------------------------------ argv */
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  if (i < 0) return null;
  return argv[i + 1] ?? '';
};
const WITHOUT = argOf('--without'); // 'manual' | 'auto' | null
const WITH_TESTS = argv.includes('--with-tests');
const EXPECT_RAW = argOf('--expect'); // 'M2A=0,K2M=0,缺失=0' | null

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      '工作台隔离门禁 · 用法：',
      '  node scripts/verify/verify-workbench-isolation.mjs [选项]',
      '',
      '选项：',
      '  --without manual|auto   模拟该模块缺席（目录视为不存在），证明另一模块仍可用',
      '  --expect k=v,k=v        仅校验所列计数器；全部匹配则 exit 0，未列项忽略',
      '  --with-tests            追加断言 E（type-check + 用例数 ≥ 182）',
      '  --help                  显示本帮助',
      '',
      '可用计数器：A、A\'、B、C、缺失、M2A、A2M、K2M、K2A、文件数',
      '示例：',
      "  node scripts/verify/verify-workbench-isolation.mjs --without auto --expect M2A=0,K2M=0,缺失=0",
    ].join('\n'),
  );
  process.exit(0);
}

if (WITHOUT !== null && !['manual', 'auto'].includes(WITHOUT)) {
  console.error(`[门禁] --without 只接受 manual|auto，收到: ${WITHOUT === '' ? '(空)' : WITHOUT}`);
  process.exit(2);
}

/* --expect 解析：'M2A=0,K2M=0' → [{key:'M2A',want:0}, …]；未知键 → exit 2 */
const EXPECT_KEYS = new Set(['A', "A'", 'B', 'C', '缺失', 'M2A', 'A2M', 'K2M', 'K2A', '文件数']);
const EXPECT = [];
if (EXPECT_RAW !== null) {
  for (const part of EXPECT_RAW.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      console.error(`[门禁] --expect 项须为 键=值，收到: ${part}`);
      process.exit(2);
    }
    const key = part.slice(0, eq).trim();
    const val = Number(part.slice(eq + 1).trim());
    if (!EXPECT_KEYS.has(key)) {
      console.error(`[门禁] --expect 未知计数器: ${key}（可用: ${[...EXPECT_KEYS].join(', ')}）`);
      process.exit(2);
    }
    if (!Number.isFinite(val)) {
      console.error(`[门禁] --expect 值须为数字: ${part}`);
      process.exit(2);
    }
    EXPECT.push({ key, want: val });
  }
}

/* -------------------------------------------------------------- 扫描根（D1） */
// 精确三条（D1：一模块一包）：kernel 域 + 两大模块各一个包。
const MODULE_DIRS = {
  manual: 'apps/plugins/manual/workbench/web',
  auto: 'apps/plugins/auto/workbench/web',
};
/**
 * ★ t29 新增（验收第 7 条）：shared 包扫描根。
 *
 * 为什么必须加：验收第 6 条要求「shared→auto 静态边消解」（§4-C2 的
 * `localUserData.ts → chatHistoryStore`）。若门禁**不扫 shared 包**，它就永远
 * 无法证明该边已消失 —— 那条边一旦回归，扫描根里任何文件都不会报错。
 * 这是「门禁必须能看见被修复的那条边」的基本要求（t6 的教训：看不见的边 = 假通过）。
 *
 * 域归属为 `shared`（见下方 DOMAIN_BY_PATH），故只受 shared→module 域对约束，
 * 不受 kernel 的 K2M/K2A 约束。D1 冻结的三条根**原样保留**（此处为纯增量）。
 *
 * 范围 = 契约 §2.3 定义的 **shared 三包**（ui-kit / ui-graph / data-core）。
 * **不含 `typography`**（`apps/plugins/shared/typography`）：它是拆分前既有的
 * 第三方示例插件，不属 §2.3 的 shared 三包；其实测对模块的 import 数 = 0
 * （仅 react / lucide-react / `@novel/core/web`），故纳入它对第 7 条的检测力零增益；
 * 而它带有 7 处**遗留** `/api/` 字面量（`web/index.tsx:99,114,134,304,318,355,398`），
 * 纳入后会新增 7 条**范围外**的断言 C 失败（与既有「例外面」同类），属误报。
 * 该文件不在本次拆分写范围内，其 `/api/` 收口是独立事项。
 */
const SHARED_ROOTS = [
  'apps/plugins/shared/ui-kit/src',
  'apps/plugins/shared/ui-graph/src',
  'apps/plugins/shared/data-core/src',
];
const SCAN_ROOTS = [
  { rel: 'apps/web/src', module: null },
  { rel: MODULE_DIRS.manual, module: 'manual' },
  { rel: MODULE_DIRS.auto, module: 'auto' },
  ...SHARED_ROOTS.map((rel) => ({ rel, module: 'shared' })),
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

/* ------------------------------------------------------------------ 域分类 */
// 与预言机 isolation-rules.json 的 domainByPath 同口径（先 kernel，再 auto，再 manual，再 shared）。
// ★ t29 修复：原表缺 `shared` 域 —— 于是 kernel 经 `@/…` 引用「已下沉 shared 的原 kernel 文件」
//   （如 `@/services/editor/entityDetector`，设计 §3.7 判 shared）会被判成 `other`/kernel，
//   域判定失真。补上 shared 分支（排在 manual 之后，避免抢占更具体的模块前缀）。
const DOMAIN_BY_PATH = [
  ['kernel', [
    /^(main|App)\.tsx$/,
    /^plugin\//,
    /^routes\//,
    /^test\//,
    /^styles\//,
    /^dev\//,
    /^types\//,
    /^components\/ui\//,
    /^components\/shared\//,
    /^components\/shell\//,
    /^pages\//,
    /^services\/api\//,
  ]],
  ['auto', [
    /^components\/ai\//,
    /^components\/layout\//,
    /^services\/ai\//,
    /^stores\/(aiStore|chatHistoryStore|aiRedstoneStore|workspaceStore)(\.ts)?$/,
  ]],
  ['manual', [
    /^components\/(editor|knowledge|timeline|foreshadow|notes|outline|stats|export|book|achievements)\//,
    /^hooks\/(useAutoEntityDetection|useLatestChapterPolling|useScanProcessors)(\.ts)?$/,
  ]],
  // ★ t29 新增：已下沉 shared 的 kernel 原文件（设计 §3.7 判 shared 者）。
  //   kernel 引用它们是**允许**的（kernel → shared 非禁令边），列出来只为让域判定准确，
  //   避免它们被误判成 kernel 而掩盖/伪造跨域边。
  ['shared', [
    /^services\/(editor|data)\//,
    /^services\/misc\//,
    /^utils\//,
  ]],
];
const domainOfPath = (relPosix) => {
  for (const [dom, pats] of DOMAIN_BY_PATH) if (pats.some((p) => p.test(relPosix))) return dom;
  return 'other';
};
/**
 * ★ t29 修复（非空自证暴露的**真实漏洞**）：
 * kernel 扫描根（`apps/web/src`）里，`DOMAIN_BY_PATH` 的 auto/manual/shared 分支只用于
 * 标出「尚未下沉的飞地」；**未命中任何分支者按定义就是 kernel 本体**。
 * 旧实现直接取 `domainOfPath(relPosix)`，未命中即得 `'other'` —— 而
 * `'other'` 既不等于 `'kernel'`（断言 B 不触发），也不匹配任何 EDGE_RULES 的 from
 * （断言 A 不触发）。于是**整个 kernel 根下未被显式枚举的文件都成了门禁盲区**：
 * 实测把 `export * from '../../plugins/auto/workbench/web/discuss/ChatPanel'` 写进
 * `apps/web/src/__t29_selfproof.ts` 后门禁仍 exit 0（0 违规）。
 * 注意：`main.tsx` / `App.tsx` 等已被 kernel 分支覆盖，故该盲区只在
 * 「kernel 根下未枚举路径」出现 —— 但 `apps/web/src` 是唯一扫描根，盲区面很大。
 */
const kernelRootDomain = (relPosix) => {
  const d = domainOfPath(relPosix);
  return d === 'other' ? 'kernel' : d;
};

/* ------------------------------------------------------ 断言 A：跨域 import 禁令 */
// 契约 §5 规则表 = 如下「域对」的等价表述（禁止前缀 → 目标域）：
//   M2A : manual → auto   （@/services/ai/、@/components/ai/、@/stores/{aiStore,chatHistoryStore,
//                           aiRedstoneStore,workspaceStore}、@/components/layout/、
//                           @novel-plugins/auto-workbench、apps/plugins/auto/）
//   A2M : auto   → manual （@/components/{knowledge,editor,timeline,foreshadow,notes,outline,stats,
//                           export}/、@novel-plugins/manual-workbench、apps/plugins/manual/）
//                           注：契约 §5 的 A2M **不含** `@/pages/`（`pages/` 本身即 kernel 域，
//                           §3.3；R3-F3 裁决移除，此注释已同步）。
//   K2M : kernel → manual （@/components/{editor,knowledge,timeline,foreshadow,notes,outline,stats,export}/、
//                           @/components/layout/{LeftSidebar,TrashDialog}.tsx（D16 归 manual））
//   K2A : kernel → auto   （@/components/{ai,layout}/、@/services/ai/）
//   NO-CROSS-MODULE : manual/auto → 对方包入口
// 说明：契约 §5 的 K2M **不含** `@/pages/`（`pages/` 本身即 kernel 域，§3.3），
//       故 kernel→pages 不算跨域；`@/components/{layout,ai}` 与 `@/services/ai` 目标域为 auto，
//       故 kernel→它们由 K2A 覆盖，不需要在 K2M 里重复列前缀。
const EDGE_RULES = [
  { id: 'M2A', from: 'manual', to: 'auto' },
  { id: 'A2M', from: 'auto', to: 'manual' },
  { id: 'K2M', from: 'kernel', to: 'manual' },
  { id: 'K2A', from: 'kernel', to: 'auto' },
  // ★ t29 新增（验收第 7 条）：shared→module 域对。
  //   shared 是「两模块都可用」的公共层，**不得反向依赖任一模块** ——
  //   否则移走该模块时 shared 树带上悬空依赖（正是 §4-C2 的原缺陷形态：
  //   `data-core/data/localUserData.ts` 静态 import auto 的 `chatHistoryStore`）。
  //   原实现无此域对，故该形态的边即使存在也不触发任何规则（假通过）。
  { id: 'S2A', from: 'shared', to: 'auto' },
  { id: 'S2M', from: 'shared', to: 'manual' },
];
const PKG_DOMAIN = [
  [/^@novel-plugins\/auto-workbench(?:\/|$)/, 'auto'],
  [/^@novel-plugins\/manual-workbench(?:\/|$)/, 'manual'],
  [/^@novel-plugins\/(ui-graph|ui-kit|data-core)(?:\/|$)/, 'shared'],
  [/^@novel\/core(?:\/|$)/, 'shared'],
  [/^@novel\/shared$/, 'shared'],
  [/^apps\/plugins\/auto\//, 'auto'],
  [/^apps\/plugins\/manual\//, 'manual'],
];

/* --------------------------- 断言 A'：兼容壳禁令（设计 §6.3 A'，F8；仅 --without manual） */
// auto 不得经 `apps/web/src/stores/index.ts` 兼容壳取 store，只允许 @novel-plugins/data-core/stores。
const COMPAT_SHELL_SPEC_RE = /^@\/stores(?:\/|$)/;
const COMPAT_SHELL_RESOLVED_RE = /^stores(?:\/index(?:\.ts)?)?$/;

/* ---------------------------- 断言 B：模块入口纪律（kernel 只能走模块导出入口） */
const MODULE_ENTRY_RE = /^@novel-plugins\/(manual-workbench|auto-workbench)(?:\/(.*))?$/;
const MODULE_ENTRY_PUBLIC_SUBPATHS = new Set(['web', 'stores']);
/**
 * D41：spec 是否命中「模块公开入口」（桶 `.` 或 **精确** `/{web,stores}[.ts|/index.ts]`）
 * —— 断言 A 据此豁免 K2M/K2A。
 *
 * ★ t29 修复（非空自证 P2 暴露）：旧实现用 `MODULE_ENTRY_PUBLIC_SUBPATHS.has(em[2].split('/')[0])`
 *   判定，于是 `/web/discuss/ChatPanel`、`/web/editor/ChapterEditor` 这类**深层内部路径**
 *   也因首段是 `web` 而被豁免 —— 但契约 §1 L17 允许 kernel 的只有
 *   `@novel-plugins/{manual-workbench,auto-workbench}/web`（即 `exports["./web"]` 这个**入口**本身），
 *   并非 `/web/**` 任意文件。豁免面过宽 ⇒ 实测
 *   `export { ChatPanel } from '@novel-plugins/auto-workbench/web/discuss/ChatPanel'`
 *   在断言 A 上被放过（0 违规）。现改为**精确匹配**公开入口。
 */
function isModulePublicEntry(spec) {
  const em = spec.match(MODULE_ENTRY_RE);
  if (!em) return false;
  if (em[2] === undefined) return true; // 桶入口 `@novel-plugins/x-workbench`
  const sub = em[2].replace(/\.tsx?$/, ''); // `/web/index.ts` ⇒ `/web/index`
  if (MODULE_ENTRY_PUBLIC_SUBPATHS.has(sub)) return true; // `/web`、`/stores`
  return /^(web|stores)\/index$/.test(sub); // `/web/index`、`/stores/index`
}

/**
 * ★ t29：判断 kernel 侧的一条说明符是否**深层引用了某模块内部文件**（应报断言 B）。
 *
 * 「公开入口」的判定改为**看解析后的落点**，覆盖三种真实写法：
 *   · 包名深层：`@novel-plugins/auto-workbench/web/discuss/ChatPanel`  → 命中
 *   · `@/` 别名：`@/components/ai/ChatPanel`（属 auto 域，非模块入口）→ 命中
 *   · 相对路径：`../../plugins/auto/workbench/web/discuss/ChatPanel`  → 命中
 * 而下列**允许**写法不报：
 *   · `@novel-plugins/<mod>-workbench`（桶）与 `/web`、`/stores`（公开子路径）
 *   · `@novel-plugins/<mod>-workbench/web/index.tsx`（解析到模块入口文件本身）
 *   · 目标不属任何模块域（如 shared / kernel 自身）
 *
 * 返回 `{ dom }` 表示命中违规，`null` 表示放行。
 */
function moduleEntryHit(spec, rootEntry, relPosix) {
  // ① 包名口径
  const em = spec.match(MODULE_ENTRY_RE);
  if (em) {
    if (isModulePublicEntry(spec)) return null; // 桶 / web / stores —— 公开入口，放行
    return { dom: em[1].startsWith('manual') ? 'manual' : 'auto' }; // 深层子路径 ⇒ 违规
  }
  // ② 路径口径（`@/` 别名 或 相对路径）——解析落点是否落在某模块的 web/** 内
  let targetRel = null; // 相对该模块根
  let dom = null;
  if (spec.startsWith('@/')) {
    const r = spec.slice(2);
    dom = domainOfPath(r);
    if (dom === 'auto' || dom === 'manual') targetRel = r;
  } else if (spec.startsWith('.')) {
    const repoRel = toRepoRel(spec, rootEntry, relPosix);
    if (repoRel) {
      const m2 = repoRel.match(/^apps\/plugins\/(auto|manual)\/(?:[^/]+)\/(.*)$/);
      // 只对**模块包**（<mod>/workbench）判定；同域兄弟插件（如 auto/novel.autowrite）
      // 不属「模块入口纪律」范围（那是同域内部依赖，D46 已另案处置）。
      if (m2 && repoRel.startsWith(`apps/plugins/${m2[1]}/workbench/`)) {
        dom = m2[1];
        targetRel = m2[2];
      }
    }
  }
  if (!dom || targetRel === null) return null;
  // 落点为模块公开入口文件本身（web/index.tsx）⇒ 等价于桶入口，放行
  if (/^web\/index\.tsx$/.test(targetRel) || /^web\/index\.ts$/.test(targetRel)) return null;
  if (/^stores(\/index\.ts)?$/.test(targetRel)) return null;
  return { dom };
}

/* ------------------------------------------ 断言 C：字面量 `/api/` 禁令（§5.4） */
const API_LITERAL_RE = /(['"`])\/api\//g;
const API_ENV_RE = /import\.meta\.env\.VITE_API_BASE_URL/g;
// 唯一允许知道 API base 的文件：共享数据层 api client（M1 后落 data-core）。
const API_BASE_OWNER_RE = /(^|\/)(services\/api\/apiClient\.ts|data-core\/src\/api\/apiClient\.ts)$/;
// 测试文件豁免：单测把 '/api/xxx' 当作 apiClient 的**输入 path**（baseUrl 由 client 补），
// 并非字面量 base；且断言 C 的语义是「产品调用点不得硬编码 base」，测试不属调用点。
const isTestFile = (label) => /(^|\/)(__tests__|test)\//.test(label) || /\.(test|spec)\.(ts|tsx)$/.test(label);
// 断言 C 的扫描范围 = 三条门禁扫描根 + t3 新建的共享三包。
// 例外：既有第三方插件（apps/plugins/{manual,auto,shared}/<legacy>，如 worldbuilding/bookscan/
// typography）不属三层拆分范围、亦不在任何任务写范围内，故排除并单列计数。
const API_SCAN_EXTRA = [
  'apps/plugins/shared/ui-graph',
  'apps/plugins/shared/ui-kit',
  'apps/plugins/shared/data-core',
];
const API_SCAN_EXCLUDED_LEGACY = [
  'apps/plugins/manual/worldbuilding',
  'apps/plugins/manual/novel.bookscan',
  'apps/plugins/auto/novel.autowrite',
  'apps/plugins/shared/typography',
];

/* ------------------------------------------------------------------ 工具函数 */
function walk(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const lineAt = (src, idx) => src.slice(0, idx).split(/\r?\n/).length;

/**
 * 屏蔽注释（保留字符串），返回**等长**文本：注释区非换行字符替换为空格。
 * 目的：避免把注释里提到的 `/api/`、`@/components/ai/` 等误判为真实依赖/硬编码 base。
 * 等长保证行号与原文一致。字符串内的 `//`（如 `https://`）不会被误当注释。
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = Math.min(j + 2, n);
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') j += 2;
        else if (src[j] === q) { j++; break; }
        else j++;
      }
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

// 解析口径同 tools/import-graph.mjs：静态 `import … from '…'` + 动态 `import(…)` + `require(…)`。
// 必须支持跨行 `import {\n a,\n b\n} from 'x'`。
const IMPORT_RE =
  /(?:^|\n)[^\S\n]*import\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
// ★ t29 修复：`export … from '…'` 曾完全不在解析口径内 —— 于是
//   `export * from '<rel>/plugins/auto/workbench/web/discuss/ChatPanel'`
//   这类**再导出边**对门禁隐形（实测漏报）。此处补上三种形态：
//     `export * from 'x'` / `export { a, b } from 'x'` / `export type { T } from 'x'`，
//   并支持花括号跨行。刻意用「`*` 或 `{…}`」限定中段，避免 `export default fn` 与
//   后续语句的 `from` 误配（`[\s\S]*?` 会跨行吃掉 `;`）。
const EXPORT_RE =
  /(?:^|\n)[^\S\n]*export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g;
/** 参与依赖判定的说明符提取器（import 家族 + export-from 家族）。 */
const SPEC_PATTERNS = [
  { re: IMPORT_RE, kind: 'import' },
  { re: EXPORT_RE, kind: 'export-from' },
];

/** 解析后路径（相对其扫描根）：`@/x` → `x`；`./x` → 相对文件目录规范化；其余 → null。 */
function resolveSpec(spec, relPosix) {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(relPosix), spec));
  }
  return null;
}

/**
 * ★ t29 修复：把「相对扫描根」的解析结果折算成**仓库根相对**路径。
 *
 * 旧口径下 kernel 根（`apps/web/src`）里的相对引用只按 kernel 根判定，
 * 于是 `../../plugins/auto/workbench/web/discuss/ChatPanel` 解析成
 * `../plugins/auto/...`，既匹配不到 `^apps/plugins/auto/`，也匹配不到
 * `domainOfPath` 的任何前缀 → 落到 `'other'` → **跨域边对门禁隐形**。
 * 折算后即可用仓库路径判域。
 */
function toRepoRel(spec, rootEntry, relPosix) {
  const resolved = resolveSpec(spec, relPosix);
  if (resolved === null) return null;
  if (!resolved.startsWith('../')) return null; // 未逃出扫描根 ⇒ 交给原有 domainOfPath 口径
  return path.posix.normalize(path.posix.join(rootEntry.rel, resolved));
}

/** 仓库根相对路径的域判定（仅用于「逃出扫描根」的相对引用）。 */
const REPO_DOMAIN_BY_PATH = [
  [/^apps\/plugins\/auto\//, 'auto'],
  [/^apps\/plugins\/manual\//, 'manual'],
  [/^apps\/plugins\/shared\//, 'shared'],
  [/^apps\/web\/src\//, 'kernel'],
];
const repoDomainOfPath = (repoRel) => {
  for (const [re, dom] of REPO_DOMAIN_BY_PATH) if (re.test(repoRel)) return dom;
  return null;
};

/** 目标域：包名 / 裸路径 / `@/` / 相对路径 分别判定。 */
function targetDomain(spec, rootEntry, relPosix) {
  for (const [re, dom] of PKG_DOMAIN) if (re.test(spec)) return dom;
  if (spec.startsWith('@/')) return kernelRootDomain(spec.slice(2));
  if (spec.startsWith('.')) {
    // ★ t29：**先**判「是否逃出扫描根」。此步对**所有**根一律适用 ——
    //   原实现只在 kernel 根做（`if (rootEntry.module) return rootEntry.module;` 先行短路），
    //   于是 shared 根里 `../../../../auto/workbench/…` 这类逃逸会被误判成「本域内相对引用」
    //   （targetDomain 直接返回 'shared'）⇒ shared→auto 边隐形。这正是验收第 7 条
    //   要守的边，必须能看见。
    const repoRel = toRepoRel(spec, rootEntry, relPosix);
    if (repoRel) {
      const esc = repoDomainOfPath(repoRel);
      if (esc) return esc; // 逃进已知域（含本域，等价）⇒ 以仓库路径为准
      return rootEntry.module ?? 'other'; // 逃出但落在 apps/web 与 apps/plugins 之外
    }
    // 未逃出扫描根
    if (rootEntry.module) return rootEntry.module; // 模块/shared 内相对引用 = 本域
    const resolved = resolveSpec(spec, relPosix);
    return resolved ? domainOfPath(resolved) : 'other';
  }
  return null; // 其它外部包
}

/* ------------------------------------------------------------------ 主扫描 */
const violationsA = [];
const violationsAPrime = [];
const violationsB = [];
const violationsC = [];
const scanned = [];

for (const rootEntry of SCAN_ROOTS) {
  // D24：kernel 根的 module 为 null，而全量模式下 WITHOUT 亦为 null——
  // 必须显式排除「非模块根」，否则全量模式把 kernel 根整根跳过（空转假通过）。
  if (rootEntry.module !== null && WITHOUT === rootEntry.module) continue; // 模拟该模块被移除：不扫描、也不要求其存在
  const base = path.join(ROOT, rootEntry.rel);
  for (const abs of walk(base)) {
    const relPosix = path.relative(base, abs).replace(/\\/g, '/');
    const label = `${rootEntry.rel}/${relPosix}`;
    const srcDom = rootEntry.module ?? kernelRootDomain(relPosix);
    const src = fs.readFileSync(abs, 'utf8');
    const code = stripComments(src); // 注释不参与依赖/硬编码判定
    scanned.push(label);

    for (const { re: pattern, kind } of SPEC_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(code)) !== null) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (!spec) continue;
        const line = lineAt(code, m.index);
        const resolved = resolveSpec(spec, relPosix);
        const tgtDom = targetDomain(spec, rootEntry, relPosix);
        const via = spec.startsWith('@/') ? 'prefix' : spec.startsWith('.') ? 'relative' : 'package';

        // 断言 A：域对禁令
        // D41 例外：kernel 经**模块公开入口**（`@novel-plugins/<mod>-workbench/{web,stores}`）
        // 引用模块是设计明确允许的（设计 §6.3 断言 B；预言机 isolation-rules.json 的
        // K2M/K2A forbiddenPrefixes 亦不含该包名）——入口纪律由断言 B 单独把关，
        // 故此处不计 K2M/K2A。否则「kernel 只经入口引用模块」与「K2M=0」自相矛盾。
        if (tgtDom && srcDom !== tgtDom) {
          if (srcDom === 'kernel' && isModulePublicEntry(spec)) {
            // 公开入口：交断言 B 处理
          } else {
            for (const rule of EDGE_RULES) {
              if (rule.from === srcDom && rule.to === tgtDom) {
                violationsA.push({ dom: srcDom, label, line, spec, rule: rule.id, via, tgtDom, kind });
              }
            }
          }
        }
        // 断言 A'：兼容壳
        if (WITHOUT === 'manual' && srcDom === 'auto') {
          const hit =
            COMPAT_SHELL_SPEC_RE.test(spec) ||
            (resolved !== null && COMPAT_SHELL_RESOLVED_RE.test(resolved));
          if (hit) violationsAPrime.push({ dom: srcDom, label, line, spec, rule: "A'-COMPAT-SHELL" });
        }
        // 断言 B：kernel 引用模块包必须命中公开入口。
        // ★ t29 修复（旧实现的两个漏洞）：
        //   ① 只查了包名说明符 `@novel-plugins/x-workbench/...`，于是
        //      `@/components/ai/ChatPanel`（解析进 auto 域）与相对路径
        //      `../../plugins/auto/workbench/web/discuss/ChatPanel`
        //      （经 toRepoRel 落进 auto 域）**双双漏过** —— 而它们正是
        //      「kernel 深层引用模块内部文件」的两种真实写法。
        //   ② `em[2] === undefined` 的桶入口被放行；但桶入口**必须**指向
        //      模块 web/index.tsx（公开入口），故改为直接校验**解析后的落点**。
        if (srcDom === 'kernel') {
          const entry = moduleEntryHit(spec, rootEntry, relPosix);
          if (entry) violationsB.push({ dom: srcDom, label, line, spec, rule: 'B-ENTRY', kind, tgtDom: entry.dom });
        }
      }
    }
  }
}

const dedupByFileLineSpec = (arr) => {
  const seen = new Map();
  const out = [];
  for (const v of arr) {
    const k = `${v.label}:${v.line}:${v.spec}`;
    if (seen.has(k)) {
      const r = seen.get(k);
      if (!r.rules.includes(v.rule)) r.rules.push(v.rule);
    } else {
      const rec = { ...v, rules: [v.rule] };
      seen.set(k, rec);
      out.push(rec);
    }
  }
  return out;
};
const A = dedupByFileLineSpec(violationsA);
const APrime = dedupByFileLineSpec(violationsAPrime);
const B = dedupByFileLineSpec(violationsB);

/* --------------------------------------------------- 断言 C：字面量 `/api/` */
const activeRoot = (r) => r.module === null || r.module !== WITHOUT;
const apiScanRoots = [...SCAN_ROOTS.filter(activeRoot).map((r) => r.rel), ...API_SCAN_EXTRA];
let cSkipped = 0;
for (const rel of apiScanRoots) {
  const base = path.join(ROOT, rel);
  for (const abs of walk(base)) {
    const relPosix = path.relative(base, abs).replace(/\\/g, '/');
    const label = `${rel}/${relPosix}`;
    if (API_BASE_OWNER_RE.test(label)) continue; // base 唯一来源，豁免
    if (isTestFile(label)) {
      cSkipped++; // 测试输入 path，非硬编码 base
      continue;
    }
    const src = stripComments(fs.readFileSync(abs, 'utf8')); // 注释不参与判定
    const hits = [];
    for (const [re, rule] of [[API_LITERAL_RE, 'C-LITERAL'], [API_ENV_RE, 'C-ENV']]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) hits.push({ line: lineAt(src, m.index), spec: m[0], rule });
    }
    const seen = new Set();
    for (const h of hits) {
      const k = `${h.line}:${h.spec}:${h.rule}`;
      if (seen.has(k)) continue;
      seen.add(k);
      violationsC.push({ label, ...h });
    }
  }
}
const excludedLegacyHits = [];
for (const rel of API_SCAN_EXCLUDED_LEGACY) {
  for (const abs of walk(path.join(ROOT, rel))) {
    const src = fs.readFileSync(abs, 'utf8');
    if (new RegExp(API_LITERAL_RE.source).test(src) || new RegExp(API_ENV_RE.source).test(src)) {
      excludedLegacyHits.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
    }
  }
}

/* ------------------------------------------------------- 模块存在性断言 */
// ★ t10（AI 写作模块剥离）：本门禁原把「两模块目录都在」当不变量 —— 只要 MODULE_DIRS
//   里任一目录不存在就判失败。剥离后 `apps/plugins/auto/workbench/web` 是**设计上
//   不应存在**的（实现已移出仓外，仓内仅剩骨架，见 .workbuddy/strip-auto-research/
//   MANIFEST.json）。故把「受支持缺席」与「真缺失」分开计：
//     · SUPPORTED_ABSENT 内的模块缺席 = 受支持状态，**不计违规**（打印一行说明）；
//     · 其余（尤其 REQUIRED_MODULES 里的 manual 手写台）缺席 = **仍然判失败**。
//   ⇒ 这不是无差别放行：手写台（manual）是本门禁的基线模块，它一缺席立刻 exit 1。
//   与同仓库既有先例（verify-manifest-validity.mjs:269「模块不在场（已移除态）⇒ 跳过，
//   不计违规」）口径一致；差别在于那边对 manual/auto 都豁免（它是纯契约校验），
//   而本门禁必须区分对待 —— 故此处显式引入 REQUIRED_MODULES，而**不能**照抄。
const SUPPORTED_ABSENT = new Set(['auto']); // auto 实现已剥离：缺席是受支持状态
const REQUIRED_MODULES = ['manual'];        // 手写台必须存在：缺席 = 失败
// ★ 测试专用负向控制：VERIFY_FORCE_ABSENT=manual 时，把指定模块**当作缺席**处理，
//   用于证明「手写台缺席仍会致红」这条检测力没有被豁免掉（本仓库禁止真去改
//   apps/plugins/** 的目录名 —— 那超出本门禁的写范围，且会污染工作树）。
const FORCE_ABSENT = new Set(
  String(process.env.VERIFY_FORCE_ABSENT ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);
const missing = []; // 真缺失 ⇒ 判失败
const absent = [];  // 受支持缺席 ⇒ 不计违规
for (const [mod, dir] of Object.entries(MODULE_DIRS)) {
  if (WITHOUT === mod) continue; // 模拟移除：不要求存在
  const exists = fs.existsSync(path.join(ROOT, dir)) && !FORCE_ABSENT.has(mod);
  if (exists) continue;
  (SUPPORTED_ABSENT.has(mod) ? absent : missing).push(`${mod}: ${dir}`);
}
for (const mod of REQUIRED_MODULES) {
  // 冗余守护：若某天 SUPPORTED_ABSENT 被误写成含 manual，这里仍强制它属「真缺失」。
  if (WITHOUT === mod) continue;
  const forced = FORCE_ABSENT.has(mod);
  const gone = !fs.existsSync(path.join(ROOT, MODULE_DIRS[mod])) || forced;
  if (gone && !missing.some((m) => m.startsWith(`${mod}:`))) {
    missing.push(`${mod}: ${MODULE_DIRS[mod]}${forced ? '（VERIFY_FORCE_ABSENT 注入）' : ''}`);
  }
}

/* --------------------------------------------------------- 断言 E：基线不退化 */
// ★ t29 修复（D44-1 教训）：旧实现有三处失真 ——
//   ① 未做**空转守卫**：模块缺席时 vitest 的 include glob 命中 0 文件仍 exit 0，
//      于是「测试全没了」也会被判「基线不退化」；
//   ② 阈值写死 ≥182，在 --without 场景下**数学上不可达**（移走模块必然少其自身用例）；
//   ③ 压根**没在模拟移除树上跑**（目录未移动，测的是全量树）。
//   现改为：**真实委托** `verify-module-removal.mjs`（它才持有 renameSync + finally 还原 +
//   指纹校验的完整实现），在其真正移走目录的树上跑 type-check/test，并要求它报告
//   「收集文件数 == 现存数 且非 0」与「通过数 == 182 − 该模块自身用例数」。
//   本脚本**不**自己复制移目录逻辑 —— 避免两处实现漂移，也避免并发抢目录（D47）。
//   `--without` 缺省时（全量）仍做本地 L2/L3，阈值 = 基线 182。
const TEST_RE = /\.(test|spec)\.(ts|tsx)$/;
const TEST_ROOTS = ['apps/web/src', 'apps/plugins/manual/workbench', 'apps/plugins/auto/workbench', 'apps/plugins/shared'];
const BASELINE_TESTS = 182;
const MODULE_OWN_TESTS = { manual: 12, auto: 58 }; // 实测：manual 2 文件/12 用例，auto 4 文件/58 用例
function countDiskTestFiles() {
  let n = 0;
  const stack = TEST_ROOTS.map((r) => path.join(ROOT, r)).filter((p) => fs.existsSync(p));
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (TEST_RE.test(e.name)) n++;
    }
  }
  return n;
}
/** pnpm 调用统一带 `--config.verify-deps-before-run=false`（详见 verify-module-removal.mjs 的说明）。 */
const runPnpm = (script) =>
  spawnSync('pnpm', ['--config.verify-deps-before-run=false', '--filter', '@novel/web', script], {
    cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
let assertionE = { status: 'skipped', detail: '未运行（加 --with-tests 执行 L2/L3）' };
if (WITH_TESTS) {
  if (WITHOUT) {
    // 委托真实移除预言机：它会在**真移走目录**的树上跑，并在 finally 里还原 + 校验指纹。
    const oracle = path.join(ROOT, 'scripts/verify/verify-module-removal.mjs');
    const r = spawnSync(process.execPath, [oracle, '--module', WITHOUT], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const collected = Number((out.match(/收集文件\s+(\d+)（现存\s*(\d+)）/) ?? [])[1]);
    const disk = Number((out.match(/收集文件\s+(\d+)（现存\s*(\d+)）/) ?? [])[2]);
    const passed = Number((out.match(/通过\s+(\d+)（期望\s*(\d+)）/) ?? [])[1]);
    const expected = Number((out.match(/通过\s+(\d+)（期望\s*(\d+)）/) ?? [])[2]);
    const restored = /还原后指纹: files=\d+ bytes=\d+\s+✓ 与移走前一致/.test(out);
    const notVacuous = Number.isFinite(collected) && collected > 0 && collected === disk;
    const ok =
      r.status === 0 && notVacuous && restored &&
      Number.isFinite(passed) && Number.isFinite(expected) && passed === expected;
    assertionE = {
      status: ok ? 'passed' : 'failed',
      detail:
        `在**真实移除树**上跑（委托 verify-module-removal.mjs --module ${WITHOUT}，exit ${r.status}）；` +
        `收集文件数 ${Number.isFinite(collected) ? collected : '未解析'} == 现存 ${Number.isFinite(disk) ? disk : '未解析'}（非空转守卫）${notVacuous ? '✓' : '✗'}；` +
        `通过 ${Number.isFinite(passed) ? passed : '未解析'} == 期望 ${Number.isFinite(expected) ? expected : '未解析'}（= ${BASELINE_TESTS} − ${WITHOUT} 自身 ${MODULE_OWN_TESTS[WITHOUT]}）；` +
        `还原指纹一致 ${restored ? '✓' : '✗'}`,
    };
    if (!ok) console.error(`[门禁] 断言 E 失败，预言机输出尾部:\n${out.split(/\r?\n/).slice(-14).join('\n')}`);
  } else {
    const tc = runPnpm('type-check');
    const ts = runPnpm('test');
    const tsOut = `${ts.stdout ?? ''}${ts.stderr ?? ''}`;
    const collected = Number((tsOut.match(/Test Files\s+(\d+)\s+passed/) ?? [])[1]);
    const passed = Number((tsOut.match(/Tests\s+(\d+)\s+passed/) ?? [])[1]);
    const disk = countDiskTestFiles();
    const notVacuous = Number.isFinite(collected) && collected > 0 && collected === disk;
    const ok = tc.status === 0 && ts.status === 0 && notVacuous && Number.isFinite(passed) && passed >= BASELINE_TESTS;
    assertionE = {
      status: ok ? 'passed' : 'failed',
      detail:
        `全量树：L2 type-check exit ${tc.status}；L3 test exit ${ts.status}；` +
        `收集文件数 ${Number.isFinite(collected) ? collected : '未解析'} == 磁盘实测 ${disk}（非空转守卫）${notVacuous ? '✓' : '✗'}；` +
        `用例数 ${Number.isFinite(passed) ? passed : '未解析'}（期望 ≥${BASELINE_TESTS}）`,
    };
  }
}

/* ------------------------------------------- 断言 D：构建期清单一致性（可判定） */
// ★ t29：原实现直接打印「无法判定」（D32-Q7 的载体未编码）。现 D32-Q7 已落地（t3）：
//   `main.tsx` 的 `staticEntries` 已删除模块静态条目，模块入口改由 `import.meta.glob`
//   按模式目录自动收集 ⇒ 缺席模块的入口文件不存在 ⇒ 不被收集 ⇒ 无悬空 import。
//   故本断言现可判定：①载体（glob 模式目录）存在；②staticEntries 内模块入口说明符 = 0。
let assertionD;
{
  const mainPath = path.join(ROOT, 'apps/web/src/main.tsx');
  const mainSrc = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '';
  const globCarrier = /import\.meta\.glob\(\s*\[[\s\S]*?plugins\/(manual|auto)\/\*\/web\/index\.tsx[\s\S]*?\]/.test(mainSrc);
  // staticEntries 段内是否仍硬编码模块入口
  const seMatch = mainSrc.match(/const staticEntries[\s\S]*?\n\s*\];/);
  const seBlock = seMatch ? seMatch[0] : '';
  const staticHits = (seBlock.match(/@novel-plugins\/(manual|auto)-workbench/g) ?? []).length;
  // 模块入口文件本身不得在 kernel 任何处被静态 import（缺席即解析失败）
  let staticModuleImports = 0;
  for (const abs of walk(path.join(ROOT, 'apps/web/src'))) {
    const src = stripComments(fs.readFileSync(abs, 'utf8'));
    staticModuleImports += (src.match(/['"]@novel-plugins\/(manual|auto)-workbench/g) ?? []).length;
  }
  const ok = globCarrier && staticHits === 0 && staticModuleImports === 0;
  assertionD = {
    status: ok ? 'passed' : 'failed',
    detail:
      `载体 import.meta.glob 收集模式目录 ${globCarrier ? '✓' : '✗'}；` +
      `staticEntries 内模块入口说明符 ${staticHits} 个（期望 0）；` +
      `kernel 内模块入口静态 import ${staticModuleImports} 个（期望 0）` +
      (WITHOUT ? `；本次为**扫描级**模拟（--without ${WITHOUT} 仅跳过扫描根，目录未移动）；真实移除证据见 scripts/verify/verify-module-removal.mjs` : ''),
  };
}

/* ------------------------------------------------------------------ 输出 */
const mode = WITHOUT ? `--without ${WITHOUT}` : '全量';
console.log(`[门禁] 工作台隔离检查（${mode}）`);
console.log(`扫描根: ${SCAN_ROOTS.filter(activeRoot).map((r) => r.rel).join(', ')}`);
console.log(`文件数: ${scanned.length}${WITHOUT ? `（已模拟移除 ${WITHOUT} 模块）` : ''}`);

const fmt = (v) => `  ✗ [${v.dom}] ${v.label}:${v.line}  import '${v.spec}'  (rule=${v.rules.join(',')})`;

console.log(`\n断言 A（跨域 import 禁令）: ${A.length} 条`);
for (const v of A) console.log(fmt(v));
const byVia = (x) => A.filter((v) => v.via === x).length;
const byRule = (id) => A.filter((v) => v.rules.includes(id)).length;
console.log(
  `  口径分解: M2A=${byRule('M2A')} A2M=${byRule('A2M')} K2M=${byRule('K2M')} K2A=${byRule('K2A')}` +
    ` S2A=${byRule('S2A')} S2M=${byRule('S2M')}` +
    ` | 前缀口径=${byVia('prefix')} 相对路径口径=${byVia('relative')} 包名口径=${byVia('package')}`,
);
console.log(`断言 A'（兼容壳禁令，仅 --without manual）: ${APrime.length} 条`);
for (const v of APrime) console.log(fmt(v));
console.log(`断言 B（模块入口纪律）: ${B.length} 条`);
for (const v of B) console.log(fmt(v));
console.log(`断言 C（字面量 '/api/' 禁令）: ${violationsC.length} 条`);
for (const v of violationsC) console.log(`  ✗ ${v.label}:${v.line}  ${v.rule}  ${v.spec}`);
console.log(`  例外面（既有第三方插件，不在拆分/写范围内，仅计数不判失败）: ${excludedLegacyHits.length} 个文件`);
console.log(`  已豁免: base 唯一来源 apiClient；测试文件 ${cSkipped} 个（'/api/xxx' 为输入 path，非硬编码 base）`);
console.log(`缺失模块目录: ${missing.length} 个`);
for (const x of missing) console.log(`  ✗ 模块目录不存在: ${x}`);
// ★ t10：受支持缺席单列，不计违规（如 auto 实现已剥离）。手写台若缺失则走上面 missing 分支。
console.log(`受支持缺席模块（已剥离态，不计违规）: ${absent.length} 个`);
for (const x of absent) console.log(`  · 模块目录不在场（已剥离态）⇒ 跳过，不计违规: ${x}`);
console.log(`断言 D（构建期清单一致性）: ${assertionD.status} — ${assertionD.detail}`);
console.log(`断言 E（基线不退化${WITHOUT ? `，WITHOUT=${WITHOUT} 模拟树` : ''}）: ${assertionE.status} — ${assertionE.detail}`);
if (WITHOUT) console.log(`  （模拟树口径：扫描级模拟；真实目录移动与还原指纹见 verify-module-removal.mjs）`);

const counters = {
  A: A.length,
  "A'": APrime.length,
  B: B.length,
  C: violationsC.length,
  缺失: missing.length,
  受支持缺席: absent.length,
  M2A: byRule('M2A'),
  A2M: byRule('A2M'),
  K2M: byRule('K2M'),
  K2A: byRule('K2A'),
  文件数: scanned.length,
};

/* --expect：仅校验所列计数器（未列项忽略）；全部匹配 → 通过。 */
let expectOk = true;
if (EXPECT.length > 0) {
  console.log(`\n--expect 校验（仅校验所列计数器）：`);
  for (const { key, want } of EXPECT) {
    const got = counters[key];
    const ok = got === want;
    if (!ok) expectOk = false;
    console.log(`  ${ok ? '✓' : '✗'} ${key}: 期望 ${want}，实际 ${got}`);
  }
}

const defaultFailed =
  A.length > 0 || APrime.length > 0 || B.length > 0 || violationsC.length > 0 ||
  missing.length > 0 || assertionD.status === 'failed' || assertionE.status === 'failed';

const failed = EXPECT.length > 0 ? !expectOk : defaultFailed;

if (EXPECT.length > 0) {
  console.log(
    failed
      ? `\n✗ 门禁失败（--expect 不匹配）：A=${A.length} A'=${APrime.length} B=${B.length} C=${violationsC.length} 缺失=${missing.length}`
      : `\n✓ 门禁通过（--expect 所列计数器全部匹配）：${EXPECT.map((e) => `${e.key}=${e.want}`).join(' ')}`,
  );
} else {
  console.log(
    failed
      ? `\n✗ 门禁失败：A=${A.length} A'=${APrime.length} B=${B.length} C=${violationsC.length} 缺失=${missing.length}`
      : `\n✓ 门禁通过：0 违规、0 缺失${assertionE.status === 'skipped' ? '（断言 E 未运行）' : ''}`,
  );
}
process.exit(failed ? 1 : 0);
