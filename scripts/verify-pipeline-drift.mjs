// ============================================================
// 真机验证：流水线 Stage4「偏离核查」（M2）
//
// 为什么必须真机跑：核查最容易被做成"假检查"（问一句"有没有跑偏" → 必答"整体符合"）。
// 这个脚本验收的是**逐条**这件事本身：
//   · driftCounts.total ≥ brief 的字段数（断言是确定性拆出来的，少一条就是漏核）
//   · 三类判定之和 === total（不许有"没判"的）
//   · 报告里必须出现「硬偏离 / 软偏离」两栏（格式契约）
//   · **无闸门**：drift 跑完是 approved（不是 awaiting_user），游标自动推进到 pilot
//
// brief 里**故意埋一条硬约束**（世界观：白天绝无电）—— 单测里已用合成判定验过"能报出来"，
// 这里验的是真实模型**有没有逐条去判**它。
//
// 前置：server 在跑（Node 24）。用法：node scripts/verify-pipeline-drift.mjs
// ============================================================

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:3774';
const P = '/api/plugins/autowrite/pipeline';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const USERNAME = `drift_${Date.now().toString(36)}`;

let cookie = '';
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON（SSE） */ }
  return { status: res.status, json, text };
}

// ---- 建探针账号（复制管理员的 AI 配置，否则模型调用必失败）----
const reg = await req('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '偏离核查探针' }),
});
check('注册探针账号', reg.status === 201, `HTTP ${reg.status}`);
const main = new DatabaseSync(MAIN_DB, { readOnly: true });
const adminCfg = main.prepare("select s.ai_provider_config c from user_settings s join users u on u.id = s.user_id where u.username = 'user'").get()?.c;
main.close();
const me = (await req('/api/auth/me')).json?.data;
const w = new DatabaseSync(MAIN_DB);
w.prepare('insert or replace into user_settings (user_id, ai_features, ai_provider_config, created_at, updated_at) values (?, ?, ?, ?, ?)')
  .run(me.id, '{}', adminCfg, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
w.close();

// ---- 建项目：brief 里埋一条硬约束 ----
const brief = {
  opening: '主角在末日前三小时醒来，手机收到自己发来的短信',
  worldview: '末日第三年，旧水电站只在夜里供电 —— **白天绝无电，白天亮灯即是硬伤**；严禁出现枪支',
  style: '冷硬克制，短句为主',
  protagonist: '陈默',
  multipleHeroines: false,
  heroines: ['苏晚'],
  genreCategory: 'system',
  genre: '末日求生',
};
const created = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: `偏离核查 ${USERNAME}`, mode: 'auto', genre: '系统流 · 末日求生', brief }),
});
const pid = created.json?.data?.id;
check('建项目并写入 brief', created.status === 201 && !!pid, `HTTP ${created.status}`);
const H = { 'x-project-id': pid };

await req(`${P}/start`, { method: 'POST', headers: H, body: JSON.stringify({ note: '' }) });
await req(`${P}/advance`, { method: 'POST', headers: H, body: JSON.stringify({ stage: 'brief' }) });

/** 跑一段并等它跑完（SSE 不等，轮询状态） */
async function runAndWait(stage, maxWaitSec = 420) {
  const r = await fetch(`${BASE}${P}/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-project-id': pid },
    body: JSON.stringify({ stage }),
  });
  if (r.status !== 200) return { error: `advance HTTP ${r.status}` };
  void r.body?.cancel?.();
  for (let i = 0; i < maxWaitSec / 5; i += 1) {
    await new Promise((res) => setTimeout(res, 5000));
    const st = await req(P, { headers: H });
    const rec = st.json?.data?.view?.stages?.find((s) => s.key === stage);
    if (rec && rec.status !== 'running') return rec;
    if (i % 6 === 5) console.log(`    …${stage} 已等 ${(i + 1) * 5}s`);
  }
  return { error: `${stage} 超时未跑完` };
}

// ---- 前三段：跑 → 批准 ----
for (const stage of ['cast', 'bible', 'plot']) {
  console.log(`\n▶ ${stage}`);
  const rec = await runAndWait(stage);
  check(`${stage} 停在等确认`, rec.status === 'awaiting_user', String(rec.status ?? rec.error));
  if (rec.status !== 'awaiting_user') break;
  const d = await req(`${P}/decision`, { method: 'POST', headers: H, body: JSON.stringify({ stage, action: 'approve' }) });
  check(`${stage} 批准成功`, d.status === 200, `HTTP ${d.status}`);
}

// ---- Stage4 偏离核查 ----
console.log('\n▶ drift（偏离核查）');
const drift = await runAndWait('drift');
check('drift 跑完', !!drift.status, String(drift.error ?? ''));
check('★ drift **没有闸门**：跑完即 approved（不是 awaiting_user）', drift.status === 'approved', String(drift.status));
check('报告非空', (drift.artifact?.length ?? 0) > 50, `${drift.artifact?.length ?? 0} 字符`);

const c = drift.driftCounts;
check('★ 逐条核查有统计（driftCounts 存在）', !!c, JSON.stringify(c ?? null));
if (c) {
  // brief 有 6 个可判定字段（开局/世界观/笔风/主角/流派/女主）
  check('★ 断言条数 ≥ 6（brief 的每个字段都要有一条）', c.total >= 6, `total=${c.total}`);
  const sum = c.符合 + c.偏离 + c.库中无依据;
  check('★ 三类判定之和 === total（没有"没判"的条目）', sum === c.total, `${sum} vs ${c.total}`);
  console.log(`   统计：符合 ${c.符合} · 偏离 ${c.偏离} · 库中无依据 ${c.库中无依据} · 硬 ${c.hard} · 软 ${c.soft}`);
}
check('报告含「硬偏离」「软偏离」两栏（格式契约）', /硬偏离/.test(drift.artifact ?? '') && /软偏离/.test(drift.artifact ?? ''));

const view = (await req(P, { headers: H })).json?.data?.view;
const cursor = view?.stage;
if ((c?.hard ?? 0) > 0) {
  check('★ 有硬偏离 → 游标退回到需要回修的段（不是继续往前）', cursor !== 'pilot', `游标=${cursor}`);
} else {
  check('无硬偏离 → 游标自动推进到 pilot', cursor === 'pilot', `游标=${cursor}`);
}

console.log('\n报告预览：');
console.log((drift.artifact ?? '').slice(0, 500));
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`临时项目：${pid}`);
console.log(`清理：node scripts/verify-autowrite-cleanup.mjs ${USERNAME} ${pid}`);
process.exit(failed === 0 ? 0 : 1);
