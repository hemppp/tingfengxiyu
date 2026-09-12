// ============================================================
// AI 对话技能注册表 (Skills Registry)
//
// 技能 = 用户在对话中可主动激活的"专家模式"。
// 激活后，该轮对话在「小说对话」基础上叠加技能专属 system prompt，
// 并由前端按 contextKeys 注入相关实体上下文（角色库/伏笔/大纲等）。
//
// 设计原则：
//  - 技能与现有 phase 机制正交：phase 是后端内部业务场景分发，
//    skill 是用户主动选择的对话视角，二者可共存。
//  - 技能 prompt 叠加在 NOVEL_CHAT_SYSTEM_PROMPT 之上，不替换场景。
//  - 新增技能只需在 SKILLS 中追加一项，无需改动路由 / Agent 主流程。
// ============================================================

/** 技能上下文类型标识 —— 与前端 buildSkillContext 的收集逻辑对齐 */
export type SkillContextKey =
  | 'characters'
  | 'foreshadows'
  | 'outline'
  | 'locations'
  | 'items'
  | 'events';

/** 技能定义（后端侧：prompt 与上下文声明 + 展示元数据） */
export interface SkillDef {
  id: string;
  /** 注入到 system prompt 末尾的专家指导 */
  systemPrompt: string;
  /** 该技能需要前端注入的上下文类型（仅用于文档/校验，实际注入由前端决定） */
  contextKeys: SkillContextKey[];
  /** 展示名称（GET /api/ai/skills 下发；缺省回退为 id） */
  name?: string;
  /** 一句话描述 */
  description?: string;
  /** 主题色（hex），前端图标/高亮用 */
  color?: string;
  /** 注册来源：内置为 builtin，插件经 registerSkill 注册为 plugin */
  source?: 'builtin' | 'plugin';
}

/**
 * 预设技能列表。
 *
 * ★ 2026-09 技能内容已全部剥离至 novel.autowrite 插件（docs/autowrite-plugin-framework.md）：
 *   本表只剩注册表机制（registerSkill/unregisterSkill/查询），内容归插件持有。
 *   插件经 ctx.ai.skills.register 注册，dispose 时自动注销。
 *
 * 每个 systemPrompt 都以"你现在同时兼任……"开头，明确告知 LLM 在通用写作助手
 * 之上叠加的专家身份与行为约束，避免身份冲突。
 *
 * 前端技能选择器从 GET /api/ai/skills 拉取本表（含插件注册项）。
 */
export const SKILLS: Record<string, SkillDef> = {};

/**
 * 获取技能的 system prompt。
 * 若 skillId 不存在或为空，返回空字符串（表示未激活技能，走默认对话）。
 */
export function getSkillSystemPrompt(skillId?: string): string {
  if (!skillId) return '';
  const skill = SKILLS[skillId];
  return skill ? skill.systemPrompt : '';
}

/** 判断 skillId 是否为已注册的有效技能 */
export function isValidSkill(skillId?: string): boolean {
  return !!skillId && skillId in SKILLS;
}

/** 注册一个技能（插件扩展用；自动标记来源，卸载时移除） */
export function registerSkill(skill: SkillDef): void {
  SKILLS[skill.id] = { ...skill, source: 'plugin' };
}

/** 注销一个技能（插件卸载时调用） */
export function unregisterSkill(skillId: string): void {
  delete SKILLS[skillId];
}

/** 获取全部技能定义 */
export function getAllSkills(): Record<string, SkillDef> {
  return { ...SKILLS };
}

/** 可序列化的技能展示元数据（GET /api/ai/skills 下发，前端技能选择器的唯一内容源） */
export interface SkillMetaDto {
  id: string;
  name: string;
  description: string;
  color: string;
  contextKeys: SkillContextKey[];
  source: 'builtin' | 'plugin';
}

/** 列出全部技能（内置 + 插件注册）的展示元数据，按声明顺序稳定排序 */
export function listSkillMetas(): SkillMetaDto[] {
  return Object.values(SKILLS).map((s) => ({
    id: s.id,
    name: s.name ?? s.id,
    description: s.description ?? '插件注册技能',
    color: s.color ?? '#94a3b8',
    contextKeys: s.contextKeys,
    source: s.source ?? 'builtin',
  }));
}
