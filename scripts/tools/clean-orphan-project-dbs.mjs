#!/usr/bin/env node
// ============================================================
// 清理「孤儿项目库」：data/projects/ 下主库 projects 表里已不存在的库文件
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
// ============================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PROJECT_DIR = 'F:/new1.2/data/projects';
const PYTHON = 'F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
const TRASH = 'F:/new1.2/scripts/tools/trash.py';

const dryRun = process.argv.includes('--list');

const db = new Database(MAIN_DB, { readonly: true });
const alive = new Set(db.prepare('select id from projects').all().map((r) => r.id));
db.close();

const orphans = [];
for (const entry of fs.readdirSync(PROJECT_DIR)) {
  const m = entry.match(/^([0-9a-f-]{36})\.db(-wal|-shm)?$/i);
  if (!m) continue; // 跳过 .mimosa 等非项目库文件
  if (!alive.has(m[1])) orphans.push(`${PROJECT_DIR}/${entry}`);
}

if (orphans.length === 0) {
  console.log('没有孤儿项目库 ✓');
  process.exit(0);
}

console.log(`===== 孤儿项目库文件（${orphans.length} 个，主库已无对应项目）=====`);
for (const f of orphans) console.log(`  ${f}`);
console.log(`\n在用项目（会保留）: ${[...alive].length} 个`);

if (dryRun) {
  console.log('\n（--list 模式，未做任何修改）');
  process.exit(0);
}

// trash.py 一次处理全部；它逐条报告，被占用的会标 ✘
let out = '';
try {
  out = execFileSync(PYTHON, [TRASH, ...orphans], { encoding: 'utf8' });
} catch (e) {
  out = e.stdout || e.message; // 有失败项时 trash.py 退出码为 1，但输出仍有效
}
console.log('\n' + out.trim());

const left = orphans.filter((f) => fs.existsSync(f));
if (left.length) {
  console.log(`\n⚠️ 仍有 ${left.length} 个文件被占用（server 在跑）—— 停掉 server 后重跑本脚本：`);
  console.log('   node scripts/tools/clean-orphan-project-dbs.mjs');
} else {
  console.log('\n✅ 全部清理完成');
}
