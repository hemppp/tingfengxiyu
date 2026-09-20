# 设计系统 — 空山雨后

> 本文件是 NovelMuse 视觉规范的单一真相。此前嵌在 `README.md` 里（占 140 行），
> 2026-09-20 为精简自述文件抽出，内容不变。
> 相关：[墨韵工艺层迁移](ink-wash-migration.md) · [工作台标签页设计](ui-tab-workspace-design.md)

---

## 设计理念

1. **水墨书写**: 界面如同铺开的宣纸，所有元素都是墨痕与晕染
2. **远山层次**: 通过 SVG 远山背景营造空间纵深与时间沉淀
3. **克制的留白**: 东方美学在于"虚实相生"，空白处即是云气
4. **触笔手感**: 圆角、柔光、缓动曲线，模拟毛笔在宣纸上的运行
5. **亮色优先**: 长篇写作需要温暖而不刺眼的基底色

---

## 色彩系统

### 主色板

```css
/* 基底 — 宣纸与墨 */
--background:  35 22% 92%   /* #EFE9DD 宣纸暖白 */
--foreground:  25 15% 18%   /* #322D26 墨色 */
--card:        35 28% 96%   /* #F8F2E7 浅宣纸 */
--border:      35 12% 78%   /* #D2C9B5 纸纹边 */

/* 主色 — 远山青 */
--primary:     178 35% 42%  /* #4F918C */
--ring:        178 35% 42%  /* focus 同主色 */
```

### 远山与雾

| 名称 | HSL | 色值 | 用途 |
|------|-----|------|------|
| `mountain-cyan` | 178 35% 42% | `#4F918C` | 主远山青（主按钮、链接） |
| `mountain-light` | 178 25% 70% | `#A4C5C2` | 淡远山（hover 边） |
| `mountain-deep` | 195 40% 32% | `#336C78` | 深远山（次要强调） |
| `mountain-pale` | 178 30% 88% | `#D9E6E4` | 远山雾（光晕、focus 环） |
| `mist-blue` | 205 30% 70% | `#9DB8C6` | 雾蓝（信息提示） |
| `mist-pale` | 200 25% 88% | `#CFE0E6` | 淡雾（背景层） |

### 水墨

| 名称 | HSL | 色值 | 用途 |
|------|-----|------|------|
| `ink` | 25 15% 18% | `#322D26` | 浓墨（主文字） |
| `ink-light` | 25 12% 38% | `#6E665A` | 淡墨（次要文字） |
| `ink-pale` | 25 10% 60% | `#A29A8E` | 灰墨（占位、辅助） |

### 点缀色

| 名称 | HSL | 色值 | 用途 |
|------|-----|------|------|
| `cinnabar` | 12 60% 48% | `#C25B3A` | 朱砂红（危险、删除） |
| `willow` | 88 30% 48% | `#66944D` | 柳绿（成功、完成） |
| `ochre` | 38 55% 52% | `#C18A3E` | 赭石（伏笔、提醒） |

---

## 字体系统

```css
/* 无衬线 - 用于 UI 元素 */
font-family: 'Inter', system-ui, sans-serif;

/* 衬线 - 用于标题和文学内容（编辑器） */
font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif;

/* 等宽 - 用于代码和数据 */
font-family: 'JetBrains Mono', 'Fira Code', monospace;
```

---

## 组件样式

### 按钮（4 种风格）

```tsx
// 主按钮：远山青渐变
<button className="btn-mist-primary">新建书籍</button>

// 幽灵按钮：墨色描边
<button className="btn-mist-ghost">取消</button>

// 软按钮：浅宣纸底
<button className="btn-mist-soft">次要操作</button>

// 朱砂按钮：危险操作
<button className="btn-mist-cinnabar">删除</button>
```

### 卡片（3 种风格）

```tsx
// 宣纸卡（基础）
<div className="card-mist">...</div>

// 浮起墨晕卡
<div className="card-mist-elevated">...</div>

// 远山装饰卡
<div className="card-mist-mountain">...</div>
```

### 输入框

```tsx
<input type="text" className="input-mist" placeholder="输入..." />
```

---

## 动画系统

### 入场动画

| 类名 | 时长 | 效果 |
|------|------|------|
| `animate-fade-in` | 0.25s | 淡入上移 |
| `animate-slide-up` | 0.3s | 上滑 |
| `animate-card-enter` | 0.45s | 卡片入场 |
| `animate-text-reveal` | 0.6s | 文字模糊清除 |

### 持续动画

| 类名 | 时长 | 效果 |
|------|------|------|
| `animate-mist-drift` | 22s | 雾气横向漂移 |
| `animate-float` | 3s | 微妙上下浮动 |
| `animate-tree-sway` | 3s | 树摇曳 |
| `animate-shimmer` | 2.4s | 骨架屏闪烁 |

---

## 视觉效果

### 远山背景

```tsx
import { BambooMistBackground } from '@/components/backgrounds/BambooMistBackground';

<BambooMistBackground />
```

**特点**:
- 三层山脉（远山雾 / 远山青 / 深远山）
- 竹林 SVG 动画（4.5s / 6s / 9s 三档缓动）
- 雨 canvas 粒子效果
- 雾气带横向漂移动画
- `pointer-events: none` 不影响交互

---

## 墨韵工艺层（2026-09-18 落地）

把 beautifului.dev 的设计基座（**无 npm 包**，copy-paste 式）移植进本项目。
定位：**黑白为骨 + 极克制信号色** —— `--sig-{run,done,warn,stop}` 是全体系**唯一的彩色出口**，
只准用于状态指示。

- 令牌在 `apps/web/src/styles/globals.css` 的「墨韵工艺层」段：`--paper-*` / `--tone[-2/-3]` /
  `--radius-{chip6,control8,card10,window14}` / `--shadow-*` / `--ease-link`；
  对应在 `tailwind.config.js` 注册（Tailwind **3.4**，没有 `@theme`）。
- 工具类前缀 `mc-`：`.mc-eyebrow` / `.mc-num` / `.mc-collapse` / `.mc-sig-*` / `.mc-pixels` /
  `.mc-caret-tail` / `.mc-press` / `.mc-focus`。
- ⚠️ **加了新令牌必须同步补 `themes.css` 的 `html[data-theme="soot"]`**，否则「换一半皮」。
- ⚠️ `--tone-3` 亮色对比度 3.31:1、压在 `paper-inset` 上 3.47:1，**均不过 AA**。
  规则：凡是唯一承载信息的文字，不得使用 `--tone-3`。
