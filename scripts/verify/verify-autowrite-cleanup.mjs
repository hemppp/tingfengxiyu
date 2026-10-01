#!/usr/bin/env node
// ============================================================
// 清理 verify-autowrite-session.mjs 产生的临时账号与项目
//
// 用法：
//   node scripts/verify/verify-autowrite-cleanup.mjs <username> <projectId>
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
  console.log('用法: node scripts/verify/verify-autowrite-cleanup.mjs <username> [projectId]');
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
} else {
  // ★ 不传 projectId 时，把该用户名下的项目**全删掉**。
  //   为什么要有这一步：删 users 行不会级联删 projects，更不会删 data/projects/*.db ——
  //   只删账号就会留下一堆**孤儿项目库**（实测积累过 3 个，还得另外跑清理脚本）。
  //   走 API 删才是干净的（会级联删库文件含 -wal/-shm）。
  try {
    const r = await req('/api/projects');
    const list = (await r.json())?.data ?? [];
    if (Array.isArray(list) && list.length > 0) {
      console.log(`该用户名下有 ${list.length} 个项目，逐个删除：`);
      for (const p of list) {
        const d = await req(`/api/projects/${p.id}`, { method: 'DELETE' });
        console.log(`  - ${p.name ?? p.id}: HTTP ${d.status}`);
      }
    } else {
      console.log('该用户名下没有项目');
    }
  } catch (e) {
    console.log('列项目失败（继续清理账号）:', e.message);
  }
}

{
  const db = new Database(MAIN_DB);
  db.pragma('foreign_keys = ON');
  const u = db.prepare('select id from users where username=?').get(USERNAME);
  if (u) {
    /**
     * ★ 删 users 行之前必须确认它名下没有项目。
     *
     * 为什么：`projects.user_id` 是 **ON DELETE cascade** —— 删用户会**连带删掉项目行**，
     * 而项目行没了、`data/projects/{id}.db` 还在 → 变成孤儿库文件，
     * 表现是"书架上的书凭空消失、但磁盘上还有 30 章正文"。
     * 实测踩过：清一个探针账号，把该账号名下 30 章的书从书架上一并抹掉了。
     * 这里改成**先检查、不静默级联**：有项目就拒绝删账号，并提示先删项目。
     */
    const orphanRisk = db.prepare('select id, name from projects where user_id=?').all(u.id);
    if (orphanRisk.length > 0) {
      console.log(`\n⚠ 该账号名下还有 ${orphanRisk.length} 个项目 —— 拒绝删账号（删它会级联删掉项目行，只留孤儿库文件）：`);
      for (const p of orphanRisk) console.log(`   · ${p.name} (${p.id})`);
      console.log('   请先删项目（不带 projectId 再跑一次本脚本会自动删），或手工处理。');
      db.close();
      process.exit(2);
    }
    db.prepare('delete from user_settings where user_id=?').run(u.id);
    // ★ 技能开关是**按用户**存的（skill_library 是全局库，这里的行才是"谁的配置"）。
    //   不显式删就会留下孤儿行 —— 而且用户重建后 id 不同，这些行永远没人认领。
    try {
      const n = db.prepare('delete from agent_skill_toggles where user_id=?').run(u.id).changes;
      if (n > 0) console.log('已删技能开关行:', n);
    } catch { /* 表还不存在（未跑过 0001 迁移）时忽略 */ }
    db.prepare('delete from users where id=?').run(u.id);
    console.log('已删账号', USERNAME, u.id);
  } else {
    console.log('账号不存在（可能已删）:', USERNAME);
  }
  console.log('剩余用户:', db.prepare('select username from users').all().map((r) => r.username).join(', '));
  console.log('user_settings 孤儿数:', db.prepare('select count(*) c from user_settings s left join users u on u.id=s.user_id where u.id is null').get().c);
  console.log('项目孤儿行数（有项目库文件但主库无行）:', (() => {
    try {
      const alive = new Set(db.prepare('select id from projects').all().map((r) => r.id));
      const dir = 'F:/new1.2/data/projects';
      if (!fs.existsSync(dir)) return 0;
      return fs.readdirSync(dir).filter((f) => f.endsWith('.db') && !alive.has(f.slice(0, -3))).length;
    } catch { return '未知'; }
  })());
  db.close();
}

if (projectId) {
  const dir = 'F:/new1.2/data/projects';
  const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(projectId)) : [];
  console.log('项目库残留文件:', left.length ? left.join(', ') : '无（清理干净）');
}
