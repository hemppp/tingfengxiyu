# 集中式 Skills 库 + 每个智能体的技能开关

> 落地于 2026-09-13。代码：`apps/server/src/services/skill-library.ts`（业务）、
> `apps/server/src/ai/agents/skill-targets.ts`（智能体清单）、`modules/ai.ts`（路由）、
> 前端 `components/ai/{EntrySkillPanel,AgentSkillsPanel,AgentSkillList,SkillSwitch}.tsx` + `services/ai/skillLibrary.ts`。

## 1. 这个功能要解决什么

原来只有"**对话技能**"一套：`ctx.ai.skills` 注册表 + 输入栏下的技能徽章，
语义是"**这一轮对话用哪条**"。它答不了两个问题：

1. 这条技能**属于谁**？（写作官用「伏笔追踪者」很合理，定稿官用就怪）
2. 这个智能体**启用**了哪些？（徽章是逐轮选的，没有"这个 agent 的长期配置"）

于是有了这个库 + 两套入口。

## 2. 名词口径（别混）

| 词 | 指什么 | `kind` / `category` |
|---|---|---|
| **智能体** | 对话本体那一个（工作台左侧「智能体对话」） | `assistant` |
| **agent** | 子智能体：写作官、剧情设计师、设定管家… | `agent`（必带 `ownerAgent`） |

用户原话对应的三条硬要求：
- 「该 skills UI 并非写作专属」→ 面板只认 `agentId`，换 id 就能展示别的 agent（今天只挂了写作官）；
- 「库仅支持安装和删除」→ 没有"编辑正文"的接口；改内容 = 卸载后重装；
- 「内部按智能体 skills / agent skills 分类存放」→ `skill_library.category`，界面按这两栏渲染。

## 3. 数据模型（主库，全局）

```
skill_library            集中存放所有技能
  id / name / description / color / icon_key
  category      'assistant' | 'agent'      ← 分类存放
  owner_agent   category='agent' 时必填，与 DesignRole.key 对齐
  system_prompt / context_keys(JSON)
  source        'builtin'（随产品带）| 'installed'（用户装的）

agent_skill_toggles      每个智能体的技能开关（**按用户**存）
  id              `${userId}:${agentId}:${skillId}`（直接当主键，不依赖复合唯一索引）
  user_id / agent_id / skill_id / enabled
```

迁移：`packages/db/drizzle/0001_skills_library.sql`；打包版回退建表同步加在
`better-sqlite3-adapter.ts` 的 `bootstrapTables()`（改一处必须改两处）。

**为什么开关单独一张表**：同一条技能可以同时属于多个智能体（「世界观顾问」给对话本体一个、
给策划官一个）。开关是 (用户, 智能体, 技能) 三元组的属性，不是技能自身的属性。

## 4. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ai/skill-library` | 库里全部技能 + `byCategory`（两类分开）+ `orphans` |
| POST | `/api/ai/skill-library/install` | 安装 / 重装（id 已存在则更新内容） |
| DELETE | `/api/ai/skill-library/:id` | 删除（**连带清掉所有用户的开关记录**） |
| GET | `/api/ai/skill-targets` | 全部智能体 + 各自的 `enabled/total` |
| GET | `/api/ai/skill-targets/:agentId` | 该智能体的技能 + 开关状态 |
| PUT | `/api/ai/skill-targets/:agentId/toggle` | 单条开关 `{skillId, enabled}` |
| PUT | `/api/ai/skill-targets/:agentId/toggle-all` | 批量开关 `{enabled}` |

全部 `requireAuth`；错误体是信封 `{error:{code,message}}`。输入类错误一律 400 且**带上原因**
（"未知智能体 X（清单里没有它，装了也看不见）"）—— 这里吞原因等于让人对着 500 猜。

## 5. 隔离规则（最要紧的一条）

`belongsToAgent(skill, agentId)`：

- `agentId === 'chat'` → 只看 `category === 'assistant'`
- 其他 → 只看 `category === 'agent' && ownerAgent === agentId`
- **`ownerAgent` 为空谁也看不到**

最后一条是刻意的：「看不到」比「悄悄给了所有人」好 —— 后者会让技能出现在完全不该用它的智能体上。
配套的是 `orphans` 检查：归属写了、清单里却没声明的技能会被列出来并在界面上报警，
否则作者会陷入"装了却看不见、而且不知道为什么"。

## 6. 前端结构

```
输入栏上方（工作台「智能体对话」的输入栏）
├── [写作 Skills]    ← EntrySkillPanel：只认 agentId，展示该 agent 的技能 + 开关
└── [智能体 Skills]  ← AgentSkillsPanel
        ├── 按智能体：智能体清单（分组 + n/total）→ 下钻 → AgentSkillList（技能 + 左关右开开关）
        └── 技能库  ：两类分组列表 + 安装表单 + 每条删除

AgentSkillList  通用件（只认 agentId）—— "该 UI 并非写作专属"的落点
SkillSwitch     左关右开；滑块在左=关、在右=开（两个状态都写在界面上，不靠颜色猜）
```

**为什么是下钻而不是左右分栏**：这个面板挂在约 400px 宽的侧栏上方，两栏会挤到看不清技能名；
"点某个智能体后看到开关"这句需求本身就是下钻语义。

**入口为什么在 `AutoWriteWorkbench` 而不是 `ChatPanel`**：工作台左侧「智能体对话」这张脸是
`AutoWriteWorkbench`；`ChatPanel` 是**手写模式**的「AI 对话」，而技能归属的 agent 属于 AI 写作链路
（手写模式不共用那套）。摆错地方会指向一个当前模式下不存在的智能体。
（首次实现就摆错了一次，靠 GUI 点检抓出来 —— 见 §8。）

## 7. 与既有 `ctx.ai.skills` 的关系

两套并存，管的不是一件事：

| | `ctx.ai.skills`（注册表） | 本库（`skill_library`） |
|---|---|---|
| 回答 | 这轮对话能激活什么 | 这些技能归属谁、开着还是关着 |
| 存哪 | 内存（插件 register 进来） | 主库表，**库是真相** |
| 谁写 | 插件注册 | 作者安装 / 删除 |

库的初始内容**来自**注册表：首次访问时把已注册技能按 `builtin` 种进去
（`ensureSeeded()`，且**只在表完全为空时种** —— 作者删掉的技能不该在下次启动复活）。

去重口径：`source='builtin'` 的技能可以删；删掉后不会被重新种回来（除非把表清空）。

## 8. 验证

- 单测：`apps/server/src/__tests__/skill-library.test.ts` 7 例（隔离规则 + 清单顺序 + 插件声明/撤销）、
  `apps/web/src/components/ai/__tests__/{SkillSwitch,AgentSkillsPanel}.test.tsx` 14 例
- 真机 API：`scripts/verify-skill-library.mjs`（34 项断言：种子、持久化、越界 400、安装/删除、删后开关记录清空）
- 真机 GUI：`.workbuddy/ui-checks/gen-skills-ui.mjs` → `plan-skills-ui.json`（含**几何断言**：
  两个入口的 `bottom` 必须 ≤ 输入栏 `top`；以及开关 `aria-checked` 拨动后回读、两页签、下钻与返回）

## 9. 已知边界 / 下一步

- **开关目前只到"配置"层**：它记录"这个智能体启用了哪些技能"，但还没接到 agent 的执行链路上
  （真正生效需要让 `runDiscussion` / `runPilot` 装配时读 `agent_skill_toggles`）。这是有意分两步：
  先把"归属 + 开关"这套配置立住并可验证，再接执行。
- `skillTargets.declare()` 已作为插件入口接好（`ctx.ai.skillTargets`），
  但现有 agent 名单目前由核心静态声明（展示层目录，与插件 `DesignRole.key` 对齐）。
- 库不提供"从 URL / 文件安装"，只有表单安装。
