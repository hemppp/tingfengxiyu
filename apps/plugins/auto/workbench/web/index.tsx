// ============================================================
// AI 写作台大模块 —— Web 面入口（D1：一模块一包；D35：kernel 只经此入口引用）
//
// ⚠ 本文件是**最小在场入口**，不是 AI 写作模块的实现回迁。
//   背景（t10「AI 自动写作模块剥离」）：auto 模块的**实现**已移出仓外，
//   仓内 auto/workbench 只剩骨架包（plugin.json + server/index.ts，no-op），
//   server 侧 hasModule('auto') === false。本入口不改动该事实。
//
// 它唯一做的事，是补上 ADR §3.2 指出的**实测缺陷**：
//   `'ai-chat'` 全仓 0 注册点 ⇒ 合池前 `chatBubbleDef` 恒为 null
//   ⇒ AI 对话面板**从不渲染**（即便 auto 实现装回也一样）。
//   t4 已按 §3.4 把 `'chapters'` / `'ai-chat'` 从 ProjectLayout 的 key 硬编码查找
//   改为**统一候选池**（`builtinPanels ∪ projectPanels`，按 key 去重），
//   故这里只要把槽注册上，合池后**自动生效**，ProjectLayout 无需任何改动。
//
// ★ 注册的是空槽（Component 缺席 ⇒ 不渲染任何东西），语义与「实现未安装」一致：
//   与 kernel `WorkbenchMissing` / `hasModule('auto')===false` 的既有降级口径对齐，
//   不伪造兜底实现（见 moduleEntries.ts 的同名纪律）。
//
// 本入口由 main.tsx 的 import.meta.glob 自动收集
//   （'../../../apps/plugins/auto/*/web/index.tsx'）—— 目录即模式事实来源，
//   适用模式由父目录名 `auto` 推导（main.tsx:83 `pluginModeFromDir('auto')`）。
// ============================================================

import type { WebPluginContext } from '@novel/core/web';
import { registerBuiltinPanelAsContext } from '@/plugin/host';

export const name = 'novel.auto.workbench';

// `builtinBubble` = manifest `web.inject` 的冻结枚举值（packages/core/src/manifest.ts:72）。
// 扩展点按 ADR §3.3 更名为 `registerBuiltinPanel`，但 **manifest 枚举不在本次改动范围**
// （packages/ 为 out-of-scope），故此处仍声明冻结值；kernel host.ts 的
// `registerBuiltinBubble` 实现内部已转发到新槽，二者落点一致。
export const inject = ['builtinBubble'];

export function apply(ctx: WebPluginContext): void {
  // ADR §3.3 / D9：经 kernel 过渡期桥接以**新名语义**注册（旧名 `registerBuiltinBubble`
  // 是 deprecated 别名，二者落到同一注册槽 `registry.builtinPanels`）。
  registerBuiltinPanelAsContext(ctx, {
    key: 'ai-chat',
    label: 'AI 对话',
    width: 420,
    height: 720,
    modes: ['auto'],
    // ★ 刻意不给 Component：auto 模块实现缺席时该槽为空 ⇒ 候选池里存在但渲染为空，
    //   不会在 auto 工作台里出现一个坏掉的面板；实现装回后由实现方注册真实组件。
  });

  ctx.logger.info(
    'AI 写作台 Web 面骨架已挂载（仅注册 ai-chat 内置面板空槽；实现未安装）',
  );
}
