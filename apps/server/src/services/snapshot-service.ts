// ============================================================
// 快照 Service
// ============================================================

import { schema, getProjectDbSync, eq, and, desc } from '@novel/db';
import type { Snapshot } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const service = new BaseService<Snapshot>(schema.snapshots, {
  rowToModel: (r) => normalizeTimestamps<Snapshot>(r),
  modelToRow: (model) => {
    const row = { ...model } as unknown as Record<string, unknown>;
    toDbTimestamps(row);
    return row;
  },
  loadByColumn: 'chapterId',
  entityLabel: 'Snapshots',
  scope: 'project',
});

/** 每章自动快照最大保留数量（超出时删除最旧的自动快照，手动快照不受限） */
const MAX_AUTO_SNAPSHOTS_PER_CHAPTER = 20;

/**
 * 清理单章的过期自动快照，保留最近 MAX_AUTO_SNAPSHOTS_PER_CHAPTER 个。
 * 手动快照（auto=false）不受限制。
 * 在每次创建快照后调用，防止存储无限膨胀。
 */
export async function pruneAutoSnapshots(chapterId: string, projectId: string): Promise<void> {
  const db = getProjectDbSync(projectId);
  if (!db) return;

  // 查询该章节的所有自动快照，按创建时间倒序
  const autoSnaps = db.select({ id: schema.snapshots.id, createdAt: schema.snapshots.createdAt })
    .from(schema.snapshots)
    .where(and(eq(schema.snapshots.chapterId, chapterId), eq(schema.snapshots.auto, true)))
    .orderBy(desc(schema.snapshots.createdAt))
    .all();

  if (autoSnaps.length <= MAX_AUTO_SNAPSHOTS_PER_CHAPTER) return;

  // 删除超出数量的旧自动快照
  const toDelete = autoSnaps.slice(MAX_AUTO_SNAPSHOTS_PER_CHAPTER);
  for (const snap of toDelete) {
    db.delete(schema.snapshots).where(eq(schema.snapshots.id, snap.id)).run();
  }
  console.debug(`[pruneAutoSnapshots] 章节 ${chapterId} 清理了 ${toDelete.length} 个过期自动快照`);
  // better-sqlite3 增量写入，无需 saveToDisk
}

export async function createSnapshot(data: Omit<Snapshot, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Snapshot> {
  const now = Date.now();
  const snapshot: Snapshot = {
    ...data,
    id: data.id ?? uuidv4(),
    auto: data.auto ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await service.save(snapshot, false, projectId);
  // 自动快照创建后清理过期快照，防止存储膨胀
  if (snapshot.auto) {
    await pruneAutoSnapshots(snapshot.chapterId, projectId);
  }
  return snapshot;
}

export async function getSnapshot(id: string, projectId: string): Promise<Snapshot | null> {
  return service.getById(id, projectId);
}

export async function listSnapshots(chapterId: string, projectId: string): Promise<Snapshot[]> {
  return service.loadAll(chapterId, projectId);
}

export async function deleteSnapshot(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
