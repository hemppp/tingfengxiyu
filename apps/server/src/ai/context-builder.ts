// ============================================================
// 统一上下文构建服务
//
// 从数据库读取项目的所有模块数据，格式化为结构化文本，
// 供 AI 对话的「智能续写」「章节分析」等 phase 使用。
//
// 设计要点：
//   - 全部从数据库读取（不依赖前端 store），避免前端搬运大量数据
//   - 每类数据含截断保护，防止上下文窗口溢出
//   - 输出纯文本格式，AI 可直接消费
// ============================================================

import { listChapters } from '../services/chapter-service.js';
import { listOutlineNodes } from '../services/outline-service.js';
import { listCharacters } from '../services/character-service.js';
import { listLocations } from '../services/location-service.js';
import { listItems } from '../services/item-service.js';
import { listForeshadows } from '../services/foreshadow-service.js';
import { listEvents } from '../services/event-service.js';
import { listReferenceBooks } from '../services/reference-service.js';

/** 单本参考书最大截断字数 */
const MAX_REF_BOOK_CHARS = 4000;

/** 单类上下文最大条目数 */
const MAX_ITEMS = 50;

/** 单条文本截断长度 */
const MAX_FIELD_LENGTH = 200;

/** 前三章单章最大截断字数 */
const MAX_PREV_CHAPTER_CHARS = 3000;

// ============================================================
// 公共接口
// ============================================================

/** 完整的项目上下文，包含所有模块数据和前三章 */
export interface ProjectContext {
  /** 是否包含大纲 */
  hasOutline: boolean;
  /** 格式化后的完整上下文文本 */
  text: string;
  /** 前三章内容（原始对象，供 AI 按需使用） */
  previousChapters: { title: string; content: string; order: number }[];
  /** 大纲概览（用于前端校验展示） */
  outlineSummary: string;
}

// ============================================================
// 各模块收集器
// ============================================================

/** 收集大纲节点 */
async function collectOutline(projectId: string): Promise<{ text: string; summary: string; hasOutline: boolean }> {
  const nodes = await listOutlineNodes(projectId);
  if (!nodes || nodes.length === 0) {
    return { text: '（暂未填写大纲）', summary: '（空）', hasOutline: false };
  }

  const limited = nodes.slice(0, MAX_ITEMS);
  const lines = limited.map((n) => {
    const desc = n.description
      ? `描述：${n.description.slice(0, MAX_FIELD_LENGTH)}`
      : '';
    const linked = n.linkedChapterIds.length > 0
      ? `关联章节：${n.linkedChapterIds.length} 个`
      : '';
    return `  [${n.type}] ${n.title}${desc ? ` | ${desc}` : ''}${linked ? ` | ${linked}` : ''}`;
  });

  const text = `【大纲规划】（共 ${nodes.length} 个节点）\n${lines.join('\n')}`;
  const summary = `共 ${nodes.length} 个节点：${limited.map((n) => n.title).join(' → ')}`;
  return { text, summary, hasOutline: true };
}

/** 收集角色库 */
async function collectCharacters(projectId: string): Promise<string> {
  const chars = await listCharacters(projectId);
  if (!chars || chars.length === 0) return '';

  const limited = chars.slice(0, MAX_ITEMS);
  const lines = limited.map((c) => {
    const roleLabel = c.role
      ? ({ protagonist: '主角', femaleLead: '女主', supporting: '配角', minor: '路人甲' } as const)[c.role] || c.role
      : '';
    const parts = [`- ${c.name}`];
    if (roleLabel) parts.push(`[${roleLabel}]`);
    if (c.personality) parts.push(`性格：${c.personality.slice(0, MAX_FIELD_LENGTH)}`);
    if (c.appearance) parts.push(`外貌：${c.appearance.slice(0, MAX_FIELD_LENGTH)}`);
    if (c.speechStyle) parts.push(`说话风格：${c.speechStyle.slice(0, MAX_FIELD_LENGTH)}`);
    if (c.backstory) parts.push(`背景：${c.backstory.slice(0, MAX_FIELD_LENGTH)}`);
    if (c.desire) parts.push(`欲望：${c.desire.slice(0, 80)}`);
    if (c.fear) parts.push(`恐惧：${c.fear.slice(0, 80)}`);
    if (c.weakness) parts.push(`弱点：${c.weakness.slice(0, 80)}`);
    return parts.join(' | ');
  });

  return `【角色设定】（共 ${chars.length} 个角色）\n${lines.join('\n')}`;
}

/** 收集地点库 */
async function collectLocations(projectId: string): Promise<string> {
  const locs = await listLocations(projectId);
  if (!locs || locs.length === 0) return '';

  const limited = locs.slice(0, MAX_ITEMS);
  const lines = limited.map((l) => {
    const parts = [`- ${l.name}`];
    if (l.world) parts.push(`世界：${l.world}`);
    if (l.description) parts.push(`描述：${l.description.slice(0, MAX_FIELD_LENGTH)}`);
    return parts.join(' | ');
  });

  return `【地点设定】（共 ${locs.length} 个地点）\n${lines.join('\n')}`;
}

/** 收集物品库 */
async function collectItems(projectId: string): Promise<string> {
  const items = await listItems(projectId);
  if (!items || items.length === 0) return '';

  const limited = items.slice(0, MAX_ITEMS);
  const lines = limited.map((i) => {
    const parts = [`- ${i.name}`];
    if (i.type) parts.push(`类型：${i.type}`);
    if (i.description) parts.push(`描述：${i.description.slice(0, MAX_FIELD_LENGTH)}`);
    if (i.currentHolders && i.currentHolders.length > 0) {
      parts.push(`持有者：${i.currentHolders.join('、')}`);
    }
    return parts.join(' | ');
  });

  return `【物品设定】（共 ${items.length} 个物品）\n${lines.join('\n')}`;
}

/** 收集伏笔列表 */
async function collectForeshadows(projectId: string): Promise<string> {
  const foreshadows = await listForeshadows(projectId);
  if (!foreshadows || foreshadows.length === 0) return '';

  const limited = foreshadows.slice(0, MAX_ITEMS);
  const typeLabel: Record<string, string> = {
    identity: '身份', motivation: '动机', relation: '关系',
    trauma: '创伤', turning: '转折', fate: '命运',
  };
  const statusLabel: Record<string, string> = {
    planted: '已播种', hinted: '已暗示', payed_off: '已回收', abandoned: '已废弃',
  };

  const lines = limited.map((f) => {
    const parts = [
      `- [${typeLabel[f.type] || f.type}] ${f.description.slice(0, MAX_FIELD_LENGTH)}`,
    ];
    parts.push(`第${f.seedChapter}章播种`);
    if (f.payoffChapter) parts.push(`第${f.payoffChapter}章回收`);
    else parts.push(`状态：${statusLabel[f.status] || f.status}`);
    return parts.join(' | ');
  });

  return `【伏笔列表】（共 ${foreshadows.length} 条）\n${lines.join('\n')}`;
}

/** 收集事件列表 */
async function collectEvents(projectId: string): Promise<string> {
  const events = await listEvents(projectId);
  if (!events || events.length === 0) return '';

  const limited = events.slice(0, MAX_ITEMS);
  const lines = limited.map((e) => {
    const desc = e.description
      ? `：${e.description.slice(0, MAX_FIELD_LENGTH)}`
      : '';
    return `  - 第${e.chapter}章：${e.title}${desc}`;
  });

  return `【事件列表】（共 ${events.length} 个事件）\n${lines.join('\n')}`;
}

/** 收集参考书 */
async function collectReferenceBooks(projectId: string): Promise<string> {
  const books = await listReferenceBooks(projectId);
  if (!books || books.length === 0) return '';

  const limited = books.slice(0, MAX_ITEMS);
  const lines = limited.map((book) => {
    const parts = [`- 《${book.title}》`];
    if (book.author) parts.push(`作者：${book.author}`);
    parts.push(`章节数：${book.chapters.length}`);

    // 取前几章内容作为参考，限制总字数
    let contentPreview = '';
    let remaining = MAX_REF_BOOK_CHARS;
    for (const ch of book.chapters) {
      if (remaining <= 0) break;
      const take = Math.min(ch.content.length, remaining);
      contentPreview += `\n    【${ch.title}】${ch.content.slice(0, take)}`;
      remaining -= take;
    }
    if (book.chapters.length > 0 && contentPreview.length > MAX_REF_BOOK_CHARS) {
      contentPreview += '\n    （内容过长，已截断）';
    }

    parts.push(`内容摘要：${contentPreview || '(空)'}`);
    return parts.join(' | ');
  });

  return `【参考书】（共 ${books.length} 本）\n${lines.join('\n\n')}`;
}

/** 收集前三章内容 */
async function collectPreviousChapters(
  projectId: string,
  currentChapterOrder: number,
): Promise<{ text: string; chapters: { title: string; content: string; order: number }[] }> {
  const allChapters = await listChapters(projectId);
  if (!allChapters || allChapters.length === 0) {
    return { text: '（暂未创建章节）', chapters: [] };
  }

  // 按 order 排序，取当前章节之前的最新 3 章
  const sorted = [...allChapters].sort((a, b) => a.order - b.order);
  const prevChapters = sorted
    .filter((ch) => ch.order < currentChapterOrder)
    .slice(-3);

  if (prevChapters.length === 0) {
    return { text: '（当前为第一章，无前文）', chapters: [] };
  }

  const lines = prevChapters.map((ch) => {
    const content = ch.content
      ? ch.content.slice(0, MAX_PREV_CHAPTER_CHARS)
      : '（空内容）';
    const truncMsg = ch.content && ch.content.length > MAX_PREV_CHAPTER_CHARS
      ? '\n（内容过长，已截断至前 3000 字）'
      : '';
    return `--- 第${ch.order}章：${ch.title} ---\n${content}${truncMsg}`;
  });

  const text = `【前三章内容】\n${lines.join('\n\n')}`;
  return {
    text,
    chapters: prevChapters.map((ch) => ({
      title: ch.title,
      content: ch.content || '',
      order: ch.order,
    })),
  };
}

// ============================================================
// 主入口
// ============================================================

/**
 * 构建完整的项目上下文，包含所有模块数据和前三章。
 *
 * @param projectId 当前项目 ID
 * @param currentChapterOrder 当前章节的 order（用于确定前三章范围）
 * @returns 结构化的项目上下文
 */
export async function buildProjectContext(
  projectId: string,
  currentChapterOrder: number,
): Promise<ProjectContext> {
  const [outline, characters, locations, items, foreshadows, events, referenceBooks, prevChapters] =
    await Promise.all([
      collectOutline(projectId),
      collectCharacters(projectId),
      collectLocations(projectId),
      collectItems(projectId),
      collectForeshadows(projectId),
      collectEvents(projectId),
      collectReferenceBooks(projectId),
      collectPreviousChapters(projectId, currentChapterOrder),
    ]);

  const sections: string[] = [];

  // 1. 大纲（始终放在最前面，续写最重要的参考）
  sections.push(outline.text);

  // 2. 前三章
  sections.push(prevChapters.text);

  // 3. 角色设定
  if (characters) sections.push(characters);

  // 4. 地点设定
  if (locations) sections.push(locations);

  // 5. 物品设定
  if (items) sections.push(items);

  // 6. 伏笔
  if (foreshadows) sections.push(foreshadows);

  // 7. 事件
  if (events) sections.push(events);

  // 8. 参考书
  if (referenceBooks) sections.push(referenceBooks);

  return {
    hasOutline: outline.hasOutline,
    text: sections.join('\n\n'),
    previousChapters: prevChapters.chapters,
    outlineSummary: outline.summary,
  };
}

/**
 * 仅检查大纲是否已填写（轻量查询，用于快速判断）。
 */
export async function checkOutlineExists(projectId: string): Promise<boolean> {
  const nodes = await listOutlineNodes(projectId);
  return nodes && nodes.length > 0;
}