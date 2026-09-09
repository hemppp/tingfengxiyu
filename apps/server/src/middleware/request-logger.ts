// ============================================================
// 请求日志中间件
// 记录 method、path、status、duration
// ============================================================

import type { Context, Next } from 'hono';

export async function requestLogger(c: Context, next: Next): Promise<void> {
  const start = Date.now();
  const { method } = c.req;
  const path = c.req.path;

  // 用 try/finally 确保即使 next() 抛出异常也能记录请求日志
  try {
    await next();
  } finally {
    const duration = Date.now() - start;
    const status = c.res.status;

    console.log(`[${method}] ${path} → ${status} (${duration}ms)`);
  }
}