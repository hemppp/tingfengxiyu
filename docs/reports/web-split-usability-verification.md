# 模块可分离性与「另一模块仍可用」独立验证（t7 / round 1）

| 项 | 值 |
|---|---|
| 任务 | t7 — 验证：模块可分离性与「另一模块仍可用」独立验证 |
| 方法 | **不复用实现者结果**：自建沙箱（真实拷贝 + junction 依赖）、独立复跑门禁/type-check/单测/build/dev server |
| 判定口径 | **D44 第 1 条**：唯一合格证据 =「删除模块目录 → type-check exit 0 + test ≥182 → 还原」 |
| **结论** | **FAIL — 可分离性未达成**（两方向均硬失败） |
| 未改代码 | ✅ 验证前后仓库聚合 SHA256 **完全一致**（见 §6） |

---

## 0. 结论摘要

| 场景 | type-check | test | build | dev server | 判定 |
|---|---|---|---|---|---|
| **全量**（两模块俱在） | **exit 0** | **14 文件 / 182 通过** | **exit 0** | HTTP 200（:5174） | **实测通过** |
| **`--without auto`**（移除 auto 目录） | **exit 2 / 53 错误** | 10 文件 / 124 通过（exit 0） | **exit 1**（ENOENT） | dep-scan **ENOENT 失败** | **FAIL** |
| **`--without manual`**（移除 manual 目录） | **exit 2 / 62 错误** | 12 文件 / 170 通过（exit 0） | **exit 1**（ENOENT） | 未跑（对称，见 §5） | **FAIL** |

> **核心判据**：按 D44，移除任一模块后 type-check 必须 exit 0。实测 **53 / 62 个编译错误** ⇒ **可分离性不成立**。
> 本结论与 t6 评审（failed / needs_revision）及队长 D44 独立复现**同源一致**。

**⚠️ 另注**：`scripts/verify/verify-module-removal.mjs`（D44 第 1 条要求的证据脚本）**当前不存在** ⇒ D44 口径的自动化证据链**尚未落地**（§7）。

---

## 1. 场景一：全量基线（实测通过）

```powershell
pnpm --filter @novel/web type-check     # → exit 0
pnpm --filter @novel/web test           # → exit 0
```

原始输出：

```
$ tsc --noEmit
TYPECHECK EXIT=0

 Test Files  14 passed (14)
      Tests  182 passed (182)
   Duration  4.52s
TEST EXIT=0
```

**判定：PASS**（守住 D20 基线 14 文件 / 182 用例）。

---

## 2. 场景二/三：门禁三模式（复跑，但**不作为可分离性证据**）

```powershell
node scripts/verify/verify-workbench-isolation.mjs                  # exit 0
node scripts/verify/verify-workbench-isolation.mjs --without auto   # exit 0
node scripts/verify/verify-workbench-isolation.mjs --without manual # exit 0
```

三模式输出一致：

```
断言 D（构建期清单一致性）: 无法判定（main.tsx staticEntries 尚无 --without/环境变量开关载体；M1 定义后编码）
断言 E（基线不退化）: skipped — 未运行
✓ 门禁通过：0 违规、0 缺失（断言 E 未运行）
EXIT=0
```

**判定：门禁 exit 0 属实，但按 D44 第 1 条，「0 违规」不构成可分离性证据** ——
门禁是静态规则匹配，规则可失明（t6-F2 已证：正则不认 `export … from`，且相对路径解析后判 `other` 无规则可触发）。
故本节仅登记事实，**不据此判 PASS**。

---

## 3. 🔴 决定性场景：模块目录真实移除（FAIL）

### 3.1 方法（可复现）

沙箱 `%TEMP%\rev-t7b`：**真实拷贝**（非 junction）`apps/web/src` + 构建/测试配置 + `apps/plugins/{manual,auto}` + `shared/{data-core,ui-kit,ui-graph`，
依赖与 `@novel/*` 走 junction，`@novel-plugins/*` 指向沙箱内自身拷贝；
**删除模块目录**模拟分离。**全程未触碰仓库**（§6 哈希自证）。

> 沙箱内两处**仅沙箱**的配置微调（不影响判定，且不改仓库）：
> `cacheDir: './.vite-sandbox'`、`server.fs.allow: ['.','..','../..']`
> —— 未加此前 8 个 `../plugins/**` 测试文件因 vite `/@fs/` 根解析报
> `Cannot find module '/@fs/D:/Temp/...'`（**沙箱路径假象，非仓库缺陷**）；加上后沙箱基线恢复 14/182。

### 3.2 沙箱基线（对照）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0**（0 错误） |
| `vitest run` | **14 文件 / 182 通过，exit 0** |

⇒ 沙箱基线可复现真实基线，**差异仅由模块存在性导致**。

### 3.3 移除 `auto`

```powershell
Remove-Item -Recurse apps/plugins/auto            # 沙箱内
Remove-Item apps/web/node_modules/@novel-plugins/auto-workbench
cd apps/web; node <repo>/node_modules/typescript/bin/tsc --noEmit
```

```
TSC EXIT=2   errors=53
```

**原始错误（前 12 条）**：

```
../plugins/shared/data-core/src/data/localUserData.ts(10,10): error TS2305: Module '"@/stores/chatHistoryStore"' has no exported member 'useChatHistoryStore'.
src/components/ai/AgentSkillList.tsx(1,15): error TS2307: Cannot find module '../../../../plugins/auto/workbench/web/skills/AgentSkillList' ...
src/components/ai/AgentSkillsPanel.tsx(1,15): error TS2307: Cannot find module '../../../../plugins/auto/workbench/web/skills/AgentSkillsPanel' ...
src/components/ai/AiChatBubbleRail.tsx(1,15): error TS2307: Cannot find module '../../../../plugins/auto/workbench/web/discuss/AiChatBubbleRail' ...
src/components/ai/ChatPanel.tsx(1,15): error TS2307: Cannot find module '../../../../plugins/auto/workbench/web/discuss/ChatPanel' ...
src/components/ai/ContinueWriteModal.tsx(1,15): error TS2307: Cannot find module '../../../../plugins/auto/workbench/web/discuss/ContinueWriteModal' ...
src/components/ai/EntrySkillPanel.tsx(1,15): error TS2307: ...
src/components/ai/OutlineCheckModal.tsx(1,15): error TS2307: ...
src/components/ai/OutlineFillDialog.tsx(1,15): error TS2307: ...
src/components/ai/skillContextBuilder.ts(1,15): error TS2307: ...
src/components/ai/skillsConfig.ts(1,15): error TS2307: ...
src/components/ai/SkillSwitch.tsx(1,15): error TS2307: ...
```

**错误归因**：

| 归因 | 条数 |
|---|---|
| `apps/web/src` 旧路径垫片（`components|services|hooks|stores|utils`） | **52** |
| kernel 非垫片：`components/shell/ProjectLayout.tsx`（`:27`/`:36` 模块入口 + `:382-391` 参数隐式 any + `:607` props 不匹配） | **7**（其中 2 条为模块入口解析失败的下游连带） |
| shared 包：`data-core/src/data/localUserData.ts:10` → `@/stores/chatHistoryStore` | **1** |

**单测**：`vitest run` → **10 文件 / 124 通过，exit 0**（auto 的 4 个测试文件随目录消失：`workspaceStore`、`PipelinePanel`、`AgentSkillsPanel`、`SkillSwitch`，182−124=58 用例）。
> ⚠️ **注意**：单测 **exit 0** 并非「通过」——vitest 的 `include` glob 对不存在的目录**静默不匹配**，即**测试侧同样空转**；
> 唯一起作用的守卫是 **用例数阈值**（124 < 182）。这与 t6-F3（断言 E 恒跑真实树）是同一类盲区。

**判定：FAIL**（type-check exit 2 ≠ 0）。

### 3.4 移除 `manual`（对称）

```
TSC EXIT=2   errors=62
```

**原始错误（前 12 条）**：

```
src/App.tsx(26,40): error TS2307: Cannot find module '@novel-plugins/manual-workbench/web' or its corresponding type declarations.
src/components/consistency/ConsistencyPanel.tsx(1,15): error TS2307: Cannot find module '../../../../plugins/manual/workbench/web/consistency/ConsistencyPanel' ...
src/components/editor/BookScanDirectory.tsx(1,15): error TS2307: ...
src/components/editor/ChapterEditor.tsx(1,15): error TS2307: ...
src/components/editor/EditorPage.tsx(1,15): error TS2307: ...
src/components/editor/EditorPanelRail.tsx(1,15): error TS2307: ...
src/components/editor/extensions/AnnotationExtension.ts(1,15): error TS2307: ...
src/components/editor/extensions/CustomHighlight.ts(1,15): error TS2307: ...
src/components/editor/extensions/LeadCharacterHighlight.ts(1,15): error TS2307: ...
src/components/editor/extensions/MentionExtension.ts(1,15): error TS2307: ...
src/components/editor/extensions/RealtimeRhythm.tsx(1,15): error TS2307: ...
src/components/editor/FindReplaceBar.tsx(1,15): error TS2307: ...
```

**错误归因**：垫片 **61** + kernel 非垫片 **1**（`App.tsx:26` 模块公开入口解析失败）。

**单测**：**12 文件 / 170 通过，exit 0**（manual 的 2 个测试文件消失：`ChapterEditor`、`chapter`，182−170=12 用例）。

**判定：FAIL**（type-check exit 2 ≠ 0）。

### 3.5 恢复校验

沙箱内恢复 auto junction 后复跑 `tsc --noEmit` → **exit 0**（0 错误）。
⇒ 证明 53/62 错误**仅**由模块目录存在性导致，非沙箱环境差异。

---

## 4. 场景四：构建侧（两缺席模式均 FAIL）

### 4.1 全量构建（实测通过）

```powershell
pnpm --filter @novel/web build
```

```
dist/assets/vendor-react-BV4FLZ4g.js            671.55 kB
✓ built in 11.52s
BUILD EXIT=0
```

### 4.2 沙箱构建（移除 auto）

```powershell
cd <sandbox>/apps/web; node <repo>/node_modules/vite/bin/vite.js build
```

```
✓ 1171 modules transformed.
 ERROR  ✗ Build failed in 1.88s
 ERROR  error during build:
[vite:load-fallback] Could not load D:\Temp\rev-t7b\apps\plugins\auto\workbench\web\index.tsx
  (imported by src/components/shell/ProjectLayout.tsx): ENOENT: no such file or directory
SANDBOX BUILD (without auto) EXIT=1
```

### 4.3 沙箱构建（移除 manual）

```
ERROR  error during build:
[vite:load-fallback] Could not load D:\Temp\rev-t7b\apps\plugins\manual\workbench\web\index.tsx
  (imported by src/App.tsx): ENOENT: no such file or directory
SANDBOX BUILD (without manual) EXIT=1
```

**判定：FAIL** —— 两缺席模式**均无法构建**。脚本支持缺席构建（`vite build` 直接可跑），故**非「无法判定」**。

> **新发现（t6 未覆盖，超出垫片范围）**：即便垫片全部清除，kernel 仍存在 **2 处模块入口的硬编码字面量**：
> - `apps/web/src/components/shell/ProjectLayout.tsx:36` → `import('@novel-plugins/auto-workbench/web')`
> - `apps/web/src/App.tsx:26` → `import('@novel-plugins/manual-workbench/web')`
>
> 二者是 **rollup 静态可解析的说明符**，vite 在 `load-fallback` 阶段即尝试读取文件 → **ENOENT 硬失败**。
> `main.tsx:73-78` 的 `import.meta.glob` 已实现「模式目录自动收集」（对缺席优雅降级），但上述两处**绕过了该机制**。
> ⇒ 这是与 t6-F1 垫片**相互独立**的第二类可分离性阻断，**t29 若只删垫片不足以让 build 通过**。

---

## 5. 场景五：运行侧

### 5.1 全量 dev server（实测通过）

Node **v24.14.1**。

```powershell
pnpm --filter @novel/web dev
```

```
VITE v6.4.3  ready in 553 ms
  ➜  Local:   http://localhost:5174/
```

探针（注意：实际端口为 **5174**，非默认 5173）：

```
PORT 5173 -> unreachable
PORT 5174 -> HTTP 200  len=2046
  root div present: YES
```

**判定：dev server 可起（PASS）**。但「登录→书架→进入工作台」的**交互链路未验证**（需后端 + 浏览器自动化，本轮未具备）⇒ 该子项记为 **无法判定**。

### 5.2 移除 auto 的 dev server（FAIL）

```
VITE v6.4.3  ready in 608 ms
  ➜  Local:   http://localhost:5399/
ERROR  Error:   Failed to scan for dependencies from entries:
X [ERROR] ENOENT: no such file or directory, open
  'D:\Temp\rev-t7b\apps\plugins\auto\workbench\web\index.tsx' [plugin vite:dep-scan]
PORT 5399 -> HTTP 200 len=2046
```

**判定：FAIL**。⚠️ 此处 **HTTP 200 具有误导性**：返回的只是 `index.html` 静态外壳（len 2046，与全量一致），
**依赖预扫描已 ENOENT 失败**，应用实际不可用。**不得据 HTTP 200 判为通过**。

### 5.3 移除 manual 的 dev server

**判定：未运行**。理由：§4.3 已证 manual 缺席时 **build exit 1**，且 dev 侧与 auto 完全对称（同一 `load-fallback` 机制、
`App.tsx:26` 同一类硬编码入口），故按同源结论判 FAIL，但**明确标注为「未实测」**而非实测通过。

---

## 6. 未修改被验证代码（哈希自证）

验证**前**与验证**后**，对 `apps/web/src`、`apps/plugins/{manual,auto}/workbench`、`apps/plugins/shared`、`scripts/verify`
（排除 `node_modules`）逐文件 SHA256，再对「路径=哈希」清单做聚合 SHA256：

| 时点 | 文件数 | 聚合 SHA256 |
|---|---|---|
| 验证前 | 389 | `75E2316C5593BFA451B23E34DA9995C84EB700DC5318D85BFD2D290FFD87B593` |
| 验证后 | 389 | `75E2316C5593BFA451B23E34DA9995C84EB700DC5318D85BFD2D290FFD87B593` |

**⇒ 完全一致：零实现代码改动**（所有移除模拟均在 `%TEMP%` 沙箱内，且两模块目录、`web/index.tsx` 均完好）。
本任务产出**仅** `docs/reports/web-split-usability-verification.md`。

---

## 7. D44 证据链落地状态

| D44 要求 | 状态 |
|---|---|
| 唯一合格证据 =「删模块目录 → type-check exit 0 + test ≥182 → 还原」 | 口径已采用（本报告 §3） |
| 落成 `scripts/verify/verify-module-removal.mjs`（try/finally + 还原后文件数/字节校验） | ❌ **脚本不存在**（`Test-Path` = False） |
| auto / manual 各跑一次 | ❌ 无脚本，故无自动化证据；本报告以手工沙箱等价复现 |

**⇒ D44 第 1 条的自动化证据链尚未落地**，t29 修复后需一并交付该脚本，t30 复验时按脚本实际 exit code 与 test 计数报告。

---

## 8. 判定汇总

| # | 场景 | 命令 | 结果 | 判定 |
|---|---|---|---|---|
| 1 | 全量 type-check | `pnpm --filter @novel/web type-check` | exit 0 | **实测通过** |
| 2 | 全量 test | `pnpm --filter @novel/web test` | 14 文件 / 182 通过，exit 0 | **实测通过** |
| 3 | 门禁三模式 | `verify-workbench-isolation.mjs [--without auto\|manual]` | exit 0 ×3 | 事实登记（**非合格证据**，D44-1） |
| 4 | 移除 auto type-check | 沙箱删目录 + `tsc --noEmit` | **exit 2 / 53 错误** | **FAIL** |
| 5 | 移除 auto test | 沙箱 `vitest run` | 10 文件 / 124 通过，exit 0 | **FAIL**（124 < 182；exit 0 系 glob 空转） |
| 6 | 移除 manual type-check | 沙箱删目录 + `tsc --noEmit` | **exit 2 / 62 错误** | **FAIL** |
| 7 | 移除 manual test | 沙箱 `vitest run` | 12 文件 / 170 通过，exit 0 | **FAIL**（170 < 182） |
| 8 | 全量 build | `pnpm --filter @novel/web build` | exit 0，built in 11.52s | **实测通过** |
| 9 | 移除 auto build | 沙箱 `vite build` | **exit 1**（ENOENT auto 入口） | **FAIL** |
| 10 | 移除 manual build | 沙箱 `vite build` | **exit 1**（ENOENT manual 入口） | **FAIL** |
| 11 | 全量 dev server | `pnpm --filter @novel/web dev` | HTTP 200 @5174 | **实测通过** |
| 12 | 登录→书架→工作台交互 | 需后端 + 浏览器自动化 | 未运行 | **无法判定** |
| 13 | 移除 auto dev server | 沙箱 `vite --port 5399` | dep-scan **ENOENT**（HTTP 200 仅为静态外壳） | **FAIL** |
| 14 | 移除 manual dev server | — | 未实测（按 §4.3 同源判 FAIL） | **未实测** |
| 15 | 未改实现代码 | 聚合 SHA256 前后比对 | 完全一致 | **实测通过** |

---

## 9. 结论

**FAIL —— 「任一模块关闭/分离后另一模块仍完全可用」未达成。**

- **type-check**：移除 auto **53 错** / 移除 manual **62 错**（要求 exit 0）。
- **build**：两缺席模式均 **exit 1**（ENOENT 模块入口）。
- **dev server**：移除 auto 时 dep-scan ENOENT（HTTP 200 具误导性）。
- **根因（两类，相互独立）**：
  1. `apps/web/src` **107 个旧路径垫片**（`export * from '../../../../plugins/{auto,manual}/…'`）——t6-F1；
  2. **2 处模块入口硬编码字面量**（`ProjectLayout.tsx:36`、`App.tsx:26`）绕过 `main.tsx` 的 `import.meta.glob` 优雅降级机制 —— **本报告新增**。
  另含 `data-core/src/data/localUserData.ts:10` 的 **shared→auto** 残留边（t6-F4）。
- **盲区提示**：单测在模块缺席时 **exit 0**（glob 静默不匹配），与断言 E 同属空转；唯一起作用的守卫是**用例数阈值**。

**建议**：t29 修复须**同时**清除垫片与硬编码入口（仅删垫片不足以让 build 通过），并交付 `verify-module-removal.mjs`；t30 以该脚本实际 exit code + test 计数为准复验。

**未把任何未运行项写成通过**（§5.3、§8#12、#14 均显式标注「未实测 / 无法判定」）。