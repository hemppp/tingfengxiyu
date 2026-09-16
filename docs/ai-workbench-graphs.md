# AI 工作台「四看板全面图谱化」

> 2026-09-15 实施并真机验证。作者口径：「把手写那些可视化的 UI 替换到 AI 自动写作的详细内容上」
> → 追问范围时选了「**全面改成图谱**」。

## 1. 改了什么

AI 写作工作台（`project.mode === 'auto'`）右侧分页区的四个看板，内容全部由图谱承载：

| 看板 | 原来 | 现在 | 实现 |
|---|---|---|---|
| 流水线 | `PipelinePanel`（阶段列表 + 控件） | **设定流水线 DAG**：7 段排成 3 列 × 3 行，状态着色 + 闸门/过期/打回徽标；控件搬进侧栏 | `PipelineGraphPanel.tsx` |
| 本章计划 | `WorldStateBoard`（计划卡 + 变动列表） | **三层因果图**：阶段链 → 章号 → 被改动的实体 | `ChapterPlanGraphPanel.tsx` |
| 实体与设定 | `EntityRail`（存量卡片） | **手写模式的关系图谱**（角色 / 物品 / 地点三 Tab） | 直接挂 `components/knowledge/RelationGraph` |
| 记忆审计 | `MemoryAuditPanel`（三段文字） | **记忆关系图**：L1 为中心，智能体与冲突挂在下面 | `MemoryGraphPanel.tsx` |

### 约定变更（作者本人决定，别再改回去）

`AutoWriteWorkbench` 里原先写着「**不挂手写面板**：两套 UI 互斥的既有约定不变」。
本次把 `RelationGraph` 直接挂进了「实体与设定」—— **那条约定已被推翻**。
代码里的注释已改写成"别再按旧约定摘下去"。

## 2. 两个新节点类型

`components/knowledge/graph/`：

- **`StageNode`** —— 阶段节点（圆角矩形 + 左侧墨条 + 状态点 + 徽标）。
  表达「先后」。状态映射到 `--state-*` 语义变量，**不写死色值**（换肤要跟着变）。
- **`EntityNode`** —— 实体 / 章号 / 记忆节点。表达「是什么」。
  `variant: 'round'` 给章号当锚点，矩形给实体与记忆。`kind` 只决定**墨阶**，不用色相。

与既有 `BubbleNode`（圆球，用面积表达"分量"）分工明确：节点名字长（「陈曦」「第 12 章」
「exp.ch3.turn2」）时圆球装不下。

### ★ 4 手柄规则（踩过）

两种节点都挂了 **4 个手柄**（`t-top` / `t-left` / `s-bottom` / `s-right`），
业务方通过 `sourceHandle` / `targetHandle` 自己选方向：

- 纵向流程（流水线列内推进、本章闭环的交付→实体）→ **下 → 上**
- 横向链（一行排开的阶段、章号→实体）→ **右 → 左**

**只用上下手柄画横向链**时，连线要从节点底部绕到下一个节点的顶部，
在同一 y 上打出两个半圆 —— 看着像打结。这是真机截图发现的第一版问题。

手柄本身用 CSS 藏掉（`.react-flow__handle.stage-handle`，在 `globals.css`）。
必须写成**双类**选择器：xyflow 自带的 `.react-flow__handle` 是单类，
而它的 `style.css` 与 `globals.css` 的相对注入顺序不确定 —— 靠提特异性取胜，不靠顺序。

## 3. 布局规则（每条都是真机截图逼出来的）

| 规则 | 为什么 |
|---|---|
| 流水线 **3 列 × 3 行**，不是一行 7 个 | 一行要 1600px 宽，画布只有 ~1030px，`fitView` 缩到 0.57 后 13px 的字变 7px，读不了 |
| 每列**垂直居中** | 最后一列只有 1 段，不居中会贴在顶部，整图看着像被截断 |
| 章号层**升序**（左老右新） | 降序时章号与实体的横向次序正好相反，每条变动边都要横跨整幅图 → 14 条成毛线团 |
| 实体按**最早变动章**升序 | 与章号锚点左右对齐，边才短 |
| 同批次变动**合并成一条边** | 「同一章改了同一角色的三个字段」画三条几乎重合的线 = 纯噪音 |
| 三层共用一个居中基准（实体层宽度） | 各层从 x=0 起排会让阶段行缩在左边、右边空一大片 |
| 记忆图谱智能体**一行最多 4 个** | 真实项目有 7–8 个读过记忆的智能体，一行 8 × 196 = 1548px → zoom 0.6 → 文字糊 |
| 节点宽度按最长文案定 | 「角色与节奏宪章」7 字在 152 宽下被截成「角色与节奏…」 |

## 4. 两个真 bug（顺手修掉）

### 4.1 `MiniMap` 变黑板

`GraphShell` 里写的是 `maskColor="var(--background)"` —— `--background` 存的是
**裸三元组**（`0 0% 98%`），不是颜色，SVG `fill` 回退成黑色，整个 MiniMap 变成一块黑板。
修法：包上 `hsl()`。**同类坑**：`hsl(var(--x, #hex))` 也是非法的（fallback 不能是 hex），
`ChapterEditor` 里踩过。

### 4.2 容器必须是 `overflow-hidden` + 确定高度

看板容器原先是 `overflow-y-auto p-4`。图谱面板全是 `h-full` + 内部自己滚，
外层再开滚动会出现「滚动条套滚动条」；更关键的是 **ReactFlow 需要确定高度的容器**，
放进可变高度的滚动盒里画布会被压成 0。已改为 `overflow-hidden p-3`。

## 5. 数据口径的坑

- **实体 store 是运行时按项目切换的**：`useSyncService` 在切项目时先 `setState({characters: []})`
  再 `loadAllProjectData`。所以 `RelationGraph`（内部不做 `projectId` 过滤）挂进 AI 工作台是安全的。
  `EntityRail` 里的 `filter(projectId)` 是防御性冗余。
- **记忆图谱的智能体集合要取并集**：`view.agents` 是按 `agent_memory` 聚合的，
  于是"读了全局记忆但还没写过私记"的智能体在图上根本不存在 ——
  而"谁读过全局记忆"正是这张图要回答的首要问题。取 `view.agents ∪ view.audit` 后补齐。

## 6. 停用的旧面板

`PipelinePanel` / `WorldStateBoard` / `EntityRail` / `MemoryAuditPanel` 已无人挂载，
文件顶部都加了「⚠️ 已停用」标注。**是否物理删除待拍板**
（与批次流水线死代码同一处理原则：先标注、不擅自删）。

- `__tests__/PipelinePanel.test.tsx` 仍在跑 `PipelinePanel` —— 删文件时要一并处理。
- 图谱版是列表版的**功能超集**；`PipelineGraphPanel` 里的 SSE 事件处理是**整段沿用**原实现的，
  改一处务必两处对齐。同理 `ChapterPlanGraphPanel` 沿用了 `WorldStateBoard` 的变动流水口径、
  `MemoryGraphPanel` 沿用了 `MemoryAuditPanel` 的冲突裁决三态。

## 7. 验证方式（可复用）

```bash
# ① 造一本有内容的探针书（角色 states / 物品 states / 伏笔回收 / 记忆审计 / 事实冲突）
node .workbuddy/ui-checks/gen-graph-plan.mjs
# ② 真机点开四颗气泡，截图 + 数节点/边 + 抓控制台
node "F:/work buddy/.workbuddy/skills/chrome-automation/scripts/chrome.mjs" \
     .workbuddy/ui-checks/plan-graphs.json
```

要点：

- **图谱必须有内容才验得出东西**。只建一本空书，四个面板全落空状态 —— 会放过一堆问题
  （MiniMap 黑板、fitView 缩糊、边打结都是"有数据"才暴露）。
  种子数据直接写项目库 `data/projects/{id}.db`（表结构见 `gen-graph-plan.mjs`）。
- `genreCategory` 的枚举**只有** `system` / `none`，写别的会被 Zod 拒（400）。
- 正文标签的选择器是 `[data-panel-key="__body__"]`；`[aria-label="正文"]` 是**内容区**，
  点它不会切标签。
- 快照里带 `nodes` / `edges` / `emptyState` / `canvas` 四项 ——
  `emptyState: false` 才说明数据真灌进去了。
- 验收基线（探针数据下）：流水线 `7 节点 / 6 边`、本章计划 `22 / 19`、实体 `7 / 3`、记忆 `10 / 9`，
  `consoleErrors` 与 `pageErrors` **都是 0**。
- 跑完清数据：`scripts/clean-test-data.mjs --keep <在用项目 id>` +
  `scripts/clean-orphan-project-dbs.mjs`（后者要在**停掉 server 后**跑，否则项目库文件被占用删不掉）。


---

## 8. 性能优化（同日，图谱化之后）

### 8.1 问题：图谱化把 three.js 拖进了工作台首屏

用**生产产物**取证（比猜可靠）：`AutoWriteWorkbench` 的 chunk 里**静态 import 了 `GraphShell`**，
而 `GraphShell` 又静态 import 了 `vendor-three` 与 `vendor-export`。后果是：

> **进 AI 工作台就会下载 three.js，哪怕一个图谱面板都不打开。**

体积口径（都取 minified）：`vendor-three` **562 kB**、`vendor-export`（html-to-image）95 kB。

### 8.2 三处改动

| 改哪 | 怎么改 | 效果 |
|---|---|---|
| `AutoWriteWorkbench` | 三个自带图谱面板改 `React.lazy`（原先只有 `RelationGraph` 是懒的） | 工作台 chunk **202.16 → 121.31 kB**（未压缩同口径，−40%）；不再静态依赖 GraphShell |
| `GraphShell` | `Graph3D` 改 `React.lazy` + `Suspense` | three 只在用户点「3D」时才下载 |
| `GraphShell` | `html-to-image` 改 `onExport` 内 `await import()` | 只在点导出时下载 |

`Graph3D` 用 React 19 的 **ref-as-prop**（props 里声明 `ref?`），所以 `lazy` **不需要** `forwardRef` 包一层。

另有两处渲染优化 —— **选中态不再重建图**：
`ChapterPlanGraphPanel` / `MemoryGraphPanel` 原先把 `selectedId` 放进 `graphData` 的 useMemo 依赖，
点一下节点就要把整份 nodes/edges（22 节点 19 边）重算一遍，还会连锁触发合并 effect。
改成单独的 effect 只改 `data.isSelected`，并在**无变化时返回原引用**以避免全量重渲染（与 `RelationGraph` 一致）。

### 8.3 实测：进工作台到底加载了什么

dev 服务器上读 `performance.getEntriesByType('resource')`：

| 时刻 | jsFiles | three | xyflow | 图谱模块 |
|---|---|---|---|---|
| 书架页 | 87 | **0** | 0 | 0 |
| 进工作台 | 146 | **0** | 0 | **0** |
| 开「流水线」 | 154 | 0 | 1 | 1 |
| 开「实体与设定」2D | 164 | **0** | 1 | 4 |
| 切到 3D | 169 | **2** | 1 | 5 |

- 进工作台：**一个图谱模块都没加载**。
- 打开关系图谱（2D）：仍然 `three: 0` —— "开了图谱但只用 2D"也不付 three 的钱。
- 点 3D：three 才下来。

### 8.4 静置开销：水墨背景层没问题

`AmbientBackdrop` 有两个 `feTurbulence` + `feDisplacementMap`（全视口）。
实测**静置 8 秒 long task = 0**，确认它是"挂载时算一次"的静态层、**没有常驻开销** —— 无需改动。

### 8.5 构建耗时：纠正一个错报

上一轮报过「`vite build` 带 minify 跑了 34 分钟没完成」。**那是测量错误，不是配置问题**：
当时同时开着 dev server + Chrome 自动化 + tsc + vitest，CPU 被抢光。
**空闲条件下完整构建（含 minify）实测 14–16 秒。**

### 8.6 一个已知的上限（别再白费力气）

`@xyflow/react` 被 `vite.config.ts` 的 `manualChunks` **强制并进 `vendor-react`**，
和 react / react-dom / framer-motion / gsap 同块 —— 注释写明原因是它们互相依赖成环，
拆开会让 React exports 初始化失败（`Cannot set properties of undefined (setting 'Activity')`）与 TDZ 报错。
**所以关系图库那份体积无法再靠"懒加载"剥离**，它跟着 React 一起在首屏。
要动它得先解开环，风险高、收益有限，暂时不做。

### 8.7 验收方式

- **分包**（静态取证）：`AutoWriteWorkbench` 已无 `GraphShell` / `vendor-three` 静态依赖；
  `GraphShell` 已无 `vendor-three` / `vendor-export` 静态依赖（各自剩 2–4 个动态 import）。
- **四面板真机复检**：四张截图，`consoleErrors` / `pageErrors` 均为 0。
- **选中高亮**（重构项，靠 **DOM 断言**而不是肉眼）：
  `.react-flow__node` 内层卡片的 `box-shadow` 从 `0 1px 3px` 变为
  `0 0 0 1.5px <墨圈>, 0 6px 18px`，未点中的节点保持不变 —— 两个面板都验过。
  ⚠️ 探针要**按样式特征定位卡片**（非 0 圆角 + 非 none 投影）；
  用 `querySelector('div > div')` 会量到外层包裹 div（radius 0），得出假结论。
- **web 测试** 139/139。
