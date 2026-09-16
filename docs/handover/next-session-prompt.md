# 新会话任务：用 MCP 操控浏览器，把「空山雨后」写到第 30 章

> 把下面 `===` 之间的内容整段发给新会话即可（新会话看不到上一轮上下文，所以是自包含的）。

===

【任务】用 desktop-control MCP 工具（真鼠标键盘）操控浏览器，确认（必要时续跑）AI 写作项目「空山雨后」的第 3–30 章。

【背景 — 你没有上一轮上下文，这里是全部所需】

- 项目根：`F:\new1.2`（NovelMuse，AI 长篇小说创作工具，pnpm monorepo）
- **服务已在跑**：server `http://127.0.0.1:3774`（Node 24 启动）、vite `http://localhost:5173`
  （vite 只监听 IPv6，**必须用 localhost**，用 127.0.0.1 连不上）
- 测试账号：`probemty3qnbx` / `Probe1234!`（已配好 AI provider）
- 目标项目：书架里的「空山雨后」（`mode=auto`，id `c980335a-026a-413f-9717-fcc9a8f05e44`）
- 已完成：第 1 章 3382 字、第 2 章 3727 字。
  **上一轮已在界面上设「连写 28 章」并发出「写第3章…」**，若界面没断，此刻正在自动写 3–30 章。

【第一步：先查进度，不要急着动鼠标】

```bash
cd F:/new1.2 && "D:/ruanjian/node.24/node.exe" -e "
const D=require('better-sqlite3');
const d=new D('F:/new1.2/data/projects/c980335a-026a-413f-9717-fcc9a8f05e44.db',{readonly:true});
console.log('章节数:', d.prepare('select count(*) c from chapters').get().c);
for(const r of d.prepare('select \"order\" o, word_count w from chapters order by \"order\"').all()) console.log('  第'+r.o+'章 '+r.w+'字');
d.close();"
```

- 章节数在增长（>2 且持续增加）→ 界面连写在跑，**别重复发**，每隔几分钟查一次，跑完做验收。
- 停在 2 → 界面断了，按下面步骤在界面上重新触发。

【第二步：用 MCP 工具驱动界面】

工具前缀 `mcp__desktop-control__`：`focus_window` / `run_actions` / `screenshot` / `click` /
`type_text` / `press_key` / `hotkey` / `active_window` / `screen_size`。

**两条纪律（不遵守必踩坑）**：

1. **每次动作前先 `focus_window("NovelMuse")`** —— 你执行操作时宿主会抢到前台，
   不置前点击/输入会打在自己身上（上一轮把登录密码敲进了别的窗口）。
2. **优先用 `run_actions` 把一串动作一次下发**（换行分隔），不要逐个工具调用 ——
   调用之间的空档正是被抢焦点的时间窗。

中文一律用 `type_text`（走剪贴板，绕开输入法）。操作前后 `screenshot` 确认，别凭想象。

【界面坐标（1920x1080 整屏，窗口最大化后）】

| 元素 | 坐标 |
|---|---|
| 落地页「开始创作」 | 954, 723 |
| 登录 用户名框 | 954, 547 |
| 书架「+ 新建」 | 1552, 153 |
| 书卡「空山雨后」 | 455, 387 |
| 新建弹窗「AI 写作」 | 1074, 399 |
| 新建弹窗 书名框 | 954, 489 |
| 新建弹窗「创建」 | 1104, 812 |
| 工作台 输入框 | 134, 865 |
| 工作台「连写 N 章」数字框 | 225, 962 |

【登录序列（run_actions 可直接用）】

```
focus NovelMuse
wait 0.6
click 954 723
wait 3
click 954 547
wait 0.8
hotkey ctrl a
type_text probemty3qnbx
wait 0.5
press_key tab
wait 0.5
hotkey ctrl a
type_text Probe1234!
wait 0.5
press_key enter
wait 9
screenshot C:/temp/s1.png
```
（若页面直接是书架就不用点「开始创作」；工作台输入框有 autoFocus，进去直接打字即可。）

【触发 3–30 章连写】

```
focus NovelMuse
wait 0.6
click 455 387
wait 13
press_key tab
hotkey ctrl a
type_text 28
wait 1
screenshot C:/temp/s2.png
hotkey shift tab
type_text 写第3章：陈默决定主动查清姐姐失踪的真相，却发现三年前那通电话和他自己有关。
wait 1
press_key enter
```
⚠️ **连写数字框只需按 1 次 Tab**：输入框为空时发送按钮是 disabled、不可聚焦（按 2 次会跳过去）。
`wait 1` 后截图确认左下角显示「连写 28 章」，再往下走。

【关键坑】

1. 窗口位置会漂 → 坐标不对就先 `screenshot` 看一眼再调
2. Chrome 用**独立 profile** 启动最稳：`python scripts/desktop-control.py chrome http://localhost:5173/`——
   日常 profile 会反复弹「Chrome 未正常关闭 → 恢复页面」挡住页面，登录态还每轮丢
3. 首页可能停在落地页而非书架 → 登录序列里「开始创作」那步不能省
4. 界面连写中断不要紧：已交付的章不会被重写（有「已有正文不覆盖」保护），重发指令接着写
5. 完全不想用鼠标时，脚本也能续跑：
   `node scripts/run-chapters.mjs --user probemty3qnbx --project c980335a-026a-413f-9717-fcc9a8f05e44 --from <下一章> --count <剩余> --batch 5 --resume`

【验收】

跑完汇总：章节数（应到 30）、各章字数、实体累积（characters / items / locations / foreshadows /
story_events）、以及质检结果（意图门打回次数 / 校对门是否有冲突 / 润色分）。
脚本方式跑的明细在 `data/run-chapters-*.jsonl`。

===

## 备注

- MCP 工具**只在会话启动时快照**，所以「信任」后必须**新开会话**才看得到这些工具。
- 相关代码：`scripts/mcp-desktop-server.py`（MCP 形态）、`scripts/desktop-control.py`（CLI 形态，
  同一套底座，当次会话就能用）。
