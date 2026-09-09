// ============================================================
// 伏笔 Service
// ============================================================

import { schema } from '@novel/db';
import type { Foreshadow } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['hints', 'relatedCharacters', 'relatedItems', 'relatedEvents', 'earmarks', 'tags'];

function rowToForeshadow(r: Record<string, unknown>): Foreshadow {
  const result = normalizeTimestamps<Foreshadow>(r);
  (result as unknown as Record<string, unknown>).hints = parseJson(r.hints, []);
  (result as unknown as Record<string, unknown>).relatedCharacters = parseJson(r.relatedCharacters, []) as string[];
  (result as unknown as Record<string, unknown>).relatedItems = parseJson(r.relatedItems, []) as string[];
  (result as unknown as Record<string, unknown>).relatedEvents = parseJson(r.relatedEvents, []) as string[];
  (result as unknown as Record<string, unknown>).earmarks = parseJson(r.earmarks, []) as string[];
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function foreshadowToRow(fs: Foreshadow): Record<string, unknown> {
  const row = { ...fs } as unknown as Record<string, unknown>;
  row.hints = JSON.stringify(fs.hints ?? []);
  row.relatedCharacters = JSON.stringify(fs.relatedCharacters ?? []);
  row.relatedItems = JSON.stringify(fs.relatedItems ?? []);
  row.relatedEvents = JSON.stringify(fs.relatedEvents ?? []);
  row.earmarks = JSON.stringify((fs as Foreshadow & { earmarks?: string[] }).earmarks ?? []);
  row.tags = JSON.stringify(fs.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<Foreshadow>(schema.foreshadows, {
  rowToModel: rowToForeshadow,
  modelToRow: foreshadowToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'Foreshadows',
  scope: 'project',
});

export async function createForeshadow(data: Omit<Foreshadow, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Foreshadow> {
  const now = Date.now();
  const foreshadow: Foreshadow = {
    ...data,
    id: data.id ?? uuidv4(),
    hints: data.hints ?? [],
    relatedCharacters: data.relatedCharacters ?? [],
    relatedItems: data.relatedItems ?? [],
    relatedEvents: data.relatedEvents ?? [],
    earmarks: data.earmarks ?? [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(foreshadow, false, projectId);
  return foreshadow;
}

export async function getForeshadow(id: string, projectId: string): Promise<Foreshadow | null> {
  return service.getById(id, projectId);
}

export async function listForeshadows(projectId: string): Promise<Foreshadow[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateForeshadow(id: string, data: Partial<Omit<Foreshadow, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteForeshadow(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}

export async function getActiveForeshadows(projectId: string): Promise<Foreshadow[]> {
  const all = await service.loadAll(projectId, projectId);
  return all.filter((f) => f.status === 'planted' || f.status === 'hinted');
}

export async function getOverdueForeshadows(projectId: string): Promise<Foreshadow[]> {
  const all = await service.loadAll(projectId, projectId);
  // 仍在 planted/hinted 状态但没有 payoffChapter 的视为"逾期"
  return all.filter((f) =>
    (f.status === 'planted' || f.status === 'hinted') && !f.payoffChapter,
  );
}
