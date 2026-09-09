import Highlight from '@tiptap/extension-highlight';

const COLOR_CLASS_MAP: Record<string, string> = {
  'rgba(59, 130, 246, 0.12)': 'highlight-blue',
  'rgba(34, 197, 94, 0.12)': 'highlight-green',
  'rgba(168, 85, 247, 0.12)': 'highlight-purple',
  'rgba(245, 158, 11, 0.12)': 'highlight-amber',
  'rgba(239, 68, 68, 0.12)': 'highlight-red',
  'rgba(236, 72, 153, 0.12)': 'highlight-pink',
};

export const CustomHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-color') || element.style.backgroundColor || undefined,
        renderHTML: (attributes: { color?: string }) => {
          if (!attributes.color) return {};
          const className = COLOR_CLASS_MAP[attributes.color] || '';
          return {
            'data-color': attributes.color,
            class: className,
          };
        },
      },
    };
  },
});