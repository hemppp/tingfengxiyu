// ============================================================
// 物品 Service
// ============================================================

import { schema } from '@novel/db';
import type { Item } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['states', 'holders', 'currentHolders', 'relations', 'chapters', 'tags'];

function rowToItem(r: Record<string, unknown>): Item {
  const result = normalizeTimestamps<Item>(r);
  (result as unknown as Record<string, unknown>).states = parseJson(r.states, []);
  (result as unknown as Record<string, unknown>).holders = parseJson(r.holders, []);
  (result as unknown as Record<string, unknown>).currentHolders = parseJson(r.currentHolders, []) as string[];
  (result as unknown as Record<string, unknown>).relations = parseJson(r.relations, []) as Item['relations'];
  (result as unknown as Record<string, unknown>).chapters = parseJson(r.chapters, []) as number[];
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function itemToRow(i: Item): Record<string, unknown> {
  const row = { ...i } as unknown as Record<string, unknown>;
  row.states = JSON.stringify(i.states ?? []);
  row.holders = JSON.stringify(i.holders ?? []);
  row.currentHolders = JSON.stringify(i.currentHolders ?? []);
  row.relations = JSON.stringify(i.relations ?? []);
  row.chapters = JSON.stringify(i.chapters ?? []);
  row.tags = JSON.stringify(i.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<Item>(schema.items, {
  rowToModel: rowToItem,
  modelToRow: itemToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'Items',
  scope: 'project',
});

export async function createItem(data: Omit<Item, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Item> {
  const now = Date.now();
  const item: Item = {
    ...data,
    id: data.id ?? uuidv4(),
    states: data.states ?? [],
    holders: data.holders ?? [],
    currentHolders: data.currentHolders ?? [],
    relations: data.relations ?? [],
    chapters: data.chapters ?? [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(item, false, projectId);
  return item;
}

export async function getItem(id: string, projectId: string): Promise<Item | null> {
  return service.getById(id, projectId);
}

export async function listItems(projectId: string): Promise<Item[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateItem(id: string, data: Partial<Omit<Item, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteItem(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
