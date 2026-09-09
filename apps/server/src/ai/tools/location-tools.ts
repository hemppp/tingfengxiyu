// ============================================================
// 地点相关工具 — create_location / update_location
// ============================================================

import { registerTools, type ToolHandlerResult, type ToolContext } from './registry.js';
import {
  createLocation,
  updateLocation,
  getLocation,
  listLocations,
} from '../../services/location-service.js';

const createLocationTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'create_location',
      description: '在当前项目中创建一个新地点。必填字段为 name。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '地点名称（必填）' },
          description: { type: 'string', description: '地点描述' },
          world: { type: 'string', description: '所属世界（多世界/穿越小说使用）' },
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
    const location = await createLocation(
      {
        id: '',
        projectId: ctx.projectId,
        name,
        description: args.description as string | undefined,
        world: args.world as string | undefined,
        color: args.color as string | undefined,
        states: [],
        chapters: [],
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
      },
      ctx.projectId,
    );
    return {
      success: true,
      result: `已创建地点「${name}」（id: ${location.id}）。`,
      entity: { type: 'location', action: 'create', id: location.id, name },
    };
  },
};

const updateLocationTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'update_location',
      description: '更新现有地点。必须提供 id 或 name（用于模糊匹配）。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '地点 ID（优先使用）' },
          name: { type: 'string', description: '地点名（用于模糊匹配）' },
          newName: { type: 'string', description: '修改后的名称' },
          description: { type: 'string', description: '地点描述' },
          world: { type: 'string', description: '所属世界' },
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
    let locId = args.id as string | undefined;
    let locName = args.name as string | undefined;

    if (!locId && locName) {
      const list = await listLocations(ctx.projectId);
      const found = list.find((l) => l.name === locName || l.name.includes(locName!));
      if (!found) {
        return { success: false, result: `错误：未找到名为「${locName}」的地点` };
      }
      locId = found.id;
      locName = found.name;
    }

    if (!locId) {
      return { success: false, result: '错误：必须提供 id 或 name' };
    }

    const existing = await getLocation(locId, ctx.projectId);
    if (!existing) {
      return { success: false, result: `错误：未找到 id 为 ${locId} 的地点` };
    }

    const updates: Record<string, unknown> = {};
    if (args.newName !== undefined) updates.name = String(args.newName);
    if (args.description !== undefined) updates.description = String(args.description);
    if (args.world !== undefined) updates.world = String(args.world);
    if (args.color !== undefined) updates.color = String(args.color);
    if (args.tags !== undefined) updates.tags = args.tags;

    await updateLocation(locId, updates, ctx.projectId);
    return {
      success: true,
      result: `已更新地点「${locName ?? existing.name}」（id: ${locId}），更新了 ${Object.keys(updates).length} 个字段。`,
      entity: { type: 'location', action: 'update', id: locId, name: locName ?? existing.name },
    };
  },
};

registerTools([createLocationTool, updateLocationTool]);
