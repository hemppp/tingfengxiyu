#!/usr/bin/env node
// ============================================================
// e2e-ui-integration.mjs — 「目标截图布局」跨区集成自测（t4）
//
// 目的：把三条并行线（t1 外壳 / t2 中栏编辑器 / t3 左右栏面板）当成**一个整体**
//       在真实栈上端到端验证，覆盖 5 条跨区契约：
//         ①顶栏模式按钮 ↔ 文档标签栏 ↔ 中栏编辑器 ↔ 左右面板 ↔ 底部细条/状态栏 五处状态一致
//         ②底部细条「N 条问题」= 中栏批注块真实计数（不是写死）；Ctrl+J 开关且内容不丢
//         ③文档标签栏「人物设定」→ 真实 characters 面板、「大纲 · 卷一」→ 真实 outline 面板
//         ④右栏 AI 对话面板在手写（manual）模式下可用，且发消息得到**真实后端 SSE**
//         ⑤100vh 无全局滚动条、各面板内部滚动；1280×800 与 1920×1080 都不溢出
//
// 前置条件（三个都要在跑；脚本不做启动，避免误拉服务）：
//   1) 后端：  pnpm dev:server            → http://localhost:3774（/api 前缀）
//   2) 前端：  pnpm dev                   → http://localhost:5174（vite dev，代理 /api）
//   3) Chromium 带 CDP：chrome --remote-debugging-port=9222（可用 的 E2E_CDP_PORT 覆盖）
//
// 用法（仓库根）：
//   node scripts/e2e/e2e-ui-integration.mjs
//   环境变量：E2E_CDP_PORT / E2E_BASE / E2E_USER / E2E_PASS / E2E_TIMEOUT_MS
//
// 退出码：0 = 全部通过；1 = 有失败项；2 = 前置条件不可用（CDP 连不上）
//
// 自清理：脚本创建的项目跑完即删（DELETE /api/projects/:id），不留脏数据。
// ============================================================

import http from 'http';
import WebSocket from 'ws';

// ---------------- 常量 / 选择器（全部来自真实源码，见 t4 交付说明） ----------------
const PORT = Number(process.env.E2E_CDP_PORT) || 9222;
const BASE = process.env.E2E_BASE || 'http://localhost:5174';
const USER = process.env.E2E_USER || 'admin';
const PASS = process.env.E2E_PASS || 'Admin1234!';
// 冷启动（全新浏览器 profile + 首次编译模块图）实测明显慢于热启动：
// 默认给足 45s，可用 E2E_TIMEOUT_MS 覆盖。
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS) || 45000;
const STAMP = Date.now().toString(36);

const PM = '.ProseMirror';
const S = {
  breadcrumbRoot: '.shell-breadcrumb-root',
  breadcrumbLeaf: '.shell-breadcrumb-leaf',
  // m04040：顶栏的「手写 / AI 写作」模式按钮组已删除，模式在开书时定下
  // （ProjectLayout.tsx 注释 + docs/design/ui-remodel-t6-adversarial-review.md §14.1）。
  // 两个选择器保留下来，只用于**反向断言**（顶栏必须不再出现模式按钮）。
  modeSwitch: '.shell-mode-switch',
  modeBtn: '.shell-mode-btn',
  modeGroup: '[aria-label="创作模式"]',
  topbarTextBtn: '.shell-topbar-text-btn',
  topbarDivider: '.shell-topbar-divider',
  workbenchBack: '[aria-label="返回书架"]',
  statusbar: '.shell-statusbar',
  statusbarItem: '.shell-statusbar-item',
  doctabsList: '[aria-label="文档标签"]',
  doctab: '.shell-doctab',
  doctabMain: '.shell-doctab-main',
  doctabClose: '.shell-doctab-close',
  dvTab: '.dv-tab',
  leftPanel: '[aria-label="章节侧边栏"]',
  chapterCount: '[aria-label^="共 "]',
  aiPanel: '[aria-label="AI 对话面板"]',
  aiLog: '[aria-label="对话消息"]',
  aiInput: '[aria-label="输入消息"]',
  aiSend: '[aria-label="发送"]',
  bottomArea: '.dock-bottom-area',
  bottomToggle: '.dock-bottom-toggle',
  bottomIssues: '.dock-bottom-issues',
  bottomBody: '.dock-bottom-body',
  bottomBlocks: '[data-testid="bottom-annotation-blocks"]',
  insertBlock: '[aria-label="插入批注块"]',
  workbenchMissing: '[aria-label="工作台未安装"]',
  activityBar: '[aria-label="活动栏"]',
};

// ---------------- 断言框架 ----------------
const results = [];
let failed = 0;
function check(label, ok, detail) {
  results.push({ label, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail === undefined || detail === '' ? '' : `  [${detail}]`}`);
  return !!ok;
}
function section(title) {
  console.log(`\n===== ${title} =====`);
}

// ---------------- CDP 最小客户端（与 e2e-mode-separation.mjs 同构） ----------------
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(new Error('timeout')); });
  });
}

let ws = null;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  }
  return r.result?.value;
}

async function waitFor(expression, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalJs(expression);
    if (last && last !== false && !(typeof last === 'object' && last.__error)) return last;
    await sleep(400);
  }
  return last;
}

// 表达式小工具（避免到处都是字符串拼接）
const q = (sel) => JSON.stringify(sel);
const textOf = (sel) => `(function(){var e=document.querySelector(${q(sel)});return e?e.textContent.trim():'';})()`;
const existsOf = (sel) => `!!document.querySelector(${q(sel)})`;
const countOf = (sel) => `document.querySelectorAll(${q(sel)}).length`;
const rectOf = (sel) => `(function(){var e=document.querySelector(${q(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()`;

/** 真实输入框写值（React 受控组件必须走原生 setter + input 事件） */
const setInputValue = (sel, value) => `(function(){
  var el = document.querySelector(${q(sel)});
  if (!el) return 'no-el';
  var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;

/** 视口 / 全局滚动条体检 */
const viewportExpr = `(function(){
  var de = document.documentElement, b = document.body;
  return {
    iw: window.innerWidth, ih: window.innerHeight,
    deScrollH: de.scrollHeight, deScrollW: de.scrollWidth,
    deClientH: de.clientHeight, deClientW: de.clientWidth,
    bodyScrollH: b.scrollHeight, bodyScrollW: b.scrollWidth,
    rootScrollTop: de.scrollTop, hasHScroll: de.scrollWidth > de.clientWidth + 1,
  };
})()`;

/**
 * 按**停靠分组**统计内部滚动容器。
 * 中栏用不了 `.ProseMirror` —— Tiptap 的滚动容器是它的祖先（`.nm-editor-scroll` 一族），
 * 直接数 `.ProseMirror` 子树恒为 0。锚到所在分组才是「该栏内部可滚」的正确口径。
 *
 * 分组定位用**结构性锚点**（锚点元素的 closest('.dv-groupview')），而不是标签文本：
 * m04040 之后中心组组头由 DocTabs 接管，该组只有**一条** `.dv-tab`，其文本是
 * 「当前章节名 + 人物设定 + 大纲 · 卷一」的**拼接串**，用 indexOf('章节正文') 永远匹配不到
 * ⇒ 旧口径会把「中心栏有 3 个可滚容器」误判成 found:false/count:0。
 * 锚点在组内找不到时回退到标签文本匹配（保底）。
 */
const scrollablesInGroup = (anchor, label) => `(function(){
  var g = null;
  var a = document.querySelector(${JSON.stringify(anchor)});
  if (a && a.closest) g = a.closest('.dv-groupview');
  if (!g && ${JSON.stringify(label || null)}) {
    var gs = document.querySelectorAll('.dv-groupview');
    for (var i = 0; i < gs.length && !g; i++) {
      var ts = gs[i].querySelectorAll('.dv-tab');
      for (var j = 0; j < ts.length; j++) {
        if ((ts[j].textContent || '').indexOf(${JSON.stringify(label || null)}) !== -1) { g = gs[i]; break; }
      }
    }
  }
  if (!g) return { found: false, count: 0, names: [] };
  var nodes = Array.prototype.slice.call(g.querySelectorAll('*')), names = [];
  for (var k = 0; k < nodes.length; k++) {
    var cs = getComputedStyle(nodes[k]);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && nodes[k].clientHeight > 40) {
      names.push(((nodes[k].className || '') + '').slice(0, 48) || nodes[k].tagName);
    }
  }
  var r = g.getBoundingClientRect();
  return { found: true, count: names.length, names: names.slice(0, 4),
           rect: { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } };
})()`;

const dvTabTexts = `Array.prototype.map.call(document.querySelectorAll(${q(S.dvTab)}), function(e){return e.textContent.trim();})`;

// ---------------- 网络监控 ----------------
const netLog = [];
function netRequests(filterFn) { return netLog.filter(filterFn); }

// ---------------- 主流程 ----------------
const created = { projectId: null };

async function login() {
  await send('Page.navigate', { url: `${BASE}/login` });
  await sleep(1800);
  await evalJs('try{localStorage.clear();sessionStorage.clear();}catch(e){}');

  const form = await waitFor(`(function(){
    var u = document.querySelector('input[type="text"], input[placeholder*="用户名"], input[name="username"]');
    var p = document.querySelector('input[type="password"]');
    return (u && p) ? 'ready' : '';
  })()`, '登录表单', TIMEOUT_MS);
  check('登录页表单可见', form === 'ready', String(form));

  await evalJs(`(function(){
    var u = document.querySelector('input[type="text"], input[placeholder*="用户名"], input[name="username"]');
    var p = document.querySelector('input[type="password"]');
    if (!u || !p) return 'no-el';
    var su = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    su.call(u, ${JSON.stringify(USER)}); u.dispatchEvent(new Event('input', { bubbles: true }));
    su.call(p, ${JSON.stringify(PASS)}); p.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await evalJs(`(function(){
    var b = Array.prototype.find.call(document.querySelectorAll('button'), function(x){ return (x.textContent||'').includes('登录'); });
    if (b) { b.click(); return 'clicked'; }
    return 'no-btn';
  })()`);

  const path = await waitFor(`location.pathname !== '/login' ? location.pathname : ''`, '登录跳转', TIMEOUT_MS);
  check('登录成功（离开 /login）', !!path, `path=${path}`);
  return !!path;
}

async function createProject(mode = 'manual') {
  const name = `集成自测-${STAMP}-${mode}`;
  const created2 = await evalJs(`fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: ${JSON.stringify(name)}, mode: ${JSON.stringify(mode)} })
  }).then(function(r){ return r.json().then(function(j){ return { status: r.status, id: j && j.data && j.data.id, mode: j && j.data && j.data.mode }; }); })
    .catch(function(e){ return { status: -1, error: String(e && e.message || e) }; })`);
  if (created2 && created2.id) created.projectId = created2.id;
  return created2;
}

async function gotoProject(id, hashExtra = '') {
  await send('Page.navigate', { url: `${BASE}/project/${id}${hashExtra}` });
  await sleep(2200);
  // 等停靠外壳或（auto 模式下的）工作台占位出现
  await waitFor(`!!document.querySelector('.shell-root') || !!document.querySelector(${q(S.workbenchMissing)})`, '项目壳挂载', TIMEOUT_MS);
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
}

async function pressCtrlJ() {
  const base = { modifiers: 2, windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74, code: 'KeyJ', key: 'j' };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(700);
}

const bottomOpen = `(function(){
  var a = document.querySelector(${q(S.bottomArea)});
  return a ? a.getAttribute('data-open') : null;
})()`;

const issueCountInStrip = `(function(){
  var e = document.querySelector(${q(S.bottomIssues)});
  if (!e) return null;
  var m = (e.textContent || '').match(/(\\d+)\\s*条问题/);
  return m ? Number(m[1]) : -1;
})()`;

const bridgeSnapshot = `(function(){
  var v = window.__novelmuseAnnotationBlocks;
  if (!v) return null;
  return { chapterId: v.chapterId || null, total: Number(v.total) || 0, open: Number(v.open) || 0 };
})()`;

// ---- 真实输入通道：先把**鼠标**落到编辑器里（建立 caret），再走 Input.insertText ----
// 只调 el.focus() 不足以让 ProseMirror 建 caret：浏览器焦点可能在宿主容器上，
// 此时 Input.insertText 落空（实测 innerText 仍为空）。这里用真实鼠标点击 + 校验 +
// 逐字符 key 事件兜底，三层保证「正文确实进了文档模型」。
async function typeIntoEditor(text) {
  const rect = await evalJs(`(function(){
    var el = document.querySelector(${q(PM)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x + Math.min(80, r.width / 2)), y: Math.round(r.y + 24) };
  })()`);
  if (!rect || typeof rect.x !== 'number') return 'no-editor';
  const mouse = { x: rect.x, y: rect.y, button: 'left', clickCount: 1, buttons: 1 };
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, mouse));
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, mouse));
  await sleep(180);
  await send('Input.insertText', { text });
  let ok = await waitFor(`(function(){
    var el = document.querySelector(${q(PM)});
    return el && ((el.innerText || '').indexOf(${JSON.stringify(text)}) !== -1);
  })()`, 'insertText 落字', 3000);
  if (ok) return 'insertText';
  // 兜底：逐字符真实 key 事件（每字符 char 事件带 text）
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
  await sleep(400);
  ok = await waitFor(`(function(){
    var el = document.querySelector(${q(PM)});
    return el && ((el.innerText || '').indexOf(${JSON.stringify(text)}) !== -1);
  })()`, 'keystrokes 落字', 4000);
  return ok ? 'keystrokes' : 'failed';
}

async function main() {
  // ---- 0) 前置条件 ----
  console.log(`CDP 端口 ${PORT} · 前端 ${BASE}`);
  let targets;
  try {
    targets = await getJson(`http://127.0.0.1:${PORT}/json`);
  } catch (e) {
    console.error(`✗ 无法连接 CDP（http://127.0.0.1:${PORT}/json）：${e && e.message}`);
    console.error('  请先启动带 --remote-debugging-port 的 Chromium，并确保前后端已运行。');
    process.exit(2);
  }
  const page = Array.isArray(targets) ? targets.find((t) => t.type === 'page') : null;
  if (!page) { console.error('✗ CDP 中没有 page 目标'); process.exit(2); }

  const consoleErrors = [];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Network.requestWillBeSent') {
      netLog.push({ kind: 'req', method: msg.params.request.method, url: msg.params.request.url, postData: msg.params.request.postData || '' });
    }
    if (msg.method === 'Network.responseReceived') {
      netLog.push({ kind: 'res', status: msg.params.response.status, mime: msg.params.response.mimeType, url: msg.params.response.url });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(`[exception] ${(d.exception && d.exception.description) || d.text || ''}`.slice(0, 200));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = (msg.params.args || []).map((a) => String(a.value ?? a.description ?? '')).join(' ');
      consoleErrors.push(`[console.error] ${text}`.slice(0, 200));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  // Runtime.enable 会把**连接前**页面已产生的 console 消息重放一遍（CDP 行为）。
  // 不清空的话，上一次运行/上一页面遗留的 `[ErrorSystem] API Error dispatched` 会被算进
  // 本次「控制台错误」断言（实测重放 5 条，清空后新导航 0 条）。这里丢弃重放缓冲。
  try { await send('Runtime.discardConsoleEntries'); } catch (_) { /* 老版本 CDP 无此命令 */ }
  await send('Network.enable');
  await setViewport(1280, 800);

  // ---- 1) 登录 ----
  section('1) 登录（真实 /api/auth）');
  if (!(await login())) { await finish(); return; }

  // ---- 2) 建真实项目（manual） ----
  section('2) 建项目（真实 POST /api/projects）');
  const proj = await createProject('manual');
  check('POST /api/projects 成功且返回真实 id', !!(proj && proj.id), JSON.stringify(proj));
  if (!proj || !proj.id) { await finish(); return; }
  check('新项目 mode=manual', proj.mode === 'manual', `mode=${proj.mode}`);

  // 关闭可能残留的面板状态，保证「首屏种子」是唯一的打开来源
  await gotoProject(proj.id);
  await evalJs(`try{localStorage.clear();sessionStorage.clear();}catch(e){}`);
  await gotoProject(proj.id);

  // ---- 3) 首屏三栏（契约④/⑤：左 240 / 中 / 右 340 同时在位） ----
  // 注意：此刻项目还是**空项目**（还没建章节），所以中栏是「编辑区」出口的空态，
  // 断言口径用**停靠分组**（.dv-groupview + 标签文本）而不是 .ProseMirror；
  // 编辑器真正挂载由下一节建章后单独断言。
  section('3) 首屏三栏布局（契约⑤）');
  const trioReady = await waitFor(
    `(${existsOf(S.leftPanel)} && ${existsOf(S.aiPanel)} && ${existsOf(S.dvTab)}) ? 'ready' : ''`,
    '三栏就位', TIMEOUT_MS,
  );
  check('首屏左「章节侧边栏」+ 中编辑区 + 右「AI 对话面板」同时在位', trioReady === 'ready', String(trioReady));

  const geo = await evalJs(`(function(){
    var rectOf = function(sel){ var e = document.querySelector(sel); if(!e) return null; var r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    var groupOf = function(label){
      var gs = document.querySelectorAll('.dv-groupview');
      for (var i=0;i<gs.length;i++){
        var tabs = gs[i].querySelectorAll('.dv-tab');
        for (var j=0;j<tabs.length;j++){
          if ((tabs[j].textContent || '').trim().indexOf(label) !== -1) {
            var r = gs[i].getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                     tab: (tabs[j].textContent || '').trim() };
          }
        }
      }
      return null;
    };
    return { left: rectOf(${q(S.leftPanel)}), right: rectOf(${q(S.aiPanel)}),
             leftGroup: groupOf('章节'), centerGroup: groupOf('章节正文'), rightGroup: groupOf('AI 对话'),
             groups: Array.prototype.map.call(document.querySelectorAll('.dv-groupview'), function(g){
               var r = g.getBoundingClientRect();
               return { x: Math.round(r.x), w: Math.round(r.width),
                        tabs: Array.prototype.map.call(g.querySelectorAll('.dv-tab'), function(t){ return (t.textContent||'').trim(); }) };
             }),
             iw: window.innerWidth, ih: window.innerHeight };
  })()`);
  console.log('  几何:', JSON.stringify(geo));
  check('左栏宽 ≈ 240px（截图口径）', !!(geo && geo.left && geo.left.w >= 180 && geo.left.w <= 300), geo && geo.left ? `w=${geo.left.w}` : 'no-left');
  check('右栏宽 ≈ 340px（截图口径）', !!(geo && geo.right && geo.right.w >= 280 && geo.right.w <= 400), geo && geo.right ? `w=${geo.right.w}` : 'no-right');
  // m04040 起，中栏分组头带里的文档标签按「章节正文」命名（t4 时叫「编辑区」），
  // 且左/中/右三栏的分组定位统一走 groupOf()。
  check('三栏左右分居（left.x < center.x < right.x）',
    !!(geo && geo.leftGroup && geo.centerGroup && geo.rightGroup
      && geo.leftGroup.x < geo.centerGroup.x && geo.centerGroup.x < geo.rightGroup.x),
    geo && geo.leftGroup && geo.centerGroup && geo.rightGroup
      ? `x=${geo.leftGroup.x}/${geo.centerGroup.x}/${geo.rightGroup.x}` : 'no-rect');
  check('三栏各占独立停靠分组（无叠放）',
    !!(geo && geo.groups && geo.groups.length === 3), geo ? JSON.stringify(geo.groups) : 'no');

  // E2E_DEBUG=1：直接 import 宿主 store 模块读「真值」（Vite dev 下与 app 同一模块实例）
  if (process.env.E2E_DEBUG) {
    const dbg = await evalJs(`(async function(){
      var out = {};
      try {
        var m = await import('/src/stores/panelOpenStore.ts');
        var st = m.usePanelOpenStore.getState();
        out.openStore = { keys: st.keys, active: st.active(), hasView: m.hasPanelView(), pending: m.pendingPanelOpens() };
      } catch (e) { out.openStore = { err: String((e && e.message) || e) }; }
      try {
        var r = await import('/src/plugin/registry.ts');
        var rs = r.usePluginRegistry.getState();
        out.builtin = rs.builtinPanels.map(function(p){ return { key: p.key, dock: p.dock || null, modes: p.modes || null }; });
        out.floating = rs.projectPanels.map(function(p){ return { key: p.key, dock: p.dock || null, modes: p.modes || null }; });
      } catch (e) { out.builtin = { err: String((e && e.message) || e) }; }
      out.dvTabs = Array.prototype.map.call(document.querySelectorAll('.dv-tab'), function(t){ return (t.textContent||'').trim(); });
      out.groups = Array.prototype.map.call(document.querySelectorAll('.dv-groupview'), function(g){ var rr = g.getBoundingClientRect(); return { x: Math.round(rr.x), w: Math.round(rr.width), tabs: Array.prototype.map.call(g.querySelectorAll('.dv-tab'), function(t){ return (t.textContent||'').trim(); }) }; });
      out.leftSel = !!document.querySelector('[aria-label="章节侧边栏"]');
      return out;
    })()`);
    console.log('  DEBUG:', JSON.stringify(dbg, null, 1));
  }

  // 顶栏面包屑 / 模式按钮（m04040 起为**反向断言**）/ 状态栏（契约①五处一致的第一处）
  const topbar = await evalJs(`(function(){
    return {
      root: ${textOf(S.breadcrumbRoot)},
      leaf: ${textOf(S.breadcrumbLeaf)},
      modeBtnCount: document.querySelectorAll(${q(S.modeBtn)}).length,
      modeSwitchCount: document.querySelectorAll(${q(S.modeSwitch)}).length,
      modeGroupCount: document.querySelectorAll(${q(S.modeGroup)}).length,
      topbarTextBtns: Array.prototype.map.call(document.querySelectorAll(${q(S.topbarTextBtn)}), function(b){ return (b.textContent||'').trim(); }),
      dividerCount: document.querySelectorAll(${q(S.topbarDivider)}).length,
      statusbar: ${textOf(S.statusbar)},
    };
  })()`);
  console.log('  顶栏/状态栏:', JSON.stringify(topbar));
  check('顶栏面包屑根节点显示真实项目名', !!(topbar && topbar.root && topbar.root.length > 0), topbar && topbar.root);
  // m04040：手写模式左上角不得再出现「AI 写作」模式切换按钮（三处选择器同时为 0）
  check('顶栏不再有「手写 / AI 写作」模式按钮（m04040 反向断言：.shell-mode-btn=0）',
    !!(topbar && topbar.modeBtnCount === 0), topbar && `modeBtnCount=${topbar.modeBtnCount}`);
  check('顶栏不再有模式切换容器（.shell-mode-switch=0 / [aria-label="创作模式"]=0）',
    !!(topbar && topbar.modeSwitchCount === 0 && topbar.modeGroupCount === 0),
    topbar && `switch=${topbar.modeSwitchCount} group=${topbar.modeGroupCount}`);
  check('顶栏文本按钮只剩「重写 / 夜间」（m04040 后的顶栏右端）',
    !!(topbar && topbar.topbarTextBtns && topbar.topbarTextBtns.length === 2
      && topbar.topbarTextBtns.indexOf('重写') !== -1 && /夜间|日间/.test(topbar.topbarTextBtns.join(','))),
    JSON.stringify(topbar && topbar.topbarTextBtns));
  check('状态栏显示「手写模式」（契约⑤：状态栏反映 project.mode）',
    !!(topbar && /手写模式/.test(topbar.statusbar)), String(topbar && topbar.statusbar).slice(0, 120));

  // ---- 4) 建第一章（真实用户路径）→ 五处状态一致 ----
  section('4) 建第一章 → 五处状态一致（契约①）');
  const empty = await waitFor(`document.querySelector(${q('input[placeholder*="章节标题"]')}) ? 'ready' : ''`, '建章节空态', TIMEOUT_MS);
  if (empty !== 'ready') {
    const why = await evalJs(`(function(){
      return { path: location.pathname, title: document.title,
               body: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
               inputs: Array.prototype.map.call(document.querySelectorAll('input,textarea'), function(i){ return (i.getAttribute('placeholder')||'') + '|' + (i.getAttribute('aria-label')||''); }).slice(0, 12),
               btns: Array.prototype.map.call(document.querySelectorAll('button'), function(b){ return (b.textContent||'').trim().slice(0,14); }).slice(0, 20) };
    })()`);
    console.log('  [诊断] 建章节空态未出现:', JSON.stringify(why));
  }
  check('空项目出现建章节输入框', empty === 'ready', String(empty));
  const chapterTitle = `集成自测章-${STAMP}`;
  await evalJs(setInputValue('input[placeholder*="章节标题"]', chapterTitle));
  const clickCreate = await evalJs(`(function(){
    var b = Array.prototype.find.call(document.querySelectorAll('button'), function(x){ return (x.textContent||'').includes('开始写作'); });
    if (!b) return 'no-btn';
    b.click();
    return 'clicked';
  })()`);
  check('点击「开始写作」建章节', clickCreate === 'clicked', String(clickCreate));

  const chapPath = await waitFor(`/^\\/project\\/[^/]+\\/[^/]+$/.test(location.pathname) ? location.pathname : ''`, '进入章节编辑器', TIMEOUT_MS);
  check('进入章节编辑器路由 /project/:bookId/:chapterId', !!chapPath, `path=${chapPath}`);
  const pmReady = await waitFor(existsOf(PM), 'ProseMirror 挂载', TIMEOUT_MS);
  check('中栏 Tiptap 编辑器挂载（.ProseMirror）', pmReady === true, `pm=${pmReady}`);
  const chapterId = chapPath ? String(chapPath).split('/').pop() : null;

  // 写入正文（真实输入通道）→ 字数/保存态应随之变化
  const bodyMarker = `集成正文-${STAMP}-甲乙丙丁戊己庚辛`;
  const typeHow = await typeIntoEditor(bodyMarker);
  await sleep(1500);
  check('正文通过真实输入通道写入中栏编辑器', typeHow === 'insertText' || typeHow === 'keystrokes', String(typeHow));

  const consistency = await evalJs(`(function(){
    var docText = (document.querySelector(${q(PM)}) || {}).innerText || '';
    var items = document.querySelectorAll(${q(S.leftPanel)} + ' .sidebar-chapter-item');
    // 「当前项」的判定用**两路信号**（LeftSidebar.tsx:78-86 的 isActive 分支）：
    //   ① 内联 style 里出现选中描边色 var(--paper-line-strong)（React 直接写进 style 属性）
    //   ② 计算后的 background 不是透明
    // 只信 ② 会漏判：hsl(var(--tone) / 0.07) 若变量在当前作用域未定义会被整条丢弃。
    var painted = Array.prototype.filter.call(items, function(el){
      var st = el.getAttribute('style') || '';
      var s = getComputedStyle(el);
      var bgPainted = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      return bgPainted || st.indexOf('paper-line-strong') !== -1;
    });
    return {
      breadcrumbLeaf: ${textOf(S.breadcrumbLeaf)},
      doctabActive: ${textOf('.shell-doctab.is-active .shell-doctab-label')},
      statusbar: ${textOf(S.statusbar)},
      treeHasChapter: ((document.querySelector(${q(S.leftPanel)}) || {}).textContent || '').includes(${JSON.stringify(chapterTitle)}),
      treeItems: items.length,
      treeActiveCount: painted.length,
      treeActiveText: painted.length ? (painted[0].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : '',
      treeActiveBg: painted.length ? getComputedStyle(painted[0]).backgroundColor : '',
      treeActiveStyle: painted.length ? (painted[0].getAttribute('style') || '').replace(/\\s+/g, ' ').slice(0, 90) : '',
      bodyHasMarker: docText.includes(${JSON.stringify(bodyMarker)}),
      editorText: docText.replace(/\\s+/g, ' ').trim().slice(0, 40),
    };
  })()`);
  console.log('  一致性:', JSON.stringify(consistency));
  check('面包屑章节名 = 真实章节标题（顶栏 ↔ 章节）',
    !!(consistency && consistency.breadcrumbLeaf && consistency.breadcrumbLeaf.includes(chapterTitle)),
    consistency && consistency.breadcrumbLeaf);
  check('文档标签激活项 = 真实章节标题（标签栏 ↔ 章节）',
    !!(consistency && consistency.doctabActive && consistency.doctabActive.includes(chapterTitle)),
    consistency && consistency.doctabActive);
  check('章节树出现该章节且高亮当前项（左栏 ↔ 当前章节）',
    !!(consistency && consistency.treeHasChapter && consistency.treeActiveCount === 1
      && consistency.treeActiveText.includes(chapterTitle)),
    consistency ? `items=${consistency.treeItems} active=${consistency.treeActiveCount} text=${consistency.treeActiveText}` : 'no');
  check('正文写入成功（中栏真实内容）', !!(consistency && consistency.bodyHasMarker), consistency && consistency.editorText);
  check('状态栏显示「手写模式」（状态栏 ↔ 项目 mode）',
    !!(consistency && /手写模式/.test(consistency.statusbar)),
    String(consistency && consistency.statusbar).slice(0, 120));
  // ★ 强化：状态栏「N 字」必须**等于服务端真值 project.currentWordCount**，
  //   不是「有个数字就算」。自动保存/汇总有延迟 ⇒ 轮询到收敛（最多 30s）。
  let wcOk = false;
  let wcEvidence = '未收敛（超时）';
  for (let i = 0; i < 20; i += 1) {
    const wc = await evalJs(`(async function(){
      try {
        var j = await (await fetch('/api/projects/${proj.id}', { credentials: 'include' })).json();
        var p = (j && j.data) ? j.data : j;
        var bar = document.querySelector(${q(S.statusbar)});
        return { server: (p && typeof p.currentWordCount === 'number') ? p.currentWordCount : null,
                 bar: bar ? (bar.textContent || '') : '' };
      } catch (e) { return { server: null, bar: '' }; }
    })()`);
    const n = wc && wc.server;
    if (typeof n === 'number') {
      const shown = n.toLocaleString('zh-CN');
      const bar = String(wc.bar).replace(/\\s+/g, ' ');
      if (bar.indexOf(shown + ' 字') !== -1 || bar.indexOf(shown + '字') !== -1) {
        wcOk = true;
        wcEvidence = `服务端 currentWordCount=${n}，状态栏含 "${shown} 字"`;
        break;
      }
      wcEvidence = `服务端=${n}，状态栏="${bar.slice(0, 80)}"`;
    }
    await sleep(1500);
  }
  check('状态栏字数 = 服务端 currentWordCount（五处一致：状态栏 ↔ 真实数据）', wcOk, wcEvidence);

  const metaLine = await evalJs(`(function(){
    var btn = document.querySelector(${q(S.insertBlock)});
    if (!btn) return null;
    var row = btn.parentElement;
    if (!row) return null;
    var t = (row.textContent || '').replace(/\\s+/g, ' ').trim();
    return { text: t.slice(0, 160), hasWordCount: /\\d+\\s*字/.test(t) };
  })()`);
  check('中栏元信息行渲染真实字数（元信息行 ↔ 正文/章节）', !!(metaLine && metaLine.hasWordCount),
    metaLine ? metaLine.text.slice(0, 120) : 'no');

  // ---- 5) 底部细条：N 条问题 = 真实批注块计数；Ctrl+J ----
  section('5) 底部细条 N 条问题 + Ctrl+J（契约②）');
  const strip0 = await evalJs(`(function(){
    return {
      area: ${existsOf(S.bottomArea)},
      open: ${bottomOpen},
      title: ${textOf('.dock-bottom-title')},
      issues: ${textOf(S.bottomIssues)},
      kbd: ${textOf('.dock-bottom-kbd')},
      n: ${issueCountInStrip},
      bridge: ${bridgeSnapshot},
      toggleExpanded: (function(){var b=document.querySelector(${q(S.bottomToggle)});return b?b.getAttribute('aria-expanded'):null;})(),
    };
  })()`);
  console.log('  细条初始:', JSON.stringify(strip0));
  check('底部细条存在且默认收起（data-open=false）', !!(strip0 && strip0.area && strip0.open === 'false'), JSON.stringify({ open: strip0 && strip0.open }));
  check('细条标题「底部面板」+ 快捷键提示「Ctrl+J」',
    !!(strip0 && strip0.title.includes('底部面板') && /Ctrl\+J/i.test(strip0.kbd)),
    `${strip0 && strip0.title} / ${strip0 && strip0.kbd}`);
  check('批注块桥已发布快照（window.__novelmuseAnnotationBlocks）',
    !!(strip0 && strip0.bridge && typeof strip0.bridge.open === 'number'), JSON.stringify(strip0 && strip0.bridge));
  check('细条 N 条问题 = 桥未解决数（不是写死）',
    !!(strip0 && strip0.bridge && strip0.n === strip0.bridge.open),
    `strip=${strip0 && strip0.n} bridge.open=${strip0 && strip0.bridge && strip0.bridge.open}`);

  // 打开底部面板 → 内容与 N 一致
  await evalJs(`(function(){ var b = document.querySelector(${q(S.bottomToggle)}); if (b) b.click(); return 'ok'; })()`);
  await sleep(500);
  const openState = await evalJs(`(function(){
    return { open: ${bottomOpen},
             body: ${existsOf(S.bottomBody)},
             blocks: ${textOf(S.bottomBlocks)},
             issuesText: ${textOf('.shell-bottom-issues, .shell-bottom-empty')} };
  })()`);
  console.log('  点击展开:', JSON.stringify(openState));
  check('点击细条可展开底部面板（aria 状态同步）', !!(openState && openState.open === 'true' && openState.body), JSON.stringify(openState && openState.open));
  check('展开区渲染批注块统计行（内容与 N 同源）', !!(openState && /内嵌批注块\s*\d+\s*条/.test(openState.blocks)), openState && openState.blocks);

  // 关闭（回到收起）→ 用真实 Ctrl+J 打开
  await evalJs(`(function(){ var b = document.querySelector(${q(S.bottomToggle)}); if (b) b.click(); return 'ok'; })()`);
  await sleep(400);
  check('再次点击可收起', (await evalJs(bottomOpen)) === 'false', String(await evalJs(bottomOpen)));

  await evalJs(`(function(){ if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return 'ok'; })()`);
  await pressCtrlJ();
  const afterCtrlJ1 = await evalJs(`(function(){ return { open: ${bottomOpen}, blocks: ${textOf(S.bottomBlocks)} }; })()`);
  check('Ctrl+J 展开底部面板（真实键盘事件）', afterCtrlJ1 && afterCtrlJ1.open === 'true', JSON.stringify(afterCtrlJ1 && afterCtrlJ1.open));
  const contentFirst = afterCtrlJ1 ? afterCtrlJ1.blocks : '';

  await pressCtrlJ();
  const afterCtrlJ2 = await evalJs(bottomOpen);
  check('Ctrl+J 再次按下收起底部面板', afterCtrlJ2 === 'false', String(afterCtrlJ2));

  await pressCtrlJ();
  const afterCtrlJ3 = await evalJs(`(function(){ return { open: ${bottomOpen}, blocks: ${textOf(S.bottomBlocks)}, n: ${issueCountInStrip} }; })()`);
  check('Ctrl+J 第三次展开且内容不丢（与首次一致）',
    !!(afterCtrlJ3 && afterCtrlJ3.open === 'true' && afterCtrlJ3.blocks === contentFirst && contentFirst !== ''),
    `first="${contentFirst}" again="${afterCtrlJ3 && afterCtrlJ3.blocks}"`);

  // 插入真实批注块 → N 必须跟着涨（证明 N 由真实计数驱动）
  const beforeInsert = await evalJs(`(function(){ return { n: ${issueCountInStrip}, bridge: ${bridgeSnapshot} }; })()`);
  const canInsert = await evalJs(existsOf(S.insertBlock));
  check('中栏存在「插入批注块」按钮', canInsert === true, String(canInsert));
  if (canInsert) {
    await evalJs(`(function(){ var b = document.querySelector(${q(S.insertBlock)}); if (b) b.click(); return 'ok'; })()`);
    await sleep(900);
    await evalJs(`(function(){ var b = document.querySelector(${q(S.insertBlock)}); if (b) b.click(); return 'ok'; })()`);
    await sleep(1600);
  }
  const afterInsert = await evalJs(`(function(){ return { n: ${issueCountInStrip}, bridge: ${bridgeSnapshot}, blocks: ${textOf(S.bottomBlocks)} }; })()`);
  console.log('  插入批注块:', JSON.stringify({ before: beforeInsert, after: afterInsert }));
  const gained = !!(afterInsert && beforeInsert && afterInsert.bridge && beforeInsert.bridge
    && afterInsert.bridge.open === beforeInsert.bridge.open + 2);
  check('插入 2 个批注块 → 桥 open 计数 +2（真实编辑器内容驱动）', gained,
    `open ${beforeInsert && beforeInsert.bridge && beforeInsert.bridge.open} → ${afterInsert && afterInsert.bridge && afterInsert.bridge.open}`);
  check('细条 N 同步跟随（N = 桥 open，非写死）',
    !!(afterInsert && afterInsert.bridge && afterInsert.n === afterInsert.bridge.open && afterInsert.n === (beforeInsert.bridge.open + 2)),
    `strip=${afterInsert && afterInsert.n}`);
  check('展开区统计行与桥 total/open 一致',
    !!(afterInsert && /内嵌批注块\s*\d+\s*条\s*·\s*未解决\s*\d+\s*条/.test(afterInsert.blocks)
      && afterInsert.blocks.includes(`${afterInsert.bridge.total} 条`)
      && afterInsert.blocks.includes(`${afterInsert.bridge.open} 条`)),
    afterInsert && afterInsert.blocks);

  // 收起底部，避免影响后续几何断言
  await pressCtrlJ();
  await evalJs(`(function(){ var a=document.querySelector(${q(S.bottomArea)}); if(a && a.getAttribute('data-open')==='true'){ var b=document.querySelector(${q(S.bottomToggle)}); if(b) b.click(); } return 'ok'; })()`);
  await sleep(300);

  // ---- 6) 文档标签栏 → 真实 characters / outline 面板（契约③） ----
  section('6) 文档标签栏 → characters / outline 真面板（契约③）');
  const tabs0 = await evalJs(`(function(){
    return {
      list: ${existsOf(S.doctabsList)},
      labels: Array.prototype.map.call(document.querySelectorAll(${q(S.doctab)}), function(t){ var m = t.querySelector(${q(S.doctabMain)}); return m ? m.textContent.trim() : t.textContent.trim(); }),
      add: ${existsOf('.shell-doctab-add')},
      dvTabs: ${dvTabTexts},
    };
  })()`);
  console.log('  文档标签:', JSON.stringify(tabs0));
  check('文档标签栏渲染（当前章节名 / 人物设定 / 大纲 · 卷一 三项）',
    !!(tabs0 && tabs0.labels && tabs0.labels.length >= 3
      && tabs0.labels[0] === chapterTitle
      && tabs0.labels.some((l) => l.includes('人物设定'))
      && tabs0.labels.some((l) => l.includes('大纲'))),
    JSON.stringify(tabs0 && tabs0.labels));
  check('标签栏带「+」新建入口', !!(tabs0 && tabs0.add), String(tabs0 && tabs0.add));

  await evalJs(`(function(){
    var t = Array.prototype.find.call(document.querySelectorAll(${q(S.doctab)}), function(x){ return x.textContent.includes('人物设定'); });
    if (!t) return 'no-tab';
    var m = t.querySelector(${q(S.doctabMain)}) || t;
    m.click();
    return 'clicked';
  })()`);
  const charTab = await waitFor(`${dvTabTexts}.some(function(t){return t.includes('角色');}) ? 'ready' : ''`, 'characters 面板', TIMEOUT_MS);
  check('点「人物设定」→ 打开真实 characters 面板（.dv-tab=角色）', charTab === 'ready',
    JSON.stringify(await evalJs(dvTabTexts)));

  await evalJs(`(function(){
    var t = Array.prototype.find.call(document.querySelectorAll(${q(S.doctab)}), function(x){ return x.textContent.includes('大纲'); });
    if (!t) return 'no-tab';
    var m = t.querySelector(${q(S.doctabMain)}) || t;
    m.click();
    return 'clicked';
  })()`);
  const outlineTab = await waitFor(`${dvTabTexts}.some(function(t){return t.includes('大纲');}) ? 'ready' : ''`, 'outline 面板', TIMEOUT_MS);
  const dvTabsNow = await evalJs(dvTabTexts);
  console.log('  dockview 标签:', JSON.stringify(dvTabsNow));
  check('点「大纲 · 卷一」→ 打开真实 outline 面板（.dv-tab=大纲）', outlineTab === 'ready', JSON.stringify(dvTabsNow));

  // m04040 后：中心组组头由 DocTabs 接管，打开/关闭侧栏面板会触发 dockview relayout，
  // 其间中心面板会**短暂 unmount**（.ProseMirror 消失几十~几百 ms）。这里先等几何稳定，
  // 再断言「三栏共存」，否则会把瞬态误判成「中栏被顶掉」。
  await waitFor(`(function(){
    var pm = document.querySelector(${q(PM)});
    if (!pm) return '';
    var a = document.querySelector(${q(S.leftPanel)}), b = document.querySelector(${q(S.aiPanel)});
    if (!a || !b) return '';
    var r = pm.getBoundingClientRect();
    return (r.width > 100 && r.height > 100) ? 'ready' : '';
  })()`, '三栏几何稳定', TIMEOUT_MS);
  await sleep(400);

  const coexist = await evalJs(`(function(){
    return {
      left: ${existsOf(S.leftPanel)}, center: ${existsOf(PM)}, right: ${existsOf(S.aiPanel)},
      tabs: ${dvTabTexts},
      global: ${viewportExpr},
    };
  })()`);
  const coexistTabs = ((coexist && coexist.tabs) || []).filter((t) => t && t.length);
  check('新面板与三栏共存（左/中/右仍在，不遮挡）',
    !!(coexist && coexist.left && coexist.center && coexist.right && coexistTabs.length >= 5),
    `left=${coexist && coexist.left} center=${coexist && coexist.center} right=${coexist && coexist.right} tabs=${JSON.stringify(coexist && coexist.tabs)}`);
  check('打开新面板未产生全局滚动条', !!(coexist && coexist.global && coexist.global.deScrollH <= coexist.global.ih + 1),
    coexist ? JSON.stringify(coexist.global) : 'no');

  // 关掉这两个面板（验证可关闭 + 不破坏布局）
  await evalJs(`(function(){
    var t = Array.prototype.find.call(document.querySelectorAll(${q(S.doctab)}), function(x){ return x.textContent.includes('人物设定'); });
    if (!t) return 'no-tab';
    var c = t.querySelector(${q(S.doctabClose)}) || t.querySelector('button[aria-label^="关闭"]');
    if (c) { c.click(); return 'closed'; }
    return 'no-close';
  })()`);
  await sleep(800);
  const afterClose = await evalJs(`(function(){ return { tabs: ${dvTabTexts}, global: ${viewportExpr} }; })()`);
  check('「人物设定」标签可关闭，面板退场且布局不破',
    !!(afterClose && !afterClose.tabs.includes('角色') && afterClose.global.deScrollW <= afterClose.global.iw + 1),
    JSON.stringify(afterClose && afterClose.tabs));

  // ---- 7) 视口契约：1280×800 / 1920×1080（契约⑤） ----
  section('7) 视口契约 1280×800 与 1920×1080（契约⑤）');
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    await setViewport(w, h);
    const vp = await evalJs(viewportExpr);
    const panels = await evalJs(`(function(){
      return {
        left: ${scrollablesInGroup(S.leftPanel, '章节')},
        center: ${scrollablesInGroup(PM, null)},
        right: ${scrollablesInGroup(S.aiPanel, 'AI 对话')},
        bottomOpen: ${bottomOpen},
        rightEdge: (function(){ var e = document.querySelector(${q(S.aiPanel)}); if(!e) return null; return Math.round(e.getBoundingClientRect().right); })(),
      };
    })()`);
    console.log(`  ${w}×${h}:`, JSON.stringify(vp));
    check(`${w}×${h} 无纵向全局滚动条（documentElement.scrollHeight ≤ innerHeight+1）`,
      vp.deScrollH <= vp.ih + 1, `scrollH=${vp.deScrollH} innerH=${vp.ih}`);
    check(`${w}×${h} 无横向全局滚动条（documentElement.scrollWidth ≤ innerWidth+1）`,
      vp.deScrollW <= vp.iw + 1, `scrollW=${vp.deScrollW} innerW=${vp.iw}`);
    check(`${w}×${h} html 未被滚动（scrollTop=0）`, vp.rootScrollTop === 0, `scrollTop=${vp.rootScrollTop}`);
    check(`${w}×${h} 布局未超出视口（右栏右边缘 ≤ 视口宽）`,
      !!(panels && panels.rightEdge !== null && panels.rightEdge <= w + 1), panels ? `rightEdge=${panels.rightEdge}` : 'no');
    check(`${w}×${h} 三个面板各自具备内部滚动容器`,
      !!(panels && panels.left.count > 0 && panels.center.count > 0 && panels.right.count > 0),
      JSON.stringify({ left: panels && panels.left.count, center: panels && panels.center.count, right: panels && panels.right.count }));
  }
  await setViewport(1280, 800);

  // ---- 8) 运行契约：HOST_MODE=all（两套插件同时在场） ----
  section('8) 运行契约：HOST_MODE=all（手写台 + AI 写作台两套插件同时在场）');
  // 契约④ 的运行前提：本步只断言服务端 /api/health 里的插件在场性（不涉及面板归属）。
  // 注：ai-chat 面板自 2026-10「手写/自动隔离改造」起由 **manual 插件目录**
  // （novel.manual.workbench）注册，auto 入口不再注册任何槽。
  // 真源 = 服务端 /api/health（apps/server/src/plugin/host.ts:698）。
  const host = await evalJs(`(async function(){
    try {
      var j = await (await fetch('/api/health', { credentials: 'include' })).json();
      var h = (j && j.data) ? j.data : j;
      var pl = Array.isArray(h && h.plugins) ? h.plugins.map(function(x){
        return { id: (x && x.id) || '', status: (x && x.status) || '', modes: (x && x.modes) || [] };
      }) : [];
      return { status: h && h.status, database: h && h.database, hostMode: h && h.hostMode, plugins: pl };
    } catch (e) { return { status: null, hostMode: null, plugins: [], error: String(e && e.message || e) }; }
  })()`);
  const hostIds = ((host && host.plugins) || []).map((p) => p.id).join(',');
  console.log('  运行契约:', JSON.stringify({ hostMode: host && host.hostMode, status: host && host.status, pluginCount: (host && host.plugins || []).length }).slice(0, 200));
  check('服务端 HOST_MODE=all（apps/server/src/plugin/host.ts:705）', !!(host && host.hostMode === 'all'), JSON.stringify(host && { hostMode: host.hostMode, status: host.status, database: host.database }));
  check('手写台插件在场（novel.manual.workbench）', hostIds.indexOf('novel.manual.workbench') !== -1, hostIds.slice(0, 240));
  check('AI 写作台插件同时在场（novel.auto.workbench）——契约④ 的运行契约', hostIds.indexOf('novel.auto.workbench') !== -1, hostIds.slice(0, 240));

  // ---- 9) 模式由「开书时定下」的 project.mode 驱动（m04040 后：界面不再给切换入口） ----
  section('9) 手写 ↔ AI 写作：project.mode 驱动界面（m04040 后无顶栏入口，改用真实 API 切换）');
  const reqBefore = netLog.length;
  // m04040 起顶栏不再有「AI 写作」按钮：入口改为真实 PUT /api/projects/:id { mode }
  // （后端 apps/server/src/modules/projects.ts 的 PUT 仍然有效，只是界面不再暴露）。
  const clickAuto = await evalJs(`(function(){
    if (document.querySelector(${q(S.modeBtn)})) return 'unexpected-mode-btn';
    return fetch('/api/projects/${proj.id}', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ mode: 'auto' })
    }).then(function(r){ return r.json().then(function(j){ return (j && j.data && j.data.mode === 'auto') ? 'clicked' : 'bad-body'; }); })
      .catch(function(e){ return 'err:' + String((e && e.message) || e); });
  })()`);
  check('顶栏无「AI 写作」按钮 + PUT mode=auto 成功（m04040 后的切换路径）',
    clickAuto === 'clicked', String(clickAuto));
  await sleep(2000);

  const putReq = netRequests((r) => r.kind === 'req' && r.method === 'PUT' && /\/api\/projects\//.test(r.url));
  check('捕获到真实 PUT /api/projects/:id（网络层证据）', putReq.length > 0,
    JSON.stringify(putReq.slice(-1).map((r) => ({ method: r.method, url: r.url, postData: r.postData }))));
  check('PUT 请求体写入 mode="auto"', putReq.some((r) => /"mode"\s*:\s*"auto"/.test(r.postData || '')),
    JSON.stringify(putReq.slice(-1).map((r) => r.postData)));
  const putRes = netRequests((r) => r.kind === 'res' && /\/api\/projects\//.test(r.url));
  console.log('  项目请求数:', netLog.length - reqBefore, '响应:', JSON.stringify(putRes.slice(-2)));

  const serverMode = await evalJs(`fetch('/api/projects/${proj.id}', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(j){ return { status: 200, mode: j && j.data && j.data.mode, name: j && j.data && j.data.name }; })
    .catch(function(e){ return { status: -1, error: String(e && e.message || e) }; })`);
  check('服务端 GET /api/projects/:id 返回 mode=auto（真实落库）', !!(serverMode && serverMode.mode === 'auto'), JSON.stringify(serverMode));

  // m04040 后 mode 由 API 写回 ⇒ 重新进入项目路由让界面按新 mode 渲染
  await gotoProject(proj.id);
  const autoUi = await evalJs(`(function(){
    return {
      missing: ${existsOf(S.workbenchMissing)},
      missingText: ${textOf(S.workbenchMissing)},
      activityBar: ${existsOf(S.activityBar)},
      leftPanel: ${existsOf(S.leftPanel)},
      aiPanel: ${existsOf(S.aiPanel)},
      statusbar: ${existsOf(S.statusbar)},
      statusbarText: ${textOf(S.statusbar)},
      global: ${viewportExpr},
    };
  })()`);
  console.log('  auto 模式 UI:', JSON.stringify(autoUi));
  check('切到 AI 写作后面板集合真实变化（手写停靠外壳与手写面板退场）',
    !!(autoUi && !autoUi.leftPanel && !autoUi.aiPanel && !autoUi.activityBar),
    JSON.stringify({ left: autoUi && autoUi.leftPanel, ai: autoUi && autoUi.aiPanel, activity: autoUi && autoUi.activityBar }));
  check('auto 模式渲染工作台占位（AI 写作台未安装 / 工作台未安装）',
    !!(autoUi && autoUi.missing), autoUi && autoUi.missingText);
  check('auto 模式无全局滚动条', !!(autoUi && autoUi.global.deScrollH <= autoUi.global.ih + 1), JSON.stringify(autoUi && autoUi.global));

  // m04040 ②：进入子界面（这里是最深的一层：auto 分支的占位屏）必须有小返回键
  const autoBack = await evalJs(`(function(){
    var b = document.querySelector(${q(S.workbenchBack)});
    if (!b) return { found: false };
    var r = b.getBoundingClientRect();
    return { found: true, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
             title: b.getAttribute('title'), aria: b.getAttribute('aria-label'), cls: b.className };
  })()`);
  console.log('  auto 占位小返回键:', JSON.stringify(autoBack));
  check('auto 占位屏有小返回键（m04040 ②：button[aria-label="返回书架"]）',
    !!(autoBack && autoBack.found && autoBack.aria === '返回书架'), JSON.stringify(autoBack));
  const autoBackClick = await evalJs(`(async function(){
    var b = document.querySelector(${q(S.workbenchBack)});
    if (!b) return 'no-btn';
    b.click();
    await new Promise(function(r){ setTimeout(r, 2500); });
    return location.pathname;
  })()`);
  console.log('  点小返回键后 path:', autoBackClick);
  check('auto 占位屏小返回键真的能出去（回到 /bookshelf）', autoBackClick === '/bookshelf', String(autoBackClick));

  // 反向：写回 manual（同一条 API），验证 manual 侧状态栏与三栏回归
  console.log('  ↺ 写回 manual（PUT 同一 API）并回到手写台');
  const back = await evalJs(`fetch('/api/projects/${proj.id}', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ mode: 'manual' })
  }).then(function(r){ return r.json().then(function(j){ return { status: r.status, mode: j && j.data && j.data.mode }; }); })
    .catch(function(e){ return { status: -1, error: String(e && e.message || e) }; })`);
  check('PUT mode=manual 成功（同一 API 反向写回）', !!(back && back.status === 200 && back.mode === 'manual'), JSON.stringify(back));

  await gotoProject(proj.id);
  const restored = await waitFor(`(${existsOf(S.leftPanel)} && ${existsOf(S.aiPanel)} && ${existsOf(S.dvTab)}) ? 'ready' : ''`, '手写三栏回归', TIMEOUT_MS);
  const restoredTop = await evalJs(`(function(){
    return { statusbar: ${textOf(S.statusbar)},
             modeBtnCount: document.querySelectorAll(${q(S.modeBtn)}).length };
  })()`);
  check('状态栏在手写模式下显示「手写模式」（mode 真值驱动）',
    !!(restoredTop && /手写模式/.test(restoredTop.statusbar) && restoredTop.modeBtnCount === 0),
    JSON.stringify(restoredTop));
  check('手写三栏在 reload 后回归（受控种子 + 左右面板）', restored === 'ready', String(restored));

  // 再进章节路由：中栏编辑器与正文应从服务端恢复（内容不丢）
  await send('Page.navigate', { url: `${BASE}/project/${proj.id}/${chapterId}` });
  await sleep(2600);
  const bodyBack = await waitFor(`(function(){
    var el = document.querySelector(${q(PM)});
    return el && (el.innerText || '').indexOf(${JSON.stringify(bodyMarker)}) !== -1;
  })()`, '正文从服务端恢复', TIMEOUT_MS);
  check('reload 后正文从服务端恢复（Ctrl+J/面板开关不丢内容，落库可复现）', bodyBack === true, String(bodyBack));

  // ---- 9) 右栏 AI 对话面板：真实 SSE（契约④） ----
  section('10) 右栏 AI 对话面板 ↔ 真实后端 SSE（契约④）');
  const probeExpr = `(async function(){
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, 15000);
    try {
      var res = await fetch('/api/ai/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-Id': ${JSON.stringify(proj.id)} },
        credentials: 'include',
        signal: ctrl.signal,
        body: JSON.stringify({ userMessage: '用一个词评价这一章的节奏。', phase: '小说对话' })
      });
      var ct = res.headers.get('content-type') || '';
      var text = await res.text();
      clearTimeout(timer);
      var frames = text.split(/\\r?\\n/)
        .filter(function(l){ return l.indexOf('data: ') === 0; })
        .map(function(l){ try { return JSON.parse(l.slice(6)); } catch (e) { return null; } })
        .filter(Boolean);
      var kinds = {}; frames.forEach(function(f){ Object.keys(f).forEach(function(k){ kinds[k] = (kinds[k] || 0) + 1; }); });
      var chunks = frames.filter(function(f){ return typeof f.chunk === 'string'; }).map(function(f){ return f.chunk; }).join('');
      var errs = frames.filter(function(f){ return f.error; }).map(function(f){ return String(f.error); });
      return {
        status: res.status, ct: ct, frameCount: frames.length, kinds: kinds,
        agent: (frames.length && frames[0].agent) ? frames[0].agent : null,
        chunkLen: chunks.length, chunkHead: chunks.slice(0, 160),
        error: errs.join(' | ').slice(0, 200)
      };
    } catch (e) {
      clearTimeout(timer);
      return { status: -1, ct: '', frameCount: 0, kinds: {}, agent: null, chunkLen: 0, chunkHead: '', error: 'probe failed: ' + String(e && e.message || e) };
    }
  })()`;
  // aiRateLimit = rateLimit({ maxRequests: 20, windowMs: 60_000, keyBy: 'user' })
  //   （apps/server/src/modules/ai.ts:299）—— 同一分钟内反复运行本脚本会撞 429。
  //   这是**环境限流**而非产品缺陷，故退避重试并在结果里打印重试次数。
  //   另外实测：连跑两次时第二次偶发 `Failed to fetch`（dev 服务/proxy 瞬时抖动），
  //   同样属于环境噪声 ⇒ 一并短暂退避重试；4xx/5xx 之外的状态（如 500）不重试，
  //   直接作为真实失败证据留下。
  let probe = null;
  let probeRetries = 0;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    probe = await evalJs(probeExpr);
    if (probe && probe.status === 200) break;
    const transient = !probe || probe.status === -1;
    const limited = probe && probe.status === 429;
    if (!transient && !limited) break;
    probeRetries = attempt;
    const waitMs = limited ? 25000 : 5000;
    console.log(
      `  [退避] /api/ai/chat-stream ${limited ? '429（aiRateLimit 每分钟 20 次）' : `传输抖动（status=${probe && probe.status}）`}` +
        ` 第 ${attempt} 次命中，等 ${Math.round(waitMs / 1000)}s 后重试…`,
    );
    await sleep(waitMs);
  }
  console.log('  SSE 探针:', JSON.stringify(probe), probeRetries ? `（退避重试 ${probeRetries} 次）` : '');
  check('POST /api/ai/chat-stream 返回 200', !!(probe && probe.status === 200), probe && `status=${probe.status}`);
  check('响应 content-type 是 text/event-stream（真实 SSE）', !!(probe && /text\/event-stream/.test(probe.ct)), probe && probe.ct);
  check('收到 SSE 帧（含首帧身份帧 {agent}）',
    !!(probe && probe.frameCount > 0 && probe.agent && probe.agent.id), JSON.stringify(probe && { frames: probe.frameCount, agent: probe.agent }));
  const branch = probe && probe.chunkLen > 0
    ? (/关于这个抉择场景/.test(probe.chunkHead) ? 'mock（模拟分支：/ai.ts 对 __mock__ 前缀）' : 'real（真实分支：模型产出）')
    : (probe && probe.error ? 'real（真实分支：SSE 已建立，模型调用报错 —— 本机 provider 未配置）' : 'unknown');
  console.log(`  分支判定: ${branch}`);
  check('SSE 建立后至少收到 thinking / chunk / error / done 之一',
    !!(probe && probe.kinds && Object.keys(probe.kinds).length > 0), JSON.stringify(probe && probe.kinds));

  // 面板 UI 路径：填输入框 → 点发送 → 断言真实 POST + 助手回合渲染
  const uiText = `E2E面板探针-${STAMP}`;
  const logBefore = await evalJs(textOf(S.aiLog));
  await evalJs(setInputValue(S.aiInput, uiText));
  const sent = await evalJs(`(function(){ var b = document.querySelector(${q(S.aiSend)}); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()`);
  check('AI 面板发送按钮可用（手写模式下）', sent === 'clicked', String(sent));
  const userEchoed = await waitFor(`(${textOf(S.aiLog)}).includes(${JSON.stringify(uiText)}) ? 'ready' : ''`, '用户消息上屏', TIMEOUT_MS);
  check('发送后用户消息出现在对话区（面板在手动模式下真实可用）', userEchoed === 'ready', String(userEchoed));
  const assistantTurn = await waitFor(`(function(){
    var log = document.querySelector(${q(S.aiLog)});
    if (!log) return '';
    var t = (log.textContent || '').split(${JSON.stringify(uiText)}).join('').trim();
    return t.length > 0 ? t.slice(0, 120) : '';
  })()`, '助手回合渲染', 25000);
  check('助手回合渲染（流式正文或可见错误态）', !!assistantTurn, String(assistantTurn).slice(0, 140));
  const panelPost = netRequests((r) => r.kind === 'req' && r.method === 'POST' && /\/ai\/chat-stream/.test(r.url));
  check('面板发出真实 POST /api/ai/chat-stream（网络层证据）', panelPost.length > 0,
    JSON.stringify(panelPost.slice(-1).map((r) => r.url)));

  // ---- 10) 控制台错误 ----
  section('11) 控制台错误');
  const noisy = consoleErrors.filter((e) => !/favicon|Download the React DevTools|ResizeObserver loop/i.test(e));
  console.log('  错误条数:', noisy.length);
  if (noisy.length) noisy.slice(0, 6).forEach((e) => console.log(`    · ${e}`));
  check('无 React 崩溃 / 无限重渲染（Maximum update depth exceeded）',
    !noisy.some((e) => /Maximum update depth exceeded/.test(e)), '');
  check('控制台错误在可接受范围（≤ 3 条非噪声）', noisy.length <= 3, `count=${noisy.length}`);

  await finish();
}

async function finish() {
  // 自清理：删掉本次创建的测试项目（服务端级联删除章节），不留脏数据
  if (created.projectId) {
    const del = await evalJs(`fetch('/api/projects/${created.projectId}', { method: 'DELETE', credentials: 'include' })
      .then(function(r){ return r.status; })
      .catch(function(){ return -1; })`).catch(() => -1);
    console.log(`\n自清理：DELETE /api/projects/${created.projectId} → ${del}`);
  }

  console.log('===== 结果汇总 =====');
  const passed = results.length - failed;
  console.log(`通过 ${passed}/${results.length}，失败 ${failed}`);
  if (failed) {
    console.log('失败项：');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.label}  [${r.detail}]`));
  }
  console.log('\n提示：本脚本覆盖 t4 五条跨区契约；若失败项集中在某契约，看上方对应小节的第一条红项即可定位。');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('✗ 脚本异常：', e && e.stack || e);
  try { process.exit(1); } catch (_) { /* noop */ }
});
