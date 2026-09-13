/**
 * @fileoverview 集中式 Skills 库 —— 隔离规则与智能体清单
 *
 * 这一层最要紧的不是 CRUD，而是**"谁看得到哪条技能"**：
 * 判错的表现是"技能出现在完全不该用它的智能体上"（或反过来永远看不到）。
 * 所以把这条规则单独钉住。
 */

import { describe, it, expect } from 'vitest';
import { belongsToAgent, type SkillCategory } from '../services/skill-library.js';
import {
  listSkillTargets, getSkillTarget, declareSkillTarget, undeclareSkillTarget,
} from '../ai/agents/skill-targets.js';

const skill = (category: SkillCategory, ownerAgent: string | null) => ({ category, ownerAgent });

describe('技能归属隔离（谁能看到哪条技能）', () => {
  it('智能体本体只看到 assistant 类', () => {
    expect(belongsToAgent(skill('assistant', null), 'chat')).toBe(true);
    // agent 类即便归属写成 chat，也不该出现在本体里（category 优先）
    expect(belongsToAgent(skill('agent', 'chat'), 'chat')).toBe(false);
  });

  it('agent 只看到归属自己的 —— 不会串到别的 agent', () => {
    const s = skill('agent', 'writer');
    expect(belongsToAgent(s, 'writer')).toBe(true);
    expect(belongsToAgent(s, 'plot-designer')).toBe(false);
  });

  it('★ 没归属（ownerAgent=null）的技能谁都看不到', () => {
    // 「看不到」比「悄悄给了所有人」好：后者会让技能出现在不该用它的智能体上
    const s = skill('agent', null);
    for (const id of ['chat', 'writer', 'plot-designer', 'continuity-keeper']) {
      expect(belongsToAgent(s, id), `${id} 不该看到它`).toBe(false);
    }
  });

  it('assistant 类技能不会被任何 agent 认领（分类优先于归属）', () => {
    expect(belongsToAgent(skill('assistant', 'writer'), 'writer')).toBe(false);
  });
});

describe('智能体清单', () => {
  it('内置里含智能体本体 + 写作流水线各角色', () => {
    const ids = listSkillTargets().map((t) => t.id);
    expect(ids).toContain('chat');
    for (const id of ['writer', 'plot-designer', 'character-designer', 'continuity-keeper', 'convener', 'reviewer', 'world-architect', 'premiere-reviewer']) {
      expect(ids, `缺少 ${id}`).toContain(id);
    }
    // id 必须与插件 DesignRole.key 对齐 —— 否则将来把开关接到执行链路上时两边对不上
    expect(getSkillTarget('writer')?.name).toBe('写作官');
  });

  it('排序稳定：智能体本体在最前，同一 kind 内顺序不变（界面左列次序不能每次刷新都变）', () => {
    const a = listSkillTargets().map((t) => t.id);
    const b = listSkillTargets().map((t) => t.id);
    expect(a).toEqual(b);
    expect(listSkillTargets()[0]!.kind).toBe('assistant');
  });

  it('插件可声明 / 撤销自己的 agent（"后续还要继续加入其他 agent 的 skills"靠这个入口）', () => {
    declareSkillTarget({
      id: 'test-agent-x', name: '测试智能体', kind: 'agent', short: '测',
      color: '#123456', description: '测试用', group: '测试组', source: 'plugin',
    });
    try {
      expect(getSkillTarget('test-agent-x')?.source).toBe('plugin');
      expect(listSkillTargets().map((t) => t.id)).toContain('test-agent-x');
    } finally {
      undeclareSkillTarget('test-agent-x');
    }
    // 撤销后必须干净 —— 否则插件卸载后界面还留着一个永远没有技能的智能体
    expect(getSkillTarget('test-agent-x')).toBeUndefined();
  });
});
