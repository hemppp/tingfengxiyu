// ============================================================
// DocTabs.test.tsx —— 文档标签行的运行时冒烟（t1 自证 / t6 去层后更新）
//
// 证明截图里的标签行**真的能切/关/加**：
//   · 三类标签（章节正文 / 人物设定 / 大纲 · 卷一）与「+」都在 DOM 里
//   · 激活态可见（`.shell-doctab.is-active`）
//   · × 关闭后切到**相邻**标签；关到 0 个不崩
//   · 「+」菜单能重新打开
//   · 标题取自真实 store（章节名 / 大纲卷名），无数据时回落静态标题
//
// ★ t6 去层后的两处口径变化：
//   1) 组件由 `DocTabs` 改名为 `DocTabsHeader` —— 它现在渲染在**中心 dock 组的组头**
//      （dockview 的 `[role="tab"]` 元素内部），不再是顶栏之下的独立横条。
//   2) 因为它嵌在 `role="tab"` 里，自身**不能**再声明 `role="tablist"/"tab"`
//      （嵌套交互元素是 a11y 反模式）。当前文档改用 `aria-current` 表达。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { DocTabsHeader, DOC_TAB_CATALOG } from '@/components/shell/DocTabs';
import { useChapterStore, useOutlineStore } from '@/stores';

function tabLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.shell-doctab-label')).map(
    (el) => el.textContent ?? '',
  );
}

function activeLabel(container: HTMLElement): string | null {
  return container.querySelector('.shell-doctab.is-active .shell-doctab-label')?.textContent ?? null;
}

beforeEach(() => {
  act(() => {
    useOutlineStore.setState({ nodes: [] });
    useChapterStore.setState({ currentChapterId: null });
  });
});

describe('DocTabsHeader 文档标签行', () => {
  it('默认渲染三类标签 + 「+」，且「章节正文」为激活态', () => {
    const { container } = render(<DocTabsHeader />);
    expect(DOC_TAB_CATALOG).toHaveLength(3);
    expect(tabLabels(container)).toEqual(['章节正文', '人物设定', '大纲 · 卷一']);
    expect(activeLabel(container)).toBe('章节正文');
    expect(container.querySelectorAll('.shell-doctab.is-active').length).toBe(1);
    expect(container.querySelector('.shell-doctab-add')).toBeTruthy();
  });

  it('点标签切换激活态（同一时刻只有一个激活）', () => {
    const { container } = render(<DocTabsHeader />);
    const mains = container.querySelectorAll('.shell-doctab-main');
    fireEvent.click(mains[1] as HTMLElement);
    expect(activeLabel(container)).toBe('人物设定');
    expect(container.querySelectorAll('.shell-doctab.is-active').length).toBe(1);
    // 嵌在组头的 role="tab" 内部 ⇒ 用 aria-current 表达当前文档（不再是 aria-selected）
    expect(
      container.querySelector('.shell-doctab.is-active .shell-doctab-main')?.getAttribute('aria-current'),
    ).toBe('true');
  });

  it('× 关闭激活标签 → 切到相邻标签；关到 0 个不崩；「+」可再打开', () => {
    const { container } = render(<DocTabsHeader />);

    // 先激活「人物设定」（列表第 2 项），再关它 → 右邻「大纲 · 卷一」接管
    fireEvent.click(container.querySelectorAll('.shell-doctab-main')[1] as HTMLElement);
    expect(activeLabel(container)).toBe('人物设定');
    fireEvent.click(container.querySelectorAll('.shell-doctab-close')[1] as HTMLElement);
    expect(tabLabels(container)).toEqual(['章节正文', '大纲 · 卷一']);
    expect(activeLabel(container)).toBe('大纲 · 卷一');

    // 全关光 → 0 个标签，不崩
    fireEvent.click(container.querySelector('.shell-doctab-close') as HTMLElement);
    fireEvent.click(container.querySelector('.shell-doctab-close') as HTMLElement);
    expect(tabLabels(container)).toEqual([]);
    expect(container.querySelector('.shell-doctab.is-active')).toBeNull();
    expect(container.querySelector('.shell-doctabs-list')).toBeTruthy();

    // 「+」菜单 → 三项候选 → 打开「章节正文」
    // 注意：菜单是 portal（挂在 document.body 下，见 F2），故不在 container 内查询。
    fireEvent.click(container.querySelector('.shell-doctab-add') as HTMLElement);
    const items = document.querySelectorAll('.shell-doctab-menu-item');
    expect(Array.from(items).map((el) => el.textContent)).toEqual([
      '章节正文',
      '人物设定',
      '大纲 · 卷一',
    ]);
    fireEvent.click(items[0] as HTMLElement);
    expect(tabLabels(container)).toEqual(['章节正文']);
    expect(activeLabel(container)).toBe('章节正文');
    // 选完即收起菜单
    expect(document.querySelector('.shell-doctab-menu')).toBeNull();
  });

  // F2：菜单被 `.shell-doctabs{overflow:hidden}` 裁到鼠标点不中 ⇒ 改为 portal 到 body。
  // jsdom 没有布局引擎，这里只能断言**挂载位置**这条结构性事实（菜单不在裁剪容器内、
  // 是 body 的直接子节点、带内联坐标）；真实命中测试由 CDP + 真实鼠标在浏览器里做，
  // 见本次修复报告里的复现步骤与 elementFromPoint 证据。
  it('「+」菜单 portal 到 body：不在 .shell-doctabs 内，带内联坐标，且不再受裁剪容器影响', () => {
    const { container } = render(<DocTabsHeader />);
    fireEvent.click(container.querySelector('.shell-doctab-add') as HTMLElement);

    // 裁剪容器里不再有菜单（否则又会只剩几像素可见）
    expect(container.querySelector('.shell-doctab-menu')).toBeNull();
    // 菜单是 <body> 的直接子节点 ⇒ 祖先链上没有任何 overflow 容器
    const menu = document.querySelector('.shell-doctab-menu') as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(menu?.parentElement).toBe(document.body);
    expect(menu?.getAttribute('role')).toBe('menu');
    // 坐标由「+」按钮 rect 内联给出（jsdom 里 rect 为 0，仍应是有限数字而非空）
    expect(Number.isFinite(Number.parseInt(menu?.style.top ?? '', 10))).toBe(true);
    expect(Number.isFinite(Number.parseInt(menu?.style.right ?? '', 10))).toBe(true);
    // 标签行自身仍只有原来的容器高度，没有被菜单撑开（F2 的关键性质：菜单不参与布局）
    expect(container.querySelector('.shell-doctabs-actions')?.querySelector('.shell-doctab-menu')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.shell-doctab-menu')).toBeNull();
  });

  it('标题取真实 store：章节名覆盖「章节正文」，act 标题覆盖卷名', () => {
    const { container } = render(<DocTabsHeader />);

    act(() => {
      useChapterStore.setState({
        chapters: [
          {
            id: 'c1',
            projectId: 'p1',
            title: '第一章 山雨欲来',
            content: '',
            order: 1,
            wordCount: 0,
            status: 'draft',
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        currentChapterId: 'c1',
      } as never);
      useOutlineStore.setState({
        nodes: [
          {
            id: 'n1',
            projectId: 'p1',
            type: 'act',
            title: '山雨卷',
            order: 1,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      } as never);
    });

    expect(tabLabels(container)).toEqual(['第一章 山雨欲来', '人物设定', '大纲 · 山雨卷']);
  });
});
