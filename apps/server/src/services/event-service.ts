// ============================================================
// 事件（StoryEvent）Service
// ============================================================

import { schema } from '@novel/db';
import type { StoryEvent } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['participants', 'relatedItems', 'relatedLocations', 'consequences', 'tags'];

function rowToStoryEvent(r: Record<string, unknown>): StoryEvent {
  const result = normalizeTimestamps<StoryEvent>(r);
  (result as unknown as Record<string, unknown>).participants = parseJson(r.participants, []) as string[];
  (result as unknown as Record<string, unknown>).relatedItems = parseJson(r.relatedItems, []) as string[];
  (result as unknown as Record<string, unknown>).relatedLocations = parseJson(r.relatedLocations, []) as string[];
  (result as unknown as Record<string, unknown>).consequences = parseJson(r.consequences, []) as string[];
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function storyEventToRow(e: StoryEvent): Record<string, unknown> {
  const row = { ...e } as unknown as Record<string, unknown>;
  row.participants = JSON.stringify(e.participants ?? []);
  row.relatedItems = JSON.stringify(e.relatedItems ?? []);
  row.relatedLocations = JSON.stringify(e.relatedLocations ?? []);
  row.consequences = JSON.stringify(e.consequences ?? []);
  row.tags = JSON.stringify(e.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<StoryEvent>(schema.storyEvents, {
  rowToModel: rowToStoryEvent,
  modelToRow: storyEventToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'StoryEvents',
  scope: 'project',
});

export async function createEvent(data: Omit<StoryEvent, 'createdAt' | 'updatedAt'>, projectId: string): Promise<StoryEvent> {
  const now = Date.now();
  const event: StoryEvent = {
    ...data,
    id: data.id ?? uuidv4(),
    participants: data.participants ?? [],
    relatedItems: data.relatedItems ?? [],
    relatedLocations: data.relatedLocations ?? [],
    consequences: data.consequences ?? [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(event, false, projectId);
  return event;
}

export async function getEvent(id: string, projectId: string): Promise<StoryEvent | null> {
  return service.getById(id, projectId);
}

export async function listEvents(projectId: string): Promise<StoryEvent[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateEvent(id: string, data: Partial<Omit<StoryEvent, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteEvent(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
