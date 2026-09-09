// ============================================================
// 章节 Service
// ============================================================

import { schema, getDb, getProjectDbSync, eq, and, isNotNull, isNull, lt, sql, saveToDisk } from '@novel/db';
import type { Chapter } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 重算并回写项目总字数。
 *
 * 求和所有未软删除章节的 wordCount（来自项目库），更新主库 projects.currentWordCount。
 * 在章节增删改后调用，保证书架页/书卡的字数显示与实际章节字数一致。
 *
 * 跨库操作：项目库（chapters）→ 主库（projects）。
 */
async function syncProjectWordCount(projectId: string): Promise<void> {
  const projectDb = getProjectDbSync(projectId);
  if (!projectDb) {
    console.warn(`[syncProjectWordCount] 项目库未初始化: ${projectId}，跳过`);
    return;
  }
  const mainDb = getDb();
  if (!mainDb) return;

  const rows = projectDb.select({ wordCount: schema.chapters.wordCount, deletedAt: schema.chapters.deletedAt })
    .from(schema.chapters)
    .where(eq(schema.chapters.projectId, projectId))
    .all();

  const total = rows
    .filter((r) => r.deletedAt == null)
    .reduce((sum, r) => sum + (r.wordCount ?? 0), 0);

  mainDb.update(schema.projects)
    .set({ currentWordCount: total, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId))
    .run();

  // 主库为 sql.js/better-sqlite3：主库变更需要落盘
  await saveToDisk();
}

/** 解析 JSON 字段，失败返回 fallback */
function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 章节删除联动清理：移除/更新与该章节关联的实体数据。
 *
 * 清理范围：
 * - timeline_events：删除 chapter = order 的事件（一对一，直接删）
 * - story_events：删除 chapter = order 的事件
 * - items.chapters：从数组中移除该 order
 * - items.holders：移除该 order 对应的流转记录，重算 currentHolders
 * - characters.chapters / locations.chapters：从数组中移除该 order
 * - foreshadows：seedChapter 命中则删除伏笔，payoffChapter 命中则置 null
 *
 * ★ 孤儿实体清理：清理后 chapters 数组为空的物品/角色/地点一并删除。
 *   场景：某实体仅在被删章节出现（如 chapters: [3]，删除第三章后变 []），
 *   保留它会让面板里出现"幽灵实体"，故直接删除。
 *   跨章节实体（chapters 仍有其他 order）保留。
 *
 * snapshots 不清理（便于回收站还原时使用，硬删除时由外键 cascade）。
 *
 * 所有操作均在项目库内进行（每本书独立 .db 文件）。
 */
async function cascadeCleanChapterRelations(projectId: string, chapterOrder: number): Promise<void> {
  const db = getProjectDbSync(projectId);
  if (!db) {
    console.warn('[cascadeCleanChapterRelations] 项目库未初始化，跳过清理');
    return;
  }

  const now = new Date();
  let timelineDeleted = 0;
  let storyDeleted = 0;
  let itemsUpdated = 0;
  let itemsDeleted = 0;
  let charsUpdated = 0;
  let charsDeleted = 0;
  let locsUpdated = 0;
  let locsDeleted = 0;
  let foreshadowsDeleted = 0;
  let foreshadowsUpdated = 0;

  // ★ 全部清理操作包进单一事务：任一步抛错则整体回滚，避免"关联已清但章节未删"的中间态
  db.transaction(() => {
    // 1) 删除该章节的时间线事件和故事事件（一对一关系）
    //    用 sql 标签获取 changes 计数（Drizzle delete().run() 返回 void）
    const tlBefore = db.select({ id: schema.timelineEvents.id }).from(schema.timelineEvents)
      .where(and(eq(schema.timelineEvents.projectId, projectId), eq(schema.timelineEvents.chapter, chapterOrder))).all().length;
    db.delete(schema.timelineEvents)
      .where(and(eq(schema.timelineEvents.projectId, projectId), eq(schema.timelineEvents.chapter, chapterOrder)))
      .run();
    timelineDeleted = tlBefore;
    const seBefore = db.select({ id: schema.storyEvents.id }).from(schema.storyEvents)
      .where(and(eq(schema.storyEvents.projectId, projectId), eq(schema.storyEvents.chapter, chapterOrder))).all().length;
    db.delete(schema.storyEvents)
      .where(and(eq(schema.storyEvents.projectId, projectId), eq(schema.storyEvents.chapter, chapterOrder)))
      .run();
    storyDeleted = seBefore;

    // 2) 清理 items 的 chapters / holders 引用；清理后 chapters 为空的物品删除（孤儿清理）
    const itemRows = db.select({ id: schema.items.id, chapters: schema.items.chapters, holders: schema.items.holders, currentHolders: schema.items.currentHolders })
      .from(schema.items)
      .where(eq(schema.items.projectId, projectId))
      .all();

    for (const row of itemRows) {
      const chapters = parseJsonField<number[]>(row.chapters, []);
      const holders = parseJsonField<Array<{ characterId: string; chapter: number; action: string }>>(row.holders, []);
      const newChapters = chapters.filter((c) => c !== chapterOrder);
      const newHolders = holders.filter((h) => h.chapter !== chapterOrder);

      // 重算 currentHolders：保留仍持有（最后一次 gained 未被 lost）的角色
      const currentSet = new Set<string>();
      const sorted = [...newHolders].sort((a, b) => a.chapter - b.chapter);
      for (const h of sorted) {
        if (h.action === 'gained' || h.action === 'transferred') currentSet.add(h.characterId);
        else if (h.action === 'lost') currentSet.delete(h.characterId);
      }
      const newCurrentHolders = Array.from(currentSet);

      const chapterChanged = newChapters.length !== chapters.length;
      const holderChanged = newHolders.length !== holders.length;

      // ★ 孤儿清理：清理后 chapters 为空，且 holders 也为空（无任何章节引用、无流转记录）→ 删除物品
      if (newChapters.length === 0 && newHolders.length === 0 && (chapterChanged || holderChanged || chapters.length === 0)) {
        db.delete(schema.items).where(eq(schema.items.id, row.id)).run();
        itemsDeleted++;
        continue;
      }

      // 仅当 chapters 或 holders 确实变化时才更新
      if (chapterChanged || holderChanged) {
        db.update(schema.items)
          .set({
            chapters: JSON.stringify(newChapters),
            holders: JSON.stringify(newHolders),
            currentHolders: JSON.stringify(newCurrentHolders),
            updatedAt: now,
          })
          .where(eq(schema.items.id, row.id))
          .run();
        itemsUpdated++;
      }
    }

    // 3) 清理 characters / locations 的 chapters 引用；清理后为空的实体删除（孤儿清理）
    const cleanChaptersArrayWithOrphanDelete = (
      table: typeof schema.characters | typeof schema.locations,
    ): { updated: number; deleted: number } => {
      let updated = 0;
      let deleted = 0;
      const rows = db.select({ id: table.id, chapters: table.chapters })
        .from(table)
        .where(eq(table.projectId, projectId))
        .all();
      for (const row of rows) {
        const chapters = parseJsonField<number[]>(row.chapters, []);
        const newChapters = chapters.filter((c) => c !== chapterOrder);
        // ★ 孤儿清理：清理后 chapters 为空 → 删除实体（不再属于任何章节）
        if (newChapters.length === 0 && chapters.length > 0) {
          db.delete(table).where(eq(table.id, row.id)).run();
          deleted++;
          continue;
        }
        // 仅当数组确实变化时才更新，减少无效写入
        if (newChapters.length !== chapters.length) {
          db.update(table)
            .set({ chapters: JSON.stringify(newChapters), updatedAt: now })
            .where(eq(table.id, row.id))
            .run();
          updated++;
        }
      }
      return { updated, deleted };
    };
    const charResult = cleanChaptersArrayWithOrphanDelete(schema.characters);
    charsUpdated = charResult.updated;
    charsDeleted = charResult.deleted;
    const locResult = cleanChaptersArrayWithOrphanDelete(schema.locations);
    locsUpdated = locResult.updated;
    locsDeleted = locResult.deleted;

    // 4) foreshadows：
    //    - seedChapter 命中：删除整个伏笔（种子章节已删，伏笔失去意义）
    //    - payoffChapter 命中：仅置 null（伏笔仍在，只是尚未回收）
    const foreshadowsRows = db.select({ id: schema.foreshadows.id, seedChapter: schema.foreshadows.seedChapter, payoffChapter: schema.foreshadows.payoffChapter })
      .from(schema.foreshadows)
      .where(eq(schema.foreshadows.projectId, projectId))
      .all();
    for (const row of foreshadowsRows) {
      if (row.seedChapter === chapterOrder) {
        // 种子章节被删 → 删除伏笔
        db.delete(schema.foreshadows).where(eq(schema.foreshadows.id, row.id)).run();
        foreshadowsDeleted++;
      } else if (row.payoffChapter === chapterOrder) {
        // 回收章节被删 → 仅置空 payoffChapter
        db.update(schema.foreshadows)
          .set({ payoffChapter: null, updatedAt: now })
          .where(eq(schema.foreshadows.id, row.id))
          .run();
        foreshadowsUpdated++;
      }
    }
  });

  console.log(
    `[cascadeCleanChapterRelations] chapter=${chapterOrder} 完成: ` +
    `timeline删除=${timelineDeleted} story删除=${storyDeleted} ` +
    `items更新=${itemsUpdated} items孤儿删除=${itemsDeleted} ` +
    `characters更新=${charsUpdated} characters孤儿删除=${charsDeleted} ` +
    `locations更新=${locsUpdated} locations孤儿删除=${locsDeleted} ` +
    `foreshadows删除=${foreshadowsDeleted} foreshadows更新=${foreshadowsUpdated}`
  );
  // better-sqlite3 增量写入，无需 saveToDisk
}

/** 软删除保留期：30 天后自动硬删除 */
const SOFT_DELETE_RETENTION_MS = 30 * 24 * 3600 * 1000;

const service = new BaseService<Chapter>(schema.chapters, {
  rowToModel: (r) => normalizeTimestamps<Chapter>(r),
  modelToRow: (model) => {
    const row = { ...model } as unknown as Record<string, unknown>;
    toDbTimestamps(row);
    return row;
  },
  loadByColumn: 'projectId',
  entityLabel: 'Chapters',
  scope: 'project',
});

export async function createChapter(data: Omit<Chapter, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Chapter> {
  const db = getProjectDbSync(projectId);
  if (!db) throw new Error('项目库未初始化');

  const now = Date.now();
  const chapter: Chapter = {
    ...data,
    id: data.id ?? uuidv4(),
    // order 由事务内计算，此处占位
    order: 0,
    content: data.content ?? '',
    wordCount: data.wordCount ?? 0,
    status: data.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // ★ maxOrder 计算 + 插入包进同一事务，防止并发创建时多个章节拿到相同 order
  // better-sqlite3 事务是同步的，且 default 待久化为 no-op（scope='project'）
  db.transaction(() => {
    const maxOrderRow = db
      .select({ maxOrder: sql`MAX(${schema.chapters.order})`.as('maxOrder') })
      .from(schema.chapters)
      .where(and(eq(schema.chapters.projectId, projectId), isNull(schema.chapters.deletedAt)))
      .get() as { maxOrder: number | null } | undefined;
    const computedOrder = (maxOrderRow?.maxOrder ?? 0) + 1;
    chapter.order = computedOrder;

    // 如果自动生成标题（第X章），则根据正确的 order 重新生成标题
    const defaultTitleRegex = /^第\s*(\d+|[一二三四五六七八九十]+)\s*章$/;
    if (defaultTitleRegex.test(chapter.title)) {
      const chineseNums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
      chapter.title = computedOrder <= 10
        ? `第${chineseNums[computedOrder]}章`
        : `第 ${computedOrder} 章`;
    }

    // 直接插入（service.save 内部的 maybePersist 对 project scope 是 no-op）
    // ★ schema.chapters 强转为 any 与 BaseService 保持一致：Drizzle 的 insert values 类型复杂，
    // row 已由 toDbTimestamps 正确转换，类型安全由 modelToRow 保证
    const row = { ...chapter } as unknown as Record<string, unknown>;
    toDbTimestamps(row);
    db.insert(schema.chapters as any).values(row).run();
  });

  await syncProjectWordCount(chapter.projectId);
  return chapter;
}

export async function getChapter(id: string, projectId: string): Promise<Chapter | null> {
  return service.getById(id, projectId);
}

/**
 * 列出项目的所有"未删除"章节（按 order 排序）。
 * 已软删除（deletedAt != null）的章节不会出现在常规列表中。
 */
export async function listChapters(projectId: string): Promise<Chapter[]> {
  const all = await service.loadAll(projectId, projectId);
  return all
    .filter((c) => c.deletedAt == null)
    .sort((a, b) => a.order - b.order);
}

/**
 * 仅统计项目的未删除章节数（不加载正文/整行数据）。
 * 书架页展示“X 章”时无需拉取完整章节列表，用 COUNT 查询即可，
 * 显著降低书架页首次渲染的网络与解析开销（避免 N+1 全量拉取）。
 */
export async function countChapters(projectId: string): Promise<number> {
  const db = getProjectDbSync(projectId);
  if (!db) return 0;
  const row = db
    .select({ count: sql`COUNT(*)`.as('count') })
    .from(schema.chapters)
    .where(and(eq(schema.chapters.projectId, projectId), isNull(schema.chapters.deletedAt)))
    .get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

/**
 * 清理已过期的软删除章节（删除时间超过 30 天），硬删除后不可恢复。
 * 由定时任务每小时执行一次，listTrashedChapters 也会即时调用，防止回收站无限堆积。
 *
 * 跨库扫描：从主库取所有 projectId，对每个项目初始化项目库并查询过期章节。
 *
 * @returns 实际硬删除的章节数量
 */
export async function cleanupExpiredChapters(): Promise<number> {
  const mainDb = getDb();
  if (!mainDb) return 0;

  // 取所有 projectId
  const projects = mainDb.select({ id: schema.projects.id }).from(schema.projects).all() as Array<{ id: string }>;
  if (projects.length === 0) return 0;

  const cutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_MS);
  let totalRemoved = 0;

  // 动态导入以避免循环依赖
  const { initProjectDb } = await import('@novel/db');

  for (const project of projects) {
    try {
      await initProjectDb(project.id);
      const projectDb = getProjectDbSync(project.id);
      if (!projectDb) continue;

      const expired = projectDb
        .select({ id: schema.chapters.id })
        .from(schema.chapters)
        .where(and(isNotNull(schema.chapters.deletedAt), lt(schema.chapters.deletedAt, cutoff)))
        .all();

      if (expired.length === 0) continue;

      for (const row of expired) {
        await service.delete(row.id, project.id);
      }
      totalRemoved += expired.length;
    } catch (e) {
      console.error(`[cleanupExpiredChapters] 项目 ${project.id} 清理失败:`, e);
    }
  }

  return totalRemoved;
}

/**
 * 列出已软删除的章节（回收站），按删除时间倒序。
 * 查询前顺带调用 cleanupExpiredChapters 做即时清理，避免回收站无限堆积。
 */
export async function listTrashedChapters(projectId: string): Promise<Chapter[]> {
  try {
    await cleanupExpiredChapters();
  } catch (e) {
    // 清理失败不应阻塞列表查询
    console.error('[chapter-service] cleanupExpiredChapters 失败:', e);
  }
  const all = await service.loadAll(projectId, projectId);
  return all
    .filter((c) => c.deletedAt != null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

export async function updateChapter(id: string, data: Partial<Omit<Chapter, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  const existing = await service.getById(id, projectId);

  // 检测内容是否从有字变空：触发联动清理
  // 条件：原字数 > 20 且 新字数 <= 20（几乎为空），或原内容有字而新内容为空
  if (existing && data.content !== undefined) {
    const oldWc = existing.wordCount ?? 0;
    const newContent = data.content ?? '';
    const newWc = data.wordCount ?? newContent.replace(/<[^>]+>/g, '').trim().length;
    const oldEmpty = oldWc <= 20;
    const newEmpty = newWc <= 20;

    if (!oldEmpty && newEmpty) {
      console.log(`[updateChapter] 章节 id=${id} 内容从 ${oldWc} 字变为 ${newWc} 字（接近清空），联动清理关联实体`);
      await cascadeCleanChapterRelations(existing.projectId, existing.order);
    }
  }

  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);

  // 字数变化时同步项目总字数。data.wordCount 为 undefined 时（仅更新标题等）跳过。
  if (existing && data.wordCount !== undefined) {
    await syncProjectWordCount(existing.projectId);
  }
}

/**
 * 软删除：标记 deletedAt，并联动清理关联实体（事件/物品/角色/地点的章节引用）。
 * 已软删除的章节再次调用 idempotent（不会重复清理关联）。
 *
 * 联动清理策略（见 cascadeCleanChapterRelations）：
 * - 一对一关系（timeline_events / story_events）：直接删除该章节的事件
 * - 多对多关系（items/characters/locations 的 chapters 数组）：仅移除该 order 引用
 * - 物品 holders 流转记录：移除该 order 的记录并重算 currentHolders
 *
 * 还原章节时不会自动恢复关联数据——用户重新扫描章节即可重建。
 *
 * 注意：deletedAt 字段在 schema 中为 timestamp mode，必须传 Date 对象；
 * 传 number 会被 Drizzle 当作原始整数写入，导致后续查询比较异常。
 */
export async function softDeleteChapter(id: string, projectId: string): Promise<void> {
  const chapter = await service.getById(id, projectId);
  if (!chapter) {
    console.warn('[softDeleteChapter] 章节不存在:', id);
    return;
  }
  // 已软删除则幂等返回，不重复清理
  if (chapter.deletedAt != null) {
    console.log('[softDeleteChapter] 章节已软删除，跳过:', id);
    return;
  }

  console.log(`[softDeleteChapter] 开始软删除章节 id=${id} order=${chapter.order} title="${chapter.title}"，联动清理关联实体...`);
  // 先联动清理关联实体（用 order 作为章节序号）
  await cascadeCleanChapterRelations(chapter.projectId, chapter.order);
  console.log(`[softDeleteChapter] 联动清理完成，标记 deletedAt`);

  // deletedAt 在 schema 中为 timestamp mode，需传 Date 对象；Chapter 类型定义为 number（读出时转换），故需 unknown 中转
  await service.update(id, { deletedAt: new Date(), updatedAt: Date.now() } as unknown as Partial<Chapter>, projectId);
  await syncProjectWordCount(chapter.projectId);
}

/**
 * 还原：清除 deletedAt 标记，章节重新出现在常规列表中。
 *
 * 仅当章节存在且处于软删除状态（deletedAt != null）时才执行还原，
 * 否则返回 null，调用方据此返回 400/404。
 */
export async function restoreChapter(id: string, projectId: string): Promise<Chapter | null> {
  const chapter = await service.getById(id, projectId);
  if (!chapter || chapter.deletedAt == null) {
    return null;
  }
  await service.update(id, { deletedAt: null, updatedAt: Date.now() } as Partial<Chapter>, projectId);
  await syncProjectWordCount(chapter.projectId);
  return await service.getById(id, projectId);
}

/**
 * 真正的硬删除（不可恢复）。
 * 回收站中点击"彻底删除"会调用此方法。
 *
 * 正常流程下，章节在软删除时已清理过关联实体，此处无需重复清理。
 * 但若章节跳过软删除直接被硬删除（异常路径），兜底清理一次关联以防残留。
 */
export async function deleteChapter(id: string, projectId: string): Promise<void> {
  const chapter = await service.getById(id, projectId);
  if (!chapter) return;
  // 兜底：若未经过软删除（关联可能还在），清理一次
  if (chapter.deletedAt == null) {
    await cascadeCleanChapterRelations(chapter.projectId, chapter.order);
  }
  await service.delete(id, projectId);
  await syncProjectWordCount(chapter.projectId);
}

/**
 * 清空回收站：将某项目下所有已软删除的章节硬删除。
 *
 * 顺序删除（for...of + await）以避免并发竞态：
 * better-sqlite3 虽为同步写入，但 service.delete 内部仍可能产生连锁副作用。
 */
export async function emptyTrash(projectId: string): Promise<number> {
  const trashed = await listTrashedChapters(projectId);
  for (const c of trashed) {
    await service.delete(c.id, projectId);
  }
  if (trashed.length > 0) {
    await syncProjectWordCount(projectId);
  }
  return trashed.length;
}

/**
 * 重新排序章节。
 *
 * 安全约束：每个 orderedIds[i] 必须属于传入的 projectId，否则跳过。
 * 这里用单条 SQL 批量更新 `WHERE id = ? AND projectId = ?`，由数据库在
 * 匹配 projectId 时才更新，避免攻击者用其他项目的章节 ID 越权改顺序。
 */
export async function reorderChapters(projectId: string, orderedIds: string[]): Promise<void> {
  const db = getProjectDbSync(projectId);
  if (!db) throw new Error('项目库未初始化');

  const now = Date.now();
  // ★ 包进事务：中途失败时整体回滚，避免"部分章节已重排、部分未动"的半成品状态
  db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      db.update(schema.chapters)
        .set({ order: i + 1, updatedAt: new Date(now) })
        .where(and(eq(schema.chapters.id, orderedIds[i]), eq(schema.chapters.projectId, projectId)))
        .run();
    }
  });
  // better-sqlite3 增量写入，无需 saveToDisk
}

export async function getChapterWordCount(id: string, projectId: string): Promise<number> {
  const chapter = await getChapter(id, projectId);
  return chapter?.wordCount ?? 0;
}
