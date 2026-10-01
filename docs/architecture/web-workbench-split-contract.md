# Web 工作台拆分 · 最小可执行边界契约

> 依据：`.workbuddy/split-workbenches/{COUPLING-TRUTH-TABLE,OWNERSHIP-PROPOSAL,BASELINE}.md`、`CAPTAIN-DECISIONS.md`（D1–D13，**唯一权威**）与 `isolation-rules.json`。无行号标注者视为「未核实」。写范围仅本文件。

## 1. 模块导出入口

| 包 | 目录 | 入口 | 内容 |
|---|---|---|---|
| `@novel-plugins/manual-workbench` | `apps/plugins/manual/workbench` | `./web` | 手写台面板/路由/命令/设置区块/编辑器扩展 |
| `@novel-plugins/auto-workbench` | `apps/plugins/auto/workbench` | `./web` | AI 工作台、chatRail、AI 面板与 AI 能力实现 |
| `@novel-plugins/ui-graph` | `apps/plugins/shared/ui-graph` | `.` | 图元语（无业务状态） |
| `@novel-plugins/ui-kit` | `apps/plugins/shared/ui-kit` | `.` | 通用 UI 原子 |
| `@novel-plugins/data-core` | `apps/plugins/shared/data-core` | `.`、`./stores` | 共享数据层与 store |

沿用 `@novel-plugins/worldbuilding` 约定（`plugin.json` 的 `novelMuse` + `exports`；workspace 见 `pnpm-workspace.yaml:2-10`）。

- kernel **允许**：`@novel-plugins/{manual-workbench,auto-workbench}/web`；`@novel-plugins/{ui-graph,ui-kit,data-core}` **及其子路径**（如 `@novel-plugins/data-core/stores`）——**包名前缀匹配即可**；`@novel/core[/web]`、`@novel/shared`；以及已归 shared 的 `@/services/data/{databaseService,localUserData,chapterLocalCache,syncService}.ts`、`@/services/editor/{entityDetector,styleService,rhythmService}.ts`（kernel 壳合法消费：`ProjectLayout.tsx:13`、`EditorPage.tsx:24,28`）。
- kernel **禁止**：`@/components/{editor,knowledge,timeline,foreshadow,notes,outline,stats,export,ai,layout}/**`、`@/services/ai/**`、任一模块 `/src/**`。
- 模块**禁止** import 另一模块（含其包入口），只能经 kernel 扩展点或共享包。

## 2. kernel 扩展点与降级

**沿用（已实现，`plugin/host.ts:59-109`、`plugin/registry.ts:254-265`）**

| 名字 | 调用形状 | 缺席降级 |
|---|---|---|
| `ctx.registerProjectPanel` | `(p: FloatingPanelDef)`（`types.ts:29-50`） | 面板不出现（`ProjectLayout.tsx:522-525` 过滤后无该项） |
| `ctx.registerCommand` | `(c: CommandDef)` | 命令面板无该项（`CommandPalette.tsx:22`） |
| `ctx.registerRoute` | `(d: PluginRouteDef)` | 路由表无该项（`App.tsx:166,219`） |
| `ctx.registerSettingsSection` | `(d: SettingsSectionDef)` | 设置页无该区块（`PluginSettingsSections.tsx:71`）；`AIConfigPanel`/`LocalModelPanel` 即走此口（D5，`modes:['auto']`） |
| `ctx.registerEditorExtension` | `(d: EditorExtensionDef)` | 编辑器无该扩展（`useEditorInstance.ts:189`） |
| `ctx.registerEditorToolbarItem` | `(d: EditorToolbarItemDef)` | 工具栏无该按钮（`PluginEditorToolbar.tsx:71`） |
| `ctx.registerSelectionAction` | `(d: SelectionActionDef)` | 选区菜单无该项（`SelectionMenu.tsx:111`） |
| `ctx.registerSkillIcons` | `(icons: Record<string,LucideIcon>)` | 图标走默认（`skillsConfig.ts:71`） |
| `ctx.registerChatRail` | `(d: ChatRailDef)`（`types.ts:131-136`） | 单槽；`pluginChatRail?.Component` 存在才渲染，**缺席 ⇒ 该 AI 气泡栏不渲染**（kernel **不再提供内置回退组件**；`AiChatBubbleRail` 属 `components/ai/**`=auto，kernel 不得静态引用，否则 K2A 恒违规；D32-Q3）。**仅管编辑器内 AI 气泡栏，与「AI 对话」浮窗面板无关** |

**新增（名字与语义由本契约冻结）**

| 名字 | 调用形状 | 缺席降级 |
|---|---|---|
| `ctx.registerWorkbench` | `(d:{key; modes:PluginMode[]; Component})` 每模式单槽 | 该模式渲染 `<WorkbenchMissing/>`（「工作台未安装」，由 **t3 在 `apps/web/src/components/shell/` 下创建**）；另一模式不受影响。kernel 据此删掉 `ProjectLayout.tsx:592-600` 对 `AutoWriteWorkbench` 的静态 import |
| `ctx.registerBuiltinBubble` | `(def: FloatingPanelDef)` **按 `def.key` 键控的多槽** | kernel 硬编码两个内置气泡（`ProjectLayout.tsx:528-538`）：`chapters`→`LeftSidebar`（`ProjectLayout.tsx:15,529`，manual 域，即 **K2M 边**）、`ai-chat`→`ChatPanel`（`ProjectLayout.tsx:23-24,532`，auto 域，即 **C1/K2A 边**）。两者**必须**经此扩展点由所属模块注入以消除 kernel→模块静态依赖。**缺席时该气泡不渲染**（`chapterBubbleDef`/`chatBubbleDef` 不进 `bubblePanels`，`ProjectLayout.tsx:534-538`），优雅降级；12 面板与编辑器照常 |
| `ctx.registerCapability` | `(name: CapabilityName, impl)` | — |
| `ctx.getCapability` | `<T>(name): T \| null` | 返回 `null`；消费点必须隐藏入口或本地兜底，**禁止 throw** |

**`registerBuiltinBubble` 的两条对称注册（D21）**

| 注册方 | `def.key` | `Component` | 缺席时 |
|---|---|---|---|
| manual | `chapters` | `LeftSidebar` | 该气泡不渲染 |
| auto | `ai-chat` | `ChatPanel` | 该气泡不渲染 |

复用既有 `FloatingPanelDef`（`types.ts:29-50`，无需新字段）；kernel 由注册表**按 key 取 `Component`** 组成 `chapterBubbleDef`/`chatBubbleDef`，并删除 `ProjectLayout.tsx:15` 与 `:23-24,29` 的静态 import。

**同步 core（t3，D2）**：3 个新扩展点（`registerWorkbench`、`registerBuiltinBubble`、`registerCapability`+`getCapability`）须同步 `packages/core/src/plugin-context.ts:390-419`（`WebPluginContext` 方法声明）与 `packages/core/src/manifest.ts:61-72`（`WEB_SERVICES` 白名单；否则 `plugin.json` 的 `web.inject` 被 `z.enum(WEB_SERVICES)` 拒绝，`manifest.ts:149`）。`registerWorkbench`/`registerBuiltinBubble` 为 **kernel 内部扩展点**（由 `plugin/host.ts` 实现、模块入口调用，非插件能力声明）；`registerCapability`/`getCapability` 的 `CapabilityName` **取自 core 常量 `WEB_CAPABILITIES`**——由 t3 在 core 增补该常量作为**唯一来源**，本契约只引用、不另立清单。

> `registerChatRail` 与 `registerBuiltinBubble` 是**两个独立扩展点**，不可合并：前者管编辑器内 AI 气泡栏（单槽，`registry.ts:41-42,218-227`；auto 经 `ctx.registerChatRail({key, Component: AiChatBubbleRail, modes:['auto']})` 注册，**缺席即不渲染，kernel 不内置兜底**，D32-Q3），后者管 kernel 内置气泡浮窗面板（`chapters`/`ai-chat` 经此注入）。

`WEB_CAPABILITIES` 成员 → 签名 → 缺席降级：

| 能力 | 签名 | 缺席降级（确切到组件/按钮） |
|---|---|---|
| `ai.quickPhrases` | `(content:string, characters:Character[]) => Promise<string[]>` | `QuickPhraseBubble.tsx:194`（调用点）的「AI提取」按钮（`:275-278`）仍可点，返回手写台自带启发式（`quickPhraseService.ts:48` 逻辑迁入 manual），不报错 |
| `ai.timelineExtract` | `{ extractEventsByKeyword(args): Promise<void> }` | **隐藏** `TimelineView.tsx:248-253` 提取按钮，提示「需 AI 写作台」；手动增删事件（`:33-`）完整 |
| `ai.scan` | `scanService` 子集 | `useAutoEntityDetection.ts:16`/`useLatestChapterPolling.ts:25` 改经此能力，缺席时直接 `return`；实体可手工维护 |
| `ai.outlineFill` | `(args) => Promise<void>` | `OutlineFillDialog` 入口隐藏；大纲纯文本编辑完整 |
| `ai.entityRefresh` | `(args) => Promise<void>` | 交付后实体刷新跳过，不报错 |

`chatRail` 与 `registerBuiltinBubble` 为两个独立机制：前者是编辑器内 AI 气泡栏**单槽**（auto 注册 `AiChatBubbleRail`，**缺席即不渲染，kernel 不内置兜底**，D32-Q3）；后者是 kernel 内置气泡浮窗**多槽**（manual 注册 `chapters`、auto 注册 `ai-chat`，各自缺席则对应气泡不渲染）。

## 3. 归属决策表

**3.1 `stores/index.ts`（864 行，入边 61）切分**

- 共享（data-core）：`useProjectStore`、`useChapterStore`、`useCharacterStore`、`useItemStore`、`useLocationStore`、`useForeshadowStore`、`useAnnotationStore`、`useEarmarkStore`、`useOutlineStore`、`useTimelineStore`、`useNoteStore`、`useCreditStore`、`useEventStore`、`useStatsStore`、`getForeshadowThreshold`、`cascadeCleanChapterClient`。
- manual：`useQuickPhraseStore`、`useUIStore`。
- kernel：无（`panelOpenStore` 本为独立文件）。
- **规则（D10）**：逐符号判定；**任一 kernel 壳（`App.tsx`/`pages/**`）消费者 ⇒ 归 shared**（`useStatsStore` 由 `SettingsPage.tsx:2,36-37` 消费，D7；`cascadeCleanChapterClient` 由 manual `useEditorInstance.ts:13,158` 与 auto `LeftSidebar.tsx:3,417` 双消费，D11）。
- **兼容壳**：`stores/index.ts` 保留至本迭代末，标 `@deprecated`，仅 `export * from '@novel-plugins/data-core/stores'`；**禁 auto 引用**（auto 直接 import `data-core/stores`）；移除留待独立后续任务（本次不删）。

**3.2 11 条跨域边（manual→auto 4 + auto→manual 7）**

| 边 | 处置 |
|---|---|
| `QuickPhraseBubble.tsx:17` → `services/ai/quickPhraseService` | 改 `ctx.getCapability('ai.quickPhrases')` |
| `TimelineView.tsx:8` → `services/ai/scanService` | 改 `ai.timelineExtract`，缺席隐藏按钮 |
| `EditorPage.tsx:21` → `hooks/useAutoEntityDetection` → `services/ai/scanService` | 改 `ai.scan`，缺席 `return`（D9） |
| `EditorPage.tsx:22` → `hooks/useLatestChapterPolling` → 同上 | 同上 |
| `ChapterPlanGraphPanel.tsx:23,24,25` → `knowledge/graph/*` | 下沉 `ui-graph`，前缀改 `@novel-plugins/ui-graph` |
| `MemoryGraphPanel.tsx:29,30` → 同上 | 同上 |
| `PipelineGraphPanel.tsx:28,29` → 同上 | 同上 |

（auto→manual 7 条全在 `components/knowledge/graph/*`，一次下沉即断。）

**3.3 下沉 / 迁移 / 41 个 shared-other / 零入边**

| 对象 | 裁决 |
|---|---|
| `components/knowledge/graph/*`（GraphShell/StageNode/EntityNode/BubbleNode/useForceLayout/enhancedEdges/Graph3D） | **下沉** `@novel-plugins/ui-graph`；保持 `GraphShell.tsx:25` 对 Graph3D 的 lazy |
| `components/knowledge/RelationGraph.tsx` | **manual**；`autoBuiltin.ts:32` 的 `entities` 面板改 auto **自带薄封装**（复用 ui-graph + data-core 实体 store） |
| `plugin/builtin.ts` | **迁 manual** → `apps/plugins/manual/workbench/web/builtin.ts` |
| `plugin/autoBuiltin.ts` | **迁 auto** → `apps/plugins/auto/workbench/web/autoBuiltin.ts` |

41 个 shared/other 逐条裁决（D23：计数以本枚举为准，共 9+16+5+8+3=41）：

- **kernel**：`components/effects/{AmbientBackdrop,BambooLeafFollow}.tsx`、`components/shuimo/index.tsx`、`components/settings/{AppearancePanel,PluginManagerSection,PluginSettingsSections,UpdateSection}.tsx`、`stores/panelOpenStore.ts`、`vite-env.d.ts`
- **共享 data-core**：`hooks/useCurrentProjectId.ts`、`services/auth/sessionKeepalive.ts`、`services/data/{databaseService,localUserData,syncService,chapterLocalCache}.ts`、`services/editor/{entityDetector,styleService,rhythmService}.ts`、`stores/{authStore,cascadeCleanFlag,editorStore,outlineNotepadStore,referenceStore}.ts`、`utils/{characterMerge,date}.ts`
- **共享 ui-kit**：`hooks/useGlassRipple.ts`、`stores/themeStore.ts`、`utils/{errors,gsap,safeConfirm}.ts`
- **manual**：`hooks/{useAchievements,useEntityChapterSync}.ts`、`services/data/exportService.ts`、`services/misc/{consistencyService,projectExportService}.ts`、`stores/chapterJumpStore.ts`、`utils/chapter.ts`、`components/snapshot/SnapshotManager.tsx`
- **auto**：`components/settings/{AIConfigPanel,LocalModelPanel}.tsx`、`services/security/securityService.ts`

> `chapterLocalCache` 归 **shared**（非 manual）：`databaseService.ts:298` 动态引它，若归 manual 会成 shared→manual 边。

零入边处置（**本次重构不删除任何文件**，D8；一律「迁移（指定落点）」或「保留（标 `@deprecated`）」）：

| 文件 | 裁决 |
|---|---|
| `layout/AIRedstonePanel.tsx` | 迁移→auto |
| `layout/BottomDrawer.tsx` | 迁移→共享(ui-kit) |
| `layout/PipelinePanel.tsx` | 迁移→auto 并保留（`__tests__/PipelinePanel.test.tsx:14`，182 红线） |
| `layout/{EntityRail,MemoryAuditPanel,StatusBar,WorkspacePane,WorldStateBoard}.tsx` | 迁移→auto |
| `layout/RightSidebar.tsx` | 迁移→共享(ui-kit) |
| `components/export/ImportDialog.tsx` | 迁移→manual（`projectExportService.ts:424` 动态引） |
| `components/foreshadow/{EarmarkPanel,ForeshadowsPage}.tsx` | 迁移→manual |
| `components/knowledge/Heatmap.tsx` | 迁移→manual |
| `components/editor/extensions/{MentionExtension.ts,RealtimeRhythm.tsx}` | 迁移→manual |
| `pages/ProjectSelectPage.tsx` | 迁移→kernel |
| `services/ai/aiService.ts` | 迁移→auto，标 `@deprecated`（与 chatService/scanService 重叠） |
| `services/editor/rhythmService.ts` | 迁移→**shared**（data-core，D19-②），标 `@deprecated` |
| `services/misc/webSearchService.ts` | 迁移→auto，标 `@deprecated` |
| `services/security/encryptionService.ts` | **保留→kernel**（`SettingsPage.tsx:19` 引，D7） |
| `utils/credentials.ts` | **保留→kernel**（`LoginPage.tsx:9` 引，D7） |
| `components/series/SeriesManager.tsx` | 迁移→manual，标 `@deprecated` |
| `components/consistency/ConsistencyPanel.tsx` | 迁移→manual |

> 两条「保留」经 t2 证明**并非零入边**（多行 import 漏判）；全部删除留待独立后续任务：须复扫 `__tests__` 与动态引用 + 全量 type-check + 182 用例全绿 + 单独评审。

## 4. 子插件清单

manual（`apps/plugins/manual/workbench/web/`）：

| 目录 | 职责 |
|---|---|
| `editor/` | 章节编辑器、工具栏、选区菜单、编辑器扩展 |
| `knowledge/` | 角色/地点/物品/关系图/地图/积分 |
| `timeline/` | 时间线视图与流程图 |
| `foreshadow/` | 伏笔与书角标记 |
| `outline-notes/` | 大纲与笔记 |
| `stats/` | 写作统计与成就 |
| `export/` | 导出/导入 |
| `reference/` | 参考书阅读与扫榜目录 |

auto（`apps/plugins/auto/workbench/web/`）：

| 目录 | 职责 |
|---|---|
| `pipeline/` | 多智能体流水线图谱与闸门 |
| `discuss/` | AI 讨论对话与 chatRail |
| `memory/` | 分层记忆审计图谱 |
| `skills/` | 技能库与技能开关 |
| `entities/` | 实体与设定（自带薄封装） |

## 5. 门禁断言规则

脚本 `scripts/verify/verify-workbench-isolation.mjs`，与 `.workbuddy/split-workbenches/tools/isolation-rules.json` 兼容。

**扫描根**：`apps/web/src/**`、`apps/plugins/manual/workbench/web/**`、`apps/plugins/auto/workbench/web/**`；`--without X` 时跳过 X 且**不要求其存在**。解析口径同 `tools/import-graph.mjs`（静态 `import from` + 动态 `import()`），命中即打印 `file:line`。

| 规则 | 适用域 | 禁止前缀 |
|---|---|---|
| `M2A` | manual | `@/services/ai/`、`@/components/ai/`、`@/stores/{aiStore,chatHistoryStore,aiRedstoneStore,workspaceStore}`、`@/components/layout/`、`@novel-plugins/auto-workbench`、`apps/plugins/auto/` |
| `A2M` | auto | `@/components/{knowledge,editor,timeline,foreshadow,notes,outline,stats,export}/`、`@novel-plugins/manual-workbench`、`apps/plugins/manual/` |
| `K2M` | kernel | `@/components/{editor,knowledge,timeline,foreshadow,notes,outline,stats,export}/`、`@/components/layout/{LeftSidebar,TrashDialog}.tsx`、`@novel-plugins/manual-workbench`、`apps/plugins/manual/` |
| `K2A` | kernel | `@/components/{ai,layout}/`、`@/services/ai/` |
| `NO-CROSS-MODULE` | manual+auto | 对方包入口 |

> **K2M 与 §1 的自洽口径**：§1「kernel 禁止」的 `@/components/{editor,…,ai,layout}/**` 在门禁中按**目标域**拆成两条——属 **manual 域**者入 **K2M**（`components/{editor,knowledge,timeline,foreshadow,notes,outline,stats,export}/**`、`components/layout/{LeftSidebar,TrashDialog}.tsx`（D16 归 manual）、`@novel-plugins/manual-workbench`、`apps/plugins/manual/`）；其余（`components/{ai}/**` 与 `components/layout/` 的**其余 19 文件**）属 **auto 域**，入 **K2A**。两规则并集 = §1 的 kernel 禁止集；`LeftSidebar`/`TrashDialog` 由 K2M 与 K2A 双重覆盖（均禁 kernel 引用），不冲突。

> `hooks/{useAutoEntityDetection,useLatestChapterPolling,useScanProcessors}` 属 **manual 自有文件**（唯一消费者 `EditorPage.tsx:21,22`，D18），故**不列入** M2A 禁止前缀（否则误伤 manual 自身）；其跨域边是 hook **内部** `→ @/services/ai/*`，已由 M2A 的 `@/services/ai/` 前缀捕获。

白名单（**包名前缀匹配即可**，含子路径）：`@novel/core`、`@novel/core/web`、`@novel/shared`、`@novel-plugins/ui-graph`、`@novel-plugins/ui-kit`、`@novel-plugins/data-core`（如 `@novel-plugins/data-core/stores`）。kernel **放行** `@/services/data/**`、`@/services/editor/**` 中已归 shared 的文件（§3.3）。

**额外断言**：`--without auto` → auto 包目录允许不存在，manual 与 kernel 扫描根 0 违规，`main.tsx` 构建期清单不含 auto 条目；`--without manual` 对称。**阈值：违规数与缺失模块数均为 0 才通过，非 0 退出码即失败。**

## 6. 写范围划分

| 任务 | 可改路径 |
|---|---|
| t3（kernel） | `apps/web/src/{plugin,components/ui,components/effects,components/shuimo,components/shell,pages,routes,styles,test,types,dev}/**`、`apps/web/src/{App.tsx,main.tsx}`、`apps/web/src/stores/{panelOpenStore,themeStore}.ts`、`packages/core/src/{plugin-context,manifest}.ts`（仅最小扩展，D2）、`apps/plugins/shared/**`、`apps/web/package.json`、`scripts/verify/verify-workbench-isolation.mjs` |
| t4（manual） | `apps/plugins/manual/workbench/**`、`apps/web/src/components/{editor,knowledge,timeline,foreshadow,notes,outline,stats,export,snapshot,series,consistency}/**`、`apps/web/src/components/layout/{LeftSidebar,TrashDialog}.tsx`（D16）、`apps/web/src/hooks/**`、`apps/web/src/services/data/exportService.ts`、`apps/web/src/services/misc/{consistencyService,projectExportService}.ts`、`apps/web/src/plugin/builtin.ts`、`apps/web/src/stores/index.ts` |
| t5（auto） | `apps/plugins/auto/workbench/**`、`apps/web/src/components/ai/**`、`apps/web/src/components/layout/**`（**仅其余 19 文件**：24 顶层 − 3 kernel 壳 `ProjectLayout`/`PanelSection`/`FloatingBubbles`（D4 移出至 `components/shell/`）− 2 t4 文件 `LeftSidebar`/`TrashDialog`（D16））、`apps/web/src/services/ai/**`、`apps/web/src/stores/{aiStore,chatHistoryStore,aiRedstoneStore,workspaceStore}.ts`、`apps/web/src/plugin/autoBuiltin.ts` |

**独占裁决（D3/D6）**：`apps/web/package.json` → **t3 独占**（M1 统一注册 workspace 依赖；t4/t5 需新依赖向队长提出、由 t3 加；原 t8 写「t4 主写」按 D3 更正，记为文档待修订、不改变 t8 结论）；`stores/index.ts` → **t4 独占**（含兼容壳），t5 只读、需改动经 t4；`apps/web/src/plugin/{registry,host,types}.ts` → **t3 独占**；`pnpm-workspace.yaml`、`scripts/verify/verify-workbench-isolation.mjs` → **t3 独占**。

**t4 写范围外的 `services/**` 归属**（D19-⑤，t4 不得改）：`services/data/{databaseService,localUserData,chapterLocalCache,syncService}.ts`→**shared**；`services/security/securityService.ts`→**auto**；`services/security/encryptionService.ts`→**kernel**；`services/editor/{entityDetector,styleService,rhythmService}.ts`→**shared**（D19-②）。
