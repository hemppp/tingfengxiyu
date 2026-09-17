// ============================================================
// 技能市场 · 公共技能源
//
// 作者要求：「要能浏览公共技能源」。
//
// ★ 为什么先做"内置目录"而不是直接连远程：
//   项目里**没有任何现成的远程源**（只有本地插件目录）。内置目录能先把
//   「浏览 → 安装 → 落到我的技能库」这条链路跑通，且离线可用；
//   以后接远程源只需换 `fetchCatalog()` 的实现，上层与 UI 一行不用动。
//
// 归属口径（与 skill-library 一致）：
//   从市场装的技能是**装给当前用户的私有技能**（`user_id = 我`），
//   不是公共技能 —— 公共的只有内置/插件随产品带的那些。
// ============================================================

import { getDb, schema, and, or, eq, isNull } from '@novel/db';
import { listSkillTargets } from '../ai/agents/skill-targets.js';

/** 目录里的一条技能（还没装进任何人的库） */
export interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  category: 'assistant' | 'agent';
  /** category='agent' 时必填：归属哪个 agent（与 DesignRole.key 对齐） */
  ownerAgent: string | null;
  systemPrompt: string;
  contextKeys?: string[];
  /** 目录条目的版本 —— 以后远程源可以据此判断"有没有新版" */
  version: string;
  /** 分类标签，给市场界面分组用（自由文本，不参与逻辑） */
  tags?: string[];
}

/**
 * 内置公共目录（随产品打包）。
 *
 * ★ 这些是**可选装**的技能 —— 与 `skills.ts` 里那批 `builtin`（自动种进库的）不同：
 *   builtin 是"产品自带、开箱即在"，这里是"市场里可以挑着装的"。
 */
export const BUILTIN_CATALOG: CatalogSkill[] = [
  {
    id: 'suspense-pacer',
    name: '悬念节奏师',
    description: '按章检查信息释放节奏：该藏什么、该露多少、钩子落在哪一句。',
    category: 'agent',
    ownerAgent: 'plot-designer',
    version: '1.0.0',
    tags: ['剧情', '节奏'],
    systemPrompt: [
      '你是悬念节奏师。只做一件事：检查这一章的信息释放节奏。',
      '',
      '工作方法：',
      '1. 先列出本章**读者已知**与**角色已知**的差异（这是悬念的唯一来源）。',
      '2. 指出有没有"过早解释"——把该留到后面揭晓的东西在前文说破了。',
      '3. 检查章末钩子：它必须是一个**未闭合的问题**，而不是一句总结。',
      '4. 若发现连续两章都没有新信息释放，明确标出来。',
      '',
      '输出用要点，每条都要指到具体段落，不要泛泛而谈"节奏可以更快"。',
    ].join('\n'),
  },
  {
    id: 'subtext-dialogue',
    name: '潜台词打磨师',
    description: '把"把话说透"的对白改成"话里有话"，并标出每句的真实意图。',
    category: 'agent',
    ownerAgent: 'writer',
    version: '1.0.0',
    tags: ['对白', '文笔'],
    systemPrompt: [
      '你是潜台词打磨师。你只改对白，不动叙述与情节。',
      '',
      '规则：',
      '1. 找出所有"角色直接说出自己意图"的句子 —— 那是说明文，不是对白。',
      '2. 改成：角色说 A，实际想要 B。改完在括号里标注真实意图，供作者核对。',
      '3. 不要为了含蓄而让意思变得不可解 —— 读者必须能从上下文推出来。',
      '4. 保留每个角色原有的说话习惯（口头禅、句长、称呼方式）。',
      '',
      '输出格式：原句 → 改后句（真实意图：…）',
    ].join('\n'),
  },
  {
    id: 'scene-sensor',
    name: '场景感官调度',
    description: '给场景补上被漏掉的感官层次，避免通篇只有"看见"。',
    category: 'agent',
    ownerAgent: 'world-architect',
    version: '1.0.0',
    tags: ['描写', '氛围'],
    systemPrompt: [
      '你是场景感官调度师。只处理场景描写，不改剧情。',
      '',
      '工作方法：',
      '1. 统计该场景用到的感官通道（视 / 听 / 嗅 / 触 / 温 / 体感）。',
      '2. 若只有视觉，补 1–2 个**非视觉**细节 —— 但必须与场景情绪一致，',
      '   不能为了凑感官而塞无关细节。',
      '3. 指出所有"作者视角"的形容词（如"很美""很恐怖"），换成可感知的具体物。',
      '',
      '注意：感官细节贵精不贵多。一个准的比五个泛的有用。',
    ].join('\n'),
  },
];

/**
 * 拉取公共目录（当前实现读内置常量）。
 *
 * ★ 接远程源时只改这个函数：返回 `CatalogSkill[]` 即可，
 *   上层 `listMarket()` 与前端一行都不用动。
 */
export async function fetchCatalog(): Promise<CatalogSkill[]> {
  return BUILTIN_CATALOG;
}

export interface MarketEntry extends CatalogSkill {
  /** 该用户是否已经装过（装了就不再显示"安装"按钮） */
  installed: boolean;
  /** 目录里声明的归属智能体是否真的存在 —— 不存在时界面上要提示，否则"装了也看不见" */
  ownerKnown: boolean;
}

/**
 * 市场列表 = 公共目录 + 「我装没装」。
 *
 * 判定"装过"的口径：库里存在 **公共的同 id** 或 **我的私有 `${userId}:${id}`**。
 * （前者是产品自带的、后者是从市场装的，两种情况都算"已经有了"。）
 */
export async function listMarket(userId?: string): Promise<MarketEntry[]> {
  const catalog = await fetchCatalog();
  const known = new Set(listSkillTargets().map((t) => t.id));

  const db = getDb();
  const ownedIds = new Set<string>();
  if (db) {
    const rows = userId
      ? await db.select({ id: schema.skillLibrary.id }).from(schema.skillLibrary)
        .where(or(isNull(schema.skillLibrary.userId), eq(schema.skillLibrary.userId, userId)))
      : await db.select({ id: schema.skillLibrary.id }).from(schema.skillLibrary)
        .where(isNull(schema.skillLibrary.userId));
    for (const r of rows) ownedIds.add(String(r.id));
  }

  return catalog.map((c) => ({
    ...c,
    installed: ownedIds.has(c.id) || (userId ? ownedIds.has(`${userId}:${c.id}`) : false),
    ownerKnown: !c.ownerAgent || known.has(c.ownerAgent),
  }));
}
