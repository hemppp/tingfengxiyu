#!/usr/bin/env node
// ============================================================
// 连写多章驱动脚本
//
// 为什么不用界面点：30 章 × 每章约 1 分钟 = 半小时长连接，
// 浏览器/SSE 中间任何一环断掉都很难续。这个脚本**分批**调用（默认每批 5 章），
// 每批一条新连接，中途断了用 --from 续跑即可，已交付的章节不会重写
// （交付侧有「已有正文不覆盖」保护）。
//
// 前置：server 在跑（Node 24 启动），vite 可选（要看界面才需要）。
//
// 用法：
//   # 新建临时账号 + auto 项目，从第 1 章连写 30 章
//   node scripts/run-chapters.mjs --new --from 1 --count 30
//   # 续跑（脚本会打印账号与项目 id）
//   node scripts/run-chapters.mjs --user probeXXX --project <projectId> --from 6 --count 25
//
// 可选：--batch N（每批章数，默认 5）、--message "首章指令"、--dry（只打印计划不执行）
// 产出：data/run-chapters-<stamp>.jsonl（每章一行摘要，供事后分析）
// ============================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3774';
const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PASSWORD = 'Probe1234!';
const DEFAULT_MESSAGE = '写第1章：一个普通上班族早高峰在地铁上捡到一部还在响的手机，接起来后对方直接叫出了他的名字。他叫陈默，三年前姐姐失踪后，他把日子过成了一条不能停的流水线。';

// ---- 参数解析 ----
const args = process.argv.slice(2);
const opt = (name, def = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const isNew = flag('new');
const fromChapter = Math.max(1, Number(opt('from', '1')) || 1);
const count = Math.max(1, Number(opt('count', '30')) || 30);
const batchSize = Math.max(1, Math.min(10, Number(opt('batch', '5')) || 5));
const firstMessage = opt('message', DEFAULT_MESSAGE);
const dryRun = flag('dry');
/** --verbose：把 phase 也打出来（默认只打章节级进度，免得刷屏） */
const verbose = flag('verbose');

let USERNAME = opt('user', '');
let projectId = opt('project', '');

if (!isNew && (!USERNAME || !projectId)) {
  console.log('用法：\n  node scripts/run-chapters.mjs --new --from 1 --count 30\n  node scripts/run-chapters.mjs --user <username> --project <projectId> --from 6 --count 25');
  process.exit(1);
}

let cookie = '';
const stamp = Date.now().toString(36);
const LOG = `F:/new1.2/data/run-chapters-${stamp}.jsonl`;
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const say = (...a) => console.log(`[${ts()}]`, ...a);
const len = (s) => String(s ?? '').replace(/\s/g, '').length;

async function req(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { ...opts, headers });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return res;
}

/** 跑一批（一次 SSE 请求，内部连写 n 章）。返回每章的摘要 */
async function runBatch(startOrder, nChapters) {
  const message = startOrder === 1 && !flag('resume')
    ? firstMessage
    : `接着上一章往下写第 ${startOrder} 章。保持人物、伏笔与文风的连续性，不要重述上一章已经写过的内容。`;

  say(`—— 批次开始：第 ${startOrder} 章起，连写 ${nChapters} 章 ——`);
  const res = await fetch(`${BASE}/api/plugins/autowrite/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-project-id': projectId, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ message, chapterOrder: startOrder, chapterCount: nChapters }),
  });
  if (res.status >= 400) {
    say('批次请求失败:', res.status, (await res.text()).slice(0, 200));
    return [];
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const out = [];
  let buf = '';
  /** 每章的累积状态 */
  let cur = { order: 0, reviews: 0, checks: [], polishes: [], delivered: null, blocked: null, entities: null, drafts: [] };

  const flush = (delivered) => {
    const ck = cur.checks.at(-1);
    const row = {
      order: cur.order,
      drafts: cur.drafts,
      reviews: cur.reviews,
      checkPassed: ck ? ck.passed : null,
      checkDetail: ck?.detail,
      polishScore: cur.polishes.at(-1) ?? null,
      delivered: cur.delivered,
      blocked: cur.blocked,
      entities: cur.entities,
      ok: delivered,
      at: new Date().toISOString(),
    };
    out.push(row);
    fs.appendFileSync(LOG, JSON.stringify(row) + '\n', 'utf8');
    const wc = cur.delivered?.wordCount ?? 0;
    say(
      delivered
        ? `  ✔ 第 ${cur.order} 章交付 ${wc} 字｜意图门打回 ${cur.reviews} 次｜校对门 ${ck ? (ck.passed ? '过' : '有冲突(未拦)') : '未执行'}｜润色 ${cur.polishes.at(-1) ?? '-'} 分｜实体 ${cur.entities ? `${cur.entities.created}新/${cur.entities.updated}更` : '-'}`
        : `  ✘ 第 ${cur.order} 章未交付${cur.blocked ? `（${String(cur.blocked.reason).slice(0, 60)}）` : ''}`,
    );
    if (ck?.detail && !ck.passed) say(`     校对门说明：${String(ck.detail).slice(0, 200)}`);
  };

  for (;;) {
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
        switch (e.type) {
          case 'phase':
            if (verbose) say('    · ' + e.label);
            break;
          case 'chapter_start':
            cur = { order: e.order, reviews: 0, checks: [], polishes: [], delivered: null, blocked: null, entities: null, drafts: [] };
            say(`▶ 第 ${e.order} 章（${e.index}/${e.total}）`);
            break;
          case 'draft':
            cur.drafts.push({ revision: e.revision, chars: len(e.text) });
            break;
          case 'review':
            if (!e.passed) cur.reviews += 1;
            break;
          case 'gate':
            if (verbose) {
              say(`    · GATE ${e.name} passed=${e.passed}${e.score != null ? ` score=${e.score}` : ''} | ${String(e.detail).slice(0, 200)}`);
            }
            if (e.name === 'check') cur.checks.push({ passed: e.passed, detail: e.detail });
            else cur.polishes.push(e.score ?? null);
            break;
          case 'delivered':
            if (!cur.order) cur.order = e.order; // 单章模式没有 chapter_start，章号从交付事件补
            cur.delivered = { order: e.order, title: e.title, wordCount: e.wordCount, created: e.created };
            break;
          case 'deliver_blocked':
            if (!cur.order) cur.order = e.order;
            cur.blocked = { order: e.order, reason: e.reason };
            break;
          case 'entities':
            cur.entities = { created: e.created, updated: e.updated, skipped: e.skipped };
            break;
          case 'error':
            say('  ! error:', String(e.message).slice(0, 140));
            break;
          case 'chapter_done':
            flush(e.delivered);
            break;
          case 'done':
            // 单章模式（chapterCount=1）不走 runChapters，没有 chapter_done —— 在这里补一次收尾
            if (cur.order > 0 && !out.some((r) => r.order === cur.order)) flush(cur.delivered != null);
            break;
          default:
            break;
        }
      }
    }
  }
  return out;
}

// ---- 准备环境 ----
if (isNew) {
  const stampUser = `probe${stamp}`;
  const r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: stampUser, password: PASSWORD, displayName: '连写探针' }) });
  if (r.status >= 400) { console.log('注册失败', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  const db = new Database(MAIN_DB);
  const admin = db.prepare("select id from users where username='user'").get();
  const cfg = db.prepare('select ai_provider_config from user_settings where user_id=?').get(admin.id)?.ai_provider_config;
  const me = db.prepare('select id from users where username=?').get(stampUser);
  const now = Math.floor(Date.now() / 1000);
  if (db.prepare('select user_id from user_settings where user_id=?').get(me.id)) {
    db.prepare('update user_settings set ai_provider_config=?, updated_at=? where user_id=?').run(cfg, now, me.id);
  } else {
    db.prepare('insert into user_settings (user_id, ai_features, ai_provider_config, created_at, updated_at) values (?,?,?,?,?)').run(me.id, '{}', cfg, now, now);
  }
  db.close();
  USERNAME = stampUser;
  const lr = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
  if (lr.status >= 400) { console.log('登录失败', lr.status); process.exit(1); }
  const pr = await req('/api/projects', { method: 'POST', body: JSON.stringify({ name: `连写·${count}章 ${stamp}`, genre: '都市悬疑', mode: 'auto' }) });
  const pj = await pr.json();
  projectId = pj?.data?.id ?? pj?.id ?? '';
  if (!projectId) { console.log('建项目失败', JSON.stringify(pj).slice(0, 300)); process.exit(1); }
  say(`环境就绪：账号 ${USERNAME} / 项目 ${projectId}`);
} else {
  const lr = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
  say('登录:', lr.status);
  if (lr.status >= 400) process.exit(1);
}

const lastOrder = fromChapter + count - 1;
say(`计划：第 ${fromChapter} → ${lastOrder} 章，共 ${count} 章，每批 ${batchSize} 章`);
if (dryRun) { say('--dry 模式，不执行'); process.exit(0); }

// ---- 分批跑 ----
let done = 0;
for (let start = fromChapter; start <= lastOrder; start += batchSize) {
  const n = Math.min(batchSize, lastOrder - start + 1);
  const rows = await runBatch(start, n);
  done += rows.filter((r) => r.ok).length;
  say(`批次收尾：累计成功 ${done} 章`);
  if (rows.length === 0) { say('⚠️ 本批没有任何章节事件返回 —— 可能是连接断了，请用 --from 续跑'); break; }
}

// ---- 汇总 ----
say(`全部完成：成功 ${done} / 计划 ${count} 章，用时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
const pdb = `F:/new1.2/data/projects/${projectId}.db`;
if (fs.existsSync(pdb)) {
  const d = new Database(pdb, { readonly: true });
  const counts = {};
  for (const t of ['chapters', 'characters', 'items', 'locations', 'foreshadows', 'story_events']) {
    try { counts[t] = d.prepare(`select count(*) c from ${t}`).get().c; } catch (err) { counts[t] = `ERR`; }
  }
  say('项目库累计:', JSON.stringify(counts));
  try {
    const rows = d.prepare('select "order" o, word_count w from chapters order by "order"').all();
    const total = rows.reduce((s, r) => s + (r.w || 0), 0);
    say(`章节 ${rows.length} 章，合计 ${total} 字，平均 ${rows.length ? Math.round(total / rows.length) : 0} 字/章`);
  } catch { /* 列名差异 */ }
  d.close();
}
say(`日志：${LOG}`);
console.log(`\n续跑命令：node scripts/run-chapters.mjs --user ${USERNAME} --project ${projectId} --from <下一章> --count <剩余章数>`);
console.log(`清理命令：node scripts/verify-autowrite-cleanup.mjs ${USERNAME} ${projectId}`);
