// ============================================================
// 真机验证：集中式 Skills 库 + 每个智能体的技能开关
//
// 为什么必须真机跑：这个功能的失败模式全是"看不见的"——
//   · 迁移没执行（表不存在）却记成"已应用"
//   · 库根本没种子（界面空着，作者以为产品就这样）
//   · 开关写进去了但读不回来（刷新后回到默认）
//   · 装了一个归属到不存在智能体的技能 → 永远不显示
// 所以这里逐条对着**库与接口**断言，不看界面文案。
//
// 前置：server 在跑（Node 24）。用法：node scripts/verify-skill-library.mjs
// ============================================================

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:3774';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const USERNAME = `skill_${Date.now().toString(36)}`;

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
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

// ---- 未鉴权基线：证明下面的 200 是真的鉴权后的结果（阴性对照）----
const anon = await req('/api/ai/skill-library');
check('未鉴权访问被挡（阴性对照）', anon.status === 401, `HTTP ${anon.status}`);

// ---- 探针账号 ----
const reg = await req('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: '技能库探针' }),
});
check('注册探针账号', reg.status === 201, `HTTP ${reg.status}`);

// ---- ① 库：真的种进去了吗 ----
console.log('\n▶ 技能库内容');
const lib = await req('/api/ai/skill-library');
check('读取技能库', lib.status === 200, `HTTP ${lib.status}`);
const skills = lib.json?.data?.skills ?? [];
const byCat = lib.json?.data?.byCategory ?? { assistant: [], agent: [] };
check('★ 库里有种子技能（界面不会是空的）', skills.length >= 9, `${skills.length} 条`);
check('★ 已有的写作技能都归到 agent skills', byCat.agent.length >= 9, `agent 类 ${byCat.agent.length} 条`);
check('内置技能的 source 标为 builtin', skills.every((s) => s.source === 'builtin'), skills.map((s) => s.source).join(','));
check('★ 归属都解析成了智能体名（不是裸 id）', skills.every((s) => !!s.ownerAgentName), skills.map((s) => s.ownerAgentName).join(','));
check('归属到未声明智能体的孤儿为 0', (lib.json?.data?.orphans ?? []).length === 0, JSON.stringify(lib.json?.data?.orphans));

// ---- ② 智能体清单 ----
console.log('\n▶ 智能体清单');
const targets = (await req('/api/ai/skill-targets')).json?.data?.targets ?? [];
const ids = targets.map((t) => t.id);
check('★ 智能体本体在清单里', ids.includes('chat'), ids.join(','));
check('★ 写作官在清单里', ids.includes('writer'));
check('写作流水线其余角色齐备', ['plot-designer', 'character-designer', 'continuity-keeper', 'convener', 'reviewer'].every((i) => ids.includes(i)));
const writer = targets.find((t) => t.id === 'writer');
check('写作官的技能计数 > 0', (writer?.total ?? 0) >= 9, `${writer?.enabled}/${writer?.total}`);

// ---- ③ 某智能体的技能 + 开关（默认关）----
console.log('\n▶ 写作官的技能与开关');
const w1 = (await req('/api/ai/skill-targets/writer')).json?.data;
check('读取写作官的技能', Array.isArray(w1?.skills) && w1.skills.length >= 9, `${w1?.skills?.length} 条`);
check('默认全部未配置（configured=false）', w1.skills.every((s) => s.configured === false));
check('默认全部为关', w1.skills.every((s) => s.enabled === false));

const one = w1.skills[0];
const turn = await req('/api/ai/skill-targets/writer/toggle', {
  method: 'PUT', body: JSON.stringify({ skillId: one.id, enabled: true }),
});
check('开启一条技能', turn.status === 200, `HTTP ${turn.status}`);
const w2 = (await req('/api/ai/skill-targets/writer')).json?.data;
const back = w2.skills.find((s) => s.id === one.id);
check('★ 重新读取仍是开（真持久化了，不是内存里的假象）', back?.enabled === true && back?.configured === true, JSON.stringify({ enabled: back?.enabled, configured: back?.configured }));
check('计数跟着变', (w2.target.enabled ?? 0) >= 1, `${w2.target.enabled}/${w2.target.total}`);

const all = await req('/api/ai/skill-targets/writer/toggle-all', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
check('批量开启', all.status === 200 && (all.json?.data?.count ?? 0) >= 9, JSON.stringify(all.json?.data));
const w3 = (await req('/api/ai/skill-targets/writer')).json?.data;
check('★ 批量开启后逐条都是开', w3.skills.every((s) => s.enabled));
await req('/api/ai/skill-targets/writer/toggle-all', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
const w4 = (await req('/api/ai/skill-targets/writer')).json?.data;
check('批量关闭后逐条都是关', w4.skills.every((s) => !s.enabled));

// ---- ④ 越界防护 ----
console.log('\n▶ 越界与校验（错误必须说清原因）');
const badAgent = await req('/api/ai/skill-targets/no-such-agent');
check('未知智能体 → 404', badAgent.status === 404, `HTTP ${badAgent.status}`);

const badToggle = await req('/api/ai/skill-targets/plot-designer/toggle', {
  method: 'PUT', body: JSON.stringify({ skillId: 'worldbuilder', enabled: true }),
});
check('★ 把写作官的技能开给剧情设计师 → 400（不是默默生效）', badToggle.status === 400, `HTTP ${badToggle.status} ${badToggle.json?.error?.message ?? ''}`);

const badEnable = await req('/api/ai/skill-targets/writer/toggle', {
  method: 'PUT', body: JSON.stringify({ skillId: 'worldbuilder', enabled: 'yes' }),
});
check('enabled 非布尔 → 400', badEnable.status === 400, `HTTP ${badEnable.status}`);

// ---- ⑤ 安装 / 删除 ----
console.log('\n▶ 安装与删除');
const ins = await req('/api/ai/skill-library/install', {
  method: 'POST',
  body: JSON.stringify({
    id: 'probe-doctor', name: '探针技能', description: '验证用',
    category: 'agent', ownerAgent: 'writer', systemPrompt: '这是一条探针技能',
  }),
});
check('安装一条 agent skill', ins.status === 201, `HTTP ${ins.status}`);
const w5 = (await req('/api/ai/skill-targets/writer')).json?.data;
check('★ 装完立刻出现在该智能体名下', !!w5.skills.find((s) => s.id === 'probe-doctor'), `${w5.skills.length} 条`);
check('新装的源标记为 installed', w5.skills.find((s) => s.id === 'probe-doctor')?.source === 'installed');
check('新装默认是关的（要作者显式开）', w5.skills.find((s) => s.id === 'probe-doctor')?.enabled === false);

const insBadOwner = await req('/api/ai/skill-library/install', {
  method: 'POST',
  body: JSON.stringify({ id: 'orphan-x', name: '孤儿技能', category: 'agent', ownerAgent: 'ghost-agent' }),
});
check('★ 归属到不存在的智能体 → 400 且说明原因', insBadOwner.status === 400 && /未知智能体/.test(insBadOwner.json?.error?.message ?? ''), `HTTP ${insBadOwner.status} ${insBadOwner.json?.error?.message ?? ''}`);

const insBadId = await req('/api/ai/skill-library/install', {
  method: 'POST',
  body: JSON.stringify({ id: '有中文 或空格', name: 'x', category: 'agent', ownerAgent: 'writer' }),
});
check('非法 id → 400', insBadId.status === 400, `HTTP ${insBadId.status}`);

// 给它开一下，再删，验证开关记录被一起清掉
await req('/api/ai/skill-targets/writer/toggle', { method: 'PUT', body: JSON.stringify({ skillId: 'probe-doctor', enabled: true }) });
const del = await req('/api/ai/skill-library/probe-doctor', { method: 'DELETE' });
check('删除技能', del.status === 200, `HTTP ${del.status}`);
const w6 = (await req('/api/ai/skill-targets/writer')).json?.data;
check('★ 删完就不在该智能体名下了', !w6.skills.find((s) => s.id === 'probe-doctor'));
const delAgain = await req('/api/ai/skill-library/probe-doctor', { method: 'DELETE' });
check('重复删除 → 404（不假装成功）', delAgain.status === 404, `HTTP ${delAgain.status}`);

// ---- ⑥ 直接查库：开关记录有没有留垃圾 ----
console.log('\n▶ 落库事实');
const db = new DatabaseSync(MAIN_DB, { readOnly: true });
const orphanToggles = db.prepare('select skill_id from agent_skill_toggles where skill_id = ?').all('probe-doctor');
check('★ 删除后开关记录也清了（不留垃圾，重装不会被旧状态影响）', orphanToggles.length === 0, JSON.stringify(orphanToggles));
const totalToggles = db.prepare('select count(*) c from agent_skill_toggles').get().c;
console.log(`    agent_skill_toggles 行数：${totalToggles}`);
db.close();

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
console.log(`临时账号：${USERNAME}`);
console.log(`清理：node scripts/verify-autowrite-cleanup.mjs ${USERNAME}`);
process.exit(failed === 0 ? 0 : 1);
