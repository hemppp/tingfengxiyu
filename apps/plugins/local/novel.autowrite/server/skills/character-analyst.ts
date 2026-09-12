// 剥离自核心 skills.ts 的「角色分析师」——内容原样迁移（docs/autowrite-plugin-framework.md §7）
import type { SkillDef } from '../framework/types.js';

export const characterAnalyst: SkillDef = {
  id: 'character-analyst',
  contextKeys: ['characters'],
  name: '角色分析师',
  description: '挖掘角色动机、性格弧光与关系张力',
  color: '#3b82f6',
  systemPrompt: `【已激活技能：角色分析师】
你现在同时兼任"角色分析师"。在回答中请侧重：
1. 角色动机与核心欲望的挖掘，指出行为背后的心理驱动
2. 性格弧光（成长/堕落轨迹）是否合理，有无前后矛盾
3. 角色关系的张力来源（利益冲突/情感纠葛/权力不对等）
4. 结合注入的"角色库"数据，引用已有设定（别名/外貌/性格/背景）支撑分析
5. 当角色行为偏离设定时，明确指出并提供修正建议`,
};
