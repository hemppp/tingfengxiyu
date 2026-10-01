// ============================================================
// 章节跳转信号 store — 用于跨组件通信"从时间线跳转到章节"
// EditorPage 监听 jumpSignal 变化，滚动到目标段落并触发高亮动画
// ============================================================

import { create } from 'zustand';

interface ChapterJumpState {
  /** 跳转信号：每次跳转递增的序号。EditorPage 监听此值变化 */
  jumpSignal: number;
  /** 目标段落锚点：事件标题或关键文本，用于在编辑器中定位段落 */
  jumpAnchor: string | null;
  /** 触发跳转高亮信号 */
  triggerJumpHighlight: (anchor?: string) => void;
}

export const useChapterJumpStore = create<ChapterJumpState>((set) => ({
  jumpSignal: 0,
  jumpAnchor: null,
  triggerJumpHighlight: (anchor) =>
    set((state) => ({
      jumpSignal: state.jumpSignal + 1,
      jumpAnchor: anchor ?? null,
    })),
}));
