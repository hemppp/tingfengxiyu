#!/usr/bin/env node
// ============================================================
// 清理 verify-autowrite-session.mjs 产生的临时账号与项目
//
// 用法：
//   node scripts/verify-autowrite-cleanup.mjs <username> <projectId>
//
// 注意（都是踩过的）：
//   · 走 API 删项目才会级联删 `data/projects/{id}.db`（含 -wal / -shm）；
//     直删主库 projects 行**不会**动这些文件，且 server 运行时句柄被占用（Windows 下 EPERM）。
//   · 删 users 行**不会**自动级联清 user_settings（schema 里没有 FK），所以这里显式删两张表。
// ============================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3774';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const USERNAME = process.argv[2];
const projectId = process.argv[3];

if (!USERNAME) {
  console.log('用法: node scripts/verify-autowrite-cleanup.mjs <username> [projectId]');
  process.exit(1);
}

let cookie = '';
async function req(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { ...opts, headers });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return res;
}

try {
  const r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
  console.log('登录:', r.status);
} catch (e) { console.log('登录异常（继续清理）:', e.message); }

if (projectId) {
  const r = await req(`/api/projects/${projectId}`, { method: 'DELETE' });
  console.log('删项目:', r.status, (await r.text()).slice(0, 160));
}

{
  const db = new Database(MAIN_DB);
  db.pragma('foreign_keys = ON');
  const u = db.prepare('select id from users where username=?').get(USERNAME);
  if (u) {
    db.prepare('delete from user_settings where user_id=?').run(u.id);
    db.prepare('delete from users where id=?').run(u.id);
    console.log('已删账号', USERNAME, u.id);
  } else {
    console.log('账号不存在（可能已删）:', USERNAME);
  }
  console.log('剩余用户:', db.prepare('select username from users').all().map((r) => r.username).join(', '));
  console.log('user_settings 孤儿数:', db.prepare('select count(*) c from user_settings s left join users u on u.id=s.user_id where u.id is null').get().c);
  db.close();
}

if (projectId) {
  const dir = 'F:/new1.2/data/projects';
  const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(projectId)) : [];
  console.log('项目库残留文件:', left.length ? left.join(', ') : '无（清理干净）');
}
