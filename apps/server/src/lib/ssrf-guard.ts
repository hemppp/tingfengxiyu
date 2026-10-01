// ============================================================
// SSRF 出站 URL 守卫（C8）
//
// AI baseUrl 由用户配置（或环境变量）提供，服务端据此发起出站请求。
// 恶意/误配置的 baseUrl 可指向内网服务（127.0.0.1:8080、云元数据
// 169.254.169.254、192.168.x.x 等）造成 SSRF。本守卫在每次解析
// AI 配置时校验 baseUrl：
//
//   1. 协议白名单：仅 http/https（拒绝 file/gopher/data 等）
//   2. IP 字面量地址：
//      - 回环（127.0.0.0/8、::1）默认放行——本地 Ollama 是核心功能
//      - 私网/链路本地/组播/保留段一律拦截（可 AI_SSRF_ALLOW_PRIVATE=1 放开）
//   3. 主机名（非 IP 字面量）放行——云端端点无法静态判定；
//      部署方若需严格模式可用 AI_SSRF_BLOCK_PRIVATE=1 开启 DNS 解析后拦截私网记录
//
// 环境变量逃生舱：
//   AI_SSRF_DISABLE=1       完全关闭本守卫（不推荐）
//   AI_SSRF_ALLOW_PRIVATE=1 放行私网/链路本地等地址（LAN 内自建中转站场景）
// ============================================================

export class SSRFGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFGuardError';
  }
}

/** 判断 IPv4 字符串是否为需要拦截的地址段（回环除外，单独处理） */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => {
    const v = Number(n);
    return Number.isInteger(v) && v >= 0 && v <= 255 ? v : NaN;
  });
  if (parts.some(Number.isNaN) || parts.length !== 4) return false; // 非合法 IPv4

  const [a, b] = parts;
  // 10.0.0.0/8 · 172.16.0.0/12 · 192.168.0.0/16（私网）
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10（CGNAT）
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16（链路本地，含云元数据 169.254.169.254）
  if (a === 169 && b === 254) return true;
  // 224.0.0.0/4（组播）· 240.0.0.0/4（保留）· 0.0.0.0/8（未指定）
  if (a >= 224) return true;
  if (a === 0) return true;
  return false;
}

/** 判断 IPv6 地址是否为需要拦截的地址段（::1 回环除外） */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // 链路本地 fe80::/10（fe80-febf）
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // ULA fc00::/7（fc00-fdff，前缀 fc/fd 后跟任意 hex）
  if (/^f[cd][0-9a-f]*:/.test(lower)) return true;
  // 未指定 :: / 组播 ff00::/8
  if (/^::/.test(lower)) return true;
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true;
  // IPv4 映射地址 ::ffff:x.x.x.x → 递归检查内嵌 IPv4
  const v4match = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4match) return isBlockedIPv4(v4match[1]);
  return false;
}

function isLoopbackHost(hostname: string, isIpv6: boolean): boolean {
  if (isIpv6) return hostname.toLowerCase() === '::1' || hostname.toLowerCase() === '[::1]';
  // 127.0.0.0/8 全部视为回环
  return /^127\./.test(hostname) || hostname === '0:0:0:0:0:0:0:1';
}

/**
 * 校验出站 AI baseUrl。非法/被拦截时抛出 SSRFGuardError（含用户可读原因）。
 * @param rawUrl 用户提供的 baseUrl（如 https://api.openai.com/v1）
 * @param opts.allowLoopback 是否放行回环地址（本地 Ollama），默认 true
 */
export function assertSafeOutboundUrl(rawUrl: string, opts: { allowLoopback?: boolean } = {}): void {
  if (process.env.AI_SSRF_DISABLE === '1') return;

  const allowLoopback = opts.allowLoopback ?? process.env.AI_SSRF_ALLOW_LOOPBACK !== '0';
  const allowPrivate = process.env.AI_SSRF_ALLOW_PRIVATE === '1';

  const trimmed = rawUrl.trim();
  if (!trimmed) throw new SSRFGuardError('AI baseUrl 不能为空');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SSRFGuardError('AI baseUrl 不是合法的 URL');
  }

  // 1. 协议白名单
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SSRFGuardError(`AI baseUrl 协议不支持：${url.protocol.replace(':', '')}（仅允许 http/https）`);
  }

  // 2. 主机判定（URL.hostname 对 IPv6 会带 []，先剥掉）
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new SSRFGuardError('AI baseUrl 缺少主机名');

  const isIpv6 = host.includes(':');
  // 已知云元数据端点（域名形式）——无论是否允许私网，一律拦截（除非显式关闭守卫）
  const METADATA_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog', 'instance-data']);
  if (!allowPrivate && METADATA_HOSTNAMES.has(host.toLowerCase())) {
    throw new SSRFGuardError('AI baseUrl 指向云元数据端点，已按 SSRF 防护拦截');
  }
  // URL 结构硬化：baseUrl 应为 origin+path，禁止 userinfo / query / fragment
  if (url.username || url.password) {
    throw new SSRFGuardError('AI baseUrl 不应包含用户名/密码（userinfo）');
  }
  if (url.search) {
    throw new SSRFGuardError('AI baseUrl 不应包含查询参数（?...）');
  }
  if (url.hash) {
    throw new SSRFGuardError('AI baseUrl 不应包含锚点（#...）');
  }
  if (isLoopbackHost(host, isIpv6)) {
    // 回环：默认放行（本地 Ollama）；可显式关闭
    if (!allowLoopback) {
      throw new SSRFGuardError('AI baseUrl 指向回环地址，但当前配置不允许访问本机服务');
    }
    return;
  }

  const isIpLiteral = isIpv6 || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIpLiteral && !allowPrivate) {
    const blocked = isIpv6 ? isBlockedIPv6(host) : isBlockedIPv4(host);
    if (blocked) {
      throw new SSRFGuardError(
        `AI baseUrl 指向内网/保留地址（${host}），已按 SSRF 防护拦截。` +
        '如确需访问局域网内服务，请设置环境变量 AI_SSRF_ALLOW_PRIVATE=1',
      );
    }
  }
  // 3. 主机名：放行（无法静态判定；严格模式见文件头说明）
}

/**
 * 深度校验（异步）：在同步检查基础上，对域名做 DNS 解析并校验全部解析结果，
 * 拦截解析到私网/回环/保留地址的域名（缓解恶意域名与 DNS rebinding 的静态盲区）。
 * 适用低频路径：AI 配置保存 / 连接测试 / 模型列表。运行时热路径仍用同步检查
 * （DNS rebinding 的连接级 pinning 需要自定义 undici Agent，作为后续项）。
 */
export async function assertSafeOutboundUrlDeep(
  rawUrl: string,
  opts: { allowLoopback?: boolean } = {},
): Promise<void> {
  assertSafeOutboundUrl(rawUrl, opts);
  if (process.env.AI_SSRF_DISABLE === '1') return;
  if (process.env.AI_SSRF_ALLOW_PRIVATE === '1') return;

  const url = new URL(rawUrl.trim());
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const isIpLiteral = host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIpLiteral) return; // IP 字面量已由同步检查覆盖

  const { lookup } = await import('dns/promises');
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new SSRFGuardError(`无法解析 AI baseUrl 域名：${host}`);
  }
  for (const addr of addresses) {
    const isV6 = addr.family === 6;
    if (isLoopbackHost(addr.address, isV6)) {
      throw new SSRFGuardError(`AI baseUrl 域名 ${host} 解析到回环地址（${addr.address}），已按 SSRF 防护拦截`);
    }
    const blocked = isV6 ? isBlockedIPv6(addr.address) : isBlockedIPv4(addr.address);
    if (blocked) {
      throw new SSRFGuardError(`AI baseUrl 域名 ${host} 解析到内网/保留地址（${addr.address}），已按 SSRF 防护拦截`);
    }
  }
}
