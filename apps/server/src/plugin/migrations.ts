// ============================================================
// 插件正式表迁移通道 —— ctx.db.migrate 的执行内核
//
// 设计：
// - 记账表 plugin_migrations 建在目标库（主库或项目库）内，
//   主键 (plugin_id, scope, project_id, version)，天然幂等；
// - 每条迁移在单独事务中执行：SQL + 记账行要么同时生效要么都回滚；
// - scope 'project' 的迁移登记进 pending 表，由 @novel/db 的
//   onProjectDbInit 钩子对未来新建/新开的项目库自动补跑
//   （已打开的库在登记时立即执行）；
// - pluginId 由守护器包装层（guardian.wrapDb）按挂载条目归因传入，
//   插件无法伪造他人命名空间。
//
// 执行方式：不使用 better-sqlite3 的多语句 exec 接口，而是把迁移 SQL
// 拆分为单语句后逐条 prepare().run()——拆分器感知单/双引号、反引号、
// 行注释与块注释，避免字符串里的分号被误切。已知限制：CREATE TRIGGER
// 的 BEGIN...END 块内含分号会被误切，插件迁移请避免触发器（可放到
// 插件代码里用参数化语句实现同等逻辑）。
// ============================================================

import {
  getMainSqlite,
  listOpenProjectDbs,
  getProjectSqliteRaw,
  onProjectDbInit,
} from '@novel/db';
import type { PluginMigration, PluginMigrateResult } from '@novel/core';

type AnyStatement = {
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};
type AnySqlite = {
  prepare: (sql: string) => AnyStatement;
  transaction: (fn: () => void) => () => void;
};

const BOOKKEEPING_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS plugin_migrations (' +
  'plugin_id  TEXT    NOT NULL,' +
  'scope      TEXT    NOT NULL,' +
  'project_id TEXT    NOT NULL DEFAULT \'\',' +
  'version    INTEGER NOT NULL,' +
  'name       TEXT    NOT NULL,' +
  "applied_at TEXT    NOT NULL DEFAULT (datetime('now'))," +
  'PRIMARY KEY (plugin_id, scope, project_id, version)' +
  ')';

/**
 * 把多语句 SQL 拆成单语句数组（跳过空片段）。
 * 感知：单引号/双引号/反引号字符串（含 '' 转义）、-- 行注释、/* 块注释 *\/。
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // 行注释
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // 块注释
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // 字符串/标识符引号（'' 为转义）
    if (ch === "'" || ch === '"' || ch === '`') {
      cur += ch;
      i += 1;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function ensureBookkeepingTable(sqlite: AnySqlite): void {
  sqlite.prepare(BOOKKEEPING_TABLE_SQL).run();
}

function loadAppliedVersions(sqlite: AnySqlite, pluginId: string, scope: string, projectId: string): Set<number> {
  const rows = sqlite
    .prepare('SELECT version FROM plugin_migrations WHERE plugin_id = ? AND scope = ? AND project_id = ?')
    .all(pluginId, scope, projectId) as Array<{ version: number }>;
  return new Set(rows.map((r) => Number(r.version)));
}

/** 校验版本号：正整数、严格升序、无重复；SQL 非空 */
function validateMigrations(migrations: PluginMigration[]): void {
  if (!Array.isArray(migrations)) throw new Error('migrations 必须是数组');
  let prev = 0;
  for (const m of migrations) {
    if (!m || typeof m !== 'object') throw new Error('migration 条目必须是对象');
    if (!Number.isInteger(m.version) || m.version <= 0) {
      throw new Error(`migration version 必须是正整数（收到 ${String(m.version)}）`);
    }
    if (m.version <= prev) {
      throw new Error(`migration version 必须严格升序且唯一（${prev} → ${m.version}）`);
    }
    prev = m.version;
    if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('migration name 不能为空');
    if (typeof m.sql !== 'string' || !m.sql.trim()) throw new Error('migration sql 不能为空');
  }
}

/** 对单个 sqlite 连接应用一组迁移（幂等，事务化，逐语句 prepare） */
function applyToSqlite(args: {
  sqlite: AnySqlite;
  pluginId: string;
  scope: 'global' | 'project';
  projectId: string;
  migrations: PluginMigration[];
}): PluginMigrateResult {
  const { sqlite, pluginId, scope, projectId, migrations } = args;
  validateMigrations(migrations);
  if (migrations.length === 0) return { applied: [], skipped: 0 };

  ensureBookkeepingTable(sqlite);
  const appliedSet = loadAppliedVersions(sqlite, pluginId, scope, projectId);
  const insert = sqlite.prepare(
    'INSERT INTO plugin_migrations (plugin_id, scope, project_id, version, name) VALUES (?, ?, ?, ?, ?)',
  );

  const applied: Array<{ version: number; name: string }> = [];
  let skipped = 0;
  for (const m of migrations) {
    if (appliedSet.has(m.version)) {
      skipped += 1;
      continue;
    }
    const statements = splitSqlStatements(m.sql);
    if (statements.length === 0) {
      skipped += 1;
      continue;
    }
    const prepared = statements.map((s) => sqlite.prepare(s));
    const run = sqlite.transaction(() => {
      for (const stmt of prepared) stmt.run();
      insert.run(pluginId, scope, projectId, m.version, m.name);
    });
    run();
    applied.push({ version: m.version, name: m.name });
  }
  return { applied, skipped };
}

// ---- scope:'project' 的 pending 登记与自动补跑 ----
// 模块级单例：guardian 每次包装产生新闭包，登记表必须跨挂载存活。
// 插件禁用/重挂时以最后一次登记为准（Map 覆盖写）。
const pendingProjectMigrations = new Map<string, PluginMigration[]>();
let projectHookRegistered = false;

function replayForProject(projectId: string, sqlite: unknown): void {
  for (const [pluginId, migrations] of pendingProjectMigrations) {
    try {
      applyToSqlite({
        sqlite: sqlite as AnySqlite,
        pluginId,
        scope: 'project',
        projectId,
        migrations,
      });
    } catch (err) {
      // 单个插件迁移失败不阻断项目库初始化，也不影响其他插件
      console.error(`[plugin-migrate] 插件 ${pluginId} 的项目库迁移失败 (${projectId}):`, err);
    }
  }
}

function ensureProjectInitHook(): void {
  if (projectHookRegistered) return;
  projectHookRegistered = true;
  onProjectDbInit((projectId) => {
    const sqlite = getProjectSqliteRaw(projectId);
    if (sqlite && pendingProjectMigrations.size > 0) replayForProject(projectId, sqlite);
  });
}

export interface MigrateForPluginArgs {
  pluginId: string;
  permissions: string[];
  migrations: PluginMigration[];
  opts?: { scope?: 'global' | 'project' };
}

/** 守护器包装层入口：按插件权限执行全局/项目库迁移（async：校验失败一律以 rejection 表达） */
export async function migrateForPlugin(args: MigrateForPluginArgs): Promise<PluginMigrateResult> {
  const { pluginId, permissions, migrations, opts } = args;
  const scope = opts?.scope ?? 'global';

  if (scope === 'global') {
    if (!permissions.includes('db:global')) {
      throw new Error('ctx.db.migrate(scope=global) 需要插件 manifest 声明 db:global 权限');
    }
    const sqlite = getMainSqlite() as unknown as AnySqlite | null;
    if (!sqlite) throw new Error('主库未初始化，无法执行迁移');
    return applyToSqlite({ sqlite, pluginId, scope, projectId: '', migrations });
  }

  // scope === 'project'
  if (!permissions.includes('db:project')) {
    throw new Error('ctx.db.migrate(scope=project) 需要插件 manifest 声明 db:project 权限');
  }
  validateMigrations(migrations);
  ensureProjectInitHook();
  pendingProjectMigrations.set(pluginId, migrations);

  // 已打开的项目库立即补跑；未打开的由 initProjectDb 钩子兜底
  let applied: Array<{ version: number; name: string }> = [];
  let skipped = 0;
  for (const { projectId, sqlite } of listOpenProjectDbs()) {
    const r = applyToSqlite({ sqlite: sqlite as AnySqlite, pluginId, scope, projectId, migrations });
    applied = applied.concat(r.applied);
    skipped += r.skipped;
  }
  return { applied, skipped };
}
