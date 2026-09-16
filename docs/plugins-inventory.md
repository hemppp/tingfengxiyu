# NovelMuse 插件化清单

> 生成于 **2026-09-15**。数据来源：`GET /api/health` 实测 + 源码静态扫描（行数、路由均实测，非文档推测）。
> 装配入口：`apps/server/src/plugin/host.ts`（868 行）。HTTP 层由 `@deepseek-ai/dsh-host-webserver` 提供，业务路由经 `lib/hono-adapter.ts` 接入 Hono。

## 一、总览：25 个插件怎么来的

| 类别 | 数量 | 来源 | 装配方式 |
|---|---|---|---|
| 核心业务模块 | **20** | `apps/server/src/modules/*.ts` | 宿主统一包装后 `ctx.plugin()` 挂载 |
| 宿主管理插件 | **1** | `apps/server/src/plugin/manager.ts` | 宿主启动时以"插件"身份挂载 |
| 示例插件 | **1** | `apps/plugins/worldbuilding/` | 扫描 `apps/plugins/*/` 自动加载 |
| 本地插件 | **3** | `apps/plugins/local/*/` | 扫描 + `guardian` 隔离审查 |
| | **25** | | |

> 每个插件的运行时状态可在 `GET /api/health` 的 `plugins[]` 里看到（全为 `status: ok`）。

---

## 二、核心业务插件（20 个）

这些是 `apps/server/src/modules/` 下的模块，由宿主包装为 cordis 插件。**全部路由要求 `requireAuth`**（`admin.ts` 另加 `requireAdmin`）。

### 2.1 内容资产类（写作对象的 CRUD）

| 插件 id | 文件 | 行数 | 作用 | 主要路由 |
|---|---|---|---|---|
| `novel.projects` | `projects.ts` | 149 | 项目（书）管理，带用户隔离与输入校验 | `GET/POST /`、`GET/PUT/DELETE /:id` |
| `novel.chapters` | `chapters.ts` | 207 | 章节：含**回收站**（软删/恢复/清空）与重排 | `GET /projects/:pid`、`GET /projects/:pid/trash`、`POST /`、`PUT /:id`、`POST /:id/restore`、`PUT /:id/reorder` |
| `novel.characters` | `characters.ts` | 262 | 角色：含**关系增删**与**相似角色合并** | `GET /search`、`POST /:id/relations`、`POST /merge-similar`、`POST /:id/merge/:targetId` |
| `novel.items` | `items.ts` | 104 | 物品/道具 | 标准 CRUD |
| `novel.locations` | `locations.ts` | 129 | 地点：含**坐标批量分配**（地图用） | 标准 CRUD + `POST /assign-coords` |
| `novel.events` | `events.ts` | 89 | 故事事件 | 标准 CRUD |
| `novel.foreshadows` | `foreshadows.ts` | 126 | 伏笔：含**活跃/逾期**两个专用视图 | `GET /projects/:pid/active`、`GET /projects/:pid/overdue` |
| `novel.timeline` | `timeline.ts` | 128 | 时间线事件：含**去重** | 标准 CRUD + `POST /dedupe` |
| `novel.outline` | `outline.ts` | 88 | 大纲节点（树形） | 标准 CRUD |
| `novel.notes` | `notes.ts` | 86 | 便签笔记 | 标准 CRUD |
| `novel.annotations` | `annotations.ts` | 92 | 正文划词标注 | 标准 CRUD |
| `novel.earmarks` | `earmarks.ts` | 95 | 书角标记（Earmark） | 标准 CRUD |
| `novel.credits` | `credits.ts` | 96 | **系统文**专用：积分流水。结余不入库、前端实时派生 | 标准 CRUD |
| `novel.snapshots` | `snapshots.ts` | 72 | 章节版本快照 | `GET /chapters/:cid`、`POST /`、`DELETE /:id` |
| `novel.references` | `references.ts` | 115 | 参考书（替代早期前端 IndexedDB 方案） | 标准 CRUD |

### 2.2 平台能力类

| 插件 id | 文件 | 行数 | 作用 | 主要路由 |
|---|---|---|---|---|
| `novel.auth` | `auth.ts` | 316 | 认证：注册/登录/刷新/登出。JWT 写 **HttpOnly + SameSite=Strict Cookie** | `POST /register`、`/login`、`/refresh`、`/logout`、`GET /me`、`/check-username`（均带限流） |
| `novel.admin` | `admin.ts` | 240 | 管理后台：用户管理（需 `requireAdmin`） | `GET /users`、`PATCH /users/:id/password`、`DELETE /users/:id`、`PATCH /users/:id/admin`、`GET /stats` |
| `novel.ai` | `ai.ts` | **1978** | **全项目最大的模块**：AI 端点 + 技能库 + 模型配置（见下） | 25 条路由 |
| `novel.stats` | `stats.ts` | 134 | 写作统计（日目标/习惯追踪） | `GET /projects/:pid`、`POST /`、`GET /projects/:pid/summary` |
| `novel.search` | `search.ts` | 33 | 外部搜索代理（DuckDuckGo） | `POST /`（带独立限流） |

### 2.3 `novel.ai` 的路由全貌（25 条）

| 分组 | 路由 |
|---|---|
| 分析 | `POST /scan`、`/scan-timeline-stream`、`/extract-events-stream`、`/check-consistency`、`/analyze-style`、`/analyze-rhythm`、`/analyze-timeline`、`/check-outline` |
| 对话 | `POST /chat`、`/chat-stream`（SSE） |
| 生成 | `POST /generate-character`、`/generate-plot` |
| 网关 | `POST /gateway`（转 Python agents 微服务） |
| 配置 | `GET /config`、`POST /config`、`POST /config/test`、`GET /models` |
| 技能库 | `GET /skills`、`GET /skill-library`、`POST /skill-library/install`、`DELETE /skill-library/:id` |
| 技能开关 | `GET /skill-targets`、`GET /skill-targets/:agentId`、`PUT /skill-targets/:agentId/toggle`、`PUT .../toggle-all` |

> `ai.ts` 用**自己的 Hono 实例**（`aiRouter`）挂到 `/api/ai`，不是 `router.get` 风格 —— 这是全仓唯一这么写的模块。

---

## 三、宿主与示例插件

### `novel.plugin-manager` —— 插件管理器

- **文件**：`apps/server/src/plugin/manager.ts`（宿主启动时以插件身份挂载，刻意演示"管理功能本身也是插件"）
- **作用**：查看/开关插件、检查全局依赖
- **路由**（全部 `requireAuth + requireAdmin`）：`GET /api/admin/plugins`、`GET /api/admin/plugins/deps`、`POST /api/admin/plugins/:id/enable`、`POST /api/admin/plugins/:id/disable`

### `novel.worldbuilding` —— 世界观建造师（示例插件）

- **文件**：`apps/plugins/worldbuilding/`（4 个文件：`package.json` + `src/server/index.ts` + `src/web/index.tsx` + `src/web/faction-highlight.ts`）
- **定位**：**演示完整插件契约**的活样板，注释里逐条列出用到的能力
- **内容**：
  1. `ctx.routes.register` —— 势力 CRUD 路由（数据存 KV，**无需数据库迁移**）
  2. `ctx.ai.tools.register` —— AI 工具 `create_faction` / `list_factions`
  3. `ctx.ai.skills.register` —— 「世界观顾问」技能
  4. `ctx.events.on` —— 订阅章节保存事件，**自动累计势力出场次数**
  5. `ctx.db.kv` —— 插件 KV 存储（项目隔离）

---

## 四、本地插件（`apps/plugins/local/*/`）

这三个是真正的业务插件，均有自己的 `plugin.json` manifest。

### 4.1 `novel.autowrite` —— 自动写作引擎（59 个文件，本仓最重插件）

- **manifest 描述**：写作技能框架 —— 承载全部聊天技能（自核心剥离）+ AI 自动写作多代理流转（规划→写作→校对→润色→交付）与治理（自治/审查/台账）
- **权限**：`routes`、`db:global`、`db:project`、`ai:tools`、`ai:skills`、`ai:agents`
- **server 注入**：`routes`、`db`、`ai`；**web 注入**：`projectPanels`、`skills`、`api`
- **实际内容（两层链路，详见 `docs/ai-writing-handover.md`）**：

| 子模块 | 位置 | 内容 |
|---|---|---|
| **讨论链路（现役）** | `server/discuss/` | 三设计角色讨论 → 定稿官收敛 → 写作官落笔 → 篇幅自检 → 意图门 → 校对门 → 润色门 → 交付 → 实体沉淀。入口 `POST /api/plugins/autowrite/session`（SSE） |
| **多智能体流水线** | `server/pipeline/` | `brief→cast→bible→plot→drift→pilot` 六段已实现（`production` 待做），带闸门三态 + 台账 |
| **分层记忆** | `server/framework/memory/` | L1 全局记忆（唯一写通道 `ingest()`）+ L2 专属记忆（`agent_memory` 表）+ 每 agent 一台"水车" |
| **技能注入** | `server/framework/agent-skills.ts` | 把「用户开关的技能正文」拼进 system 后缀，接到三处发言点 |
| **旧批次流水线（死代码）** | `server/autowrite/` + `framework/flow-store.ts` | 8 个 `autowrite_*` AI 工具 + `FlowStore` + 3 条 `/batches` 路由，已脱节，**是否物理删待拍板** |
| **Web 面** | `web/index.tsx`、`chat-wheel.tsx`、`panel.tsx` | 注册 AI 聊天气泡栏（转轮选择器）+ 9 个技能图标 |

### 4.2 `novel.bookscan` —— 扫榜拆书（3 个文件）

- **作用**：抓取公共书榜（晋江 VIP强推榜/总分榜/编辑推荐榜），一键把书加入「参考书」（含文案），并可就地 AI 拆书
- **权限**：`routes`、`db:global`
- **缓存**：榜单结果写 `plugin_kv`（key `rankings:*`），**这是主库最大的软性负担来源**

### 4.3 `novel.typography` —— 字体排版（3 个文件）

- **作用**：调整编辑器文字的显示粗细与颜色（实时预览，**项目无关的用户级设置**）
- **权限**：`routes`、`db:global`
- ⚠️ 已知问题：三条路由 `GET/PUT/DELETE /settings` **缺 `requireAuth`**（安全报告 C7）

---

## 五、插件机制要点

- **契约**：插件 = `{ name, inject, apply(ctx, config) }`，经 `inject` 声明依赖（如 `['routes','db','ai']`），宿主据此做装配顺序与缺依赖报错。
- **manifest**：`plugin.json` 声明 `id / name / description / version / permissions / server.inject / web.inject`，由 `@novel/core` 的 zod schema 校验。
- **生命周期**：`ctx.plugin()` 挂载 → fiber 隔离 → `dispose()` 卸载；禁用清单持久化在 `novel.host/disabled-plugins`。所有工具注册走 `ctx.effect(...)` 包裹，卸载时随 DisposerBag 自动注销。
- **`guardian` 审查**：本地插件先隔离，**连续 2 个会话零错误才放行**（策略见 `plugin/host.ts`，记录在 `plugin_kv` 的 `novel.host/guardian`）。
- **Web 面收集是构建期行为**：vite 用 `import.meta.glob` 在**构建时**扫描插件 Web 入口 —— **新增插件必须重启 vite**，服务端的 enable/disable 对 Web 面无效。
- **AI 工具白名单**：插件经 `ctx.ai.tools.register` 注册的工具会被 `host.ts:303` 自动 `markPluginTool`，**无条件进入所有用户的聊天工具列表**；而 `create_plugin` / `list_local_plugins` 属另一套常量，**仅对管理员可见**。

---

## 六、前端 UI 插件

**关键认知：前端的 UI 面本身就是插件化的** —— 连宿主自己的 12 个核心工作台面板都是"内置插件"注册的（原先硬编码在 `ProjectLayout.tsx` 的 `floatingPanelConfigs` 数组里）。

### 6.1 九个扩展点（白名单是单点真相）

单点真相：`packages/core/src/manifest.ts` 的 `WEB_SERVICES`（10 项，其中 `api` 不是注册器而是注入能力）。

| manifest 声明 | 插件调用 | 效果 | 去重 key |
|---|---|---|---|
| `projectPanels` | `ctx.registerProjectPanel` | 工作台浮窗面板（`scope: 'editor'` 则进编辑器侧栏） | `key` |
| `commands` | `ctx.registerCommand` | `Ctrl+K` 命令 | `id` |
| `routes` | `ctx.registerRoute` | 顶级路由 | `path` |
| `settings` | `ctx.registerSettingsSection` | 设置页区块（`category`: general/ai/security/plugins/updates） | `key` |
| `editor` | `ctx.registerEditorExtension` | Tiptap 扩展（工厂，每编辑器实例 create） | `key` |
| `toolbar` | `ctx.registerEditorToolbarItem` | 编辑器工具栏按钮 | `key` |
| `selection` | `ctx.registerSelectionAction` | 划词后浮出菜单项 | `key` |
| `skills` | `ctx.registerSkillIcons` | 技能选择器图标（`{技能id: LucideIcon}`） | 技能 id |
| `chatRail` | `ctx.registerChatRail` | **AI 聊天浮窗左缘功能气泡栏**（单槽，后注册覆盖，注销回退宿主兜底） | — |
| `api` | `ctx.api` | 带鉴权 fetch（自动带 JWT / 项目头） | — |

> ⚠️ 白名单必须与 `WebPluginContext` 的 `register*` 方法**一一对应**。`manifest.ts` 注释里留着教训：曾经多列了 `sidebar` / `locale` / `store` 等未实现项 —— manifest 校验放行，但插件调不到任何 API，"等于给插件作者一个假承诺"。**新增扩展点要先加 ctx 方法，再加白名单。**

### 6.2 两路发现机制（注意：都是构建期行为）

| 路 | 登记方式 | 适用 |
|---|---|---|
| **静态清单** | `apps/web/src/main.tsx` 的 `staticEntries` **手写一行** | 内置面板插件、workspace 包形态插件（如 worldbuilding） |
| **自动收集** | `import.meta.glob('../../../apps/plugins/local/*/web/index.tsx')` | `apps/plugins/local/*` —— **落盘即被发现，无需改任何清单** |

⚠️ 两者都在 **vite 构建期**完成 —— **新增插件文件后必须重启 vite dev / 重新构建**。服务端对插件 enable/disable 也**不会**摘除已注册的 Web 面 UI。

### 6.3 挂载前先对齐宿主状态

`mountAllWebPlugins()` 会先拉 `/api/health`：Server 端状态**非 `ok`**（disabled / error / skipped）的插件，Web 面**直接跳过挂载**（`console.warn` 说明原因）；Server 不可达则放行全部，保证前端仍能打开。目的是避免"面板还在、接口全 404"的僵尸 UI。

### 6.4 注册表机制（`apps/web/src/plugin/registry.ts`）

- Zustand store 驱动 —— 任何注册/注销立刻触发订阅组件重渲染。
- **按 key 去重**：同 key 重复注册 = 覆盖且**保持原位置**（HMR / 重载友好）。
- **排序**：`order` 升序 → 同 order 按**首次注册序号**稳定排序（未声明 order 的按注册先后，既有 12 个面板顺序因此不变）。
- ⚠️ **卸载函数必须从「当前 state」重新读列表再过滤** —— 早期实现闭包捕获了注册时刻的快照，卸载时用旧快照覆盖，会**连带丢弃此后注册的所有条目**（插件热禁用 / Vite HMR 时必踩）。
- `chatRail` 是单槽；`skillIcons` 是合并 map（注销时按 key 删）。

### 6.5 现状：谁注册了什么

| 插件 | 注册的前端 UI |
|---|---|
| `novel.builtin-panels`（内置） | **12 个工作台面板**：参考书 / 笔记 / 统计 / 大纲 / 时间线 / 角色 / 地点 / 伏笔 / 物品 / 关系图 / 地图 / 导出 |
| `novel.worldbuilding` | 面板「势力」+ 命令「新增势力」+ **Tiptap 扩展** + **划词菜单动作**（4 种扩展点，覆盖度最全） |
| `novel.autowrite` | **接管 AI 聊天气泡栏**（转轮选择器 `ChatWheelRail`）+ 9 个技能图标 |
| `novel.typography` | 面板「字体排版」+ 设置区「字体排版」（通用栏）+ 命令「切换显示粗细」 |
| `novel.bookscan` | 命令（1 条） |

> 即：一个插件能提供的 UI 形态，从「一个面板」到「接管整个聊天气泡栏」都有实例可参照 —— 想加什么，先看上表里谁的写法最接近。

### 6.6 消费侧：每个扩展点落在哪个 UI 位置

**注册了不等于显示** —— 宿主里有一对一的消费组件。这是完整的 10 个落点（全部实测）：

| 扩展点 | 消费点 | 渲染成什么 |
|---|---|---|
| `projectPanels` | `components/layout/ProjectLayout.tsx:516` | 工作台浮窗面板（`scope !== 'editor'`，进顶栏按钮组） |
| `projectPanels`（`scope: 'editor'`） | `components/editor/EditorPanelRail.tsx:14` | **编辑器内的面板栏** |
| `commands` | `components/ui/CommandPalette.tsx:21` | `Ctrl+K` 命令面板 |
| `routes` | `App.tsx:165` | 顶级路由表 |
| `settings` | `components/settings/PluginSettingsSections.tsx:69` | 设置页区块 |
| `editor` | `components/editor/hooks/useEditorInstance.ts:177` | Tiptap 扩展链 |
| `toolbar` | `components/editor/PluginEditorToolbar.tsx:68` | 编辑器工具栏 |
| `selection` | `components/editor/SelectionMenu.tsx:110` | 划词浮出菜单 |
| `skills` | `components/ai/skillsConfig.ts:71,99` | 技能选择器图标（未注册的走 `Puzzle` 兜底） |
| `chatRail` | `components/layout/ProjectLayout.tsx:364` | AI 聊天气泡栏（**插件优先，宿主内置兜底**） |

**这 10 处就是「插件化的 UI」的全部落点** —— 反过来说，宿主里只有这 10 个位置可被插件追加/改写；其余 UI（编辑器本体、书架、登录页）仍是硬编码。**同一个 `projectPanels` 有两个落点**（顶栏 vs 编辑器侧栏），靠 `scope` 字段分流，这点容易漏。

### 6.7 AI 动态创建的插件也自带 UI

`create_plugin` 工具的代码模板会给新插件生成三种 UI（`apps/server/src/ai/tools/plugin-tools.ts:180-189`）：一个 `registerProjectPanel` + 一个 `registerSettingsSection` + 一个 `registerCommand`（用于重新打开自己的面板）。也就是说，AI 对话里一句话建出来的插件，落地就是「面板 + 设置区 + 命令」三件套。

### 6.8 机制本体有多大

`apps/web/src/plugin/` 整个前端插件机制只有 **4 个文件 / 574 行**：

| 文件 | 行数 | 职责 |
|---|---|---|
| `types.ts` | 115 | 各扩展点的 Def 类型（`FloatingPanelDef` / `CommandDef` / `ChatRailDef` …） |
| `registry.ts` | 262 | Zustand 注册表（去重 / 排序 / 卸载） |
| `host.ts` | 142 | `mountWebPlugin()`：把插件的 `apply(ctx)` 接到注册表 + 失败隔离 |
| `builtin.ts` | 55 | 唯一的"内置 Web 插件"：注册那 12 个面板 |

> 前端插件化不是框架级工程，**574 行**就能把「9 个扩展点 + 去重排序 + 热卸载」做扎实 —— 想扩新扩展点，改动面就在这 4 个文件 + 对应消费组件。


