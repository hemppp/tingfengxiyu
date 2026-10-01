# 运行时可用性验证报告（t34）

- 验证对象：D51 修复后，两个工作台在**真实浏览器**下的可用性与互斥性
- 验证方式：**真实** server + **真实** vite dev + **真实** Chrome（CDP 9222）
- 结论：**运行时可用性成立**（D51 修复前**不成立**）
- 说明：本任务原派给 kernel-eng（attempt 1），该 attempt 因宿主超时（`Request timed out`）被标记 failed；它已把环境备齐（server 3774 / vite 5174 / Chrome CDP 9222），仅差探针路径问题（vite 被 hoist 到根 `node_modules`）。由队长接管（attempt 2）跑完。

---

## 一、为什么必须做浏览器级验证

D51 的教训是：**此前所有证据都止于静态 / 构建 / 单测层，而「可用」是运行时属性。**
10 条验收命令全部 exit 0 的同时，auto 项目在真实浏览器里**永久卡在 `Loading...`** —— 静态扫描、type-check、单测、构建**没有一道**能看见这件事。

用户原始要求是「保证另外一个模块分离或者关闭后另外一个模块也可以使用」，其中「**完全可用**」这一条款，在本次验证之前**从未被验证过**。

---

## 二、环境快照

| 组件 | 实测 |
|---|---|
| server | `http://localhost:3774`，pid 3864（**修复后新起**的进程） |
| vite dev | `http://localhost:5174`，pid 19656 |
| Chrome / CDP | `Chrome/154.0.8037.92`，`--remote-debugging-port=9222`，pid 22484 |
| 探针 | `.workbuddy/split-workbenches/tools/_t34_runtime_probe.mjs`（kernel-eng 编写） |
| e2e | `scripts/e2e/e2e-mode-separation.mjs` |

> **★ 关键前提**：必须是**修复后新起**的 server。`local-scanner` 只在启动时扫描、**不热重载** `plugin.json`；D51 修复前的陈旧进程（pid 18552）**至今仍报** `MANIFEST_INVALID`。若误用旧进程，auto 会依旧卡 `Loading`，从而把「修复成功」误判为「修复失败」。

---

## 三、决定性对照：D51 修复前 vs 修复后

同一探针、同一路径、同一判据：

| 观测项 | D51 修复前 | 修复后 |
|---|---|---|
| auto 项目 `bodyLen` | **10** | **365** |
| auto `textHead` | `"Loading..."` | 完整工作台 UI |
| auto `ariaLabels` | `["Loading"]` | **18 个**（含全部 AutoWriteWorkbench 面板） |
| auto 三标记命中 | **0 / 3** | **3 / 3** |
| `hasWorkbenchSlot` | `false` | `true` |
| auto console 错误 | 0（静默卡住） | 0 |
| `e2e-mode-separation` | **EXIT=1** | **EXIT=0** |
| `/api/health` 两模块 | `error` / `error` | **`ok` / `ok`**（插件总数 27） |

---

## 四、auto 项目（原始 CDP 输出）

```
[auto] path=/project/47a43767-1073-4d2a-8dbc-82a59ac2adb6  bodyLen=365  ariaLabelCount=18
[auto] ariaLabels(18) = ["返回","收起对话栏","展开分页区","智能体对话","对智能体说话","发送",
                         "功能看板气泡列","打开流水线看板","打开本章计划看板","打开实体与设定看板",
                         "打开记忆审计看板","打开技能库看板","打开字体排版看板","调整对话栏宽度",
                         "关闭正文","编辑器标签","正文","状态栏"]
[auto] 标记命中: {"状态栏":true,"智能体对话":true,"编辑器标签":true,"功能转轮":false}
[auto] bodyLen 轨迹: [{"t":0,"bodyLen":365}]
[auto] 错误/异常事件(0): (无)
```

⇒ **三标记 3/3 命中**；`功能转轮`（manual 标记）**未出现**；无 console 错误、无 HTTP ≥ 400。
⇒ 一次性到达 365 字节（`t=0` 即达标），非「慢加载」。

---

## 五、manual 项目（原始 CDP 输出）

```
[manual] path=/project/6e821302-fc5a-48c7-b73b-6784096867e8  bodyLen=130  ariaLabelCount=23
[manual] ariaLabels(23) = ["返回","返回书架","设置","管理员后台","登出","功能转轮","打开章节面板",
                           "打开AI 对话面板","打开势力面板","打开参考书面板","打开笔记面板",
                           "打开统计面板","打开大纲面板","打开时间线面板","打开角色面板",
                           "打开地点面板","打开伏笔面板","打开物品面板","打开关系图面板",
                           "打开地图面板","打开导出面板","打开字体排版面板","展开功能转轮"]
[manual] 标记命中: {"状态栏":false,"智能体对话":false,"编辑器标签":false,"功能转轮":true}
[manual] bodyLen 轨迹: [{"t":0,"bodyLen":130},{"t":3,"bodyLen":130},...{"t":21,"bodyLen":130}]
[manual] 错误/异常事件(0): (无)
```

⇒ 手写台 12 个面板气泡齐全；**零 auto 标记泄漏**；`bodyLen` 8×3s 恒为 130（**稳定**，非慢加载）。

---

## 六、e2e 断言（`scripts/e2e/e2e-mode-separation.mjs` → EXIT=0）

```
===== 3) manual 项目 =====
  manual markers: {"功能转轮":true,"角色气泡":true}
  auto   markers: {"状态栏":false,"智能体对话":false,"编辑器标签":false}
✓ manual 项目出现手写台标记（功能转轮 + 角色气泡） — 命中 2/2
✓ manual 项目**不出现** AI 写作 UI（状态栏/智能体对话/编辑器标签） — 误现 0 个

===== 4) auto 项目 =====
  auto   markers: {"状态栏":true,"智能体对话":true,"编辑器标签":true}
  manual markers: {"功能转轮":false,"角色气泡":false}
✓ auto 项目出现 AutoWriteWorkbench（状态栏 + 智能体对话 + 编辑器标签） — 命中 3/3
✓ auto 项目**不出现**手写知识面板（功能转轮/角色气泡） — 误现 0 个

============================================================
✅ e2e-mode-separation 全过
```

**四条断言全过**：manual 2/2 命中 + 误现 0；auto 3/3 命中 + 误现 0 ⇒ **互斥性成立**。
（D51 修复前该脚本为 EXIT=1，auto 命中 0/3 且 manual 标记也为 0 —— 因为界面根本没渲染。）

---

## 七、两个必须记住的技术要点

### 1. 三个 auto 标记的判据**只认运行时 DOM 的 `aria-label` 集合**，不以源码字面量 grep 为准
由 kernel-eng 抓出、队长独立复现：

| 标记 | 真实位置 | 形式 | 字面量 grep |
|---|---|---|---|
| `状态栏` | `AutoWriteWorkbench.tsx:1320` | 静态字面量 | ✅ 能命中 |
| `智能体对话` | `AutoWriteWorkbench.tsx:807` | 静态字面量 | ✅ 能命中 |
| `编辑器标签` | `shell/TabBar.tsx:165` | **三元表达式** `aria-label={variant === 'unified' ? '编辑器标签' : …}` | ❌ **漏报** |
| `打开角色面板` | `components/shell/FloatingBubbles.tsx:117` | **模板拼接** ``aria-label={`打开${label}面板`}`` | ❌ **漏报** |

⇒ 若有人用 `grep 'aria-label="编辑器标签"'` 去复核标记唯一性，会得到「0 命中 ⇒ 标记不存在」的**错误结论**。复核须用不含引号的模式（如 `编辑器标签`），或直接信运行时 DOM。
（另：`状态栏` 在 `manual/workbench/web/editor/EditorPage.tsx:228` 也有命中，但那是**注释**，不是 `aria-label`；`智能体对话` 在 manual 侧的命中同样是注释/说明。故三个标记作为 `aria-label` **仍全部只存在于 auto 模块**。）

### 2. 环境必须是修复后新起的 server
见第二节 ★ 说明。

---

## 八、遗留与清理

- 探针与 e2e 所建测试项目均已 `DELETE` 清理（HTTP 200）。
- 验证结束时 vite（19656）/ server（3864）/ Chrome（22484）仍在运行 —— 属验证环境，收尾时统一清理。
- **一条并发纪律（本次实测）**：`verify-module-removal.mjs` 会 `renameSync` 移走模块目录，**禁止与 vite dev / server / e2e 并发**。vite 是**已证实**的模块目录句柄持有者（其 tailwind content 含 `../plugins/**/web/…`，且 vite 监视模块目录）：实测 **vite 在跑时两个模块目录 `renameSync` 均报 `EPERM`；停掉 vite 后立即成功**。另实测**否证**了「`tsx watch` 也是句柄持有者」的推测（停掉 vite 但 `tsx watch` 仍在跑时，两个 `renameSync` 均成功）—— 排障时**不必**去停 `tsx watch`。

---

## 九、★ 补充：模块**物理移除**下的双向运行时验证（最强判据）

以上第一至八节验证的是「两模块同时在场时各自可用」。但用户要求的核心是「**任一模块被关闭或分离后，另一模块仍完全可用**」—— 这需要把模块目录**真的移走**再验。

工具：`.workbuddy/split-workbenches/tools/_captain_removed_runtime.mjs`（可双向，`REMOVE_MODULE=manual|auto`）。
流程：记录逐文件指纹 → `renameSync` 物理移走目标模块 → 起真实 server + vite + Chrome → 浏览器探针 → **`finally` 无条件还原 + 复算指纹断言逐字节一致**。

### 方向一：移走 `manual` → `auto` 可用（EXIT=0）

```
[前置] manual 指纹: files=72 bytes=745734 hash=233FBA06…ADD11D
[2] /api/health 插件总数=26 ；novel.auto.workbench: ok ；非 ok 列表: (空)
    novel.manual.workbench 已从清单消失: true
[5] auto bodyLen=365 ariaLabelCount=18
    ① 必中标记 3 项全中: true — 状态栏=true 智能体对话=true 编辑器标签=true
    ② 未泄漏对侧标记: true — 功能转轮=false
    ③ 渲染完整（bodyLen>=300，实测 365）: true
    ④ 无 console 错误 / HTTP≥400: true   ⑤ 无 error 插件: true
    ⑥ novel.auto.workbench… ⑦ novel.manual.workbench 已消失 / novel.auto.workbench 仍在且 ok
[清理] 还原后指纹 files=72 bytes=745734 hash=233FBA06…ADD11D ⇒ 逐字节一致
结论: ✓ auto 在 manual 缺席下运行时完全可用            EXIT=0
```

### 方向二：移走 `auto` → `manual` 可用（EXIT=0）

```
[前置] auto 指纹: files=58 bytes=643130 hash=AE904389…4973A
[2] /api/health 插件总数=26 ；novel.manual.workbench: ok ；非 ok 列表: (空)
    novel.auto.workbench 已从清单消失: true ；novel.manual.workbench 仍在且 ok: true
[5] manual bodyLen=124 ariaLabelCount=22
    ① 必中标记 2 项全中: true — 功能转轮=true 打开角色面板=true
    ② 未泄漏对侧标记: true — 状态栏=false 智能体对话=false 编辑器标签=false
    ③ 渲染完整（bodyLen>=100，实测 124）: true
    ④ 无 console 错误 / HTTP≥400: true   ⑤ 无 error 插件: true
    ⑥ novel.auto.workbench 已消失   ⑦ novel.manual.workbench 仍在且 ok
[清理] 还原后指纹 files=58 bytes=643130 hash=AE904389…4973A ⇒ 逐字节一致
结论: ✓ manual 在 auto 缺席下运行时完全可用            EXIT=0
```

⇒ **用户要求的「任一模块分离/关闭后另一模块仍完全可用」，运行时层面双向成立。**
（`bodyLen` 差异说明：manual 缺 auto 时 124 / 在场时 130；auto 恒为 365。差额来自「字体排版」等跨模块面板的缺失，属预期，非缺陷。）

### 本次暴露的**三处判据标定错误**（均为我方判据错，非产品缺陷）

| # | 错误 | 表现 | 修正 |
|---|---|---|---|
| 1 | `bodyLen` 阈值跨模式统一用 `>200` | manual（124~130）被判「渲染不完整」⇒ 假失败 | 按模式标定：auto ≥300、manual ≥100 |
| 2 | 用 `new RegExp('auto')` 子串匹配插件 id | 命中同目录**独立插件包** `novel.autowrite`（不属于 auto 大模块）⇒ 「已消失」误报 false | 改为精确 id 比较 `novel.auto.workbench` |
| 3 | `probeText.split('[auto]')[1]` 取段落 | 在**第二个** `[auto]`（建项目日志行）处截断，只得 79 字符 ⇒ 三标记全判 false | 只认探针末尾的**结构化 JSON 汇总** |

**教训**：写判据比跑判据更容易出错。凡见「失败」，须先自查判据本身是否标定正确，再判产品缺陷。

---

## 十、结论

**运行时可用性成立，且双向成立。**

| 场景 | 结果 |
|---|---|
| 两模块**同时在场** | auto 渲染完整（18 个 `aria-label`，三标记 3/3）；manual 渲染完整（23 个 `aria-label`，12 个面板气泡）；**标记互斥**，零泄漏 |
| **移走 manual** → 验 auto | ✓ auto `bodyLen=365`、18 个 `aria-label`、三标记 3/3、零泄漏、零错误、`/api/health` 全 `ok` |
| **移走 auto** → 验 manual | ✓ manual `bodyLen=124`、22 个 `aria-label`、两标记 2/2、零泄漏、零错误、`/api/health` 全 `ok` |

结合 t33 的静态 / 构建 / 单测 / 真实挂载证据，用户原始要求「保证另外一个模块分离或者关闭后另外一个模块也可以使用」中的「**完全可用**」条款，**已获得运行时双向证据支撑**。