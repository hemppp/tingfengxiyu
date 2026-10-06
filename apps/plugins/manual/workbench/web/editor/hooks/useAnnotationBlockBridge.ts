/**
 * 把「本章未解决批注数量」发布给外壳（底部细条「N 条问题 Ctrl+J」）
 *
 * 外壳不需要 import 本插件内部文件即可消费，三条通道任选（见 `../annotationBlocks`）：
 *   · `annotationBlockBridge.subscribe(...)` / `getSnapshot()`
 *   · `window.__novelmuseAnnotationBlocks`
 *   · `window.addEventListener('novelmuse:annotation-blocks', ...)`
 *
 * 触发时机：挂载、章节切换、以及编辑器任意 transaction（含 setContent 这种
 * `emitUpdate=false` 的静默替换 —— 章节切换正是走这条路，只监听 'update' 会漏）。
 */

import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import {
  countAnnotationBlocks,
  publishAnnotationBlockSummary,
  resetAnnotationBlockSummary,
} from '../annotationBlocks';

/** 连续输入时的发布节流（与字数统计的 80ms 同量级，避免每个字符都序列化整篇文档） */
const PUBLISH_DEBOUNCE_MS = 150;

export function useAnnotationBlockBridge(editor: Editor | null, chapterId: string | null): void {
  useEffect(() => {
    if (!editor) {
      resetAnnotationBlockSummary();
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const publishNow = () => {
      publishAnnotationBlockSummary(countAnnotationBlocks(editor.getHTML()), chapterId);
    };

    const schedulePublish = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        publishNow();
      }, PUBLISH_DEBOUNCE_MS);
    };

    // 立即发布一次，并在下一 macrotask 再补一次：章节切换的 setContent 可能排在本
    // effect 之后执行（取决于调用顺序），补一次可避免读到上一章的批注块。
    publishNow();
    const settleTimer = setTimeout(publishNow, 0);

    editor.on('transaction', schedulePublish);

    return () => {
      editor.off('transaction', schedulePublish);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      clearTimeout(settleTimer);
      resetAnnotationBlockSummary();
    };
  }, [editor, chapterId]);
}
