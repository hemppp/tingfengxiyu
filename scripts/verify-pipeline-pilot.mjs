// ============================================================
// 真机验证：流水线 Stage5「前三章试写」（M2）
//
// 为什么必须真机跑：这一段的承诺是**具体到"三章正文进了库"**的，而报告极易写得像
// "三章都交了、文风统一"。所以验收一律**只看库**：
//   · chapters 表里第 1/2/3 章**真的存在**，且字数达标
//   · pilotChapters 三条记录 delivered 全 true（有一条 false 就是没交齐）
//   · **跨章连续性**：第 2/3 章正文里出现主角名 —— 串行注入上一章全文才会有的现象
//     （并发写三章时每章都从零开始，最容易缺的就是这个）
//   · premiereVerdict 存在且是 pass|minor|major 之一（跨章审阅真跑了、且回了合法判定）
//   · 停在 G4 闸门（awaiting_user），游标 cursor.lastDelivered === 3
//
// 前置：server 在跑（Node 24）。用法：node scripts/verify-pipeline-pilot.mjs
// ============================================================

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:3774';
const P = '/api/plugins/autowrite/pipeline';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const USERNAME = `pilot_${Date.now().toString(36)}`;
const HERO = '陈默';

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
  body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '试写探针' }),
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

// ---- 建项目：brief 写得**自洽**，尽量别在 drift 就卡住（本脚本验的是 pilot）----
const brief = {
  opening: `${HERO}在末日来临前三小时醒来，手机收到一条来自三年后自己的短信`,
  worldview: '末日第三年，旧水电站只在夜里供电；严禁出现枪支',
  style: '冷硬克制，短句为主',
  protagonist: HERO,
  multipleHeroines: false,
  heroines: ['苏晚'],
  genreCategory: 'system',
  genre: '末日求生',
};
const created = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: `试写三章 ${USERNAME}`, mode: 'auto', genre: '系统流 · 末日求生', brief }),
});
const pid = created.json?.data?.id;
check('建项目并写入 brief', created.status === 201 && !!pid, `HTTP ${created.status}`);
const H = { 'x-project-id': pid };

await req(`${P}/start`, { method: 'POST', headers: H, body: JSON.stringify({ note: '' }) });
await req(`${P}/advance`, { method: 'POST', headers: H, body: JSON.stringify({ stage: 'brief' }) });

/** 跑一段并等它跑完（SSE 不等，轮询状态） */
async function runAndWait(stage, maxWaitSec = 900) {
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
    if (i % 12 === 11) console.log(`    …${stage} 已等 ${(i + 1) * 5}s`);
  }
  return { error: `${stage} 超时未跑完` };
}

/** 游标在哪 */
async function cursorOf() {
  return (await req(P, { headers: H })).json?.data?.view?.stage;
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

// ---- drift：无闸门；万一有硬偏离就把退回去的那段重批，再来一次（最多 3 轮）----
for (let round = 1; round <= 3; round += 1) {
  console.log(`\n▶ drift（第 ${round} 轮）`);
  const d = await runAndWait('drift');
  check('drift 跑完', !!d.status, String(d.error ?? ''));
  const cur = await cursorOf();
  if (cur === 'pilot') break;
  if (round === 3) {
    check('drift 之后游标到 pilot', false, `游标=${cur}`);
    break;
  }
  console.log(`    drift 把游标退回「${cur}」，重跑该段再核查`);
  const rec = await runAndWait(cur);
  if (rec.status === 'awaiting_user') {
    await req(`${P}/decision`, { method: 'POST', headers: H, body: JSON.stringify({ stage: cur, action: 'approve' }) });
  }
}

// ---- Stage5 前三章试写 ----
console.log('\n▶ pilot（前三章试写）—— 三章串行，每章走完整闭环，耗时较长');
const t0 = Date.now();
const pilot = await runAndWait('pilot', 2400);
check('pilot 跑完', !!pilot.status, String(pilot.error ?? ''));
check('★ 停在 **G4 闸门**（awaiting_user：试写要作者看过才继续）', pilot.status === 'awaiting_user', String(pilot.status));
console.log(`    用时 ${Math.round((Date.now() - t0) / 1000)}s`);

const recs = pilot.pilotChapters ?? [];
check('★ pilotChapters 有 3 条记录（不是报告里说"三章"就算）', recs.length === 3, JSON.stringify(recs.map((r) => r.order)));
check('★ 三章**全部落库**（delivered 全 true）', recs.length === 3 && recs.every((r) => r.delivered), JSON.stringify(recs.map((r) => r.delivered)));

// 逐章字数：与单章闭环同口径（<2500 要补写）
for (const r of recs) {
  check(`第 ${r.order} 章字数达标（≥2500）`, r.wordCount >= 2500, `${r.wordCount} 字`);
}
const warned = recs.filter((r) => r.warnings?.length);
console.log(`    带警示交付：${warned.length} 章${warned.length ? ` → ${warned.map((r) => `第 ${r.order} 章`).join('、')}` : ''}`);

check('★ 跨章审阅真跑了（premiereVerdict 存在）', !!pilot.premiereVerdict, JSON.stringify(pilot.premiereVerdict ?? null));
check('★ 审阅判定是合法值（pass|minor|major）', ['pass', 'minor', 'major'].includes(pilot.premiereVerdict?.verdict), String(pilot.premiereVerdict?.verdict));
check('报告含《前三章跨章审阅》（格式契约）', /前三章跨章审阅/.test(pilot.artifact ?? ''));
check('报告写了交付情况（报告要能独立看懂）', /已交付/.test(pilot.artifact ?? ''));

// ---- 落库判据：直接查项目库（不看报告怎么写）----
const PDB = `F:/new1.2/data/projects/${pid}.db`;
let chapters = [];
try {
  const pdb = new DatabaseSync(PDB, { readOnly: true });
  chapters = pdb.prepare('select "order" o, title, length(content) len, content from chapters where deleted_at is null order by "order"').all();
  pdb.close();
} catch (e) {
  check('项目库可读', false, String(e.message));
}
check('★ 项目库里真有 3 章（1/2/3）', chapters.length === 3 && chapters.map((c) => c.o).join(',') === '1,2,3', chapters.map((c) => c.o).join(','));
for (const c of chapters) {
  check(`第 ${c.o} 章正文非空（${c.len} 字）`, c.len > 1000, `${c.len}`);
}

// ---- ★ 跨章连续性：串行注入上一章全文才会有的现象 ----
const ch2 = chapters.find((c) => c.o === 2)?.content ?? '';
const ch3 = chapters.find((c) => c.o === 3)?.content ?? '';
check(`★ 第 2 章提到主角名「${HERO}」（说明它知道上一章是谁在走）`, ch2.includes(HERO));
check(`★ 第 3 章提到主角名「${HERO}」`, ch3.includes(HERO));
// 第二、三章不该再"从头介绍主角"（那正是并发写三章的典型症状）
check('第 2 章没有重新开篇介绍主角（不是另起炉灶）', !/^[^。]{0,20}(是[一个名]|名叫)/.test(ch2.trim().slice(0, 60)));

// ---- 长跑游标：pilot 是长跑的起点，M3 靠它接续 ----
const view = (await req(P, { headers: H })).json?.data?.view;
check('★ 长跑游标 lastDelivered === 3（M3 长跑从第 4 章接）', view?.lastDelivered === 3, `lastDelivered=${view?.lastDelivered}`);

console.log('\n审阅报告预览：');
console.log((pilot.artifact ?? '').slice(0, 700));
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`临时项目：${pid}`);
console.log(`清理：node scripts/verify-autowrite-cleanup.mjs ${USERNAME} ${pid}`);
process.exit(failed === 0 ? 0 : 1);
