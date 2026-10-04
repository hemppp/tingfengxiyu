# NovelMuse 接手交接 · 停靠重构 / 主题单一真源 / 插件模式拆分 / Electron 桌面端

> **编写**：团队一号（DSH 内置 Agent Teams）成员 `handover-scribe`，2026-10-04
> **覆盖范围**：2026-10-01 20:56（HEAD `a0e1db0`）之后、至 2026-10-04 四条工作线的产物与结论
> **不覆盖**：AI 写作模块现状（→ `ai-writing-handover.md`）、多代理流水线历史故障现场（→ `UNFINISHED-pipeline-blocked.md`）
> **口径**：`[实测]` = 2026-10-04 本次交接期现场跑出的结果；`[报告]` = 引用仓库内已有报告原文；`[未验证]` = 仓库内找不到依据的事项，**不得当作通过**。
> **本文未做的事**：没有执行任何 git 写操作（不 commit / 不 add / 不 stash / 不 clean）；没有改源码；只写 `docs/handover/`。

---

## 0. 先看这 6 件事

1. **仓库只有 2 个 commit，四条工作线的产物几乎全在工作区。** HEAD = `a0e1db0cffa93b86bc2c9d771a16ad660f1103b8`（`a0e1db0` 2026-10-01 20:56:49），工作区 `git status --porcelain` = **68 项** `[实测]`。接手第一件要决定的事是「先锁定再改」——建议先提交或至少建分支，否则一次 `git add -A` 会把整个未验证的桌面端卷进历史。
2. **`apps/desktop/`（整个 Electron 桌面端）完全未被 git 跟踪** `[实测]`：`git ls-files apps/desktop` 为空，`git status` 里是 `?? apps/desktop/`。它自带 `apps/desktop/.gitignore`（忽略 `payload/`）。
3. **三份 ADR 与五份 10-02/10-03 报告也全部未入库** `[实测]`（列表见 §6.2）。接手者若只 `git log` 会完全看不到这些结论。
4. **桌面端打包会污染本机 ABI**：打包把仓库 `node_modules/better-sqlite3` 就地改成 Electron ABI 149，**打包后不 `pnpm install` 恢复 ABI 137，`pnpm dev` / `pnpm test` 全部失败**（详见 §4.4）。
5. **停靠重构有一项「高」残余风险未修**：写请求超时被静默吞掉 ⇒ 静默丢数据（`§3.5 F-F`）。另有 `--ink*` 主题变量迁移（187 处）未做。
6. **`release/desktop/` 里的安装包已被重新打包过**：磁盘上是 2026-10-03 21:11–21:13 的产物，SHA256 与两份报告记录的 19:13 产物**不一致** `[实测]`（详见 §5.5）。报告里的哈希 attestation 只对 19:13 那轮成立。

---

## 1. 版本库 / 工作区现状（2026-10-04 实测）

### 1.1 git

| 项 | 值 | 来源 |
|---|---|---|
| HEAD | `a0e1db0cffa93b86bc2c9d771a16ad660f1103b8` | `[实测]` |
| 分支 | `main` | `[实测]` |
| commit 总数 | **2** | `[实测]` `git rev-list --count HEAD` |
| `c2583f8` | 2026-10-01 19:43:37 「chore: 剥离 AI 自动写作模块（保留插拔接口）」—— **513 files changed, 110355 insertions** | `[实测]` |
| `a0e1db0` | 2026-10-01 20:56:49 「chore: 版本定为 0.1.0 + 修正 CI Node 版本」—— 4 files changed, 55 insertions | `[实测]` |
| 工作区改动 | 68 项（含 19 个 `??` 未跟踪条目） | `[实测]` |
| 索引中已暂存 | `D  apps/web/src/components/shell/FloatingBubbles.tsx`、`D  apps/web/src/components/shell/PanelSection.tsx`（**两处删除已在 index 里**） | `[实测]` |

### 1.2 workspace 项目数口径

`pnpm -r list --depth -1` 列出 **15 个**：根 `novel-companion` + 14 个子项目 `[实测]`。
工程目录下实测的 14 个子项目：`apps/agents`、`apps/desktop`、`apps/plugins/auto/novel.autowrite`、`apps/plugins/auto/workbench`、`apps/plugins/manual/workbench`、`apps/plugins/manual/worldbuilding`、`apps/plugins/shared/data-core`、`apps/plugins/shared/ui-graph`、`apps/plugins/shared/ui-kit`、`apps/server`、`apps/web`、`packages/core`、`packages/db`、`packages/shared`。
> `apps/plugins/local/` **目录不存在**（多份旧文档里的路径已失效，见 §6.4）。
> `apps/desktop/payload/**` 与 `release/desktop/**` 下的 `package.json` 是打包产物，不是 workspace 项目。

### 1.3 68 项改动按工作线归类

| 工作线 | 代表路径 | git 状态 |
|---|---|---|
| ① 停靠（Dock）重构 | `apps/web/src/components/shell/{DockShell.tsx,PanelMenu.tsx,dock/,project-shell.css}`、`apps/web/src/plugin/__tests__/plugin-dock-adaptation.test.ts`、`apps/web/vitest.probe.config.ts` | 全部 `??` 未跟踪 |
| ② 主题单一真源 | `apps/plugins/shared/ui-kit/src/styles/`（`vscode-dark-modern.css` 13933 B）、`…/ui-kit/src/themeStore.ts`(M)、`apps/web/src/styles/shuimo.css`(D)、`themes.css`(D)、`apps/web/src/main.tsx`(M) | 混合 |
| ③ 插件按模式拆分 | `apps/plugins/**` 共 **146 个受跟踪文件** `[实测]`（拆分结构**已在 HEAD 里**）；未提交的是 `?? apps/plugins/auto/workbench/web/` 与若干 `M` 的插件 Web 文件 | 大部分已入库 |
| ④ Electron 桌面端 | `apps/desktop/`（整个目录 `??`） | 完全未跟踪 |
| 治理/验证脚本 | `scripts/verify/{measure-ink-consumers.mjs,verify-theme-single-source.mjs}` | `??` |
| 文档 | 3 份 ADR + 5 份报告（§6.2） | `??` |
| 夹具/杂项 | `scripts/e2e/e2e-core-flows.mjs`(M)、`e2e-mode-separation.mjs`(M)、`pnpm-workspace.yaml`(M)、`pnpm-lock.yaml`(M)、`.gitignore`(M) | 见 §1.4 |

> **与「四条线全部未提交」这个说法不同**：插件模式拆分的目录结构（`apps/plugins/{manual,auto,shared}/…`、146 个文件）**已经在 commit `c2583f8` 里**；未提交的是拆分之后的增量改动。见 §7 勘误。

### 1.4 忽略规则（与接手相关）

- `/release/` 已被 `.gitignore` 忽略 `[实测]` ⇒ 发布产物**不会**入库；`release/desktop/` 当前有 **32,521 个文件 / 1,146,962,174 B**（≈1.07 GB）`[实测]`。
- `/data/`、`dist/`、`node_modules/`、`*.db`、`.env`、`.agent-teams/` 均已忽略。
- `.gitignore` 本身**当前是 ` M` 状态**：2026-10-04 新增了 `.ps-smoke/` 与 `.verify-scratch/` 的忽略块（注释里写明这两个目录被三份报告引用为证据路径，**只忽略入库、保留磁盘实体，勿删**）。`apps/desktop/.gitignore`（忽略 `payload/`）是 `??`。

---

## 2. 四条工作线总览

| # | 工作线 | 契约文档 | 结论文档 | 状态 |
|---|---|---|---|---|
| ① | 停靠（Dock）重构：把工作台壳换成 dockview，外观改成 VS Code Dark Modern | `docs/architecture/dock-protocol-adr.md`（ADR-0007，845 行，2026-10-02 15:18）+ 收尾定稿 `dock-refactor-final.md`（549 行，15:33） | `docs/reports/dock-refactor-verification.md`（1099 行，15:22）、`dock-refactor-closeout.md`（735 行，15:42） | 收尾交付完成，**1 高 + 2 中残余风险**，6 项需人工确认，`--ink*` 迁移未做 |
| ② | 主题单一真源：三档水墨主题 → 单档 `vscode-dark-modern` | ADR-0007 §6（冻结） | 同 ① | 已完成；`verify-theme-single-source.mjs` 可复跑 |
| ③ | 插件按创作模式物理拆分（`manual`/`auto`/`shared`） | `docs/architecture/plugin-standard.md`、`plugins-inventory.md` | README L51、CHANGELOG 0.1.0 | **结构已入库**；增量改动未提交 |
| ④ | Electron 桌面端打包 | `docs/architecture/desktop-packaging-adr.md`（ADR-0008，951 行，2026-10-02 21:06） | `docs/reports/desktop-e2e-verification.md`（295 行）、`desktop-packaging-closeout.md`（211 行）、`desktop-shell-audit.md` | 19:13 那轮端到端可用；**§5 有 9 项未验证**；打包 ABI 纪律必须遵守 |

---

## 3. 工作线 ① + ②：停靠重构与主题单一真源（ADR-0007）

### 3.1 做了什么

- 工作台外壳改为 **dockview 8.4.0** 停靠模型：新文件 `apps/web/src/components/shell/DockShell.tsx`、`PanelMenu.tsx`、`shell/dock/`、`shell/project-shell.css`；删除 `shell/FloatingBubbles.tsx`、`shell/PanelSection.tsx`。
- 外观从「水墨（shuimo）」整体迁到 **VS Code Dark Modern**：
  - `ThemeId` 从 `'ink' | 'shuimo' | 'soot'` **收缩为单值字面量联合 `'vscode-dark-modern'`**；`THEMES` 恰好一项；默认 `mode` / `lockedMode` 均为 `dark`；`MIGRATION_KEY` 常量整体删除，旧值**静默回落默认**（不抛错、不提示、不写迁移标记）`[报告]`（`docs/architecture/dock-protocol-adr.md:677-687`）。
  - 色值真源唯一：`apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css`（13933 B，2026-10-01 22:16:29）`[实测]`，由 `apps/web/src/main.tsx:7` `import '@novel-plugins/ui-kit/styles/vscode-dark-modern.css';` 引入 `[实测]`。
  - 删除清单（ADR-0007 §6.4）：`apps/web/src/styles/shuimo.css`（127 处水墨引用）、`components/shuimo/`（13 处）、`dev/shuimoPreview.tsx`、`styles/themes.css`、`components/effects/{AmbientBackdrop,BambooLeafFollow}.tsx`、`ui-kit/src/InkBackButton.tsx`、`components/ui/InkBackButton.tsx`——以上**均已在工作区删除** `[实测]`（`git status` 的 `D` 行）。

### 3.2 验收证据（`[报告]`，均为 2026-10-02）

- 收尾报告 §10.1：十项判定全部 ✅/⚠️；**验收命令 7/7 EXIT=0**；测试基线 **12 files / 153 passed**；`shuimo|ink-wash` 全 `dist` 递归（82 个文件）残留 **0 / 0**。
- captain 回改后复测（§11.3）：七条命令全部重跑仍 7/7 EXIT=0 —— `type-check` 0 / `lint` 0（0 errors, 1 warning `DockShell.tsx:360`）/ `build` 0（`ProjectLayout-BE5p2nO0.js` 437.53 kB）/ `test` 0（12 files / 153 passed）/ `verify-theme-single-source` 0 / `verify-all` 0 / `verify-plugin-mode-separation` 0。
- 独立第二信源（团队一号 `verifier` 交叉印证，§11.4）：dockview 69 次、`dv-theme-vscode` 2 次、`nm-center-default` 1、`dockview-host` 1、`dndPanelOverlay` 4、`addFloatingGroup` 14、`moveTo` 9；`--vscode-editor-background` 每 CSS chunk 各 1 次且值均 `hsl(220 13% 13%)`；`DockShell.smoke.test.tsx` 17 tests（含 3 条中心槽回归）。
- 主题变量口径（§11.2，权威工具 `scripts/verify/measure-ink-consumers.mjs`，**测量工具、非门禁、退出码恒 0**）：`--ink` 72/69/73、`--ink-light` 83/82/84、`--ink-pale` 32/31/33，合计 `A_raw`(含块注释)=**187** / `B_code`(剔除注释)=182 / `C_bare`(裸 token)=190。

### 3.3 需人工确认的 6 项（`[报告]` closeout §5，t4 §9 原样转录，**未计 PASS**）

1. 能力 2：拖拽浮窗 + 拖回停靠；
2. 能力 5：落位预览可见性（`--vscode-panel-dropBackground` + 2px `--vscode-focusBorder`，圆角 0）；
3. 能力 7：分栏拖拽 sash（`--vscode-sash-hoverBorder`）；
4. 能力 4：标签堆叠交互顺序；
5. VS Code 外观一致性（对照 `apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css`）；
6. 能力 8：**Linux 运行时未实测**（源码级跨平台洁净度已自动 PASS，未自动验证的是 Linux 运行时）。

### 3.4 已登记的 findings（`[报告]` closeout §6）

收尾期 F-1（临时探针污染 vitest 收集范围）/F-1 附带（vitest 位置参数语义更正）/F-2（测试镜像漂移 ⇒ 8→12 tests）/F-3（`DockShell.tsx:360:5` 未用 eslint-disable，维持 0 errors / 1 warning）/F-4（ADR `fore-shadow`→`foreshadow` 笔误）/F-6（ADR 契约与实测矛盾，新增 §6.4-a 与 §6.5-a）。
验证期 F-A（`DockShell.tsx:450-451` 注释不实：dockview 8.4.0 对重复 id 是 **throw** 而非忽略）/F-B（`buildAddSpec` `:613-628` 与 openPanel center 分支 `:458-469` 重复硬编码）/F-C（`onActivitySelect` `:533-545` 隐式依赖）/F-D（`[aria-label="设置"]` 全仓 2 处：`ProjectLayout.tsx:397` 与 `pages/BookshelfPage.tsx:351`）/F-E（e2e 夹具附着「第一个 page target」⇒ 遗留标签页回放历史 console 造成假失败）。

### 3.5 残余风险与待办（`[报告]` closeout §4 / §10.2）

- **F-F（高，既存缺陷，非本次回归）——写请求超时被静默吞掉 ⇒ 静默丢数据。** 现象：UI 已显示新建角色（store 写入成功），后端返回 `{"data":[]}`，用户无提示。触发链：AI 端点饱和（8 并发、单条约 24 s 的 `analyze-style`）占满 6 条同源连接 ⇒ `POST /api/characters` 排队中被 **8 s 客户端超时** abort。关键位置：
  - `apps/plugins/shared/data-core/src/api/apiClient.ts:103` `const DEFAULT_TIMEOUT_MS = 8000;`，`:234` `const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;`，`:362-363` 超时错误 `if (!options?.silent) dispatchApiErrorEvent(timeoutErr);` ⇒ `silent: true` 时既不弹 toast 也不重试（该文件全文无 retry）。
  - `apps/plugins/shared/data-core/src/data/databaseService.ts:98` `async function apiSave<T …>`，`:105-112` 用 `silent: true` + `console.warn` + `return null`。
  - 上游成因：`apps/plugins/manual/workbench/web/editor/panels/StyleAdvisor.tsx:77-92`（建了 AbortController 却从未传入）与 `apps/plugins/shared/data-core/src/editor/styleService.ts:146` `async analyzeStyle(chapters: string[])`（签名无 `signal`，`:161` 固定 `{ silent: true, timeoutMs: 60_000 }`）⇒ 请求不可取消，abort 后仍占 socket 至 60 s。
  - 并发主来源：`apps/plugins/manual/workbench/web/editor/EditorPage.tsx:134-157`（`:134` deps `[chapters]`、`:142` 立即调用、`:136` 建 AbortController 从未传入）。
  - **范围判定**：`git diff --stat HEAD -- …/EditorPage.tsx` 为空，worktree blob = HEAD blob（`1ef7b123e44b85a14630ab87c92323fd07319bce`）⇒ 与 HEAD 逐字节相同，**不是停靠重构的回归**，建议另开任务。
  - ⚠️ **路径勘误**：任务交底与 t4 报告引用的 `apps/web/src/pages/EditorPage.tsx` **不存在**；真实路径是 `apps/plugins/manual/workbench/web/editor/EditorPage.tsx`（26730 B，2026-09-30 11:22:41）。
- **F-E（中）**：修 `scripts/e2e/e2e-core-flows.mjs:118` 与 `scripts/e2e/e2e-mode-separation.mjs:101-103` 的 `page = pages.find(...)`，加 URL 校验。
- **`--ink*` 悬挂引用**：`--ink-deep` 13 处、`--ink-soft` 5 处，全仓 0 定义（既存，登记不修）。
- **`--ink*` → `--vscode-*` 迁移任务（低·独立立项）**：涉及 **187 处**，**会改变外观，需独立评审，完成后才可删除三定义**。

---

## 4. 工作线 ④：Electron 桌面端（ADR-0008）

### 4.1 产物

- 代码在 `apps/desktop/`（**整个目录未入库**）：`src/main.ts`(21834 B)、`src/server-process.ts`(28596)、`src/paths.ts`(21542)、`src/updater/index.ts`(33854)、`updater/zip.ts`(15792)、`updater-manifest.ts`(11323)，以及 `env/logger/window/preload/ipc-channels/types/desktop-api.ts`、`updater/{backup,config,http,plugins,semver,types}.ts` `[报告]` closeout §1.3。
- 构建脚本：`apps/desktop/scripts/{build-update.mjs 17398, build-server-payload.mjs 11794, bundle-shell.mjs 4028, gen-icon.py 3735}`；配置 `apps/desktop/electron-builder.yml`(4377 B)；图标 `build-resources/{icon.ico 187891, icon.png 527794}`。
- 更新源 `release/updates/` **恰 7 项** `[实测]`（mtime 2026-10-03 16:58）：`manifest.json` 2431 B、`novelmuse-app-0.1.0.zip` 69,076,232、`novel.auto.workbench-0.1.0.zip` 11,096,747、`novel.manual.workbench-0.1.0.zip` 11,334,357、`novel.autowrite-0.1.0.zip` 5,353,042、`novel.bookscan-0.1.0.zip` 7,258、`novel.typography-0.1.0.zip` 7,263。

### 4.2 已验证（`[报告]` closeout §2 D1–D21 / e2e §0）

- e2e 报告：三形态（`win-unpacked` / NSIS / Portable）**全部端到端跑通**——启动、后端 `database=connected`、`plugins=27`、按 D7 落盘并建 junction、跨重启持久化、拦第二实例、优雅关停无残留。
- D5 端口握手成功（`http://127.0.0.1:<port>`，来自子进程 stderr）；D6 注入 78/79/82 项环境变量；D7 userData 布局 `app-runtime/ data/ plugins/ backups/ logs/ updates/` + junction 断言真；D8 `better_sqlite3.node` 1,921,024 B；D11 注册 9 条 IPC 通道；D12 全部 8 步完成 + 单实例聚焦；D13 stdin 优雅退出闭环；D17 **6/6 sha256 独立复算 MATCH**（针对 19:13 那轮产物）。
- R12 `compareVersions` 15/15 PASS（`.verify-scratch/semver-test.mts`）；R10 闭环（`.log`/`.txt` grep `MODULE_TYPELESS` 0 命中）；R11 `server.err.log` 1,243 B / `server.out.log` 5,669 B。

### 4.3 安装 / 运行事实（`[报告]` closeout §4）

- NSIS 静默 `/S` 实测 **285 s 退出码 0**；默认落点 `%LOCALAPPDATA%\Programs\NovelMuse`；只建开始菜单快捷方式「听风细雨」，**不建桌面快捷方式**；卸载保留 userData（`deleteAppDataOnUninstall=false`）。
- 首启一次性管理员初始密码写入 `<userData>\logs\initial-admin-password.txt`（23 B）。
- 便携版首启自解压约 3 分钟到 `%TEMP%\<随机目录>`，退出后删除。
- 便携版 userData 落 `C:\Users\1\AppData\Roaming\NovelMuse`，**与安装版完全相同、不重定向**；源码未消费 `PORTABLE_EXECUTABLE*`（R13，即使携版语义未落地）。
- 未签名安装包会触发 SmartScreen；**未安装 VC++ 运行库的行为未验证**。

### 4.4 ⚠️ 打包后 ABI 纪律（必须遵守，`[报告]` ADR-0008 §D8.1/§D8.4）

- 仓库内 `node_modules/better-sqlite3/…/better_sqlite3.node` = 1,919,488 B / **Node ABI 137**；Electron 44.5.1 运行时 = **ABI 149**。
- 桌面打包会**就地把仓库的 `.node` 重建成 ABI 149**（重建后 1,921,024 B）。没有 Electron 预编译包（`prebuild-install --runtime=electron --target=44.5.1` → **HTTP 404**），必须源码编译。
- **打包后必须 `pnpm install`（或 `pnpm rebuild better-sqlite3`）恢复 ABI 137**，否则 `pnpm dev` / `pnpm test` 全部失败；未重建直接跑会报 `NODE_MODULE_VERSION 137 vs 149`，日志出现 `[Server] 数据库初始化失败，将以降级模式运行`（**不阻断启动**）。
- 降级路径：`packages/db/src/index.ts:1351-1356` 捕获后回退 **sql.js**（内存库 + WASM）。
- closeout §5 第 9 项「`pnpm install` 后 ABI 复原（D8.4）的现场复核」**本次未执行** ⇒ 属未验证项。

### 4.5 ⚠️ 本机两处坑（`[报告]` closeout §4.3 / e2e §2）

1. **`ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化为纯 Node**：启动前先 `Remove-Item Env:\ELECTRON_RUN_AS_NODE -EA 0`。
2. **不要用重定向 stdio 的方式启动**（父进程持有 stdout/stderr 管道）——会触发下面的 EPIPE 缺陷。

**`main.log` EPIPE 自激写盘（真实缺陷，非验收项，本次未改码）** `[报告]` e2e §6：
以「父进程持有 stdio 管道」方式启动（`UseShellExecute=$false` + 重定向 stdout/stderr），关闭主窗口后进程不退出（观察到 3 个残留进程），`%APPDATA%\NovelMuse\logs\main.log` 数分钟内膨胀到 **3,519,024,054 B（≈3.9 GB）**，`totalLines=49,712,192`、`matchCount=4,519,287`（几乎全是同一行）。
机制：`apps/desktop/src/logger.ts` 的 `FileLogger.write` 先 `ringPush`，再 `if (this.echoToConsole) { … console.error(line) }`，之后才写 stream；`ShellLogger` 以 `echoToConsole=true` 构造 ⇒ `console.error` 抛 `EPIPE` → `process.on('uncaughtException')` 处理器再写日志 → 自激循环。
触发条件：**仅**在父进程 stdio 管道被关闭/断开时触发；正常双击或 `cmd /c start` 分离式启动不触发（分离式启动 `main.log` 仅 2,588 B）。

### 4.6 报告与磁盘的差异（本次实测发现）

| 项 | 报告（19:13 那轮） | 磁盘现状（2026-10-03 21:11–21:13） |
|---|---|---|
| `NovelMuse-Setup-0.1.0-x64.exe` | 177,697,975 B / SHA256 `1D53021050DE2929EC59CF3F03E74B62ED741F28C7FEB8D61A43A14DC49EB4D1` | **177,697,975 B**（同尺寸）/ SHA256 `15EC9B37B5E5965AEA5E47384291648FE89B23047BDA70DE9ACCBB26FD1A3CC8` **≠** |
| `NovelMuse-Portable-0.1.0-x64.exe` | 177,302,758 B / SHA256 `DDDF3A98…27ECB` | **177,302,760 B**（+2 B）/ SHA256 `CB2FD64BF33FA530B5C49E2E975CA0D1BD5936AAE7B1AB1134A3AFD8AA3C57DC` **≠** |
| `K1__uninstaller.exe` | 36,859 B | 存在，36,859 B |
| `builder-debug.yml` | 6,041 B | 存在，6,041 B |
| `win-unpacked/NovelMuse.exe` | 245,877,248 B | 245,877,248 B（mtime 21:12:16） |

⇒ **`release/desktop/` 当前不是两份报告验证过的那批产物**。报告里的哈希 attestation（D17 6/6 MATCH）只对 19:13 那轮成立；磁盘上这批（21:11–21:13，由 `apps/desktop/package.json` 于 21:10:54 恢复 `build` 块之后的重新打包产生）**其哈希未见于任何仓库内报告** `[未验证]`。
> 顺带：closeout §2/D16 与 §6 记的「`apps/desktop/package.json` 于 2026-10-03 19:26:48 被改写为 320 B、`build` 块 / `devDependencies` / `scripts` 全部消失，使打包不可复现，是发布前唯一需处置项」——**该偏离在交接时点已不复存在**：`[实测]` 2026-10-04 读到的 `apps/desktop/package.json` = **2547 B**（mtime 2026-10-03 21:10:54），`scripts`/`build`/`devDependencies` 均在场（`build` 块含 `directories.output=../../release/desktop`、`asarUnpack`、`extraResources`、`win.target=[nsis,portable]`、`nsis.shortcutName="听风细雨"`、`deleteAppDataOnUninstall=false`）。是否与 ADR-0008 D16.1 逐字一致 **未验证**。

### 4.7 closeout §5「未验证项清单」全文 9 项（标题原文为「不得视为通过」）

1. R5：打包态 tsx `.js`→`.ts`（`ai.ts:1351` 五条 AI 路由）需实调 `/api/ai/gateway`；
2. R4：量化的 Mode B 闭包「够用」缺收窄证据；
3. 完整 UI 交互链路（渲染层点击流）；
4. 自动更新端到端（下载→校验→解压→备份→替换→重启）未搭真实 http 更新源跑真实升级；
5. 便携版 `PORTABLE_EXECUTABLE*` 语义落地；
6. 代码签名 / SmartScreen；
7. `apps/desktop/package.json` 最终形态裁定；
8. 漂移后配置的冒烟打包 `--win dir --x64` 能否复现；
9. `pnpm install` 后 ABI 复原（D8.4）的现场复核（本次未在打包后执行）。

> 另：Mode B 依赖闭包实测 **265 包 / 252,475,413 B**，超 D4.2 基线 **189 包 / 107,768,288 B**（closeout §2/D4、`desktop-shell-audit.md` DEV-09）。closeout §3.5 与 shell-audit 把它写作「超基线 **134 MB** 未解决」；按同处两个数字相减为 252,475,413 − 107,768,288 = **144,707,125 B ≈ 144.7 MB（十进制）/ ≈ 138.0 MiB**，与 134 不符 —— 引用时请照抄原报告的「134 MB」并注明该算术差额。

---

## 5. 工作线 ③：插件按创作模式物理拆分

- 结构 `apps/plugins/{manual,auto,shared}/…`，父目录名即适用模式；manifest 新增 `modes` 字段（缺省 `['shared']`）；`HOST_MODE=manual|auto|all` 启动期裁剪；跨模式 `/api/plugins/*` 返回 **404 `PLUGIN_MODE_MISMATCH`**；目录与 `modes` 不一致由安装门 **G2.5 拒绝（`MODE_MISMATCH`）** `[报告]` README L51、`docs/architecture/plugin-standard.md`。
- 仓库内实际 `plugin.json` 共 **5 份** `[实测]`：`novel.autowrite`(modes `["auto"]`)、`novel.auto.workbench`(`["auto"]`)、`novel.bookscan`(`["manual"]`)、`novel.manual.workbench`(`["manual"]`)、`novel.typography`(`["shared"]`)。另外 `apps/plugins/manual/worldbuilding`、`shared/{data-core,ui-graph,ui-kit}` 只有 `package.json`、无 `plugin.json`（属被插件消费的工作区包）。
  > 「27 个插件」是 CHANGELOG 0.1.0 与桌面 e2e 的口径（`GET /api/health` 的 `plugins[]` 记到 `plugins=27`）；`docs/architecture/plugins-inventory.md`（2026-09-29）记的是 **25 个**。**「27」与「5 份 plugin.json」不是同一计量单位，未验证其换算关系。**
- 更新安装包口径：`release/updates/` 里的插件 zip 恰 **5 个**（auto.workbench / autowrite / bookscan / manual.workbench / typography），与 5 份 `plugin.json` 一一对应 `[实测]`。
- 拆分增量未提交部分：`?? apps/plugins/auto/workbench/web/`（当前只有 `web/index.tsx`）、`M apps/plugins/manual/workbench/web/{editor/BookScanDirectory.tsx, editor/panels/QuickPhraseBubble.tsx, index.tsx, outline/OutlineManager.tsx, panels.tsx}`、`M apps/plugins/shared/typography/web/index.tsx`、`M apps/plugins/shared/ui-kit/{package.json, src/aiBars.tsx, src/index.ts, src/themeStore.ts}`、`D apps/plugins/shared/ui-kit/src/InkBackButton.tsx` `[实测]`。

---

## 6. 接手后的前 30 分钟

### 6.1 先跑一遍基线（`[实测]` 2026-10-04 全部通过）

```bash
cd F:\new1.2
git status --porcelain                       # 68 项；先看清有哪些未提交
pnpm install                                 # 若刚打过桌面包，必须先做这步恢复 ABI 137
pnpm -r type-check                           # EXIT=0（Scope: 14 of 15；实际执行 5 个包）
pnpm -r lint                                 # EXIT=0；0 errors / 4 warnings
pnpm --filter @novel/web test                # 12 files / 153 passed
pnpm --filter @novel/server exec vitest run  # 7 files / 63 passed
pnpm build                                   # EXIT=0，12.93s，ProjectLayout-BE5p2nO0.js 437.53 kB
pnpm verify:all                              # node scripts/verify/verify-all.mjs
pnpm verify:modes                            # 插件模式隔离门
node scripts/verify/measure-ink-consumers.mjs # 主题变量三口径（测量工具，退出码恒 0）
```

`[实测]` 明细：`pnpm -r type-check` 只对 **5 个**带该脚本的项目实际执行（`apps/desktop`、`packages/core`、`apps/plugins/auto/novel.autowrite`、`apps/server`、`apps/web`），全部 `Done`，EXIT=0；`pnpm -r lint` 全仓 **0 errors / 4 warnings**（`apps/web` 1 条 = `DockShell.tsx:360:5` 未用 eslint-disable；`apps/server` 3 条 = 未使用变量）；web+server 单测合计 **19 files / 216 passed**。

### 6.2 还没入库的东西（先决定怎么处置）

```
?? apps/desktop/                                        # 整个桌面端
?? apps/web/src/components/shell/{DockShell.tsx,PanelMenu.tsx,dock/,project-shell.css}
?? apps/web/src/plugin/__tests__/plugin-dock-adaptation.test.ts
?? apps/web/vitest.probe.config.ts
?? apps/plugins/auto/workbench/web/
?? apps/plugins/shared/ui-kit/src/styles/
?? docs/architecture/{dock-protocol-adr.md,dock-refactor-final.md,desktop-packaging-adr.md}
?? docs/reports/{desktop-e2e-verification.md,desktop-packaging-closeout.md,desktop-shell-audit.md,dock-refactor-closeout.md,dock-refactor-verification.md}
?? scripts/verify/{measure-ink-consumers.mjs,verify-theme-single-source.mjs}
D  apps/web/src/components/shell/{FloatingBubbles.tsx,PanelSection.tsx}   # 已在 index 中
```

### 6.3 建议的处置顺序

1. 先提交/建分支锁住当前状态（68 项里含已验证与未验证混装，建议按工作线拆 commit）。
2. 修 **F-F（高）**：给 `styleService.analyzeStyle` 加 `signal`，把 `EditorPage.tsx:136` 与 `StyleAdvisor.tsx:85` 的 AbortController 真正传进去，并把 `apiSave` 的 `silent` 收窄（`docs/reports/dock-refactor-closeout.md` §4.1 有完整链路）。
3. 补 §3.3 的 6 项人工确认（含 Linux 运行时）。
4. 决定 `--ink*`（187 处 → `--vscode-*`）迁移是否立项——**会改变外观**。
5. 桌面端若要再发版：先按 §4.4 确认 ABI，再按 ADR-0008 重跑打包，并**重新生成哈希 attestation**（现有报告哈希与磁盘产物已不一致）。
6. 修 EPIPE 自激写盘（`apps/desktop/src/logger.ts` 的 `echoToConsole` 递归），或在文档里明确「禁止重定向 stdio 启动」。

### 6.4 已失效的旧引用（别照抄）

- `apps/plugins/local/novel.autowrite/server/pipeline/roles-phase.ts`（`UNFINISHED-pipeline-blocked.md` 里的修法路径）：**该目录已不存在**，文件也已不在（`[实测]` `Test-Path` 为 False）。引擎整包移出仓库到 `F:\new1.2-detached\ai-autowrite-module\`（含 `novel.autowrite/`、`workbench/`、`MANIFEST.json`、`PLUG-BACK.md`）`[实测]`；仓库内只剩 4 个骨架文件（`plugin.json`、`package.json`、`tsconfig.json`、`server/index.ts`）。
- `ai-writing-handover.md`（最后更新 2026-09-12）里的基线数字已过期：原文写 `pnpm type-check`「**8 个包**必须全绿」、server 单测「16 文件 / 213 用例」（2026-09-17 实测）——当前是 15 个 workspace 项目、server 7 files / 63 passed。
- `apps/web/src/pages/EditorPage.tsx` 不存在（见 §3.5 路径勘误）。

---

## 7. 勘误台账：转述 vs 原报告/实测

| # | 转述 | 原报告 / 本次实测 | 结论 |
|---|---|---|---|
| 1 | 「四条工作线**全部**在工作区未提交」 | `[实测]` 插件模式拆分的结构**已在 HEAD**（`git ls-files apps/plugins` = 146 个文件，`apps/plugins/{manual,auto,shared}` 均在 `c2583f8` 里）；未提交的只是拆分后的增量 | **部分不成立** |
| 2 | 「type-check **14/14** 通过」 | `[实测]` `pnpm -r type-check` 的原文是 `Scope: 14 of 15 workspace projects`（14 = **被选中的项目数**，不是通过数）；实际带 `type-check` 脚本并执行的只有 **5 个**，全部 `Done`、EXIT=0 | **数字来源被误读** |
| 3 | 「workspace **15** 个项目」 | `[实测]` pnpm 列 **15** 个（含根 `novel-companion`）+ 14 个子项目 | 成立（口径要写明含根 package） |
| 4 | 「lint 0 error」 | `[实测]` 全仓 `pnpm -r lint` EXIT=0，**0 errors / 4 warnings**；报告里的「0 errors, 1 warning」是 **web 单包**口径 | 成立但需补口径 |
| 5 | 「单测 **216** 通过」 | `[实测]` web 12 files/153 + server 7 files/63 = **19 files / 216 passed**，两套 EXIT=0。**两份报告自身都不写「216」**（216 是两处相加：dock 收尾 web 153 + desktop 收尾 server 63） | 成立（需注明是求和） |
| 6 | 「Mode B 闭包超基线 **134 MB**」 | `[报告]` closeout §3.5、shell-audit DEV-09 原话确实是 134 MB；但 252,475,413 − 107,768,288 = **144,707,125 B ≈ 144.7 MB / ≈138.0 MiB** | 原报告内部算术不自洽，引用需注明 |
| 7 | 「桌面端报告 §5 的**四条**未验证项」 | `[报告]` closeout §5 是 **9 行**表格；转述的 4 条对应第 1、2、4、5 行 | **不成立** |
| 8 | 「ABI 137/149 的打包后纪律」 | `[报告]` ADR-0008 §D8.1/§D8.4 原文一致：打包把 `.node` 就地改成 ABI 149 ⇒ 打包后必须 `pnpm install`（或 `pnpm rebuild better-sqlite3`）恢复 ABI 137，否则 `pnpm dev` / `pnpm test` 全部失败 | **成立** |
| 9 | 「`apps/desktop/package.json` 丢失 `build` 块，是发布前唯一需处置项」 | `[实测]` 该文件现为 **2547 B**（mtime 2026-10-03 21:10:54），`scripts`/`build`/`devDependencies` 均在 ⇒ 偏离已被修复；但修复后重新打包的产物（21:13）**哈希未经验证**，报告 §1.1 的哈希已与磁盘不符 | **报告结论已过期** |
| 10 | 「旧交接三文件 mtime 全是 2026-09-28」 | `[实测]` `ai-writing-handover.md` 2026-09-28 23:51:13 / `next-session-prompt.md` 2026-09-28 19:19:00 / `UNFINISHED-pipeline-blocked.md` 2026-09-28 19:19:00 | **成立** |

---

## 8. 文档索引

| 文档 | 内容 |
|---|---|
| `docs/architecture/dock-protocol-adr.md` | ADR-0007：停靠协议 + 主题单一真源契约（845 行，2026-10-02 15:18） |
| `docs/architecture/dock-refactor-final.md` | ADR-0007 收尾定稿：判据表、数字口径、与 ADR 的已知偏差（549 行，15:33） |
| `docs/reports/dock-refactor-verification.md` | 停靠重构验证详录（1099 行，15:22） |
| `docs/reports/dock-refactor-closeout.md` | 停靠重构收尾报告：D1–D21 式判定、残余风险、findings 台账、captain 回改（735 行，15:42） |
| `docs/architecture/desktop-packaging-adr.md` | ADR-0008：桌面打包契约（951 行，2026-10-02 21:06，已冻结） |
| `docs/reports/desktop-e2e-verification.md` | 桌面端 e2e 验证（295 行，2026-10-03 20:35）——含 §6 EPIPE 缺陷现场 |
| `docs/reports/desktop-packaging-closeout.md` | 桌面打包收尾：产物哈希、D1–D21、§5 未验证 9 项（211 行，20:39） |
| `docs/reports/desktop-shell-audit.md` | 桌面壳审计（52,141 B，17:12）——DEV-09 闭包超基线 |
| `docs/architecture/plugin-standard.md` | 插件标准：模式拆分、`modes`、G2.5 门 |
| `docs/architecture/plugins-inventory.md` | 插件清单（2026-09-29 版，记 25 个） |
| `apps/plugins/shared/ui-kit/src/themeStore.ts` | 主题 store 现状（单档，`ThemeId = 'vscode-dark-modern'`） |
| `README.md` L117–121 | 接手开发指路牌（`docs/handover/` 在先） |

---

> **一句话总结**：四条工作线的**结论都已写在仓库里，但几乎都没进 git**；接手先把基线跑通、按 §7 勘误表校正数字、按 §6.3 处置 F-F 与产物哈希，再看 §3.3 / §4.7 的未验证项清单——那些**不得视为通过**。
