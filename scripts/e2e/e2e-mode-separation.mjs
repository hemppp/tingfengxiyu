// ============================================================
// CDP 端到端：插件层的「模式分离」在浏览器里真实可见
//
// 断言（两种项目模式互斥的 UI 表现）：
//   · manual 项目 → 工作台出现手写台**停靠外壳** UI（面板菜单 + 活动栏），
//                   且**不出现** AI 写作专属 UI（状态栏 / 智能体对话 / 看板）
//   · auto   项目 → 出现 AutoWriteWorkbench（三栏 / 世界状态仪表盘：状态栏 + 智能体对话 + 看板），
//                   且**不出现**手写台停靠外壳（面板菜单 / 活动栏）
//
// 为什么必须浏览器级验证：单测只证明「注册表按 mode 过滤」这个纯函数，
//   证明不了「ProjectLayout 真的在 auto 下不渲染手写气泡、在 manual 下不渲染 AutoWriteWorkbench」。
//   前端拆分的真正风险是"两种工作台同时出现"（泄漏）——只有真渲染才看得见。
//
// 前置条件（与 e2e-full.mjs 同款）：
//   1. dev server 在跑（默认 http://localhost:5174；vite，/api 代理到后端）。
//      ★ 模块入口由 `apps/web/src/plugin/moduleEntries.ts` 与 `main.tsx` 的
//        `import.meta.glob` **构建期**收集 —— 新增 / 改动模块入口后必须**重启 vite**，
//        否则新入口不会被收集，auto 不会渲染（表现为本脚本 auto 命中 0/3）。
//   2. 后端 server 在跑，且其 `/api/health` 对本脚本用到的模块报 `status=ok`。
//      ★ local-scanner **只在 server 启动时**扫描 manifest，不热重载 `plugin.json`：
//        改过 manifest 后必须**重启 server**，否则会看到陈旧的 MANIFEST_INVALID 假失败。
//      端口可用 E2E_API_PORT 覆盖（vite 代理目标见 vite.config.ts）。
//   3. 一个开了 remote-debugging 的浏览器：
//        "C:/Program Files/Google/Chrome/Application/chrome.exe" \
//          --remote-debugging-port=9222 --user-data-dir=<临时目录> http://localhost:5174/login
//      （CDP 不可用时本脚本会明确报错，不会假装通过）
//   4. 可用账号：默认 admin / Admin1234!（可用 E2E_USER / E2E_PASS 覆盖）
//
// 用法：
//   node scripts/e2e/e2e-mode-separation.mjs
// 退出码：0 = 全过；1 = 有断言失败；2 = 环境不可用（CDP 未起）
// ============================================================

import WebSocket from 'ws';
import http from 'http';

const PORT = Number(process.env.E2E_CDP_PORT) || 9222;
const BASE = process.env.E2E_BASE || 'http://localhost:5174';
const USER = process.env.E2E_USER || 'admin';
const PASS = process.env.E2E_PASS || 'Admin1234!';

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
// ★ 为什么用「编辑器标签」而不是「看板」：AutoWriteWorkbench 的看板是**标签切换**面板
//   （正文/看板互斥，见 TabBar variant='unified'），aria-label="看板" 只在**选中看板标签**时才渲染，
//   默认显示正文时不存在 —— 用它当断言会误判。而 unified 标签栏的 aria-label="编辑器标签"
//   是 AutoWriteWorkbench 独有（全仓仅此一处 variant='unified'）且**常驻**，是稳定的 auto 标记。
// ★ t10（AI 写作模块剥离）：auto 的 Web 实现已移出仓外 ⇒ auto 项目**不再**渲染这些标记。
//   本常量**保留**为**反向探针**（语义由「必须出现」反转为「不得出现」）：若 auto 被误装回/
//   实现被误接管，标记会 >0 ⇒ 断言立刻红（非恒真）。
const AUTO_MARKERS = { '状态栏': '[aria-label="状态栏"]', '智能体对话': '[aria-label="智能体对话"]', '编辑器标签': '[aria-label="编辑器标签"]' };

let failed = 0;
const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push({ ok, label, detail });
  if (!ok) failed++;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
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

// ---- 先探 CDP，不可用就直接退出（明确报错，不伪造通过）----
let page;
try {
  const pages = await getJson(`http://127.0.0.1:${PORT}/json`);
  page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('CDP 上没有 page 目标');
} catch (err) {
  console.error(`\n❌ 无法连接 CDP（127.0.0.1:${PORT}）：${err.message}`);
  console.error('   e2e 需要浏览器开 remote-debugging。手动步骤：');
  console.error(`   1) 起 dev：pnpm dev（web 在 ${BASE}，需 3774 上的 server）`);
  console.error('   2) 起带调试端口的浏览器：');
  console.error(`      "C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=${PORT} --user-data-dir=.workbuddy/e2e-chrome ${BASE}/login`);
  console.error('   3) 重跑本脚本');
  process.exit(2);
}

const ws = await connect(page.webSocketDebuggerUrl);
const consoleErrors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXC: ' + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
  }
});

async function evalJs(expression) {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) return { __exc: JSON.stringify(res.exceptionDetails).slice(0, 200) };
  return res.result?.value;
}
/** 轮询直到 expr 为真（返回其值），或超时返回最后一次值 */
async function waitFor(expr, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evalJs(expr);
    if (last) return last;
    await sleep(500);
  }
  return last;
}
/** 统计一组标记各自是否出现在 DOM 里 */
function markerExpr(markers) {
  const parts = Object.entries(markers).map(([name, sel]) => `${JSON.stringify(name)}: !!document.querySelector(${JSON.stringify(sel)})`);
  return `({${parts.join(', ')}})`;
}
const countTrue = (obj) => Object.values(obj ?? {}).filter(Boolean).length;

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Network.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

try {
  // ---- 1) 登录（清 localStorage → 走登录表单；token 走 HttpOnly cookie）----
  console.log('\n===== 1) 登录 =====');
  await send(ws, 'Page.navigate', { url: `${BASE}/login` });
  await sleep(3500);
  await evalJs(`(() => { const keys = []; for (let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i)); keys.forEach(k=>localStorage.removeItem(k)); return keys.length; })()`);
  await sleep(1000);
  const loginState = await evalJs(`(() => {
    const inputs = document.querySelectorAll('input');
    let user=null, pass=null;
    inputs.forEach((i)=>{ if(i.type==='text'&&i.placeholder&&i.placeholder.includes('用户名')) user=i; if(i.type==='password') pass=i; });
    if (!user || !pass) return { alreadyLoggedIn: true, path: location.pathname };
    const setVal=(el,val)=>{ const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,val); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    setVal(user, ${JSON.stringify(USER)}); setVal(pass, ${JSON.stringify(PASS)});
    const btn=Array.from(document.querySelectorAll('button')).find((b)=>b.textContent.includes('登录'));
    if(!btn) return { noBtn: true };
    btn.click(); return { submitted: true };
  })()`);
  console.log('login:', JSON.stringify(loginState));
  const okPath = await waitFor(`location.pathname !== '/login' ? location.pathname : ''`, 15000);
  check('登录成功（离开 /login）', !!okPath, `path=${okPath || await evalJs('location.pathname')}`);

  // ---- 2) 建两个项目（manual / auto）—— 页面内 fetch，带同源 cookie ----
  console.log('\n===== 2) 建 manual / auto 两个项目 =====');
  const stamp = Date.now().toString(36);
  const created = await evalJs(`(async () => {
    const mk = async (mode) => {
      const r = await fetch('/api/projects', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: 'e2e-mode-${stamp}-'+mode, mode }) });
      const j = await r.json().catch(()=>({}));
      return { status: r.status, id: j?.data?.id, mode: j?.data?.mode };
    };
    return { manual: await mk('manual'), auto: await mk('auto') };
  })()`);
  console.log('created:', JSON.stringify(created));
  check('创建 manual 项目', !!created?.manual?.id, JSON.stringify(created?.manual));
  check('创建 auto 项目', !!created?.auto?.id, JSON.stringify(created?.auto));
  const manualId = created?.manual?.id;
  const autoId = created?.auto?.id;

  // ---- 3) manual 项目：出现手写台，不出现 AI 写作 UI ----
  console.log('\n===== 3) manual 项目 =====');
  if (manualId) {
    await send(ws, 'Page.navigate', { url: `${BASE}/project/${manualId}` });
    await sleep(4500);
    await waitFor(`!!document.querySelector('[aria-label="面板菜单"]')`, 12000);
    const m = await evalJs(markerExpr(MANUAL_MARKERS));
    const a = await evalJs(markerExpr(AUTO_MARKERS));
    console.log('  manual markers:', JSON.stringify(m));
    console.log('  auto   markers:', JSON.stringify(a));
    check('manual 项目出现手写台停靠外壳标记（面板菜单 + 活动栏）', countTrue(m) === Object.keys(MANUAL_MARKERS).length,
      `命中 ${countTrue(m)}/${Object.keys(MANUAL_MARKERS).length}: ${JSON.stringify(m)}`);
    check('manual 项目**不出现** AI 写作 UI（状态栏/智能体对话/编辑器标签）', countTrue(a) === 0,
      `误现 ${countTrue(a)} 个: ${JSON.stringify(a)}`);
  }

  // ---- 4) auto 项目：出现 AutoWriteWorkbench，不出现手写面板 ----
  console.log('\n===== 4) auto 项目（实现已剥离 ⇒ 优雅降级）=====');
  if (autoId) {
    await send(ws, 'Page.navigate', { url: `${BASE}/project/${autoId}` });
    await sleep(4500);
    // ★ t10：auto Web 实现已移出 ⇒ 落 <WorkbenchMissing/>，而非 AutoWriteWorkbench。
    //   waitFor 成功返回最后一次 evalJs 的值（对象），超时返回 falsy ⇒ 显式判。
    const missingInfo = await waitFor(
      `(() => { const el = document.querySelector('[aria-label="工作台未安装"]');
         return el ? { ok: true, text: el.innerText } : null; })()`,
      15000);
    check('auto 项目渲染 <WorkbenchMissing/>（工作台未安装占位）',
      !!missingInfo && missingInfo.ok === true,
      `text=${JSON.stringify(missingInfo?.text ?? null)}`);
    check('占位文案点明「AI 写作台未安装」',
      typeof missingInfo?.text === 'string'
        && missingInfo.text.includes('AI 写作台') && missingInfo.text.includes('未安装'),
      `text=${JSON.stringify(missingInfo?.text ?? null)}`);
    const a = await evalJs(markerExpr(AUTO_MARKERS));
    const m = await evalJs(markerExpr(MANUAL_MARKERS));
    console.log('  auto   markers:', JSON.stringify(a));
    console.log('  manual markers:', JSON.stringify(m));
    check('auto 项目**不出现** AutoWriteWorkbench 标记（实现已移出，0/3）', countTrue(a) === 0,
      `命中 ${countTrue(a)}/${Object.keys(AUTO_MARKERS).length}: ${JSON.stringify(a)}`);
    check('auto 项目**不出现**手写台停靠外壳（面板菜单/活动栏）', countTrue(m) === 0,
      `误现 ${countTrue(m)} 个: ${JSON.stringify(m)}`);
  }

  // ---- 5) 清理临时项目 ----
  console.log('\n===== 5) 清理 =====');
  const cleaned = await evalJs(`(async () => {
    const ids = ${JSON.stringify([manualId, autoId].filter(Boolean))};
    const out = [];
    for (const id of ids) { const r = await fetch('/api/projects/'+id, { method:'DELETE' }); out.push(id+':'+r.status); }
    return out.join(', ');
  })()`);
  console.log('  deleted:', cleaned);
} catch (err) {
  check('e2e 执行未抛异常', false, err instanceof Error ? err.message : String(err));
} finally {
  // ★ t10：本脚本原有的 consoleErrors 只**打印**不断言（与 e2e-core-flows 不一致）。
  //   AI 写作模块剥离后，「auto 项目优雅降级」这条路径若有渲染异常（例如
  //   WorkbenchMissing 未接线、或降级本身抛错），正好应由本条捕获。故补一条
  //   断言 —— 这是**增强**（补齐四脚本里唯一缺失的 console 清零关卡），非弱化。
  check('全流程 console 错误为 0（consoleAPICalled type=error + exceptionThrown）',
    consoleErrors.length === 0, `${consoleErrors.length} 条`);
  if (consoleErrors.length) console.log('\nconsole errors（前 6 条）:', JSON.stringify(consoleErrors.slice(0, 6)));
  ws.close();
}

console.log(`\n${'='.repeat(60)}`);
if (failed === 0) {
  console.log('✅ e2e-mode-separation 全过');
} else {
  console.log(`❌ e2e-mode-separation：${failed} 项失败`);
  for (const r of results.filter((x) => !x.ok)) console.log(`   · ${r.label} — ${r.detail}`);
  console.log('   定位：manual 出现 AI UI / auto 出现手写外壳 → apps/web/src/components/shell/ProjectLayout.tsx'
    + '（mode 分流：workbench 槽 + 候选池按 mode 过滤）'
    + '、apps/web/src/plugin/registry.ts（条目 modes 标注与 filterByProjectMode）'
    + '、apps/web/src/plugin/moduleEntries.ts（模块入口构建期 glob；模块缺席 ⇒ 不渲染）'
    + '、apps/web/src/plugin/host.ts（ctx 扩展点注册）');
}
process.exit(failed === 0 ? 0 : 1);
