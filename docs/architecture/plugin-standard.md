# NovelMuse 插件安装标准（novel-plugin-standard/1.0）

> 目的：**让"装一个插件"不再可能弄崩宿主。** 任何来源的插件（内置 / 本地 / npm / AI 对话创建）
> 进入宿主前必须通过本标准定义的安装门；任何一门失败都只隔离该插件并给出标准错误码，
> 其余插件与宿主照常启动运行。
>
> 代码落点：纯判定逻辑在 `packages/core/src/install.ts`（`INSTALL_STANDARD_VERSION = '1.0.0'`），
> 宿主管线在 `apps/server/src/plugin/host.ts` 的 `mount()`，扫描器封装在
> `apps/server/src/plugin/local-scanner.ts` 的 `scanLocalPluginsDetailed()`。

## 1. 插件的合法形态

### 1.1 本地目录形态（AI 创建 / 手动放置）

```text
apps/plugins/local/{dirName}/
  plugin.json          # manifest（本标准的唯一元数据来源）
  server/index.ts      # Server 面入口（exports { name, apply(ctx) } 或 default router 适配）
  web/index.tsx        # Web 面入口（exports { name, apply(ctx) }，vite 构建期 glob 收集）
```

目录名 `{dirName}` 必须是 **完整 id**（如 `novel.typography`，AI `create_plugin` 形态，
防不同 id 尾段碰撞）或 **id 尾段**（如 `typography`，手写形态）。其余命名一律拒绝（`ID_MISMATCH`）。

### 1.2 内置插件

`apps/server/src/plugin/builtin.ts` 中注册，manifest 由代码内联声明，走同一套安装门。

### 1.3 npm / workspace 包形态

`package.json` 的 `novelMuse` 字段承载 manifest（与本地形态同 schema），经 `PluginEntry` 进入宿主。

## 2. Manifest 规范（plugin.json）

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | ✅ | 反向域名风格，`/^[a-z0-9]+(\.[a-z0-9]+)+$/`，如 `novel.worldbuilding` |
| `name` | ✅ | 展示名称，非空 |
| `version` | ✅ | semver（`x.y.z`） |
| `description` | — | 一句话说明 |
| `minHostVersion` | — | semver；宿主版本低于它 → 拒绝（`HOST_VERSION_MISMATCH`） |
| `dependsOn` | — | 硬依赖的其他插件 id 数组；缺失/被禁用 → 跳过（`DEP_MISSING`）；成环 → 整环拒绝（`DEP_CYCLE`）；自依赖 → 拒绝 |
| `permissions` | ✅ | 白名单子集：`routes, db:global, db:project, ai:tools, ai:skills, ai:agents, ai:providers, events, settings, scheduler` |
| `server.inject` | — | 白名单子集：`routes, services, db, ai, events, hooks, settings, scheduler, prompt` |
| `web.inject` | — | 白名单子集：`routes, projectPanels, commands, settings, editor, toolbar, selection, api` |
| `serverEntry` | — | Server 入口相对路径，默认 `./server/index.ts`；**仅允许插件目录内相对路径**（绝对路径 / `..` 穿越 → `ENTRY_UNSAFE`） |
| `webEntry` | — | Web 入口相对路径，默认 `./web/index.tsx`，同上 |
| `db.globalMigrations` / `db.projectMigrations` | — | 迁移目录 |

> `serverEntry`/`webEntry` 自标准 1.0 起是 **manifest 正式字段**（schema 校验路径安全），
> 不再是扫描器的私有旁路约定。

## 3. 六道安装门

| 门 | 内容 | 失败错误码 | 执行位置 |
|---|---|---|---|
| G0 | Manifest 门：plugin.json 存在、JSON 可解析、通过 zod schema | `MANIFEST_INVALID` | 扫描器 / host.mount |
| G1 | 结构门：入口路径安全 + Server 入口文件存在 | `ENTRY_UNSAFE` / `ENTRY_MISSING` | 扫描器（`load()` 前再做一次 realpath 逃逸检查） |
| G2 | 身份门：目录名匹配 + id 全局唯一 | `ID_MISMATCH` / `ID_CONFLICT` | 扫描器 + host.mount |
| G3 | 版本门：`minHostVersion ≤ 宿主版本` | `HOST_VERSION_MISMATCH` | 扫描器 + host.mount + addPluginEntry |
| G4 | 依赖门：dependsOn 存在、未禁用、无环、无自依赖 | `DEP_MISSING` / `DEP_CYCLE` | 扫描器（静态）+ host.mount（拓扑排序）+ setPluginEnabled/addPluginEntry（运行时） |
| G5 | 注入门：`server.inject` 的服务宿主可提供 | `INJECT_MISSING` | host.mount 拓扑排序 |
| G6 | 装载门：模块加载成功且导出 `apply()` | `LOAD_FAILED` / `APPLY_MISSING` | mountEntry（try/catch 隔离） |

## 4. 挂载顺序与失败策略

1. `host.mount()` 先逐门筛选出 **admitted** 插件，再按
   `sortByDependencies()`（Kahn 拓扑排序，稳定）排序后依序挂载 ——
   **依赖者永远晚于被依赖者**，不再依赖清单书写顺序的偶然正确。
2. 已禁用插件不进入可用集合：依赖它的插件按标准 **跳过**（`DEP_MISSING`），
   而不是挂着等运行时炸。重启后由管线自动重排。
3. 循环依赖 **整环拒绝**（全部成员 `DEP_CYCLE`），不部分挂载。
4. 单个插件的任何失败（门拒绝 / load 抛错 / apply 抛错）**只影响它自己**：
   状态置 `error` 或 `skipped`，宿主与其余插件正常启动。
5. 运行期由守护器（guardian）继续兜底：非内置插件错误归因、熔断（自动禁用）、隔离放行。

## 5. 状态可观测性

- `GET /api/health` → `pluginStandard`（标准版本）+ `plugins[]`（每插件 `id/status/error`）。
- `GET /api/admin/plugins`（需管理员）→ 状态 + 权限 + 依赖 + 被依赖 + `source`（builtin/local/npm）+ 守护器快照。
- 被扫描器拒绝的插件也会登记进宿主状态（`recordInstallRejections`），**不会静默消失**。
- 错误信息格式统一为 `错误码: 面向插件作者的可读原因`。

## 6. Web 面同步规则

Web 端（`apps/web/src/main.tsx`）挂载任何 Web 面插件前，先拉取 `/api/health`：
Server 端该插件状态非 `ok`（disabled / error / skipped）→ Web 面不挂载（console.warn 说明原因）。
Server 不可达时放行全部（保持前端可打开）。这样禁用/熔断一个插件后，
它的面板、命令、设置不会残留成"点了就 404"的僵尸 UI。

## 7. 运行时动态安装（AI create_plugin / 插件管理）

`host.addPluginEntry()` 与启动挂载走同一套门（G0/G2/G3/G4），
依赖未启用直接拒绝安装并返回原因。`setPluginEnabled(id, true)` 同样检查硬依赖，
提示先启用依赖。落盘环节保留原子写（临时目录 → rename），不留可被扫描的半成品。

## 8. 已知边界

- Hono 路由无法热摘除（架构限制）：禁用/熔断后动态插件路由由 muted gate 立即 404，
  彻底移除需重启。
- 启用被依赖插件后，先前因它被禁用而跳过的插件需重启恢复（管线只在启动期排序）。
- permissions 当前是 **声明与审计** 用途（manifest 校验白名单），同进程插件不构成内存级沙箱。
