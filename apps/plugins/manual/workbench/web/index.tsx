// ============================================================
// 手写台大模块 —— Web 面入口（D1：一模块一包；D35：kernel 只经此入口引用）
//
// 职责：
//   1. registerProjectPanel × 12 —— 手写台工作台浮窗面板（modes: ['manual']）
//   2. registerBuiltinBubble('chapters') —— 「章节」气泡浮窗（LeftSidebar）
//      ★ D21：kernel ProjectLayout 的 chapterBubbleDef 改为按 key 'chapters'
//        取注册槽；模块缺席 ⇒ 该气泡不渲染（优雅降级）
//   3. 章节编辑器（ChapterEditor）经本入口的具名导出供 kernel 惰性引用（D35）
//
// 本入口由 main.tsx 的 import.meta.glob 自动收集
//   （'../../../apps/plugins/manual/*/web/index.tsx'）—— 目录即模式事实来源。
// ============================================================

import React from 'react';
import { BookOpen } from 'lucide-react';
import type { WebPluginContext } from '@novel/core/web';
import { BUILTIN_PANELS } from './panels';

// 章节气泡浮窗：懒加载保持 chunk 分割
const LeftSidebar = React.lazy(() =>
  import('./layout/LeftSidebar').then((m) => ({ default: m.LeftSidebar })),
);

export const name = 'novel.manual.workbench';
export const inject = ['projectPanels', 'builtinBubble'];

export function apply(ctx: WebPluginContext): void {
  // 1) 12 个手写台工作台面板
  for (const panel of BUILTIN_PANELS) {
    ctx.registerProjectPanel(panel);
  }

  // 2) 「章节」气泡浮窗（D21 键控多槽；缺席即不渲染）
  ctx.registerBuiltinBubble({
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