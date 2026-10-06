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
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import { ChapterEditor } from '../ChapterEditor';
import { useChapterStore } from '@novel-plugins/data-core/stores';

// ---- router mock：可控 params / 记录 navigate ----
const navigateMock = vi.fn();
let params: Record<string, string | undefined> = {};

vi.mock('react-router-dom', () => ({
  useParams: () => params,
  useNavigate: () => navigateMock,
}));

// ---- store mock：可控 chapters，并记录 setCurrentChapter 的实参 ----
// ★ setCurrentChapter 同时扮演「真实 store 的写入」：它更新 storeCurrentChapterId，
//   这样测试能断言「单击切章后 currentChapterId 有没有被 effect 拉回」。
let storeCurrentChapterId: string | null = null;
const setCurrentChapterMock = vi.fn((id: string | null) => {
  storeCurrentChapterId = id;
});
let chapters: Array<{ id: string; content: string }> = [];

// ★ t4：ChapterEditor 的 store 实现已迁到共享包（@novel-plugins/data-core/stores），
//   mock 必须对准**真实导入说明符**，否则 mock 失效 → 真 store 发起网络请求（fetch failed）。
vi.mock('@novel-plugins/data-core/stores', () => ({
  useChapterStore: (selector: (s: unknown) => unknown) =>
    selector({
      chapters,
      currentChapterId: storeCurrentChapterId,
      setCurrentChapter: setCurrentChapterMock,
    }),
}));

// EditorPage 是本测试的无关下游，stub 掉避免拉起 tiptap 全家桶
vi.mock('../EditorPage', () => ({
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

/**
 * 探针：以「章节树的形状」暴露 store 的当前章，并提供一个只改 store 的单击入口
 * （与 LeftSidebar.handleSelectChapter 同语义：setCurrentChapter(id)，不碰 URL）。
 * 它让回归测试能走「DOM click → store → 后台 chapters 刷新」这条真实时序。
 */
function ChapterProbe() {
  const currentChapterId = useChapterStore((s) => s.currentChapterId);
  const setCurrentChapter = useChapterStore((s) => s.setCurrentChapter);
  return (
    <div>
      <span data-testid="current-chapter">{currentChapterId ?? 'none'}</span>
      <button type="button" data-testid="tree-item-2" onClick={() => setCurrentChapter(CHAPTER_RECENT)}>
        02
      </button>
    </div>
  );
}

beforeEach(() => {
  navigateMock.mockClear();
  setCurrentChapterMock.mockClear();
  storeCurrentChapterId = null;
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

  it('★ 核心回归（F1）：chapters 数组被替换不会把当前章拉回路由章 —— 单击一次即生效', async () => {
    params = { bookId: BOOK, chapterId: CHAPTER_FIRST };
    const { rerender } = render(<ChapterEditor />);
    await waitFor(() => expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_FIRST));
    expect(setCurrentChapterMock).toHaveBeenCalledTimes(1);
    expect(storeCurrentChapterId).toBe(CHAPTER_FIRST);

    // 用户在左侧章节树单击另一章：LeftSidebar.handleSelectChapter 只改 store、不改 URL
    storeCurrentChapterId = CHAPTER_RECENT;
    setCurrentChapterMock.mockClear();

    // syncService 刷新把 chapters 换成新数组引用（同 id、同数量 —— verifier 观测到的 3->3）
    chapters = [mkChapter(CHAPTER_FIRST, 1000), mkChapter(CHAPTER_RECENT, 2000)];
    rerender(<ChapterEditor />);

    // 修复前：exists 分支无条件 setCurrentChapter(chapterId) ⇒ 这里被拉回 CHAPTER_FIRST
    expect(setCurrentChapterMock).not.toHaveBeenCalled();
    expect(storeCurrentChapterId).toBe(CHAPTER_RECENT);

    // 再刷新两次（每次都是新数组引用，其中一次还多了新章）仍然不回写：store 是唯一事实来源
    chapters = [mkChapter(CHAPTER_FIRST, 1000), mkChapter(CHAPTER_RECENT, 2000)];
    rerender(<ChapterEditor />);
    chapters = [...chapters, mkChapter('probe-ch-3', 500)];
    rerender(<ChapterEditor />);
    expect(setCurrentChapterMock).not.toHaveBeenCalled();
    expect(storeCurrentChapterId).toBe(CHAPTER_RECENT);
  });

  it('路由 chapterId 真的变化时仍会同步一次到 store（不是「同步过一次就永久失效」）', async () => {
    params = { bookId: BOOK, chapterId: CHAPTER_FIRST };
    const { rerender } = render(<ChapterEditor />);
    await waitFor(() => expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_FIRST));

    params = { bookId: BOOK, chapterId: CHAPTER_RECENT };
    rerender(<ChapterEditor />);
    await waitFor(() => expect(setCurrentChapterMock).toHaveBeenCalledWith(CHAPTER_RECENT));
    expect(storeCurrentChapterId).toBe(CHAPTER_RECENT);
  });

  it('URL 章 id 在数据未就绪时先变化，数据到达后仍同步到 URL 的那一章', async () => {
    // 覆盖「若改用『本次渲染 chapterId 是否变化』判定就会漏掉」的那条路径：
    // 第一次运行 chapters 为空 → 只进等待分支；chapterId 换成 B；数据到达后重跑，
    // 此时 chapterId 相对上一次运行并没有变，但仍必须同步到 B。
    chapters = [];
    params = { bookId: BOOK, chapterId: CHAPTER_FIRST };
    const { rerender } = render(<ChapterEditor />);

    params = { bookId: BOOK, chapterId: CHAPTER_RECENT };
    rerender(<ChapterEditor />);

    chapters = [mkChapter(CHAPTER_FIRST, 1000), mkChapter(CHAPTER_RECENT, 2000)];
    rerender(<ChapterEditor />);

    await waitFor(() => expect(storeCurrentChapterId).toBe(CHAPTER_RECENT));
  });

  it('★ DOM 单击重复 verifier 的时序：click 树条目 → 后台 chapters 刷新 → 当前章不被拉回', async () => {
    // 注意：这里的 store mock 没有订阅能力（真实 store 会因 currentChapterId 变化自动重渲染），
    // 所以每次 store 写入后用 rerender 显式驱动一次重渲染，其余时序与真实 app 一致。
    // ★ 每次都要新建元素（同一元素引用会被 React 的 bailout 优化跳过重渲染）。
    params = { bookId: BOOK, chapterId: CHAPTER_FIRST };
    const renderTree = () => (
      <>
        <ChapterEditor />
        <ChapterProbe />
      </>
    );
    const { rerender } = render(renderTree());
    await waitFor(() => expect(storeCurrentChapterId).toBe(CHAPTER_FIRST));
    rerender(renderTree()); // effect 写完 store 后让探针读到
    expect(screen.getByTestId('current-chapter').textContent).toBe(CHAPTER_FIRST);

    setCurrentChapterMock.mockClear();
    navigateMock.mockClear();

    // 单击章节树里的另一章：只写 store（LeftSidebar.handleSelectChapter 不改 URL）
    fireEvent.click(screen.getByTestId('tree-item-2'));
    expect(storeCurrentChapterId).toBe(CHAPTER_RECENT);
    expect(setCurrentChapterMock).toHaveBeenCalledTimes(1); // 这一次就是用户点击本身
    rerender(renderTree());

    // syncService 后台刷新把 chapters 换成新数组引用（verifier 观测到的 3 -> 3）
    chapters = [mkChapter(CHAPTER_FIRST, 1000), mkChapter(CHAPTER_RECENT, 2000)];
    rerender(renderTree());

    // 当前章仍是用户点的那一章；effect 没有再写 store（没有第二次调用、更没有被拉回路由章），也没有动 URL
    expect(screen.getByTestId('current-chapter').textContent).toBe(CHAPTER_RECENT);
    expect(setCurrentChapterMock).toHaveBeenCalledTimes(1);
    expect(setCurrentChapterMock).not.toHaveBeenCalledWith(CHAPTER_FIRST);
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
