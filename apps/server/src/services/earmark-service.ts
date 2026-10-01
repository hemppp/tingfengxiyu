// ============================================================
// Earmark Service
// ============================================================

import { schema } from '@novel/db';
import type { Earmark } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['relatedCharacters', 'relatedItems', 'tags'];

function rowToEarmark(r: Record<string, unknown>): Earmark {
  const result = normalizeTimestamps<Earmark>(r);
  (result as unknown as Record<string, unknown>).relatedCharacters = parseJson(r.relatedCharacters, []) as string[];
  (result as unknown as Record<string, unknown>).relatedItems = parseJson(r.relatedItems, []) as string[];
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function earmarkToRow(em: Earmark): Record<string, unknown> {
  const row = { ...em } as unknown as Record<string, unknown>;
  row.relatedCharacters = JSON.stringify(em.relatedCharacters ?? []);
  row.relatedItems = JSON.stringify(em.relatedItems ?? []);
  row.tags = JSON.stringify(em.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<Earmark>(schema.earmarks, {
  rowToModel: rowToEarmark,
  modelToRow: earmarkToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'Earmarks',
  scope: 'project',
});

export async function createEarmark(data: Omit<Earmark, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Earmark> {
  const now = Date.now();
  const earmark: Earmark = {
    ...data,
    id: data.id ?? uuidv4(),
    relatedCharacters: data.relatedCharacters ?? [],
    relatedItems: data.relatedItems ?? [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(earmark, false, projectId);
  return earmark;
}

export async function getEarmark(id: string, projectId: string): Promise<Earmark | null> {
  return service.getById(id, projectId);
}

export async function listEarmarks(projectId: string): Promise<Earmark[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateEarmark(id: string, data: Partial<Omit<Earmark, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteEarmark(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
