// ============================================================
// 分页工作区状态（VSCode 式标签）
//
// 设计见 docs/ui-tab-workspace-design.md。**只服务 AI 写作模式** ——
// 手写模式保持原来的罗盘转轮 + 浮窗，两套互斥（2026-09-13 决定）。
//
// 与老的 `panelOpenStore` 的区别（别混用）：
//   panelOpenStore：只有 keys[]（谁开着），谁开谁关不管顺序 —— 浮窗时代够用
//   本 store：多了**顺序 / 当前激活 / 分页区展开 / 宽度 / 最近使用(MRU)** —— 标签语义里这几个是核心
//
// 三条不变量（写在这里，改的时候别绕开）：
//   1. **正文不进 tabs** —— 它是固定主视图，永不参与分页、永不卸载
//   2. **气泡是显示/隐藏开关**：点已激活的气泡只收起分页区，**不销毁**面板
//   3. **不设打开数量上限**：溢出靠标签栏滚动 + 下拉，不静默挤掉旧标签
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 分页区宽度范围（与设计文档一致） */
export const PANE_MIN = 320;
export const PANE_MAX = 720;
export const PANE_DEFAULT = 420;

export interface WorkspaceState {
  /** 组 2（侧编辑器组）已打开的看板 key，按标签顺序（组 1 的正文不在里面，它常驻） */
  tabs: string[];
  /** 组 2 当前激活的看板；null = 组 2 收起（正文占满） */
  active: string | null;
  /**
   * **预览标签**（IDE 语义：资源管理器里单击文件 = 斜体预览标签，再去点别的会**替换**它，
   * 双击才固定）。这里 null 表示当前没有预览标签、全是固定标签。
   */
  previewKey: string | null;
  /** 侧编辑器组是否展开 */
  paneOpen: boolean;
  /** 组 2 宽度（记忆用，恢复时钳制） */
  paneWidth: number;
  /** 最近使用顺序（Ctrl+Tab 用），最近的在最前 */
  mru: string[];

  /**
   * 打开并激活（幂等）。
   * @param opts.preview true = 作为**预览标签**打开：已有预览标签会被它**替换**（IDE 行为）
   */
  openPanel: (key: string, opts?: { preview?: boolean }) => void;
  /** 把预览标签**固定**（双击标签或双击气泡） */
  promote: (key: string) => void;
  /** 切到某个看板；传 null = 回到正文（收起组 2） */
  activate: (key: string | null) => void;
  /** 关闭标签。关的是当前 → 激活右邻，无右邻取左邻；全关光 → 组 2 收起（正文占满） */
  closePanel: (key: string) => void;
  /** 关闭除 key 以外的全部 */
  closeOthers: (key: string) => void;
  /** 关闭 key 右侧的全部（IDE 的「关闭右侧」） */
  closeToRight: (key: string) => void;
  /**
   * 气泡单击（IDE 里对应"资源管理器单击文件"）：
   *   ①没有标签 → 以**预览**方式打开 + 激活 + 展开
   *   ②有但不是当前 → 切过去
   *   ③就是当前 → 收起组 2（**标签保留**）；再点恢复
   */
  toggleBubble: (key: string) => void;
  setWidth: (w: number) => void;
  setPaneOpen: (open: boolean) => void;
  moveTab: (from: number, to: number) => void;
  reset: () => void;
}

export const clampPaneWidth = (w: number): number =>
  Math.max(PANE_MIN, Math.min(PANE_MAX, Math.round(w)));

/** 把 key 提到 MRU 最前（去重） */
function touchMru(mru: string[], key: string): string[] {
  return [key, ...mru.filter((k) => k !== key)].slice(0, 20);
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      active: null,
      previewKey: null,
      paneOpen: false,
      paneWidth: PANE_DEFAULT,
      mru: [],

      openPanel: (key, opts) => set((s) => {
        if (!key) return s;
        const preview = opts?.preview === true;
        let tabs = s.tabs;
        let previewKey = s.previewKey;

        if (!tabs.includes(key)) {
          if (preview && previewKey && tabs.includes(previewKey)) {
            // ★ IDE 行为：预览标签只有一个槽位 —— 新预览**顶掉**旧的，位置也沿用（不跳到末尾）
            tabs = tabs.map((k) => (k === previewKey ? key : k));
          } else {
            tabs = [...tabs, key];
          }
        }
        if (preview) previewKey = key;
        else if (previewKey === key) previewKey = null;   // 固定打开 = 晋级

        return { tabs, active: key, previewKey, paneOpen: true, mru: touchMru(s.mru, key) };
      }),

      promote: (key) => set((s) => (s.previewKey === key ? { previewKey: null } : s)),

      activate: (key) => set((s) => {
        if (key === null) return { active: null, paneOpen: false };
        if (!s.tabs.includes(key)) return s;
        return { active: key, paneOpen: true, mru: touchMru(s.mru, key) };
      }),

      closePanel: (key) => set((s) => {
        const i = s.tabs.indexOf(key);
        if (i < 0) return s;
        const tabs = s.tabs.filter((k) => k !== key);
        const previewKey = s.previewKey === key ? null : s.previewKey;
        if (s.active !== key) return { tabs, previewKey, mru: s.mru.filter((k) => k !== key) };

        // 关掉的是当前标签：右邻优先，其次左邻
        const next = tabs[i] ?? tabs[i - 1] ?? null;
        return {
          tabs,
          previewKey,
          active: next,
          // 一个都不剩：收起组 2（正文占满），而不是把工作区关掉
          paneOpen: next === null ? false : s.paneOpen,
          mru: s.mru.filter((k) => k !== key),
        };
      }),

      closeOthers: (key) => set((s) => {
        const tabs = s.tabs.includes(key) ? [key] : [];
        return {
          tabs,
          previewKey: s.previewKey === key ? s.previewKey : null,
          active: tabs.length ? key : null,
          paneOpen: tabs.length ? s.paneOpen : false,
        };
      }),

      closeToRight: (key) => set((s) => {
        const i = s.tabs.indexOf(key);
        if (i < 0) return s;
        const tabs = s.tabs.slice(0, i + 1);
        const previewKey = s.previewKey && tabs.includes(s.previewKey) ? s.previewKey : null;
        const active = s.active && tabs.includes(s.active) ? s.active : key;
        return { tabs, previewKey, active };
      }),

      toggleBubble: (key) => {
        const s = get();
        const has = s.tabs.includes(key);
        if (!has) { s.openPanel(key, { preview: true }); return; }
        if (s.active !== key) { s.activate(key); return; }
        // ★ 就是当前标签：只收起组 2，**不销毁**看板（面板里的筛选/滚动/表单都留着）
        set({ paneOpen: !s.paneOpen });
      },

      setWidth: (w) => set({ paneWidth: clampPaneWidth(w) }),
      setPaneOpen: (open) => set((s) => ({
        paneOpen: open,
        // 展开时若没有激活项，回到第一个标签（避免"展开了但没有内容"）
        active: open ? (s.active ?? s.tabs[0] ?? null) : s.active,
      })),

      moveTab: (from, to) => set((s) => {
        if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return s;
        const tabs = [...s.tabs];
        const [moved] = tabs.splice(from, 1);
        if (moved === undefined) return s;
        tabs.splice(to, 0, moved);
        return { tabs };
      }),

      reset: () => set({ tabs: [], active: null, previewKey: null, paneOpen: false, mru: [] }),
    }),
    {
      name: 'novelmuse:workspace:ai',
      // 只持久化数据，不持久化动作；预览标签不持久化（IDE 重启后预览槽是空的）
      partialize: (s) => ({ tabs: s.tabs, active: s.active, paneOpen: s.paneOpen, paneWidth: s.paneWidth, mru: s.mru }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 恢复时自检：宽度钳制；active 不在 tabs 里就回退（配置被改过/面板被下线）
        state.paneWidth = clampPaneWidth(state.paneWidth ?? PANE_DEFAULT);
        if (state.active && !state.tabs.includes(state.active)) state.active = state.tabs[0] ?? null;
        if (state.tabs.length === 0) state.paneOpen = false;
      },
    },
  ),
);
