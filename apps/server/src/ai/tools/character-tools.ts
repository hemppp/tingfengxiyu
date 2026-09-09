// ============================================================
// 角色相关工具 — create_character / update_character
// ============================================================

import { registerTools, type ToolHandlerResult, type ToolContext } from './registry.js';
import {
  createCharacter,
  updateCharacter,
  getCharacter,
  listCharacters,
} from '../../services/character-service.js';

// ---- 工具定义 ----

const createCharacterTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'create_character',
      description: '在当前项目中创建一个新角色。必填字段为 name，其余字段可选。创建后角色会立即写入数据库并出现在角色库中。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色姓名（必填）' },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description: '别名/代称列表',
          },
          role: {
            type: 'string',
            enum: ['protagonist', 'femaleLead', 'supporting', 'minor'],
            description: '角色定位：protagonist=主角, femaleLead=女主, supporting=配角, minor=龙套',
          },
          desire: { type: 'string', description: '核心欲望' },
          fear: { type: 'string', description: '恐惧' },
          belief: { type: 'string', description: '信念' },
          weakness: { type: 'string', description: '致命弱点' },
          appearance: { type: 'string', description: '外貌描写' },
          personality: { type: 'string', description: '性格特征' },
          backstory: { type: 'string', description: '背景故事' },
          speechStyle: { type: 'string', description: '说话风格/口头禅' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表',
          },
          color: { type: 'string', description: '高亮颜色（hex）' },
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
    const character = await createCharacter(
      {
        id: '',
        projectId: ctx.projectId,
        name,
        aliases: Array.isArray(args.aliases) ? (args.aliases as string[]) : [],
        states: [],
        relations: [],
        chapters: [],
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
        role: args.role as 'protagonist' | 'femaleLead' | 'supporting' | 'minor' | undefined,
        desire: args.desire as string | undefined,
        fear: args.fear as string | undefined,
        belief: args.belief as string | undefined,
        weakness: args.weakness as string | undefined,
        appearance: args.appearance as string | undefined,
        personality: args.personality as string | undefined,
        backstory: args.backstory as string | undefined,
        speechStyle: args.speechStyle as string | undefined,
        color: args.color as string | undefined,
      },
      ctx.projectId,
    );
    return {
      success: true,
      result: `已创建角色「${name}」（id: ${character.id}）。角色已写入数据库，用户可在角色库中查看。`,
      entity: { type: 'character', action: 'create', id: character.id, name },
    };
  },
};

const updateCharacterTool = {
  definition: {
    type: 'function' as const,
    function: {
      name: 'update_character',
      description: '更新现有角色的字段。必须提供 id（角色 ID）或 name（角色名，用于模糊查找）。只更新提供的字段，未提供的字段保持不变。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '角色 ID（优先使用）' },
          name: { type: 'string', description: '角色名（若无 id，按名称模糊匹配第一个）' },
          newName: { type: 'string', description: '修改后的姓名' },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description: '别名/代称列表（整体替换）',
          },
          role: {
            type: 'string',
            enum: ['protagonist', 'femaleLead', 'supporting', 'minor'],
            description: '角色定位',
          },
          desire: { type: 'string', description: '核心欲望' },
          fear: { type: 'string', description: '恐惧' },
          belief: { type: 'string', description: '信念' },
          weakness: { type: 'string', description: '致命弱点' },
          appearance: { type: 'string', description: '外貌描写' },
          personality: { type: 'string', description: '性格特征' },
          backstory: { type: 'string', description: '背景故事' },
          speechStyle: { type: 'string', description: '说话风格/口头禅' },
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
    let characterId = args.id as string | undefined;
    let characterName = args.name as string | undefined;

    // 若无 id，按 name 模糊查找
    if (!characterId && characterName) {
      const list = await listCharacters(ctx.projectId);
      const found = list.find(
        (c) => c.name === characterName || c.aliases?.includes(characterName!),
      );
      if (!found) {
        return { success: false, result: `错误：未找到名为「${characterName}」的角色` };
      }
      characterId = found.id;
      characterName = found.name;
    }

    if (!characterId) {
      return { success: false, result: '错误：必须提供 id 或 name' };
    }

    const existing = await getCharacter(characterId, ctx.projectId);
    if (!existing) {
      return { success: false, result: `错误：未找到 id 为 ${characterId} 的角色` };
    }

    // 构建更新字段
    const updates: Record<string, unknown> = {};
    if (args.newName !== undefined) updates.name = String(args.newName);
    if (args.aliases !== undefined) updates.aliases = args.aliases;
    if (args.role !== undefined) updates.role = args.role;
    if (args.desire !== undefined) updates.desire = String(args.desire);
    if (args.fear !== undefined) updates.fear = String(args.fear);
    if (args.belief !== undefined) updates.belief = String(args.belief);
    if (args.weakness !== undefined) updates.weakness = String(args.weakness);
    if (args.appearance !== undefined) updates.appearance = String(args.appearance);
    if (args.personality !== undefined) updates.personality = String(args.personality);
    if (args.backstory !== undefined) updates.backstory = String(args.backstory);
    if (args.speechStyle !== undefined) updates.speechStyle = String(args.speechStyle);
    if (args.tags !== undefined) updates.tags = args.tags;

    await updateCharacter(characterId, updates, ctx.projectId);
    return {
      success: true,
      result: `已更新角色「${characterName ?? existing.name}」（id: ${characterId}），更新了 ${Object.keys(updates).length} 个字段。`,
      entity: { type: 'character', action: 'update', id: characterId, name: characterName ?? existing.name },
    };
  },
};

// ---- 注册 ----

registerTools([createCharacterTool, updateCharacterTool]);
