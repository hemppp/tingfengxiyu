// ============================================================
// 扫描处理器共享逻辑
// 抽取 useAutoEntityDetection 和 useLatestChapterPolling 的公共处理逻辑
// ============================================================

import { nanoid } from 'nanoid';
import {
  useCharacterStore,
  useLocationStore,
  useItemStore,
  useTimelineStore,
} from '@/stores';
import type { Item, Location, TimelineEvent } from '@novel/shared';
import { mergeSimilarCharacters, updateItemHoldersForMerge } from '@/utils/characterMerge';
import type { StreamTimelineEvent, StreamEntity, StreamItemTransfer, StreamAliasMatch } from '@/services/ai/scanService';

// ---- 事件去重工具函数 ----

/** 归一化字符串：去标点、去空格、转小写 */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
}

/** 计算两个字符串的编辑距离相似度 (Levenshtein) */
export function levenshteinDistance(a: string, b: string): number {
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
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 计算字符串相似度 (0~1) */
export function stringSimilarity(s1: string, s2: string): number {
  const n1 = normalizeText(s1);
  const n2 = normalizeText(s2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1;
  const maxLen = Math.max(n1.length, n2.length);
  return 1 - levenshteinDistance(n1, n2) / maxLen;
}

/** 判断两个事件是否为同一事件 */
export function isDuplicateEvent(existingTitle: string, existingDesc: string, newTitle: string, newDesc: string): boolean {
  const titleSim = stringSimilarity(existingTitle, newTitle);
  if (titleSim > 0.55) return true;
  const descSim = stringSimilarity(existingDesc, newDesc);
  if (descSim > 0.65) return true;
  if (titleSim > 0.4 && descSim > 0.4) return true;
  return false;
}

/** 实体基础字段 */
export function entityBase(projectId: string) {
  const now = Date.now();
  return { id: nanoid(), projectId, createdAt: now, updatedAt: now };
}

/**
 * 构建角色名字 → ID 的映射表（含别名）
 */
export function buildCharNameToIdMap(characters: Array<{ name: string; id: string; aliases?: string[] }>): Map<string, string> {
  const charNameToId = new Map<string, string>();
  for (const c of characters) {
    if (c.name && !charNameToId.has(c.name)) charNameToId.set(c.name, c.id);
    for (const alias of c.aliases ?? []) {
      if (alias && !charNameToId.has(alias)) charNameToId.set(alias, c.id);
    }
  }
  return charNameToId;
}

/**
 * 查找角色ID：先精确匹配，再模糊匹配
 */
export function findCharIdByName(name: string, charNameToId: Map<string, string>, characters: Array<{ id: string; name: string; aliases?: string[] }>): string | null {
  if (!name) return null;
  // 精确匹配
  if (charNameToId.has(name)) return charNameToId.get(name)!;
  // 模糊匹配：名字互相包含
  const found = characters.find(c =>
    c.name.includes(name) || name.includes(c.name) ||
    c.aliases?.some(a => a.includes(name) || name.includes(a))
  );
  return found ? found.id : null;
}

/**
 * 处理时间线事件的公共逻辑
 * @returns { added: boolean; relations: number }
 */
export function processTimelineEventShared(
  event: StreamTimelineEvent,
  idx: number,
  projectId: string,
  chapterOrder: number,
  detectedIdsRef: Set<string>,
): { added: boolean; relations: number } {
  if (!event.title) return { added: false, relations: 0 };

  // 1. 内存去重：本次扫描内的重复
  const eventKey = `${chapterOrder}-${event.title}-${event.type}`;
  let _hash = 5381;
  for (let i = 0; i < eventKey.length; i++) {
    _hash = ((_hash << 5) + _hash + eventKey.charCodeAt(i)) | 0;
  }
  const hashKey = (_hash >>> 0).toString(36);

  if (detectedIdsRef.has(hashKey)) return { added: false, relations: 0 };
  detectedIdsRef.add(hashKey);

  // 2. 持久化去重：与store中已有事件对比（同章节+标题/描述相似）
  const existingEvents = useTimelineStore.getState().events;
  const chapterEvents = existingEvents.filter(e => e.chapter === chapterOrder && e.projectId === projectId);
  
  const isDuplicate = chapterEvents.some(existing => {
    if (!existing.title) return false;
    return isDuplicateEvent(
      existing.title,
      existing.description || '',
      event.title,
      event.description || ''
    );
  });
  
  if (isDuplicate) {
    console.debug('[ScanProcessor] 跳过重复事件:', event.title);
    return { added: false, relations: 0 };
  }

  // 构建 名字 → ID 索引（含别名）
  const existingCharacters = useCharacterStore.getState().characters;
  const charNameToId = buildCharNameToIdMap(existingCharacters);

  const matchedIds = (event.characterNames ?? [])
    .map(name => charNameToId.get(name))
    .filter((id): id is string => Boolean(id));

  // order 去冲突：用 chapterOrder * 100 + 事件序号
  const safeOrder = chapterOrder * 100 + idx;

  // 写入时间线 store
  const newTimelineEvent: TimelineEvent = {
    ...entityBase(projectId),
    title: event.title,
    description: event.description ?? '',
    chapter: chapterOrder,
    order: safeOrder,
    characterIds: matchedIds,
    type: event.type ?? 'event',
    timestamp: event.timestamp,
  };
  useTimelineStore.getState().addEvent(newTimelineEvent);

  // 同事件中出现 ≥2 个已知角色 → 两两建立 mutual 关联关系
  let newRelations = 0;
  if (matchedIds.length >= 2) {
    const addRelation = useCharacterStore.getState().addRelation;
    for (let i = 0; i < matchedIds.length - 1; i++) {
      for (let j = i + 1; j < matchedIds.length; j++) {
        const aId = matchedIds[i]!;
        const bId = matchedIds[j]!;
        if (aId === bId) continue;

        const aChar = useCharacterStore.getState().characters.find(c => c.id === aId);
        const aHas = (aChar?.relations ?? []).some(r => r.targetId === bId && r.type === '关联');
        if (!aHas) {
          addRelation(aId, { targetId: bId, type: '关联', direction: 'mutual', chapter: chapterOrder });
          newRelations++;
        }
        const bChar = useCharacterStore.getState().characters.find(c => c.id === bId);
        const bHas = (bChar?.relations ?? []).some(r => r.targetId === aId && r.type === '关联');
        if (!bHas) {
          addRelation(bId, { targetId: aId, type: '关联', direction: 'mutual', chapter: chapterOrder });
          newRelations++;
        }
      }
    }
  }

  return { added: true, relations: newRelations };
}

/**
 * 处理物品流转的公共逻辑
 */
export function handleItemTransferShared(
  transfer: StreamItemTransfer,
  chapterOrder: number,
  controller: AbortController,
): number {
  if (controller.signal.aborted) return 0;
  const itemState = useItemStore.getState();
  const charState = useCharacterStore.getState();

  // 按名称查找物品（支持部分匹配）
  const item = itemState.items.find(i => 
    i.name === transfer.itemName || 
    i.name.includes(transfer.itemName) || 
    transfer.itemName.includes(i.name)
  );
  if (!item) return 0;

  // 构建 名字→ID 映射（含别名）
  const charNameToId = buildCharNameToIdMap(charState.characters);

  // 查找角色的辅助函数
  const findCharId = (name: string): string | null => 
    findCharIdByName(name, charNameToId, charState.characters);

  const fromId = transfer.fromCharacter ? findCharId(transfer.fromCharacter) : null;
  const toId = transfer.toCharacter ? findCharId(transfer.toCharacter) : null;

  // 检查本章是否已经记录过相同流转（去重）
  const existingInChapter = item.holders.some(
    h => h.chapter === chapterOrder &&
         ((fromId && h.characterId === fromId && h.action === 'lost') ||
          (toId && h.characterId === toId && (h.action === 'gained' || h.action === 'transferred')))
  );
  if (existingInChapter && transfer.action !== 'held') return 0;

  const newHolders = [...item.holders];
  const currentHoldersSet = new Set(item.currentHolders ?? []);
  let currentChanged = false;
  let transferCount = 0;

  if (transfer.action === 'held') {
    // ★ 持有/使用/穿戴（无流转变化）：仅确保当前持有者包含该角色，不写流转史
    if (toId && !currentHoldersSet.has(toId)) {
      currentHoldersSet.add(toId);
      currentChanged = true;
    }
  } else if (transfer.action === 'gained' && toId) {
    newHolders.push({ characterId: toId, chapter: chapterOrder, action: 'gained' });
    currentHoldersSet.add(toId);
    transferCount++;
  } else if (transfer.action === 'lost' && (fromId || toId)) {
    const loserId = fromId || toId!;
    newHolders.push({ characterId: loserId, chapter: chapterOrder, action: 'lost' });
    currentHoldersSet.delete(loserId);
    transferCount++;
  } else if (transfer.action === 'transferred' && fromId && toId) {
    newHolders.push({ characterId: fromId, chapter: chapterOrder, action: 'lost' });
    newHolders.push({ characterId: toId, chapter: chapterOrder, action: 'gained' });
    currentHoldersSet.delete(fromId);
    currentHoldersSet.add(toId);
    transferCount++;
  }

  if (transferCount > 0 || currentChanged || newHolders.length !== item.holders.length) {
    itemState.updateItem(item.id, {
      holders: newHolders,
      currentHolders: Array.from(currentHoldersSet),
      updatedAt: Date.now(),
    });
  }

  return transferCount;
}

/**
 * 处理别名匹配的公共逻辑
 * @returns 新增的别名数量
 */
export function handleAliasMatchShared(
  aliasMatch: StreamAliasMatch,
  projectId: string,
  controller: AbortController,
  safeMode: boolean = false,
): number {
  if (controller.signal.aborted) return 0;
  const charState = useCharacterStore.getState();
  const allNames = [aliasMatch.primaryName, ...aliasMatch.aliases].filter(Boolean);
  if (allNames.length < 2) return 0;

  // 安全模式：过滤明显不是人名的词
  let validNames = allNames;
  if (safeMode) {
    const obviouslyNotNames = new Set([
      '主角', '反派', '配角', '路人甲', '路人乙', '路人', '群众',
      '女朋友', '男朋友', '朋友', '同事', '同学', '老师', '学生',
      '父亲', '母亲', '爸爸', '妈妈', '哥哥', '姐姐', '弟弟', '妹妹',
      '大嗓门', '小个子', '大个子', '胖子', '瘦子', '老头', '老太',
      '少年', '少女', '青年', '中年', '老人', '孩子', '小孩',
      '黑衣人', '白衣人', '红衣人', '为首之人', '那少年', '这女子',
    ]);
    validNames = allNames.filter(n => n.length >= 2 && !obviouslyNotNames.has(n));
    if (validNames.length < 2) return 0;
  }

  // 找出已存在的角色
  const matchedCharIds = new Set<string>();
  for (const name of validNames) {
    for (const c of charState.characters) {
      if (c.projectId !== projectId) continue;
      if (c.name === name) { matchedCharIds.add(c.id); continue; }
      if (c.aliases?.includes(name)) { matchedCharIds.add(c.id); continue; }
      if (!safeMode) {
        // 非安全模式允许子串匹配
        if (c.name.includes(name) || name.includes(c.name)) { matchedCharIds.add(c.id); continue; }
        if (c.aliases?.some(a => a.includes(name) || name.includes(a))) { matchedCharIds.add(c.id); continue; }
      }
    }
  }

  const matchedChars = charState.characters.filter(c => matchedCharIds.has(c.id));
  if (matchedChars.length === 0) return 0;

  const primaryChar = matchedChars.find(c => c.name === aliasMatch.primaryName)
    || matchedChars.find(c => aliasMatch.aliases.some(a => c.name === a || c.aliases?.includes(a)))
    || matchedChars[0];

  if (!primaryChar) return 0;

  const otherMatched = matchedChars.filter(c => c.id !== primaryChar.id);

  // 安全模式下的额外校验
  if (safeMode) {
    const canSafelyDelete = (targetName: string): boolean => {
      const primary = primaryChar.name;
      if (targetName === primary) return false;
      if (targetName.length < 2 || primary.length < 2) return false;
      if (targetName.length === 2 && targetName.charAt(0) === targetName.charAt(1) && primary.includes(targetName.charAt(0))) return true;
      if (primary.length >= 2 && targetName.length >= 2) {
        if (primary.startsWith(targetName) || targetName.startsWith(primary)) return true;
        if (primary.endsWith(targetName) || targetName.endsWith(primary)) return true;
      }
      const primaryChars = new Set([...primary]);
      const targetChars = [...targetName];
      const common = targetChars.filter(c => primaryChars.has(c)).length;
      const minLen = Math.min(primary.length, targetName.length);
      if (common / minLen >= 0.8) return true;
      return false;
    };

    const safeToDelete: typeof otherMatched = [];
    const notSafeToDelete: typeof otherMatched = [];
    for (const other of otherMatched) {
      if (canSafelyDelete(other.name)) {
        safeToDelete.push(other);
      } else {
        notSafeToDelete.push(other);
        console.debug(
          `[ScanProcessor] 别名合并安全校验拒绝: "${primaryChar.name}" ← "${other.name}"`,
        );
      }
    }

    // 合并可安全删除的
    const allAliases = new Set(primaryChar.aliases ?? []);
    const allChapters = new Set(primaryChar.chapters ?? []);
    let mergedBackstory = primaryChar.backstory || '';
    const mergedStates = [...(primaryChar.states ?? [])];
    const mergedRelations = [...(primaryChar.relations ?? [])];
    const mergedTags = new Set(primaryChar.tags ?? []);

    for (const name of validNames) {
      if (name !== primaryChar.name && !allAliases.has(name)) {
        allAliases.add(name);
      }
    }

    for (const other of safeToDelete) {
      for (const a of other.aliases ?? []) {
        if (a !== primaryChar.name) allAliases.add(a);
      }
      for (const ch of other.chapters ?? []) allChapters.add(ch);
      if (other.backstory && other.backstory.length > mergedBackstory.length) {
        mergedBackstory = other.backstory;
      }
      for (const st of other.states ?? []) {
        if (!mergedStates.some(s => s.field === st.field)) mergedStates.push(st);
      }
      for (const rel of other.relations ?? []) {
        if (!mergedRelations.some(r => r.targetId === rel.targetId && r.type === rel.type)) {
          mergedRelations.push(rel);
        }
      }
      for (const t of other.tags ?? []) mergedTags.add(t);
    }

    charState.updateCharacter(primaryChar.id, {
      aliases: Array.from(allAliases),
      chapters: Array.from(allChapters),
      backstory: mergedBackstory,
      states: mergedStates,
      relations: mergedRelations,
      tags: Array.from(mergedTags),
      updatedAt: Date.now(),
    });

    // 只删除可安全合并的角色
    for (const other of safeToDelete) {
      const itemState = useItemStore.getState();
      const projectItems = itemState.items.filter(i => i.projectId === projectId);
      const updatedItems = updateItemHoldersForMerge(projectItems, other.id, primaryChar.id);
      const otherItems = itemState.items.filter(i => i.projectId !== projectId);
      itemState.setItems([...otherItems, ...updatedItems]);
      charState.deleteCharacter(other.id);
    }

    return allAliases.size - (primaryChar.aliases?.length ?? 0);
  } else {
    // 非安全模式：简单合并
    const allAliases = new Set(primaryChar.aliases ?? []);
    const allChapters = new Set(primaryChar.chapters ?? []);
    let mergedBackstory = primaryChar.backstory || '';
    const mergedStates = [...(primaryChar.states ?? [])];
    const mergedRelations = [...(primaryChar.relations ?? [])];
    const mergedTags = new Set(primaryChar.tags ?? []);

    for (const name of allNames) {
      if (name !== primaryChar.name && !allAliases.has(name)) {
        allAliases.add(name);
      }
    }

    for (const other of otherMatched) {
      for (const a of other.aliases ?? []) {
        if (a !== primaryChar.name) allAliases.add(a);
      }
      for (const ch of other.chapters ?? []) allChapters.add(ch);
      if (other.backstory && other.backstory.length > mergedBackstory.length) {
        mergedBackstory = other.backstory;
      }
      for (const st of other.states ?? []) {
        if (!mergedStates.some(s => s.field === st.field)) mergedStates.push(st);
      }
      for (const rel of other.relations ?? []) {
        if (!mergedRelations.some(r => r.targetId === rel.targetId && r.type === rel.type)) {
          mergedRelations.push(rel);
        }
      }
      for (const t of other.tags ?? []) mergedTags.add(t);
    }

    charState.updateCharacter(primaryChar.id, {
      aliases: Array.from(allAliases),
      chapters: Array.from(allChapters),
      backstory: mergedBackstory,
      states: mergedStates,
      relations: mergedRelations,
      tags: Array.from(mergedTags),
      updatedAt: Date.now(),
    });

    for (const other of otherMatched) {
      const itemState = useItemStore.getState();
      const projectItems = itemState.items.filter(i => i.projectId === projectId);
      const updatedItems = updateItemHoldersForMerge(projectItems, other.id, primaryChar.id);
      const otherItems = itemState.items.filter(i => i.projectId !== projectId);
      itemState.setItems([...otherItems, ...updatedItems]);
      charState.deleteCharacter(other.id);
    }

    return allAliases.size - (primaryChar.aliases?.length ?? 0);
  }
}

/**
 * 物品类型归一化：把 AI 输出的类型码/中文类型词映射到标准类型码
 * （词表与 ItemManager 的标签/配色一致）。无法识别时回退 'other'。
 */
const ITEM_TYPE_ALIASES: Record<string, string> = {
  weapon: 'weapon', 武器: 'weapon', 兵器: 'weapon', 兵刃: 'weapon',
  armor: 'armor', 防具: 'armor', 铠甲: 'armor', 软甲: 'armor', 盔甲: 'armor', 护具: 'armor',
  clothing: 'clothing', 衣物: 'clothing', 衣服: 'clothing', 服饰: 'clothing', 服装: 'clothing',
  佩饰: 'clothing', 首饰: 'clothing', 戴饰: 'clothing', 衣袍: 'clothing', 袍服: 'clothing',
  treasure: 'treasure', 宝物: 'treasure', 财宝: 'treasure', 珍宝: 'treasure', 金银: 'treasure', 财物: 'treasure',
  token: 'token', 信物: 'token', 令牌: 'token', 令牌信物: 'token',
  artifact: 'artifact', 法器: 'artifact', 法宝: 'artifact', 神器: 'artifact', 灵宝: 'artifact',
  medicine: 'medicine', 药物: 'medicine', 药品: 'medicine', 解药: 'medicine', 毒药: 'medicine',
  potion: 'potion', 丹药: 'potion', 丹: 'potion',
  book: 'book', 书籍: 'book',
  document: 'document', 文书: 'document', 书信: 'document', 信件: 'document', 地图: 'document',
  scroll: 'scroll', 卷轴: 'scroll', 秘籍: 'scroll', 功法: 'scroll',
  key: 'key', 钥匙: 'key',
  vehicle: 'vehicle', 载具: 'vehicle', 交通工具: 'vehicle', 坐骑: 'vehicle', 马车: 'vehicle', 船只: 'vehicle', 飞剑: 'vehicle',
  gem: 'gem', 宝石: 'gem', 玉器: 'gem', 珠宝: 'gem', 夜明珠: 'gem',
  tool: 'tool', 工具: 'tool', 器具: 'tool',
  food: 'food', 食物: 'food',
  plant: 'plant', 植物: 'plant', 灵草: 'plant', 灵果: 'plant',
  animal: 'animal', 动物: 'animal', 灵兽: 'animal',
  prop: 'prop', 道具: 'prop', 杂物: 'prop',
  other: 'other', 其他: 'other',
};

/** 物品标准类型码集合（与 ItemManager 配色词表一致） */
const ITEM_TYPE_CODES = new Set([
  'weapon', 'token', 'artifact', 'document', 'key', 'medicine', 'clothing', 'vehicle',
  'treasure', 'book', 'food', 'plant', 'animal', 'tool', 'prop', 'potion', 'armor', 'scroll', 'gem', 'other',
]);

export function normalizeItemType(raw?: string): string {
  if (!raw) return 'other';
  const key = raw.trim().toLowerCase();
  if (ITEM_TYPE_CODES.has(key)) return key;
  return ITEM_TYPE_ALIASES[key] ?? 'other';
}

/**
 * 处理实体（角色/物品/地点）的公共逻辑
 * @returns { chars: number; items: number; locs: number; aliases: number }
 */
export function processEntityShared(
  entity: StreamEntity,
  projectId: string,
  chapterOrder: number,
  controller: AbortController,
  safeMode: boolean = false,
): { chars: number; items: number; locs: number; aliases: number } {
  if (controller.signal.aborted) return { chars: 0, items: 0, locs: 0, aliases: 0 };
  if (!entity.name) return { chars: 0, items: 0, locs: 0, aliases: 0 };

  let chars = 0;
  let items = 0;
  let locs = 0;
  let aliases = 0;

  if (entity.entityType === 'character') {
    const charState = useCharacterStore.getState();

    // 安全模式：本地兜底过滤
    if (safeMode) {
      const singleCharVerbs = new Set([
        '按', '打', '来', '去', '说', '道', '看', '听', '走', '跑',
        '坐', '站', '吃', '喝', '拿', '放', '给', '要', '想', '做',
        '大', '小', '多', '少', '好', '坏', '是', '非', '上', '下',
        '在', '向', '从', '到', '过', '着', '了', '的', '与', '和',
      ]);
      const obviouslyNotNames = new Set([
        '主角', '反派', '配角', '路人', '群众', '朋友', '同事', '同学',
        '老师', '学生', '父亲', '母亲', '哥哥', '姐姐', '弟弟', '妹妹',
        '少年', '少女', '青年', '中年', '老人', '孩子', '医生', '护士',
        '警察', '警官', '警员', '司机', '服务员', '按摩员', '厨师',
        '皇帝', '掌门', '队长', '将军', '大人', '公子', '小姐',
      ]);
      const isLikelyNotPersonName = (name: string): boolean => {
        if (!name || name.length === 0) return true;
        if (name.length === 1) {
          if (singleCharVerbs.has(name)) return true;
          return true;
        }
        if (obviouslyNotNames.has(name)) return true;
        if (name.length > 6) return true;
        const verbNounPattern = /^[按打来去说道看听走跑坐站吃喝拿放给要做]\S{1,4}(员|人|者|生|师|官|长|帝|门|公|子|姐|士|兵|工)$/;
        if (verbNounPattern.test(name)) return true;
        return false;
      };

      if (isLikelyNotPersonName(entity.name)) {
        console.debug(`[ScanProcessor] 本地兜底过滤拦截疑似非人名: "${entity.name}"`);
        return { chars: 0, items: 0, locs: 0, aliases: 0 };
      }
    }

    // 检查是否已存在
    const existing = safeMode
      ? charState.characters.find(c =>
          c.name === entity.name ||
          c.aliases?.includes(entity.name)
        )
      : charState.characters.find(c =>
          c.name === entity.name ||
          c.aliases?.includes(entity.name) ||
          entity.name.includes(c.name) ||
          c.name.includes(entity.name)
        );

    if (existing) {
      // 已存在同名角色，只补充章节引用
      const chapters = new Set(existing.chapters ?? []);
      if (!chapters.has(chapterOrder)) {
        chapters.add(chapterOrder);
        charState.updateCharacter(existing.id, {
          chapters: Array.from(chapters),
          updatedAt: Date.now(),
        });
        aliases++;
      }
      return { chars: 0, items: 0, locs: 0, aliases };
    }

    // 完全新角色，创建
    console.debug(`[ScanProcessor] 新角色: name="${entity.name}"`);
    useCharacterStore.getState().addCharacter({
      ...entityBase(projectId),
      name: entity.name,
      backstory: entity.context || entity.description || '',
      aliases: [],
      states: [],
      relations: [],
      chapters: [chapterOrder],
      tags: [],
      // 扩展字段（AI 提取的可选信息）
      ...(entity.appearance ? { appearance: entity.appearance } : {}),
      ...(entity.personality ? { personality: entity.personality } : {}),
      ...(entity.role ? { role: entity.role } : {}),
      ...(entity.speechStyle ? { speechStyle: entity.speechStyle } : {}),
    });
    chars++;
  } else if (entity.entityType === 'item') {
    const itemState = useItemStore.getState();
    const existing = itemState.items.find(i => i.name === entity.name);
    if (existing) {
      // ★ 已存在的物品：类型还是未分类（other）且 AI 给出了有效类型时，补上分类
      const normalized = normalizeItemType(entity.itemType);
      if (normalized !== 'other' && (!existing.type || existing.type === 'other')) {
        itemState.updateItem(existing.id, { type: normalized, updatedAt: Date.now() });
      }
      return { chars: 0, items: 0, locs: 0, aliases: 0 };
    }
    const now = Date.now();
    const newItem: Item = {
      ...entityBase(projectId),
      name: entity.name,
      // ★ 类型识别：AI 按标准词表输出的 itemType（宝物/衣物/防具等），归一化后入库
      type: normalizeItemType(entity.itemType),
      description: entity.context || entity.description || '',
      states: [],
      holders: [],
      currentHolders: [],
      relations: [],
      chapters: [chapterOrder],
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    useItemStore.getState().addItem(newItem);
    items++;
  } else if (entity.entityType === 'location') {
    const exists = useLocationStore.getState().locations.some(l => l.name === entity.name);
    if (exists) return { chars: 0, items: 0, locs: 0, aliases: 0 };
    const newLoc: Location = {
      ...entityBase(projectId),
      name: entity.name,
      description: entity.context || entity.description || '',
      states: [],
      chapters: [chapterOrder],
      tags: [],
    };
    useLocationStore.getState().addLocation(newLoc);
    locs++;
  }

  return { chars, items, locs, aliases };
}

/**
 * 扫描完成后合并相似角色
 */
export function mergeSimilarCharactersAfterScan(projectId: string): number {
  const charState = useCharacterStore.getState();
  const itemState = useItemStore.getState();
  const projectChars = charState.characters.filter(c => c.projectId === projectId);
  const projectItems = itemState.items.filter(i => i.projectId === projectId);
  const { mergedCharacters, mergedItems, mergeCount } = mergeSimilarCharacters(projectChars, projectItems);
  if (mergeCount > 0) {
    const otherChars = charState.characters.filter(c => c.projectId !== projectId);
    const otherItems = itemState.items.filter(i => i.projectId !== projectId);
    charState.setCharacters([...otherChars, ...mergedCharacters]);
    itemState.setItems([...otherItems, ...mergedItems]);
    console.debug(`[ScanProcessor] 自动合并了 ${mergeCount} 对相似角色`);
  }
  return mergeCount;
}
