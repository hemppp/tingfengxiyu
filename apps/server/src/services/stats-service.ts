// ============================================================
// 写作统计（WritingStats）Service
// ============================================================

import { schema } from '@novel/db';
import type { WritingStats } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

interface WritingStatsRow extends WritingStats {
  id: string;
  createdAt: number;
  updatedAt: number;
}

const service = new BaseService<WritingStatsRow>(schema.writingStats, {
  rowToModel: (r) => {
    const row = r as unknown as Record<string, unknown>;
    // 统一用 normalizeTimestamps 处理 createdAt/updatedAt
    // 处理 Date（Drizzle timestamp mode 返回）和 number（旧行回填为 0）两种情况
    const normalized = normalizeTimestamps<WritingStatsRow>(row);
    return {
      id: normalized.id,
      projectId: normalized.projectId,
      date: normalized.date,
      wordCount: typeof normalized.wordCount === 'number' ? normalized.wordCount : 0,
      chapterId: normalized.chapterId,
      duration: normalized.duration,
      createdAt: normalized.createdAt ?? 0,
      updatedAt: normalized.updatedAt ?? 0,
    };
  },
  modelToRow: (model) => {
    const row = { ...model } as unknown as Record<string, unknown>;
    toDbTimestamps(row);
    return row;
  },
  loadByColumn: 'projectId',
  entityLabel: 'WritingStats',
  scope: 'project',
});

export async function listStats(projectId: string): Promise<WritingStats[]> {
  const rows = await service.loadAllSafe(projectId, projectId);
  return rows.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest }) => rest);
}

export async function createStats(data: Omit<WritingStats, 'createdAt' | 'updatedAt'> & { id?: string }, projectId: string): Promise<WritingStats> {
  const now = Date.now();
  const stat: WritingStatsRow = {
    ...data,
    id: data.id ?? uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await service.save(stat, false, projectId);
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...result } = stat;
  return result;
}

export async function getStatsByDate(projectId: string, date: string): Promise<WritingStats | null> {
  const all = await listStats(projectId);
  return all.find((s) => s.date === date) ?? null;
}

export async function getStats(id: string, projectId: string): Promise<WritingStatsRow | null> {
  return service.getById(id, projectId);
}

export async function deleteStats(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
