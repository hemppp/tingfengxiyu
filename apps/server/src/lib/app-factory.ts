// ============================================================
// Hono 应用工厂
// 集中配置 CORS、安全响应头、请求体大小限制、错误处理、日志
//
// 认证中间件说明：
// - requireAuth: 强制认证，用于受保护的路由（从 middleware/auth 导入）
// - optionalAuth: 可选认证，用于需要区分登录状态的路由
// - 使用方式：在具体路由中按需引入，如 router.get('/protected', requireAuth, handler)
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestLogger } from '../middleware/request-logger.js';
import { errorHandler } from '../middleware/error-handler.js';

export function createApp(): Hono {
  const app = new Hono();

  // CORS - 允许 localhost（带/不带端口）+ 局域网 IP（带端口）
  // 单机/局域网写作工具，放宽 origin 限制以支持：
  //   - 本地开发: http://localhost:5174, http://127.0.0.1:5174
  //   - 端口转发/隧道映射到本地默认端口: http://localhost, http://127.0.0.1
  //   - 局域网直接访问服务器: http://192.168.x.x:3774, http://10.x.x.x:3774
  app.use('*', cors({
    origin: (origin) => {
      // C12：不再对缺失 Origin 的请求回退 '*'（历史遗留）。
      // 无 Origin 的请求（curl/健康检查等非浏览器客户端）本就无需 CORS 头；
      // 浏览器同源请求（经 vite 代理/静态托管）也不依赖 ACAO。
      // 结合 C4 的 Cookie 鉴权 + credentials:true，任何跨源响应都必须有明确授权来源。
      if (!origin) return null;
      // localhost / 127.0.0.1，端口可选
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
      // 局域网私有 IP（RFC1918），端口可选
      if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) return origin;
      // 额外白名单（逗号分隔，精确匹配）：反向代理/隧道等自有公网域名，
      // 如 CORS_EXTRA_ORIGINS=https://novel.dadfafwada.dpdns.org
      const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (extraOrigins.includes(origin)) return origin;
      console.warn(`[CORS] 拒绝来源: ${origin}`);
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    // C4：跨源（局域网直连 3774）时允许携带认证 Cookie
    credentials: true,
    maxAge: 86400,
  }));

  // 安全响应头
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  // 请求体大小限制（5MB）
  app.use('*', async (c, next) => {
    const contentLength = parseInt(c.req.header('content-length') || '0', 10);
    const MAX_BODY_SIZE = 5 * 1024 * 1024;
    if (contentLength > MAX_BODY_SIZE) {
      return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' } }, 413);
    }
    await next();
  });

  // 请求日志
  app.use('*', requestLogger);

  // 全局错误处理
  app.onError(errorHandler);

  return app;
}