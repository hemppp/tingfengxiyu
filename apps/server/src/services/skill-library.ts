// ============================================================
// 集中式 Skills 库 —— 业务层
//
// 设计见 docs/architecture/skills-library.md。三条口径：
//   ① **一处集中存放**：所有技能都在 `skill_library` 这张表里，智能体与各 agent 都从它取；
//   ② **只支持安装与删除**：不提供编辑 —— 技能正文是"装进来的东西"，
//      就地改会让库里的内容与技能来源脱节（改内容应当卸载后重装）；
//   ③ **内部两类分开**：`category='assistant'`（智能体 skills）/ `category='agent'`（agent skills）。
//      归属关系由 `ownerAgent` 表达，而"某 agent 看得到哪些"就是按这个字段过滤。
//
// 与 `ctx.ai.skills`（运行时注册表）的关系：
//   注册表管"这轮对话能激活什么"，本库管"这些技能归属谁、开着还是关着"。
//   本库的初始内容**来自**注册表（首次访问时按 builtin 种进去），之后库就是真相。
// ============================================================

import { getDb, schema, and, or, eq, isNull, saveToDisk } from '@novel/db';
import { getAllSkills } from '../ai/agents/skills.js';
import { getSkillTarget, listSkillTargets } from '../ai/agents/skill-targets.js';

export type SkillCategory = 'assistant' | 'agent';

export interface LibrarySkill {
  id: string;
  name: string;
  description: string;
  color: string;
  iconKey: string;
  category: SkillCategory;
  ownerAgent: string | null;
  /** 归属智能体的展示名（UI 直接显示，省得前端再查一次表） */
  ownerAgentName: string | null;
  systemPrompt: string;
  contextKeys: string[];
  source: 'builtin' | 'installed';
  /**
   * 归属可见性：
   *   'public'  = 内置 / 插件带 —— 所有用户可见，谁都能删（影响所有人）
   *   'private' = 当前用户自己上传的 —— 只有本人可见、只有本人能删
   * 由 `user_id` 是否为 NULL 推出，不下发 raw userId。
   */
  visibility: 'public' | 'private';
  createdAt: number;
  updatedAt: number;
}

/** 智能体 + 它的技能计数（左列用） */
export interface SkillTargetView {
  id: string;
  name: string;
  kind: 'assistant' | 'agent';
  short: string;
  color: string;
  description: string;
  group: string;
  source: 'core' | 'plugin';
  /** 该智能体名下的技能总数 */
  total: number;
  /** 其中已开启的条数（界面显示 3/9） */
  enabled: number;
}

/** 智能体 + 它的技能（含开关状态，右列用） */
export interface TargetSkillsView {
  target: SkillTargetView;
  skills: Array<LibrarySkill & { enabled: boolean; /** 是否被显式配置过（没配过 = 默认关） */ configured: boolean }>;
}

/** 库里出现过的、但清单里没声明的归属 —— 必须报出来，否则技能会"永远看不到" */
export interface OrphanOwner { agentId: string; count: number; skillIds: string[] }

// ---- 内部工具 ----

/** drizzle 的 timestamp 模式读回来是 Date；对外统一给**秒**（与库里整数列语义一致） */
function toSeconds(v: unknown): number {
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (typeof v === 'number') return v;
  return 0;
}

function parseContextKeys(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToSkill(r: Record<string, unknown>): LibrarySkill {
  const owner = (r.ownerAgent as string | null) ?? null;
  return {
    id: String(r.id),
    name: String(r.name ?? r.id),
    description: String(r.description ?? ''),
    color: String(r.color ?? '#94a3b8'),
    iconKey: String(r.iconKey ?? 'sparkles'),
    category: (String(r.category) === 'assistant' ? 'assistant' : 'agent'),
    ownerAgent: owner,
    ownerAgentName: owner ? (getSkillTarget(owner)?.name ?? owner) : null,
    systemPrompt: String(r.systemPrompt ?? ''),
    contextKeys: parseContextKeys(r.contextKeys),
    source: (String(r.source) === 'builtin' ? 'builtin' : 'installed'),
    // ★ 2026-09-17：公共（内置/插件带，谁都能删）还是私有（我上传的，只有我能删）。
    //   前端据此决定删除按钮是否可点 —— 不用把 raw userId 下发出去。
    visibility: r.userId ? 'private' : 'public',
    createdAt: toSeconds(r.createdAt),
    updatedAt: toSeconds(r.updatedAt),
  };
}

// ---- 种子 ----

/**
 * 首次访问时把运行时注册表里的技能种进库（builtin）。
 *
 * ★ **只在表完全为空时种**：这是一条硬口径 —— 作者删掉的技能不该在下次启动时复活。
 *   代价是"表被清空后重启会重新种一遍"，但这属于极端操作，且种回来的正是产品自带技能，
 *   比"删了又活"好得多。
 * @returns 本次种入的条数
 */
export async function ensureSeeded(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  // ★ 判据是「**没有公共技能**」而不是「表为空」——加了私有归属后，
  //   用户自己装的技能也会占着表行，用 length>0 会把内置技能永久挡在门外。
  const existing = await db.select({ id: schema.skillLibrary.id }).from(schema.skillLibrary)
    .where(isNull(schema.skillLibrary.userId)).limit(1);
  if (existing.length > 0) return 0;

  const registry = getAllSkills();
  const now = new Date();
  let n = 0;
  for (const def of Object.values(registry)) {
    await db.insert(schema.skillLibrary).values({
      id: def.id,
      name: def.name ?? def.id,
      description: def.description ?? '插件注册技能',
      color: def.color ?? '#94a3b8',
      iconKey: def.id,
      // ★ 归属由技能**自己声明**（`SkillDef.ownerAgent`）：不同技能本就该归不同 agent
      //   （角色分析师 → 角色设计师、情节构思师 → 剧情设计师、伏笔追踪者 → 设定管家…）。
      //   2026-09-15 之前这里硬编码 'writer'，导致 10 条技能全堆在写作官名下、
      //   另外 7 个 agent 的技能列表全空。
      //   未声明时回落 'writer' —— 写作场景的默认归属。
      //   智能体本体（assistant）名下仍为空 —— 不凭空造，等真装了再出现。
      category: 'agent',
      ownerAgent: (def as { ownerAgent?: string }).ownerAgent ?? 'writer',
      systemPrompt: def.systemPrompt ?? '',
      contextKeys: JSON.stringify(def.contextKeys ?? []),
      source: 'builtin',
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    n += 1;
  }
  if (n > 0) await saveToDisk(true);
  return n;
}

// ---- 读 ----

/**
 * 可见的技能 = **公共的**（`user_id IS NULL`，内置 / 插件带）+ **自己的**（`user_id = 我`）。
 *
 * ★ 2026-09-17：原来是无条件全表读（库是全局的）。作者口径修订后，
 *   用户自己上传的技能是私有财产 —— 别人既看不到、也删不掉。
 *   不传 userId 时只返回公共技能（内部调用/种子检查用）。
 */
export async function listLibrary(userId?: string): Promise<LibrarySkill[]> {
  await ensureSeeded();
  const db = getDb();
  if (!db) return [];
  const visible = userId
    ? or(isNull(schema.skillLibrary.userId), eq(schema.skillLibrary.userId, userId))
    : isNull(schema.skillLibrary.userId);
  const rows = await db.select().from(schema.skillLibrary)
    .where(visible)
    .orderBy(schema.skillLibrary.name);
  return rows.map((r) => rowToSkill(r as unknown as Record<string, unknown>));
}

/**
 * 某智能体名下的技能（这就是"看得到哪些"的唯一判据）。
 *
 * 语义（用户口径的分类存放）：智能体本体只看 `assistant` 类；
 * 各 agent 只看 `agent` 类**且归属自己**的；没归属（ownerAgent=null）的谁都看不到 ——
 * 「看不到」比「悄悄给了所有人」好，后者会让技能出现在完全不该用它的智能体上。
 *
 * 导出是为了单测能直接钉住这条隔离规则（它一旦错，界面会在错误的地方显示技能）。
 */
export function belongsToAgent(
  skill: { category: SkillCategory; ownerAgent: string | null },
  agentId: string,
): boolean {
  if (agentId === 'chat') return skill.category === 'assistant';
  return skill.category === 'agent' && skill.ownerAgent === agentId;
}

async function toggleMap(userId: string, agentId: string): Promise<Map<string, boolean>> {
  const db = getDb();
  const out = new Map<string, boolean>();
  if (!db) return out;
  const rows = await db.select().from(schema.agentSkillToggles)
    .where(and(eq(schema.agentSkillToggles.userId, userId), eq(schema.agentSkillToggles.agentId, agentId)));
  for (const r of rows) out.set(String(r.skillId), Boolean(r.enabled));
  return out;
}

export async function listTargets(userId: string): Promise<SkillTargetView[]> {
  const all = await listLibrary(userId);
  const targets = listSkillTargets();
  const out: SkillTargetView[] = [];
  for (const t of targets) {
    const mine = all.filter((s) => belongsToAgent(s, t.id));
    const toggles = await toggleMap(userId, t.id);
    out.push({
      ...t,
      total: mine.length,
      enabled: mine.filter((s) => toggles.get(s.id) === true).length,
    });
  }
  return out;
}

export async function getTargetSkills(agentId: string, userId: string): Promise<TargetSkillsView | null> {
  const target = listSkillTargets().find((t) => t.id === agentId);
  if (!target) return null;
  const all = await listLibrary(userId);
  const mine = all.filter((s) => belongsToAgent(s, agentId));
  const toggles = await toggleMap(userId, agentId);
  const skills = mine.map((s) => ({
    ...s,
    enabled: toggles.get(s.id) === true,
    configured: toggles.has(s.id),
  }));
  return {
    target: {
      ...target,
      total: mine.length,
      enabled: skills.filter((s) => s.enabled).length,
    },
    skills,
  };
}

/**
 * 库里"归属写了但清单里没声明"的条目。
 * 没有这个检查，作者装了技能、界面却永远不显示，而且**完全不知道为什么** ——
 * 这类"配了但看不见"最难查，所以直接摆在接口里。
 */
export async function listOrphanOwners(userId?: string): Promise<OrphanOwner[]> {
  const all = await listLibrary(userId);
  const known = new Set(listSkillTargets().map((t) => t.id));
  const acc = new Map<string, string[]>();
  for (const s of all) {
    if (s.category !== 'agent') continue;
    const owner = s.ownerAgent ?? '__unassigned__';
    if (known.has(owner)) continue;
    acc.set(owner, [...(acc.get(owner) ?? []), s.id]);
  }
  return [...acc.entries()].map(([agentId, skillIds]) => ({ agentId, count: skillIds.length, skillIds }));
}

// ---- 写（只支持安装 / 删除 / 开关）----

export interface InstallSkillInput {
  id: string;
  name: string;
  description?: string;
  color?: string;
  iconKey?: string;
  category: SkillCategory;
  ownerAgent?: string | null;
  systemPrompt?: string;
  contextKeys?: string[];
}

/** 安装（已存在则覆盖 —— 这是"重装"，仍不提供就地编辑正文的接口） */
export async function installSkill(input: InstallSkillInput, userId?: string): Promise<LibrarySkill> {
  const db = getDb();
  if (!db) throw new Error('数据库不可用');
  const rawId = input.id.trim();
  if (!rawId) throw new Error('技能 id 不能为空');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(rawId)) {
    throw new Error('技能 id 只能用字母、数字、点、下划线、连字符');
  }
  if (input.category === 'agent' && !input.ownerAgent) {
    throw new Error('agent skills 必须指定归属智能体');
  }
  if (input.ownerAgent && !getSkillTarget(input.ownerAgent)) {
    throw new Error(`未知智能体 ${input.ownerAgent}（清单里没有它，装了也看不见）`);
  }
  // ★ 2026-09-17：带 userId = 用户私有（id 加命名空间避开主键冲突）；
  //   不带 = 公共（种子/内置路径），id 保持原样。
  //   为什么用前缀而不是复合主键：与 agent_skill_toggles.id 同款理由 ——
  //   「直接当主键，避免依赖复合唯一索引的实现差异」。
  const id = userId ? `${userId}:${rawId}` : rawId;
  const now = new Date();
  const values = {
    id,
    name: input.name.trim() || rawId,
    description: input.description?.trim() ?? '',
    color: input.color?.trim() || '#94a3b8',
    iconKey: input.iconKey?.trim() || 'sparkles',
    category: input.category,
    ownerAgent: input.category === 'agent' ? (input.ownerAgent ?? null) : null,
    systemPrompt: input.systemPrompt ?? '',
    contextKeys: JSON.stringify(input.contextKeys ?? []),
    source: 'installed' as const,
    userId: userId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  // 已存在时保留原有 created_at，只更新内容（重装语义）
  await db.insert(schema.skillLibrary).values(values).onConflictDoUpdate({
    target: schema.skillLibrary.id,
    set: {
      name: values.name,
      description: values.description,
      color: values.color,
      iconKey: values.iconKey,
      category: values.category,
      ownerAgent: values.ownerAgent,
      systemPrompt: values.systemPrompt,
      contextKeys: values.contextKeys,
      updatedAt: now,
    },
  });
  await saveToDisk(true);
  const rows = await db.select().from(schema.skillLibrary).where(eq(schema.skillLibrary.id, id)).limit(1);
  return rowToSkill(rows[0] as unknown as Record<string, unknown>);
}

/**
 * 删除。
 * ★ 同时删掉所有用户对它的开关记录 —— 留着就是垃圾行，
 *   而且技能重装回来后会被旧开关的残留状态影响（那种"明明重装了却是关的"最难查）。
 */
export async function removeSkill(id: string, userId?: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const rows = await db.select({ id: schema.skillLibrary.id, userId: schema.skillLibrary.userId })
    .from(schema.skillLibrary)
    .where(eq(schema.skillLibrary.id, id)).limit(1);
  const row = rows[0];
  if (!row) return false;
  // ★ 2026-09-17：私有技能只有主人能删。
  //   公共技能（userId=null）保持原口径 —— 谁都能删、影响所有人（见 skills-library.md 第 56 行）。
  if (row.userId && row.userId !== userId) return false;
  await db.delete(schema.agentSkillToggles).where(eq(schema.agentSkillToggles.skillId, id));
  await db.delete(schema.skillLibrary).where(eq(schema.skillLibrary.id, id));
  await saveToDisk(true);
  return true;
}

export interface ToggleResult { agentId: string; skillId: string; enabled: boolean }

export async function setToggle(o: {
  userId: string; agentId: string; skillId: string; enabled: boolean;
}): Promise<ToggleResult> {
  const db = getDb();
  if (!db) throw new Error('数据库不可用');
  if (!getSkillTarget(o.agentId)) throw new Error(`未知智能体 ${o.agentId}`);
  // ★ 必须带 userId：不带时 listLibrary 只返回**公共**技能，
  //   于是用户自己装的私有技能在这里查不到 → 抛「技能库中没有 xxx」→ **私有技能开不了**。
  //   （2026-09-17 加归属后漏改这一处，属于功能性回归。）
  const all = await listLibrary(o.userId);
  const skill = all.find((s) => s.id === o.skillId);
  if (!skill) throw new Error(`技能库中没有 ${o.skillId}`);
  if (!belongsToAgent(skill, o.agentId)) {
    throw new Error(`技能「${skill.name}」不属于这个智能体（开了也不会生效）`);
  }
  const id = `${o.userId}:${o.agentId}:${o.skillId}`;
  const now = new Date();
  await db.insert(schema.agentSkillToggles)
    .values({ id, userId: o.userId, agentId: o.agentId, skillId: o.skillId, enabled: o.enabled, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.agentSkillToggles.id,
      set: { enabled: o.enabled, updatedAt: now },
    });
  await saveToDisk(true);
  return { agentId: o.agentId, skillId: o.skillId, enabled: o.enabled };
}

/** 批量开/关某智能体名下的全部技能（面板上的"全部开启/全部关闭"） */
export async function setAllToggles(o: {
  userId: string; agentId: string; enabled: boolean;
}): Promise<number> {
  const view = await getTargetSkills(o.agentId, o.userId);
  if (!view) throw new Error(`未知智能体 ${o.agentId}`);
  for (const s of view.skills) {
    await setToggle({ userId: o.userId, agentId: o.agentId, skillId: s.id, enabled: o.enabled });
  }
  return view.skills.length;
}

/** 执行链路要用的最小技能形状（只给用得上的字段，别把整个库行塞进 prompt 装配） */
export interface EnabledSkill { id: string; name: string; systemPrompt: string }

/**
 * 某个智能体**当前启用**的技能 —— 这是开关真正生效的地方。
 *
 * 与 `getTargetSkills` 的区别：那个面向配置界面（要给出全部技能 + 是否开启 + 是否配置过），
 * 这个面向执行（只给"开着且真有正文"的，调用方直接拼进 system prompt）。
 *
 * fail-closed：拿不到、没配置、正文为空 → 返回空数组。
 * 宁可不加技能，也不要让一条内容为空的技能占着 prompt。
 */
export async function listEnabledSkills(agentId: string, userId?: string): Promise<EnabledSkill[]> {
  const db = getDb();
  if (!db || !userId) return [];          // 没有用户身份就无从查开关（开关是按用户存的）
  if (!getSkillTarget(agentId)) return []; // 未声明的智能体：不必查库
  const rows = await db.select().from(schema.skillLibrary)
    .where(or(isNull(schema.skillLibrary.userId), eq(schema.skillLibrary.userId, userId)));
  const skills = rows.map((r) => rowToSkill(r as unknown as Record<string, unknown>));
  const toggles = await toggleMap(userId, agentId);
  return skills
    .filter((s) => belongsToAgent(s, agentId) && toggles.get(s.id) === true && s.systemPrompt.trim().length > 0)
    .map((s) => ({ id: s.id, name: s.name, systemPrompt: s.systemPrompt }));
}
