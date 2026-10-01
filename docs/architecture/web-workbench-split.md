# Web 工作台插件式拆分设计（kernel / manual / auto 三层）

> 目标：把 `apps/web` 从「单包双工作台」重构为**插件式三层** ——
> **kernel 宿主** > **manual（手写台）/ auto（AI 写作台）两个大模块** > **各自「大类」子插件**，
> 并保证**任一模块关闭 / 分离后，另一模块仍完全可用**。
>
> 状态：**设计稿（未改动任何业务代码）**。写范围仅本文件；`apps/**`、`packages/**`、`scripts/**` 未改动。
> 证据规则：每条结论附 `路径:行号`；无法核实的显式标注 **「未核实」**，不做臆测。
> **已按队长裁决 D1 修订**：两个大模块各只对应**一个**插件包
> （`apps/plugins/manual/workbench/` = `@novel-plugins/manual-workbench`、`apps/plugins/auto/workbench/` = `@novel-plugins/auto-workbench`），
> 「大类子插件」以模块包内 `web/<大类>/` **目录**体现，不各自成包。裁决原文见 `.workbuddy/split-workbenches/CAPTAIN-DECISIONS.md`。

---

## 0. 口径、基线与回滚点（验收命令必须在此环境跑）

| 项 | 实测值 | 来源 |
|---|---|---|
| Node | **v24.14.1** | 本机 `node -v` 实测 |
| pnpm | **11.8.0** | 根 `package.json:24`（`packageManager`） |
| 工作区包 | `apps/*` + `apps/plugins/*`（顶层）+ `apps/plugins/{manual,auto,shared,local}/*` + `packages/*` | `pnpm-workspace.yaml:2-10`（F19 补全 `apps/plugins/*` 一行） |
| 重构前基线 · 类型 | `pnpm --filter @novel/web type-check` → **exit 0** | `.workbuddy/split-workbenches/BASELINE.md`（队长实测） |
| 重构前基线 · 单测 | `pnpm --filter @novel/web test` → **14 文件 / 182 用例全绿（≈4.7s）** | `.workbuddy/split-workbenches/BASELINE.md`（队长实测）；14 个测试文件见 §6.1 L3 |
| 版本控制 | **本仓库没有 git（`.git` 不存在）** | 本机 `Test-Path .git` → `False` |
| 唯一回滚点 | `.workbuddy/split-workbenches/backup-baseline/baseline-20260929-235002.zip`（293 条目） | `.workbuddy/split-workbenches/BASELINE.md` |

> **182 个用例是回归红线**：任何搬迁都必须让这 14 个测试文件继续全绿，**不得删测**。
> 本仓库无 git，因此**没有版本控制回滚**，唯一回滚手段是解压快照覆盖（见 §8.2）。

### 0.1 既有「模式分离」成果（本次重构的地基，已落地）

- 模式契约：`packages/core/src/mode.ts:16-20`（`PLUGIN_MODES = manual|auto|shared`）、
  `:46-59`（`pluginModeFromDir`，目录名即事实来源）、`:61-74`（`pluginAppliesToProjectMode`）。
- 安装门 G2.5（目录 ↔ `manifest.modes` 严格一致，否则 `MODE_MISMATCH`）：
  `packages/core/src/install.ts:139-143`、`:78-79`。
- 两套面板注册表已物理分开：`apps/web/src/plugin/builtin.ts:37-50`（12 面板，全部 `modes: ['manual']`）
  vs `apps/web/src/plugin/autoBuiltin.ts:43-51`（5 面板，全部 `modes: ['auto']`）。
- 宿主分流：`apps/web/src/components/layout/ProjectLayout.tsx:592-600`（`project.mode === 'auto'` → 整屏交给 `AutoWriteWorkbench`）。
- 服务端 `HOST_MODE` 裁剪：`apps/server/src/plugin/host.ts:842-861`（不匹配者 `status: 'skipped'`，**可见非消失**）。
- 运行时跨模式门禁：`apps/server/src/plugin/host.ts:338-354`（404 + `PLUGIN_MODE_MISMATCH`）。
- Web 面构建期清单显式带 `modes`：`apps/web/src/main.tsx:58-64`；模式目录自动收集 `apps/web/src/main.tsx:75-103`。
- 端到端验证脚本已存在：`scripts/verify/verify-plugin-mode-separation.mjs`、`scripts/e2e/e2e-mode-separation.mjs`。

**结论**：模式分离在「插件集合」层面已经成立；本次要补的是 **`apps/web` 单包内部的文件级隔离**。

---

## 1. 现状分离度审计

### 1.1 已分离项（可直接复用，不需重做）

| 能力 | 证据 |
|---|---|
| 模式白名单 / 判定 / 目录推导 | `packages/core/src/mode.ts:16-20,46-59,61-74` |
| 手写台面板清单（12） | `apps/web/src/plugin/builtin.ts:37-50` |
| AI 工作台面板清单（5） | `apps/web/src/plugin/autoBuiltin.ts:43-51` |
| 注册表 + 模式过滤纯函数 | `apps/web/src/plugin/registry.ts:142-265`、`:277-304` |
| 宿主 mode 分流（整屏二选一） | `apps/web/src/components/layout/ProjectLayout.tsx:592-600` |
| chatRail 单槽 + 内置兜底 | `apps/web/src/plugin/registry.ts:41-42,139-140,218-227`、`ProjectLayout.tsx:364-405` |
| 服务端 HOST_MODE 过滤 | `apps/server/src/plugin/host.ts:842-861` |
| 运行时项目模式门禁 | `apps/server/src/plugin/host.ts:338-354` |
| Web 面构建期清单 | `apps/web/src/main.tsx:58-64,75-103` |

### 1.2 未分离项与双向耦合清单（逐条带证据）

> 真值表来源：`.workbuddy/split-workbenches/COUPLING-TRUTH-TABLE.md` 与 **`tools/import-graph-v2.json`**（队长只读脚本生成，已逐条复核行号）。
> **真正必须消解的跨模块边共 11 条**（**4 条 manual→auto + 7 条 auto→manual**），其余是「组装」或「同域」。
> （round 1 漏记 2 条 manual→auto：`EditorPage.tsx:21`、`:22`，本版按 D9 补齐，故总数由 9 修正为 11。）

**A. manual → auto（4 条，必须消解）**

| 编号 | 边 | 证据 |
|---|---|---|
| M1 | `components/editor/panels/QuickPhraseBubble.tsx` → `services/ai/quickPhraseService` | `apps/web/src/components/editor/panels/QuickPhraseBubble.tsx:17`（用法 `:17` 导入 `generateQuickPhrases`） |
| M2 | `components/timeline/TimelineView.tsx` → `services/ai/scanService` | `apps/web/src/components/timeline/TimelineView.tsx:8`（用法 `:156` `scanService.extractEventsByKeyword`） |
| M3（D9 补） | `components/editor/EditorPage.tsx` → `hooks/useAutoEntityDetection.ts` | `apps/web/src/components/editor/EditorPage.tsx:21`（`import { useAutoEntityDetection } from '@/hooks/useAutoEntityDetection'`；调用 `:166`；证据 `tools/import-graph-v2.json`） |
| M4（D9 补） | `components/editor/EditorPage.tsx` → `hooks/useLatestChapterPolling.ts` | `apps/web/src/components/editor/EditorPage.tsx:22`（`import { useLatestChapterPolling } from '@/hooks/useLatestChapterPolling'`；调用 `:181`；证据 `tools/import-graph-v2.json`） |

> **M3/M4 为何是 manual→auto**：`useAutoEntityDetection`（`hooks/useAutoEntityDetection.ts:13,16,18`）与 `useLatestChapterPolling`
> （`hooks/useLatestChapterPolling.ts:22,25`）都依赖 auto 侧的 `services/ai/*`（`aiRedstoneStore`、`scanService`、`aiService`）与
> `stores/aiRedstoneStore`。manual 的 `EditorPage` 经这两个 hook 间接静态依赖 auto 能力 → 属 manual→auto 边，
> 须按 §4 行 C3 的 `ai.scan` 能力契约消解（见 §4）。

**B. auto → manual（7 条，全部是「图元语」，一次下沉即可根治）**

| 编号 | 边 | 证据 |
|---|---|---|
| A1-A3 | `ChapterPlanGraphPanel` → `knowledge/graph/{GraphShell,StageNode,EntityNode}` | `apps/web/src/components/layout/ChapterPlanGraphPanel.tsx:23,24,25` |
| A4-A5 | `MemoryGraphPanel` → `knowledge/graph/{GraphShell,EntityNode}` | `apps/web/src/components/layout/MemoryGraphPanel.tsx:29,30` |
| A6-A7 | `PipelineGraphPanel` → `knowledge/graph/{GraphShell,StageNode}` | `apps/web/src/components/layout/PipelineGraphPanel.tsx:28,29` |
| A8（注册表侧） | `plugin/autoBuiltin.ts` → `components/knowledge/RelationGraph` | `apps/web/src/plugin/autoBuiltin.ts:31-32`（面板 `entities`，`:46`） |

> **`components/knowledge/graph/*` 是 auto→manual 的唯一共享面**（下沉即切断，见 §4 行 A1-A8）。
> `RelationGraph`（A8）是「手写台组件被 AI 侧复用」，按 §4 行 A1-A8 处理。

**C. kernel → 模块（属「组装」而非「耦合」，但需按入口约束）**

| 编号 | 边 | 证据 | 处置 |
|---|---|---|---|
| K1 | `plugin/builtin.ts` → 12 个 manual 组件 | `apps/web/src/plugin/builtin.ts:18-29` | 该文件**随 manual 模块迁走** |
| K2 | `plugin/autoBuiltin.ts` → 5 个 AI 面板 | `apps/web/src/plugin/autoBuiltin.ts:21-37` | 该文件**随 auto 模块迁走** |
| K3 | `App.tsx` → 9 个页面/壳 | `apps/web/src/App.tsx:22-30` | 保留 kernel，但只经**模块导出入口**引用 |

**D. 其余「未分离」但需在文档裁决的共享面**（§3 逐条定归属）

- `stores/index.ts`（入边 61）—— `apps/web/src/stores/index.ts`（864 行）。
- `hooks/useCurrentProjectId.ts`（15）、`utils/safeConfirm.ts`（14）、`utils/errors.ts`（12）、
  `stores/authStore.ts`（8）、`utils/gsap.ts`（8）、`services/data/databaseService.ts`（7）、
  `services/editor/entityDetector.ts`（7，两模块都用）、`services/editor/styleService.ts`（6）等。
- 反向小边：`services/data/localUserData.ts:10` → `stores/chatHistoryStore`（`localUserData` 又被
  `stores/authStore.ts:78` 与 `services/data/databaseService.ts:805` 动态引用）。

### 1.3 体量（判断搬迁成本）

| 文件 | 行数 |
|---|---|
| `apps/web/src/components/ai/ChatPanel.tsx` | 2051 |
| `apps/web/src/components/layout/AutoWriteWorkbench.tsx` | 1365 |
| `apps/web/src/hooks/useAutoEntityDetection.ts` | 981 |
| `apps/web/src/stores/index.ts` | 864 |
| `apps/web/src/components/knowledge/graph/Graph3D.tsx` | 659 |

---

## 2. 三层结构与命名

```
第 0 层  kernel（宿主）            apps/web/src/**  +  packages/core（契约）
             │  只做：路由壳 / 注册表 / 扩展点 / 跨模块共享服务；不含任何业务工作台 UI
             ▼
第 1 层  两个大模块（各 = **一个** 插件包，路径与包名已冻结，见 D1）
   manual 手写台   apps/plugins/manual/workbench/   @novel-plugins/manual-workbench   modes:["manual"]
   auto   AI 写作台 apps/plugins/auto/workbench/     @novel-plugins/auto-workbench     modes:["auto"]
             │  各自 registerProjectPanel / registerRoute / registerSettingsSection …
             ▼
第 2 层  「大类」子插件（**以模块包内 `web/<大类>/` 目录体现**，不各自成包）
```

### 2.1 manual 手写台 · 大类子插件清单（单包 `@novel-plugins/manual-workbench`，大类以 `web/<大类>/` 目录体现）

| 大类（目录） | 职责 | 现有来源 |
|---|---|---|
| `web/editor/` | 手写台壳 + 编辑器：`ProjectLayout` 手写分支、章节编辑器、写作模式、面板栏 | `plugin/builtin.ts:37-50`、`components/editor/**` |
| `web/knowledge/` | 知识库：角色 / 地点 / 物品 / 关系图 / 地图 / 积分账本 / 一致性 | `components/knowledge/**`、`components/consistency/**`、`plugin/builtin.ts:20-23,28` |
| `web/timeline/` | 时间线面板 | `components/timeline/**`、`plugin/builtin.ts:24` |
| `web/foreshadow/` | 伏笔 / 标记 | `components/foreshadow/**`、`plugin/builtin.ts:25` |
| `web/outline-notes/` | 大纲 + 笔记 | `components/outline/**`、`components/notes/**`、`plugin/builtin.ts:19,26` |
| `web/stats/` | 写作统计 | `components/stats/**`、`plugin/builtin.ts:27` |
| `web/export/` | 导出 / 导入 / 快照 | `components/export/**`、`components/snapshot/**`、`plugin/builtin.ts:29` |
| `web/reference/` | 参考书 / 扫榜拆书入口 | `components/editor/ReferenceReader.tsx`、`plugin/builtin.ts:18` |

> 既有 `apps/plugins/manual/novel.bookscan/`、`apps/plugins/manual/worldbuilding/` 为**独立插件包**，保持不变（不是本模块的大类子目录）。

### 2.2 auto AI 写作台 · 大类子插件清单（单包 `@novel-plugins/auto-workbench`，大类以 `web/<大类>/` 目录体现）

| 大类（目录） | 职责 | 现有来源 |
|---|---|---|
| `web/discuss/` | AI 工作台壳：`AutoWriteWorkbench` 三栏、交流流、正文区、状态栏；AI 对话面板 + chatRail（技能开关 / 工具 / Agent 模式） | `components/layout/AutoWriteWorkbench.tsx`、`plugin/autoBuiltin.ts:43-51`、`components/ai/ChatPanel.tsx`、`AiChatBubbleRail.tsx`、`services/ai/{chatService,skillLibrary,…}` |
| `web/pipeline/` | 多智能体流水线面板 | `components/layout/{PipelineGraphPanel,ChapterPlanGraphPanel}.tsx` |
| `web/memory/` | 记忆审计面板 | `components/layout/MemoryGraphPanel.tsx` |
| `web/skills/` | 技能库面板 + 技能开关 | `components/layout/SkillLibraryPanel.tsx`、`components/ai/AgentSkillsPanel.tsx` |
| `web/entities/` | 实体与设定面板（复用 shared `ui-graph` 图元） | `plugin/autoBuiltin.ts:31-32,46`、`components/knowledge/RelationGraph.tsx` |

> `apps/plugins/auto/novel.autowrite/` 为**独立插件包**（server 面 53 文件），保持不变。

### 2.4 模块边界与「同目录兄弟包不随 workbench 消失」（t31 补记 · T30-O2）

> 本节显式固化一条**容易被后人改错**的语义。它已由 D46 实证踩过一次坑（见下），
> 故单独立节，并在 `plugin/moduleEntries.ts` 处交叉引用（同一陷阱的两面）。

**(1) 模块边界的定义**

模块 = `apps/plugins/{manual,auto}/workbench` 这**一个目录**。
「移走模块」「模块缺席」在全部验证脚本里都是**字面意义地移走该目录**
（`scripts/verify/verify-module-removal.mjs` 用 `fs.renameSync` 把它挪到暂存区，`finally` 还原）。
即：**移除单元 = `workbench/` 一层，不向上扩到模式目录、也不向下细分。**

**(2) 同目录兄弟包不随之消失**

`apps/plugins/auto/novel.autowrite/`、`apps/plugins/manual/novel.bookscan/`、
`apps/plugins/manual/worldbuilding/` 是**独立插件包**（见上文 §2.1 L152、§2.2 L164），
它们与 `workbench/` **同处一个模式目录下**（`apps/plugins/auto/`、`apps/plugins/manual/`），
但**不随 `workbench/` 目录的移走而消失** —— 移走模块后，它们仍在树里、仍会被 glob 收集、仍会构建。

这条看似显然，却是**「另一模块缺席仍可用」最容易失守的地方**：

**(3) 由此产生的陷阱（D46 实证）**

`novel.autowrite` 的 `web/chat-wheel.tsx` 需要 `SkillsBar` / `QuickPromptsBar`。
一度写成经 **auto 模块公开入口**引用：

```ts
import { SkillsBar, QuickPromptsBar } from '@novel-plugins/auto-workbench/web';  // ✗ 曾经的写法
```

后果（实测）：移走 `apps/plugins/auto/workbench/` 后，`novel.autowrite` **依然在场**，
而它这条 import 的说明符已解析不到 → vite 在 `load-fallback` 阶段硬失败：

```
[vite:load-fallback] Could not load …/apps/plugins/auto/workbench/web/index.tsx
(imported by ../plugins/auto/novel.autowrite/web/chat-wheel.tsx): ENOENT
```

⇒ `build` **exit 1**，「任一模块缺席另一模块仍可用」**不成立**。
注意这不是理论推演：它就是 t6/t7 独立验证里那条 ENOENT 的成因。

**正确做法 = 经恒在的 shared 包引用**（D46 首选方案，现为唯一实现）：

```ts
// 展示层：@novel-plugins/ui-kit（严格叶子，不依赖 kernel / auto）
import { SkillsBar, QuickPromptsBar } from '@novel-plugins/ui-kit';
// 技能数据：@novel-plugins/data-core 连接层（与 auto 模块共用同一注册表实例）
import { useSkillBarProps } from '@novel-plugins/data-core';
```

`ui-kit` / `data-core` 位于 `apps/plugins/shared/`，**不属于任何模块**，故任一模块缺席都不影响其解析。
（`novel.autowrite` 无 `react-router-dom` 依赖，其「打开设置」经 `nm:open-settings` 事件桥
由 kernel 壳监听导航，见 §7.5。）

**(4) 防回归提示（硬约束）**

- **禁止**把 `novel.autowrite` 对 `SkillsBar`/`QuickPromptsBar` 的引用改回模块公开入口
  （`@novel-plugins/auto-workbench/web` 或任何 `auto-workbench` 子路径）。
- **禁止**把 `novel.autowrite` 当作 auto 模块的「大类子目录」一并移走 ——
  它是独立插件包，不是模块的一部分；扩大移除范围会让验证失去意义（把「模块缺席」偷换成「整个模式目录缺席」）。

**(5) 同一陷阱的另一面：模块入口 glob 必须精确到 `workbench`**

`apps/web/src/plugin/moduleEntries.ts` 的 `ENTRY_SUFFIX` 写死了
`/plugins/{manual,auto}/workbench/web/index.tsx` 两条**精确**路径，**不得**改成
`manual/*/web/index.tsx` 这类通配。原因与 (2) 完全相同：兄弟包的 `web/index.tsx`
同样会被通配命中。实测 tinyglobby 键顺序为
`auto/novel.autowrite` → `auto/workbench` → `manual/novel.bookscan` → `manual/workbench`，
故 `find(k => k.includes('/plugins/manual/'))` 会**错误命中 `novel.bookscan`**，导致：

- `loadModuleComponent('manual','ChapterEditor')` 取不到导出 → 运行时报错；
- `hasModule()` **恒为 true**（兄弟插件总在）→ 「模块缺席检测」彻底失效，D44 的优雅降级退化为空转。

两面归纳成一句：**「模块」= `workbench` 这一个目录；凡按模式目录（`manual/`、`auto/`）或按
`*/web/index.tsx` 通配来判断「模块在不在」的写法，都会把兄弟包误算成模块，从而让缺席检测失效。**

### 2.3 shared 共享包（两模块都可用，不含业务工作台）

| 包 | 目录 | 职责 |
|---|---|---|
| `@novel-plugins/ui-graph` | `apps/plugins/shared/ui-graph/` | **图元语**：`GraphShell` / `BubbleNode` / `EntityNode` / `StageNode` / `useForceLayout` / `enhancedEdges` / `Graph3D` |
| `@novel-plugins/ui-kit` | `apps/plugins/shared/ui-kit/` | 通用 UI 原子：`primitives/**`、`ErrorBoundary`、`ToastProvider`、`InkBackButton`、`safeConfirm`、`gsap`、`errors` |
| `@novel-plugins/data-core` | `apps/plugins/shared/data-core/` | 共享数据/服务：`apiClient`、`databaseService`、`entityDetector`、`authStore`、`projectStore`、`themeStore` |

> 契约层仍是 `packages/core`（`@novel/core` / `@novel/core/web`），不属于任何模块，见 `packages/core/package.json`。

---

## 3. 文件归属矩阵（`apps/web/src` → kernel | manual | auto | shared）

### 3.1 一级目录总表（覆盖 `apps/web/src` 全部一级目录）

| 一级路径 | 归属 | 目标落点 | 证据 / 说明 |
|---|---|---|---|
| `apps/web/src/components/` | 见 §3.2 | 拆到 kernel/manual/auto/shared | 子目录逐一裁决 |
| `apps/web/src/dev/` | **kernel**（开发态） | 留 `apps/web/src/dev/` | `dev/primitivesPreview.tsx:19` 只引 `components/ai/primitives` → 改为 `@novel-plugins/ui-kit`；`dev/shuimoPreview.tsx` 无跨域引用 |
| `apps/web/src/hooks/` | 见 §3.5 | 拆到 kernel/manual/auto | `hooks/useCurrentProjectId.ts:7` 等 |
| `apps/web/src/pages/` | **kernel** | 留 `apps/web/src/pages/` | 页面由 `App.tsx:22-30` 组装；`pages/SettingsPage.tsx:2,9-11` 引 stores 与设置区块 |
| `apps/web/src/plugin/` | **kernel**（仅 `registry/host/types`） | 留 `apps/web/src/plugin/{registry,host,types}.ts` | `plugin/builtin.ts`→manual、`plugin/autoBuiltin.ts`→auto（K1/K2） |
| `apps/web/src/routes/` | **kernel** | 留 `apps/web/src/routes/` | `routes/Lazy.tsx`、`NotFoundPage.tsx`、`PageFade.tsx`、`paths.ts`、`ScrollToTop.tsx`；`App.tsx:11-15` 引用 |
| `apps/web/src/services/` | 见 §3.3 | 拆到 kernel/manual/auto/shared | 子目录逐一裁决 |
| `apps/web/src/stores/` | 见 §3.4 | 拆到 kernel/manual/auto/shared | `stores/index.ts` 必须切分 |
| `apps/web/src/styles/` | **kernel** | 留 `apps/web/src/styles/` | `main.tsx:4,7,11` 全局引入 4 个 css |
| `apps/web/src/test/` | **kernel** | 留 `apps/web/src/test/` | `apps/web/vitest.config.ts` `setupFiles: ['./src/test/setup.ts']` |
| `apps/web/src/types/` | **kernel** | 留 `apps/web/src/types/` | `d3-force-3d.d.ts`、`desktop-api.d.ts`（全局声明） |
| `apps/web/src/utils/` | 见 §3.6 | 拆到 kernel/shared/manual | — |
| `apps/web/src/App.tsx` | **kernel** | 留 | `App.tsx:22-30` 组装页面；`:164-166,219` 消费插件路由 |
| `apps/web/src/main.tsx` | **kernel** | 留 | 构建期清单 `main.tsx:58-64,75-103` |
| `apps/web/src/vite-env.d.ts` | **kernel** | 留 | 全局类型声明 |

### 3.2 `components/*` 子目录裁决

| 路径 | 归属 | 目标落点 | 证据 |
|---|---|---|---|
| `components/ai/` | **auto** | `apps/plugins/auto/workbench/web/discuss/chat/` | 唯一消费者在 auto 侧：`ProjectLayout.tsx:23-24,29`（kernel→auto，需按 §4 行 C1 收口）；`autoBuiltin.ts:36` 引 `SkillLibraryPanel`（`:19` 引 `AgentSkillsPanel`） |
| `components/consistency/` | **manual**（迁移或保留，见 §3.7） | `apps/plugins/manual/workbench/web/knowledge/` | `ConsistencyPanel.tsx:3` 仅引 `services/misc/consistencyService`；0 入边，按 §3.7 准则 B 迁移保留 |
| `components/editor/` | **manual** | `apps/plugins/manual/workbench/web/editor/` | `App.tsx:24` → `ChapterEditor`；`builtin.ts:18` → `ReferenceReader` |
| `components/effects/` | **kernel** | 留 `apps/web/src/components/effects/` | `App.tsx:9-10,234-235` 全局挂载 |
| `components/export/` | **manual** | `apps/plugins/manual/workbench/web/export/` | `builtin.ts:29` 注册导出面板；`ExportDialog.tsx:4-5` 引 manual 侧服务 |
| `components/foreshadow/` | **manual** | `apps/plugins/manual/workbench/web/foreshadow/` | `builtin.ts:25` 注册伏笔面板 |
| `components/knowledge/` | **manual**（`graph/` → **shared**） | `apps/plugins/manual/workbench/web/knowledge/`；`graph/` → `apps/plugins/shared/ui-graph/` | `builtin.ts:20-23,28`；`graph/*` 被 auto 三面板引用（§1.2 B） |
| `components/layout/` | **kernel 壳** + **manual** + **auto**（见 §3.8） | 按文件拆分 | `ProjectLayout.tsx` 为 kernel 壳 |
| `components/notes/` | **manual** | `apps/plugins/manual/workbench/web/outline-notes/` | `builtin.ts:26` |
| `components/outline/` | **manual** | `apps/plugins/manual/workbench/web/outline-notes/` | `builtin.ts:19` → `OutlinePage`；`OutlinePage.tsx:1` → `OutlineManager` |
| `components/series/` | **manual**（迁移或保留，§3.7） | `apps/plugins/manual/workbench/web/` | `SeriesManager.tsx:4` 仅引 `safeConfirm`；0 入边，按 §3.7 准则 A 迁移（删除另行立项，D8） |
| `components/settings/` | **kernel 壳** + **auto**（见 §3.9） | `AIConfigPanel/LocalModelPanel` → `auto/workbench/web/discuss/`；其余留 kernel | `SettingsPage.tsx:5,9,10,11,12` |
| `components/shuimo/` | **kernel** | 留 `apps/web/src/components/shuimo/` | 主题层，`main.tsx:11` 全局 css 配套 |
| `components/snapshot/` | **manual**（迁移或保留，§3.7） | `apps/plugins/manual/workbench/web/export/` | `SnapshotManager.tsx:3` 引 `databaseService`；0 入边，按 §3.7 准则 B 迁移保留 |
| `components/stats/` | **manual** | `apps/plugins/manual/workbench/web/stats/` | `builtin.ts:27` → `WritingDashboard` |
| `components/timeline/` | **manual** | `apps/plugins/manual/workbench/web/timeline/` | `builtin.ts:24` → `TimelinePage`；M2 边 `TimelineView.tsx:8` |
| `components/ui/` | **kernel/shared** | `apps/plugins/shared/ui-kit/src/`（`ErrorBoundary`/`ToastProvider`/`InkBackButton`） | `ErrorBoundary` 6 处、`ToastProvider` 5 处、`InkBackButton` 4 处（含 `App.tsx:7-8`） |

### 3.3 `services/*` 裁决

| 路径 | 归属 | 证据 |
|---|---|---|
| `services/api/` | **shared**（data-core） | `apiClient.ts:423` `baseUrl: VITE_API_BASE_URL \|\| '/api'`；`authApi.ts:7` 引 `stores/authStore` 类型 |
| `services/ai/` | **auto** | **主要** auto 消费（`AutoWriteWorkbench.tsx:43,48,49`、`ChatPanel.tsx:10,25,29`、`MemoryGraphPanel.tsx:26-28`、`PipelineGraphPanel.tsx:23-26`）；例外见 §4 行 M1/M2（两条 manual→auto）、§4 行 C3（manual hooks `useAutoEntityDetection`/`useLatestChapterPolling`/`useScanProcessors`）与 §3.7（待处理面板 `MemoryAuditPanel.tsx:27`）——非「仅 auto 消费」 |
| `services/auth/` | **shared**（data-core） | `sessionKeepalive.ts:15` 引 `stores/authStore`；`App.tsx:6` 调用 |
| `services/data/` | **shared** + **manual** 混合 | `databaseService.ts:26`（shared）、`chapterLocalCache.ts`（shared，`databaseService.ts:298` 动态引）、`localUserData.ts:10`（shared，**值引用** `stores/chatHistoryStore`（auto）→ 形成 **shared→auto 已知边**，消解见 §4 行 C2）、`exportService.ts`（manual，`ExportDialog.tsx:4`）、`syncService.ts:7,28,44`（**shared**，唯一**真实**消费者 `ProjectLayout.tsx:13`（D4 后属 kernel 壳）→ 按 D10「kernel 壳消费者 ⇒ shared」归 shared；其余 20+ 处（如 `useEditorInstance.ts:431`、`ChapterEditor.tsx:12`）均为**注释/日志提及**，非真实 import） |
| `services/editor/` | **shared** | `entityDetector.ts` 7 处引用（manual+auto 都用）；`styleService.ts` 6 处；`rhythmService.ts` **零入边**（§3.7） |
| `services/misc/` | 混合 | `consistencyService.ts:6`（manual，仅 `ConsistencyPanel`）、`projectExportService.ts:12,424`（manual）、`webSearchService.ts:7`（**零入边**，§3.7） |
| `services/security/` | 混合 | `securityService.ts`（auto：`ChatPanel.tsx:14`、`webSearchService.ts:6`）、`encryptionService.ts`（**保留 · kernel**：`pages/SettingsPage.tsx:14-19` 静态导入，`SettingsPage` 属 kernel —— 见 §3.7 F2） |

### 3.4 `stores/*` 裁决（含 `stores/index.ts` 切分）

| 文件 | 归属 | 目标 | 证据 |
|---|---|---|---|
| `stores/index.ts` | **必须切分** | 见下表 3.4.1 | 入边 61（manual 35 / auto 16 / kernel 3） |
| `stores/authStore.ts` | **shared**（data-core） | 全局认证 | 8 处引用：`App.tsx:5`、`ProjectLayout.tsx:10`、`services/api/authApi.ts:7`、`services/auth/sessionKeepalive.ts:15`、`pages/{AdminPage,BookshelfPage,LoginPage,RegisterPage}` |
| `stores/themeStore.ts` | **shared**（ui-kit） | 主题 | `main.tsx:13`、`AppearancePanel.tsx:12` |
| `stores/panelOpenStore.ts` | **kernel** | 浮窗开合状态（跨模式） | `ProjectLayout.tsx:21`、`EditorPanelRail.tsx:11` |
| `stores/cascadeCleanFlag.ts` | **shared** | 级联清理标志 | `stores/index.ts:3`、`syncService.ts:7`、`useEntityChapterSync.ts:24` |
| `stores/referenceStore.ts` | **shared** | 参考书 | `ProjectLayout.tsx:8`、`ChatPanel.tsx:26`、`ReferenceReader.tsx:9`、`BookScanDirectory.tsx:9` |
| `stores/chatHistoryStore.ts` | **auto** | AI 对话历史 | `ChatPanel.tsx:8`、`localUserData.ts:10` |
| `stores/aiRedstoneStore.ts` | **auto** | AI 功能开关 | `ChatPanel.tsx:7`、`useAutoEntityDetection.ts:13`、`useLatestChapterPolling.ts:22`、`AIRedstonePanel.tsx:1-2` |
| `stores/aiStore.ts` | **auto** | AI 配置 | `AIConfigPanel.tsx:2` |
| `stores/workspaceStore.ts` | **auto** | AI 工作台面板状态 | `AutoWriteWorkbench.tsx:35`、`stores/__tests__/workspaceStore.test.ts:12` |
| `stores/editorStore.ts` | **shared** | 编辑器状态 | `useEditorInstance.ts:14`、`ChatPanel.tsx:9` |
| `stores/outlineNotepadStore.ts` | **shared**（data-core） | 大纲记事本（共享数据层） | manual 侧 `OutlineManager.tsx:31`；auto 侧 `ChatPanel.tsx:6,467,551`、`OutlineFillDialog.tsx:17,126-128` **直接 import** → 若归 manual 即产生 auto→manual 边，故必须 shared（与契约 §3.3 对齐，F22） |
| `stores/chapterJumpStore.ts` | **manual** | 章节跳转 | `EditorPage.tsx:3`、`TimelineFlowChart.tsx:3` |

> **归属规则（F4/D7/D10 · 逐符号判定）**：`stores/index.ts` 的每个导出**按符号单独判定**归属，
> 判据为「**任一 kernel 壳（`App.tsx` / `pages/**`）消费者 ⇒ 归 shared**」，其次看是否有**跨模块消费者**（⇒ shared），
> 仅当**唯一消费者全部落在同一模块**时才归该模块。禁止按文件整体归属。
> 例：`useStatsStore` 被 kernel 的 `pages/SettingsPage.tsx:2,36-37` 消费（`dailyGoal`/`setDailyGoal`）⇒ **shared**（见 §3.4.1），
> 而非「仅手写台消费」。

#### 3.4.1 `stores/index.ts` 切分方案（864 行 → 3 个 store 包 + 兼容壳）

| 迁出去向 | 具体 store | 依据（消费者） |
|---|---|---|
| **shared**（`@novel-plugins/data-core`） | `useProjectStore`（`stores/index.ts:62`）、`useChapterStore`（`:92`）、`useCharacterStore`（`:143`）、`useItemStore`（`:202`）、`useCreditStore`（`:248`）、`useLocationStore`（`:275`）、`useEventStore`（`:302`）、`useForeshadowStore`（`:330`）、`useEarmarkStore`（`:387`）、`useAnnotationStore`（`:437`）、`useOutlineStore`（`:467`）、`useTimelineStore`（`:497`）、`useNoteStore`（`:522`）、`getForeshadowThreshold`（`:47`）、`cascadeCleanChapterClient`（`:739`）、**`useStatsStore`（`:650`）** | 实体/领域数据，manual 面板与 auto 侧 `useAutoEntityDetection.ts:12` 同时消费 → 只有 shared 才能切断模块间边；`cascadeCleanChapterClient` 消费者跨模块：`useEditorInstance.ts:13,158`（manual）+ `LeftSidebar.tsx:3,417`（manual）→ 属共享数据层（F21）；`useStatsStore` 被 **kernel** 的 `pages/SettingsPage.tsx:2,36-37` 消费（`dailyGoal`/`setDailyGoal`）→ 必须 shared，否则形成 kernel→manual 边（F4/D7/D10） |
| **manual**（`@novel-plugins/manual-workbench`） | `useQuickPhraseStore`（`:695`）、`useUIStore`（`:574`，含 `leftSidebarTab/rightSidebarTab`，见 `:559-562`） | 唯一消费者全在手写台：`QuickPhraseBubble.tsx:14`、`LeftSidebar`/`EditorPanelRail`（无 kernel/auto 消费者） |
| **auto** | 无（auto 专用 store 已各自独立：`chatHistoryStore`/`aiStore`/`aiRedstoneStore`/`workspaceStore`） | 见 §3.4 |
| **kernel** | 无（kernel 只保留 `panelOpenStore`） | — |

> ⚠️ **歧义点 1**：`useCharacterStore` 等实体 store 同时被 manual 面板与 **auto 的 `useAutoEntityDetection`**
> 使用（`useAutoEntityDetection.ts:12`、`ChapterPlanGraphPanel.tsx:22`）。这不是「模块互引」而是**共享数据层**问题：
> 实体 store 归 **shared**（`@novel-plugins/data-core`），manual/auto 各自 import 它，
> 从而 auto 侧不再指向 manual。
> **最终归属：实体 store 全部 → shared（data-core），不归 manual**。
> 若把实体 store 判给 manual，则 auto 侧 `ChapterPlanGraphPanel.tsx:22` 会成为新的 auto→manual 边，
> 直接违反 §4 总原则 —— 这是本条裁决的硬理由。

> ⚠️ **歧义点 2（兼容壳）**：`apps/web/src/stores/index.ts` 是否保留？
> **结论：保留一个「re-export 壳」，由 t4 维护（队长裁决 D3：`stores/index.ts` 唯一写者 = t4，t5 只读），仅存活一个迭代**：
> ```ts
> // apps/web/src/stores/index.ts（过渡壳，t4 维护；下个里程碑删除）
> export * from '@novel-plugins/data-core/stores';
> export * from '@novel-plugins/manual-workbench/stores';   // 仅当 manual 模块已挂载
> ```
> 但**门禁要求该壳不得被 auto 侧引用**：auto 侧必须直接 import `@novel-plugins/data-core/stores`，
> 否则「移除 manual 后 auto 仍可用」不成立。该禁令由 §6.3 断言 A'（auto 域禁引 `@/stores` 壳）强制。
> 壳的删除条件见 §7.5。

### 3.5 `hooks/*` 裁决

| 文件 | 归属 | 证据 |
|---|---|---|
| `hooks/useCurrentProjectId.ts` | **shared** | 15 处引用（`QuickPhraseBubble.tsx:16` … `TimelineView.tsx:3`）；`main.tsx:26` 注册 getter |
| `hooks/useGlassRipple.ts` | **kernel/shared** | `BookCard.tsx:6`、`BookshelfPage.tsx:7`、`BottomDrawer.tsx:3` |
| `hooks/useAchievements.ts` | **manual** | 仅 `WritingDashboard.tsx:5` |
| `hooks/useEntityChapterSync.ts` | **manual** | 仅 `EditorPage.tsx:23` |
| `hooks/useAutoEntityDetection.ts` | **manual** | 仅 `EditorPage.tsx:21,166`（**非死代码**：经 `EditorPage` → `ChapterEditor` ← `App.tsx:24` 可达） |
| `hooks/useLatestChapterPolling.ts` | **manual** | 仅 `EditorPage.tsx:22,181`（**非死代码**，同上） |
| `hooks/useScanProcessors.ts` | **manual** | 仅被 `useAutoEntityDetection.ts:18` 引用（**非死代码**，同上） |

### 3.6 `utils/*` 裁决

| 文件 | 归属 | 证据 |
|---|---|---|
| `utils/errors.ts` | **shared**（ui-kit） | 12 处引用（`apiClient.ts:7` … `PipelinePanel.tsx:33`） |
| `utils/safeConfirm.ts` | **shared**（ui-kit） | 14 处引用（`EntityForm.tsx:5` … `SettingsPage.tsx:6`） |
| `utils/gsap.ts` | **shared**（ui-kit） | 8 处引用（`EditorPage.tsx:7` … `RegisterPage.tsx:6`） |
| `utils/chapter.ts` | **manual** | `ChapterEditor.tsx:6`、`EditorPage.tsx:8` |
| `utils/characterMerge.ts` | **shared** | `ItemManager.tsx:11`、`useAutoEntityDetection.ts:17`、`useLatestChapterPolling.ts:26`、`useScanProcessors.ts:14` |
| `utils/credentials.ts` | **kernel**（保留） | **有活跃静态导入**：`pages/LoginPage.tsx:9` `} from '@/utils/credentials';`（多行 import，`:6-8` 为 `getCredentials`/`saveCredentials`/`clearCredentials`），用法 `:42-45,66,68`；`pages/` 属 kernel → 归 kernel（F1，原「零入边」判定错误） |
| `utils/date.ts` | **kernel/shared** | 仅 `BookCard.tsx:3` |

### 3.7 零入边文件逐条处置（**一律「迁移或保留」**）

> 判定前提：队长脚本跳过 `__tests__`；本表已用 `Select-String` 复扫**全 `apps/web/src`（含 `__tests__`）**。
> **队长裁决 D8**：本表**不再给出任何「删除」结论**，一律改为「**迁移或保留**」。
> 删除**留待独立后续任务**处理，且必须：**(a) 独立复扫**（`__tests__` + `lazy(() => import(...))` + `key:`/字符串动态引用）、
> **(b) 全量回归**（`pnpm --filter @novel/web type-check` + `pnpm --filter @novel/web test`，182 用例全绿）、
> **(c) 单独立项评审** —— 三者齐备前不得删除任何文件。
>
> **「迁移 vs 保留」判定准则（F15）**：
> - **准则 A**：0 入边 **且**功能已被图谱版/新壳明确取代（有注释为证）→ **迁移**（先随模块搬迁，删除另行立项）。
> - **准则 B**：0 入边 **但**属未接线/待接线能力，或仍有测试在跑 → **迁移并保留**（`PipelinePanel.tsx` 即此类，测试红线）。
> - **准则 C**：**有活跃入边**（曾被误判为零入边）→ **保留**，按消费者归属。

| 文件 | 行数 | 结论 | 准则 | 理由 / 证据 |
|---|---|---|---|---|
| `components/layout/AIRedstonePanel.tsx` | 180 | **迁移 → auto（保留）** | B | 引 `stores/aiRedstoneStore`（`:1-2`），是 AI 功能开关面板；属 auto 域能力，由 `auto/workbench/web/discuss/` 接管 |
| `components/layout/BottomDrawer.tsx` | 195 | **迁移 → shared（ui-kit）** | B | 引 `hooks/useGlassRipple`（`:3`），是通用抽屉壳；`AutoWriteWorkbench` 注释里提到旧用法（`:1260`） |
| `components/layout/EntityRail.tsx` | 236 | **迁移 → auto（保留）** | A | 0 入边；引 stores（`:30`）。与 `WorldStateBoard` 的分工注释（`:15-17`）表明已被 `RelationGraph` 面板取代；删除另行立项 |
| `components/layout/MemoryAuditPanel.tsx` | 255 | **迁移 → auto（保留）** | A | 0 入边；`MemoryGraphPanel.tsx:9` 注释明言「原 MemoryAuditPanel 是三段文字…改成图谱」；删除另行立项 |
| `components/layout/PipelinePanel.tsx` | 629 | **迁移 → auto + 保留测试** | B | 唯一引用是 `components/layout/__tests__/PipelinePanel.test.tsx:14`；`PipelineGraphPanel.tsx:11` 声明是其**功能超集**。**因 182 用例红线，保留测试、不得删组件**（D8 明确） |
| `components/layout/RightSidebar.tsx` | 36 | **迁移 → shared（ui-kit）**（D19-①） | B | 0 入边，纯容器；下沉模式无关的共享包 `@novel-plugins/ui-kit`，两侧皆可用、无模块间边；删除另行立项 |
| `components/layout/StatusBar.tsx` | 120 | **迁移 → auto（保留）** | A | 0 入边；`EditorPage.tsx:130` 仅注释提及 |
| `components/layout/WorkspacePane.tsx` | 164 | **迁移 → auto（保留）** | A | 0 入边；`AutoWriteWorkbench.tsx:1260` 注释说明已改为页面切换 |
| `components/layout/WorldStateBoard.tsx` | 220 | **迁移 → auto（保留）** | A | 0 入边；`ChapterPlanGraphPanel.tsx:4` 注释说明已被图谱版替代 |
| `components/consistency/ConsistencyPanel.tsx` | 148 | **迁移 → manual（保留）** | B | 引 `consistencyService`（`:3`），属手写台能力；由 `manual/workbench/web/knowledge/` 接管 |
| `components/series/SeriesManager.tsx` | 160 | **迁移 → manual（保留）** | A | 0 入边，仅引 `safeConfirm`（`:4`）；删除另行立项 |
| `components/snapshot/SnapshotManager.tsx` | 338 | **迁移 → manual（保留）** | B | 引 `databaseService`（`:3`），是章节快照能力，与编辑器强相关 |
| `components/knowledge/Heatmap.tsx` | 114 | **迁移 → manual（保留）** | A | 0 入边，引 4 个实体 store（`:1`）；删除另行立项 |
| `components/export/ImportDialog.tsx` | — | **迁移 → manual（保留）** | B | 按准则 B 保留（`projectExportService.ts:424` 仅为**注释**提及，非引用 —— 依据更正，结论方向不变） |
| `components/foreshadow/EarmarkPanel.tsx` | — | **迁移 → manual（保留）** | B | `EarmarkPanel.tsx:4-5` 引 `EarmarkBadge`/`EarmarkDialog`；反向 `SelectionMenu.tsx:6` 引 `EarmarkDialog`。`EarmarkPanel` 本身 0 入边，按准则 B 保留 |
| `components/foreshadow/ForeshadowsPage.tsx` | — | **迁移 → manual（保留）** | B | 仅 `ForeshadowsPage.tsx:3` 自身；无入边，按准则 B 保留 |
| `components/editor/extensions/MentionExtension.ts` | — | **迁移 → manual（保留）** | A | 0 入边，未被 `useEditorInstance.ts:5-12` 引入；删除另行立项 |
| `components/editor/extensions/RealtimeRhythm.tsx` | — | **迁移 → manual（保留）** | A | 0 入边；删除另行立项 |
| `services/editor/rhythmService.ts` | 147 | **迁移 → shared（保留）**（D19-②） | A | 0 入边（无任何 import 方；内部 `import('../api/apiClient')` 是出边非入边）；与同目录 `entityDetector`/`styleService` 一致，保持 `services/editor/` 语义单一；删除另行立项 |
| `services/misc/webSearchService.ts` | — | **迁移 → auto（保留）** | A | 0 入边；仅引 `apiClient`（`:7`）、`securityService`（`:6`）；删除另行立项 |
| `services/ai/aiService.ts` | — | **迁移 → auto（保留）** | A | 0 入边（`aiService` 仅 `:83` 自身导出）；与 `chatService.ts`/`scanService.ts` 功能重叠；删除另行立项 |
| `services/security/encryptionService.ts` | — | **保留 · kernel**（F2） | C | **有活跃静态导入**：`pages/SettingsPage.tsx:14-19` `} from '@/services/security/encryptionService';`（`saveEncrypted`/`loadEncrypted`/`deleteEncrypted`/`listEncryptedKeys`），`SettingsPage` 属 kernel → 归 kernel。原「零入边」判定错误 |
| `utils/credentials.ts` | 105 | **保留 · kernel**（F1） | C | **有活跃静态导入**：`pages/LoginPage.tsx:9`（多行 import），用法 `:42-45,66,68`；`LoginPage` 属 kernel → 归 kernel。原「零入边」判定错误 |
| `pages/ProjectSelectPage.tsx` | 109 | **保留 · kernel** | C | 0 入边（已复扫：`App.tsx:22-30` 路由表未注册、无 `lazy(() => import(...))`/`key:`/字符串路径命中 —— 补齐 F20 证据）；`pages/` 属 kernel，随 kernel 保留；删除另行立项 |
| `components/layout/__tests__/PipelinePanel.test.tsx` | — | **保留** | — | 属 14 个基线测试文件之一（**不得删测**） |

> **本轮修订说明（D8）**：原表 9 处「删除（候选）」已全部改为「迁移或保留」；
> 其中 `utils/credentials.ts`、`services/security/encryptionService.ts` 两条由「删除候选」**改判为保留**（F1/F2，有活跃入边）。
> 任何删除动作须满足上文 (a)(b)(c) 三项前置，并作为**独立后续任务**立项。

### 3.8 `components/layout/` 逐文件归属（kernel 壳迁出后：shell / manual / auto）

> **队长裁决 D4**：kernel 壳 `ProjectLayout.tsx`、`PanelSection.tsx`、`FloatingBubbles.tsx` 迁入**新增**目录
> `apps/web/src/components/shell/`；`components/layout/` **其余文件全归 auto**（不再有 kernel 文件留在 `layout/`）。
> `ProjectLayout.tsx` 唯一引用点 `App.tsx:22`（`import('./components/layout/ProjectLayout')`），改动成本极低。

| 文件 | 归属 | 证据 |
|---|---|---|
| `components/shell/ProjectLayout.tsx` | **kernel**（壳，从 `layout/` 迁入） | `ProjectLayout.tsx:15-24`、`:519-538`、`:592-600`、`:695-721`；唯一引用 `App.tsx:22` |
| `components/shell/PanelSection.tsx` | **kernel**（壳，从 `layout/` 迁入） | 引 `components/ai/primitives`（`:2`）→ 改 `@novel-plugins/ui-kit` |
| `components/shell/FloatingBubbles.tsx` | **kernel**（壳，从 `layout/` 迁入） | `ProjectLayout.tsx:17,711` |
| `layout/LeftSidebar.tsx` | **manual** | `ProjectLayout.tsx:529`（章节气泡面板）；**D21：经新增扩展点 `registerBuiltinBubble` 的 `chapters` 槽注入**（`LeftSidebar` 由 manual 注册），故 kernel 无静态边 |
| `layout/TrashDialog.tsx` | **manual** | `LeftSidebar.tsx:8,595` |
| `layout/WorkbenchPlan.tsx` | **auto** | `AutoWriteWorkbench.tsx:36`、`ChapterPlanGraphPanel.tsx:26`、`WorldStateBoard.tsx:30` |
| `layout/BubbleRail.tsx` | **auto** | `AutoWriteWorkbench.tsx:39,1081` |
| `layout/TabBar.tsx` | **auto** | `AutoWriteWorkbench.tsx:41,1123` |
| `layout/QuickOpen.tsx` | **auto** | `AutoWriteWorkbench.tsx:42,1356` |
| `layout/workspaceDefs.ts` | **auto** | `AutoWriteWorkbench.tsx:47` |
| `layout/AutoWriteWorkbench.tsx` | **auto** | `ProjectLayout.tsx:32-34`（kernel→auto 组装边） |
| `layout/{PipelineGraphPanel,ChapterPlanGraphPanel,MemoryGraphPanel,SkillLibraryPanel}.tsx` | **auto** | `autoBuiltin.ts:21-37,44-50` |
| `layout/{AIRedstonePanel,EntityRail,MemoryAuditPanel,PipelinePanel,StatusBar,WorkspacePane,WorldStateBoard}.tsx` | **auto**（迁移或保留，见 §3.7） | 0 入边 |
| `layout/{BottomDrawer,RightSidebar}.tsx` | **shared（ui-kit）**（T13-F1；见 §3.7 本表上方两行） | 0 入边，纯容器 → 下沉 `@novel-plugins/ui-kit`；**不归 auto** |

> **D4 影响面**：契约 §5 的 kernel 禁止前缀含 `@/components/layout/`，D4 后 `layout/` **无 kernel 文件**
> （壳迁 `components/shell/`；其余文件归 auto，`BottomDrawer`/`RightSidebar` 归 shared(ui-kit)——见 §3.7），
> 该规则**无需例外即可自洽**（kernel 壳位于 `components/shell/`，不在禁止前缀内）；契约 §6 的 t3 可改路径需增列 `apps/web/src/components/shell/**`。

### 3.9 `components/settings/` 逐文件归属（歧义点裁决）

| 文件 | 归属 | 理由 |
|---|---|---|
| `settings/AIConfigPanel.tsx` | **auto**（AI 模块面板，由设置页壳装配） | 内容为 AI 供应商/模型配置，引 `stores/aiStore`（`:2`）、`services/ai/aiClient`（`:3-5`）。**裁决（D5）：属 auto 模块，经既有 `registerSettingsSection`（`WEB_SERVICES` 已含 `settings`，`manifest.ts:65`）+ 模式过滤装配，不新增契约**；kernel 的 `SettingsPage.tsx:9` 静态 import 改为注册表渲染；auto 缺失时该区块整块消失，设置页其余不受影响 |
| `settings/LocalModelPanel.tsx` | **auto** | 引 `services/ai/aiClient`（`:3`），被 `AIConfigPanel.tsx:22,729` 引用 |
| `settings/AppearancePanel.tsx` | **kernel** | 引 `stores/themeStore`（`:12`），全局外观 |
| `settings/PluginManagerSection.tsx` | **kernel** | 插件管理，引 `apiClient`（`:10`）、`safeConfirm`（`:11`） |
| `settings/PluginSettingsSections.tsx` | **kernel** | 插件设置区宿主，引 `plugin/registry`（`:11`） |
| `settings/UpdateSection.tsx` | **kernel** | 更新检查 |

### 3.10 目标包结构（F9/D1：单包 `apps/plugins/{manual,auto}/workbench/`）

```
apps/web/src/                                  # kernel（宿主壳）
├── App.tsx  main.tsx  vite-env.d.ts
├── components/{effects,shuimo}/               # 全局层
├── components/shell/{ProjectLayout,PanelSection,FloatingBubbles}.tsx   # kernel 壳（D4：从 layout/ 迁入）
├── plugin/{registry,host,types}.ts            # 只留注册表/宿主/契约（builtin/autoBuiltin 迁走）
├── pages/  routes/  styles/  test/  types/  dev/
├── utils/{credentials,date}.ts                # kernel 工具（credentials 有 LoginPage 活跃入边，F1）
└── stores/{panelOpenStore.ts}                 # kernel 自留极少数

apps/plugins/shared/
├── ui-graph/    {package.json(plugin.json), web/index.ts, src/{GraphShell,BubbleNode,EntityNode,StageNode,useForceLayout,enhancedEdges,Graph3D}}
├── ui-kit/      src/{primitives/**, ErrorBoundary, ToastProvider, InkBackButton, safeConfirm, gsap, errors}
└── data-core/   src/{api/{apiClient,authApi,queryClient}, data/{databaseService,chapterLocalCache,localUserData,syncService}, editor/{entityDetector,styleService}, security/encryptionService, stores/{authStore,projectStore,chapterStore,entityStores,useStatsStore,outlineNotepadStore,cascadeCleanChapterClient,themeStore,editorStore,referenceStore,cascadeCleanFlag,useCurrentProjectId}}

apps/plugins/manual/
├── workbench/   # @novel-plugins/manual-workbench · modes ['manual'] · 单包
│   ├── plugin.json
│   ├── web/index.tsx（builtin.ts 迁入，注册 12 个 manual 面板）
│   ├── web/{editor,knowledge,timeline,foreshadow,outline-notes,stats,export,reference}/
│   │   └── editor/{LeftSidebar,TrashDialog}   # layout/ 中的手写台 UI 迁入 manual（非 kernel 壳、非 auto）
│   └── stores/index.ts（手写台专属 store 聚合：useQuickPhraseStore / useUIStore / chapterJumpStore）
├── novel.bookscan/      # 现状（独立插件包）
└── worldbuilding/       # 现状（独立插件包）

apps/plugins/auto/
├── workbench/   # @novel-plugins/auto-workbench · modes ['auto'] · 单包
│   ├── plugin.json
│   ├── web/index.tsx（autoBuiltin.ts 迁入，注册 5 个 auto 面板）
│   ├── web/{discuss,pipeline,memory,skills,entities}/
│   │   ├── discuss/{AutoWriteWorkbench,chat/{ChatPanel,AiChatBubbleRail,services/{chatService,skillLibrary,entityRefresh,sseStream}}}
│   │   ├── pipeline/{PipelineGraphPanel,ChapterPlanGraphPanel}
│   │   ├── memory/MemoryGraphPanel
│   │   ├── skills/SkillLibraryPanel
│   │   └── entities/RelationGraph（复用 shared ui-graph）
│   ├── layout/{BubbleRail,TabBar,QuickOpen,workspaceDefs,WorkbenchPlan,AIRedstonePanel,EntityRail,MemoryAuditPanel,PipelinePanel,StatusBar,WorkspacePane,WorldStateBoard}  # D4：layout/ 去掉 kernel 壳、manual UI 与 §3.7 判 shared(ui-kit) 者（BottomDrawer/RightSidebar）后的剩余文件全归 auto
│   └── stores/{aiStore,aiRedstoneStore,workspaceStore,chatHistoryStore}
└── novel.autowrite/     # 现状（独立插件包，server 面 53 文件）
```

> **D4 说明**：`apps/web/src/components/layout/` 在迁移后**不再有 kernel 文件**（kernel 壳已移入 `components/shell/`）。
> 该目录的处置为「**四分**」：kernel 壳 → `components/shell/`；手写台 UI（`LeftSidebar`/`TrashDialog`）→ `manual/workbench/web/editor/`；
> shared(ui-kit)（`BottomDrawer`/`RightSidebar`，§3.7）→ `@novel-plugins/ui-kit`；
> **其余文件全归 auto**（迁入 `auto/workbench/`，即除上述三类之外的剩余文件）。若把 `LeftSidebar` 判给 auto，则 kernel 壳 `ProjectLayout.tsx:529` 会形成 kernel→auto 边，
> 移除 auto 时手写台章节面板即编译失败 —— 故 `LeftSidebar` 必须归 manual（与 §3.8 一致）。
> **D21 补充**：`LeftSidebar`（`chapters`）与 `ChatPanel`（`ai-chat`）是 `ProjectLayout.tsx:529/532` 的**两个对称内核硬编码气泡**；
> 二者均改为经新增扩展点 `registerBuiltinBubble`（按 `def.key` 键控多槽）注入 —— manual 注册 `chapters`、auto 注册 `ai-chat`，
> 缺席时对应气泡不渲染。如此 kernel 对 `LeftSidebar`/`ChatPanel` **均无静态 import**，K2M 与 C1 两条 kernel→模块边一并消解（见 §5.5）。

---

## 4. 耦合消解方案（逐条 + 为何不破坏「另一模块可用」）

**总原则**：manual 与 auto **不得静态互相 import**；共享件只能**下沉 kernel/shared**（或各模块自带）。
所有「模块 ↔ kernel」的方向是 **kernel → 模块入口**（组装），模块只依赖 `@novel/core/web` 与 `shared` 包。

| 编号 | 耦合 | 处理方式 | 为何不破坏另一模块 |
|---|---|---|---|
| **M1** | `QuickPhraseBubble.tsx:17` → `services/ai/quickPhraseService` | **改注册表可选能力**：`quickPhraseService` 迁 auto 侧；`QuickPhraseBubble` 改为消费 kernel 扩展点 `ctx.getCapability('ai.quickPhrases')`（新增契约见 §5.2）。缺失时走**本地启发式**（`quickPhraseService.ts:42-44` 的 `catch` 已调用 `extractHeuristicPhrases`（`:48`）） | auto 未挂载 → 能力为 `null` → 手写台直接用启发式短语，功能不消失、不报错 |
| **M2** | `TimelineView.tsx:8` → `services/ai/scanService` | **改注册表可选能力**：`TimelineView` 的「关键词提取事件」按钮改为 `ctx.getCapability('ai.timelineExtract')`；缺失时该入口**隐藏**（`disabled` + tooltip「需 AI 写作台」），时间线手动增删事件不受影响 | auto 未挂载 → 仅少一个 AI 入口，时间线本体（`:33-` 手写逻辑）完整可用 |
| **M3/M4**（D9 补） | `EditorPage.tsx:21,22` → `hooks/useAutoEntityDetection.ts`、`hooks/useLatestChapterPolling.ts` | **与 C3 同源，合并消解**：这两个 hook 属 manual，但其内部依赖 auto 的 `services/ai/*`；按 `ai.scan` 能力契约（§5.2/§5.3）把 hook 内的 AI 调用改为 `ctx.getCapability('ai.scan')`，能力缺失即静默 `return`（`useAutoEntityDetection.ts:5-7` 注释已声明「后端不可用时静默返回」） | auto 未挂载 → 扫描/轮询静默跳过；手写台编辑、保存、实体手动维护全部照常 |
| **A1-A8** | 三个 auto 图谱面板 → `knowledge/graph/*`（7 条）+ `autoBuiltin.ts:31-32` → `RelationGraph` | **下沉 shared**：`components/knowledge/graph/*` 整体迁 `apps/plugins/shared/ui-graph/`；`RelationGraph` 的**图元部分**同样下沉，`entities` 面板改为 `auto/workbench/web/entities/` 自带薄封装（复用 `ui-graph` + `data-core` 的实体 store） | graph 图元无业务状态（`GraphShell.tsx:1-30` 仅依赖 `@xyflow/react`/`lucide-react`/同目录），manual 与 auto 各自 import 同一 shared 包，**不产生模块间边** |
| **K1** | `plugin/builtin.ts:18-29` → 12 个 manual 组件 | **随 manual 迁走**：文件移到 `apps/plugins/manual/workbench/web/index.tsx`，`main.tsx` 只 import 模块入口 | kernel 不再依赖 manual 内部；移除 manual 模块 = 该面板清单整体消失 |
| **K2** | `plugin/autoBuiltin.ts:21-37` → 5 个 AI 面板 | **随 auto 迁走**：文件移到 `apps/plugins/auto/workbench/web/index.tsx` | 同上，kernel 零依赖 auto 内部 |
| **K3** | `App.tsx:22-30` → 页面/壳 | **保留 kernel，但不再硬编码模块入口说明符（已实现，t29 补记）**：页面（bookshelf/settings/admin/…）留 kernel；模块入口改由 `apps/web/src/plugin/moduleEntries.ts` 经**构建期 `import.meta.glob`**（精确两条：`../../../apps/plugins/{manual,auto}/workbench/web/index.tsx`）收集，`getModuleEntryLoader(dir)` 用 `k.endsWith('/plugins/'+dir+'/workbench/web/index.tsx')` 精确匹配，`loadModuleComponent(dir, exportName)` 取公开导出。**关键收益**：模块目录缺席 ⇒ 该入口文件不存在 ⇒ glob 不收集 ⇒ 无悬空 import ⇒ 天然优雅降级（无需 `?? 空实现` 兜底，符合 D32-Q3）。`ProjectLayout` 的 auto 分支经注册表能力 `workbench.auto` 决定是否渲染（`WorkbenchMissing` 占位）。 | 移除 auto 模块 → glob 收集不到其入口 → 不产生任何悬空 import；type-check + build 均 exit 0；manual 分支照常 |
| **C1** | `ProjectLayout.tsx:23-24,29` → `components/ai/*` | **改注册表可选能力**：`ChatPanelControlProps` 类型与 `AiChatBubbleRail` 兜底改由 kernel 定义；`ChatPanel`（auto）与 `LeftSidebar`（manual）两个内核硬编码气泡均经**新增的 `registerBuiltinBubble`**（D21，按 `def.key`：`ai-chat` / `chapters`）注入（§5.5；**不并入** `registerChatRail`，D5 回改） | auto 缺失 → `ai-chat` 槽为空 → 手写台不渲染「AI 对话」气泡，其余 12 面板与编辑器不受影响；manual 缺失对称（`chapters` 气泡消失） |
| **C2** | `localUserData.ts:10` → `stores/chatHistoryStore` | **下沉 shared + 反转依赖（已实现，t29 补记）**：`localUserData` 与 `chatHistoryStore` 双双下沉 `apps/plugins/shared/data-core`（`src/data/localUserData.ts`、`src/stores/chatHistoryStore.ts`）——`localUserData` 侧改为**注册表式回调**而非静态 import：`data-core` 导出 `registerLocalDataCleaner(cleaner): () => void`（`localUserData.ts:38-46` 维护 `Set<LocalDataCleaner>`），`clearAllLocalUserData()` / `clearProjectLocalData()` 在清掉 kernel 自有 key 后**遍历调用已注册的 cleaner**（`localUserData.ts:126`）。auto 侧在模块入口注册（`auto/workbench/web/index.tsx:28,70`，经 `ctx.effect` 绑定生命周期 ⇒ 卸载自动反注册）：`ctx.effect(() => registerLocalDataCleaner((projectId) => {…}))`。**语义比原「kernel 事件」更强**：不但「无订阅者不报错」，且 **auto 缺席时 cleaner 集合为空、kernel 清理照常**；auto 在场时**内存态与 localStorage 一并清空**（D44-C2 硬要求）。反向边（shared→auto）**已消除**：`data-core` 不再引用 auto 任何文件。 | auto 缺失 → cleaner 集合为空，kernel 清理照常、无报错；auto 在场 → 内存态 + localStorage 均被清 |
| **C3** | `useAutoEntityDetection.ts:12,16` / `useLatestChapterPolling.ts:22,25` / `useScanProcessors.ts:15` → `services/ai/*` | **各模块自带实现**：这三个 hook 仅被 `EditorPage.tsx:21-22` 使用，属**手写台**能力 → 整体迁 manual；其依赖的 `services/ai/scanService` 改为经 **auto 可选能力** `ai.scan` 调用，缺失时 hook 直接 `return`（`useAutoEntityDetection.ts:5-7` 注释已声明「后端不可用时静默返回」） | auto 缺失 → 扫描静默跳过，手写台编辑/保存/实体手动管理全部可用 |
| **C4** | `stores/index.ts`（入边 61） | **切分 + 兼容壳**（§3.4.1）：实体 store → shared，手写台 store → manual，auto store → auto；kernel 留 `panelOpenStore` | 两模块只依赖 shared 的实体 store 与各自私有 store；移除任一模块不影响另一模块的 store 解析 |

---

## 5. kernel 扩展点与「可选依赖降级契约」

### 5.1 既有扩展点（复用，不新增）

`apps/web/src/plugin/types.ts:29-50`（`FloatingPanelDef`）、`:116-136`（`ChatRailDef`）；
`apps/web/src/plugin/registry.ts:254-265`（`pluginRegistryApi` 的 9 个注册入口）；
`apps/web/src/plugin/host.ts:30-32`（`withModes`）、`:125-144`（`mountWebPlugin` 失败隔离）。
对应 `packages/core/src/manifest.ts:61-72` 的 `WEB_SERVICES` 白名单。

### 5.2 需新增的 kernel 扩展点（**契约名与降级行为先在此定义，实现者不得自行发明**）

> **F3（必做前置）· 同步扩展 `packages/core` 契约**：`packages/core/src/plugin-context.ts` 的 `WebPluginContext`
> （现 `:390-419`）**不含**下列方法；`packages/core/src/manifest.ts` 的 `WEB_SERVICES`（`:61-72`，10 项）**不含**新名。
> `manifest.ts:57-59` 注释明确「**先加 ctx 方法，再加这里**」。因此新增扩展点必须**同一步**改三处：
> (a) `packages/core/src/plugin-context.ts` 声明新方法；(b) `apps/web/src/plugin/host.ts:59-109` 的 `ctx` 对象字面量实现；
> (c) `apps/web/src/plugin/registry.ts` 增补对应状态与注册函数（`registerWorkbench` 一单槽、`registerBuiltinBubble` 按 `def.key` 键控多槽；
> `registerCapability`/`getCapability` 各一个 `Map`）。
> 否则 `plugin.json` 的 `web.inject` 会被 `z.enum(WEB_SERVICES)` 拒绝，且 `ctx.registerWorkbench` 在类型上不存在。
> **该步归 t3（队长裁决 D2）**，见 §7。

| 契约名 | 形式 | 签名 | 降级行为（能力缺失时） |
|---|---|---|---|
| `ctx.registerWorkbench` | 注册器（单槽，kernel 内部） | `registerWorkbench({ modes: ['manual'\|'auto'], Component, key })` | 未注册 → 该模式**不渲染专属工作台**，回退到通用空态页；另一模式不受影响 |
| `ctx.registerBuiltinBubble`（D21 新增，泛化自 D5 阶段的单槽方案） | 注册器（按 `def.key` 键控多槽，kernel 内部） | `registerBuiltinBubble(def: FloatingPanelDef)` | 该 `key` 未注册 → 对应内置气泡**不渲染**（`chapters`/`ai-chat` 各自独立，优雅降级） |
| `ctx.registerCapability` | 注册器（具名能力） | `registerCapability(name: WebCapabilityName, impl)` | `ctx.getCapability(name)` 返回 `null`；消费点必须**隐藏入口或走本地兜底**，禁止 throw |
| `ctx.getCapability` | 查询 | `getCapability<T>(name: WebCapabilityName): T \| null` | 返回 `null` |

> **F11 · 能力名单一事实源**：能力名**不硬编码**在签名里，改为引用 core 常量 `WEB_CAPABILITIES`
> （建议置于 `packages/core/src/manifest.ts`，与 `WEB_SERVICES` 并列，`WebCapabilityName = typeof WEB_CAPABILITIES[number]`）：

| 能力名 | 降级行为 | 消费点（证据） |
|---|---|---|
| `ai.quickPhrases` | 走本地启发式 `extractHeuristicPhrases` | `QuickPhraseBubble.tsx:17`（§4 M1） |
| `ai.timelineExtract` | 入口隐藏，时间线手动增删照常 | `TimelineView.tsx:8`（§4 M2） |
| `ai.scan` | hook 静默 `return` | `useAutoEntityDetection.ts:16`、`useLatestChapterPolling.ts:25`（§4 M3/M4/C3） |
| `ai.outlineFill` | 入口隐藏，大纲纯文本编辑完整 | `OutlineFillDialog.tsx`（§5.3） |
| `ai.entityRefresh` | 静默跳过刷新 | `useAutoEntityDetection.ts`（§5.3） |

> **D43 增补 · `ai.scan` 的形状（红石开关面并入，不单列契约名）**：`ai.redstone` 这个**额外**能力名已撤销 ——
> 本节规定「契约名与降级行为先在此定义，**实现者不得自行发明**」，能力名总数恒为上述 5 个。
> 红石开关面（scanner/extract 启停 + abort 注册）作为 **`ai.scan` 的组成部分**下发：
>
> ```ts
> interface AIScanCapability {
>   scanTimelineStream(chapterContent, chapterOrder, existingEntities,
>     onEvent, onEntity?, onItemTransfer?, onAliasMatch?, signal?, projectId?): Promise<StreamTimelineEvent[]>;
>   extractEventsByKeyword(content, title, order, keyword, onEvent): Promise<void>;
>   // ---- 红石开关面（同属 ai.scan）----
>   isScannerEnabled: () => boolean;
>   isExtractEnabled: () => boolean;
>   registerAbort: (feature: string, controller: AbortController) => () => void;
>   subscribeRedstone: (cb: () => void) => () => void;   // 供 useSyncExternalStore 保持响应性
> }
> ```
>
> **降级**：能力缺失 ⇒ `isScannerEnabled`/`isExtractEnabled` 取 **`true`**（视为启用，与原 `features.scanner` 默认值一致，**保持原行为**），
> `registerAbort` 取 no-op。**不改变上表各行的既有降级语义**。manual 侧的契约形状定义在
> `apps/plugins/manual/workbench/web/hooks/aiScanCapability.ts`（纯类型，零 auto 运行时依赖）。
>
> **D42 增补 · `K2M` 的归属**：`apps/web/src/plugin/autoBuiltin.ts:32`（`@/components/knowledge/RelationGraph`）
> 是 kernel 装配文件中的 K2M 边，**归 t5**（D40 已把该文件划给 t5）；t4 的验收只要求 manual 侧
> `M2A=0`、`缺失=0`。**全量门禁（t6/t7）必须 `K2M=0`**，此点不变。

> **chatRail 不新增契约**：`chatRail`（`types.ts:131-136`、`registry.ts:218-227`）**已存在且已实现降级**：
> 未注册时 `ProjectLayout.tsx:391` 回退 `AiChatBubbleRail`。**本次不新增 chatRail 契约**，只把它从 kernel 的静态 import 改为「auto 注册 / kernel 兜底」。
> （F5 原建议「`ChatPanel` 本体经既有 `registerChatRail` 承载」**已被队长 D5 更正**：`chatRail` 只管编辑器内气泡栏；`ChatPanel` 是「AI 对话」浮窗、`LeftSidebar` 是「章节」浮窗，二者均为 kernel 硬编码内置气泡，**必须**经**独立新增**的 `registerBuiltinBubble`（D21 由 D5 阶段的单槽方案泛化）按 `def.key` 注入 —— 见 §5.5。）

### 5.5 `registerBuiltinBubble` 为**独立新增扩展点**（D21：泛化自 D5 阶段的单槽方案，**不可**并入 `chatRail`）

**结论（队长 D5 更正 + D21 泛化，代码复核后）**：`ProjectLayout.tsx` 有**两个对称的内核硬编码气泡**，都必须经扩展点注入，否则 kernel 保留对模块的静态 import：

| 集成点 | 代码证据 | 语义 |
|---|---|---|
| `chatRail`（既有，**保持原样**） | `registry.ts:41-42,218-227`；`ProjectLayout.tsx:391` `RailComponent = pluginChatRail?.Component ?? AiChatBubbleRail` | **编辑器内的 AI 气泡栏**（有 `syncInsert/enableTools/enableAgent` props），kernel 有内置兜底 `AiChatBubbleRail` |
| `registerBuiltinBubble`（**新增，必要**；D21 由 D5 阶段的单槽方案泛化而来） | `ProjectLayout.tsx:529` `chapterBubbleDef={key:'chapters',Component:LeftSidebar}`（manual）；`:532` `chatBubbleDef={key:'ai-chat',Component:ChatPanel}`（auto） | **两个内核硬编码气泡浮窗**：`chapters`（manual 的 `LeftSidebar`）与 `ai-chat`（auto 的 `ChatPanel`）。二者现均由 kernel **静态 import**（`:15`、`:23-24,29`，即 K2M 与 C1 边）→ **必须**经此扩展点注入 |

**故**：`registerBuiltinBubble(def: FloatingPanelDef)` 按 `def.key` **键控多槽**——manual 注册 `chapters`→`LeftSidebar`、auto 注册 `ai-chat`→`ChatPanel`；**缺席时对应气泡不渲染**（优雅降级）。kernel 壳 `ProjectLayout.tsx:529/532` 的两个 def 改为「有对应 `key` 注册才渲染」。**真正新增的契约是 3 个**：`registerWorkbench`、`registerBuiltinBubble`、`registerCapability`/`getCapability`（后者算一对）。此结论**不改变降级行为**（§5.3 各行不变）。

### 5.3 AI 能力缺失时手写台的**确切行为**

| 场景 | 行为 | 证据 |
|---|---|---|
| **auto 模块未挂载**（`chatRail` 与 `registerBuiltinBubble` 的 `ai-chat` 槽均为空） | 不渲染「AI 对话」浮窗；`ProjectLayout.tsx:531-533` 的 `chatBubbleDef` 从 `bubblePanels` 移除；**12 个手写台面板、编辑器、章节/大纲/伏笔/统计/时间线全部照常** | `ProjectLayout.tsx:519-538`、`:695-706` |
| **`chatRail` 无插件接管** | 回退内置 `AiChatBubbleRail`（`ProjectLayout.tsx:391`、`registry.ts:41-42,218-227`）；若连 ChatPanel 也缺失，则 `isAiChat` 分支（`:363,372-405`）整体不成立，气泡栏不渲染 | 同上 |
| **ai.quickPhrases** 缺失 | `QuickPhraseBubble` 走本地启发式 `extractHeuristicPhrases`，短语气泡仍有内容 | `services/ai/quickPhraseService.ts:42-44`（`catch` 兜底）、`:48`（启发式实现） |
| **ai.timelineExtract** 缺失 | 「从正文提取事件」入口隐藏；时间线手动增删改查完整 | `TimelineView.tsx:33-`（本体逻辑不依赖 AI） |
| **ai.scan** 缺失 | `useAutoEntityDetection` / `useLatestChapterPolling` 静默 `return`；实体仍可手工维护 | `hooks/useAutoEntityDetection.ts:5-7`（注释：「后端不可用时静默返回」） |
| **ai.outlineFill** 缺失 | `OutlineFillDialog`（AI 填大纲）入口隐藏；大纲纯文本编辑完整 | `stores/outlineNotepadStore.ts` 由 `OutlineManager.tsx:31` 使用 |
| **auto 工作台（`AutoWriteWorkbench`）未注册** | `project.mode === 'auto'` 的项目回退通用空态；**manual 项目完全不受影响** | `ProjectLayout.tsx:592-600` |

> **「未核实」标注**：`§6.3` 断言 D 中「`staticEntries` 在 `--without auto` 时不含 auto 条目」的具体实现形态
> **未核实** —— `main.tsx:58-64` 是硬编码数组，尚无环境变量开关机制；该断言的确切开关方式待 M1 定稿时确定，
> 在此之前不得声称该断言已可执行。

### 5.4 八处硬编码相对 `/api` 的处理（**全部必须收口到 kernel**）

实测 `fetch('/api...')` 共 **8 处**（含经 `baseUrl` 拼接的 1 处；D25 补 `pipelineSession.ts:170`）：

| # | 位置 | 现状 | 处理 |
|---|---|---|---|
| 1 | `apps/web/src/components/ai/ChatPanel.tsx:1571` | `fetch('/api/ai/chat-stream')` | 改 `kernelApi.url('/ai/chat-stream')`（auto 模块内改为经 `ctx.api`） |
| 2 | `apps/web/src/services/ai/chatService.ts:170` | 同上 | 同上 |
| 3 | `apps/web/src/services/ai/scanService.ts:169` | `fetch('/api/ai/scan-timeline-stream')` | 同上 |
| 4 | `apps/web/src/services/ai/scanService.ts:336` | `fetch('/api/ai/extract-events-stream')` | 同上 |
| 5 | `apps/web/src/services/ai/autowriteSession.ts:84` | `fetch('/api/plugins/autowrite/session')` | 同上（SSE 裸 fetch，须保留手动 `X-Project-Id`，见 `:81-83`） |
| 6 | `apps/web/src/services/ai/pipelineSession.ts:170` | `const RAW_BASE = '/api/plugins/autowrite/pipeline'`（裸 fetch 用） | 改 kernel 的 `resolveApiUrl('/plugins/autowrite/pipeline')`（auto 模块内经 `ctx.api`）；**注意与 `:169` 的 `API_BASE='/plugins/autowrite/pipeline'`（给 `apiClient`，会自补 `/api`）成对**，`:166` 注释已说明「两个 base 不能混用」 |
| 7 | `apps/web/src/components/editor/hooks/useEditorInstance.ts:448`（用法 `:474`） | `import.meta.env.VITE_API_BASE_URL \|\| '/api'` | 改 kernel 导出的 `resolveApiUrl()` |
| 8 | `apps/web/src/main.tsx:33` | `fetch('/api/health')` | 改 kernel 的 `resolveApiUrl('/health')` |

**契约**：kernel 在 `apps/plugins/shared/data-core/src/api/apiClient.ts` 导出
`resolveApiUrl(path: string): string`，实现口径与 `apiClient.ts:423`（`baseUrl: import.meta.env.VITE_API_BASE_URL || '/api'`）一致。
**降级行为**：`VITE_API_BASE_URL` 未设置时返回同源 `/api`（与现状一致，零回归）；
`vite.config.ts` 已有的「缺 `/api` 后缀自动规范化」逻辑（`vite.config.ts` 的 `define['import.meta.env.VITE_API_BASE_URL']`）继续生效。
**禁止**：任何模块再出现字面量 `'/api'` 或 `import.meta.env.VITE_API_BASE_URL`（由 §6.3 门禁断言 C 拦截）。

---

## 6. 独立可用性验收标准

> 判定原则：**关闭 / 移除任一模块后，另一模块必须通过 type-check / 单测 / 构建 / 运行四项**（L1 为额外静态门禁）。

### 6.1 判定方法（五层）

| 层 | 命令 | 通过判据 |
|---|---|---|
| L1 静态 | `node scripts/verify/verify-workbench-isolation.mjs --without auto` | exit 0（断言见 §6.3） |
| L2 类型 | `pnpm --filter @novel/web type-check` | exit 0 |
| L3 单测 | `pnpm --filter @novel/web test` | **14 文件 / 182 用例全绿**（不得少于基线） |
| L4 构建 | `pnpm --filter @novel/web build` | exit 0；且产物**不含**被移除模块的 chunk（如 `--without auto` 后无 `AutoWriteWorkbench-*.js`、`ChatPanel-*.js`） |
| L5 运行 | 起 dev（`pnpm dev`）→ 打开 manual 项目 → 断言手写台标记齐全、无 AI UI | 复用 `scripts/e2e/e2e-mode-separation.mjs` 的标记口径（`MANUAL_MARKERS` 全中、`AUTO_MARKERS` 全不中） |

**L3 的 14 个基线测试文件**（`apps/web/src` 下实测枚举，搬迁后路径可变但文件与用例数不得减少）：
`components/ai/__tests__/{AgentSkillsPanel,SkillSwitch}.test.tsx`、
`components/editor/__tests__/ChapterEditor.test.tsx`、
`components/layout/__tests__/PipelinePanel.test.tsx`、
`components/ui/__tests__/{AddBookModal,ToastProvider}.test.tsx`、
`plugin/__tests__/registry.test.ts`、
`services/api/__tests__/apiClient.test.ts`、
`services/editor/__tests__/entityDetector.test.ts`、
`stores/__tests__/{authStore,projectStore,workspaceStore}.test.ts`、
`utils/__tests__/{chapter,errors}.test.ts`。

### 6.2 两个方向的判定矩阵

| 移除模块 | L1 断言方向 | L4 产物断言 | L5 运行断言 |
|---|---|---|---|
| `--without auto` | 禁 `manual/**` 与 `kernel` 出现 auto 前缀 import | 无 auto chunk | manual 项目出现「功能转轮」+「角色气泡」（`e2e-mode-separation.mjs:37`），无「状态栏/智能体对话/编辑器标签」（`:43`） |
| `--without manual` | 禁 `auto/**` 与 `kernel` 出现 manual 前缀 import | 无 manual chunk | auto 项目出现「状态栏/智能体对话/编辑器标签」，无「功能转轮/角色气泡」 |

### 6.3 门禁脚本断言规则（`scripts/verify/verify-workbench-isolation.mjs`，t3 据此实现）

**输入**：`--without auto|manual`（缺省 = 全量，只做「两侧都可用」检查）。

**扫描根（精确、唯一确定，见 D1）**：
`apps/web/src/**`、`apps/plugins/manual/workbench/web/**`、`apps/plugins/auto/workbench/web/**`
（按 D1，两大模块各只对应一个插件包，故扫描根为上述三条精确路径，不用通配 `apps/plugins/{manual,auto}/**`）。

> **t29 补记：shared 三包亦纳入扫描根（纯增量）**。D1 的三条根原样保留，另加
> `apps/plugins/shared/{ui-kit,ui-graph,data-core}/src`（域 = `shared`）。
> 理由：验收第 7 条要求「shared→module 域对」受门禁约束（消解 §4-C2 的
> `localUserData.ts → chatHistoryStore` 反向边）——**门禁必须能看见被修复的那条边**，
> 否则该边一旦回归无任何文件会报错（t6 的教训：看不见的边 = 假通过）。
> **不含 `typography`**：它是拆分前既有的第三方示例插件，不属 §2.3 的 shared 三包；
> 实测对模块 import 数 = 0（仅 react / lucide-react / `@novel/core/web`），纳入对检测力
> 零增益，却带 7 处遗留 `/api/` 字面量（`web/index.tsx:99,114,134,304,318,355,398`），
> 会新增 7 条**范围外**的断言 C 失败。该文件的 `/api/` 收口是独立事项。

**断言 A（跨域 import 前缀禁令，核心）**：在上述扫描根内解析 `*.{ts,tsx}`，
用与 `.workbuddy/split-workbenches/tools/import-graph.mjs` 相同的解析口径（静态 `import ... from` + 动态 `import(...)`），
对每条**解析后路径**匹配下述前缀；命中即失败并打印 `file:line`。
**扫描时须排除 `node_modules/`、`dist/`**（F5：`apps/plugins/*/node_modules` 实测存在，否则假阳性）。

- `--without auto` 时，**manual 域（`apps/plugins/manual/workbench/web/**`）+ kernel 域（`apps/web/src/**`）**禁止出现以下前缀：
  `@/components/ai/`、`@/services/ai/`、`@/components/layout/`（**整目录**，D19-③：D4 后 `layout/` 整体归 auto）、
  `@/plugin/autoBuiltin`、`@novel-plugins/auto-`、`apps/plugins/auto/`。
- `--without manual` 时，**auto 域（`apps/plugins/auto/workbench/web/**`）+ kernel 域（`apps/web/src/**`）**禁止出现以下前缀：
  `@/components/{editor,knowledge,timeline,foreshadow,outline,notes,stats,export,snapshot,series,consistency}/`、
  `@/plugin/builtin`、`@/components/layout/{LeftSidebar,TrashDialog}`、`@novel-plugins/manual-`、`apps/plugins/manual/`。
  （D4 后 kernel 壳位于 `components/shell/`，**不在**上述禁止前缀内；`@/components/layout/` 在**本方向（`--without manual`）**无需列入 kernel 禁令 —— 因 `layout/` 整体归 auto，kernel 引它属 kernel→auto 边，由上方 `--without auto` 的 kernel 禁令覆盖。）
- **例外白名单**（必须显式列出，且逐条带理由注释；D19-④：原白名单误写为**不存在的** `@novel-plugins/shared` 包，已更正为下列真实共享包）：
  `@novel-plugins/{ui-graph,ui-kit,data-core}`（**包名前缀匹配即可，含子路径**，如 `@novel-plugins/data-core/stores`）、
  `@novel/core`、`@novel/core/web`、`@novel/shared`。

**断言 A'（兼容壳禁令，F8 新增）**：`--without manual` 时，**auto 域**禁止出现
`@/stores`（`apps/web/src/stores/index.ts` 兼容壳）或 `apps/web/src/stores/` 的 import；
auto 只允许 `@novel-plugins/data-core/stores`。否则「移除 manual 后 auto 仍可用」不成立（§3.4.1、§7.5）。

**断言 B（模块入口纪律）**：kernel 引用模块**只能**走入口：
`apps/web/src/**` 中出现的 `@novel-plugins/manual-workbench` 必须命中 `.../web` 或 `.../stores` 导出，
**禁止** `@novel-plugins/manual-workbench/web/discuss/...` 之类的模块内部深层路径（用 `exports` 字段 + 正则双重校验；公开入口仅 `.../web`（模块根）与 `.../stores`）。
（注：现有三种包声明约定并存——`worldbuilding` 用 `novelMuse` 字段、`bookscan`/`typography` 用 `plugin.json`——断言 B 须覆盖三者。）

> **t29 补记（实测加固，三处口径修正）**：
> 1. **公开入口改为精确匹配**。原实现按「子路径首段 ∈ {`web`,`stores`}」豁免，于是
>    `@novel-plugins/auto-workbench/web/discuss/ChatPanel` 这类**深层内部路径**也被放过；
>    但契约 §1 允许 kernel 的只有 `exports["./web"]` **这个入口本身**。现精确匹配
>    `web` / `web/index[.ts(x)]` / `stores` / `stores/index[.ts(x)]`。
> 2. **覆盖 `@/` 别名与相对路径两种写法**。原实现只匹配包名说明符，于是
>    `@/components/ai/ChatPanel`（解析进 auto 域）与
>    `../../plugins/auto/workbench/web/discuss/ChatPanel`（相对路径）**双双漏过** —— 而它们正是
>    「kernel 深层引用模块内部文件」的真实写法。现改为判定**解析后的落点**是否落在
>    `apps/plugins/<mod>/workbench/**` 且非公开入口。
> 3. **解析口径补 `export … from`**。原 `IMPORT_RE` 只认 `import … from` / `import()` / `require()`，
>    `export * from` / `export { a } from` / `export type { T } from`（含跨行）**完全隐形**
>    （t6-F2 实测双重假阴性）。现增 `EXPORT_RE` 并纳入同一扫描循环。
>
> **非空自证（必须）**：`node .workbuddy/split-workbenches/tools/_t29_selfproof.mjs`
> 逐条注入 4 种边（相对 `export *`、包名深层 `export {}`、跨行 `export type {}`、相对 `import`），
> 要求门禁**全部 exit 1 且命中 A/B**，随后 `finally` 撤销并复验门禁回到 exit 0。
> 该自证在 t29 首次运行时**抓到 2 个真实漏洞**（见上 1、3），证明其有效。

**断言 C（字面量 `/api` 禁令）**：`apps/web/src/**` 与 `apps/plugins/{manual,auto,shared}/**` 内不得出现
**字面量** `'/api/`、`"/api/`、`\`/api/` 或 `import.meta.env.VITE_API_BASE_URL`。
**允许** `resolveApiUrl('/...')` 形态（§5.4）；`autowriteSession.ts:84` 的 SSE 裸 `fetch` 属**显式例外**（须保留手动 `X-Project-Id`），
断言 C 只拦字面量 base，不拦裸 `fetch`（F16 边界澄清）。

**断言 D（构建期清单一致性）—— 已可判定（t29 补记）**：
原文（F6）判「无法判定」，因 `main.tsx:58-64` 的 `staticEntries` 当时是硬编码数组、无开关载体。
**该前提已随 t3/t4 落地消失**：`staticEntries` 中的模块静态条目已删除（`main.tsx:52-62` 注释显式说明），
模块入口改由 `import.meta.glob`（`main.tsx:73-78`，按 `mode 目录/*/web/index.tsx` 自动收集）承接。
故断言 D 现按**可判定**实现，三条同时成立才算过：
1. `main.tsx` 存在 `import.meta.glob` 收集 `plugins/(manual|auto)/*/web/index.tsx` 的载体；
2. `staticEntries` 段内模块入口说明符数 = 0；
3. `apps/web/src/**` 内模块入口静态 import 数 = 0（缺席即解析失败）。
现状实测：三条全过（载体 ✓ / 0 个 / 0 个）。

**断言 E（基线不退化）—— 已按「真实移除树」实现（t29 补记）**：
原文「L3 用例数 ≥ 182」有两处失真：① 未防 vitest 对不存在目录**静默匹配 0 文件仍 exit 0** 的空转；
② 固定阈值 182 在 `--without` 场景下**数学上不可达**（移走模块必然少其自身用例，实测 auto=58 / manual=12）。
现口径：
- `--without <mod>`：**委托 `scripts/verify/verify-module-removal.mjs --module <mod>`**，
  在其**真实 `renameSync` 移走目录**的树上跑 L2/L3（该脚本持有 `finally` 还原 + 文件数/字节数指纹校验），
  要求「收集文件数 == 现存数 **且非 0**」+「通过数 == 182 − 该模块自身用例数」+「还原指纹一致」；
- 全量：本地跑 L2/L3，要求「收集文件数 == 磁盘实测数 且非 0」+「用例数 ≥ 182」。
**并发的坑（D47 补充事实）**：移除预言机会移走模块目录，**禁止并发运行**；
其已加跨进程互斥锁（`.workbuddy/split-workbenches/.vmr.lock`，`fs.openSync(..., 'wx')` 独占创建，
已存在即 exit 2）。实测假象：并发时曾读到「基线 12 文件 / 170 通过」并被误判为「测试被删」——
真值 14 文件 / 182 通过（12 = 14 − manual 的 2 个测试文件，170 = 182 − 12）。

**断言 (a1)/(a2)：type-check 的覆盖范围（t29 新增，补一处结构性盲区）**：
`pnpm --filter @novel/web type-check` = `tsc --noEmit` + `apps/web/tsconfig.json` 的
`include: ["src"]`，实测 `--listFiles` 中 `plugins/{auto,manual}/workbench` 命中 **0** 个文件
（shared 命中 44 个）⇒ 该步**只覆盖 kernel + shared，模块内部的死导入/悬空引用它完全看不见**。
该盲区**实际掩盖过一个真缺陷**：`auto/workbench/web/discuss/ChatPanel.tsx` 的 lucide 导入含 `X`
而全文再无 `X` 引用（模块内专用 tsconfig 一探即报 `TS6133`）。
故拆分：
- **(a1)** kernel+shared type-check exit 0，**输出须显式标注覆盖范围**，不得过度解读为「模块也类型正确」；
  脚本会打印实测覆盖数（模块内 N 个 / shared M 个）。
- **(a2)** 为 auto/manual 各建模块内专用 tsconfig
  （`apps/plugins/<mod>/workbench/tsconfig.typecheck.json`，include 模块 `web/**`+`stores/**`，
  **exclude 测试文件**），在**移除态**下运行 `tsc -p <cfg> --noEmit`，exit 0。
  ⚠ **必须 exclude 测试文件**：`apps/web/tsconfig.json` 的 `types` 未含
  `@testing-library/jest-dom`，纳入会冒出约 50 条
  `TS2339: Property 'toBeInTheDocument' does not exist` 噪声 —— 既有配置缺口、非真缺陷。
  实测该图覆盖 auto 模块内 50 个文件（kernel 业务源码 0 个，仅纳入
  `apps/web/src/types/d3-force-3d.d.ts` 这个第三方库环境声明，与
  `novel.autowrite/tsconfig.json` 的既有做法一致），故**可独立于 kernel 存在**，
  移走另一模块后仍可跑。

**断言 F（core 契约一致性，F12 新增）**：`packages/core` 须增补一个单测/门禁，断言
`WEB_SERVICES`（`manifest.ts:61-72`）与 `WebPluginContext`（`plugin-context.ts:390-419`）的扩展点集合**一一对应**，
且 `WEB_CAPABILITIES` 与 §5.2 能力表一致（新增扩展点必须同时改两处）。

---

## 7. 实施顺序与里程碑（含写范围与回滚点）

> 每个里程碑结束都必须跑 `pnpm --filter @novel/web type-check` + `pnpm --filter @novel/web test`，
> 并把原始输出摘要贴进任务输出；未运行的项一律写「无法判定」。

### M0 · 冻结基线与门禁骨架（无产品代码改动）
- **写范围**：`scripts/verify/verify-workbench-isolation.mjs`（新增）、文档。
- **门禁扫描根（精确，见 D1）**：`apps/web/src/**`、`apps/plugins/manual/workbench/web/**`、`apps/plugins/auto/workbench/web/**`。
- **验收**：门禁脚本在**当前未拆分**状态下以 `--without` 运行应**失败**（证明确实在拦），全量运行通过。
- **回滚点**：删脚本即可。

### M1 · kernel 先行（纯搬迁 + core 契约扩展）
- **写范围**：`apps/web/src/plugin/{registry,host,types}.ts`（**单写者 = t3**，D3）、新增 `apps/plugins/shared/{ui-graph,ui-kit,data-core}/`；
  `components/knowledge/graph/*` 迁 `ui-graph`；`utils/{errors,gsap,safeConfirm}`、`components/ui/{ErrorBoundary,ToastProvider,InkBackButton}` 迁 `ui-kit`；
  `services/api/*`、`services/security/encryptionService.ts`、`stores/{authStore,themeStore,editorStore,referenceStore,cascadeCleanFlag}` 迁 `data-core`。
  （`apps/web/package.json` 的 workspace 依赖由 **t3** 统一注册，见 D3；`pnpm-workspace.yaml` 亦 t3。）
- **F3 子步骤（必做，同一步完成）**：`packages/core/src/{plugin-context.ts,manifest.ts}` 的最小扩展（**归 t3**，D2）——
  在 `WebPluginContext`（`:390-419`）声明 §5.2 的新方法、在 `manifest.ts` 增补 `WEB_SERVICES` 条目与 `WEB_CAPABILITIES` 常量，
  并同步 `apps/web/src/plugin/host.ts:59-109`（`ctx` 实现）与 `registry.ts`（单槽/`Map` 状态）。三者漏一即编译失败。
- **F6 子步骤**：定义 `main.tsx` `staticEntries`（`:58-64`）的**构建期开关载体**（如 `VITE_WORKBENCH_WITHOUT`），
  使 §6.3 断言 D 从「无法判定」转为可编码。
- **F7 子步骤（单写者，避免双写）**：实体 store 从 `stores/index.ts`（864 行）抽取到 `data-core` 的**唯一写者 = t3**
  （一次完成「移除 + 新增」），`apps/web/src/stores/index.ts` 兼容壳则归 **t4**（D3）；二者**不得重叠写同一文件**。
- **判据**：type-check exit 0 + 182 用例全绿；**此时两模块仍混在 `apps/web/src`，功能零变化**。
- **回滚点**：解压快照覆盖（§8.2）。

### M2 · manual 模块抽离
- **写范围**：新增**单包** `apps/plugins/manual/workbench/`（`plugin.json` 含 `modes:["manual"]` + `web/index.tsx`），
  迁 `plugin/builtin.ts` → `apps/plugins/manual/workbench/web/index.tsx`（12 个 manual 面板注册）；
  组件按大类落 `web/{editor,knowledge,timeline,foreshadow,outline-notes,stats,export,reference}/`；
  `components/layout/{LeftSidebar,TrashDialog}` 一并迁入 `web/editor/`；`apps/web/src/main.tsx:58-64` 改为 import 模块入口。
- **D4 子步骤**：kernel 壳 `ProjectLayout.tsx`/`PanelSection.tsx`/`FloatingBubbles.tsx` 迁入 `apps/web/src/components/shell/`
  （`App.tsx:22` 的 `import('./components/layout/ProjectLayout')` 同步改为 `'./components/shell/ProjectLayout'`）。
- **判据**：门禁 `--without auto` 通过（manual 不再 import auto 前缀）；type-check + 182 用例全绿。
- **回滚点**：快照覆盖 + 门禁复跑。

### M3 · auto 模块抽离
- **写范围**：新增**单包** `apps/plugins/auto/workbench/`（`plugin.json` 含 `modes:["auto"]` + `web/index.tsx`），
  迁 `plugin/autoBuiltin.ts` → `apps/plugins/auto/workbench/web/index.tsx`（5 个 auto 面板注册）；
  组件按大类落 `web/{discuss,pipeline,memory,skills,entities}/`（`discuss/` 含 `AutoWriteWorkbench` + `chat/`（ChatPanel/AiChatBubbleRail + services/ai））；
  `components/layout/` **其余文件全归 auto**（D4；**除 §3.7 判 shared(ui-kit) 者**——`BottomDrawer`/`RightSidebar` 不在此列：`BubbleRail`/`TabBar`/`QuickOpen`/`workspaceDefs`/`WorkbenchPlan`/`*GraphPanel`/`AIRedstonePanel`/`EntityRail`/`MemoryAuditPanel`/`PipelinePanel`/`StatusBar`/`WorkspacePane`/`WorldStateBoard`）、
  `components/ai/**`、`services/ai/**`、`stores/{aiStore,aiRedstoneStore,workspaceStore,chatHistoryStore}` 一并迁入；
  `ProjectLayout.tsx:592-600` 的 auto 分支改走 `ctx.registerWorkbench`（§5.2）。
- **判据**：门禁 `--without manual` 通过；type-check + 182 用例全绿；L5 e2e 两模式标记互斥。
- **回滚点**：快照覆盖。

### M4 · 消解 11 条跨域边 + 收口 8 处 `/api`
- **写范围**：§4 的 M1/M2/M3/M4/A1-A8/C1-C4、§5.4 的 8 处。
- **判据**：门禁**两个方向都通过**（含断言 A'）；`verify-plugin-mode-separation.mjs` 与 `e2e-mode-separation.mjs` 全过。
- **回滚点**：按里程碑粒度回滚。

### M5 · 隔离门禁与验证（终验）
- **写范围**：无产品代码；只跑 L1-L5 全矩阵，产出验证报告。
- **判据**：两方向 × 5 层全过；L3 ≥ 182。
- **回滚点**：快照覆盖。

### 7.5 兼容壳的删除条件
`apps/web/src/stores/index.ts`（§3.4.1）在 **M4 结束时**若门禁两方向均通过，则在 **M5 删除**；
删除后必须再跑一次 L2/L3。

> **t29 补记（现状与两处新增机制）**：
> · `apps/web/src/stores/index.ts` 兼容壳**仍在**（`auto/workbench` 侧已改指
>   `@novel-plugins/data-core/stores`，门禁断言 A' 专门守此，两方向实测 0 违规）；
>   删除条件仍按上文——须在 M5、两方向门禁通过后删，删后复跑 L2/L3。
> · **新增机制 ①：`registerLocalDataCleaner`**（消解 §4-C2 的 shared→auto 反向边，
>   见该行补记）。`data-core` 提供注册/反注册，auto 在模块入口经 `ctx.effect` 注册，
>   缺席即集合为空、清理照常。
> · **新增机制 ②：`apps/web/src/plugin/moduleEntries.ts`**（承接 §4-K3）。
>   用 `import.meta.glob` 精确两条路径收集模块入口，`k.endsWith(...)` 精确匹配，
>   使「模块缺席 ⇒ 入口不被收集 ⇒ 无悬空 import」成为**构建期事实**而非运行时兜底。
>   （D44 教训：kernel 曾直接写 `import('@novel-plugins/manual-workbench/web')`，
>   那是 vite **静态可解析**的说明符 ⇒ 模块缺席时 `[vite:load-fallback]` ENOENT 硬失败。）
>   ★ 该机制与 §2.4 是**同一陷阱的两面**：都必须精确到 `workbench` 而非按模式目录通配，
>   否则同目录的兄弟包（`novel.autowrite` / `novel.bookscan` / `worldbuilding`）会被误算成模块。
> · **新增机制 ③：模块内专用 tsconfig**（`apps/plugins/<mod>/workbench/tsconfig.typecheck.json`，
>   见 §6.3 的 (a1)/(a2) 补记）。补上「`@novel/web` 的 type-check 看不见模块内部」这一结构性盲区。
> · **解析陷阱修正（两处，t29）**：① `ui-kit/package.json` 的 exports 键由 `"./ai-bars"` 改为
>   `"./aiBars"` —— 原键名与文件名 `src/aiBars.tsx` 不一致，而本仓别名走**文件系统前缀映射**
>   （`ui-kit/*` → `src/*`，不经 package exports）⇒ 实测 `ui-kit/ai-bars` 报 **TS2307**、
>   `ui-kit/aiBars` exit 0；② `novel.autowrite/tsconfig.json` 补
>   `"@novel-plugins/ui-kit/*": ["../../shared/ui-kit/src/*"]` —— 原只有精确路径、缺 `/*`，
>   故该包内任何 `ui-kit/<子路径>` 都解析不了（会打穿该模块的独立 type-check）。
> · **D46 下沉与事件桥**：`SkillsBar` / `QuickPromptsBar` 下沉
>   `apps/plugins/shared/ui-kit/src/aiBars.tsx`（**严格叶子**：只依赖 `react` + `lucide-react`，
>   不依赖 kernel / `react-router-dom` / `data-core`），技能数据层下沉
>   `apps/plugins/shared/data-core/src/skills/skillRegistry.ts`，两者以 **props 注入**相连
>   （`useSkillBarProps` 在模块侧取值 → 传给纯展示组件）。因 `novel.autowrite` **无
>   `react-router-dom` 依赖**，无法内联 `navigate(PATHS.settings)`，故新增
>   **`nm:open-settings` 事件桥**：模块侧 `window.dispatchEvent(new Event('nm:open-settings'))`，
>   kernel 壳 `ProjectLayout.tsx` 监听并 `navigate(PATHS.settings)` —— 与仓内既有
>   `nm:open-panel` 惯例同源，且让 shared 保持严格叶子（不引入路由依赖）。

---

## 8. 风险与回滚

### 8.1 风险表

| 风险 | 等级 | 对策 |
|---|---|---|
| **无 git**，误改无法用版本控制恢复 | **高** | 每个里程碑前重新打包快照；回滚=解压覆盖（§8.2） |
| 搬迁中**删测 / 改测**导致 182 用例退化 | **高** | 门禁断言 E（用例数 ≥ 182）；`PipelinePanel.test.tsx` 明确保留 |
| `stores/index.ts` 切分引发 store 循环依赖 | **高** | 按 §3.4.1 三分；实体 store 统一 shared；过渡壳仅存一个迭代且禁 auto 引用 |
| `Graph3D`（659 行，拖 `three` 1.18MB）下沉后把 three 拉进主包 | **中** | 保持 `GraphShell.tsx:25` 的 `lazy(() => import('./Graph3D'))` 惰性；`vite.config.ts` 的 `vendor-three` manualChunks 不变 |
| 8 处 `/api` 收口改变 base 解析 → 404/CORS | **中** | `resolveApiUrl` 与 `apiClient.ts:423` 口径完全一致；`vite.config.ts` 的规范化逻辑不动 |
| 零入边文件误删 | **中** | §3.7 一律「迁移或保留」（D8）；**删除留待独立后续任务**（独立复扫 + 全量回归 + 单独立项评审）；`credentials.ts`/`encryptionService.ts` 已改判保留（F1/F2） |
| `packages/core` 契约未同步导致新扩展点不可用 | **高** | §5.2 F3 前置 + §7 M1 F3 子步骤（t3）；§6.3 断言 F 强制 `WEB_SERVICES`↔`WebPluginContext` 一致 |
| kernel 壳留 `layout/` 造成 kernel→auto 边 | **中** | D4：kernel 壳迁 `components/shell/`，`layout/` 整体归 auto（§3.8/§3.10） |
| `plugin/{builtin,autoBuiltin}.ts` 迁移后注册顺序变化 | **低** | `registry.ts:114-116` 的 `order` 缺省 0 + 注册序号稳定排序；迁移保持注册先后 |
| HOST_MODE 服务端过滤与前端拆分口径不一致 | **低** | 复用 `pluginAppliesToProjectMode`（`packages/core/src/mode.ts:61-74`）单一事实源 |

### 8.2 回滚步骤（唯一手段，**无 git**）

```powershell
# 1) 确认目标就是本仓库根
$root = 'F:\new1.2'
# 2) 解压覆盖（node_modules 不在包内，不受影响）
Expand-Archive -Path "$root\.workbuddy\split-workbenches\backup-baseline\baseline-20260929-235002.zip" -DestinationPath $root -Force
# 3) 复验两条基线命令
pnpm --filter @novel/web type-check   # 期望 exit 0
pnpm --filter @novel/web test         # 期望 14 文件 / 182 用例全绿
```

### 8.3 纪律
- `.workbuddy/**` 是工作区外挂目录，**不是产品源码**，不得作为交付物路径。
- 本设计文档**未改动任何业务代码**；`apps/**`、`packages/**`、`scripts/**` 均未触碰。

---

## 附录 A · 关键契约速查

| 契约 | 位置 |
|---|---|
| 模式白名单 / 判定 | `packages/core/src/mode.ts:16-20,61-74` |
| Web 扩展点白名单 | `packages/core/src/manifest.ts:61-72` |
| Web 注册表 API | `apps/web/src/plugin/registry.ts:254-265` |
| 面板 / chatRail 类型 | `apps/web/src/plugin/types.ts:29-50,116-136` |
| 宿主挂载 + 模式标注 | `apps/web/src/plugin/host.ts:30-32,125-144` |
| 构建期清单 | `apps/web/src/main.tsx:58-64,75-103` |
| 服务端 HOST_MODE / 运行时门禁 | `apps/server/src/plugin/host.ts:842-861,338-354` |

## 附录 B · 本文件对队长 4 问的直答

1. **`components/knowledge/graph/*` 下沉到哪** → `apps/plugins/shared/ui-graph/`（模式无关共享包，两侧静态 import 不构成模块间边）。见 §2.3、§3.10。
2. **`stores/index.ts` 如何切** → **逐符号判定**（F4/D7/D10）：任一 kernel 壳（`App.tsx`/`pages/**`）消费者 ⇒ shared，跨模块消费者 ⇒ shared；实体 store / `useStatsStore` / `outlineNotepadStore` / `cascadeCleanChapterClient` → `@novel-plugins/data-core`（shared）；手写台专属（`useQuickPhraseStore`/`useUIStore`/`chapterJumpStore`）→ manual；AI store → auto；kernel 只留 `panelOpenStore`；保留一个由 **t4** 维护（D3）的 re-export 壳，且**禁止 auto 引用**（§6.3 断言 A'），M5 删除。见 §3.4/§3.4.1。
3. **模块导出入口与契约对应** → 入口 `@novel-plugins/manual-workbench/web`、`@novel-plugins/auto-workbench/web`；`plugin.json` 的 `web.inject` 取值与 `packages/core/src/manifest.ts:61-72` 的 `WEB_SERVICES` 一一对应，本地具体类型见 `apps/web/src/plugin/types.ts`。见 §2、§5.1、§6.3 断言 B。
4. **门禁 `--without` 断言规则** → §6.3 断言 A/A'/B/C/D/E/F（含两方向前缀禁令清单、兼容壳禁令、入口纪律、`/api` 字面量禁令、`staticEntries` 清单一致性〔降级「无法判定」〕、用例数 ≥ 182、core 契约一致性）。
