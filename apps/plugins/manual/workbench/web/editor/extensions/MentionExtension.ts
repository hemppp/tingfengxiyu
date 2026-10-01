import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { RawCommands } from '@tiptap/core';

export interface MentionOptions {
 suggestion: {
 char: string;
 items: () => Promise<string[]>;
 render: () => string;
 };
}

export const MentionExtension = Extension.create<MentionOptions>({
 name: 'mention',

 addOptions() {
 return {
 suggestion: {
 char: '@',
 items: async () => [], // Will be provided by the component
 render: () => {
 // 由组件渲染
 return '<div class="mention-suggestion">加载中...</div>';
 },
 },
 };
 },

 addCommands() {
 return {
 setMention: (attrs: { id: string; display: string }) => ({ commands }: { commands: RawCommands }) => {
 return commands.setMark('mention', attrs);
 },
 clearMention: () => ({ commands }: { commands: RawCommands }) => {
 return commands.unsetMark('mention');
 },
 } as Partial<RawCommands>;
 },

 addMarks() {
 return {
 mention: {
 name: 'mention',
 inclusive: false,
 parseHTML(element: HTMLElement) {
 return {
 id: element.getAttribute('data-entity-id'),
 display: element.getAttribute('data-display'),
 };
 },
 toHTML(mark: { attrs: { id: string | null; display: string | null } }) {
 return [
 'span',
 {
 'data-entity-id': mark.attrs.id,
 'data-display': mark.attrs.display,
 class: 'mention',
 },
 mark.attrs.display,
 ];
 },
 },
 };
 },

 addProseMirrorPlugins() {
 return [
 new Plugin({
 key: new PluginKey('mention'),
 props: {
 // 处理键盘事件以触发建议
 handleKeyDown: (view, event) => {
 const { state } = view;
 const { selection } = state;
 const { from } = selection;
 
 // 检查用户是否输入了 @
 if (event.key === this.options.suggestion.char) {
 const $pos = state.doc.resolve(from);
 const before = $pos.before();
 const textBefore = state.doc.textBetween(before - 1, before);
 
 if (textBefore === this.options.suggestion.char) {
 // 触发建议
 const suggestionEvent = new CustomEvent('mention-trigger', {
 detail: {
 pos: from,
 char: this.options.suggestion.char
 },
 bubbles: true,
 });
 document.dispatchEvent(suggestionEvent);
 return true;
 }
 }
 
 return false;
 },
 },
 }),
 ];
 },
});