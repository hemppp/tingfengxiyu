// ============================================================
// 势力名高亮 —— 演示 ctx.registerEditorExtension 扩展点
//
// 正文中出现的势力名加下划虚线并可点击打开势力面板。
// 势力列表由插件 Web 面维护（factionNames），变更时派发
// FACTION_NAMES_EVENT，扩展在 view 层订阅并派发 meta 事务重算装饰。
// ============================================================

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const pluginKey = new PluginKey<DecorationSet>('worldbuildingFactionHighlight');

/** 势力名变更事件：插件面板加载/新增势力后派发 */
export const FACTION_NAMES_EVENT = 'novel.worldbuilding:faction-names';

/** 当前势力名（模块级共享；扩展与面板同处一个插件 bundle） */
let factionNames: string[] = [];

export function setFactionNames(names: string[]): void {
  factionNames = names.filter((n) => typeof n === 'string' && n.trim().length > 0);
  window.dispatchEvent(new CustomEvent(FACTION_NAMES_EVENT));
}

interface TextNodeLike {
  isText: boolean;
  text?: string;
}

interface DocLike {
  descendants: (cb: (node: TextNodeLike, pos: number) => void) => void;
}

function buildDecorations(doc: DocLike): DecorationSet {
  // 长名优先匹配，避免短名先命中把长名切碎
  const names = [...factionNames].sort((a, b) => b.length - a.length);
  if (names.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const name of names) {
      let from = 0;
      while ((from = text.indexOf(name, from)) !== -1) {
        const start = pos + from;
        decorations.push(
          Decoration.inline(start, start + name.length, {
            class: 'wb-faction-name',
            'data-faction-name': name,
            style: 'border-bottom: 1px dashed hsl(174, 30%, 45%); cursor: pointer;',
          }),
        );
        from += name.length;
      }
    }
  });
  return DecorationSet.create(doc as Parameters<typeof DecorationSet.create>[0], decorations);
}

export const FactionHighlight = Extension.create({
  name: 'worldbuildingFactionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pluginKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, old) {
            if (tr.docChanged || tr.getMeta(pluginKey)) {
              return buildDecorations(tr.doc);
            }
            return old;
          },
        },
        // 势力名变更时派发一个只带 meta 的空事务，触发装饰重算
        view(view) {
          const refresh = () => {
            view.dispatch(view.state.tr.setMeta(pluginKey, true));
          };
          window.addEventListener(FACTION_NAMES_EVENT, refresh);
          return {
            destroy() {
              window.removeEventListener(FACTION_NAMES_EVENT, refresh);
            },
          };
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
          handleDOMEvents: {
            click: (_view, event) => {
              const target = event.target as HTMLElement | null;
              const name = target?.getAttribute('data-faction-name');
              if (!name) return false;
              event.preventDefault();
              window.dispatchEvent(new CustomEvent('nm:open-panel', { detail: { key: 'factions' } }));
              return true;
            },
          },
        },
      }),
    ];
  },
});
