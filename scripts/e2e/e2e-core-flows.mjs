// ============================================================
// CDP 端到端：NovelMuse 核心业务闭环（浏览器级真渲染 + 真持久化）
//
// 覆盖 7 项核心闭环：
//   1. 登录 → 进入书架
//   2. manual 项目 → 打开 → 手写台停靠外壳标记出现（[aria-label="面板菜单"] + [aria-label="活动栏"]）
//   3. auto   项目 → 打开 → AutoWriteWorkbench 标记出现
//   4. 项目内 创建章节 → 写入正文 → 保存 → **刷新页面 → 正文仍在**（真持久化）
//   5. 角色/知识库面板可打开并渲染数据（面板渲染 + 无 console error）
//   6. console 错误清零断言（consoleAPICalled type=error + exceptionThrown 都收集）
//   7. 自清理：脚本创建的测试项目/章节全部删除，不留脏数据
//
// ★ 为什么必须浏览器级验证：
//   单测只证明纯函数（如 filterByProjectMode 的过滤逻辑），证明不了
//   「路由真的注册了」「工作台真的渲染出来了」「正文真的落到了后端」。
//   本项目已实测发生过两个只有真端到端才能暴露的缺陷（都曾被 404 / 静默掩盖）：
//     · apps/web/src/plugin/moduleEntries.ts 的 import.meta.glob 路径多一层 `apps/`
//       → glob 展开为空 → ChapterEditor 路由**永不注册** → 章节页 404
//       （pnpm build 不报错、门禁抓不到、182 个单测也抓不到）
//     · apps/plugins/manual/workbench/web/editor/hooks/useEditorInstance.ts 的
//       pluginEditorExtensions 每次渲染返回新数组 → useEditor 的 deps 每轮都"变了"
//       → destroy/create/setEditor 无限循环 → "Maximum update depth exceeded" 白屏
//   本脚本的第 4 项（章节正文往返）正是钉死这两个缺陷的回归断言。
//
// 前置条件：
//   1. dev server 在跑（默认 http://localhost:5174，vite，/api 代理到后端）
//   2. 后端 server 在跑（默认 http://localhost:3774，其 /api/health 报 status=ok）
//   3. 一个开了 remote-debugging 的浏览器（默认 127.0.0.1:9222）
//   4. 可用账号：默认 admin / Admin1234!（可用 E2E_USER / E2E_PASS 覆盖）
//
// 用法：
//   node scripts/e2e/e2e-core-flows.mjs
// 环境变量覆盖（便于故障注入复核）：
//   E2E_CDP_PORT(9222) E2E_BASE(http://localhost:5174) E2E_API_BASE(http://localhost:3774)
//   E2E_USER(admin) E2E_PASS(Admin1234!) E2E_TIMEOUT_MS(20000)
// 退出码：0 = 全过；1 = 有断言失败；2 = 环境不可用（CDP / server 不可达）
//
// ★ 幂等：每次跑都用独立时间戳命名测试项目，跑完自删（含章节）；重复跑互不影响。
// ★ 清理：即使中途失败也会在 finally 里尽力清理（不留脏数据）。
// ============================================================

import WebSocket from 'ws';
import http from 'http';

const PORT = Number(process.env.E2E_CDP_PORT) || 9222;
const BASE = process.env.E2E_BASE || 'http://localhost:5174';
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3774';
const USER = process.env.E2E_USER || 'admin';
const PASS = process.env.E2E_PASS || 'Admin1234!';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS) || 20000;

// ---- DOM 标记（与源码一一对应，均已确认全局唯一）----
// 手写台（★ t2 修正 F2）：气泡体系（「功能转轮」+ 卫星气泡）已按 ADR §0.3 / D15 整体退役，
//   取代形态是**活动栏 / 侧边栏 / 面板菜单**三入口。旧选择器
//   `[aria-label="功能转轮"]` / `[aria-label="打开角色面板"]` 已不存在于源码 ⇒ 断言恒假。
//   现改为新外壳的**常驻**标记（两处均经 grep 确认全仓唯一，且只在 manual 分支渲染）：
//     · 面板菜单 `apps/web/src/components/shell/PanelMenu.tsx:90`（顶栏右侧下拉入口）
//     · 活动栏   `apps/web/src/components/shell/DockShell.tsx:202`（最左窄条）
//   为何用这两个而非某个具体面板：它们由 DockShell/PanelMenu **外壳骨架**常驻渲染，
//   不依赖任何面板被打开；「角色」等面板本体需先经入口打开才存在，不适合当挂载标记。
const MANUAL_MARKERS = { '面板菜单': '[aria-label="面板菜单"]', '活动栏': '[aria-label="活动栏"]' };
// AI 写作：AutoWriteWorkbench（aria-label="状态栏"/"智能体对话"/"编辑器标签"）
// ★ 用「编辑器标签」而非「看板」：看板是标签切换面板（默认显示正文时不存在），
//   而 unified 标签栏的 aria-label="编辑器标签" 是 auto 独有且**常驻**（全仓仅一处 variant='unified'）。
// ★ t10（AI 写作模块剥离）：auto 的 Web 实现已移出仓外 ⇒ auto 项目**不再**渲染这些标记。
//   本常量**保留**，语义从「必须出现」反转为「**不得出现**」——它是一个**反向探针**：
//   若 auto 被误装回 / 实现被误接管，标记会 >0 ⇒ 断言立刻红（非恒真，仍有区分度）。
//   随实现移出后，断言改为「命中 === 0」+「落 <WorkbenchMissing/>」。
const AUTO_MARKERS = { '状态栏': '[aria-label="状态栏"]', '智能体对话': '[aria-label="智能体对话"]', '编辑器标签': '[aria-label="编辑器标签"]' };
// 章节编辑器：TipTap 挂载后的正文容器（编辑器真渲染的标志）
const PM_SELECTOR = '.ProseMirror';

let failed = 0;
const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push({ ok, label, detail });
  if (!ok) failed++;
}

function getJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`响应非 JSON: ${data.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`请求超时 ${timeoutMs}ms`)); });
  });
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

let msgId = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 环境探测：任一不可用 → EXIT=2（明确报错，绝不假装通过）----
console.log('===== 0) 环境探测 =====');
let page;
try {
  const pages = await getJson(`http://127.0.0.1:${PORT}/json`);
  page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('CDP 上没有 type=page 的目标');
} catch (err) {
  console.error(`\n❌ 环境不可用：无法连接 CDP（127.0.0.1:${PORT}）— ${err.message}`);
  console.error('   e2e 需要浏览器开 remote-debugging。手动步骤：');
  console.error(`   1) 起 dev：pnpm dev（web 在 ${BASE}，需 ${API_BASE} 上的 server）`);
  console.error('   2) 起带调试端口的浏览器：');
  console.error(`      "C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=${PORT} --user-data-dir=.workbuddy/e2e-chrome ${BASE}/login`);
  console.error('   3) 重跑本脚本');
  process.exit(2);
}
console.log(`  CDP ok — target url: ${page.url}`);

try {
  const health = await getJson(`${API_BASE}/api/health`);
  if (health?.status !== 'ok') throw new Error(`/api/health 返回 status=${health?.status}`);
  const okPlugins = (health.plugins ?? []).filter((p) => p.status === 'ok');
  console.log(`  server ok — database=${health.database}, plugins ok=${okPlugins.length}/${(health.plugins ?? []).length}`);
  // ★ t10（AI 写作模块剥离）拆分：manual（手写台）是基线模块，必须在场且 ok —— 硬断言。
  //   auto 的实现已移出仓外（仓内仅剩骨架包），故**不能**再要求「Web 实现在场」；
  //   但它仍是「契约在场」：骨架被宿主接受 ⇒ health 里仍有 novel.auto.workbench
  //   （status=ok，因为骨架的 server 面过 G1）。★ 注意：health status **不能**用来
  //   证明「auto 已剥离」—— 唯一判据是 hasModule('auto')===false，由下面第 3) 步的
  //   <WorkbenchMissing/> 断言实际证明。
  {
    const id = 'novel.manual.workbench';
    const st = (health.plugins ?? []).find((p) => p.id === id);
    check(`插件 ${id} 已挂载且 status=ok`, st?.status === 'ok', `status=${st?.status ?? '(missing)'}`);
  }
  {
    const id = 'novel.auto.workbench';
    const st = (health.plugins ?? []).find((p) => p.id === id);
    check(`插件 ${id} 契约仍在场（骨架包，插拔接口未破坏）`, !!st, `status=${st?.status ?? '(missing)'}`);
  }
} catch (err) {
  console.error(`\n❌ 环境不可用：后端 ${API_BASE} 不健康 — ${err.message}`);
  console.error('   请先起 server（pnpm dev:server），端口可用 E2E_API_BASE 覆盖。');
  process.exit(2);
}
console.log(`  web ok — ${BASE}`);

// web dev server 可达性：指向死端口时应 EXIT=2，而不是在后续断言里以假失败收场
try {
  await new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/`, (res) => { res.resume(); (res.statusCode && res.statusCode < 500) ? resolve() : reject(new Error(`HTTP ${res.statusCode}`)); });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('超时 5000ms')));
  });
} catch (err) {
  console.error(`\n❌ 环境不可用：web dev server ${BASE} 不可达 — ${err.message}`);
  console.error('   请先起 vite（pnpm dev:web），地址可用 E2E_BASE 覆盖。');
  process.exit(2);
}

const ws = await connect(page.webSocketDebuggerUrl);

// console 错误收集：consoleAPICalled(type=error) + exceptionThrown 都要
const consoleErrors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 240));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXC: ' + String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? '').slice(0, 400));
  }
});

async function evalJs(expression) {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) return { __exc: JSON.stringify(res.exceptionDetails).slice(0, 300) };
  return res.result?.value;
}
/** 轮询直到 expr 为真，返回其值；超时返回最后一次值 + 可区分诊断 */
async function waitFor(expr, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evalJs(expr);
    if (last) return last;
    await sleep(400);
  }
  // 超时时打印「页面到没到」vs「元素渲没渲」的可区分证据，避免误判为产品缺陷
  const diag = await evalJs(`({ path: location.pathname, ready: document.readyState, vis: document.visibilityState, bodyLen: document.body?.innerText?.length ?? -1, head: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 120) })`);
  console.log(`  [waitFor 超时 ${timeoutMs}ms] ${label}`);
  console.log(`    last=${JSON.stringify(last)}`);
  console.log(`    诊断: ${JSON.stringify(diag)}`);
  return last;
}
function markerExpr(markers) {
  const parts = Object.entries(markers).map(([name, sel]) => `${JSON.stringify(name)}: !!document.querySelector(${JSON.stringify(sel)})`);
  return `({${parts.join(', ')}})`;
}
const countTrue = (obj) => Object.values(obj ?? {}).filter(Boolean).length;

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Network.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ★★ 关键前置：把标签页从「未合成 / 不可见」状态解救出来 ★★
//   实测本机 Chrome 常处于未合成状态 → `document.visibilityState === 'hidden'`。
//   隐藏标签页**不派发 requestAnimationFrame**，而 PageFade 的退场动画由 framer-motion
//   驱动、必须靠 rAF 推进；`<AnimatePresence mode="wait">`（App.tsx:209）又规定
//   **旧页面 exit 跑完才挂载新页面**。于是出现这种「卡死」：
//     · 登录后 `location.pathname` 已是 `/bookshelf`，但 DOM 里仍是 LoginPage
//       （其包裹层 opacity 永远停在 0），新页面从未挂载 ⇒ 不发 `/api/projects`；
//     · 章节页同理：URL 已切换，但编辑器永不挂载 ⇒ `.ProseMirror` 永远等不到。
//   这是 e2e 环境的前台/可见性问题，**不是产品缺陷**（真实用户窗口是可见的）。
//   证据：加下面两行后同一流程 2s 内渲染出 `.nm-book-grid`；不加则 15s 超时。
await send(ws, 'Emulation.setFocusEmulationEnabled', { enabled: true });
await send(ws, 'Page.setWebLifecycleState', { state: 'active' });

// 校验前置真的生效：仍不可见 ⇒ 断言结果无意义，按「环境不可用」退出（EXIT=2）
const visibility = await (async () => {
  for (let i = 0; i < 10; i++) {
    const v = await evalJs(`({ state: document.visibilityState, hidden: document.hidden, focused: document.hasFocus() })`);
    if (v?.state === 'visible') return v;
    await sleep(300);
  }
  return null;
})();
if (!visibility) {
  console.error('\n❌ 环境不可用：标签页处于 hidden（未合成）状态，rAF 不派发。');
  console.error('   framer-motion 的页面过渡无法推进，客户端路由会「卡在旧页面」，断言无意义。');
  console.error('   请把浏览器窗口切到前台（或至少不要最小化），然后重跑。');
  console.error(`   当前：${JSON.stringify(await evalJs('({s:document.visibilityState,h:document.hidden,f:document.hasFocus()})'))}`);
  process.exit(2);
}
console.log(`  标签页可见 — visibilityState=${visibility.state}, hasFocus=${visibility.focused}`);

// 本次跑用到的资源 id，供 finally 清理
const stamp = Date.now().toString(36);
const created = { projects: [], chapterIds: [], characterIds: [] };
/** 清理：先删本次创建的角色，再删测试项目（项目删除也会级联带走章节） */
async function cleanup() {
  console.log('\n===== 8) 自清理 =====');
  if (created.characterIds.length) {
    const rc = await evalJs(`(async () => {
      const out = [];
      for (const id of ${JSON.stringify(created.characterIds)}) {
        try {
          const r = await fetch('/api/characters/' + id, { method: 'DELETE', headers: { 'X-Project-Id': ${JSON.stringify(created.projects[0] ?? '')} } });
          out.push(id.slice(0, 8) + ':' + r.status);
        } catch (e) { out.push(id.slice(0, 8) + ':ERR'); }
      }
      return out.join(', ');
    })()`);
    console.log('  已删除角色:', rc);
    // 复核：删除后列表里不应再有这些 id
    const leftover = await evalJs(`(async () => {
      if (!${JSON.stringify(created.projects[0] ?? '')}) return [];
      const r = await fetch('/api/characters/projects/' + ${JSON.stringify(created.projects[0] ?? '')});
      const j = await r.json().catch(() => ({}));
      const ids = new Set(${JSON.stringify(created.characterIds)});
      return (j?.data ?? []).filter((c) => ids.has(c.id)).map((c) => c.name);
    })()`);
    check('测试角色已彻底删除（列表复核无残留）',
      Array.isArray(leftover) && leftover.length === 0, `残留=${JSON.stringify(leftover)}`);
  }
  if (created.projects.length === 0) {
    console.log('  无测试项目需要清理');
    return;
  }
  const res = await evalJs(`(async () => {
    const ids = ${JSON.stringify(created.projects)};
    const out = [];
    for (const id of ids) {
      try {
        const r = await fetch('/api/projects/' + id, { method: 'DELETE' });
        out.push(id.slice(0, 8) + ':' + r.status);
      } catch (e) { out.push(id.slice(0, 8) + ':ERR'); }
    }
    return out.join(', ');
  })()`);
  console.log('  已删除:', res);
  // 独立复核：DELETE 后必须真的查不到（不采信 DELETE 的 200）
  const stillThere = await evalJs(`(async () => {
    const r = await fetch('/api/projects');
    const j = await r.json().catch(() => ({}));
    const ids = new Set(${JSON.stringify(created.projects)});
    return (j?.data ?? []).filter((p) => ids.has(p.id)).map((p) => p.name);
  })()`);
  check('测试项目已彻底删除（GET /api/projects 复核无残留）',
    Array.isArray(stillThere) && stillThere.length === 0, `残留=${JSON.stringify(stillThere)}`);
}

try {
  // ---- 1) 登录 → 书架 ----
  console.log('\n===== 1) 登录 → 书架 =====');
  await send(ws, 'Page.navigate', { url: `${BASE}/login` });
  await sleep(3000);
  await evalJs(`(() => { const k=[]; for (let i=0;i<localStorage.length;i++) k.push(localStorage.key(i)); k.forEach(x=>localStorage.removeItem(x)); return k.length; })()`);
  await sleep(800);
  const loginState = await evalJs(`(() => {
    const inputs = document.querySelectorAll('input');
    let user = null, pass = null;
    inputs.forEach((i) => {
      if (i.type === 'text' && i.placeholder && i.placeholder.includes('用户名')) user = i;
      if (i.type === 'password') pass = i;
    });
    if (!user || !pass) return { alreadyLoggedIn: true, path: location.pathname };
    const setVal = (el, val) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(user, ${JSON.stringify(USER)});
    setVal(pass, ${JSON.stringify(PASS)});
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('登录'));
    if (!btn) return { noBtn: true };
    btn.click();
    return { submitted: true };
  })()`);
  console.log('  提交:', JSON.stringify(loginState));
  check('登录表单已提交', loginState?.submitted === true, JSON.stringify(loginState));
  const bookshelfPath = await waitFor(`location.pathname === '/bookshelf' ? '/bookshelf' : ''`, '进入书架');
  check('登录后进入书架 /bookshelf', bookshelfPath === '/bookshelf', `path=${await evalJs('location.pathname')}`);
  const me = await evalJs(`fetch('/api/auth/me').then(r=>r.json()).then(j=>j?.data?.username).catch(()=>null)`);
  check('Cookie 会话有效（/auth/me 返回当前用户）', me === USER, `username=${me ?? '(none)'}`);

  // ---- 2) 建 manual / auto 两个测试项目（页面内 fetch，带同源 Cookie）----
  console.log('\n===== 2) 建 manual / auto 测试项目 =====');
  const mk = await evalJs(`(async () => {
    const create = async (mode) => {
      const r = await fetch('/api/projects', { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ name: 'e2e-core-${stamp}-' + mode, mode }) });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, id: j?.data?.id, mode: j?.data?.mode, error: j?.error };
    };
    return { manual: await create('manual'), auto: await create('auto') };
  })()`);
  console.log('  created:', JSON.stringify(mk));
  check('创建 manual 项目（201）', mk?.manual?.status === 201 && !!mk?.manual?.id, JSON.stringify(mk?.manual));
  check('创建 auto 项目（201）', mk?.auto?.status === 201 && !!mk?.auto?.id, JSON.stringify(mk?.auto));
  check('manual 项目 mode 回读为 manual', mk?.manual?.mode === 'manual', `mode=${mk?.manual?.mode}`);
  check('auto 项目 mode 回读为 auto', mk?.auto?.mode === 'auto', `mode=${mk?.auto?.mode}`);
  const manualId = mk?.manual?.id;
  const autoId = mk?.auto?.id;
  if (manualId) created.projects.push(manualId);
  if (autoId) created.projects.push(autoId);

  // ---- 3) manual 项目 → 手写台停靠外壳标记 ----
  console.log('\n===== 3) manual 项目 → 手写台停靠外壳 =====');
  if (manualId) {
    await send(ws, 'Page.navigate', { url: `${BASE}/project/${manualId}` });
    await sleep(4000);
    await waitFor(`!!document.querySelector('[aria-label="面板菜单"]')`, 'manual 面板菜单');
    const m = await evalJs(markerExpr(MANUAL_MARKERS));
    const a = await evalJs(markerExpr(AUTO_MARKERS));
    console.log('  manual markers:', JSON.stringify(m));
    console.log('  auto   markers:', JSON.stringify(a));
    check('manual 项目出现手写台停靠外壳标记 [aria-label="面板菜单"]', m?.['面板菜单'] === true, JSON.stringify(m));
    check('manual 项目出现手写台全部标记（面板菜单 + 活动栏）',
      countTrue(m) === Object.keys(MANUAL_MARKERS).length,
      `命中 ${countTrue(m)}/${Object.keys(MANUAL_MARKERS).length}: ${JSON.stringify(m)}`);
    check('manual 项目**不出现** AI 写作 UI（模式互斥无泄漏）', countTrue(a) === 0,
      `误现 ${countTrue(a)} 个: ${JSON.stringify(a)}`);
  }

  // ---- 4) auto 项目 → 优雅降级：落 <WorkbenchMissing/>，不崩、标记 0/3 ----
  // ★ t10（AI 写作模块剥离）：auto 的 Web 实现已移出仓外（hasModule('auto')===false）
  //   ⇒ auto 项目**不再**渲染 AutoWriteWorkbench。但「缺席」必须被**优雅处理**：
  //   ProjectLayout 检测到工作台槽为空时应渲染 <WorkbenchMissing mode="auto"/>
  //   （G-1 修复点，ProjectLayout.tsx:631）。本段如实断言这一行为，并**保留**
  //   AUTO_MARKERS 作为反向探针（若 auto 被误装回、或实现误接管，标记会 >0 ⇒ 立刻红）。
  console.log('\n===== 4) auto 项目 → WorkbenchMissing（实现已移出的优雅降级）=====');
  if (autoId) {
    await send(ws, 'Page.navigate', { url: `${BASE}/project/${autoId}` });
    await sleep(4000);
    // 4a) 必须渲染「工作台未安装」占位（WorkbenchMissing.tsx:29 aria-label="工作台未安装"）
    //     ★ waitFor 返回值语义：成功时返回最后一次 evalJs 的值（此处为对象），
    //       超时返回最后一次 falsy 值 —— **不是布尔**，故显式判 !!obj && obj.ok===true。
    const missingInfo = await waitFor(
      `(() => { const el = document.querySelector('[aria-label="工作台未安装"]');
         return el ? { ok: true, text: el.innerText } : null; })()`,
      'auto 工作台未安装占位',
      TIMEOUT_MS);
    check('auto 项目渲染 <WorkbenchMissing/>（工作台未安装占位）',
      !!missingInfo && missingInfo.ok === true,
      `text=${JSON.stringify(missingInfo?.text ?? null)}`);
    // 4b) 占位文案必须点名 AI 写作台（WorkbenchMissing.tsx:18-21 MODE_LABEL.auto='AI 写作台'）
    check('占位文案点明「AI 写作台未安装」',
      typeof missingInfo?.text === 'string'
        && missingInfo.text.includes('AI 写作台') && missingInfo.text.includes('未安装'),
      `text=${JSON.stringify(missingInfo?.text ?? null)}`);
    // 4c) AI 写作台 UI 标记必须 0/3（如实反映 Web 实现缺席）—— 反向探针，非恒真
    const a = await evalJs(markerExpr(AUTO_MARKERS));
    check('auto 项目**不出现** AutoWriteWorkbench 标记（实现已移出，0/3）',
      countTrue(a) === 0,
      `命中 ${countTrue(a)}/${Object.keys(AUTO_MARKERS).length}: ${JSON.stringify(a)}`);
    // 4d) 模式互斥仍然成立：不出现手写知识面板
    const m = await evalJs(markerExpr(MANUAL_MARKERS));
    check('auto 项目**不出现**手写台停靠外壳（模式互斥无泄漏）', countTrue(m) === 0,
      `误现 ${countTrue(m)} 个: ${JSON.stringify(m)}`);
    // 注：console error 断言**已由本脚本末尾的全局断言覆盖**（见 `全流程 console 错误为 0`
    //     一条收集 consoleAPICalled(type=error)+exceptionThrown）。本段刻意不重复添加，
    //     但若 auto 降级路径抛错（如 WorkbenchMissing 未接线），该全局断言会捕获。
  }

  // ---- 5) 章节闭环：UI 建章节 → 写正文 → 落库 → 刷新 → 正文仍在 ----
  console.log('\n===== 5) 章节闭环（创建 → 写正文 → 保存 → 刷新持久化）=====');
  if (manualId) {
    // 5a) 空项目 → 走 UI「开始写作」创建第一章（验证真实用户路径）
    await send(ws, 'Page.navigate', { url: `${BASE}/project/${manualId}` });
    await sleep(4000);
    const emptyState = await waitFor(`(() => {
      const i = document.querySelector('input[placeholder*="章节标题"]');
      return i ? { placeholder: i.placeholder } : '';
    })()`, '空项目建章节输入框');
    check('空项目显示「创建第一章」空态输入框', !!emptyState?.placeholder, JSON.stringify(emptyState));

    const clicked = await evalJs(`(() => {
      const i = document.querySelector('input[placeholder*="章节标题"]');
      if (!i) return 'no-input';
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(i, '端到端测试章');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('开始写作'));
      if (!b) return 'no-btn';
      b.click();
      return 'clicked';
    })()`);
    check('点击「开始写作」提交建章节', clicked === 'clicked', String(clicked));

    // 5b) 进入编辑器：URL 变成 /project/<bookId>/<chapterId> 且 ProseMirror 挂载
    const chapUrl = await waitFor(
      `/^\\/project\\/[^/]+\\/[^/]+$/.test(location.pathname) ? location.pathname : ''`,
      '进入章节编辑器 URL',
    );
    console.log('  chapter url:', chapUrl);
    check('建章节后进入编辑器路由 /project/:bookId/:chapterId',
      !!chapUrl && chapUrl.split('/').length === 4, `path=${chapUrl || await evalJs('location.pathname')}`);
    // ★ 这一条是「ChapterEditor 路由真的注册了」的回归断言（moduleEntries glob 缺陷曾让此处 404）
    const notFound = await evalJs(`document.body.innerText.includes('山径已隐') || document.body.innerText.includes('404')`);
    check('章节路由未落到 404（ChapterEditor 路由已注册）', notFound === false, `404标记=${notFound}`);

    const chapterId = chapUrl ? String(chapUrl).split('/').pop() : null;
    if (chapterId) created.chapterIds.push(chapterId);

    const pmReady = await waitFor(`!!document.querySelector('${PM_SELECTOR}')`, 'ProseMirror 挂载', TIMEOUT_MS);
    check('章节编辑器正文容器 .ProseMirror 已挂载', pmReady === true, `pm=${pmReady}`);
    // ★ 这一条是「无无限重渲染」的回归断言（useEditor deps 缺陷曾让此处白屏）
    const crashed = await evalJs(`document.body.innerText.includes('Maximum update depth exceeded')`);
    check('章节页未出现无限重渲染崩溃（Maximum update depth exceeded）', crashed === false, `crashed=${crashed}`);

    // 5c) 写入正文（Input.insertText 走真实输入通道，触发 TipTap 的 update）
    const MARKER = `端到端正文-${stamp}-甲乙丙丁戊己庚辛`;
    const focus = await evalJs(`(() => {
      const el = document.querySelector('${PM_SELECTOR}');
      if (!el) return 'no-pm';
      el.focus();
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
      return 'focused';
    })()`);
    check('正文容器可获得焦点', focus === 'focused', String(focus));
    await send(ws, 'Input.insertText', { text: MARKER });
    const typed = await waitFor(
      `(document.querySelector('${PM_SELECTOR}')?.innerText || '').includes(${JSON.stringify(MARKER)}) ? 'ok' : ''`,
      '正文写入编辑器',
    );
    check('正文已写入编辑器（编辑器内可见标记文本）', typed === 'ok',
      `innerText=${JSON.stringify((await evalJs(`document.querySelector('${PM_SELECTOR}')?.innerText || ''`))?.slice(0, 60))}`);

    // 5d) 真持久化：正文必须落到后端（不是内存态）
    //     编辑器落库有 100ms 防抖 + 异步 PUT，故轮询等待
    const persisted = await waitFor(`(async () => {
      const r = await fetch('/api/chapters/${chapterId}', { headers: { 'X-Project-Id': '${manualId}' } });
      const j = await r.json().catch(() => ({}));
      const c = j?.data?.content;
      return (typeof c === 'string' && c.includes(${JSON.stringify(MARKER)}))
        ? { status: r.status, wordCount: j?.data?.wordCount, len: c.length } : '';
    })()`, '后端落库', TIMEOUT_MS);
    check('正文已持久化到后端（GET /api/chapters/:id 含标记文本）', !!persisted,
      persisted ? JSON.stringify(persisted) : `content=${JSON.stringify((await evalJs(`fetch('/api/chapters/${chapterId}',{headers:{'X-Project-Id':'${manualId}'}}).then(r=>r.json()).then(j=>String(j?.data?.content||'').slice(0,80)).catch(()=>'ERR')`)))}`);

    // 5e) 刷新页面 → 正文仍在（★ 真持久化，排除「只在内存/localStorage」的假象）
    //     主动清掉章节本地缓存，强制刷新后只能从后端取内容。
    await send(ws, 'Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.removeItem('nm:chapter:${chapterId}'); } catch (e) {}`,
    });
    await send(ws, 'Page.reload', { ignoreCache: true });
    await sleep(5000);
    await waitFor(`!!document.querySelector('${PM_SELECTOR}')`, '刷新后 ProseMirror', TIMEOUT_MS);
    const afterReload = await evalJs(`(() => ({
      path: location.pathname,
      text: document.querySelector('${PM_SELECTOR}')?.innerText || '',
      cachePresent: !!localStorage.getItem('nm:chapter:${chapterId}'),
    }))()`);
    console.log('  刷新后:', JSON.stringify({ path: afterReload?.path, cachePresent: afterReload?.cachePresent, text: String(afterReload?.text ?? '').slice(0, 40) }));
    check('刷新后仍在章节编辑器路由', afterReload?.path === chapUrl, `path=${afterReload?.path}`);
    check('刷新后正文仍在（清本地缓存后从后端恢复 ⇒ 真持久化）',
      typeof afterReload?.text === 'string' && afterReload.text.includes(MARKER),
      `text=${JSON.stringify(String(afterReload?.text ?? '').slice(0, 80))}`);
  }

  // ---- 6) 角色/知识库面板：打开并渲染数据 ----
  console.log('\n===== 6) 角色面板打开并渲染数据 =====');
  if (manualId) {
    // ★ 造数据必须走**真实用户路径**（点面板的「创建新角色」→ 填名 → 失焦保存）。
    //   不能用 raw fetch('/api/characters') 直接打后端 —— 那会绕过 zustand store：
    //   CharacterManager 读的是 `useCharacterStore((s) => s.characters)`（:218），
    //   store 里没有这条记录，面板就会（正确地）显示「暂无角色」。
    //   「造数据的路径」与「断言的读取源」必须是同一条链，否则断言毫无意义。
    const charName = `端到端角色-${stamp}`;

    // 打开「角色」面板（★ t2 修正 F2）：旧路径「展开功能转轮 → 点角色气泡」已随气泡体系退役。
    //   新外壳有两个等价入口，本脚本走**活动栏**（一步到位，最稳）：
    //     · 活动栏按钮：`DockShell.tsx:212` 渲染 `aria-label={it.label}`，角色面板即 `aria-label="角色"`；
    //       点击经 `onActivitySelect` → `api.openPanel(key)`（DockShell.tsx:501-513）直接开面板。
    //     · 面板菜单：先点 `[aria-label="面板菜单"]`，再点 `.panel-menu-item-label` 文本为「角色」的项。
    //   此处先断言活动栏按钮存在（= 候选池确实按 mode 供给了角色面板），再点它。
    const hub = await evalJs(`(() => {
      const b = document.querySelector('nav[aria-label="活动栏"] button[aria-label="角色"]');
      if (!b) return 'no-activity-btn';
      b.click();
      return 'clicked';
    })()`);
    check('活动栏存在「角色」入口并可点击（nav[aria-label="活动栏"] button[aria-label="角色"]）', hub === 'clicked', String(hub));
    await sleep(900);

    // 面板壳 + 列表内容（面板是懒加载 chunk，等它真的渲染出来）
    // ★ 面板本体用 `data-panel-key` 定位（DockPanelContent.tsx:107），**不能**用 `[aria-label="角色"]`：
    //   后者会被活动栏那个同名按钮命中，选择器不唯一（实测全仓 `aria-label="角色"` 来自
    //   `aria-label={it.label}` 的运行时展开，字面量 grep 为 0）。
    const panel = await waitFor(`(() => {
      const p = document.querySelector('[data-panel-key="characters"]');
      const lb = document.querySelector('[role="listbox"][aria-label="角色列表"]');
      if (!p || !lb) return '';
      return { panelText: (p.innerText || '').slice(0, 160), listText: (lb.innerText || '').slice(0, 160) };
    })()`, '角色面板渲染');
    console.log('  面板:', JSON.stringify(panel));
    check('角色面板已打开（[data-panel-key="characters"] + 角色列表 listbox）', !!panel, JSON.stringify(panel));
    // 新项目下应先呈现空态 —— 这同时证明列表确实由 store 驱动（而非硬编码）
    check('新项目的角色列表初始为空态（暂无角色）',
      typeof panel?.listText === 'string' && panel.listText.includes('暂无角色'),
      `listText=${JSON.stringify(panel?.listText)}`);

    // 6a) 走 UI 创建角色：点「创建新角色」→ 名字输入框 → 填名 → 失焦保存
    const createClick = await evalJs(`(() => {
      const b = document.querySelector('[aria-label="创建新角色"]');
      if (!b) return 'no-create-btn';
      b.click();
      return 'clicked';
    })()`);
    check('点击「创建新角色」按钮（[aria-label="创建新角色"]）', createClick === 'clicked', String(createClick));

    // EntityForm 的名字输入框：placeholder="未命名"（CharacterManager 新建时 name='新角色'）
    const nameInput = await waitFor(`(() => {
      const i = document.querySelector('input[placeholder="未命名"]');
      return i ? { value: i.value } : '';
    })()`, '角色名字输入框');
    check('出现角色名字输入框（placeholder="未命名"）', !!nameInput, JSON.stringify(nameInput));

    // 填名（独立 tick）——★ 必须与下面的 blur **分开两次求值**：
    //   EntityForm 的 handleSave 闭包捕获的是 useState 的 `name`（EntityForm.tsx:73-75）。
    //   若在同一 tick 里既 dispatch input 又 blur，React 19 会批处理这次 setState，
    //   onBlur 读到的仍是**旧值**（'新角色'），于是把旧名 PUT 上去 —— 这是
    //   「不真实的输入时序」造成的假失败，不是产品缺陷（真人输入与失焦必然跨 tick）。
    const filled = await evalJs(`(() => {
      const i = document.querySelector('input[placeholder="未命名"]');
      if (!i) return 'no-input';
      i.focus();
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(i, ${JSON.stringify(charName)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return i.value === ${JSON.stringify(charName)} ? 'filled' : 'mismatch:' + i.value;
    })()`);
    check('角色名已填入输入框', filled === 'filled', String(filled));
    await sleep(400); // 让 React 提交这次 setState，确保 onBlur 读到新值

    // 失焦保存（独立 tick）→ React onBlur → handleSave → updateCharacter → store + 后端
    const blurred = await evalJs(`(() => {
      const i = document.querySelector('input[placeholder="未命名"]');
      if (!i) return 'no-input';
      i.blur();
      i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      return 'blurred';
    })()`);
    check('角色名输入框已失焦（触发保存）', blurred === 'blurred', String(blurred));

    // 6b) ★ 核心断言：面板列表真的渲染出刚创建的角色（保持强度，不放宽）
    const rendered = await waitFor(`(() => {
      const lb = document.querySelector('[role="listbox"][aria-label="角色列表"]');
      if (!lb) return '';
      const t = lb.innerText || '';
      return t.includes(${JSON.stringify(charName)}) ? { listText: t.slice(0, 200) } : '';
    })()`, '角色出现在面板列表');
    console.log('  列表:', JSON.stringify(rendered));
    check('角色面板渲染出真实数据（含刚通过 UI 创建的角色名）',
      typeof rendered?.listText === 'string' && rendered.listText.includes(charName),
      `listText=${JSON.stringify(rendered?.listText)}`);

    // 6c) 顺带验证「面板 → store → syncService → 后端」整条链真的落库
    // ★ 列表路由是 `/api/characters/projects/:projectId`（见 apps/server/src/modules/characters.ts:70）。
    //   没有裸 `GET /api/characters`（会 404）；也没有 `/api/projects/:id/characters`（同样 404）。
    const charPersisted = await waitFor(`(async () => {
      const r = await fetch('/api/characters/projects/${manualId}');
      const j = await r.json().catch(() => ({}));
      const hit = (j?.data ?? []).find((c) => c.name === ${JSON.stringify(charName)});
      return hit ? { status: r.status, id: hit.id, role: hit.role } : '';
    })()`, '角色落库', TIMEOUT_MS);
    check('UI 创建的角色已持久化到后端（GET /api/characters/projects/:id 含该名字）', !!charPersisted,
      charPersisted ? JSON.stringify(charPersisted)
        : `后端列表=${JSON.stringify(await evalJs(`fetch('/api/characters/projects/${manualId}').then(r=>r.text()).then(t=>t.slice(0,400)).catch(e=>'ERR '+e.message)`))}`);
    if (charPersisted?.id) created.characterIds.push(charPersisted.id);

    // 面板不应停留在加载态
    // ★ 加载态选择器（t2 修正）：旧 `[aria-label="Loading"]` 全仓已 0 命中（实测含 node_modules），
    //   新壳的加载态是 `[aria-label="加载中"]`（ProjectLayout.tsx:72 的 PanelFallback，role="status"）。
    const stuckLoading = await evalJs(`!!document.querySelector('[aria-label="加载中"]')`);
    check('角色面板未卡在加载态', stuckLoading === false, `loading=${stuckLoading}`);
  }

  // ---- 7) 自清理 ----
  await cleanup();

  // ---- 6b) console 错误清零（放在最后，覆盖全流程收集到的错误）----
  console.log('\n===== 7) console 错误清零断言 =====');
  console.log(`  收集到 ${consoleErrors.length} 条 console error`);
  if (consoleErrors.length) {
    // 去重后打印，避免刷屏
    const uniq = [...new Set(consoleErrors.map((e) => e.slice(0, 200)))];
    console.log('  去重后前 6 条:');
    uniq.slice(0, 6).forEach((e) => console.log(`    · ${e}`));
  }
  check('全流程 console 错误为 0（consoleAPICalled type=error + exceptionThrown）',
    consoleErrors.length === 0, `${consoleErrors.length} 条`);
} catch (err) {
  check('e2e 执行未抛异常', false, err instanceof Error ? err.message : String(err));
} finally {
  // 尽力清理（即使上面抛异常也不留脏数据）
  try {
    const remaining = await evalJs(`(async () => {
      const r = await fetch('/api/projects');
      const j = await r.json().catch(() => ({}));
      const ids = new Set(${JSON.stringify(created.projects)});
      return (j?.data ?? []).filter((p) => ids.has(p.id)).length;
    })()`);
    if (remaining > 0) {
      console.log(`\n⚠️ 仍有 ${remaining} 个测试项目残留，执行兜底清理…`);
      await cleanup();
    }
  } catch { /* 清理失败不影响结论 */ }

  ws.close();

  console.log(`\n${'='.repeat(60)}`);
  if (failed === 0) {
    console.log(`✅ e2e-core-flows 全过（${results.length} 项断言）`);
  } else {
    console.log(`❌ e2e-core-flows：${failed}/${results.length} 项失败`);
    for (const r of results.filter((x) => !x.ok)) console.log(`   · ${r.label} — ${r.detail}`);
    console.log('   定位：');
    console.log('     · 章节页 404「山径已隐」 → apps/web/src/plugin/moduleEntries.ts'
      + '（import.meta.glob 路径；空展开 ⇒ ChapterEditor 路由不注册）');
    console.log('     · 白屏 "Maximum update depth exceeded" → apps/plugins/manual/workbench/web/editor/hooks/useEditorInstance.ts'
      + '（pluginEditorExtensions 需 useMemo，否则 useEditor 的 deps 每轮都是新引用 ⇒ 无限重建）');
    console.log('     · 正文刷新后丢失 → apps/plugins/shared/data-core/src/data/databaseService.ts（PUT /chapters/:id 落库）'
      + '、apps/web/src/services/data/chapterLocalCache.ts（本地缓存兜底）');
    console.log('     · 模式泄漏（manual 出现 AI UI / auto 出现手写面板） → apps/web/src/components/shell/ProjectLayout.tsx'
      + '（mode 分流）、apps/web/src/plugin/registry.ts（filterByProjectMode）');
  }
  process.exit(failed === 0 ? 0 : 1);
}