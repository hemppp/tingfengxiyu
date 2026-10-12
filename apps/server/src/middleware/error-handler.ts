// ============================================================
// 全局错误处理中间件
// 捕获异常并返回统一 JSON 格式 { error: { code, message, details?, requestId? } }
// 生产环境不暴露内部错误详情
// ============================================================

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
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

  // Hono 原生 HTTPException（如 zValidator 对畸形 JSON 抛的 400「Malformed JSON in
  // request body」）：状态码是异常语义的一部分，绝不能掉进 500 兜底。透传其响应；
  // 无自带响应体时按本项目 JSON 错误体包装，状态码保持异常声明的（400 等）。
  if (err instanceof HTTPException) {
    if (err.res) return err.res;
    return c.json(
      {
        error: {
          code: err.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
          message: err.message || '请求不合法',
          ...(requestId ? { requestId } : {}),
        },
      } satisfies ErrorResponse,
      err.status,
    );
  }

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