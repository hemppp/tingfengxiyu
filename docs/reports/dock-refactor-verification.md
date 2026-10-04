# 停靠（Dock）重构 · t4 端到端独立验证报告

| 项 | 值 |
|---|---|
| 任务 | t4 端到端验证：停靠系统 8 项能力 + 构建产物 + 中心槽可达性 + 跨平台 |
| attempt_id | `919bf226-4381-4ed0-98bf-b1f9a9ff604a` |
| 仓库根 | `F:\new1.2` |
| 验证者 | verify-eng（t4） |
| 验证日期 | 2026-10-02 |
| 唯一交付物 | `docs/reports/dock-refactor-verification.md`（本文件） |
| 源码改动 | **零**（本报告未修改任何产品源码；全部验证为只读 + 仓库外/`.verify-scratch/` 影子脚本） |

> **独立复测声明**：本报告的全部结论均由 t4 在 `F:\new1.2` 现场重跑得出，**不是**转述团队一号或 reviewer 的既有结论。
> 凡引用他人结论处均单独标注「（转述基线，已独立复测）」或「（转述基线，未复测）」。
> 无法自动化的交互项一律标 **「需人工确认」** 并给出人工核对步骤，**不伪造通过**。

---

## §0 结论速览

### 0.1 八项能力

| # | 能力 | 结论 | 自动化程度 |
|---|---|---|---|
| 1 | 多 Dock Panel（面板由外部 props 注入） | ✅ 通过 | 全自动（源码 + 单测 + 产物） |
| 2 | 拖拽标题栏 → Floating Dock（可再拖回） | ✅ 通过（代码路径）/ ⚠️ 手感需人工 | 半自动 |
| 3 | 上/下/左/右四个 Dock Area + 中心编辑区，可吸附任一区 | ✅ 通过 | 半自动（落位逻辑全自动；吸附手势需人工） |
| 4 | Tabbed Dock Group（同组多标签堆叠、拖出/拖入重组） | ✅ 通过（代码路径）/ ⚠️ 拖拽重组需人工 | 半自动 |
| 5 | Dock Preview Indicator（拖拽落点预览框） | ✅ 通过（样式与变量已接线）/ ⚠️ 视觉需人工 | 半自动 |
| 6 | 中心画布可替换（关系图抢占中心区） | ✅ **通过** | **全自动**（真实浏览器实测：活动栏点击 → 打开 → 重复点击幂等 → 关闭回落，`plainRelationGraph=0`；见 §5.5） |
| 7 | Dock Splitter（拖动调整大小） | ✅ 通过（sash 选择器与变量已接线）/ ⚠️ 拖动手感需人工 | 半自动 |
| 8 | 深色主题 + Windows/Linux 跨平台可用 | ✅ 通过（源码级跨平台洁净度全自动；**Linux 运行时未实测**，标「需人工确认」） | 半自动 |

### 0.2 验收命令

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm --filter @novel/web type-check` | **0** | 通过 |
| `pnpm --filter @novel/web lint` | **0** | 0 errors / **1 warning**（基线 1，既存） |
| `pnpm --filter @novel/web build` | **0** | 通过，`✓ built in 10.10s` |
| `pnpm --filter @novel/web test` | **0** | **12 files / 153 passed**（基线一致） |
| `node scripts/verify/verify-all.mjs` | **0** | `✅ verify-all 全过` |
| `node scripts/verify/verify-plugin-mode-separation.mjs` | **0** | `✅ verify-plugin-mode-separation 全过` |
| `node scripts/verify/verify-theme-single-source.mjs` | **0** | `✅ 主题单一真源不变量全部成立`（真源 117 令牌；副本 0 定义） |
| `node scripts/e2e/e2e-mode-separation.mjs` | **0** | `✅ e2e-mode-separation 全过`（干净标签页条件下；见 §7.6） |
| `scripts/e2e/e2e-core-flows.mjs` | 1 | **38/39 通过**；唯一失败项已定性为**既存缺陷、非停靠重构回归**（见 §7.2–7.5） |

### 0.3 构建产物

| 判据 | 结论 |
|---|---|
| `apps/web/dist` 已生成 | ✅ |
| `ProjectLayout-*.js` 含 `dockview` ×69 / `dv-theme-vscode` ×2，437530 B | ✅ 独立复测命中 |
| CSS 令牌：**同一 chunk 内不重复 + 各 chunk 值一致** | ✅ 通过（**旧判据「全 dist 恰好 1 次」会误判失败**，见 §3.3） |
| `shuimo` / `ink-wash` 残留 | ✅ 0 |

### 0.4 中心槽可达性（能力 6 的闭环）

✅ **通过 —— 已在真实浏览器实测**，不只是单测。`activeCenterKey` 已由「已打开面板 ∩ `resolveDockMeta(def).center`」派生（非硬编码 null），关闭后回落 null；内核侧同一业务 key 仅 1 个实例且只经 `nm-center:<key>` 渲染。

真实浏览器 raw-CDP 探针（DOM `[data-tab-panel-id]` 计数，**不用 `listPanels()`**，见 §5.5）：

```
初始                all=["nm-center-default"]
开「关系图」         all=["nm-center-default","nm-center:relationGraph"]   plainRelationGraph=0
再点一次（幂等）     all 完全不变                                          plainRelationGraph=0
关闭后              all=["nm-center-default"]                            ← 无残留
RESULT = PASS（可达 / 恰好 1 实例无普通孪生 / 重复打开幂等 / 关闭无残留）
```

`plainRelationGraph=0` 即 **「双实例缺陷已闭环」的现场证据**。详见 §5。

### 0.5 需要单独记录的事项

| 类别 | 数量 | 位置 |
|---|---|---|
| 已裁定 ADR 偏离（**只登记，不判失败**） | 3 | **§8** |
| 残余风险（既存，非本次引入） | 3 | **§8.3**（`--ink-deep` / `--ink-soft` 悬挂）+ **§10.6**（静默丢数据 F-F） |
| 新登记 findings | 6（F-A…F-F，含 1 项「高」） | **§10** |
| **需人工确认**项 | 6 | **§9** |
| e2e 角色持久化失败（**非停靠重构回归**） | 1 | **§7.5** |

**findings 一览**：F-A 注释与 dockview 行为不符（低）｜F-B `addPanel` 参数重复硬编码（低）｜F-C `onActivitySelect` 隐式依赖（低）｜F-D `[aria-label="设置"]` 全仓非唯一（低）｜F-E e2e 夹具附着遗留标签页致假失败（中）｜**F-F 写请求超时被静默吞掉 ⇒ 静默丢数据（高，既存）**。

> **总判定**：停靠重构基线**通过**独立复测；**未发现本次重构引入的功能缺陷**。详见 §11。

---

## §1 验证环境与前置条件

### 1.1 前置检查（captain 要求）

| 检查项 | 结果 |
|---|---|
| `Test-Path apps\web\src\components\shell\DockShellReverted.tsx` | **False**（reviewer 证伪副本已清理） |
| `Test-Path apps\web\src\components\shell\__scratch__` | **False**（已清理） |
| `DockShell.tsx` 正品大小 | **24715 B** ✅ |

> **说明**：t4 开工早期（约 11:5x）曾测得上述两项为 `True`；captain 于 13:15 前通报 reviewer 已自行清理，t4 复测为 **False/False**。本报告按**清理后**的实际状态记录：**验证收尾时工作区不含任何证伪副本**。
> 全部不变量核对均读取正品 `apps/web/src/components/shell/DockShell.tsx`（24715 B），**未**依据任何回退副本下结论。

### 1.2 三文件哈希基线交叉核对（captain attestation vs t4 独立复算）

| 文件 | t4 独立 SHA256 | 大小 | 与 captain attestation |
|---|---|---|---|
| `apps/web/src/components/shell/DockShell.tsx` | `AFE36EFCD83A3BCC88EFB41850F2AD7F213682F92B68E8EC860D7B319BA2C205` | 24715 B | ✅ 逐字节一致 |
| `apps/web/src/components/shell/dock/DockShell.smoke.test.tsx` | `309663DE6A56E03500A293BF2E1B73AE2DBFAEB19FE029BD2BD6C3991407C190` | 15828 B | ✅ 逐字节一致 |
| `apps/web/src/components/shell/dock/layout.ts` | `59EFD75CBC826F379C4340AF66D8822BDCC5D6DE1E096DE997EFF181839D0C48` | 6454 B | ✅ 逐字节一致 |

⇒ **验证期间无未登记写入**。（命令：`Get-FileHash -Algorithm SHA256`）

### 1.3 服务栈自建（三项前置原先全部未运行）

e2e 依赖三项外部条件，t4 开工时**全部不可用**，由 t4 自行拉起：

| 组件 | 命令要点 | 结果 |
|---|---|---|
| 后端 | `apps/server` → `node ..\..\node_modules\tsx\dist\cli.mjs src\index.ts` | `:3774` `/api/health` = `{"status":"ok","database":"connected","pluginStandard":"1.0.0","hostMode":"all"}`，**27/27 插件 ok** |
| 前端 | `apps/web` → `vite --port 5174 --strictPort --host 127.0.0.1` | `:5174` 200（e2e 默认端口） |
| 浏览器 | `chrome.exe --headless=new --remote-debugging-port=9222` | `Chrome/154.0.8037.92`，CDP protocol 1.3 |

Node 运行时：`D:\ruanjian\node.24\node.exe` = **v24.14.1**（`better-sqlite3` 需 ABI 137，故必须 Node 24）。

### 1.4 e2e 必需的两个 CDP 调用（环境性，非产品缺陷）

`Emulation.setFocusEmulationEnabled {enabled:true}` + `Page.setWebLifecycleState {state:'active'}`。
无头/后台标签页下若不注入，应用**永不挂载**、`/api/projects` 永不发出。两个 e2e 脚本均已在 `:229-230` 注入并断言 `visibilityState==='visible' && hasFocus`。

---

## §2 验收命令实测输出

全部命令在 `F:\new1.2` 现场执行，以下为**原始输出摘要**。

### 2.1 `pnpm --filter @novel/web type-check`

```
$ tsc --noEmit
EXIT=0
```

### 2.2 `pnpm --filter @novel/web lint`

```
EXIT=0
✖ 1 problem (0 errors, 1 warning)
F:\new1.2\apps\web\src\components\shell\DockShell.tsx
  360:5  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
0 errors and 1 warning potentially fixable with the --fix option.
```

⇒ **警告数 = 基线 1**，未因本轮重构增加。

### 2.3 `pnpm --filter @novel/web build`

```
EXIT=0
✓ built in 10.10s
dist/assets/ProjectLayout-BE5p2nO0.js   437.53 kB
dist/assets/vendor-react-QuO_6Ew3.js    671.57 kB
dist/assets/vendor-three-ClSjaZe6.js    562.54 kB
dist/assets/vendor-editor-DnYt0fo_.js   297.13 kB
dist/assets/index-_34EEzhp.js           127.50 kB
dist/assets/index-BsIP0eYk.js           100.93 kB
dist/assets/BookshelfPage-DA84Ipw8.js    48.87 kB
dist/assets/RelationGraph-BVL1cM0i.js    24.34 kB
dist/assets/CharacterManager-CAMA96mU.js 12.32 kB
```

> **决定性事实**：重新构建产出的 `ProjectLayout-BE5p2nO0.js` **哈希与体积与既有产物完全相同**（437.53 kB）⇒ 构建是确定性的，且既有 `dist/` 确实对应当前源码（不存在「产物陈旧」的假通过）。

### 2.4 `pnpm --filter @novel/web test`

```
EXIT=0
Test Files  12 passed (12)
     Tests  153 passed (153)
  Duration  7.13s
```

与 captain 修正后基线 **12 files / 153 passed** 完全一致：
- 文件数保持 **12** ⇒ 无探针泄漏进收集范围（若为 13 即为异常）。
- `src/components/shell/dock/DockShell.smoke.test.tsx` = **17 tests**（含 5 个中心槽回归用例）。
- `src/plugin/__tests__/plugin-dock-adaptation.test.ts` = **12 tests**（149→153 的 4 个新增用例）。

**单文件显式路径复跑**（captain 更正后的用法，无需 `--config vitest.probe.config.ts`）：

```
pnpm --filter @novel/web exec vitest run src/components/shell/dock/DockShell.smoke.test.tsx
→ ✓ src/components/shell/dock/DockShell.smoke.test.tsx (17 tests) 2684ms
     ✓ center 面板同时在 openKeys 与 activeCenterKey 中 ⇒ 恰好 1 个实例、无重复 key  302ms
     ✓ activeCenterKey 置回 null ⇒ 移除 center 实例并回落到默认出口；再置回仍恰好 1 个  827ms
     ✓ openPanel 对已抢占的 center 面板幂等（重复调用不新增实例）  808ms
→ Test Files 1 passed (1) / Tests 17 passed (17) / EXIT=0
```

> 逃生舱 `vitest.probe.config.ts` **仅**适用于被 exclude 的探针命名（`__scratch__/**`、`__scratch_*`）；普通测试文件直接用显式路径即可。

### 2.5 `node scripts/verify/verify-all.mjs`

```
✓ manifest 合法性门禁通过：5 个真实 plugin.json 全部通过 G0（真实 validateManifest）/ G1（入口文件存在）/ G2（id 尾段==目录名）/ Web 入口 name==id。
✅ verify-all 全过
EXIT=0
```

### 2.6 `node scripts/verify/verify-plugin-mode-separation.mjs`

```
✓ 目录 manual + modes=[manual] → 通过（status=ok）
✅ verify-plugin-mode-separation 全过
EXIT=0
```

### 2.7 `node scripts/verify/verify-theme-single-source.mjs`

```
· apps/web/tailwind.config.js：90 处 var(--vscode-*) **引用**，0 处定义（引用不算定义 —— 分类规则生效）
✅ 主题单一真源不变量全部成立
   唯一真源: apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css
   副本转发: apps/web/src/components/shell/dock/dock-tokens.css（0 定义，纯 @import）
EXIT=0
```

补充数据：真源 = 117 行定义 / 117 唯一 token；副本 `dock-tokens.css` = **0 定义**（要求 0）、0 字面色值、含 `@import`；全仓 **421** 文件扫描 → 117 个 `--vscode-*` 定义，全部在白名单内，白名单外 0。

> **该文件计数随现场临时产物漂移，属正常现象、非缺陷**（captain 追加）：`verify-theme-single-source.mjs` 从**仓库根**递归扫描（`SCAN_EXTS` 含 `.css/.scss/.sass/.less/.ts/.tsx/.js/.jsx/.mjs/.cjs/.html/.vue/.svelte`，`SKIP_DIRS` = `node_modules/dist/build/.git/.workbuddy/coverage`），故 `docs/`、`scripts/`、以及现场临时产物（`.verify-scratch/`、`.tmp_*`）都会计入。实测快照：本报告 **421**（t4 运行时）→ t5 **432** → captain 复核 **433**（含 `.tmp_b410e32_ProjectLayout.tsx` 1 + `.verify-scratch/` 44）。**关键不变量（白名单内 117 / 白名单外 0）在三个快照下完全一致**，故该数字不用于任何判定。

### 2.8 `node scripts/e2e/e2e-mode-separation.mjs`

```
✓ 登录成功（离开 /login） — path=/bookshelf
✓ 创建 manual 项目 — {"status":201,"id":"daa5c4b0-…","mode":"manual"}
✓ 创建 auto 项目 — {"status":201,"id":"5b40f2e2-…","mode":"auto"}
✓ manual 项目出现手写台停靠外壳标记（面板菜单 + 活动栏） — 命中 2/2: {"面板菜单":true,"活动栏":true}
✓ manual 项目**不出现** AI 写作 UI（状态栏/智能体对话/编辑器标签） — 误现 0 个
✓ auto 项目渲染 <WorkbenchMissing/>（工作台未安装占位） — text="AI 写作台未安装\n该创作模式对应的模块未启用。启用后刷新即可使用。"
✓ 占位文案点明「AI 写作台未安装」
✓ auto 项目**不出现** AutoWriteWorkbench 标记（实现已移出，0/3） — 命中 0/3
✓ auto 项目**不出现**手写台停靠外壳（面板菜单/活动栏） — 误现 0 个
✓ 全流程 console 错误为 0（consoleAPICalled type=error + exceptionThrown） — 0 条
✅ e2e-mode-separation 全过
EXIT=0
```

> ⚠️ 该脚本**首次运行曾出现 1 项失败**（`console 错误为 0 — 15 条`），根因已定位为**测试壳环境产物**（陈旧标签页的 console 缓冲重放），**非产品缺陷**。完整证据链见 **§8**。

---

## §3 构建产物独立复测

### 3.1 `dist` 生成与新鲜度

- `apps/web/dist` 已生成；`dist/index.html` 与 `ProjectLayout-BE5p2nO0.js` mtime **2026/10/2 11:50:49**，晚于最新源码 `apps/web/src/styles/landing.css`（11:37:08）、`globals.css`（11:36:48）、`DockShell.tsx`（11:32:21）⇒ **产物对应当前源码**。
- 更强的证据：t4 自行 `pnpm build` 后，`ProjectLayout-BE5p2nO0.js` **哈希/体积不变**（437.53 kB）⇒ 确定性构建，不存在陈旧产物。

### 3.2 DockShell 真实接入证据（关键判据）

在 `apps/web/dist/assets/ProjectLayout-BE5p2nO0.js`（437530 B）中独立计数：

| 串 | 命中 | 期望 | 结论 |
|---|---|---|---|
| `dockview` | **69** | ≈69 | ✅ 真实接入 |
| `dv-theme-vscode` | **2** | 2 | ✅ 真实接入 |
| `nm-center` | 4 | ≥1 | ✅ 中心槽实例 id 进产物 |
| `nm-panel` | 2 | ≥1 | ✅ 普通实例 id 进产物 |
| `shuimo` | **0** | 0 | ✅ |
| `ink-wash` | **0** | 0 | ✅ |

**判据意义**：若 DockShell 未被真实接线（未被 import），该 chunk 会被 Vite tree-shake，`dockview` 与 `dv-theme-vscode` 不可能出现在 `ProjectLayout-*.js` 中。69/2 的命中量级证明内核**确实被打进宿主 chunk 并执行**。

全 `dist` 递归扫描（82 个文件）`shuimo|ink-wash` = **0 残留文件**。

### 3.3 CSS 令牌判据 —— **旧判据会误判失败**

**原合同判据**（`docs/architecture/dock-refactor-final.md` §5 产物判据表）：「构建 CSS 中 `--vscode-editor-background` 定义次数 = **恰好 1 次**」。
**captain 裁定该判据错误**：Vite 按 chunk 切分 CSS，**每个 chunk 各带一份是正常的**，按「全 dist 只出现 1 次」判会得到**假失败**。

**t4 独立复测**（正则分别统计「定义」与 `var()` 使用，逐 chunk）：

| chunk | 字节 | 定义数 | `var()` 使用 | 定义值 | chunk 内唯一 |
|---|---|---|---|---|---|
| `index-jxLsSZrK.css` | 176146 | **1** | 2 | `hsl(220 13% 13%)` | ✅ |
| `ProjectLayout-CwE2_LDR.css` | 154040 | **1** | **12** | `hsl(220 13% 13%)` | ✅ |
| `LandingPage-3Vt8Qvfx.css` | 9901 | 0 | 0 | — | ✅ |
| `vendor-react-BZV40eAE.css` | 15851 | 0 | 0 | — | ✅ |

**正确判据与结论**：

1. **同一 chunk 内不重复** ⇒ ✅ 四个 chunk 全部满足（各 chunk 定义数 ≤ 1）。
2. **各含定义的 chunk 值一致** ⇒ ✅ 跨 chunk 去重后定义值集合 = `["hsl(220 13% 13%)"]`，**唯一**。
3. ⇒ **判据通过**。

**假失败演示**（独立脚本 `.verify-scratch/verify-artifacts.mjs` 的显式报告）：
```
original "exactly 1 in all of dist" would report: 2 occurrences -> FALSE FAILURE
```
即：全 dist 实际出现 **2** 次（`index-*` 1 次 + `ProjectLayout-*` 1 次）。按旧判据会判「不恰好 1 次」→ **失败**；按修正判据 → **通过**。

> 旁证：`ProjectLayout-CwE2_LDR.css` 有 **12** 处 `var(--vscode-editor-background)` 使用 ⇒ 该 chunk **真实消费**该令牌，不是「只定义不使用」的死定义。

---

## §4 八项能力逐项证据

> 判定口径：**源码锚点 + 构建产物 + 可自动化运行时证据**三者齐备才判 PASS。
> 纯鼠标交互（拖拽标题栏、拖拽分栏、拖拽 tab、悬停落位预览）**无法在 headless 环境稳定自动化**，
> 一律标 **「需人工确认」** 并给出人工核对步骤，**不伪造为通过**。

### 4.1 能力 1 —— 多停靠面板来自外部 props（内核不硬编码任何业务面板）

| 判据 | 证据 | 结论 |
|---|---|---|
| 内核不出现业务 key | `DockShell.tsx` 中 `characters` / `relationGraph` / `outline` / `knowledge` / `timeline` / `storyMap` / `locations` / `quickPhrase` / `foreshadows` / `factions` 计数**各为 0** | ✅ |
| 唯一疑似命中已排除 | `items` 出现 5 次，全部是**通用** `ActivityBar` 入参（`:193 items,`、`:197 items: { key: string; label: string; icon: React.ComponentType<{ size?: number }> }[];`、`:203 {items.map((it) => {`、`:551 <ActivityBar items={activityItems} … />`），**不是业务 key** | ✅ |
| 面板集合来自 props | `DockShell.tsx:257` `const { panels, centerDefault, activeCenterKey, openKeys, onOpenChange, onActiveChange } = props;` | ✅ |
| 受控优先 | `DockShell.tsx:278` `if (openKeys) return openKeys;`（受控态下渲染完全由宿主决定） | ✅ |
| 宿主真实传参 | `ProjectLayout.tsx:434-437` 传 `centerDefault={<Outlet />}`、`activeCenterKey={activeCenterKey}`、`openKeys={openPanelKeys}` | ✅ |

**结论：PASS。** 内核是纯壳，业务面板集合全部由外部注入。

### 4.2 能力 2 —— 标题栏拖拽 → 浮窗，并可拖回

| 判据 | 证据 | 结论 |
|---|---|---|
| 允许浮窗组 | `DockShell.tsx:573` `disableFloatingGroups={false}` | ✅ |
| 拖拽把手 = 标题栏 | `DockShell.tsx:574` `floatingGroupDragHandle="titlebar"` | ✅ |
| 浮窗 API | `DockShell.tsx:492` `floatPanel(key)`；`:500` `a.addFloatingGroup(p, {`（尺寸取 `resolveDockMeta` 的 `floatingSize`） | ✅ |
| 停靠回位 API | `DockShell.tsx:505` `dockPanel(key, slot)`；`:512` `p.api.moveTo({ position: slotToPosition(slot) });` | ✅ |
| 双通道暴露 | `DockShell.tsx:519/:520` 两次 `useImperativeHandle`（`ref` + `props.apiRef`） | ✅ |
| 构建产物含浮窗实现 | `ProjectLayout-BE5p2nO0.js` 中 `dockview` 出现 **69** 次、`dv-theme-vscode` **2** 次（未接线会被 tree-shake 掉） | ✅ |

**拖拽行为本身：需人工确认。** 人工核对步骤：
1. `pnpm --filter @novel/web dev`（或 `start-dev.cmd`），登录后进入任一 **manual** 项目；
2. 在右侧停靠区打开一个面板（如「角色」），**按住其标签页/标题栏拖动**；
3. 期望：出现浮窗，且浮窗可自由移动、可缩放；
4. 把浮窗**拖回**停靠区任意槽位；
5. 期望：面板重新停靠回该槽，无残影、无重复实例。

### 4.3 能力 3 —— 四个停靠区 + 中心编辑区

| 判据 | 证据 | 结论 |
|---|---|---|
| 槽位类型 | `dock/types.ts` `type DockSlot = 'center' | 'left' | 'right' | 'bottom'` | ✅ |
| 唯一方向换算点 | `dock/layout.ts:30` `slotToDockDirection(slot: DockAreaSlot): DropDirection`（`bottom` → `'below'`，其余恒等） | ✅ |
| 落位映射 | `dock/layout.ts:110-111` 中心用 `{ direction: 'within', referencePanel: anchorId }`，其余用 `slotToDockDirection(slot)` | ✅ |
| 中心布尔优先于 slot | `dock/layout.ts:68` `const slot: DockSlot = meta.center ? 'center' : meta.slot;` | ✅ |
| 默认尺寸 | `layout.ts:117` `spec.initialWidth = DOCK_SIDE_PANEL_DEFAULT_WIDTH;`（320）、`:119` `spec.initialHeight = DOCK_BOTTOM_PANEL_DEFAULT_HEIGHT;`（240） | ✅ |
| 内核调用 | `DockShell.tsx:320/335/384/435/459/470` `dock.addPanel({…})`；`:621-622` `position: { direction: slot === 'center' ? ('within' as const) : slotToDockDirection(slot), … }` | ✅ |
| 四区 DOM 齐备 | `:554` 侧边栏、`:562` 编辑区、`:582` 辅助侧栏、`:590` 底部面板区 | ✅ |

**结论：PASS（源码 + 产物）。** 四个停靠区与中心编辑区均可达。

### 4.4 能力 4 —— 同组标签堆叠 + `dock.closable` 生效

| 判据 | 证据 | 结论 |
|---|---|---|
| 自定义 tab 渲染器 | `DockShell.tsx:134` `const DOCK_TAB_COMPONENT_ID = 'dock:tab';`、`:143` `function DockTab(props: IDockviewPanelHeaderProps<DockPanelParams>)`、`:184` `[DOCK_TAB_COMPONENT_ID]: DockTab` | ✅ |
| × 遵循 `closable` | `DockShell.tsx:155` `{meta?.closable !== false ? (` ⇒ 只有 `closable !== false` 才渲染关闭按钮 | ✅ |
| 注册渲染器 | `DockShell.tsx:568` `defaultTabComponent={DockTab as never}` | ✅ |
| 单 tab 全宽 | `DockShell.tsx:575` `singleTabMode="fullwidth"` | ✅ |
| 同组堆叠 | dockview 原生 Tabbed Group（`addPanel` 落同一 group 即成 tab） | ✅ |
| 回归用例 | `DockShell.smoke.test.tsx` 17 用例全过（独立单文件复跑：1 file / 17 passed / EXIT=0） | ✅ |

**结论：PASS。** 标签堆叠与关闭按钮可见性均由 `closable` 驱动。

### 4.5 能力 5 —— 拖拽落位指示器

| 判据 | 证据 | 结论 |
|---|---|---|
| 落位填充色 | `dock/dock-theme.css:57` `--dv-drag-over-background-color: var(--vscode-panel-dropBackground);` | ✅ |
| 落位描边色 | `:58` `--dv-drag-over-border-color: var(--vscode-focusBorder);`、`:59` `--dv-drag-over-border: 2px solid var(--vscode-focusBorder);` | ✅ |
| 选择器覆盖 | `:98-100` `.dv-theme-vscode .dv-drop-target` / `.dv-drop-target-selection` / `.dv-drop-target-container .dv-drop-target-anchor`；`:105` `.dv-drop-target > .dv-drop-target-selection`；`:112` `.dv-tabs-container .dv-drop-target-selection` | ✅ |
| 视觉样式落地 | `:106` `border: 2px solid var(--vscode-focusBorder);`、`:107` `background-color: var(--vscode-panel-dropBackground);` | ✅ |
| 令牌真源存在 | `vscode-dark-modern.css` 定义 `--vscode-panel-dropBackground` / `--vscode-focusBorder`（`verify-theme-single-source.mjs` EXIT=0，117 令牌全在白名单内） | ✅ |
| 无重复实现 | `project-shell.css` **无** drop-target / drag-over 选择器 | ✅ |

**拖拽预览的可见性：需人工确认。** 人工核对步骤：
1. 打开一个 manual 项目并打开 2 个以上面板；
2. 按住一个面板标签页开始拖动，**不要松手**；
3. 期望：目标停靠区出现**半透明填充 + 2px 高亮描边**的落位预览块，且圆角为 0（VS Code 观感）；
4. 拖到中心区与拖到侧边区的预览块位置应分别对应编辑区/侧栏；
5. 松手后预览块消失，面板落入该槽。

### 4.6 能力 6 —— 中心可替换槽位

见 **§5 中心槽闭环**（独立复测含真实浏览器探针）。

### 4.7 能力 7 —— 可拖拽分栏（sash）

| 判据 | 证据 | 结论 |
|---|---|---|
| sash 底色 | `dock/dock-theme.css:53` `--dv-sash-color: var(--vscode-splitter-background);` | ✅ |
| sash 悬停色 | `:54` `--dv-active-sash-color: var(--vscode-sash-hoverBorder);` | ✅ |
| 圆角 | `:47` `--dv-sash-border-radius: 0px;` | ✅ |
| 悬停/拖拽态样式 | `:123-125` `.dv-theme-vscode .dv-sash-container .dv-sash:not(.disabled):hover, …:active { background-color: var(--vscode-sash-hoverBorder); }` | ✅ |
| dockview@8.4.0 真实 DOM 结构 | 注释 `:49-52` / `:118-119` 记录 sash 仅存在于 `.dv-split-view-container .dv-sash-container .dv-sash` | ✅ |
| 无重复实现 | `project-shell.css` **无** sash 选择器 | ✅ |

**拖动分栏本身：需人工确认。** 人工核对步骤：
1. 打开 manual 项目，令左侧栏 + 中心编辑区同时存在；
2. 把鼠标移到两者之间的分隔条上；
3. 期望：分隔条高亮为 `--vscode-sash-hoverBorder` 色；
4. 按住拖动，期望两侧宽度实时变化、松手后保持；
5. 把宽度拖到极窄，期望不塌陷、不出现 0 宽面板。

### 4.8 能力 8 —— VS Code 外壳骨架

| 判据 | 证据 | 结论 |
|---|---|---|
| 主题根类 | `DockShell.tsx:549` `<div className="dock-shell dv-theme-vscode">` | ✅ |
| 活动栏 | `:202` `<nav className="dock-activity-bar" aria-label="活动栏">` | ✅ |
| 侧边栏 | `:554` `<aside className="dock-side-bar" aria-label="侧边栏">` | ✅ |
| 编辑区 | `:562` `<main className="dock-main" aria-label="编辑区">` | ✅ |
| dockview 宿主 | `:565` `className="dockview-host"` | ✅ |
| 辅助侧栏 | `:582` `<aside className="dock-aux-bar" aria-label="辅助侧栏">` | ✅ |
| 底部面板区 | `:590` `<section className="dock-bottom-area" aria-label="底部面板区">` | ✅ |
| 状态栏 | `:237` `<footer className="dock-status-bar">`（**无** aria-label，故 `[aria-label="状态栏"]` 恒 0 命中） | ✅ |
| 骨架 6 部件回归 | `DockShell.smoke.test.tsx` 断言 `.dock-activity-bar` / `.dock-side-bar` / `.dock-main` / `.dock-bottom-area` / `.dock-status-bar` / `.dock-aux-bar` / `.dockview-host` / `.dv-theme-vscode` 全部存在 | ✅ |
| 跨平台洁净 | 见 §6 | ✅ |

**结论：PASS。**

### 4.9 能力之外的必守项 —— 事件桥（ADR §2.9，不得删除）

| 判据 | 证据 | 结论 |
|---|---|---|
| `nm:open-panel` 监听保留 | `ProjectLayout.tsx:322` `window.addEventListener('nm:open-panel', onOpenPanel as EventListener);` | ✅ |
| 守卫逐字保留 | `ProjectLayout.tsx:318` `var key = (e as CustomEvent<{ key: string }>).detail?.key;`（`if (!key) return;`） | ✅ |
| `nm:open-settings` 保留 | `ProjectLayout.tsx:328` `window.addEventListener('nm:open-settings', onOpenSettings as EventListener);` | ✅ |
| 卸载清理 | `ProjectLayout.tsx:330-331` 两个 listener 均在 cleanup 中 `removeEventListener` | ✅ |
| 现网仍有派发方 | `LeadCharacterHighlight.ts:53`、`ForeshadowWarning.tsx:40`（`detail: { key: 'foreshadows' }`）、`worldbuilding/src/web/faction-highlight.ts:102`（`detail: { key: 'factions' }`）、`worldbuilding/src/web/index.tsx:25`、以及**永久保留**的服务端模板字面量 `apps/server/src/ai/tools/plugin-tools.ts:189` | ✅ |
| 监听器位置正确 | 挂在 `ProjectLayout` 而非 `DockShell`（dockview 初始化是异步的，挂内核会让命令静默排队丢失） | ✅ |
| `MAX_OPEN_PANELS` 已退役 | 全仓仅 **2** 处命中，且**都是注释**（`ProjectLayout.tsx:10`、`stores/panelOpenStore.ts:7`）⇒ 无残留逻辑 | ✅ |

### 4.10 能力之外的必守项 —— 单面板错误隔离（ADR §3）

| 判据 | 证据 | 结论 |
|---|---|---|
| 边界组件 | `dock/DockPanelContent.tsx:28` `class PanelErrorBoundary extends React.Component<` | ✅ |
| 捕获 | `:37` `static getDerivedStateFromError(error: Error)` | ✅ |
| 降级 UI | `:45` `className="dock-panel-error"`、`:46` `role="alert"` | ✅ |
| 重试 | `:78` `onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}`；`:86` `return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;` | ✅ |
| 包裹每个面板 | `:106` `<PanelErrorBoundary label={def.label}>`、`:107` `<div className="dock-panel-body" data-panel-key={def.key}>` | ✅ |
| 中心槽标记 | `:129` `<div className="dock-center-slot" data-dock-slot="center">` | ✅ |
| 应用级致命 | `ProjectLayout.tsx:48` 导入 `ErrorBoundary`；`:83` `function ShellFatal({ error })`；`:360` `<ErrorBoundary renderError={… <ShellFatal error={error} />}>`；`:460` `</ErrorBoundary>` | ✅ |
| 加载态 | `ProjectLayout.tsx:72` `<div className="shell-panel-fallback" role="status" aria-label="加载中">` | ✅ |

**结论：PASS。** 单面板抛错只降级该面板（`role="alert"` + 重试），应用级致命由根 `ErrorBoundary` + `ShellFatal` 兜底。

---


## §5 中心槽闭环（能力 6）—— 独立复测

> 本节是本报告最关键的一节：能力 6 曾被修复过一次「中心面板双实例」缺陷。
> 复测口径按 captain 裁定：**不变量必须用 DOM `[data-tab-panel-id]` 计数验证，绝不能用 `listPanels()` 输出**。
> 原因（已独立确认）：dockview 8.4.0 `_doAddPanel` 对**重复 id** 会 `throw`，
> 而旧代码的 `canonicalId = panelInstanceId(key)` 漏掉了 `nm-center:<key>`，
> 于是 `addPanel({id:'nm-panel:<key>'})` 是一个**全新 id** ⇒ 不报错，**真的多建了一个普通实例**；
> 而 `listPanels()` 按**业务 key 去重**，把重复**藏起来了** —— 只有 DOM 属性才暴露它。

### 5.1 不变量与四要素

**不变量**：同一业务 key **有且仅有 1 个实例**；center 面板**只经 `nm-center:<key>`** 渲染，**绝不建 `nm-panel:<key>`**。

### 5.2 内核侧四处修复 —— 逐条在**真实** `DockShell.tsx` 中确认

> 真实性前提：文件 SHA256 = `AFE36EFCD83A3BCC88EFB41850F2AD7F213682F92B68E8EC860D7B319BA2C205`，24715 B（与 captain attestation 一致，见 §1.2）。

| # | 修复点 | 真实行号与代码 | 作用 |
|---|---|---|---|
| 1 | 初始布局**排除** center 面板 | `:315` `(d) => wanted.has(d.key) && !resolveDockMeta(d).center,` | 不让受控 effect 建普通实例 |
| 2 | 受控 `openKeys` effect 对 center **让位** | `:433` `if (meta.center) continue;` | 中心面板归 `activeCenterKey` 独占 |
| 3 | 关闭循环**跳过** `nm-center:` 实例 | `:418` `if (isCenterPanelInstanceId(p.id)) continue;` | 关普通面板时不误删中心实例 |
| 4 | `openPanel` 幂等守卫查**规范 id** | `:452` `const canonicalId = meta.center ? centerPanelInstanceId(key) : panelInstanceId(key);` | 重复打开不再新建第二个实例 |
| 5 | `emitOpenChange` 用 `Set` 去重 | `:289` `const seen = new Set<string>();` | 上报的 key 列表无重复 |

### 5.3 宿主侧派生逻辑 —— `activeCenterKey` 不再硬编码 `null`

`ProjectLayout.tsx:217-233`（唯一缺省真源，**未自写 `?? 默认值`**）：

```ts
:218  var isCenterPanel = function(key: string): boolean {
:220    return !!def && resolveDockMeta(def).center;
:223  if (activeKey && openPanelKeys.indexOf(activeKey) !== -1 && isCenterPanel(activeKey)) {
:227    for (var i = openPanelKeys.length - 1; i >= 0; i--) {
:229      if (key && isCenterPanel(key)) return key;
:233  }, [defByKey, openPanelKeys, activeKey]);
```

优先级：**① 当前 activeKey 本身是 center 面板 ⇒ 取它；② 否则倒序扫描取最近打开的 center 面板；③ 无 ⇒ `null`**。
关闭后回落 `null`。导入链 `ProjectLayout.tsx:53 import { resolveDockMeta } from '@/components/shell/dock/types';`。

> 旁证：该 hook 被**刻意放在** `mode === 'auto'` 提前返回**之前**，使两种模式下 hook 顺序完全一致（避免 React hook 顺序违规）。

### 5.4 全仓唯一 `center:true` 声明 —— 确认只有 1 处

全仓（`.ts`/`.tsx`，排除 `node_modules`/`dist`）扫描 `center\s*:\s*true`：

| 类型 | 位置 |
|---|---|
| **真实声明（唯一）** | `apps/plugins/manual/workbench/web/panels.tsx:49` — `{ icon: Network, label: '关系图', key: 'relationGraph', Component: RelationGraph, width: 900, height: 800, modes: ['manual'], dock: { center: true, slot: 'center' } }` |
| 注释 | `panels.tsx:46`、`CenterGraphPanel.tsx:8`、`DockShell.tsx:102/307/427`、`ProjectLayout.tsx:33` |
| 测试夹具 | `DockShell.smoke.test.tsx:176/220/223`、`plugin-dock-adaptation.test.ts:14/91/124/125` |

### 5.5 真实浏览器端到端探针 —— 独立新增证据（`.verify-scratch/probe-center-slot.mjs`）

**方法**：raw CDP，用**真实 UI 表单**登录 → 建一次性 manual 项目 → 进 `/project/<id>` →
读取 DOM `[data-tab-panel-id]` 全量列表 → 点活动栏「关系图」→ 再点一次（幂等）→ 关闭该 tab → 删除项目。

**实测输出（原文）**：

```
attached to 905228C2 about:blank
after login path = /bookshelf
project = 88e2990f-cde9-4199-8f59-30c3cf1e4898 mode = manual
route = /project/88e2990f-cde9-4199-8f59-30c3cf1e4898
  [initial (no center panel opened)] {"all":["nm-center-default"],"centerRelationGraph":0,"plainRelationGraph":0,"panelKeys":[],"centerSlot":true,"hasActivityBar":true}
activity-bar click target = 关系图
  [after opening relationGraph]      {"all":["nm-center-default","nm-center:relationGraph"],"centerRelationGraph":1,"plainRelationGraph":0,"panelKeys":["relationGraph"],"centerSlot":false,"hasActivityBar":true}
  [after clicking relationGraph AGAIN (idempotency)] {"all":["nm-center-default","nm-center:relationGraph"],"centerRelationGraph":1,"plainRelationGraph":0,"panelKeys":["relationGraph"],"centerSlot":false,"hasActivityBar":true}
close action = clicked-close
  [after closing relationGraph]      {"all":["nm-center-default"],"centerRelationGraph":0,"plainRelationGraph":0,"panelKeys":[],"centerSlot":true,"hasActivityBar":true}
cleanup DELETE status = 200

=== VERDICT ===
center reachable via activity bar : YES
exactly 1 instance, no plain twin: YES
repeat open is idempotent        : YES
close removes it, no residue     : YES
RESULT = PASS
```

**逐项解读**：

| 阶段 | `[data-tab-panel-id]` 实测 | 判定 |
|---|---|---|
| 初始（未开中心面板） | `["nm-center-default"]` — 只有根面板，**无任何 center 业务实例** | ✅ 初始布局正确排除 center 面板 |
| 打开「关系图」后 | `["nm-center-default","nm-center:relationGraph"]`；`nm-panel:relationGraph` = **0** | ✅ **恰好 1 个实例，且无普通孪生实例** |
| **再点一次**（幂等） | 列表**完全不变**，仍是 2 项 | ✅ `openPanel` 幂等守卫生效 |
| 关闭后 | 回落 `["nm-center-default"]`，`nm-center:relationGraph` = **0** | ✅ 移除干净、无残留 |

> 附带观察：打开中心面板后 `[data-dock-slot="center"]` 由 `true` 变 `false` —— 因为 `CenterGraphPanel` 接管了中心槽的渲染，根容器 `.dock-center-slot` 被替换。这与「中心槽可替换」的语义一致，属**预期行为**，非缺陷。

**结论：能力 6 PASS（源码 + 构建产物 + 真实浏览器三证齐备）。**

### 5.6 回归守门测试 —— 独立单文件复跑

```
pnpm --filter @novel/web exec vitest run src/components/shell/dock/DockShell.smoke.test.tsx
→ 1 file / 17 passed / EXIT=0
```
中心槽三例耗时 302 ms / 827 ms / 808 ms。`DockShell.smoke.test.tsx` 的 5 个能力 6 用例（①同开恰好 1 实例 ②`activeCenterKey=null` 不建普通实例 ③置回 null 移除并回落 ④`openPanel` 幂等 ⑤`onOpenChange` 只上报唯一 key）全部通过。

> **守门有效性**（此证据由 reviewer 提供并已被 captain 复核，t4 此处**登记为既有结论**，未重复构造回退副本）：
> 把四处修复回退后，5 个新用例**全部失败**、12 个既有用例全通过 ⇒ 测试**真的守住了**该缺陷。
> t4 的独立贡献在于用**真实浏览器 DOM 计数**验证同一不变量（§5.5），不依赖该测试自身。

---

## §6 跨平台洁净度（能力 8 的横向要求）

| 检查项 | 范围 | 结果 |
|---|---|---|
| 硬编码盘符 / 反斜杠 / UNC 路径 | `apps/web/src/components/shell/**`（含 `dock/**`） | **0** 处 ✅ |
| `require(` / `process.` / `.node` / `electron` / `ipcRenderer` / `@electron` / `remote.` | 同上 | **0** 处 ✅ |
| `from 'electron'` / `ipcRenderer` / `require('electron')` | 整个 `apps/web/src` | **0** 处 ✅ |
| `process.env` / `process.platform` | `apps/web/src` 非测试源码 | **0** 处 ✅ |
| 原生模块泄漏 | 全仓 `.node` 文件仅 **3** 个：`@rollup/rollup-win32-x64-gnu`、`@rollup/rollup-win32-x64-msvc`、`better-sqlite3/build/Release/better_sqlite3.node`；**均未被 web 层导入** ✅ |
| `node:fs` / `node:path` | web 层仅出现在**测试**：`apps/web/src/plugin/__tests__/plugin-dock-adaptation.test.ts:28 import { readFileSync, existsSync } from 'node:fs';`、`:29 import path from 'node:path';`（测试侧，正常） ✅ |
| `dockview` 平台约束 | `dockview@8.4.0` deps `{"dockview-core":"^8.4.0"}`，**两个包均无 `os` 字段** ⇒ 无平台限制 ✅ |

### 6.1 历史缺陷（额外 `apps/` 层 glob）确已修复 —— 独立算术验证

| 判据 | 证据 |
|---|---|
| 唯一 glob 定义 | `apps/web/src/plugin/moduleEntries.ts:79` `MODULE_ENTRIES`，条目 `'../../../plugins/manual/workbench/web/index.tsx'`、`'../../../plugins/auto/workbench/web/index.tsx'` |
| 另一处 glob | `apps/web/src/main.tsx:70` |
| **解析验证** | `path.resolve('apps/web/src/plugin', '../../../plugins/manual/workbench/web/index.tsx')` → `F:\new1.2\apps\plugins\manual\workbench\web\index.tsx`，`existsSync` = **true** ✅ |
| 产物侧验证 | `ChapterEditor` 出现在 `dist/assets/index-_34EEzhp.js` 与 `dist/assets/index-BsIP0eYk.js` ⇒ 路由注册成功 ✅ |
| e2e 侧验证 | 章节路由 `/project/<bookId>/<chapterId>` 返回 **200**（非 404），`.ProseMirror` 正常挂载（见 §7） ✅ |

> 该缺陷的历史表现：glob 多了一层 `apps/` ⇒ 展开为空 ⇒ `ChapterEditor` 路由**从未注册** ⇒ 章节页 404。
> `pnpm build` 会通过、单元门禁会通过，**只有真 e2e 能暴露**。

**结论：跨平台洁净度 PASS。** 停靠内核与外壳无任何平台绑定代码。

---

## §7 e2e 端到端实测与失败项定性

### 7.1 前置：三项服务原先**全部未运行**，由 t4 自建

| 服务 | 状态 | 证据 |
|---|---|---|
| 后端 `:3774` | ✅ | `/api/health` → `{"status":"ok","database":"connected","pluginStandard":"1.0.0","hostMode":"all"}`，**27/27 插件 ok**（含 `novel.manual.workbench`、`novel.auto.workbench`、`novel.typography`） |
| 前端 vite `:5174` | ✅ | HTTP 200 |
| CDP 浏览器 `:9222` | ✅ | `/json/version` → `Chrome/154.0.8037.92`，protocol 1.3 |

> `start-dev.cmd` 用 `D:\ruanjian\node.24\node.exe`（**v24.14.1**）—— `better-sqlite3` 是 ABI 137 原生模块，必须 Node 24。
> e2e 脚本默认端口是 **5174**（非 `start-dev.cmd` 的 5180），故我按 5174 起前端。

### 7.2 `scripts/e2e/e2e-core-flows.mjs` —— RUN A（未修改原脚本）

**结果：`❌ e2e-core-flows：1/39 项失败`，EXIT=1。**

**通过的 38 项（全部与停靠重构相关）**：

| 断言 | 实测 |
|---|---|
| 环境探测 | CDP ok / server ok（27/27 插件）/ web 5174 / 标签页 visible+focus ✅ |
| 登录 → `/bookshelf` | cookie 会话有效，`/api/auth/me` = `admin` ✅ |
| manual + auto 测试项目创建 | 201，模式回读正确 ✅ |
| **manual 停靠标记** | `{"面板菜单":true,"活动栏":true}` = **2/2** ✅ |
| manual 不出现 AI UI | 0/3（模式隔离，无泄漏） ✅ |
| auto 渲染 `<WorkbenchMissing/>` | 文案「AI 写作台未安装\n该创作模式对应的模块未启用。启用后刷新即可使用。」 ✅ |
| auto 不出现停靠标记 | 0/3 ✅ |
| 章节闭环 | 创建 → 路由 `/project/<bookId>/<chapterId>`（**非 404**，`ChapterEditor` 已注册）→ `.ProseMirror` 挂载 → **无 `Maximum update depth exceeded`** → 写入并落库（`{"status":200,"wordCount":24}`）→ **刷新后文本仍在** ✅ |
| 角色面板 | 经 `nav[aria-label="活动栏"] button[aria-label="角色"]` 打开；`[data-panel-key="characters"]` + `[role="listbox"][aria-label="角色列表"]` 命中；空态「暂无角色」；UI 创建的角色在面板中渲染 ✅ |
| 加载态 | `✓ 角色面板未卡在加载态 — loading=false` ✅ |
| console 错误 | **0 条** ✅ |
| 自清理 | `已删除: …:200, …:200`，无残留 ✅ |

**唯一失败项**：
```
✗ UI 创建的角色已持久化到后端（GET /api/characters/projects/:id 含该名字） — 后端列表="{\"data\":[]}"
   前置：[waitFor 超时 20000ms] 角色落库 last=""
```
即：角色**已在 zustand store 且面板渲染出来了**（`✓ 角色面板渲染出真实数据（含刚通过 UI 创建的角色名） — listText="端\n端到端角色-…"`），但**从未到达后端**。

> 脚本自身的失败定位提示指向 `ProjectLayout.tsx`（模式路由）与 `apps/web/src/plugin/registry.ts`（`filterByProjectMode`）——
> 那是脚本的**通用**失败位置列表，**不是**因果证明。t4 按下节独立定位真实机制。

### 7.3 判别实验：三行对照（**安慰剂失败是判别关键**）

> 全部在**同一控制条件**下运行：先关闭所有 page target，再新开**恰好一个** `about:blank`，唯一变量只有被屏蔽的 URL。
> 变体脚本均为 `scripts/e2e/e2e-core-flows.mjs` 的**影子副本**（位于仓库外 `.verify-scratch/`），
> 与原文的字节差异**仅为注入块**；**产品源码未改一行**。

| run | 条件（唯一变量） | 结果 |
|---|---|---|
| **RUN A** | 不屏蔽任何 URL（原脚本） | ❌ 1/39 失败，`后端列表="{\"data\":[]}"` |
| **RUN E1-安慰剂A** | 屏蔽 `*/__t4_placebo_never_matches__*`（**永不命中**，只控制「装规则」这个动作） | ❌ **仍然失败**，同一断言 |
| **RUN E1-安慰剂B** | 屏蔽 `*/favicon.svg*`（真实但**无关**的静态资源） | ❌ **仍然失败**，同一断言 |
| **RUN noai** | 屏蔽 `*/api/ai/analyze-style*` | ✅ **40 项断言全过**，`{"status":200,"id":"pRdqEWCG4sHnie9F01DJW","role":null}` |

**安慰剂 A、B 均失败 ⇒ 排除了两个解释**：① 装 `Network.setBlockedURLs` 规则这个动作本身；② 单纯的时序/负载敏感。
**只有屏蔽 `analyze-style` 才通过** ⇒ **存在特定的干扰链**，不是环境噪音。

**确定性**：`noai` 变体在全新标签页连跑 **2** 次，均 `✅ e2e-core-flows 全过（40 项断言）`、EXIT=0
（id 分别为 `pRdqEWCG4sHnie9F01DJW`、`V8HQfCrQmCgkOFvk8kPYk`）⇒ **可复现、非 flaky**。

### 7.4 时间线证据（`Network` + `console` 全量插桩，不屏蔽任何 URL）

证据文件：`.verify-scratch/log-e2-timeline.txt`（**仓库外影子脚本产物**）。被测项目 `39b083a0-acc9-4587-aae1-adfc5120e0d9`。

```
+  4822ms  SEND GET   /api/characters/projects/39b083a0-…
+  4868ms  RESP 200   /api/characters/projects/39b083a0-…
+ 12766ms  SEND GET   /api/characters/projects/39b083a0-…      (周期轮询)
+ 12806ms  RESP 200   /api/characters/projects/39b083a0-…
+ 17785ms  SEND GET   /api/characters/projects/39b083a0-…
+ 17838ms  RESP 200   /api/characters/projects/39b083a0-…
+ 22579ms  SEND GET   /api/characters/projects/39b083a0-…
+ 22646ms  RESP 200   /api/characters/projects/39b083a0-…
+ 23183ms  SEND POST  /api/characters                     ← 角色写入发出（项目上下文正确）
+ 23667ms  SEND GET   /api/characters/projects/39b083a0-…
+ 31167ms  console warning: [databaseService] API 保存 Characters 失败: ApiError: 请求超时 (8s)
             at request (…/data-core/src/api/apiClient.ts:199:30)
             at async apiSave (…/data-core/src/data/databaseService.ts:58:20)
+ 31168ms  Network.loadingFailed: net::ERR_ABORTED
+ 47186ms  RESP 200   /api/ai/analyze-style               ← 该 AI 请求跑了约 24.5s
+ 47190ms  RESP 200   /api/characters/projects/39b083a0-… ← 排在它后面的 GET 也等了 23.5s
```

- **`POST /api/characters` 全程没有任何 RESP 行** —— 它**从未收到响应**。
- `analyze-style` 共 **8** 个 SEND（+16913 / +18175×2 / +22654 / +22658×2 / +22673），唯一可见 RESP 在 **+47186ms**。
- 客户端在 **+31167ms ≈ 23183 + 8000** abort —— **正好等于 8000 ms `DEFAULT_TIMEOUT_MS`**，产生 `net::ERR_ABORTED`。
- 后端日志侧交叉印证：该项目的 `GET /api/characters/projects/…` 多次 200，但**从未出现 `[POST] /api/characters`** 记录 ⇒ POST **根本没到服务端**。

**⇒ t4 直接证明的部分**：同源 HTTP/1.1 连接池（6 条）被长 AI 请求占满，`POST /api/characters` 与其后的 `GET` 一起排队，
POST 在**排队期间**即被 8 s 客户端超时 abort，**未发出**。
（captain 进一步定位到服务端侧 `aiRateLimit` + 单条约 24 s 的 AI 调用造成饱和；两个方向一致，**无论哪一层，机制链与结论不变**。）

**同时否证了一个假设**：POST 与超时之间**没有任何 `GET /api/characters/projects/<id>` 完成** ——
那个「本该用服务器旧数据覆盖 store」的 GET 自己也被堵在 +23667→+47190（23.5 s）。
⇒ **「GET 覆盖 store」假设不成立**；机制是**写入被超时吞掉**，不是本地状态被回滚覆盖。

### 7.5 定性（按 captain 裁定口径）

> **定性：存在未解释的特定干扰链（仅屏蔽 `/api/ai/analyze-style` 即通过）。**
> 表现为**真实存在的既存缺陷** —— 写请求超时被静默吞掉 ⇒ **静默丢数据**，由 AI 端点饱和触发。
> **标记为残余风险。**
> **不是**环境噪音；**不是**停靠重构回归（与 `DockShell` / `ProjectLayout` / `dock/**` 无任何因果关系）；
> **不属本次停靠重构范围**，建议**另开任务**。

**已排除项（逐条有实验支撑）**：

| # | 被排除的解释 | 排除依据 |
|---|---|---|
| 1 | 「装 `Network.setBlockedURLs` 规则」这个动作本身 | 安慰剂 A（永不命中模式）**仍然失败** |
| 2 | 单纯时序 / 负载敏感（与具体端点无关） | 安慰剂 B（`favicon.svg`）**仍然失败** |
| 3 | 后端拒绝 / 项目作用域错误 | 直连 `POST /api/characters` **7 ms 成功**；body 中 `projectId` 上下文正确 |
| 4 | `projectId` 为空 | DB `characters.project_id` 为 **NOT NULL**；POST body 携带正确 projectId |
| 5 | 「GET 覆盖 store」（服务器旧数据回滚本地状态） | E2 时间线中 POST 与超时之间**无任何 `GET /api/characters/projects/<id>` 完成** |
| 6 | 客户端 React 批处理导致 PUT 带旧名 | 时间线中**根本没有 PUT** 发生 |

> 另：**范围判定**中「既存」一项，captain 已独立核对 `git diff --stat HEAD -- apps/plugins/manual/workbench/web/editor/EditorPage.tsx` **为空**（与 HEAD 逐字节相同），
> 与 t4 的结论一致，可直接引用。
>
> ⚠️ **路径勘误（captain 追加，2026-10-02）**：本报告与 captain 交底中曾以省略号形式写作 `…/EditorPage.tsx`，容易被误读为 `apps/web/src/pages/EditorPage.tsx` —— **该路径不存在**（`Test-Path` = False）。
> **真实路径 = `apps/plugins/manual/workbench/web/editor/EditorPage.tsx`**（26730 B，mtime 2026-09-30 11:22:41）。
> 本报告下文出现的 `EditorPage.tsx:NNN` 一律指该真实路径，**结论与行号均未受影响**（t5 已在真实路径逐行复核，结论一致）。
> 已由 `docs/reports/dock-refactor-closeout.md` §4.1 与 §8.5 正式登记。

**机制链（分两层，含文件:行，均已逐条独立核对）**：

#### 第一层 · 直接成因（t4 实测）：同源连接池饱和 ⇒ 写入排队中被 8 s 超时 abort

1. `apps/plugins/shared/data-core/src/api/apiClient.ts:103` `const DEFAULT_TIMEOUT_MS = 8000;` —— 写请求 8 s 硬超时。
2. 实测**同时 8 条** `analyze-style` 在飞（时间线上 +22654 / +22658 / +22673 **同毫秒连发**），
   单条实测约 **24 s**（`apps/server/src/modules/ai.ts:574` `aiRouter.post('/analyze-style', requireAuth, ensureConfigMiddleware, aiRateLimit, …)`）；
   6 条同源 HTTP/1.1 连接被占满。
3. `apps/plugins/manual/workbench/web/knowledge/CharacterManager.tsx:249-270` `handleCreate` 建 `newChar` 并
   `addCharacter(newChar)`（`:264`），经 `useEntitySync` → `apiSave` 触发 `POST /api/characters`；
   此时它拿不到连接，在队列里等到 8 s 客户端超时。
4. `apps/plugins/shared/data-core/src/data/databaseService.ts:98` `async function apiSave<T …>`；
   `:105-112` `try { … await apiClient.post<T>(apiPath, entity, { silent: true }); } catch (e) { console.warn(…); return null; }`
   —— `:106-107` 注释明示 `silent: true`；配合 `apiClient.ts:363` `if (!options?.silent) dispatchApiErrorEvent(timeoutErr);`
   ⇒ **超时既不弹 toast，也不重试**（`apiClient.ts` 全文**无任何 retry 逻辑**，仅 3 处错误文案字符串）。
5. ⇒ **UI 显示新角色（store 已写入）、后端 `{"data":[]}`** —— 用户视角的**静默丢数据**。

#### 第二层 · 上游成因（captain 定位，t4 已打开源码逐行复核确认）：请求**不可取消**，被 abort 的请求继续占用连接直到 60 s

`apps/plugins/manual/workbench/web/editor/panels/StyleAdvisor.tsx`：

| 行 | 代码 | 问题 |
|---|---|---|
| `:82-83` | `const controller = new AbortController(); abortRef.current = controller;` | 建了 controller |
| `:85` | `styleService.analyzeStyle(texts).then(...)` | **只传 `texts`，`controller.signal` 根本没有传进去** |
| `:86` / `:91` | `if (!controller.signal.aborted && …)` / `if (!controller.signal.aborted) {` | **只在 `.then`/`.catch` 里读** `signal.aborted` ⇒ **仅影响回调是否打印日志，取消不了请求** |
| `:102-104` | `if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }` | cleanup 里 `abort()` 只是把一个**没人监听的** signal 标记为 aborted |

`apps/plugins/shared/data-core/src/editor/styleService.ts`：

| 行 | 代码 | 问题 |
|---|---|---|
| `:146` | `async analyzeStyle(chapters: string[]): Promise<StyleAnalysisResult>` | **签名压根没有 signal 参数** ⇒ 上游即便想传也传不进来 |
| `:161` | `{ silent: true, timeoutMs: 60_000 },` | 请求最长可占连接 **60 s** |

**因果闭合**：`StyleAdvisor` 的 effect deps 是 `[chapters]`（`:107`，另有 3000 ms 防抖 `:77/:95`），
`EditorPage.tsx:134-157` 的同类 effect **连防抖都没有**（`:134` deps `[chapters]`，`:142` 立即调用，`:136` 建了 `AbortController` 却**从未传入**）。
⇒ 正文/章节变动会**反复起新的 60 s `analyze-style`**，而旧请求因 **signal 未传递而无法取消**，**继续占用 socket 直到 60 s 超时**
⇒ 这就是**8 并发的来源**（与时间线同毫秒连发吻合）。

> **复核结论**：captain 的两处引用**逐行核对为真**，t4 **无不同结论**。
> 补充一点精度：`StyleAdvisor` 本身**有** 3000 ms 防抖，真正「无防抖」的是 `EditorPage.tsx:134-157`；
> 但两者**同样**不传 signal，故**同样不可取消**——结论方向不变，且并发的**主要**来源是 `EditorPage`。

**完整链条**：
`EditorPage`/`StyleAdvisor` 反复发射不可取消的 60 s AI 请求 → 6 条同源连接被占满 →
`POST /api/characters` 排队 → 8 s `DEFAULT_TIMEOUT_MS` 到点 abort → `silent: true` 静默吞掉 →
**UI 有、后端无（静默丢数据）**。

**范围判定**：
- **既存缺陷**：`EditorPage.tsx` 与 HEAD **逐字节相同**（`git diff --stat` 为空）；
  `CharacterManager.tsx` / `entityStores.ts` / `syncService.ts` / `apiClient.ts` / `databaseService.ts` 均 `git status` 干净、未被本次重构触碰；
  该 e2e 断言在 HEAD 版本脚本中**早已存在**。
- **非停靠重构回归**：`ProjectLayout.tsx` 相对 HEAD 的 diff **只涉及停靠/面板打开管线**，
  `useSyncService(urlBookId || project?.id)` 一行**与 HEAD 完全相同**。
- **非本次范围**：建议**另开任务**（超时应**可见化 / 可重试**；或写入路径走独立于 AI 的连接/队列；
  并修 `EditorPage.tsx` 的**未防抖 + 未传递 signal** 两处）。

**证据文件**（均位于仓库外 `.verify-scratch/`，为影子脚本产物，非产品源码）：
`log-e2-timeline.txt`（7.4 时间线）、`log-e1-placebo-favicon.txt` / `log-e1-placebo-never.txt`（7.3 安慰剂）、`log-noai-1.txt` / `log-noai-2.txt`（确定性复跑）。

### 7.6 `scripts/e2e/e2e-mode-separation.mjs` —— 首次失败经查为**测试夹具**问题

| 轮次 | 条件 | 结果 |
|---|---|---|
| 第 1 次 | 当时 CDP 上存在 **5** 个 page target（其中 2 个停留在**已删除项目**上） | ❌ `✗ 全流程 console 错误为 0 — 15 条`，EXIT=1 |
| 插桩复跑 | 同上 | ✅ 全过，`console errors = []`，失败响应 `(none)` |
| 第 2、3 次 | 同上 | ✅ 全过，`✓ 全流程 console 错误为 0 — 0 条`，EXIT=0 |

**根因（已坐实）**：脚本 `:101-103` `page = pages.find((p) => p.type === 'page');` —— **附着到列表里第一个 page target**，
而它可能是一个**遗留标签页**。CDP 的 `Runtime.enable` 会**回放**该 target 的历史 console 消息：

```
target [2] 30a03d90…  consoleErr=15  [ErrorSystem] API Error dispatched: Object
target [5] ec7347aa…  consoleErr=15  [ErrorSystem] API Error dispatched: Object
   → 恰为 15 条，与失败轮的计数完全一致
probe-replay：到达偏移 4,4,4,4,4,4,4,4,4,4,4,5,5,5,5（跨度 1 ms）
   → 全部**立即到达** ⇒ 是附着**之前**就已缓冲并回放的消息
```

**A/B 对照（同一脚本，唯一变量 = 标签页身份）**：
① 留一个遗留标签页 ⇒ ❌ 复现 15 条；② 关掉遗留页、新开一个空白页 ⇒ ✅ 0 条、EXIT=0。

⇒ **定性：测试夹具/环境问题，非产品缺陷、非停靠重构回归。**
（稳健化修法属**夹具侧**——附着到 URL 匹配 `BASE` 的标签页、或先清理遗留页、或忽略 `Runtime.enable` 后头几毫秒的消息；
**t4 未施此修改**，因源码修改被禁。）

**结论：`e2e-mode-separation.mjs` 在干净标签页条件下 EXIT=0（通过）。**

---

## §8 三条已裁定的 ADR 偏离（**登记，不判失败**）

> 本节目的：**阻止后续成员照旧清单硬删**。三条偏离均已由 captain 裁定，且已在 ADR 内留有追加记录；
> t4 独立复算了支撑数据，**结论一致**。以下**均为「保留」，本轮零删除**。

### 8.1 ADR §6.4 `--ink*` 删除前提**不成立** —— 裁定：保留

**ADR 原文要求**删除 `--ink*` 与 `--cover-ink`、`.nm-ink-*`。
**实测事实**：这些名字仍有大量**活跃消费点**，硬删 = 大面积静默视觉回归。

**t4 独立复算（源码扫描，排除 `node_modules`/`dist`，正则 `var\(\s*--ink…\s*[,)]`）**：

| 令牌 | 消费点（`var()` 使用） | 定义数 | 定义位置 |
|---|---|---|---|
| `--ink` | **72** | 2 | `globals.css:161`（`:root`）、`globals.css:374`（深色块） |
| `--ink-light` | **83** | 2 | `globals.css:162`、`globals.css:375` |
| `--ink-pale` | **32** | 2 | `globals.css:163`、`globals.css:376` |
| **小计（活跃消费点）** | **187** | | |
| `--ink-deep` | 13 | **0** | 无定义（悬挂，见 8.3） |
| `--ink-soft` | 5 | **0** | 无定义（悬挂，见 8.3） |
| `--cover-ink` | 2 | 1 | `globals.css:72` |

- 72 + 83 + 32 = **187**，与 captain 的 187 总数**一致**。**拆分口径已由 captain 裁定并复现化**（`scripts/verify/measure-ink-consumers.mjs`）：`A_raw`（原样计数含块注释）= 72/83/32 = **187**、`B_code`（剥离块注释）= 69/82/31 = **182**、`C_bare`（裸 token 名含注释行）= 73/84/33 = **190**。原先流传的 73/83/31 是**把 `C_bare` 的 `--ink` 列与 `B_code` 的 `--ink-pale` 列混入了 `A_raw` 的拆分**（不是正则边界问题），属口径混用，已更正为 72/83/32。
- **写法全部是 `hsl(var(--ink…))` 三元组形式**（故值必须保持 HSL 三元组，不可改成整色值）。
- **真源不含这些名字**：`apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css` 定义 `--ink*` **0 次**。
- **多数消费点在原 writeScope 之外**：`--ink-light` 单token 即分布在 18 个文件，
  含 `SettingsPage.tsx`(11)、`UpdateSection.tsx`(9)、`AdminPage.tsx`(7)、`CharacterManager.tsx`(6)、
  `FindReplaceBar.tsx`(6)、`PluginManagerSection.tsx`(6)、`LoginPage.tsx`(5)、`RegisterPage.tsx`(5)、`index.tsx`(5) 等。

**裁定（已落地，登记）**：
- **保留**三个定义（`globals.css` `:root` 块 L161-163、深色块 L374-376）；
- **保留** `--cover-ink`（L72）；
- **保留** `.glass-ripple-ink`（L694 注释 / L696 选择器）；
- **只改写**水墨语义注释。

**已落地的 ADR 追加记录**（登记，供后续成员查证）：
`docs/architecture/dock-protocol-adr.md:725` `#### 6.4-a 偏离记录：本行（--ink* / --cover-ink / nm-ink-*）的删除前提经实测不成立（t2 追加，2026-10-02）`
—— 内含 187 消费点表与五条裁定。

### 8.2 ADR §6.5「可删类」例外清单**逐条与事实矛盾** —— 裁定：零删除

**t4 独立复算引用数（`git grep`，仅跟踪文件）**：

| 类族 | 引用数 | 分布 | 判定 |
|---|---|---|---|
| `.nm-logo-seal` | 4 | `LoginPage.tsx:106`（`className="nm-logo-seal mb-5 cursor-pointer"`）、`RegisterPage.tsx:216`（同）、`globals.css:1430` / `:1451`（选择器） | **有活跃引用** ⇒ 不可删 |
| `.nm-no-brush` | 4 | `ui-kit/src/aiBars.tsx:413`（注释）/`:415`（className）/`:517`（注释）/`:518`（className） | **有活跃引用** ⇒ 不可删 |
| `.nm-qbubble*` | 9 | `aiBars.tsx:138,154`；`globals.css:1979,1998,2002,2009,2027` | **有活跃引用** ⇒ 不可删 |
| `.nm-qp-*` | 22 | `EditorPage.tsx:233`（注释）、`QuickPhraseBubble.tsx:406,409,413,453`；`globals.css:2041,2046,2054,2088` 等 | **有活跃引用** ⇒ 不可删 |
| `.nm-ink-*` | **0**（代码） | 8 处引用**全在文档** `docs/design/ink-wash-migration.md`（L123,128,152,153,154,214） | 真零引用，**但无选择器可删** |
| `.nm-brush` | **0** | — | 真零引用，**但无选择器可删** |

**选择器存在性扫描**（`apps/web/src/styles/globals.css`，正则 `\.nm-ink|\.nm-brush|\.nm-logo-seal|\.nm-no-brush|\.nm-qbubble|\.nm-qp-`）：

```
命中仅：L1430, L1451（.nm-logo-seal）
        L1979, L2002, L2009, L2027（.nm-qbubble*）
        L2041, L2046, L2054, L2088（.nm-qp-*）
⇒ .nm-ink 选择器出现 0 次；.nm-brush 选择器出现 0 次
```

**⇒ 结论：唯一「真零引用」的两个类族（`.nm-ink-*`、`.nm-brush`）在 `globals.css` 内根本不存在对应选择器，
故不存在任何「正当的」选择器删除。本轮零删除是正确裁定。**

**已落地的 ADR 追加记录**：`docs/architecture/dock-protocol-adr.md:756` `### 6.5 nm-* 语义类去向（冻结）`（保留冻结例外清单）、
`:766` `#### 6.5-a 偏离记录：上面「唯一例外」清单逐条与事实矛盾（t2 追加，2026-10-02）`。

### 8.3 既存悬挂引用 —— **残余风险**，本次不修

| 令牌 | 消费点 | 定义 | 说明 |
|---|---|---|---|
| `--ink-deep` | **13** 处（`QuickPhraseBubble.tsx:256,456`；`ui-kit/src/aiBars.tsx:169,243,358,381,478`；`AdminPage.tsx:348,357`） | **全仓 0 处** | 消费但无定义 ⇒ 该处颜色**回退为无效值** |
| `--ink-soft` | **5** 处（`QuickPhraseBubble.tsx:274,288,421`；`AdminPage.tsx:367,490`）+ 1 处文档（`docs/design/ink-wash-migration.md:142`，该文档**已自行注明**「该变量全项目并未定义」） | **全仓 0 处** | 同上 |

**定性**：**既存问题，非本次引入**（这些消费点均不在本次改动范围内，`git status` 干净）。
记为 **残余风险**，**本次不修**，建议随 §8.1/§8.2 的收尾一并处理。

---

## §9 「需人工确认」清单（无法自动化项，**未伪造通过**）

> 以下项目在 headless/CDP 环境下**无法稳定自动化**（依赖真实鼠标轨迹、hover 时序、拖拽释放坐标）。
> 按硬约束，**一律标「需人工确认」**，给出可执行的人工核对步骤；**本报告不将其计为 PASS**。

### 9.1 能力 2 —— 标题栏拖拽成浮窗、并拖回停靠

- **自动化程度**：源码锚点 + 产物证据已 PASS（§4.2）；**拖拽行为本身未自动验证**。
- **人工步骤**：
  1. `start-dev.cmd`（或 `pnpm --filter @novel/web dev`），登录后进入任一 **manual** 项目；
  2. 在右侧停靠区打开一个面板（如「角色」）；
  3. **按住该面板的标签页/标题栏拖动**；
  4. 期望：面板脱离成**浮窗**，可自由移动、可缩放；
  5. 把浮窗**拖回**停靠区任意槽位；
  6. 期望：重新停靠回该槽，**无残影、无重复实例**。
- **判定**：全部满足 ⇒ 通过。

### 9.2 能力 5 —— 拖拽落位指示器（drop target 预览）

- **自动化程度**：CSS 令牌 + 选择器已 PASS（§4.5）；**预览块的可见性未自动验证**。
- **人工步骤**：
  1. 打开 manual 项目，至少打开 2 个面板；
  2. 按住一个面板标签页开始拖动，**不要松手**；
  3. 期望：目标停靠区出现**半透明填充（`--vscode-panel-dropBackground`）+ 2px 高亮描边（`--vscode-focusBorder`）**的落位预览块，**圆角为 0**；
  4. 分别拖向**中心区**与**侧边区**，期望预览块位置分别对应编辑区/侧栏；
  5. 松手后预览块消失，面板落入该槽。
- **判定**：全部满足 ⇒ 通过。

### 9.3 能力 7 —— 分栏拖拽（sash）

- **自动化程度**：CSS 令牌 + 选择器已 PASS（§4.7）；**拖拽本身未自动验证**。
- **人工步骤**：
  1. 打开 manual 项目，令左侧栏与中心编辑区同时存在；
  2. 鼠标移到两者之间的**分隔条**上；
  3. 期望：分隔条高亮为 `--vscode-sash-hoverBorder` 色；
  4. 按住拖动，期望两侧宽度**实时变化**、松手后**保持**；
  5. 把宽度拖到极窄，期望**不塌陷、不出现 0 宽面板**。
- **判定**：全部满足 ⇒ 通过。

### 9.4 能力 4 —— 标签堆叠的交互顺序

- **自动化程度**：渲染器与 `closable` 逻辑已 PASS（§4.4）；**拖拽改变 tab 顺序未自动验证**。
- **人工步骤**：同一停靠区内打开 2 个面板 → 拖动 tab 改变左右顺序 → 期望顺序变化并保持；`closable:false` 的面板标签**不应出现 ×**。

### 9.5 外观一致性（VS Code 观感）

- **自动化程度**：**无法自动化**（主观视觉）。
- **人工步骤**：对照 `apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css` 的令牌语义，
  核对活动栏/侧边栏/编辑区/底部面板/状态栏的**底色、描边、悬停高亮、圆角**是否与 VS Code Dark Modern 一致；
  重点核对**圆角为 0**、**分栏线 1px**、**落位描边 2px**。

### 9.6 能力 8 —— Linux 运行时未实测

- **自动化程度**：**源码级跨平台洁净度已全自动通过**（§6：内核/外壳 0 处盘符·反斜杠·UNC·`require(`·`process.`·`electron`·`ipcRenderer`；`apps/web/src` 0 处 electron / `process.env`；3 个 `.node` 均未被 web 层导入；`dockview` 两包均无 `os` 字段）。
- **未自动验证**：**本次验证环境为 Windows**（`F:\new1.2`），**Linux 运行时未实测**。
- **人工步骤**：
  1. 在 Linux（建议 Node 24，`better-sqlite3` 需对应 ABI 构建）克隆/复制仓库并 `pnpm install`；
  2. `pnpm --filter @novel/web build` 与 `pnpm --filter @novel/web test` 期望 EXIT=0；
  3. `start-dev.cmd` 的 Linux 等价启动（后端 + vite），进入 manual 项目；
  4. 期望：停靠外壳正常渲染，§4 的八项能力表现与 Windows 一致；
  5. 重点核对：路径分隔符（`import.meta.glob` 展开是否仍命中 `moduleEntries.ts:79`）、原生模块加载、文件监听。
- **判定**：全部满足 ⇒ 通过。

### 9.7 汇总

| 编号 | 项目 | 状态 |
|---|---|---|
| 9.1 | 能力 2 拖拽浮窗 + 拖回 | **需人工确认** |
| 9.2 | 能力 5 落位预览可见性 | **需人工确认** |
| 9.3 | 能力 7 分栏拖拽 | **需人工确认** |
| 9.4 | 能力 4 tab 拖拽排序 | **需人工确认** |
| 9.5 | VS Code 外观一致性 | **需人工确认** |
| 9.6 | 能力 8 Linux 运行时 | **需人工确认** |

> 除上述 6 项外，本报告其余全部结论均由**可复现的命令/探针输出**支撑。

---

## §10 发现登记（Findings）

> 口径：**只登记，不改源码**。每条给出文件:行、严重度、以及「是否影响本次验收结论」。
> 凡**非本次重构引入**者，均明确标注，**不据此判失败**。

### 10.1 F-A（低 · 文档缺陷）—— `DockShell.tsx` 注释描述与 dockview 真实行为不符

| 项 | 内容 |
|---|---|
| 位置 | `apps/web/src/components/shell/DockShell.tsx:450-451` |
| 问题 | 该注释暗示「重复 id 会被 dockview 静默忽略/去重」，但 dockview 8.4.0 的真实行为是 **对重复 id 直接 `throw`** |
| 真实机制（已独立确认） | `node_modules/dockview-core/dist/package/main.cjs.js:14800` `init() {` … `if (panels.has(panel.api.id)) throw new Error(\`dockview: Invalid event sequence. [onDidAddPanel] called for panel ${panel.api.id} but panel already exists\`);` |
| 旧代码的真实后果 | `canonicalId = panelInstanceId(key)` **漏掉了 `nm-center:<key>`**，于是 `addPanel({id:'nm-panel:<key>'})` 是一个**全新 id** ⇒ **不报错**，**真的多建了一个普通实例** |
| 为何单测难发现 | `listPanels()` 按**业务 key 去重**，把重复**藏起来了**；只有 DOM `[data-tab-panel-id]` 才暴露它 |
| 影响 | **纯文档问题**。修复本身**正确**（四处修复均已独立确认，见 §5.2）。**不影响验收结论**，不判失败 |
| 建议 | 后续任务把该注释改写为「重复 id 会 throw；旧缺陷表现为多建 `nm-panel:<key>` 普通实例」 |

### 10.2 F-B（低 · 可维护性）—— `addPanel` 参数在两处重复硬编码，存在漂移风险

| 项 | 内容 |
|---|---|
| 位置 | `apps/web/src/components/shell/DockShell.tsx:613-628`（`buildAddSpec`）与 `:458-469`（`openPanel` 的 center 分支） |
| 问题 | 两处**各自**硬编码 `addPanel` 的 `component` / `title` / `params` / `position` / `minSize` |
| 风险 | 任一处改动而另一处未同步 ⇒ 同一面板经不同路径打开时规格不一致 |
| 是否本次引入 | **否**（既存结构） |
| 影响 | **不影响本次验收结论**（当前两处参数一致，运行时无可见差异） |
| 建议 | 后续任务抽取为单一 `buildAddSpec` 调用，消除重复 |

### 10.3 F-C（低 · 隐式依赖）—— `onActivitySelect` 对 center 面板的幂等依赖是隐式的

| 项 | 内容 |
|---|---|
| 位置 | `apps/web/src/components/shell/DockShell.tsx:533-545`（`onActivitySelect`） |
| 问题 | 它**只查询普通 id**，对已被抢占的 center 面板必然落空，于是回落到 `api.openPanel(key)`，**依赖修复 4** 才变成幂等的 `setActive()` |
| 功能正确性 | **正确** —— 已有 smoke 用例 ④「`openPanel` 对已抢占的 center 面板幂等」覆盖，且 t4 的**真实浏览器探针**二次点击实测**列表完全不变**（§5.5） |
| 风险 | 该幂等性**隐式**依赖 `openPanel` 内部的规范 id 守卫；若未来有人改动 `openPanel` 而未察觉此依赖，回归会静默发生 |
| 影响 | **不影响本次验收结论** |
| 建议 | 后续任务在 `onActivitySelect` 中显式使用 `meta.center ? centerPanelInstanceId(key) : panelInstanceId(key)`，或在注释中显式声明该依赖 |

### 10.4 F-D（低 · 文档/契约精度）—— `[aria-label="设置"]` 在**全仓范围内不唯一**

| 项 | 内容 |
|---|---|
| 声明处 | `docs/architecture/dock-refactor-final.md` §4 称新外壳的稳定选择器「仓库唯一」 |
| 实测 | `[aria-label="设置"]` 命中 **2** 处：`apps/web/src/components/shell/ProjectLayout.tsx:397` **与** `apps/web/src/pages/BookshelfPage.tsx:351` |
| 精确表述 | 它在**新外壳内部唯一**（外壳内仅 1 处），但**全仓不唯一** |
| 其余选择器 | 全部实测唯一：`面板菜单`=1、`活动栏`=1、`侧边栏`=1、`编辑区`=1、`辅助侧栏`=1、`底部面板区`=1、`加载中`=1、`工作台未安装`=1、`返回`=1、`管理员后台`=1、`登出`=1；`角色`=0（运行时 `aria-label={it.label}` 展开，**已知且已文档化**） |
| 影响 | **不影响功能与验收结论**。仅提示：以 `[aria-label="设置"]` 定位时须限定作用域（如 `[aria-label="编辑区"]` 容器内，或 `.dock-shell` 前缀） |
| 建议 | 修正文档表述为「外壳内唯一」 |

### 10.5 F-E（中 · 测试夹具问题）—— e2e 脚本附着到「第一个 page target」，会命中遗留标签页

| 项 | 内容 |
|---|---|
| 位置 | `scripts/e2e/e2e-core-flows.mjs:118` 与 `scripts/e2e/e2e-mode-separation.mjs:101-103`：`page = pages.find((p) => p.type === 'page');` |
| 问题 | 未校验 target 的 URL，附着到列表**第一个** page target；若 CDP 上残留旧标签页，`Runtime.enable` 会**回放**其历史 console 消息 |
| 实测后果 | `e2e-mode-separation.mjs` 首轮 `✗ 全流程 console 错误为 0 — 15 条`（遗留页恰好缓冲 15 条 `[ErrorSystem] API Error dispatched`）；到达偏移跨度仅 **1 ms**，证明是**附着前**的回放 |
| 对照 | 关掉遗留页、新开空白页 ⇒ `✓ 0 条`、EXIT=0 |
| 定性 | **测试夹具/环境问题，非产品缺陷、非停靠重构回归** |
| 影响 | 会导致**假失败**（本次已发生一次）。**不影响产品结论** |
| 建议（**夹具侧**，t4 因禁改源码**未施**） | 附着到 URL 匹配 `BASE` 的 target；或先清理遗留 page target；或忽略 `Runtime.enable` 后头几毫秒内到达的 console 消息 |

### 10.6 F-F（高 · 既存缺陷 · 残余风险）—— 写请求超时被**静默吞掉** ⇒ 静默丢数据

| 项 | 内容 |
|---|---|
| 现象 | UI 已显示新建角色（store 写入成功），**后端 `{"data":[]}`** —— 用户无任何提示 |
| 触发条件 | AI 端点饱和（8 并发、单条约 24 s 的 `analyze-style`）占满 6 条同源连接 ⇒ `POST /api/characters` 排队中被 8 s 客户端超时 abort |
| 关键代码 | `apiClient.ts:103`（`DEFAULT_TIMEOUT_MS = 8000`）；`databaseService.ts:98/105-112`（`apiSave` 的 `silent: true` + `console.warn` + `return null`）；`apiClient.ts:363`（`if (!options?.silent) dispatchApiErrorEvent(timeoutErr);`）⇒ **不弹 toast、不重试** |
| 上游成因 | `EditorPage.tsx:134-157`（**无防抖**、`AbortController` 未传入）与 `StyleAdvisor.tsx:82-85`（有 3000 ms 防抖，但**同样未传 signal**）；`styleService.ts:146` 签名**无 signal 参数**、`:161` `timeoutMs: 60_000` ⇒ 请求**不可取消**，被 abort 的请求继续占连接直到 60 s |
| 范围 | **既存缺陷**：相关文件与 HEAD **逐字节相同**（`git diff --stat` 为空），且该 e2e 断言在 HEAD 脚本中**早已存在** |
| 是否停靠重构回归 | **否** —— 与 `DockShell` / `ProjectLayout` / `dock/**` 无任何因果关系 |
| 影响 | **不影响本次停靠重构验收结论**；但属**真实的既存数据丢失窗口**，记为**残余风险** |
| 建议 | **另开任务**：① 超时**可见化 / 可重试**；② 写入路径走**独立于 AI** 的连接或队列；③ 修 `EditorPage.tsx` 的**未防抖**与 `styleService.analyzeStyle` 的**缺 signal 参数**两处 |

### 10.7 Findings 汇总表

| ID | 严重度 | 一句话 | 本次引入？ | 影响验收结论？ |
|---|---|---|---|---|
| F-A | 低 | `DockShell.tsx:450-451` 注释与 dockview「重复 id 会 throw」的真实行为不符 | 否（文档） | **否** |
| F-B | 低 | `addPanel` 参数在 `:613-628` 与 `:458-469` 重复硬编码，漂移风险 | 否 | **否** |
| F-C | 低 | `onActivitySelect` 对 center 幂等的依赖是**隐式**的 | 否 | **否** |
| F-D | 低 | `[aria-label="设置"]` 全仓 **2** 处，非唯一（外壳内唯一） | 否（文档表述） | **否** |
| F-E | 中 | e2e 脚本附着「第一个 page target」⇒ 遗留标签页回放导致**假失败** | 否（夹具） | **否** |
| F-F | **高** | 写请求 8 s 超时被 `silent:true` **静默吞掉** ⇒ **静默丢数据** | **否**（既存） | **否**（非停靠重构范围） |

> **F-F 是本次唯一「高」严重度发现**，但它**不属于停靠重构范围**，故**不影响本次验收判定**；
> 已按 captain 裁定标为**残余风险**并建议另开任务。

---

## §11 结论

### 11.1 验收判定

| 维度 | 判定 | 依据 |
|---|---|---|
| **八项能力** | **通过**（能力 6 已由真实浏览器实测；其余 6 项交互子项标「需人工确认」） | §4 + §5.5 真实浏览器探针 |
| **能力 6 中心槽闭环** | **通过** | §5：源码四处修复 + 宿主派生 + **真实浏览器 DOM 计数**（`plainRelationGraph=0`）+ 17 用例单测 |
| **构建产物** | **通过**（按**修正后**的 per-chunk 判据） | §3：同 chunk 不重复、跨 chunk 值一致（`hsl(220 13% 13%)`）；`dockview`×69 证明真实接入 |
| **验收命令** | **全部 EXIT=0** | §2：type-check / lint（0 error, 1 warning）/ build / test（12 files, 153 passed）/ verify-all / verify-plugin-mode-separation / verify-theme-single-source / e2e-mode-separation |
| **跨平台洁净度** | **通过** | §6：内核与外壳 0 处平台绑定 |
| **e2e（core-flows）** | **38/39 通过**；唯一失败项**已定性为既存缺陷、非停靠重构回归** | §7.2–7.5 |
| **ADR 三条偏离** | **登记**（保留 `--ink*`、零删除、悬挂引用记残余风险） | §8 |
| **未自动化交互项** | **6 项「需人工确认」**，附人工步骤，**未伪造通过** | §9 |

**总判定：停靠重构基线通过独立复测。** 未发现本次重构引入的功能缺陷。

### 11.2 与 captain 基线的交叉核对

| 基线项 | captain | t4 独立复测 | 一致 |
|---|---|---|---|
| 测试基线 | 12 files / 153 passed | **12 files / 153 passed** | ✅ |
| lint | 0 error / 1 warning | **0 error / 1 warning**（`DockShell.tsx:360:5` unused eslint-disable） | ✅ |
| 构建产物 hash | `ProjectLayout-BE5p2nO0.js` 437.53 kB | **重建后 hash/体积完全一致** ⇒ 构建确定性、dist 对应当前源码 | ✅ |
| `dockview` 计数 | 69 | **69** | ✅ |
| CSS 判据 | **per-chunk**（原「恰好 1 次」判据错误） | **per-chunk 通过**；旧判据会得 **2 次 → 假失败** | ✅ |
| 三文件哈希 | `AFE36EFC…` / `309663DE…` / `59EFD75C…` | **逐字节一致**（24715 B / 15828 B / 6454 B） | ✅ |
| 唯一 `center:true` | 1 处 | **1 处**（`panels.tsx:49`） | ✅ |
| `--ink*` 消费点 | 187 | **187**（72+83+32） | ✅ |
| §6.5 零删除 | 正当 | **正当**（`.nm-ink`/`.nm-brush` 选择器各 **0** 次） | ✅ |
| 工作区清洁 | 已清理回退副本 | `DockShellReverted.tsx` = **False**、`__scratch__` = **False** | ✅ |

### 11.3 遗留事项与建议

| # | 事项 | 建议 |
|---|---|---|
| 1 | **F-F 静默丢数据**（高，既存） | **另开任务**：超时可见化/可重试；写入走独立连接或队列；修 `EditorPage.tsx` 未防抖 + `styleService` 缺 signal 参数 |
| 2 | **F-E 夹具附着遗留标签页**（中） | 夹具侧修 `page = pages.find(...)` 增加 URL 校验；或运行前清理遗留 page target |
| 3 | F-A / F-B / F-C / F-D（低） | 随后续清理任务一并处理（注释更正、参数抽取、显式依赖、文档表述） |
| 4 | §9 的 6 项「需人工确认」 | 由具备真实桌面环境的人员按步骤核对（含 Linux 运行时） |
| 5 | ADR §5 产物判据表 | 建议把「恰好 1 次」改为「**同一 chunk 内不重复，且各 chunk 值一致**」，避免后续成员误判 |

### 11.4 方法与边界声明

- **本次验证未修改任何产品源码**。所有 e2e 变体均为 `scripts/e2e/*.mjs` 的**影子副本**，
  存放于仓库外 `.verify-scratch/`，与原文的字节差异**仅为注入块**（`node --check` 均 EXIT=0）。
- **未执行** `git checkout` / `git restore` / `git stash` / `git clean`。
- **无法自动化的交互项一律标「需人工确认」**，给出人工核对步骤，**未伪造为通过**（§9）。
- 所有结论均以**可复现的命令输出 / 探针日志**为支撑，证据文件路径已在各节标注。

---
