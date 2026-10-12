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
//  2. **★ 2026-10-11 单列布局**（用户口径「点击那些功能需要显示在正页」）：
//     · 旧的「中心槽抢占」（F1：ProjectLayout 派生 activeCenterKey、
//       DockShell 建 `nm-center:<key>` 实例）已**整体废弃**；
//     · 现在**全部面板都作为中心组标签堆叠**（`planDockAreas` 把整池收进 center 桶）；
//     · `dock.center` 字段（ADR §1.4 冻结）仍保留在类型上，但布局层不再据它分流。
//
// 说明：除纯函数用例外，本文件另有一条**源码级漂移守卫**：直接读
// `ProjectLayout.tsx` 的源码，断言 center 抢占派生已被移除。镜像与实现一旦漂移，
// 守卫用例即失败。
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Layers } from 'lucide-react';
import { createWebPluginContext, registerBuiltinPanelAsContext } from '@/plugin/host';
import { pluginRegistryApi, usePluginRegistry } from '@/plugin/registry';
import { resolveDockMeta, type DockPanelDef } from '@/components/shell/dock/types';
import { planDockAreas } from '@/components/shell/dock/layout';
import { BUILTIN_PANELS } from '../panels';

function makeDef(key: string, over: Partial<DockPanelDef> = {}): DockPanelDef {
  return { key, label: key, icon: Layers, Component: () => null, ...over } as DockPanelDef;
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

// ============================================================
// ★ 2026-10-11 单列布局（用户口径「点击那些功能需要显示在正页」）
//
//   旧的「中心槽抢占」（F1）已废弃：ProjectLayout 不再派生 activeCenterKey，
//   DockShell 不再建 `nm-center:<key>` 实例 —— **全部面板都作为中心组标签堆叠**。
//   `dock.center` 字段（ADR §1.4 冻结）保留在类型上，但布局层不再据它分流。
//   下面把这条新口径钉死在注册表 + 布局层 + 源码漂移守卫三处。
// ============================================================
describe('单列布局 · 面板落位收敛（2026-10-11 用户口径）', () => {
  it('relationGraph 仍声明 dock:{center:true}（字段保留，resolveDockMeta 仍可读）', () => {
    const rg = BUILTIN_PANELS.find((p) => p.key === 'relationGraph');
    expect(rg).toBeTruthy();
    expect(rg?.dock?.center).toBe(true);
    expect(resolveDockMeta(rg as DockPanelDef).center).toBe(true);
  });

  it('resolveDockMeta.center 缺省仍为 false（ADR §1.4 缺省表不变）', () => {
    // 缺省（无 dock 字段）→ false
    expect(resolveDockMeta(makeDef('x')).center).toBe(false);
    // dock 为空对象 → 同样走缺省
    expect(resolveDockMeta(makeDef('x', { dock: {} })).center).toBe(false);
    // 显式 false → false
    expect(resolveDockMeta(makeDef('x', { dock: { center: false } })).center).toBe(false);
  });

  it('planDockAreas 把全部面板收进 center 桶（含声明 center:true / slot:left 的）', () => {
    const panels = [
      makeDef('relationGraph', { dock: { center: true } }),
      makeDef('notes'),
      makeDef('chapters', { dock: { slot: 'left' } }),
    ];
    const plan = planDockAreas(panels);
    expect(plan.center.map((d) => d.key)).toEqual(['relationGraph', 'notes', 'chapters']);
    expect(plan.left).toHaveLength(0);
    expect(plan.right).toHaveLength(0);
    expect(plan.bottom).toHaveLength(0);
  });

  // 源码级漂移守卫：中心槽抢占的宿主侧接线（activeCenterKey 派生）已删除。
  it('drift guard: ProjectLayout 不再派生 activeCenterKey / 不再自写 center 判定', () => {
    // 注：jsdom 环境下 `import.meta.url` 不是 file: URL，故用 cwd 定位
    //（vitest 的 root = apps/web，process.cwd() 即该目录）。
    const candidates = [
      path.resolve(process.cwd(), 'src/components/shell/ProjectLayout.tsx'),
      path.resolve(process.cwd(), 'apps/web/src/components/shell/ProjectLayout.tsx'),
    ];
    const implPath = candidates.find((p) => existsSync(p));
    expect(implPath, `找不到 ProjectLayout.tsx（试过 ${candidates.join(' | ')}）`).toBeTruthy();
    const src = readFileSync(implPath as string, 'utf8');

    // 旧的 center 抢占派生（activeCenterKey / isCenterPanel）已整体移除
    expect(src.includes('activeCenterKey'), 'activeCenterKey 抢占派生应已删除').toBe(false);
    expect(src.includes('isCenterPanel'), 'isCenterPanel 判定应已删除').toBe(false);
    // 整池透传给 DockShell（分类真源在 DockShell 内部）
    expect(src.includes('allShellPanels')).toBe(true);
  });
});
