# 评审报告 · Web 工作台拆分「最小可执行边界契约」（t9 / round 1）

- **被评审对象**：`docs/architecture/web-workbench-split-contract.md`（165 行 / 923 中文字符，6 节）
- **评审员**：reviewer（质量门）
- **评审依据**：契约本身、`docs/architecture/web-workbench-split.md`（设计文档）、`.workbuddy/split-workbenches/CAPTAIN-DECISIONS.md`（D1–D10，**唯一权威**）、`.workbuddy/split-workbenches/{COUPLING-TRUTH-TABLE.md,OWNERSHIP-PROPOSAL.md}`、`packages/core/src/{manifest.ts,plugin-context.ts,web.ts}`、`apps/web/src/plugin/{types.ts,registry.ts,host.ts}`、以及**独立复扫**（含 `__tests__` 与动态引用）。
- **未修改被评审文档**：仅新增本报告。

## 结论（verdict）

**needs_revision**。

契约 6 节齐备、结构清晰、多数条目**可直接照做**（模块入口、降级行为已具体到组件/行号，非「优雅降级」空话；门禁扫描根与断言阈值可编码）。但存在 **2 条 high** 与若干 medium，须在驱动实现前修正：

1. **§3.2「9 条跨域边」漏了 2 条 manual→auto**：`EditorPage.tsx:21,22` 经 `useAutoEntityDetection`/`useLatestChapterPolling` → `services/ai/scanService`。按队长 **D9**，跨域边应为 **11 条**（manual→auto **4** 条）。契约按 2 条写，会让 t4/t5 漏掉这两条边的消解。
2. **§1 kernel 禁止前缀过宽，会把 shared 子路径一并禁掉**：`@/services/{ai,data,editor}/**` 中的 `services/data/{databaseService,localUserData,syncService}` 与 `services/editor/{entityDetector,styleService}` 是**共享（data-core）**，kernel 壳**合法且必须**消费（`ProjectLayout.tsx:13` 引 `syncService`、`EditorPage.tsx:24,28` 引 `entityDetector`/`chapterLocalCache`）。照此禁令，kernel 自己会违规。

其余为 D 系列取代项（D7/D8/D4/D3）在契约中的同步修订，见 §2 与 §4。

> 说明：队长要求「§6 `package.json` 归 t4 已被 D3 取代——记为文档待修订 finding，不因此否掉 t8」。本报告对 **t8 的产出**记为 F9（low，文档待修订）；但 F1/F2 是**独立于 D 系列**的实质缺陷，故整体 verdict 仍为 needs_revision。

---

## 1. 逐节核对（6 节齐备性 + 可执行性）

| 节 | 齐备 | 可执行 | 备注 |
|---|---|---|---|
| §1 模块导出入口 | ✅ | ⚠️ | 入口/包名/白名单齐备；**kernel 禁止前缀过宽**（F2）。`worldbuilding` 用 `novelMuse` 字段而非 `exports`，契约称「沿用 `exports` + `novelMuse.modes`」——两种约定并存，需说明 kernel 校验以哪种为准。 |
| §2 kernel 扩展点与降级 | ✅ | ✅（降级具体到组件） | 9 个沿用项 + 4 个新增项，降级行为**具体**（如 `QuickPhraseBubble.tsx:268-278`、`TimelineView.tsx:248-253`）；但**未写明 core 同步**（F5）。 |
| §3 归属决策表 | ✅ | ⚠️ | §3.1/§3.3 多数正确；**§3.2 漏 2 条边**（F1）、**§3.1 `useStatsStore` 与 D7 冲突**（F6）、**§3.3 删除项与 D8 冲突**（F7）。 |
| §4 子插件清单 | ✅ | ✅ | 目录与 **D1 一致**（`web/<大类>/`）✅。 |
| §5 门禁断言规则 | ✅ | ✅ | 扫描根与 **D1 一致** ✅；断言可编码（F2 需收窄前缀）。 |
| §6 写范围划分 | ✅ | ⚠️ | **§6 `package.json`→t4 与 D3 冲突**（F9）；**缺 `packages/core/**`（D2）与 `components/shell/**`（D4）**（F8）。 |

**结论**：6 节齐备；§1/§3/§6 存在需修正项，§2/§4/§5 基本可执行。

---

## 2. Findings

### F1 · §3.2「9 条跨域边」漏 2 条 manual→auto（应为 11 条，D9） — **high**
- **file**：`docs/architecture/web-workbench-split-contract.md:67-77`
- **problem**：§3.2 表头写「9 条跨域边」，只列 2 条 manual→auto（`QuickPhraseBubble.tsx:17`、`TimelineView.tsx:8`）+ 7 条 auto→manual。独立复扫：`apps/web/src/components/editor/EditorPage.tsx:21` `import { useAutoEntityDetection } from '@/hooks/useAutoEntityDetection'`、`:22` `import { useLatestChapterPolling } from '@/hooks/useLatestChapterPolling'`；这两个 hook 又 `import { scanService } from '@/services/ai/scanService'`（`useAutoEntityDetection.ts:16`、`useLatestChapterPolling.ts:25`、`useScanProcessors.ts:15`）。按 **D9**，manual→auto 为 **4** 条，跨域边共 **11** 条。契约按 2 条写，会让 t4 漏消解这两条边（`EditorPage` 属 manual，却直连 auto 的 `services/ai`）。
- **requiredFix**：§3.2 增列 2 条边（`EditorPage.tsx:21` → `useAutoEntityDetection` → `services/ai/scanService`；`EditorPage.tsx:22` → `useLatestChapterPolling` → 同上），总数改为 11 条；并在 §3.2 给出这两条的处置（应同 §2 的 `ai.scan` 能力降级，即 `useAutoEntityDetection`/`useLatestChapterPolling` 改为经 `ctx.getCapability('ai.scan')`，缺席时 `return`）。
- **evidence**：`apps/web/src/components/editor/EditorPage.tsx:21,22`；`apps/web/src/hooks/useAutoEntityDetection.ts:16`；`apps/web/src/hooks/useLatestChapterPolling.ts:25`；队长 D9。

### F2 · §1 kernel 禁止前缀 `@/services/{ai,data,editor}/**` 过宽，误禁 shared 子路径 — **high**
- **file**：`docs/architecture/web-workbench-split-contract.md:18`
- **problem**：§1 规定 kernel **禁止** `@/services/{ai,data,editor}/**`。但契约 §3.3（`:91`）自己把 `services/data/{databaseService,localUserData,syncService}.ts`、`services/editor/{entityDetector,styleService}.ts` 判给**共享 data-core**；而 kernel 壳**合法消费**它们：`components/layout/ProjectLayout.tsx:13` `import { useSyncService } from '@/services/data/syncService'`（ProjectLayout 是 kernel 壳）；`components/editor/EditorPage.tsx:24` `import { htmlToText, ensureHtmlContent } from '@/services/editor/entityDetector'`、`:28` `import ... from '@/services/data/chapterLocalCache'`。禁令与归属表自相矛盾，且会让 kernel 自身违规。
- **requiredFix**：把 §1 的 kernel 禁止前缀从目录级收窄为**具体模块级**：禁 `@/services/ai/**`（整目录属 auto）、`@/services/data/{exportService,syncService}.ts` 视归属再定；**放行**已归 shared 的 `@/services/data/{databaseService,localUserData,chapterLocalCache}.ts` 与 `@/services/editor/{entityDetector,styleService}.ts`（或改为「禁止 `@/services/**` 中未列入 shared 白名单的路径」的白名单式表达）。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:18,91`；`apps/web/src/components/layout/ProjectLayout.tsx:13`；`apps/web/src/components/editor/EditorPage.tsx:24,28`。

### F3 · §2 新增扩展点未写明「同步扩展 `packages/core`」 — **medium**
- **file**：`docs/architecture/web-workbench-split-contract.md:37-46`
- **problem**：§2 冻结了 `registerWorkbench`/`registerChatPanel`/`registerCapability`/`getCapability` 的名字与语义，但**未要求**同步修改 `WebPluginContext`（`plugin-context.ts:390-419`）与 `WEB_SERVICES`（`manifest.ts:61-72`）。D2 已把最小 core 扩展归 t3，但契约作为「实现者照做」的文档，应显式写出该步（否则 t3 可能只改 `host.ts` 的 ctx 实现而漏改 core 声明/白名单）。
- **requiredFix**：§2 增补一段：「新增扩展点须同步 `packages/core/src/plugin-context.ts`（`WebPluginContext` 声明）与 `manifest.ts`（`WEB_SERVICES`/新增 `WEB_CAPABILITIES`），否则 `plugin.json` 的 `web.inject` 会被 `z.enum(WEB_SERVICES)` 拒绝」；并注明 `registerWorkbench`/`registerChatPanel` 是 kernel 内部扩展点、`registerCapability`/`getCapability` 的 `CapabilityName` 应来自 core 常量。
- **evidence**：`packages/core/src/plugin-context.ts:390-419`；`packages/core/src/manifest.ts:57-59,61-72,147-150`；队长 D2。

### F4 · §2 缺 `ai.quickPhrases`/`ai.scan` 等能力名的**单一事实源**声明 — **medium**
- **file**：`docs/architecture/web-workbench-split-contract.md:46-54`
- **problem**：§2 把 `CapabilityName` 写死在契约里（`:46`）。契约是文档，能力名若无 core 常量兜底，实现时容易与文档漂移（设计文档 §5.2 也硬编码同一列表，两处需人工同步）。
- **requiredFix**：在 core 增补 `WEB_CAPABILITIES` 常量作为唯一来源，契约改为引用之，并保留「能力 → 签名 → 缺席降级（组件/按钮）」对照表。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:46-54`；`docs/architecture/web-workbench-split.md:419`。

### F5 · §2 未定义 `<WorkbenchMissing/>` 的归属与实现 — **low**
- **file**：`docs/architecture/web-workbench-split-contract.md:41`
- **problem**：`registerWorkbench` 的缺席降级写「渲染 `<WorkbenchMissing/>`（「工作台未安装」）」，但该组件当前不存在，契约未指明由谁（t3/kernel）创建、落在哪个路径。
- **requiredFix**：注明 `<WorkbenchMissing/>` 由 t3 在 `apps/web/src/components/shell/` 下创建（与 D4 的 kernel 壳同处）。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:41`；`apps/web/src/components/`（无该文件）。

### F6 · §3.1 `useStatsStore` 判 manual，与 D7（改 shared）冲突 — **medium**
- **file**：`docs/architecture/web-workbench-split-contract.md:63`
- **problem**：§3.1 把 `useStatsStore` 列在 **manual**；但 **D7** 已裁决 `useStatsStore` → **shared**（因 kernel 的 `SettingsPage.tsx:2,36-37` 消费）。契约未同步。
- **requiredFix**：§3.1 把 `useStatsStore` 从 manual 移到「共享（data-core）」；并补注「任一 kernel 壳消费者 ⇒ 归 shared」（D10）。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:63`；`apps/web/src/pages/SettingsPage.tsx:2,36-37`；队长 D7/D10。

### F7 · §3.3 保留「删除」裁决，与 D8（禁止任何删除）冲突 — **medium**
- **file**：`docs/architecture/web-workbench-split-contract.md:95,104,107-110`
- **problem**：§3.3 与零入边表含多处「删除」（`rhythmService.ts`、`webSearchService.ts`、`encryptionService.ts`、`credentials.ts`、`SeriesManager.tsx`、`ConsistencyPanel.tsx`、`EntityRail.tsx` 等）。**D8** 已裁决本次重构**禁止任何删除**，全部改「迁移或保留」。契约未同步（且其中 `encryptionService.ts`/`credentials.ts` 经 t2 证明**并非零入边**）。
- **requiredFix**：§3.3/§3.7 全部「删除」改为「迁移（指定落点）或保留（标 `@deprecated`）」；删除留待独立后续任务。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:95,104,107-110`；队长 D8。

### F8 · §6 t3 写范围缺 `packages/core/**`（D2）与 `components/shell/**`（D4） — **medium**
- **file**：`docs/architecture/web-workbench-split-contract.md:161`
- **problem**：§6 的 t3 可改路径未含 `packages/core/src/{plugin-context,manifest}.ts`（D2 明确归 t3）与 `apps/web/src/components/shell/**`（D4 要求 kernel 壳迁入）。照此写范围，t3 执行 D2/D4 时越界。
- **requiredFix**：§6 t3 行增列 `packages/core/src/{plugin-context,manifest}.ts`（仅最小扩展）与 `apps/web/src/components/shell/**`；同时把 t5 行 `apps/web/src/components/{ai,layout}/**` 说明为「layout 其余文件（kernel 壳已按 D4 移出）」。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:161`；队长 D2/D4。

### F9 · §6 `apps/web/package.json` 归 t4，已被 D3 取代（归 t3） — **low**
- **file**：`docs/architecture/web-workbench-split-contract.md:165`
- **problem**：§6 写「`apps/web/package.json` → t4 主写、t5 只追加 auto 依赖行」；**D3** 裁决归 **t3**（`CAPTAIN-DECISIONS.md:48,58`）。
- **requiredFix**：§6 改为「`apps/web/package.json` → t3 独占」。（按队长指示：记为文档待修订，不因此否掉 t8。）
- **evidence**：`docs/architecture/web-workbench-split-contract.md:165`；队长 D3。

### F10 · §1 白名单未含 `@novel-plugins/{ui-graph,ui-kit,data-core}` 的**子路径**语义 — **low**
- **file**：`docs/architecture/web-workbench-split-contract.md:17,153`
- **problem**：§1/§5 白名单写 `@novel-plugins/{ui-graph,ui-kit,data-core}`，但 §1 又要求 kernel 经 `@novel-plugins/{manual,auto}-workbench/web` 入口、`data-core` 经 `./stores`（`:13`）。白名单是否覆盖 `@novel-plugins/data-core/stores` 子路径未言明，门禁实现易产生歧义。
- **requiredFix**：白名单显式写出允许的子路径（`@novel-plugins/data-core/stores` 等），或声明「包名前缀匹配即可」。
- **evidence**：`docs/architecture/web-workbench-split-contract.md:13,17,153`。

### F11 · §3.3 把 `chapterLocalCache` 判 manual，但 shared 的 `databaseService` 动态引它 — **low**
- **file**：`docs/architecture/web-workbench-split-contract.md:93`
- **problem**：§3.3 把 `services/data/chapterLocalCache.ts` 列 **manual**；但契约 §3.3（`:91`）把 `databaseService.ts` 列 **shared**，而 `databaseService.ts:298` 动态 `import('./chapterLocalCache')` → 形成 shared→manual 边（模块间边）。契约未消解。
- **requiredFix**：将 `chapterLocalCache.ts` 改判 **shared（data-core）**（其消费者含 manual 的 `EditorPage`/`useEditorInstance` 与 shared 的 `databaseService`），或把 `databaseService` 对它的调用改为事件/注入。
- **evidence**：`apps/web/src/services/data/databaseService.ts:298`；`apps/web/src/components/editor/EditorPage.tsx:28`；`docs/architecture/web-workbench-split-contract.md:91,93`。

### F12 · §2 `ai.quickPhrases` 行号引用偏差 — **low**
- **file**：`docs/architecture/web-workbench-split-contract.md:50`
- **problem**：契约写 `QuickPhraseBubble.tsx:268-278` 的「AI提取」仍可点。实测「AI提取」按钮/文案在 `:275`（title）、`:278`（label）、`:335`（空态提示），调用点在 `:194`（`generateQuickPhrases`）。`:268-278` 大致命中按钮区，但调用点未标。
- **requiredFix**：补标调用点 `QuickPhraseBubble.tsx:194`，并把按钮区间写准（`:275-278`）。
- **evidence**：`apps/web/src/components/editor/panels/QuickPhraseBubble.tsx:17,194,275,278,335`。

---

## 3. 独立复核（≥5 条归属决策 + 9 条跨域边）

| 契约条目 | 独立复扫结果 | 判定 |
|---|---|---|
| §3.1 实体 store（`useCharacterStore` 等）→ shared | `useAutoEntityDetection.ts:12`、`ChapterPlanGraphPanel.tsx:22` 均经 `@/stores` 消费 | ✅ 正确 |
| §3.1 `cascadeCleanChapterClient` → manual | `LeftSidebar.tsx:3,417`、`useEditorInstance.ts:13,158`（均 manual） | ✅ 正确 |
| §3.3 `outlineNotepadStore` → shared | `ChatPanel.tsx:6,467,551`（auto）、`OutlineManager.tsx:31`（manual）双消费 | ✅ 正确（设计文档判 manual 有误） |
| §3.3 `syncService` → shared | `ProjectLayout.tsx:13`（kernel 壳）唯一消费者 | ✅ 正确 |
| §3.3 `useGlassRipple` → ui-kit | `BookCard.tsx:6`、`BookshelfPage.tsx:7`、`BottomDrawer.tsx:3` | ✅ 正确 |
| §3.3 `entityDetector`/`styleService` → data-core | `EditorPage.tsx:24`、`useEditorInstance.ts:7`、`styleService.ts:154,184` | ✅ 正确 |
| §3.2 auto→manual 7 条 = `knowledge/graph/*` | `ChapterPlanGraphPanel.tsx:23-25`、`MemoryGraphPanel.tsx:29-30`、`PipelineGraphPanel.tsx:28-29` | ✅ 正确 |
| §3.2 manual→auto（2 条） | 实为 4 条（漏 `EditorPage.tsx:21,22`） | ❌ **漏 2 条（F1）** |
| §3.3 `components/knowledge/graph/*` 下沉 ui-graph | 入边仅三张图谱面板 + `GraphShell.tsx:25` lazy `Graph3D` | ✅ 正确 |
| §3.3 `plugin/{builtin,autoBuiltin}.ts` 迁模块 | `builtin.ts:18-29`（12 manual 组件）、`autoBuiltin.ts:21-37`（5 auto 面板） | ✅ 正确 |
| 零入边「删除」项（`rhythmService`/`webSearchService`/`aiService` 等） | 确为 0 入边；但 `encryptionService`/`credentials` 有入边 | ⚠️ 部分误判 + 与 D8 冲突（F7） |

**门禁断言可编码性**：§5 的扫描根（`apps/web/src/**` + `apps/plugins/{manual,auto}/workbench/web/**`）与 D1 一致 ✅；「违规数/缺失模块数均为 0、非 0 退出码即失败」可直接编码 ✅；`--without manual` 与 `--without auto` 通过 `appliesTo` 域切换可区分 ✅。唯一需修：§1/§5 的 kernel 禁止前缀须按 F2 收窄，否则门禁会对 kernel 自身产生假阳性。

**降级行为具体性**：§2 的降级**具体到组件与交互**（非空话）——`TimelineView.tsx:248-253` 隐藏按钮、`useAutoEntityDetection` 直接 `return`、`ProjectLayout.tsx:531-538` 气泡不渲染 ✅。

---

## 4. 判定汇总

| id | severity | 摘要 | 是否阻断 |
|---|---|---|---|
| F1 | high | §3.2 漏 2 条 manual→auto 边（应为 11 条，D9） | 是 |
| F2 | high | §1 kernel 禁止前缀过宽，误禁 shared 子路径 | 是 |
| F3 | medium | §2 未写「同步扩展 core」（D2） | 否 |
| F4 | medium | §2 能力名缺单一事实源 | 否 |
| F5 | low | §2 `<WorkbenchMissing/>` 归属未定 | 否 |
| F6 | medium | §3.1 `useStatsStore`→manual 与 D7 冲突 | 否 |
| F7 | medium | §3.3「删除」与 D8 冲突 | 否 |
| F8 | medium | §6 t3 写范围缺 `packages/core/**`/`components/shell/**` | 否 |
| F9 | low | §6 `package.json`→t4 与 D3 冲突（不否 t8） | 否 |
| F10 | low | §1 白名单未言明子路径语义 | 否 |
| F11 | low | §3.3 `chapterLocalCache`→manual 造成 shared→manual 边 | 否 |
| F12 | low | §2 `ai.quickPhrases` 行号偏差 | 否 |

**verdict：needs_revision**（F1/F2 为 high，须在驱动 t3/t4/t5 前修正契约）。

**与 D 系列的交叉说明**：F6/F7/F8/F9 属「按 D7/D8/D2/D3/D4 修订契约」类；F1（漏边）与 F2（前缀过宽）是**独立于 D 系列的实质缺陷**，也是 t9 判 needs_revision 的主因。契约 §4/§5 与 D1 已一致 ✅，无需修订。

---

## 5. 流程备注

- t9 已认领（attempt_id `fc292fcb-b5f4-4f96-9a6a-16077f060e57`），本报告为 t9 产出。
- **未修改被评审文档**（`docs/architecture/web-workbench-split-contract.md` 只读）；仅新增本报告。
- t2 已按队长要求置 **failed + verdict=needs_revision**（findings F1–F23 已回写），报告 `docs/reports/web-split-design-review.md`。
- 待 t10（architect 定点修订设计文档）完成、t11 就绪后，另出 `docs/reports/web-split-design-review-r2.md`（按 D7–D10 复核）。
