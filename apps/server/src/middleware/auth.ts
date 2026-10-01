import type { Context, Next } from 'hono';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { safeTokenError } from '../lib/safe-error.js';
import { getAuthCookie } from '../lib/cookies.js';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin?: boolean;
}

export type AuthVariables = {
  user: AuthUser;
};

/**
 * 提取认证令牌：优先 Authorization: Bearer 头（兼容旧客户端/内部调用），
 * 其次 HttpOnly Cookie（C4 迁移后的主通道）。
 */
function extractToken(c: Context): string | undefined {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token) return token;
  }
  return getAuthCookie(c);
}

export async function requireAuth(c: Context<{ Variables: AuthVariables }>, next: Next) {
  const token = extractToken(c);
  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: '缺少或无效的认证令牌' } }, 401);
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch (error) {
    // 不暴露 jwt malformed / jwt expired / invalid signature 等内部细节
    return c.json({ error: { code: 'UNAUTHORIZED', message: safeTokenError(error, '[Auth Middleware]') } }, 401);
  }

  try {
    const { getUserById } = await import('../services/auth-service.js');
    const user = await getUserById(payload.userId);
    if (!user) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: '用户不存在或已被删除' } }, 401);
    }
    c.set('user', {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    });
    await next();
  } catch (error) {
    console.error('[Auth Middleware] 查询用户失败:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '认证服务暂时不可用' } }, 500);
  }
}

/**
 * 要求当前用户是管理员。必须挂在 requireAuth 之后。
 */
export async function requireAdmin(c: Context<{ Variables: AuthVariables }>, next: Next) {
  const user = c.get('user');
  if (!user?.isAdmin) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: '需要管理员权限' } },
      403,
    );
  }
  await next();
}

export async function optionalAuth(c: Context<{ Variables: Partial<AuthVariables> }>, next: Next) {
  const token = extractToken(c);
  if (token) {
    try {
      const payload = verifyToken(token);
      const { getUserById } = await import('../services/auth-service.js');
      const user = await getUserById(payload.userId);
      if (user) {
        c.set('user', { id: user.id, username: user.username, displayName: user.displayName });
      }
    } catch (error) {
      console.warn('[Auth Middleware] optionalAuth token 验证失败:', error instanceof Error ? error.message : error);
    }
  }
  await next();
}
