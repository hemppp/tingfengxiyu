// ============================================================
// AI 写作台大模块 —— Web 面入口（D1：一模块一包；D35：kernel 只经此入口引用）
//
// ⚠ 本文件是**最小在场入口**，不是 AI 写作模块的实现回迁。
//   背景（t10「AI 自动写作模块剥离」）：auto 模块的**实现**已移出仓外，
//   仓内 auto/workbench 只剩骨架包（plugin.json + server/index.ts，no-op），
//   server 侧 hasModule('auto') === false。本入口不改动该事实。
//
// ★ 隔离改造（本轮）：本入口**不再注册任何槽**。
//   原先它注册 builtinPanel `'ai-chat'`（modes: ['manual','auto']）以补 ADR §3.2 的
//   实测缺陷「`'ai-chat'` 全仓 0 注册点 ⇒ AI 对话面板从不渲染」。但那让
//   **手写台右栏的 UI 由 AI 写作模块提供**：既跨模块（manual 的使用面依赖 auto 包在场），
//   也让同一个 key 在 ProjectLayout 的 `builtinPanels ∪ projectPanels` 合池里出现两个
//   注册者（`byKey.set` 后写覆盖、无告警 ⇒ 谁生效取决于 glob 挂载顺序）。
//   现该槽已收回手写台自有：`apps/plugins/manual/workbench/web/index.tsx` 以
//   key='ai-chat'、modes:['manual'] 注册，实现是 manual 的 `web/ai/AiChatPanel.tsx`
//   （面板 + SSE 解析两个文件均已移交，含其预取）。
//
//   因此本入口的 `apply()` 是**有意为之的空实现**（只留一条日志），`inject` 清空：
//   auto 模块在 Web 面不参与任何扩展点 ⇒ 手写模式的面板与代码路径不再引用 auto。
//   原 `web/ai/**` 三个文件保留为留档（各文件头注已标明「已移交」），
//   产品路径上已无引用。
//
// 本入口仍保留在场的意义：`apps/web/src/plugin/moduleEntries.ts` 用 `import.meta.glob`
//   精确收集 `plugins/(auto|manual)/*/web/index.tsx`（「目录即模式事实来源」）。
//   auto 目录缺席本身也是受支持状态
//   （`scripts/verify/verify-workbench-isolation.mjs` 的 `SUPPORTED_ABSENT`），
//   故本入口在场/缺席都不会破坏 kernel 行为。
// ============================================================

import type { WebPluginContext } from '@novel/core/web';

export const name = 'novel.auto.workbench';

// ★ 隔离改造：不再声明任何扩展点 —— 本模块 Web 面不注册槽位。
//   （原值 `['builtinBubble']` 随 `'ai-chat'` 槽一并移交 `novel.manual.workbench`。）
export const inject: string[] = [];

export function apply(ctx: WebPluginContext): void {
  ctx.logger.info(
    'AI 写作台 Web 面入口已挂载（本入口不注册任何槽；AI 对话面板已移交 novel.manual.workbench）',
  );
}

// ★ 隔离改造：本入口不再导出 `preload()`。
//   原预取内容只有 `./ai/AiChatPanel` 一个懒加载 chunk，现已随面板移交 manual
//   （其预取由 manual 入口的 `preload()` 负责）。kernel 的
//   `moduleEntries.ts:loadModulePreload()` 对「模块未导出 preload」是显式容许的
//   （`if (typeof mod.preload !== 'function') return;`），故本模块无需空实现占位。
