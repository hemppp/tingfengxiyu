// ============================================================
// DockPanelContent.suspense.test.tsx — 面板级 Suspense 边界回归（2026-10-07）
//
// 背景（用户 m01082「检查一下那些跳转加载转圈，为什么会出现？」的调查结论）：
//   dockview 把面板内容经 `ReactDOM.createPortal` 挂在 `DockviewReact` 所在的 div 下，
//   **它自己不提供任何 Suspense 边界**；而停靠面板组件几乎全是 `React.lazy`
//   （模块内 12 个面板 / 章节左栏 / AI 对话）。于是「打开一个还没下载完的面板」
//   会让挂起一路上溯到 `routes/Lazy.tsx` 的路由级 fallback —— 整页（顶栏 + 停靠区 +
//   状态栏）被换成 32px「加载中...」大转圈。
//
// 本测试用「外层哨兵 fallback」把这个上溯行为变成可判定断言：
//   · 面板挂起期间，**必须**出现面板级 `.shell-panel-fallback`；
//   · 外层哨兵文本**绝不能**出现（出现即说明边界缺失、挂起漏到了路由层）；
//   · chunk 到位后面板内容正常渲染、fallback 消失。
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { lazy, Suspense, type ReactNode } from 'react';

// dockview 依赖 ResizeObserver —— jsdom 未内建，测试环境补齐。
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

import { DockPanelContent } from '@/components/shell/dock/DockPanelContent';
import type { DockPanelDef } from '@/components/shell/dock/types';

/** 一个可控的 lazy 面板：`release()` 之前一直挂起。 */
function makeDeferredPanel() {
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  const LazyPanel = lazy(async () => {
    await gate;
    return { default: () => <div data-testid="panel-ready">PANEL_READY</div> };
  });
  return { LazyPanel, release: () => release() };
}

/** 只渲染面板内容本身（DockPanelContent 直接吃 `props.params`）。 */
function renderPanel(def: DockPanelDef, outer: ReactNode) {
  // DockPanelContent 只用到 props.params —— 其余 dockview 字段与本断言无关
  const props = { params: { defKey: def.key, def } } as unknown as Parameters<typeof DockPanelContent>[0];
  return render(
    <Suspense fallback={outer}>
      <DockPanelContent {...props} />
    </Suspense>,
  );
}

describe('DockPanelContent · 面板级 Suspense 边界（整页转圈回归）', () => {
  it('lazy 面板挂起时只显示面板级 fallback，外层路由级 fallback 不出现', async () => {
    const { LazyPanel, release } = makeDeferredPanel();
    const def: DockPanelDef = {
      key: 'probe',
      label: '探针',
      icon: () => null,
      Component: LazyPanel,
    } as unknown as DockPanelDef;

    const { container } = renderPanel(def, <div data-testid="outer-fallback">OUTER_ROUTE_FALLBACK</div>);

    // 挂起期间：面板级 fallback 出现……
    await waitFor(() => {
      expect(container.querySelector('.shell-panel-fallback')).toBeTruthy();
    });
    // ……而外层（路由级）哨兵**从未**出现 —— 这就是「整页转圈」被挡住的那一步。
    expect(container.querySelector('[data-testid="outer-fallback"]')).toBeNull();
    expect(container.textContent).not.toContain('OUTER_ROUTE_FALLBACK');

    // chunk 到位 → 面板内容渲染、fallback 消失
    release();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="panel-ready"]')).toBeTruthy();
    });
    expect(container.querySelector('.shell-panel-fallback')).toBeNull();
    expect(container.querySelector('[data-testid="outer-fallback"]')).toBeNull();
  });

  it('面板体（.dock-panel-body）仍是 fallback 的容器 —— 转圈只占面板框内', async () => {
    const { LazyPanel, release } = makeDeferredPanel();
    const def: DockPanelDef = {
      key: 'probe2',
      label: '探针2',
      icon: () => null,
      Component: LazyPanel,
    } as unknown as DockPanelDef;

    const { container } = renderPanel(def, <div data-testid="outer-fallback">OUTER</div>);

    await waitFor(() => {
      expect(container.querySelector('.shell-panel-fallback')).toBeTruthy();
    });
    const body = container.querySelector('.dock-panel-body');
    expect(body).toBeTruthy();
    expect(body?.querySelector('.shell-panel-fallback')).toBeTruthy();

    release();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="panel-ready"]')).toBeTruthy();
    });
  });
});
