/**
 * @fileoverview pickMostRecentChapter / pickFallbackChapterId
 *
 * 收口「该打开哪一章」的口径。此前 EditorPage 与 ChapterEditor 各写了一份且不一致
 * （前者按 updatedAt、后者按 chapters[0]），这里守住统一语义。
 */

import { describe, it, expect } from 'vitest';
import { pickMostRecentChapter, pickFallbackChapterId } from '../chapter';

const ch = (id: string, updatedAt: number) => ({ id, updatedAt });

describe('pickMostRecentChapter', () => {
  it('取 updatedAt 最大的那一章（而非数组第一个）', () => {
    const list = [ch('a', 100), ch('b', 300), ch('c', 200)];
    expect(pickMostRecentChapter(list)?.id).toBe('b');
  });

  it('空数组返回 undefined', () => {
    expect(pickMostRecentChapter([])).toBeUndefined();
  });

  it('单元素返回它自己', () => {
    expect(pickMostRecentChapter([ch('only', 1)])?.id).toBe('only');
  });

  it('时间戳相同时不炸，返回其中之一（不抛错即达标）', () => {
    const r = pickMostRecentChapter([ch('a', 5), ch('b', 5)]);
    expect(['a', 'b']).toContain(r?.id);
  });

  it('不修改入参', () => {
    const list = [ch('a', 100), ch('b', 300)];
    const snapshot = JSON.stringify(list);
    pickMostRecentChapter(list);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

describe('pickFallbackChapterId', () => {
  it('返回最近章的 id', () => {
    expect(pickFallbackChapterId([ch('a', 100), ch('b', 300)])).toBe('b');
  });

  it('没有章节时返回 null（由调用方决定回退到项目首页）', () => {
    expect(pickFallbackChapterId([])).toBeNull();
  });
});
