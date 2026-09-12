// ============================================================
// 主题 store —— 换肤的两个正交维度
//
//   theme：主题性格（青霭玻璃 / 电玩街机）→ 写 <html data-theme>
//   mode ：明暗（light / dark）          → 写 <html class="dark">
//
// 默认主题（azure）**不设 data-theme 属性**，直接回落到 globals.css 的 `:root` / `.dark`，
// 这样默认外观与改造前完全一致，主题文件只承担"非默认"的部分。
//
// 持久化到 localStorage；`applyStoredTheme()` 必须在首屏渲染前同步调用，否则会闪一下默认色。
// ============================================================

import { create } from 'zustand';

export type ThemeId = 'azure' | 'arcade';
export type ColorMode = 'light' | 'dark';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  desc: string;
  /** 自带固定明暗的主题（电玩街机本体即暗色）—— 设了则忽略明暗切换 */
  lockedMode?: ColorMode;
  /** 设置页色卡预览：[底色, 主色, 强调色] */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'azure',
    name: '青霭玻璃',
    desc: '冷调瓷白 + 霁青，毛玻璃质感的默认外观',
    swatch: ['#f2f3f7', '#2383c7', '#222a3d'],
  },
  {
    id: 'arcade',
    name: '电玩街机',
    desc: '深空蓝紫 + 霓虹青，硬边面板与辉光',
    lockedMode: 'dark',
    swatch: ['#0a0d18', '#00e5ff', '#ff2e88'],
  },
];

const STORAGE_KEY = 'novelmuse:theme';

interface StoredTheme {
  theme: ThemeId;
  mode: ColorMode;
}

function readStored(): StoredTheme {
  const fallback: StoredTheme = { theme: 'azure', mode: 'light' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<StoredTheme>;
    const meta = THEMES.find((x) => x.id === p.theme);
    if (!meta) return fallback;
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

/** 把主题写到 <html>。默认主题移除 data-theme，回落到 :root */
export function applyTheme(theme: ThemeId, mode: ColorMode): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (theme === 'azure') el.removeAttribute('data-theme');
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
    // 锁定明暗的主题忽略切换（电玩街机只有暗色）
    if (THEMES.find((x) => x.id === theme)?.lockedMode) return;
    applyTheme(theme, m);
    persist(theme, m);
    set({ mode: m });
  },
}));
