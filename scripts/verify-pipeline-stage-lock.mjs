#!/usr/bin/env node
// ============================================================
// 验证流水线的 running 锁 + 阶段执行路径（★ 会真调模型，约 5 次调用 / 2–3 分钟）
//
// 用法（server 必须先以 Node 24 起在 3774）：
//   "D:/ruanjian/node.24/node.exe" scripts/verify-pipeline-stage-lock.mjs
//
// 为什么值得花这几次调用：`beginStage` 是**唯一**防止「两个标签页重复跑同一段」的锁，
// 而它动的是执行路径（runStage 开头）—— 改过执行路径就必须真跑一次，单测证明不了它没跑歪。
//
// 覆盖：
//   1) 第一次 advance → 200（SSE 建立）
//   2) 紧接着 GET /pipeline → 该段状态是 running（证明锁**落盘**了，不是只存在内存里）
//   3) 再 advance 同一段 → 409「该阶段正在跑」（锁真的拦住了）
//   4) 等它自然跑完 → 状态变 awaiting_user 且契约文本非空（执行路径没被我改坏）
//
// 清理：脚本会打印命令，用 scripts/verify-autowrite-cleanup.mjs 删账号与项目。
// ============================================================

const BASE = 'http://127.0.0.1:3774';
const P = '/api/plugins/autowrite/pipeline';
const USERNAME = 'plprobe_lock';
const PASSWORD = 'Probe1234!';

let cookie = '';
async function req(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { ...opts, headers });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

const brief = {
  opening: '主角在末日前三小时醒来，手机里收到一条自己发来的短信',
  worldview: '近未来沿海都市，丧尸爆发后第三年',
  style: '冷硬克制，短句为主',
  protagonist: '陈默',
  multipleHeroines: false,
  heroines: ['苏晚'],
  genreCategory: 'system',
  genre: '末日求生',
};

let r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '锁探针' }) });
if (r.status === 409) r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
check('登录取到会话', r.status === 200 || r.status === 201, `HTTP ${r.status}`);

const proj = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: '锁探针之书', mode: 'auto', genre: '系统流 · 末日求生', brief }),
});
const pid = proj.json?.data?.id;
check('建项目', proj.status === 201 && !!pid);

await req(`${P}/start`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ note: '' }) });
const advBrief = await fetch(`${BASE}${P}/advance`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, 'x-project-id': pid },
  body: JSON.stringify({ stage: 'brief' }),
});
await advBrief.text();
check('brief 段推进（游标到 cast）', advBrief.status === 200);

// 1) 第一次跑 cast：只等 SSE 头，不等它跑完（跑完要 2–3 分钟）
const first = await fetch(`${BASE}${P}/advance`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, 'x-project-id': pid },
  body: JSON.stringify({ stage: 'cast' }),
});
check('第一次 advance cast → 200（SSE 已建立）', first.status === 200, `HTTP ${first.status}`);
void first.body?.cancel?.(); // 不等它，服务端照跑

// 2) 锁必须已落盘
let view = null;
for (let i = 0; i < 10 && !view; i++) {
  await new Promise((r2) => setTimeout(r2, 500));
  const st = await req(P, { headers: { 'x-project-id': pid } });
  view = st.json?.data?.view;
  const cast = view?.stages?.find((s) => s.key === 'cast');
  if (cast?.status === 'running') break;
}
const castStatus = view?.stages?.find((s) => s.key === 'cast')?.status;
check('锁已落盘：状态是 running', castStatus === 'running', String(castStatus));

// 3) 第二次跑同一段必须被拦住
const second = await req(`${P}/advance`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: 'cast' }) });
check('第二次 advance → 409 被锁拦住', second.status === 409, `HTTP ${second.status} · ${second.json?.error?.message ?? ''}`);

// 4) 等它自然跑完（执行路径回归）
console.log('\n…等这一段跑完（最长 6 分钟，会调用模型）');
let done = null;
for (let i = 0; i < 72; i++) {
  await new Promise((r2) => setTimeout(r2, 5000));
  const st = await req(P, { headers: { 'x-project-id': pid } });
  const cast = st.json?.data?.view?.stages?.find((s) => s.key === 'cast');
  if (cast && cast.status !== 'running') { done = cast; break; }
  if (i % 6 === 5) console.log(`  …已等 ${(i + 1) * 5}s`);
}
check('阶段跑完并停在等确认', done?.status === 'awaiting_user', String(done?.status));
check('契约文本非空', (done?.artifact?.length ?? 0) > 50, `${done?.artifact?.length ?? 0} 字符`);
if (done?.status === 'failed') console.log('  失败原因：', done.error);
console.log('\n产出预览：');
console.log((done?.artifact ?? '').slice(0, 300));

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`临时项目：${pid}`);
console.log(`清理：node scripts/verify-autowrite-cleanup.mjs ${USERNAME} ${pid}`);
process.exit(failed === 0 ? 0 : 1);
