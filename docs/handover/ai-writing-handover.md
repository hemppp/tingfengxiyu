# AI 写作模块 · 接手必读

> 给接手这块的人。读完这一份就能知道：**现在什么能用、什么不能用、坑在哪、从哪下手。**
> 最后更新：2026-09-12。文末有「文档地图」——那些是**设计意图与历史**，这一份是**现状**。两者不一致时以本文为准。

---

## 0. 三分钟上手

```bash
pnpm install          # 首次
pnpm dev:all          # web 5173 + server 3774
pnpm type-check       # 8 个包，必须全绿
pnpm --filter @novel/server exec vitest run   # 当前基线：7 文件 / 75 用例全过
```

三件必须先知道的事：

1. **基线已提交**（2026-09-12，`4a0cb93`，87 个文件）。此前一直悬在工作区的「35 改 + 16 未跟踪」（`novel.autowrite` 整目录）现已入库，改坏了可以回到这一刻。
2. **已经跑过三轮真机验证**（2026-09-12，见 `docs/reports/ai-writing-test-report.md` 的第二轮）：P1（实体不落库）/ P2（字数不达标）确认修复，三道门与「上一章全文注入」实测通过。**但每次改完仍必须重跑** —— 模型输出是链路的一部分，type-check 与单测证明不了它真能用（见 §3）。
3. **这个模块有两条并行链路，改之前先确认你改的是哪条**（见 §2）。看错链路是这里最容易犯的错。

---

## 1. 一句话现状

`novel.autowrite` 插件实现了「**多角色讨论 → 收敛本章结论 → 写作官落笔 → 篇幅自检 → 意图门（打回重写）→ 校对门 → 润色门 → 交付写库 → 实体沉淀**」的**单章**闭环。三道门与实体沉淀均已真机验证（2026-09-12）。

主要缺口只剩**「只有单章」**：没有连续多章、没有灌溉水车记忆 —— 当前的多章连续性靠「上一章全文强制注入 + 实体沉淀」两件事撑着（实测第 2 章能引用第 1 章的正文细节与伏笔状态）。另外旧的批次流水线仍是死代码。

---

## 2. 架构现状：两条并行链路 ⚠️ 先看这个

模块里有**两套互不相通**的写作链路。它们共享数据表，但**流程、状态存储、工具集全不同**。

| | **讨论链路（现役）** | **批次流水线（旧，已脱节）** |
|---|---|---|
| 入口 | `POST /api/plugins/autowrite/session`（SSE） | `autowrite_*` 8 个 AI 工具 |
| 代码 | `server/discuss/orchestrator.ts` + `roles.ts` | `server/autowrite/*` |
| 流程 | 三设计角色来回讨论 → 定稿官收敛 → 写作官 → 意图复核 | 规划官拆批次 → 写作官 → 校对官 → 评审官 → 交付 |
| 单位 | **单章** | **批次**（第 N–M 章，带 cursor） |
| 状态 | 无持久状态（一轮会话即完） | `FlowStore`（`plugin_kv`，key `batch:`/`flow:`/`audit:`） |
| 治理 | 意图门（对照结论）+ 覆写保护 | 硬门/软门/预算/隔离 + 审计台账 |
| 前端 | `AutoWriteWorkbench` → 中栏仪表盘 + 右栏实体栏 | 无（`WorkbenchPlan` 已明确弃用批次数据） |

**关键事实：AI 写作模式（`project.mode === 'auto'`）的工作台只连讨论链路。** 8 个 `autowrite_*` 工具在自动写作模式下**根本调不到**（讨论链路里子代理的工具白名单只有 `list_chapters` / `read_chapter`）；它们只可能被**手写模式**的 AI 对话（ChatPanel 开工具）调起，而手写模式又看不到自动写作工作台。

**结论**：批次流水线（`server/autowrite/*`、`FlowStore`、`/batches` 路由、状态面板、`GET /api/plugins/autowrite/batches`）目前是**死代码** —— 讨论链路**完全不复用**它：编排器自己实现了交付（`orchestrator.ts` 的 `deliver()`）与实体沉淀，`tool-deliver` 的覆写快照**并未被调用**（讨论链路直接拒绝覆盖已有正文，见 §6-4）。

→ **接手第一件事是在这两条里选一条**：要么把批次能力接回讨论链路（做连续多章），要么正式废弃并在文档/UI 里清掉。**2026-09-12 已清掉 UI 侧的误导**（删了「批次 0/0」与旧话术，两处入口加了废弃标注），只剩「要不要物理删代码」，见 §5 的 P0-1。

---

## 3. 怎么验证（唯一有效的验收方式）

type-check 和单测**不能**证明这个模块能用 —— 模型输出是链路的一部分。真实的验收方式是：**新建临时账号 + `mode: 'auto'` 项目，直接消费 SSE 事件流，然后查项目库**。

**已经脚本化了，直接用**（server 必须先起、且用 Node 24）：

```bash
node scripts/verify-autowrite-session.mjs 2                       # 跑 2 章
node scripts/verify-autowrite-cleanup.mjs <username> <projectId>  # 参数由上一个脚本打印
```

脚本自己注册临时账号（继承管理员的 AI 配置）、建 auto 项目、逐章消费 SSE 并打印事件（含 `gate`），
最后列出项目库各表行数。实测结果与手工方法（耗时、调用次数、逐步事件）见 `docs/reports/ai-writing-test-report.md`。要点：

- 用 Node 脚本 POST `/api/plugins/autowrite/session`，逐条记 `data:` 行（事件类型：`phase` / `thinking` / `turn` / `conclusion` / `draft` / `review` / `delivered` / `deliver_blocked` / `entities` / `error` / `done`）。
- **`thinking` = 思维链（2026-09-16 加）**：推理型模型的 `reasoning_content`，逐片实时推给前端，同一次发言可能上千条；
  该次发言的整段也会挂在 `turn.thinking` 上。**非推理模型没有这个事件**，前端按「可能没有」处理。
  另外，它要单独验：`node scripts/verify-thinking-sidechannel.mjs`（跑到第一条带思维链的发言就掐断）。
- ⚠️ **验讨论必须先用该账号打一次 `/api/ai/*` 路由**：配置 loader 是惰性注册的（`modules/ai.ts:ensureUserConfigLoader`），
  而讨论走的是**插件路由**、不经过那个中间件 → 不打这一下就会静默回退到 **env 里的模型**（本机 env 默认 `deepseek-v4-flash`），
  表现为「配了模型却按别的模型跑」「思维链一条都没有」，且不报任何错。
- 关键验证点，按重要性：
  1. **第 1 章交付后，项目库应有实体**：`characters` / `items` / `locations` / `foreshadows` 非空（这是 P1 的修复目标；修复前全为 0）。
  2. **再跑第 2 章时，设定管家的【项目现状】里能看到第 1 章沉淀的角色** —— 这才是「记忆沉淀」的真正验收标准，写进去只是手段。
  3. **重写已有正文章节必须被拦下**（`deliver_blocked`），且库里的章 id / word_count / 正文指纹均不变。
  4. 正文去空白字数应 ≥ 2500（P2 目标）。
- 测完清理：临时账号 / 项目 / `data/projects/{id}.db`（含 `-wal` `-shm`）三个文件都要删；**删主库 `projects` 行不会级联删这些库文件**，且 Windows 下需先让 server 释放句柄，否则 `EPERM`。

---

## 4. 已完成（能用的边界）

**讨论链路（`server/discuss/`）**

- 三个设计角色**真来回**：剧情设计师提案 → 角色设计师回应 → 设定管家查库质疑 → 剧情设计师二次回应 → 定稿官收敛。发言共享 `transcript`，不是各交一份报告。
- **强制注入防幻觉**：`resolveSettingsDigest` 直接查项目库，把角色/伏笔/大纲/章节现状作为【项目现状】喂给所有角色，并明确告知「没有就是真没有」（实测制止了设定管家在空项目里编设定）。
- **定稿官结论是契约**，字段固定：`节拍 / 角色 / 关键物 / 伏笔 / 禁项 / 结束状态 / 待定`（`角色` 是 2026-09-12 补的）。
- **意图门**对照结论验收正文；打回时给出可执行修改要求；上限 2 次（`MAX_REVISIONS`）后停下交人工，不无限烧钱。
- **覆写保护**：目标章已有正文时**不自动覆盖**，emit `deliver_blocked` 交人工（实测有效）。
- **篇幅自检**（2026-09-12 新增）：初稿低于 2500 字先补写一次（取更长一稿），补写在意图门**之前**，保证过门的就是最终稿。
- **实体沉淀**（2026-09-12 新增，`framework/entity-sink.ts`）：交付成功后一次 `ctx.ai.complete({json:true})` 抽取，保守 upsert 进 `characters/items/locations/foreshadows/story_events`。
- **三道门齐了**（2026-09-12 新增，架构 §5 的设计至此全部落地）：
  · **意图门**（`discuss/roles.ts` 的 `ROLE_REVIEWER`）—— 点状：写出来的是不是我们商量的那一章。
    判定范围**只含结论里的硬约束**（节拍与落点 / 关键物 / 禁项 / 结束状态 / 角色状态变化）；
    「表演方式」（动作怎么做、措辞怎么选）不构成打回理由 —— 这条是实测教训换来的，见 §6-3。
  · **校对门**（`framework/gates.ts:runConsistencyGate`）—— 面状：全文 × 设定库。
    **只给一次定向修订**；修订后仍有冲突也**照常交付**并把冲突清单交人工 —— 宁可带一处标注，也不让整章作废。
  · **润色门**（`framework/gates.ts:runPolishGate`）—— 评分（软门，通过线 7/10），**从不阻塞交付**。
- **上一章全文强制注入**（2026-09-12 新增，`context-resolver.ts:resolvePreviousChapter`）：
  架构 §7 列为「不注入必然写错」的一类。超 6000 字保留结尾（衔接点在那里）；
  没有已交付章节时**明确告知「这是第一章」**，不给模型留幻想前情的余地。
  实测：第 2 章的设定管家能引用第 1 章的正文细节（「手机是第七节车厢专座上捡的」）。

**前端（`apps/web/src/components/layout/`）**

- `AutoWriteWorkbench`：三栏工作台（左交流流 / 中正文+仪表盘 / 右实体栏），双分隔条可拖、两栏可收，中间 340px 保底。
  footer 显示「单章会话 · 库中 N 章」（原先硬编码的「批次 0 / 0」已删）。
- `WorldStateBoard`：本章计划卡（6 段阶段推进 + 结构化的本章结论）+「最近变动」流水。
  **阶段状态由工作台按收到的事件累积**（收到 `conclusion` 即讨论完成、收到 `gate` 即该门完成），
  不解析 `phase` 文案 —— 文案会改，事件契约不会。
  「最近变动」现在读**三类**：`characters.states`（角色变化，此前漏读）/ `items.states` + holders / `foreshadows.payoffChapter`。
- `EntityRail`：右栏存量视图（知识库 / 地点 / 物品 / 伏笔）。
- 交付后收到 `entities` 事件 → 触发宿主 `reload()` 刷新 store，仪表盘与实体栏自动亮起。

**开书设定（`projects.brief`，2026-09-13 新增）**

- 新书向导（`AddBookModal` 的 AI 写作分支）：书名 / 开局 / 世界观 / 笔风基调 / 主角姓名 / 女主姓名
  （「是否多女主」打开后是可增删的名单）→ 第二步选流派（系统流 6 组 / 无系统流 8 组，
  目录是纯数据文件 `apps/web/src/components/ui/novelGenres.ts`，加流派只改它）。手写分支的旧表单原样保留。
- 落库：`projects.brief`（JSON 文本列，见 `NovelBrief`）。服务端 zod 给每项都设了长度上限 ——
  这些文本会被**注入每一轮模型输入**，不设限等于给模型塞垃圾。
- 注入：`context-resolver.ts:formatBrief()` → `SettingsDigest.brief` → `orchestrator` 的
  `【项目现状】` 里多出一段 `【创作设定】`。**为什么必须框架直给**：brief 在**主库**，
  角色的工具（`list_chapters` / `read_chapter`）读不到 —— 让 agent「自己去查」等于向导白填。
- 流派展示名同时写进 `projects.genre`（书卡顶部标签、书库搜索都用它），形如「系统流 · 末日求生」。
- 验证：`scripts/verify-brief-api.mjs`（**Node 24**，用 `node:sqlite` 只读核对主库）；
  `apps/web/src/components/ui/__tests__/AddBookModal.test.tsx` 8 例守 UI（含「手写分支字段不变」与多女主动态增删）。

**多智能体协作流水线（M1，2026-09-13 新增并真机验证）**

- 设计见 `docs/architecture/ai-writing-multiagent-pipeline.md`（7 段 + 4 道闸门 + 施工拆分 + 未决项），
  **M1 已落地**：`brief → cast → bible → plot` 四段可跑，前三段有用户闸门，批准后落库。
- 代码在 `server/pipeline/`（types / store / roles-phase / orchestrator / sink / store.test），
  路由挂在同一个插件下：`GET /pipeline`、`POST /pipeline/{start,advance,decision}`、`GET /pipeline/ledger`。
  前端：`services/ai/pipelineSession.ts` + `components/layout/PipelinePanel.tsx`（工作台中栏）。
- **与现役单章链路的关系**：两条路各管一段 —— 「先立设定」走 pipeline，「已有设定、开始写章」走 `/session`。
  `/session` 与三道门**一行未改**。
- 已验：状态机单测 19 例；`scripts/verify-pipeline-api.mjs` 16 项（零模型成本）；
  真机全链路（`.workbuddy/ui-checks/`）跑完 cast 段 → 闸门 → 批准 → 落库 3 个角色，零控制台报错。
- **M1 的坑**（改代码前先看设计文档 §0）：`canRun` 必须判「不能超过游标」（曾放行跳段，真跑掉一段）；
  reject 要连本段状态一起重置；错误体必须是 `{error:{code,message}}` 信封；
  前端 apiClient 自带 `/api` 前缀而 SSE 走裸 fetch 要全路径；brief 段没有闸门。
- **running 锁与僵死兜底**：跑之前 `store.beginStage()` 落盘 `running`（防两个标签页重复跑同一段）；
  进程被杀留下的僵死 `running` 由 `store.load()` 自动收敛成「中断了，可重试」（阈值 20 分钟）。
  验证脚本 `scripts/verify-pipeline-stage-lock.mjs`（★ 会调模型，约 5 次调用）。
- **未做**：drift 核查 / 前三章试写 / 写作监工 / 每三章轨迹确认 / 断点续跑 / 台账回放（advance 到它们返回 501）。

**治理/基础设施**

- 插件挂载冒烟测试（真实 HTTP）：`apps/server/src/__tests__/plugin-mount.smoke.test.ts`、`autowrite-mount.test.ts` —— 这条关卡来自 08-30 的 `ctx.effect` 事故（曾导致所有 `/api/plugins/*` 路由启动即被熔断 404）。
- 实体沉淀单测 14 例 + 篇幅契约单测 4 例（`server/framework/entity-sink.test.ts`、`server/discuss/roles.test.ts`）。
- 插件正式表迁移通道**已实现**（`plugin/migrations.ts`，248 行，经 `guardian.wrapDb` 归因 + `onProjectDbInit` 给新项目库补跑，5 个用例通过）。注意：**内置插件拿不到 `ctx.db.migrate`**，内置插件数据仍须走 KV 或直接 `global()/project()`。

---

## 5. 未完成清单

### P0 —— 只剩一项决策

| # | 事项 | 现状 / 下手位置 |
|---|---|---|
| 1 | **旧批次流水线怎么处置** | UI 侧的误导**已清**（「批次 0/0」删了、旧话术改了、`autowrite/index.ts` 与 `routes.ts` 顶部加了废弃标注）。剩下的是**要不要物理删除** `server/autowrite/*`（8 工具）+ `FlowStore` + `/batches` 三条路由。倾向删；但 `/batches` 的审计台账能力可能值得先迁到讨论链路。**这是需要拍板的决策，不是技术问题** |

### P1 —— 功能缺口

| # | 事项 | 说明 |
|---|---|---|
| 2 | ~~连续多章写作~~ ✅ **已做**（2026-09-12） | 一条会话支持 `chapterCount`（1–50），**逐章串行**跑完整闭环（讨论→结论→落笔→三道门→交付→沉淀），一章失败不拖垮后续；后续章自动「接着上一章往下写」。UI 输入框右下角有「连写 N 章」，脚本 `scripts/run-chapters.mjs` 支持分批与断点续跑 |
| 3 | **水车记忆（三斗 + 三层时间戳）未实现** | §6 设计（`chapterNo` / `ingestedAt` / `storyTime`）grep 零命中。当前连续性靠「上一章全文 + 实体沉淀 + 章节摘要」，**到第 4–5 章之后可能露馅**（上一章之外的前情只剩摘要） |
| 4 | **「本章细纲」没有对应物** | §7 的强制注入清单里，「上一章全文 / 出场角色卡 / 未回收伏笔 / 已确立硬设定」都已具备（后三者来自 digest），唯独**本章细纲**没有落盘物 —— 这一章写什么完全由讨论现场决定，没有可复用的细纲 |
| 5 | **正文非流式** | `draft` 事件整段到达，正文方块一次出现（不是逐字流）。`AutoWriteWorkbench.tsx` 顶部「待接入：正文流式落点」那句注释**仍然有效** |
| 6 | **台账回放历史运行未做** | KV 里其实有 audit 数据（旧流水线写的），但没有回放 UI。若 P0-1 决定删旧流水线，这条要一起处理 |
| 7 | **两道门可能互相矛盾** | 复核官看「本章结论」、校对官看「设定库」，视角不同，实测出现过「意图门通过、校对门报冲突」。不是 bug，但同时为 false 时该怎么向作者交代**尚未设计** |

### P2 —— 历史债（与 AI 写作相邻）

| # | 事项 | 说明 |
|---|---|---|
| 8 | 伏笔模块设计债 | `SnapshotManager` / `ConsistencyPanel` 仍用**未定义**的 `mc-*` 类；`EarmarkPanel.tsx`（398 行）与 `ForeshadowsPage.tsx` 是**无引用死代码**，已报告未删 |
| 9 | 安全审计结论未逐条复核 | `security_best_practices_report.md`（2026-08-19）报了 1 条高危 RCE（`create_plugin` 让 LLM 生成 `serverCode` 运行时挂载，`apps/server/src/ai/tools/plugin-tools.ts:325` 仍在）+ 默认管理员口令 + 依赖漏洞。插件路由现已要求鉴权（测试断言 401），但**其余结论没有逐条确认** |
| 10 | server 业务模块仍无单测 | 当前基线 6 文件 / 49 用例（`src/__tests__/` 3 个冒烟与迁移 + 插件内 3 个纯逻辑）。`apps/server/src/modules/` 的 20 个业务模块与 `guardian.ts` 的熔断状态机**全无测试保护**。✅ 附带清理已完成：vitest 通配扫进插件 `node_modules` 的问题已修（曾让整个套件卡到超时） |
| 11 | 杂项 | ~~`apps/desktop` 是空壳（无 package.json，`pnpm -r` 只扫到 8/9）~~ ✅ 已于 2026-09-16 删除（空壳仅剩 3 个断链 shim），现为 8/8；仓库根有 `.tmp-p.json` / `.tmp-ck.txt` 等临时文件；测试账号残留（`autowrite_probe`、`uiver…`、`bverify…`） |

---

## 6. 已知陷阱（都是踩过的）

**链路与治理**

1. **意图门靠正则判定**：`/判定\s*[：:]\s*打回/`，其余一律当通过（刻意如此，防格式跑偏导致死循环）。改定稿官/复核官的输出格式时，别破坏这个约定。
2. **实体沉淀只在真交付后跑**。`deliver()` 返回 `{ delivered }` 标志，`deliver_blocked`（已有正文不覆盖 / 没认出章号）**绝不沉淀** —— 否则库里会出现正文里根本没有的实体。
3. **字数自检必须排在意图门之前**。补写出来的内容也得过门；门后补写等于绕开治理。
4. **覆写场景的差异**：讨论链路**拒绝覆盖**已有正文（所以不需要快照）；旧流水线的 `tool-deliver` 会先 KV 备份 + 打 snapshot 再覆盖。

**模型调用**

5. **`maxTokens` 不传的时候，SDK 根本不发 `max_tokens`**，由服务商默认值兜底；而**推理模型（如 `glm-5.3-flash`）的思考 token 也计入该上限**，预算偏小时模型会**主动写短**（表现为「总是写不到约定字数」）。长文写作必须显式给足 —— 见 `autowrite/helpers.ts` 的 `WRITER_MAX_TOKENS = 16384`（与 `ai/agents/chat-agent.ts` 里推理模型的量级一致）。`AgentRunOptions.maxTokens` 是 2026-09-12 才补上的字段。
6. **篇幅契约必须同源**：`discuss/roles.ts` 的 `WRITER_TARGET_CHARS` / `WRITER_MIN_CHARS` 同时被提示词（插值）与运行时字数自检使用，并有单测锁死。此前正是「提示词写 2500–4000、代码里没有任何检查」才导致三次交付全部低于下限。
7. **给区间模型就朝下限写**：写「2500–4000 字」会稳定产出 2100 字左右，要写单一目标值。

**数据库**

8. **`ctx.db.project()` 是同步只读缓存 —— 全新项目返回 `null`。** 项目库在**首次写入**时才创建。任何读到新项目的地方都必须先 `await getProjectDb(projectId)` 一次（讨论链路开头就做了），并且对空库 `try/catch` 兜底（`resolveSettingsDigest` 在空库会抛）。
9. **实体匹配只用精确名称，绝不用子串**。前端踩过「周」与「周粥」被并成同一角色的坑，`entity-sink.ts` 里有注释与单测守护。
10. **枚举全是英文，schema 里的中文注释会骗人**：伏笔 `status` 是 `planted|hinted|payed_off|abandoned`，`type` 是 `identity|motivation|relation|trauma|turning|fate`（`packages/shared/src/index.ts`）。
11. **落库要保守**：只增、只追加（`chapters` 补章号、`states` 追流水），按内容去重保证幂等；`items.currentHolders` 用 `holders` 流转史派生，别手写。
12. **项目库表没有 FK 约束**（`packages/db/drizzle/project_tables.sql` 里没有 `REFERENCES projects`），可以脱离主库行独立插实体。

**前端**

13. **不要在组件里再挂一个 `useSyncService`** —— 它带实体持久化订阅，两个实例会让每次 store 变更被**写两遍**（实体重复创建）。要刷新 store 必须把 `ProjectLayout` 已持有的 `reload` 透传下来（`AutoWriteWorkbench` 的 `onProjectDataChanged` 就是这么做的）。
14. **Web 面插件是构建期静态收集**（`main.tsx` 的 `import.meta.glob`）：新 UI 插件必须重启 vite / 重新构建才生效，**server 的插件 enable/disable API 对 Web 面完全无效**。

**宿主 / 环境**

15. **插件注册资源必须走 `ctx.effect`**，否则插件禁用/卸载时资源不注销 —— 08-30 那次事故就是用法错误导致所有 `/api/plugins/*` 路由启动即熔断 404。
16. **路由卸载要重启**（Hono 架构限制）：日志里的「路由 /api/plugins/xxx 需要重启才能卸载」是正常的，不是 bug。
17. **内置插件拿不到 `ctx.db.migrate`**（只有经 guardian 包装的非内置插件有），内置插件数据走 KV。
18. **GLM 走 new-api 中转需要系统代理（7897）**；遇到 `fetch failed` 先查代理，别怀疑模型配置。
19. **Windows + tsx watch**：kill 不干净会留孤儿进程占 3774，需 `taskkill`。
20. **vite 与 esbuild 版本不能齐步升**：vite 6.4 的依赖预构建与 esbuild 0.28 不兼容，故 vite 侧 pin 0.24（`pnpm-workspace.yaml` 的 overrides 有详解）。

**治理（2026-09-12 实测新增）**

21. **意图门会「抠细节」**：复核官容易抠「同一件事的表演方式」—— 动作是主动还是被动、做了几次、措辞怎么选。这类东西结论里根本没规定，却足以连打两次回、且第二次改稿往往更远，最终整章作废（实测 3333 字全废）。已把判定范围写进 `ROLE_REVIEWER`：**只判结论里的硬约束**。再遇到「明明没写错却过不了门」，先看是不是这类。
22. **两道门不能都设成「能拦死」**：校对门若也无限打回，等于把同一个循环跑两遍。现在的取向是——意图门最多打回 2 次（方向问题值得重写），校对门只给 **1 次**定向修订、之后带冲突交付（事实问题交人工）。**「宁可带标注交付，也不要整章作废」**是这里的设计原则。
23. **改动越大越要跑真机**：type-check 全绿 + 单测全过之后，实测仍抓出三处问题（意图门的细节拉锯、校对门发现的真冲突、初稿只有 1384 字）。验收方式只有一种，见 §3。

**环境（Windows 本机）**

24. **Git Bash 下 `taskkill` 要关掉路径转换**：`taskkill //PID <pid> //F` 会报「无效参数」，得用 `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F`。重启 server 前先用 `netstat -ano | grep :3774` 拿 PID。
25. **vitest 的 `include` 通配会扫进 `node_modules`**：插件目录下有 pnpm hoisted 的副本，`../plugins/local/novel.autowrite/**/*.test.ts` 会把里面第三方的测试也收进来 —— 实测把 server 套件直接拖到超时。已收窄 include 并补 `exclude`（`apps/server/vitest.config.ts`），修后 10.1s / 6 文件 / 49 用例。

**门口径（2026-09-12 连写 30 章实测换来的）**

26. **「门不让交付」要极其慎重**：意图门原本是「打回上限用尽 → 整章不交付」，30 章连写**丢了 2/7 章**。连写场景下缺章会让后面所有章失去前情，比带瑕疵的一章糟得多；而且脚本/后台跑的时候，作者根本看不到那份没入库的稿子。现在意图门与校对门都走**「带警示照常交付」**，由 `delivered.warnings` 标出来。**以后新增任何门，先问一句：它失败时该怎么落地？**
27. **「静默跳过」比报错更危险**：校对门曾因 `maxTokens` 偏小 → 输出 JSON 被截断 → 解析失败，而失败被 `catch` 后返回 `null`、调用方 `if (gate)` 直接跳过 —— 门成了摆设，还照烧一次调用。现在失败会带回 `error` 并透给作者。
28. **每章的真实成本**：约 75 秒 / 10–12 次模型调用（含三道门与实体沉淀），30 章 ≈ 40 分钟。打算跑长任务前先知道这个量级。

---

## 7. 关键文件地图

```
apps/plugins/local/novel.autowrite/
├── plugin.json                          # manifest：权限须含 db:global + db:project
├── server/
│   ├── index.ts                         # 插件装配：注册 9 个技能 + 8 个流程工具 + 状态路由
│   ├── routes.ts                        # /batches（旧）· /session（现役 SSE）
│   ├── discuss/                         # ★ 现役链路
│   │   ├── roles.ts                     #   角色人设 + 定稿官格式 + 篇幅契约常量
│   │   ├── orchestrator.ts              #   编排：讨论→收敛→落笔→字数自检→意图门→交付→沉淀
│   │   └── roles.test.ts                #   篇幅契约同源回归
│   ├── pipeline/                        # ★ 多智能体协作流水线（M1，见 §4）
│   │   ├── types.ts                     #   7 段 / 闸门三态 / 事件 / 上限常量
│   │   ├── store.ts                     #   KV 状态机 + briefHash + 台账 + canRun 守卫
│   │   ├── roles-phase.ts               #   阶段档位（PHASE_SPEC/roleFor）+ 定稿官契约 + 策划官
│   │   ├── orchestrator.ts              #   runStage（讨论→收敛→等确认）/ approveStage（落库）
│   │   ├── sink.ts                      #   契约→结构化抽取→保守 upsert
│   │   └── store.test.ts                #   19 例状态机单测（零模型成本）
│   ├── framework/
│   │   ├── entity-sink.ts               # ★ 实体沉淀（抽取 + 保守 upsert 五表）
│   │   ├── entity-sink.test.ts          #   14 例：去重 / 幂等 / 伏笔三分支 / 脏数据
│   │   ├── context-resolver.ts          #   项目库→digest（供数与幻觉防治）+ 上一章全文
│   │   ├── gates.ts                     # ★ 校对门 / 润色门（架构 §5 的后两道门）
│   │   ├── flow-store.ts / flow-state.ts#   旧流水线的 KV 状态机（现役链路不用）
│   │   └── types.ts
│   └── autowrite/                       # 旧批次流水线（8 工具；见 §2）
│       ├── helpers.ts                   #   GOVERNANCE / WRITER_MAX_TOKENS / parseJsonLoose
│       ├── tool-*.ts                    #   plan/write/review/deliver/admin
│       └── prompts.ts
└── web/
    ├── index.tsx                        # 只注册 chatRail + 技能图标；**已不再注册浮窗面板**
    │                                    #   （inject 里的 'projectPanels' 已成多余，可清）
    ├── chat-wheel.tsx                   # 接管 AI 聊天气泡栏（现役）
    └── panel.tsx                        # 批次状态视图 + 技能气泡，**未注册**，留给日后复用

apps/web/src/components/layout/
├── AutoWriteWorkbench.tsx               # 工作台壳（三栏 + 双分隔条 + 交流流）
├── WorldStateBoard.tsx                  # 本章计划 + 最近变动
├── WorkbenchPlan.tsx                    # 结论结构化解析（CONCERN_FIELDS 与定稿官格式对应）
└── EntityRail.tsx                       # 右栏存量视图
apps/web/src/components/ui/
├── AddBookModal.tsx                     # 新建/编辑书籍：手写卡片表单 + AI 写作新书向导（开书设定 → 流派）
└── novelGenres.ts                       # 流派目录（纯数据：系统流 / 无系统流，分组）
apps/web/src/services/ai/autowriteSession.ts   # /session 的 SSE 客户端 + SessionEvent 类型

apps/server/src/plugin/host.ts           # ctx.ai.agents.run / ctx.ai.complete 的宿主实现（含 maxTokens 透传）
apps/server/src/plugin/guardian.ts       # 插件守护器（隔离/熔断/权限归因）
apps/server/src/plugin/migrations.ts     # 插件正式表迁移通道
```

**落库表**（项目库 `data/projects/{id}.db`）：`chapters` / `characters` / `items` / `locations` / `foreshadows` / `story_events`；带 `states: EntityState[]` 的表能被仪表盘消费。

---

## 8. 未决决策

1. **旧批次流水线删不删**（原「两条链路留哪条」，2026-09-12 已收敛到这一步）—— UI 侧的误导已清、批次数据源已不再被读，只剩「要不要物理删除 `server/autowrite/*` + `FlowStore` + `/batches` 三条路由」。倾向删；若想保留 `FlowStore` 的审计台账能力，得先把它迁到讨论链路（这也决定 P1-6「台账回放」怎么做）。
2. **水车记忆做不做**（现在只剩一半问题）—— 架构 §6 设计「固定三斗 + 三层时间戳」。实体沉淀 + **上一章全文强制注入**已落地，§7 要的「常驻」其实已经做到 1 斗（上一章）。所以问题变成：**要不要把常驻扩到 3 斗**（代价是每轮多带约 2 章全文 × 每章 10+ 次模型调用），以及 `storyTime`（故事内时间）要不要单独维护。
3. **两道门互相矛盾时怎么呈现**（原「意图门之后要不要再补校验」，已由三道门落地解决）—— 实测出现过「意图门通过、校对门报冲突」，两者都没错（视角不同）。当前是各推一条交流流消息，靠人自己看懂；是否需要一个合并的「本章验收结论」尚未设计。
4. **实体抽取的粒度** —— 现在是「一次调用抽全五类」。若发现某类噪声大（尤其 `events` 与 `locations`），可拆成按类调用或加置信度阈值。
5. **收敛是否每次都要用户点头** —— 架构 §4.3 / §10.3 提过，当前是自动收敛、有异议才体现在结论的「待定」栏。

---

## 9. 文档地图

| 文档 | 是什么 |
|---|---|
| **本文** | **现状 + 缺口 + 坑（接手先读这个）** |
| `docs/architecture/ai-writing-architecture.md` | 完整架构设计（双框架/三栏/智能体阵容/三道门/水车记忆）。§8 有「设计→代码」落地状态表，§10 未决项 |
| `docs/reports/ai-writing-test-report.md` | **真机实测报告（两轮）**。第一轮（上午）发现了 P1/P2；第二轮（下午）验证修复 + 三道门 + 上一章全文注入，并记录了跑挂的那次及原因。要复现验证照抄它即可 |
| ~~`docs/autowrite-plugin-framework.md`~~ | 插件框架设计（manifest / 目录 / FlowSpec / KV key 约定 / 安全边界 / 验收锚点）—— **2026-09 已随过期文档一并归档清理**，插件相关设计改看 `docs/architecture/plugin-architecture.md` |
| `docs/architecture/plugin-architecture.md` · `docs/architecture/plugins.md` · `docs/architecture/plugin-standard.md` | 插件体系的架构 / 开发指南 / 标准 |
| `security_best_practices_report.md` | 2026-08-19 安全审计（含未复核的高危项） |
| `README.md` | 项目总览（含 Cordis 基座架构与设计系统） |
