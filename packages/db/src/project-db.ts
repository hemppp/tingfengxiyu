// ============================================================
// 项目库连接管理（每本书一个独立 SQLite 文件）
//
// 设计要点：
// - 每个项目对应一个独立的 .db 文件：data/projects/{projectId}.db
// - 使用 better-sqlite3（WAL 模式，增量写入）
// - LRU 缓存最近使用的项目库实例，避免频繁打开/关闭
// - 项目库的 schema 见 drizzle/project_tables.sql（16 张项目级表，无跨库外键）
// - 主库 novelmuse.db 保留全局表：users / user_settings / projects / series
// ============================================================

import * as schema from './schema.js';
import type { DrizzleDb } from './index.js';

// 用变量形式持有模块名，避免 TS 编译期静态解析缺失模块
const BETTER_SQLITE3: string = 'better-sqlite3';
const DRIZZLE_BETTER_SQLITE3: string = 'drizzle-orm/better-sqlite3';

/** 项目库实例缓存条目 */
interface ProjectDbEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sqlite: any;
  db: DrizzleDb;
  lastUsed: number;
}

/** LRU 缓存：projectId → 项目库实例 */
const _projectDbCache = new Map<string, ProjectDbEntry>();

/** 最大同时打开的项目库数量（超过则关闭最旧的） */
const MAX_OPEN_PROJECT_DBS = 5;

/** 项目库是否已初始化（保证 better-sqlite3 模块只加载一次） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _DatabaseCtor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _drizzleCtor: any = null;
let _moduleLoaded = false;

/** 解析项目根目录（向上查找 pnpm-workspace.yaml） */
async function resolveProjectRoot(): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  // 不使用 __dirname 作为变量名，避免与 Node.js 全局冲突
  let _moduleDir: string;
  try {
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    _moduleDir = path.dirname(__filename);
  } catch {
    _moduleDir = __dirname;
  }

  let dir = _moduleDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/** 异步加载 better-sqlite3 和 drizzle-orm/better-sqlite3 模块 */
async function loadModules(): Promise<void> {
  if (_moduleLoaded) return;
  const { default: Database } = (await import(BETTER_SQLITE3)) as any;
  const { drizzle } = (await import(DRIZZLE_BETTER_SQLITE3)) as any;
  _DatabaseCtor = Database;
  _drizzleCtor = drizzle;
  _moduleLoaded = true;
}

/** 获取项目库文件路径 */
export async function getProjectDbPath(projectId: string): Promise<string> {
  const path = await import('path');
  const root = await resolveProjectRoot();
  return path.join(root, 'data', 'projects', `${projectId}.db`);
}

/**
 * 运行项目库 migration（执行 drizzle/project_tables.sql）
 * 多次执行安全：所有 CREATE 都用 IF NOT EXISTS
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runProjectMigrations(sqlite: any): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  // 不使用 __dirname 作为变量名，避免与 Node.js 全局冲突
  let _moduleDir: string;
  try {
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    _moduleDir = path.dirname(__filename);
  } catch {
    _moduleDir = __dirname;
  }

  const migrationsDir = path.resolve(_moduleDir, '../drizzle');
  const sqlFile = path.join(migrationsDir, 'project_tables.sql');

  if (!fs.existsSync(sqlFile)) {
    console.warn('[ProjectDB] 项目库迁移文件不存在:', sqlFile);
    return;
  }

  const sql = fs.readFileSync(sqlFile, 'utf-8');
  const statements = sql.split('--> statement-breakpoint');

  sqlite.exec('BEGIN');
  try {
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    try { sqlite.exec('ROLLBACK'); } catch { /* ignore */ }
    console.error('[ProjectDB] 项目库迁移失败:', e);
    throw e;
  }

  // 兼容补列：project_tables.sql 的 CREATE TABLE IF NOT EXISTS 对旧库不生效，
  // 后加的列（如 items.credit_price）需在此检测补齐，否则 drizzle 整表查询会报 no such column
  try {
    const itemCols = sqlite.pragma('table_info(items)') as Array<{ name: string }>;
    if (!itemCols.some((c) => c.name === 'credit_price')) {
      console.log('[ProjectDB] items 表缺少 credit_price 列，正在添加...');
      sqlite.exec('ALTER TABLE items ADD COLUMN credit_price REAL');
    }
  } catch (e) {
    console.warn('[ProjectDB] 检查 items.credit_price 列失败:', e);
  }
}

/**
 * 初始化项目库：创建/打开 DB 文件、跑 migration、缓存实例
 * 如果缓存已存在，直接返回。
 */
export async function initProjectDb(projectId: string): Promise<DrizzleDb> {
  // 缓存命中
  const cached = _projectDbCache.get(projectId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.db;
  }

  await loadModules();

  const fs = await import('fs');
  const path = await import('path');

  const dbPath = await getProjectDbPath(projectId);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new _DatabaseCtor(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  await runProjectMigrations(sqlite);

  const db = _drizzleCtor(sqlite, { schema }) as DrizzleDb;

  const entry: ProjectDbEntry = { sqlite, db, lastUsed: Date.now() };
  _projectDbCache.set(projectId, entry);

  // LRU 淘汰：超过上限时关闭最旧的
  if (_projectDbCache.size > MAX_OPEN_PROJECT_DBS) {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, e] of _projectDbCache) {
      if (id === projectId) continue;
      if (e.lastUsed < oldestTime) {
        oldestTime = e.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) {
      await closeProjectDb(oldestId);
      console.log(`[ProjectDB] LRU 淘汰项目库: ${oldestId}`);
    }
  }

  console.log(`[ProjectDB] 已初始化项目库: ${projectId}`);
  return db;
}

/**
 * 获取项目库的 Drizzle 实例。
 * 如果未初始化，会自动调用 initProjectDb。
 */
export async function getProjectDb(projectId: string): Promise<DrizzleDb> {
  return initProjectDb(projectId);
}

/**
 * 同步获取项目库实例（已缓存时直接返回，未缓存返回 null）。
 * 适用于 service 层在已知 projectId 已 init 的场景下避免 async。
 */
export function getProjectDbSync(projectId: string): DrizzleDb | null {
  const entry = _projectDbCache.get(projectId);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.db;
  }
  return null;
}

/**
 * 持久化项目库（WAL checkpoint）
 */
export async function persistProjectDb(projectId: string, force = false): Promise<void> {
  const entry = _projectDbCache.get(projectId);
  if (!entry) return;
  if (force) {
    try {
      entry.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error(`[ProjectDB] checkpoint 失败 (${projectId}):`, e);
    }
  }
}

/**
 * 关闭指定项目库并从缓存移除。
 */
export async function closeProjectDb(projectId: string): Promise<void> {
  const entry = _projectDbCache.get(projectId);
  if (!entry) return;
  try {
    entry.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    entry.sqlite.close();
  } catch (e) {
    console.error(`[ProjectDB] 关闭失败 (${projectId}):`, e);
  }
  _projectDbCache.delete(projectId);
}

/**
 * 关闭所有已打开的项目库。用于优雅关闭。
 */
export async function closeAllProjectDbs(): Promise<void> {
  const ids = Array.from(_projectDbCache.keys());
  await Promise.all(ids.map((id) => closeProjectDb(id)));
  console.log(`[ProjectDB] 已关闭 ${ids.length} 个项目库`);
}

/**
 * 删除项目库文件（删除项目时调用）。
 * 先关闭连接，再删除 .db / .db-wal / .db-shm 文件。
 */
export async function deleteProjectDb(projectId: string): Promise<void> {
  await closeProjectDb(projectId);

  const fs = await import('fs');
  const path = await import('path');
  const dbPath = await getProjectDbPath(projectId);
  const dir = path.dirname(dbPath);

  const filesToDelete = [
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    `${dbPath}.bak`,
  ];

  for (const file of filesToDelete) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) {
      console.warn(`[ProjectDB] 删除文件失败 ${file}:`, e);
    }
  }

  // 如果项目目录为空，删除目录
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    /* ignore */
  }

  console.log(`[ProjectDB] 已删除项目库文件: ${projectId}`);
}

/** 当前缓存中已打开的项目库数量（调试用） */
export function getOpenProjectDbCount(): number {
  return _projectDbCache.size;
}
