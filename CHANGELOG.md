# 更新日志

本文件记录 NovelMuse（听风细雨）的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
