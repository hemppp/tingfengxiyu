#!/usr/bin/env node
// ============================================================
// 验证多智能体流水线的状态机与路由
//
// 用法（server 必须先以 Node 24 起在 3774）：
//   "D:/ruanjian/node.24/node.exe" scripts/verify-pipeline-api.mjs
//
// **默认零模型成本**：只跑不需要模型的那部分（start / brief 段 / 各种守卫）。
// 若项目里已有某个阶段停在「等确认」（例如你手动跑过一轮），脚本会自动多验一段：
// 打回必须带批注、带批注能打回 —— 那段才需要模型。
//
// 覆盖（零成本部分）：
//   1) 未启动 → started:false
//   2) 没有开书设定 → 400 且提示人话（流水线的起点就是它）
//   3) start（有设定）→ 7 阶段就位、游标停在 brief、已实现 6 段（只剩 production 未实现）、
//      闸门标在 cast/bible/plot/pilot
//   4) 跳着跑 → 409；未实现阶段（production）→ 501
//   5) brief 段不调模型直接过：SSE 只有 stage_skipped、游标推进到 cast
//   6) 往回重跑更早的段被允许，并记进台账
//
// 状态机三态（approve/revise/reject）的语义由单测覆盖，见
// apps/plugins/local/novel.autowrite/server/pipeline/store.test.ts
//
// 清理：脚本会打印命令，用 scripts/verify-autowrite-cleanup.mjs 删账号与项目。
// ============================================================

const BASE = 'http://127.0.0.1:3774';
const P = '/api/plugins/autowrite/pipeline';
const USERNAME = 'plprobe_ui';
const PASSWORD = 'Probe1234!';

let cookie = '';
async function req(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { ...opts, headers });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSE 或非 JSON */ }
  return { status: res.status, json, text };
}

/** 消费 SSE：把 data: 行解析成事件数组（★ 别忘了 x-project-id，否则一律 400） */
async function sse(path, body, projectId) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(projectId ? { 'x-project-id': projectId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { status: res.status, events: [], text: await res.text() };
  }
  const raw = await res.text();
  const events = raw.split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean);
  return { status: res.status, events };
}

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}
const stageOf = (view, key) => view?.stages?.find((s) => s.key === key);

const brief = {
  opening: '主角在末日前三小时醒来',
  worldview: '近未来沿海都市，丧尸爆发后第三年',
  style: '冷硬克制，短句为主',
  protagonist: '陈默',
  multipleHeroines: false,
  heroines: ['苏晚'],
  genreCategory: 'system',
  genre: '末日求生',
};

// 0) 账号
let r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '流水线探针' }) });
if (r.status === 409) r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
check('登录取到会话', r.status === 200 || r.status === 201, `HTTP ${r.status}`);

// 无开书设定：必须被拦住，且说清为什么
const bare = await req('/api/projects', { method: 'POST', body: JSON.stringify({ name: '流水线探针·无设定', mode: 'auto' }) });
const bareId = bare.json?.data?.id;
const bareStart = await req(`${P}/start`, { method: 'POST', headers: { 'x-project-id': bareId }, body: JSON.stringify({}) });
// ★ 错误体必须是人话：前端 apiClient 读的是 body.error.message（宿主约定），
//   写成裸字符串 { error: 'xxx' } 界面上只会显示「请求失败(400)」这种废话。
check('无开书设定 → 400 且提示人话',
  bareStart.status === 400 && /开书设定/.test(bareStart.json?.error?.message ?? ''),
  `HTTP ${bareStart.status} · ${JSON.stringify(bareStart.json?.error ?? null)}`);

// 有开书设定的项目
const proj = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: '流水线探针·设定完备', mode: 'auto', genre: '系统流 · 末日求生', brief }),
});
const pid = proj.json?.data?.id;
check('创建带开书设定的 auto 项目', proj.status === 201 && !!pid, `HTTP ${proj.status}`);

const before = await req(P, { headers: { 'x-project-id': pid } });
check('未启动时 started:false', before.json?.data?.started === false);

const started = await req(`${P}/start`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ note: '不要太慢热' }) });
let view = started.json?.data?.view;
check('start 成功且 7 个阶段就位', started.status === 200 && view?.stages?.length === 7, `HTTP ${started.status}`);
check('游标停在 brief', view?.stage === 'brief', String(view?.stage));
// ★ 别硬编码「几个已实现」：跟着 IMPLEMENTED_STAGES 的真实名单走。
//   M2 完成后已实现 6 段，而这里曾经写死 4 段（brief/cast/bible/plot），
//   每上一个里程碑就要改一次脚本 —— 2026-09-14 就是这么假失败过一回。
const implKeys = (view?.stages ?? []).filter((s) => s.implemented).map((s) => s.key);
check(
  '已实现 6 段（brief/cast/bible/plot/drift/pilot），只剩 production 未实现',
  JSON.stringify(implKeys) === JSON.stringify(['brief', 'cast', 'bible', 'plot', 'drift', 'pilot']),
  implKeys.join(','),
);
check('闸门只标在 cast/bible/plot/pilot',
  JSON.stringify((view?.stages ?? []).filter((s) => s.gated).map((s) => s.key)) === JSON.stringify(['cast', 'bible', 'plot', 'pilot']));

// 守卫
const skip = await req(`${P}/advance`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: 'bible' }) });
check('跳着跑 bible → 409', skip.status === 409, `HTTP ${skip.status}`);
// 「未实现」的探针要用**真未实现**的阶段。drift 在 M2 已实现，再拿它验 501 会先撞上游标守卫
// 拿回 409 —— 那不是缺陷，是探针选错了（且 409 与「跳着跑」的断言混在一起，看起来像真 bug）。
const notImpl = await req(`${P}/advance`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: 'production' }) });
check('未实现的 production → 501（不假装能跑）', notImpl.status === 501, `HTTP ${notImpl.status}`);
const early = await req(`${P}/decision`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: 'cast', action: 'approve' }) });
check('cast 没产出就 approve → 409', early.status === 409, `HTTP ${early.status}`);
const wrongStage = await req(`${P}/decision`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: 'brief', action: 'revise', note: 'x' }) });
check('对非游标阶段做决策 → 409', wrongStage.status === 409, `HTTP ${wrongStage.status}`);

// brief 段：不调模型直接过
const adv = await sse(`${P}/advance`, { stage: 'brief' }, pid);
const types = adv.events.map((e) => e.type);
check('brief 段直接过（stage_skipped）', types.includes('stage_skipped'), types.join(','));
check('brief 段没有闸门（不发 awaiting_user）', !types.includes('awaiting_user'), types.join(','));
view = (await req(P, { headers: { 'x-project-id': pid } })).json?.data?.view;
check('游标推进到 cast', view?.stage === 'cast', String(view?.stage));
check('brief 记为 approved', stageOf(view, 'brief')?.status === 'approved');

// 往回重跑更早的段：允许，并记台账
const back = await sse(`${P}/advance`, { stage: 'brief' }, pid);
check('往回重跑更早的段被允许', back.status === 200 && back.events.length > 0, `HTTP ${back.status}，事件 ${back.events.length}`);
const ledger = await req(`${P}/ledger`, { headers: { 'x-project-id': pid } });
const decisions = ledger.json?.data?.decisions ?? [];
check('重跑记进台账', decisions.some((d) => /重跑/.test(d.note ?? '')), JSON.stringify(decisions.map((d) => d.action)));
view = (await req(P, { headers: { 'x-project-id': pid } })).json?.data?.view;
check('重跑后游标回到 cast（brief 又自动过了一遍）', view?.stage === 'cast', String(view?.stage));

// 需要模型的那部分：只有真的跑过一段才验
const awaiting = view?.stages?.find((s) => s.status === 'awaiting_user');
if (awaiting) {
  console.log(`\n· 发现「${awaiting.label}」停在等确认，顺带验证闸门：`);
  const noNote = await req(`${P}/decision`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: awaiting.key, action: 'revise' }) });
  check('打回不带批注 → 400（没批注的重跑等于原样再来一遍）', noNote.status === 400, `HTTP ${noNote.status}`);
  const rev = await req(`${P}/decision`, { method: 'POST', headers: { 'x-project-id': pid }, body: JSON.stringify({ stage: awaiting.key, action: 'revise', note: '再冷一点' }) });
  check('带批注打回 → revision+1', (rev.json?.data?.view?.stages?.find((s) => s.key === awaiting.key)?.revision ?? 0) >= 1);
} else {
  console.log('\n· 跳过闸门三态的 HTTP 验证（没有停在等确认的阶段；那一段要调模型，约 4–5 次调用）');
  console.log('  三态语义已由单测覆盖：apps/plugins/local/novel.autowrite/server/pipeline/store.test.ts');
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`临时项目：${pid}（另有一个无设定项目 ${bareId}）`);
console.log(`清理：node scripts/verify-autowrite-cleanup.mjs ${USERNAME} ${pid}`);
process.exit(failed === 0 ? 0 : 1);
