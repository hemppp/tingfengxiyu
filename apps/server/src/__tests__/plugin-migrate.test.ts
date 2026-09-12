// ============================================================
// ctx.db.migrate 插件正式表迁移通道 —— 行为测试
//
// 覆盖：
// - 全局迁移：建表 + 记账 + 幂等（重复调用 skipped）
// - 权限门：无 db:global / db:project 权限时拒绝
// - 版本校验：非升序版本拒绝
// - 项目库迁移：已打开库立即应用；之后新建的项目库由
//   initProjectDb 钩子自动补跑（「未来项目」场景）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  initDatabase,
  closeDatabase,
  getMainSqlite,
  getProjectSqliteRaw,
  listOpenProjectDbs,
  initProjectDb,
  deleteProjectDb,
} from '@novel/db';
import type { ServerPluginContext } from '@novel/core';
import { createSqliteKvService } from '../plugin/kv-service.js';
import { createServerPluginHost, type ServerPluginHost } from '../plugin/host.js';

let tmpDir: string;
let host: ServerPluginHost;
/** 本测试创建的项目库 id（afterAll 清理；项目库路径不受 DB_PATH 控制，必须显式删除） */
const createdProjectIds: string[] = [];
const runId = randomBytes(6).toString('hex');

/** 造一个「捕获 ctx.db 后按测试指令行动」的本地插件 */
function makeMigratorPlugin(
  id: string,
  permissions: Array<'routes' | 'db:global' | 'db:project'>,
  onApply: (db: ServerPluginContext['db']) => void,
) {
  return {
    id,
    source: 'local' as const,
    manifest: {
      id,
      name: id,
      description: 'migration test plugin',
      version: '0.1.0',
      permissions,
      dependsOn: [],
      server: { inject: ['routes', 'db'] as Array<'routes' | 'db'> },
    },
    load: async () => ({
      name: id,
      inject: ['db'],
      apply(ctx: unknown) {
        onApply((ctx as ServerPluginContext).db);
      },
    }),
  };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'novel-plugin-migrate-'));
  process.env.DB_PATH = join(tmpDir, 'migrate.db');
  await initDatabase(process.env.DB_PATH);
  const kv = createSqliteKvService();
  host = createServerPluginHost({ kv });
  host.setInitialDisabled([]);
}, 120_000);

afterAll(async () => {
  try {
    await host?.dispose();
  } catch { /* 已释放 */ }
  try {
    await closeDatabase();
  } catch { /* 未初始化 */ }
  // 项目库路径不受 DB_PATH 控制（固定在 data/projects/），必须显式删除测试产物
  for (const pid of createdProjectIds) {
    try {
      await deleteProjectDb(pid);
    } catch { /* 可能已关闭 */ }
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ctx.db.migrate 全局迁移', () => {
  it('建表 + 记账，重复调用幂等', async () => {
    let db!: ServerPluginContext['db'];
    const entry = makeMigratorPlugin('novel.test-migrator-global', ['routes', 'db:global'], (d) => { db = d; });
    await host.mount([entry]);

    const migrations = [
      { version: 1, name: 'create demo table', sql: "CREATE TABLE IF NOT EXISTS plugin_demo_g (id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '')" },
      { version: 2, name: 'create demo index', sql: 'CREATE INDEX IF NOT EXISTS idx_plugin_demo_g_note ON plugin_demo_g(note)' },
    ];
    const first = await db.migrate(migrations);
    expect(first.applied.map((m) => m.version)).toEqual([1, 2]);
    expect(first.skipped).toBe(0);

    // 幂等：重放只报 skipped
    const second = await db.migrate(migrations);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toBe(2);

    // 表真实存在、记账行两条
    const sqlite = getMainSqlite() as { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] } };
    sqlite.prepare("INSERT INTO plugin_demo_g (id, note) VALUES ('t1', 'hello')").run();
    const rows = sqlite.prepare('SELECT id, note FROM plugin_demo_g').all() as Array<{ id: string; note: string }>;
    expect(rows).toContainEqual({ id: 't1', note: 'hello' });
    const ledger = sqlite.prepare(
      "SELECT version, name FROM plugin_migrations WHERE plugin_id = 'novel.test-migrator-global' AND scope = 'global' ORDER BY version",
    ).all() as Array<{ version: number; name: string }>;
    expect(ledger).toEqual([
      { version: 1, name: 'create demo table' },
      { version: 2, name: 'create demo index' },
    ]);
  });

  it('无 db:global 权限的插件被拒绝', async () => {
    let db!: ServerPluginContext['db'];
    const entry = makeMigratorPlugin('novel.test-migrator-noperm', ['routes'], (d) => { db = d; });
    await host.mount([entry]);
    await expect(db.migrate([{ version: 1, name: 'x', sql: "CREATE TABLE plugin_demo_no (id TEXT)" }]))
      .rejects.toThrow(/db:global/);
  });

  it('版本号非升序被拒绝', async () => {
    let db!: ServerPluginContext['db'];
    const entry = makeMigratorPlugin('novel.test-migrator-order', ['routes', 'db:global'], (d) => { db = d; });
    await host.mount([entry]);
    await expect(db.migrate([
      { version: 2, name: 'b', sql: "CREATE TABLE plugin_demo_ord_b (id TEXT)" },
      { version: 1, name: 'a', sql: "CREATE TABLE plugin_demo_ord_a (id TEXT)" },
    ])).rejects.toThrow(/升序/);
  });
});

describe('ctx.db.migrate 项目库迁移', () => {
  it('登记后：已打开库立即应用，未来新建库由钩子补跑', async () => {
    let db!: ServerPluginContext['db'];
    const entry = makeMigratorPlugin('novel.test-migrator-proj', ['routes', 'db:global', 'db:project'], (d) => { db = d; });
    await host.mount([entry]);

    // 项目库路径不受 DB_PATH 控制 → 用一次性 id 保证测试可重跑
    const pidExists = 'proj-mig-exists-' + runId;
    const pidFuture = 'proj-mig-future-' + runId;
    createdProjectIds.push(pidExists, pidFuture);

    // 场景 A：已打开的项目库 → 登记时立即应用
    await initProjectDb(pidExists);
    const migrations = [
      { version: 1, name: 'project demo table', sql: "CREATE TABLE IF NOT EXISTS plugin_demo_p (id TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')" },
    ];
    const r1 = await db.migrate(migrations, { scope: 'project' });
    expect(r1.applied.length).toBe(1);

    const pSqlite = getProjectSqliteRaw(pidExists) as { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } };
    const ledger = pSqlite.prepare(
      "SELECT version FROM plugin_migrations WHERE plugin_id = 'novel.test-migrator-proj' AND scope = 'project'",
    ).all();
    expect(ledger.length).toBe(1);

    // 场景 B：「未来」的项目库 → initProjectDb 钩子自动补跑
    const before = listOpenProjectDbs().find((p) => p.projectId === pidFuture);
    expect(before).toBeUndefined();
    await initProjectDb(pidFuture);
    const fSqlite = getProjectSqliteRaw(pidFuture) as { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } };
    const fLedger = fSqlite.prepare(
      "SELECT version FROM plugin_migrations WHERE plugin_id = 'novel.test-migrator-proj' AND scope = 'project'",
    ).all();
    expect(fLedger.length).toBe(1);
  });

  it('无 db:project 权限的插件被拒绝', async () => {
    let db!: ServerPluginContext['db'];
    const entry = makeMigratorPlugin('novel.test-migrator-noproj', ['routes', 'db:global'], (d) => { db = d; });
    await host.mount([entry]);
    await expect(db.migrate([{ version: 1, name: 'x', sql: "CREATE TABLE plugin_demo_np (id TEXT)" }], { scope: 'project' }))
      .rejects.toThrow(/db:project/);
  });
});
