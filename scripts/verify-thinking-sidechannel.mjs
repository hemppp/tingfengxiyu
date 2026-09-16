#!/usr/bin/env node
// ============================================================
// 真机验证：AI 讨论里的**思维链**（reasoning_content）真的能到前端吗？
//
// 为什么必须真机验：这条链路每一步都可能悄悄断掉，而且都不报错 ——
//   ① 模型今天吐不吐 reasoning_content（换模型/换中转站可能就不吐了）
//   ② SDK 通道会不会把它吞掉（0.14.3 的 Chat Completions 适配器本来就不解析，
//      全靠 sdk/provider.ts 里的 fetch 旁路补）
//   ③ 旁路有没有把主链路弄坏（正文/工具调用还正不正常）
//   单测只能钉住 ③ 里的解析函数，①② 必须打真实模型。
//
// 前置：server 在跑（Node 24）+ 管理员账号配好 AI provider
// 用法：node scripts/verify-thinking-sidechannel.mjs
//
// ★ 只跑「到第一条发言」就主动掐断 —— 一轮完整讨论要 5+ 次模型调用，
//   验证思维链只需要第一条发言，掐断能省掉后面 4 次。
// ============================================================

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:3774';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
// ★ 每次跑用**新账号**：宿主按 userId 缓存 AI 配置，同一个账号复用会拿到上一次的
//   （哪怕已经在库里补了配置，缓存也不会失效）→ 表现为「模型不对，思维链一条都没有」。
const USERNAME = `thinkprobe_${Date.now().toString(36)}`;

let cookie = '';
async function req(p, opts = {}) {
  const res = await fetch(BASE + p, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return res;
}

// ---------- 账号 ----------
const reg = await req('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '思维链探针' }),
});
if (reg.status !== 201) {
  console.error('✗ 注册失败', reg.status, (await reg.text()).slice(0, 200));
  process.exit(1);
}
console.log('✓ 账号已建', USERNAME);

// ★ 必须把管理员的 AI 配置复制过来：新账号没有配置 → getAIConfig 回退到 env 默认模型，
//   而默认模型不一定吐 reasoning_content（实测 deepseek-v4-flash 就不吐），
//   于是「思维链一条都没有」会被误判成代码坏了。
{
  const db = new DatabaseSync(MAIN_DB);
  const admin = db.prepare(
    "select s.ai_provider_config c from user_settings s join users u on u.id = s.user_id where u.username = 'user'",
  ).get();
  const me = (await (await req('/api/auth/me')).json())?.data;
  if (!admin?.c) {
    console.error('✗ 管理员没有 AI 配置，无法验证（先配好 provider）');
    db.close();
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    'insert or replace into user_settings (user_id, ai_features, ai_provider_config, created_at, updated_at) values (?, ?, ?, ?, ?)',
  ).run(me.id, '{}', admin.c, now, now);
  console.log('✓ 已复制管理员 AI 配置 →', JSON.parse(admin.c).model);
  db.close();
}

// ★★ 关键一步：先打一个 /api/ai/* 路由，把该用户的配置 loader 注册上。
//   为什么需要：loader 是**惰性注册**的（modules/ai.ts:ensureUserConfigLoader，挂在
//   /api/ai/* 的中间件上）。而讨论走的是 `/api/plugins/autowrite/session` —— **不经过**
//   那个中间件。所以「库里配了模型但没打过 AI 路由」的用户，讨论会静默回退到
//   **环境变量里的模型**（本机 env 默认是 deepseek-v4-flash，它不吐 reasoning_content）,
//   表现就是「思维链一条都没有」，而代码其实没错。
await req('/api/ai/config');
console.log('✓ 已触发 AI 路由（注册配置 loader）');

// ---------- 项目 ----------
const brief = {
  opening: '清晨六点四十，陈默在地铁服务台接起一部陌生人落下的旧手机，对面直接叫出了他的名字。',
  worldview: '当下的南方沿海城市，没有超自然力量。',
  style: '冷硬克制，短句为主。',
  protagonist: '陈默',
  multipleHeroines: false,
  heroines: ['苏晚'],
  genreCategory: 'none',
  genre: '悬疑推理',
};
const projRes = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: '思维链点检', mode: 'auto', genre: '无系统流 · 悬疑推理', brief }),
});
const pid = (await projRes.json())?.data?.id;
if (!pid) { console.error('✗ 建项目失败'); process.exit(1); }
console.log('✓ 项目已建', pid);

// 项目库惰性创建：先打一次业务接口，否则讨论里读上下文会拿不到库
await req(`/api/chapters/projects/${pid}`);

// ---------- 跑讨论，只跑到第一条带思维链的发言 ----------
const ac = new AbortController();
let thinkingEvents = 0;
let thinkingChars = 0;
let firstTurn = null;
let turnCount = 0;
let sawThinkingFor = new Set();

console.log('\n开始一轮讨论（收到第一条带思维链的发言就掐断）…');
const t0 = Date.now();
const res = await fetch(`${BASE}/api/plugins/autowrite/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-project-id': pid, ...(cookie ? { cookie } : {}) },
  body: JSON.stringify({ message: '讨论一下第 1 章的开场怎么写。' }),
  signal: ac.signal,
});
if (res.status >= 400) {
  console.error('✗ SSE 失败', res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
try {
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let e;
        try { e = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (e.type === 'thinking') {
          thinkingEvents += 1;
          thinkingChars += String(e.delta ?? '').length;
          sawThinkingFor.add(e.name);
        } else if (e.type === 'turn') {
          turnCount += 1;
          console.log(`  · 发言：${e.name} ${String(e.text).replace(/\s/g, '').length} 字｜thinking=${e.thinking ? `${e.thinking.length} 字` : '(无)'}`);

          // 找一条**同时**收到过 thinking 增量、又带整段 thinking 的发言 —— 才算链路真的通
          if (e.thinking && sawThinkingFor.has(e.name)) { firstTurn = e; break outer; }
          // 看够 3 条发言还没有就停：一轮完整讨论要 5+ 次模型调用，没必要为失败再多花
          if (turnCount >= 3) break outer;
        } else if (e.type === 'error') {
          console.error('  · 后端报错：', e.message);
        }
      }
    }
  }
} catch (err) {
  if (!(err instanceof Error && err.name === 'AbortError')) throw err;
}
// 主动收尾：**用 reader.cancel() 而不是 ac.abort()** ——
// 中途 abort 会让 undici 在流上抛 "terminated"，而那条 fetch promise 已经没人接了，
// 结果是一个未处理的 rejection 直接把进程打崩（实测）。
try { await reader.cancel(); } catch { /* 已经关了 */ }
try { reader.releaseLock?.(); } catch { /* 忽略 */ }

const secs = ((Date.now() - t0) / 1000).toFixed(1);

// ---------- 判定 ----------
console.log('\n=== 结果 ===');
console.log(`耗时 ${secs}s`);
console.log(`thinking 事件数 = ${thinkingEvents}，累计 ${thinkingChars} 字`);
console.log(`收到过思维链的角色 = ${[...sawThinkingFor].join('/') || '(无)'}`);

let ok = true;
if (thinkingEvents === 0) {
  console.error('✗ 一条 thinking 事件都没收到 —— 要么模型不吐 reasoning_content，要么旁路断了');
  console.error('  排查顺序：先跑 .workbuddy/ui-checks/_probe-reasoning.mjs 确认这个模型到底吐不吐；');
  console.error('  吐的话就是 sdk/provider.ts 的 fetch 旁路没生效（provider 有按 userId 缓存，改完要重启 server）。');
  ok = false;
} else {
  console.log('✓ 思维链增量实时到达');
}
if (!firstTurn) {
  console.error('✗ 没有一条发言同时满足「收到过增量」+「turn 带整段 thinking」');
  ok = false;
} else {
  console.log(`✓ ${firstTurn.name} 的发言带整段思维链（${firstTurn.thinking.length} 字）`);
  if (firstTurn.thinking === firstTurn.text) {
    console.error('✗ 思维链与发言正文一模一样 —— 说明截到的不是 reasoning_content');
    ok = false;
  }
  console.log('  思维链片段：', firstTurn.thinking.slice(0, 120).replace(/\s+/g, ' '));
  console.log('  发言片段：', firstTurn.text.slice(0, 120).replace(/\s+/g, ' '));
}

// ---------- 清理 ----------
// 顺序不能反：projects.user_id 是 ON DELETE cascade，但**删 users 不会删项目库文件** →
// 先走 API 删项目（会级联删 data/projects/{id}.db 含 -wal/-shm），再删账号。
const delProj = await req(`/api/projects/${pid}`, { method: 'DELETE' });
console.log(`\n清理：删项目 → HTTP ${delProj.status}`);
{
  const db = new DatabaseSync(MAIN_DB);
  db.prepare('delete from user_settings where user_id in (select id from users where username = ?)').run(USERNAME);
  const info = db.prepare('delete from users where username = ?').run(USERNAME);
  db.close();
  console.log(`清理：删账号 ${USERNAME} → ${info.changes} 行`);
}

process.exit(ok ? 0 : 1);
