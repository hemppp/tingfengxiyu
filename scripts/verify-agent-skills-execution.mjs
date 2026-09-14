// ============================================================
// 真机验证：智能体技能开关**真的作用到模型身上**
//
// 为什么必须真机跑：这一版要证明的不是"能读到配置"，而是"开了的技能进了模型看到的 prompt"。
// 组件测/接口测都只能证明前者 —— 后者只有模型能证。
//
// 证法（三段，缺一不可）：
//   ① 装一条**探针技能**：正文要求模型在章末原样输出 `##SKILL-PROBE-OK##`。
//      这个串模型不可能自己编出来 —— 正文里出现它就**只可能**是因为它看到了技能正文。
//   ② 只看**写作官**的 turn：它的 meta 里要出现 `技能 probe-marker`。
//   ③ 同一轮里**别的智能体**（剧情设计师/定稿官…）的 meta 里**不能**出现 ——
//      证明这是"按智能体分配"，不是"一把全塞给所有 agent"。
//
// 前置：server 在跑（Node 24）。用法：node scripts/verify-agent-skills-execution.mjs
// 清理：node scripts/verify-autowrite-cleanup.mjs <username> <projectId>
// ============================================================

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:3774';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const stamp = Date.now().toString(36);
const USERNAME = `agsk${stamp}`;
const MARKER = '##SKILL-PROBE-OK##';
const SKILL_ID = 'probe-marker';

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
  try { json = JSON.parse(text); } catch { /* SSE */ }
  return { status: res.status, json, text };
}

// ---- 探针账号 + 复制管理员 AI 配置（否则模型调用必失败）----
const reg = await req('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '技能执行探针' }),
});
check('注册探针账号', reg.status === 201, `HTTP ${reg.status}`);
const main = new DatabaseSync(MAIN_DB, { readOnly: true });
const adminCfg = main.prepare("select s.ai_provider_config c from user_settings s join users u on u.id = s.user_id where u.username = 'user'").get()?.c;
main.close();
if (!adminCfg) { console.error('管理员没有 AI 配置，无法验证'); process.exit(1); }
const me = (await req('/api/auth/me')).json?.data;
const w = new DatabaseSync(MAIN_DB);
w.prepare('insert or replace into user_settings (user_id, ai_features, ai_provider_config, created_at, updated_at) values (?, ?, ?, ?, ?)')
  .run(me.id, '{}', adminCfg, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
w.close();

const created = await req('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: `技能执行 ${stamp}`, mode: 'auto', genre: '都市悬疑' }),
});
const pid = created.json?.data?.id;
check('建 auto 项目', created.status === 201 && !!pid, `HTTP ${created.status}`);
const H = { 'x-project-id': pid };

// ---- ① 装探针技能（归属写作官）----
console.log('\n▶ 装技能并开启');
const ins = await req('/api/ai/skill-library/install', {
  method: 'POST',
  body: JSON.stringify({
    id: SKILL_ID,
    name: '探针技能（必须原样输出标记）',
    description: '验证开关是否真的作用到模型',
    category: 'agent',
    ownerAgent: 'writer',
    systemPrompt: `你**必须**在正文的第一行原样输出下面这一行标记，然后再开始写正文（不要加引号、不要解释、不要改动）：\n${MARKER}`,
  }),
});
check('安装探针技能到写作官名下', ins.status === 201, `HTTP ${ins.status}`);

const beforeToggle = (await req('/api/ai/skill-targets/writer')).json?.data?.skills?.find((s) => s.id === SKILL_ID);
check('★ 刚装完是关的（要作者显式开）', beforeToggle?.enabled === false, `enabled=${beforeToggle?.enabled}`);

const on = await req('/api/ai/skill-targets/writer/toggle', {
  method: 'PUT', body: JSON.stringify({ skillId: SKILL_ID, enabled: true }),
});
check('开启探针技能', on.status === 200, `HTTP ${on.status}`);

// 隔离：同一个技能不该出现在别的 agent 名下
const other = (await req('/api/ai/skill-targets/plot-designer')).json?.data?.skills ?? [];
check('★ 探针技能不出现在剧情设计师名下（按智能体分配）', !other.some((s) => s.id === SKILL_ID));

// ---- ② 跑一章，抓每个角色发言的 meta ----
console.log('\n▶ 跑一章（真模型，约 2–4 分钟）');
const res = await fetch(`${BASE}/api/plugins/autowrite/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, 'x-project-id': pid },
  body: JSON.stringify({ message: `写第 1 章：主角在便利店值夜班时发现有人跟踪他`, chapterOrder: 1 }),
});
if (!res.ok || !res.body) {
  check('session SSE 建立', false, `HTTP ${res.status}`);
  process.exit(1);
}
const turns = [];
let delivered = null;
let errMsg = null;
{
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (block) => {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let e = null;
      try { e = JSON.parse(raw); } catch { continue; }
      if (e.type === 'turn') turns.push({ agent: e.agent, name: e.name, meta: e.meta ?? '', len: String(e.text ?? '').length });
      if (e.type === 'delivered') delivered = e;
      if (e.type === 'error') errMsg = e.message;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  handle(buf);
}
check('本章交付成功', !!delivered, delivered ? `第 ${delivered.order} 章 ${delivered.wordCount} 字` : (errMsg ?? '未交付'));

// ---- ③ 看 meta：只有写作官带技能 ----
const writerTurns = turns.filter((t) => t.agent === 'writer');
const otherTurns = turns.filter((t) => t.agent !== 'writer');
console.log(`   本轮发言：写作官 ${writerTurns.length} 次，其他 ${otherTurns.length} 次`);
for (const t of turns) console.log(`   · ${t.agent.padEnd(18)} ${String(t.len).padStart(5)}字  meta=${t.meta || '(无)'}`);

check('★ 写作官的 turn 标出了已注入技能', writerTurns.some((t) => t.meta.includes(`技能 ${SKILL_ID}`)), writerTurns.map((t) => t.meta).join(' | '));
check('★ 其他智能体的 turn **没有**这条技能（没有一把全塞）', otherTurns.length > 0 && otherTurns.every((t) => !t.meta.includes(SKILL_ID)), otherTurns.map((t) => t.agent).join(','));

// ---- ④ 硬证据：正文里出现只可能来自技能正文的标记 ----
const PDB = `F:/new1.2/data/projects/${pid}.db`;
let content = '';
try {
  const pdb = new DatabaseSync(PDB, { readOnly: true });
  content = pdb.prepare('select content from chapters where "order" = 1 and deleted_at is null').get()?.content ?? '';
  pdb.close();
} catch (e) {
  check('读取交付正文', false, String(e.message));
}
check('正文非空', content.length > 1000, `${content.length} 字符`);
check(`★★ 正文里出现标记「${MARKER}」（模型只可能因为看到技能正文才写出来）`, content.includes(MARKER),
  content.includes(MARKER) ? `已出现（正文开头：${content.slice(0, 40).replace(/\n/g, '⏎')}…）` : `未出现（正文末 120 字：${content.slice(-120).replace(/\n/g, '⏎')}）`);

// ---- ⑤ 自清理：探针技能装在**全局库**里（不属于探针账号），不删就会一直留在库中 ----
const del = await req(`/api/ai/skill-library/${SKILL_ID}`, { method: 'DELETE' });
check('验证后清掉探针技能（库是全局的，不清会留垃圾）', del.status === 200, `HTTP ${del.status}`);

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`临时项目：${pid}`);
console.log(`清理：node scripts/verify-autowrite-cleanup.mjs ${USERNAME} ${pid}`);
process.exit(failed === 0 ? 0 : 1);
