// ============================================================
// 认证路由模块
// 提供注册、登录、刷新 Token、获取当前用户、登出等接口
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import type { AuthVariables } from '../middleware/auth.js';
import {
  registerUser,
  authenticateUser,
  getUserById,
  checkUsernameExists,
} from '../services/auth-service.js';
import { verifyToken, signToken, revokeToken } from '../lib/jwt.js';
import { setAuthCookie, clearAuthCookie, getAuthCookie } from '../lib/cookies.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { safeBusiness, safeInternal, safeTokenError } from '../lib/safe-error.js';

// 登录/注册接口防暴力破解：每 IP 每分钟最多 10 次
// keyBy='ip' 因为这些接口在认证之前调用，无法获取 userId
const authRateLimit = rateLimit({ maxRequests: 10, windowMs: 60_000, keyBy: 'ip' });

// ---- C10：注册开关 ----
// 生产环境默认关闭注册（LAN/公网暴露时防止任意注册占用 AI 额度/密钥）；
// 显式设置 ALLOW_REGISTRATION=true 可开启，开发环境（非 production）默认开启。
const REGISTRATION_ENABLED =
  process.env.ALLOW_REGISTRATION === undefined
    ? process.env.NODE_ENV !== 'production'
    : process.env.ALLOW_REGISTRATION === 'true';

// ---- Zod 验证 Schema ----

/** 注册请求体 Schema */
const registerSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(32, '用户名最多 32 个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  password: z
    .string()
    .min(8, '密码至少 8 个字符')
    .max(128, '密码最多 128 个字符')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码必须包含大小写字母和数字'),
  displayName: z
    .string()
    .min(1, '昵称不能为空')
    .max(50, '昵称最多 50 个字符'),
});

/** 登录请求体 Schema */
const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});

// ---- 路由定义 ----

const router = new Hono<{ Variables: AuthVariables }>();

/**
 * POST /api/auth/register
 * 注册新用户（成功即登录：写入 HttpOnly 认证 Cookie）
 *
 * @requestBody { username, password, displayName }
 * @response 201 { data: { user } }（token 不再返回给前端，见 C4）
 * @response 400 { error: { code: 'VALIDATION_ERROR', ... } }
 * @response 409 { error: { code: 'CONFLICT', message: '用户名已被占用' } }
 */
router.post('/register', authRateLimit, zValidator('json', registerSchema), async (c) => {
  const body = c.req.valid('json') as z.infer<typeof registerSchema>;

  // C10：注册开关（生产默认关闭）
  if (!REGISTRATION_ENABLED) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: '注册已关闭。如需开放，请设置环境变量 ALLOW_REGISTRATION=true 后重启服务',
        },
      },
      403,
    );
  }

  try {
    const result = await registerUser(body.username, body.password, body.displayName);
    setAuthCookie(c, result.token);
    return c.json({ data: { user: result.user } }, 201);
  } catch (error) {
    // 仅暴露已知的业务错误消息，其余内部错误统一脱敏
    const message = safeBusiness(error, ['用户名已被占用'], '注册失败', '[Auth Register]');
    const isConflict = message === '用户名已被占用';

    return c.json(
      {
        error: {
          code: isConflict ? 'CONFLICT' : 'INTERNAL_ERROR',
          message: isConflict ? message : safeInternal(error, '注册失败', '[Auth Register]'),
        },
      },
      isConflict ? 409 : 500,
    );
  }
});

/**
 * POST /api/auth/login
 * 用户登录（写入 HttpOnly 认证 Cookie）
 *
 * @requestBody { username, password }
 * @response 200 { data: { user } }（token 不再返回给前端，见 C4）
 * @response 400 { error: { code: 'VALIDATION_ERROR', ... } }
 * @response 401 { error: { code: 'UNAUTHORIZED', message: '用户名或密码错误' } }
 */
router.post('/login', authRateLimit, zValidator('json', loginSchema), async (c) => {
  const body = c.req.valid('json') as z.infer<typeof loginSchema>;

  try {
    const result = await authenticateUser(body.username, body.password);
    setAuthCookie(c, result.token);
    return c.json({ data: { user: result.user } });
  } catch (error) {
    // 仅暴露凭据错误消息，其余内部错误统一脱敏
    const message = safeBusiness(error, ['用户名或密码错误'], '登录失败', '[Auth Login]');
    const isUnauthorized = message === '用户名或密码错误';

    return c.json(
      {
        error: {
          code: isUnauthorized ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
          message: isUnauthorized ? message : safeInternal(error, '登录失败', '[Auth Login]'),
        },
      },
      isUnauthorized ? 401 : 500,
    );
  }
});

/**
 * POST /api/auth/refresh
 * 刷新 JWT Token（写入新的 HttpOnly Cookie）
 *
 * 验证当前 Token 有效性并签发新的 Token（token 来源：Authorization 头 / Cookie）
 *
 * @requestBody { token? } - 可选，优先从 Authorization header 获取
 * @response 200 { data: { user } }
 * @response 401 { error: { code: 'UNAUTHORIZED' } }
 */
router.post('/refresh', authRateLimit, async (c) => {
  // 尝试从请求体或 header 获取 Token
  let token: string | undefined;

  // 1. 尝试从请求体获取
  try {
    const body = await c.req.parseBody();
    if (body.token && typeof body.token === 'string') {
      token = body.token;
    }
  } catch {
    // 忽略解析错误
  }

  // 2. 从 Authorization header 获取
  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  // 3. 从认证 Cookie 获取（C4）
  if (!token) {
    token = getAuthCookie(c);
  }

  if (!token) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: '缺少认证令牌',
        },
      },
      401,
    );
  }

  // 验证旧 Token 并签发新 Token
  try {
    const payload = verifyToken(token);

    // 验证用户是否仍然存在
    const user = await getUserById(payload.userId);
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: '用户不存在或已被删除',
          },
        },
        401,
      );
    }

    // 签发新 Token 并写入 Cookie
    const newToken = signToken({ userId: payload.userId, username: payload.username });
    setAuthCookie(c, newToken);

    return c.json({
      data: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          isAdmin: user.isAdmin,
        },
      },
    });
  } catch (error) {
    // 不暴露 jwt malformed / jwt expired 等内部细节
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: safeTokenError(error, '[Auth Refresh]'),
        },
      },
      401,
    );
  }
});

/**
 * GET /api/auth/me
 * 获取当前登录用户信息
 *
 * 需要认证：Bearer Token
 *
 * @response 200 { data: { id, username, displayName, avatar, ... } }
 * @response 401 { error: { code: 'UNAUTHORIZED' } }
 */
router.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json({ data: user });
});

/**
 * GET /api/auth/check-username?username=xxx
 * 检查用户名是否已被占用（注册页实时检测用）
 *
 * @response 200 { data: { username, available } }
 */
router.get('/check-username', authRateLimit, async (c) => {
  const username = c.req.query('username')?.trim() ?? '';
  if (!username || username.length < 3) {
    return c.json({ data: { username, available: false, reason: 'too_short' } });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return c.json({ data: { username, available: false, reason: 'invalid_chars' } });
  }
  try {
    const exists = await checkUsernameExists(username);
    return c.json({
      data: {
        username,
        available: !exists,
        reason: exists ? 'taken' : 'ok',
      },
    });
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: safeInternal(error, '检查失败', '[Auth CheckUsername]'),
        },
      },
      500,
    );
  }
});

/**
 * POST /api/auth/logout
 * 登出（吊销 token + 清除认证 Cookie）
 *
 * @response 200 { data: { message: '登出成功' } }
 */
router.post('/logout', async (c) => {
  // 提取 token（Authorization 头或 Cookie）并吊销
  let token: string | undefined;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }
  if (!token) {
    token = getAuthCookie(c);
  }
  if (token) {
    try {
      revokeToken(token);
    } catch (error) {
      // token 无效或已过期，仍返回登出成功（客户端会清除本地状态）
      console.warn('[Auth Logout] 吊销 token 失败:', error instanceof Error ? error.message : error);
    }
  }
  clearAuthCookie(c);
  return c.json({ data: { message: '登出成功' } });
});

export default router;
