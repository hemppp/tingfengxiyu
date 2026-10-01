# 评审报告 · Web 工作台插件式拆分设计（t2 / round 1）

- **被评审对象**：`docs/architecture/web-workbench-split.md`（613 行 / 54 KB，00:21 落盘）
- **评审员**：reviewer（质量门）
- **评审日期**：本会话
- **评审快照**：`docs/architecture/web-workbench-split.md`，评审时实测 **613 行 / 54,070 字节**（`Get-ChildItem` + `read` 实测；t1 输出自报「624 行 / 41093 字符」与快照略有出入，architect 可能已再修订——以本报告评审的 613 行快照为准）。
- **评审依据**：`docs/architecture/web-workbench-split.md`（设计文档，权威来源）、`.workbuddy/split-workbenches/{BASELINE.md,COUPLING-TRUTH-TABLE.md,tools/*}`（队长脚本产物，只读）、队长裁决 `CAPTAIN-DECISIONS.md`（D1–D6 + 门禁扫描根）、`docs/architecture/web-workbench-split-contract.md`（契约，用于判定设计文档偏差）、以及**独立复扫**（未复用队长/架构师的脚本结论）。
- **未修改任何被评审文档**：本报告只读 `docs/architecture/web-workbench-split.md`；仅新增本报告文件。
- **独立复现**：`pnpm --filter @novel/web test` → **14 文件 / 182 用例全绿（3.95s）**，与基线一致（证据见 §4）。

## 结论（verdict）

**needs_revision**。

设计文档骨架完整、证据密度高、多数裁决可独立复现（见 §4「已独立验证为正确」）。但存在 **3 条 high** 缺陷必须在进入实现前修正：

1. §3.7 把 `utils/credentials.ts` 与 `services/security/encryptionService.ts` 判为「删除候选」，**两者都有活跃静态导入方**（`pages/LoginPage.tsx`、`pages/SettingsPage.tsx`）——照此删除会导致 type-check 失败、`LoginPage.test`/`SettingsPage` 编译中断。
2. §5.2 新增 4 个 Web 扩展点，**遗漏「同步扩展 `packages/core` 契约」**（`WebPluginContext` + `WEB_SERVICES`），照此实现新扩展点在运行时会被 `plugin.json` 校验拒绝、且 `ctx.registerWorkbench` 在类型上不存在（与队长补充说明一致，已独立复核确认）。
3. §3.4.1 把 `useStatsStore` 判给 manual，但 **kernel 的 `pages/SettingsPage.tsx` 直接消费它**（`:2,:36-37`）——这会在拆分后新增一条 kernel→manual 边，移除 manual 时设置页编译失败，违反「另一模块仍可用」。

另有 1 条 medium 关于 §6.3 断言 A 的**扫描根过宽**（会扫到不应扫描的目录）、1 条 medium 关于 §6.3 断言 D **不可编码**（应降级为「无法判定」，与文档 §5.3 自认「未核实」一致）、以及若干 medium/low 一致性缺口。逐条见 §2；队长点名复核的 5 处逐条回答见 §3。

> 说明：队长 D1 已裁决模块包路径为 `apps/plugins/{manual,auto}/workbench/`，设计文档 §3.10/§7 写的 `apps/plugins/auto/{autowrite,ai-chat,ai-graphs}/`、`apps/plugins/manual/knowledge/` 属**已裁决偏差**（architect 已被告知修订）。按队长指示，此项**不计入 needs_revision 的理由**，仅列为 F9（低，对齐项）。

---

## 1. 评审方法与范围

- **静态复扫**：对 `apps/web/src`（含 `__tests__`）用 ripgrep 独立复扫（未复用 `.workbuddy` 脚本结论），重点：
  - 零入边/删除候选文件的**入边**（含 `__tests__` 与字符串/动态引用 `lazy(() => import(...))`、`key:` 注册、`projectExportService.ts:424` 类注释引用）。
  - `fetch('/api...')` / `import.meta.env.VITE_API_BASE_URL` 字面量全量清点（对照 §5.4 的 7 处）。
  - 注册 API 与 `WEB_SERVICES` 白名单的**一致性**。
- **基线复现**：本地跑 `pnpm --filter @novel/web test`（182/182）。
- **契约对照**：`packages/core/src/{manifest.ts,plugin-context.ts}`、`apps/web/src/plugin/{registry.ts,host.ts,types.ts}`、`apps/web/src/main.tsx`。
- **未做**：`pnpm --filter @novel/web build`（L4）与 L5 运行（属实现/验证阶段 t6/t7），本报告不据此下结论。

---

## 2. Findings（结构完整：id / severity / problem / requiredFix / 证据）

### F1 · §3.7 删除候选误判：`utils/credentials.ts` 有活跃导入方 — **high**
- **file**：`docs/architecture/web-workbench-split.md:280,313`
- **problem**：§3.7（`:313`）判 `utils/credentials.ts`「**零入边**，删除候选」；§3.6（`:280`）同判。独立复扫证明**存在活跃静态导入**：`apps/web/src/pages/LoginPage.tsx:9` `import { getCredentials, saveCredentials, clearCredentials } from '@/utils/credentials';`，用法 `:42-45`（`getCredentials()` 预填用户名）、并调用 `saveCredentials`/`clearCredentials`。文件确为 live code（105 行，C4 收尾仍在用）。文档的「零入边」结论错误。
- **requiredFix**：把 `utils/credentials.ts` 从「删除候选」改为 **保留**，归属 kernel（`pages/` 为 kernel，`LoginPage` 是 kernel 页面），落点建议 `apps/web/src/utils/credentials.ts` 或 ui-kit。删除前必须重跑 L2/L3。
- **evidence**：`apps/web/src/pages/LoginPage.tsx:9,42-45`；独立 grep `credentials` → 命中 `LoginPage.tsx`。

### F2 · §3.7 删除候选误判：`services/security/encryptionService.ts` 有活跃导入方 — **high**
- **file**：`docs/architecture/web-workbench-split.md:212,312`
- **problem**：§3.7（`:312`）判 `encryptionService.ts`「**零入边**，删除候选」；§3.3（`:212`）同判。独立复扫证明**存在活跃静态导入**：`apps/web/src/pages/SettingsPage.tsx:14-19` `import { saveEncrypted, loadEncrypted, deleteEncrypted, listEncryptedKeys } from '@/services/security/encryptionService';`（「安全」设置分类在用）。文档「零入边」结论错误。
- **requiredFix**：从「删除候选」改为 **保留**；归属 kernel（`SettingsPage` 为 kernel）。同 F1，删除前必须重跑基线。
- **evidence**：`apps/web/src/pages/SettingsPage.tsx:14-19`。

### F3 · §5.2 新增扩展点遗漏「同步扩展 `packages/core` 契约」 — **high**
- **file**：`docs/architecture/web-workbench-split.md:404-420,596-606`
- **problem**：§5.2 定义 4 个新扩展点（`registerWorkbench`/`registerChatPanel`/`registerCapability`/`getCapability`），但设计文档**全文未要求同步修改 `packages/core`**：`WebPluginContext`（`packages/core/src/plugin-context.ts:390-419`）无这些方法；`WEB_SERVICES`（`packages/core/src/manifest.ts:61-72`）只有 10 项、无新名；而 `manifest.ts:57-59` 注释明确要求「新增扩展点时先加 ctx 方法再加这里」。后果：(a) 若插件 `plugin.json` 写 `web.inject: ["workbench"]` 会被 `z.enum(WEB_SERVICES)`（`manifest.ts:147-150`）拒绝；(b) 即使不写 inject，`ctx.registerWorkbench` 在 `WebPluginContext` 上不存在 → 实现方 tsc 报错或被迫 `as any`。设计文档 §7 各里程碑写范围亦未含 `packages/core/src/{plugin-context.ts,manifest.ts}`。
- **requiredFix**：在 §5.2/§7 明确增补一步「同步扩展 core 契约」：在 `WebPluginContext` 声明新方法、并决定白名单归属（见 §3 答复 2/3）。建议该步与 `ctx` 实现同属一个任务（见 §3 答复 1 的拆分建议）。**不要**依赖实现者自行发明契约名。
- **evidence**：`packages/core/src/manifest.ts:57-59,61-72,147-150`；`packages/core/src/plugin-context.ts:390-419`；`apps/web/src/plugin/host.ts:59-109`（`ctx` 对象字面量，新增方法必须同时改这里）。

### F4 · §3.4.1 把 `useStatsStore` 判给 manual，但 kernel 的 `SettingsPage` 直接消费 — **high**
- **file**：`docs/architecture/web-workbench-split.md:237`
- **problem**：§3.4.1 把 `useStatsStore`（`stores/index.ts:650`）判给 **manual**，理由「仅手写台消费：`WritingDashboard.tsx:2`、…、`SettingsPage.tsx:2`」。但 `SettingsPage.tsx` 属 **kernel**（§3.1 `pages/` → kernel）。于是拆分后 kernel 的 `SettingsPage` 需要 import manual 包的 store，形成新的 **kernel→manual 边**；当 manual 模块被移除时 `SettingsPage` 编译失败（两种模式都坏），直接违反 §4 总原则与「另一模块仍可用」。文档在 §3.4.1 专门论证了「实体 store 必须 shared 否则 auto→manual」的对称问题，却在 `useStatsStore` 上犯了同型反向错误（kernel→manual）。
- **requiredFix**：`useStatsStore`（至少 `dailyGoal`/`setDailyGoal` 部分）改为 **shared（`@novel-plugins/data-core`）**；或把设置页的「每日目标」区块改为经 kernel 可选能力挂载、其 store 随 manual。二选一并在 §3.4.1 显式裁决。
- **evidence**：`apps/web/src/pages/SettingsPage.tsx:2,36-37`；`apps/web/src/components/editor/hooks/useEditorInstance.ts:13,47`；`apps/web/src/components/stats/WritingDashboard.tsx:2,50-51`。

### F5 · §6.3 断言 A 的扫描根过宽（会扫到不应扫描的目录） — **medium**
- **file**：`docs/architecture/web-workbench-split.md:488-499`
- **problem**：断言 A 写「扫描 `apps/web/src/**` 与 `apps/plugins/{manual,auto}/**/*.{ts,tsx}`」。但 `apps/plugins/{manual,auto}/` 下还存在 `node_modules/`、`dist/` 等非源码目录（实测 `apps/plugins/auto/novel.autowrite/node_modules`、`apps/plugins/manual/worldbuilding/node_modules` 存在），`**/*.{ts,tsx}` 会命中它们，产生假阳性/误伤第三方代码。队长已裁定**精确扫描根**为 `apps/web/src/**` + `apps/plugins/manual/workbench/web/**` + `apps/plugins/auto/workbench/web/**`。
- **requiredFix**：把 §6.3 断言 A 的扫描根改为上述精确根，并显式排除 `node_modules/`、`dist/`。
- **evidence**：`docs/architecture/web-workbench-split.md:488-499`；`Get-ChildItem apps/plugins -Recurse` 实测 `node_modules` 存在；队长裁决（门禁扫描根）。

### F6 · §6.3 断言 D（`staticEntries` 开关）不可直接编码，应降级为「无法判定」 — **medium**
- **file**：`docs/architecture/web-workbench-split.md:508-509,437-439`
- **problem**：断言 D 要求「`main.tsx` 的 `staticEntries`（`:58-64`）不得在 `--without auto` 时含 auto 条目」。但 `staticEntries` 是**硬编码数组**（`main.tsx:58-64`），**当前不存在**环境变量/`--without` 开关机制；§5.3 的「未核实」注（`:437-439`）亦自认「尚无环境变量开关机制，确切开关方式待 M1 定稿」。在没有定义开关载体的前提下，断言 D **无法被编码**（断言读什么来判断「不含 auto 条目」？）。
- **requiredFix**：把断言 D 在 §6.3 中**降级为「无法判定（待 M1 定稿开关载体后再定义）」**；并在 §7 M1 的写范围中显式加入「定义 `staticEntries` 的构建期开关（如 `VITE_WORKBENCH_WITHOUT` 或等价机制）」。在此之前门禁脚本不得声称 D 已可执行。
- **evidence**：`apps/web/src/main.tsx:58-64`（硬编码）；`docs/architecture/web-workbench-split.md:437-439`（自认未核实）。

### F7 · §3.4.1/§7 实体 store 抽取存在「单写者」缺口（`stores/index.ts` 与 `data-core` 双归属冲突） — **medium**
- **file**：`docs/architecture/web-workbench-split.md:236,400,526-537,557-559`
- **problem**：§3.4.1 要求把实体 store（`useProjectStore`…`cascadeCleanChapterClient`）从 `stores/index.ts`（864 行）**搬入 `@novel-plugins/data-core`**。该操作同时写两处：`apps/web/src/stores/index.ts`（移除/改壳）与 `apps/plugins/shared/data-core/**`（新增文件）。而队长 D3 规定 `stores/index.ts` → t4、`data-core` 由 kernel(t3) 在 M1 创建并搬入 `authStore` 等（§7 M1）。文档未指明「谁负责把实体 store 从 `stores/index.ts` 搬进 `data-core`」，导致 t3/t4 可能同时写 `data-core/**` 或同时写 `stores/index.ts`。
- **requiredFix**：在 §7 明确单写者：建议 **t3（M1）一次性完成「实体 store 抽取到 data-core」并因此拥有 `stores/index.ts` 的该次改动**，或 **t4 拥有 `stores/index.ts` 且同时拥有 `data-core/stores/**`**（二者取一，不得重叠）。并在 §7 写范围列明 `apps/plugins/shared/data-core/**` 的写入者。
- **evidence**：`docs/architecture/web-workbench-split.md:236,526-537`；队长 D3；`apps/web/src/stores/index.ts`（864 行）。

### F8 · §7.5 兼容壳删除条件缺前置（M4「门禁两方向通过」依赖壳未被 auto 引用，但该禁令未定义验证） — **medium**
- **file**：`docs/architecture/web-workbench-split.md:557-559,249-257`
- **problem**：§7.5 规定壳在 M5 删除的条件是「M4 结束时门禁两方向均通过」。但 §3.4.1 给壳设的硬约束是「**壳不得被 auto 侧引用**」（`:256-257`）；该约束**未进入 §6.3 断言清单**（断言 A–E 无一条检查「auto 不引用 `@/stores` 壳」）。因此即使壳被 auto 引用，门禁也可能通过，壳删除后 auto 才暴露问题。
- **requiredFix**：在 §6.3 增加断言（或并入断言 A）：`--without manual` 时 **auto 域禁止出现 `@/stores`（壳）或 `apps/web/src/stores/` 的 import**，只允许 `@novel-plugins/data-core/stores`。
- **evidence**：`docs/architecture/web-workbench-split.md:249-257,557-559,488-511`。

### F9 · §3.10/§7 目标包路径与 D1 不一致（已裁决偏差，对齐项） — **low**
- **file**：`docs/architecture/web-workbench-split.md:349-380,532-545`
- **problem**：§3.10/§7 写 `apps/plugins/auto/{autowrite,ai-chat,ai-graphs}/`、`apps/plugins/manual/knowledge/`；D1 裁决为 `apps/plugins/{manual,auto}/workbench/`（单包），子插件以 `web/<大类>/` 子目录体现。
- **requiredFix**：按 D1 修订 §2.1/§2.2/§3.10/§7 的路径与包名（architect 已被告知）。**不作为 needs_revision 的理由**（队长指示）。
- **evidence**：队长 D1；`docs/architecture/web-workbench-split.md:349-380`。

### F10 · §3.4.1 兼容壳「由 kernel 维护」与 D3「`stores/index.ts` → t4」冲突 — **low**
- **file**：`docs/architecture/web-workbench-split.md:249-257`
- **problem**：§3.4.1 称壳「**由 kernel 维护**」；D3 裁决 `stores/index.ts` → **t4（manual-eng）**。文档与裁决不一致，会造成实现者按文档误认为 t3 所有。
- **requiredFix**：按 D3 修订 §3.4.1 的措辞（壳由 t4 维护，t5 只读）。
- **evidence**：`docs/architecture/web-workbench-split.md:249-257`；队长 D3。

### F11 · §5.2 能力名未单一来源，与「白名单即真相」的既有约束冲突 — **medium**
- **file**：`docs/architecture/web-workbench-split.md:415-420`
- **problem**：§5.2 把能力名硬编码进签名：`name ∈ {'ai.quickPhrases','ai.timelineExtract','ai.scan','ai.outlineFill','ai.entityRefresh'}`（`:419`），§5.3（`:425-435`）另以散列表描述降级行为。既有的 core 契约风格是**单一白名单常量**（`SERVER_SERVICES`/`WEB_SERVICES`，`manifest.ts:41-72`）。能力名若散落在文档/实现里，与「单一事实源」相悖，易漂移（如 §4 C3 引用 `ai.scan`，§4.3/§4.5 引用 `ai.outlineFill`）。
- **requiredFix**：在 core 增补 `WEB_CAPABILITIES`（或等价常量）作为唯一事实源，§5.2 改为引用该常量；文档给出每个能力的 `name`→降级行为→消费点的完整对照表。
- **evidence**：`docs/architecture/web-workbench-split.md:415-420,425-435`；`packages/core/src/manifest.ts:41-72`。

### F12 · `WEB_SERVICES` ↔ `WebPluginContext` 一致性：新增扩展点后无自动校验 — **medium**
- **file**：`packages/core/src/manifest.ts:57-59,61-72`；`packages/core/src/plugin-context.ts:390-419`
- **problem**：`manifest.ts:57-59` 注释要求「白名单必须与 `WebPluginContext` 的 `register*` 一一对应」，但**无任何测试/脚本强制该一致性**（`packages/core/src/*.test.ts` 仅 `install.test.ts`/`mode.test.ts`）。当前 10 项 `WEB_SERVICES` 与 `WebPluginContext` 的 10 个扩展点恰好对齐；一旦按 §5.2 增补扩展点而漏改一侧，回归不会被拦截。
- **requiredFix**：增补一个 core 单测/门禁，断言 `WEB_SERVICES` 与 `WebPluginContext` 扩展点集合一致（新增扩展点必须同时改两处）。
- **evidence**：`packages/core/src/manifest.ts:57-59,61-72`；`packages/core/src/plugin-context.ts:390-419`；`packages/core/src/` 现有测试文件清单。

### F13 · §3.3 `services/ai/` 例外清单不完整 — **low**
- **file**：`docs/architecture/web-workbench-split.md:207`
- **problem**：§3.3 称 `services/ai/`「仅 auto 消费」，例外只列 §4.3（M1/M2 两条 manual→auto）。但独立复扫显示还有多处非 auto 域消费者：`components/layout/MemoryAuditPanel.tsx:27`（§3.7 判删除候选）、`hooks/{useAutoEntityDetection,useLatestChapterPolling,useScanProcessors}.ts`（§3.5 判 manual）。这些在 §4.3（C3）有处理，但 §3.3 的措辞「仅 auto 消费」不准确，易被实现者误读。
- **requiredFix**：把 §3.3 措辞改为「主要 auto 消费；例外见 §4.3/§4.5（含 C3 的 manual hooks 与 §3.7 的待删除面板）」。
- **evidence**：独立 grep `from '@/services/ai/` → 24 命中；`docs/architecture/web-workbench-split.md:207`。

### F14 · §4.5 悬空引用（文档未定义 §4.5） — **low**
- **file**：`docs/architecture/web-workbench-split.md:229,342,397`
- **problem**：§3.4（`:229`）、§3.9（`:342`）、§4.3（`:397`）引用「§4.5」，但 §4 只到 §4.4（表格行 C1–C4 后即接 §5）。属引用错误。
- **requiredFix**：把「§4.5」更正为实际章节（应为 §5.2 的能力契约）。
- **evidence**：`docs/architecture/web-workbench-split.md:229,342,397`（全文无 §4.5 标题）。

### F15 · §3.7 内部不一致：同为「0 入边」的 `AIRedstonePanel`/`BottomDrawer` 判「保留」，其余判「删除候选」 — **low**
- **file**：`docs/architecture/web-workbench-split.md:289-315,336`
- **problem**：§3.7 对同为「0 入边」的文件给出不同结论（`AIRedstonePanel`→迁移保留、`BottomDrawer`→迁移 shared、其余→删除候选），但**未给出「保留 vs 删除」的判定准则**，结论可审计性弱。
- **requiredFix**：在 §3.7 增补判定准则（如「0 入边 且 功能已被图谱版/新壳取代 → 删除候选；0 入边 但属未接线能力 → 迁移保留」），并逐条标注适用准则。
- **evidence**：`docs/architecture/web-workbench-split.md:291-299`。

### F16 · §6.3 断言 C 与 §5.4 第 5 项 / `ctx.api` 存在张力 — **low**
- **file**：`docs/architecture/web-workbench-split.md:505-506,451`
- **problem**：断言 C 禁止 `apps/plugins/{manual,auto,shared}/**` 内出现字面量 `'/api/`；但 §5.4 第 5 项对 `autowriteSession.ts:84` 的处置是「SSE 裸 fetch，须保留手动 `X-Project-Id`」，即**仍用裸 `fetch`**（只换成 `resolveApiUrl`）。若保留裸 fetch，则插件域内必然出现 `fetch(resolveApiUrl('/api/...'))` 形态，与断言 C 的字面量禁令需要明确边界（是禁 `'/api/` 字面量、还是禁裸 fetch？）。文档未澄清。
- **requiredFix**：明确断言 C 只禁**字面量** `'/api'` 与 `import.meta.env.VITE_API_BASE_URL`（允许 `resolveApiUrl('/...')` 形态），并说明 SSE 裸 fetch 的例外；或把 SSE 统一到 `ctx.api`。
- **evidence**：`docs/architecture/web-workbench-split.md:451,505-506`；`apps/web/src/services/ai/autowriteSession.ts:84`。

### F17 · §3.5/§3.7 hooks 分类措辞不一致 — **low**
- **file**：`docs/architecture/web-workbench-split.md:267-269,399`
- **problem**：§3.5 把 `useAutoEntityDetection`/`useLatestChapterPolling`/`useScanProcessors` 判为「**manual**（疑死代码）」；§3.7 未列这三个 hook（§3.7 只列组件/服务）。而 §4.3（C3，`:399`）又把三者判为「**手写台**能力，整体迁 manual」并赋予 `ai.scan` 降级。三处口径（死代码 vs 活跃 manual 能力）不一致：若它们是死代码则应走 §3.7 删除流程，若是活跃能力则不应标「疑死代码」。
- **requiredFix**：统一结论：确认三 hook 是否仍被 `EditorPage.tsx:21-22` 使用（§3.5/§4.3 均称是）→ 若是，去掉「疑死代码」措辞并纳入 manual 活跃能力；若否，移入 §3.7。
- **evidence**：`docs/architecture/web-workbench-split.md:267-269,399`；`apps/web/src/components/editor/EditorPage.tsx:19,21-22`。

### F18 · §3.2 `components/consistency/` 目标落点与 D1 不一致 — **low**
- **file**：`docs/architecture/web-workbench-split.md:185,300`
- **problem**：§3.2 把 `components/consistency/` 落点写为 `apps/plugins/manual/knowledge/src/`；D1 下 manual 只有一个包 `apps/plugins/manual/workbench/`，知识库应以 `web/knowledge/` 子目录体现。同 F9，属已裁决偏差。
- **requiredFix**：按 D1 修订落点。**不作为 needs_revision 的理由**。
- **evidence**：队长 D1；`docs/architecture/web-workbench-split.md:185`。

### F19 · §0 workspace 包声明与实际略有出入 — **low**
- **file**：`docs/architecture/web-workbench-split.md:18`
- **problem**：§0 写工作区包为 `apps/plugins/{manual,auto,shared,local}/*`；实际 `pnpm-workspace.yaml:2-9` 同时含 `apps/plugins/*`（顶层）与四个模式子目录。§0 遗漏 `apps/plugins/*` 一行（虽不影响结论，但作为「基线口径」应精确）。
- **requiredFix**：补全 `apps/plugins/*`。
- **evidence**：`pnpm-workspace.yaml:2-9`。

### F20 · §3.7 `pages/ProjectSelectPage.tsx` 结论含糊（「删除候选」但未确认名称是否含 `key:`/路由字符串引用） — **low**
- **file**：`docs/architecture/web-workbench-split.md:314`
- **problem**：§3.7 判其「0 入边，删除候选」，理由「`App.tsx:201-220` 路由表未注册它」。独立复扫确认 `App.tsx` 无该引用、无其它文件 import；但 §3.7 的「字符串动态引用」复扫声明（`:286`）未给出 `ProjectSelectPage` 的 `key:`/`lazy(...)` 命中证据。建议补齐证据以符合 §3.7 自定的「删除前须 grep 字符串动态引用」。
- **requiredFix**：在 §3.7 补记「已 grep `key:`/`lazy(() => import(...))`/字符串路径，无命中」的原始结果。
- **evidence**：`apps/web/src/App.tsx:22-30,190-220`；独立 grep 无 `ProjectSelectPage` 导入。

### F21 · §3.4.1 `cascadeCleanChapterClient` 判给 shared，但消费者是 manual（应 manual） — **medium**
- **file**：`docs/architecture/web-workbench-split.md:236`
- **problem**：§3.4.1 把 `cascadeCleanChapterClient`（`stores/index.ts:739`）列入 **shared（data-core）**。独立复扫：唯一调用方是 manual 侧 —— `components/layout/LeftSidebar.tsx:3,417` 与 `components/editor/hooks/useEditorInstance.ts:13,158`（`LeftSidebar` 属 manual，见 §3.8；`useEditorInstance` 属 manual）。故应归 **manual**。契约 §3.1 正是把它列在 manual 组（`docs/architecture/web-workbench-split-contract.md:63`）。设计文档判 shared 与其自身 §3.4.1 的「按消费者定归属」原则矛盾，也与契约不一致。
- **requiredFix**：§3.4.1 将 `cascadeCleanChapterClient` 从 shared 移到 **manual**（与契约 §3.1 对齐）。若坚持 shared，需给出「auto 也消费」的证据，否则属误判。
- **evidence**：`apps/web/src/components/layout/LeftSidebar.tsx:3,417`；`apps/web/src/components/editor/hooks/useEditorInstance.ts:13,158`；`docs/architecture/web-workbench-split-contract.md:63`。

### F22 · §3.4 把 `outlineNotepadStore` 判给 manual，但 auto 侧 `ChatPanel.tsx`/`OutlineFillDialog.tsx` 直接消费（契约已改口径，设计文档未同步） — **medium**
- **file**：`docs/architecture/web-workbench-split.md:229`
- **problem**：§3.4 判 `stores/outlineNotepadStore.ts` → **manual**，并注明 auto 侧 `ChatPanel.tsx:6`、`OutlineFillDialog.tsx:17` 走「kernel 可选能力（§4.5）」。但 §5.2/契约 §2 的能力清单**没有覆盖大纲记事本 store 的能力名**（只有 `ai.outlineFill`，且契约把 `ai.outlineFill` 定义为「入口隐藏、大纲纯文本编辑完整」的**可选 AI 入口**，并非 store 的共享方式）。独立复扫：`ChatPanel.tsx:6,467,551`、`OutlineFillDialog.tsx:17,126-128` **直接 import 该 store**。若 store 归 manual，则 auto 侧成 auto→manual 边（违反 §4 总原则）。契约 §3.3（`docs/architecture/web-workbench-split-contract.md:91`）把 `outlineNotepadStore` 列在**共享 data-core**——与设计文档 §3.4 冲突。二者必居其一，设计文档未自洽。
- **requiredFix**：统一口径。建议按契约把 `outlineNotepadStore` 归 **shared（data-core）**（auto 侧 `ChatPanel`/`OutlineFillDialog` 与 manual 侧 `OutlineManager` 都消费，符合「共享数据层」判据），或为 auto 侧定义明确的可选能力并移出 auto 的静态 import。设计文档 §3.4/§4.5 需与契约 §3.1/§3.3 对齐。
- **evidence**：`apps/web/src/components/ai/ChatPanel.tsx:6,467,551`；`apps/web/src/components/ai/OutlineFillDialog.tsx:17,126-128`；`apps/web/src/components/outline/OutlineManager.tsx:31`；`docs/architecture/web-workbench-split-contract.md:91`。

---

## 3. 队长点名复核的 5 处：逐条结论

### 3.1 §3.4.1 实体 store 判给 shared 是否真能切断 auto→manual 边 —— **成立（确认）**
- **复核**：`useAutoEntityDetection.ts:12` `import { useCharacterStore, useLocationStore, useTimelineStore, useChapterStore, useItemStore, useProjectStore } from '@/stores'`（auto 域）；`ChapterPlanGraphPanel.tsx:22` `import { useCharacterStore, useForeshadowStore, useItemStore } from '@/stores'`（auto 域）。两者都经 `stores/index.ts`（实体 store）。**若实体 store 归 manual，这两处即成 auto→manual 边**；归 shared（`data-core`）后，auto 侧改引 `@novel-plugins/data-core/stores`，边消除。文档 §3.4.1（`:241-247`）的论证**正确且必要**。
- **注意（新发现 F4）**：同一「谁消费谁定归属」的推理在 `useStatsStore` 上被漏用——其 consumer 含 **kernel** 的 `SettingsPage.tsx`，故不能判 manual。实体 store 结论成立，但 §3.4.1 的 store 分类需按 F4 修正一处。
- **结论**：**通过**（实体 store → shared 正确）；附带 F4 修正。

### 3.2 §3.7 零入边文件「删除候选」——独立 grep `__tests__` 与字符串动态引用 —— **不通过（2 处误删，见 F1/F2）**
独立复扫结果（`apps/web/src` 全量，含 `__tests__`；模式：静态 `from '...'`、`lazy(() => import(...))`、`key:`、注释/字符串）：

| §3.7 文件 | 文档结论 | 独立复扫（含 `__tests__`/动态） | 判定 |
|---|---|---|---|
| `utils/credentials.ts` | 删除候选 | **`pages/LoginPage.tsx:9,42-45` 静态导入** | ❌ **误删**（F1） |
| `services/security/encryptionService.ts` | 删除候选 | **`pages/SettingsPage.tsx:14-19` 静态导入** | ❌ **误删**（F2） |
| `components/layout/PipelinePanel.tsx` | 迁移保留（仅测试） | `__tests__/PipelinePanel.test.tsx:14` 唯一引用；组件头注 `:6` 自述「只有测试还在跑」 | ✅ 正确（保留测试） |
| `components/export/ImportDialog.tsx` | 迁移保留 | **无任何 import 方**（`projectExportService.ts:424` 仅为注释「…以便 ImportDialog 使用」，非引用）；`ExportDialog.tsx` 也未引 | ⚠️ 结论方向可接受，但**依据不成立**（F7-类，见 F7 说明：应为「按 §3.7 准则保留」，非「被动态引用」） |
| `components/foreshadow/EarmarkPanel.tsx` | 迁移保留 | `EarmarkPanel.tsx:4-5` 引 `EarmarkBadge`/`EarmarkDialog`；反向 `SelectionMenu.tsx:6` 引 `EarmarkDialog`；**`EarmarkPanel` 本身 0 入边** | ⚠️ 同上，依据不成立 |
| `components/foreshadow/ForeshadowsPage.tsx` | 迁移保留 | 仅 `ForeshadowsPage.tsx:3` 自身；无入边 | ⚠️ 同上 |
| `components/layout/{EntityRail,MemoryAuditPanel,RightSidebar,StatusBar,WorkspacePane,WorldStateBoard}.tsx` | 删除候选 | 仅自身定义 + 注释提及（`AutoWriteWorkbench.tsx:1260`、`ChapterPlanGraphPanel.tsx:4,102`、`EditorPage.tsx:130` 均为**注释**） | ✅ 正确 |
| `components/series/SeriesManager.tsx`、`components/knowledge/Heatmap.tsx`、`components/editor/extensions/{MentionExtension.ts,RealtimeRhythm.tsx}`、`services/editor/rhythmService.ts`、`services/misc/webSearchService.ts`、`services/ai/aiService.ts`、`pages/ProjectSelectPage.tsx` | 删除候选 | 均 0 入边（`rhythmService` 内部 `import('../api/apiClient')` 是出边非入边） | ✅ 正确 |

> `services/ai/aiService.ts` 复扫亦为 0 入边（`aiService` 仅 `:83` 自身导出）。`MentionExtension`/`RealtimeRhythm` 未被 `useEditorInstance.ts:5-12` 引入（已核对）。

**结论**：§3.7 的**删除候选机制（全标「候选」+ 删除前复扫 + 跑基线）方向正确**，但 **2 条「零入边」判定事实上错误**（F1/F2），且 3 条「保留」的依据描述不准确（F7 类）。必须修正后才可进入实现。

### 3.3 §5.2 新增 4 个扩展点是否与 `registry.ts:254-265` / `WEB_SERVICES` 冲突 —— **冲突（F3/F11/F12）**
- **与注册 API**：`pluginRegistryApi`（`registry.ts:254-265`）现有 9 个入口 + `reset`，**不含** workbench/chatPanel/capability；`WebPluginContext`（`plugin-context.ts:390-419`）也不含。§5.2 的 4 个新方法**必须同时**在 `plugin-context.ts` 声明、在 `host.ts:59-109` 的 `ctx` 对象实现、在 `registry.ts` 增补状态与注册函数（`registerWorkbench`/`registerChatPanel` 各需一个单槽；`registerCapability`/`getCapability` 需一个 `Map`）。设计文档未列出这些落点。
- **与 `WEB_SERVICES` 白名单**：见下 §3.4 的答复 1–4。
- **结论**：**存在遗漏**，非「冲突」而是「未同步」，属 F3（high）。

### 3.4 §6.3 断言 A–E 可编码性 —— **A/B/C/E 可编码；D 不可编码（应降级）**
- **断言 A**：可编码，但**扫描根需按 F5 收窄**（`node_modules` 假阳性）。
- **断言 B**：可编码（`exports` 字段 + 正则）。可行；建议同时校验 `package.json` 的 `exports` 确实暴露 `./web`（当前 `worldbuilding` 用 `novelMuse` 字段而非 `exports`，`bookscan`/`typography` 用 `plugin.json`——三种约定并存，断言 B 需覆盖）。
- **断言 C**：可编码，但需按 F16 澄清与裸 fetch/`ctx.api` 的边界。
- **断言 D**：**不可编码**（F6）→ 按队长建议**降级为「无法判定（待 M1 定稿开关载体）」**。
- **断言 E**：可编码（跑 L2/L3，用例数 ≥ 182）。独立复现基线 182 ✅。

### 3.5 §7 里程碑写范围是否让 t3/t4/t5 不冲突 —— **基本成立，但有 2 处需补**
- **`apps/web/package.json`**：D3 已裁决 → t3（单写者）。§7 文档未点名（M2 说 `main.tsx` 改 import 入口；M3 说新增 auto 包——两者都可能触发 `package.json` 的 workspace 依赖变更）。**按 D3 落定即可**，但 §7 应显式写「`apps/web/package.json` 仅 t3 可写」。
- **`stores/index.ts` 兼容壳**：D3 裁决 → t4（t5 只读）；与 §3.4.1「kernel 维护」冲突（F10）。更关键的是**实体 store 抽取到 `data-core` 的双写冲突**（F7）。
- **`plugin/{registry,host,types}.ts`**：D3 → t3；§7 M1 已把这三个文件列入 t3 写范围 ✅，但 §5.2 新增扩展点所需的 `host.ts`/`registry.ts`/`plugin-context.ts` 改动**未在 §7 任一里程碑列出**（F3）。
- **门禁扫描根**：§6.3 需按队长裁决改为 `apps/web/src/**` + `apps/plugins/{manual,auto}/workbench/web/**`（F5）。
- **结论**：**不通过（需补写范围）**，主要缺口为 F3（core 契约）与 F7（data-core 双写）。

---

## 4. 已独立验证为正确的部分（予以确认）

- **基线**：`pnpm --filter @novel/web test` → **14 文件 / 182 用例全绿（3.95s）**，与 §0/§6.1 一致；`apps/web/package.json` 无 `packageManager`（§0 引 `package.json:24`，实际该字段在根 `package.json`，属轻微引注瑕疵，不影响结论）。
- **§5.4 的 7 处 `/api` 字面量**：独立 grep 全量命中且**恰好 7 处**，行号与 §5.4 表格**逐条一致**（`ChatPanel.tsx:1571`、`chatService.ts:170`、`scanService.ts:169,336`、`autowriteSession.ts:84`、`useEditorInstance.ts:448`、`main.tsx:33`）。✅
- **§1.2 的 9 条必须消解边**：M1/M2 与 A1–A8 的行号可独立复现（`QuickPhraseBubble.tsx:17`、`TimelineView.tsx:8`、`ChapterPlanGraphPanel.tsx:23-25`、`MemoryGraphPanel.tsx:29-30`、`PipelineGraphPanel.tsx:28-29`、`autoBuiltin.ts:31-32`）。✅
- **§5.1 既有扩展点引用**：`types.ts:29-50,116-136`、`registry.ts:254-265`、`host.ts:30-32,125-144`、`manifest.ts:61-72` 均核对无误。✅
- **`main.tsx:58-64,75-103` 构建期清单**：核对无误（`staticEntries` 3 项 + `import.meta.glob` 四模式目录）。✅
- **§3.1 一级目录总表**：与实测目录结构一致（`components/ai,consistency,editor,effects,export,foreshadow,knowledge,layout,notes,outline,series,settings,shuimo,snapshot,stats,timeline,ui`）。✅
- **`components/knowledge/graph/*` 为 auto→manual 唯一共享面**：`MemoryGraphPanel.tsx:29-30`、`PipelineGraphPanel.tsx:28-29`、`ChapterPlanGraphPanel.tsx:23-25` 均只引 `knowledge/graph/{GraphShell,StageNode,EntityNode}`，与 §1.2 B 一致。✅

---

## 5. 给队长的直接答复（补充说明的 4 问 + D4/D5 追问）

1. **设计文档是否遗漏「同步扩展 `packages/core` 契约」？属什么 severity？**
   **是遗漏，severity = high**（F3）。`WebPluginContext`（`plugin-context.ts:390-419`）无新方法、`WEB_SERVICES`（`manifest.ts:61-72`）无新名，且 `manifest.ts:57-59` 明确要求先加 ctx 方法再加白名单。照文档实现会导致：`plugin.json` 的 `web.inject` 被 `z.enum(WEB_SERVICES)` 拒绝；`ctx.registerWorkbench` 在类型上不存在。**应纳入实现范围**，且不应拆成「独立任务」——最小 core 扩展与 `host.ts`/`registry.ts` 的 ctx 实现强耦合，拆开会造成中间态无法编译。建议：作为 t3 的一个**显式子步骤**（或 t3 内的一个子任务），写范围含 `packages/core/src/{plugin-context.ts,manifest.ts}` + `apps/web/src/plugin/{host.ts,registry.ts}`，并在 §7 里程碑列明。

2. **`registerWorkbench`/`registerChatPanel` 是否应进 `WEB_SERVICES` 白名单？**
   **不应进白名单，应设计为 kernel 内部扩展点。** 理由：`WEB_SERVICES` 表达的是「插件 manifest 的 `web.inject` 可声明什么」，而 `workbench`/`chatPanel` 是**两个大模块（kernel 侧）**的组装点，不是普通子插件的能力。让任意子插件 `web.inject: ['workbench']` 会破坏「单槽、由模块入口注册」的语义。对 `plugin.json` 的影响：模块包（`manual-workbench`/`auto-workbench`）**不需要**在 `web.inject` 里声明 `workbench`；它们经 `web/index.tsx` 的 `apply(ctx)` 调用 `ctx.registerWorkbench(...)` 即可。**但**：如果坚持让 manifest 校验通过（因为 `WebPluginModule.inject` 与 `plugin.json.web.inject` 会做一致性校验，见 `plugin-context.ts:423-427`），则必须在 `WebPluginContext` 上声明这两个方法（否则 tsc 失败），并在 `WEB_SERVICES` 中**显式加入**、或**从白名单校验中豁免**（见答复 3 的机制建议）。

3. **`registerCapability`/`getCapability` 是否需要白名单条目？**
   **需要「能力名」的白名单，不需要「方法名」的白名单。** 方法名（`capability`）若出现在 `web.inject` 里没有意义；真正需要冻结的是**能力名集合**（`ai.quickPhrases`/`ai.timelineExtract`/`ai.scan`/`ai.outlineFill`/`ai.entityRefresh`）。建议：在 core 新增 `WEB_CAPABILITIES` 常量，`registerCapability`/`getCapability` 的 `name` 类型为 `WebCapabilityName`；子插件若要通过 manifest 声明能力（可选），在 `plugin.json.web` 增一个 `capabilities: string[]` 字段并校验为 `WEB_CAPABILITIES` 子集。这样既保持「单一事实源」，又避免把方法名塞进 `inject`。

4. **有无其它「新增扩展点但未同步 core」的同类遗漏？**
   **全扫结果：无历史遗漏，但存在「无一致性校验」的风险（F12）。** 现有 10 项 `WEB_SERVICES`（`manifest.ts:61-72`）与 `WebPluginContext`（`plugin-context.ts:390-419`）的 10 个扩展点**恰好一一对应**（`routes/projectPanels/commands/settings/editor/toolbar/selection/skills/chatRail/api` ↔ 同名 `register*`/`api`）。`ServerPluginContext`（`plugin-context.ts:77-227`）与 `SERVER_SERVICES`（`manifest.ts:41-51`）亦对齐。**问题在于没有测试/门禁强制这一致性**——§5.2 新增 4 项后极易漏改一侧。建议按 F12 增补 core 一致性单测。

### 5b. 队长 D4/D5/D3 追问的答复

5. **D4（kernel 壳迁出 `components/layout/`，不开白名单）：设计文档 §3.8/§3.10 与契约 §5/§6 是否都需按 D4 修订？**
   **是，两者都需修订**（requiredFix 如下）：
   - **设计文档 §3.8**（`:320-336`）：现写 `layout/ProjectLayout.tsx` → **kernel**、`layout/PanelSection.tsx` → **kernel/shared**、`layout/FloatingBubbles.tsx` → **kernel**，落点仍是 `apps/web/src/components/layout/`；需改为三者迁 `apps/web/src/components/shell/`，且 `components/layout/` 整体归 auto。
   - **设计文档 §3.10**（`:349-358`）：现写 kernel 保留 `components/layout/{ProjectLayout,PanelSection,FloatingBubbles}.tsx`；需改为 `components/shell/{ProjectLayout,PanelSection,FloatingBubbles}.tsx`，并删除「`components/layout/` 留 kernel」的表述。
   - **契约 §5**（`web-workbench-split-contract.md:150`）：`K2A` 的 kernel 禁止前缀含 `@/components/layout/`。D4 后该目录整体消失，规则**无需例外即可自洽**——契约 §5 保持原样即可（但应补一句「kernel 壳位于 `components/shell/`，不在禁止前缀内」以防实现者误读）。
   - **契约 §6**（`web-workbench-split-contract.md:161`）：t3 可改路径含 `apps/web/src/{plugin,components/ui,components/effects,components/shuimo,...}`；需**增列 `apps/web/src/components/shell/**`**，并把 t5 的 `apps/web/src/components/{ai,layout}/**` 保留（layout 其余文件仍归 t5，但 kernel 壳已不在其中）。否则 t3 执行 D4 搬迁时越出自身写范围。
   - **契约 §5 的扫描根**：`apps/plugins/{manual,auto}/workbench/web/**` 与 `apps/web/src/**` 不受影响（`components/shell/` 在 `apps/web/src/**` 内）。✅
   - **一致性检查**：D4 要求 `ProjectLayout.tsx` 的引用方只有 `App.tsx:22-30`——已核实 `App.tsx:22` `import('./components/layout/ProjectLayout')`（唯一引用点），改动成本极低，D4 可行。✅

6. **D5（`AIConfigPanel`/`LocalModelPanel` 归 auto，复用既有 `registerSettingsSection`）：设计文档 §5.2 是否过度新增扩展点？「不新增契约」是否可行？**
   - **是否过度新增**：§5.2 的 `registerChatPanel` 与 D5 无直接关系（D5 走 `registerSettingsSection`，§5.2 未为设置区块新增契约，这点**不算过度**）。但 §5.2 **整体偏「新增过多」**：`registerWorkbench`/`registerChatPanel`/`registerCapability`/`getCapability` 四个里，`registerChatPanel` 与既有 `registerChatRail`（`registry.ts:263`、`types.ts:131-136`）职责高度重叠（都是「单槽 + 回退内置 + auto 缺席则不渲染」）。§5.2 自己也说 chatRail「已存在且已实现降级、本次不新增」——那么 **ChatPanel 本体同样可经既有 `registerChatRail` 的 Component 承载**（或复用 `registerProjectPanel` 的 `chat` key），无需再造一个单槽注册器。建议 §5.2 收敛为：`registerWorkbench`（确为新增，kernel 壳需要）+ `registerCapability`/`getCapability`（确为新增，降级契约需要），`registerChatPanel` 合并进 `chatRail` 或改为内部实现。
   - **「不新增契约」是否可行**：**可行**。D5 的装配路径已被验证：`WEB_SERVICES` 已含 `settings`（`manifest.ts:65`）；`PluginSettingsSections.tsx` 已按模式过滤（`SettingsPage.tsx:11` 引 `PluginSettingsSections`，其内部按 `filterByProjectMode` 过滤）。auto 以 `modes:['auto']` 注册、auto 缺失则区块不出现、设置页其余照常——**无需任何新扩展点**。唯一需补的是：`AIConfigPanel` 当前被 `SettingsPage.tsx:9` **静态 import**（kernel→auto 边），D5 生效要求把该 import 改为经注册表渲染；这属实现细节，不构成新增契约。
   - **requiredFix（若采纳）**：设计文档 §3.9/§5.2 明确「设置区块经既有 `registerSettingsSection` + 模式过滤，不新增契约」，并把 `SettingsPage.tsx:9` 的静态 import 改为注册表渲染（归属 kernel 写范围）。

7. **D3 提醒：契约 §6 的 `apps/web/package.json` 归 t4 已被 D3 取代（归 t3）——记为 finding。**
   **记录为 F23（低，文档待修订）**：契约 §6（`web-workbench-split-contract.md:165`）写「`apps/web/package.json` → t4 主写、t5 只追加 auto 依赖行」；D3（`CAPTAIN-DECISIONS.md:48,58`）裁决归 **t3**。**不因此否掉 t8**（t8 已 pass）；仅要求契约文档与任务契约修订为「`apps/web/package.json` → t3 独占」。
   - **附带（设计文档侧）**：设计文档 §7 也未把 `apps/web/package.json` 与 `pnpm-workspace.yaml` 的写者点名（仅 §7 M1 提「新增 shared 包」），建议一并按 D3 写死单写者。

---

## 6. 判定汇总

| id | severity | 摘要 | 阻断实现 |
|---|---|---|---|
| F1 | high | §3.7 `credentials.ts` 误判删除（`LoginPage.tsx:9` 在用） | 是 |
| F2 | high | §3.7 `encryptionService.ts` 误判删除（`SettingsPage.tsx:14-19` 在用） | 是 |
| F3 | high | §5.2 遗漏同步扩展 core（`WebPluginContext`+`WEB_SERVICES`） | 是 |
| F4 | high | §3.4.1 `useStatsStore`→manual 引入 kernel→manual 边 | 是 |
| F5 | medium | §6.3 断言 A 扫描根过宽 | 否（门禁实现前须修） |
| F6 | medium | §6.3 断言 D 不可编码，应降级「无法判定」 | 否（须改文档） |
| F7 | medium | 实体 store 抽取 `stores/index.ts`/`data-core` 双写 | 否（须定单写者） |
| F8 | medium | 兼容壳「禁 auto 引用」未进门禁 | 否 |
| F9 | low | §3.10/§7 路径 vs D1（已裁决偏差） | 否 |
| F10 | low | 兼容壳「kernel 维护」vs D3 | 否 |
| F11 | medium | 能力名未单一来源 | 否 |
| F12 | medium | `WEB_SERVICES`↔`WebPluginContext` 无一致性校验 | 否 |
| F13 | low | §3.3 `services/ai/` 例外清单不全 | 否 |
| F14 | low | §4.5 悬空引用 | 否 |
| F15 | low | §3.7 保留/删除准则缺失 | 否 |
| F16 | low | 断言 C 与 §5.4 第 5 项/`ctx.api` 张力 | 否 |
| F17 | low | hooks「死代码」vs「manual 能力」措辞不一致 | 否 |
| F18 | low | §3.2 `consistency` 落点 vs D1 | 否 |
| F19 | low | §0 workspace 声明不精确 | 否 |
| F20 | low | §3.7 `ProjectSelectPage` 证据不足 | 否 |
| F21 | medium | §3.4.1 `cascadeCleanChapterClient`→shared 应为 manual（契约 §3.1） | 否 |
| F22 | medium | §3.4 `outlineNotepadStore`→manual 与 auto 直接消费/契约冲突 | 否 |
| F23 | low | 契约 §6 `package.json` 归 t4 已被 D3 取代（文档待修订） | 否 |

**verdict：needs_revision**（F1–F4 为 high，须在进入 t3/t4/t5 前修订设计文档或由队长裁决纳入实现范围）。

**与队长裁决的交叉说明**：
- **F3 已被 D2 部分承接**：D2 把 `packages/core/src/{plugin-context.ts,manifest.ts}` 的最小扩展纳入 t3。这解决了 F3 的**范围**问题；但设计文档 §5.2/§7 仍需**显式写明**该步与白名单口径（`WEB_SERVICES` 加哪几项、`CapabilityName` 常量），否则实现者仍可能漏改 `host.ts`/`registry.ts` 的 ctx 实现。F3 的 requiredFix 保留，但 severity 可随 D2 落地降为「文档同步」。
- **F5/F9/F10/F18/F23 均属「按 D1/D3/D4 修订文档」类**，不作为 needs_revision 的独立理由（队长已明确）。
- **F21/F22 为设计文档与契约的实质归属冲突**（非 D 系列裁决可覆盖），建议由 architect 或队长裁决后统一设计文档与契约。

---

## 7. 流程备注（t2 认领状态）

- 本报告是 **t2 的实质产出**，但 **t2 当前无法认领**：`agent_teams_claim_task(t2)` 返回 `blocked by unfinished dependencies: t1`（t1 仍 `in_progress`）。故本次以「先行评审」方式产出，未持有 t2 的 attempt_id，无法用 `agent_teams_update_task` 回写 t2 状态。
- 待 t1 完成、t2 可认领后，请队长指派（或允许我认领 t2）以便把本报告正式挂到 t2 输出并落 verdict。
- **未修改被评审文档**；仅新增 `docs/reports/web-split-design-review.md`。
- t9（契约评审）另出 `docs/reports/web-split-contract-review.md`（契约已落盘 `docs/architecture/web-workbench-split-contract.md`）。
