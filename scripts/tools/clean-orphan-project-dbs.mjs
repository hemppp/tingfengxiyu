#!/usr/bin/env node
// ============================================================
// 清理 `data/projects/` 下**不该留的库文件**
//
// 为什么需要它：删项目主库行**不会**级联删项目库文件（无外键），直接删库行
// 就会留下孤儿 .db / -wal / -shm。这个脚本按主库校验后再删，不会误伤在用的书。
//
// 用法：
//   node scripts/tools/clean-orphan-project-dbs.mjs --list    # 只看
//   node scripts/tools/clean-orphan-project-dbs.mjs           # 执行（文件送回收站）
//
// ⚠️ server 运行中时，被它缓存句柄的库文件会删失败（Windows ERROR_SHARING_VIOLATION=32）。
//    停掉 server 后重跑即可收尾。被占用的文件会自动列入「待手工处理」。
//
// ★ 2026-09-17 修盲区：原判定正则只认 **36 位 UUID 命名**的库文件，
//   而 server 单测产生的库叫 `entity-sink-test-<ts>.db` / `memory-test-<ts>.db` /
//   `proj-mig-exists-<runId>.db` / `proj-mig-future-<runId>.db` —— 不是 UUID，
//   被整批跳过，脚本还会理直气壮地报「没有孤儿项目库 ✓」。
//   现在分三类处理（见下方 THREE KINDS），**非 UUID 的也不会再静默消失**。
//
// ★ 2026-09-17 再修一个（同一天、同一类「静默跳过」的毛病）：原主循环
//   `if (!entry.endsWith('.db')) continue;` **只遍历 `*.db`**，于是「.db 已经不在了、
//   只剩 -wal / -shm / -journal」的残留，在 `--list` 和执行里**都**看不见，
//   脚本还会报「没有待清理的库文件 ✓」。而这种"只剩散件"恰恰是 server 运行中删库失败、
//   或进程中途被杀留下的典型形态。现在按基名聚合成组（见 groups），散件与 .db 同进同出。
// ============================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PROJECT_DIR = 'F:/new1.2/data/projects';
const PYTHON = 'F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
const TRASH = 'F:/new1.2/scripts/tools/trash.py';

const dryRun = process.argv.includes('--list');

/**
 * server 单测会往 data/projects/ 拉这些库（名字里带时间戳/runId，每次都不一样）。
 * 来源：
 *   entity-sink-test-*  apps/plugins/local/novel.autowrite/server/framework/entity-sink.test.ts
 *   memory-test-*       .../framework/memory/memory.test.ts
 *   proj-mig-*          apps/server/src/__tests__/plugin-migrate.test.ts
 * 它们是**确定要清**的测试产物 —— 但仍会逐个核对 chapters=0（见下），
 * 万一名字撞上真实数据也不会误删。
 */
const TEST_PREFIXES = ['entity-sink-test-', 'memory-test-', 'proj-mig-exists-', 'proj-mig-future-'];

/** 库文件的后缀（三件套 + SQLite 回滚日志） */
const SUFFIXES = ['', '-shm', '-wal', '-journal'];

const db = new Database(MAIN_DB, { readonly: true });
const alive = new Set(db.prepare('select id from projects').all().map((r) => r.id));
db.close();

/** 某个项目库里的章节数；读不出来返回 null（文件损坏/被锁） */
function chapterCount(basePath) {
  try {
    const d = new Database(basePath, { readonly: true });
    const has = d.prepare("select name from sqlite_master where type='table' and name='chapters'").get();
    const n = has ? d.prepare('select count(*) c from chapters').get().c : 0;
    d.close();
    return n;
  } catch {
    return null;
  }
}

// ---- 分三类 ----
// ★ 2026-09-17 补盲区（第二个）：原实现 `if (!entry.endsWith('.db')) continue;` **只遍历 .db**，
//   于是「.db 已经被删掉、只剩 -wal / -shm / -journal」的残留永远清不到 ——
//   而 server 运行中删库失败、或进程中途被杀，产出的恰恰就是这种"只剩散件"的状态。
//   实测撞到两组（13d8b52b / af541394 只有 -shm+-wal）与一个 -journal，脚本却报「没有待清理 ✓」。
//   现在按**基名**聚合：`X.db` / `X.db-shm` / `X.db-wal` / `X.db-journal` 视为同一组，
//   组内只要没有活着的项目就一起进清理清单。
/** 一个库文件组：基名 + .db 路径 + 散件（-shm/-wal/-journal） */
const orphans = [];        // ① UUID 命名 + 主库查不到 → 直接清（原行为）
const testArtifacts = [];  // ② 测试前缀 → 核对 chapters=0 后清
const unknown = [];        // ③ 其他非 UUID → **只列出让人确认，绝不自动删**

/** base → { base, full, sidecars } */
const groups = new Map();
for (const entry of fs.readdirSync(PROJECT_DIR)) {
  const m = /^(.*)\.db(-shm|-wal|-journal)?$/.exec(entry);
  if (!m) continue;
  const base = m[1];
  const g = groups.get(base) ?? { base, full: path.join(PROJECT_DIR, `${base}.db`), sidecars: [] };
  if (m[2]) g.sidecars.push(path.join(PROJECT_DIR, entry));
  groups.set(base, g);
}

for (const g of groups.values()) {
  if (g.base.startsWith('.')) continue; // 隐藏文件跳过
  if (/^[0-9a-f-]{36}$/i.test(g.base)) {
    // 主库查得到 = 在用的书 → **连它的散件一起保护**（不动）
    if (!alive.has(g.base)) orphans.push(g);
    continue;
  }
  if (TEST_PREFIXES.some((p) => g.base.startsWith(p))) {
    testArtifacts.push(g);
    continue;
  }
  unknown.push(g);
}

// ② 逐个核对章节数：非 0 的**不删**，转人工确认
const safeTestArtifacts = [];
const suspicious = [];
for (const t of testArtifacts) {
  const n = chapterCount(t.full);
  if (n === 0) safeTestArtifacts.push(t);
  else suspicious.push(`${t.full}（chapters=${n === null ? '读取失败' : n}）`);
}

// 展开成三件套
const targets = [
  // 孤儿：.db 可能早就不在了（只剩散件），所以 .db 与散件一起展开
  ...orphans.flatMap((g) => [g.full, ...g.sidecars]),
  ...safeTestArtifacts.flatMap((t) => SUFFIXES.map((s) => `${t.full}${s}`)),
].filter((f) => fs.existsSync(f));

if (targets.length === 0 && unknown.length === 0 && suspicious.length === 0) {
  console.log('没有待清理的库文件 ✓');
  process.exit(0);
}

if (orphans.length) {
  console.log(`===== ① 孤儿项目库（主库已无对应项目，${orphans.length} 组）=====`);
  for (const g of orphans) {
    const files = [g.full, ...g.sidecars].filter((f) => fs.existsSync(f)).map((f) => path.basename(f));
    console.log(`  ${g.base}  →  ${files.join(' , ')}`);
  }
}
if (safeTestArtifacts.length) {
  console.log(`\n===== ② 单测产物（chapters=0 已核对，${safeTestArtifacts.length} 个）=====`);
  for (const t of safeTestArtifacts) console.log(`  ${t.full}`);
}
if (suspicious.length) {
  console.log(`\n===== ⚠️ 疑似单测产物但**有章节**，未删，请人工确认（${suspicious.length} 个）=====`);
  for (const f of suspicious) console.log(`  ${f}`);
}
if (unknown.length) {
  console.log(`\n===== ⚠️ 非 UUID 也非已知测试前缀，未删，请人工确认（${unknown.length} 组）=====`);
  for (const g of unknown) {
    const files = [g.full, ...g.sidecars].filter((f) => fs.existsSync(f)).map((f) => path.basename(f));
    console.log(`  ${g.base}  →  ${files.join(' , ')}`);
  }
}
console.log(`\n在用项目（会保留）: ${[...alive].length} 个`);

if (dryRun) {
  console.log('\n（--list 模式，未做任何修改）');
  process.exit(0);
}
if (targets.length === 0) {
  console.log('\n没有可自动清理的文件（上面的 ⚠️ 项需人工处理）');
  process.exit(0);
}

// trash.py 一次处理全部；它逐条报告，被占用的会标 ✘
let out = '';
try {
  out = execFileSync(PYTHON, [TRASH, ...targets], { encoding: 'utf8' });
} catch (e) {
  out = e.stdout || e.message; // 有失败项时 trash.py 退出码为 1，但输出仍有效
}
console.log('\n' + out.trim());

const left = targets.filter((f) => fs.existsSync(f));
if (left.length) {
  console.log(`\n⚠️ 仍有 ${left.length} 个文件被占用（server 在跑）—— 停掉 server 后重跑本脚本：`);
  console.log('   node scripts/tools/clean-orphan-project-dbs.mjs');
} else {
  console.log('\n✅ 全部清理完成');
}
