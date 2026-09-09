// ============================================================
// 角色 Service
// ============================================================

import { schema } from '@novel/db';
import type { Character, CharacterRelation } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps, parseJson } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const JSON_FIELDS = ['aliases', 'states', 'relations', 'chapters', 'tags'];

function rowToCharacter(r: Record<string, unknown>): Character {
  const result = normalizeTimestamps<Character>(r);
  (result as unknown as Record<string, unknown>).aliases = parseJson(r.aliases, []) as string[];
  (result as unknown as Record<string, unknown>).states = parseJson(r.states, []);
  (result as unknown as Record<string, unknown>).relations = parseJson(r.relations, []);
  (result as unknown as Record<string, unknown>).chapters = parseJson(r.chapters, []) as number[];
  (result as unknown as Record<string, unknown>).tags = parseJson(r.tags, []) as string[];
  return result;
}

function characterToRow(c: Character): Record<string, unknown> {
  const row = { ...c } as unknown as Record<string, unknown>;
  row.aliases = JSON.stringify(c.aliases ?? []);
  row.states = JSON.stringify(c.states ?? []);
  row.relations = JSON.stringify(c.relations ?? []);
  row.chapters = JSON.stringify(c.chapters ?? []);
  row.tags = JSON.stringify(c.tags ?? []);
  toDbTimestamps(row);
  return row;
}

const service = new BaseService<Character>(schema.characters, {
  rowToModel: rowToCharacter,
  modelToRow: characterToRow,
  jsonFields: JSON_FIELDS,
  loadByColumn: 'projectId',
  entityLabel: 'Characters',
  scope: 'project',
});

export async function createCharacter(data: Omit<Character, 'createdAt' | 'updatedAt'>, projectId: string): Promise<Character> {
  const now = Date.now();
  const character: Character = {
    ...data,
    id: data.id ?? uuidv4(),
    aliases: data.aliases ?? [],
    states: data.states ?? [],
    relations: data.relations ?? [],
    chapters: data.chapters ?? [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await service.save(character, false, projectId);
  return character;
}

export async function getCharacter(id: string, projectId: string): Promise<Character | null> {
  return service.getById(id, projectId);
}

export async function listCharacters(projectId: string): Promise<Character[]> {
  return service.loadAll(projectId, projectId);
}

export async function updateCharacter(id: string, data: Partial<Omit<Character, 'id' | 'createdAt'>>, projectId: string): Promise<void> {
  await service.update(id, { ...data, updatedAt: Date.now() }, projectId);
}

export async function deleteCharacter(id: string, projectId: string): Promise<void> {
  await service.delete(id, projectId);
}

export async function searchCharacters(projectId: string, query: string): Promise<Character[]> {
  const all = await service.loadAll(projectId, projectId);
  const q = query.toLowerCase();
  return all.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.aliases.some((a) => a.toLowerCase().includes(q)) ||
    c.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export async function getCharacterRelations(characterId: string, projectId: string): Promise<CharacterRelation[]> {
  const c = await getCharacter(characterId, projectId);
  return c?.relations ?? [];
}

export async function addRelation(characterId: string, relation: CharacterRelation, projectId: string): Promise<void> {
  const c = await getCharacter(characterId, projectId);
  if (!c) throw new Error('角色不存在');
  const relations = [...c.relations, relation];
  await service.update(characterId, { relations, updatedAt: Date.now() } as Partial<Character>, projectId);
}

export async function removeRelation(characterId: string, targetId: string, projectId: string): Promise<void> {
  const c = await getCharacter(characterId, projectId);
  if (!c) throw new Error('角色不存在');
  const relations = c.relations.filter((r) => r.targetId !== targetId);
  await service.update(characterId, { relations, updatedAt: Date.now() } as Partial<Character>, projectId);
}
