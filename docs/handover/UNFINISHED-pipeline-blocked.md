# ✅ 已修复 · 全量写作流程跑不通（输出预算被思考打穿）

> ## ✅ 已解决（2026-09-17）—— 以下原文**保留作现场记录**，勿删
>
> ### 真因（裸测 + 故障注入双向坐实）
> `max_tokens` 被服务商**严格遵守**，而推理模型 `glm-5.3-flash` 的**思考 token 也计入该上限**、
> 且波动极大。同一 system、同一输入、`temperature=0` 的三档裸测：
>
> | max_tokens | reasoning | content | finish_reason |
> |---|---|---|---|
> | 256 | 254 token（吃光） | **0 字** | `length` |
> | 8192 | 4787 token | 1110 字 | `stop` |
> | 16384 | 5529 token | 1288 字 | `stop` |
>
> 另抽到过 reasoning 只用 26 token 的样本 —— **波动达两个数量级**，所以「某个值够用」是错觉。
> 某一轮思考吃满额度时，中转站回 `content: null`，SDK 的 `turnResolution` 便认为
> 「这一轮没结束」→ `next_step_run_again` → 空转 → `Max turns (N) exceeded` → **整段作废**。
>
> ### 修法（两层，已落库）
> 1. **提预算**（降低触发率）：`STAGE_SPEAK_MAX_TOKENS` 8192 → 16384，
>    `apps/plugins/local/novel.autowrite/server/pipeline/roles-phase.ts`
> 2. **加护栏**（消除"整段作废"这个脆弱点，关键）：宿主层识别「轮次耗尽且全程零正文」
>    → 以 2 倍预算 + 「请直接作答」提示重试一次。
>    `apps/server/src/plugin/host.ts` 的 `isStarvationFailure` / `retryBudgetOf` / `STARVATION_RETRY_HINT`
>
> ⚠️ **判定踩过的坑**（值得记住）：最初写成「零正文 **且** 零工具调用」，结果漏掉了真实的一类现场 ——
> **带工具的发言人**（设定管家）会先成功查一次库（`tool=true`），之后每轮都拿不到正文。
> 故障注入实测原文就是 `设定管家 → Max turns (6) exceeded`，当时代码把它当"工具循环"放行了。
> **判据只看「全程零正文」**：正常的工具流程最后一定会产出正文，不会误触发。
>
> ### 验证证据（故障注入：把预算压到 256，人为放大空转）
> 三次触发自救、**三次全部救回**：
> 设定管家（6 轮零正文，有工具调用）→ 457 字 ｜ 角色设计师（4 轮）→ 1410 字 ｜
> 定稿官（4 轮）→ **1711 字《角色与节奏宪章》**；cast 段正常停在 `awaiting_user`。
> 修复前这类现场是**整段作废**。
> 单测：`apps/server/src/__tests__/subagent-budget-recovery.test.ts`（17 例，纯函数、零模型成本）。
>
> ### 本文以下内容的现状
> - §3「下一步该做什么」**已全部执行完**，保留作历史对照。
> - §2.1「死在 cast 第 5 个发言人」属实（已复现），但**探针项目后来已经推进到 plot 全部批准**
>   （见 `data/projects/8375f0b9-*.db`：brief/cast/bible/plot 均 approved、stages.*.sinked=true），
>   本文写于 plot 批准之后 —— 这条状态已过期。
>   （该库 `characters: 0` 不是 bug：它的 brief 是 `111/1111` 占位符，定稿官照实产出"骨架版"，抽不出人名。）
> - §5.2 的 `turnsFor` 2→4 仍保留（能多产出真实发言），但现在它只是第二道防线，第一道是护栏。

---

> **这份文档是给下一个接手的人（或 AI）的。**
> 任务本身**没有完成** —— 流水线在第 2 阶段就断，我查到了直接原因并修了两处真 bug，
> 但**根本原因还没修**。本文把「已经确认的事实」和「下一步怎么查」写清楚，别重复劳动。
>
> 最后更新：2026-09-17 · 相关提交 `30f10ff`（已推送到 `origin/main`）

---

## 0. 一句话现状（⚠️ 历史快照 —— 已修复，见顶部横幅）

**写作流水线（`novel.autowrite` 的 pipeline）无法用当前配置的模型跑完。**
`brief` 阶段能过，`cast` 阶段跑到第 5 个发言人就被 `Max turns (4) exceeded` 打断。

**最可疑的根因**：配置的模型 `glm-5.3-flash` 会返回 **`content: null`**（只出 `reasoning_content`），
导致 `@openai/agents-core` 认为"没拿到最终输出"而继续循环，直到耗尽轮次预算。
→ **这个方向是对的，已坐实**（真因是"思考 token 计入 max_tokens 且某轮吃满"）。

---

## 1. 怎么复现（三步）

```bash
# ① 起服务（注意：别用 | tail，会被缓冲，出事了看不到日志）
cd F:/new1.2/apps/server && "D:/ruanjian/node.24/node.exe" ../../node_modules/tsx/dist/cli.mjs src/index.ts > /tmp/srv.log 2>&1 &

# ② 造环境（账号 + 带完整开书设定的项目）
#    开书设定是流水线的起点，缺了 start 会直接 400 NO_BRIEF
#    需要的字段：opening / worldview / style / protagonist / heroines[] / genre / genreCategory
#    写进主库：UPDATE projects SET brief=<JSON字符串>, genre='都市悬疑' WHERE id=<项目id>

# ③ 起流水线并逐阶段推进
POST /api/plugins/autowrite/pipeline/start      {note?}
POST /api/plugins/autowrite/pipeline/advance    {stage}      ← SSE
POST /api/plugins/autowrite/pipeline/decision   {stage, action:'approve'|'revise'|'reject', note?}
# 头部必须带：Cookie: novelmuse_token=<token>  +  X-Project-Id: <项目id>
```

阶段顺序：`brief → cast → bible → plot → drift → pilot → production(未实现)`
闸门（需 approve）：`cast / bible / plot / pilot`；`brief` 与 `drift` 无闸门。

---

## 2. 已确认的事实（别再重复验证）

### 2.1 实测结果

| `maxTurns` 设置 | 结果 |
|---|---|
| 2（原始值） | 死在**第 1 个**发言人「角色设计师」，**0 个 stage_turn** |
| 4（我改的值） | 死在**第 5 个**发言人，**4 个 stage_turn 成功产出** |

cast 一次要跑 21 分钟（推理模型慢）。事件统计：
```
stage_phase: 6    ← 启动了 6 个发言人
stage_turn:  4    ← 只有 4 个产出成功
stage_failed: Max turns (4) exceeded
```

**结论：改 `maxTurns` 只是把失败推迟，不能让它跑完。** 所以问题不在预算大小。

### 2.2 模型探测（这是我目前最强的线索）

用同一个 prompt 打中转站 `https://new-api.dadfafwada.dpdns.org/v1`，看返回形态：

| 模型 | `content` | `reasoning_content` | `finish_reason` |
|---|---|---|---|
| **`glm-5.3-flash`**（当前配置） | **`null`** | 489 字 | **`length`** |
| `glm-4.7` | `"好的"` | 460 字 | `stop` |
| `deepseek-v4-pro` | `"收到"` | **无** | `stop` |
| `agnes-2.5-flash` | `"收到"` | 97 字 | `stop` |
| `deepseek-flash` | `"收到"` | 39 字 | `stop` |

**`glm-5.3-flash` 是唯一返回 `content: null` 的**，而且我试了两次（`max_tokens` 100 和 800）
**两次都是 null + `finish_reason:length`** —— 它的思考把额度吃光，正文一个字都没出。

中转站全部可用模型（16 个）：
```
agnes-2.0-flash  agnes-2.5-flash  agnes-2.5-pro  agnes-2.5-pro-alpha
agnes-image-2.0-flash  agnes-image-2.1-flash  agnes-video-v2.0
deepseek-flash  deepseek-v4-flash  deepseek-v4-pro  deepseek-v4.1-flash
glm-4.7  glm-5.3-flash  hy3-preview-agent
kuku/gateway-deepseek-v4.1-flash-tencent  kuku/gateway-glm-5.3-flash
```

### 2.3 代码里已有的相关注释（说明作者知道这是推理模型）

`apps/server/src/plugin/host.ts` 第 279 行附近：
```
// ★ maxTokens 必须显式透传：不传时 SDK 不发送 max_tokens，由服务商默认值兜底；
//   推理模型（如 glm-5.3-flash）的思考 token 也计入该上限，默认值偏小时
//   模型会自行收短输出 —— 长文写作上表现为「总是写不到约定字数」。
```
→ 作者知道 `glm-5.3-flash` 是推理模型，也处理了 maxTokens。**但轮次（turn）这一面没处理。**

---

## 3. ★ 下一步该做什么（按优先级）

### 第一优先：对照实验（约 25 分钟，最能定性）

**把模型换成非推理的 `deepseek-v4-pro`（探测显示它 `reasoning_content` 为空、`content` 直接有值），
重跑同一个 cast 阶段。**

```sql
-- 改探针账号的模型（别改真实用户的）
UPDATE user_settings SET ai_provider_config = json_set(ai_provider_config, '$.model', 'deepseek-v4-pro')
WHERE user_id = '<探针账号id>';
```

- **若 cast 顺利跑完** → 坐实是「推理模型 + openai-agents 轮次计数」的兼容问题。
  接着按第三优先修。
- **若还是 `Max turns exceeded`** → 我的推断错了，问题在框架/prompt 层，
  回到第二优先查 SDK 内部。

⚠️ 重跑前记得把阶段状态重置（见 §4.2）。

### 第二优先：查 SDK 怎么判定「这一轮结束」

`node_modules/@openai/agents-core/dist/runner/` 下：

- `turnPreparation.js` —— `beginTurn()` 里 `state._currentTurn++`，
  每 **一次 `prepareTurn` 调用**算一轮；`_currentTurn > _maxTurns` 就抛
  `MaxTurnsExceededError`。
- 找 `runLoop` / `runSingleTurn` 那层，看**循环继续的条件是什么** ——
  重点怀疑：**当 `content` 为 null / 没有文本输出项时，框架是不是认为"这一轮没完"**。
- 也看一眼 `items.js`，确认 reasoning 输出项是否被当成"待处理的项"。

### 第三优先（若坐实是推理模型问题）：两个方向

1. **治标**：给推理模型单独放宽 `maxTurns`。**但我实测过——它可能无限循环，
   放宽只是延后失败**，所以别只做这个。
2. **治本**：在 provider 层把 `reasoning_content` 也映射成文本输出项，
   让框架认得"这轮有产出"。相关文件：`apps/server/src/ai/sdk/provider.ts`
   （文件头有注释说明它用 fetch 旁路截 `reasoning_content`）。

---

## 4. 干活需要的环境知识

### 4.1 命令（照抄，别自己拼）

| 场景 | 命令 |
|---|---|
| 任何 pnpm 命令 | `/d/ruanjian/node.24/pnpm.CMD`（**别用** `pnpm`，sh shim 在 Git Bash 下路径转换失败） |
| server 单测 | `cd apps/server && PATH="/d/ruanjian/node.24:$PATH" "/d/ruanjian/node.24/pnpm.CMD" exec vitest run` |
| 全仓类型检查 | `"/d/ruanjian/node.24/pnpm.CMD" -r type-check`（8 包，必须全绿） |
| **必须用 Node 24** | better-sqlite3 编译于 ABI 137；Node 22（127）会 `ERR_DLOPEN_FAILED` |

### 4.2 流水线状态存在哪、怎么看

**项目库的 `plugin_kv` 表**（`data/projects/<项目id>.db`），
`plugin_id='novel.autowrite'`, `key='pipeline'`。失败原因就在 `stages.<阶段>.error` 里。

```bash
"D:/ruanjian/node.24/node.exe" -e "
const D=require('better-sqlite3'); const fs=require('fs');
const db=new D('data/projects/<项目id>.db',{readonly:true});
const r=db.prepare(\"SELECT value FROM plugin_kv WHERE plugin_id='novel.autowrite' AND key='pipeline'\").get();
const st=JSON.parse(r.value);
console.log('当前阶段:', st.stage);
for(const k of ['brief','cast','bible','plot','drift','pilot']) console.log(' ',k, st.stages[k].status, st.stages[k].error||'');
db.close();"
```

**重置某个阶段**（让它可以重跑）：
```js
st.stages.cast = { status:'idle', revision:0 };   // 然后 UPDATE 回 plugin_kv
```

### 4.3 两个诊断手法（今天现学的，很省时间）

1. **服务端 stdout 千万别接 `| tail -N`** —— 会被缓冲，出事了什么都看不到。
   改成 `> /tmp/srv.log 2>&1`，随时 `grep`。
   （我就是靠这个才发现 `ReferenceError: getProjectDbSync is not defined` 被 try/catch 吞掉的）
2. **直接读 `plugin_kv` 比看 SSE 全** —— SSE 只有事件流，状态机在库里。

---

## 5. 今天已经修好并验证的（别动，别回退）

### 5.1 ✅ 重启后项目级 KV 读全废（提交 `30f10ff`）

```
KvService.get(id, key, {projectId})
  → getProjectDbSync(projectId)   // 同步，**只查缓存，不打开库**
      → 缓存未命中 → null
  → if (!db) return undefined      // **静默**返回，不抛错
```

server 一重启，项目库缓存是空的 → **所有项目级 KV 读全部读成「没有」**。
实测表现：`GET /pipeline` 回 `started:false`（数据其实在 `plugin_kv` 里），
`advance` 被判 `NOT_STARTED` —— 整条流水线状态"消失"。

`kv.set` 里是 `initProjectDb` 过的（`kv-service.ts` 有注释「否则写入静默丢失」），
`get` 这条路缺了同一手。

**修法**：`apps/server/src/plugin/host.ts` 里 `/api/plugins/*` 的中间件
（本来就读 `X-Project-Id` 做所有权校验）补 `await initProjectDb(projectId)`。
**通用修复**，所有插件的项目级 KV 读都受益。

**验证**：重启后立刻 `GET /pipeline` → `started:true` ✓（修前是 `false`）

⚠️ **注意**：`getProjectDbSync` 在 `host.ts` 里**另有使用**（约第 430 行）。
我一度误判它"未被使用"而删了 import → `ReferenceError` 被 `resolveSettingsDigest`
的 try/catch 吞掉 → 兜底 digest **不含 `brief` 字段** → 报「这本书还没有开书设定」
（**指向完全无关的地方**，我因此浪费了一轮）。

### 5.2 ⚠️ `turnsFor` 2 → 4（提交 `30f10ff`）

`apps/plugins/local/novel.autowrite/server/pipeline/orchestrator.ts`：
```ts
function turnsFor(role: DesignRole): number {
  return role.tools && role.tools.length > 0 ? 6 : 4;   // 原来无工具是 2
}
```

**它把失败从第 1 个发言人推迟到第 5 个 —— 不是修复，是缓解。**
保留它（能多产出 4 个真实发言），但**别以为问题解决了**。

### 5.3 🐛 附带发现（未修，建议顺手修）

`resolveSettingsDigest` 的**兜底 digest 缺 `brief` 字段**
（`apps/plugins/local/novel.autowrite/server/pipeline/orchestrator.ts` 约第 93 行的 catch）。
后果：**任何一次设定读取失败都会被报成「这本书还没有开书设定」**。
→ 兜底对象应该把 `brief: ''` 显式写上，或者在 catch 里把**原始错误**一起报出来。

---

## 6. 判定「修好了」的标准

不是 type-check 绿、不是单测过 —— **必须真机把 7 个阶段跑完**：

```
brief → cast → bible → plot → drift → pilot        （production 未实现，到 pilot 为止）
```

每过一个闸门要 `approve`（approve 才会把产出落库）。跑完验收：

```bash
# 项目库里应该多出东西
"D:/ruanjian/node.24/node.exe" -e "
const D=require('better-sqlite3');
const db=new D('data/projects/<项目id>.db',{readonly:true});
for(const t of ['characters','locations','items','chapters','outline_nodes','foreshadows'])
  console.log(t, db.prepare('select count(*) c from '+t).get().c);
db.close();"
```

`brief` 段不落库（它是基线）；`cast` 落角色；`bible` 落设定；`plot` 落大纲；
`drift` 是检查；`pilot` 落试写章。

---

## 7. 别忘的收尾纪律

- 探针账号/项目用完要删，**且要连项目库文件一起删**
  （`scripts/tools/clean-orphan-project-dbs.mjs`，但注意它**只认 UUID 命名的库文件**，
  单测产物如 `entity-sink-test-*.db` 它认不出来 —— 见该脚本 2026-09-17 的修订）
- 删账号时若涉及技能库，要连带 `DELETE FROM skill_library WHERE user_id IS NOT NULL`
- 停服务：`netstat -ano | grep :3774` 拿 PID → `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /T /F`
  （**`ps -W` 的 PID 不能喂 taskkill**）
- `git push` 前现测代理通不通（`curl --noproxy '*' https://github.com` vs
  `curl -x http://127.0.0.1:7897 https://github.com`），**哪条 200 用哪条** ——
  这台机器的代理健康度会波动，别靠记忆
