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

1. **所有 AI 写作代码都还没提交。** 仓库只有 2 个 commit（基线 + 一个测试关卡），工作区有 **35 个已改 + 16 个未跟踪**文件，`apps/plugins/local/novel.autowrite/` 整个目录都是未跟踪的。**动手前先建分支/提交基线**，否则一次误操作就能丢掉这块的全部工作。
2. **没有任何真机验证。** type-check 与单测只覆盖纯逻辑与落库器；模型输出的质量、字数、实体抽取准确度**全部未经实测**（最近一次实测是 2026-09-12 上午，只覆盖修复前的状态，见 `docs/ai-writing-test-report.md`）。
3. **这个模块有两条并行链路，改之前先确认你改的是哪条**（见 §2）。看错链路是这里最容易犯的错。

---

## 1. 一句话现状

`novel.autowrite` 插件实现了「**多角色讨论 → 收敛本章结论 → 写作官落笔 → 意图复核（打回重写）→ 交付写库 → 实体沉淀**」的单章闭环，治理阀门（意图门、覆盖保护）在 08-12 实测中真实生效；主要缺口是**只有单章**（无连续多章/水车记忆）、**缺校对门与润色门**、以及**旧的批次流水线已成死代码**。

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

**结论**：批次流水线（`server/autowrite/*`、`FlowStore`、`/batches` 路由、状态面板、`GET /api/plugins/autowrite/batches`）目前基本是**死代码**，只有 `tool-deliver` 的覆写快照能力在讨论链路里被复用（实体沉淀也挂进了它的交付路径，见 §4）。

→ **接手第一件事应该是在这两条里选一条**：要么把批次能力接回讨论链路（做连续多章），要么正式废弃并在文档/UI 里清掉（含 `AutoWriteWorkbench` 底部硬编码的「批次 0 / 0」）。

---

## 3. 怎么验证（唯一有效的验收方式）

type-check 和单测**不能**证明这个模块能用 —— 模型输出是链路的一部分。真实的验收方式是：**新建临时账号 + `mode: 'auto'` 项目，直接消费 SSE 事件流，然后查项目库**。

`docs/ai-writing-test-report.md` 里有完整的实测方法（含耗时、调用次数、逐步事件、落库核验），照抄即可。要点：

- 用 Node 脚本 POST `/api/plugins/autowrite/session`，逐条记 `data:` 行（事件类型：`phase` / `turn` / `conclusion` / `draft` / `review` / `delivered` / `deliver_blocked` / `entities` / `error` / `done`）。
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

**前端（`apps/web/src/components/layout/`）**

- `AutoWriteWorkbench`：三栏工作台（左交流流 / 中正文+仪表盘 / 右实体栏），双分隔条可拖、两栏可收，中间 340px 保底。
- `WorldStateBoard`：本章计划卡（阶段推进 + 结构化的本章结论）+「最近变动」流水。
- `EntityRail`：右栏存量视图（知识库 / 地点 / 物品 / 伏笔）。
- 交付后收到 `entities` 事件 → 触发宿主 `reload()` 刷新 store，仪表盘与实体栏自动亮起。

**治理/基础设施**

- 插件挂载冒烟测试（真实 HTTP）：`apps/server/src/__tests__/plugin-mount.smoke.test.ts`、`autowrite-mount.test.ts` —— 这条关卡来自 08-30 的 `ctx.effect` 事故（曾导致所有 `/api/plugins/*` 路由启动即被熔断 404）。
- 实体沉淀单测 14 例 + 篇幅契约单测 4 例（`server/framework/entity-sink.test.ts`、`server/discuss/roles.test.ts`）。
- 插件正式表迁移通道**已实现**（`plugin/migrations.ts`，248 行，经 `guardian.wrapDb` 归因 + `onProjectDbInit` 给新项目库补跑，5 个用例通过）。注意：**内置插件拿不到 `ctx.db.migrate`**，内置插件数据仍须走 KV 或直接 `global()/project()`。

---

## 5. 未完成清单

### P0 —— 不做会持续误导后来者

| # | 事项 | 现状 / 下手位置 |
|---|---|---|
| 1 | **两条链路二选一** | 见 §2。批次流水线已成死代码，UI 里还有硬编码「批次 0 / 0」（`AutoWriteWorkbench.tsx` footer）。要么接回、要么废弃 |
| 2 | **P1/P2 修复未经真机验证** | 按 §3 跑一轮。若字数仍不达标，见 §6 的 maxTokens 那条 |
| 3 | **提交基线** | 35 改 + 16 未跟踪全在工作区；建议先提交再改 |

### P1 —— 功能缺口（架构文档里承诺过）

| # | 事项 | 说明 |
|---|---|---|
| 4 | **校对门 / 润色门未接进讨论链路** | `docs/ai-writing-architecture.md` §5 承诺三道门，讨论链路只落了**意图门**。现成的 `autowrite/tool-review.ts`（`check_draft` / `polish_draft`）属旧流水线，需改成对讨论链路的稿子生效 |
| 5 | **水车记忆（三斗 + 三层时间戳）未实现** | §6 设计（`chapterNo` / `ingestedAt` / `storyTime`）grep 零命中。当前连续性只靠「本章结论 + 章节 summary 列表」，**多章长篇会露馅** |
| 6 | **强制注入清单未完整落地** | §7 要求强制注入「上一章全文、本章细纲、出场角色卡、未回收伏笔、已确立硬设定」。当前只注入了 digest 摘要，**不含上一章全文** |
| 7 | **连续多章写作没有** | 一轮会话只处理一章，没有 cursor / 自动续写。原批次流水线有状态机但 UI 不连（P0-1） |
| 8 | **正文非流式** | `draft` 事件整段到达，正文方块一次出现（不是逐字流）。`AutoWriteWorkbench.tsx:23` 那句「待接入：正文流式落点」的注释已过时，需修正或实现 |
| 9 | **台账回放历史运行未做** | KV 里其实有 audit 数据（旧流水线写的），但没有回放 UI |
| 10 | **角色变化不进「最近变动」** | `WorldStateBoard` 只读 `Item.states` + `Foreshadow.payoffChapter`。实体沉淀**已经**在写 `characters.states`，但前端不读，所以角色的状态变化看不见。改前端（读 characters.states）或补后端变更流水 |

### P2 —— 历史债（与 AI 写作相邻）

| # | 事项 | 说明 |
|---|---|---|
| 11 | 伏笔模块设计债 | `SnapshotManager` / `ConsistencyPanel` 仍用**未定义**的 `mc-*` 类；`EarmarkPanel.tsx`（398 行）与 `ForeshadowsPage.tsx` 是**无引用死代码**，已报告未删 |
| 12 | 安全审计结论未逐条复核 | `security_best_practices_report.md`（2026-08-19）报了 1 条高危 RCE（`create_plugin` 让 LLM 生成 `serverCode` 运行时挂载，`apps/server/src/ai/tools/plugin-tools.ts:325` 仍在）+ 默认管理员口令 + 依赖漏洞。插件路由现已要求鉴权（测试断言 401），但**其余结论没有逐条确认** |
| 13 | server 业务模块仍无单测 | 现有 7 个测试文件＝3 个 server 冒烟/迁移（`src/__tests__/`）+ 1 个旧框架单测（`flow-state.test.ts`）+ 我加的 2 个（`entity-sink.test.ts`、`roles.test.ts`）+ 1 个**从插件 node_modules 副本里跑到的** core `install.test.ts`。`apps/server/src/modules/` 的 20 个业务模块与 `guardian.ts` 的熔断状态机**全无测试保护**。附带清理：vitest 的 include 通配 `../plugins/local/novel.autowrite/**/*.test.ts` 会扫进 `node_modules`，建议补 `exclude` |
| 14 | 杂项 | `apps/desktop` 是空壳（无 package.json，`pnpm -r` 只扫到 8/9）；仓库根有 `.tmp-p.json` / `.tmp-ck.txt` 等临时文件；测试账号残留（`autowrite_probe`、`uiver…`、`bverify…`） |

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
│   ├── framework/
│   │   ├── entity-sink.ts               # ★ 实体沉淀（抽取 + 保守 upsert 五表）
│   │   ├── entity-sink.test.ts          #   14 例：去重 / 幂等 / 伏笔三分支 / 脏数据
│   │   ├── context-resolver.ts          #   项目库→digest（供数与幻觉防治）
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
apps/web/src/services/ai/autowriteSession.ts   # /session 的 SSE 客户端 + SessionEvent 类型

apps/server/src/plugin/host.ts           # ctx.ai.agents.run / ctx.ai.complete 的宿主实现（含 maxTokens 透传）
apps/server/src/plugin/guardian.ts       # 插件守护器（隔离/熔断/权限归因）
apps/server/src/plugin/migrations.ts     # 插件正式表迁移通道
```

**落库表**（项目库 `data/projects/{id}.db`）：`chapters` / `characters` / `items` / `locations` / `foreshadows` / `story_events`；带 `states: EntityState[]` 的表能被仪表盘消费。

---

## 8. 未决决策

1. **两条链路留哪条**（最优先，决定后面所有事）—— 倾向：废弃批次流水线，把「连续多章」做成讨论链路的循环，把 `FlowStore` 的审计台账能力迁过来复用。
2. **水车记忆做不做** —— 架构 §6 设计了「固定三斗 + 三层时间戳」，但 §6.2 自己也承认「转折的后果本该由设定库承载」。实体沉淀落地后，「靠设定库承载连续性」已经走了第一步；水车可能只需要「上一章全文常驻」这一半。
3. **意图门之后要不要再补校验** —— 若真机验证发现字数仍不达标，下一步是给写作官做「生成→自数→续写」的多轮，还是再加一道独立门。
4. **实体抽取的粒度** —— 现在是「一次调用抽全五类」。若发现某类噪声大（尤其 `events` 与 `locations`），可拆成按类调用或加置信度阈值。
5. **收敛是否每次都要用户点头** —— 架构 §4.3 / §10.3 提过，当前是自动收敛、有异议才体现在结论的「待定」栏。

---

## 9. 文档地图

| 文档 | 是什么 |
|---|---|
| **本文** | **现状 + 缺口 + 坑（接手先读这个）** |
| `docs/ai-writing-architecture.md` | 完整架构设计（双框架/三栏/智能体阵容/三道门/水车记忆）。§8 有「设计→代码」落地状态表，§10 未决项 |
| `docs/ai-writing-test-report.md` | 2026-09-12 上午的真机实测报告（P1/P2 就是它发现的）。**注意：它描述的是修复前的状态**，修复前的所有验证方法仍然有效 |
| `docs/autowrite-plugin-framework.md` | 插件框架设计（manifest / 目录 / FlowSpec / KV key 约定 / 安全边界 / 验收锚点） |
| `docs/plugin-architecture.md` · `docs/plugins.md` · `docs/plugin-standard.md` | 插件体系的架构 / 开发指南 / 标准 |
| `security_best_practices_report.md` | 2026-08-19 安全审计（含未复核的高危项） |
| `README.md` | 项目总览（含 Cordis 基座架构与设计系统） |
