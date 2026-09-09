// ============================================================
// 速率限制中间件 — 基于内存的滑动窗口限流
// ============================================================

import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * 获取客户端真实 IP。
 *
 * 优先使用 Hono node-server 提供的连接远程地址（TCP socket remoteAddress），
 * 该值由服务器内核填充，客户端无法伪造。
 *
 * 仅当连接信息不可用（如非 node-server 运行时、或测试环境）时，
 * 才回退到 X-Forwarded-For / X-Real-IP header。
 * ⚠️ 回退路径有伪造风险：仅在可信代理后部署时才应信任这些 header，
 *    生产环境建议始终通过反向代理将真实 IP 注入 socket（如 PROXY protocol），
 *    或在中间件中显式校验上游代理白名单后再读取 header。
 */
function getClientIp(c: Context): string {
  try {
    const info = getConnInfo(c);
    const addr = info?.remote?.address;
    if (addr) return addr;
  } catch {
    // getConnInfo 在非 node-server 环境下可能抛错，忽略后回退到 header
  }

  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'anonymous'
  );
}

const buckets = new Map<string, RateLimitEntry>();

// 定期清理过期条目（每 5 分钟）
// unref() 让定时器不阻止进程退出；shutdown 时由进程生命周期回收
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

export interface RateLimitConfig {
  /** 时间窗口（毫秒），默认 60000（1 分钟） */
  windowMs?: number;
  /** 窗口内最大请求数 */
  maxRequests?: number;
  /** 限流维度：'user' 按用户 ID，'ip' 按 IP */
  keyBy?: 'user' | 'ip';
}

/**
 * 创建速率限制中间件。
 *
 * @example
 * ```ts
 * // 每用户每分钟最多 20 次 AI 请求
 * router.post('/ai/*', rateLimit({ maxRequests: 20 }), handler);
 * ```
 */
export function rateLimit(config: RateLimitConfig = {}) {
  const {
    windowMs = 60_000,
    maxRequests = 20,
    keyBy = 'user',
  } = config;

  return async (c: Context, next: Next) => {
    let key: string;

    if (keyBy === 'user') {
      const user = c.get('user' as never) as { id?: string } | undefined;
      // 已登录用户按 userId 限流；未登录时回退到连接 IP，避免匿名用户绕过限流
      key = user?.id || getClientIp(c);
    } else {
      key = getClientIp(c);
    }

    const bucketKey = `${keyBy}:${key}`;
    const now = Date.now();
    let entry = buckets.get(bucketKey);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, entry);
    }

    entry.count++;

    // 设置速率限制响应头
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `请求过于频繁，请在 ${retryAfter} 秒后重试`,
          },
        },
        429,
      );
    }

    await next();
  };
}
