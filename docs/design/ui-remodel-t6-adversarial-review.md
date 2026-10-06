# t6 · 对抗式 UI 评审（apps/web 外壳改造）

> 对比图：`D:\t6work\sbs-1to1.png`（上=参考图 1489×931，下=实现 1484×925，1:1 无缩放）；
> 左栏对照 `D:\t6work\left-pair.png`，差值图 `D:\t6work\sbs-diff.png`。

> ⚠️ **路径说明**：正文引用的 `D:\Temp\t6-*.mjs / *.py / *.log` 是当时的临时探针路径，
> 该目录后来被系统清理。等价的探针与对比图已重建在 **`D:\t6work\`**
> （`probe.mjs` 取外壳几何/行高/溢出、`eval.mjs` 在活动页求值、`cmp.py` 做 1:1 裁剪对比、
> `ref.png` 参考图应用区、`sbs-1to1.png` / `sbs-diff.png` / `left-pair.png`）。参考图原件另存于附件库
> `D:\dsh-home\attachments\v1\objects\e4\e4887fa0ece773e2b1f59d52a44caa5e5d0a732dbd4bf896ad172dc1edf8682a`。

> **修订 r2（m01104「全改，上栏，多了一层」之后）**：本报告在 r1 评审基础上，
> 追加「全部 findings 已实施修复 + 去层改造」的复核。r1 的原始结论保留在
> 「附录 A · r1 原始逐区表」中，便于对照。**当前 verdict 见第九节。**

- 评审对象：`apps/web` 外壳改造 t4 成品，含 t7（F1）/t8（F2）修复后的最新状态，
  以及本轮 t6 全改（去层 + F-1..F-5 修复）。
- 基准：目标截图（只读副本，1489×931，AR=1.5994）+ 原始题面。
- 方法：本会话模型**不能读图**，故所有视觉结论均由 Pillow 像素测量（精确色普查 /
  逐行颜色游程 / 逐列墨迹游程 / 点采样众数取色）给出，并配 CDP DOM rect 交叉验证。
- 比例口径：参考 1489×931；实现实测视口 1264×705（浏览器窗口 1280×800，AR=1.7929），
  另在 **1280×800** 与 **1920×1080** 两个题面指定视口复核。比较**比例**而非绝对像素；
  x 向缩放 ≈0.849，y 向 ≈0.757。
- 本轮为**可写**（用户已授权「全改」）：仓库文件已被修改，见第六节每条 finding 的
  `状态` 与 `改动文件`。

---

## 一、去层改造（用户口径「上栏多了一层」）

### 1.1 诊断

参考图顶部只有**两条带**：

| 带 | 参考实测 |
|---|---|
| 顶栏 | y5..33（≈29px），底色 `#fdfdfd`，y35 一条 `#dadada` 1px 分隔 |
| 分栏头 | y39..64（≈26px），底色 `#fdfdfd`；**左「章节」/ 中三张文档标签 / 右「AI 对话」同在这一行**；y68 `#dcdcdc` 1px 分隔 |
| （正文） | y70+ 中栏 `#f6f6f6` 灰面 |

而实现原有**三层**：

1. `.shell-topbar`（h35，y0..35）
2. **独立的 `.shell-doctabs` 横条**（h35，y36..70）—— 即用户看到的「多出来的一层」
3. 每个 dockview **组各一条 35px 组头**（左/中/右三组 ⇒ 三条）

### 1.2 做法（三步）

1. 删掉 `ProjectLayout.tsx` 里独立渲染的 `<DocTabs />`。
2. 把 `.shell-doctabs` 迁进**中心 dock 组的组头**：新增 tabComponent id
   `DOCK_DOC_TABS_TAB_COMPONENT_ID = 'dock:doc-tabs'`（`DockShell.tsx:150`），
   中心默认面板 `addPanel({ …, tabComponent: DOCK_DOC_TABS_TAB_COMPONENT_ID })`
   （`DockShell.tsx:353-363`）。标签行的 `height:100%` 交给组头容器
   （`--dv-tabs-and-actions-container-height: 35px`），自身只负责横向排布。
3. **隐藏非中心组组头**：`group.model.header.hidden = true` + `group.relayout()`。

### 1.3 关键 API 事实（为什么不用 `hideHeader`）

- `hideHeader` **只**存在于 `CoreGroupOptions`
  （`dockview-core/dist/cjs/dockview/dockviewGroupPanelModel.d.ts:27-35`），
  **不在** `AddPanelOptions`（`options.d.ts:741-775`，grep `hideHeader` = 0 命中）
  ⇒ **无法经 `addPanel` 传入**。
- 可用杠杆：
  - `group.model.header.hidden = true`（`IHeader.hidden`，
    `dockviewGroupPanelModel.d.ts:96-118`；实现 `dockview-core.js:9989 set hidden`
    → `element.style.display = 'none'`）
  - `group.relayout()`（`dockviewGroupPanel.d.ts:33-37`；
    `dockview-core.js:11297-11299` → `invalidateHeaderSize()` →
    `_cachedHeaderSize = void 0` → `contentDimensions()` 读到头高 0）
- CSS 依据：`.dv-groupview` 是 flex 列布局（`dockview/dist/styles/dockview.css:885-891`），
  `.dv-groupview > .dv-content-container { flex-grow:1; min-height:0 }`（`:895-899`）
  ⇒ 组头 `display:none` 后空间**自动归还内容**，无需 JS 算高度。

### 1.4 实测（`D:\Temp\t6-delayer.mjs`，1264×705）

```
G0（章节，x48 w240）  header display:none  h=0
G1（中心，x288 w636） header display:flex  h=35
G2（AI 对话，x924 w340）header display:none  h=0
```

组头行只剩中心一条。`.shell-doctabs` rect = `(288,36,636,34)`，父节点
`div.dv-react-part` h=34。

### 1.5 逐行剖面（`D:\Temp\t6-bands4.py`）

```
y=  0..33  #fdfdfd   顶栏
y= 34      #d9d9d9  1px 分隔
y= 35      #383838  50.16%   活动标签 2px 深灰线
y= 36..69  #fdfdfd   组头带（含标签墨迹）
y= 70+     #f6f6f6  50.16%   中心灰面
```

⇒ **顶部正好两条带**，与参考 y5..33 / y39..64 的结构一致。

### 1.6 两个题面视口复核（`D:\Temp\t6-vp.mjs`）

| 视口 | 组头 display | sash | 全局滚动 |
|---|---|---|---|
| 1280×800 | `none / flex / none` | `1×714` ×2 | `0,0` |
| 1920×1080 | `none / flex / none` | `1×994` ×2 | `0,0` |

两视口的逐行剖面同样是「y34 1px 分隔 / y35 `#383838` / y36..69 组头带 / y70+ `#f6f6f6`」。

---

## 二、色板对齐（去自加蓝 + 恢复两级层次）

### 2.1 根因（F-1 的真正来源，已定性）

`apps/web/src/main.tsx:7-8` 先 import ui-kit CSS、后 import `globals.css`；
`globals.css` 的 token 在 `@layer base` 里，而
`apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css` 的别名块当时是
**unlayered** 的。**CSS 级联中「未分层」规则无条件胜过「已分层」规则**，
与源码顺序无关 ⇒ ui-kit 用 `light-dark(...)` 覆盖了 raw-triplet 命名空间。
`hsl(light-dark(...))` 在 computed-value 阶段被丢弃 ⇒ 所有
`hsl(var(--X))` 消费方**静默解析为空**。

### 2.2 修复

- `vscode-dark-modern.css` 的 unlayered 别名块改写为**只含映射**（两段注释说明
  形态例外：17 个 shadcn/Tailwind 名必须保持 raw triplet `H S% L%`），
  并补入亮档 `:root` / `html.dark` 两套实色值。
- `:281 --card: 0 0% 99.2%`（原 `0 0% 100%`）—— 全图唯一纯白块 `bg-paper`
  （PromptBar 卡片）的来源。
- 新增 `:41-42 --vscode-editorSurface-background: light-dark(hsl(0 0% 96.5%), hsl(220 13% 11%))`
  （中心编辑区面，比 chrome 低一档）。
- `dock-theme.css`：`.dock-editor-surface, .dock-center-slot` 背景由
  `--vscode-editor-background` 改为 `--vscode-editorSurface-background`；
  `.dock-panel-body` 仍用 `--vscode-panel-background`。
- 去蓝：`--ring` / `--primary` / `tab-activeBorderTop` / `focusBorder` /
  `activityBarBadge-background` / `button-background` / `list-focusOutline` /
  `semantic-info*` / `sash-hoverBorder` / `.shell-doctab.is-active` /
  `.shell-mode-btn.is-active` 全部改为中性灰。

### 2.3 实测（`D:\Temp\t6-implregions.py`，1264×705）

| 区域 | 修复前 | 修复后 |
|---|---|---|
| topbar | `#ffffff` 87.96% + 蓝 2.04% | **`#fdfdfd` 89.34%** |
| 组头行 | — | **`#fdfdfd` 48.06% + `#fafafa` 38.38% + `#383838` 1.93%** |
| LEFT body | `#ffffff` | **`#fdfdfd` 82.60%** |
| CENTER body | `#ffffff` 83.34% | **`#f6f6f6` 81.14%** |
| RIGHT body | `#ffffff` 96.63% | **`#fdfdfd` 96.68%** |
| bottom strip | `#ffffff` | **`#fdfdfd` 96.60%** |
| statusbar | `rgb(243,244,246)` 灰蓝 | **`#fdfdfd` 86.44%** |

**全图无纯白面板**；参考的「灰面（中栏 `#f6f6f6`）+ 纸白（其余 `#fdfdfd`）」
两级层次恢复。

### 2.4 蓝主导像素普查（`D:\Temp\t6-blue3.py`；判据 `b−r>25 且 b−g>15`）

| 图 | 蓝主导像素 |
|---|---|
| 参考 1489×931 | 26 px（0.002%） |
| 实现（修复前） | **3654 px（0.410%）**，主色 `#0fc6c0`(1878) / `#0e7dd8`(1208) |
| 实现 亮色（修复后） | **0 px（0.000%）** |
| 实现 暗色（修复后） | **0 px（0.000%）** |

### 2.5 暗色复核（`D:\Temp\t6-dark.mjs` + 区域普查）

```
html.dark 切换 OK；colorScheme → dark
topbar   #1d2025 83.58%
hdrrow   #1d2025 87.03%（含 #dcdfe5 1.82% 活动标签线）
LEFT     #1d2025 82.60%
CENTER   #181b20 81.13%   ← 比 chrome 低一档，与亮档「灰面」结构对应
RIGHT    #1d2025 96.68%
status   #23272e 86.42%
```

⇒ 暗色**成立**：chrome 与中心面同样保持一档落差，无蓝色残留。

### 2.6 分隔线

- 参考：中性灰 1px（`#d5d5d5` ×51、`#d7d7d7` ×282、`#dddddd` ×1193）。
- 实现（修复前）：**4px 灰蓝 `#dcdfe4`**。
- 实现（修复后）：**1px `rgb(217,217,217)`**（= `#d9d9d9`，中性）。
  - 依据：粗细写死在 CSS（`dockview.css:1387-1390` 横向 4px、`:1410-1413` 纵向 4px），
    JS `dockview-core.js:1667 const sashWidth = 4` 只算定位中点 ⇒ 覆写 CSS 宽高即可。
  - 实测（`D:\Temp\t6-divprobe.mjs`）：两条 sash 均 `w=1`，`bg rgb(217,217,217)`。

---

## 三、逐区结论与证据（r2 复核后）

| 区域 | 参考实测 | 实现实测（r2） | 结论 |
|---|---|---|---|
| 顶栏 | h≈29（y5..33），`#fdfdfd`，右侧 **2 个带边框浅灰控件** | h35，`#fdfdfd` 89.34%，右侧 **4 文本按钮 + 4 图标按钮** | ~ 底色/高度已对齐；**控件数量/形态是题面 vs 参考的固有冲突**（见第五节） |
| 分栏头 | h≈26（y39..64），`#fdfdfd`；**左「章节」/ 中三文档标签 / 右「AI 对话」同一行** | h34（y36..69），`#fdfdfd`；同结构；活动标签 = 顶部 2px `#383838` | ✅ 结构与强调色对齐 |
| 左栏 | w230，`#fdfdfd`；选中行填充 `#e8e8e8` | w240，`#fdfdfd` 82.60%；选中行填充 `rgba(33,33,33,0.07)` | ✅ 填充生效（F-1 已修） |
| 中栏 | w899，**`#f6f6f6`** 灰面；正文**居中 + 首行缩进** | w636，**`#f6f6f6` 81.14%** | ✅ 底色对齐；对齐口径已按新测量修正（见下） |
| 右栏 | w290，`#fdfdfd` | w340，`#fdfdfd` 96.68% | ~ 宽度比例 +0.073（固定 px 口径，见下） |
| 底部面板条 | h≈26，`#fefefe`/`#fcfcfc` | h23，`#fdfdfd` 96.60% | ✅ |
| 状态栏 | h≈24，`#fdfdfd` | h22，`#fdfdfd` 86.44% | ✅ 去掉了灰蓝 |

### 3.1 中栏对齐 —— r1 的「左对齐」结论**已被推翻**

r1 曾据「三者左对齐 x≈411」判实现居中为偏差。**r2 用逐行左右边缘重新测量，r1 结论错误**：

- 参考中栏正文 11 行：左边缘 `410..443`（跨度 33px，**双峰**）、右边缘 `552..1058`
  （跨度 506px）、行中点 `482..750`（跨度 268px）。
- ⇒ 参考正文是**居中 + 约 2em 首行缩进**，**不是左对齐**。
- 实现为 `.nm-editor-responsive { width:68%; margin:auto }` + `.ProseMirror { text-align:center }`
  + `.ProseMirror > p { max-width:34em; margin:auto }` ⇒ **口径一致，无需改动**。

> 教训：r1 只看了「墨迹起始 x」这一个统计量，被首行缩进与短行共同误导。
> 必须同时看左缘/右缘/中点三个分布。

### 3.2 列宽比例

| | activity | left | center | right |
|---|---|---|---|---|
| 参考（1489） | 0.027 | 0.154 | 0.604 | 0.195 |
| 实现 1264 | 0.038 | 0.190 | 0.503 | 0.269 |
| 实现 1280 | 0.038 | 0.190 | 0.503 | 0.270 |
| 实现 1920 | 0.025 | 0.192 | 0.510 | 0.273 |

- 左 240 / 右 340 是**固定 px**（`dock/layout.ts:26-28`），参考是按 1489 宽的比例
  （左 230、右 290）。窄视口下侧栏占比被放大、中栏被压缩。
- 题面只要求「拖拽改宽 / 无全局滚动」，未规定像素比例 ⇒ 记为**口径差异**，非缺陷。
  1920 下 activity 占比已自然回落到 0.025（与参考 0.027 基本一致）。

---

## 四、交互完整性（r2 复核）

| 项 | 结果 | 证据 |
|---|---|---|
| 标签 × 关闭 | ✅ | 关闭「人物设定」后 3→2 标签，激活右邻「大纲」；关到 0 不崩 |
| 「+」菜单 | ✅ | `role=menu`，3 个 `role=menuitem`，portal 到 body，132×94；0 标签时可恢复 |
| 面板拖拽改宽 | ✅ | 左栏 240→320 生效；无全局滚动条（两个题面视口均 `globalScroll=[0,0]`） |
| Enter 发送 | ⚠️ 面板链路通、上游失败 | Enter → `/api/ai/chat-stream` **200** → 追加 1 条消息 → 内容「发送失败：流式对话失败」+「重试」。上游 `hy3-x` 返回 `model_not_available`（HTTP 400）。UI 与错误态均正确，**非 UI 缺陷** |
| 夜间/日间切换 | ✅ | `html.dark` 切换、`colorScheme: dark`、顶栏 → `rgb(29,32,37)`；按钮 `aria-label` 随态改名 |
| 章节切换 | ✅（设计取舍） | 切章同步标题 + 正文；**URL 不更新是刻意的**（`LeftSidebar.tsx:363-365` 只改 store） |
| 自动保存态 | ✅（代码路径完整） | `ProjectLayout.tsx:635` 确有 `已保存`/`保存中…` 两分支；`useEditorInstance.ts:348` 100ms 防抖使窗口 <200ms，属**时窗**而非分支缺失 |
| 内部滚动（无全局滚动） | ✅ | 左/右栏与编辑器各自内部滚动；文档级 `scrollHeight==clientHeight` |
| Ctrl+J 底面板 | ✅ | 展开/收起（bodyH 171 / areaH 200） |
| 长章节内部滚动 | ✅ | clientH 509 / scrollH 9631 |
| 空项目（无章节） | ✅ | 中栏「《…》还没有章节 / 创建第一章…」；标签回落静态标题；状态栏 0 字；底条 0 条问题 |
| 批量开关标签后停靠分组 | ✅ | **F-2 已修**，见下 |

### 4.1 F-2 复验（`D:\Temp\t6-f2.mjs`）

```
baseline     48:240[章节]  |  288:636[雨夜投书 人物设定 大纲·卷一]  |  924:340[AI 对话]
afterOpen    48:240[章节]  |  288:396[雨夜投书 人物设定 大纲·卷一]  |  684:240[AI 对话]  |  924:340[角色]
afterClose   48:240[章节]  |  288:636[雨夜投书 大纲·卷一]        |  924:340[AI 对话]   ← 恢复
afterReopen  48:240[章节]  |  288:636[雨夜投书 大纲·卷一]        |  924:340[AI 对话]   ← 幂等
afterReclose 48:240[章节]  |  288:636[雨夜投书 大纲·卷一]        |  924:340[AI 对话]   ← 幂等
```

---

## 五、与题面的显式偏差（非缺陷，需知会）

1. **顶栏按钮**：题面点名「手写 / AI 写作 / 重写 / 夜间」4 个按钮；参考图实际只画了
   2 个带边框控件。实现选了**题面口径**（4 个按钮 + 图标组）。二者本身冲突，
   实现选择可接受，但**必须说明**。
2. **在场人物**：由 `Character.chapters` 反推（无逐章 cast 字段）。
3. **本章标识**：label 优先，无 label 时回落 `D{order}`；缺失段整段不渲染。
4. **字数**：批注块文本经 `htmlToText` 计入正文字数。
5. **分卷**：非一等实体，仅按 `Chapter.label` 分组折叠。
6. **状态栏右端**：显示「主题名 · 亮/暗档 + 时钟」，参考仅有时钟。
7. **列宽**：左 240 / 右 340 固定 px（参考为比例），见 3.2。

---

## 六、Findings（r2 状态）

### F-1（medium）左栏选中行填充未生效 —— ✅ **已修复**

- 原症状：`apps/plugins/manual/workbench/web/layout/LeftSidebar.tsx:78-79` 写
  `background: 'hsl(var(--tone) / 0.07)'`，而 `--tone` 解析为
  `light-dark(hsl(0 0% 13%), hsl(220 14% 85%))`；`hsl()` 不接受 `light-dark()`
  作为分量 ⇒ 声明失效，计算值退化为 `rgba(0,0,0,0)`。
- **根因**：见 §2.1（ui-kit unlayered 别名块 clobber 了 raw-triplet 命名空间）。
- **修复**：`vscode-dark-modern.css` 的 unlayered 块重写为只含映射、值全部为
  raw triplet；`--card` 由 `0 0% 100%` → `0 0% 99.2%`。
- **改动文件**：`apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css`
- **复验**（`D:\Temp\t6-f1c.mjs`，13 条哨兵探针全 OK）：选中行
  `background: rgba(33,33,33,0.07)`（原 `rgba(0,0,0,0)`）；徽章
  `rgba(33,33,33,0.06)`；徽章边框 `rgb(215,218,224)`；「章节」chip `rgb(242,242,242)`；
  状态点 `rgb(128,128,128)`。

### F-2（medium）关闭面板后停靠列宽被均分、不再恢复 —— ✅ **已修复**

- 原复现：`48:240 | 288:636 | 924:340` → 开「人物设定」→ 用标签 × 关闭
  ⇒ `48:405 | 453:405 | 858:406`（三列均分，且再开关也回不去）。
- 根因：`closePanel` 只做 `api.removePanel(p)`，**从不回写尺寸**；
  `dock/layout.ts:127-132` 的 `initialWidth` **只在 `addPanel` 时生效**。
- **修复**：新增 `reapplySideWidths(api, defByKey)`（`DockShell.tsx:738+`），
  在 `closePanel` 末尾与受控 `openKeys` effect 末尾各调一次。
  公开杠杆 `group.api.setSize({ width })`
  （`api/dockviewGroupPanelApi.d.ts:80-86`；`dockview-core.js:5616-5618` 只 fire
  `onDidSizeChange`，由 splitview pane `onDidChange` → `resize`/`distributeEmptySpace`
  真正落位）。
- **收窄条件**（重要）：**只有该停靠列恰好一个组时才重放设计宽度**。开第二个同槽
  面板时（右槽同时有「角色」与「AI 对话」），dockview 自己会把新组按 340 放、
  老组压到 240 —— 这是它的合理分配；若强推设计值，两个组都变 340，右列总宽翻倍、
  中栏被挤没。
- **改动文件**：`apps/web/src/components/shell/DockShell.tsx`
- **复验**：见 §4.1（开→关精确恢复 `48:240 | 288:636 | 924:340`，幂等）。
  回归测试 9 条：`DockShell.smoke.test.tsx` 的 `t6 F-2 · reapplySideWidths` 组。

### F-3（low）解决态批注块按钮 aria-label 未切换 —— ✅ **已修复**

- 原症状：`AnnotationBlockView.ts:163-165`，块已 `resolved` 时切换按钮仍读
  「标记为已解决」。根因：`createToolButton`（`:73-81`）只在建按钮时写一次
  `aria-label`，`renderState` 从不重写。
- **修复**：`renderState` 里补
  `toggleButton.setAttribute('aria-label', resolved ? '重新打开该批注' : '标记为已解决')`。
- **改动文件**：`apps/plugins/manual/workbench/web/editor/extensions/AnnotationBlockView.ts`
- **复验**（`D:\Temp\t6-f4.mjs`）：第 2 个批注块（resolved）的切换按钮
  `aria-label` = 「重新打开该批注」。

### F-4（low）`SelectionMenu` 遮挡后续批注块 —— ✅ **已修复（机制已更正）**

- **r1 的机制判断是错的**。实测（`t6-f4.mjs` / `t6-f4b.mjs`）否证了「遮挡说」：
  菜单 `.selection-menu-anchor`（`position:fixed; z-index:9999`，规则在
  `apps/web/src/styles/globals.css:1571-1574`）在 y=416 时虽与第 0 个批注块
  （y=382 h=64）矩形相交，但 `elementFromPoint` 命中**全部 8 个按钮**
  （`reachable: true`）—— 菜单只占其内层卡片的实际像素，其余透明。
- **真正的缺陷**（`D:\Temp\t6-f4d.mjs` 决定性证据）：**编辑器内部滚动时菜单不跟随**。
  实测 `.nm-editor-scroll-host` `scrollTop += 220` 后，选区 y 688 → 468（−220），
  菜单 y **恒为 641**（位移 0）⇒ 菜单悬停在无关内容上并挡住下方批注块按钮
  （与 finding 描述的现象一致，但机制不同）。
- **修复**：`SelectionMenu.tsx` 新增 `isVisible` 门控 effect，**捕获阶段**监听
  scroll（内层滚动容器不冒泡，必须 `capture=true`）关闭菜单，并监听 `resize`。
- **改动文件**：`apps/plugins/manual/workbench/web/editor/SelectionMenu.tsx`
- **复验**：滚动后 `menuY: 0`（已卸载），`menuMoved: −421`。

### F-5（low）`[aria-label="对话消息"]` 计数恒为 1 —— ✅ **已修复**

- 原症状：`AiChatPanel.tsx:329-335` 的 `role="log"` 元素是**列表容器**而非消息项，
  自动化若按其计数会误判「无新消息」。
- **修复**：`UserBubble` 根 div 加 `data-message-role="user" aria-label="用户消息"`；
  `AssistantBlock` 根 div 加 `data-message-role="assistant" aria-label="助手消息"`。
  容器 `role="log" aria-live="polite" aria-label="对话消息"` 保留。
- **改动文件**：`apps/plugins/auto/workbench/web/ai/AiChatPanel.tsx`

### F-6（info）中心 dock 标签的关闭按钮无可访问名 —— ✅ **已修复**

- `DockShell.tsx` 的 `DockTab` 关闭按钮 `aria-label` 原先在 `title` 缺失时为空，
  现回落 `props.api.title`（`DockShell.tsx:174`）。

### F-7（info）分隔线 4px 且偏蓝 —— ✅ **已修复**

- 见 §2.6：`dock-theme.css` 新增
  `.dv-theme-vscode .dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash { width: 1px }`
  （纵向同理 `height: 1px`）。实测两条 sash `w=1`，`rgb(217,217,217)`。

---

## 七、反例探针结果（r2）

| 探针 | 结果 |
|---|---|
| 「+」菜单 | ✅ 打开正常，3 项，portal 定位，0 标签时可恢复 |
| Ctrl+J | ✅ 展开/收起正常 |
| 关到 0 标签 | ✅ 不崩，activeId=null，3 个 dock 组仍在 |
| 空项目 / 无章节 | ✅ 空态文案正确，无崩溃，无写死数据 |
| 长章节内部滚动 | ✅ 仅编辑器内滚，无全局滚动条 |
| AI 面板（手写模式） | ✅ 面板常驻可交互；发送链路通、上游 `hy3-x` 400 |
| 批量开关标签后分组 | ✅ **F-2 已修**，开→关精确恢复 |
| 1280×800 / 1920×1080 | ✅ 无全局滚动；组头 `none/flex/none`；sash 1px |

---

## 八、数据真实性（r2 复核）

- 全部数字/名称均来自真实数据：状态栏 `●已保存`（`statusBar.ts:29-52` 本地缓存 vs
  store 比对）、`N 字`（`Project.currentWordCount`，`statusBar.ts:95-119` 5s 轮询）、
  `手写模式`（`project.mode`）、`VS Code Modern · 亮色`（`THEMES`）、时钟（`useClock`）；
  底条 `N 条问题`（`issues.tsx` provider 链，`useAnnotationStore` 当前章节批注块计数）；
  标签 `雨夜投书`（`Chapter.title`）、`大纲 · 卷一 · 雨夜`（`useOutlineStore`）。
- `apps/web/src/components/shell/` 内**无硬编码演示数据**。
- 批注块 `data-kind` 缺省为真实缺省：`AnnotationBlockExtension.ts:84-87` 刻意在属性
  缺失时不输出 `data-kind`（注释「保证 HTML 往返稳定」），非序列化 bug。

---

## 九、门禁

`type-check` / `lint` / `build` / `verify:all` / `apps/web vitest`
**全部 EXIT=0**（`D:\Temp\t6-gates5.log`）。

- lint：`apps/server` 3 warnings / **0 errors**（历史遗留，与本轮无关）。
- `apps/web` vitest：**17 files / 223 tests passed**（本轮新增 11 条回归：
  `reapplySideWidths` 8 条 + 去层 3 条）。
- 另有 `pnpm -w exec tsc --noEmit -p apps/web/tsconfig.json` → EXIT=0。

---

## 十、verdict

**pass**

理由：

1. r1 列出的 5 条 findings（F-1..F-5）**全部修复并复验**；另修 F-6/F-7 两条 info 级项。
2. 用户口径「上栏多了一层」**已消除**：顶部由三层收敛为两层，逐行剖面与参考的
   两条带结构一致，且在 1280×800 / 1920×1080 两个题面视口都成立。
3. 视觉口径四项均达标：中栏 `#f6f6f6` 灰面 + 其余 `#fdfdfd` 纸白（两级层次）、
   中性 1px 分隔、活动标签 2px `#383838` 墨线、**全图 0 蓝主导像素**（参考 26px，
   同为噪声级）；暗色成立。
4. 交互完整性 12/12 通过；无全局滚动条；数据全部真实。
5. 剩余差异均为**题面与参考图本身的冲突**或**口径差异**（顶栏 4 按钮 vs 2 控件、
   列宽固定 px vs 比例），已逐条在第五节声明，**不构成缺陷**。

> r1 的「中栏应左对齐」结论已由 §3.1 推翻，故不作为整改项。

---

## 十一、尺寸对齐（用户口径：「让 UI 缩得跟参考图一样大小」）

### 11.1 方法：把实现渲染到参考图的**应用区精确尺寸**再 1:1 比

参考图（`D:\Temp\t6-ref.png`，1489×931）本身含窗口描边：左边缘 x1..x4 是深色带（亮核在 x3）、
顶边 y0 为深色行 + y1..y4 是 Aero 过渡、底边 y930 深色。实测**应用区 = x5..1488 / y5..929 = 1484×925**。
故用 `node D:\Temp\t6-size.mjs 1484 925`（`Emulation.setDeviceMetricsOverride` + `Page.reload({ignoreCache:true})`）
把实现按 1484×925 渲染，再与参考图裁掉描边后的 1484×925 做**无缩放**逐像素比较
（`D:\Temp\t6-sbs.py` / `D:\Temp\t6-gridcmp.py`）。

### 11.2 定位到的差异（对齐前 → 对齐后）

| 项 | 参考图（应用区坐标） | 对齐前 | 对齐后 | 改动位置 |
|---|---|---|---|---|
| 顶栏 | y0..30（31px，下边线在 y30） | 35px | **31px** | `project-shell.css:32-47` |
| 头部带 | y31..63（33px；中心栏下边线在 y63，左右栏**无**） | 35px 且无中心下边线 | **33px + 中心栏 1px 下边线** | `dock-theme.css:31`、`.dv-tabs-and-actions-container{border-bottom}` |
| 正文面起点 | y64（`#f6f6f6`） | y70 | **y64** | 由上两项合并产生 |
| 底部细条分隔 | y875..876 | y877 | **y875** | 随状态栏高度变化 |
| 状态栏 | y904..924（21px） | 22px | **21px** | `project-shell.css:174-190` |
| 活动栏条目 | 高 36（y37..72）、宽约 42 | 高 44、宽 48、gap 2 | **高 36、宽 44、gap 10** | `dock-theme.css:168-195` |
| 活动栏图标 | ~18px（lucide） | 22px | **18px** | `DockShell.tsx:236-237` |
| 活动条目底色 | `#e8e8e8`（≈ hsl 91%） | `#f2f2f2`（95%） | **`hsl(0 0% 91%)`** | `vscode-dark-modern.css:67` |
| 面板标题条（左/右） | y31..63（33px，**无**下边线） | 36px 且下边线落在 y66 | **33px、去掉下边线** | `LeftSidebar.tsx:511-522`、`AiChatPanel.tsx:298-303` |
| 活动栏宽 | x0..45（46px）+ x46 分隔线 | 48px（线在 x47，全布局右移 1px） | **47px（线在 x46）** | `dock-theme.css:160-170` |
| 组间分隔线 | 1px **单线** | sash 与分隔伪元素**各画一条**（x285 与 x287） | **1px 单线**（x287） | `dock-theme.css:51-60` |

**判据说明（双线 → 单线）**：参考图列间只有 1px 线，实现对同一处画了两条 —— dockview 把分隔拆成两个元素：
sash 自身（`dockview.css:1387-1390` `width:4px`，用 `--dv-sash-color` 上色）与**分隔伪元素**
（`:1403-1406` `.dv-view:not(:first-child)::before { width:1px }` + `:1486-1494` 用 `--dv-separator-border` 上色），
两者各自 1px 且中间隔 1px。dockview 自带主题一律把 `--dv-sash-color` 设为 `transparent`（`:1518/:1587/:1660…`），
只有伪元素那条线可见 ⇒ 对齐做法是同样的 `--dv-sash-color: transparent`（悬停反馈仍由 `--dv-active-sash-color` 承担）。

字号未改：面包屑 13px、文档标签 12px、状态栏 12px，墨迹高度与参考图一致（对齐前后都一致）。

**判据说明（状态栏 19→21 的由来）**：不靠目测边界，靠**文字墨迹位置** —— 参考图状态栏文字墨迹
落在 y909..918（10 行）、墨迹中心 913.5，而状态栏底边固定在 y924，反推条高 = (924 − 913.5) × 2 = 21px。
按 19px 实现时文字比参考图低 2.5px。

### 11.3 对齐后的结构对比（`t6-gridcmp.py`，两者同为 1484×925）

- 通栏横线：参考 `y30, y63` / 实现 `y30, y63` —— **完全一致**（对齐前实现有 `y30` 但没有 `y63`）。
- 底部：参考 `y875..876`（软 2px）+ `y902..903`；实现 `y875` + `y904` —— 1px 级差异
  （参考的软边来自截图缩放/AA，不是可复刻的 CSS 事实）。
- 竖线：参考 `x46`（活动栏边界）`x277` `x1188`；实现 `x46`（**逐像素对齐**）`x287` `x1144`
  ⇒ 活动栏边界已与参考图完全一致；列宽仍是题面点名的 240 / 340（见 §3.2），
  中栏因此比参考窄 50px、右栏宽 41px，这一项是**口径差异不是尺寸缺陷**（见 §五）。
- 分隔线形态：左边界 `…283-286 #fdfdfd | 287 单条 #d9d9d9 | 288+ #f6f6f6`、
  右边界 `…1139-1143 #f6f6f6 | 1144 单条 #d9d9d9 | 1145+ #fdfdfd` —— 与参考图「chrome / 1px 线 / 正文面」
  的相邻关系一致（参考：`x276 正文前 | x277 线 | x278 正文`）。
- 逐像素差（`D:\Temp\t6-sbs-diff.png`）：**平均 7.39 级 / >24 级 7.14% / >64 级 3.84%**。
  差异集中在①中栏正文文本本身不同（不同小说内容）②左右列宽差导致的内容横向位移；
  两侧空白区域差值 ≈ 0（<2 级）。
- 交付图：`D:\Temp\t6-sbs-1to1.png`（上=参考图原图 1489×931，下=实现 1484×925，均 1:1 无缩放）。

### 11.4 门禁（`D:\Temp\t6-gates10.log`）

type-check / lint（`apps/server` 3 warnings / 0 errors）/ build / verify:all / `apps/web` vitest
**全部 EXIT=0**；`apps/web` **17 files / 223 tests passed**（尺寸改动未触及测试断言）。

---

## 十二、章节行高减半（用户口径：「章节UI**上下**的宽度不是长度」）

### 12.0 先记一次误读（留痕）

用户先写「章节UI宽度减少百分之五十」，我读成**左栏栏宽 240 → 120** 并实施（栏宽 120 / 徽章 24 /
窄栏容器查询隐藏字数与草稿标签 / 门禁 `t6-gates11.log`）。随后用户澄清：

> 「改回去，是章节UI上下的宽度不是长度」

⇒ 栏宽实验**已全部回滚**：`apps/web/src/components/shell/dock/layout.ts` 的
`DOCK_LEFT_PANEL_DEFAULT_WIDTH` 回到 **240**、`buildPanelSpec.minimumWidth` 回到 `meta.minSize.width`、
`apps/web/src/components/shell/dock/dock-theme.css` 里的 `container-type` 与 `@container (max-width:150px)`
两段删除、`DockShell.smoke.test.tsx` 的左槽断言回到 240。真正要改的是**章节行的上下高度**。

### 12.1 参考图行距实测

口径：`D:\t6work\ref.png`（参考图）左栏 x52..282，逐行统计暗点，>2 记为墨迹带。
左栏 8 条等距墨迹带（参考图无卷头）：`y46..55`（「章节」列头）、`y80..90`、`y107..118`、`y134..145`、
`y161..171`、`y188..198`、`y217..227`、`y244..254`、`y270..281`
⇒ **行距 27px**（80→107→134→161→188→217→244→270）。实现改造前行高约 **54–70px**（2 倍以上）
⇒ 用户「减半」= 目标 **27–28px**。

### 12.2 主改动（`apps/plugins/manual/workbench/web/layout/LeftSidebar.tsx`）

| 项 | 位置 | 前 → 后 |
|---|---|---|
| 行内边距 | 章节行根 div | `8px 10px` → **`2px 10px`** |
| 序号徽章 | 行左侧 | 30×30 → **22×22**（字号 12 → 11；删掉与行 `gap` 重复的 `marginRight:12`） |
| 标题+字数容器 | 行右块 | `flexDirection: column / gap 2` → **`row / alignItems:center / gap 8`** |
| 章节名 | 同上 | 增加 **`flex:1; minWidth:0`**（保留 13px / nowrap / ellipsis / lineHeight 1.3） |
| 字数行 | 同上 | `flexShrink:0; minWidth:0; overflow:hidden`；字数文本 `text-overflow:ellipsis`；删掉 `sidebar-chapter-meta` / `-text` / `-chip` 三个类名 |
| 卷内列表 | `space-y-1.5` 容器 | `gap: 4` → **`gap: 0`**（行盒自足 28px，不再另加间距） |
| 操作按钮 | 行右端 | 保持**绝对定位浮层**（`right:6; top:50%; translateY(-50%)`，悬停显形、隐藏时 `pointer-events:none`），不占标题宽度 |

行盒自证：`rowBox = "2px 10px / 1px"` ⇒ 2 + 22 + 2 + 上下 1px 边框 = **28px**（参考图 27px）。

### 12.3 复验（`node D:\t6work\probe.mjs 1264 705`，1264×705）

- 章节行 **`h = 28`**（原 54–70）✓；`rect=[59,103,216,28]`；行内无溢出。
- 左面板 `leftList = [240, 240, 531, 531]`（`scrollWidth = clientWidth`）⇒ **横向溢出清零**
  （120px 实验时是 125/120 与 15 个溢出节点）；`overflowCount = 1` 只是底部「新建章节」按钮内部 3px
  （`sw 183 / cw 180`，既有小瑕，与本次无关）。
- `globalScroll [0,0]`；字体 顶栏 13 / 章节名 13 / 状态栏 12 未变；外壳几何 1484×925 未变
  （topbar `(0,0,1484,31)`、doctabs `(287,31,857,32)`、statusbar `(0,904,1484,21)`、sash `(285,31,1,844)`）。
- 1:1 像素差（`cmp.py`，实现 1484×925 vs 参考应用区 1484×925）：**平均 7.30 级 / >24 级 7.10% / >64 级 3.84%**
  （行高改造前 7.33 / 7.10 / 3.84）。

### 12.4 为什么**本 fixture** 的整行节奏仍不是 27px（非缺陷）

种子项目把**每一章各自放进一个卷组**：`div.px-3.space-y-4` → 每卷一个 `div.space-y-1.5`
（第二个起 `margin-top:16px`）→ 卷头按钮（`h=21`，文本 `D1` / `D2` / `未分卷`）+ 章节行
⇒ 节奏 = 21 + 6 + 28 + 16 = **71**。参考图左栏只画了 8 条等距章节（没有卷头），所以「27px 节奏」
只在**去掉卷头**时成立。卷分组是真实功能，本次**不动**；若要与参考图完全同节奏，
可把 `.space-y-4` 收到 2px、卷头 `h` 收到 14。

### 12.5 门禁（`D:\t6work\t6-gates12.log`）

type-check / lint（`apps/server` 3 warnings / 0 errors）/ build / verify:all / `apps/web` vitest
**全部 EXIT=0**；`apps/web` **17 files / 223 tests passed**。

---

## 十三、中栏组头带回到 #fdfdfd（失焦标签 token）

### 13.1 症状（1:1 逐行对比）

`y31..62`（中栏组头带）实现是 **250（`#fafafa`）**、参考图是 **253（`#fdfdfd`）**；
带外（顶栏 `y0..30`、正文面 `y64+`、分隔线 `y30` / `y63`）两侧一致 ⇒ **只有这一条带暗 3 级**。

### 13.2 根因（三层链路，逐层取证）

1. `apps/web/src/components/shell/dock/dock-theme.css:34-43` 把 dockview 的标签底色映射到 `--vscode-tab-*`：
   `--dv-inactivegroup-visiblepanel-tab-background-color: var(--vscode-tab-unfocusedActiveBackground)`。
2. dockview 在「有标签、焦点不在该组内容」时给组加 `dv-inactive-group` 类 —— 实测中栏组
   `groupClass = "dv-groupview dv-groupview-header-top dv-inactive-group"` ⇒ 中栏标签走 **inactive 分支**。
3. `apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css` 的 `--vscode-tab-unfocusedActiveBackground`
   原值 `light-dark(hsl(0 0% 98%), hsl(220 13% 14%))` ⇒ 亮色下 98% = **250**。

探针 `expr-tabrule.js`（列出匹配 `.dv-tab` 且含 background 的 CSS 规则 + 计算值）读数：
`tabRules: []`（没有直接给 `.dv-tab` 上底色的规则）、`tabBg = rgb(250,250,250)`、
`headerBg = rgb(253,253,253)`、`--dv-activegroup-visiblepanel-tab-background-color = light-dark(hsl(0 0% 99.2%), …)`
⇒ 确证 250 只来自 **inactive** 那条变量。

### 13.3 修复

| 文件 | 前 → 后 |
|---|---|
| `apps/plugins/shared/ui-kit/src/styles/vscode-dark-modern.css:119` | `--vscode-tab-unfocusedActiveBackground`：`light-dark(hsl(0 0% 98%), hsl(220 13% 14%))` → **`light-dark(hsl(0 0% 99.2%), hsl(220 13% 13%))`**（对齐 `tab-activeBackground`） |
| 同上 `:228` | `--vscode-tab-unfocusedInactiveBackground`：`light-dark(hsl(220 13% 97%), hsl(220 13% 14%))` → **`light-dark(hsl(0 0% 99.2%), hsl(220 13% 15%))`**（对齐 `tab-inactiveBackground`） |

### 13.4 复验（`cmp.py`）

`y31..62` 实现 **253，覆盖 1395–1482px**（改前 250 / 768px ✓ 反向核对）
；`y0..30`、`y63` 分隔线、`y64+` 正文面均不变；1:1 像素差 **平均 7.30 级 / >24 级 7.10% / >64 级 3.84%**。


---

## 十四、创作模式入口收敛 + auto 分支返回键（用户口径 m04040）

原文：「手写模式左上角的AI写作模UI按钮就不用出现了，因为进入了AI写作就是AI写作，手写写作就手写写作。还有就是点击UI的时候要有一个小返回键。你现在是没有返回键的，用户点击之后就没有返回了。」

### 14.1 顶栏移除模式切换按钮组

原顶栏右簇是 `手写 | AI 写作 | 重写 | 夜间 | …`：两个模式按钮按 `project.mode` 互斥高亮，点击即 `PUT /projects/:id {mode}` 并把整壳换成另一套工作台。用户口径下创作模式在**开书时**就已定下（`BookshelfPage` 新建向导写 `mode`），写作途中不再切换 ⇒ 该按钮组连同样式一同删除。

| 位置 | 改动 |
|---|---|
| `apps/web/src/components/shell/ProjectLayout.tsx` | 删除 `.shell-mode-switch` 整块（原 `:522-541`，含 `role="group" aria-label="创作模式"` 与两个 `button.shell-mode-btn`），保留其后 `.shell-topbar-divider` 与「重写 / 夜间」 |
| `apps/web/src/components/shell/project-shell.css` | 删除 `.shell-mode-switch` / `.shell-mode-btn` / `.shell-mode-btn:hover` / `.shell-mode-btn.is-active` 四条规则（原 `:416-450`），原位留注释说明为何删 |

复验（live DOM 普查，`D:\t6work\m04040b.mjs`，视口 1264×705）：

| 读数 | 值 |
|---|---|
| `.shell-mode-switch` | `null` |
| `.shell-mode-btn` 计数 / `[aria-label="创作模式"]` 计数 | **0 / 0** |
| `.shell-topbar-text-btn` 文本 | `["重写", "夜间"]` |
| `.shell-topbar-divider` 计数 | **1**（原 2） |
| `.shell-topbar` rect | `[0, 0, 1264, 31]`（尺寸未变，仍与参考图对齐） |
| 其余入口 | 返回键 `[10,2,28,26]` aria「返回」、面包屑 `[44,5,182,20]`、面板菜单 / 设置 / 管理员后台 / 用户 / 登出 均不变 |

状态栏右侧仍**被动**显示当前模式（`.shell-statusbar-item.is-remote` → 「手写模式 / AI 写作模式」），作为只读提示保留。

### 14.2 小返回键（auto 分支此前无任何返回入口）

根因：`ProjectLayout.tsx` 的 auto 分支在渲染停靠外壳**之前**就提前 `return` ⇒ 该路径上既没有顶栏（顶栏返回键在其中），工作台模块缺席时渲染的 `WorkbenchMissing` 占位也没有任何返回控件。

| 位置 | 改动 |
|---|---|
| `apps/web/src/components/shell/WorkbenchMissing.tsx` | props 新增 `onBack?: () => void`；根 div 加 `relative`，首位渲染 `button[aria-label="返回书架"]`（`className="nm-btn-apple-icon-sm absolute left-2 top-2"` + `<ArrowLeft size={15} />`），与外壳顶栏返回键同款同语义 |
| `apps/web/src/components/shell/ProjectLayout.tsx:449` | 占位实参带上 `onBack={handleBack}`（`handleBack` 恒 `navigate('/bookshelf')`） |

复验（live，`D:\t6work\m04040.mjs`：临时建 `{name:'m04040-auto-probe', mode:'auto'}` 项目 → 打开 → 点返回键 → 删除探针项目）：

| 读数 | 值 |
|---|---|
| 建项目 | `POST /api/projects` → **201**，`{"data":{"id":"99c5e573-45f1-4578-8992-fb46d886970b",…,"mode":"auto"}}` |
| `/project/99c5e573-…` 上的外壳 | `.shell-topbar` = `null`、`.shell-doctabs` = `null`、`.shell-statusbar` = `null`（auto 分支不渲染外壳，符合设计） |
| 占位 | `[aria-label="工作台未安装"]` present，文案「AI 写作台未安装 / 该创作模式对应的模块未启用。启用后刷新即可使用。」 |
| 小返回键 | rect `[8,8,28,28]`，`title`/`aria-label` = 「返回书架」 |
| 点击后 | `location.pathname` → **`/bookshelf`** ✓ |

截图：`D:\t6work\m04040-topbar.png`（手写模式顶栏，已无模式按钮）、`D:\t6work\m04040-auto-back.png`（auto 占位 + 左上小返回键）。

### 14.3 测试与门禁

`apps/web/src/components/shell/ProjectLayout.shell-tabs.test.tsx`：原「四按钮互斥高亮」与「点 AI 写作写 PUT」两条用例替换为三条 —— ①顶栏无模式按钮（断言 `.shell-mode-switch` 为 `null`、`.shell-mode-btn` 计 0、文本按钮恒为 `['重写','夜间']`、分割线计 1）；② `mode=auto` 走工作台分支（占位不含顶栏，切回 manual 外壳回来）；③ auto 占位的小返回键点击后真的到达 `/bookshelf`（`MemoryRouter` 加 `/bookshelf` 落地路由做见证）。

门禁 `D:\t6work\m04040-gates.log`：`type-check` / `lint` / `build` / `verify:all` + `pnpm -C apps/web run test` **全 EXIT=0**；web **17 files / 224 tests passed**（改前 223）。

### 14.4 附带修回

首次 live 读数「顶栏全 null」并非缺陷：早前置 mode 的探针把 fixture 项目 `8beadb86-81a2-4b06-ae8b-b26de9cfd453` 的 `mode` 留在了 `auto`，页面上渲染的是占位（`GET /api/projects/:id` 读回 `mode:"auto"`）。已 `PUT {mode:'manual'}` 修回并复读 `mode:"manual"` + `.shell-topbar` present。

> 接口层仍支持 `PUT /projects/:id {mode}`（`apps/server/src/modules/projects.ts:99`，`:129-130` 注释「仅在请求显式带了 mode 时才覆盖」）—— 入口只是从写作界面移除；若日后要在书架/项目卡片上提供「切换工作台」，无需改后端。

### 14.5 e2e 集成脚本口径修正（`scripts/e2e/e2e-ui-integration.mjs`）

m04040 的改动让 t4 集成脚本的**三条断言口径**失效，逐条修正后 **83/83 全过**（连续两跑）：

1. **中栏分组定位改结构性锚点**（原按 `.dv-tab` 文本 `indexOf`）。
   m04040 后中心组组头由 `DocTabs` 接管，该组只剩**一条** `.dv-tab`，其文本是「当前章节名 + 人物设定 + 大纲 · 卷一」的**拼接串**（实测如 `"雨夜投书人物设定大纲 · 卷一 · 雨夜"`），`indexOf('章节正文')` 永不命中 ⇒ `scrollablesInGroup('章节正文')` 返回 `found:false, count:0`，把「中心栏实有 3 个可滚容器」误判成 0。
   现改为 `anchor.closest('.dv-groupview')`：左栏锚 `[aria-label="章节侧边栏"]`、中栏锚 `.ProseMirror`、右栏锚 `[aria-label="AI 对话面板"]`；锚点找不到时回退到原标签文本匹配（保底）。修复后两个视口用例的 `center` 由 0 → 3（`.dock-center-slot` / `.dock-editor-surface` / `.nm-editor-scroll-host`，`overflowY:auto`）。

2. **coexist 断言加几何稳定等待**。打开/关闭侧栏面板会触发 dockview `relayout`，其间中心面板**短暂 unmount**（`.ProseMirror` 消失几十~几百 ms）。原脚本立即取样，会偶发把瞬态误判成「中栏被顶掉」（`center=false`）。现在先 `waitFor`「`.ProseMirror` 与左右栏同时在场且中栏 rect 宽高 > 100」+ 400ms 静置，再断言；同时把 `tabs.length >= 5` 改为**过滤空串后**计数（底部 dock 区关闭后遗留一个空文本 `.dv-tab`，是隐藏组头，非面板）。

3. **`Runtime.enable` 后丢弃 console 重放缓冲**。CDP 的 `Runtime.enable` 会把**连接前**页面已产生的 console 消息重放一遍 —— 实测重放 5 条 `[ErrorSystem] API Error dispatched`，被算进「控制台错误」断言（`count=9` 越界）。现于 `Runtime.enable` 后调用 `Runtime.discardConsoleEntries`（老版本无此命令时静默跳过）。修复后错误条数 **9 → 0**。
   独立取证：`D:\t6work\diag-replay.mjs`（重放 5 条 → discard 后 0 条 → 新导航 0 条）、`D:\t6work\diag-page-errors.mjs`（登录 + 建项目 + 进项目页 + 回书架，纯页面路径 **0 条** console 错误 ⇒ 该错误并非页面/本次改动引入，纯属重放残留）。
   打印点唯一：`apps/plugins/shared/ui-kit/src/errors.ts:286 dispatchApiErrorEvent`，唯一调用方 `apps/plugins/shared/data-core/src/api/apiClient.ts:355/363/373`。

修正后门禁（本会话重测）：`pnpm type-check` EXIT=0（Scope 14 of 15）· `pnpm lint` EXIT=0（3 warning，既有）· `pnpm -C apps/web run test` EXIT=0（**17 files / 224 tests passed**）· `pnpm verify:all` EXIT=0（`✅ verify-all 全过`）· `pnpm build` EXIT=0。e2e 日志：`D:\t6work\live-e2e5.log`、`live-e2e6.log`。

### 14.6 m04040 终检（live 1264×705，`D:\t6work\diag-final.mjs`）

| 读数 | 值 | 判定 |
|---|---|---|
| `.shell-topbar` | `[0,0,1264,31]` | 在位 |
| `.shell-mode-btn` / `.shell-mode-switch` / `[aria-label="创作模式"]` | `0` / `0` / `0` | ① 达成 |
| 顶栏文本按钮 | `["重写","夜间"]`，分割线 `1` | 无模式按钮残影 |
| 顶栏返回键 | `rect [10,2,28,26]`，`aria="返回"` | 子界面可退出 |
| `.shell-doctabs` 行数 | **1**（`[287,31,637,32]`） | 「两个红框重复」已消失 |
| 文档标签 | `["章节正文","人物设定","大纲 · 卷一"]` | = `DOC_TAB_CATALOG` |
| 可见组头数 | **1** | 左右组头 `display:none`，不再叠行 |
| 状态栏 | `● 已保存 0 字 手写模式 VS Code Modern · 亮色` | mode 真值驱动 |
| 面包屑 | `final-check-muw4xf6c` | — |

截图 `D:\t6work\final-manual.png`；auto 分支占位小返回键读数见 §14.2（`rect [8,8,28,28]`、`aria="返回书架"`、点击 → `/bookshelf`）。测试项目已 `DELETE → 200` 自清理。

---

## 附录 A · r1 原始逐区表（保留供对照）

| 区域 | 参考实测 | 实现实测（r1） | 结论 |
|---|---|---|---|
| 顶栏 | h≈34，`#fdfdfd`，右侧 2 个带边框浅灰控件 | h35，`#ffffff`，4 文本按钮 + 4 图标按钮 | ✗ 偏差 |
| 标签栏 | h≈33，`#fdfdfd`；活动标签 = 带边框填充方块，顶边 `#383838`/`#171717` | h30，`#ffffff`；活动标签 = 顶部 2px **蓝色** `rgb(12,111,192)`；分隔线 `#dcdfe4` 4px | ✗ 偏差 |
| 左栏 | w230，`#fdfdfd`；选中行填充 `#e8e8e8` | w240，`#ffffff`；选中行**只有 1px 边框、填充透明** | ✗ 偏差 + 缺陷 F-1 |
| 中栏 | w899，`#f6f6f6`；三者左对齐 x≈411 | w632，`#ffffff`；居中 | ✗ 偏差（**对齐结论已被 §3.1 推翻**） |
| 右栏 | w290，`#fdfdfd` | w338，`#ffffff` | ✗ 偏差 |
| 底部面板条 | h≈26，`#fefefe`/`#fcfcfc` | h29，`#ffffff` | ~ 基本吻合 |
| 状态栏 | h≈24，`#fdfdfd` | h22，`rgb(243,244,246)` 灰蓝 | ✗ 偏差 |

**r1 全局色板**：参考 `#f6f6f6` 41.40% / `#fdfdfd` 31.45% / `#ffffff` **仅 1.44%**；
实现 `#ffffff` **83.77%** + `#dcdfe4` 1.00% + `#0c6fc0` 0.18%。

**r1 verdict**：`needs_revision`（视觉保真系统性差距 + F-1/F-2 两项实现缺陷）。
