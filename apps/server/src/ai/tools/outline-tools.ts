// ============================================================
// 大纲相关工具 — set_outline_core_conflict / set_chapter_outline / set_outline_section
//
// ★ 特殊说明：大纲数据存储在前端 localStorage（useOutlineNotepadStore），
//   后端无数据库表。因此这些工具的 handler 不做实际持久化，
//   而是返回成功 + payload，由前端 onToolResult 回调拦截 entity.type==='outline'
//   并写入 useOutlineNotepadStore。
//
//   handler 的职责：
//   1. 校验参数合法性
//   2. 返回结构化 payload 供前端使用
//   3. 返回成功消息给 LLM（让对话自然继续）
// ============================================================

import { registerTools, type ToolHandlerResult } from './registry.js';

// ---- 工具定义 ----

const setOutlineCoreConflictTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'set_outline_core_conflict',
      description: '设置或更新大纲的"核心冲突"文本。核心冲突描述主角想要什么、谁在阻止、冲突根源。调用后内容会立即填入大纲编辑器的核心冲突文本框。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '核心冲突的完整文本（一段话描述主角欲望、对立面、冲突根源与升级路径）',
          },
          merge: {
            type: 'boolean',
            description: '是否追加到已有内容末尾（false=覆盖，默认 false）',
          },
        },
        required: ['text'],
      },
    },
  },
  handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
    const text = String(args.text ?? '').trim();
    if (!text) {
      return { success: false, result: '错误：text 不能为空' };
    }
    const merge = args.merge === true;
    return {
      success: true,
      result: `已${merge ? '追加' : '设置'}核心冲突内容（${text.length} 字）。内容已填入大纲编辑器。`,
      entity: {
        type: 'outline',
        action: 'update',
        name: '核心冲突',
        payload: { field: 'core_conflict', text, merge },
      },
    };
  },
};

const setChapterOutlineTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'set_chapter_outline',
      description: '设置或更新某一章的大纲细节。通过 chapter_title（章节标题）或 chapter_order（章节序号，从1开始）指定目标章节。调用后内容会立即填入大纲编辑器对应章节的细节文本框。',
      parameters: {
        type: 'object',
        properties: {
          chapter_title: {
            type: 'string',
            description: '目标章节的标题（精确匹配章节列表中的标题）',
          },
          chapter_order: {
            type: 'number',
            description: '目标章节的序号（从1开始，如第1章=1）',
          },
          text: {
            type: 'string',
            description: '该章节的大纲细节文本（核心事件、冲突推进、角色行动、伏笔铺设/回收、章节结尾钩子）',
          },
          merge: {
            type: 'boolean',
            description: '是否追加到已有内容末尾（false=覆盖，默认 false）',
          },
        },
        required: ['text'],
      },
    },
  },
  handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
    const text = String(args.text ?? '').trim();
    if (!text) {
      return { success: false, result: '错误：text 不能为空' };
    }
    const chapterTitle = args.chapter_title ? String(args.chapter_title).trim() : '';
    const chapterOrder = typeof args.chapter_order === 'number' ? args.chapter_order : undefined;
    if (!chapterTitle && chapterOrder === undefined) {
      return { success: false, result: '错误：必须提供 chapter_title 或 chapter_order' };
    }
    const merge = args.merge === true;
    const target = chapterTitle || `第${chapterOrder}章`;
    return {
      success: true,
      result: `已${merge ? '追加' : '设置'}「${target}」的大纲细节（${text.length} 字）。内容已填入大纲编辑器。`,
      entity: {
        type: 'outline',
        action: 'update',
        name: target,
        payload: { field: 'chapter_detail', chapterTitle, chapterOrder, text, merge },
      },
    };
  },
};

const setOutlineSectionTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'set_outline_section',
      description: '设置或更新大纲的自由笔记分区内容（如"一句话故事""核心主题""故事背景""主要人物""结构框架"等）。通过 title 匹配分区标题，匹配不到则创建新分区。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '分区标题（如"一句话故事""核心主题""故事背景""主要人物""结构框架"等）',
          },
          content: {
            type: 'string',
            description: '分区的完整内容文本',
          },
          merge: {
            type: 'boolean',
            description: '是否追加到已有内容末尾（false=覆盖，默认 false）',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  handler: async (args: Record<string, unknown>): Promise<ToolHandlerResult> => {
    const title = String(args.title ?? '').trim();
    const content = String(args.content ?? '').trim();
    if (!title) {
      return { success: false, result: '错误：title 不能为空' };
    }
    if (!content) {
      return { success: false, result: '错误：content 不能为空' };
    }
    const merge = args.merge === true;
    return {
      success: true,
      result: `已${merge ? '追加' : '设置'}大纲分区「${title}」的内容（${content.length} 字）。内容已填入大纲编辑器。`,
      entity: {
        type: 'outline',
        action: 'update',
        name: title,
        payload: { field: 'section', title, content, merge },
      },
    };
  },
};

// ---- 注册 ----

registerTools([
  setOutlineCoreConflictTool,
  setChapterOutlineTool,
  setOutlineSectionTool,
]);
