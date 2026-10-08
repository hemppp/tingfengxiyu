# 更新日志

本文件记录 NovelMuse（听风细雨）的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-06

停靠式工作台（Dock）重构与桌面端（Electron）首个可用版本。

### 新增

- **桌面端（Electron）**：主进程 + 内嵌 server 子进程，内置 server 负载与
  seed 插件；交付 Windows x64 的**两种形态**：NSIS 安装版与
  **标准绿色 zip**（`NovelMuse-Portable-0.2.0-x64.zip`，解压后进顶层
  `NovelMuse/` 双击 `NovelMuse.exe`）。
  首启自动播种数据目录，退出走优雅关闭通道。
  > 单文件便携 exe（`NovelMuse-Portable-0.2.0-x64.exe`）曾作为第三种形态提供，
  > 已于 **2026-10-06 移除**（见下方「变更」与 ADR D4.6）。
- **停靠式工作台（Dock）**：以 `dockview` 重建项目页布局 —— 活动栏、
  左/中/右三栏与底部细条，面板可拖拽停靠；新增 **文档标签**（DocTabs）
  接管中心区组头，可打开 / 关闭「章节正文 / 人物设定 / 大纲」等标签。
- **插件停靠协议 D9**：插件侧对接停靠面板注册与中心区抢占
  （`dock:{center:true}`），并补齐 `auto` 创作台入口。
- **编辑器批注块**：`AnnotationBlock` 扩展 / 视图 / 桥接钩子，
  选中文本可插入批注块，支持章节元信息与导出。
- **AI 对话面板**：`auto` 工作台新增 AI 对话面板与 SSE 流式通道。
- **UI 集成自测**：`scripts/e2e/e2e-ui-integration.mjs`，覆盖三栏布局、
  文档标签、视口契约、mode 切换、AI SSE 与控制台错误等 11 个小节。

### 变更

- **创作模式入口收口**：移除项目页顶栏的「AI 写作 / 手写写作」切换按钮组。
  创作模式在**建书时**决定，界面只被动展示当前模式（状态栏），不再提供
  中途切换入口 —— 进入 AI 写作就是 AI 写作，手写写作就是手写写作。
- **子界面返回键**：进入子界面（设置 / 管理员 / 工作台未安装占位）统一提供
  左上角小返回键，用户可原路返回，不再出现「进得去出不来」。
- **主题**：删除 `shuimo`（水墨）主题，统一为 VS Code Modern 亮 / 暗色。

### 修复

- **文档标签重复行**：中心区组头与文档标签曾出现两条重复行，已收敛为一行。
- **便携版首启无反馈（已修）**：单文件便携 exe 在未配 `portable.splashImage` 时，
  electron-builder 的 `portable.nsi` 会走 `SetSilent silent` ⇒ 双击后要静默自解压
  数分钟且全程无窗口，用户据此判定「启动失败」。现已配启动图
  （`build-resources/splash.bmp`），解压全程可见提示。
- **便携版负载过大（已修）**：配套把 server 负载从 **240.8 MB / 32158 文件** 裁剪到
  **68.2 MB / 5911 文件**（剔除 web-only 依赖与第三方包内 `.map`/`.d.ts`/文档），
  单文件 exe 首启自解压由约 **4.5 分钟**降到约 **1–2 分钟**；绿色 zip 约 **190 MB**，
  解压约 **5 秒**，双击即起窗。
- **便携版首启无反馈（已废）**：曾为单文件便携 exe 补 `portable.splashImage`
  以消除「双击后数分钟无窗口」。该 exe 形态已整体移除，此修复连同
  `portable` target 一并作废（ADR D4.6）。

### 变更（2026-10-06 同日修订）

- **移除单文件便携 exe**：便携版**只保留 zip 一种形态**。`win.target` 回退为
  只有 `nsis`；`portable` 配置段与 `dist:portable` 脚本一并删除；
  `release/desktop/NovelMuse-Portable-0.2.0-x64.exe`（122219604 B）已从产物目录删除。
  理由：与绿色 zip 功能完全重叠，且它是 NSIS 自解压 stub —— 首启实测 64–102 s，
  并独占 D4.5-1 记录的两个假象（`Error writing temporary file`、无窗口静默 exit 0）；
  zip 解压约 5 s 且解压后就是普通 exe，没有 stub 这一层。
  **文件名不变**：便携版 zip 仍叫 `NovelMuse-Portable-<version>-x64.zip`
  （「Portable」指便携形态，不是 portable target）。
- **修掉「封装版界面与网页版不一致」的成因**：桌面端的前端与后端**不是**从安装目录
  直接运行，而是**首启播种一次**到 `%APPDATA%\NovelMuse\app-runtime\{web-dist,app-server}`，
  之后再装新版安装包 / 换新版便携 zip **都不会刷新它**（播种闸门只看
  <code>app-runtime\version.json</code> 是否存在，从不比较版本号，见
  <code>docs/architecture/desktop-packaging-adr.md</code> D7.2）。本次已清除本地
  冻结的旧运行时（含先摘除 `app-server\data` 与 `app-server\node_modules\better-sqlite3`
  两个 junction，避免递归删除穿透链接删掉书稿库），下次启动会按新包重新播种。
  **注意：代码层面的「版本变了就重新播种」尚未实现**，是残留缺陷。
  （该残留缺陷已于下方「修复（同日修订 2）」中实现，见 ADR D7.5。）

### 修复（2026-10-06 同日修订 2）

- **播种闸门现在会识别「同版本号重新打包」（ADR D7.5）**：以往闸门只判
  `app-runtime/version.json` 是否存在，于是**在同一个版本号（如 0.2.0）下重新打包**后，
  用户装上新包仍看到旧界面/旧后端 —— 闸门跳过播种，而 `copyDirNoClobber` 又对
  已存在文件一律跳过。现在新增**载荷指纹** `buildId`：打包脚本对
  `app-server + seed-plugins + web-dist` 三棵树做 `sha256(sorted "<label>/<relpath>|<bytes>")`
  取前 32 位，写 `<resources>/app-server/build-stamp.json`。启动时三条触发条件任一成立
  即重新播种：`missing`（无 version.json）/ `shell-newer`（安装包版本更高）/
  `payload-changed`（**版本号相同但指纹不同**）。
- **重新播种会先清空旧运行时**（否则 `copyDirNoClobber` 一个文件都复制不进来）：
  清 `plugins/node_modules` → `app-runtime/app-server` → `app-runtime/web-dist` →
  `plugins/{auto,manual,shared}`；`plugins/local`（用户自装）不碰。
  **数据安全**：删除逐条目 `lstat` 判定，**链接只摘链接、绝不递归跟随**，
  也绝不对 `app-runtime/app-server` 做 `fs.rmSync(..., {recursive:true})`
  （那会穿透 `data` junction 删掉全部书稿）。另加两道自检：清理前若
  `app-server/data` 是**真实非空目录**（D7.3 junction 未建成的历史遗留）则**拒绝播种**；
  清理后自证 `<userData>/data` 仍存在。
- **应用内更新不再被误判为陈旧**：更新器替换载荷后会把更新包里的 `buildId`
  一并写入 `version.json`（ADR D14.5 步骤 8），避免下次启动被判成
  `payload-changed` 而把刚装好的运行时回退成安装包里的旧载荷。
- **开放注册（打包态）**：`apps/server/src/modules/auth.ts` 在 `ALLOW_REGISTRATION`
  未定义时按 `NODE_ENV !== 'production'` 判定，而桌面端打包态 `NODE_ENV` 恒为
  `'production'` ⇒ 桌面版「注册」页会被 403 拒绝，与网页版行为不一致。现由主进程
  在打包态显式注入 `ALLOW_REGISTRATION='true'`（ADR D6 / D12.5）。
  **注意**：这是环境变量层面的开放，**前端没有注册开关 UI**，注册页在导航上始终可见。
- **启动日志**新增 `reseeded=` 字段，便于确认本次是否发生了重新播种。

### 变更（2026-10-07 死代码清理）

全仓零入边扫描（421 个源文件，排除 node_modules / dist / payload）后删除 **21 个零引用文件**
（约 2329 行 + 一张 768 KB 启动图），并清掉随之变空的 4 个目录：

- **迁移遗留的插件组件（8 个）**：`manual/workbench/web/` 下的
  `consistency/ConsistencyPanel.tsx`、`series/SeriesManager.tsx`、`snapshot/SnapshotManager.tsx`、
  `knowledge/Heatmap.tsx`、`foreshadow/EarmarkPanel.tsx`、`foreshadow/ForeshadowsPage.tsx`、
  `editor/extensions/MentionExtension.ts`、`editor/extensions/RealtimeRhythm.tsx`。
  它们来自 web→插件拆分那轮迁移，拆分契约明令「不删除任何文件」，
  之后**再没有任何注册点挂上去**（`web/index.tsx:46` 只注册了一个 `key:'chapters'` 面板）。
- **未接入路由的页面（1 个）**：`apps/web/src/pages/ProjectSelectPage.tsx`
  —— `App.tsx` 路由表、`lazyRoute`、字符串路径三处均无引用。
- **零引用的兼容垫片（9 个）**：`apps/web/src/` 下 9 个 1–4 行的再导出壳
  （`components/layout/{BottomDrawer,RightSidebar}.tsx`、`hooks/useCurrentProjectId.ts`、
  `services/data/localUserData.ts`、`services/editor/{rhythmService,styleService}.ts`、
  `stores/{cascadeCleanFlag,editorStore,outlineNotepadStore}.ts`）。
  **只删壳**：它们指向的实体仍在 `@novel-plugins/{data-core,ui-kit}` 里并由插件直接引入
  （`apps/web/src` 另有 19 个同类垫片仍被引用，保留）。
- **无人调用的服务（1 个）**：`apps/server/src/services/demo-seed.ts`
  （`seedDemoData` 已导出但全仓无调用点）。
- **portable 目标移除后的孤儿资产（2 个）**：`apps/desktop/build-resources/splash.bmp`
  （唯一消费者 `portable.splashImage` 已随 D4.6 作废）与生成它的
  `apps/desktop/scripts/gen-splash.py`。

验证：`pnpm -r type-check`（14 workspace）✓、`pnpm --filter @novel/web build` ✓、
`pnpm verify:all` ✓。构建产物**仍是 49 个 chunk、一个都没少**
（本次删除的代码此前就已被 tree-shaking 排除在包外），仅 chunk 文件名哈希发生漂移；
因此 `buildId` 会变化，桌面端下次启动会按 D7.5 自动重新播种。

### 已知限制

- 桌面端产物**未做代码签名**：首次运行会触发 Windows SmartScreen 提示，
  选择「仍要运行」即可。
- AI 自动写作模块（`novel.autowrite` 引擎与 `novel.auto.workbench` 界面）
  处于剥离态：打开 `mode=auto` 的项目会显示「AI 写作台未安装」占位，
  这是预期行为，不会崩溃或白屏。

## [0.1.0] - 2026-10-01

首个公开版本。

### 新增

- **手写台（manual）**：章节编辑器、角色 / 势力 / 参考书 / 笔记 / 统计 / 大纲 /
  时间线 / 地点 / 伏笔 / 物品 / 关系图 / 地图 / 导出 / 字体排版等面板。
- **AI 能力**：AI 写作辅助、技能注册表、多代理流水线框架、记忆水车。
- **插件基座**：基于 Cordis 的插件宿主，27 个插件按创作模式物理拆分
  （`manual` / `auto` / `shared`）；宿主 `HOST_MODE` 可在启动期裁剪插件集合。
- **数据层**：SQLite（better-sqlite3），项目级独立数据库。
- **认证**：JWT + HttpOnly Cookie（`SameSite=Strict`），前端 JS 不可读。
- **部署**：Docker 多阶段构建；Windows 免安装运行包。

### 变更

- **AI 自动写作模块剥离**：`novel.autowrite`（服务端引擎）与
  `novel.auto.workbench`（AI 写作台界面）的实现已移出仓库，
  仓库内仅保留 7 个骨架文件作为**预留接口（插座）**：
  - `plugin.json` / `package.json` / `tsconfig.json` 逐字节保留原样；
  - `server/index.ts` 为 no-op 挂载点（满足 G1 结构门）。
  - 插拔接线保留：`apps/web/src/plugin/moduleEntries.ts` 的构建期 glob、
    workspace 依赖与 tsconfig paths。
  - 手写台与共享 AI 层不受影响，对剥离模块零编译期依赖。

  装回方式见 `F:\new1.2-detached\ai-autowrite-module\PLUG-BACK.md`
  （整包回填 `workbench/` 与 `novel.autowrite/` → 重启 vite 与 server）。

### 修复

- **CI**：`node-version` 由 20 修正为 24（项目要求 Node ≥ 24；
  better-sqlite3 为原生模块，Node 22 及以下会 `ERR_DLOPEN_FAILED`）。
- **JWT 密钥**：移除源码内公开的固定回退值，改为生产环境强制要求
  `JWT_SECRET`，开发环境使用持久化随机密钥。
- **凭据存储**：不再把密码写入 `localStorage`，仅保存用户名，
  并主动清除历史遗留的加密键。
- 插件门禁支持「受支持缺席」：剥离态下 `auto` 缺席不计违规，
  但 `manual` 缺席仍会致红。

### 已知限制

- AI 自动写作模块处于剥离态：打开 `mode=auto` 的项目会显示
  「AI 写作台未安装 —— 该创作模式对应的模块未启用」（预期行为）。
- `apps/agents`（Python Strands Agents 微服务）为可选组件。
