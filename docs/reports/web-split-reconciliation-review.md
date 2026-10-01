# 跨文档对账 + 归属清单 · 独立抽查评审（t12 / round 2）

| 项 | 值 |
|---|---|
| 被评审 | `docs/reports/web-split-reconciliation.md`（**110 行 / 14,017 B / SHA256[:16]=`ECBB8211AEE1B0CC`**） |
| 被评审 | `.workbuddy/split-workbenches/ownership-final.json`（**216 条 / 35,020 B / SHA256[:16]=`E0C19A3B41439D76`**，generatedAt=2026-09-29 17:04:53，mtime 09-30 01:04:53） |
| 权威 | `.workbuddy/split-workbenches/CAPTAIN-DECISIONS.md`（D1–D19） |
| 方法 | 复核 6 维对账与 D 系列 PASS/FAIL；**用仓库 grep 独立抽查 25 条归属**（含全部争议项）；用文件系统 diff 核对清单覆盖 |
| **verdict** | **needs_revision** |

## 0. 结论摘要

- **对账报告（产出 1）质量高**：6 维齐全、D1/D3/D4/D5/D7/D8/D9/D10/D11/D12 逐条 PASS/FAIL（10 PASS / 0 FAIL）、5 处不一致均给出「以谁为准 + 应改文本」、登记 1 处不判 FAIL。其自身结论我独立复核**基本成立**。
- **归属清单（产出 2）**：**216 条 = 仓库 216 文件，无遗漏、无重复**；抽查 **25 条中 24 条正确**。
- **发现 1 条 medium**：`ownership-final.json` 的 `services/editor/rhythmService.ts` 仍记 **`manual`**，而 **D19-②**（t11 完成之后下达）已裁为 **`shared`**，现行契约 §1/§3.3/§6 亦为 shared → 清单与唯一权威/契约冲突。
- 结论：产出可用、覆盖面完整；但因清单含 1 条与 D19-② 冲突的条目（且该清单将被 t3 门禁脚本**直接消费**），须先修，故 `needs_revision`。

---

## 1. 对账报告：6 维覆盖复核

| # | 维度 | 报告是否覆盖 | 我的独立复核 |
|---|---|---|---|
| ① | 模块路径/包名 | ✅ §1-① | ✅ 与 D1 一致（`apps/plugins/{manual,auto}/workbench/`） |
| ② | store 与文件归属 | ✅ §1-② + §2-①② | ✅ 2 处不一致（RightSidebar、rhythmService）属实（见 §3、§5） |
| ③ | 跨域边 11 条 | ✅ §1-③ | ✅ 11 = manual→auto 4 + auto→manual 7，行号复核属实 |
| ④ | kernel 禁止前缀 | ✅ §1-④ + §2-③④ | ✅ 2 处属实（`layout` 整目录 vs 单文件；`@novel-plugins/shared/*` 不存在） |
| ⑤ | 门禁扫描根 | ✅ §1-⑤ | ✅ 三条精确根一致 |
| ⑥ | 写范围 | ✅ §1-⑥ + §2-⑤ | ✅ t4 整目录越权属实（D3/D16/D19-⑤） |

**判定**：6 维**真覆盖**（非走过场）；每维均落到具体行号/文本。✅

## 2. D 系列逐条 PASS/FAIL 复核

| 裁决 | 报告判定 | 我的复核 |
|---|---|---|
| D1 单包冻结 | PASS | ✅ 两份文档路径/包名一致 |
| D3 单写者 | PASS（含 §2-⑤ 待修） | ✅ 且 §2-⑤ 正是 D19-⑤ 的前身 |
| D4 kernel 壳迁出 | PASS（含 §2-③） | ✅ `layout/` 整目录归 auto 与 D4 自洽 |
| D5 AIConfigPanel/LocalModelPanel→auto | PASS | ✅ |
| D7 F1/F2/F4 处置 | PASS | ✅ `credentials`/`encryptionService`→kernel、`useStatsStore`→shared |
| D8 不删除 | PASS | ✅ |
| D9 11 条边 | PASS | ✅ |
| D10 逐符号 store | PASS | ✅ |
| D11 `cascadeCleanChapterClient`→shared | PASS | ✅ |
| D12 `outlineNotepadStore`→shared | PASS | ✅ |

**判定**：10 条**逐条有 PASS/FAIL**，无遗漏；「以谁为准 + 应改文本」在 §2 五处均给出。✅（报告写「D1–D16 唯一权威」，未含 D17–D19；见 F-2。）

## 3. `ownership-final.json` 独立抽查（25 条，仓库 grep 核对）

| # | path | 清单 domain | 仓库事实（grep） | 正确？ |
|---|---|---|---|---|
| 1 | `stores/useStatsStore.ts` | shared | 与 `stores/index.ts` 合并定义，被 kernel `pages/SettingsPage.tsx:2,36-37` 消费 | ✅ |
| 2 | `stores/cascadeCleanChapterClient`（`stores/index.ts`） | shared | manual `useEditorInstance.ts:13` + auto `LeftSidebar.tsx:3` 双消费 | ✅ |
| 3 | `stores/outlineNotepadStore.ts` | shared | manual `OutlineManager.tsx:31` + auto `ChatPanel.tsx:6` 直接 import | ✅ |
| 4 | `services/data/chapterLocalCache.ts` | shared | `databaseService.ts:298` 动态引；`EditorPage.tsx:28` 引 | ✅ |
| 5 | `utils/credentials.ts` | kernel | `pages/LoginPage.tsx:9`（多行 import） | ✅ |
| 6 | `services/security/encryptionService.ts` | kernel | `pages/SettingsPage.tsx:19` | ✅ |
| 7 | `hooks/useAutoEntityDetection.ts` | manual | 唯一消费者 `EditorPage.tsx:21`；内部→`services/ai/scanService:16` | ✅ |
| 8 | `hooks/useLatestChapterPolling.ts` | manual | 唯一消费者 `EditorPage.tsx:22`；内部→`services/ai/scanService:25` | ✅ |
| 9 | `hooks/useScanProcessors.ts` | manual | 仅 `useAutoEntityDetection.ts:18` 引用 | ✅ |
| 10 | `components/layout/ProjectLayout.tsx` | kernel | kernel 壳（`App.tsx:22`），D4 目标 `components/shell/` | ✅ |
| 11 | `components/layout/PanelSection.tsx` | kernel | 壳（`ProjectLayout.tsx:16`） | ✅ |
| 12 | `components/layout/FloatingBubbles.tsx` | kernel | 壳（`ProjectLayout.tsx:17`） | ✅ |
| 13 | `components/layout/LeftSidebar.tsx` | manual | `ProjectLayout.tsx:15,529`（章节面板） | ✅ |
| 14 | `components/layout/TrashDialog.tsx` | manual | `LeftSidebar.tsx:8,595` | ✅ |
| 15 | `components/layout/ChapterPlanGraphPanel.tsx` | auto | `autoBuiltin.ts` 装配；`:23,24,25`→`knowledge/graph/*` | ✅ |
| 16 | `components/layout/MemoryGraphPanel.tsx` | auto | `:29,30`→`knowledge/graph/*` | ✅ |
| 17 | `components/layout/PipelineGraphPanel.tsx` | auto | `:28,29`→`knowledge/graph/*` | ✅ |
| 18 | `components/editor/EditorPage.tsx` | manual | manual 编辑器；`:21,22` 跨域边、`:24,27,28` 消费 shared | ✅ |
| 19 | `components/knowledge/graph/GraphShell.tsx` 等 7 文件 | shared | 下沉 `ui-graph`（D9） | ✅ |
| 20 | `services/data/exportService.ts` | manual | 唯一消费者 `components/export/ExportDialog.tsx:4` | ✅ |
| 21 | `services/security/securityService.ts` | auto | 唯一消费者 `components/ai/ChatPanel.tsx:14` | ✅ |
| 22 | `services/data/syncService.ts` | shared | 唯一消费者 `ProjectLayout.tsx:13`（kernel 壳） | ✅ |
| 23 | `components/settings/AIConfigPanel.tsx` / `LocalModelPanel.tsx` | auto | D5 | ✅ |
| 24 | `stores/index.ts` | shared | 过渡壳（D3/t4 独占，M5 移除） | ✅ |
| 25 | **`services/editor/rhythmService.ts`** | **manual** | **D19-② 裁为 shared**；现行契约 §1 L17/§3.3 L98/L120/§6 L184 均为 **shared** | ❌ **错误（F-1）** |

**小结**：抽查 25 条，**24 ✅ / 1 ❌**。

## 4. 覆盖完整性（文件系统 diff）

- `apps/web/src` 实际文件 **216**；清单 `files` **216**。
- **在仓库但缺于清单：0**；**在清单但不在仓库：0**；**重复 path：0**。
- 分布 `kernel 48 / manual 64 / auto 52 / shared 52` = 216。
- ✅ 覆盖**完全、无遗漏、无重复**。

---

## 5. Findings

### R-F1（medium）· `ownership-final.json` 的 `rhythmService` 未同步 D19-②（manual，应为 shared）

- **file**: `.workbuddy/split-workbenches/ownership-final.json`（条目 `apps/web/src/services/editor/rhythmService.ts`）
- **line**: 不适用（JSON 单行条目；证据字段 = `"契约 §3.3（迁移→manual，@deprecated）"`）
- **problem**: 清单记 `domain = "manual"`，`evidence` 引「契约 §3.3 迁移→manual」。但 **D19-②**（在 t11 完成之后下达）已把 `rhythmService` 裁为 **shared**，且**现行契约** §1 L17、§3.3 L98/L120、§6 L184 均写 **shared**。故该条目与唯一权威（D19-②）及现行契约**直接冲突**。该清单是 t3 门禁脚本的**直接输入**，错误 domain 会让 `services/editor/rhythmService.ts` 被误判为 manual 侧文件，进而使 kernel 放行/auto 归属的门禁口径出错。
- **requiredFix**: 将该条目改为 `domain = "shared"`，`evidence = "D19-②；契约 §3.3 L120（迁移→shared，@deprecated）"`；并**全量复扫**是否还有其它条目跟随 t11 时点（D19 之前）的裁决（建议对照 D19-② 与 D18 再核一遍）。

### R-F2（low）· 对账报告的权威口径已过期（D1–D16），未含 D17–D19

- **file**: `docs/reports/web-split-reconciliation.md`
- **line**: 5（「`CAPTAIN-DECISIONS.md`（D1–D16，唯一权威）」）、23、108–109
- **problem**: 报告把权威写为 **D1–D16**，但此后已下达 **D17–D19**（D19-② 直接推翻报告 §2-② 的「契约优先→manual」结论）。报告在 §2-② 末尾已**主动备注**「建议队长补一条 D 固化」，说明作者已知该点悬而未决——而该 D 正是 **D19-②**，且结论**与报告相反**（shared）。报告正文未回填，读者若只看正文会得到过时结论。
- **requiredFix**: 在报告头部与 §2-② 增补「**后续更新**：D19-② 已裁 `rhythmService`→**shared**，覆盖本报告 §2-② 的 manual 结论；权威范围更新为 D1–D19」。

### R-F3（low）· 清单缺少「快照时点」标注，易被误用为现行权威

- **file**: `.workbuddy/split-workbenches/ownership-final.json`
- **line**: 不适用（顶层 `generatedBy="t11"`、`generatedAt=2026-09-29 17:04:53`；**无 `authority`/`snapshotNote` 字段**）
- **problem**: 清单是**时点快照**（t11 完成时，早于 D18/D19），却将被 t3 门禁脚本消费；除 `generatedAt` 外无「以 CAPTAIN-DECISIONS 为准 / 快照可能落后」的提示。R-F1 正是此类漂移的实例。
- **requiredFix**: 在顶层增加 `authority: "CAPTAIN-DECISIONS.md (D1–D19)"` 与 `snapshotNote`（生成时点 + 可能落后于后续 D 裁决的声明），并规定每次 D 更新后由清单 owner 复扫。

---

## 6. 验收判据对照

| 验收项 | 结果 |
|---|---|
| 对账真覆盖 6 维 | ✅ |
| D1/D3/D4/D5/D7/D8/D9/D10/D11/D12 逐条 PASS/FAIL | ✅（10 PASS / 0 FAIL） |
| 不一致处给出「以谁为准 + 应改文本」 | ✅（5 处均给出） |
| 独立抽查 ≥15 条（含全部争议项） | ✅ 完成 25 条（含 captain 点名全部争议项） |
| 清单覆盖全部文件、无遗漏、无重复 | ✅（216↔216，0 漏 / 0 重） |
| findings 结构完整 | ✅（R-F1 medium、R-F2/R-F3 low） |

**最终 verdict：`needs_revision`** —— 对账报告与清单**主体可用**（覆盖完整、争议项 24/25 正确），仅需：①（R-F1）修 `rhythmService`→shared 并复扫同类漂移；②（R-F2/R-F3）补注 D19 与快照时点。修复量小。
