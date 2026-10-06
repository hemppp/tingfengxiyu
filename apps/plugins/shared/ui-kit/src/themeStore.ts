// ============================================================
// 主题 store —— VS Code Modern（亮 / 暗双档）
//
// 契约真源：docs/architecture/dock-protocol-adr.md §6
//   · §6.1 默认主题 = 'vscode-dark-modern'（唯一档），并且就是 :root 本身
//   · §6.2 老用户 localStorage 里的三档旧主题名一律**静默回落**默认，
//          不抛错、不提示、不写迁移标记；MIGRATION_KEY 常量整体删除
//   · §6.3 applyTheme 保留 dataset.theme 写入 + .dark 切换 + style.colorScheme
//
// ## t1 外壳改造对 §6.3 的显式修订（明暗解锁）
//   旧实现把「唯一档 = 暗色」写死成 lockedMode:'dark'，于是 setMode 被提前
//   return，明暗切换名存实亡。目标界面要求「夜间」按钮即时切换亮/暗，故：
//     · token 真源把 114 个颜色 token 包成 `light-dark(浅, 深)`（同一 token
//       仍只有一处定义，单一真源不变量不变），由 color-scheme 决定生效档；
//     · 本 store 去掉 lockedMode、默认档改为 'light'，setMode 因此真正生效；
//     · applyTheme 继续写 style.colorScheme —— 它现在不只是「跟随原生控件」，
//       而是明暗两档的唯一开关（ADR §6.3 的写法正好是关键机制）。
//
// ## 与旧实现的关系（水墨化 → VS Code 化的净变化）
//   旧：ThemeId 是「三档水墨主题」的联合，默认水墨档，
//       并带一个 MIGRATION_KEY 一次性迁移分支（把存着旧默认档的当成没做过选择）。
//   新：ThemeId = 'vscode-dark-modern'（单值字面量联合）。
//       迁移分支**整个删除** —— 旧值在 THEMES 里找不到 → 直接回落默认，
//       这正是 §6.2 要的行为，且不再需要任何 flag 来防「读两次互相覆盖」
//       （那个坑只存在于「读时改写存储值」的写法里，现在压根不写存储）。
//
//   注：本文件刻意用「三档旧主题名」这类描述性说法而不写出具体字面量，
//       以免残留的旧标识符污染仓库检索（P1 验收：全仓无水墨残留）。
//
// ## 颜色定义在哪
//   本 store 只负责「把哪个主题、哪一档明暗写到 <html>」这一件事；
//   具体色值全部在 @novel-plugins/ui-kit 的 styles/vscode-dark-modern.css，
//   `:root, html.dark` 里每个 token 写成 `light-dark(浅色, 深色)`，
//   按 <html> 的 computed color-scheme 解析 —— 故亮暗两档共用同一批 token 名，
//   定义在全局作用域，所有插件自动继承，且「一个 token 只有一处定义」不破。
// ============================================================

import { create } from 'zustand';

/** 唯一主题档。ADR §6.1：单值字面量联合（保留联合形态以便未来加档）。 */
export type ThemeId = 'vscode-dark-modern';
export type ColorMode = 'light' | 'dark';

/** 唯一主题 id（applyTheme / THEMES 共用，避免散落字面量） */
export const DEFAULT_THEME: ThemeId = 'vscode-dark-modern';
/**
 * 默认明暗档 = 'light'（目标界面以极简白底为默认观感）。
 * 老用户 localStorage 里的 'dark' 会被 readStored 原样读出，不受影响。
 */
export const DEFAULT_MODE: ColorMode = 'light';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  desc: string;
  /** 自带固定明暗的主题 —— 设了则忽略明暗切换 */
  lockedMode?: ColorMode;
  /** 设置页色卡预览：[底色, 主色, 强调色] */
  swatch: [string, string, string];
}

/**
 * 主题清单：**恰好一项**（ADR §6.1）。
 *
 * 为什么保留数组而不是删除：设置页「外观」需要它渲染色卡，
 * 且保留未来加档的扩展位。
 *
 * t1：不再设 lockedMode —— 亮/暗两档由同一个主题的 `light-dark()` token 承载，
 * 因此「主题 id」与「明暗档」正交，明暗切换不再被主题锁死（见文件头 §6.3 修订）。
 */
export const THEMES: ThemeMeta[] = [
  {
    id: 'vscode-dark-modern',
    name: 'VS Code Modern',
    desc: '亮 / 暗双档：白底极简与编辑器深灰底共用一套 token，由「夜间」或设置页切换',
    swatch: ['#ffffff', '#0078d4', '#1f1f1f'],
  },
];

const STORAGE_KEY = 'novelmuse:theme';

interface StoredTheme {
  theme: ThemeId;
  mode: ColorMode;
}

/** 只接受 'light'/'dark'，其余（含 undefined / 非法字符串）一律回落到默认 */
function normalizeMode(m: unknown): ColorMode {
  return m === 'light' || m === 'dark' ? m : DEFAULT_MODE;
}

/**
 * 读本地存储。ADR §6.2 冻结实现：
 * 「读 → JSON.parse → 在 THEMES 里找 → 找到就用，找不到就 fallback」。
 *
 * 旧主题名（已被移除的三档）在 THEMES 里**找不到**，因此静默回落默认；
 * 损坏 JSON、隐私模式不可读同样走 fallback。**任何分支都不抛错。**
 * 也不读写任何迁移标记 —— MIGRATION_KEY 已按 §6.2 删除，
 * 且旧浏览器里残留的那个一次性迁移键不再被任何读取路径引用
 * （不清理，清理属无收益写操作）。
 */
function readStored(): StoredTheme {
  const fallback: StoredTheme = { theme: DEFAULT_THEME, mode: DEFAULT_MODE };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<StoredTheme>;
    const meta = THEMES.find((x) => x.id === p.theme);
    return meta
      ? { theme: meta.id, mode: meta.lockedMode ?? normalizeMode(p.mode) }
      : fallback;
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

/**
 * 把主题写到 <html>。ADR §6.3（t1 修订）：
 *   · 保留 `el.dataset.theme`（值 = 'vscode-dark-modern'）
 *   · 必须继续 toggle `.dark` —— 按 class 作用域写的规则仍依赖它
 *   · 必须继续设 colorScheme —— 现在它是亮/暗两档的开关：token 真源里每个颜色
 *     都是 `light-dark(浅, 深)`，按本元素的 color-scheme 解析；副作用是原生
 *     滚动条 / 表单控件也一并跟随
 */
export function applyTheme(theme: ThemeId, mode: ColorMode): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.classList.toggle('dark', mode === 'dark');
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
    // 未知主题不接受（不写存储、不改 DOM）—— 保持与 readStored 同一条不变量
    if (!meta) return;
    const mode = meta.lockedMode ?? get().mode;
    applyTheme(t, mode);
    persist(t, mode);
    set({ theme: t, mode });
  },

  setMode: (m) => {
    const { theme } = get();
    // 锁定明暗的主题忽略切换（当前唯一档亮/暗皆可，故不会命中）
    if (THEMES.find((x) => x.id === theme)?.lockedMode) return;
    // 非法入参不接受（不写存储、不改 DOM）—— 与 readStored 同一条不变量
    if (m !== 'light' && m !== 'dark') return;
    applyTheme(theme, m);
    persist(theme, m);
    set({ mode: m });
  },
}));
