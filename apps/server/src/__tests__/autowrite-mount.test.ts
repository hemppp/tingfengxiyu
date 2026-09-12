// ============================================================
// novel.autowrite 挂载冒烟测试 —— 技能剥离的验收关卡
//
// 验收锚点（docs/autowrite-plugin-framework.md §7 / §11-A）：
//   1. 插件经本地扫描真实挂载（health 中 status=ok）
//   2. 核心技能注册表内容为空、9 个技能全部由插件注册（source=plugin）
//   3. 8 个剥离技能 id/名称原样保留（前端选择器无感）
//   4. 8 个自动写作流程工具进入工具注册表
//   5. GET /api/ai/skills 路由存在（未鉴权 401 而非 404）
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, closeDatabase } from '@novel/db';
import { createSqliteKvService } from '../plugin/kv-service.js';
import { createServerPluginHost, type ServerPluginHost } from '../plugin/host.js';
import { BUILTIN_PLUGINS } from '../plugin/builtin.js';
import { createPluginManagerEntry } from '../plugin/manager.js';
import { scanLocalPluginsDetailed } from '../plugin/local-scanner.js';
import { listSkillMetas } from '../ai/agents/skills.js';
import { getAllToolDefinitions } from '../ai/tools/registry.js';

let tmpDir: string;
let host: ServerPluginHost;
let base: string;

async function get(path: string): Promise<Response> {
  return fetch(base + path, { signal: AbortSignal.timeout(15_000) });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'novel-autowrite-smoke-'));
  process.env.DB_PATH = join(tmpDir, 'smoke.db');

  await initDatabase(process.env.DB_PATH);
  const kv = createSqliteKvService();
  host = createServerPluginHost({ kv });
  host.setInitialDisabled(kv.get<string[]>('novel.host', 'disabled-plugins') ?? []);

  const scan = scanLocalPluginsDetailed();
  host.recordInstallRejections(
    scan.rejected.map((r) => ({ id: r.id, message: `${r.code}: ${r.message}` })),
  );
  await host.mount([
    ...BUILTIN_PLUGINS,
    createPluginManagerEntry(() => host),
    ...scan.entries,
  ]);

  const started = await host.start({ port: 0, host: '127.0.0.1' });
  base = 'http://127.0.0.1:' + started.port;
}, 180_000);

afterAll(async () => {
  try {
    await host?.dispose();
  } catch { /* 已释放 */ }
  try {
    await closeDatabase();
  } catch { /* 未初始化 */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('novel.autowrite 挂载（真实宿主）', () => {
  it('健康检查：插件挂载成功、无安装门拒绝', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      plugins: Array<{ id: string; status: string; error?: string }>;
      installRejections?: Array<{ id: string; message: string }>;
    };
    const aw = body.plugins.find((p) => p.id === 'novel.autowrite');
    expect(aw, 'novel.autowrite 应出现在健康检查插件列表').toBeTruthy();
    expect(aw?.status).toBe('ok');
    for (const r of body.installRejections ?? []) {
      expect(r.id, '不应有插件被安装门拒绝').not.toBe('novel.autowrite');
    }
  });

  it('技能注册表：9 技能全部 source=plugin（核心内置表已清空）', () => {
    const metas = listSkillMetas();
    const ids = metas.map((m) => m.id);
    const expected = [
      'character-analyst', 'foreshadow-tracker', 'rhythm-doctor', 'worldbuilder',
      'dialogue-polisher', 'plot-architect', 'continue-writer', 'outline-architect',
      'auto-write',
    ];
    for (const id of expected) expect(ids, `技能 ${id} 应由插件注册`).toContain(id);
    // 真正的不变量：核心内置表必须为空（注册表里不允许任何 builtin 来源；
    // worldbuilding 插件的「势力顾问」也是 plugin 来源，总数会 > 9）
    expect(metas.every((m) => m.source === 'plugin')).toBe(true);
  });

  it('剥离技能的展示元数据原样保留（前端选择器无感）', () => {
    const metas = listSkillMetas();
    expect(metas.find((m) => m.id === 'character-analyst')?.name).toBe('角色分析师');
    expect(metas.find((m) => m.id === 'foreshadow-tracker')?.name).toBe('伏笔追踪者');
    expect(metas.find((m) => m.id === 'outline-architect')?.name).toBe('大纲架构师');
    expect(metas.find((m) => m.id === 'character-analyst')?.contextKeys).toContain('characters');
    const aw = metas.find((m) => m.id === 'auto-write');
    expect(aw?.name).toBe('自动写作');
    expect(aw?.description).toContain('自动写作');
  });

  it('流程工具：8 个 autowrite_* 工具进入工具注册表', () => {
    const names = getAllToolDefinitions().map((d) => d.function.name);
    for (const name of [
      'autowrite_plan_batch', 'autowrite_write_draft', 'autowrite_check_draft',
      'autowrite_polish_draft', 'autowrite_confirm_chapter', 'autowrite_resume_batch',
      'autowrite_status', 'autowrite_audit',
    ]) {
      expect(names, `工具 ${name} 应已注册`).toContain(name);
    }
  });

  it('GET /api/ai/skills 路由存在（未鉴权 401 而非 404）', async () => {
    const res = await get('/api/ai/skills');
    expect(res.status).toBe(401);
  });

  it('状态路由可达（面板数据源；未鉴权 401 而非 404）', async () => {
    const res = await get('/api/plugins/autowrite/batches');
    expect(res.status).toBe(401);
  });
});
