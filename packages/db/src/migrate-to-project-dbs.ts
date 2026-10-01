// ============================================================
// 主库 → 项目库 数据迁移脚本
//
// 启动时检测主库 novelmuse.db 中的项目级数据，按 projectId 拆到
// data/projects/{projectId}.db 独立库。主库只保留全局表（users/projects/
// series/user_settings）。
//
// 触发条件：
// - 主库存在项目级表（chapters 等）
// - 且任一项目级表有数据
// - 且对应项目库尚未创建（避免重复迁移）
//
// 完成后：
// - 项目库已包含该项目的所有业务数据
// - 主库的项目级表会被 DROP（schema.ts 仍保留定义，但主库 drizzle 实例
//   查询这些表会报 no such table，从而暴露 service 层未切换的 bug）
// - 主库记录迁移完成标记到 __novelmuse_migrations 表
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySqlite = any;

/** 带有 project_id 的项目级表 */
const PROJECT_TABLES_WITH_PID = [
  'chapters',
  'characters',
  'items',
  'locations',
  'story_events',
  'foreshadows',
  'earmarks',
  'annotations',
  'outline_nodes',
  'timeline_events',
  'notes',
  'reference_books',
  'writing_stats',
  'ai_conversations',
] as const;

/** 没有 project_id 的项目级表（通过 chapter_id 关联） */
const PROJECT_TABLES_BY_CHAPTER = [
  'snapshots',
  'text_markers',
] as const;

/** 所有项目级表 */
const ALL_PROJECT_TABLES = [...PROJECT_TABLES_WITH_PID, ...PROJECT_TABLES_BY_CHAPTER];

/**
 * 检查主库是否需要迁移（存在项目级表且有数据）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function needsMigration(mainSqlite: AnySqlite): boolean {
  // 检查迁移完成标记
  try {
    const r = mainSqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='__novelmuse_migrations'`,
    ).get();
    if (r) {
      const marker = mainSqlite.prepare(
        `SELECT filename FROM __novelmuse_migrations WHERE filename = '__project_dbs_split__'`,
      ).get();
      if (marker) return false;
    }
  } catch {
    /* migrations 表不存在，继续检查 */
  }

  // 检查任一项目级表是否有数据
  for (const table of ALL_PROJECT_TABLES) {
    try {
      const r = mainSqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      ).get(table);
      if (!r) continue;
      const count = mainSqlite.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number };
      if (count.c > 0) return true;
    } catch {
      /* 表不存在或查询失败，跳过 */
    }
  }
  return false;
}

/**
 * 获取主库中所有 project_id 列表（含孤儿 project_id，即 project 不存在但章节还在的）。
 */
function getProjectIds(mainSqlite: AnySqlite, onlyKnownProjects: Set<string>): string[] {
  const ids = new Set<string>();
  for (const table of PROJECT_TABLES_WITH_PID) {
    try {
      const r = mainSqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      ).get(table);
      if (!r) continue;
      const rows = mainSqlite.prepare(`SELECT DISTINCT project_id FROM "${table}"`).all() as Array<{ project_id: string }>;
      for (const row of rows) {
        if (row.project_id) ids.add(row.project_id);
      }
    } catch {
      /* ignore */
    }
  }
  // 只保留主库 projects 表中存在的 project（避免孤儿数据迁移到独立库后无人管理）
  return Array.from(ids).filter((id) => onlyKnownProjects.has(id));
}

/**
 * 复制单张表的数据（按 project_id 过滤）到项目库。
 */
function copyTableByProjectId(
  mainSqlite: AnySqlite,
  projectSqlite: AnySqlite,
  table: string,
  projectId: string,
): number {
  // 获取列名
  const cols = mainSqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (cols.length === 0) return 0;
  const colNames = cols.map((c) => c.name);
  const placeholders = colNames.map(() => '?').join(', ');
  const colList = colNames.map((c) => `"${c}"`).join(', ');

  const rows = mainSqlite.prepare(
    `SELECT ${colList} FROM "${table}" WHERE project_id = ?`,
  ).all(projectId) as Array<Record<string, unknown>>;

  if (rows.length === 0) return 0;

  const insertStmt = projectSqlite.prepare(
    `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${placeholders})`,
  );

  const tx = projectSqlite.transaction((data: Array<Record<string, unknown>>) => {
    for (const row of data) {
      insertStmt.run(...colNames.map((c) => row[c]));
    }
  });
  tx(rows);

  return rows.length;
}

/**
 * 复制单张表的数据（通过 chapter_id 关联到 project）到项目库。
 */
function copyTableByChapter(
  mainSqlite: AnySqlite,
  projectSqlite: AnySqlite,
  table: string,
  projectId: string,
): number {
  const cols = mainSqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (cols.length === 0) return 0;
  const colNames = cols.map((c) => c.name);
  const placeholders = colNames.map(() => '?').join(', ');
  const colListAliased = colNames.map((c) => `t."${c}"`).join(', ');
  const colList = colNames.map((c) => `"${c}"`).join(', ');

  const rows = mainSqlite.prepare(
    `SELECT ${colListAliased}
     FROM "${table}" t
     INNER JOIN chapters c ON t.chapter_id = c.id
     WHERE c.project_id = ?`,
  ).all(projectId) as Array<Record<string, unknown>>;

  if (rows.length === 0) return 0;

  const insertStmt = projectSqlite.prepare(
    `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${placeholders})`,
  );

  const tx = projectSqlite.transaction((data: Array<Record<string, unknown>>) => {
    for (const row of data) {
      insertStmt.run(...colNames.map((c) => row[c]));
    }
  });
  tx(rows);

  return rows.length;
}

/**
 * 执行迁移。返回迁移统计信息。
 *
 * @param mainSqlite 主库的 better-sqlite3 实例（通过 adapterManager 取得）
 * @param knownProjectIds 主库 projects 表中已知的项目 ID 集合
 */
export interface MigrationStats {
  projectsMigrated: number;
  totalRowsMigrated: number;
  tablesDropped: number;
  durationMs: number;
}

export async function migrateToProjectDbs(
  mainSqlite: AnySqlite,
  knownProjectIds: string[],
): Promise<MigrationStats> {
  const startTime = Date.now();
  const stats: MigrationStats = {
    projectsMigrated: 0,
    totalRowsMigrated: 0,
    tablesDropped: 0,
    durationMs: 0,
  };

  if (!needsMigration(mainSqlite)) {
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  const knownSet = new Set(knownProjectIds);
  const projectIds = getProjectIds(mainSqlite, knownSet);

  if (projectIds.length === 0) {
    // 没有项目级数据需要迁移，直接打标记
    mainSqlite.prepare(
      `INSERT OR IGNORE INTO __novelmuse_migrations (filename, applied_at) VALUES ('__project_dbs_split__', ?)`,
    ).run(Date.now());
    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  console.log(`[Migrate] 开始迁移：${projectIds.length} 个项目`);

  const { default: Database } = await import('better-sqlite3');
  const { initProjectDb, getProjectDbPath, closeProjectDb } = await import('./project-db.js');

  for (const projectId of projectIds) {
    // 确保 project_tables.sql 已应用
    await initProjectDb(projectId);

    // 单独打开一个连接做数据迁移（避免与 LRU 缓存的实例冲突）
    const dbPath = await getProjectDbPath(projectId);
    const projectSqlite = new Database(dbPath);
    projectSqlite.pragma('foreign_keys = OFF'); // 迁移时关闭外键检查，避免顺序问题
    projectSqlite.pragma('journal_mode = WAL');

    try {
      let projectRows = 0;
      for (const table of PROJECT_TABLES_WITH_PID) {
        projectRows += copyTableByProjectId(mainSqlite, projectSqlite, table, projectId);
      }
      for (const table of PROJECT_TABLES_BY_CHAPTER) {
        projectRows += copyTableByChapter(mainSqlite, projectSqlite, table, projectId);
      }

      projectSqlite.pragma('wal_checkpoint(TRUNCATE)');
      stats.projectsMigrated++;
      stats.totalRowsMigrated += projectRows;
      console.log(`[Migrate] 项目 ${projectId}: 迁移 ${projectRows} 行`);
    } finally {
      projectSqlite.close();
      // 同时关闭 LRU 缓存里的实例，让后续 service 层重新打开
      await closeProjectDb(projectId);
    }
  }

  // 迁移完成，DROP 主库的项目级表
  for (const table of ALL_PROJECT_TABLES) {
    try {
      const r = mainSqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      ).get(table);
      if (r) {
        mainSqlite.exec(`DROP TABLE IF EXISTS "${table}"`);
        stats.tablesDropped++;
      }
    } catch (e) {
      console.warn(`[Migrate] DROP 表失败 ${table}:`, e);
    }
  }

  // 记录迁移完成标记
  mainSqlite.prepare(
    `INSERT OR IGNORE INTO __novelmuse_migrations (filename, applied_at) VALUES ('__project_dbs_split__', ?)`,
  ).run(Date.now());

  // 强制主库 checkpoint
  try {
    mainSqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }

  stats.durationMs = Date.now() - startTime;
  console.log(`[Migrate] 迁移完成：${stats.projectsMigrated} 项目，${stats.totalRowsMigrated} 行，DROP ${stats.tablesDropped} 表，耗时 ${stats.durationMs}ms`);

  return stats;
}
