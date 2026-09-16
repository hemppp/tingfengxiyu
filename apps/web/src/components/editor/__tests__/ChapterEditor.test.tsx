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

const CHAPTER_A = '5fae6a3a-e148-4d87-8fff-3f158ef366b4';
const CHAPTER_B = 'probe-ch-1';
const BOOK = '3eb7f978-2137-4ad3-b2cf-6fb5695a0069';

beforeEach(() => {
  navigateMock.mockClear();
  setCurrentChapterMock.mockClear();
  chapters = [
    { id: CHAPTER_A, content: 'a' },
    { id: CHAPTER_B, content: 'b' },
  ];
  params = { bookId: BOOK, chapterId: CHAPTER_A };
});

describe('ChapterEditor · URL 章节 id 校验', () => {
  it('id 存在 → 选中该章，且不动 URL', async () => {
    render(<ChapterEditor />);
    await waitFor(() => expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_A));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('★ 核心回归：id 不存在 → 纠正 URL，且绝不把坏 id 写进 store', async () => {
    params = { bookId: BOOK, chapterId: 'write' }; // 非 UUID，复现原报告情形
    render(<ChapterEditor />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        `/project/${BOOK}/${CHAPTER_A}`,
        { replace: true },
      ),
    );
    // 关键：store 里必须是真实存在的章节，不是那个坏 id
    expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_A);
    expect(setCurrentChapterMock).not.toHaveBeenCalledWith('write');
  });

  it('id 不存在且列表里只有一个别的章 → 落到那一章', async () => {
    chapters = [{ id: CHAPTER_B, content: 'b' }];
    params = { bookId: BOOK, chapterId: 'stale-bookmark-id' };
    render(<ChapterEditor />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(`/project/${BOOK}/${CHAPTER_B}`, { replace: true }),
    );
    expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_B);
    expect(setCurrentChapterMock).not.toHaveBeenCalledWith('stale-bookmark-id');
  });

  it('纠正只发生一次：后续 store 变化不再重复 navigate', async () => {
    params = { bookId: BOOK, chapterId: 'write' };
    const { rerender } = render(<ChapterEditor />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1));

    // 模拟用户切章导致的 store 变化（URL 参数没变）
    chapters = [{ id: CHAPTER_A, content: 'a2' }, { id: CHAPTER_B, content: 'b' }];
    rerender(<ChapterEditor />);

    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});
