// ============================================================
// 浮窗面板开闭状态 —— ProjectLayout 与 EditorPanelRail 共享
//
// 此前 openPanelKeys 是 ProjectLayout 的局部 state，编辑器内的
// 插件面板栏无法感知/切换面板。上移到 store 后：
//   - ProjectLayout 顶栏与编辑器面板栏读写同一份状态
//   - ForeshadowWarning 的 nm:open-panel 事件链路保持不变
// 受限浮窗上限（MAX_OPEN_PANELS）逻辑随状态一起迁移。
// ============================================================

import { create } from 'zustand';

/** 受限浮窗最多同时打开数（章节与 AI 对话面板不在此列） */
export const MAX_OPEN_PANELS = 3;

interface PanelOpenState {
  /** 已打开的受限浮窗 key（按打开顺序，超出上限淘汰最早的） */
  keys: string[];
  /** 打开面板（已打开则为空操作） */
  open: (key: string) => void;
  /** 切换面板：未打开则打开，已打开则关闭 */
  toggle: (key: string) => void;
  /** 关闭面板 */
  close: (key: string) => void;
}

export const usePanelOpenStore = create<PanelOpenState>((set) => ({
  keys: [],

  open: (key) =>
    set((state) => {
      if (state.keys.includes(key)) return state;
      const next = state.keys.concat(key);
      return { keys: next.length > MAX_OPEN_PANELS ? next.slice(next.length - MAX_OPEN_PANELS) : next };
    }),

  toggle: (key) =>
    set((state) => {
      if (state.keys.includes(key)) {
        return { keys: state.keys.filter((k) => k !== key) };
      }
      const next = state.keys.concat(key);
      return { keys: next.length > MAX_OPEN_PANELS ? next.slice(next.length - MAX_OPEN_PANELS) : next };
    }),

  close: (key) =>
    set((state) => ({ keys: state.keys.filter((k) => k !== key) })),
}));
