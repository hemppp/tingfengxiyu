import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface AnnotationOptions {
  types: string[];
  colors: Record<string, string>;
}

export const AnnotationExtension = Extension.create<AnnotationOptions>({
  name: 'annotation',

  addOptions() {
    return {
      types: ['character', 'item', 'location', 'foreshadow', 'event', 'relation'],
      colors: {
        character: 'blue',
        item: 'green',
        location: 'purple',
        foreshadow: 'amber',
        event: 'red',
        relation: 'pink',
      },
    };
  },

  addMarks() {
    return {
      annotation: {
        name: 'annotation',
        inclusive: false,
        parseHTML(element: HTMLElement) {
          return {
            id: element.getAttribute('data-annotation-id'),
            type: element.getAttribute('data-type'),
          };
        },
        toHTML(mark: { attrs: { id: string | null; type: string | null } }) {
          return [
            'span',
            {
              'data-annotation-id': mark.attrs.id,
              'data-type': mark.attrs.type,
              class: `annotation-${mark.attrs.type}`,
            },
            0,
          ];
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('annotation'),
        props: {
          // Handle clicks on 批注
          handleDOMEvents: {
            click: (view, event) => {
              const { state } = view;
              const { selection } = state;
              const { from } = selection;
              
              // Check if clicked on an 批注
              const $pos = state.doc.resolve(from);
              const mark = $pos.marks().find((mark) => mark.type.name === 'annotation');
              
              if (mark) {
                event.preventDefault();
                
                // Dispatch 自定义 事件 为 selection 菜单
                const annotationId = mark.attrs.id;
                const annotationType = mark.attrs.type;
                
                const clickEvent = new CustomEvent('annotation-click', {
                  detail: { annotationId, annotationType },
                  bubbles: true,
                });
                
                document.dispatchEvent(clickEvent);
                return true;
              }
              
              return false;
            },
          },
        },
      }),
    ];
  },
});