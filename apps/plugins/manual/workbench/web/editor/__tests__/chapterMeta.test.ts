/**
 * 章节元信息行（标题下方小字）的推导单测。
 *
 * 目标：把「四段都由真实数据渲染、缺失时整段不渲染」钉死在纯函数层，
 * 不依赖 React 渲染或编辑器实例。
 */
import { describe, expect, it } from 'vitest';
import {
  buildChapterMetaSegments,
  formatUpdatedAt,
  formatWordCount,
  type ChapterMetaInput,
} from '../chapterMeta';

/** 固定的「现在」：2025-05-20 20:00（本地时区），便于断言同日 / 跨天 */
const NOW = new Date(2025, 4, 20, 20, 0, 0);
const SAME_DAY_1912 = new Date(2025, 4, 20, 19, 12, 0).getTime();
const PREV_DAY_2305 = new Date(2025, 4, 19, 23, 5, 0).getTime();

/** 对齐目标截图的输入：第一章 · order 1 · label "D1" · 沈砚/沈母在场 */
const SCREENSHOT_INPUT: ChapterMetaInput = {
  wordCount: 2400,
  liveWordCount: 2410,
  updatedAt: SAME_DAY_1912,
  label: 'D1',
  order: 1,
  characters: [
    { name: '沈砚', chapters: [1, 2, 4] },
    { name: '沈母', chapters: [1, 4] },
    { name: '老周', chapters: [3] },
  ],
};

function texts(segments: ReturnType<typeof buildChapterMetaSegments>): string[] {
  return segments.map((segment) => segment.text);
}

describe('chapterMeta · 四段真实数据', () => {
  it('完整数据下四段逐字对齐截图口径', () => {
    expect(texts(buildChapterMetaSegments(SCREENSHOT_INPUT, NOW))).toEqual([
      '2,410 字',
      '最后修改 19:12',
      '本章 D1',
      '在场: 沈砚 / 沈母',
    ]);
  });

  it('每段都带非空 title，且不出现 null / undefined / 空串', () => {
    const segments = buildChapterMetaSegments(SCREENSHOT_INPUT, NOW);
    expect(segments.map((segment) => segment.key)).toEqual(['words', 'updated', 'badge', 'cast']);
    for (const segment of segments) {
      expect(segment.text.trim()).not.toBe('');
      expect(segment.title.trim()).not.toBe('');
      expect(segment.text).not.toMatch(/null|undefined|NaN/);
    }
  });

  it('字数取编辑器实时字数，并做千分位', () => {
    const segments = buildChapterMetaSegments(
      { ...SCREENSHOT_INPUT, liveWordCount: 12480, wordCount: 12000 },
      NOW,
    );
    expect(segments[0]?.text).toBe('12,480 字');
    expect(formatWordCount(12480)).toBe('12,480');
  });

  it('实时字数未就绪时回落章节持久化字数；0 字也照实显示（不是空占位）', () => {
    const pending = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, liveWordCount: null }, NOW);
    expect(pending[0]?.text).toBe('2,400 字');

    const empty = buildChapterMetaSegments(
      { wordCount: 0, liveWordCount: null, order: 1 },
      NOW,
    );
    expect(empty.map((segment) => segment.key)).toEqual(['words', 'badge']);
    expect(empty[0]?.text).toBe('0 字');
  });
});

describe('chapterMeta · 缺失即整段不渲染（不产生空占位/null）', () => {
  it('字数与持久化字数都不可用时，没有字数段', () => {
    const segments = buildChapterMetaSegments({ updatedAt: SAME_DAY_1912, order: 1 }, NOW);
    expect(segments.map((segment) => segment.key)).not.toContain('words');
    expect(texts(segments)).toEqual(['最后修改 19:12', '本章 D1']);
  });

  it('updatedAt 缺失 / 0 / NaN 时，没有「最后修改」段', () => {
    for (const updatedAt of [undefined, null, 0, Number.NaN]) {
      const segments = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, updatedAt }, NOW);
      expect(segments.map((segment) => segment.key)).not.toContain('updated');
    }
    expect(formatUpdatedAt(undefined)).toBeNull();
    expect(formatUpdatedAt(0)).toBeNull();
    expect(formatUpdatedAt(Number.NaN)).toBeNull();
  });

  it('label 缺失或全空白时回落真实序号 D{n}；order 也缺失时整段不渲染', () => {
    const noLabel = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, label: null }, NOW);
    expect(noLabel.find((segment) => segment.key === 'badge')?.text).toBe('本章 D1');
    expect(noLabel.find((segment) => segment.key === 'badge')?.title).toContain('全书第 1 章');

    const blankLabel = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, label: '   ' }, NOW);
    expect(blankLabel.find((segment) => segment.key === 'badge')?.text).toBe('本章 D1');

    const noOrder = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, order: null, label: null }, NOW);
    expect(noOrder.map((segment) => segment.key)).not.toContain('badge');
  });

  it('在场人物由「角色出场章节含本章 order」推导，不写死；无匹配则不渲染该段', () => {
    const chapterThree = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, order: 3 }, NOW);
    expect(chapterThree.find((segment) => segment.key === 'cast')?.text).toBe('在场: 老周');

    const chapterNine = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, order: 9 }, NOW);
    expect(chapterNine.map((segment) => segment.key)).not.toContain('cast');

    const noCharacters = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, characters: null }, NOW);
    expect(noCharacters.map((segment) => segment.key)).not.toContain('cast');

    const unnamed = buildChapterMetaSegments(
      { ...SCREENSHOT_INPUT, characters: [{ name: '   ', chapters: [1] }, { chapters: [1] }] },
      NOW,
    );
    expect(unnamed.map((segment) => segment.key)).not.toContain('cast');

    const noOrder = buildChapterMetaSegments({ ...SCREENSHOT_INPUT, order: null }, NOW);
    expect(noOrder.map((segment) => segment.key)).not.toContain('cast');
  });

  it('输入为 null / undefined 时返回空数组（整行不渲染）', () => {
    expect(buildChapterMetaSegments(null, NOW)).toEqual([]);
    expect(buildChapterMetaSegments(undefined, NOW)).toEqual([]);
  });
});

describe('chapterMeta · 最后修改时间口径', () => {
  it('同一天只给 HH:mm，跨天补 MM-DD', () => {
    expect(formatUpdatedAt(SAME_DAY_1912, NOW)).toBe('19:12');
    expect(formatUpdatedAt(PREV_DAY_2305, NOW)).toBe('05-19 23:05');
  });

  it('「最后修改」段的 title 给出完整本地时间', () => {
    const segment = buildChapterMetaSegments(SCREENSHOT_INPUT, NOW).find(
      (item) => item.key === 'updated',
    );
    expect(segment?.title).toBe(`最后修改于 ${new Date(SAME_DAY_1912).toLocaleString('zh-CN')}`);
  });
});
