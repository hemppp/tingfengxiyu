// ============================================================
// 角色合并服务
// ============================================================

import type { Character, Item, ItemHolder, CharacterRelation, EntityState } from '@novel/shared';

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function commonCharRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set([...a]);
  const setB = new Set([...b]);
  let common = 0;
  for (const c of setA) {
    if (setB.has(c)) common++;
  }
  const minLen = Math.min(setA.size, setB.size);
  return minLen === 0 ? 0 : common / minLen;
}

function isReduplicatedNickname(full: string, nick: string): boolean {
  if (!full || !nick) return false;
  if (nick.length !== 2 || full.length < 2) return false;
  const c0 = nick.charAt(0);
  const c1 = nick.charAt(1);
  if (c0 !== c1) return false;
  return full.includes(c0);
}

export function isNameSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA === lowerB) return true;

  const minLen = Math.min(lowerA.length, lowerB.length);
  const maxLen = Math.max(lowerA.length, lowerB.length);

  if (minLen < 2) return false;

  if (minLen >= 2 && (lowerA.includes(lowerB) || lowerB.includes(lowerA))) {
    const short = lowerA.length <= lowerB.length ? lowerA : lowerB;
    const long = lowerA.length > lowerB.length ? lowerA : lowerB;
    if (long.startsWith(short) || long.endsWith(short)) return true;
  }

  if (isReduplicatedNickname(lowerA, lowerB)) return true;
  if (isReduplicatedNickname(lowerB, lowerA)) return true;

  if (minLen === maxLen && minLen <= 3) {
    const sim = nameSimilarity(lowerA, lowerB);
    if (minLen === 2) return false;
    if (minLen === 3 && sim >= 2 / 3) return true;
  }

  if (maxLen - minLen >= 1) {
    const ratio = commonCharRatio(lowerA, lowerB);
    if (ratio >= 0.8) return true;
  }

  if (nameSimilarity(lowerA, lowerB) >= 0.8) return true;

  return false;
}

export function shouldMergeCharacters(a: Character, b: Character): boolean {
  if (a.id === b.id) return false;
  if (a.name === b.name) return true;
  if (a.aliases?.includes(b.name)) return true;
  if (b.aliases?.includes(a.name)) return true;
  if (a.aliases?.some((al: string) => b.aliases?.includes(al))) return true;
  if (isNameSimilar(a.name, b.name)) return true;
  if (a.aliases?.some((al: string) => isNameSimilar(al, b.name))) return true;
  if (b.aliases?.some((al: string) => isNameSimilar(al, a.name))) return true;
  return false;
}

export function pickPrimaryCharacter(a: Character, b: Character): Character {
  if (a.name.length > b.name.length) return a;
  if (b.name.length > a.name.length) return b;
  if (a.createdAt && b.createdAt) {
    return a.createdAt < b.createdAt ? a : b;
  }
  return a;
}

export function mergeTwoCharacters(primary: Character, secondary: Character): Character {
  const aliasSet = new Set([...(primary.aliases ?? []), ...(secondary.aliases ?? [])]);
  if (secondary.name !== primary.name) {
    aliasSet.add(secondary.name);
  }
  aliasSet.delete(primary.name);

  const primaryChapters: number[] = Array.isArray(primary.chapters)
    ? primary.chapters.filter(c => typeof c === 'number')
    : [];
  const secondaryChapters: number[] = Array.isArray(secondary.chapters)
    ? secondary.chapters.filter(c => typeof c === 'number')
    : [];
  const chapterSet = new Set([...primaryChapters, ...secondaryChapters]);

  const tagSet = new Set([...(primary.tags ?? []), ...(secondary.tags ?? [])]);

  const existingStates = new Map<string, EntityState>();
  for (const s of primary.states ?? []) {
    existingStates.set(s.field, s);
  }
  for (const s of secondary.states ?? []) {
    if (!existingStates.has(s.field)) {
      existingStates.set(s.field, s);
    }
  }

  const existingRelations = new Map<string, CharacterRelation>();
  for (const r of primary.relations ?? []) {
    existingRelations.set(r.targetId, r);
  }
  for (const r of secondary.relations ?? []) {
    if (!existingRelations.has(r.targetId)) {
      existingRelations.set(r.targetId, r);
    } else {
      const existing = existingRelations.get(r.targetId)!;
      if (r.description && !existing.description?.includes(r.description)) {
        existing.description = existing.description
          ? `${existing.description}；${r.description}`
          : r.description;
      }
    }
  }
  existingRelations.delete(primary.id);
  existingRelations.delete(secondary.id);

  const backstoryParts: string[] = [];
  if (primary.backstory) backstoryParts.push(primary.backstory);
  if (secondary.backstory && secondary.backstory !== primary.backstory) {
    backstoryParts.push(secondary.backstory);
  }

  return {
    ...primary,
    aliases: Array.from(aliasSet),
    chapters: Array.from(chapterSet).sort((a, b) => (a as number) - (b as number)),
    tags: Array.from(tagSet),
    states: Array.from(existingStates.values()),
    relations: Array.from(existingRelations.values()),
    backstory: backstoryParts.join('\n\n'),
    updatedAt: Date.now(),
  };
}

export function updateItemHoldersForMerge(
  items: Item[],
  oldCharId: string,
  newCharId: string,
): Item[] {
  return items.map(item => {
    if (!item.holders?.length && !item.currentHolders?.length) return item;

    const newHolders: ItemHolder[] = (item.holders ?? []).map((h: ItemHolder) =>
      h.characterId === oldCharId ? { ...h, characterId: newCharId } : h
    );

    const seen = new Set<string>();
    const uniqueHolders = newHolders.filter(h => {
      const key = `${h.chapter}-${h.action}-${h.characterId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const currentSet = new Set(item.currentHolders ?? []);
    if (currentSet.has(oldCharId)) {
      currentSet.delete(oldCharId);
      currentSet.add(newCharId);
    }

    if (
      uniqueHolders.length === (item.holders?.length ?? 0) &&
      currentSet.size === (item.currentHolders?.length ?? 0) &&
      uniqueHolders.every((h, i) => h.characterId === item.holders?.[i]?.characterId)
    ) {
      return item;
    }

    return {
      ...item,
      holders: uniqueHolders,
      currentHolders: Array.from(currentSet),
      updatedAt: Date.now(),
    };
  });
}

export interface MergeResult {
  mergedCharacters: Character[];
  mergedItems: Item[];
  mergeCount: number;
  mergeLog: { from: string; into: string }[];
}

export function mergeSimilarCharacters(
  characters: Character[],
  items: Item[],
): MergeResult {
  if (characters.length < 2) {
    return { mergedCharacters: characters, mergedItems: items, mergeCount: 0, mergeLog: [] };
  }

  // ★ 使用并查集优化：先一次性计算所有合并对，再统一合并
  // 避免原 O(n³) 的"每合并一对就重新扫描"问题
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let curr = id;
    while (parent.get(curr) !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const c of characters) parent.set(c.id, c.id);

  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      if (shouldMergeCharacters(characters[i]!, characters[j]!)) {
        union(characters[i]!.id, characters[j]!.id);
      }
    }
  }

  const groups = new Map<string, Character[]>();
  for (const c of characters) {
    const root = find(c.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c);
  }

  let its = [...items];
  let mergeCount = 0;
  const mergeLog: { from: string; into: string }[] = [];
  const merged: Character[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    let primary = group[0]!;
    for (let i = 1; i < group.length; i++) {
      const candidate = group[i]!;
      const picked = pickPrimaryCharacter(primary, candidate);
      if (picked.id !== primary.id) primary = candidate;
    }

    let result = primary;
    for (const c of group) {
      if (c.id === primary.id) continue;
      result = mergeTwoCharacters(result, c);
      its = updateItemHoldersForMerge(its, c.id, primary.id);
      mergeLog.push({ from: c.name, into: primary.name });
      mergeCount++;
    }
    merged.push(result);
  }

  return { mergedCharacters: merged, mergedItems: its, mergeCount, mergeLog };
}
