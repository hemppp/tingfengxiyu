# 两工作台模块抽取实现 · 评审（round 1 / t6）

| 项 | 值 |
|---|---|
| 被评审 | t4（manual 大模块）+ t5（auto 大模块）抽取实现 |
| 评审范围 | `apps/web/src`、`apps/plugins/{manual,auto,shared}/**`（**只读**，未改任何实现代码） |
| 权威 | `CAPTAIN-DECISIONS.md`（D1–D43）> 契约（冻结）> 设计（t27 pass） |
| 方法 | 独立复跑门禁/type-check/单测 + **自建静态依赖分析** + **模块移除模拟（沙箱，junction 复制，绝不改仓库）** |
| **verdict** | **needs_revision**（**blocker**） |

## 0. 结论摘要

抽取的**主体结构确实落地**（两模块包、入口注册、降级契约、`/api` 收口均真实有效，见 §2），
但存在**两处 blocker**，直接否证本轮的核心验收目标「任一模块缺席另一模块仍可用」：

1. **`apps/web/src` 内 106 个 `export * from '<相对深层路径>'` 垫片**，把 kernel 树与两个模块的**内部实现**硬绑。
   我在沙箱中模拟模块移除后实测：**移除 auto → type-check 53 错误；移除 manual → 62 错误**（基线 exit 0）。
   即**当前仓库并不具备可分离性**，只是「恰好都在」。
2. **门禁与队长预言机对 `export … from` 完全失明**（正则只认 `import … from` / `import()` / `require()`），
   故「三模式全 0」是**假阴性**而非真实通过；即便匹配上，相对路径解析后的域被判为 `other`，**任何域对规则都无法触发**——双重失明。
3. 连带：**断言 E 是空转的**——`--without auto --with-tests` 仍在**真实树**（两模块俱在）跑 type-check，
   从不模拟移除，故其「passed」与实测的 53 错误直接矛盾。

> 结论：**t4/t5 交付的「可分离性」证据不成立**，下游 t7 不可据此放行。必须修复后重审。

---

## 1. 独立复跑（不采信实现者贴的结果）

| 命令 | 实测结果 | 判读 |
|---|---|---|
| `node scripts/verify/verify-workbench-isolation.mjs` | **exit 0**（A=0 A'=0 B=0 C=0 缺失=0） | ⚠️ **假阴性**，见 F2 |
| `… --without auto` | **exit 0** | ⚠️ 假阴性 |
| `… --without manual` | **exit 0** | ⚠️ 假阴性 |
| `… --with-tests` | **exit 0**；E「passed — L2 type-check exit 0；L3 用例数 182」 | ❌ **E 空转**，见 F3 |
| `… --without auto --with-tests` | **exit 0**；E 仍报 passed | ❌ 与实测 53 错误**直接矛盾** |
| `pnpm --filter @novel/web type-check` | **exit 0** | ✅ 仅证明「两模块都在时」可编译 |
| `pnpm --filter @novel/web test` | **14 文件 / 182 用例全绿**（exit 0） | ✅ D20 基线守住，**无删测** |
| `node .workbuddy/…/captain-isolation-check.mjs` | **exit 0**，违规 0 | ⚠️ 与门禁**同源失明**（同一 `IMPORT_RE`） |

### 1.1 🔴 决定性实验：模块移除模拟（沙箱）

方法：把 `apps/web/src` 与 `apps/web/tsconfig.json` 复制到 `%TEMP%`，
以 **junction** 指向真实 `node_modules` / `apps/plugins/*` / `packages/*`，
**删除模块 junction** 模拟移除，跑**同一份 tsconfig + 同一个 tsc**。全程未触碰仓库任何文件。

| 场景 | tsc 结果 | 报错引用目标模块 |
|---|---|---|
| **基线**（manual+auto 俱在） | **exit 0**，0 错误 | — |
| **`--without auto`**（删 auto junction） | **exit 2**，**53 个 TS2307/TS2305** | **45 条**指向 `plugins/auto/workbench/…` |
| **`--without manual`**（删 manual junction） | **exit 2**，**62 个 TS2307** | **61 条**指向 `plugins/manual/workbench/…` |
| 恢复 auto 后复跑 | **exit 0**，0 错误 | 证明差异**仅**由模块存在性导致 |

典型报错：

```
src/components/ai/ChatPanel.tsx(1,15): error TS2307: Cannot find module
  '../../../../plugins/auto/workbench/web/discuss/ChatPanel' or its corresponding type declarations.
src/components/editor/ChapterEditor.tsx(1,15): error TS2307: Cannot find module
  '../../../../plugins/manual/workbench/web/editor/ChapterEditor' or its corresponding type declarations.
```

**这正是「另一模块缺席时另一模块不可用」的定义式反例。**

---

## 2. ✅ 已核实为真实达标的项（不是注释）

| 项 | 证据 |
|---|---|
| 两模块单包落地（D1） | `apps/plugins/manual/workbench/{package.json,plugin.json,web/index.tsx,stores/index.ts}`、`apps/plugins/auto/workbench/…` 齐备 |
| manual 入口注册 | `web/index.tsx`：`registerProjectPanel × 12` + `registerBuiltinBubble({key:'chapters'})` + `export { ChapterEditor }`（D35 供 kernel 惰性引） |
| auto 入口注册 | `web/index.tsx`：`registerProjectPanel × 5` + `registerBuiltinBubble('ai-chat')` + `registerChatRail` + `registerWorkbench({modes:['auto']})` + `registerSettingsSection × 2` + `registerCapability × 3`（`ai.quickPhrases`/`ai.timelineExtract`/`ai.scan`） |
| `ProjectLayout` auto 侧静态 import 已消 | `:15` `LeftSidebar` 已删（D26/D37，改为按 key 取注册槽）；`:22/:29 ChatPanel`、`:23 AiChatBubbleRail`、`:33 AutoWriteWorkbench` 全消；`:27` 仅 `import type`；`:396` `pluginChatRail?.Component ?? null` 真守卫 |
| **降级契约真实生效**（非注释） | `QuickPhraseBubble.tsx:196-197`：`const cap = getCapability('ai.quickPhrases'); cap ? await cap.generate(...) : extractHeuristicPhrases(...)`；`useAutoEntityDetection.ts:29` `getCapability<AIScanCapability>('ai.scan')`（`?? noopUnsub`）；`quickPhraseHeuristic.ts` 为零 AI 依赖的本地实现 |
| `/api` 收口 | 断言 C **7 → 0**；`main.tsx:33` 走 `resolveApiUrl('health')` |
| `stores/index.ts` 铁律 | 仅 `export * from '@novel-plugins/data-core/stores'`；实体 store 定义唯一在 data-core |
| 无重复实现 | `layout/{BottomDrawer,RightSidebar}.tsx` 为 3–4 行再导出壳，实现在 `ui-kit`；`entities` 未复制 manual 的 `RelationGraph` |
| 模块 → kernel **深层相对逃逸 = 0** | 全量静态扫描：模块内相对路径逃出 `apps/web/` 的引用 **0 条**（模块对 kernel 的 `@/plugin/*`、`@/routes/*` 属允许方向） |
| 测试基线不退化 | 14 文件 / 182 用例，文件名与用例数与 D20 一致，**无删测**；vitest `include` 已纳入 `../plugins/**` 且排除其 `node_modules`（D41-附） |

---

## 3. Findings

### 🔴 F1（blocker）· 106 个相对路径垫片否证可分离性

- **问题**：`apps/web/src` 内 **106 个**单行文件形如
  `export * from '../../../../plugins/auto/workbench/web/discuss/ChatPanel';`
  （auto 45 / manual 61，按目录：`components/layout` 19、`components/knowledge` 12、`components/ai` 11、`services/ai` 11、`components/editor` 9、`hooks` 5、`stores` 5 …）。
  这些垫片（a）绕过模块**公开入口**直连内部实现；（b）使 kernel 树在**编译期**硬依赖两模块的内部文件。
  实测移除任一模块 → **type-check 53 / 62 错误**（§1.1）。
- **为何危险**：它把「kernel 只经模块入口引用模块」退化为「kernel 直连模块内部深层路径」，
  且**构建绿**给了「可分离」的假象——真实分离即编译失败。
- **requiredFix**：
  1. 删除这 106 个垫片（其中 **104 个无任何消费者**，见 F5，可直接删）；
  2. 仅剩的 2 个真实消费者改指**模块公开入口**或 shared 包：
     `apps/web/src/utils/characterMerge.ts` → 删（其唯一消费者是垫片自身链）或改 `@novel-plugins/manual-workbench/web`；
     `data-core/src/data/localUserData.ts:10` 见 F4；
  3. 修完后**必须**以「删除模块目录 + 重跑 type-check exit 0」作为可分离性证据（见 F3 修法）。

### 🔴 F2（blocker）· 门禁与预言机对 `export … from` 双重失明 →「全 0」是假阴性

- **问题**：门禁 `scripts/verify/verify-workbench-isolation.mjs:287` 与预言机
  `.workbuddy/split-workbenches/tools/captain-isolation-check.mjs:52` 使用同一正则：
  ```
  /(?:^|\n)[^\S\n]*import\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\(…\)|require\(…\)/g
  ```
  **不含 `export … from`**。实测该正则对垫片行 `match = false`；我自建的全量扫描（含 export）识别出 **106 条**被门禁漏掉的模块引用。
- **二次失明**：即使补上 export，`targetDomain()` 对相对路径走 `domainOfPath(resolveSpec(...))`，
  而 `../../../../plugins/auto/...` 规范化后为 `../../plugins/auto/...`，
  **既不匹配 `^components/…` 也不以 `apps/plugins/` 开头** → 判 `other` → **任何 EDGE_RULE 都不触发**。
  （`PKG_DOMAIN` 的 `/^apps\/plugins\/auto\//` 亦为 `false`。）
- **影响**：D15 验收 1（静态门禁三方向通过）**不成立**；D27 要求的「非空转反例」在**本类边**上从未被覆盖。
- **requiredFix**：
  1. 两处扫描器正则补 `export\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]…['"]`；
  2. 相对路径解析后**先还原为仓库根相对路径**（`path.relative(ROOT, resolvedAbs)`）再判域，
     使其命中 `apps/plugins/(auto|manual)/` 前缀；或直接对「解析后落入模块目录」的相对引用一律计 K2M/K2A/M2A/A2M；
  3. 增加**自证非空转**用例：临时注入 1 条 `export * from '../../plugins/auto/…'` 必须被抓到（验证后撤销）。

### 🟠 F3（high）· 断言 E 空转，不模拟移除，与实测矛盾

- **问题**：`verify-workbench-isolation.mjs:446` 的断言 E 执行
  `spawnSync('pnpm --filter @novel/web type-check', { cwd: ROOT })` —— **恒在真实树**运行，
  与 `WITHOUT` 无关。故 `--without auto --with-tests` 报「E passed」，
  而真实移除后 type-check 是 **exit 2 / 53 错误**。
- **影响**：E 是本轮「另一模块仍可用」的**主要机器判据**，它却对移除完全无感 ⇒ 验收证据链断裂。
- **requiredFix**：E 在 `WITHOUT` 非空时须对**模拟移除后的树**执行 type-check + 单测
  （可用 junction/临时目录方案，或先修 F1 后以「删除目录 → 跑 → 还原」流程），
  并在输出中显式标注「E 运行于 WITHOUT=<mod> 模拟树」。

### 🟠 F4（high）· 设计 §4 C2 的消解方案未落地：shared→auto 边仍在

- **问题**：`apps/plugins/shared/data-core/src/data/localUserData.ts:10`
  `import { useChatHistoryStore } from '@/stores/chatHistoryStore';`
  → kernel 垫片 `apps/web/src/stores/chatHistoryStore.ts`
  → `apps/plugins/auto/workbench/stores/chatHistoryStore`。
  即 **shared(data-core) → auto** 的真实运行时边（`:38 removeProject`、`:53 clearAll`）。
- **与设计不符**：设计 §4 行 C2 明确要求「**下沉 shared + 反转依赖**：改为 **kernel 事件** ——
  `clearAllLocalUserData()` 只清 kernel 自有 key，再 `emit('local-data.clear')` 由各模块自清」。
  实现**未采用**该方案，仍为直接 import。
- **门禁为何不报**：断言 A 的域对表无 `shared → auto` 组合；断言 A' 仅在 `--without manual` 且 `srcDom === 'auto'` 时生效，**不覆盖 shared 源**。
- **requiredFix**：按 §4-C2 落地 kernel 事件反转（或经 `ctx.getCapability` 取清理能力），消除 shared→auto 静态边；并在门禁补 `shared → module` 域对。

### 🟡 F5（medium）· 106 个垫片中 104 个是死代码（占 kernel 树 39%）

- **问题**：全量反向图（扫描 `apps/web/src` + 两模块 + 三 shared 包）显示：
  **仅 2 个垫片有消费者**（`components/knowledge/characterMerge.ts` ← `utils/characterMerge.ts`；
  `stores/chatHistoryStore.ts` ← `localUserData.ts`），**104 个零消费者**。
  其中 **17 个目录 100% 由垫片构成**（`components/{ai,consistency,editor,editor/extensions,editor/hooks,editor/panels,export,foreshadow,knowledge,notes,outline,series,snapshot,stats,timeline}`、`services/{ai,misc}`），共 **74 个纯垫片文件**。
- **影响**：t4 交付说明称「63 个旧路径 1 行 shim 保构建绿」，实际 **106 个**；
  它们既是 F1 的载体，也是误导后续判断的噪声。
- **requiredFix**：删除全部零消费者垫片；保留项逐一登记理由与删除条件（设计 §7.5 口径）。

### 🟡 F6（medium）· 垫片绕过断言 B（模块入口纪律）

- **问题**：断言 B 仅匹配 `^@novel-plugins/(manual|auto)-workbench` 形式的说明符；
  垫片用的是**相对深层路径**，故 B 恒为 0，无法发现「kernel 未走公开入口」。
- **requiredFix**：B 增加「kernel 域内相对/别名解析后落入 `apps/plugins/<mod>/workbench/web/**` 且**非** `web/index.tsx` 桶」的判定，
  或在 F1 修复后由「模块目录内不得存在 kernel 侧引用」统一覆盖。

### 🟢 F7（low）· 断言 D 仍未实现（已知）

`main.tsx:58` 的 `staticEntries` 仍为硬编码数组，`import.meta.glob` 已就位但无 `--without` 开关载体，
断言 D 输出「无法判定」。**属既定待办（D32-Q7/M1 后编码）**，本轮不作为缺陷，仅登记。

---

## 4. 验收判据对照

| 判据（D15 + t6 验收） | 实测 | 判定 |
|---|---|---|
| 静态门禁三方向通过 | exit 0，但系**假阴性**（F2） | ❌ |
| 非空判据（未拆分须失败） | t3 已证；但**不覆盖 export-from 类边** | ⚠️ 不充分 |
| 与预言机对拍一致 | 两者**同源失明**，一致地漏 | ⚠️ 不充分 |
| type-check exit 0（全量） | exit 0 | ✅ |
| `pnpm -r type-check` | 实现者报 exit 0（我未复跑全仓） | ⚠️ 部分 |
| test ≥182 且不删测 | 14 文件 / 182 全绿 | ✅ |
| **「任一模块缺席另一模块仍可用」** | **移除 auto 53 错误 / 移除 manual 62 错误** | ❌ **不成立** |
| 降级契约真实生效 | 已核实为真（`getCapability` 分支 + 启发式兜底） | ✅ |
| 归属矩阵落实 | 组件均已迁入模块；kernel 树残留为垫片（F1/F5） | ⚠️ 部分 |
| 未修改被评审代码 | 仅新增本报告 | ✅ |

---

## 5. 必须修复项（按优先级）

1. **F1 + F5**：删除 106 个相对路径垫片（104 个零消费者直接删；2 个改指模块公开入口）。
2. **F2**：门禁 + 预言机正则补 `export … from`，并修相对路径的域判定；补非空转自证。
3. **F3**：断言 E 改为在**模拟移除树**上跑 type-check + 单测。
4. **F4**：按设计 §4-C2 落地 kernel 事件反转，消除 shared→auto 边。
5. **F6**：断言 B 覆盖「kernel 经相对路径直连模块内部」。
6. 修复后**须以「删除模块目录 → type-check exit 0 + test ≥182 → 还原」作为可分离性证据**（t7 复核）。

**verdict = `needs_revision`**（含 2 条 blocker）—— 主体结构合格，但**可分离性未达成**，下游不得放行。