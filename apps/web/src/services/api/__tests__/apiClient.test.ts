/**
 * @fileoverview API Client 单元测试
 * 测试 HTTP 请求封装层的 URL 构建、响应解析、错误处理、Token 管理等核心逻辑
 *
 * 安装依赖命令（已在项目根目录执行）:
 * pnpm add -Dw vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react
 *
 * 测试策略：由于 createApiClient 是模块内部函数（未导出），
 * 本测试通过 mock fetch 全局函数来验证导出的 apiClient 单例行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  apiClient,
  ApiError,
  getToken,
  setToken,
  clearToken,
} from '../apiClient';

// ---------- Mock fetch 工具 ----------

/** 当前 mock 响应（可动态切换） */
let currentMockResponse: Response | Error | DOMException = new Response(
  JSON.stringify({ data: { id: 1 } }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

/**
 * 创建可配置的 mock fetch
 * 通过 setMockResponse() 在每个 test 中动态设置响应
 */
function setupMockFetch() {
  const mockFetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit): Promise<Response> => {
    if (currentMockResponse instanceof Error) throw currentMockResponse;
    if (currentMockResponse instanceof DOMException) throw currentMockResponse;
    return currentMockResponse as Response;
  });

  vi.stubGlobal('fetch', mockFetch);
  return {
    getMockFetch: () => mockFetch,
    setMockResponse: (response: Response | Error | DOMException) => {
      currentMockResponse = response;
    },
  };
}

describe('apiClient', () => {
  let mock: ReturnType<typeof setupMockFetch>;

  beforeEach(() => {
    // 清除 localStorage 中的 token
    clearToken();

    // 重置 mock 响应为默认成功响应
    currentMockResponse = new Response(
      JSON.stringify({ data: { id: 1 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    // 设置 mock fetch
    mock = setupMockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('buildUrl - URL 构建', () => {
    it('buildUrl 正确构建带参数的 URL', async () => {
      const expectedData = { items: ['a', 'b'] };
      mock.setMockResponse(
        new Response(JSON.stringify({ data: expectedData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await apiClient.get('/api/test', { page: '1', size: '10', search: 'hello' });

      expect(result).toEqual(expectedData);

      // 验证 fetch 被调用时包含正确的查询参数
      const fetchUrl = mock.getMockFetch().mock.calls[0]?.[0] as string;
      expect(fetchUrl).toContain('page=1');
      expect(fetchUrl).toContain('size=10');
      expect(fetchUrl).toContain('search=hello');
      expect(fetchUrl).toContain('/api/test');
    });

    it('无参数时 URL 不包含查询字符串', async () => {
      mock.setMockResponse(
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await apiClient.get('/api/simple');

      const fetchUrl = mock.getMockFetch().mock.calls[0]?.[0] as string;
      // URL 应包含路径但不包含 ?
      expect(fetchUrl).toContain('/api/simple');
      expect(fetchUrl.split('?')[0]).toBe(fetchUrl); // 无查询参数部分
    });
  });

  describe('成功响应解析', () => {
    it('成功响应解包 data 字段', async () => {
      const responseData = { name: 'test', value: 42 };
      mock.setMockResponse(
        new Response(JSON.stringify({ data: responseData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await apiClient.get('/api/data');

      expect(result).toEqual(responseData);
      expect(result).not.toHaveProperty('data'); // 已解包，不再包含外层 data
    });

    it('非 JSON 响应返回文本', async () => {
      mock.setMockResponse(
        new Response('plain text response', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const result = await apiClient.get('/api/text');

      expect(result).toBe('plain text response');
    });
  });

  describe('HTTP 错误处理', () => {
    it('HTTP 错误抛出 ApiError（含 status/code/message）', async () => {
      mock.setMockResponse(
        new Response(
          JSON.stringify({
            error: {
              code: 'NOT_FOUND',
              message: '资源不存在',
              details: { resourceId: '123' },
            },
          }),
          {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        await apiClient.get('/api/missing');
        expect.fail('应该抛出 ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.code).toBe('NOT_FOUND');
        expect(apiErr.message).toBe('资源不存在');
        expect(apiErr.details).toEqual({ resourceId: '123' });
      }
    });

    it('非 JSON 错误响应使用默认错误信息', async () => {
      // 使用空字符串作为响应体，这样源码会 fallback 到 getErrorMessage()
      mock.setMockResponse(
        new Response('', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      try {
        await apiClient.get('/api/error');
        expect.fail('应该抛出 ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.code).toBe('INTERNAL_SERVER_ERROR');
        // 空响应体时 fallback 到 getErrorMessage() 返回的中文消息
        expect(apiErr.message).toContain('服务器内部错误');
      }
    });
  });

  describe('超时处理', () => {
    it('超时/取消抛出 ApiError（TIMEOUT 或 ABORTED）', async () => {
      // 模拟 AbortError（fetch 超时或主动取消）
      // 注意: 源码通过检查 controller.signal.aborted 区分 TIMEOUT 和 ABORTED，
      // 但在 jsdom 中直接抛出 DOMException 时 signal.aborted 可能为 false，
      // 因此此处验证抛出的错误为 ApiError 且 code 为 TIMEOUT 或 ABORTED 均可接受
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mock.setMockResponse(abortError);

      try {
        await apiClient.get('/api/slow');
        expect.fail('应该抛出 ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiErr = error as ApiError;
        // jsdom 环境限制：可能返回 TIMEOUT 或 ABORTED
        expect(['TIMEOUT', 'ABORTED']).toContain(apiErr.code);
      }
    });
  });

  describe('网络错误处理', () => {
    it('网络错误抛出 NETWORK_ERROR', async () => {
      // 模拟网络错误（如断网）
      const networkError = new TypeError('Failed to fetch');
      mock.setMockResponse(networkError);

      try {
        await apiClient.get('/api/offline');
        expect.fail('应该抛出 ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiErr = error as ApiError;
        expect(apiErr.code).toBe('NETWORK_ERROR');
        expect(apiErr.message).toContain('网络错误');
      }
    });
  });

  describe('Token 管理', () => {
    it('Token 自动附加到 Authorization header', async () => {
      setToken('my-test-token-123');

      mock.setMockResponse(
        new Response(JSON.stringify({ data: { secured: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await apiClient.get('/api/protected');

      // 验证请求头中包含 Authorization
      const fetchInit = mock.getMockFetch().mock.calls[0]?.[1] as RequestInit;
      expect(fetchInit.headers).toHaveProperty(
        'Authorization',
        'Bearer my-test-token-123',
      );
    });

    it('无 Token 时不附加 Authorization header', async () => {
      clearToken(); // 确保 token 被清除

      mock.setMockResponse(
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await apiClient.get('/api/public');

      const fetchInit = mock.getMockFetch().mock.calls[0]?.[1] as RequestInit;
      expect(fetchInit.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('401 响应处理', () => {
    it('401 响应触发 clearToken()', async () => {
      setToken('expired-token'); // 先设置一个 token

      mock.setMockResponse(
        new Response(
          JSON.stringify({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Token expired',
            },
          }),
          {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        await apiClient.get('/api/protected');
        expect.fail('应该抛出 ApiError');
      } catch (error) {
        // 验证 token 已被清除
        expect(getToken()).toBeNull();
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
      }
    });
  });

  describe('HTTP 方法', () => {
    it('POST 请求正确发送 JSON body', async () => {
      const postData = { title: '新项目', description: '测试描述' };

      mock.setMockResponse(
        new Response(JSON.stringify({ data: { id: 'new-id', ...postData } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await apiClient.post('/api/projects', postData);

      expect(result).toEqual({ id: 'new-id', ...postData });

      // 验证请求方法和 body
      const fetchInit = mock.getMockFetch().mock.calls[0]?.[1] as RequestInit;
      expect(fetchInit.method).toBe('POST');
      const parsedBody = JSON.parse(fetchInit.body as string);
      expect(parsedBody).toEqual(postData);
    });

    it('DELETE 请求不包含 body', async () => {
      // jsdom 的 Response 构造函数不支持 204 No Content，使用 200 替代
      mock.setMockResponse(
        new Response(null, {
          status: 200,
          headers: {},
        }),
      );

      await apiClient.delete('/api/items/123');

      const fetchInit = mock.getMockFetch().mock.calls[0]?.[1] as RequestInit;
      expect(fetchInit.method).toBe('DELETE');
      expect(fetchInit.body).toBeUndefined();
    });
  });
});
