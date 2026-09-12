// ============================================================
// 上下文解析器 —— flow 型技能的服务端供数通道
//
// chat 型技能由前端注入上下文；flow 型不依赖前端在场，
// 由这里直接查项目库产出紧凑设定摘要（digest），喂给子代理。
// ============================================================

import type { ServerPluginContext } from '@novel/core';
import { schema, eq, and, isNull, asc, desc, lt, type DrizzleDb } from '@novel/db';

/** 截断工具：超长字段收敛，保 digest 紧凑 */
function cut(v: unknown, n: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export interface SettingsDigest {
  projectName: string;
  genre: string;
  characters: string;
  foreshadows: string;
  outline: string;
  chapters: string;
}

/** 拉取项目设定摘要（角色/伏笔/大纲/章节清单） */
export async function resolveSettingsDigest(
  ctx: ServerPluginContext,
  projectId: string,
): Promise<SettingsDigest> {
  const db = ctx.db.project(projectId) as DrizzleDb;

  const chars = await db
    .select({
      name: schema.characters.name,
      role: schema.characters.role,
      desire: schema.characters.desire,
      fear: schema.characters.fear,
      personality: schema.characters.personality,
      speechStyle: schema.characters.speechStyle,
      backstory: schema.characters.backstory,
    })
    .from(schema.characters)
    .where(eq(schema.characters.projectId, projectId));

  const fsh = await db
    .select({
      description: schema.foreshadows.description,
      type: schema.foreshadows.type,
      status: schema.foreshadows.status,
      seedChapter: schema.foreshadows.seedChapter,
      payoffChapter: schema.foreshadows.payoffChapter,
    })
    .from(schema.foreshadows)
    .where(eq(schema.foreshadows.projectId, projectId));

  const outline = await db
    .select({
      type: schema.outlineNodes.type,
      title: schema.outlineNodes.title,
      description: schema.outlineNodes.description,
      order: schema.outlineNodes.order,
    })
    .from(schema.outlineNodes)
    .where(eq(schema.outlineNodes.projectId, projectId))
    .orderBy(asc(schema.outlineNodes.order));

  const chapters = await db
    .select({
      order: schema.chapters.order,
      title: schema.chapters.title,
      wordCount: schema.chapters.wordCount,
      summary: schema.chapters.summary,
      deletedAt: schema.chapters.deletedAt,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.projectId, projectId))
    .orderBy(asc(schema.chapters.order));

  // 项目基本信息在主库
  const gdb = ctx.db.global() as DrizzleDb;
  const projRows = await gdb
    .select({ name: schema.projects.name, genre: schema.projects.genre, description: schema.projects.description })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const proj = projRows[0] ?? {};

  const charLines = chars.map((c) =>
    `- ${c.name}（${c.role ?? '未定位'}）：欲望=${cut(c.desire, 80)} 恐惧=${cut(c.fear, 60)} 性格=${cut(c.personality, 100)} 语言风格=${cut(c.speechStyle, 60)} 背景=${cut(c.backstory, 120)}`,
  );
  const fshLines = fsh.map((f) =>
    `- [${f.type}/${f.status}] ${cut(f.description, 80)}（埋于第${f.seedChapter}章${f.payoffChapter ? `，回收于第${f.payoffChapter}章` : '，未回收'}）`,
  );
  const outlineLines = outline.map((o) => `- [${o.type}] ${o.title}${o.description ? `：${cut(o.description, 120)}` : ''}`);
  const chapterLines = chapters
    .filter((c) => !c.deletedAt)
    .map((c) => `- 第${c.order}章《${c.title}》（${c.wordCount ?? 0}字）${c.summary ? `摘要：${cut(c.summary, 80)}` : ''}`);

  return {
    projectName: String(proj.name ?? ''),
    genre: String(proj.genre ?? ''),
    characters: charLines.join('\n') || '（暂无角色设定）',
    foreshadows: fshLines.join('\n') || '（暂无伏笔）',
    outline: outlineLines.join('\n') || '（暂无大纲）',
    chapters: chapterLines.join('\n') || '（暂无章节）',
  };
}

/** 读取某一章的现有内容（交付覆写检查 + 备份用） */
export async function readChapterByOrder(
  ctx: ServerPluginContext,
  projectId: string,
  order: number,
): Promise<{ id: string; title: string; content: string } | undefined> {
  const db = ctx.db.project(projectId) as DrizzleDb;
  const rows = await db
    .select({ id: schema.chapters.id, title: schema.chapters.title, content: schema.chapters.content })
    .from(schema.chapters)
    .where(and(eq(schema.chapters.projectId, projectId), eq(schema.chapters.order, order), isNull(schema.chapters.deletedAt)))
    .limit(1);
  return rows[0];
}

/** 上一章全文的注入上限（字符数）—— 衔接最吃结尾，超限时保留结尾 */
export const PREV_CHAPTER_MAX_CHARS = 6000;

export interface PreviousChapter {
  order: number;
  title: string;
  content: string;
  /** 因超长被截断（只保留结尾） */
  truncated: boolean;
}

/**
 * 读取「上一章全文」—— 架构 §7 的强制注入项之一。
 *
 * 为什么必须**强制注入**而不是让 agent 自己去读：只给「第 N 章 · M 字 · 摘要」的清单时，
 * 模型不知道上一章的文风、语气、结尾钩子的具体写法，所谓「接着写」会写成另一本书。
 * 2026-09-12 实测：这是跨章连续性最缺的一块（此前只注入了 digest 摘要）。
 *
 * 取章规则（两处调用方语义不同，别混）：
 *   · 传了 beforeOrder → 取 order **小于**它的最新一章（写第 3 章时给第 2 章）
 *   · 没传 → 取库中最新一章（作者没指定章号时，「上一章」= 最后交付的那一章）
 * 超长时保留**结尾**并标注 —— 结尾那一刻的处境才是衔接点。
 */
export async function resolvePreviousChapter(
  ctx: ServerPluginContext,
  projectId: string,
  beforeOrder?: number,
  maxChars: number = PREV_CHAPTER_MAX_CHARS,
): Promise<PreviousChapter | null> {
  const db = ctx.db.project(projectId) as DrizzleDb;
  const scope = eq(schema.chapters.projectId, projectId);
  const alive = isNull(schema.chapters.deletedAt);
  const rows = await db
    .select({ order: schema.chapters.order, title: schema.chapters.title, content: schema.chapters.content })
    .from(schema.chapters)
    .where(
      beforeOrder != null
        ? and(scope, alive, lt(schema.chapters.order, beforeOrder))
        : and(scope, alive),
    )
    .orderBy(desc(schema.chapters.order))
    .limit(1);

  const row = rows[0];
  const content = String(row?.content ?? '').trim();
  if (!row || !content) return null;
  if (content.length <= maxChars) {
    return { order: row.order, title: String(row.title ?? ''), content, truncated: false };
  }
  return {
    order: row.order,
    title: String(row.title ?? ''),
    content: `（上一章原文过长，此处只保留结尾 ${maxChars} 字）\n…${content.slice(-maxChars)}`,
    truncated: true,
  };
}
