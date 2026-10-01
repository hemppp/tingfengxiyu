// ============================================================
// 全局错误处理中间件
// 捕获异常并返回统一 JSON 格式 { error: { code, message, details?, requestId? } }
// 生产环境不暴露内部错误详情
// ============================================================

import type { Context } from 'hono';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';

const isProduction = process.env.NODE_ENV === 'production';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function errorHandler(err: Error, c: Context): Response {
  // 生产环境生成 requestId 用于日志追溯
  const requestId = isProduction ? randomUUID() : undefined;
  console.error(`[ErrorHandler]${requestId ? ` [${requestId}]` : ''}`, err);

  // Zod 验证错误（dev 和 production 均返回详细验证信息）
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数验证失败',
          details: err.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
      } satisfies ErrorResponse,
      400,
    );
  }

  // 通用错误
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? '服务器内部错误' : (err.message || '服务器内部错误'),
        ...(requestId ? { requestId } : {}),
      },
    } satisfies ErrorResponse,
    500,
  );
}