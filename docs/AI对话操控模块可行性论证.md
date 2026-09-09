# AI 对话功能操控其他功能模块 —— 可行性论证

> 基于 NovelMuse 当前代码库实证分析（非空想）。
> 范围：在现有"AI 对话"能力之上，让对话能够**调用/编排**已有的功能模块（笔记、角色、章节、伏笔、大纲……）。
> 结论先行：**技术上高度可行（High）**，现有架构已具备约 80% 的先决条件，边际成本低，核心工作是"把 REST 端点声明为 tool" + "加一层安全/确认门"。

---

## 1. 现状盘点（代码实证）

### 1.1 AI 对话现状：能"说"，还不能"做"
- 入口：`apps/server/src/modules/ai.ts` 的 `POST /api/ai/chat`（`runChatAgent` / `runChatAgentSimple`）。
- 前端：`apps/web/src/services/ai/chatService.ts` 的 `novelChat` / `novelChatStream`，已支持 `phase: '小说对话'` 与章节上下文透传。
- 本质：**纯文本生成**。LLM 输出一段文字返回给用户，不触发任何写操作。这是"操控模块"要补上的最后一环。

### 1.2 功能模块已全面 REST 化（最关键的使能点）
`apps/server/src/modules/` 下每个模块都是标准化的 CRUD 端点，且**统一经过鉴权链**：

| 模块 | 文件 | 关键端点示例 |
|---|---|---|
| 笔记 notes | `notes.ts` | `GET /:projectId`、`POST /`、`PUT /:id`、`DELETE /:id` |
| 角色 characters | `characters.ts` | 增删改查 + 关系 |
| 地点 locations / 物品 items | `locations.ts` / `items.ts` | 同上 |
| 事件 events / 伏笔 foreshadows / 标记 earmarks | `events.ts` / `foreshadows.ts` / `earmarks.ts` | 同上 |
| 大纲 outline / 时间线 timeline | `outline.ts` / `timeline.ts` | 同上 |
| 批注 annotations / 引用 references | `annotations.ts` / `references.ts` | 同上 |
| 章节 chapters / 项目 projects | `chapters.ts` / `projects.ts` | 同上 |
| 快照 snapshots / 统计 stats / 搜索 search | `snapshots.ts` / `stats.ts` / `search.ts` | 同上 |

**关键事实**：以 `notes.ts` 为样本，所有写操作都执行 `verifyProjectOwnership(c, projectId)` 后才落库。这意味着——**AI 调用模块与用户在 UI 上点击按钮，走的是同一条鉴权链，不存在权限提升（privilege escalation）风险。**

### 1.3 Strands Agent 微服务已存在
- `apps/agents/src/novelmuse_agents/main.py` + `agents/ghost.py`：Ghost Agent 已用 `agent.structured_output(GhostResult, ...)` 验证过结构化输出。
- Strands SDK **原生支持 `@tool` 函数定义与 tool-calling**。新增一个"编排 Agent"只是再写一个 agent 文件，复用 `provider.get_strands_model`。
- 网关已具备转发能力：`ai.ts` 的 `forwardToAgentsService` 把 `feature` 路由到 Python 微服务（如 `ghost`），链路现成。

### 1.4 前端状态层已就绪
- Zustand：`editorStore`、`projectStore`、`referenceStore`、`chatHistoryStore`、`authStore`、`aiRedstoneStore`。
- React Query：`queryClient` + `services/api/*`（如 `noteService` 已存在）。
- 含义：AI 执行"创建笔记"后，只需 `invalidateQueries(['notes', projectId])` 或乐观更新 store，UI 即自动刷新——**无需为 AI 单独造一套状态通道**。

### 1.5 现成的"能力许可清单"
- `aiRedstoneStore` + 后端 `userSettings.aiFeatures`：用户可按功能冻结/解冻 AI（红石开关）。
- 这正是**AI 可执行的动作白名单**的天然载体——只需把"AI 能否删除""AI 能否创建角色"这类开关并入同一套机制。

---

## 2. 方案设计

### 2.1 核心思想：Tool-ify 而非 Rewrite
不重写任何业务模块。把每个模块的 CRUD 端点**声明为 LLM 可理解的 tool schema**（name / description / JSON-Schema 参数），由编排 Agent 在对话中按需调用。

```
用户: "帮我把第 3 章里出现的'青鸾'加为角色，并记一条笔记：她的真实身份是……"
  → Orchestrator Agent 解析意图
  → tool: createCharacter({ projectId, name:'青鸾', ... })
  → tool: createNote({ projectId, title:'青鸾身份', content:'...' })
  → 返回结果 + 自然语言总结
```

### 2.2 两种部署形态

**A. 后端编排（推荐）**
- 在 `apps/agents` 新增 `orchestrator.py`，持有上述 tools；tool 实现直接 `fetch` 调用 Hono REST（`:3774`，已带 JWT 鉴权）。
- `ai.ts` 网关新增 `feature: 'orchestrate'`，转发到该 agent。
- 前端只发"意图 + projectId"，收"工具执行结果 + 文本"。
- 优点：LLM 逻辑集中服务端，跨端复用，密钥不落浏览器。
- 缺点：依赖 agents 微服务常驻（当前默认未随 web/server 起，需补启动脚本）。

**B. 前端编排（轻量）**
- web 侧把 tool schema 发给 LLM，tool 执行映射为现有 `services/api/*` 调用 + store 更新。
- 复用现有 `/api/ai/chat` 网关（加 `tools` 透传）。
- 优点：无需新服务，改造面小。
- 缺点：工具执行在浏览器，部分敏感操作不便；多端难统一。

**建议：A 为主、B 为降级**。当 agents 服务不可达时，前端回退为"建议操作卡片"（见 5.5）。

### 2.3 与红石开关整合
- 在 `aiFeatures` 中扩展 AI 动作维度：`aiWrite`（允许创建/更新）、`aiDelete`（允许删除，默认关）、`aiOrchestrate`（总开关）。
- 破坏性操作（delete）**默认关闭**，开启后仍需"二次确认 token"：Agent 先返回"将删除 X，确认？"，用户确认后后端才真正执行。

---

## 3. 可行性支撑论据

1. **架构就绪度最高**：模块已是 REST + 统一鉴权。把端点"声明成 tool"是机械性工作，不是设计性风险。
2. **基础设施已复用**：Strands（tool-calling）、`/api/ai/gateway`（路由/转发）、SSE 流式（`scan-timeline-stream` 已验证）、用户配置 loader（`ensureUserConfigLoader`）全部现成。
3. **状态回写路径清晰**：React Query 失效 / Zustand 更新是既有模式，AI 写操作与用户操作的回写方式完全一致。
4. **安全边界天然闭合**：AI 调模块 = 走 `requireAuth` + `verifyProjectOwnership`，与 UI 同源同权。攻击者即便诱导 AI，也只能动自己拥有的项目数据。

---

## 4. 风险与缓解（必须正视的部分）

| 风险 | 说明 | 缓解 |
|---|---|---|
| 工具调用幻觉 / 错误参数 | LLM 可能调错 tool 或填错参 | tool 用 JSON-Schema 强约束；服务端 `zod` 二次校验；高风险操作走 dry-run 预演 + 人类确认门 |
| 延迟 | tool-calling 多一轮 LLM 往返（1–3s） | 流式响应 + 渐进式 UI；工具结果增量回写；只读工具优先 |
| 状态一致性 | AI 改了后端，前端未刷新 | 以 `projectId` 为 key 的 query 失效 / 乐观更新 / SSE 推送 |
| 破坏性操作安全 | "删除整本大纲"级风险 | 能力白名单（红石）+ 二次确认 token + 操作审计日志 |
| 本地模型能力弱 | `LocalModelPanel` 引入的本地模型可能不擅长 tool-call | 优雅降级：检测不支持 tool-call 时，回退为"建议操作卡片"，用户点选才执行 |
| 上下文越界 | Agent 需知道"当前项目/章节" | 每次调用强制带 `projectId` + 当前选中上下文，prompt 中锁定作用域 |

---

## 5. 落地路线（分阶段，低风险起步）

- **Phase 0 — 规范**：定义共享 `tool-schema` 规范（必含 `projectId`、ownership 约束、只读/写/删分级）。
- **Phase 1 — 只读工具**：`search`、`listCharacters`、`getNotes` 等。零破坏，验证"意图→tool→结果→UI"全链路。
- **Phase 2 — 创建类工具**：`createNote`、`addCharacter`、`addForeshadow`，带确认门。
- **Phase 3 — 多步编排**：先读后写（"把第 3 章提到的所有人都建为角色"）。
- **Phase 4 — 破坏性与红石整合**：`deleteX` + 开关 + 二次确认 + 审计。

---

## 6. 工作量与风险等级评估

| 项 | 量级 | 说明 |
|---|---|---|
| 后端：orchestrator agent + tool registry | 中 | 复用 Strands，主要工作是指标化声明现有模块 |
| 网关：新增 `orchestrate` feature + 转发 | 小 | 沿用 `forwardToAgentsService` |
| 前端：对话 UI 增加 tool-result 渲染 | 中 | 现有 chat UI 扩展，渲染"操作卡片 + 确认" |
| 红石开关扩展 | 小 | 复用 `aiRedstoneStore` 机制 |
| 启动脚本补齐（agents 常驻） | 小 | 当前默认未随 web/server 起 |
| **MVP 总估** | **2–3 周** | 在现有地基上，非从零 |

---

## 7. 结论

AI 对话操控其他功能模块**在 NovelMuse 当前架构下高度可行**。最大的两块地基——**功能模块的 REST 层**与 **AI 网关/Strands 基础设施**——已经存在且质量良好。真正要补的只是两层薄薄的胶水：

1. **Tool 声明层**：把已有 REST 端点翻译成 LLM 可调用、带 JSON-Schema 与鉴权约束的 tool；
2. **安全/确认门**：用现成的红石开关做能力白名单，破坏性操作加二次确认。

这是一项"接线"工程，而非"重建"工程。建议从 Phase 1（只读工具） immediately 起步验证链路，收益最快、风险最低。
