// ============================================================
// NovelMuse - 数据库桥接层 (CRUD 操作)
// 前端 <--> 后端 HTTP API 的数据持久化桥梁
//
// 浏览器环境始终通过 HTTP API 调用后端服务器，实现跨浏览器数据共享
// ============================================================

import type {
  Project,
  Chapter,
  Character,
  Item,
  CreditTransaction,
  Location,
  StoryEvent,
  Foreshadow,
  Earmark,
  Annotation,
  OutlineNode,
  TimelineEvent,
  Note,
  WritingStats,
  Snapshot,
} from '@novel/shared';
import { nanoid } from 'nanoid';
import { apiClient } from '../api/apiClient';

// ============================================================
// HTTP API 调用底层
// ============================================================

// 实体名称到 API 路径的映射
const ENTITY_API_MAP: Record<string, string> = {
  'Projects': '/projects',
  'Chapters': '/chapters',
  'Characters': '/characters',
  'Items': '/items',
  'CreditTransactions': '/credits',
  'Locations': '/locations',
  'StoryEvents': '/events',
  'Foreshadows': '/foreshadows',
  'Earmarks': '/earmarks',
  'Annotations': '/annotations',
  'OutlineNodes': '/outline',
  'TimelineEvents': '/timeline',
  'Notes': '/notes',
  'WritingStats': '/stats',
  'Snapshots': '/snapshots',
};

/**
 * 通过 HTTP API 加载所有实体
 */
async function apiLoadAll<T extends { id: string }>(
  tableName: string,
  filterColumn?: string,
  filterValue?: string,
  orderBy?: string
): Promise<T[]> {
  let apiPath = ENTITY_API_MAP[tableName];
  let filterCol = filterColumn;
  let filterVal = filterValue;
  // 按 projectId 查询时，使用 /projects/:projectId/xxx 路径
  if (apiPath && filterCol === 'projectId' && filterVal) {
    const projectScoped = apiPath + '/projects/' + encodeURIComponent(filterVal);
    // 除 Projects/Snapshots/WritingStats 外，其余实体均使用 project-scoped 路径
    if (['/chapters', '/characters', '/items', '/credits', '/locations', '/events', '/foreshadows', '/annotations', '/notes', '/outline', '/timeline', '/earmarks'].includes(apiPath)) {
      apiPath = projectScoped;
      filterCol = undefined; // 清除 filter，避免再追加 ?projectId=xxx
      filterVal = undefined;
    }
  }
  if (!apiPath) {
    console.warn(`[databaseService] 未知的实体类 ${tableName}`);
    return [];
  }

  try {
    const params: Record<string, string> = {};
    if (filterCol && filterVal) {
      params[filterCol] = filterVal;
    }
    if (orderBy) {
      params.orderBy = orderBy;
    }

    const result = await apiClient.get<T[]>(apiPath, params);
    return result || [];
  } catch (e) {
    console.warn(`[databaseService] API 加载 ${tableName} 失败:`, e);
    return [];
  }
}

/**
 * 通过 HTTP API 保存实体
 */
async function apiSave<T extends { id: string }>(tableName: string, entity: T): Promise<T | null> {
  const apiPath = ENTITY_API_MAP[tableName];
  if (!apiPath) {
    console.warn(`[databaseService] 未知的实体类 ${tableName}`);
    return null;
  }

  try {
    // silent: true — syncService 后台同步语义，400/422（zod 校验失败）等错误
    // 不应通过 apiClient 自动弹 toast 打扰用户；错误仍记录到 console 供调试
    const result = await apiClient.post<T>(apiPath, entity, { silent: true });
    return result;
  } catch (e) {
    console.warn(`[databaseService] API 保存 ${tableName} 失败:`, e);
    return null;
  }
}

/**
 * 通过 HTTP API 更新实体
 */
async function apiUpdate<T extends { id: string }>(
  tableName: string,
  id: string,
  updates: Partial<T>
): Promise<void> {
  const apiPath = ENTITY_API_MAP[tableName];
  if (!apiPath) {
    console.warn(`[databaseService] 未知的实体类 ${tableName}`);
    return;
  }

  // 剥离 null 值：DB text 列读取时为 null，但 Zod `.optional()` 只接受 undefined 不接受 null。
  // 若不剥离，整个 PUT 会因 null 字段触发 400 验证错误（silent 模式下静默失败，导致字段不持久化）。
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== null) cleaned[k] = v;
  }

  try {
    // silent: true — 同 apiSave，后台同步的 PUT 失败不弹 toast
    await apiClient.put(`${apiPath}/${id}`, cleaned, { silent: true });
  } catch (e) {
    console.warn(`[databaseService] API 更新 ${tableName} 失败:`, e);
  }
}

/**
 * 通过 HTTP API 删除实体
 */
async function apiDelete(tableName: string, id: string): Promise<void> {
  const apiPath = ENTITY_API_MAP[tableName];
  if (!apiPath) {
    console.warn(`[databaseService] 未知的实体类 ${tableName}`);
    return;
  }

  try {
    // silent: true — 删除属于后台同步语义，404（实体不存在/已被删除）等失败
    // 不应通过 apiClient 自动弹 toast 打扰用户；错误仍记录到 console 供调试
    await apiClient.delete(`${apiPath}/${id}`, { silent: true });
  } catch (e) {
    console.warn(`[databaseService] API 删除 ${tableName} 失败:`, e);
  }
}

// ============================================================
// 泛型实体服务工厂
// 消除 12 个实体的 加载/保存/更新/删除 重复代码
// ============================================================

/**
 * 创建一个实体的 CRUD 服务
 *
 * @param config.entityLabel  - 实体在 ENTITY_API_MAP 中的标识名（如 'Projects', 'Chapters'）
 * @param config.loadByColumn - 批量加载时 where 的列名，默认 'projectId'；传 undefined 加载全表
 * @param config.orderBy      - 可选 SQL ORDER BY 片段（如 'updated_at DESC'），由调用方硬编码，绝不接用户输入
 */
function createEntityService<
  T extends { id: string; updatedAt: number; createdAt: number },
>(
  config: {
    loadByColumn?: string;
    orderBy?: string;
    entityLabel: string;
  },
): {
  loadAll: (filterValue?: string) => Promise<T[]>;
  save: (entity: T) => Promise<T | null>;
  update: (id: string, updates: Partial<T>) => Promise<void>;
  delete: (id: string) => Promise<void>;
} {
  const { loadByColumn, orderBy, entityLabel } = config;

  const loadAll = async (filterValue?: string): Promise<T[]> => {
    try {
      return await apiLoadAll<T>(entityLabel, loadByColumn, filterValue, orderBy);
    } catch (e) {
      const msg = `load ${entityLabel} 失败`;
      console.warn(`[databaseService] ${msg}:`, e);
      throw new Error(`[databaseService] ${msg}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const save = async (entity: T): Promise<T | null> => {
    try {
      return await apiSave<T>(entityLabel, entity);
    } catch (e) {
      const msg = `save ${entityLabel} 失败`;
      console.warn(`[databaseService] ${msg}:`, e);
      throw new Error(`[databaseService] ${msg}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const update = async (id: string, updates: Partial<T>): Promise<void> => {
    try {
      await apiUpdate<T>(entityLabel, id, updates);
    } catch (e) {
      const msg = `update ${entityLabel} 失败`;
      console.warn(`[databaseService] ${msg}:`, e);
      throw new Error(`[databaseService] ${msg}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await apiDelete(entityLabel, id);
    } catch (e) {
      const msg = `delete ${entityLabel} 失败`;
      console.warn(`[databaseService] ${msg}:`, e);
      throw new Error(`[databaseService] ${msg}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return { loadAll, save, update, delete: remove };
}

// ============================================================
// Projects
// ============================================================

const projectSvc = createEntityService<Project>({
  entityLabel: 'Projects',
  // loadProjects 默认按更新时间倒序返回：
  // 1) BookshelfPage 接收 projects[0] 就是最新更新的一本；
  // 2) ProjectLayout dbProjects[0] 恢复 currentProject 时也拿到“最近编辑的一本”。
  // 字段为 Drizzle 列名（snake_case），SQLite ORDER BY 子句的列名要与 schema 一致
  orderBy: 'updated_at DESC',
});

export const loadProjects = projectSvc.loadAll;
export const saveProject = projectSvc.save;
export const updateProject = projectSvc.update;
export const deleteProject = projectSvc.delete;

// ============================================================
// Chapters
// ============================================================

const chapterSvc = createEntityService<Chapter>({
  entityLabel: 'Chapters',
  loadByColumn: 'projectId',
});

export const loadChapters = chapterSvc.loadAll;
export const saveChapter = chapterSvc.save;
export const updateChapter = chapterSvc.update;
/** 软删除（移入回收站），由后端默认行为决定 */
export const deleteChapter = chapterSvc.delete;

// ---- 回收站（章节软删除 / 还原 / 硬删除 / 清空） ----

/** 列出某项目下已软删除的章节 */
export async function listTrashedChapters(projectId: string): Promise<Chapter[]> {
  try {
    const result = await apiClient.get<Chapter[]>(`/chapters/projects/${encodeURIComponent(projectId)}/trash`);
    return result ?? [];
  } catch (e) {
    console.warn('[databaseService] 加载回收站失败:', e);
    return [];
  }
}

/** 还原章节：从回收站恢复到正常列表 */
export async function restoreChapter(id: string): Promise<Chapter | null> {
  try {
    const result = await apiClient.post<Chapter>(`/chapters/${encodeURIComponent(id)}/restore`);
    return result ?? null;
  } catch (e) {
    console.warn('[databaseService] 还原章节失败:', e);
    return null;
  }
}

/** 彻底删除（不可恢复） */
export async function hardDeleteChapter(id: string): Promise<void> {
  try {
    // silent: 同收站操作，404（已被清空）不应弹 toast
    await apiClient.delete(`/chapters/${encodeURIComponent(id)}?hard=true`, { silent: true });
    // 同步清除本地缓存，避免 localStorage 残留已删除章节的数据
    const { clearCachedChapterContent } = await import('./chapterLocalCache');
    clearCachedChapterContent(id);
  } catch (e) {
    console.warn('[databaseService] 彻底删除失败:', e);
  }
}

/** 清空回收站 */
export async function emptyChapterTrash(projectId: string): Promise<number> {
  try {
    const result = await apiClient.delete<{ success: boolean; removed: number }>(
      `/chapters/projects/${encodeURIComponent(projectId)}/trash`
    );
    return result?.removed ?? 0;
  } catch (e) {
    console.warn('[databaseService] 清空回收站失败:', e);
    return 0;
  }
}

// ============================================================
// Characters
// ============================================================

const charSvc = createEntityService<Character>({
  entityLabel: 'Characters',
  loadByColumn: 'projectId',
});

export const loadCharacters = charSvc.loadAll;
export const saveCharacter = charSvc.save;
export const updateCharacter = charSvc.update;
export const deleteCharacter = charSvc.delete;

export interface MergeSimilarResult {
  mergeCount: number;
  mergeLog: { from: string; into: string }[];
  mergedCharacters: Character[];
  mergedItems: Item[];
}

export async function mergeSimilarCharacters(projectId: string): Promise<MergeSimilarResult | null> {
  try {
    const result = await apiClient.post<MergeSimilarResult>(
      '/characters/merge-similar',
      {},
      { headers: { 'X-Project-Id': projectId } },
    );
    return result || null;
  } catch (e) {
    console.warn('[databaseService] 合并相似角色失败:', e);
    return null;
  }
}

export interface ManualMergeResult {
  primaryId: string;
  deletedId: string | null;
  character: Character;
  mergedItems: Item[];
}

export async function mergeTwoCharacters(
  projectId: string,
  primaryId: string,
  targetId: string,
  deleteMerged = true,
): Promise<ManualMergeResult | null> {
  try {
    const result = await apiClient.post<ManualMergeResult>(
      `/characters/${encodeURIComponent(primaryId)}/merge/${encodeURIComponent(targetId)}`,
      { deleteMerged },
      { headers: { 'X-Project-Id': projectId } },
    );
    return result || null;
  } catch (e) {
    console.warn('[databaseService] 手动合并角色失败:', e);
    return null;
  }
}

// ============================================================
// Items
// ============================================================

const itemSvc = createEntityService<Item>({
  entityLabel: 'Items',
  loadByColumn: 'projectId',
});

export const loadItems = itemSvc.loadAll;
export const saveItem = itemSvc.save;
export const updateItem = itemSvc.update;
export const deleteItem = itemSvc.delete;

// ============================================================
// CreditTransactions（系统积分流水）
// ============================================================

const creditSvc = createEntityService<CreditTransaction>({
  entityLabel: 'CreditTransactions',
  loadByColumn: 'projectId',
});

export const loadCreditTransactions = creditSvc.loadAll;
export const saveCreditTransaction = creditSvc.save;
export const updateCreditTransaction = creditSvc.update;
export const deleteCreditTransaction = creditSvc.delete;

// ============================================================
// Locations
// ============================================================

const locSvc = createEntityService<Location>({
  entityLabel: 'Locations',
  loadByColumn: 'projectId',
});

export const loadLocations = locSvc.loadAll;
export const saveLocation = locSvc.save;
export const updateLocation = locSvc.update;
export const deleteLocation = locSvc.delete;

export interface AssignCoordsResult {
  assignedCount: number;
  locations: Location[];
}

export async function assignLocationCoords(projectId: string): Promise<AssignCoordsResult | null> {
  try {
    const result = await apiClient.post<AssignCoordsResult>(
      '/locations/assign-coords',
      {},
      { headers: { 'X-Project-Id': projectId } },
    );
    return result || null;
  } catch (e) {
    console.warn('[databaseService] 分配地点坐标失败:', e);
    return null;
  }
}

// ============================================================
// Story Events
// ============================================================

const eventSvc = createEntityService<StoryEvent>({
  entityLabel: 'StoryEvents',
  loadByColumn: 'projectId',
});

export const loadStoryEvents = eventSvc.loadAll;
export const saveStoryEvent = eventSvc.save;
export const updateStoryEvent = eventSvc.update;
export const deleteStoryEvent = eventSvc.delete;

// ============================================================
// Foreshadows
// ============================================================

const foreSvc = createEntityService<Foreshadow>({
  entityLabel: 'Foreshadows',
  loadByColumn: 'projectId',
});

export const loadForeshadows = foreSvc.loadAll;
export const saveForeshadow = foreSvc.save;
export const updateForeshadow = foreSvc.update;
export const deleteForeshadow = foreSvc.delete;

// ============================================================
// Earmarks
// ============================================================

const earSvc = createEntityService<Earmark>({
  entityLabel: 'Earmarks',
  loadByColumn: 'projectId',
});

export const loadEarmarks = earSvc.loadAll;
export const saveEarmark = earSvc.save;
export const updateEarmark = earSvc.update;
export const deleteEarmark = earSvc.delete;

// ============================================================
// Annotations
// ============================================================

const annSvc = createEntityService<Annotation>({
  entityLabel: 'Annotations',
  loadByColumn: 'projectId',
});

export const loadAnnotations = annSvc.loadAll;
export const saveAnnotation = annSvc.save;
export const updateAnnotation = annSvc.update;
export const deleteAnnotation = annSvc.delete;

// ============================================================
// Outline Nodes
// ============================================================

const outlineSvc = createEntityService<OutlineNode>({
  entityLabel: 'OutlineNodes',
  loadByColumn: 'projectId',
});

export const loadOutlineNodes = outlineSvc.loadAll;
export const saveOutlineNode = outlineSvc.save;
export const updateOutlineNode = outlineSvc.update;
export const deleteOutlineNode = outlineSvc.delete;

// ============================================================
// Timeline Events
// ============================================================

const timelineSvc = createEntityService<TimelineEvent>({
  entityLabel: 'TimelineEvents',
  loadByColumn: 'projectId',
});

export const loadTimelineEvents = timelineSvc.loadAll;
export const saveTimelineEvent = timelineSvc.save;
export const updateTimelineEvent = timelineSvc.update;
export const deleteTimelineEvent = timelineSvc.delete;

export interface DedupeEventsResult {
  removedCount: number;
  removedIds: string[];
  events: TimelineEvent[];
}

export async function dedupeTimelineEvents(
  projectId: string,
  threshold = 0.7,
): Promise<DedupeEventsResult | null> {
  try {
    const result = await apiClient.post<DedupeEventsResult>(
      '/timeline/dedupe',
      { threshold },
      { headers: { 'X-Project-Id': projectId } },
    );
    return result || null;
  } catch (e) {
    console.warn('[databaseService] 事件去重失败:', e);
    return null;
  }
}

// ============================================================
// Notes
// ============================================================

const noteSvc = createEntityService<Note>({
  entityLabel: 'Notes',
  loadByColumn: 'projectId',
});

export const loadNotes = noteSvc.loadAll;
export const saveNote = noteSvc.save;
export const updateNote = noteSvc.update;
export const deleteNote = noteSvc.delete;

// ============================================================
// Writing Stats (特殊模式，不适用于工厂)
// ============================================================

async function loadApiStats(projectId: string): Promise<WritingStats[]> {
  try {
    const stats = await apiClient.get<WritingStats[]>(`/stats/projects/${encodeURIComponent(projectId)}`);
    return stats || [];
  } catch (e) {
    console.warn('[databaseService] API 加载 WritingStats 失败:', e);
    return [];
  }
}

async function saveApiStat(stat: WritingStats): Promise<void> {
  try {
    const statWithId = { ...stat, id: nanoid() };
    // silent: 后台统计记录，失败不弹 toast
    await apiClient.post('/stats', statWithId, { silent: true });
  } catch (e) {
    console.warn('[databaseService] API 保存 WritingStats 失败:', e);
  }
}

export async function loadStats(projectId: string): Promise<WritingStats[]> {
  try {
    return await loadApiStats(projectId);
  } catch (e) {
    console.warn('[databaseService] loadStats 失败:', e);
    throw new Error(`[databaseService] loadStats 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function saveDailyStat(stat: WritingStats): Promise<void> {
  try {
    await saveApiStat(stat);
  } catch (e) {
    console.warn('[databaseService] saveDailyStat 失败:', e);
    throw new Error(`[databaseService] saveDailyStat 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface StatsSummary {
  totalWords: number;
  totalDays: number;
  todayWords: number;
  last7Days: { date: string; words: number }[];
  last7DaysTotal: number;
  maxStreak: number;
  avgPerDay: number;
}

export async function loadStatsSummary(projectId: string): Promise<StatsSummary | null> {
  try {
    const result = await apiClient.get<StatsSummary>(
      `/stats/projects/${encodeURIComponent(projectId)}/summary`,
    );
    return result || null;
  } catch (e) {
    console.warn('[databaseService] 加载统计汇总失败:', e);
    return null;
  }
}

// ============================================================
// Snapshots (按 chapterId 加载)
// ============================================================

const snapSvc = createEntityService<Snapshot>({
  entityLabel: 'Snapshots',
  loadByColumn: 'chapterId',
});

export const loadSnapshots = snapSvc.loadAll;
export const saveSnapshot = snapSvc.save;
export const deleteSnapshot = snapSvc.delete;

// ============================================================
// 批量加载
// ============================================================

export interface AllProjectData {
  projects: Project[];
  chapters: Chapter[];
  characters: Character[];
  items: Item[];
  creditTransactions: CreditTransaction[];
  locations: Location[];
  storyEvents: StoryEvent[];
  foreshadows: Foreshadow[];
  earmarks: Earmark[];
  annotations: Annotation[];
  outlineNodes: OutlineNode[];
  timelineEvents: TimelineEvent[];
  notes: Note[];
  writingStats: WritingStats[];
}

/**
 * 带超时的 Promise 包装器，防止单个加载 hang 导致整个页面卡死
 */
function withTimeout<T>(ms: number, label: string, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[TIMEOUT] ${label} 超时 (${ms}ms)`)), ms)
    ),
  ]);
}

/**
 * 安全执行单个加载函数，保证永不 hang
 */
async function safeLoad<T>(label: string, fn: () => Promise<T>, fallback: T, timeoutMs = 5000): Promise<T> {
  const t0 = Date.now();
  try {
    console.debug(`[databaseService] 开始 ${label}`);
    const result = await withTimeout(timeoutMs, label, fn());
    console.debug(`[databaseService] ${label} 完成 (${Date.now() - t0}ms)`);
    return result;
  } catch (e) {
    console.error(`[databaseService] ${label} 失败 (${Date.now() - t0}ms):`, e);
    return fallback;
  }
}

/**
 * 一次性加载某个项目的所有关联数据
 * 每个加载独立超时+容错，单个失败不影响其他数据
 */
export async function loadAllProjectData(projectId: string): Promise<AllProjectData> {
  console.debug(`[databaseService] ════ 开始全量加载项目 ${projectId} ════`);
  const t0 = Date.now();

  const [
    projects,
    chapters,
    characters,
    items,
    creditTransactions,
    locations,
    storyEvents,
    foreshadows,
    earmarks,
    annotations,
    outlineNodes,
    timelineEvents,
    notes,
    writingStats,
  ] = await Promise.all([
    safeLoad('loadProjects', () => loadProjects(), []),
    safeLoad('loadChapters', () => loadChapters(projectId), []),
    safeLoad('loadCharacters', () => loadCharacters(projectId), []),
    safeLoad('loadItems', () => loadItems(projectId), []),
    safeLoad('loadCreditTransactions', () => loadCreditTransactions(projectId), []),
    safeLoad('loadLocations', () => loadLocations(projectId), []),
    safeLoad('loadStoryEvents', () => loadStoryEvents(projectId), []),
    safeLoad('loadForeshadows', () => loadForeshadows(projectId), []),
    safeLoad('loadEarmarks', () => loadEarmarks(projectId), []),
    safeLoad('loadAnnotations', () => loadAnnotations(projectId), []),
    safeLoad('loadOutlineNodes', () => loadOutlineNodes(projectId), []),
    safeLoad('loadTimelineEvents', () => loadTimelineEvents(projectId), []),
    safeLoad('loadNotes', () => loadNotes(projectId), []),
    safeLoad('loadStats', () => loadStats(projectId), []),
  ]);

  console.debug(`[databaseService] ════ 全量加载完成 (${Date.now() - t0}ms) projects=${projects.length} chapters=${chapters.length} ════`);

  return {
    projects,
    chapters,
    characters,
    items,
    creditTransactions,
    locations,
    storyEvents,
    foreshadows,
    earmarks,
    annotations,
    outlineNodes,
    timelineEvents,
    notes,
    writingStats,
  };
}

// ============================================================
// 级联删除项目（同时删除所有关联数据）
// ============================================================

/** 批量删除辅助：通过 HTTP API 加载并删除指定项目的所有关联数据 */
async function bulkDeleteByProject(tableName: string, projectId: string): Promise<void> {
  const apiPath = ENTITY_API_MAP[tableName];
  if (!apiPath) return;

  try {
    // 加载该项目的所有数据
    const items = await apiClient.get<Array<{ id: string }>>(apiPath, { projectId });
    // 逐个删除（silent：级联删除为后台批量操作，单项 404 不应打扰用户）
    for (const item of items) {
      await apiClient.delete(`${apiPath}/${item.id}`, { silent: true });
    }
  } catch (e) {
    console.warn(`[databaseService] API 级联删除 ${tableName} 失败:`, e);
  }
}

/**
 * 级联删除项目及其所有关联数据（章节/角色/物品/地点/事件/伏笔/书签/标注/大纲/时间线/笔记/统计）
 * 返回 true 表示所有操作成功
 */
export async function deleteProjectCascade(projectId: string): Promise<boolean> {
  console.debug(`[databaseService] 🗑 级联删除项目: ${projectId}`);
  const results: { key: string; ok: boolean }[] = [];

  const run = async (key: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ key, ok: true });
    } catch (e) {
      console.error(`[databaseService] 级联删除 ${key} 失败:`, e);
      results.push({ key, ok: false });
    }
  };

  await Promise.all([
    run('project', () => deleteProject(projectId)),
    run('chapters', () => { bulkDeleteByProject('Chapters', projectId); return Promise.resolve(); }),
    run('characters', () => { bulkDeleteByProject('Characters', projectId); return Promise.resolve(); }),
    run('items', () => { bulkDeleteByProject('Items', projectId); return Promise.resolve(); }),
    run('creditTransactions', () => { bulkDeleteByProject('CreditTransactions', projectId); return Promise.resolve(); }),
    run('locations', () => { bulkDeleteByProject('Locations', projectId); return Promise.resolve(); }),
    run('storyEvents', () => { bulkDeleteByProject('StoryEvents', projectId); return Promise.resolve(); }),
    run('foreshadows', () => { bulkDeleteByProject('Foreshadows', projectId); return Promise.resolve(); }),
    run('earmarks', () => { bulkDeleteByProject('Earmarks', projectId); return Promise.resolve(); }),
    run('annotations', () => { bulkDeleteByProject('Annotations', projectId); return Promise.resolve(); }),
    run('outlineNodes', () => { bulkDeleteByProject('OutlineNodes', projectId); return Promise.resolve(); }),
    run('timelineEvents', () => { bulkDeleteByProject('TimelineEvents', projectId); return Promise.resolve(); }),
    run('notes', () => { bulkDeleteByProject('Notes', projectId); return Promise.resolve(); }),
    run('stats', () => { bulkDeleteByProject('WritingStats', projectId); return Promise.resolve(); }),
  ]);

  // ★ 前端本地敏感数据同步清理：聊天历史 / 大纲记事本 / 参考书分析
  try {
    const { clearProjectLocalData } = await import('./localUserData.js');
    clearProjectLocalData(projectId);
  } catch { /* 清理失败不影响删除主流程 */ }

  const allOk = results.every(r => r.ok);
  const failed = results.filter(r => !r.ok).map(r => r.key);
  if (failed.length > 0) {
    console.warn(`[databaseService] ⚠️ 部分删除失败: ${failed.join(', ')}`);
  }
  console.debug(`[databaseService] ${allOk ? '✅' : '⚠️'} 级联删除完成 (${results.filter(r => r.ok).length}/${results.length})`);
  return allOk;
}
