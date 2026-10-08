// ============================================================
// Lazy.test.tsx — RouteFallback 防闪烁（2026-10-07「跳转加载转圈」全修复 ⑤）
//
// 背景：React.lazy 首次读取**必然**抛 thenable（即使 chunk 已在模块缓存里，
//   `lazyInitializer` 也先置 Pending 再抛，只能在后续微任务里重试）。于是
//   「零耗时挂起」也会挂载一次 fallback 又立刻卸载 —— 用户看到整页大转圈闪一下。
//
// 断言：RouteFallback 挂载后**先不显示**，超过延迟窗口才显示；若在窗口内卸载，
//       计时器被清掉、永不显示。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { RouteFallback, lazyRoute } from '@/routes/Lazy';

describe('RouteFallback · 防闪烁', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('挂载瞬间不渲染任何转圈（延迟窗口内为空）', () => {
    const { container } = render(<RouteFallback />);
    // 立刻：什么都没有（旧实现这里就已经是 32px 转圈了）
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('超过延迟窗口才显示转圈', () => {
    const { container } = render(<RouteFallback />);
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(container.textContent).toContain('加载中');
  });

  it('延迟窗口内卸载 ⇒ 计时器清掉、永不显示（这就是「不闪」）', () => {
    const { container, unmount } = render(<RouteFallback />);
    unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('lazyRoute：chunk 已缓存（零耗时）时不出现整页转圈', async () => {
    // 已 resolve 的 loader —— 模拟「chunk 已在模块缓存里」的快速命中
    const Comp = lazyRoute(async () => ({ default: () => <div data-testid="ready">READY</div> }));
    const { container } = render(<Comp />);
    // 微任务推进后内容就绪；期间不该留下转圈
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="ready"]')).toBeTruthy();
    expect(container.textContent).not.toContain('加载中');
  });
});
