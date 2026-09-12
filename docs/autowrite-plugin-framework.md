# novel.autowrite 自动写作插件 —— 技能框架设计

> 结论先行：以**独立插件**承载一个「写作技能框架」。核心 AI 层退化为纯引擎（机制留核心、内容归插件），
> 8 个内置聊天技能剥离进插件；框架内建「多代理流转引擎 + 治理层（自治/审查/强制台账）」，
> 自动写作作为第一个 flow 型技能接入。展示沿用 AI 聊天流（工具气泡），不另开面板。
> 全程不依赖插件数据库迁移（状态走 KV），不碰 plugin-migrations WIP。

---

## 1. 定位与设计原则

| 原则 | 含义 |
|------|------|
| 机制留核心，内容归插件 | 技能注册表/查询机制是宿主能力；具体技能定义、图标、展示标签全部由插件持有 |
| 决策权自治，监督权审查 | 编排器在 FlowSpec 声明的边界内自主流转；审查三道关与审计台账同步设立，台账不可关闭 |
| 零迁移依赖 | 框架状态（批次计划/流转断点/审计台账）全部存 `plugin_kv`，不建新表 |
| 展示零新形态 | 复用聊天流工具气泡；二阶段才做聚合进度卡 |

## 2. 现状盘点（代码实证）

**可直接复用：**

- 插件技能注册通道：`apps/server/src/plugin/host.ts:245` `ctx.ai.skills.register()`（dispose 自动注销，`source: 'plugin'`）
- 工具注册通道：`host.ts:238` `ctx.ai.tools.register(definition, handler)`
- 章节读写 SDK 工具：`apps/server/src/ai/agents/sdk/tools.ts` —— `write_chapter`（`allowWriteChapter` 双重门禁，默认封锁）、`read_chapter`、`list_chapters`、`web_search`
- 知识库工具：`ai/tools/`（character/item/location/foreshadow/outline 五套读写）
- 分析型 agent：consistency / style / rhythm（`ai/agents/`，被章节保存 pipeline 引用，**不剥离**）
- 上下文构建：`ai/context-builder.ts`
- 聊天流工具气泡：`apps/web/src/components/ai/ChatPanel.tsx:475` `ToolCallBubble` + `TOOL_LABELS`
- 前端技能选择器：已从 `GET /api/ai/skills` 拉取，无内容副本
- 守护器（插件级 quarantine/trusted/failed）、snapshots、KV（`plugin_kv`）

**必须补的缺口（唯一宿主契约扩展）：**

- `host.ts:252` `ctx.ai.agents` 目前是**空壳**（Map 存名字，无运行能力）；`ctx.ai.providers` 同。
  框架要跑子代理，需给宿主补真实运行器（见 §6.3）。

## 3. 插件形态与 Manifest

对齐 `docs/plugin-standard.md`（novel-plugin-standard/1.0），本地目录形态：

```json
{
  "id": "novel.autowrite",
  "name": "自动写作引擎",
  "version": "0.1.0",
  "description": "写作技能框架：技能承载 + 多代理流转 + 治理（自治/审查/台账）",
  "permissions": ["ai:skills", "ai:tools", "ai:agents", "routes", "db:global"],
  "server": { "inject": ["ai", "routes", "db"] },
  "web": { "inject": ["skills", "api"] }
}
```

- `ai:agents` 权限白名单已存在（`packages/core/src/manifest.ts`），配合 §6.3 的运行器扩展正好落位。
- `web.inject` 需在 core 契约新增 `'skills'` 扩展点（`registerSkillIcons`），这是 web 契约的唯一改动：
  - `packages/core/src/manifest.ts` web 白名单加 `'skills'`
  - `WebPluginContext` 加 `registerSkillIcons(map: Record<string, ComponentType>)`
  - 前端 `skillsConfig.ts` 清空为插件注册结果 + 空 Map 兜底

## 4. 目录结构

```
apps/plugins/local/novel.autowrite/
├── plugin.json
├── src/server/
│   ├── index.ts                     # apply(ctx)：装配 + dispose 注销
│   ├── framework/                   # ★ 框架本体（与具体技能无关）
│   │   ├── types.ts                 # SkillModule / FlowSpec / GovernanceConfig
│   │   ├── registry.ts              # mount 批量注册 skills+tools+icons，统一注销
│   │   ├── context-resolver.ts      # contextKeys → 注入数据（chat 型走前端，flow 型走 context-builder）
│   │   ├── flow-engine.ts           # 流转状态机：合法转移校验 / KV 断点 / 卡点 / 台账
│   │   └── subagent.ts              # 子代理声明 → ctx.ai.agents 运行；每步独立模型配置
│   ├── skills/                      # ★ 剥离来的 8 个 chat 型技能，一技能一文件
│   │   ├── character-analyst.ts     # 角色分析师
│   │   ├── foreshadow-tracker.ts    # 伏笔追踪
│   │   ├── rhythm-doctor.ts         # 节奏医生
│   │   ├── worldbuilder.ts          # 世界观构建
│   │   ├── dialogue-polisher.ts     # 对话润色
│   │   ├── plot-architect.ts        # 情节架构
│   │   ├── continue-writer.ts       # 续写
│   │   ├── outline-architect.ts     # 大纲架构
│   │   └── index.ts                 # 汇总 export
│   └── autowrite/                   # ★ 第一个 flow 型技能
│       ├── index.ts                 # FlowSpec 声明（steps + governance + gate）
│       ├── planner.ts               # 规划官：设定+大纲 → 每章细纲（批次计划）
│       ├── writer.ts                # 写作官：前情摘要+细纲+设定 → 初稿
│       ├── checker.ts               # 校对官：初稿 vs 设定，一致性硬门（机判）
│       ├── polisher.ts              # 润色官：风格/节奏软门（评分）
│       └── deliver.ts               # 交付：write_chapter + 生成本章摘要
└── src/web/
    ├── index.tsx                    # registerSkillIcons
    └── flow-card.tsx                # 流程进度卡（二阶段）
```

## 5. 框架核心抽象

### 5.1 SkillModule —— 技能一等公民

```ts
interface SkillModule {
  def: SkillDef;                    // 宿主契约原样：id/systemPrompt/contextKeys/name/color
  kind: 'chat' | 'flow';
  tools?: ToolModule[];             // 技能专属工具（ctx.ai.tools 注册，带展示标签）
  flow?: FlowSpec;                  // 仅 flow 型
}
```

- **chat 型**（8 个剥离技能）：只带 prompt + contextKeys，框架零加工直通宿主注册表。
- **flow 型**（自动写作）：声明式流程，执行/状态/展示由框架代理。

### 5.2 FlowSpec —— 流程型技能声明

```ts
interface FlowSpec {
  steps: FlowStep[];                          // planner → writer → checker → polisher → deliver
  loop?: { over: 'chapters'; plan: string };  // 外循环：按章推进，plan 来自规划官
  gate: 'per-chapter' | 'final';              // 人工卡点：每章一停 / 批次结束停
  governance: GovernanceConfig;
}

interface GovernanceConfig {
  hardGates: FlowStep[];            // ① 校对官：机判过审（0 矛盾才放行）
  reviewer?: { threshold: number }; // ② 评审官：低于阈值打回重写
  retries: number;                  // ③ 自愈重试上限（超限→批次隔离）
  budgetPerChapter?: number;        // token 预算，超支→暂停请示
  auditLog: true;                   // 台账：框架强制常量，不可配置关闭
}
```

## 6. 框架组件与数据流

### 6.1 编排模型

```
用户选「自动写作」技能 → 聊天代理获得编排器 systemPrompt（框架由 FlowSpec 自动生成）
  编排器把每个 flow step 当工具调用（agent-as-tool 语义）：
    plan_batch / write_draft / check_draft / polish_draft / deliver_chapter
  flow-engine 在工具 handler 层校验转移合法性：
    ① 校对官不通过 → 拒绝进入润色/交付
    ② 评审官打回 → 只允许回到写作官
    ③ 未到交付步 → write_chapter 不可能被调用
  每步执行 → 记台账 → 更新 KV 断点 → 工具结果回到聊天流渲染气泡
```

关键：**编排器（LLM）提议，flow-engine 裁决**。LLM 只能在声明的边内流转，越界转移被状态机拒绝并回喂错误信息。

### 6.2 状态存储（plugin_kv，项目隔离）

| key | 内容 |
|-----|------|
| `batch:<id>` | 批次计划：章节范围、每章细纲、进度指针 |
| `flow:<batchId>:<chapterOrder>` | 当前步骤、各步产物、重试计数、预算消耗 |
| `audit:<batchId>` | 台账：每步 {输入摘要, 输出摘要, 模型, 耗时, token, 决策理由} |
| `gate:<batchId>` | 卡点状态：等待确认的章节及其概要/评分/审查结论 |

聊天中断可恢复：回来说"继续"，编排器从 KV 断点步接着跑。

### 6.3 宿主契约扩展：给 `ctx.ai.agents` 补运行器

`host.ts` 的 aiService 扩展（复用核心 AI 基础设施，插件不直接触 provider）：

```ts
agents: {
  register(def) { /* 现状不变 */ },
  // 新增：运行一个命名子代理（SDK createNovelAgent 同款装配）
  run(name, input, opts?: { model?, skillId?, tools?: string[], context? }),
    // → { text, toolCalls, usage }
  // 新增：裸补全（校对官/评审官等无需工具的机判步骤用）
  complete(messages, opts?: { model?, json?: boolean }),
},
```

- `run()` 内部：provider-factory 取模型配置 → SDK `Agent` + 按名单裁剪 `wrapExistingTools` → 运行 → 归集 usage。
- 每步模型可独立配置（盘点/校对用便宜模型，写作官用强模型）。
- 权限：持 `ai:agents` 的插件方可调用；`tools` 名单受插件自身 `ai:tools` 注册范围约束。

### 6.4 上下文双通道

- chat 型技能：沿用前端注入（`contextKeys` → 前端拉知识库塞 prompt），机制不变。
- flow 型技能：`context-resolver` 服务端直供——调 `context-builder` 拿设定/前情摘要，
  不依赖前端在场（挂机跑批次的前提）。

## 7. 技能剥离清单（核心 → 插件）

| 来源 | 去向 | 动作 |
|------|------|------|
| `ai/agents/skills.ts` 的 `SKILLS` 8 条目内容 | 插件 `skills/*.ts` | 搬迁，`source` 变 `'plugin'` |
| `skills.ts` 的机制（类型/注册表/getSkillSystemPrompt/listSkillMetas） | 留在核心 | 不动，`SKILLS` 表清空 |
| 消费方 `chat-agent.ts:609`、`sdk/agent.ts:183`、`modules/ai.ts:44` | — | 零改动（注册表合并逻辑天然兼容空内置表） |
| 前端 `skillsConfig.ts` id→图标映射 | 插件 web 入口 `registerSkillIcons` | 清空 + 兜底空 Map |
| style/rhythm/quick-phrase/scanner 等 agent | 留核心 | **不剥离**——pipeline 引擎部件，剥离牵动章节保存分析 |

**验收锚点**：剥离后 `GET /api/ai/skills` 返回相同技能清单（source 全变 plugin）；`pnpm type-check` 全绿；章节保存分析 pipeline 行为无变化。

## 8. 治理层：自治与审查

### 8.1 自治（编排器的决策空间）

| 自治项 | 内容 | 边界 |
|--------|------|------|
| 流转决策 | 校对零问题→跳过润色直交；发现矛盾→带修正指令打回写作官 | 只能走 FlowSpec 声明的边 |
| 上下文自主 | 写作官可自调 read_chapter / 知识库读工具 / web_search 取材 | 只读工具；写类工具永不入自治范围 |
| 故障自愈 | 失败→换上下文/模型重试；连续 retries 次失败→自动暂停整批次并报告 | 不卡死、不静默烂尾 |
| 预算自治 | 每章 token 预算，超支→暂停请示 | 防失控循环重写 |

### 8.2 审查（三道关 + 台账 + 保险）

```
写作官初稿
  → ① 校对官（硬门）：一致性机判，矛盾不过审不许出本章
  → ② 评审官（软门）：节奏/文风评分，低于阈值附评语打回
  → ③ 人工卡点：默认每章交付前贴「概要+评分+审查结论」等确认
```

- **审计台账强制**（`auditLog: true` 常量）：每步记录输入/输出摘要、模型、耗时、token、决策理由；聊天可查（"看第 3 章的审查记录"）。
- **覆写保险**：写非空章节前强制聊天确认 + 自动打 snapshots 快照；`write_chapter` 的 `allowWriteChapter` 门由本插件显式持有，延续核心"章节写入默认封锁"基调。
- **批次隔离（守护器同构）**：批次级连续失败 → 批次进 `quarantined`，须人工在聊天里明确"恢复"；与插件级守护器（guardian.ts）同构不同层。

### 8.3 自治级别（聊天里一句话切换）

| 级别 | 行为 |
|------|------|
| 受限自治（默认） | 每章卡点 + 硬门 + 软门全开 |
| 高自治 | 连续模式：硬门拦截 + 台账留痕，人工事后审 |
| 守护自治 | 高自治 + 批次隔离保护（适合挂机过夜） |

## 9. 展示层（AI 聊天流，已定案）

- **一阶段**：每个 flow step = 一张 `ToolCallBubble` 气泡（`TOOL_LABELS` 加 5 行中文标签）+ 技能选择器新技能项。
- **二阶段**：`flow-card.tsx` —— 每章一张流程进度卡（写作⠙→校对✓→润色○），批次级总进度卡；数据源即 §6.2 的 KV 状态（轮询既有状态路由）。
- 状态路由：`GET /api/plugins/autowrite/batches/:id`（鉴权走插件 routes 常规通道）。

## 10. 安全边界汇总

| 风险 | 防线 |
|------|------|
| AI 覆盖既有正文 | 非空章节强制确认 + 写前自动快照 |
| 越权流转（跳过审查） | flow-engine 状态机裁决，越界转移拒绝并回喂 |
| 失控成本 | 每章预算 + 重试上限 + 超限自动停 |
| 无人监督的批量写入 | 卡点默认开；连续模式仅限高自治显式切换 |
| 事后追责无据 | 台账强制（不可配置关闭） |
| 插件本身失控 | 宿主守护器 quarantine/trusted 照常覆盖本插件 |

## 11. 实施顺序与验收锚点

> **实施状态（2026-09-09）**：A / B / C 已全部落地并通过验收（type-check 8 包全绿、vitest 56/56、
> server+web 生产构建通过、lint 通过；真机冒烟确认插件 status=ok、9 技能 source=plugin、
> 8 个 autowrite_* 工具注册、/api/ai/skills 路由存活）。
> 插件已升格为 workspace 包（`@novel-plugins/autowrite`，pnpm-workspace 增加 `apps/plugins/local/*`），
> 框架单测位于插件内 `server/framework/flow-state.test.ts`，借 server vitest 运行。
> 遗留：D 阶段打磨项（流程进度卡 / 连续模式 / 批次计划确认 UI）。

| 阶段 | 内容 | 验收 |
|------|------|------|
| A 剥离 | 8 技能迁入插件壳 + web 图标扩展点 + 核心清空 | §7 验收锚点 |
| B 框架 | registry / context-resolver / flow-engine / subagent + 宿主 agents.run 扩展 | 单测：状态机合法转移/拒绝越界；KV 断点续跑 |
| C 自动写作 | FlowSpec 五步 + 编排 prompt + 治理落地 | E2E：写通一章（规划→写作→校对→润色→交付，卡点暂停→继续），台账完整 |
| D 打磨 | 流程进度卡 / 连续模式 / 批次计划确认 UI | 挂机跑 3 章批次不断链 |

每阶段独立可合入：A 完成后插件已是「技能承载者」，B/C/D 逐层加码。

## 12. 明确不做

> ⚠ 2026-09-10 更新：应用户要求已加**独立浮窗面板**（projectPanels + 状态路由
> `/api/plugins/autowrite/batches`），聊天流与面板并存（共享 KV 状态，面板只读 + 人工恢复按钮）。
> 下述"聊天流是唯一界面"条款对其余项仍然有效。

- ~~不做 projectPanels / editor 扩展~~ → 面板已加（见上）；editor 扩展仍不做
- 不剥离 style/rhythm/quick-phrase 等 pipeline 引擎部件
- 不建新数据库表（KV 足够；未来若要结构化检索台账再议迁移）
- 不做插件级模型 provider 注册（复用宿主 provider-factory 统一配置）
- 第一阶段不做断点编辑 UI（聊天对话即是交互面）
