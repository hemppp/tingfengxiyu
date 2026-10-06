// ============================================================
// DockShell.smoke.test.tsx — P2 停靠内核的运行时冒烟（t3 自证）
//
// 目的：不只靠静态字符串断言（契约 verify: node -e ... includes('DockviewReact')），
//       而是在 jsdom 里**真的挂载 DockShell**，证明：
//         · 外壳骨架都渲染（活动栏 / 编辑区 / 底部面板细条）
//         · ★ t1（外壳改造）：两个**纯占位**侧栏（主侧栏 / 辅助侧栏）与内核自带的
//           第二根状态栏已删除 —— 真实面板由 dockview 在编辑区内左右停靠，
//           状态栏只剩 ProjectLayout 的通栏一根；底部改为截图里的细条
//           （左「底部面板」+ 右「N 条问题 Ctrl+J」）
//         · dockview 宿主被挂载
//         · 面板来源为**外部传入数组**，切换数组 → 活动栏条目同步变化
//         · resolveDockMeta / planDockAreas 的缺省行为与 ADR §1.4/§1.5/§1.6 一致
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
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

import { DockShell, reapplySideWidths } from '@/components/shell/DockShell';
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
  it('骨架（活动栏 / 编辑区 / 底部细条）与 dockview 宿主都在 DOM 里', () => {
    const { container } = render(
      <DockShell panels={PANELS} centerDefault={<div>editor</div>} activeCenterKey={null} />,
    );
    expect(container.querySelector('.dock-activity-bar')).toBeTruthy();
    expect(container.querySelector('.dock-main')).toBeTruthy();
    expect(container.querySelector('.dock-bottom-area')).toBeTruthy();
    // ★ t1：底部细条 = 可点击的「底部面板」开关 + 右侧「N 条问题 Ctrl+J」
    expect(container.querySelector('.dock-bottom-toggle')).toBeTruthy();
    expect(container.querySelector('.dock-bottom-kbd')?.textContent).toContain('Ctrl+J');
    // ★ t1：内核自带的第二根状态栏与两个占位侧栏已删除（截图只有一根通栏状态栏）
    expect(container.querySelector('.dock-status-bar')).toBeNull();
    expect(container.querySelector('.dock-side-bar')).toBeNull();
    expect(container.querySelector('.dock-aux-bar')).toBeNull();
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
    expect(container.querySelector('.dock-bottom-area')).toBeTruthy();
    expect(container.querySelector('.dock-bottom-toggle')).toBeTruthy();
  });

  // ★ t1：底部细条的数据契约 —— 条数由调用方传入（内核只管机制），
  //   Ctrl+J 展开/收起由内核处理；展开区渲染调用方给的 children。
  it('底部细条：条数来自 props、Ctrl+J 展开/收起、展开区渲染 children', () => {
    const { container } = render(
      <DockShell
        panels={PANELS}
        centerDefault={<div />}
        activeCenterKey={null}
        bottomPanel={{ issueCount: 3, children: <div data-testid="bl">problems</div> }}
      />,
    );
    const area = container.querySelector('.dock-bottom-area') as HTMLElement;
    expect(area).toBeTruthy();
    // 折叠态：细条常驻、展开区不渲染
    expect(area.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('.dock-bottom-issues')?.textContent).toContain('3 条问题');
    expect(container.querySelector('[data-testid="bl"]')).toBeNull();

    // Ctrl+J → 展开
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(area.getAttribute('data-open')).toBe('true');
    expect(container.querySelector('[data-testid="bl"]')).toBeTruthy();

    // 再按一次 → 收起
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(area.getAttribute('data-open')).toBe('false');

    // 点「底部面板」开关 → 也能展开
    const toggle = container.querySelector('.dock-bottom-toggle') as HTMLElement;
    expect(toggle.textContent).toContain('底部面板');
    fireEvent.click(toggle);
    expect(area.getAttribute('data-open')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
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

// ============================================================
// 回归：t6 F-2 —— 关闭面板后停靠列宽必须回到设计值
//
// ## 缺陷
//   `initialWidth` **只在 `addPanel` 那一刻**被 dockview 采用
//   （`dock/layout.ts:127-132`）。某列的面板被移除后，网格按剩余视图**均分**
//   腾出的空间，且没有任何机制恢复原宽：实测
//     `48:240 | 288:636 | 924:340` → 开「人物设定」→ 用标签 × 关掉
//     ⇒ `48:405 | 453:405 | 858:406`，再开关也回不去。
//
// ## 修复
//   `closePanel()` 与受控 `openKeys` effect 末尾都调用 `reapplySideWidths()`，
//   经公开杠杆 `group.api.setSize({ width })`（`api/dockviewGroupPanelApi.d.ts:80-86`；
//   `dockview-core.js:5616-5618` 它只 fire `onDidSizeChange`，由 splitview pane
//   `onDidChange` → `resize`/`distributeEmptySpace` 真正落位）重放左右列宽。
//
// 这里对纯逻辑做**不挂载**的单元覆盖（渲染路径的列宽由 e2e 探针
// `D:\Temp\t6-f2.mjs` 在真实浏览器里实测），因为 jsdom 没有真实布局，
// `group.width` 恒为 0，无法在 jsdom 里断言像素宽度。
// ============================================================

type FakeGroup = {
  width: number;
  panels: { id: string }[];
  api: { setSize: (e: { width?: number; height?: number }) => void };
  sized: ({ width?: number; height?: number } | null)[];
};

function fakeGroup(width: number, panelIds: string[]): FakeGroup {
  const sized: ({ width?: number; height?: number } | null)[] = [];
  const g: FakeGroup = {
    width,
    panels: panelIds.map((id) => ({ id })),
    sized,
    api: { setSize: (e) => sized.push(e) },
  };
  return g;
}

function defMap(...defs: DockPanelDef[]): Map<string, DockPanelDef> {
  return new Map(defs.map((d) => [d.key, d]));
}

describe('t6 F-2 · reapplySideWidths 重放左右列宽', () => {
  it('左侧组偏宽 ⇒ 收回 240；右侧组偏窄 ⇒ 放回 340', () => {
    const left = fakeGroup(405, ['nm-panel:chapters']);
    const right = fakeGroup(406, ['nm-panel:ai-chat']);
    const center = fakeGroup(405, ['nm-center-default']);

    reapplySideWidths(
      { groups: [left, right, center] as never },
      defMap(
        makeDef({ key: 'chapters', label: '章节', dock: { slot: 'left' } }),
        makeDef({ key: 'ai-chat', label: 'AI 对话', dock: { slot: 'right' } }),
      ),
    );

    // 左栏设计宽已回到 240（2026-10-05 的 120px 实验是误读用户口径，已回滚；
    // 用户要的是「章节行」上下高度减半，见 LeftSidebar 行高）
    expect(left.sized).toEqual([{ width: 240 }]);
    expect(right.sized).toEqual([{ width: 340 }]);
    // 中心组是剩余空间的接收者，绝不设宽（设了会和两侧收窄打架）
    expect(center.sized).toEqual([]);
  });

  it('宽度已在设计值（±1px）⇒ 不产生多余 setSize（避免布局抖动）', () => {
    const left = fakeGroup(240, ['nm-panel:chapters']);
    const right = fakeGroup(340.5, ['nm-panel:ai-chat']);

    reapplySideWidths(
      { groups: [left, right] as never },
      defMap(
        makeDef({ key: 'chapters', label: '章节', dock: { slot: 'left' } }),
        makeDef({ key: 'ai-chat', label: 'AI 对话', dock: { slot: 'right' } }),
      ),
    );

    expect(left.sized).toEqual([]);
    expect(right.sized).toEqual([]);
  });

  it('同一停靠列有多个组（开了第二个同槽面板）⇒ 整列不动，交给 dockview 自行分配', () => {
    // 实测：开「人物设定」后右槽同时有「角色」(340) 与「AI 对话」(240)。
    // 若按设计值把两个组都拉到 340，右列总宽翻倍、中栏被挤没。
    const rightA = fakeGroup(340, ['nm-panel:characters']);
    const rightB = fakeGroup(240, ['nm-panel:ai-chat']);

    reapplySideWidths(
      { groups: [rightA, rightB] as never },
      defMap(
        makeDef({ key: 'characters', label: '角色', dock: { slot: 'right' } }),
        makeDef({ key: 'ai-chat', label: 'AI 对话', dock: { slot: 'right' } }),
      ),
    );

    expect(rightA.sized).toEqual([]);
    expect(rightB.sized).toEqual([]);
  });

  it('同列的多组关回单组后，宽度重新退回设计值', () => {
    const left = fakeGroup(240, ['nm-panel:chapters']);
    const right = fakeGroup(406, ['nm-panel:ai-chat']);

    reapplySideWidths(
      { groups: [left, right] as never },
      defMap(
        makeDef({ key: 'chapters', label: '章节', dock: { slot: 'left' } }),
        makeDef({ key: 'ai-chat', label: 'AI 对话', dock: { slot: 'right' } }),
      ),
    );

    expect(left.sized).toEqual([]);
    expect(right.sized).toEqual([{ width: 340 }]);
  });
  it('混合槽位的组（用户拖拽后的结果）不动 —— 不与用户意图打架', () => {
    const mixed = fakeGroup(500, ['nm-panel:chapters', 'nm-panel:ai-chat']);

    reapplySideWidths(
      { groups: [mixed] as never },
      defMap(
        makeDef({ key: 'chapters', label: '章节', dock: { slot: 'left' } }),
        makeDef({ key: 'ai-chat', label: 'AI 对话', dock: { slot: 'right' } }),
      ),
    );

    expect(mixed.sized).toEqual([]);
  });

  it('底部槽位的组不设宽（它沿高度轴，宽由网格给）', () => {
    const bottom = fakeGroup(600, ['nm-panel:problems']);

    reapplySideWidths(
      { groups: [bottom] as never },
      defMap(makeDef({ key: 'problems', label: '问题', dock: { slot: 'bottom' } })),
    );

    expect(bottom.sized).toEqual([]);
  });

  it('def 尚未注册（异步注册的插件面板）⇒ 跳过，不崩', () => {
    const left = fakeGroup(405, ['nm-panel:not-yet-registered']);

    expect(() =>
      reapplySideWidths({ groups: [left] as never }, defMap()),
    ).not.toThrow();
    expect(left.sized).toEqual([]);
  });

  it('中心默认面板所在组被识别为中心（keyOfPanel 返回 null ⇒ 不入槽位集）', () => {
    const g = fakeGroup(500, ['nm-center-default']);
    reapplySideWidths({ groups: [g] as never }, defMap());
    expect(g.sized).toEqual([]);
  });
});

// ============================================================
// 回归：t6 去层 —— 只保留中心组组头（用户口径「上栏多了一层」）
//
// ## 缺陷
//   参考图顶部只有**两条带**：顶栏 + 一条分栏头（左「章节」/ 中三张文档标签 /
//   右「AI 对话」同在 y36..68）。而 dockview 给**每个组**各配一条 35px 组头，
//   于是左右列出现「dock 组头 + 面板内 h-9 标题条」两层，顶部总共三层。
//
// ## 修复
//   隐藏非中心组组头：`group.model.header.hidden = true` + `group.relayout()`
//   （`dockview-core.js:9989 set hidden` → `display:none`；
//    `:11297-11299 relayout()` → `invalidateHeaderSize()`）。
//   为什么不用 `hideHeader`：它只存在于 `CoreGroupOptions`
//   （`dockviewGroupPanelModel.d.ts:27-35`），**不在** `AddPanelOptions` 里
//   （`options.d.ts:741-775`，grep 0 命中），无法经 `addPanel` 传入。
//
// jsdom 断言的是**组头元素的 display**（不依赖真实布局），
// 像素级的两条带剖面由 `D:\Temp\t6-bands4.py` 在真实浏览器里实测。
// ============================================================

/** 每组的组头容器（`.dv-tabs-and-actions-container` 由 dockview 生成）。 */
function groupHeaders(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '.dv-groupview > .dv-tabs-and-actions-container',
    ),
  );
}

describe('t6 去层 · 只保留中心组组头', () => {
  it('普通面板组（左/右）的组头被隐藏，中心组组头保留', async () => {
    const { container } = render(
      <DockShell
        panels={PANELS}
        centerDefault={<div data-testid="ed">编辑器</div>}
        activeCenterKey={null}
        openKeys={['chapters']}
      />,
    );
    await settle();

    const headers = groupHeaders(container);
    // 至少两组：中心默认面板一组 + 章节一组
    expect(headers.length).toBeGreaterThanOrEqual(2);

    const hidden = headers.filter((h) => h.style.display === 'none');
    const visible = headers.filter((h) => h.style.display !== 'none');
    // 恰好一组可见（中心组），其余全隐藏
    expect(visible.length).toBe(1);
    expect(hidden.length).toBe(headers.length - 1);

    // 可见的那组承载中心默认面板（组头里渲染的是文档标签行 tabComponent，
    // 面板本身在 content-container 里 ⇒ 按 data-tab-panel-id 断言，不按文本）
    const centerHeader = visible[0];
    expect(centerHeader).toBeTruthy();
    expect(
      centerHeader!.closest('.dv-groupview')?.querySelector('[data-tab-panel-id="nm-center-default"]'),
    ).toBeTruthy();
  });

  it('中心组（被 center 面板抢占）的组头同样保留', async () => {
    const { container } = render(
      <DockShell
        panels={CENTER_PANELS}
        centerDefault={<div />}
        activeCenterKey={CENTER_KEY}
        openKeys={['notes', CENTER_KEY]}
      />,
    );
    await settle();

    const visible = groupHeaders(container).filter((h) => h.style.display !== 'none');
    expect(visible.length).toBe(1);
  });

  it('开→关一个侧栏面板后，可见组头数仍恒为 1（去层不因增删组而回退）', async () => {
    const ref = { current: null as DockShellApi | null };
    const { container, rerender } = render(
      <DockShell
        panels={PANELS}
        centerDefault={<div />}
        activeCenterKey={null}
        openKeys={[]}
        apiRef={ref as never}
      />,
    );
    await waitFor(() => expect(ref.current).toBeTruthy());
    await settle();
    expect(groupHeaders(container).filter((h) => h.style.display !== 'none').length).toBe(1);

    rerender(
      <DockShell
        panels={PANELS}
        centerDefault={<div />}
        activeCenterKey={null}
        openKeys={['chapters']}
        apiRef={ref as never}
      />,
    );
    await settle();
    expect(groupHeaders(container).filter((h) => h.style.display !== 'none').length).toBe(1);

    rerender(
      <DockShell
        panels={PANELS}
        centerDefault={<div />}
        activeCenterKey={null}
        openKeys={[]}
        apiRef={ref as never}
      />,
    );
    await settle();
    expect(groupHeaders(container).filter((h) => h.style.display !== 'none').length).toBe(1);
  });
});
