// ============================================================
// 参考书 Service
// 持久化存储参考书（参考书阅读器使用），替代前端 IndexedDB 方案。
// ============================================================

import { schema } from '@novel/db';
import type { ReferenceBook } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

// chapters 列已使用 drizzle 的 { mode: 'json' }，读写自动序列化/反序列化，
// 无需在 JSON_FIELDS 中声明（base-service 的 stringify 会双重编码）。

function rowToReferenceBook(r: Record<string, unknown>): ReferenceBook {
  const result = normalizeTimestamps<ReferenceBook>(r);
  // parseJson 同时处理 string 和已解析对象，兼容旧数据
  (result as unknown as Record<string, unknown>).chapters = parseJson(
    r.chapters,
    [],
  ) as ReferenceBook['chapters'];
  return result;
}

function bookToRow(b: ReferenceBook): Record<string, unknown> {
  const row = { ...b } as unknown as Record<string, unknown>;
  row.chapters = b.chapters ?? [];
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<ReferenceBook>(schema.referenceBooks, {
  rowToModel: rowToReferenceBook,
  modelToRow: bookToRow,
  jsonFields: [],
  loadByColumn: 'projectId',
  entityLabel: 'ReferenceBooks',
  scope: 'project',
});

export async function createReferenceBook(
  data: Omit<ReferenceBook, 'createdAt' | 'updatedAt'>,
  projectId: string,
): Promise<ReferenceBook> {
  const now = Date.now();
  const book: ReferenceBook = {
    ...data,
    id: data.id ?? uuidv4(),
    chapters: data.chapters ?? [],
    currentChapter: data.currentChapter ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await service.save(book, false, projectId);
  return book;
}

export async function getReferenceBook(id: string, projectId: string): Promise<ReferenceBook | null> {
  return service.getById(id, projectId);
}

export async function listReferenceBooks(projectId: string): Promise<ReferenceBook[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateReferenceBook(
  id: string,
  data: Partial<Omit<ReferenceBook, 'id' | 'createdAt'>>,
  projectId: string,
): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteReferenceBook(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
