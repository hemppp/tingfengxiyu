import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// 主角 / 女主角名字高亮：用 ProseMirror Decoration 自动给文中出现的
// 主角（role=protagonist）和女主角（role=femaleLead）名字加上蓝色文字样式，
// 点击后派发事件打开角色面板。

export interface LeadCharacterHighlightOptions {
  /** 主角和女主角的名字列表（含别名），变化时重建 decoration */
  names: string[];
}

const pluginKey = new PluginKey<DecorationSet>('leadCharacterHighlight');

export const LeadCharacterHighlight = Extension.create<LeadCharacterHighlightOptions>({
  name: 'leadCharacterHighlight',

  addOptions() {
    return {
      names: [],
    };
  },

  addProseMirrorPlugins() {
    const names = (this.options.names ?? []).filter(Boolean).sort((a, b) => b.length - a.length);

    return [
      new Plugin<DecorationSet>({
        key: pluginKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc, names);
          },
          apply(tr, old) {
            if (tr.docChanged || tr.getMeta('leadCharacterHighlightUpdate')) {
              return buildDecorations(tr.doc, names);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
          handleDOMEvents: {
            click: (_view, event) => {
              const target = event.target as HTMLElement;
              if (!target) return false;
              const name = target.getAttribute('data-lead-name');
              if (!name) return false;
              event.preventDefault();
              window.dispatchEvent(new CustomEvent('nm:open-panel', {
                detail: { key: 'characters' },
              }));
              return true;
            },
          },
        },
      }),
    ];
  },
});

function buildDecorations(
  doc: { descendants: (cb: (node: { isText: boolean; text?: string }, pos: number) => void) => void },
  names: string[],
): DecorationSet {
  if (names.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const name of names) {
      if (!name) continue;
      let from = 0;
      while ((from = text.indexOf(name, from)) !== -1) {
        const start = pos + from;
        const end = start + name.length;
        decorations.push(
          Decoration.inline(start, end, {
            class: 'lead-character-name',
            'data-lead-name': name,
            style: 'color: hsl(217, 71%, 52%); cursor: pointer;',
          }),
        );
        from += name.length;
      }
    }
  });

  return DecorationSet.create(doc as Parameters<typeof DecorationSet.create>[0], decorations);
}
