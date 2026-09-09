// CDP 完整流程：清空状态 → 登录 → 书架 → 检查
import WebSocket from 'ws';
import http from 'http';

const PORT = 9222;
const BASE = 'http://localhost:5174';

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
const pages = await getJson(`http://127.0.0.1:${PORT}/json`);
const page = pages.find((p) => p.type === 'page');
const ws = await connect(page.webSocketDebuggerUrl);
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
async function evalJs(expression) {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) return 'EXC:' + JSON.stringify(res.exceptionDetails).slice(0, 150);
  return res.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Network.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// 捕获 console 错误
const consoleErrors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 150));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXC: ' + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
  }
});

// 1) 清空所有本地状态（模拟用户彻底退出）
await send(ws, 'Page.navigate', { url: `${BASE}/login` });
await sleep(3500);
await evalJs(`(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  keys.forEach((k) => localStorage.removeItem(k));
  return 'cleared: ' + keys.join(',');
})()`);
console.log('localStorage cleared');

// 2) 重新登录
await sleep(1500);
await evalJs(`(() => {
  const setVal = (el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = document.querySelectorAll('input');
  let user = null, pass = null;
  inputs.forEach((i) => {
    if (i.type === 'text' && i.placeholder && i.placeholder.includes('用户名')) user = i;
    if (i.type === 'password') pass = i;
  });
  if (!user || !pass) return 'inputs not found: ' + document.body.innerText.slice(0, 80);
  setVal(user, 'graph3d_test');
  setVal(pass, 'Test1234!');
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('登录'));
  if (!btn) return 'no login btn';
  btn.click();
  return 'submitted';
})()`);
await sleep(5000);
console.log('after login:', await evalJs('location.pathname'));

// 3) 书架内容 + token 状态
const s = await evalJs(`(() => {
  const names = Array.from(document.querySelectorAll('*')).filter((el) => el.children.length === 0 && /^(3D测试书|1)$/.test(el.textContent.trim()));
  return {
    path: location.pathname,
    books: names.length,
    hasToken: !!localStorage.getItem('novelmuse_token'),
    authPersist: localStorage.getItem('novelmuse_auth'),
  };
})()`);
console.log('bookshelf:', JSON.stringify(s));

// 4) 刷新一次（用户会做的操作）
await send(ws, 'Page.reload', { ignoreCache: true });
await sleep(6000);
const s2 = await evalJs(`(() => {
  const names = Array.from(document.querySelectorAll('*')).filter((el) => el.children.length === 0 && /^(3D测试书|1)$/.test(el.textContent.trim()));
  return { path: location.pathname, books: names.length };
})()`);
console.log('after reload:', JSON.stringify(s2));
console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 6)));
ws.close();
process.exit(0);
