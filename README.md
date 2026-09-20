# NovelMuse

> 以人为核心的长篇小说创作工具 —— 追踪角色、地点、物品与事件，帮作者保持叙事的一致性与深度。

空山雨后 · 水墨主题 · 本地优先（数据全部保留在作者设备上）

---

## 特性

- **沉浸式编辑器** — Typora 风格 Markdown 体验、实时字数、专注模式
- **知识库** — 角色 / 物品 / 地点 / 事件时间线，含关系图
- **伏笔系统** — 六种伏笔类型、自动阈值、逾期提醒
- **标注系统** — 划词标注实体与伏笔，高亮 + 快速导航
- **AI 辅助** — 实体提取、一致性检查、风格分析、续写建议
- **大纲与笔记** — 树形大纲 + 便签式笔记
- **数据统计** — 写作目标、习惯追踪、成就系统
- **导出** — Markdown（PDF / EPUB 计划中）

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 · TypeScript · Vite 6 · Tailwind 3.4 · Zustand · Tiptap |
| 后端 | **`@deepseek-ai/cordis` 4.0.1 插件基座** · Hono（经薄适配器接入基座 HTTP 层） |
| 数据 | SQLite（better-sqlite3）· 多库：主库 `novelmuse.db` + 每项目一库 `projects/{id}.db` · Drizzle ORM |
| 运行时 | **Node.js 24** — better-sqlite3 编译于 ABI 137，**Node 22 会 `ERR_DLOPEN_FAILED`** |
| 工具链 | pnpm workspaces · Vitest · GitHub Actions |

---

## 架构

```
apps/web  (React SPA，生产态由基座静态托管)
    │  HTTP /api/*   (Hono 路由)
apps/server = cordis Context 宿主
    ├─ 20 个业务模块       auth / projects / chapters / …
    ├─ novel.ai           tools / skills / agents
    ├─ novel.admin        插件管理（plugin-manager）
    └─ 本地插件            novel.autowrite / novel.bookscan / novel.typography
```

服务端已全面迁移到 cordis 插件基座 —— **20 个 API 模块 + AI 层 + 管理端 + 外部插件**全部以插件形式装配（运行时共 25 个插件）；`packages/core` 退化为**纯契约包**。
插件契约：`{ name, inject, apply(ctx, config) }`，通过 `ctx.routes / ctx.db / ctx.ai / ctx.events` 注入能力，`ctx.plugin()` 挂载、fiber 隔离、`dispose()` 卸载。

详见 [`docs/architecture/`](docs/architecture/)。

---

## 快速开始

**环境要求**：Node **24**、pnpm ≥ 8。

```bash
pnpm install        # 首次安装
pnpm dev            # 同时起 web (5173) + server (3774)
pnpm dev:server     # 仅后端（tsx watch）
pnpm build && pnpm start:server   # 生产：静态资源由基座托管
```

> ⚠️ **better-sqlite3 是 native 模块**，ABI 必须与「安装依赖时所用的 Node 大版本」一致。
> 切换 Node 大版本后须重跑 `pnpm install` 重新编译，否则启动即 `ERR_DLOPEN_FAILED`，
> 并**被静默降级**为 `status:degraded` —— 不报错，只是插件全部加载失败，极难排查。

**首次登录**：用户名默认 `admin`（可用 `ADMIN_USERNAME` 覆盖）。密码取 `ADMIN_PASSWORD` 环境变量；
未设置时会**自动生成随机强密码并打印到控制台（仅显示一次）**，请立即登录修改。
生产环境必须显式设置 `JWT_SECRET`（缺失将拒绝启动）。

**运行测试**

```bash
pnpm verify:all                     # 全量：两侧单测 + 记忆不变量抽查（串行）
pnpm -r test                        # 仅单元测试
pnpm --filter @novel/web test:coverage
```

---

## 项目结构

```
apps/
├── web/          React SPA（前端插件注册表 @novel/core/web）
├── server/       cordis 宿主：业务模块 + AI 层 + 管理端
├── agents/       Python Strands Agents 微服务（可选，docker profile）
└── plugins/
    ├── worldbuilding/   示例完整插件
    └── local/           本地插件：novel.autowrite / novel.bookscan / novel.typography
packages/
├── core/         纯契约包（manifest zod + 类型 + 浏览器安全入口）
├── db/           数据库 Schema 与迁移
└── shared/       共享类型定义
scripts/          验证与运维脚本
docs/             项目文档
```

---

## 文档

| 目录 | 内容 |
|---|---|
| [`docs/handover/`](docs/handover/) | **接手开发先读这里** —— AI 写作模块现状、未完成清单与已知陷阱 |
| [`docs/architecture/`](docs/architecture/) | 插件架构、多智能体流水线、分层记忆、Skills 库 |
| [`docs/design/`](docs/design/) | [设计系统](docs/design/design-system.md) · 墨韵工艺层 · 工作台设计 |
| [`docs/reports/`](docs/reports/) | 验证报告与审计记录 |
| [`docs/skills/`](docs/skills/) | 可复用的写作技能定义 |

---

## 贡献

欢迎 Issue 与 PR。

1. Fork 本仓库
2. 创建特性分支 `git checkout -b feature/amazing-feature`
3. 提交（遵循 Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）
4. 推送并创建 Pull Request

---

## 许可证

[Apache License 2.0](LICENSE) © 2026 hemppp

---

## 致谢

[React](https://react.dev/) · [Tiptap](https://tiptap.dev/) · [Drizzle ORM](https://orm.drizzle.team/) · [Hono](https://hono.dev/) · [Zustand](https://zustand-demo.pmnd.rs/) · [cordis](https://github.com/deepseek-ai/cordis)
