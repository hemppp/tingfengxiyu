# NovelMuse 代码审查标准（Code Review Standard）

> 适用仓库：`novel-companion`（pnpm monorepo）
> 适用范围：`apps/web`（React 19 + Vite + Zustand + Tiptap）、`apps/server`（Hono + Drizzle + Zod + JWT）、`apps/agents`（Python Strands）、`packages/db`、`packages/shared`
> 目的：用**统一、可操作的 checklist** 把"代码质量参差不齐"变成可度量、可复盘的持续过程。

---

## 0. 怎么读这份标准

审查不是挑刺，是**带教**。每条规则都标注严重级别：

| 标记 | 含义 | 合并前必须处理？ |
|------|------|------------------|
| 🔴 **Blocker** | 安全漏洞、数据损坏、破坏性变更、关键路径无错误处理 | **必须修复**，否则不允许合并 |
| 🟡 **Suggestion** | 明显的可维护性 / 正确性 / 性能 / 测试缺口 | 应尽量修复；如暂不修需 reviewer 与作者共同确认并开 follow-up issue |
| 💭 **Nit** | 命名、注释、细微风格（无 linter 覆盖时） | 可选，建议顺手改 |

**黄金法则**：先看懂"作者想解决什么问题"，再判断"代码是否恰当解决了它"。不要为了符合个人口味而阻挡合并。

---

## 1. 安全（Security）— 本项目最高优先级

NovelMuse 是**用户私有创作数据**的载体，且含 JWT 登录、bcrypt 密码哈希、AI 调用与外部网络请求。安全问题零容忍。

### 🔴 授权（Authorization）— 最常出问题的地方
- **每个访问他人数据的接口都必须校验所有权**。项目已有 `verifyProjectOwnership(c, projectId)`（`apps/server/src/lib/ownership.ts`），reviewer 必须确认：
  - 路由参数里的 `projectId` / 资源 ID 是否都走了所有权校验；
  - **请求体（body）里的 `projectId` 同样要校验**——不能只校验 URL 参数。
- ⚠️ **本项目真实缺口示例（供 reviewer 对照检查）**：
  - `POST /api/characters`（`apps/server/src/modules/characters.ts:97`）直接用 body 的 `projectId` 创建，**未校验该 project 是否属于当前用户** → 可越权写入他人项目。
  - `GET /api/characters/search`（`characters.ts:78`）只对 `projectId` 做了 `|| ''` 兜底，**未校验所有权** → 可跨项目检索。
  - 标准：凡是"创建类"接口，必须先 `verifyProjectOwnership(c, body.projectId)` 再写入；凡是"读/改/删"接口，必须先取资源、校验其 `projectId` 归属，再操作。
- **PUT 的 upsert 语义要谨慎**：`characters.ts:104` 在资源不存在时按 body 的 `id` 直接创建，reviewer 需确认：创建路径是否也做了所有权校验，且 `id` 是否由服务端生成（避免客户端指定任意主键造成冲突/越权）。

### 🔴 认证（Authentication）
- `requireAuth` / `optionalAuth`（`apps/server/src/middleware/auth.ts`）已覆盖绝大多数路由。检查：
  - 敏感路由是否漏挂 `requireAuth`；
  - Token 解析失败是否统一返回 401（已做，保持）；
  - 不要把 `optionalAuth` 用于本应强制登录的写操作。

### 🔴 注入与输入安全
- **SQL 注入**：全部走 Drizzle 查询构造器（`packages/db`），禁止字符串拼接 SQL。审查任何 `db.run` / 原生 SQL 调用。
- **XSS（前端）**：
  - 富文本用 Tiptap，渲染 AI/外部内容时必须走 `dompurify` 清洗（依赖已装）；
  - 禁止 `dangerouslySetInnerHTML` 拼接未清洗内容；
  - 用 `react-markdown` 渲染 Markdown 时注意 `rehype-raw` 是否开启。
- **命令注入 / 反序列化**：审核 `apps/agents`（Python）中对 LLM 输出的 `eval`/`exec`/`pickle` 使用。
- **正则 ReDoS**：审查用户输入拼进 `new RegExp(...)` 的地方（server ESLint 已开 `no-control-regex`）。

### 🔴 密钥与配置
- API Key、JWT 秘钥不得硬编码，必须从环境变量读取（`apps/server/src/ai/providers/provider-factory.ts` 等）。
- `apps/agents` 的密钥同样不得进仓库；检查 `.env` 是否被 `.gitignore` 覆盖。

### 🟡 速率限制与日志
- 已有 `rate-limiter` 中间件（`apps/server/src/middleware/rate-limiter.ts`），确认敏感接口（登录、AI 调用）是否挂载。
- 认证失败、权限拒绝应记录日志但**不得泄露密钥/令牌**（`auth.ts` 当前做法 OK）。

---

## 2. 正确性（Correctness）

### 🔴 关键路径错误处理
- 所有 DB 调用、外部 HTTP（`undici`）、AI 调用都要有 `try/catch` 或向上抛错并被 `error-handler` 中间件统一捕获。
- 已存在 `apps/server/src/middleware/error-handler.ts`，确认它不会吞掉错误细节（开发环境保留堆栈，生产环境脱敏）。

### 🟡 边界与空值
- Zod schema 的 `.optional()` / `.nullish()` 语义是否真的符合业务？例如 `chapter: z.number().nullish()` 与 `z.number().optional()` 行为不同，reviewer 要确认作者意图。
- 前端 `stores/` 中的异步操作在 loading / error / empty 三态是否都处理了（无骨架屏、无错误提示是常见问题）。

### 🟡 并发与幂等
- 同一资源的并发修改（如章节内容保存）是否有防覆盖机制（版本号 / `updatedAt` 比较 / 乐观锁）。
- 幂等键：涉及支付的外部调用（本项目暂无，但 AI 续写建议应防重复触发——前端已有 10s 防抖，确认后端是否也兜底）。

---

## 3. API 契约（API Contract）

### 🟡 响应结构一致
- 当前约定：成功 `{ data: ... }`，错误 `{ error: { code, message } }`（见 `characters.ts`）。**新增接口必须沿用**，不得发明新形状。
- 状态码语义：400 参数错误、401 未认证、403/404 权限或资源不存在、500 内部错误。确认未滥用 200 承载错误。

### 🟡 破坏性变更
- 改 Zod schema 的字段名 / 类型、改路由路径、改 Drizzle schema（含迁移）都属于**破坏性变更**：
  - 前端 `@novel/shared` 类型是否同步更新；
  - 是否提供了迁移（`packages/db/drizzle/`）与回滚方案；
  - 是否影响了 Tauri 桌面端。

---

## 4. 数据层（Drizzle / SQLite）

### 🟡 Schema 与迁移
- 新增表 / 字段需在 `packages/db/src/schema.ts` 定义，并生成 drizzle 迁移（`drizzle/000x_*.sql`）。
- 外键删除策略统一用 `onDelete: 'cascade'`（项目现状），确认级联不会误删重要数据。
- **软删除**：项目用 `deletedAt` 列实现软删除（见 `chapters` 表）。reviewer 需确认：列表/统计查询是否排除了 `deletedAt IS NOT NULL` 的记录，避免"已删数据仍出现"。

### 🟡 查询性能
- 高频过滤字段是否有 `index(...)`（项目已为 `userId`/`projectId`/`order` 建索引，保持）。
- 避免 N+1：在 service 层批量查询关联数据，而非循环里逐条查。

---

## 5. 前端（React / Zustand / Tiptap）

### 🟡 组件与状态
- 优先函数组件 + Hooks；`stores/` 用 Zustand，避免把服务端状态塞进全局 store（应放 React Query / 局部 state）。
- 组件是否拆分合理、是否过度依赖 `any`（项目 tsconfig 已 `strict`，但 `as` 断言泛滥会绕过它）。
- Tiptap 扩展的自定义逻辑是否有单测覆盖关键命令。

### 🟡 可访问性（a11y）
- README 明确要求"所有交互元素有 `aria-label`"。审查按钮、图标按钮、对话框、表单 label。
- 颜色只用设计系统 CSS 变量（远山青 / 墨色等），禁止硬编码色值；对比度满足 WCAG AA。

### 💭 样式
- 用 Tailwind + 设计系统工具类（`btn-mist-*`、`card-mist-*`、`input-mist`），不要重复造按钮样式。
- 动画用已有的 `animate-*` 类，避免内联 `setTimeout` 做动画。

---

## 6. AI Agents（Python / Strands）

### 🟡 输入 / 输出边界
- LLM 返回的结构化数据要用 Pydantic / 显式解析校验，不能信任裸 JSON。
- 对 LLM 输出的任何"执行指令"（写文件、调 API）都要有白名单与人工确认。

### 🟡 成本与超时
- AI 调用要有超时、重试上限、token 预算；避免无限循环调用（已在 `apps/server/src/ai/pipeline.ts` 关注，保持）。

### 💭 测试
- `apps/agents` 目前无测试框架。至少对 prompt 构造、输出解析做单测（mock LLM）。

---

## 7. 测试（Testing）

### 🟡 必须有测试的场景
- 安全相关：授权校验、Token 校验（**server 当前 0 测试，是最大缺口**）。
- 业务逻辑核心：Zustand store 的状态迁移、service 层纯函数、Drizzle 迁移后数据形状。
- 边界：空输入、超大输入、并发保存。

### 🟡 测试质量
- 命名用业务语言（`应该创建新项目并持久化到数据库`），禁止 `test1`/`works`（README 已明确）。
- 不依赖真实外部服务：AI / 网络用 mock。
- 当前 `apps/web` 仅 5 个测试文件，覆盖率低——新增功能**至少补关键路径测试**。

---

## 8. 性能（Performance）

### 🟡 前端
- 大列表（角色关系图、时间线）是否虚拟化 / 分页；
- `recharts` / `@ant-design/plots` 图表数据量大时是否做采样；
- 不必要的重渲染（`React.memo` / 选择器）。

### 🟡 后端
- AI 调用是否有缓存与防抖，避免重复计费调用。

---

## 9. 可维护性（Maintainability）

### 🟡 命名与结构
- 文件 / 函数 / 变量名表达意图；路由模块保持 `modules/*.ts` 单一职责。
- 重复的"取资源→校验所有权→操作"三段式，考虑抽成 `withOwnership(c, id, fn)` 辅助（减少 `characters.ts` 里的样板与漏写风险）。

### 🟡 日志
- 用结构化日志而非散落的 `console.log`；server ESLint 已限制 `console` 仅 `warn`/`error`，保持。

### 💭 注释
- 解释"为什么"，不解释"是什么"；对外 API 用 JSDoc 标注参数与返回。

---

## 附：本项目已确立的优良模式（reviewer 应认可得以延续）

- ✅ TS `strict: true`（`apps/*/tsconfig.json`）。
- ✅ 路由层 Zod 校验（`zValidator('json', schema)`）。
- ✅ 集中所有权校验 `verifyProjectOwnership`。
- ✅ 结构化错误码 `{ error: { code, message } }`。
- ✅ 软删除 + 级联删除 + 索引（`packages/db/src/schema.ts`）。
- ✅ 统一错误中间件、认证中间件、速率限制中间件。
- ✅ 设计系统 CSS 变量与 `animate-*` 动画体系。

> 审查时对照以上清单逐项勾选（见 `PROCESS.md` 与 PR 模板）。发现反复出现的问题，回流到本文档第 1 节"真实缺口示例"，形成持续改进闭环。
