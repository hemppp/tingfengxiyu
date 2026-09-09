// ============================================================
// 伏笔相关工具 — create_foreshadow / update_foreshadow
// ============================================================

import { registerTools, type ToolHandlerResult, type ToolContext } from './registry.js';
import {
  createForeshadow,
  updateForeshadow,
  getForeshadow,
  listForeshadows,
} from '../../services/foreshadow-service.js';

const createForeshadowTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'create_foreshadow',
      description: '创建一个新伏笔。伏笔是预先埋下的线索，后续可回收形成反转或揭示。必填字段为 description、type、seedChapter。',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '伏笔的一句话描述（必填）' },
          type: {
            type: 'string',
            enum: ['identity', 'motivation', 'relation', 'trauma', 'turning', 'fate'],
            description: '伏笔类型：identity=身份, motivation=动机, relation=关系, trauma=创伤, turning=转折, fate=命运（必填）',
          },
          seedChapter: { type: 'integer', minimum: 1, description: '播种章节序号（必填，1-based）' },
          seedText: { type: 'string', description: '播种位置的文字描述' },
          status: {
            type: 'string',
            enum: ['planted', 'hinted', 'payed_off', 'abandoned'],
            description: '初始状态，默认 planted',
          },
          relatedCharacters: {
            type: 'array',
            items: { type: 'string' },
            description: '关联角色 ID 列表',
          },
          relatedItems: {
            type: 'array',
            items: { type: 'string' },
            description: '关联物品 ID 列表',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表',
          },
        },
        required: ['description', 'type', 'seedChapter'],
      },
    },
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolHandlerResult> => {
    const description = String(args.description ?? '').trim();
    if (!description) {
      return { success: false, result: '错误：description 不能为空' };
    }
    if (args.seedChapter === undefined || args.seedChapter === null) {
      return { success: false, result: '错误：seedChapter 不能为空' };
    }
    const foreshadow = await createForeshadow(
      {
        id: '',
        projectId: ctx.projectId,
        description,
        type: args.type as 'identity' | 'motivation' | 'relation' | 'trauma' | 'turning' | 'fate',
        status: (args.status as 'planted' | 'hinted' | 'payed_off' | 'abandoned') ?? 'planted',
        seedChapter: Number(args.seedChapter),
        seedText: args.seedText as string | undefined,
        relatedCharacters: Array.isArray(args.relatedCharacters) ? (args.relatedCharacters as string[]) : [],
        relatedItems: Array.isArray(args.relatedItems) ? (args.relatedItems as string[]) : [],
        relatedEvents: [],
        earmarks: [],
        hints: [],
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
      },
      ctx.projectId,
    );
    return {
      success: true,
      result: `已创建伏笔「${description.slice(0, 30)}…」（id: ${foreshadow.id}，类型: ${args.type}，播种于第${args.seedChapter}章）。`,
      entity: { type: 'foreshadow', action: 'create', id: foreshadow.id },
    };
  },
};

const updateForeshadowTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'update_foreshadow',
      description: '更新现有伏笔。必须提供 id 或通过 description 模糊匹配。常用于更新状态（如 planted→payed_off）或补充 payoffChapter。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '伏笔 ID（优先使用）' },
          description: { type: 'string', description: '伏笔描述（用于模糊匹配，若无 id）' },
          newDescription: { type: 'string', description: '修改后的描述' },
          status: {
            type: 'string',
            enum: ['planted', 'hinted', 'payed_off', 'abandoned'],
            description: '新状态',
          },
          payoffChapter: { type: 'integer', minimum: 1, description: '回收章节序号（设为 0 或 null 表示取消回收）' },
          payoffText: { type: 'string', description: '回收位置的文字描述' },
          type: {
            type: 'string',
            enum: ['identity', 'motivation', 'relation', 'trauma', 'turning', 'fate'],
            description: '伏笔类型',
          },
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
    let fsId = args.id as string | undefined;
    const descMatch = args.description as string | undefined;

    if (!fsId && descMatch) {
      const list = await listForeshadows(ctx.projectId);
      const found = list.find((f) => f.description.includes(descMatch));
      if (!found) {
        return { success: false, result: `错误：未找到描述含「${descMatch}」的伏笔` };
      }
      fsId = found.id;
    }

    if (!fsId) {
      return { success: false, result: '错误：必须提供 id 或 description' };
    }

    const existing = await getForeshadow(fsId, ctx.projectId);
    if (!existing) {
      return { success: false, result: `错误：未找到 id 为 ${fsId} 的伏笔` };
    }

    const updates: Record<string, unknown> = {};
    if (args.newDescription !== undefined) updates.description = String(args.newDescription);
    if (args.status !== undefined) updates.status = args.status;
    if (args.type !== undefined) updates.type = args.type;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.payoffText !== undefined) updates.payoffText = String(args.payoffText);
    // payoffChapter：0 或 null 表示取消
    if (args.payoffChapter !== undefined) {
      const pc = Number(args.payoffChapter);
      updates.payoffChapter = pc > 0 ? pc : null;
    }

    await updateForeshadow(fsId, updates, ctx.projectId);
    return {
      success: true,
      result: `已更新伏笔（id: ${fsId}），更新了 ${Object.keys(updates).length} 个字段。`,
      entity: { type: 'foreshadow', action: 'update', id: fsId },
    };
  },
};

registerTools([createForeshadowTool, updateForeshadowTool]);
