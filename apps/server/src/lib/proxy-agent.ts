// ============================================================
// 代理配置 - 让 server 的 fetch 走系统代理
//
// Node.js 原生 fetch（基于 undici）不会自动读取 HTTP_PROXY/HTTPS_PROXY 环境变量。
// 在中国大陆直连 OpenAI 等被墙服务时，TCP 连接会被 GFW 丢弃，
// 导致 ETIMEDOUT 错误。此模块在 server 启动时设置全局 dispatcher，
// 让所有 fetch 请求自动走代理。
//
// 支持的环境变量：
//   HTTPS_PROXY / https_proxy  - HTTPS 请求代理
//   HTTP_PROXY  / http_proxy   - HTTP 请求代理
//   NO_PROXY    / no_proxy     - 不走代理的域名（逗号分隔）
//
// 若环境变量未设置，会自动探测本机常见代理软件的监听端口
// （Clash Verge 默认 7897、Clash 默认 7890、v2rayN 默认 10809 等）。
// ============================================================

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { createConnection } from 'net';

let proxyConfigured = false;
let activeProxyUrl: string | null = null;
let proxySource: 'env' | 'auto-detected' | 'none' = 'none';

/** 常见代理软件的默认监听端口（按流行度排序） */
const COMMON_PROXY_PORTS = [7897, 7890, 10809, 10808, 1080, 8080, 8388, 2080, 7891];

/**
 * 并发探测本机常见代理端口，返回第一个可连接的。
 * 单个端口超时 300ms，整体最长 ~400ms。
 */
async function detectProxyPortAsync(): Promise<number | null> {
  const probe = (port: number): Promise<number | null> => new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port, timeout: 300 });
    const cleanup = () => { try { sock.destroy(); } catch { /* 忽略 */ } };
    sock.once('connect', () => { cleanup(); resolve(port); });
    sock.once('error', () => { cleanup(); resolve(null); });
    sock.once('timeout', () => { cleanup(); resolve(null); });
  });

  // 并发探测所有候选端口，取第一个成功的
  const results = await Promise.all(COMMON_PROXY_PORTS.map(probe));
  return results.find((p): p is number => p !== null) ?? null;
}

/**
 * 初始化代理配置。在 server 启动时调用一次。
 * 优先级：HTTPS_PROXY 环境变量 > 自动探测本机代理端口 > 不启用代理。
 * ★ 使用 EnvHttpProxyAgent 落实 NO_PROXY：直连可达的域名（如部分国内中转站）
 *   走代理反而会被掐断长流（推理模型一条流可长达数分钟）。
 */
export async function initProxy(): Promise<void> {
  if (proxyConfigured) return;

  // 桌面端（Electron）设置 DISABLE_PROXY_DETECT=1 跳过自动探测
  // 用户机器上可能没有代理软件，探测会浪费 400ms 启动时间
  if (process.env.DISABLE_PROXY_DETECT === '1') {
    proxySource = 'none';
    proxyConfigured = true;
    console.log('[Proxy] 已跳过代理探测（DISABLE_PROXY_DETECT=1）');
    return;
  }

  // 1) 优先读取环境变量
  const envProxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    '';

  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1').trim();

  const applyProxy = (proxyUrl: string, source: 'env' | 'auto-detected'): boolean => {
    try {
      process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || proxyUrl;
      process.env.HTTP_PROXY = process.env.HTTP_PROXY || proxyUrl;
      process.env.NO_PROXY = noProxy;
      setGlobalDispatcher(new EnvHttpProxyAgent({
        httpProxy: proxyUrl,
        httpsProxy: proxyUrl,
        noProxy,
      }));
      activeProxyUrl = proxyUrl;
      proxySource = source;
      proxyConfigured = true;
      console.log(`[Proxy] 已启用代理(${source === 'env' ? '来自环境变量' : '自动探测'}): ${maskProxyUrl(proxyUrl)} (NO_PROXY: ${noProxy})`);
      return true;
    } catch (e) {
      console.error('[Proxy] 代理初始化失败:', e);
      return false;
    }
  };

  if (envProxyUrl && applyProxy(envProxyUrl, 'env')) return;

  // 2) 自动探测本机常见代理端口（仅当环境变量未设置时）
  const detectedPort = await detectProxyPortAsync();
  if (detectedPort && applyProxy(`http://127.0.0.1:${detectedPort}`, 'auto-detected')) return;

  // 3) 未找到代理
  proxySource = 'none';
  proxyConfigured = true;
  console.log(`[Proxy] 未检测到代理。若访问被墙服务超时，请：`);
  console.log(`[Proxy]   1) 启动代理软件（Clash/V2Ray 等），或`);
  console.log(`[Proxy]   2) 设置环境变量 HTTPS_PROXY=http://127.0.0.1:<端口>，或`);
  console.log(`[Proxy]   3) 改用国内可达的 AI 服务（如 DeepSeek/智谱/通义）`);
}

/** 脱敏代理 URL（隐藏用户名密码） */
function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      return `${u.protocol}//***:***@${u.hostname}:${u.port}`;
    }
    return `${u.protocol}//${u.hostname}:${u.port}`;
  } catch {
    return url;
  }
}

/** 获取当前激活的代理 URL（用于诊断日志） */
export function getActiveProxy(): string | null {
  return activeProxyUrl;
}

/** 获取代理来源：'env' | 'auto-detected' | 'none' */
export function getProxySource(): 'env' | 'auto-detected' | 'none' {
  return proxySource;
}
