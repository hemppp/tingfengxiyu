// ============================================================
// CDP 端到端：清空状态 → 登录 → 书架 → 刷新持久化
//
// ★ 本脚本的前身是「假绿脚本」，已确认的三个缺陷（2026-10-01 修复）：
//   1. 用了**不存在的账号** `graph3d_test` / `Test1234!` → 登录必然失败；
//   2. **通篇 0 条断言**，结尾硬编码 `process.exit(0)` → 流程完全没跑通也报 EXIT=0；
//   3. 实测输出 `after login: /login` / `books:0` / `hasToken:false` 却 EXIT=0。
//   现在：每一步都有断言，任一失败 EXIT=1；环境不可用 EXIT=2。
//
// ★ 为什么不再断言 `localStorage.novelmuse_token`：
//   C4 之后 JWT 由**服务端 HttpOnly Cookie**（`novelmuse_token`）承载，
//   JS 读不到；且 apiClient 启动时会**主动 removeItem** 清理历史遗留值。
//   所以「localStorage 里没有 token」是**正确行为**，不是缺陷 ——
//   旧脚本把它当断言是错的。本脚本改以「离开 /login」+ `/auth/me` 200 作为登录证据。
//
// 前置条件：
//   1. dev server 在跑（默认 http://localhost:5174，vite，/api 代理到后端）
//   2. 后端 server 在跑（默认 http://localhost:3774，其 /api/health 报 status=ok）
//   3. 一个开了 remote-debugging 的浏览器（默认 127.0.0.1:9222）
//   4. 可用账号：默认 admin / Admin1234!（可用 E2E_USER / E2E_PASS 覆盖）
//
// 用法：
//   node scripts/e2e/e2e-full.mjs
// 环境变量覆盖（便于故障注入复核）：
//   E2E_CDP_PORT(9222) E2E_BASE(http://localhost:5174) E2E_API_BASE(http://localhost:3774)
//   E2E_USER(admin) E2E_PASS(Admin1234!) E2E_TIMEOUT_MS(15000)
// 退出码：0 = 全过；1 = 有断言失败；2 = 环境不可用（CDP / server 不可达）
// ============================================================

import WebSocket from 'ws';
import http from 'http';

const PORT = Number(process.env.E2E_CDP_PORT) || 9222;
const BASE = process.env.E2E_BASE || 'http://localhost:5174';
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3774';
const USER = process.env.E2E_USER || 'admin';
const PASS = process.env.E2E_PASS || 'Admin1234!';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS) || 15000;

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
  console.log(`  server ok — database=${health.database}, plugins=${(health.plugins ?? []).length}`);
} catch (err) {
  console.error(`\n❌ 环境不可用：后端 ${API_BASE} 不健康 — ${err.message}`);
  console.error(`   请先起 server（pnpm dev:server），端口可用 E2E_API_BASE 覆盖。`);
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

// console 错误收集：consoleAPICalled(type=error) + exceptionThrown
const consoleErrors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXC: ' + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 300));
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

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Network.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ★★ 关键前置：把标签页从「未合成 / 不可见」状态解救出来 ★★
//   实测本机 Chrome 常处于未合成状态 → `document.visibilityState === 'hidden'`。
//   隐藏标签页**不派发 requestAnimationFrame**，而 PageFade 的退场动画由 framer-motion
//   驱动、必须靠 rAF 推进；`<AnimatePresence mode="wait">`（App.tsx:209）又规定
//   **旧页面 exit 跑完才挂载新页面**。于是出现这种「卡死」：
//     · 登录后 `location.pathname` 已是 `/bookshelf`
//     · 但 DOM 里仍是 LoginPage（其包裹层 opacity 永远停在 0）
//     · 新页面从未挂载 ⇒ 它的 useEffect 没跑 ⇒ 书架**从不发** `/api/projects`
//   这是 e2e 环境的前台/可见性问题，**不是产品缺陷**（真实用户窗口是可见的）。
//   证据：加下面两行后同一流程 2s 内即渲染出 `.nm-book-grid`；不加则 15s 超时。
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

try {
  // ---- 1) 清空本地状态（模拟用户彻底退出）----
  console.log('\n===== 1) 清空本地状态 =====');
  await send(ws, 'Page.navigate', { url: `${BASE}/login` });
  await sleep(3000);
  const cleared = await evalJs(`(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach((k) => localStorage.removeItem(k));
    return keys.length;
  })()`);
  console.log(`  已清空 ${cleared} 个 localStorage 键`);
  check('清空本地状态后仍在登录页', (await evalJs('location.pathname')) === '/login',
    `path=${await evalJs('location.pathname')}`);

  // ---- 2) 登录（真实账号；会话由 HttpOnly Cookie 承载）----
  console.log('\n===== 2) 登录 =====');
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
  check('登录表单已提交（未走「已登录」短路）', loginState?.submitted === true, JSON.stringify(loginState));

  const afterLoginPath = await waitFor(`location.pathname !== '/login' ? location.pathname : ''`, '离开 /login');
  check('登录成功：离开 /login', !!afterLoginPath, `path=${afterLoginPath || await evalJs('location.pathname')}`);
  check('登录后落在书架 /bookshelf', afterLoginPath === '/bookshelf', `path=${afterLoginPath}`);

  // 会话真实性的独立证据：/auth/me 必须 200 且回当前用户
  const me = await evalJs(`fetch('/api/auth/me').then(r => r.json()).then(j => ({ status: 200, username: j?.data?.username })).catch(e => ({ status: 0, err: String(e.message) }))`);
  check('会话有效：GET /api/auth/me 返回当前用户', me?.username === USER,
    `username=${me?.username ?? '(none)'} user=${USER}`);

  // ---- 3) 书架内容 ----
  console.log('\n===== 3) 书架 =====');
  // ★ 必须等「加载完成」再断言：BookshelfPage 有 loading 态（转圈 +「墨香渐浓...」），
  //   且页面是 lazy chunk。刚登录时若立刻查 DOM，会看到 grid/cards 都不存在 ——
  //   那是**还在加载**，不是缺陷。判定「已就绪」= 转圈消失且（书格 或 空态）出现。
  const shelf = await waitFor(`(() => {
    if (location.pathname !== '/bookshelf') return '';
    const stillLoading = document.body.innerText.includes('墨香渐浓');
    if (stillLoading) return '';
    const grid = document.querySelector('.nm-book-grid');
    const cards = document.querySelectorAll('.book-card-item');
    const emptyState = document.body.innerText.includes('开卷以待') || document.body.innerText.includes('未得此卷');
    if (!grid && !emptyState) return '';
    return { path: location.pathname, grid: !!grid, cards: cards.length, emptyState };
  })()`, '书架加载完成（转圈消失 + 书格/空态出现）');
  console.log('  书架:', JSON.stringify(shelf));
  check('书架页加载完成并渲染出书格容器 .nm-book-grid', shelf?.grid === true, JSON.stringify(shelf));
  check('书架至少加载 1 本书（admin 账号已有数据）', (shelf?.cards ?? 0) >= 1,
    `cards=${shelf?.cards} emptyState=${shelf?.emptyState}`);
  // 注意：这里**不断言** localStorage 里有 token —— C4 后 token 只在 HttpOnly Cookie，
  // 且 apiClient 会主动清理遗留的 localStorage 值（见文件头说明）。
  const tokenLeak = await evalJs(`localStorage.getItem('novelmuse_token')`);
  check('JWT 未泄漏到 localStorage（C4：仅 HttpOnly Cookie）', tokenLeak === null, `value=${JSON.stringify(tokenLeak)}`);

  // ---- 4) 刷新后仍保持登录（Cookie 会话持久化）----
  console.log('\n===== 4) 刷新持久化 =====');
  await send(ws, 'Page.reload', { ignoreCache: true });
  await sleep(3000);
  const afterReload = await waitFor(`(() => {
    if (location.pathname !== '/bookshelf') return '';
    if (document.body.innerText.includes('墨香渐浓')) return '';
    const grid = document.querySelector('.nm-book-grid');
    const cards = document.querySelectorAll('.book-card-item');
    const emptyState = document.body.innerText.includes('开卷以待') || document.body.innerText.includes('未得此卷');
    if (!grid && !emptyState) return '';
    return { path: location.pathname, grid: !!grid, cards: cards.length };
  })()`, '刷新后书架加载完成');
  console.log('  刷新后:', JSON.stringify(afterReload));
  check('刷新后仍停在书架（未被踢回登录页）', afterReload?.path === '/bookshelf', JSON.stringify(afterReload));
  check('刷新后书籍数量与刷新前一致', afterReload?.cards === shelf?.cards,
    `before=${shelf?.cards} after=${afterReload?.cards}`);

  const meAfterReload = await evalJs(`fetch('/api/auth/me').then(r => r.json()).then(j => j?.data?.username).catch(() => null)`);
  check('刷新后 Cookie 会话仍有效（/auth/me 仍返回用户）', meAfterReload === USER, `username=${meAfterReload ?? '(none)'}`);
} catch (err) {
  check('e2e 执行未抛异常', false, err instanceof Error ? err.message : String(err));
} finally {
  // console 错误断言：真端到端不该有未捕获错误
  console.log(`\nconsole errors: ${consoleErrors.length}`);
  if (consoleErrors.length) console.log('  前 6 条:', JSON.stringify(consoleErrors.slice(0, 6), null, 1));
  check('流程中无 console 错误（consoleAPICalled error + exceptionThrown）', consoleErrors.length === 0,
    `${consoleErrors.length} 条`);

  ws.close();

  console.log(`\n${'='.repeat(60)}`);
  if (failed === 0) {
    console.log(`✅ e2e-full 全过（${results.length} 项断言）`);
  } else {
    console.log(`❌ e2e-full：${failed}/${results.length} 项失败`);
    for (const r of results.filter((x) => !x.ok)) console.log(`   · ${r.label} — ${r.detail}`);
    console.log('   定位：登录失败 → apps/server/src/modules/auth.ts（账号/密码）'
      + '、apps/web/src/stores/authStore.ts（login 流程）'
      + '；书架空 → apps/web/src/pages/BookshelfPage.tsx（/projects 加载）'
      + '；刷新掉登录 → apps/server/src/lib/cookies.ts（HttpOnly Cookie 写入）');
  }
  process.exit(failed === 0 ? 0 : 1);
}