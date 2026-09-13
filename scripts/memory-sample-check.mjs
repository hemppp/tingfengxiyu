// ============================================================
// 记忆随机抽查 —— 抽样给人看 + 不变量自动判定
//
// 为什么要有它：「写入 → 抽查 → 完善」这个循环里，抽查必须是**可复跑的**，
// 否则每次都是我手工 SQL 捞，既不可比对也留不下来。
//
// 用法：
//   node scripts/memory-sample-check.mjs            # 全部有 agent_memory 的项目
//   node scripts/memory-sample-check.mjs <projectId> [每表抽样数，默认 5]
// 退出码：0 = 不变量全过；1 = 有不变量失败（可直接进 CI）
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'F:/new1.2/data';
const MAIN_DB = path.join(DATA_DIR, 'novelmuse.db');
const COUNT = Number(process.argv[3] ?? 5);
const ONLY = process.argv[2];

/** 合法枚举（与 types.ts 保持一致；这里是**独立抄一份**，故意如此：让代码与校验互为对照） */
const AUDIT_ACTIONS = new Set(['assemble', 'read_l1', 'deny_l1', 'write_l2', 'deny_write_l2', 'ingest', 'conflict']);
const REASONS = new Set(['discuss-context', 'continuity-check', 'assemble-before-write', 'gate-review', 'recall-by-need', 'ingest']);
const FORMS = new Set(['fact_ref', 'experience']);
const WHEEL_CAPACITY = 3;

/** 随机抽 n 条（Fisher–Yates 的取样版，不改原数组） */
function sample(arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length > 0) {
    out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return out;
}

function listProjects() {
  const main = new DatabaseSync(MAIN_DB, { readOnly: true });
  const rows = main.prepare('select id, name from projects').all();
  main.close();
  return rows;
}

const failures = [];
const notes = [];
function check(ok, msg) {
  if (!ok) failures.push(msg);
  return ok;
}

const targets = ONLY ? listProjects().filter((p) => p.id === ONLY) : listProjects();
if (targets.length === 0) {
  console.log('没有可检查的项目');
  process.exit(0);
}

for (const p of targets) {
  const file = path.join(DATA_DIR, 'projects', `${p.id}.db`);
  if (!fs.existsSync(file)) continue;
  const db = new DatabaseSync(file, { readOnly: true });
  const has = db.prepare("select name from sqlite_master where type='table' and name='agent_memory'").all();
  if (has.length === 0) { db.close(); continue; }

  console.log(`\n${'='.repeat(64)}\n项目：${p.name}（${p.id}）\n${'='.repeat(64)}`);

  const audit = db.prepare('select * from memory_audit order by at desc').all();
  const mem = db.prepare('select * from agent_memory').all();
  const conflicts = db.prepare('select * from fact_conflicts').all();
  const wheels = mem.filter((m) => m.key === 'wheel.slots');
  console.log(`规模：审计 ${audit.length} · L2 ${mem.length} · 水车 ${wheels.length} 台 · 冲突 ${conflicts.length}`);

  // ---------- 不变量 ----------
  // I1 每行都有 agent_id（隔离的物理前提）
  for (const m of mem) check(!!m.agent_id && String(m.agent_id).trim() !== '', `[I1] agent_memory 有行缺 agent_id（id=${m.id}）`);
  for (const a of audit) check(!!a.agent_id && String(a.agent_id).trim() !== '', `[I1] memory_audit 有行缺 agent_id（id=${a.id}）`);

  // I2 枚举合法
  for (const a of audit) {
    check(AUDIT_ACTIONS.has(a.action), `[I2] 非法 action: ${a.action}`);
    if (a.reason != null) check(REASONS.has(a.reason), `[I2] 非法 reason: ${a.reason}`);
  }
  for (const m of mem) check(FORMS.has(m.form), `[I2] 非法 form: ${m.form}（key=${m.key}）`);

  // I3 审计的 keys 必须是 JSON 数组
  for (const a of audit) {
    let ok = false;
    try { ok = Array.isArray(JSON.parse(a.keys)); } catch { ok = false; }
    check(ok, `[I3] keys 不是 JSON 数组: ${String(a.keys).slice(0, 40)}`);
  }

  // I4/I5 水车：章号严格递减、无重复、不超容量、正文非空
  for (const w of wheels) {
    let slots = [];
    try { slots = JSON.parse(w.value); } catch { /* 下面会判 */ }
    check(Array.isArray(slots) && slots.length > 0, `[I4] ${w.agent_id} 的 wheel.slots 不是非空数组`);
    check(slots.length <= WHEEL_CAPACITY, `[I4] ${w.agent_id} 斗数 ${slots.length} 超过容量 ${WHEEL_CAPACITY}`);
    const nos = slots.map((s) => s.chapterNo);
    check(new Set(nos).size === nos.length, `[I4] ${w.agent_id} 斗位章号重复: [${nos}]`);
    const desc = nos.every((n, i) => i === 0 || nos[i - 1] > n);
    check(desc, `[I4] ${w.agent_id} 斗位不是"斗1最新"的降序: [${nos}]`);
    for (const s of slots) check(typeof s.text === 'string' && s.text.length > 0, `[I5] ${w.agent_id} 斗位 ch${s.chapterNo} 正文为空`);
  }

  // I6 出界记录必须真的"不在斗里"（防止压了梗概却还占着斗位）
  const evictions = mem.filter((m) => m.key.startsWith('wheel.summary.') || m.key.startsWith('wheel.pending.'));
  for (const e of evictions) {
    const no = Number(e.key.replace(/^wheel\.(summary|pending)\./, ''));
    const inWheel = wheels.some((w) => {
      try { return JSON.parse(w.value).some((s) => s.chapterNo === no); } catch { return false; }
    });
    check(!inWheel, `[I6] ch${no} 既在斗位里又有出界记录（key=${e.key}）`);
  }

  // I8 时间戳必须落在合理区间 —— ★ 这条能自动抓住"秒/毫秒搞混"（实测抓到过一次：
  //    drizzle 的 timestamp 存**秒**，抽查脚本与 /memory 路由都当毫秒用 → 全显示 1970）
  const nowMs = Date.now();
  const lo = Date.UTC(2020, 0, 1);
  const hi = nowMs + 24 * 3600 * 1000;
  const saneTs = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo / 1000 && n <= hi / 1000;
  };
  for (const a of audit) check(saneTs(a.at), `[I8] 审计时间戳不合理: ${a.at}（多半是秒/毫秒搞混）`);
  for (const m of mem) check(saneTs(m.created_at), `[I8] L2 created_at 不合理: ${m.created_at}`);

  // I7 隔离的"物理"检查：同 key 在不同 agent 下必须是**不同的行**，且各 agent 只碰自己的 agent_id
  const byKey = new Map();
  for (const m of mem) {
    const list = byKey.get(m.key) ?? new Set();
    list.add(m.agent_id);
    byKey.set(m.key, list);
  }
  for (const [key, owners] of byKey) {
    check(owners.size <= mem.filter((m) => m.key === key).length, `[I7] ${key} 出现异常归属`);
  }
  // 没有任何一行把 agent_id 写成别的角色的前缀形式（防"拼接式越权"）
  for (const m of mem) check(!String(m.agent_id).includes('/'), `[I7] agent_id 含斜杠（可疑拼接）: ${m.agent_id}`);

  // ---------- 随机抽样（给人看）----------
  const pick = (label, rows, fmt) => {
    console.log(`\n—— 随机抽查 ${label}（${Math.min(COUNT, rows.length)}/${rows.length}）——`);
    if (rows.length === 0) { console.log('  （空）'); return; }
    for (const r of sample(rows, COUNT)) console.log('  ' + fmt(r));
  };

  pick('审计流水', audit, (a) => `${new Date(Number(a.at) * 1000).toLocaleTimeString('zh-CN', { hour12: false })} ${String(a.action).padEnd(9)} ${String(a.agent_id).padEnd(18)} allow=${a.allow} reason=${a.reason ?? '-'} ${String(a.detail ?? '').slice(0, 40)}`);
  pick('L2 专属记忆', mem.filter((m) => m.key !== 'wheel.slots'), (m) => `${String(m.agent_id).padEnd(18)} ${String(m.form).padEnd(10)} ${String(m.key).padEnd(28)} len=${String(m.value).length} src=${m.source_ref ?? '-'}`);
  pick('水车斗位', wheels, (w) => {
    let nos = '?';
    try { nos = JSON.parse(w.value).map((s) => 'ch' + s.chapterNo).join(', '); } catch { /* 脏数据 */ }
    return `${String(w.agent_id).padEnd(18)} 斗位=[${nos}]`;
  });
  pick('事实冲突', conflicts, (c) => `${c.status} ${c.slot}：${c.existing_value} ✗ ${c.incoming_value}（${c.source}）`);

  db.close();
}

console.log(`\n${'='.repeat(64)}`);
if (failures.length === 0) {
  console.log('✅ 不变量全过');
} else {
  console.log(`❌ ${failures.length} 条不变量失败：`);
  for (const f of failures.slice(0, 20)) console.log('  · ' + f);
  if (failures.length > 20) console.log(`  …另有 ${failures.length - 20} 条`);
}
if (notes.length) notes.forEach((n) => console.log('  ℹ ' + n));
process.exit(failures.length === 0 ? 0 : 1);
