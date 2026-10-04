#!/usr/bin/env node
/**
 * measure-ink-consumers.mjs —— `--ink*` 遗留别名「消费点计数」的口径裁定工具
 *
 * ## 为什么需要这个脚本
 *
 * `--ink` / `--ink-light` / `--ink-pale` 三个遗留别名的消费点计数，在不同报告中
 * 出现过 **187 / 186 / 182 / 181 / 190** 五个数字。争议不是「谁数错了」，而是
 * **口径被混用**：有人把注释文本里出现的 token 名算作消费点，同时又把手写回退
 * 写法 `var(--ink-pale, 0 0% 58%)` 排除在「严格计数」之外 —— 这种混合口径
 * 既不是「原样计数」也不是「严格计数」，无法被任何单一定义复现。
 *
 * 本脚本把口径**显式化并一次性全部输出**，任何文档引用时必须指明所用口径。
 * 它是测量工具，**不是门禁**：退出码恒为 0。
 *
 * ## 口径定义（三者互相独立，禁止混用）
 *
 * | 口径 | 正则 | 含义 |
 * |---|---|---|
 * | **A_raw**  | `var\(\s*<token>(?=\s*[,)])` | **含**块注释内出现。历史文档所称「原样 grep 计数」，是「宁可多算」的保守口径。 |
 * | **B_code** | 同 A，但剔除位于 `/* … *\/` 内的出现 | **真实代码消费点**。 |
 * | **C_bare** | `<token>(?=$|[,);\s])` | **裸 token 名**（含注释里的映射说明行）。仅用于解释「为何有人数出更大的值」，**不是消费点口径**。 |
 *
 * ## 判据要点（易错处）
 *
 * - 回退写法 `hsl(var(--ink-pale, 0 0% 58%))` **是**消费点（它读取该变量）。
 *   正则用 `(?=\s*[,)])` 前瞻，故 `var(--ink)`、`var(--ink, fb)`、`var(--ink / 0.35)` 均计入。
 * - `--ink` **不会**误配 `--ink-light`：`--ink` 之后是 `-`，不满足 `\s*[,)]`。
 * - 本脚本只看 `apps/` 与 `packages/`（产品源码），排除 `node_modules` / `dist` /
 *   `build` / `out`。扩展名限定 `.ts .tsx .css .js .jsx`。
 *
 * ## 用法
 *
 * ```
 * node scripts/verify/measure-ink-consumers.mjs
 * ```
 */

import fs from 'node:fs';
import path from 'node:path';

/** 仓库根：本脚本位于 <root>/scripts/verify/ */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

const SCAN_ROOTS = ['apps', 'packages'];
const EXTS = new Set(['.ts', '.tsx', '.css', '.js', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage']);

const TOKENS = ['--ink', '--ink-light', '--ink-pale'];

/** 收集待扫描文件（确定性顺序：排序后遍历，保证输出可 diff）。 */
function collectFiles() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(p);
      } else if (EXTS.has(path.extname(e.name))) {
        files.push(p);
      }
    }
  };
  for (const r of SCAN_ROOTS) walk(path.join(ROOT, r));
  return files;
}

/** 块注释区间（`/* … *\/`），用于 B_code 口径剔除。 */
function commentSpans(text) {
  const spans = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function main() {
  const files = collectFiles();
  const filesByRoot = SCAN_ROOTS.map(
    (r) => `${r}/: ${files.filter((f) => rel(f).startsWith(`${r}/`)).length} 文件`,
  );

  /** hits[token][caliber] = [{file, line, text}] */
  const hits = {};
  for (const t of TOKENS) hits[t] = { A_raw: [], B_code: [], C_bare: [] };

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const spans = commentSpans(text);
    const inComment = (i) => spans.some(([s, e]) => i >= s && i < e);
    const lineOf = (i) => text.slice(0, i).split('\n').length;

    for (const t of TOKENS) {
      const esc = t.replace(/-/g, '\\-');

      // A_raw / B_code：var() 用法（含手写回退写法）
      const reVar = new RegExp(`var\\(\\s*${esc}(?=\\s*[,)])`, 'g');
      let m;
      while ((m = reVar.exec(text))) {
        const line = lineOf(m.index);
        const snippet = (text.split('\n')[line - 1] || '').trim().slice(0, 120);
        const rec = { file: rel(f), line, snippet };
        hits[t].A_raw.push(rec);
        if (!inComment(m.index)) hits[t].B_code.push(rec);
      }

      // C_bare：裸 token 名（含注释里的映射说明行）
      const reBare = new RegExp(`${esc}(?=$|[,);\\s])`, 'g');
      while ((m = reBare.exec(text))) {
        const line = lineOf(m.index);
        hits[t].C_bare.push({
          file: rel(f),
          line,
          snippet: (text.split('\n')[line - 1] || '').trim().slice(0, 120),
        });
      }
    }
  }

  const CALIBERS = ['A_raw', 'B_code', 'C_bare'];
  const LABEL = {
    A_raw: 'A_raw  var() 含注释（历史文档口径，保守）',
    B_code: 'B_code var() 剔除注释（真实代码消费点）',
    C_bare: 'C_bare 裸 token 名含注释（非消费点，仅备查）',
  };

  console.log('=== measure-ink-consumers ===');
  console.log(`root            : ${ROOT.split(path.sep).join('/')}`);
  console.log(`scan            : ${SCAN_ROOTS.join(', ')}  (${filesByRoot.join(' | ')})`);
  console.log(`exts            : ${[...EXTS].join(' ')}`);
  console.log(`skip dirs       : ${[...SKIP_DIRS].join(' ')}`);
  console.log(`files scanned   : ${files.length}`);
  console.log('');

  const totals = {};
  for (const c of CALIBERS) totals[c] = 0;

  console.log('token'.padEnd(14) + CALIBERS.map((c) => c.padStart(9)).join('') + '    合计');
  for (const t of TOKENS) {
    const row = CALIBERS.map((c) => hits[t][c].length);
    row.forEach((n, i) => (totals[CALIBERS[i]] += n));
    console.log(t.padEnd(14) + row.map((n) => String(n).padStart(9)).join('') + String(row.reduce((a, b) => a + b, 0)).padStart(8));
  }
  console.log(
    '合计'.padEnd(14) +
      CALIBERS.map((c) => String(totals[c]).padStart(9)).join('') +
      String(CALIBERS.reduce((a, c) => a + totals[c], 0)).padStart(8),
  );

  console.log('');
  console.log('=== 口径说明 ===');
  for (const c of CALIBERS) console.log(`  ${LABEL[c]}  ⇒ 合计 ${totals[c]}`);

  const onlyInA = (t) =>
    hits[t].A_raw.filter(
      (a) => !hits[t].B_code.some((b) => b.file === a.file && b.line === a.line),
    );

  console.log('');
  console.log('=== A_raw 与 B_code 的差额明细（即「位于注释内的 var() 出现」）===');
  let diffTotal = 0;
  for (const t of TOKENS) {
    const d = onlyInA(t);
    diffTotal += d.length;
    if (d.length === 0) continue;
    console.log(`  ${t}  (${d.length} 处，仅存在于注释内):`);
    for (const r of d) console.log(`    ${r.file}:${r.line}  ${r.snippet}`);
  }
  console.log(`  差额合计 = ${diffTotal}（A_raw ${CALIBERS.length ? totals.A_raw : ''} − B_code ${totals.B_code} = ${totals.A_raw - totals.B_code}）`);

  console.log('');
  console.log('=== 手写回退写法 `var(--ink…, <fallback>)` 的出现（易被误判为非消费点）===');
  let fb = 0;
  for (const t of TOKENS) {
    for (const r of hits[t].B_code) {
      if (/var\([^)]*,\s*[^)]+\)/.test(r.snippet)) {
        fb++;
        console.log(`  ${t}  ${r.file}:${r.line}  ${r.snippet}`);
      }
    }
  }
  if (fb === 0) console.log('  （无）');

  console.log('');
  console.log('=== 定义位置（`--ink*:` 声明）===');
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    text.split('\n').forEach((l, i) => {
      for (const t of TOKENS) {
        if (new RegExp(`^\\s*${t.replace(/-/g, '\\-')}\\s*:`).test(l)) {
          console.log(`  ${t.padEnd(13)} ${rel(f)}:${i + 1}  ${l.trim().slice(0, 80)}`);
        }
      }
    });
  }

  console.log('');
  console.log('（本脚本是测量工具，退出码恒为 0；文档引用数字时请注明所用口径。）');
}

main();