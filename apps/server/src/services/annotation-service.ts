// ============================================================
// 标注 Service
// ============================================================

import { schema } from '@novel/db';
import type { Annotation } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const service = new BaseService<Annotation>(schema.annotations, {
  rowToModel: (r) => normalizeTimestamps<Annotation>(r),
  modelToRow: (model) => {
    const row = { ...model } as unknown as Record<string, unknown>;
    toDbTimestamps(row);
    return row;
  },
  loadByColumn: 'projectId',
  entityLabel: 'Annotations',
  scope: 'project',
});

export async function createAnnotation(data: Omit<Annotation, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Annotation> {
  const now = Date.now();
  const annotation: Annotation = {
    ...data,
    id: data.id ?? uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await service.save(annotation, false, projectId);
  return annotation;
}

export async function getAnnotation(id: string, projectId: string): Promise<Annotation | null> {
  return service.getById(id, projectId);
}

export async function listAnnotations(projectId: string): Promise<Annotation[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateAnnotation(id: string, data: Partial<Omit<Annotation, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteAnnotation(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
