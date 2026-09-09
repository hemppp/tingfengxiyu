// ============================================================
// 时间线 Service
// ============================================================

import { schema } from '@novel/db';
import type { TimelineEvent } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['characterIds'];

function rowToTimelineEvent(r: Record<string, unknown>): TimelineEvent {
  const result = normalizeTimestamps<TimelineEvent>(r);
  (result as unknown as Record<string, unknown>).characterIds = parseJson(r.characterIds, []) as string[];
  return result;
}

function timelineEventToRow(e: TimelineEvent): Record<string, unknown> {
  const row = { ...e } as unknown as Record<string, unknown>;
  row.characterIds = JSON.stringify(e.characterIds ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<TimelineEvent>(schema.timelineEvents, {
  rowToModel: rowToTimelineEvent,
  modelToRow: timelineEventToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'TimelineEvents',
  scope: 'project',
});

export async function createTimelineEvent(data: Omit<TimelineEvent, 'createdAt' | 'updatedAt'>, projectId: string): Promise<TimelineEvent> {
  const now = Date.now();
  const event: TimelineEvent = {
    ...data,
    id: data.id ?? uuidv4(),
    characterIds: data.characterIds ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(event, false, projectId);
  return event;
}

export async function getTimelineEvent(id: string, projectId: string): Promise<TimelineEvent | null> {
  return service.getById(id, projectId);
}

export async function listTimelineEvents(projectId: string): Promise<TimelineEvent[]> {
  const events = await service.loadAll(projectId, projectId);
  return events.sort((a, b) => a.order - b.order);
}

export async function updateTimelineEvent(id: string, data: Partial<Omit<TimelineEvent, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteTimelineEvent(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
