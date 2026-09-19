/** @type {import('tailwindcss').Config} */

// ============================================================
// 水墨化：Tailwind 内置彩色调色板 → 中性灰阶（墨分五色）
//
// 为什么在配置层做：组件里散落着大量 text-amber-500 / bg-green-100 / text-red-500
//   这类彩色工具类，逐处改既慢又必漏。此处一次性重映射 —— 所有彩色类自动落到灰阶，
//   且**明暗两种模式都可读**（500 档取 52% 灰，深底/浅底上对比都够）。
// 墨阶：50 极淡 / 100 淡 / 300 清 / 500 中 / 700 重 / 900 浓 / 950 焦
// ============================================================
const INK_STEPS = {
  50: 97, 100: 94, 200: 88, 300: 80, 400: 66,
  500: 52, 600: 42, 700: 32, 800: 24, 900: 15, 950: 10,
};
const INK_SCALE = Object.fromEntries(
  Object.entries(INK_STEPS).map(([step, l]) => [step, `hsl(0 0% ${l}%)`]),
);
/** 需要水墨化的内置彩色调色板（gray/slate/zinc/neutral/stone 本就是灰，不动） */
const CHROMATIC_PALETTES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];
const INK_PALETTE = Object.fromEntries(CHROMATIC_PALETTES.map((c) => [c, INK_SCALE]));

export default {
  darkMode: 'class',
  // ★ 插件 Web 面也要扫描（novel.autowrite / worldbuilding 等）：
  //   否则插件独有的工具类（如 -right-14 / right-12）不会生成 CSS，
  //   表现为气泡栏/弹层类全部失效、叠在面板内部（2026-09-10 实测事故）。
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../plugins/**/web/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // —— 水墨化：彩色调色板整体重映射为灰阶（说明见文件顶部）——
        ...INK_PALETTE,
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // —— 青霭玻璃语义化色板（值见 globals.css 变量层）——
        mountain: {
          DEFAULT: 'hsl(var(--mountain-cyan))',
          cyan: 'hsl(var(--mountain-cyan))',
          light: 'hsl(var(--mountain-light))',
          deep: 'hsl(var(--mountain-deep))',
          pale: 'hsl(var(--mountain-pale))',
        },
        mist: {
          DEFAULT: 'hsl(var(--mist-blue))',
          blue: 'hsl(var(--mist-blue))',
          pale: 'hsl(var(--mist-pale))',
          deep: 'hsl(var(--mist-deep))',
        },
        ink: {
          DEFAULT: 'hsl(var(--ink))',
          light: 'hsl(var(--ink-light))',
          pale: 'hsl(var(--ink-pale))',
        },
        // 章节区分墨阶（8 档）——原 6 色高饱和板改墨阶，见 globals.css 注释
        chapter: {
          1: 'hsl(var(--chapter-1))',
          2: 'hsl(var(--chapter-2))',
          3: 'hsl(var(--chapter-3))',
          4: 'hsl(var(--chapter-4))',
          5: 'hsl(var(--chapter-5))',
          6: 'hsl(var(--chapter-6))',
          7: 'hsl(var(--chapter-7))',
          8: 'hsl(var(--chapter-8))',
        },
        cinnabar: {
          DEFAULT: 'hsl(var(--cinnabar))',
          pale: 'hsl(var(--cinnabar-pale))',
        },
        willow: {
          DEFAULT: 'hsl(var(--willow))',
          pale: 'hsl(var(--willow-pale))',
        },
        ochre: {
          DEFAULT: 'hsl(var(--ochre))',
          pale: 'hsl(var(--ochre-pale))',
        },
        // —— 兼容旧命名 ——
        inspiration: {
          DEFAULT: 'hsl(var(--mountain-deep))',
          light: 'hsl(var(--mountain-light))',
        },
        focus: {
          DEFAULT: 'hsl(var(--mountain-cyan))',
          subtle: 'hsl(var(--mountain-pale))',
        },
        warm: {
          DEFAULT: 'hsl(var(--ochre))',
          light: 'hsl(var(--ochre-pale))',
        },
        success: {
          DEFAULT: 'hsl(var(--willow))',
        },
        // —— 语义扩展层（换肤契约 2026-09-11，值见 globals.css）——
        // 组件该类色一律用这里，不要写死 #xxxxxx —— 否则换肤不生效
        entity: {
          character: 'hsl(var(--entity-character))',
          location: 'hsl(var(--entity-location))',
          item: 'hsl(var(--entity-item))',
          foreshadow: 'hsl(var(--entity-foreshadow))',
          event: 'hsl(var(--entity-event))',
          outline: 'hsl(var(--entity-outline))',
        },
        agent: {
          plot: 'hsl(var(--agent-plot))',
          character: 'hsl(var(--agent-character))',
          continuity: 'hsl(var(--agent-continuity))',
          convener: 'hsl(var(--agent-convener))',
          writer: 'hsl(var(--agent-writer))',
        },
        state: {
          idle: 'hsl(var(--state-idle))',
          running: 'hsl(var(--state-running))',
          done: 'hsl(var(--state-done))',
          blocked: 'hsl(var(--state-blocked))',
        },

        // ============================================================
        // 墨韵工艺层（2026-09-18）—— 令牌定义见 globals.css「墨韵工艺层」小节
        //
        // 纸面层级 paper：由"深"到"浮"共 6 档
        //   bg-canvas(底) < bg-inset(凹陷) < bg-field(输入) < bg(面) < bg-hover < bg-hover-2
        // 墨线 line：勾线三档 —— 在纸上，实体感来自勾线而非投影
        // ============================================================
        paper: {
          DEFAULT: 'hsl(var(--paper))',
          canvas: 'hsl(var(--paper-canvas))',
          inset: 'hsl(var(--paper-inset))',
          field: 'hsl(var(--paper-field))',
          hover: 'hsl(var(--paper-hover))',
          'hover-2': 'hsl(var(--paper-hover-2))',
          line: 'hsl(var(--paper-line))',
          'line-strong': 'hsl(var(--paper-line-strong))',
          'line-soft': 'hsl(var(--paper-line-soft))',
        },

        // 墨阶文字 tone：三档（tone-3 只准用于 placeholder / disabled / 装饰）
        tone: {
          DEFAULT: 'hsl(var(--tone))',
          2: 'hsl(var(--tone-2))',
          3: 'hsl(var(--tone-3))',
        },

        // 极克制信号色 sig：本体系唯一的彩色，只用于状态指示
        sig: {
          run: 'hsl(var(--sig-run))',
          'run-tint': 'hsl(var(--sig-run-tint))',
          done: 'hsl(var(--sig-done))',
          'done-tint': 'hsl(var(--sig-done-tint))',
          warn: 'hsl(var(--sig-warn))',
          'warn-tint': 'hsl(var(--sig-warn-tint))',
          stop: 'hsl(var(--sig-stop))',
          'stop-tint': 'hsl(var(--sig-stop-tint))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // 墨韵工艺层：四级圆角档位（与上面的苹果大圆角并存，迁移可分批）
        chip: 'var(--radius-chip)',           // 6px  标签 / 徽章 / 极小控件
        control: 'var(--radius-control)',     // 8px  按钮 / 输入 / 图标按钮
        card: 'var(--radius-card)',           // 10px 卡片 / 面板
        window: 'var(--radius-window)',       // 14px 窗口 / 大容器 / 输入区
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', 'Microsoft YaHei', 'system-ui', 'sans-serif'],
        serif: ['Noto Serif SC', 'Source Han Serif SC', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'zoom-in-95': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-from-top-2': {
          '0%': { opacity: '0', transform: 'translateY(-0.5rem)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 5px currentColor' },
          '50%': { boxShadow: '0 0 20px currentColor' },
        },
        'card-enter': {
          '0%': { opacity: '0', transform: 'translateY(16px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'text-reveal': {
          '0%': { opacity: '0', transform: 'translateY(4px)', filter: 'blur(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'gradient-flow': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'pulse-glow-enhanced': {
          '0%, 100%': {
            boxShadow: '0 0 20px hsl(var(--mountain-cyan) / 0.1), 0 0 40px hsl(var(--mountain-cyan) / 0.05)',
          },
          '50%': {
            boxShadow: '0 0 30px hsl(var(--mountain-cyan) / 0.2), 0 0 60px hsl(var(--mountain-cyan) / 0.1)',
          },
        },
        'purple-glow': {
          '0%, 100%': { boxShadow: '0 0 25px hsl(var(--mountain-deep) / 0.15)' },
          '50%': { boxShadow: '0 0 50px hsl(var(--mountain-deep) / 0.25)' },
        },
        'spring-scale': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'smooth-fade': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'rotate-in': {
          '0%': { opacity: '0', transform: 'rotate(-5deg) scale(0.95)' },
          '100%': { opacity: '1', transform: 'rotate(0) scale(1)' },
        },
        // —— 空山雨后时期的旧动画（保留兼容，部分已被玻璃体系取代）——
        'mist-drift': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(20px, -4px)' },
        },
        'ink-spread': {
          '0%': { opacity: '0', transform: 'scale(0.94)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'scale(1)', filter: 'blur(0)' },
        },
        'tree-sway': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(1.5deg)' },
          '75%': { transform: 'rotate(-1.5deg)' },
        },
        'tree-sway-soft': {
          '0%, 100%': { transform: 'rotate(0deg) scaleX(1)' },
          '33%': { transform: 'rotate(1deg) scaleX(1.01)' },
          '66%': { transform: 'rotate(-0.8deg) scaleX(0.99)' },
        },
        'leaf-fall': {
          '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(60px) rotate(180deg)', opacity: '0' },
        },
        'leaf-drift': {
          '0%': { transform: 'translateX(0) translateY(0) rotate(0deg)', opacity: '1' },
          '50%': { transform: 'translateX(15px) translateY(30px) rotate(90deg)', opacity: '0.6' },
          '100%': { transform: 'translateX(-10px) translateY(60px) rotate(180deg)', opacity: '0' },
        },
        'ring-expand': {
          '0%': { transform: 'scale(0.5)', opacity: '0.8' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        'glow-pulse-soft': {
          '0%, 100%': { boxShadow: '0 0 8px hsl(var(--mountain-cyan) / 0.1)' },
          '50%': { boxShadow: '0 0 20px hsl(var(--mountain-cyan) / 0.25)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'zoom-in-95': 'zoom-in-95 200ms ease-out',
        'slide-in-from-top-2': 'slide-in-from-top-2 200ms ease-out',
        'float': 'float 3s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'card-enter': 'card-enter 0.5s ease-out both',
        'text-reveal': 'text-reveal 0.6s ease-out both',
        'shimmer': 'shimmer 2s infinite linear',
        'gradient-flow': 'gradient-flow 8s ease infinite',
        'pulse-glow-enhanced': 'pulse-glow-enhanced 2.5s ease-in-out infinite',
        'purple-glow': 'purple-glow 3s ease-in-out infinite',
        'spring-scale': 'spring-scale 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'smooth-fade': 'smooth-fade 0.4s ease-out',
        'rotate-in': 'rotate-in 0.5s ease-out',
        'mist-drift': 'mist-drift 22s ease-in-out infinite',
        'ink-spread': 'ink-spread 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        'tree-sway': 'tree-sway 3s ease-in-out infinite',
        'tree-sway-soft': 'tree-sway-soft 4s ease-in-out infinite',
        'leaf-fall': 'leaf-fall 2s ease-in forwards',
        'leaf-drift': 'leaf-drift 3s ease-in-out forwards',
        'ring-expand': 'ring-expand 0.6s ease-out forwards',
        'glow-pulse-soft': 'glow-pulse-soft 3s ease-in-out infinite',
      },
      boxShadow: {
        'glow': '0 0 15px -3px hsl(var(--mountain-cyan) / 0.1)',
        'glow-lg': '0 0 30px -5px hsl(var(--mountain-cyan) / 0.15)',
        'glass': '0 8px 32px -8px hsl(var(--ink) / 0.08)',
        'glow-blue': '0 0 30px -5px hsl(var(--mountain-cyan) / 0.2)',
        'glow-purple': '0 0 30px -5px hsl(var(--mountain-deep) / 0.2)',
        'glow-orange': '0 0 30px -5px hsl(var(--ochre) / 0.15)',
        'deep': '0 20px 60px -15px hsl(var(--ink) / 0.18)',
        // —— 青霭玻璃特色阴影
        'ink': '0 8px 24px -8px hsl(var(--ink) / 0.18)',
        'mist': '0 12px 32px -10px hsl(var(--mist-deep) / 0.25)',

        // —— 墨韵工艺层：分级投影，全部含 1px 墨线（令牌见 globals.css）——
        // hairline 勾线 → card 卡片 → raised 浮起 → overlay 弹层，四级递进
        hairline: 'var(--shadow-hairline)',
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        btn: 'var(--shadow-btn)',
        field: 'var(--shadow-inset-field)',
      },
      // 墨韵工艺层：三档精修缓动（取 beautifului 的值）
      transitionTimingFunction: {
        link: 'var(--ease-link)',                       // 出场 / 展开：快起慢收
        'out-strong': 'var(--ease-out-strong)',         // 位移 / 放大：更脆
        'in-out-strong': 'var(--ease-in-out-strong)',   // 循环 / 往复
      },
      // 墨韵工艺层：命名字号档位
      // 为什么要这个：全站已在用 336 处 text-[11px]，但那是"魔法值"，
      // 后来人不知道 11 是地板还是随手写的。固化成 text-2xs 后语义自明，
      // 且将来要调档位只改这一处。
      //   2xs 11px = 面板内小字地板（眉标 / 元信息 / 表格 meta）
      //   xs  12px = Tailwind 内置，正文下限
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.45' }],
      },
    },
  },
  daisyui: {
    themes: false,
    darkTheme: 'inkwash',
    base: false,
    styled: true,
    utils: true,
  },
  plugins: [require('daisyui')],
};
