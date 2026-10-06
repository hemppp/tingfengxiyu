# 更新日志

本文件记录 NovelMuse（听风细雨）的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-06

停靠式工作台（Dock）重构与桌面端（Electron）首个可用版本。

### 新增

- **桌面端（Electron）**：主进程 + 内嵌 server 子进程，内置 server 负载与
  seed 插件；交付 **Windows x64 便携版（Portable）** 与 NSIS 安装版。
  首启自动播种数据目录，退出走优雅关闭通道。
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

### 已知限制

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
