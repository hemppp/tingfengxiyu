// ============================================================
// verify-theme-single-source.mjs —— 主题色「单一真源」机检
//
// 契约真源：docs/architecture/dock-protocol-adr.md §5.1 / §5.5 / §6.4
//
// 断言的不变量（任一不成立 ⇒ 非 0 退出并打印 `文件:行`）：
//   1. **唯一真源**：`--vscode-*` 的**定义**只允许出现在
//      `apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css`。
//      白名单只有两个文件：真源自身 + 副本转发层（见 3）。
//   2. 真源自洽：无重复定义；定义只落在 `:root` / `html.dark` 选择器内
//      （ADR §5.1：**不得**写在 `.some-component { --x: … }` 里，否则插件继承不到）；
//      两个块都在；token 数不低于冻结基线 117。
//   3. 副本转发层：`apps/web/src/components/shell/dock/dock-tokens.css`
//      **必须 0 个 token 定义**，且必须仍以 `@import` 转发真源，
//      且不含字面色值（其文件头自述的约束）。
//   4. 构建产物与 node_modules 不参与扫描（dist 里出现定义是正常的）。
//
// ★★ 关键分类规则：`var(--vscode-*)` 是**引用**，不是定义。
//   `apps/web/tailwind.config.js` 里通篇是 `'var(--vscode-editor-background)'`
//   这类**取值映射**（本文件只做映射、不写死色值），若把它误判为「定义」，
//   就会把合法的引用层报成第二个真源 —— 那是**误报**，本脚本必须避免。
//   实现：先剥离全部 `var(...)` 调用，再在剩余文本里找 `--vscode-<name>:`，
//   这样 `editor: 'var(--vscode-editor-background)'` 剥完只剩 `editor: '',`
//   ⇒ 不命中；而真正的 CSS/内联定义 `--vscode-x: hsl(...)` 仍会命中。
//   （`style={{ '--vscode-x': v }}` 在 TSX 里也是**真实定义**，故也纳入扫描。）
//
// 用法：
//   node scripts/verify/verify-theme-single-source.mjs
// 退出码：0 = 全部不变量成立；1 = 有违反；2 = 环境/契约文件缺失（无法判定）
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// ---- 契约常量（冻结） ------------------------------------------------------
const TRUE_SOURCE = 'apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css';
const COPY_FORWARD = 'apps/web/src/components/shell/dock/dock-tokens.css';
/** ADR §5.3 冻结的 token 数量基线；只允许增加（增加时同步更新 ADR）。 */
const BASELINE_TOKEN_COUNT = 117;
/** 副本转发层必须引用的模块说明符（@import 目标）。 */
const FORWARD_TARGET = '@novel-plugins/ui-kit/styles/vscode-dark-modern.css';

/** 定义白名单：只有这两个文件可以出现 `--vscode-*` 定义。 */
const DEFINITION_WHITELIST = new Set([TRUE_SOURCE, COPY_FORWARD]);

/** 扫描的文件类型（含 tsx：内联 style 里写自定义属性是真实定义）。 */
const SCAN_EXTS = new Set([
  '.css', '.scss', '.sass', '.less',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.vue', '.svelte',
]);

/** 不参与扫描的目录（构建产物 / 依赖 / 工具临时区）。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.workbuddy', 'coverage']);

const TOKEN_NAME_RE = /--vscode-[A-Za-z0-9_-]+/g;
/** 剥离 `var(...)` 调用后，仍形如 `--vscode-x:` 的才是**定义**。 */
const DEFINITION_RE = /--vscode-[A-Za-z0-9_-]+\s*:/g;

const failures = [];
const warnings = [];
const notes = [];

/** 违规记录：统一 `文件:行` 前缀，便于机检与人工定位。 */
function fail(where, message) {
  failures.push(where ? `${where}: ${message}` : message);
}
function warn(message) {
  warnings.push(message);
}

// ---- 工具 ------------------------------------------------------------------

/** 把注释替换为等长空白（保留换行 ⇒ 行号与原文一一对应）。 */
function blankComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, ' '));
}

/** 剥离 `var(...)` 调用（含嵌套参数），返回等长文本（换行保留）。 */
function blankVarCalls(text) {
  let out = text;
  // 反复剥离，处理 `var(--a, var(--b))` 这类嵌套
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/var\([^()]*\)/g, (m) => m.replace(/[^\n]/g, ' '));
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 递归收集待扫描文件（工作区相对 POSIX 路径）。 */
function collectFiles(absDir, relDir = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...collectFiles(path.join(absDir, e.name), rel));
    } else if (e.isFile() && SCAN_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 逐行求「当前所处选择器」——用于校验定义是否落在 :root / html.dark 内。
 * 先抹掉注释（等长替换）再扫描花括号，保证行号不变。
 */
function computeSelectorPerLine(cleanText) {
  const lines = cleanText.split('\n');
  const selectorAt = new Array(lines.length).fill(null);
  const stack = [];
  let buf = '';
  for (let i = 0; i < lines.length; i++) {
    selectorAt[i] = stack.length ? stack[stack.length - 1] : null;
    for (const ch of lines[i]) {
      if (ch === '{') {
        stack.push(buf.trim().replace(/\s+/g, ' '));
        buf = '';
      } else if (ch === '}') {
        stack.pop();
        buf = '';
      } else {
        buf += ch;
      }
    }
  }
  return selectorAt;
}

/** 选择器是否为 ADR §5.1 允许的根选择器。 */
function isRootSelector(sel) {
  if (!sel) return false;
  // 允许 `:root` / `html.dark` 单独或成组（`:root, html.dark`）
  const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => p === ':root' || /^html\.dark$/.test(p) || /^html\[data-theme=/.test(p));
}

// ---- 0) 契约文件必须存在 ---------------------------------------------------
const trueSourceAbs = path.join(ROOT, TRUE_SOURCE);
const copyForwardAbs = path.join(ROOT, COPY_FORWARD);

let hardStop = false;
for (const [rel, abs, label] of [
  [TRUE_SOURCE, trueSourceAbs, '真源'],
  [COPY_FORWARD, copyForwardAbs, '副本转发层'],
]) {
  if (!fs.existsSync(abs)) {
    fail(rel, `${label}文件不存在（契约被破坏：无法判定单一真源）`);
    hardStop = true;
  }
}
if (hardStop) {
  console.error('❌ verify-theme-single-source：契约文件缺失，无法判定');
  for (const f of failures) console.error(`   · ${f}`);
  process.exit(2);
}

const trueSourceText = fs.readFileSync(trueSourceAbs, 'utf8');
const copyForwardText = fs.readFileSync(copyForwardAbs, 'utf8');

// ---- 1) 真源自洽 -----------------------------------------------------------
{
  const clean = blankComments(trueSourceText);
  const stripped = blankVarCalls(clean);
  const lines = stripped.split('\n');
  const selectorAt = computeSelectorPerLine(clean);

  const names = [];
  const definitionSites = []; // {name, line, selector}

  for (let i = 0; i < lines.length; i++) {
    DEFINITION_RE.lastIndex = 0;
    let m;
    while ((m = DEFINITION_RE.exec(lines[i])) !== null) {
      const name = m[0].replace(/\s*:$/, '').trim();
      names.push(name);
      definitionSites.push({ name, line: i + 1, selector: selectorAt[i] });
    }
  }

  // 1a) 必须定义在 :root / html.dark 内
  const badSelectors = definitionSites.filter((d) => !isRootSelector(d.selector));
  for (const d of badSelectors) {
    fail(`${TRUE_SOURCE}:${d.line}`, `定义 ${d.name} 落在非根选择器 \`${d.selector ?? '(顶层)'}\` 内`
      + '（ADR §5.1：必须写在 :root / html.dark 上，否则插件继承不到）');
  }

  // 1b) 两个根块都要在（:root 与 html.dark 各至少一处定义）
  const hasRoot = definitionSites.some((d) => (d.selector ?? '').includes(':root'));
  const hasDark = definitionSites.some((d) => (d.selector ?? '').includes('html.dark'));
  if (!hasRoot) fail(TRUE_SOURCE, '真源缺少 `:root` 块的定义（ADR §5.1 要求 :root + html.dark 双块）');
  if (!hasDark) fail(TRUE_SOURCE, '真源缺少 `html.dark` 块的定义（ADR §5.1 要求 :root + html.dark 双块）');

  // 1c) 无重复定义
  const seen = new Map();
  for (const d of definitionSites) {
    if (seen.has(d.name)) {
      fail(`${TRUE_SOURCE}:${d.line}`, `重复定义 ${d.name}（首次出现于第 ${seen.get(d.name)} 行）`);
    } else {
      seen.set(d.name, d.line);
    }
  }

  // 1d) token 数不低于冻结基线
  const distinct = new Set(names);
  if (distinct.size < BASELINE_TOKEN_COUNT) {
    fail(TRUE_SOURCE, `token 数 ${distinct.size} 少于冻结基线 ${BASELINE_TOKEN_COUNT}`
      + '（有 token 被删/漏迁 ⇒ 消费方会静默回落）');
  } else if (distinct.size > BASELINE_TOKEN_COUNT) {
    warn(`真源 token 数 ${distinct.size} > 基线 ${BASELINE_TOKEN_COUNT}：已新增 token，`
      + '请同步更新 ADR §5.3 与 scripts/verify/verify-theme-single-source.mjs 的基线常量');
  }
  notes.push(`真源：${TRUE_SOURCE} —— ${definitionSites.length} 行定义 / ${distinct.size} 个唯一 token`);
}

// ---- 2) 副本转发层：0 定义 + 仍转发 + 无字面色值 ---------------------------
{
  const clean = blankComments(copyForwardText);
  const stripped = blankVarCalls(clean);
  const lines = stripped.split('\n');

  let defCount = 0;
  for (let i = 0; i < lines.length; i++) {
    DEFINITION_RE.lastIndex = 0;
    let m;
    while ((m = DEFINITION_RE.exec(lines[i])) !== null) {
      defCount++;
      fail(`${COPY_FORWARD}:${i + 1}`, `副本转发层出现 token 定义 ${m[0].trim()}`
        + '（契约要求 0 定义：一切色值真源唯一，副本只做 @import 转发）');
    }
  }

  // 仍必须以 @import 转发真源（否则 DockShell.tsx:41 的 import 会变成空操作）
  const forwards = clean.includes('@import') && clean.includes(FORWARD_TARGET);
  if (!forwards) {
    fail(COPY_FORWARD, `未找到转发真源的 \`@import '${FORWARD_TARGET}'\``
      + '（副本必须转发真源；若已决定删除本层，需同时改 DockShell.tsx 的 import 与 ADR）');
  }

  // 副本自述约束：不得含字面色值
  const literalHits = [];
  const literalRe = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(\s*[\d.]/g;
  for (let i = 0; i < lines.length; i++) {
    literalRe.lastIndex = 0;
    let m;
    while ((m = literalRe.exec(lines[i])) !== null) {
      literalHits.push({ line: i + 1, text: m[0] });
    }
  }
  for (const h of literalHits) {
    fail(`${COPY_FORWARD}:${h.line}`, `副本转发层含字面色值 \`${h.text}\``
      + '（其文件头自述约束：不得写入任何 --vscode-* 定义或字面色值）');
  }

  notes.push(`副本：${COPY_FORWARD} —— ${defCount} 个定义（要求 0），`
    + `转发 @import：${forwards ? '有' : '无'}，字面色值：${literalHits.length} 处（要求 0）`);
}

// ---- 3) 全仓扫描：定义只允许出现在白名单内 ---------------------------------
{
  const files = collectFiles(ROOT);
  const offending = [];

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    // 快速预筛：不含 `--vscode-` 直接跳过（99% 的文件）
    if (!text.includes('--vscode-')) continue;

    const clean = blankComments(text);
    const stripped = blankVarCalls(clean);
    const lines = stripped.split('\n');

    for (let i = 0; i < lines.length; i++) {
      DEFINITION_RE.lastIndex = 0;
      let m;
      while ((m = DEFINITION_RE.exec(lines[i])) !== null) {
        offending.push({ rel, line: i + 1, token: m[0].trim(), whitelisted: DEFINITION_WHITELIST.has(rel) });
      }
    }
  }

  const outside = offending.filter((o) => !o.whitelisted);
  for (const o of outside) {
    fail(`${o.rel}:${o.line}`, `白名单外的 --vscode-* 定义 ${o.token}`
      + `（唯一真源只能是 ${TRUE_SOURCE}；本文件只应**引用** var(--vscode-*)，不应定义）`);
  }

  notes.push(`全仓扫描：${files.length} 个文件，命中 --vscode-* 定义 ${offending.length} 处`
    + `（白名单内 ${offending.length - outside.length} / 白名单外 ${outside.length}）`);
}

// ---- 4) tailwind.config.js 必须被判为「引用」而非「定义」（回归护栏） ------
{
  const TW = 'apps/web/tailwind.config.js';
  const twAbs = path.join(ROOT, TW);
  if (fs.existsSync(twAbs)) {
    const text = fs.readFileSync(twAbs, 'utf8');
    const clean = blankComments(text);
    const stripped = blankVarCalls(clean);
    const lines = stripped.split('\n');

    let twDefs = 0;
    for (let i = 0; i < lines.length; i++) {
      DEFINITION_RE.lastIndex = 0;
      if (DEFINITION_RE.test(lines[i])) {
        twDefs++;
        fail(`${TW}:${i + 1}`, 'tailwind 配置里出现 --vscode-* **定义**'
          + '（本文件只做取值映射，应写 `var(--vscode-*)` 引用）');
      }
    }

    // 正向前置：确实存在引用，才说明上面的「0 定义」不是因为文件被清空
    const refCount = (text.match(/var\(--vscode-[A-Za-z0-9_-]+\)/g) ?? []).length;
    if (refCount === 0) {
      warn(`${TW} 未发现任何 var(--vscode-*) 引用：请确认取值映射层是否已迁移`);
    } else {
      notes.push(`${TW}：${refCount} 处 var(--vscode-*) **引用**，${twDefs} 处定义`
        + '（引用不算定义 —— 分类规则生效）');
    }
  } else {
    warn(`${TW} 不存在，跳过 tailwind 引用/定义分类护栏`);
  }
}

// ---- 输出 ------------------------------------------------------------------
console.log('===== verify-theme-single-source =====');
console.log(`根目录: ${ROOT}`);
for (const n of notes) console.log(`  · ${n}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);

if (failures.length === 0) {
  console.log('\n✅ 主题单一真源不变量全部成立');
  console.log(`   唯一真源: ${TRUE_SOURCE}`);
  console.log(`   副本转发: ${COPY_FORWARD}（0 定义，纯 @import）`);
  process.exit(0);
}

console.error(`\n❌ verify-theme-single-source：${failures.length} 项违反`);
for (const f of failures) console.error(`   · ${f}`);
console.error('\n   契约: docs/architecture/dock-protocol-adr.md §5.1 / §5.5 / §6.4');
console.error(`   真源: ${TRUE_SOURCE}`);
process.exit(1);