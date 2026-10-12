/**
 * @fileoverview 写请求瞬时失败的可见化（F-F 修复）—— 回归测试
 *
 * 背景：`apiSave` / `apiUpdate` / `apiDelete` 一律以 `silent: true` 调 apiClient，
 * 原意是「400/422 这类 zod 校验失败不打扰用户」。但 silent 是一刀切开关，
 * 把 TIMEOUT / NETWORK_ERROR 也吞掉了 ⇒ UI 显示保存成功、后端没有数据、
 * 用户毫无感知（F-F「静默丢数据」）。
 *
 * 本测试钉住的不变量：
 *   ① 瞬时故障（TIMEOUT / NETWORK_ERROR）**必须**产生用户可见提示；
 *   ② 语义错误（400 / 404 / 409）**仍保持安静** —— 修 F-F 不得把 zod 校验失败也变成 toast；
 *   ③ 批量瞬时故障**不得刷屏**（首条立即 + 窗口结束补一条汇总，而非 N 条）。
 *
 * ★ 每个用例都走 `vi.resetModules()` + 动态 import 取一份**全新的**
 *   databaseService：去重窗口是**模块级**状态，若沿用静态 import 的同一份实例，
 *   前一个用例留下的窗口会把后一个用例的提示吃掉，测试之间互相污染。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ApiError as ApiErrorType } from '../../api/apiClient';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  dispatchToastEvent: vi.fn(),
}));

vi.mock('../../api/apiClient', async (importOriginal) => {
  // 保留 ApiError 等真实导出（instanceof 判定依赖同一个类对象），只替换单例的方法
  const actual = await importOriginal<typeof import('../../api/apiClient')>();
  return {
    ...actual,
    apiClient: {
      get: mocks.get,
      post: mocks.post,
      put: mocks.put,
      patch: vi.fn(),
      delete: mocks.delete,
    },
  };
});

vi.mock('@novel-plugins/ui-kit/errors', () => ({
  dispatchToastEvent: mocks.dispatchToastEvent,
}));

/** 取一份全新的 databaseService（连同其模块级去重窗口状态） */
async function freshService() {
  vi.resetModules();
  return import('../databaseService');
}

/** 取真实的 ApiError 类（用于构造抛错对象，保证 instanceof 判定成立） */
async function makeApiError(status: number, code: string, message: string) {
  const { ApiError } = await import('../../api/apiClient');
  return new ApiError(status, code, message) as ApiErrorType;
}

/** 一个最小可用的角色实体（databaseService 自身不校验字段，校验在后端 zod） */
function makeCharacter(id = 'char-1') {
  return {
    id,
    projectId: 'proj-1',
    name: '测试角色',
    createdAt: 1,
    updatedAt: 1,
  } as never;
}

describe('databaseService 写请求的瞬时失败可见化（F-F）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.post.mockReset();
    mocks.put.mockReset();
    mocks.delete.mockReset();
    mocks.get.mockReset();
    mocks.dispatchToastEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('① 瞬时故障要可见', () => {
    it('保存超时（TIMEOUT）⇒ 弹一次错误提示', async () => {
      const svc = await freshService();
      mocks.post.mockRejectedValueOnce(await makeApiError(0, 'TIMEOUT', '请求超时 (8s)'));

      const result = await svc.saveCharacter(makeCharacter());

      expect(result).toBeNull(); // 调用点契约不变：失败仍返回 null
      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);
      const toast = mocks.dispatchToastEvent.mock.calls[0][0];
      expect(toast.type).toBe('error');
      expect(toast.message).toContain('保存超时');
    });

    it('网络错误（NETWORK_ERROR）⇒ 弹一次错误提示', async () => {
      const svc = await freshService();
      mocks.post.mockRejectedValueOnce(await makeApiError(0, 'NETWORK_ERROR', '网络错误: Failed to fetch'));

      await svc.saveCharacter(makeCharacter());

      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);
      expect(mocks.dispatchToastEvent.mock.calls[0][0].message).toContain('保存失败');
    });

    it('更新超时（PUT）⇒ 同样可见', async () => {
      const svc = await freshService();
      mocks.put.mockRejectedValueOnce(await makeApiError(0, 'TIMEOUT', '请求超时 (8s)'));

      await svc.updateCharacter('char-1', { name: '改名' });

      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);
      expect(mocks.dispatchToastEvent.mock.calls[0][0].type).toBe('error');
    });

    it('删除超时（DELETE）⇒ 同样可见', async () => {
      const svc = await freshService();
      mocks.delete.mockRejectedValueOnce(await makeApiError(0, 'TIMEOUT', '请求超时 (8s)'));

      await svc.deleteCharacter('char-1');

      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('② 语义错误仍保持安静（不得把 zod 校验失败也变成 toast）', () => {
    it('400（zod 校验失败）⇒ 不弹 toast', async () => {
      const svc = await freshService();
      mocks.post.mockRejectedValueOnce(await makeApiError(400, 'BAD_REQUEST', '请求参数错误'));

      const result = await svc.saveCharacter(makeCharacter());

      expect(result).toBeNull();
      expect(mocks.dispatchToastEvent).not.toHaveBeenCalled();
    });

    it('404（删除已不存在的实体）⇒ 不弹 toast', async () => {
      const svc = await freshService();
      mocks.delete.mockRejectedValueOnce(await makeApiError(404, 'NOT_FOUND', '请求的资源不存在'));

      await svc.deleteCharacter('char-1');

      expect(mocks.dispatchToastEvent).not.toHaveBeenCalled();
    });

    it('409 冲突 ⇒ 不弹 toast', async () => {
      const svc = await freshService();
      mocks.post.mockRejectedValueOnce(await makeApiError(409, 'CONFLICT', '数据冲突，请刷新后重试'));

      await svc.saveCharacter(makeCharacter());

      expect(mocks.dispatchToastEvent).not.toHaveBeenCalled();
    });

    it('非 ApiError（意外抛出）⇒ 不弹 toast（保持既有兜底行为）', async () => {
      const svc = await freshService();
      mocks.post.mockRejectedValueOnce(new Error('boom'));

      await svc.saveCharacter(makeCharacter());

      expect(mocks.dispatchToastEvent).not.toHaveBeenCalled();
    });
  });

  describe('③ 批量瞬时故障不得刷屏', () => {
    it('同一窗口内 5 次超时 ⇒ 首条立即 1 条 + 窗口结束 1 条汇总，共 2 条', async () => {
      const svc = await freshService();
      const timeoutErr = await makeApiError(0, 'TIMEOUT', '请求超时 (8s)');
      mocks.post.mockRejectedValue(timeoutErr);

      // 模拟 AI 端点饱和：多个写请求几乎同时被打回
      for (let i = 0; i < 5; i++) {
        await svc.saveCharacter(makeCharacter(`char-${i}`));
      }

      // 首条立即弹出，其余 4 条只计数
      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);
      expect(mocks.dispatchToastEvent.mock.calls[0][0].message).toContain('保存超时');

      // 窗口结束 → 补一条汇总（"另有 N 项…"）
      vi.advanceTimersByTime(8000);
      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(2);
      const summary = mocks.dispatchToastEvent.mock.calls[1][0];
      expect(summary.type).toBe('error');
      expect(summary.message).toContain('另有 4 项');
    });

    it('窗口结束后再次失败 ⇒ 重新立即弹提示（不永久静音）', async () => {
      const svc = await freshService();
      mocks.post.mockRejectedValue(await makeApiError(0, 'TIMEOUT', '请求超时 (8s)'));

      await svc.saveCharacter(makeCharacter('a'));
      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(8000); // 窗口过期（无被抑制项 ⇒ 不补汇总）
      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(1);

      await svc.saveCharacter(makeCharacter('b'));
      expect(mocks.dispatchToastEvent).toHaveBeenCalledTimes(2);
      expect(mocks.dispatchToastEvent.mock.calls[1][0].message).toContain('保存超时');
    });
  });
});
