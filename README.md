# NovelMuse 项目文档

> AI 辅助小说创作助手 — 空山雨后主题

> **接手开发请先读 [`docs/ai-writing-handover.md`](docs/ai-writing-handover.md)** —— AI 写作模块的现状、未完成清单与已知陷阱都在那里。
> 本文档是产品与架构总览；两者不一致时以接手必读为准。

---

## 📖 产品概述

NovelMuse 是一款以人为核心的长篇小说创作协作工具，帮助作者记住关于角色、地点、物品和事件的一切。与生成内容的 AI 写作助手不同，NovelMuse 通过追踪所有叙事元素，帮助作家保持故事的一致性和深度。

### 核心理念

- **作者至上**: 工具服务于作者，而非相反
- **一致性**: 确保叙事中的内部逻辑和连贯性
- **灵活性**: 适应任何类型或写作风格
- **隐私**: 所有数据保留在作者设备上

---


---

## 🧩 Cordis 基座架构（v2，已落地）

> 服务端已全面迁移到 **@deepseek-ai/cordis 4.0.1** 插件基座（DeepSeek Harness 同款内核）。
> **20 个 API 模块** + AI 层 + 管理端 + 外部插件，**全部以 cordis 插件形式装配**（运行时共 **25 个插件**）。

### 架构总览

```
┌─ apps/web（React SPA，生产态由基座静态托管）───────────────┐
│   前端插件注册表: @novel/core/web（纯浏览器安全入口）        │
└──────────────▲──────────────────────────────────────────┘
               │ HTTP /api/*（Hono 路由，经 hono-adapter）
┌──────────────┴──────────────────────────────────────────┐
│ apps/server = cordis Context 宿主（@deepseek-ai/cordis） │
│   ctx.plugin(WebServer, {host,port})  ← dsh-host-webserver
│   ctx.provide('routes'|'db'|'ai'|'events'|…)  ← 扩展点    │
│   ├─ novel.auth / projects / chapters / …（20 内置模块）   │
│   ├─ novel.ai（AI 层：tools/skills/agents）                │
│   ├─ novel.admin + novel.plugin-manager（插件管理）        │
│   ├─ novel.worldbuilding（示例完整插件）                   │
│   └─ 本地插件（ apps/plugins/local/* ）：                  │
│        novel.autowrite（AI 写作引擎）/ novel.bookscan /    │
│        novel.typography                                    │
└──────────────────────────────────────────────────────────┘
```

- **内核**：`@deepseek-ai/cordis`（真实基座，link 自 DSH 安装树），不再使用自研宿主；`packages/core` 退化为**纯契约包**（manifest zod + 类型 + 浏览器安全入口 `@novel/core/web`）。
- **HTTP 层**：`dsh-host-webserver` 提供 `ctx.webServer` 服务（路由/静态/upgrade/fallback），业务路由经 `hono-adapter`（自研薄适配器，错误显式记录）接入 Hono 应用。
- **插件契约**：插件 = `{ name, inject, apply(ctx, config) }`；通过 `ctx.routes / ctx.db / ctx.ai / ctx.events / ctx.effect` 等注入访问能力，`inject` 声明依赖。
- **生命周期**：`ctx.plugin()` 挂载 → fiber 隔离 → `ctx.fiber.dispose()` 卸载 → 禁用清单持久化（`novel.host/disabled-plugins`）。

### 快速启动

```bash
pnpm install          # 首次（link: 依赖指向本机 DSH 安装树）
pnpm dev              # 同时起 web (5173) + server (3774)
pnpm dev:server       # 仅后端（tsx watch）
pnpm build && pnpm start:server   # 生产：静态由基座托管
```

> 默认管理员用户名 **`admin`**（可用 `ADMIN_USERNAME` 覆盖），密码取 `ADMIN_PASSWORD` 环境变量；未设置时首次启动**自动生成随机强密码并打印到控制台**（仅显示一次，请立即登录修改）。引导仅在系统内**没有任何管理员**时执行，因此改名后不会再被重建。
> 生产环境必须显式设置 `JWT_SECRET`（缺失将拒绝启动）与 `ADMIN_PASSWORD`。
> 浏览器访问 `http://localhost:3774`（生产）或 `http://localhost:5174`（开发，代理到 3774）。
> 会话凭据（JWT）由服务端写入 **HttpOnly + SameSite=Strict Cookie**，前端 JS 不可读（XSS 无法窃取）；登录/注册接口不再返回 token。HTTPS 部署请设置 `COOKIE_SECURE=true` 使 Cookie 仅经加密通道传输。

### 验证（冒烟实测通过）

| 检查项 | 结果 |
|--------|------|
| 全工作区类型检查 `pnpm type-check` | ✅ 7/7 包通过 |
| 服务端构建 `tsc` + 前端构建 `vite build` | ✅ |
| `GET /api/health` | ✅ 200 · **25 个插件**全部 ok |
| 插件挂载 | ✅ **20 个内置模块** + AI + 管理 + worldbuilding + plugin-manager + 本地插件（`novel.autowrite` / `novel.bookscan` / `novel.typography`）均以 cordis fiber 挂载 |
| 业务链路（登录→建项目→读取→删除） | ✅ 200/201/200/200 |
| AI 写作链路（多角色讨论 → 三道门 → 交付 → 实体沉淀） | ✅ 真机验证，逐条证据见 `docs/verify-report-*.md` |
| 生产静态托管 / SPA 回退 / 未授权 401 | ✅ |

## 🛠 技术栈

### 前端
- **框架**: React 19 + TypeScript
- **编辑器**: Tiptap (富文本编辑器)
- **UI 组件**: Tailwind CSS + 自定义组件
- **状态管理**: Zustand
- **构建工具**: Vite 6.4.2
- **路由**: React Router v6

### 后端
- **插件基座**: `@deepseek-ai/cordis` 4.0.1 —— 全部业务模块以插件形式装配
- **API 框架**: Hono（经自研 `hono-adapter` 接入基座的 HTTP 层 `dsh-host-webserver`）
- **数据库**: SQLite（better-sqlite3）· 多库结构：主库 `novelmuse.db` + 每项目一库 `projects/{id}.db`
- **ORM**: Drizzle ORM 0.45.2
- **运行时**: **Node.js 24**（better-sqlite3 编译于 ABI 137，Node 22 会 `ERR_DLOPEN_FAILED`）

### AI 集成
- **API**: OpenAI-compatible API
- **功能**: 实体提取、一致性检查、风格分析、续写建议

### 开发工具
- **包管理**: pnpm workspaces
- **测试**: Vitest + Testing Library
- **CI/CD**: GitHub Actions

---

## 📂 项目结构

```
NovelMuse/
├── apps/
│   ├── web/              # React SPA（前端插件注册表 @novel/core/web）
│   ├── server/           # cordis 宿主：20 个业务模块 + AI 层 + 管理端
│   ├── agents/           # Python Strands Agents 微服务（可选，docker profile）
│   ├── desktop/          # 桌面端（空壳，尚未落地）
│   └── plugins/
│       ├── worldbuilding/   # 示例完整插件
│       └── local/           # 本地插件：novel.autowrite / novel.bookscan / novel.typography
├── packages/
│   ├── core/             # 纯契约包（manifest zod + 类型 + 浏览器安全入口 @novel/core/web）
│   ├── db/               # 数据库 Schema 与迁移
│   └── shared/           # 共享类型定义
├── scripts/              # 验证与运维脚本（verify-*.mjs / run-chapters.mjs / clean-*.mjs）
├── docs/                 # 项目文档；AI 写作模块以 ai-writing-handover.md 为准
└── README.md             # 本文件
```

---

## 🎨 设计系统 — 空山雨后

### 设计理念

1. **水墨书写**: 界面如同铺开的宣纸，所有元素都是墨痕与晕染
2. **远山层次**: 通过 SVG 远山背景营造空间纵深与时间沉淀
3. **克制的留白**: 东方美学在于"虚实相生"，空白处即是云气
4. **触笔手感**: 圆角、柔光、缓动曲线，模拟毛笔在宣纸上的运行
5. **亮色优先**: 长篇写作需要温暖而不刺眼的基底色

### 色彩系统

#### 主色板

```css
/* 基底 — 宣纸与墨 */
--background:  35 22% 92%   /* #EFE9DD 宣纸暖白 */
--foreground:  25 15% 18%   /* #322D26 墨色 */
--card:        35 28% 96%   /* #F8F2E7 浅宣纸 */
--border:      35 12% 78%   /* #D2C9B5 纸纹边 */

/* 主色 — 远山青 */
--primary:     178 35% 42%  /* #4F918C */
--ring:        178 35% 42%  /* focus 同主色 */
```

#### 远山与雾

| 名称 | HSL | 色值 | 用途 |
|------|-----|------|------|
| `mountain-cyan` | 178 35% 42% | `#4F918C` | 主远山青（主按钮、链接） |
| `mountain-light` | 178 25% 70% | `#A4C5C2` | 淡远山（hover 边） |
| `mountain-deep` | 195 40% 32% | `#336C78` | 深远山（次要强调） |
| `mountain-pale` | 178 30% 88% | `#D9E6E4` | 远山雾（光晕、focus 环） |
| `mist-blue` | 205 30% 70% | `#9DB8C6` | 雾蓝（信息提示） |
| `mist-pale` | 200 25% 88% | `#CFE0E6` | 淡雾（背景层） |

#### 水墨

| 名称 | HSL | 色值 | 用途 |
|------|-----|------|------|
| `ink` | 25 15% 18% | `#322D26` | 浓墨（主文字） |
| `ink-light` | 25 12% 38% | `#6E665A` | 淡墨（次要文字） |
| `ink-pale` | 25 10% 60% | `#A29A8E` | 灰墨（占位、辅助） |

#### 点缀色

| 名称 | HSL | 色值 | 用途 |
|------|-----|------|------|
| `cinnabar` | 12 60% 48% | `#C25B3A` | 朱砂红（危险、删除） |
| `willow` | 88 30% 48% | `#66944D` | 柳绿（成功、完成） |
| `ochre` | 38 55% 52% | `#C18A3E` | 赭石（伏笔、提醒） |

### 字体系统

```css
/* 无衬线 - 用于 UI 元素 */
font-family: 'Inter', system-ui, sans-serif;

/* 衬线 - 用于标题和文学内容（编辑器） */
font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif;

/* 等宽 - 用于代码和数据 */
font-family: 'JetBrains Mono', 'Fira Code', monospace;
```

### 组件样式

#### 按钮（4 种风格）

```tsx
// 主按钮：远山青渐变
<button className="btn-mist-primary">新建书籍</button>

// 幽灵按钮：墨色描边
<button className="btn-mist-ghost">取消</button>

// 软按钮：浅宣纸底
<button className="btn-mist-soft">次要操作</button>

// 朱砂按钮：危险操作
<button className="btn-mist-cinnabar">删除</button>
```

#### 卡片（3 种风格）

```tsx
// 宣纸卡（基础）
<div className="card-mist">...</div>

// 浮起墨晕卡
<div className="card-mist-elevated">...</div>

// 远山装饰卡
<div className="card-mist-mountain">...</div>
```

#### 输入框

```tsx
<input type="text" className="input-mist" placeholder="输入..." />
```

### 动画系统

#### 入场动画

| 类名 | 时长 | 效果 |
|------|------|------|
| `animate-fade-in` | 0.25s | 淡入上移 |
| `animate-slide-up` | 0.3s | 上滑 |
| `animate-card-enter` | 0.45s | 卡片入场 |
| `animate-text-reveal` | 0.6s | 文字模糊清除 |

#### 持续动画

| 类名 | 时长 | 效果 |
|------|------|------|
| `animate-mist-drift` | 22s | 雾气横向漂移 |
| `animate-float` | 3s | 微妙上下浮动 |
| `animate-tree-sway` | 3s | 树摇曳 |
| `animate-shimmer` | 2.4s | 骨架屏闪烁 |

### 视觉效果

#### 远山背景

```tsx
import { BambooMistBackground } from '@/components/backgrounds/BambooMistBackground';

<BambooMistBackground />
```

**特点**:
- 三层山脉（远山雾 / 远山青 / 深远山）
- 竹林 SVG 动画（4.5s / 6s / 9s 三档缓动）
- 雨 canvas 粒子效果
- 雾气带横向漂移动画
- `pointer-events: none` 不影响交互

---

## 🚀 快速开始

### 环境要求

- **Node.js 22+**（本项目 Dockerfile 使用 `node:22-alpine`）
- pnpm >= 8

> ⚠️ **better-sqlite3 是 native 模块，其 ABI 必须与「安装依赖时所用的 Node 大版本」一致。**
> 切换 Node 大版本后必须重跑 `pnpm install` 重新编译，否则启动报 `ERR_DLOPEN_FAILED`，
> 并被**静默降级**为 `status:degraded` —— 不报错、只是插件全部加载失败，非常难排查。

### 安装依赖

```bash
pnpm install
```

### 启动开发环境

```bash
# 启动 Web 开发环境
pnpm dev

# 单独启动后端
pnpm dev:server

# 单独启动前端
pnpm dev:web
```

### 运行测试

```bash
# 一键全量验证（两侧单测 + 记忆不变量抽查，串行；server 套件走 Node 24）
node scripts/verify-all.mjs        # 等价于 npm run verify:all

# 仅单元测试
pnpm test

# 查看测试覆盖率
pnpm test:coverage
```

> 单测基线：**server 186 例 / web 139 例**。真机验证脚本（`scripts/verify-*.mjs`）会自建探测账号、复制管理员的 AI 配置、跑完打印清理命令，必须**串行**执行（并发会争模型）。

### 构建生产版本

```bash
# 构建 Web 应用
pnpm build
```

---

## 📊 核心功能

### 1. 沉浸式编辑器

- Typora 风格的 Markdown 编辑体验
- 实时字数统计
- 专注模式
- AI 续写建议（10s 防抖 + Ctrl+Space 立即触发）

### 2. 知识库管理

- **角色管理**: 姓名、别名、外貌、性格、关系图
- **物品管理**: 关键道具、象征物、追踪出现位置
- **地点管理**: 场景描述、氛围标签、关联事件
- **事件时间线**: chronological 排序、章节关联

### 3. 伏笔系统

- 六种伏笔类型：身份、动机、关系、创伤、转折、命运
- 自动阈值计算（根据类型）
- 逾期提醒和警告
- 书角标记（Earmark）关联

### 4. 标注系统

- 划词标注角色、物品、地点、伏笔
- 高亮显示和快速导航
- 上下文关联展示

### 5. AI 辅助

- 实体自动提取
- 一致性检查（角色行为、时间线）
- 写作风格分析
- 节奏评估
- 续写建议（带 stale 检测 + API Key 检查）

### 6. 大纲与笔记

- 树形大纲结构
- 便签式笔记
- 支持 Markdown

### 7. 数据统计

- 每日写作目标
- 写作习惯追踪
- 成就系统

### 8. 导出功能

- Markdown 导出
- PDF 导出（计划中）
- EPUB 导出（计划中）

---

## 🧪 测试指南

### 运行测试

```bash
# 运行所有测试
pnpm test

# 监听模式
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

### 测试文件位置

```
apps/web/src/
├── stores/__tests__/          # Store 单元测试
├── services/__tests__/        # Service 单元测试
└── components/__tests__/      # 组件测试
```

### 测试命名规范

```typescript
// ✅ 好的测试命名
it('应该创建新项目并持久化到数据库', () => {});
it('应该在网络失败时优雅降级', () => {});

// ❌ 不好的测试命名
it('test1', () => {});
it('works', () => {});
```

---

## 📝 开发规范

### 代码风格

- 使用 TypeScript 严格模式
- 优先使用函数式组件和 Hooks
- CSS 变量优先，避免硬编码颜色
- 所有交互元素有 `aria-label`

### 提交规范

```
feat: 新功能
fix: 修复 Bug
docs: 文档更新
style: 代码格式调整
refactor: 重构
test: 测试相关
chore: 构建/工具更新
```

---

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 📄 许可证

⚠️ **仓库当前未包含 `LICENSE` 文件**，`package.json` 也未声明 `license` 字段。（此前 README 写「MIT」但无对应文件，属不一致。）
如需对外发布，请先补齐许可证再改回本节 —— 本仓历史的远程初始提交曾带 Apache-2.0 LICENSE。

---

## 🙏 致谢

- [React](https://react.dev/) - UI 库
- [Tiptap](https://tiptap.dev/) - 富文本编辑器
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Hono](https://hono.dev/) - 轻量级 Web 框架
- [Zustand](https://zustand-demo.pmnd.rs/) - 状态管理

---

**用 NovelMuse 创作你的下一个伟大故事！** 📖✨

*最后更新: 2026-09-15*
