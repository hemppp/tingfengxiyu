// ============================================================
// plugin-dock-adaptation.test.ts — P4 插件适配的自证（t5 交付）
//
// 覆盖两个**只在运行时才能证伪**的契约点（静态字符串断言证明不了）：
//
//  1. **D9 去气泡化**（ADR §3.3）：
//     · 宿主 context 上 `registerBuiltinPanel`（新名）与 `registerBuiltinBubble`
//       （deprecated 别名）**必须同时可用且落到同一注册槽** `registry.builtinPanels`；
//     · 旧名不得消失（apps/server 的 AI 插件模板仍在吐 `builtinBubble`）。
//
//  2. **F1 中心槽抢占的宿主侧接线**（t9 评审发现，ADR §1.6）：
//     · `ProjectLayout` 的 `activeCenterKey` 不再硬编码 null，而是由
//       `resolveDockMeta(def).center` 派生；
//     · 语义：声明 `dock:{center:true}` 的面板**打开时**抢占中心槽、关闭后回落 null；
//     · 判定口径必须与 DockShell 的 `keyOfPanel/listPanels` 一致（只统计业务面板）。
//
// 说明：`activeCenterKey` 的推导逻辑在 ProjectLayout 组件内部，整壳挂载依赖
// react-router / 项目 store / 网络，故这里用**同口径的纯推导**做等价性验证，
// 并对 `resolveDockMeta` 这一**唯一真源**直接断言 —— 避免测试与实现各写一份。
//
// ⚠️ 但「同口径」不能只靠声称（本文件曾因此留下虚假保证，见 F-2）。因此除
// 纯函数用例之外，本文件另有一条**源码级漂移守卫**：直接读 `ProjectLayout.tsx`
// 的源码，断言 `activeCenterKey` 的取值优先级两个分支**都存在且顺序正确**。
// 镜像与实现一旦漂移，守卫用例即失败。
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Layers } from 'lucide-react';
import { createWebPluginContext, registerBuiltinPanelAsContext } from '@/plugin/host';
import { pluginRegistryApi, usePluginRegistry } from '@/plugin/registry';
import { resolveDockMeta, type DockPanelDef } from '@/components/shell/dock/types';
import { BUILTIN_PANELS } from '../panels';

function makeDef(key: string, over: Partial<DockPanelDef> = {}): DockPanelDef {
  return { key, label: key, icon: Layers, Component: () => null, ...over } as DockPanelDef;
}

/**
 * `ProjectLayout.activeCenterKey` 的**同口径**推导（纯函数镜像）。
 *
 * ⚠️ 本镜像**不是**「与实现对齐」的证明本身 —— 它只是把实现的取值优先级重写
 * 一遍，好让纯函数可测。此前该镜像只实现了「倒序扫描」一个分支却自称
 * 「与实现逐条对齐」，漏掉 `activeKey` 优先分支，即 F1 派生的**主路径**
 * （用户聚焦某个 center 面板时应当由它抢占中心槽）—— 属**虚假保证**：
 * 断言全绿，但绿得没有意义。为杜绝再次漂移，除补齐分支外，另加一条
 * **源码级漂移守卫**用例（见 describe 内 `drift guard`），直接对
 * `ProjectLayout.tsx` 断言两个分支的**存在与先后顺序**。
 *
 * 取值优先级（与 `ProjectLayout.tsx` L217-233 实现逐条对应）：
 *   1. dockview 当前**激活**面板若已打开且声明 center ⇒ 用它
 *   2. 否则回落：已打开集合中**最近打开**的 center 面板（倒序扫描首个命中）
 *   3. 否则 null（中心槽交回 `centerDefault` 的章节编辑器路由出口）
 */
function deriveActiveCenterKey(
  panels: DockPanelDef[],
  openKeys: string[],
  activeKey: string | null = null,
): string | null {
  const isCenter = (key: string): boolean => {
    const d = panels.find((p) => p.key === key);
    return !!d && resolveDockMeta(d).center;
  };
  // 1) 激活面板优先（仅当它确实处于已打开集合中）
  if (activeKey && openKeys.indexOf(activeKey) !== -1 && isCenter(activeKey)) {
    return activeKey;
  }
  // 2) 回落：已打开集合中最近打开的 center 面板
  for (let i = openKeys.length - 1; i >= 0; i--) {
    const k = openKeys[i];
    if (!k) continue;
    if (isCenter(k)) return k;
  }
  // 3) 无 center 面板被打开 ⇒ 中心槽用 centerDefault
  return null;
}

describe('D9 · registerBuiltinPanel 去气泡化（新名可用 + 旧名别名同落点）', () => {
  it('新名与旧名都注册进同一槽 registry.builtinPanels', () => {
    pluginRegistryApi.reset();
    const ctx = createWebPluginContext('t5.probe');

    // 旧名（deprecated 别名）—— 已发布插件 / AI 落盘插件走这条路
    const offOld = ctx.registerBuiltinBubble({ key: 'chapters', Component: () => null });
    expect(usePluginRegistry.getState().builtinPanels.map((b) => b.key)).toEqual(['chapters']);

    // 新名（契约推荐名）—— 本仓插件走这条路（经 kernel 垫片，绕开
    // `WebPluginContext` 尚未声明新名的**编译期**空档；运行时新名确实在 ctx 上）。
    const offNew = registerBuiltinPanelAsContext(ctx, {
      key: 'ai-chat',
      Component: () => null,
    });
    expect(usePluginRegistry.getState().builtinPanels.map((b) => b.key)).toEqual([
      'chapters',
      'ai-chat',
    ]);

    offNew();
    expect(usePluginRegistry.getState().builtinPanels.map((b) => b.key)).toEqual(['chapters']);
    offOld();
    expect(usePluginRegistry.getState().builtinPanels).toEqual([]);
    pluginRegistryApi.reset();
  });

  it('runtime host 确实带新名（host.ts 的 satisfies 断言不是空话）', () => {
    const ctx = createWebPluginContext('t5.probe.host-shape');
    // 编译期 `WebPluginContext` 只有旧名，故这里的**运行时**探测必须走断言 ——
    // 它证明的正是「类型空档 ≠ 运行时缺能力」：host.ts 真的挂了新名。
    const runtime = ctx as unknown as Record<string, unknown>;
    expect(typeof runtime.registerBuiltinPanel).toBe('function');
    expect(typeof runtime.registerBuiltinBubble).toBe('function');
  });

  it('deprecated 别名与旧槽名 builtinBubbles 均已从 state 移除（去气泡化落地）', () => {
    const state = usePluginRegistry.getState() as unknown as Record<string, unknown>;
    expect(state.builtinPanels).toBeDefined();
    expect(state.builtinBubbles).toBeUndefined();
  });
});

describe('F1 · 中心槽抢占的宿主侧接线（ADR §1.6 / D16）', () => {
  it('relationGraph 声明 dock:{center:true}，resolveDockMeta 判为 center', () => {
    const rg = BUILTIN_PANELS.find((p) => p.key === 'relationGraph');
    expect(rg).toBeTruthy();
    expect(rg?.dock?.center).toBe(true);
    expect(resolveDockMeta(rg as DockPanelDef).center).toBe(true);
  });

  it('其余 11 个面板缺省不抢占中心区（不误伤）', () => {
    const others = BUILTIN_PANELS.filter((p) => p.key !== 'relationGraph');
    expect(others).toHaveLength(11);
    for (const p of others) {
      expect(resolveDockMeta(p as DockPanelDef).center).toBe(false);
    }
  });

  it('activeCenterKey 不再硬编码 null：打开 center 面板即非 null，关闭后回落 null', () => {
    const panels = BUILTIN_PANELS as unknown as DockPanelDef[];

    // 未打开任何面板 → null（章节编辑器占中心区）
    expect(deriveActiveCenterKey(panels, [])).toBeNull();

    // 打开普通面板 → 仍为 null（不抢占）
    expect(deriveActiveCenterKey(panels, ['notes', 'outline'])).toBeNull();

    // 打开 relationGraph → 抢占
    expect(deriveActiveCenterKey(panels, ['notes', 'relationGraph'])).toBe('relationGraph');

    // 关闭 relationGraph → 回落到 null
    expect(deriveActiveCenterKey(panels, ['notes'])).toBeNull();
  });

  it('多个 center 面板同时打开时，取最后打开的占用中心区（互斥语义）', () => {
    const panels = [
      makeDef('relationGraph', { dock: { center: true } }),
      makeDef('storyMap', { dock: { center: true, slot: 'center' } }),
      makeDef('notes'),
    ];
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'notes', 'storyMap'])).toBe('storyMap');
    // 后打开者关闭 → 先前那个 center 面板重新占用（而不是直接回落空）
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'notes'])).toBe('relationGraph');
  });

  it('center 判定经 resolveDockMeta 单点取值，未声明 dock 的面板恒为 false', () => {
    // 缺省（无 dock 字段）→ false，与 ADR §1.4 缺省表一致
    expect(resolveDockMeta(makeDef('x')).center).toBe(false);
    // dock 为空对象 → 同样走缺省
    expect(resolveDockMeta(makeDef('x', { dock: {} })).center).toBe(false);
    // 显式 false → false（显式声明不改变语义）
    expect(resolveDockMeta(makeDef('x', { dock: { center: false } })).center).toBe(false);
  });

  // ------------------------------------------------------------------
  // F-2 修复：activeKey 优先分支（F1 派生的**主路径**）
  //
  // 修复前本文件只测了「倒序扫描」这一回落分支，activeKey 优先分支从未被覆盖
  // —— 而它才是用户实际最常触发的路径（聚焦某个 center 面板）。下面三条用例
  // 对该分支做正向 + 两条边界（未打开 / 非 center）覆盖。
  // ------------------------------------------------------------------
  it('F-2: 激活面板是已打开的 center 面板时优先取它（即使它不是最近打开的）', () => {
    const panels = [
      makeDef('relationGraph', { dock: { center: true } }),
      makeDef('storyMap', { dock: { center: true, slot: 'center' } }),
      makeDef('notes'),
    ];
    // 打开顺序 relationGraph → storyMap（storyMap 更晚），但用户聚焦 relationGraph
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'storyMap'], 'relationGraph')).toBe(
      'relationGraph',
    );
    // 反向聚焦 storyMap 时同样生效（对称性）
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'storyMap'], 'storyMap')).toBe('storyMap');
  });

  it('F-2: 激活面板**不在已打开集合**中时忽略它，回落倒序扫描', () => {
    const panels = [
      makeDef('relationGraph', { dock: { center: true } }),
      makeDef('storyMap', { dock: { center: true, slot: 'center' } }),
      makeDef('notes'),
    ];
    // activeKey 指向一个从未打开的面板（如 dockview 尚未同步）⇒ 不得抢占
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'storyMap'], 'ghostPanel')).toBe(
      'storyMap',
    );
  });

  it('F-2: 激活面板是已打开的**非 center** 面板时忽略它，回落倒序扫描', () => {
    const panels = [
      makeDef('relationGraph', { dock: { center: true } }),
      makeDef('notes'),
    ];
    // 用户聚焦普通面板 notes ⇒ 中心槽仍由 relationGraph 占用（不得回落 null）
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'notes'], 'notes')).toBe('relationGraph');
    // activeKey 为 null（无激活面板）⇒ 同样回落
    expect(deriveActiveCenterKey(panels, ['relationGraph', 'notes'], null)).toBe('relationGraph');
  });

  // ------------------------------------------------------------------
  // 源码级漂移守卫：镜像与实现必须同口径。
  //
  // 纯函数镜像的固有风险是「实现改了、镜像没改」而用例仍全绿（F-2 正是如此）。
  // 这里直接读实现源码，断言两个分支**存在且顺序正确**，把「逐条对齐」从
  // 注释里的声称变成可执行的断言。
  // ------------------------------------------------------------------
  it('drift guard: ProjectLayout.activeCenterKey 实现确实有 activeKey 优先分支，且先于倒序扫描', () => {
    // 注：jsdom 环境下 `import.meta.url` 不是 file: URL，故用 cwd 定位
    //（vitest 的 root = apps/web，process.cwd() 即该目录）。
    const candidates = [
      path.resolve(process.cwd(), 'src/components/shell/ProjectLayout.tsx'),
      path.resolve(process.cwd(), 'apps/web/src/components/shell/ProjectLayout.tsx'),
    ];
    const implPath = candidates.find((p) => existsSync(p));
    expect(implPath, `找不到 ProjectLayout.tsx（试过 ${candidates.join(' | ')}）`).toBeTruthy();
    const src = readFileSync(implPath as string, 'utf8');

    // ① 必须存在 activeKey 优先分支：activeKey && … indexOf(activeKey) !== -1 && isCenterPanel(activeKey)
    const activeFirst = src.indexOf('if (activeKey && openPanelKeys.indexOf(activeKey) !== -1');
    expect(activeFirst, 'ProjectLayout 缺少 activeKey 优先分支（F1 派生主路径）').toBeGreaterThan(-1);

    // ② 必须存在倒序扫描回落分支
    const fallback = src.indexOf('for (var i = openPanelKeys.length - 1; i >= 0; i--)');
    expect(fallback, 'ProjectLayout 缺少倒序扫描回落分支').toBeGreaterThan(-1);

    // ③ 顺序：activeKey 优先必须在倒序扫描**之前**
    expect(activeFirst, 'activeKey 优先分支必须在倒序扫描之前').toBeLessThan(fallback);

    // ④ 判定口径必须经 resolveDockMeta 单点取值，不得自写兜底
    const metaCall = src.indexOf('resolveDockMeta(def).center');
    expect(metaCall, 'center 判定必须经 resolveDockMeta 单点取值').toBeGreaterThan(-1);
    expect(metaCall).toBeLessThan(activeFirst);
  });
});
