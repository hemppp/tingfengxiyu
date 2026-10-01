# Web 工作台拆分 · 边界契约复审（round 2）

| 项 | 值 |
|---|---|
| 被评审 | `docs/architecture/web-workbench-split-contract.md` |
| 评审快照 | **184 行 / 16,597 字节 / cjk=1358 / SHA256[:16]=`EAA338C58780892A`**（mtime 2026-09-30，含 t16 + t18 修订） |
| 复审轮次 | round 2（承接 t9 的 F1–F12；t18 完成后定稿） |
| 唯一权威 | `.workbuddy/split-workbenches/CAPTAIN-DECISIONS.md`（D1–D19） |
| 方法 | 逐节核对 + **用仓库事实独立复核**（不只看措辞），重点核 F2「kernel 壳消费 shared 子路径」是否已不被自身禁令误伤 |
| **verdict** | **needs_revision** |

## 0. 结论摘要

- **t9 的 F1–F12 全部落地**（逐条见 §2）；**D2–D12 全部落地**（逐条见 §3）；**t16 / t18 的已知待修项全部闭环**（§4）。
- **新增 2 条 medium + 1 条 low**，均围绕同一处此前未被任何裁决覆盖的集成/写范围缺口：**kernel 壳对 manual 的 `LeftSidebar`（「章节」气泡）的静态引用**，以及 **§6 对 `components/layout/` 三分（D16）的写范围未同步**。
- 结论：契约 6 节齐备、大部分可执行；但 §2（扩展点）与 §6（写范围）各有一处**与 D16/实现自洽性冲突**，属「可直接驱动实现」验收项下的阻塞点，故 `needs_revision`。修复量小（§2 一句 + §6 两处），建议并入一次微修复。

---

## 1. 六节完整性与可执行性

| 节 | 齐备 | 可执行性 | 备注 |
|---|---|---|---|
| §1 模块导出入口 | ✅ | ✅ | 单包路径（D1）+ 白名单式 kernel 允许/禁止（F2 已收窄）自洽 |
| §2 kernel 扩展点与降级 | ✅ | ⚠️ | 9 个沿用 + 4 个新增（t16 后为「3 个新扩展点」口径）；**缺 kernel 壳静态 `LeftSidebar` 的注入路径（见 F-2）** |
| §3 归属决策表 | ✅ | ✅ | 11 条跨域边（F1）、store 逐符号（D10）、零入边禁删（D8）均落地 |
| §4 子插件清单 | ✅ | ✅ | manual 8 / auto 5，与 D1 一致 |
| §5 门禁断言规则 | ✅ | ✅ | M2A/A2M/K2M/K2A + NO-CROSS-MODULE；`--without` 对称可区分（§6 核验） |
| §6 写范围划分 | ✅ | ⚠️ | t3 含 core+shell（F8）、package.json→t3（F9）；**t5 的 `layout/**` 未排除 `LeftSidebar/TrashDialog`（D16 判 t4），见 F-1** |

---

## 2. t9 的 F1–F12 逐条核验（仓库事实复核）

| # | t9 原 finding | 契约现状（行号） | 结论 |
|---|---|---|---|
| F1 | §3.2 漏 2 条 manual→auto 边 | L72 标题「11 条跨域边（manual→auto 4 + auto→manual 7）」；L78–79 补 `EditorPage.tsx:21,22` | ✅ 已落地 |
| F2 | §1 kernel 禁止前缀过宽 | L17 改**白名单式**：点名放行 `@/services/data/{databaseService,localUserData,chapterLocalCache,syncService}.ts`、`@/services/editor/{entityDetector,styleService,rhythmService}.ts`；L18 仅禁 `@/services/ai/**` + 组件前缀 | ✅ 已落地 |
| F3 | §2 未写「同步 core」 | L46「**同步 core（t3，D2）**」段（`plugin-context.ts:390-419` + `manifest.ts:61-72`/`:149`） | ✅ 已落地 |
| F4 | 能力名缺单一来源 | L46「`CapabilityName` 取自 core 常量 `WEB_CAPABILITIES`——唯一来源」；L50–58 只引用 | ✅ 已落地 |
| F5 | `<WorkbenchMissing/>` 归属未定 | L41「由 **t3 在 `apps/web/src/components/shell/` 下创建**」 | ✅ 已落地 |
| F6 | §3.1 `useStatsStore`→manual | L66 入 shared；L69 D10 规则 + `SettingsPage.tsx:2,36-37` 证据 | ✅ 已落地 |
| F7 | §3.3「删除」与 D8 冲突 | L105 表头「**本次重构不删除任何文件（D8）**」；各行改「迁移（指定落点）/保留（`@deprecated`）」 | ✅ 已落地 |
| F8 | §6 t3 写范围缺 core 与 shell | L178 t3 含 `apps/web/src/components/shell`、`packages/core/src/{plugin-context,manifest}.ts` | ✅ 已落地 |
| F9 | §6 `package.json`→t4 与 D3 冲突 | L178/L182 `package.json` → **t3 独占** | ✅ 已落地 |
| F10 | 白名单子路径语义 | L15/L170「**包名前缀匹配即可**（含子路径）」 | ✅ 已落地 |
| F11 | `chapterLocalCache`→manual 造 shared→manual 边 | L98/L103/L120 `chapterLocalCache`→shared；`rhythmService`→shared（D19-②） | ✅ 已落地 |
| F12 | 行号偏差 | L54–55 `QuickPhraseBubble.tsx:194`（调用点）/`:275-278`（按钮）；L55 `TimelineView.tsx:248-253` | ✅ 已落地 |

> 仓库复核：`QuickPhraseBubble.tsx:194` = `await generateQuickPhrases(content, characters)`、`:275-278` = 「AI提取」按钮；`TimelineView.tsx:248-253` = `onClick={handleExtract}` 提取按钮 —— 与契约标注**一致**。

---

## 3. D2–D12 在契约中的落地核验

| 裁决 | 契约落点 | 结论 |
|---|---|---|
| D2 最小 core 扩展 | L46 | ✅ |
| D3 单写者 | L178–182（`package.json`→t3、`stores/index.ts`→t4、`plugin/{registry,host,types}.ts`→t3） | ✅ |
| D4 kernel 壳迁 `shell/` | L41（`WorkbenchMissing` 落 shell）、L178（t3 含 shell）、L180（t5 注明三壳已移出） | ⚠️ **部分**：§6 t5 的 `layout/**` 未排除 `LeftSidebar/TrashDialog`（D16 判 t4）→ F-1 |
| D5 `AIConfigPanel/LocalModelPanel`→auto | L30、L101 | ✅ |
| D7 F1/F2 保留→kernel | L122–123（`encryptionService`、`credentials`） | ✅ |
| D8 禁删除 | L105 | ✅ |
| D9 11 条边 | L72–82 | ✅ |
| D10 逐符号判定 | L69 | ✅ |
| D11 `cascadeCleanChapterClient`→shared | L66/L69 | ✅ |
| D12 `outlineNotepadStore`→shared | L98 | ✅ |

---

## 4. 已知待修项闭环核验

| 项 | 证据（现行契约） | 结论 |
|---|---|---|
| **t16**（`registerChatPanel`≠`registerChatRail`） | L35「**仅管编辑器内 AI 气泡栏，与「AI 对话」浮窗面板无关**」；L42 独立槽位；L46「**3 个**新扩展点」；L48「两个独立扩展点，**不可合并**」；L60「两个独立槽位」。全文「唯一入口」命中 **0** | ✅ 闭环，**F-D5 不成立** |
| **D18**（M2A 移除三条 `@/hooks/*` 前缀） | L162 M2A 禁止前缀**已无** `@/hooks/`（全文 `@/hooks/` 命中 0）；L168 新增说明块（三 hook 属 manual 自有、跨域边在 hook 内部 `→ @/services/ai/*`，由 `@/services/ai/` 前缀捕获） | ✅ 闭环 |
| **D19-⑤**（§6 t4 写范围收窄） | L179 t4 由整目录收窄为 `services/data/exportService.ts` + `services/misc/{consistencyService,projectExportService}.ts`；L184 新增「t4 写范围外 `services/**` 归属」注 | ✅ 闭环 |
| **D19-②**（`rhythmService`→shared） | L98、L120、L184 | ✅ 闭环 |

---

## 5. 仓库事实独立复核（≥5 条归属决策 + 9 条跨域边）

**归属决策（抽查 8 条，全部属实）：**

| 决策 | 契约裁决 | 仓库事实 | 结论 |
|---|---|---|---|
| `utils/credentials.ts` | kernel（保留） | `pages/LoginPage.tsx:9` 多行 import | ✅ |
| `services/security/encryptionService.ts` | kernel（保留） | `pages/SettingsPage.tsx:19` | ✅ |
| `services/data/syncService.ts` | shared（kernel 放行） | 唯一消费者 `components/layout/ProjectLayout.tsx:13`（kernel 壳） | ✅ |
| `services/data/exportService.ts` | manual | 唯一消费者 `components/export/ExportDialog.tsx:4` | ✅ |
| `services/security/securityService.ts` | auto | 唯一消费者 `components/ai/ChatPanel.tsx:14` | ✅ |
| `stores/outlineNotepadStore.ts` | shared | `ChatPanel.tsx:6`（auto）直接 import → 归 manual 会成 auto→manual 边 | ✅ |
| `cascadeCleanChapterClient` | shared（D11） | `LeftSidebar.tsx:3`（auto）+ `useEditorInstance.ts:13`（manual） | ✅ |
| `stores/useStatsStore` | shared（D7） | `SettingsPage.tsx:2`（kernel） | ✅ |

**跨域边（11 条，行号逐条复核，全部属实）：**

| 边 | 仓库事实 |
|---|---|
| `QuickPhraseBubble.tsx:17` → `services/ai/quickPhraseService` | ✅（import 行） |
| `TimelineView.tsx:8` → `services/ai/scanService` | ✅ |
| `EditorPage.tsx:21` → `hooks/useAutoEntityDetection` | ✅ |
| `EditorPage.tsx:22` → `hooks/useLatestChapterPolling` | ✅ |
| `layout/ChapterPlanGraphPanel.tsx:23,24,25` → `knowledge/graph/*` | ✅ |
| `layout/MemoryGraphPanel.tsx:29,30` → 同上 | ✅ |
| `layout/PipelineGraphPanel.tsx:28,29` → 同上 | ✅ |
| （auto→manual 7 条）`knowledge/graph/*` | ✅（`components/knowledge/graph/` 下 7 文件，一次下沉即断） |

> 三 hook 的归属（D18）：`useAutoEntityDetection`/`useLatestChapterPolling` 唯一消费者为 `EditorPage.tsx:21,22`（manual）→ 归 manual；其 `→ @/services/ai/*`（`:16`/`:25`）为跨域边，由 M2A 的 `@/services/ai/` 前缀捕获，契约 L168 口径正确。

---

## 6. 门禁规则可编码性与 `--without` 区分

- 规则表（L160–166）为「域 × 禁止前缀」，**可直接编码**：域 = 扫描根文件所属（`apps/web/src`→kernel、模块目录→manual/auto），前缀 = 字符串匹配，命中打印 `file:line`（L158）。
- `--without auto`（L172）：auto 目录允许不存在、manual+kernel 0 违规、`main.tsx` 清单不含 auto 条目；`--without manual` 对称 —— **两条路径判据不同**，可区分。
- 阈值：违规数与缺失模块数均为 0 才通过（非 0 退出码失败）——**可机械判定**。
- 与队长预言机（D18 修正后：违规 31 / 缺失 2 / exit 1）**口径相容**（captain 已说明：唯一共同判据 = 拆分后全为 0）。

---

## 7. Findings

### F-1（medium）· §6 t5 的 `components/layout/**` 未排除 `LeftSidebar.tsx`/`TrashDialog.tsx`，与 D16 冲突

- **file**: `docs/architecture/web-workbench-split-contract.md:180`（并涉及 `:179`）
- **problem**: L180 t5 写范围含「`apps/web/src/components/layout/**`（**仅其余文件**：kernel 壳 `ProjectLayout`/`PanelSection`/`FloatingBubbles` 已按 D4 移出）」——只排除了 3 个 kernel 壳，**未排除** D16 明确判给 **t4（manual）** 的 `LeftSidebar.tsx`、`TrashDialog.tsx`。按字面，t5 会主张对这两个文件的写权，而 L179 t4 又未列入它们 → **t4/t5 在 `layout/` 上重叠**，违反 D3/D16 单写者纪律（项目无 git，冲突即可能丢改动）。
- **requiredFix**: §6 t4 增列 `apps/web/src/components/layout/{LeftSidebar,TrashDialog}.tsx`；§6 t5 的 `components/layout/**` 改为「**其余 20 文件**（不含 `LeftSidebar`/`TrashDialog`）」，与 D16 三分表一致。

### F-2（medium）· §2 未给出 kernel 壳静态 `LeftSidebar`（「章节」气泡）的注入路径

- **file**: `docs/architecture/web-workbench-split-contract.md:41-44`（§2 新增扩展点表）
- **problem**: `ProjectLayout.tsx:15,529` 把 `LeftSidebar` **静态 import** 并硬编码为 `chapterBubbleDef`（`Component: LeftSidebar`）——与 `ChatPanel` 之于 `chatBubbleDef`（L42）**完全对称**。契约对 auto 侧 `ChatPanel` 明确要求「**必须**经 `registerChatPanel` 注入以消除 kernel→auto 静态依赖」，但对 manual 侧 `LeftSidebar` **未给任何消除方式**：§2 新增扩展点只有 `registerWorkbench`（管整模式工作台）/`registerChatPanel`/`registerCapability`，既有 `registerProjectPanel`（L27）的降级是「面板不出现」（语义是「未注册则无」，而非「kernel 从注册表取组件」）。故按 §2 字面，t3 迁移后 kernel 壳仍 `import '@/components/layout/LeftSidebar'` → 命中自身 `K2M` 前缀（L164）→ 与 §1 自洽性冲突，且 `--without manual` 时 kernel 编译失败，**违反「manual 关闭后 kernel/auto 仍可用」**。
- **requiredFix**: 在 §2 明确 `LeftSidebar`（`chapters` 气泡）的消除路径——或扩展 `registerProjectPanel` 语义使其支持「kernel 由注册表取该气泡组件」，或新增与 `registerChatPanel` 对称的注册点；并在 §5 `K2M` 对该 kernel 集成边给出与 §1 自洽的口径。

### F-3（low）· §3.3 表头「47 个 shared/other」与枚举数不符

- **file**: `docs/architecture/web-workbench-split-contract.md:95`
- **problem**: 表头写「47 个 shared/other 逐条裁决」，但 L97–101 实际枚举 **41 项**（kernel 9 + data-core 16 + ui-kit 5 + manual 8 + auto 3）。计数不一致（差 6），易误导实现者以为有遗漏项；各项裁决本身经复核**均正确**。
- **requiredFix**: 将表头计数改为与枚举一致的数目，或补齐遗漏的 6 项并说明来源。

---

## 8. 非阻断观察（不构成 finding）

1. **与 F-2 同源**：设计文档 §3.8 L435-436 论证「若 `LeftSidebar` 判给 auto 则 kernel→auto 边，故必须归 manual」——方向存疑：归 manual 同样产生 **kernel→manual** 边，除非 kernel 经扩展点访问。建议 t17（设计残余）与 F-2 一并给出统一的 kernel↔`LeftSidebar` 集成口径。
2. §1 L17 kernel 允许清单点名到具体 `services` 文件，未点名 `@/services/api/**`、`@/services/auth/sessionKeepalive`；因 §5 白名单按目录放行 `@/services/data/**`、`@/services/editor/**`，其余 `services` 由「未列入白名单」隐含禁止 —— **自洽，非问题**。
3. §3.2「11 条」与设计 §4 一致；与预言机「import 语句计数」的差异（31）已由 captain 说明（唯一共同判据 = 拆分后为 0），**非问题**。

---

## 9. 验收判据对照

| 验收项 | 结果 |
|---|---|
| 6 节齐备且可执行 | **部分**：6 节齐备；§2/§6 各有一处阻塞（F-1/F-2） |
| 仓库事实独立复核 ≥5 条归属 + 9 条跨域边 | ✅ 完成（8 条归属 + 11 条边） |
| 降级行为具体到组件与交互 | ✅ L54–58、L41–42 均点名组件/按钮/行为，无空话 |
| 门禁规则可直接编码、区分 `--without manual/auto` | ✅ |

**最终 verdict：`needs_revision`**（F-1/F-2 medium 阻断实现；F-3 low）。t9 的 F1–F12 与 D2–D12 及 t16/t18 已知项**均已闭环**，无需回炉；本次残留为**两处新发现**，修复量小。
