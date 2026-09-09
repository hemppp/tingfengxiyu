import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsOptions {
  /** 唤起查找替换浮层 */
  onFind?: () => void;
  /** 关闭查找替换浮层 */
  onCloseFind?: () => void;
}

/**
 * 编辑器快捷键注册
 * - Ctrl+S / Cmd+S: 阻止默认保存行为（已有自动保存）
 * - Ctrl+P / Cmd+P: 阻止默认打印行为
 * - Ctrl+F / Cmd+F: 唤起查找替换
 * - Esc: 关闭查找替换（由 FindReplaceBar 内部处理）
 */
export function useKeyboardShortcuts({ onFind, onCloseFind }: KeyboardShortcutsOptions = {}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === 's') {
      e.preventDefault();
    }
    if (meta && e.key === 'p') {
      e.preventDefault();
    }
    if (meta && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      onFind?.();
    }
    if (e.key === 'Escape' && !meta) {
      // 由 FindReplaceBar 内部 input 的 onKeyDown 优先处理
      // 这里作为兜底：当焦点不在 input 上时按 Esc 关闭
      onCloseFind?.();
    }
  }, [onFind, onCloseFind]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
