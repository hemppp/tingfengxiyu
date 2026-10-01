// ============================================================
// novel.autowrite 挂载冒烟测试 —— 技能剥离的验收关卡
//
// 验收锚点（docs/architecture/ai-writing-architecture.md）：
//   1. 插件骨架经本地扫描真实挂载（health 中 status=ok）
//   2. 核心技能注册表无任何 builtin 来源（内置表为空）
//   3. 8 个剥离技能已随 novel.autowrite 实现移出仓外（不再注册）
//   4. 旧批次流水线的 8 个 autowrite_* 流程工具**已删除**（回归守护）
//   5. GET /api/ai/skills 路由存在（未鉴权 401 而非 404；AI 层未剥离）
//
// ★ 2026-09-28：`auto-write` flow 型技能与 8 个流程工具、`/batches` 路由随旧批次
//   流水线一并删除。本测试相应改为断言它们**不存在**（防止被误加回来）。
// ★ t10（2026-10-01，AI 写作模块剥离）：novel.autowrite 的**实现**（8 个聊天技能 +
//   状态/流水线路由 + 多代理流水线）已移出仓外，仓内仅剩最小 no-op 骨架
//   （plugin.json + package.json + server/index.ts，见
//   .workbuddy/strip-auto-research/MANIFEST.json）。故：
//     · 骨架仍在场 ⇒ `:78-80` 的健康检查断言**仍然有效**（契约被宿主接受）；
//     · 8 技能不再注册 ⇒ 原 `:86-97` 的「8 技能 toContain」按 §14-β **拆成两条**：
//         ① 「无 builtin 来源」不变量**原样保留**（形式上零弱化）；
//         ② **新增**「8 技能已不在注册表」（语义反转的回归守护，抓剥离不彻底）；
//     · `/api/plugins/autowrite/*` 前缀未注册 ⇒ 404（原为 401）⇒ `:129-132` 如实改。
//   ⇒ 「实现已剥离」的**唯一判据**是 hasModule('auto')===false / 该前缀未注册，
//     **不能**用 health status 或插件计数证明（骨架在场 ⇒ 仍 status=ok）。
// ============================================================

/** 随 novel.autowrite 实现移出仓外的 8 个聊天技能（原注册于插件 server 面） */
const STRIPPED_SKILL_IDS = [
  'character-analyst', 'foreshadow-tracker', 'rhythm-doctor', 'worldbuilder',
  'dialogue-polisher', 'plot-architect', 'continue-writer', 'outline-architect',
];

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
  it('健康检查：骨架插件挂载成功、无安装门拒绝', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      plugins: Array<{ id: string; status: string; error?: string }>;
      installRejections?: Array<{ id: string; message: string }>;
    };
    // ★ t10：骨架在场 ⇒ 本条**仍然有效**：它证明「契约（plugin.json）被宿主接受、
    //   server/index.ts 过 G1 结构门」。注意它**不能**用来证明「实现已剥离」。
    const aw = body.plugins.find((p) => p.id === 'novel.autowrite');
    expect(aw, 'novel.autowrite 骨架应出现在健康检查插件列表').toBeTruthy();
    expect(aw?.status).toBe('ok');
    for (const r of body.installRejections ?? []) {
      expect(r.id, '不应有插件被安装门拒绝').not.toBe('novel.autowrite');
    }
  });

  // ============================================================
  // §14-β：原「8 技能全部 source=plugin」一条，按剥离态**拆成两条**。
  //   这样原断言的「无 builtin 来源」不变量**一字不改地保留**（形式上零弱化），
  //   同时新增一条更硬的「8 技能已不在场」回归守护。
  // ============================================================
  it('技能注册表：无任何 builtin 来源（核心内置表为空）', () => {
    const metas = listSkillMetas();
    // 真正的不变量（剥离前后都成立）：注册表里不允许任何 builtin 来源。
    // 现役注册者只剩仍在场的插件（如 worldbuilding 的「势力顾问」），均为 plugin 来源。
    expect(metas.every((m) => m.source === 'plugin')).toBe(true);
  });

  it('剥离实现后：8 个 autowrite 聊天技能已不在注册表（回归守护）', () => {
    const metas = listSkillMetas();
    const ids = metas.map((m) => m.id);
    // ★ 反转式守护（非恒真）：若剥离不彻底（skills/ 被误留、或骨架被改回注册技能），
    //   这些 id 会重新出现 ⇒ 本断言立刻红。
    for (const id of STRIPPED_SKILL_IDS) {
      expect(ids, `技能 ${id} 应随 novel.autowrite 实现移出，不应再注册`).not.toContain(id);
    }
    // 更强的守护：展示元数据也不得残留（id 不在但元数据残留 = 半剥离）。
    for (const id of STRIPPED_SKILL_IDS) {
      expect(metas.find((m) => m.id === id), `技能 ${id} 的展示元数据不应残留`).toBeUndefined();
    }
  });

  it('剥离实现后：8 技能的展示元数据不再暴露给前端（选择器如实反映缺席）', () => {
    const metas = listSkillMetas();
    // ★ t10 反转原「展示元数据原样保留（前端选择器无感）」——该断言的前提
    //   （技能仍在注册表）已随实现移出而**不成立**。如实改为「不再暴露」：
    //   DTO 层面 id 与 name 都不得再出现。
    expect(metas.find((m) => m.id === 'character-analyst')).toBeUndefined();
    expect(metas.find((m) => m.id === 'foreshadow-tracker')).toBeUndefined();
    expect(metas.find((m) => m.id === 'outline-architect')).toBeUndefined();
    // 反向守护：这 8 个 name 也不得作为「无主元数据」残留在任何条目上。
    const names = metas.map((m) => m.name);
    for (const n of ['角色分析师', '伏笔追踪者', '大纲架构师']) {
      expect(names, `技能展示名 ${n} 不应残留`).not.toContain(n);
    }
  });

  it('旧批次流水线的 8 个 autowrite_* 流程工具已删除（回归守护）', () => {
    const names = getAllToolDefinitions().map((d) => d.function.name);
    for (const name of [
      'autowrite_plan_batch', 'autowrite_write_draft', 'autowrite_check_draft',
      'autowrite_polish_draft', 'autowrite_confirm_chapter', 'autowrite_resume_batch',
      'autowrite_status', 'autowrite_audit',
    ]) {
      expect(names, `工具 ${name} 不应再注册（旧批次流水线已删）`).not.toContain(name);
    }
    // flow 型技能 auto-write 也一并删除
    expect(listSkillMetas().map((m) => m.id)).not.toContain('auto-write');
  });

  it('GET /api/ai/skills 路由存在（未鉴权 401 而非 404）', async () => {
    const res = await get('/api/ai/skills');
    expect(res.status).toBe(401);
  });

  // 注（t10 更新）：剥离后 novel.autowrite 骨架**不注册** `/api/plugins/autowrite`
  // 路由前缀 ⇒ 该前缀下所有子路径落到 Hono 通用 404（**不再是** 401，因为 host 的
  // `/api/plugins/*` 前缀鉴权中间件只对**已注册**前缀生效）。
  // 原断言 `expect(401).toBe(401)` 的两层语义已变：
  //   · 旧语义「前缀鉴权生效 ⇒ 路由已注册」——剥离后**不应成立**；
  //   · 新语义「实现确已移出（该前缀未注册）⇒ 404，且不是被模式门禁挡下」。
  // ⇒ 如实断言 404 + error.code ≠ PLUGIN_MODE_MISMATCH。
  //   这不弱化：**404 的精确断言**仍能抓获「实现被误装回并注册了路由」（那会变回 401/非404）。
  it('流水线路由已随实现移出（未注册 ⇒ 404，且非模式门禁）', async () => {
    const res = await get('/api/plugins/autowrite/pipeline/runs');
    expect(res.status).toBe(404);
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    expect(body?.error?.code, '应是「未注册」而非「模式门禁」')
      .not.toBe('PLUGIN_MODE_MISMATCH');
  });
});
