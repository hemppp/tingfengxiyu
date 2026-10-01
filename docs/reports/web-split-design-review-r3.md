# 拆分设计文档 · 复审（round 3 / t27）

| 项 | 值 |
|---|---|
| 被评审 | `docs/architecture/web-workbench-split.md` |
| 评审快照 | **756 行 / 56,008 字符 / SHA256[:16]=`2EB9B373DEF085BA`**（t26 修订后） |
| 复审轮次 | round 3（承接 t13 的 T13-F1/F2/F3） |
| 权威 | `CAPTAIN-DECISIONS.md`（D1–D26） |
| 方法 | 逐条核 T13-F1/F2/F3 + **仓库事实复核** + 三处内部自洽复查 + 回归既有结论 |
| **verdict** | **pass** |

## 0. 结论摘要

- **T13-F1（medium）✅ 闭环**：`RightSidebar`/`BottomDrawer` 的 `auto` 残留已从 **§3.8 L375、§3.10 L430、§7-M3 L682** 三处清除；§3.8 新增 L376 显式行（shared ui-kit，不归 auto），§3.10 L430 注释与 §7-M3 均改为「除 §3.7 判 shared(ui-kit) 者」，§3.10 L435-437 D4 说明由「三分」改「**四分**」。**文档内不再有同文件两处不同归属**。
- **T13-F2（medium）✅ 闭环**：§3.3 L229 `syncService` 已改 **shared**，理由为「唯一真实消费者 `ProjectLayout.tsx:13`（D4 后属 kernel 壳）→ D10 归 shared」，误导表述「随 chatRail 归属 auto」**已不存在**；全文无把 `syncService` 描述为 auto 之处。
- **T13-F3（low）✅ 闭环**：§3.10 L408 `data-core` 清单已含 `syncService`（`data/{databaseService,chapterLocalCache,localUserData,syncService}`）。
- **回归无退化**：t13 已核的 F1/F2/F4/F9、D1/D4/D5/D8/D9/D10、F21/F22、D21 均保持；**未引入新矛盾**（扫描根、单包路径、`/api` 八处、`layout/` 四分均自洽）。
- 结论：设计文档**已可作为实现权威依据**，`pass`。

---

## 1. T13-F1 / T13-F2 / T13-F3 逐条复核

| 原 finding | 修复要求 | 现状（行号） | 结论 |
|---|---|---|---|
| **T13-F1**（medium）RS/BD 内部矛盾 | §3.8/§3.10/§7-M3 去 auto | §3.8 L375 已删两名；L376 新增「`layout/{BottomDrawer,RightSidebar}.tsx` → **shared（ui-kit）**…**不归 auto**」；§3.10 L430 已删两名 + 注释「…§3.7 判 shared(ui-kit) 者（BottomDrawer/RightSidebar）后的剩余文件」；§7-M3 L682「**除 §3.7 判 shared(ui-kit) 者**——`BottomDrawer`/`RightSidebar` 不在此列」；§3.10 L436「四分」 | ✅ 闭环 |
| **T13-F2**（medium）`syncService` 归属 | §3.3 改 shared | §3.3 L229：`syncService.ts:7,28,44`（**shared**，唯一真实消费者 `ProjectLayout.tsx:13`…按 D10 归 shared；其余 20+ 处为注释/日志）；同行混合标签改为 `shared + manual` | ✅ 闭环 |
| **T13-F3**（low）data-core 缺 `syncService` | 补入 | §3.10 L408 `data/{databaseService,chapterLocalCache,localUserData,syncService}` | ✅ 闭环 |

**仓库事实复核**：`syncService` 唯一真实 import = `ProjectLayout.tsx:13,560`（✅ 文档所引两处「注释/日志」实证：`useEditorInstance.ts:431` = `// …syncService 的异步 fetch 会被 abort`；`ChapterEditor.tsx:12` = `* 数据加载由 syncService（ProjectLayout 中调用）…`，**均为注释**）。`BottomDrawer`/`RightSidebar` 在契约 §3.3 L119/L122 与 `ownership-final.json` 均 `shared`，文档现与之一致。

## 2. 内部自洽复查（§3.10 vs §7 vs 扫描根）

| 维度 | 结果 |
|---|---|
| **扫描根** | §6.3 L592-594 与 §7-M0 L646 一致（三条精确路径）✅ |
| **单包路径** | §3.10 与 §7-M2/M3 一致 ✅ |
| **`layout/` 归属** | §3.8（kernel 壳 3 + manual 2 + shared 2 + auto 17 行内合计）/ §3.10 L430 / §7-M3 L682 **现已一致**（shared 者三处均排除）✅ |
| **`/api` 处数** | §5.4 L536「八处」+ 表 8 行 与 §7-M4 L688-689「8 处」、§8 L714 一致；第 6 行 `pipelineSession.ts:170` 与仓库 `:169 API_BASE`/`:170 RAW_BASE`/`:166` 注释**完全吻合** ✅ |
| **扩展点命名** | `registerChatPanel` 0 命中、`registerBuiltinBubble` 统一；`registerChatPanel` 仅在历史沿革说明中出现 0 次 ✅ |
| **历史包名** | `@novel-plugins/shared` 仅 L611 作为「D19-④ 原误写…已更正」的历史注（正确，非现行白名单）✅ |

## 3. 回归（t13 已核项保持）

| 项 | 结果 |
|---|---|
| F1（`credentials`→kernel，`LoginPage.tsx:9`）/ F2（`encryptionService`→kernel，`SettingsPage.tsx:14-19`） | ✅ |
| F4（`useStatsStore`→shared + 逐符号规则）/ F9（单包路径） | ✅ |
| D1/D4/D5/D8/D9/D10 | ✅ |
| F21（`cascadeCleanChapterClient`→shared）/ F22（`outlineNotepadStore`→shared） | ✅ |
| D21（`registerBuiltinBubble` 双槽）/ §5.4 八处 | ✅ |
| 无「删除候选」结论（D8） | ✅ |

## 4. 非阻断观察（不影响 verdict）

1. **`localUserData`→`chatHistoryStore` 已知边（t25 已登记）**：§3.3 L229 记「值引用 `stores/chatHistoryStore`（auto）→ shared→auto 已知边，消解见 §4 行 C2」，§4 L461 C2 有对应消解方案。**属显式登记的跨域边**（非新增第 12 条 manual/auto 边，方向为 shared→auto），表述自洽。仓库事实吻合：`localUserData.ts:10` import、`:38 removeProject`、`:53 clearAll`。
2. **门禁漏报提醒（转 M1/t7，非设计缺陷）**：`layout/` 整目录判 auto 时，`ProjectLayout.tsx:15 → LeftSidebar` 会被记为 auto→auto 而漏报；**M1 必须删除 `ProjectLayout.tsx:15` 的 `LeftSidebar` 静态 import**（已入 D26，t7 验证）。§3.8 L366 已声明「kernel 经 `registerBuiltinBubble('chapters')` 注入，故 kernel 无静态边」，与之一致。
3. §3.10 L430 只列 12 个 `layout/` 名（4 图谱/技能面板与 `AutoWriteWorkbench` 已在大类目录归位），§3.8 合计 17 = 12 + 4 + 1，**账实相符**。

---

## 5. 验收判据对照

| 验收项 | 结果 |
|---|---|
| T13-F1/F2/F3 闭环 | ✅ 全部 |
| F1/F2/F4/F9 真修正（仓库事实） | ✅ |
| D1/D4/D5/D8/D9/D10 落地 | ✅ |
| 未引入新矛盾（§3.10 vs §7 vs 扫描根） | ✅ |
| 未修改被评审文档 | ✅（仅新增本报告） |

**最终 verdict：`pass`** —— t26 三项修复全部落地并经仓库事实复核；设计文档三层边界、归属矩阵、耦合消解、降级契约、验收标准齐备且**无自相矛盾**，**可作为实现权威依据**。
