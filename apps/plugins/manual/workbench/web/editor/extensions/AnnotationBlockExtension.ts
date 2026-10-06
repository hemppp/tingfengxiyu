/**
 * 内嵌批注块 —— Tiptap 块级 Node 扩展
 *
 * 与既有的 `AnnotationExtension`（offset 锚定的 inline Mark）并列存在，二者不冲突：
 *   · Mark   = 给**已有正文**套标记（下划线式）；
 *   · 本 Node = 独立于正文的**块级批注卡片**（浅灰底 + 左侧强调条 + 类型徽标 + 自由文本）。
 *
 * 持久化：批注块是普通文档节点，`editor.getHTML()` 会输出
 *   `<div data-annotation-block="true" class="nm-annotation-block" data-kind="…" data-state="open">文本</div>`
 * 因此它随章节 `content` 走现有的 PUT /api/chapters/:id，无需额外接口。
 *
 * `priority: 1000` 是刻意的：Tiptap 的 `addKeyboardShortcuts` 每个扩展各注册一个
 * prosemirror-keymap 插件，**插件顺序即优先级**，而 StarterKit 的 baseKeymap 也绑了
 * Enter（splitBlock）。此处必须让「Enter 跳出批注块」先于 StarterKit 生效。
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { createAnnotationBlockNodeView } from './AnnotationBlockView';
import {
  ANNOTATION_BLOCK_ATTR,
  ANNOTATION_BLOCK_CLASS,
  ANNOTATION_BLOCK_KIND_ATTR,
  ANNOTATION_BLOCK_NODE_NAME,
  ANNOTATION_BLOCK_STATE_ATTR,
  DEFAULT_ANNOTATION_KIND,
  normalizeAnnotationBlockState,
  normalizeAnnotationKind,
  type AnnotationBlockState,
} from '../annotationBlocks';

export interface AnnotationBlockOptions {
  /** 新插入批注块的缺省类型标记 */
  defaultKind: string;
  /** 新插入批注块的占位正文（插入后会被整体选中，直接输入即替换） */
  defaultText: string;
  HTMLAttributes: Record<string, unknown>;
}

export interface InsertAnnotationBlockOptions {
  /** 类型标记；传 null / 空串则不写 data-kind */
  kind?: string | null;
  state?: AnnotationBlockState;
  /** 初始正文；传空串则插入空块 */
  text?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    annotationBlock: {
      /** 在当前块之后插入一个内嵌批注块，并把光标/选区落在其正文里 */
      insertAnnotationBlock: (options?: InsertAnnotationBlockOptions) => ReturnType;
    };
  }
}

export const AnnotationBlockExtension = Node.create<AnnotationBlockOptions>({
  name: ANNOTATION_BLOCK_NODE_NAME,

  // 让 Enter 跳出批注块的快捷键先于 StarterKit 的 baseKeymap 生效（详见文件头注释）
  priority: 1000,

  group: 'block',
  content: 'inline*',
  // defining：清空块内容时保留块本身，且与相邻块合并时不会被吃掉
  defining: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      defaultKind: DEFAULT_ANNOTATION_KIND,
      defaultText: '在此写批注内容',
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      kind: {
        default: null,
        parseHTML: (element: HTMLElement) => normalizeAnnotationKind(element.getAttribute(ANNOTATION_BLOCK_KIND_ATTR)),
        // 属性缺失时不输出空 data-kind，保证 HTML 往返稳定
        renderHTML: (attributes: Record<string, unknown>) => {
          const kind = normalizeAnnotationKind(attributes.kind);
          return kind ? { [ANNOTATION_BLOCK_KIND_ATTR]: kind } : {};
        },
      },
      state: {
        default: 'open',
        parseHTML: (element: HTMLElement) => normalizeAnnotationBlockState(element.getAttribute(ANNOTATION_BLOCK_STATE_ATTR)),
        renderHTML: (attributes: Record<string, unknown>) => ({
          [ANNOTATION_BLOCK_STATE_ATTR]: normalizeAnnotationBlockState(attributes.state),
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: `div[${ANNOTATION_BLOCK_ATTR}]` },
      // 兜底：只有类名（手工粘贴 / 旧数据）也认
      { tag: `div.${ANNOTATION_BLOCK_CLASS}` },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        [ANNOTATION_BLOCK_ATTR]: 'true',
        class: ANNOTATION_BLOCK_CLASS,
      }),
      0,
    ];
  },

  addNodeView() {
    return createAnnotationBlockNodeView();
  },

  addCommands() {
    return {
      insertAnnotationBlock:
        (options: InsertAnnotationBlockOptions = {}) =>
        ({ chain, state }: CommandProps) => {
          const kind = normalizeAnnotationKind(options.kind === undefined ? this.options.defaultKind : options.kind);
          const blockState = normalizeAnnotationBlockState(options.state);
          const text = options.text === undefined ? this.options.defaultText : options.text;

          const { $from } = state.selection;
          // 深度 0（整块被选中）时插到当前 doc 位置，否则插到「当前所在块的后面」
          const insertPos = $from.depth === 0 ? $from.pos : $from.after($from.depth);

          const block = {
            type: ANNOTATION_BLOCK_NODE_NAME,
            attrs: { kind, state: blockState },
            content: text ? [{ type: 'text', text }] : [],
          };

          return chain()
            .insertContentAt(insertPos, block)
            // 把选区落在批注块正文上（有占位文本时整体选中，直接输入即替换）
            .setTextSelection({ from: insertPos + 1, to: insertPos + 1 + text.length })
            .focus()
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // 插入批注块（与手写台既有快捷键无冲突：useKeyboardShortcuts 只占 Ctrl/Cmd+S、+P、+F、Escape）
      'Mod-Alt-a': () => this.editor.commands.insertAnnotationBlock(),
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        // 从光标所在深度向上找批注块（正文是 inline*，故批注块必然在父级链上）
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name !== ANNOTATION_BLOCK_NODE_NAME) continue;
          // Enter = 跳出批注块，在它后面新起一个段落（块内换行请用 Shift+Enter）
          return this.editor.commands.insertContentAt($from.after(depth), { type: 'paragraph' });
        }
        return false;
      },
    };
  },
});
