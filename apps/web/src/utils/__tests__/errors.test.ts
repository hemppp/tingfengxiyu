/**
 * @fileoverview 错误处理系统单元测试
 * 测试 ErrorCategory 枚举、AppError 类、categorizeError 函数等错误分类逻辑
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ErrorCategory,
  AppError,
  categorizeError,
  isRecoverableError,
  dispatchApiErrorEvent,
  dispatchToastEvent,
} from '../errors';
import { ApiError } from '@/services/api/apiClient';

describe('categorizeError', () => {
  describe('ApiError 分类', () => {
    it('将 ApiError(401) 分类为 AUTHENTICATION', () => {
      const apiError = new ApiError(401, 'UNAUTHORIZED', '登录已过期');

      const result = categorizeError(apiError);

      expect(result).toBeInstanceOf(AppError);
      expect(result.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(result.code).toBe('UNAUTHORIZED');
      expect(result.message).toBe('登录已过期');
      expect(result.recoverable).toBe(false);
    });

    it('将 ApiError(403) 分类为 AUTHENTICATION', () => {
      const apiError = new ApiError(403, 'FORBIDDEN', '没有权限执行此操作');

      const result = categorizeError(apiError);

      expect(result.category).toBe(ErrorCategory.AUTHENTICATION);
    });

    it('将 ApiError(400) 分类为 VALIDATION', () => {
      const apiError = new ApiError(400, 'BAD_REQUEST', '请求参数错误');

      const result = categorizeError(apiError);

      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(true);
    });

    it('将 ApiError(422) 分类为 VALIDATION', () => {
      const apiError = new ApiError(422, 'UNPROCESSABLE_ENTITY', '数据验证失败');

      const result = categorizeError(apiError);

      expect(result.category).toBe(ErrorCategory.VALIDATION);
    });

    it('将 ApiError(404) 分类为 NOT_FOUND', () => {
      const apiError = new ApiError(404, 'NOT_FOUND', '请求的资源不存在');

      const result = categorizeError(apiError);

      expect(result.category).toBe(ErrorCategory.NOT_FOUND);
    });

    it('将 ApiError(500) 分类为 SERVER', () => {
      const apiError = new ApiError(500, 'INTERNAL_SERVER_ERROR', '服务器内部错误');

      const result = categorizeError(apiError);

      expect(result.category).toBe(ErrorCategory.SERVER);
    });

    it('将 ApiError(status=0) 分类为 NETWORK', () => {
      const apiError = new ApiError(0, 'NETWORK_ERROR', '网络连接失败');

      const result = categorizeError(apiError);

      expect(result.category).toBe(ErrorCategory.NETWORK);
    });
  });

  describe('DOMException(TIMEOUT) 分类', () => {
    it('将 DOMException(TIMEOUT/AbortError) 分类为 NETWORK', () => {
      const abortError = new Error('请求超时');
      Object.defineProperty(abortError, 'name', { value: 'AbortError' });

      const result = categorizeError(abortError);

      expect(result).toBeInstanceOf(AppError);
      expect(result.category).toBe(ErrorCategory.NETWORK);
      expect(result.code).toBe('TIMEOUT');
      expect(result.recoverable).toBe(true);
    });
  });

  describe('普通 Error 分类', () => {
    it('将 Error 分类为 UNKNOWN', () => {
      const genericError = new Error('发生了未知错误');

      const result = categorizeError(genericError);

      expect(result).toBeInstanceOf(AppError);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('包含 "network" 关键词的 Error 分类为 NETWORK', () => {
      const networkError = new Error('Network request failed');

      const result = categorizeError(networkError);

      expect(result.category).toBe(ErrorCategory.NETWORK);
      expect(result.code).toBe('NETWORK_ERROR');
    });

    it('包含 "Failed to fetch" 的 Error 分类为 NETWORK', () => {
      const fetchError = new Error('Failed to fetch');

      const result = categorizeError(fetchError);

      expect(result.category).toBe(ErrorCategory.NETWORK);
    });
  });

  describe('非 Error 类型处理', () => {
    it('null 错误返回 UNKNOWN 类别', () => {
      const result = categorizeError(null);

      expect(result).toBeInstanceOf(AppError);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.message).toContain('Null');
    });

    it('undefined 错误返回 UNKNOWN 类别', () => {
      const result = categorizeError(undefined);

      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.message).toContain('Undefined');
    });

    it('字符串错误返回 UNKNOWN 类别', () => {
      const result = categorizeError('字符串错误信息');

      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.message).toBe('字符串错误信息');
    });
  });

  describe('已经是 AppError 的输入', () => {
    it('直接返回原始 AppError 实例', () => {
      const originalError = new AppError(
        ErrorCategory.SERVER,
        '服务器崩溃',
        'SERVER_CRASH',
        true,
      );

      const result = categorizeError(originalError);

      expect(result).toBe(originalError);
      expect(result.category).toBe(ErrorCategory.SERVER);
      expect(result.code).toBe('SERVER_CRASH');
    });
  });
});

describe('AppError', () => {
  it('AppError 包含正确的 metadata', () => {
    const error = new AppError(
      ErrorCategory.NETWORK,
      '连接超时',
      'TIMEOUT_ERROR',
      true,
    );

    expect(error.name).toBe('AppError');
    expect(error.message).toBe('连接超时');
    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.code).toBe('TIMEOUT_ERROR');
    expect(error.recoverable).toBe(true);

    expect(error.userMessage).toBeDefined();
    expect(typeof error.userMessage).toBe('string');
    expect(error.userMessage.length).toBeGreaterThan(0);
  });

  it('userMessage 根据 category 返回 MC 风格文案', () => {
    const networkErr = new AppError(ErrorCategory.NETWORK, '', '');
    expect(networkErr.userMessage).toContain('网络');

    const authErr = new AppError(ErrorCategory.AUTHENTICATION, '', '');
    expect(authErr.userMessage).toContain('身份验证');

    const serverErr = new AppError(ErrorCategory.SERVER, '', '');
    expect(serverErr.userMessage).toContain('服务');
  });

  it('默认 recoverable 为 true', () => {
    const error = new AppError(ErrorCategory.UNKNOWN, 'test');
    expect(error.recoverable).toBe(true);
  });

  it('保持正确的原型链', () => {
    const error = new AppError(ErrorCategory.UNKNOWN, 'test');

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('isRecoverableError', () => {
  it('可恢复错误返回 true', () => {
    const error = new ApiError(500, 'INTERNAL_SERVER_ERROR', '服务端错误');
    expect(isRecoverableError(error)).toBe(true);
  });

  it('不可恢复的认证错误返回 false', () => {
    const error = new ApiError(401, 'UNAUTHORIZED', '未授权');
    expect(isRecoverableError(error)).toBe(false);
  });
});

describe('dispatchApiErrorEvent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('分发自定义事件到 window', () => {
    const eventListener = vi.fn();
    window.addEventListener('novelmuse:api-error', eventListener);

    const apiError = new ApiError(500, 'SERVER_ERROR', '服务器错误');
    dispatchApiErrorEvent(apiError);

    expect(eventListener).toHaveBeenCalled();
    const customEvent = eventListener.mock.calls[0]?.[0] as CustomEvent;
    expect(customEvent.detail.error).toBeInstanceOf(AppError);
    expect(customEvent.detail.error.category).toBe(ErrorCategory.SERVER);

    window.removeEventListener('novelmuse:api-error', eventListener);
  });
});

describe('dispatchToastEvent', () => {
  it('分发 Toast 通知事件', () => {
    const eventListener = vi.fn();
    window.addEventListener('novelmuse:toast-notify', eventListener);

    dispatchToastEvent({
      type: 'success',
      message: '操作成功',
      duration: 3000,
    });

    expect(eventListener).toHaveBeenCalled();
    const customEvent = eventListener.mock.calls[0]?.[0] as CustomEvent;
    expect(customEvent.detail.type).toBe('success');
    expect(customEvent.detail.message).toBe('操作成功');
    expect(customEvent.detail.duration).toBe(3000);

    window.removeEventListener('novelmuse:toast-notify', eventListener);
  });
});
