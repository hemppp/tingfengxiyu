#!/usr/bin/env node
// ============================================================
// 验证「AI 写作开书设定」（projects.brief）的 API 往返与落库
//
// 用法（server 必须先以 Node 24 起在 3774）：
//   "D:/ruanjian/node.24/node.exe" scripts/verify/verify-brief-api.mjs
//
// 覆盖：
//   1) 注册临时账号
//   2) POST /api/projects 带 brief（mode=auto）→ 返回值里要有完整 brief
//   3) GET  /api/projects      → brief 原样往返（含多女主列表）
//   4) 主库 projects.brief     → 确实是以 JSON 文本落盘的
//   5) PUT 不带 brief 改名     → 已有设定**不被冲掉**（这是最容易写错的一处）
//   6) POST 带非法 brief       → 400（zod 校验生效）
//
// 清理：脚本会打印命令，用 scripts/verify/verify-autowrite-cleanup.mjs 删账号与项目。
// ============================================================

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:3774';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const USERNAME = `brief_probe_${Date.now().toString(36)}`;
const DISPLAY = '设定探针';

let cookie = '';
async function req(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { ...opts, headers });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 就保留原文 */ }
  return { status: res.status, json, text };
}

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

const BRIEF = {
  opening: '主角在末日前三小时醒来，收到自己发来的短信',
  worldview: '近未来沿海都市，丧尸爆发后第三年',
  style: '冷硬克制，短句为主',
  protagonist: '陈默',
  multipleHeroines: true,
  heroines: ['苏晚', '陆离', '白蓉'],
  genreCategory: 'system',
  genre: '末日求生',
};

// 1) 注册
const reg = await req('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: DISPLAY }),
});
check('注册临时账号', reg.status === 201, `HTTP ${reg.status}`);

// 2) 建带 brief 的 auto 项目
const created = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({
    name: '设定探针之书',
    mode: 'auto',
    genre: '系统流 · 末日求生',
    brief: BRIEF,
  }),
});
const pid = created.json?.data?.id;
check('创建 auto 项目并写入 brief', created.status === 201 && !!pid, `HTTP ${created.status} id=${pid}`);
check('创建响应里 brief 完整', JSON.stringify(created.json?.data?.brief) === JSON.stringify(BRIEF));

// 3) 列表往返
const list = await req('/api/projects');
const found = (list.json?.data ?? []).find((p) => p.id === pid);
check('GET /projects 能读回同一条 brief', JSON.stringify(found?.brief) === JSON.stringify(BRIEF));
check('流派展示名落进 project.genre', found?.genre === '系统流 · 末日求生', String(found?.genre));

// 4) 主库确实是 JSON 文本（用 node:sqlite 只读看一眼，不依赖 better-sqlite3 的 ABI）
try {
  const db = new DatabaseSync(MAIN_DB, { readOnly: true });
  const row = db.prepare('select brief, mode from projects where id = ?').get(pid);
  db.close();
  const raw = row?.brief;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
  check('主库 brief 列是 JSON 文本', typeof raw === 'string' && parsed?.opening === BRIEF.opening);
  check('主库 mode 列为 auto', row?.mode === 'auto', String(row?.mode));
} catch (e) {
  check('读主库核对 brief 列', false, e.message);
}

// 5) 改名（不带 brief）不能把已有设定冲掉
const renamed = await req(`/api/projects/${pid}`, {
  method: 'PUT',
  body: JSON.stringify({ name: '设定探针之书（改名）' }),
});
check('改名（不带 brief）', renamed.status === 200, `HTTP ${renamed.status}`);
const after = await req(`/api/projects/${pid}`);
check('改名后 brief 未被冲掉', JSON.stringify(after.json?.data?.brief) === JSON.stringify(BRIEF));

// 6) 非法 brief 要被 zod 拦住
const bad = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: '非法设定', mode: 'auto', brief: { ...BRIEF, genreCategory: 'bogus' } }),
});
check('非法 genreCategory 被拒', bad.status === 400, `HTTP ${bad.status}`);

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`临时项目：${pid}`);
console.log(`清理：node scripts/verify/verify-autowrite-cleanup.mjs ${USERNAME} ${pid}`);
process.exit(failed === 0 ? 0 : 1);
