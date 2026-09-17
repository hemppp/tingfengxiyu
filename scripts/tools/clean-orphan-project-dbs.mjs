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

/** 库文件的三件套后缀 */
const SUFFIXES = ['', '-shm', '-wal'];

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
const orphans = [];        // ① UUID 命名 + 主库查不到 → 直接清（原行为）
const testArtifacts = [];  // ② 测试前缀 → 核对 chapters=0 后清
const unknown = [];        // ③ 其他非 UUID → **只列出让人确认，绝不自动删**

for (const entry of fs.readdirSync(PROJECT_DIR)) {
  if (!entry.endsWith('.db')) continue;
  const base = entry.slice(0, -3);
  const full = path.join(PROJECT_DIR, entry);

  if (/^[0-9a-f-]{36}$/i.test(base)) {
    if (!alive.has(base)) orphans.push(full);
    continue;
  }
  if (TEST_PREFIXES.some((p) => base.startsWith(p))) {
    testArtifacts.push({ base, full });
    continue;
  }
  if (base.startsWith('.')) continue; // 隐藏文件跳过
  unknown.push(full);
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
  ...orphans,
  ...safeTestArtifacts.flatMap((t) => SUFFIXES.map((s) => `${t.full}${s}`)),
].filter((f) => fs.existsSync(f));

if (targets.length === 0 && unknown.length === 0 && suspicious.length === 0) {
  console.log('没有待清理的库文件 ✓');
  process.exit(0);
}

if (orphans.length) {
  console.log(`===== ① 孤儿项目库（主库已无对应项目，${orphans.length} 个）=====`);
  for (const f of orphans) console.log(`  ${f}`);
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
  console.log(`\n===== ⚠️ 非 UUID 也非已知测试前缀，未删，请人工确认（${unknown.length} 个）=====`);
  for (const f of unknown) console.log(`  ${f}`);
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
