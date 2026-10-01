// ============================================================
// AI 写作台大模块 —— Server 面入口（**最小 no-op**）
//
// ★ 为什么必须存在（D32-Q6 / D51 的 blocker 根因之一）：
//   G1 结构门要求 `plugin.json` 的 `serverEntry`（缺省即 `./server/index.ts`）
//   所指向的**文件真实存在**（`existsSync` 必须为真）。缺则 `ENTRY_MISSING`
//   ⇒ 整个插件被拒 ⇒ `/api/health` 报 `status=error`
//   ⇒ kernel 的 `blocked(id)` 为真 ⇒ **Web 面从不挂载**。
//   这正是 D51 实测的「auto 项目永久卡在 Loading…」。
//
// ★ 本模块是**纯 Web 模块**：AI 写作台的界面与面板全在 `web/**`；
//   服务端能力（AI 路由 / 流水线 / 数据表）由**独立插件包** `novel.autowrite` 承担
//   （它有自己的 server 面 53 文件，见设计 §2.2）。
//   故本入口刻意保持**最小 no-op**：
//     · 不注册任何路由（不触碰 `ctx.routes`）
//     · 不改 DB（不触碰 `ctx.db`）
//     · 不注册任何服务 / 事件 / 定时器
//   它存在的唯一目的是**满足 G1 结构门**，使模块能被宿主正常装载。
//
// ★ 为什么 `inject` 是空数组而不是省略：
//   模块契约（`packages/core/src/context.ts:65-74` 的 `PluginModule`）允许
//   `inject?: string[]`。此处**显式导出空数组**表达「不需要任何宿主服务」——
//   声明了却不用是假承诺，还会让 G4/G5 拓扑排序无谓等待。
//   （注：G4/G5 实际读的是 `manifest.server.inject`，本模块 `plugin.json` 未声明该项。）
//
// ★ 为什么只 `import type` 且不导入 hono：
//   server 面不需要 Hono（不注册路由）。只取 core 的**类型**，可避免把
//   server-only 依赖拖进模块的 tsc 图（(a2) 配置 `include` 已含 `server/**/*`）。
//
// ★ 导入路径用**根 barrel** `@novel/core`（与仓库既有 4 个 server 面一致：
//   typography / novel.bookscan / worldbuilding / novel.autowrite 均如此），
//   取 `ServerPluginContext` —— 这是 **Server 面**，就该用 Server 面契约。
//
//   ⚠ 历史坑（已由队长修掉，留档防回退）：本文件初版曾改用 `@novel/core/web` 的
//   `PluginModule` 来绕开一个报错。当时 (a2) 报 4 条 TS6133，**全部在
//   `packages/core/src/loader.ts`、模块自身 0 条** —— 那是 core 的**既存死导入**
//   （`satisfiesMinVersion`/`DisposerBag`/`EventBus`/`HookBus`）被根 barrel
//   （`index.ts:10` 再导出 `./loader.js`）拉进模块图所致，与本入口写法无关。
//   根因已删（见 `packages/core/src/loader.ts` 头注释），故此处无需绕行。
//   另：`PluginModule['apply']` 的 `ctx` 是 `never`（`context.ts:71`），
//   将来若要在本入口写 `ctx.routes.register(...)` 会**类型层面写不出来** —— 故不采用。
// ============================================================

import type { ServerPluginContext } from '@novel/core';

export const name = 'novel.auto.workbench';

/** 不依赖任何宿主服务（纯 Web 模块的 server 面占位） */
export const inject: string[] = [];

/**
 * 挂载函数 —— **刻意 no-op**（见文件头说明）。
 *
 * 参数以 `_` 前缀命名：本模块 (a2) 的 `tsconfig.typecheck.json` 开了
 * `noUnusedParameters`，未使用参数会被判 `TS6133`；下划线前缀是 TS 认可的
 * 「刻意未用」写法（`noUnusedLocals` 对 `name`/`inject` 这两个**导出**符号不适用）。
 */
export function apply(_ctx: ServerPluginContext): void {
  // 有意留空：本模块服务端无任何事要做，入口存在的目的是过 G1 结构门。
}