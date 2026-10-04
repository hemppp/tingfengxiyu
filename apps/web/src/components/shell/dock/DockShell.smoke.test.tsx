// ============================================================
// DockShell.smoke.test.tsx — P2 停靠内核的运行时冒烟（t3 自证）
//
// 目的：不只靠静态字符串断言（契约 verify: node -e ... includes('DockviewReact')），
//       而是在 jsdom 里**真的挂载 DockShell**，证明：
//         · 外壳骨架六件套都渲染（活动栏/侧边栏/编辑区/底部面板区/状态栏/辅助侧栏）
//         · dockview 宿主被挂载
//         · 面板来源为**外部传入数组**，切换数组 → 活动栏条目同步变化
//         · resolveDockMeta / planDockAreas 的缺省行为与 ADR §1.4/§1.5/§1.6 一致
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Layers } from 'lucide-react';

// dockview 依赖 ResizeObserver / matchMedia —— jsdom 未内建，测试环境补齐。
// （这是**测试环境**能力补齐，不是产品代码的降级；产品运行在真实浏览器里。）
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

import { DockShell } from '@/components/shell/DockShell';
import {
  DockPanelDef,
  resolveDockMeta,
  DOCK_META_DEFAULTS,
  type DockShellApi,
} from '@/components/shell/dock/types';
import { planDockAreas, slotToDockDirection } from '@/components/shell/dock/layout';

function makeDef(over: Partial<DockPanelDef> & { key: string; label: string }): DockPanelDef {
  return {
    icon: Layers,
    Component: () => null,
    ...over,
  } as DockPanelDef;
}

const PANELS: DockPanelDef[] = [
  makeDef({ key: 'chapters', label: '章节' }),
  makeDef({ key: 'factions', label: '势力' }),
];

describe('DockShell 外壳骨架', () => {
  it('六件套骨架与 dockview 宿主都在 DOM 里', () => {
    const { container } = render(
      <DockShell panels={PANELS} centerDefault={<div>editor</div>} activeCenterKey={null} />,
    );
    expect(container.querySelector('.dock-activity-bar')).toBeTruthy();
    expect(container.querySelector('.dock-side-bar')).toBeTruthy();
    expect(container.querySelector('.dock-main')).toBeTruthy();
    expect(container.querySelector('.dock-bottom-area')).toBeTruthy();
    expect(container.querySelector('.dock-status-bar')).toBeTruthy();
    expect(container.querySelector('.dock-aux-bar')).toBeTruthy();
    // dockview 宿主（能力 1/3/4/7 的载体）
    expect(container.querySelector('.dockview-host')).toBeTruthy();
    // §5.5 冻结的主题映射层类
    expect(container.querySelector('.dv-theme-vscode')).toBeTruthy();
  });

  it('活动栏条目由外部 panels 派生（不硬编码业务面板）', () => {
    const { container, rerender } = render(
      <DockShell panels={PANELS} centerDefault={<div />} activeCenterKey={null} />,
    );
    expect(container.querySelectorAll('.dock-activity-item').length).toBe(2);

    // 换成 3 个 → 活动栏同步
    rerender(
      <DockShell
        panels={[
          makeDef({ key: 'a', label: 'A' }),
          makeDef({ key: 'b', label: 'B' }),
          makeDef({ key: 'c', label: 'C' }),
        ]}
        centerDefault={<div />}
        activeCenterKey={null}
      />,
    );
    expect(container.querySelectorAll('.dock-activity-item').length).toBe(3);
  });

  it('候选池为空也不崩（骨架常驻）+ centerDefault 传得进去', () => {
    const { container } = render(
      <DockShell panels={[]} centerDefault={<div data-testid="ed">E</div>} activeCenterKey={null} />,
    );
    expect(container.querySelector('.dock-activity-bar')).toBeTruthy();
    expect(container.querySelector('.dock-status-bar')).toBeTruthy();
  });

  it('apiRef 暴露 §2.4 DockShellApi 七个方法', () => {
    const ref = { current: null as null | Record<string, unknown> };
    render(
      <DockShell
        panels={PANELS}
        centerDefault={<div />}
        activeCenterKey={null}
        apiRef={ref as never}
      />,
    );
    expect(ref.current).toBeTruthy();
    for (const m of [
      'openPanel',
      'closePanel',
      'focusPanel',
      'listPanels',
      'activePanel',
      'floatPanel',
      'dockPanel',
    ]) {
      expect(typeof ref.current?.[m]).toBe('function');
    }
  });
});

describe('resolveDockMeta —— ADR §1.4/§1.5 缺省真源', () => {
  it('未声明 dock → 全部取冻结缺省', () => {
    const m = resolveDockMeta(makeDef({ key: 'x', label: 'X' }));
    expect(m.slot).toBe('right');
    expect(m.defaultOpen).toBe(false);
    expect(m.allowMultiple).toBe(false);
    expect(m.closable).toBe(true);
    expect(m.floatable).toBe(true);
    expect(m.minSize).toEqual({ width: 240, height: 160 });
    expect(m.center).toBe(false);
    // floatingSize 回落链：顶层 width/height → 1024×720
    expect(m.floatingSize).toEqual({ width: 1024, height: 720 });
  });

  it('floatingSize 回落链：dock.floatingSize → 顶层 width/height', () => {
    const a = resolveDockMeta(makeDef({ key: 'a', label: 'A', width: 800, height: 600 }));
    expect(a.floatingSize).toEqual({ width: 800, height: 600 });

    const b = resolveDockMeta(
      makeDef({ key: 'b', label: 'B', width: 800, dock: { floatingSize: { width: 1, height: 2 } } }),
    );
    expect(b.floatingSize).toEqual({ width: 1, height: 2 });
  });

  it('显式声明覆盖缺省', () => {
    const m = resolveDockMeta(
      makeDef({ key: 'g', label: 'G', dock: { slot: 'bottom', floatable: false, closable: false } }),
    );
    expect(m.slot).toBe('bottom');
    expect(m.floatable).toBe(false);
    expect(m.closable).toBe(false);
  });

  it('DOCK_META_DEFAULTS 与 ADR §1.5 冻结表逐字段一致', () => {
    expect(DOCK_META_DEFAULTS.slot).toBe('right');
    expect(DOCK_META_DEFAULTS.minSize).toEqual({ width: 240, height: 160 });
    expect(DOCK_META_DEFAULTS.fallbackFloatingSize).toEqual({ width: 1024, height: 720 });
  });
});

describe('planDockAreas / slot 映射 —— ADR §1.6 落位', () => {
  it('缺省全落 right（与 scope:editor 同落点）', () => {
    const plan = planDockAreas([makeDef({ key: 'a', label: 'A' }), makeDef({ key: 'b', label: 'B' })]);
    expect(plan.right.map((d) => d.key)).toEqual(['a', 'b']);
    expect(plan.left).toHaveLength(0);
    expect(plan.bottom).toHaveLength(0);
    expect(plan.center).toHaveLength(0);
  });

  it('四区都能落；center 布尔优先于 slot（不参与侧栏池）', () => {
    const plan = planDockAreas([
      makeDef({ key: 'l', label: 'L', dock: { slot: 'left' } }),
      makeDef({ key: 'r', label: 'R', dock: { slot: 'right' } }),
      makeDef({ key: 'b', label: 'B', dock: { slot: 'bottom' } }),
      makeDef({ key: 'c', label: 'C', dock: { slot: 'left', center: true } }),
    ]);
    expect(plan.left.map((d) => d.key)).toEqual(['l']);
    expect(plan.right.map((d) => d.key)).toEqual(['r']);
    expect(plan.bottom.map((d) => d.key)).toEqual(['b']);
    expect(plan.center.map((d) => d.key)).toEqual(['c']);
  });

  it('order 升序且稳定（同 order 保持原序）', () => {
    const plan = planDockAreas([
      makeDef({ key: 'a', label: 'A', order: 2 }),
      makeDef({ key: 'b', label: 'B', order: 1 }),
      makeDef({ key: 'c', label: 'C', order: 1 }),
    ]);
    expect(plan.right.map((d) => d.key)).toEqual(['b', 'c', 'a']);
  });

  it('槽位 → dockview Direction：bottom 映射为 below', () => {
    expect(slotToDockDirection('left')).toBe('left');
    expect(slotToDockDirection('right')).toBe('right');
    expect(slotToDockDirection('bottom')).toBe('below');
  });
});

// ============================================================
// 回归：能力 6 中心槽抢占的**单一所有者**（t5 修复）
//
// ## 为什么必须真实渲染
//   本缺陷只在**两个 effect 的交互**中显形（activeCenterKey effect 与受控 openKeys
//   effect 各自建实例、且互看不见对方的实例 id）。`planDockAreas` 的纯函数分桶
//   永远测不到它 —— 修复前本文件**所有**渲染用例都传 `activeCenterKey={null}`，
//   抢占路径完全无覆盖，所以缺陷一路漏到验收。
//
// ## 实例 id 的可观测性
//   dockview 把每个面板的真实 id 渲染为 `[data-tab-panel-id]`，故可在 DOM 上直接
//   数实例个数（不依赖内核私有状态）：
//     · 中心槽实例 = `nm-center:<key>`（由 activeCenterKey effect 独占）
//     · 普通实例   = `nm-panel:<key>`
//   不变量：同一业务 key **有且仅有 1 个**实例，且 center 面板**只**经
//   `nm-center:<key>` 渲染。
// ============================================================

const CENTER_KEY = 'relationGraph';

/** 含一个 center 面板（声明 `dock:{center:true}`）+ 一个普通面板。 */
const CENTER_PANELS: DockPanelDef[] = [
  makeDef({ key: 'notes', label: '笔记' }),
  makeDef({ key: CENTER_KEY, label: '关系图', dock: { center: true, slot: 'center' } }),
];

/** DOM 里出现的全部 dockview 面板实例 id（含中心默认面板）。 */
function panelIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-tab-panel-id]')).map(
    (n) => n.getAttribute('data-tab-panel-id') ?? '',
  );
}

const countId = (container: HTMLElement, id: string): number =>
  panelIds(container).filter((x) => x === id).length;

/** 等 dockview 的 effect 链落定（addPanel / removePanel 是异步提交的）。 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 250));

describe('能力 6 · 中心槽抢占的单一所有者（双实例回归）', () => {
  it('center 面板同时在 openKeys 与 activeCenterKey 中 ⇒ 恰好 1 个实例、无重复 key', async () => {
    const ref = { current: null as DockShellApi | null };
    const { container } = render(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div data-testid="ed">编辑器</div>}
        activeCenterKey={CENTER_KEY}
        openKeys={['notes', CENTER_KEY]}
        apiRef={ref as never}
      />,
    );
    await waitFor(() => expect(ref.current).toBeTruthy());
    await settle();

    const listed = ref.current!.listPanels();
    // ① 该 key 恰好出现 1 次
    expect(listed.filter((k) => k === CENTER_KEY)).toHaveLength(1);
    // ② 整体无任何重复项（修复前为 ["relationGraph","relationGraph","notes"]）
    expect(new Set(listed).size).toBe(listed.length);

    // ③ center 实例恰好 1 个，且**不存在**普通实例（修复前的双实例根因）
    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(1);
    expect(countId(container, `nm-panel:${CENTER_KEY}`)).toBe(0);
    // 普通面板仍恰好 1 个（不误伤）
    expect(countId(container, 'nm-panel:notes')).toBe(1);
  });

  it('center 面板在 openKeys 中但 activeCenterKey=null ⇒ 不由受控 effect 建普通实例', async () => {
    const ref = { current: null as DockShellApi | null };
    const { container } = render(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div />}
        activeCenterKey={null}
        openKeys={[CENTER_KEY]}
        apiRef={ref as never}
      />,
    );
    await waitFor(() => expect(ref.current).toBeTruthy());
    await settle();

    // 未抢占 ⇒ 中心槽是默认出口；center 面板**不得**以普通 id 出现
    // （修复前此处渲染成 nm-panel:relationGraph，是一个 id 口径错误的实例）
    expect(countId(container, `nm-panel:${CENTER_KEY}`)).toBe(0);
    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(0);
    expect(ref.current!.listPanels()).not.toContain(CENTER_KEY);
    // 中心默认面板常驻
    expect(countId(container, 'nm-center-default')).toBe(1);
  });

  it('activeCenterKey 置回 null ⇒ 移除 center 实例并回落到默认出口；再置回仍恰好 1 个', async () => {
    const ref = { current: null as DockShellApi | null };
    const { container, rerender } = render(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div data-testid="ed">编辑器</div>}
        activeCenterKey={CENTER_KEY}
        openKeys={['notes', CENTER_KEY]}
        apiRef={ref as never}
      />,
    );
    await waitFor(() => expect(ref.current).toBeTruthy());
    await settle();
    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(1);

    // ---- 退出抢占 ----
    rerender(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div data-testid="ed">编辑器</div>}
        activeCenterKey={null}
        openKeys={['notes', CENTER_KEY]}
        apiRef={ref as never}
      />,
    );
    await settle();
    // center 实例被移除，key 不再在打开集合里
    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(0);
    expect(ref.current!.listPanels()).not.toContain(CENTER_KEY);
    // 中心槽回到 CENTER_DEFAULT_PANEL_ID 承载的默认出口
    expect(countId(container, 'nm-center-default')).toBe(1);
    // 也不得残留普通实例
    expect(countId(container, `nm-panel:${CENTER_KEY}`)).toBe(0);

    // ---- 重新抢占（关闭→重开幂等） ----
    rerender(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div data-testid="ed">编辑器</div>}
        activeCenterKey={CENTER_KEY}
        openKeys={['notes', CENTER_KEY]}
        apiRef={ref as never}
      />,
    );
    await settle();
    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(1);
    expect(countId(container, `nm-panel:${CENTER_KEY}`)).toBe(0);
    const listed = ref.current!.listPanels();
    expect(listed.filter((k) => k === CENTER_KEY)).toHaveLength(1);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('openPanel 对已抢占的 center 面板幂等（重复调用不新增实例）', async () => {
    const ref = { current: null as DockShellApi | null };
    const { container } = render(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div />}
        activeCenterKey={CENTER_KEY}
        openKeys={[CENTER_KEY]}
        apiRef={ref as never}
      />,
    );
    await waitFor(() => expect(ref.current).toBeTruthy());
    await settle();
    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(1);

    // 宿主重复点击面板菜单（PanelMenu → getPanelNavigation().open）
    ref.current!.openPanel(CENTER_KEY);
    await settle();
    ref.current!.openPanel(CENTER_KEY);
    await settle();

    expect(countId(container, `nm-center:${CENTER_KEY}`)).toBe(1);
    expect(countId(container, `nm-panel:${CENTER_KEY}`)).toBe(0);
    expect(ref.current!.listPanels().filter((k) => k === CENTER_KEY)).toHaveLength(1);
  });

  it('onOpenChange 只上报唯一 key（保留首次出现顺序）', async () => {
    const ref = { current: null as DockShellApi | null };
    const payloads: string[][] = [];
    const { container } = render(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div />}
        activeCenterKey={CENTER_KEY}
        openKeys={['notes', CENTER_KEY]}
        apiRef={ref as never}
        onOpenChange={(keys) => payloads.push([...keys])}
      />,
    );
    await waitFor(() => expect(ref.current).toBeTruthy());
    await settle();

    // 内核每次上报都必须是唯一 key 列表（修复前重复实例会把同一个 key 推两次，
    // 污染宿主 store 的「打开顺序」与状态栏计数）
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      expect(new Set(p).size).toBe(p.length);
    }
    expect(countId(container, `nm-panel:${CENTER_KEY}`)).toBe(0);
  });
});
