/**
 * @fileoverview ToastProvider 组件单元测试
 * 使用 @testing-library/react 测试 Toast 通知系统的渲染、交互和生命周期
 *
 * 安装依赖命令（已在项目根目录执行）:
 * pnpm add -Dw vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../ToastProvider';

// ★ Mock gsap：当前实现移除 toast 前会播放 0.2s 退出动画（gsap.to + onComplete）。
// 在 fake timers 环境下 gsap 的 rAF 动画不会推进，onComplete 永不触发导致 toast 无法移除。
// 测试关注 ToastProvider 的队列/计时逻辑，因此让动画同步完成。
vi.mock('@/utils/gsap', () => ({
  gsap: {
    to: (_target: unknown, vars: { onComplete?: () => void }) => {
      vars.onComplete?.();
      return { kill: vi.fn() };
    },
  },
  useGSAP: () => {},
  toastEnter: () => {},
}));

// ---------- 测试辅助组件 ----------

/** 内部测试组件：通过 useToast 触发通知 */
function ToastTestComponent({
  onToastReady,
}: {
  onToastReady?: (toast: ReturnType<typeof useToast>) => void;
}) {
  const toast = useToast();

  // 将 toast 实例暴露给父组件
  if (onToastReady) {
    onToastReady(toast);
  }

  return (
    <div data-testid="test-child">
      <button onClick={() => toast.success('成功消息')}>Success</button>
      <button onClick={() => toast.error('错误消息')}>Error</button>
      <button onClick={() => toast.warning('警告消息')}>Warning</button>
      <button onClick={() => toast.info('信息消息')}>Info</button>
    </div>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    // 使用 fake timers 控制 setTimeout 行为
    vi.useFakeTimers();

    // 清理 DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    // 恢复真实 timers
    vi.useRealTimers();
  });

  describe('默认渲染行为', () => {
    it('默认不渲染任何内容（无 toast 时返回 null）', () => {
      render(
        <ToastProvider>
          <div>子组件内容</div>
        </ToastProvider>,
      );

      // 子组件正常渲染
      expect(screen.getByText('子组件内容')).toBeInTheDocument();

      // 不存在 toast 容器（role="alert" 的元素）
      const alerts = screen.queryAllByRole('alert');
      expect(alerts).toHaveLength(0);
    });
  });

  describe('显示 Toast', () => {
    it('调用 useToast().success() 显示成功 toast', async () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      // 通过 hook 实例触发 success toast
      act(() => {
        toastInstance!.success('操作成功！');
      });

      // 验证 toast 已渲染（success 类型的可访问角色为 status，非 alert）
      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThanOrEqual(1);

      // 验证消息文本存在
      expect(screen.getByText('操作成功！')).toBeInTheDocument();
    });

    it('调用 useToast().error() 显示错误 toast', async () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      act(() => {
        toastInstance!.error('操作失败');
      });

      expect(screen.getByText('操作失败')).toBeInTheDocument();
    });
  });

  describe('自动消失', () => {
    it('toast 自动消失（使用 fake timers）', async () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      // 触发 success toast（默认 duration=3000ms）
      act(() => {
        toastInstance!.success('自动消失的消息');
      });

      // 立即验证 toast 存在
      expect(screen.getByText('自动消失的消息')).toBeInTheDocument();

      // 推进时间到刚好超过默认 duration (3000ms)
      act(() => {
        vi.advanceTimersByTime(3100);
      });

      // toast 应该已经消失
      expect(screen.queryByText('自动消失的消息')).not.toBeInTheDocument();
    });

    it('错误 toast 停留更长时间（5000ms）', async () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      act(() => {
        toastInstance!.error('错误消息停留更久');
      });

      // 3 秒后仍然存在（因为 error 默认 5s）
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.queryByText('错误消息停留更久')).toBeInTheDocument();

      // 5.1 秒后消失
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByText('错误消息停留更久')).not.toBeInTheDocument();
    });
  });

  describe('手动关闭', () => {
    it('手动关闭 toast', () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      act(() => {
        toastInstance!.success('可手动关闭的 toast');
      });

      // 验证 toast 存在
      expect(screen.getByText('可手动关闭的 toast')).toBeInTheDocument();

      // 找到并点击关闭按钮（aria-label="关闭通知"）
      // 注意：fake timers 环境下使用 fireEvent 而非 userEvent，
      // 因为 userEvent 内部依赖真实 timers 会导致超时
      const closeButton = screen.getByLabelText('关闭通知');

      act(() => {
        fireEvent.click(closeButton);
      });

      // 验证 toast 已被移除
      expect(screen.queryByText('可手动关闭的 toast')).not.toBeInTheDocument();
    });
  });

  describe('最大数量限制', () => {
    it('同时最多显示 3 条 toast', async () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      // 连续添加 4 条 toast（使用较长的 duration 防止自动消失）
      act(() => {
        toastInstance!.success('Toast 1', 60000);
        toastInstance!.success('Toast 2', 60000);
        toastInstance!.success('Toast 3', 60000);
        toastInstance!.success('Toast 4', 60000); // 第 4 条应该挤掉最早的
      });

      // 应该只有 3 条 toast 可见（success 类型角色为 status）
      const statusElements = screen.getAllByRole('status');
      expect(statusElements).toHaveLength(3);

      // 最旧的 "Toast 1" 应该被移除
      expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();

      // 新的 3 条应该都存在
      expect(screen.getByText('Toast 2')).toBeInTheDocument();
      expect(screen.getByText('Toast 3')).toBeInTheDocument();
      expect(screen.getByText('Toast 4')).toBeInTheDocument();
    });
  });

  describe('useToast 在 Provider 外使用', () => {
    it('在 ToastProvider 外部调用 useToast 抛出错误', () => {
      // 抑制控制台错误输出
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ToastTestComponent />);
      }).toThrow('useToast must be used within a <ToastProvider>');

      consoleSpy.mockRestore();
    });
  });

  describe('自定义持续时间', () => {
    it('支持自定义 toast 持续时间', async () => {
      let toastInstance: ReturnType<typeof useToast> | undefined;

      render(
        <ToastProvider>
          <ToastTestComponent onToastReady={(t) => (toastInstance = t)} />
        </ToastProvider>,
      );

      // 设置自定义持续时间为 1000ms
      act(() => {
        toastInstance!.info('短命消息', 1000);
      });

      expect(screen.getByText('短命消息')).toBeInTheDocument();

      // 900ms 后仍存在
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(screen.queryByText('短命消息')).toBeInTheDocument();

      // 1100ms 后消失
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText('短命消息')).not.toBeInTheDocument();
    });
  });
});
