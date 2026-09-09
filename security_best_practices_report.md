# NovelMuse 逆向可能性 & 安全漏洞审计报告

> 审计对象：`F:\new1.2`（NovelMuse / novel-companion 单仓库）
> 技术栈：React 19 + Vite 6（前端）· Hono + Cordis 基座 + SQLite/Drizzle（后端）· Node.js
> 审计方式：源码静态审查 + 运行实例探测（health/登录链路）+ `pnpm audit` 依赖漏洞扫描
> 日期：2026-08-19

---

## 0. 执行摘要（Executive Summary）

**逆向可能性：非常高（且无有效对抗手段）。** 本项目是标准 React SPA + JSON API 架构，前端打包产物（仅压缩、无混淆、无 sourcemap）中完整包含业务逻辑、全部 API 路由清单、鉴权流程、加密实现与 AI 配置处理方式。任何拿到前端包的人都可以在几分钟内还原出完整的 API 面并直接调用。同时，本机运行的浏览器可读取 localStorage 中的 JWT 与「加密」记住的密码（密钥与密文同库），管理员默认口令直接写在 README 中。**结论：本项目的可逆性不构成技术壁垒——它依赖的是「数据在本机、服务只绑 127.0.0.1」这一部署边界，而非任何逆向防护。**

**安全漏洞：存在 1 个高危 RCE 链路与数个中高危问题。** 最严重的是「AI 建插件」功能（`create_plugin` 工具）——任意已注册用户（注册接口默认开放）可让 LLM 生成任意 `serverCode` 并**运行时挂载执行**，即服务端任意代码执行（RCE）；配合小说正文的提示词注入，攻击链完整。默认管理员口令 `admin/novelmuse123` 与开发 JWT 密钥回退值写死在源码中。依赖层面 `drizzle-orm 0.38.4`（SQLi 高危公告）、`undici 7.25.0`（多项高危公告）未升级。插件注册的路由（typography/worldbuilding/AI 生成插件）**全部缺少认证中间件**。

---

## 1. 逆向可能性评估（Reverse Engineering）

### R1. 前端代码完全可逆 —— 严重度：高（设计使然）

- SPA 打包产物（`vite build`）仅做压缩（`esbuild`/`rollup` minify），**无混淆、无加密**。
- `vite.config.ts` 中 `sourcemap: false`（生产不输出 sourcemap，好），但压缩后的 JS 结构依然清晰，beautify 后即可通读。
- 前端包内包含：全部 API 端点路径（`apiClient`、各 `*Api.ts`）、鉴权流程（`authStore`、`getToken`）、**凭据加密实现**（`credentials.ts` 的 WebCrypto 逻辑）、AI 配置处理（`aiStore`/`LocalModelPanel`）、插件加载机制等。
- 影响：任何人可还原 API 面，绕过 UI 直接调用所有接口；可复刻完整客户端逻辑（数据格式、请求头、路由约定）。
- 缓解建议：对 SPA 而言逆向不可完全避免；可选措施是 API 层做强鉴权/配额/风控，把「逆向后能干什么」降到最低（见 §2 漏洞修复）。

### R2. 记住密码「加密」形同虚设 —— 严重度：高

- `apps/web/src/utils/credentials.ts`：AES-GCM 加密密码存入 `localStorage`，但**加密密钥与盐同样存在 localStorage**（`novelmuse_cred_key` / `novelmuse_cred_salt`），代码注释自己承认这是「混淆级」方案。
- 攻击者只需打开 DevTools 执行约 10 行代码（代码逻辑就在打包产物里）即可解密出**明文密码**。
- 影响：本机任何能访问该浏览器上下文的人（恶意扩展、XSS、同机其他进程/用户）可直接拿到账号密码。
- 建议：改为 WebAuthn / Credential Management API，或至少禁用「记住密码+自动登录」；真正的密码不应以可逆形式存于客户端。

### R3. JWT 存于 localStorage，可直接提取 —— 严重度：高

- `apps/web/src/services/api/apiClient.ts:12,18-30`：token 键 `novelmuse_token` 存于 localStorage，每次请求附加 `Authorization: Bearer`。
- 影响：XSS 或本机任意代码即可窃取会话；token 24h 有效，可离线冒用。
- 建议：改用 HttpOnly + SameSite=Lax cookie（需配套 CSRF 防护）或内存态短命 token + 刷新机制。

### R4. AI API Key 明文回传浏览器 —— 严重度：中

- `apps/server/src/modules/ai.ts:1329-1338`：`GET /api/ai/config` 对用户返回**完整未脱敏**的 apiKey（注释说明是为了前端编辑回显）。
- 影响：浏览器持有明文第三方 AI 密钥；若前端被攻破（XSS/恶意扩展），密钥被窃；数据库泄露时密钥也是明文存储。
- 建议：前端编辑时只回传掩码值 + 未变更标记；保存时服务端合并旧值；密钥加密落库（如 AES-GCM + 服务端主密钥）。

### R5. 默认管理员口令公开 —— 严重度：高（与 §2-C2 合并）

- README 与 `index.ts:23` 公开固定默认口令 `admin/novelmuse123`，且首次启动**直接使用**（无强制改密）。

### R6. 其他可逆性事实

- 服务端路由全部可枚举（19 模块 + 插件），zod schema 全在包内，可离线构造合法请求。
- SQLite 数据文件（`data/*.db` + 每项目独立库）在本机明文存储——拿到磁盘即可读全部小说内容。
- 开发模式 Vite 直接提供源码（含 sourcemap），仅限本机 dev，无额外风险。

---

## 2. 安全漏洞清单（按严重度排序）

### 🔴 严重（Critical / High）

#### C1. AI 建插件 → 服务端任意代码执行（RCE 链路）

- **位置**：`apps/server/src/ai/tools/plugin-tools.ts:176-256`（createPlugin）、`apps/server/src/ai/tools/index.ts:19`（注册为 AI 工具）、`apps/server/src/plugin/local-scanner.ts:66-78`（动态 `import` 执行）、`apps/server/src/modules/ai.ts:839`（聊天工具集包含 PLUGIN_TOOL_NAMES）。
- **链路**：
  1. 注册接口 `POST /api/auth/register` **默认开放**（`modules/auth.ts:64`，仅限速 10/min/IP）；
  2. 任意用户打开 AI 聊天（`POST /api/ai/chat`、`/api/ai/chat-stream`，均仅 `requireAuth`，`ai.ts:565/669`），AI 持有 `create_plugin` 工具（可传自定义 `serverCode`）；
  3. 工具将 `serverCode` 写入 `apps/plugins/local/{id}/server/index.ts` 并调用 `addPluginEntry` **运行时挂载**（`plugin-tools.ts:236-249`）→ 动态 import → **任意代码在服务端进程执行**（可读环境变量/文件、发请求、删数据）；
  4. 提示词注入放大器：小说章节正文是用户可控内容，会被喂给 LLM（chat-agent 读取章节），恶意正文可指示 LLM 生成恶意插件。
- **影响**：服务端完全失陷（RCE）。当前裸机模式服务仅绑 `127.0.0.1`（`index.ts:155`）使其只对本机进程/浏览器开放；但 **Docker 部署将端口映射到 0.0.0.0**（`docker-compose.yml: ports "${PORT:-3774}:3774"`），一旦暴露到局域网即被任意人利用。
- **修复建议**：
  - `create_plugin` 工具仅对管理员开放（AI 工具调用前校验 `user.isAdmin`）；
  - 插件写入与挂载前增加**审批流**（人审）与**沙箱**（子进程/worker 隔离、能力白名单）；
  - 聊天工具集按权限过滤（`PLUGIN_TOOL_NAMES` 仅对 admin 注入）；
  - 考虑将插件代码固定模板化，禁止任意 `serverCode`。

#### C2. 默认管理员口令 `admin / novelmuse123` 硬编码

- **位置**：`apps/server/src/index.ts:23,57`；README 明示。
- **影响**：Docker/LAN 暴露时，任何人可直接以管理员登录 → 重置任意用户密码、删除用户、授予管理权限、开关插件（`modules/admin.ts`、`plugin/manager.ts`）。即使改密，`ADMIN_PASSWORD` 显式设置时每次启动都会强制覆盖回该值（`index.ts:78-85`）。
- **修复建议**：首次启动强制改密；移除「每次启动同步 ADMIN_PASSWORD」逻辑或仅首次生效；生产部署必须设置强 `ADMIN_PASSWORD`。

#### C3. JWT 密钥开发回退值公开

- **位置**：`apps/server/src/lib/jwt.ts:26`：`JWT_SECRET = process.env.JWT_SECRET || (NODE_ENV === 'production' ? undefined : 'novelmuse-dev-secret')`。
- **影响**：只要 `NODE_ENV` 不是 `production`（未设置是常见疏漏），服务使用公开已知密钥签发 JWT——攻击者可**伪造任意用户（含 admin）的 token**。docker-compose 注释声称「不设置则自动生成」，与代码不符（生产未设置时 `signToken` 直接抛错，登录不可用）。
- **修复建议**：开发回退值随机化（启动时生成并警告）；生产缺失 `JWT_SECRET` 时**拒绝启动**而非半可用；修正 docker-compose 注释并默认要求传入 `JWT_SECRET`。

#### C4. 前端敏感凭据暴露面（localStorage JWT + 可解密记住密码）

- **位置**：`apiClient.ts:12,18-30`；`credentials.ts:12-15,36-65`。
- **影响**：单点 XSS/恶意扩展即账号接管（JWT + 明文密码）。
- **修复建议**：见 R2/R3。

#### C5. drizzle-orm 0.38.4 —— SQL 注入高危公告（未升级）

- **位置**：`packages/db` 依赖 `drizzle-orm@0.38.4`；`pnpm audit` 报 `GHSA-gpj5-g38j-94v9`（<0.45.2 存在 SQL 标识符转义缺陷导致 SQLi）。
- **影响**：当前代码库查询均使用固定 schema 表名/列名、参数化查询，**实际可利用性较低**；但若任何路径将用户输入作为 SQL 标识符（表名/列名/别名）传入，则存在注入。属「该升级」项。
- **修复建议**：升级 `drizzle-orm >= 0.45.2`（注意兼容性验证）。

#### C6. undici 7.25.0 —— 多项高危公告（未升级）

- **位置**：`apps/server` 直接依赖 `undici@7.25.0`（AI 出站调用底层）；公告含 TLS 校验绕过（GHSA-vmh5-mc38-953g）、SOCKS5 代理跨源请求路由（GHSA-hm92-r4w5-c3mj）、WebSocket DoS（GHSA-vxpw-j846-p89q）等，修复版本 `>=7.28.0`。
- **影响**：服务端出站 AI 请求的 TLS 校验可被绕过（中间人注入响应）、代理池串扰等。
- **修复建议**：升级 `undici >= 7.28.0`。

### 🟠 中（Medium）

#### C7. 插件路由全部缺少认证

- **位置**：`apps/plugins/local/typography/server/index.ts:22-54`、`apps/plugins/worldbuilding/src/server/index.ts`（`router.get/post/delete` 无任何 auth）、AI 生成插件模板 `plugin-tools.ts:48-95` 同样无 auth；`hono-adapter.ts` 与 `host.ts` 的路由注册**无全局认证层**。
- **影响**：任何能访问服务的人（Docker/LAN 暴露时）可读/写/删插件数据；项目级 KV 仅凭 `X-Project-Id` 头（可伪造）隔离，无所有权校验。typography 是全局设置（影响低），worldbuilding/AI 插件数据可被任意篡改。
- **修复建议**：为插件路由注入默认 `requireAuth`（注册时包裹），并让 `X-Project-Id` 走 `requireProjectScope`（`project-scope.ts`）统一校验所有权。

#### C8. SSRF：AI baseUrl 用户可控 + 服务端出站请求

- **位置**：`modules/ai.ts:1210-1266`（gateway）、`:1482`（models）、`:1587`（config/test）经 `provider-factory.ts` 用用户配置的 `baseUrl` 发起 fetch。
- **影响**：用户可把 baseUrl 指向内网地址（如 `http://127.0.0.1:8080`、云元数据 `169.254.169.254`），服务端代发请求——内网探测/SSRF。默认绑 127.0.0.1 时风险低；Docker/LAN 部署时中危。
- **修复建议**：对非 localhost/非本机 Ollama 的 baseUrl 增加协议白名单（http/https）与内网地址拦截；或提示用户该功能自带 SSRF 特性。

#### C9. hono-adapter 错误处理泄露内部错误详情（含生产）

- **位置**：`apps/server/src/lib/hono-adapter.ts:52-60`：兜底 `catch` 直接 `JSON.stringify({ error: { ..., message } })` 返回 `err.message`——**不区分环境**，生产同样泄露 DB/AI/路径等内部错误文本。
- **影响**：信息泄露，辅助攻击者定位内部结构。
- **修复建议**：生产环境统一走 `error-handler.ts` 的脱敏逻辑（`INTERNAL_ERROR` 通用文案 + 服务端日志）。

#### C10. 注册接口默认开放

- **位置**：`modules/auth.ts:64` `POST /api/auth/register` 无邀请码/关闭开关。
- **影响**：LAN/公网暴露时任何人都能注册账号，进而使用 AI 功能（消耗服务端配置的 AI 额度/密钥）与 C1 链路。
- **修复建议**：提供「关闭注册/仅邀请码」开关，默认在非本机部署时关闭。

### 🟡 低（Low）/ 加固项

- **C11. 依赖公告（低危）**：`hono 4.12.32 < 4.12.34`（代理头处理，GHSA-79qm-7rj5-m7r9）、`linkify-it 5.0.0 < 5.0.2`（markdown 链接扫描二次复杂度 DoS，前端 tiptap 链路）、`ini <1.3.6`（构建期 prebuild-install 链，原型污染，实际不可达）。建议随升级窗口一并处理。
- **C12. CORS 空 Origin 回退 `*`**：`app-factory.ts:26` `if (!origin) return '*'`。鉴权走 Bearer 头、无 cookie，实际 CSRF 面小；但配合未来 cookie 化鉴权时必须收紧。
- **C13. 登录/注册限流在内存中**：`rate-limiter.ts` 桶存内存（重启清零、多实例不共享），单机场景可接受；多副本部署需换 Redis 等共享存储。
- **C14. Token 吊销表在内存**：`jwt.ts:37-55` 重启即失，且按 `Set` 存；可接受，但重启后已吊销 token 复活。
- **C15. 静态文件回退路径拼接**：`frontend-static.ts:43` `join(distRoot, reqPath)`，依赖 WHATWG URL 对 `..` 的归一化防穿越，建议加 `resolve` 后前缀校验双保险（生产部署前验证）。

---

## 3. 已具备的防护（正面确认）

- ✅ 密码 bcrypt 哈希（10 轮），注册密码策略强制大小写+数字+长度
- ✅ 全 API 请求体 zod 校验（`zValidator`）
- ✅ 认证限流（登录/注册 10 次/分钟/IP）、AI 限流（20 次/分钟/用户）、搜索限流
- ✅ 项目所有权校验（`project-scope.ts` + `ownership.ts`），跨项目访问返回 404
- ✅ admin 与插件管理路由均 `requireAuth + requireAdmin`
- ✅ JWT 吊销机制（jti blocklist）+ 过期清理
- ✅ 应用层错误脱敏（`error-handler.ts` 生产通用文案）+ requestId 追踪
- ✅ 安全响应头（nosniff / X-Frame-Options DENY / Referrer-Policy / Permissions-Policy）
- ✅ 前端 XSS 防护到位：`react-markdown` 默认不渲染 raw HTML；富文本/快照渲染走 DOMPurify 白名单；聊天输入双重过滤
- ✅ 请求体大小限制 5MB；服务裸机模式仅绑 `127.0.0.1`
- ✅ 生产构建关闭 sourcemap；`.gitignore` 覆盖 `.env` / `*.db` / `dist`
- ✅ AI 配置按 userId 隔离（provider 缓存 Map），避免用户间 key 串用；日志中 apiKey 脱敏
- ✅ CORS 白名单（localhost/局域网私有 IP）而非反射任意 Origin

---

## 4. 优先修复路线（建议顺序）

| 优先级 | 事项 | 工作量 |
|---|---|---|
| P0 | C1：`create_plugin` 限管理员 + 审批/沙箱 | 中 |
| P0 | C2：默认管理员口令治理（强制改密、移除启动覆盖） | 小 |
| P0 | C3：JWT 密钥——生产缺失即拒绝启动，移除公开回退值 | 小 |
| P1 | C7：插件路由注入默认认证 + 项目所有权校验 | 中 |
| P1 | C5/C6：升级 drizzle-orm、undici | 中（需回归） |
| P1 | C4：token 存储迁移（HttpOnly cookie 或内存）+ 凭据方案替换 | 大 |
| P2 | C8/C9/C10：SSRF 出站白名单、错误脱敏、注册开关 | 小-中 |
| P2 | C11-C15 加固项 | 小 |

---

## 6. 修复进展（2026-08-19 · P0 已完成）

| 事项 | 状态 | 改动 |
|---|---|---|
| C1 create_plugin 限管理员 | ✅ 已修复 | 双层闸门：`modules/ai.ts` 工具定义按 `user.isAdmin` 过滤（非管理员 LLM 看不到该工具）；`plugin-tools.ts` handler 层最终授权校验（拒绝返回「权限不足」）；`ToolContext` 增加 `user` 字段 |
| C2 默认管理员口令 | ✅ 已修复 | `index.ts` 删除 `DEFAULT_ADMIN_PASSWORD`；未设置 `ADMIN_PASSWORD` 时首次创建随机强口令（`randomBytes(16).base64url`）并仅在控制台展示一次；README/.env.example 同步更新 |
| C3 JWT 密钥治理 | ✅ 已修复 | `jwt.ts` 删除公开回退值 `novelmuse-dev-secret`；生产缺失 `JWT_SECRET` 由 `index.ts` 启动守卫直接拒绝启动；开发环境持久化随机密钥到 `data/.jwt-secret`（与 DB 同目录锚定、已加入 .gitignore），重启不掉线；docker-compose 的 `JWT_SECRET` 改为必填（`${JWT_SECRET:?}`） |
| 附带修复 | ✅ | 早前 `pnpm` 预检失败导致 `node_modules/tsx/dist` 被清空的问题——`pnpm install` 恢复依赖树后服务正常重启 |

**验证结果（全部实测通过）**：
- `tsc --noEmit` 服务端类型检查通过（exit 0）
- 服务 3774 健康检查 200，22 插件全挂载；Vite 5174 代理链路 200
- admin 登录/`/api/admin/users` 200；普通用户访问 admin 接口 403
- create_plugin 门禁单测：非管理员 → 拒绝且不写文件；管理员 → 放行（后续 id 校验拦截，未污染插件目录）

---

## 7. 修复进展（P1 · C7 + C5/C6 已完成）

| 事项 | 状态 | 改动 |
|---|---|---|
| C7 插件路由默认认证 | ✅ 已修复 | `host.ts` 的 `routesService.register` 对 `/api/plugins/*` 前缀包裹父 Hono：`requireAuth`（默认登录）+ `X-Project-Id` 存在时 `verifyProjectOwnership` 所有权校验；内置模块（/api/auth 等）不在此前缀，公开路由不受影响 |
| C7 插件 web 面鉴权配套 | ✅ | `@novel/core/web` 契约新增 `ctx.api`（带鉴权 fetch：自动附加 JWT + X-Project-Id）；web 宿主实现并注入；typography / worldbuilding / AI 建插件模板全部改用 `ctx.api`，弃用裸 fetch |
| C7 附带修复（新发现） | ✅ | **worldbuilding 插件从未真正工作**：manifest `inject: ['events']` 但宿主未提供 events 服务 → cordis 让插件停在等待态，apply 永不执行（日志里该插件路由从无 200）。宿主补 `events` 服务（EventBus）后路由/AI 工具/技能全部生效 |
| C5 依赖升级 | ✅ | drizzle-orm 0.38.4→0.45.2（SQLi 公告消除）；hono 4.12.32→4.13.3（server/core/worldbuilding）、@hono/node-server→1.19.17；dompurify→3.4.13；nanoid→5.1.16 |
| C6 依赖升级 | ✅ | undici 7.25.0→7.29.0（覆盖全部 11 条 undici 公告）；pnpm-workspace.yaml 加 overrides：linkify-it ^5.0.2、ini ^1.3.8（原型污染）、brace-expansion ^5.0.9、markdown-it ^14.3.0、esbuild ^0.28.1、@babel/core ^7.29.7、postcss>nanoid ^3.3.18 |

**验证结果（全部实测通过）**：
- `pnpm audit`：24 → 33（审计库刷新新增公告）→ **0**（"No known vulnerabilities found"）
- 服务端 + core + web 三包 `tsc --noEmit` 通过（drizzle/hono 升级无 API 破坏）
- 服务全新重启：22 插件全挂载、DB connected、健康检查 200；vite 在 esbuild 0.28 下正常服务
- C7 实测：无 token → 401；有 token → 200；伪造项目 ID → 404；跨用户写他人项目 → 404 拦截；本人项目 → 200
- worldbuilding GET/POST 首次全链路可用（事件服务修复后）

**剩余（P1 大项）**：C4 token 存储迁移（HttpOnly cookie / 内存方案）——改动面最大（登录流、apiClient、插件 ctx.api、多标签页、CSRF 防护），建议单独排期。

---

## 8. 修复进展（P1 · C4 已完成）

| 事项 | 状态 | 改动 |
|---|---|---|
| C4 服务端 Cookie 会话 | ✅ 已修复 | 新增 `lib/cookies.ts`：`novelmuse_token` 认证 Cookie（HttpOnly + SameSite=Strict + Max-Age=24h，`COOKIE_SECURE=true` 时加 Secure）；login/register/refresh 写入 Cookie 且**响应不再返回 token**；logout 吊销 + 清除 Cookie；`requireAuth`/`optionalAuth`/`refresh`/`logout` 统一「Authorization 头 → Cookie」双通道提取 |
| C4 前端去 localStorage | ✅ 已修复 | `apiClient`：get/set/clearToken 改为**内存态**（不再写 localStorage），启动时一次性清除遗留的 `novelmuse_token`；`authApi` 不再 setToken，login/register/refresh 响应类型改为 `{ user }`；`authStore`：initialize 改后台 `/auth/me` 校准（Cookie 为唯一凭据），移除本地 JWT 解码过期判断，不再持久化 `isAuthenticated`；所有 fetch 加 `credentials: 'include'` |
| C4 CSRF 防线 | ✅ | SameSite=Strict（跨站不携带）+ JSON 请求体 + CORS `credentials: true`（局域网直连场景） |
| 兼容性 | ✅ | 服务端仍接受 `Authorization: Bearer`（过渡期/内部调用）；流式请求（SSE/keepalive）在无内存 token 时优雅降级到 Cookie |

**验证结果（全部实测通过）**：
- 登录 Set-Cookie：`HttpOnly; SameSite=Strict; Max-Age=86400; Path=/`，响应体**无 token 字段**
- Cookie 会话：`/me`、`/projects`、`/admin/users`、`/api/plugins/*`、`/api/search`、`/api/ai/config` 全部 200
- 登出：Clear-Cookie（Max-Age=0）+ token 进 blocklist（登出后旧 token 请求 → 401）
- 刷新：Cookie 轮换成功；Authorization 头兼容模式验证通过
- Vite 代理（5174→3774）Cookie 完整透传：登录 → /me → 建/删项目 全通
- 前端单测 23/23 通过（authStore + apiClient）；server/web 双包 `tsc --noEmit` 通过

**剩余加固项**：C8（SSRF 出站白名单）、C9（错误脱敏复核）、C10（注册开关）、C11-C15 小项。

---

## 9. 修复进展（P2 · C8-C15 全部完成）

| 事项 | 状态 | 改动 |
|---|---|---|
| C8 SSRF 出站防护 | ✅ 已修复 | 新增 `lib/ssrf-guard.ts`：协议白名单（仅 http/https）+ IP 字面量段拦截（私网 10/8、172.16/12、192.168/16、CGNAT 100.64/10、链路本地 169.254/16、组播/保留/未指定、IPv6 链路本地/ULA）；回环（127.0.0.0/8、::1、localhost）默认放行（本地 Ollama 核心功能）；主机名放行（云端端点无法静态判定）。守卫挂在 `getAIConfig`（覆盖 chat/stream/models/config-test 全部出站路径）+ `POST /api/ai/config` 保存时即时校验。环境开关：`AI_SSRF_ALLOW_PRIVATE=1`（LAN 内自建中转）、`AI_SSRF_DISABLE=1`（不推荐） |
| C9 hono-adapter 生产脱敏 | ✅ 已修复 | 兜底 catch 不再无条件回传 `err.message`：生产环境返回统一「服务器内部错误」（与 error-handler.ts 口径一致），完整堆栈始终记服务端日志 |
| C10 注册开关 | ✅ 已修复 | `ALLOW_REGISTRATION` 环境变量：未设置时生产（NODE_ENV=production）默认**关闭**、开发默认开启；显式 true/false 强制。关闭时注册返回 403 + 引导文案。docker-compose 默认 `false`（容器暴露 0.0.0.0） |
| C11 依赖公告 | ✅ 已随 C5/C6 完成 | hono 4.13.3 / linkify-it 5.0.2 / ini 1.3.8 均 ≥ 修复版本，pnpm audit = 0 |
| C12 CORS 空 Origin 回退 | ✅ 已修复 | 移除 `if (!origin) return '*'` 历史遗留（配合 C4 Cookie 鉴权 + credentials:true，任何跨源响应必须有明确授权来源）。实测：evil origin 无 ACAO 头、localhost origin 正常回显、vite 代理链路无回归 |
| C13 内存限流 / C14 内存吊销 | 📋 已接受 | 单机本机部署可接受（重启清零）；多副本部署需换共享存储（Redis）。已记录为运维注意事项，不列入代码改动 |
| C15 静态回退防穿越 | ✅ 已修复 | `frontend-static.ts`：WHATWG URL 归一化之外再加「解码后 resolve + 前缀校验」双保险，越界一律 403。实测 `%2e%2e` 编码穿越 → 403，正常资源/SPA 回退不受影响 |

**验证结果（全部实测通过）**：
- SSRF 守卫单测 **18/18**：公网/回环/host.docker.internal 放行；私网/元数据/组播/保留/协议白名单/IPv6 链路本地+ULA 全部拦截；`AI_SSRF_ALLOW_PRIVATE`/`AI_SSRF_DISABLE` 开关生效
- C8 集成：保存 `169.254.169.254` → 400 拦截；回环地址保存+config/test 正常放行
- C9 实测（打包验证）：`NODE_ENV=production` 下 500 响应 message=`服务器内部错误`（不泄露 DB 连接串），development 保留详情
- C10：开发环境注册仍开放（201，无回归）；生产默认关闭逻辑 4 组合全对
- 全量回归：health 22 插件全 ok；/me、/projects、插件路由、admin、AI config/test、search 全 200；登出 401 ✓

**剩余待办**：无（C1-C15 全部落地）。持续项：保持 `pnpm audit` 清零、新依赖随升级窗口复查。

---

## 10. 补充发现与修复（C16 · 「记住我」本地密码存储）

**浏览器实测 C4 时发现**：登录页「记住我」功能把**加密密码 + 加密密钥 + 盐一并写入 localStorage**（`novelmuse_remembered_credentials` / `novelmuse_cred_key` / `novelmuse_cred_salt`）。虽然用 AES-GCM 加密（作者注释也承认是「混淆」而非安全存储），但**密钥与密文同地存放**——XSS/恶意扩展拿到两者即可解密出明文密码。这等于在 C4 迁移后遗留了第二个凭据存储面。

| 事项 | 状态 | 改动 |
|---|---|---|
| C16 移除本地密码存储 | ✅ 已修复 | `utils/credentials.ts` 重写：删除 AES-GCM 加解密/密钥/盐，**只存用户名**（`novelmuse_remembered_username`，30 天过期）；autoLogin（自动登录）废弃——会话恢复完全由 HttpOnly Cookie + `/auth/me` 校准承担；模块加载时一次性清理全部历史遗留键。`LoginPage.tsx` 同步简化：仅预填用户名，不再回填/保存密码 |
| 浏览器实测 | ✅ | 勾选记住我登录后 localStorage 仅剩 `{username, rememberMe, timestamp}`（无密码/密文/密钥）；刷新会话保持；登出（确认框）→ Cookie 清除、localStorage 清空、登录页用户名自动预填、**密码框为空** |

**全量浏览器验证记录（playwright）**：登录页渲染 → admin 登录 → 书架页 → localStorage 无 token（C4 ✓）→ 刷新仍停留 /bookshelf（Cookie 会话 ✓）→ 退出登录（confirm 对话框）→ 回登录页 + Cookie 清除 + 401 ✓。前端单测 23/23、server/web `tsc` 双包通过。

**剩余待办（P1+）**：~~C4 token 存储迁移（大项，见第 7 节）、C8-C15 加固项~~ → **全部完成，见第 8/9 节**。

---

## 5. 结论

- **逆向**：技术上「零防护」，但这是 SPA 的固有属性而非缺陷；真正的防线应建立在「数据本机化 + 服务仅本机监听 + 强鉴权」上。当前最该警惕的是：**开发密钥/默认口令/凭据混淆**这三处让「逆向成果」能直接变现。
- **安全**：整体工程质量高于平均水平（鉴权、校验、限流、脱敏、XSS 防护都做得认真），但 **AI 建插件 RCE 链路 + 默认凭据 + 依赖欠升级** 构成必须优先处理的真实风险。只要保持服务仅监听 `127.0.0.1` 且不对外暴露，上述多数漏洞的实际暴露面会大幅缩小。
