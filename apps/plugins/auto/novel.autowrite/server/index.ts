// ============================================================
// 自动写作引擎插件 —— Server 面入口（**最小 no-op 骨架**）
//
// ★ 本文件是「实现已剥离」后的**接口骨架**：自动写作引擎的全部实现
//   （8 个聊天技能 + 状态/流水线路由 + 多代理流水线 + 记忆水车）已移出仓库，
//   暂存于 F:\new1.2-detached\ai-autowrite-module\novel.autowrite\，
//   装回步骤见 F:\new1.2-detached\ai-autowrite-module\PLUG-BACK.md。
//
// ★ 为什么必须存在（G1 结构门）：
//   `plugin.json` 的 `serverEntry`（缺省即 `./server/index.ts`）所指向的
//   **文件必须真实存在**（`existsSync`）。缺则 `ENTRY_MISSING`
//   ⇒ 整个插件被拒 ⇒ `/api/health` 报 `status=error`。
//   骨架入口的真实作用是**让契约（plugin.json）在仓库内继续可校验**，
//   装回时把实现原样覆盖回来即可，仓内 0 改动。
//
// ★ 与装回前实现的差异（诚实说明）：
//   装回前本文件的 `inject` 为 `['routes','db','ai']` 并注册 8 个技能 +
//   `/api/plugins/autowrite` 路由。骨架期：
//     · 不注册任何技能（`ctx.ai.skills` 不动）
//     · 不注册任何路由（`ctx.routes` 不动）⇒ `/api/plugins/autowrite/*` 恒 404
//     · 不改 DB、不注册任何服务 / 事件 / 定时器
//   这是「模块不在」的如实体现，而非伪装成「已加载」。
//
// ★ 为什么 `inject` 是空数组而不是保留 `['routes','db','ai']`：
//   服务端挂载期有注入可用性门（`INJECT_MISSING`）：声明了却用不到的服务
//   会让插件被跳过/上报。骨架不做任何事，故显式声明「不需要任何宿主服务」。
//   装回后由实现文件恢复原 inject。
//
// ★ 为什么只 `import type`：server 面不注册路由，不需要 Hono / 路由实现。
// ============================================================

import type { ServerPluginContext } from '@novel/core';

export const name = 'novel.autowrite';

/** 实现已剥离：骨架不依赖任何宿主服务 */
export const inject: string[] = [];

/**
 * 挂载函数 —— **刻意 no-op**（见文件头说明）。
 *
 * 参数以 `_` 前缀命名：本包 tsconfig 开了 `noUnusedParameters`，
 * 未使用参数会被判 `TS6133`；下划线前缀是 TS 认可的「刻意未用」写法。
 */
export function apply(_ctx: ServerPluginContext): void {
  // 有意留空：实现已剥离。装回时本文件被原实现覆盖。
}
