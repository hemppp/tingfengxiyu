# 拆分设计文档 · 复审（round 2 / t13）

| 项 | 值 |
|---|---|
| 被评审 | `docs/architecture/web-workbench-split.md` |
| 评审快照 | **753 行 / 55,447 字符 / SHA256[:16]=`5B4FD01BE3CDEFCD`**（t23 修订后，含 D21/D25） |
| 复审轮次 | round 2（承接 t2 的 F1/F2/F4/F9；核 D1/D4/D5/D8/D9/D10 + F21/F22） |
| 权威 | `CAPTAIN-DECISIONS.md`（D1–D26） |
| 方法 | 逐条核 F1/F2/F4/F9/D1/D4/D5/D8/D9/D10/F21/F22 + **仓库事实独立复核** + 三处内部自洽（§3.10 vs §7 vs 扫描根） |
| **verdict** | **needs_revision** |

## 0. 结论摘要

- **t2 的 F1/F2/F4/F9 与 D1/D4/D5/D8/D9/D10、F21/F22 全部落地**（逐条见 §1–§3，仓库事实复核）。
- **D21 已同步**：`registerChatPanel` 全文 **0**、`registerBuiltinBubble` **10**；§3.10 L437-439、§5.5、§4-C1、§3.8 L366 均已改为「`chapters`/`ai-chat` 两个对称内核硬编码气泡经 `registerBuiltinBubble` 注入」；§5.4 已「七处→八处」（`七处` 0 命中、`八处` L533）。
- **新增 2 条 medium**：**T13-F1** 设计文档**内部自相矛盾**（`RightSidebar`/`BottomDrawer` 在 §3.7 判 `shared`，却在 §3.8/§3.10/§7-M3 仍列 `auto`）；**T13-F2** `syncService` §3.3 仍判 `auto`（应为 `shared`，t25 在修，须复核终态）。
- 结论：文档主体（三层结构、归属矩阵、耦合消解、降级契约、验收标准）**已可作为实现依据**；但存在 1 处**会直接误导 t5 写范围/归属**的内部矛盾（T13-F1），故 `needs_revision`（修复量小：3 处列表去掉 2 个文件名）。

---

## 1. t2 的 F1/F2/F4/F9 落地核验（仓库事实）

| 原 finding | 要求 | 文档现状 | 仓库事实复核 | 结论 |
|---|---|---|---|---|
| **F1** `credentials.ts` 有活跃入边 | 保留·kernel | §3.6 L307、§3.7 L347「保留·kernel（F1）」 | `pages/LoginPage.tsx:9` `} from '@/utils/credentials'`（`:6-8` 多行 import，用法 `:42-45,66,68`）；`LoginPage` 属 kernel | ✅ 落地 |
| **F2** `encryptionService.ts` 有活跃入边 | 保留·kernel | §3.3 L232、§3.7 L346「保留·kernel（F2）」 | `pages/SettingsPage.tsx:14-19`（`saveEncrypted`/`loadEncrypted`/`deleteEncrypted`/`listEncryptedKeys`）；`SettingsPage` 属 kernel | ✅ 落地 |
| **F4** `useStatsStore`→shared + 逐符号规则 | shared + 规则 | §3.4 L252-256（逐符号：任一 kernel 壳消费者⇒shared）、§3.4.1 L262（`useStatsStore`→shared） | `pages/SettingsPage.tsx:2,36-37`（`dailyGoal`/`setDailyGoal`） | ✅ 落地 |
| **F9** 单包路径 | `apps/plugins/{manual,auto}/workbench/` | §0 L9-11、§2 L131-133、§3.10 L408-430 | `pnpm-workspace.yaml` 现状 + D1 | ✅ 落地 |

## 2. D1/D4/D5/D8/D9/D10 落地核验

| 裁决 | 文档现状 | 结论 |
|---|---|---|
| **D1** 单包冻结 | §0 L9-11、§2 L131-133（`@novel-plugins/{manual-workbench,auto-workbench}`）、§3.10 目标结构 | ✅ |
| **D4** kernel 壳迁 `components/shell/` | §3.8 L357-363、§3.10 L397、§7-M2 L670-671 | ✅ |
| **D5** AIConfigPanel/LocalModelPanel→auto | §3.9 L384-385（经 `registerSettingsSection`） | ✅ |
| **D8** 禁删除 | §3.7 标题 L310「一律『迁移或保留』」、L313、L351-353；全文无「删除候选」结论（仅 L351-352 复述历史） | ✅ |
| **D9** 11 条跨域边 | §1.2 L64-86（M1/M2/M3/M4 + A1-A8）、§4 L447-457 | ✅ |
| **D10** 逐符号 store 判定 | §3.4 L252-256、附录 B L751 | ✅ |

## 3. F21/F22 与 D21 落地核验

| 项 | 文档现状 | 仓库事实 | 结论 |
|---|---|---|---|
| **F21** `cascadeCleanChapterClient`→shared | §3.4.1 L262 | manual `useEditorInstance.ts:13,158` + `LeftSidebar.tsx:3,417` 双消费 | ✅ |
| **F22** `outlineNotepadStore`→shared | §3.4 L249 | auto `ChatPanel.tsx:6`、`OutlineFillDialog.tsx:17` 直接 import | ✅ |
| **D21** `registerBuiltinBubble` 同步 | §3.10 L437-439、§5.2 L487、§5.5 L506-513、§4-C1 L457、§3.8 L366；`registerChatPanel` 0 命中 | — | ✅ |

## 4. 内部自洽核验（§3.10 vs §7 vs 扫描根）

| 维度 | 结果 |
|---|---|
| **扫描根** | §6.3 L592-594 与 §7-M0 L646 **完全一致**：`apps/web/src/**`、`apps/plugins/manual/workbench/web/**`、`apps/plugins/auto/workbench/web/**` ✅ |
| **单包路径** | §3.10 与 §7-M2/M3 一致 ✅ |
| **`layout/` 三分** | §3.8 L357-375 与 §3.10 L428、§7-M3 L679 **在 `RightSidebar`/`BottomDrawer` 上不一致** → **T13-F1** ❌ |
| **`/api` 处数** | §5.4 L533-535「八处」与 §7-M4 L685-686「8 处」一致 ✅ |

---

## 5. Findings

### T13-F1（medium）· 设计文档内部矛盾：`RightSidebar`/`BottomDrawer` 判 `shared`，却仍列在 `auto`

- **file**: `docs/architecture/web-workbench-split.md`（对照 `:330`/`:326` ↔ `:375`/`:428`/`:679`）
- **problem**: §3.7 **L330** 判 `components/layout/RightSidebar.tsx` → **shared（ui-kit）（D19-①）**、**L326** 判 `BottomDrawer.tsx` → **shared（ui-kit）**；但同一文档的三处 `layout/` 归集列表仍把这两文件列入 **auto**：
  - **L375**（§3.8）：`layout/{AIRedstonePanel,BottomDrawer,…,RightSidebar,StatusBar,…}.tsx | **auto**（迁移或保留，见 §3.7）`；
  - **L428**（§3.10）：`layout/{…,BottomDrawer,…,RightSidebar,…}  # …剩余文件全归 auto`；
  - **L679**（§7-M3）：`components/layout/ 其余文件全归 auto（D4：…BottomDrawer…RightSidebar…）`。
  即**同一文件两处不同归属**（§3.7=shared，§3.8/§3.10/§7-M3=auto）。仓库事实与契约一致：`ownership-final.json` 两文件均 `shared`、契约 §3.3 L119/L122 均「迁移→共享(ui-kit)」——故 **§3.7/契约正确，§3.8/§3.10/§7-M3 过时**。该矛盾直接影响 **t5 写范围**（是否主张 `layout/BottomDrawer.tsx`、`layout/RightSidebar.tsx`）与门禁归属，属「实现权威依据」级缺陷。
- **requiredFix**: §3.8 L375、§3.10 L428、§7-M3 L679 三处 `layout/` 列表中**移除 `BottomDrawer`、`RightSidebar`**（或就地标注「→ shared(ui-kit)，见 §3.7」）；同步修正 L428 的注释「剩余文件全归 auto」为「剩余文件（除 §3.7 判 shared 者）归 auto」。

### T13-F2（medium）· §3.3 仍判 `syncService` → auto（应为 shared）

- **file**: `docs/architecture/web-workbench-split.md:229`
- **problem**: §3.3 写 `services/data/`「`syncService.ts:7,28,44`（**auto**，仅 `ProjectLayout.tsx:13` 消费 → 随 chatRail 归属 auto，见 §3.8）」。仓库事实：`syncService` 唯一真实 import 为 kernel 壳 `ProjectLayout.tsx:13,560`（其余 20+ 处为注释/日志），按 D10「kernel 壳消费者⇒shared」应归 **shared**；契约 §1 L17/§3.3 L107/§6 L195 与 `ownership-final.json` 均判 **shared**。理由「随 chatRail 归属 auto」自相矛盾（`syncService` 由 kernel 壳直接消费，与 chatRail 无关）。
- **requiredFix**: §3.3 L229 的 `syncService.ts` 由 **auto** 改 **shared**，删除「随 chatRail 归属 auto」表述。**（注：队长已建 t25 专修此项，本条请以 t25 终态为准——我将在其完成后复核。）**

### T13-F3（low）· §3.10 L406 `data-core` 清单未含 `syncService`

- **file**: `docs/architecture/web-workbench-split.md:406`
- **problem**: §3.10 目标结构 `data-core/src/{…,data/{databaseService,chapterLocalCache,localUserData},…}` 未列 `syncService`；若 T13-F2 落为 shared，该清单应含 `syncService`（现缺，与 §3.3 的 auto 判一致但均待修）。
- **requiredFix**: 随 T13-F2 一并在 L406 的 `data/` 清单补 `syncService`。

---

## 6. 非阻断观察

1. **`LeftSidebar`/`ChatPanel` 集成口径已自洽**：§3.10 L437-439 与 §5.5 一致（两气泡经 `registerBuiltinBubble` 注入，kernel 无静态边）。t17 原「若把 `LeftSidebar` 判 auto 则 kernel→auto 边，故必须 manual」的论证已补 D21 说明，方向不再存疑。
2. **门禁漏报提醒（转 M1/t7，非设计缺陷）**：`layout/` 整目录判 auto 时，`ProjectLayout.tsx:15 → LeftSidebar` 会被记为 auto→auto 而漏报；这是唯一 kernel→`LeftSidebar` 静态边，**M1 必须删除 `ProjectLayout.tsx:15` 的静态 import**（已入 D26，t7 验证）。
3. **§3.10 L428 与 §3.8 L374 的文件集差异**：L428 只列 14 个 `layout/` 文件名，而 `{ChapterPlanGraphPanel,MemoryGraphPanel,PipelineGraphPanel,SkillLibraryPanel}` 4 个在 §3.10 的 `web/{pipeline,memory,skills}/` 处归位——**设计意图可辨**，但 L428 未注明「4 图谱/技能面板已移入大类目录」，易被读成漏列；建议加一句说明（非阻断）。

---

## 7. 验收判据对照

| 验收项 | 结果 |
|---|---|
| F1/F2/F4/F9 真正修正（仓库事实复核） | ✅ |
| D1/D4/D5/D8/D9/D10 落地 | ✅ |
| F21/F22 落地 | ✅ |
| 未引入新矛盾（§3.10 vs §7 vs 扫描根） | **部分**：扫描根 ✅、单包路径 ✅、`/api` ✅；**`layout/` 三分 ❌（T13-F1）** |
| 未修改被评审文档 | ✅（仅新增本报告） |

**最终 verdict：`needs_revision`** —— 设计文档主体已可作为实现依据；阻断项为 **T13-F1**（`RightSidebar`/`BottomDrawer` 归属在文档内自相矛盾，3 处列表待删 2 个名），另 **T13-F2/T13-F3**（`syncService` 归属，t25 在修）。修复量小。
