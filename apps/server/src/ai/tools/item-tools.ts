// ============================================================
// 物品相关工具 — create_item / update_item
// ============================================================

import { registerTools, type ToolHandlerResult, type ToolContext } from './registry.js';
import {
  createItem,
  updateItem,
  getItem,
  listItems,
} from '../../services/item-service.js';

const createItemTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'create_item',
      description: '在当前项目中创建一个新物品。必填字段为 name。物品可以是武器、信物、法器等。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '物品名称（必填）' },
          type: { type: 'string', description: '物品类型（武器/信物/法器/消耗品等）' },
          description: { type: 'string', description: '物品描述' },
          color: { type: 'string', description: '高亮颜色（hex）' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolHandlerResult> => {
    const name = String(args.name ?? '').trim();
    if (!name) {
      return { success: false, result: '错误：name 不能为空' };
    }
    const item = await createItem(
      {
        id: '',
        projectId: ctx.projectId,
        name,
        type: args.type as string | undefined,
        description: args.description as string | undefined,
        color: args.color as string | undefined,
        holders: [],
        currentHolders: [],
        relations: [],
        states: [],
        chapters: [],
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
      },
      ctx.projectId,
    );
    return {
      success: true,
      result: `已创建物品「${name}」（id: ${item.id}）。`,
      entity: { type: 'item', action: 'create', id: item.id, name },
    };
  },
};

const updateItemTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'update_item',
      description: '更新现有物品。必须提供 id 或 name（用于模糊匹配）。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '物品 ID（优先使用）' },
          name: { type: 'string', description: '物品名（用于模糊匹配）' },
          newName: { type: 'string', description: '修改后的名称' },
          type: { type: 'string', description: '物品类型' },
          description: { type: 'string', description: '物品描述' },
          color: { type: 'string', description: '高亮颜色（hex）' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表（整体替换）',
          },
        },
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolHandlerResult> => {
    let itemId = args.id as string | undefined;
    let itemName = args.name as string | undefined;

    if (!itemId && itemName) {
      const list = await listItems(ctx.projectId);
      const found = list.find((i) => i.name === itemName || i.name.includes(itemName!));
      if (!found) {
        return { success: false, result: `错误：未找到名为「${itemName}」的物品` };
      }
      itemId = found.id;
      itemName = found.name;
    }

    if (!itemId) {
      return { success: false, result: '错误：必须提供 id 或 name' };
    }

    const existing = await getItem(itemId, ctx.projectId);
    if (!existing) {
      return { success: false, result: `错误：未找到 id 为 ${itemId} 的物品` };
    }

    const updates: Record<string, unknown> = {};
    if (args.newName !== undefined) updates.name = String(args.newName);
    if (args.type !== undefined) updates.type = String(args.type);
    if (args.description !== undefined) updates.description = String(args.description);
    if (args.color !== undefined) updates.color = String(args.color);
    if (args.tags !== undefined) updates.tags = args.tags;

    await updateItem(itemId, updates, ctx.projectId);
    return {
      success: true,
      result: `已更新物品「${itemName ?? existing.name}」（id: ${itemId}），更新了 ${Object.keys(updates).length} 个字段。`,
      entity: { type: 'item', action: 'update', id: itemId, name: itemName ?? existing.name },
    };
  },
};

registerTools([createItemTool, updateItemTool]);
