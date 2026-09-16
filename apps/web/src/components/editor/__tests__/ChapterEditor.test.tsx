/**
 * @fileoverview ChapterEditor —— URL 章节 id 的有效性校验
 *
 * 病灶（修复前）：
 *   if (chapters.length > 0) { setCurrentChapter(chapterId); ... }
 *   只判「数据到了」，不判「这个 id 真的存在」。当 URL 里的 chapterId 失效
 *   （手输/改错的链接、陈旧书签、分享后章节被删）时，编辑器会挂在一个
 *   store 里查无此章的"幽灵章节"上：
 *     · 界面停在「尚未开启章节」空状态
 *     · 而 flushToBackend 仍按该 id 发 PUT /api/chapters/<乱码>，
 *       配合 silent:true 变成一串用户完全无感的 400
 *
 * 这里守住三件事：
 *   1. id 存在 → 正常选中，不碰 URL
 *   2. id 不存在 → 纠正 URL 到真实章节（一章都没有则回项目首页），且不使用坏 id
 *   3. 纠正后用户切章（只改 store、不改 URL）不被 effect 拉回
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ChapterEditor } from '../ChapterEditor';

// ---- router mock：可控 params / 记录 navigate ----
const navigateMock = vi.fn();
let params: Record<string, string | undefined> = {};

vi.mock('react-router-dom', () => ({
  useParams: () => params,
  useNavigate: () => navigateMock,
}));

// ---- store mock：可控 chapters，并记录 setCurrentChapter 的实参 ----
const setCurrentChapterMock = vi.fn();
let chapters: Array<{ id: string; content: string }> = [];

vi.mock('@/stores', () => ({
  useChapterStore: (selector: (s: unknown) => unknown) =>
    selector({ chapters, setCurrentChapter: setCurrentChapterMock }),
}));

// EditorPage 是本测试的无关下游，stub 掉避免拉起 tiptap 全家桶
vi.mock('@/components/editor/EditorPage', () => ({
  EditorPage: () => null,
}));

const BOOK = '3eb7f978-2137-4ad3-b2cf-6fb5695a0069';

/**
 * ★ 章节列表顺序刻意设计成「第一个 ≠ 最近的」：
 *   CHAPTER_FIRST 排在数组首位（模拟后端按 order 升序返回），
 *   但 CHAPTER_RECENT 的 updatedAt 更大。
 *   失效 URL 的兜底必须落到 CHAPTER_RECENT —— 早期实现用的是 chapters[0]，
 *   这个数据集能把两种口径区分开（只断言「落到了某一章」是测不出来的）。
 */
const CHAPTER_FIRST = 'probe-ch-1';
const CHAPTER_RECENT = 'probe-ch-2';

const mkChapter = (id: string, updatedAt: number, content = 'x') => ({ id, updatedAt, content });

beforeEach(() => {
  navigateMock.mockClear();
  setCurrentChapterMock.mockClear();
  chapters = [
    mkChapter(CHAPTER_FIRST, 1000),
    mkChapter(CHAPTER_RECENT, 2000), // ← 最近编辑
  ];
  params = { bookId: BOOK, chapterId: CHAPTER_FIRST };
});

describe('ChapterEditor · URL 章节 id 校验', () => {
  it('id 存在 → 选中该章，且不动 URL', async () => {
    params = { bookId: BOOK, chapterId: CHAPTER_FIRST };
    render(<ChapterEditor />);
    await waitFor(() => expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_FIRST));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('★ 核心回归：id 不存在 → 纠正 URL，且绝不把坏 id 写进 store', async () => {
    params = { bookId: BOOK, chapterId: 'write' }; // 非 UUID，复现原报告情形
    render(<ChapterEditor />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        `/project/${BOOK}/${CHAPTER_RECENT}`,
        { replace: true },
      ),
    );
    // 关键：store 里必须是真实存在的章节，不是那个坏 id
    expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_RECENT);
    expect(setCurrentChapterMock).not.toHaveBeenCalledWith('write');
  });

  it('★ 兜底落到「最近编辑」的那章，而不是列表第一个', async () => {
    // 这里是最容易写错的地方：早期实现用 chapters[0]，会落到 CHAPTER_FIRST
    params = { bookId: BOOK, chapterId: 'stale-bookmark-id' };
    render(<ChapterEditor />);

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    // 数组第一个是 CHAPTER_FIRST，但最近的是 CHAPTER_RECENT
    expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_RECENT);
    expect(setCurrentChapterMock).not.toHaveBeenCalledWith(CHAPTER_FIRST);
  });

  it('id 不存在且列表里只有一个别的章 → 落到那一章', async () => {
    chapters = [mkChapter(CHAPTER_FIRST, 1000)];
    params = { bookId: BOOK, chapterId: 'stale-bookmark-id' };
    render(<ChapterEditor />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(`/project/${BOOK}/${CHAPTER_FIRST}`, { replace: true }),
    );
    expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_FIRST);
    expect(setCurrentChapterMock).not.toHaveBeenCalledWith('stale-bookmark-id');
  });

  it('纠正只发生一次：后续 store 变化不再重复 navigate', async () => {
    params = { bookId: BOOK, chapterId: 'write' };
    const { rerender } = render(<ChapterEditor />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1));

    // 模拟用户切章导致的 store 变化（URL 参数没变）
    chapters = [mkChapter(CHAPTER_FIRST, 3000), mkChapter(CHAPTER_RECENT, 2000)];
    rerender(<ChapterEditor />);

    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});
