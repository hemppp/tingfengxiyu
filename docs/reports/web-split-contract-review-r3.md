# Web 工作台拆分 · 边界契约复审（round 3 / t20）

| 项 | 值 |
|---|---|
| 被评审 | `docs/architecture/web-workbench-split-contract.md` |
| 评审快照 | **195 行 / cjk=1511 / SHA256[:16]=`CFA6B8B3FEE1EF65`**（t19 修订后） |
| 复审轮次 | round 3（承接 t15 的 F-1/F-2/F-3；核 t19 的 D21/D22/D23） |
| 权威 | `CAPTAIN-DECISIONS.md`（D1–D26） |
| 方法 | 逐条核 D21/D22/D23 + **仓库事实独立复核**（8 条归属 + 11 条跨域边）+ 跨文档/算术自洽检查 |
| **verdict** | **needs_revision** |

## 0. 结论摘要

- **D21 ✅ 闭环**：§2 已把 `registerChatPanel` 泛化为 **`registerBuiltinBubble(def: FloatingPanelDef)`**（按 `def.key` 键控多槽），L46-51 给出**两条对称注册**（manual `chapters`→`LeftSidebar` / auto `ai-chat`→`ChatPanel`，各自缺席不渲染），L53 明确**删除 `ProjectLayout.tsx:15` 与 `:23-24,29` 的静态 import**。`registerChatPanel` 全文命中 **0**、`registerBuiltinBubble` **5**。**F-2 闭环**。
- **D22 ⚠️ 结构闭环、但有算术错误**：§6 L190 t4 已含 `components/layout/{LeftSidebar,TrashDialog}.tsx`；L191 t5 已改「其余 **20** 文件」。**F-1 的「写范围重叠」已修**，但**该计数错误**（见 R3-F1：应为 **19**）。
- **D23 ✅ 闭环**：§3.3 L104 计数 **41**（`47 个` 命中 **0**），枚举 9+16+5+8+3=41 **逐类复核属实**。**F-3 闭环**。
- **D26 ✅**：§5 L173 **K2M 不含** `@/pages/`，且含 `@/components/layout/{LeftSidebar,TrashDialog}.tsx`。
- **新增 2 medium + 1 low**：t5 写范围计数 20→19（R3-F1）；`syncService` 设计/契约跨文档冲突（R3-F2）；A2M 含 `@/pages/` 待澄清（R3-F3）。
- 结论：三条待修项**均已实质闭环**，但契约仍含 1 处**可机械证伪的计数错误**（R3-F1）与 1 处**跨文档归属冲突**（R3-F2），二者都落在「t5 写范围 / shared 归属」这类**直接驱动实现**的位置，故 `needs_revision`。

---

## 1. D21 / D22 / D23 逐条复核

| 裁决 | 复核点 | 契约现状 | 结论 |
|---|---|---|---|
| **D21**（F-2） | 扩展点名 / 多槽 / 对称注册 / 删除静态 import | L42 `registerBuiltinBubble` 按 `def.key` 多槽；L46-51 表（manual→`chapters`→`LeftSidebar`；auto→`ai-chat`→`ChatPanel`）；L53「删除 `ProjectLayout.tsx:15` 与 `:23-24,29` 的静态 import」；L55「3 个新扩展点」；L57/L69 独立性重申 | ✅ **闭环** |
| **D22**（F-1） | t4 含 2 文件 / t5 仅其余 | L190 t4 含 `components/layout/{LeftSidebar,TrashDialog}.tsx`（D16）；L191 t5「仅其余 20 文件」 | ⚠️ **结构闭环**，计数错（R3-F1） |
| **D23**（F-3） | 计数 = 41 | L104「41 个…共 9+16+5+8+3=41」；`47 个` 命中 0 | ✅ **闭环**（枚举逐类复核属实） |

**仓库事实核对（D21 依赖）**：`ProjectLayout.tsx:15` = `import { LeftSidebar } from '@/components/layout/LeftSidebar'`；`:23-24` = `ChatPanelControlProps` 类型 + `AiChatBubbleRail`；`:29` = `lazy(() => import('@/components/ai/ChatPanel')…)`；`:528-533` = `chapterBubbleDef`(`chapters`→`LeftSidebar`) + `chatBubbleDef`(`ai-chat`→`ChatPanel`)；`:534-538` = 二者并入 `bubblePanels`。**契约行号全部属实**。

---

## 2. 仓库事实独立复核（8 条归属 + 11 条跨域边）

**归属决策（8 条，全部与契约一致）：**

| 决策 | 契约裁决 | 仓库事实 | 结论 |
|---|---|---|---|
| `utils/credentials.ts` | 保留·kernel（L132） | `pages/LoginPage.tsx:9` 活跃静态 import | ✅ |
| `services/security/encryptionService.ts` | 保留·kernel（L131） | `pages/SettingsPage.tsx:19` 活跃静态 import | ✅ |
| `useStatsStore` | shared（L75） | kernel `SettingsPage.tsx:2,36-37` | ✅ |
| `cascadeCleanChapterClient` | shared（L78） | manual `useEditorInstance.ts:13,158` + `LeftSidebar.tsx:3,417` | ✅ |
| `outlineNotepadStore` | shared（L107） | auto `ChatPanel.tsx:6` 直接 import | ✅ |
| `rhythmService` | shared（L129，D19-②） | 零入边 | ✅ |
| `chapterLocalCache` | shared（L107/L112） | `databaseService.ts:298` 动态引 | ✅ |
| `syncService` | shared（L17/L107/L195） | 唯一消费者 kernel 壳 `ProjectLayout.tsx:13,560` | ✅（**设计侧冲突 → R3-F2**） |

**跨域边（7 条图谱边，行号逐条复核）：**

| 边 | 契约行号 | 仓库事实 | 结论 |
|---|---|---|---|
| `ChapterPlanGraphPanel` → graph | `:23,24,25` | `:23` GraphShell / `:24` StageNode / `:25` EntityNode | ✅ |
| `MemoryGraphPanel` → graph | `:29,30` | `:29` GraphShell / `:30` EntityNode | ✅ |
| `PipelineGraphPanel` → graph | `:28,29` | `:28` GraphShell / `:29` StageNode | ✅ |
| `QuickPhraseBubble.tsx:17`→`services/ai/quickPhraseService` | L85 | `:17` 属实 | ✅ |
| `TimelineView.tsx:8`→`services/ai/scanService` | L86 | `:8` 属实 | ✅ |
| `EditorPage.tsx:21,22`→hooks | L87-88 | `:21`/`:22` 属实 | ✅ |

---

## 3. 门禁可编码性与 `--without` 区分（复核）

- 规则表（L169-175）为「域 × 禁止前缀」，**可直接编码**；`M2A`/`A2M`/`K2M`/`K2A`/`NO-CROSS-MODULE` 五条。
- **K2M/K2A 分工自洽**（L177）：`components/layout/{LeftSidebar,TrashDialog}.tsx` 入 K2M（manual 域，D16）；`components/ai/**` 与 `layout/` **其余文件**入 K2A（auto 域）；两规则并集 = §1 kernel 禁止集。`pages/` **不在** K2M（D26 ✅）。
- 阈值「违规数与缺失模块数均为 0」**可机械判定**；两方向判据不同（auto 目录允许不存在 + 清单不含 auto 条目），**可区分**。

---

## 4. Findings

### R3-F1（medium）· §6 t5 写范围「其余 20 文件」计数错误（应为 **19**）

- **file**: `docs/architecture/web-workbench-split-contract.md:191`（并见 `:177`）
- **problem**: L191 写「`apps/web/src/components/layout/**`（**仅其余 20 文件**：24 顶层 − 3 kernel 壳 `ProjectLayout`/`PanelSection`/`FloatingBubbles` − 2 t4 文件 `LeftSidebar`/`TrashDialog`）」。**其自述公式 24−3−2 = 19**，与文字「20」矛盾。仓库实测：`components/layout/` **顶层 24 文件**（含 `__tests__` 25），扣除 3 壳 + 2 文件 = **19**（`AIRedstonePanel, AutoWriteWorkbench, BottomDrawer, BubbleRail, ChapterPlanGraphPanel, EntityRail, MemoryAuditPanel, MemoryGraphPanel, PipelineGraphPanel, PipelinePanel, QuickOpen, RightSidebar, SkillLibraryPanel, StatusBar, TabBar, WorkbenchPlan, workspaceDefs, WorkspacePane, WorldStateBoard`）。L177 亦写「其余 20 文件」。该数字是 **t5 写范围** 的边界（D3/D16 单写者纪律依赖它），错 1 会让实现者/门禁对 `layout/` 的 t5 覆盖集判定不一致。
- **requiredFix**: L191 与 L177 的「20 文件」改为 **「19 文件」**（24−3−2=19）；并保留「= 其余全部（19）」的算式以便自证。

### R3-F2（medium）· `services/data/syncService.ts` 设计/契约跨文档冲突（契约=shared，设计=auto）

- **file**: `docs/architecture/web-workbench-split-contract.md:107`（对照 `docs/architecture/web-workbench-split.md:229`）
- **problem**: 契约三处一致判 **shared**（§1 L17 kernel 放行清单、§3.3 L107 共享 data-core、§6 L195 D19-⑤），仓库事实亦支持（唯一消费者为 kernel 壳 `ProjectLayout.tsx:13,560`，无模块消费者）。但**设计文档 §3.3 L229 判 `syncService` 为 auto**，且理由自相矛盾——「仅 `ProjectLayout.tsx:13` 消费 → **随 chatRail 归属 auto**」：`syncService` 由 **kernel 壳**直接消费，与 `chatRail`（auto）无关；按契约/设计共有的「kernel 壳消费者 ⇒ shared」规则应归 **shared**。该冲突直接影响 t5 是否会错误地把 `syncService` 迁入 auto（进而制造 kernel→auto 边）。
- **requiredFix**: 设计文档（t23）把 §3.3 L229 的 `syncService.ts` 由 **auto** 改 **shared**，删除「随 chatRail 归属 auto」的误导表述；或在契约中显式声明「本契约 §1/§3.3/§6 覆盖设计 §3.3，以 shared 为准」。

### R3-F3（low）· §5 A2M 含 `@/pages/`（kernel 域前缀），须澄清是否误植

- **file**: `docs/architecture/web-workbench-split-contract.md:172`
- **problem**: `A2M`（auto 域）禁止前缀含 `@/pages/`。`pages/` 全部属 **kernel 域**（设计 §3.1 L187），D26 亦明确「kernel→pages 非跨域」。把 kernel 域前缀放进 **auto 域**规则，语义上属「auto→kernel 组装禁令」而非「auto→manual」，与 A2M 其余项（manual 组件前缀）不同类。当前不产生假阳性（拆分前 auto 扫描根为空），但分类不清、易被后续误改。
- **requiredFix**: 或从 A2M 移除 `@/pages/`（若要禁 auto 引 kernel，应单列「组装禁令」并说明），或就地补注「`@/pages/` 为 kernel 域，此条意在禁 auto 直引 kernel 页面，非 auto→manual 边」。

---

## 5. 必验项（转 M1 / t7，非契约缺陷）

- **⚠️ M1 必验：删除 `ProjectLayout.tsx:15` 的 `LeftSidebar` 静态 import**。队长指出：门禁把 `components/layout/` **整目录**判 auto，而当前未拆分状态下 `ProjectLayout.tsx` 仍在 `layout/`（⇒ 被判 auto），故 `ProjectLayout.tsx:15 → LeftSidebar` 会被记为 **auto→auto** 而**漏报**；这是**唯一**的 kernel→`LeftSidebar` 静态边。**M1（D4 迁壳 + D21 注入）完成后必须专项复验**：`ProjectLayout.tsx`（迁至 `components/shell/`）不得再出现 `@/components/layout/LeftSidebar`（及 `:23-24,29` 的 `@/components/ai/ChatPanel`）。
- **K2A/K2M 并集覆盖验证**：拆分后须实测「kernel 引任一 `layout/` 文件」均被 K2A 或 K2M 命中（防止 `LeftSidebar/TrashDialog` 与「其余 19 文件」之间出现规则缝隙）。

---

## 6. 验收判据对照

| 验收项 | 结果 |
|---|---|
| 6 节齐备且可执行 | ✅（195 行，6 节） |
| D21/D22/D23 闭环 | **D21 ✅ / D23 ✅ / D22 ⚠️**（计数错，R3-F1） |
| 仓库事实复核 ≥5 归属 + 9 边 | ✅（8 归属 + 11 边） |
| 降级行为具体到组件/交互 | ✅（L42/L50-51/L63-67 均点名组件/按钮/行为） |
| 门禁可编码、区分 `--without manual/auto` | ✅ |
| 未改被评审文档 | ✅（仅新增本报告） |

**最终 verdict：`needs_revision`** —— D21/D22/D23 已实质闭环，仅需：①（R3-F1）t5 写范围 20→**19**；②（R3-F2）对齐设计 §3.3 的 `syncService` 归属；③（R3-F3）澄清 A2M 的 `@/pages/`。修复量小（1 处数字 + 1 处跨文档 + 1 处注）。
