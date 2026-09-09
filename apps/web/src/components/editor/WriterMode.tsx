import { useState, useEffect, useRef } from 'react';
import { EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { useChapterStore } from '@/stores';
import { X } from 'lucide-react';

interface WriterModeProps {
  /** 接收父组件的 编辑器 实例，不自己创建 */
  editor: Editor | null;
  onExit: () => void;
}

/**
 * 沉浸式写作 — 全屏专注层：背景完全透明（透出环境层），正文样式由
 * EditorPage 的全局 .ProseMirror 规则接管（信纸横线 + 居中 + 1.9 行高），与外面一致。
 * 按 Esc 或点击右上角退出；不创建独立编辑器实例。
 */
export function WriterMode({ editor, onExit }: WriterModeProps) {
  const currentChapter = useChapterStore(s => s.getCurrentChapter());
  const [showHint, setShowHint] = useState(true);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Esc 退出
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onExit]);

  // 3秒后隐藏提示
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // 自动聚焦到编辑器
  useEffect(() => {
    editor?.commands.focus();
  }, [editor]);

  if (!editor) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: 'transparent' }}
      >
        <p style={{ color: 'hsl(var(--ink-pale))', fontSize: '14px' }}>编辑器加载中...</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: 'transparent' }}
      onClick={() => editor.commands.focus()}
      role="application"
      aria-label="沉浸式写作 - 全屏专注模式"
    >
      {/* 退出按钮（鼠标悬停时显示） */}
      <button
        onClick={onExit}
        className="absolute top-4 right-4 p-2 transition-colors"
        style={{ color: 'hsl(var(--ink-pale))', background: 'transparent', border: 'none', cursor: 'pointer' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'hsl(var(--ink))'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'hsl(var(--ink-pale))'; }}
        title="退出沉浸模式 (Esc)"
        aria-label="退出沉浸模式"
      >
        <X size={20} aria-hidden="true" />
      </button>

      {/* 启动提示 */}
      {showHint && (
        <div
          className="absolute top-1/3 text-sm animate-pulse"
          style={{ color: 'hsl(var(--ink-pale))' }}
          aria-live="polite"
        >
          Esc 退出
        </div>
      )}

      {/* 编辑器 — 字体/行高/居中/信纸横线全部由全局 .ProseMirror 规则提供，与外面一致 */}
      <div className="w-full max-w-2xl h-full flex flex-col px-12 py-20" ref={editorContainerRef}>
        {currentChapter && (
          <h1
            className="text-xl mb-8 font-serif text-center"
            style={{ color: 'hsl(var(--ink) / 0.55)', fontWeight: 500 }}
          >
            {currentChapter.title}
          </h1>
        )}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* 底部：极简状态 */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-6 text-xs"
        style={{ color: 'hsl(var(--ink-pale))' }}
      >
        <span>
          {currentChapter?.wordCount.toLocaleString() || 0} 字
        </span>
      </div>
    </div>
  );
}
