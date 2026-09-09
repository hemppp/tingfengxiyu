// ============================================================
// 笔记 Service
// ============================================================

import { schema } from '@novel/db';
import type { Note } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['tags'];

function rowToNote(r: Record<string, unknown>): Note {
  const result = normalizeTimestamps<Note>(r);
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function noteToRow(n: Note): Record<string, unknown> {
  const row = { ...n } as unknown as Record<string, unknown>;
  row.tags = JSON.stringify(n.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<Note>(schema.notes, {
  rowToModel: rowToNote,
  modelToRow: noteToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'Notes',
  scope: 'project',
});

export async function createNote(data: Omit<Note, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    ...data,
    id: data.id ?? uuidv4(),
    content: data.content ?? '',
    tags: data.tags ?? [],
    pinned: data.pinned ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await service.save(note, false, projectId);
  return note;
}

export async function getNote(id: string, projectId: string): Promise<Note | null> {
  return service.getById(id, projectId);
}

export async function listNotes(projectId: string): Promise<Note[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateNote(id: string, data: Partial<Omit<Note, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteNote(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
