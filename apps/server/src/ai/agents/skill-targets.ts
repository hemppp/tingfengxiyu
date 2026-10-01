// ============================================================
// 技能目标（智能体清单）—— 「智能体 skills」面板里那一列
//
// 名词口径（见 docs/architecture/skills-library.md）：
//   · **智能体**（assistant）：对话本体那一个，kind = 'assistant'
//   · **agent**：各个子智能体（写作官等），kind = 'agent'，由某个插件声明
//
// 为什么单独一张声明表而不是把清单写死在前端：
//   ① 技能的归属（skill.ownerAgent）必须能校验 —— 库里存了 'writer' 这个归属，
//      清单里却没有它，界面就会出现"永远看不到的技能"；
//   ② 用户明确说"后续还要继续加入其他 agent 的 skills"，所以声明是**可扩展**的：
//      插件走 `ctx.ai.skillTargets.declare()`，宿主侧登记进本表。
//
// ★ 与插件 `discuss/roles.ts` 的 DesignRole.key **故意对齐**：
//   将来要把某个 agent 的开关真正接到执行链路上时，两边必须是同一个 id。
//   对齐的代价是核心要知道这几个 id —— 这是**展示层目录**，不构成对插件代码的依赖。
// ============================================================

/** 'assistant' = 智能体本体；'agent' = 子智能体 */
export type SkillTargetKind = 'assistant' | 'agent';

export interface SkillTarget {
  id: string;
  name: string;
  kind: SkillTargetKind;
  /** 头像字（单字） */
  short: string;
  /** 主题色（hex） */
  color: string;
  /** 一句话职责 —— 作者靠它判断"这个智能体管什么" */
  description: string;
  /** 界面分组（如「对话」「写作流水线」） */
  group: string;
  /** 声明来源：core 内置 / 插件声明 */
  source: 'core' | 'plugin';
}

const REGISTRY = new Map<string, SkillTarget>();

/** 声明一个智能体（插件经 ctx.ai.skillTargets.declare 调用；id 重复则覆盖） */
export function declareSkillTarget(target: SkillTarget): void {
  REGISTRY.set(target.id, target);
}

/** 撤销声明（插件卸载时调用） */
export function undeclareSkillTarget(id: string): void {
  REGISTRY.delete(id);
}

/**
 * 全部智能体，按 kind（智能体在前）+ 组 + 声明顺序稳定排序。
 * ★ 顺序必须稳定：界面左列的次序每次刷新都变，等于没法用。
 */
export function listSkillTargets(): SkillTarget[] {
  const all = [...REGISTRY.values()];
  const kindRank = (k: SkillTargetKind): number => (k === 'assistant' ? 0 : 1);
  return all.sort((a, b) => {
    if (kindRank(a.kind) !== kindRank(b.kind)) return kindRank(a.kind) - kindRank(b.kind);
    if (a.group !== b.group) return a.group.localeCompare(b.group, 'zh-Hans-CN');
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

export function getSkillTarget(id: string): SkillTarget | undefined {
  return REGISTRY.get(id);
}

// ---- 内置声明 ----

/** 智能体本体：对话里那个"我" */
declareSkillTarget({
  id: 'chat',
  name: '对话智能体',
  kind: 'assistant',
  short: '我',
  color: '#5B7CFA',
  description: '工作台 AI 对话本体，负责与你讨论、检索设定与落笔',
  group: '对话',
  source: 'core',
});

/**
 * 写作流水线的 agent。
 * 颜色/头像字与插件 `discuss/roles.ts` 一致 —— 同一个人在交流流与配置页里
 * 应该是同一个颜色，否则作者会以为是两个东西。
 */
const WRITING_AGENTS: Array<Omit<SkillTarget, 'kind' | 'group' | 'source'>> = [
  { id: 'writer', name: '写作官', short: '写', color: '#0F6E56', description: '按本章结论落笔成文' },
  { id: 'plot-designer', name: '剧情设计师', short: '剧', color: '#4F918C', description: '决定这一章发生什么' },
  { id: 'character-designer', name: '角色设计师', short: '角', color: '#336C78', description: '管人物动机与关系推进' },
  { id: 'continuity-keeper', name: '设定管家', short: '设', color: '#C18A3E', description: '查库核对，防自相矛盾' },
  { id: 'convener', name: '定稿官', short: '定', color: '#66944D', description: '把讨论收敛成本章结论' },
  { id: 'reviewer', name: '意图复核', short: '核', color: '#534AB7', description: '验收正文有没有写出约定的事' },
  { id: 'world-architect', name: '策划官', short: '策', color: '#7A6BA8', description: '世界观、势力与力量体系' },
  { id: 'premiere-reviewer', name: '前三章审阅', short: '阅', color: '#B0654A', description: '横着读前三章，查跨章连贯' },
];

for (const a of WRITING_AGENTS) {
  declareSkillTarget({ ...a, kind: 'agent', group: '写作流水线', source: 'core' });
}
