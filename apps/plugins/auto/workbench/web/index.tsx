// ============================================================
// AI 写作台大模块 —— Web 面入口（D1：一模块一包；D35：kernel 只经此入口引用）
//
// ⚠ 本文件是**最小在场入口**，不是 AI 写作模块的实现回迁。
//   背景（t10「AI 自动写作模块剥离」）：auto 模块的**实现**已移出仓外，
//   仓内 auto/workbench 只剩骨架包（plugin.json + server/index.ts，no-op），
//   server 侧 hasModule('auto') === false。本入口不改动该事实。
//
// 它做两件事：
//   1. 补上 ADR §3.2 指出的**实测缺陷**：`'ai-chat'` 全仓 0 注册点
//      ⇒ 合池前 `chatBubbleDef` 恒为 null ⇒ AI 对话面板**从不渲染**。
//      t4 已按 §3.4 把 `'chapters'` / `'ai-chat'` 从 ProjectLayout 的 key 硬编码
//      查找改为**统一候选池**（`builtinPanels ∪ projectPanels`，按 key 去重），
//      故这里只要把槽注册上，合池后**自动生效**，ProjectLayout 无需任何改动。
//   2. 把该槽的 Component 补成**仓内真实实现** `./ai/AiChatPanel`
//      （t3 ②：消息列表 + Enter 发送 + 真实 `POST /api/ai/chat-stream` SSE 流式）。
//      面板本身是「对话 UI + ai.ts 流式协议」的消费方，与 auto 写作台实现是否
//      在场无关，因此它可以在**手写模式**下使用 —— 故 modes 放宽到
//      `['manual','auto']`（手写台的右栏就是它；见 t3 ③ 的跨模块约定）。
//      ⚠ 注意 auto 模式目前不渲染 DockShell（ProjectLayout.tsx:346 的固定工作台
//      分支在 WorkbenchMissing 时直接返回占位），所以 `'auto'` 这一项只是保持
//      槽的模式语义完整，实际生效面是 manual。
//
// 本入口由 main.tsx 的 import.meta.glob 自动收集
//   （'../../../apps/plugins/auto/*/web/index.tsx'）—— 目录即模式事实来源，
//   适用模式由父目录名 `auto` 推导（main.tsx:83 `pluginModeFromDir('auto')`）。
// ============================================================

import { lazy } from 'react';
import { MessageSquare } from 'lucide-react';
import type { WebPluginContext } from '@novel/core/web';
import { registerBuiltinPanelAsContext } from '@/plugin/host';

export const name = 'novel.auto.workbench';

// `builtinBubble` = manifest `web.inject` 的冻结枚举值（packages/core/src/manifest.ts:72）。
// 扩展点按 ADR §3.3 更名为 `registerBuiltinPanel`，但 **manifest 枚举不在本次改动范围**
// （packages/ 为 out-of-scope），故此处仍声明冻结值；kernel host.ts 的
// `registerBuiltinBubble` 实现内部已转发到新槽，二者落点一致。
export const inject = ['builtinBubble'];

// 与 manual 的 LeftSidebar 同款懒加载：面板未打开时不把面板代码拉进首屏
// （DockShell 的面板内容已在 Suspense/PanelGuard 内渲染）。
const AiChatPanel = lazy(() =>
  import('./ai/AiChatPanel').then((m) => ({ default: m.AiChatPanel })),
);

export function apply(ctx: WebPluginContext): void {
  // ADR §3.3 / D9：经 kernel 过渡期桥接以**新名语义**注册（旧名 `registerBuiltinBubble`
  // 是 deprecated 别名，二者落到同一注册槽 `registry.builtinPanels`）。
  registerBuiltinPanelAsContext(ctx, {
    key: 'ai-chat',
    label: 'AI 对话',
    icon: MessageSquare,
    // 右栏宽度量级取截图口径（panel 缺省 slot='right'，见 dock/types.ts:64）
    width: 340,
    height: 640,
    modes: ['manual', 'auto'],
    Component: AiChatPanel,
  });

  ctx.logger.info(
    'AI 写作台 Web 面已挂载（ai-chat 槽注册仓内真实对话面板，manual/auto 可用）',
  );
}
