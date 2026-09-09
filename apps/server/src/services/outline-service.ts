// ============================================================
// 大纲 Service
// ============================================================

import { schema } from '@novel/db';
import type { OutlineNode } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['linkedChapterIds', 'tags'];

function rowToOutlineNode(r: Record<string, unknown>): OutlineNode {
  const result = normalizeTimestamps<OutlineNode>(r);
  (result as unknown as Record<string, unknown>).linkedChapterIds = parseJson(r.linkedChapterIds, []) as string[];
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function outlineNodeToRow(n: OutlineNode): Record<string, unknown> {
  const row = { ...n } as unknown as Record<string, unknown>;
  row.linkedChapterIds = JSON.stringify(n.linkedChapterIds ?? []);
  row.tags = JSON.stringify(n.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<OutlineNode>(schema.outlineNodes, {
  rowToModel: rowToOutlineNode,
  modelToRow: outlineNodeToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'OutlineNodes',
  scope: 'project',
});

export async function createOutlineNode(data: Omit<OutlineNode, 'createdAt' | 'updatedAt'>, projectId: string): Promise<OutlineNode> {
  const now = Date.now();
  const node: OutlineNode = {
    ...data,
    id: data.id ?? uuidv4(),
    linkedChapterIds: data.linkedChapterIds ?? [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(node, false, projectId);
  return node;
}

export async function getOutlineNode(id: string, projectId: string): Promise<OutlineNode | null> {
  return service.getById(id, projectId);
}

export async function listOutlineNodes(projectId: string): Promise<OutlineNode[]> {
  const nodes = await service.loadAll(projectId, projectId);
  return nodes.sort((a, b) => a.order - b.order);
}

export async function updateOutlineNode(id: string, data: Partial<Omit<OutlineNode, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteOutlineNode(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}
