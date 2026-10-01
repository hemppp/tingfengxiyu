# 跨文档一致性对账 · 设计文档 × 契约文档（t11 / round 2）

- **对账对象 A**：`docs/architecture/web-workbench-split.md`（设计文档，t10 修订后，**742 行 / 53004 字符**）
- **对账对象 B**：`docs/architecture/web-workbench-split-contract.md`（契约文档，t14 修订后，6 节 / 1223 中文字符）
- **权威顺序**：`CAPTAIN-DECISIONS.md`（**D1–D24**，唯一权威）> 契约文档 > 设计文档。
- **产出**：本报告 + `.workbuddy/split-workbenches/ownership-final.json`（216 条，机器可读）。
- **未改动**：设计文档、契约文档、任何业务代码。仅新增上述两文件。
- **判定口径**：`PASS` = 两份文档在同一事实上表述一致且与裁决一致；`FAIL` = 冲突或与裁决不一致。**唯一登记项**（`registerChatPanel` 与 `registerChatRail` 的合并语义，§2-⑥）按队长指示记为「设计文档待修、契约侧已正确」，**不判 FAIL**。
- **⚠️ 时点与后续更新（t21 回填）**：本报告是 **t11 时点快照**；其后队长下达 D17–D24，其中 **D19-② 已裁 `services/editor/rhythmService.ts` → `shared`**（推翻本报告 §2-② 当时的「契约优先→manual」结论，以 **shared** 为准），**D21** 把新增扩展点 `registerChatPanel` 泛化为 **`registerBuiltinBubble`**（按 `def.key` 键控多槽）。**凡本报告结论与现行 CAPTAIN-DECISIONS（D1–D24）冲突者，一律以裁决为准。**

---

## 1. 六维一致性对账

| # | 维度 | 设计文档（A） | 契约文档（B） | 一致？ | 以谁为准 |
|---|---|---|---|---|---|
| ① | **模块路径/包名** | `apps/plugins/{manual,auto}/workbench/`、`@novel-plugins/{manual-workbench,auto-workbench}`（A §2 L125-131、§3.10 L391-431） | 同（B §1 L9-13） | ✅ 一致 | — |
| ② | **store 与文件归属** | A §3.2-§3.7、§3.4 L252-256（逐符号规则）、§3.4.1 L258-273 | B §3.1-§3.3 L64-127 | ⚠️ 2 处不一致 | 契约（B）为准（见 §2-①、§2-②） |
| ③ | **跨域边清单** | **11 条**（4 manual→auto + 7 auto→manual）A §1.2 L64-86、§4 L447-457 | **11 条**（4+7）B §3.2 L72-84 | ✅ 一致 | — |
| ④ | **kernel 禁止前缀** | A §6.3 L586-599（kernel 侧含 `@/components/layout/AutoWriteWorkbench`；白名单写 `@novel-plugins/shared/*`） | B §5 L164-168（`K2A` 含 `@/components/{ai,layout}/`；白名单写三个具体包名） | ⚠️ 2 处不一致 | 契约（B）为准（见 §2-③、§2-④） |
| ⑤ | **门禁扫描根** | 三条精确根（A §6.3 L581-584、§7 M0 L635） | 同三条（B §5 L158） | ✅ 一致 | — |
| ⑥ | **写范围** | A §7 M1/M2/M3 L639-675 | B §6 L172-178 | ⚠️ 1 处不一致 | 契约（B）+ D3/D16（见 §2-⑤） |

**小结**：6 维中 3 维完全一致（①模块路径/包名、③跨域边、⑤扫描根），3 维（②store/文件归属、④kernel 禁止前缀、⑥写范围）存在共 **5 处**不一致，均已在 §2 给出以谁为准与应改文本。另登记 1 处**不判 FAIL** 的同步项（§2-6）。设计文档 4 处待修、契约文档 1 处待修。

---

## 2. 不一致明细（以权威为准 + 应改文本）

### ① `components/layout/RightSidebar.tsx` 归属冲突 —— **以契约为准**
- **A**（设计 §3.7 L330）：`RightSidebar.tsx | 36 | 迁移 → auto（保留） | A | 0 入边，纯容器`。
- **B**（契约 §3.3 L113）：`layout/RightSidebar.tsx | 迁移→共享(ui-kit)`。
- **裁决依据**：无 D 直接覆盖；权威顺序 ⇒ 契约 > 设计文档。且 `RightSidebar` 为「纯容器、0 入边」，下沉 ui-kit（模式无关共享包）可确保两侧都可用、不产生模块间边。
- **应改文本（A §3.7 该行）**：`| components/layout/RightSidebar.tsx | 36 | 迁移 → shared（ui-kit） | A | 0 入边，纯容器；下沉 ui-kit 避免 kernel 侧歧义；删除另行立项 |`
- **同步**：`ownership-final.json` 中该文件 domain = `shared`（已按契约落盘）。

### ② `services/editor/rhythmService.ts` 归属冲突 —— **以契约为准**
- **A**（设计 §3.7 L343）：`services/editor/rhythmService.ts | 147 | 迁移 → shared（保留）`。
- **B**（契约 §3.3 L120）：`services/editor/rhythmService.ts | 迁移→manual，标 @deprecated`。
- **裁决依据**：无 D 直接覆盖；契约 > 设计。`rhythmService` 为写作节奏服务、0 入边，契约判 manual（随手写台）。
- **应改文本（A §3.7 该行）**：`| services/editor/rhythmService.ts | 147 | 迁移 → manual（保留，标 @deprecated） | A | 0 入边；随手写台迁移；删除另行立项 |`
- **同步**：`ownership-final.json` 中 domain = `manual`（已按契约落盘）。
- **备注（提请队长确认）**：设计原判 shared、契约判 manual，二者均无 D 背书。本条以契约优先，但**建议队长补一条 D 固化**（因 `services/editor/` 其余文件 `entityDetector`/`styleService` 均为 shared，`rhythmService` 单列 manual 会形成「同目录跨域」的细微语义不一致）。
- **⚠️ 后续更新（D19-② 覆盖本条）**：队长已下达 **D19-②**，裁决 `services/editor/rhythmService.ts` → **`shared`**（与同目录 `entityDetector`/`styleService` 一致，保持 `services/editor/` 语义单一），**推翻本条「契约优先→manual」的结论**。**以 shared 为准**；`ownership-final.json` 已按 D19-② 回填为 `shared`（t21）。

### ③ kernel 禁止前缀范围 —— **以契约为准**
- **A**（设计 §6.3 L591-593）：`--without auto` 时 kernel 侧禁 `@/components/layout/AutoWriteWorkbench`（**仅该文件**）。
- **B**（契约 §5 L165）：`K2A` kernel 禁 `@/components/{ai,layout}/`（**整目录**）。
- **裁决依据**：D4 —— `components/layout/` 迁移后**整体归 auto**，故 kernel 不得 import 其中任何文件。契约的「整目录」禁令与 D4 自洽；设计文档的「单文件」禁令偏窄。
- **应改文本（A §6.3 断言 A 第一项）**：将 `@/components/layout/AutoWriteWorkbench` 改为 `@/components/layout/`（整目录）。

### ④ kernel 白名单写法 —— **以契约为准**
- **A**（设计 §6.3 L598-599）：白名单写 `@novel-plugins/shared/*` —— **该包名不存在**（实际共享包为 `ui-graph`/`ui-kit`/`data-core`，无名为 `shared` 的包）。
- **B**（契约 §5 L168）：`@novel/core`、`@novel/core/web`、`@novel/shared`、`@novel-plugins/ui-graph`、`@novel-plugins/ui-kit`、`@novel-plugins/data-core`（前缀匹配）。
- **裁决依据**：D1 冻结的共享包名是 `@novel-plugins/{ui-graph,ui-kit,data-core}`，不存在 `@novel-plugins/shared`。契约正确。
- **应改文本（A §6.3 例外白名单行）**：`@novel-plugins/shared/*` → `@novel-plugins/{ui-graph,ui-kit,data-core}`（前缀匹配即可，含子路径）。

### ⑤ 契约 §6 写范围与 §3 归属表冲突 —— **以归属表（D11/D12）+ D3 为准，契约待修**
- **B**（契约 §6 L175）：t4（manual）可改路径含 `apps/web/src/services/{data,misc,security}/**`（**整目录**）。
- **冲突点**：按契约 §3.3 与设计 §3.3，`services/data/{databaseService,localUserData,chapterLocalCache,syncService}`→**shared**、`services/security/securityService`→**auto**、`services/security/encryptionService`→**kernel**。t4 若持整目录，会越权改 shared/auto/kernel 文件，违反 D3「单写者」。
- **裁决依据**：D3（单写者）+ D11/D12（shared 归属）。
- **应改文本（B §6 该行）**：t4 的 `apps/web/src/services/{data,misc,security}/**` → 收窄为明确文件集：`apps/web/src/services/data/exportService.ts`、`apps/web/src/services/misc/{consistencyService,projectExportService}.ts`；其余（`data/{databaseService,localUserData,chapterLocalCache,syncService}`、`security/{securityService,encryptionService}`）分别归 **t3/shared** 与 **t5/auto**、**t3/kernel**。
- **备注**：本项属契约内部（§6 与 §3）自洽性问题，非设计×契约冲突；已在 §3 的 D3 检查中标注为「契约待修」。

### ⑥ `registerChatPanel` vs `registerChatRail` —— **以契约（B）为准；设计文档（A）跟随已撤回的 D5，应改**
- **契约（B）现状（已由 t16 修正，正确）**：L46 写「**3 个**新扩展点（`registerWorkbench`、`registerChatPanel`、`registerCapability`+`getCapability`）」；L48 明确「`registerChatRail` 与 `registerChatPanel` 是**两个独立扩展点，不可合并**」。与队长 **D5 更正**（`CAPTAIN-DECISIONS.md` L167-180）一致。
- **设计文档（A）现状（错误）**：§5.5 L502-505 写「`registerChatPanel` 收敛进既有 `chatRail`，不再单独新增」；§5.2 L477 亦写「按 §5.5 收敛进既有 `chatRail`，不再单独新增」；§4 C1 L454 写「经既有 `registerChatRail` 承载（不再新增 `chatPanel` 单槽）」——**三处均跟随已被队长撤回的 D5**。
- **裁决依据**：D5 撤回说明 —— `chatRail`=编辑器内 AI 气泡栏（有内置兜底 `AiChatBubbleRail`，`registry.ts:41-42,218-227`、`ProjectLayout.tsx:391`）；`chatPanel`=「AI 对话」浮窗（`ProjectLayout.tsx:531-533` 的 `chatBubbleDef`，kernel 现**静态 import** `ChatPanel`，即 C1 边）→ **`registerChatPanel` 必须新增**，否则 C1 边无法消解。
- **应改文本（A §5.5 标题与正文）**：改为「`registerChatPanel` 为**独立新增扩展点**（**不可**并入 `chatRail`）：`chatRail` 管编辑器内 AI 气泡栏（内置兜底 `AiChatBubbleRail`）；`chatPanel` 管「AI 对话」浮窗，`ChatPanel` 经此注入以消除 C1（kernel→auto 静态 import）边。真正新增的契约是 **3 个**：`registerWorkbench`、`registerChatPanel`、`registerCapability`/`getCapability`。」
- **应改文本（A §5.2 注 L477）**：删除「按 §5.5 收敛进既有 `chatRail`，不再单独新增」，改为「与 `registerWorkbench` 同批在 `registry.ts` 各增一个单槽」。
- **应改文本（A §4 C1 L454）**：`ChatPanel` 组件本体经**新增的 `registerChatPanel`**（而非既有 `registerChatRail`）注入。
- **判定**：契约侧 **PASS**（t16 已修）；设计文档侧 **应改**（本条为**设计文档待修**，非契约残留）。**不判 FAIL**（属队长 D5 更正的下游同步，非两文档各自独立缺陷）。

---

## 3. 队长裁决落地检查（逐条 PASS/FAIL）

| 裁决 | 检查点 | 设计文档（A） | 契约文档（B） | 判定 |
|---|---|---|---|---|
| **D1** 单包冻结 | 模块路径 = `apps/plugins/{manual,auto}/workbench/`，包名 `@novel-plugins/{manual-workbench,auto-workbench}`，modes 单一 | A §2 L123-128、§3.10 L399-431 ✅ | B §1 L9-10、§4 L131-152 ✅ | **PASS** |
| **D3** 单写者 | `package.json`→t3；`stores/index.ts`→t4；`plugin/{registry,host,types}.ts`→t3；`pnpm-workspace.yaml`+门禁脚本→t3 | A §3.4.1 L276-283（壳=t4）、§7 M1 L642 ✅ | B §6 L177「独占裁决」✅ | **PASS**（含 §2-⑤ 契约待修项） |
| **D4** kernel 壳迁出 | `ProjectLayout`/`PanelSection`/`FloatingBubbles` → `components/shell/`；`layout/` 其余全归 auto | A §3.8 L356-378、§3.10 L397 ✅ | B §5 L165（K2A 整目录）、§6 L176（t3 含 `components/shell/**`）✅ | **PASS**（含 §2-③ 待修项） |
| **D5** AIConfigPanel/LocalModelPanel→auto，经既有 `registerSettingsSection` | 两文件归 auto；不新增契约；auto 缺失则该区块消失 | A §3.9 L384 ✅ | B §2 L30 ✅ | **PASS**（`registerChatPanel` 残留另计，见 §2-⑥） |
| **D7** F1/F2/F4 处置 | `credentials.ts`→kernel 保留；`encryptionService.ts`→kernel 保留；`useStatsStore`→shared | A §3.6 L307、§3.7 L346-347、§3.4.1 L262 ✅ | B §3.3 L122-123、§3.1 L66 ✅ | **PASS** |
| **D8** 本次不删除 | 零入边一律「迁移或保留」，删除留待独立任务（三项前置） | A §3.7 L313-316、L351-353 ✅ | B §3.3 L105、L127 ✅ | **PASS** |
| **D9** 跨域边 11 条 | manual→auto 4（含 `EditorPage.tsx:21,22`）+ auto→manual 7 = 11 | A §1.2 L64-86、§4 L447-456 ✅ | B §3.2 L72-84 ✅ | **PASS** |
| **D10** 逐符号判定 store 归属 | 任一 kernel 壳（`App.tsx`/`pages/**`）消费者 ⇒ shared | A §3.4 L252-256 ✅ | B §3.1 L69 ✅ | **PASS** |
| **D11** `cascadeCleanChapterClient`→shared | 跨域双消费（manual `useEditorInstance.ts:13,158` + auto `LeftSidebar.tsx:3,417`） | A §3.4.1 L262 ✅ | B §3.1 L66、L69 ✅ | **PASS** |
| **D12** `outlineNotepadStore`→shared | 跨域（manual `OutlineManager.tsx:31` + auto `ChatPanel.tsx:6`/`OutlineFillDialog.tsx:17`） | A §3.4 L249 ✅ | B §3.3 L98 ✅ | **PASS** |

**结论：D1/D3/D4/D5/D7/D8/D9/D10/D11/D12 共 10 条，10 PASS / 0 FAIL。**
（另：D2/D6/D13/D16 与 D11/D12 的一致性已在本表与 §2 覆盖；D13.4 的 `registerChatPanel` 合并句为**已撤回**内容，登记于 §2-⑥，不判 FAIL。）

---

## 4. 归属清单（`ownership-final.json`）

- **路径**：`.workbuddy/split-workbenches/ownership-final.json`；`scanRoot = apps/web/src`。
- **规模**：**216** 条，覆盖 `apps/web/src` 下**全部文件**（含 `__tests__`、`*.css`、`*.d.ts`）。
- **字段**：每条 `{ path, domain, evidence }`，`domain ∈ {kernel, manual, auto, shared}`；`evidence` = D 编号或证据行号（如 `D4；设计文档 §3.8`、`F2/D7（保留，SettingsPage.tsx:14-19）`）。
- **分布**：`kernel 48 / manual 63 / auto 52 / shared 53`（t21 已把 `services/editor/rhythmService.ts` 由 manual 改 shared，故 manual 64→63、shared 52→53；R4-F1 修正）。
- **消费方式（供 t3 门禁脚本）**：`JSON.parse(...).files` 为数组；`domain` 直接对应门禁规则的适用域；`path` 为工作区相对 POSIX 路径。
- **注意**：`stores/index.ts` 为**过渡兼容壳**（domain=`shared`，D3/t4 独占，M5 移除）；`components/layout/{ProjectLayout,PanelSection,FloatingBubbles}.tsx` 的 domain=`kernel`（D4，目标落点 `components/shell/`，`evidence` 已注明）。

---

## 5. 对账结论

- **可进入 t3 实现**：模块路径/包名（D1）、跨域边 11 条（D9）、扫描根（⑤）、store 归属（D7/D10/D11/D12）在两份文档中**完全一致**，可直接作为实现依据。
- **需先行修正的 5 处**（不阻塞 t3 主体，但建议实现前闭环）：设计文档 4 处（§2-①②③④，均为契约优先）、契约文档 1 处（§2-⑤ 写范围收窄）。
- **登记不判 FAIL 的 1 处**：`registerChatPanel` 与 `registerChatRail` 的合并语义（§2-⑥）——**契约侧（t16 修订后）已正确**（两个独立扩展点），**设计文档侧仍跟随已撤回的 D5，应改**（§5.5/§5.2/§4 C1 三处）。
- **零业务代码改动**：本任务仅新增本报告与 `ownership-final.json`，未触碰 `apps/**`、`packages/**`、`scripts/**`、设计文档、契约文档。
- **⚠️ 后续更新（t21 回填，权威范围 D1–D24）**：① 本报告 §2-② 的 `rhythmService` 结论已被 **D19-② 覆盖为 shared**；② §2-⑥ 的 `registerChatPanel` 独立槽位结论已被 **D21 泛化为 `registerBuiltinBubble`**（按 `def.key` 键控多槽：manual `chapters`→`LeftSidebar`、auto `ai-chat`→`ChatPanel`）；③ §2-① 的 `RightSidebar→shared(ui-kit)` 已由 **D19-①** 固化。凡与现行 CAPTAIN-DECISIONS 冲突处，以裁决为准。
