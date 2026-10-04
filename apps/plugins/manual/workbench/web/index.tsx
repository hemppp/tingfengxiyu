// ============================================================
// 手写台大模块 —— Web 面入口（D1：一模块一包；D35：kernel 只经此入口引用）
//
// 职责：
//   1. registerProjectPanel × 12 —— 手写台工作台停靠面板（modes: ['manual']）
//   2. registerBuiltinPanel('chapters') —— 「章节」内置面板槽（LeftSidebar）
//      ★ D21：kernel ProjectLayout 的 chapterBubbleDef 改为按 key 'chapters'
//        取注册槽；模块缺席 ⇒ 该面板不渲染（优雅降级）
//      ★ ADR D9 / §3.3（本次改名）：扩展点由 `registerBuiltinBubble` 更名为
//        `registerBuiltinPanel`。「bubble（气泡）」是本次重构退役的 UI 形态词，
//        槽位本身作为扩展点保留（`'chapters'` 仍是键）。旧名在 kernel 侧保留为
//        deprecated 别名，此处**主动改名**以完成去气泡化。
//   3. 章节编辑器（ChapterEditor）经本入口的具名导出供 kernel 惰性引用（D35）
//
// 本入口由 main.tsx 的 import.meta.glob 自动收集
//   （'../../../apps/plugins/manual/*/web/index.tsx'）—— 目录即模式事实来源。
// ============================================================

import React from 'react';
import { BookOpen } from 'lucide-react';
import type { WebPluginContext } from '@novel/core/web';
import { registerBuiltinPanelAsContext } from '@/plugin/host';
import { BUILTIN_PANELS } from './panels';

// 章节面板内容：懒加载保持 chunk 分割
const LeftSidebar = React.lazy(() =>
  import('./layout/LeftSidebar').then((m) => ({ default: m.LeftSidebar })),
);

export const name = 'novel.manual.workbench';
export const inject = ['projectPanels', 'builtinBubble'];

export function apply(ctx: WebPluginContext): void {
  // 1) 12 个手写台工作台面板（ADR §7.1：FloatingPanelDef 全部既有字段保留 ⇒ 零改动）
  for (const panel of BUILTIN_PANELS) {
    ctx.registerProjectPanel(panel);
  }

  // 2) 「章节」内置面板槽（D21 键控多槽；缺席即不渲染）。
  //    ★ D9：经 kernel 的过渡期桥接函数以**新名语义**注册。
  //      为什么用 `registerBuiltinPanelAsContext(ctx, …)` 而不是 `ctx.registerBuiltinPanel(…)`：
  //      `WebPluginContext`（packages/core，本次不在改动范围）只声明了旧名
  //      `registerBuiltinBubble`，新名尚未落到接口上。桥接函数是 kernel 提供的
  //      新名入口，二者落到**同一个注册槽**（`registry.builtinPanels`）。
  //      退场条件见 `@/plugin/host.ts` 的 `registerBuiltinPanelAsContext` 注释。
  registerBuiltinPanelAsContext(ctx, {
    key: 'chapters',
    label: '章节',
    icon: BookOpen,
    Component: LeftSidebar,
    width: 320,
    height: 640,
    modes: ['manual'],
  });
}

// ------------------------------------------------------------------
// kernel 惰性引用的公开导出（D35）
//   App.tsx:24 `loadChapterEditor` 改指本入口，避免 kernel 静态 import
//   `@/components/editor/ChapterEditor`（K2M 边）。
// ------------------------------------------------------------------
export { ChapterEditor } from './editor/ChapterEditor';
export { EditorPage } from './editor/EditorPage';