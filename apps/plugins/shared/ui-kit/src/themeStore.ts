// ============================================================
// 主题 store —— 换肤的两个正交维度
//
//   theme：主题性格（水墨 / 松烟）→ 写 <html data-theme>
//   mode ：明暗（light / dark）          → 写 <html class="dark">
//
// 默认主题（azure）**不设 data-theme 属性**，直接回落到 globals.css 的 `:root` / `.dark`，
// 这样默认外观与改造前完全一致，主题文件只承担"非默认"的部分。
//
// 持久化到 localStorage；`applyStoredTheme()` 必须在首屏渲染前同步调用，否则会闪一下默认色。
// ============================================================

import { create } from 'zustand';

// 水墨化（2026-09-15）：原 `azure`（青霭玻璃）/ `arcade`（电玩街机）两个彩色主题，
// 重制为同一套水墨语言的两种纸性 —— 「水墨」（生宣 + 浓淡墨）与「松烟」（松烟墨底 + 硬边勾线）。
// id 一并改名：老用户 localStorage 里的 'azure'/'arcade' 会在 readStored 里找不到而回落到默认，
// 自动迁移到水墨，无需写迁移代码。
export type ThemeId = 'ink' | 'shuimo' | 'soot';
export type ColorMode = 'light' | 'dark';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  desc: string;
  /** 自带固定明暗的主题（松烟本体即暗色）—— 设了则忽略明暗切换 */
  lockedMode?: ColorMode;
  /** 设置页色卡预览：[底色, 主色, 强调色] */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'ink',
    name: '水墨',
    desc: '宣纸白底 + 浓淡墨色，笔触飞白与渲染晕染',
    swatch: ['#f5f5f5', '#1f1f1f', '#8c8c8c'],
  },
  {
    id: 'shuimo',
    name: '水墨UI',
    desc: '宣纸底 + 毛笔笔触边框 + 中国传统色（移植自 shuimo.design）',
    swatch: ['#f7f1e6', '#1a2847', '#a81c2b'],
  },
  {
    id: 'soot',
    name: '松烟',
    desc: '松烟墨底 + 硬边勾线，锁定暗色，字如夜灯',
    lockedMode: 'dark',
    swatch: ['#121212', '#e8e8e8', '#6b6b6b'],
  },
];

const STORAGE_KEY = 'novelmuse:theme';
/** 一次性迁移标记：默认主题由 ink 改成 shuimo（见 readStored） */
const MIGRATION_KEY = 'novelmuse:theme:default-migrated-to-shuimo';

interface StoredTheme {
  theme: ThemeId;
  mode: ColorMode;
}

function readStored(): StoredTheme {
  // ★★ 默认主题 = **shuimo（水墨UI）**（2026-09-19 改）
  //
  // 原先默认是 `ink`，而 shuimo 的全部换皮样式都挂在
  // `html[data-theme='shuimo']` 之下 —— 于是**不手动切主题就一点变化都看不到**。
  // 老大反馈「刚启动项目，感觉还是没有变化」就是撞在这上面：
  //   ① 全新访客没有 localStorage → 走这里的 fallback → ink
  //   ② ink 是"不设 data-theme 属性、回落 globals.css :root"的默认档，
  //      外观与改造前**逐像素一致**（这是上一轮刻意做的回归保证）
  // 需求是「用水墨UI全面代替项目里的 UI」，那默认就必须是 shuimo。
  const fallback: StoredTheme = { theme: 'shuimo', mode: 'light' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<StoredTheme>;
    const meta = THEMES.find((x) => x.id === p.theme);
    if (!meta) return fallback;

    // ★ 一次性迁移：把"存着 ink"的当成"没做过主动选择"，迁到新默认 shuimo。
    //
    // 为什么需要：老浏览器里可能已经存了 `{theme:'ink'}`（以前 ink 是默认档，
    //   随便进一次设置页就会被 persist 写下来）。只改 fallback 救不了这种情况 ——
    //   读到的仍是 ink，用户依旧"看不到变化"，正是本次要解决的问题。
    //
    // ★★ 必须**改写存储值**，不能只在读取时临时返回 shuimo（2026-09-19 实测踩过）：
    //   `readStored()` 在一次页面加载里会被调**两次** ——
    //   模块级的 `const initial = readStored()` 先跑，紧接着 `applyStoredTheme()` 又跑一次。
    //   如果只是"读时判断 + 写 flag"，第一次读返回 shuimo 并写下 flag，
    //   第二次读发现 flag 已存在 → 返回 ink → **把 shuimo 覆盖掉**，迁移等于没做。
    //   （三段对照测试的 B 段抓到的就是这个：flag=1 但主题仍是 ink）
    //   写成"覆盖存储值"后，后续任何一次读拿到的都是 shuimo，与调用次数无关。
    //
    // 为什么只跑一次：用 MIGRATION_KEY 记「迁移已执行」。此后用户若**主动**切回 ink，
    //   会被正常保留（不再被弹回 shuimo）——不覆盖用户后来的选择。
    //   标记要在**每次读取时**都写，不能只在命中 ink 时写 ——
    //   否则"本来就是 shuimo 的用户"永远不写标记，之后他切 ink 会被误迁移。
    if (!window.localStorage.getItem(MIGRATION_KEY)) {
      window.localStorage.setItem(MIGRATION_KEY, '1');
      if (meta.id === 'ink') {
        persist(fallback.theme, fallback.mode);
        return fallback;
      }
    }

    return {
      theme: meta.id,
      // 锁定明暗的主题以主题声明为准
      mode: meta.lockedMode ?? (p.mode === 'dark' ? 'dark' : 'light'),
    };
  } catch {
    return fallback;
  }
}

function persist(theme: ThemeId, mode: ColorMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, mode }));
  } catch {
    /* 隐私模式等：存不上不影响本次会话 */
  }
}

/** 把主题写到 <html>。
 *  `ink`（老「水墨」档）移除 data-theme，回落到 globals.css 的 :root —— 那是改造前的原样外观，
 *  现在它是**可选**的对照档，不再是默认。默认见 readStored() 的 fallback。 */
export function applyTheme(theme: ThemeId, mode: ColorMode): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (theme === 'ink') el.removeAttribute('data-theme');
  else el.dataset.theme = theme;
  el.classList.toggle('dark', mode === 'dark');
  // 告诉浏览器当前明暗，让原生控件（滚动条、表单）跟随
  el.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
}

/** 渲染前调用：同步应用本地主题，避免首屏闪一下默认色 */
export function applyStoredTheme(): void {
  const { theme, mode } = readStored();
  applyTheme(theme, mode);
}

const initial = readStored();

interface ThemeState {
  theme: ThemeId;
  mode: ColorMode;
  setTheme: (t: ThemeId) => void;
  setMode: (m: ColorMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial.theme,
  mode: initial.mode,

  setTheme: (t) => {
    const meta = THEMES.find((x) => x.id === t);
    const mode = meta?.lockedMode ?? get().mode;
    applyTheme(t, mode);
    persist(t, mode);
    set({ theme: t, mode });
  },

  setMode: (m) => {
    const { theme } = get();
    // 锁定明暗的主题忽略切换（松烟只有暗色）
    if (THEMES.find((x) => x.id === theme)?.lockedMode) return;
    applyTheme(theme, m);
    persist(theme, m);
    set({ mode: m });
  },
}));
