// ============================================================
// BookCard.intent.test.tsx — 书架条目的「意图预取」钩子（2026-10-07 全修复 ④）
//
// 背景：从书架点开一本书是四段**串行**（ProjectLayout chunk → ProjectIndexPage chunk
//   → 等章节数据 → ChapterEditor chunk）。原先只有 `requestIdleCallback` 的空闲预取，
//   用户点得快时它输给点击的竞态 ⇒ 照样现下载、照样出转圈。
//   修复：把预取挂到 `mouseenter` / `pointerdown`（用户意图出现、点击尚未发生）。
//
// 断言：悬停触发一次；按下触发一次；`onIntent` 未传时不崩。
// ============================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BookCard } from '@/components/ui/BookCard';
import type { Project } from '@novel/shared';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  }
});

const BOOK = {
  id: 'b1',
  name: '测试书',
  penName: '作者',
  genre: '玄幻',
  currentWordCount: 1234,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
} as unknown as Project;

describe('BookCard · 意图预取钩子', () => {
  it('mouseenter 触发 onIntent（悬停即预取）', () => {
    const onIntent = vi.fn();
    const { container } = render(<BookCard book={BOOK} onClick={() => {}} onIntent={onIntent} />);
    const card = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(card);
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it('pointerdown 触发 onIntent（按下即预取，早于 click）', () => {
    const onIntent = vi.fn();
    const { container } = render(<BookCard book={BOOK} onClick={() => {}} onIntent={onIntent} />);
    const card = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(card, { clientX: 5, clientY: 5 });
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it('未传 onIntent 时不崩（钩子可选）', () => {
    const { container } = render(<BookCard book={BOOK} onClick={() => {}} />);
    const card = container.firstElementChild as HTMLElement;
    expect(() => {
      fireEvent.mouseEnter(card);
      fireEvent.pointerDown(card, { clientX: 1, clientY: 1 });
    }).not.toThrow();
  });
});
