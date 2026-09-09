import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

// ============================================================
// editorStore — 全局编辑器实例引用
// ------------------------------------------------------------
// 编辑器实例由 useEditorInstance 创建并写入此 store，
// 供兄弟组件（如 ChatPanel）读取，打通"应用到正文"链路。
// 不存储任何内容副本，仅持有实例引用，组件卸载时置空。
// ============================================================

interface EditorState {
  /** 当前编辑器实例（可能为 null：未进入编辑页 / 已卸载） */
  editor: Editor | null;
  /** 写入编辑器实例（EditorPage 挂载时调用） */
  setEditor: (editor: Editor | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}));
