/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // ★ 插件 Web 面也要扫描（novel.autowrite / worldbuilding 等）：
  //   否则插件独有的工具类（如 -right-14 / right-12）不会生成 CSS，
  //   表现为气泡栏/弹层类全部失效、叠在面板内部（2026-09-10 实测事故）。
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../plugins/**/web/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
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
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
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
