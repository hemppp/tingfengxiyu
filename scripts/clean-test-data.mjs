#!/usr/bin/env node
// ============================================================
// 清理测试账号与测试项目（保留保护清单）
//
// 用法：
//   node scripts/clean-test-data.mjs --list          # 只看会删什么
//   node scripts/clean-test-data.mjs                 # 执行
//   node scripts/clean-test-data.mjs --keep <id> ... # 追加要保留的项目 id
//
// 为什么不用 API 删项目：项目属于各自 owner，一个账号删不了别人的；
// 而这里只是清测试残留，直接改库更快。代价是**不会级联删项目库文件** ——
// 所以本脚本额外把 `data/projects/{id}.db`（含 -wal/-shm）送回收站。
//
// ⚠️ 项目库文件若被正在运行的 server 占用（Windows EPERM），会删不掉；
//    停掉 server 后重跑本脚本即可收尾。
// ============================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PROJECT_DIR = 'F:/new1.2/data/projects';
const PYTHON = 'F:/work buddy/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
const TRASH = 'F:/new1.2/scripts/trash.py';

/** 永远保留的账号：管理员 + 当前浏览器正在登录的探测账号 */
const KEEP_USERS = new Set(['user', 'probemty3qnbx']);
/** 永远保留的项目（正在用的成品书） */
const KEEP_PROJECTS = new Set(['c980335a-026a-413f-9717-fcc9a8f05e44']); // 空山雨后

const args = process.argv.slice(2);
const dryRun = args.includes('--list');
args.forEach((a, i) => {
  if (a === '--keep' && args[i + 1]) KEEP_PROJECTS.add(args[i + 1]);
});

const db = new Database(MAIN_DB);
db.pragma('foreign_keys = ON');

const projects = db.prepare('select id, name, user_id from projects').all();
const users = db.prepare('select id, username, is_admin from users').all();

const killProjects = projects.filter((p) => !KEEP_PROJECTS.has(p.id));
const killUsers = users.filter((u) => !KEEP_USERS.has(u.username) && !u.is_admin);

console.log(`===== 将删除的项目（${killProjects.length}）=====`);
for (const p of killProjects) console.log(`  ${p.id.slice(0, 8)}  ${p.name}`);
console.log(`===== 将删除的账号（${killUsers.length}）=====`);
for (const u of killUsers) console.log(`  ${u.username}`);

if (dryRun) {
  console.log('\n（--list 模式，未做任何修改）');
  db.close();
  process.exit(0);
}

// ---- 1) 删库里的行 ----
for (const p of killProjects) {
  db.prepare('delete from projects where id = ?').run(p.id);
  console.log(`  删除项目行: ${p.name}`);
}
for (const u of killUsers) {
  db.prepare('delete from user_settings where user_id = ?').run(u.id); // 无 FK 级联，显式删
  db.prepare('delete from users where id = ?').run(u.id);
  console.log(`  删除账号: ${u.username}`);
}
const orphan = db.prepare(
  'select count(*) c from user_settings s left join users u on u.id = s.user_id where u.id is null',
).get().c;
console.log(`  剩余账号: ${db.prepare('select username from users').all().map((r) => r.username).join(', ')}`);
console.log(`  剩余项目: ${db.prepare('select name from projects').all().map((r) => r.name).join(', ')}`);
console.log(`  user_settings 孤儿: ${orphan}`);
db.close();

// ---- 2) 项目库文件（含 -wal/-shm）送回收站 ----
const files = [];
for (const p of killProjects) {
  for (const suffix of ['.db', '.db-wal', '.db-shm']) {
    const f = `${PROJECT_DIR}/${p.id}${suffix}`;
    if (fs.existsSync(f)) files.push(f);
  }
}
if (files.length === 0) {
  console.log('  没有需要清理的项目库文件');
} else {
  console.log(`\n===== 送回收站的项目库文件（${files.length}）=====`);
  try {
    const out = execFileSync(PYTHON, [TRASH, ...files], { encoding: 'utf8' });
    console.log(out.trim());
  } catch (e) {
    console.log('  trash.py 调用失败:', e.message);
    console.log('  待手工清理:', files.join('\n    '));
  }
}
console.log('\n完成。被占用的文件（server 在跑时常见）停掉 server 后重跑本脚本即可。');
