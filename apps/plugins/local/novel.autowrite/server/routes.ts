// ============================================================
// 自动写作 —— 状态路由（独立面板的数据源）
//
//   GET  /batches            批次列表（项目隔离，含各章流转摘要）
//   GET  /batches/:id        批次详情（逐章流转状态 + 最近 50 条台账）
//   POST /batches/:id/resume 恢复被暂停/隔离的批次（人工显式操作）
//
// 鉴权由宿主统一处理（/api/plugins/* 默认要求登录）；项目隔离读 X-Project-Id 头。
// 与聊天编排器共享同一份 KV 状态：面板是只读视图 + 一个人工恢复按钮。
//
// ⚠️ 上面三条 /batches 路由属**已废弃的批次流水线**（说明见 autowrite/index.ts 顶部）：
//    现役的 AutoWriteWorkbench 不读它（计划卡读的是会话结论）。保留供日后把审计台账
//    迁到讨论链路时复用。**/session 才是现役入口**（SSE，单章闭环）。
// ============================================================

import { Hono, type Context } from 'hono';
import type { ServerPluginContext } from '@novel/core';
import { schema, eq, and, desc, type DrizzleDb } from '@novel/db';
import { FlowStore, type ChapterFlow } from './framework/flow-store.js';
import { runDiscussion, runChapters } from './discuss/orchestrator.js';
import { formatBrief } from './framework/context-resolver.js';
import { PipelineStore, computeBriefHash, canRun, nextStage } from './pipeline/store.js';
import { writeAudit } from './framework/memory/index.js';
import { runStage, approveStage } from './pipeline/orchestrator.js';
import { IMPLEMENTED_STAGES, REVISION_LIMIT, STAGES, STAGE_LABEL, type DecisionAction, type PipelineEvent, type StageKey } from './pipeline/types.js';

/** 单章对外视图（不暴露草稿全文，只暴露状态与结论） */
function flowView(f: ChapterFlow | undefined) {
  if (!f) return { step: 'planned' as const, revisions: 0, checkFails: 0, polishFails: 0, usedChars: 0 };
  return {
    step: f.step,
    revisions: f.revisions,
    checkFails: f.checkFails,
    polishFails: f.polishFails,
    usedChars: f.usedChars,
    checkPass: f.check?.pass,
    conflicts: f.check?.pass === false ? (f.check.conflicts ?? []).slice(0, 5) : undefined,
    polishScore: f.polish?.score,
    polishComments: f.polish && f.polish.score < 7 ? f.polish.comments : undefined,
    summary: f.summary,
  };
}

/** 审计里的 keys 是 JSON 文本列：解析失败就当空数组（显示层不该因为脏数据炸掉） */
function safeJson(raw: unknown): unknown[] {
  if (typeof raw !== 'string') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function createAutowriteRouter(ctx: ServerPluginContext): Hono {
  const router = new Hono();

  // ---- 批次列表 ----
  router.get('/batches', (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return c.json({ error: '缺少 X-Project-Id 头' }, 400);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batches = store.listBatches().map((b) => ({
      id: b.id,
      from: b.from,
      to: b.to,
      status: b.status,
      note: b.note,
      cursor: b.cursor,
      createdAt: b.createdAt,
      total: b.chapters.length,
      delivered: b.chapters.filter((ch) => store.loadFlow(b.id, ch.order)?.step === 'delivered').length,
      chapters: b.chapters.map((ch) => ({
        order: ch.order,
        title: ch.title,
        brief: ch.brief.slice(0, 120),
        ...flowView(store.loadFlow(b.id, ch.order)),
      })),
    }));
    return c.json({ batches });
  });

  // ---- 批次详情（含台账） ----
  router.get('/batches/:id', (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return c.json({ error: '缺少 X-Project-Id 头' }, 400);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batch = store.loadBatch(c.req.param('id'));
    if (!batch) return c.json({ error: '批次不存在' }, 404);
    const audit = store.getAudit(batch.id).slice(-50).reverse(); // 最新在前
    return c.json({ batch, audit });
  });

  // ---- 人工恢复（暂停/隔离 → 运行中） ----
  router.post('/batches/:id/resume', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return c.json({ error: '缺少 X-Project-Id 头' }, 400);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batch = store.loadBatch(c.req.param('id'));
    if (!batch) return c.json({ error: '批次不存在' }, 404);
    if (batch.status !== 'paused' && batch.status !== 'quarantined') {
      return c.json({ error: `批次状态为 ${batch.status}，无需恢复` }, 409);
    }
    batch.status = 'running';
    batch.note = undefined;
    await store.saveBatch(batch);
    await store.appendAudit(batch.id, { ts: Date.now(), step: 'resume', decision: '作者经面板恢复批次' });
    return c.json({ ok: true, batch });
  });

  // ---- 设计讨论会话（SSE）----
  // 多角色来回讨论 → 收敛成本章结论。前端把事件翻译成「智能体交流流」。
  // 鉴权与项目所有权由宿主统一处理（/api/plugins/* 已挂 requireAuth + 所有权校验）。
  router.post('/session', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return c.json({ error: '缺少 X-Project-Id 头' }, 400);

    let body: { message?: string; chapterOrder?: number; chapterCount?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      // 允许空体，下面统一校验 message
    }
    const message = String(body.message ?? '').trim();
    if (!message) return c.json({ error: '缺少 message' }, 400);
    /** 连写章数：1 = 单章（默认），>1 走连写循环；上限 50 防手滑跑出个几百章 */
    const chapterCount = Math.max(1, Math.min(50, Math.floor(Number(body.chapterCount ?? 1)) || 1));

    // 宿主已注入 user，取 id 供子代理上下文使用（讨论阶段不写库，缺省空串亦可）
    const user = (c as unknown as { get: (key: string) => { id?: string } | undefined }).get('user');

    const encoder = new TextEncoder();
    let closed = false;

    return new Response(
      new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch {
              closed = true;
            }
          };

          // SSE 心跳：一轮讨论要跑多次模型调用，期间可能长时间无数据，防中间层掐断
          const heartbeat = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            } catch {
              closed = true;
              clearInterval(heartbeat);
            }
          }, 15_000);

          try {
            const base = {
              projectId,
              userId: user?.id ?? '',
              message,
              chapterOrder: body.chapterOrder,
            };
            if (chapterCount > 1) {
              await runChapters(ctx, { ...base, chapterCount }, send);
            } else {
              await runDiscussion(ctx, base, send);
            }
          } catch (e) {
            send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
            send({ type: 'done' });
          } finally {
            clearInterval(heartbeat);
            closed = true;
            try {
              controller.close();
            } catch {
              // 已被下游关闭
            }
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  });

  // ============================================================
  // 多智能体协作流水线（设计见 docs/ai-writing-multiagent-pipeline.md）
  //
  //   GET  /pipeline            读状态（工作台挂载时拉一次）
  //   POST /pipeline/start      启动 / 续跑（写基线指纹）
  //   POST /pipeline/advance    SSE：跑一个阶段（讨论 → 收敛 → 停下等作者）
  //   POST /pipeline/decision   闸门决策：通过 / 带批注打回 / 退回上一段
  //   GET  /pipeline/ledger     决策台账（回放用）
  //
  // ★ 设计约束：**推进走 SSE、决策走独立 POST**。需要用户输入的东西绝不放长连接里等 ——
  //   否则刷新页面就说不清「我到底批没批」，连接一断状态就悬空。
  // ============================================================

  /**
   * 统一错误信封。
   * ★ 宿主约定是 `{ error: { code, message } }`，而前端 `apiClient` 只认这个形状
   *   （它读 `body.error.message`）—— 写成裸字符串 `{ error: '人话' }`，界面上只会看到
   *   「请求失败(400)」这种废话。流水线这几条路由给的都是要人读的提示，所以必须走信封。
   */
  const fail = (c: Context, status: 400 | 404 | 409 | 501, code: string, message: string) =>
    c.json({ error: { code, message } }, status);

  /** SSE 响应封装：心跳 + 事件发送 + 收尾（与 /session 同款语义） */  function sseStream(run: (emit: (e: PipelineEvent) => void) => Promise<void>): Response {
    const encoder = new TextEncoder();
    let closed = false;
    return new Response(
      new ReadableStream({
        async start(controller) {
          const send = (obj: PipelineEvent) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch {
              closed = true;
            }
          };
          // 一轮阶段讨论要跑多次模型调用，长时间无数据会被中间层掐断
          const heartbeat = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            } catch {
              closed = true;
              clearInterval(heartbeat);
            }
          }, 15_000);
          try {
            await run(send);
          } catch (e) {
            send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
          } finally {
            send({ type: 'done' });
            clearInterval(heartbeat);
            closed = true;
            try {
              controller.close();
            } catch {
              // 已被下游关闭
            }
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  }

  /** 读作者基线（brief + 流派 + 补的话）→ 指纹 + 注入用的格式化文本 */
  async function readBaseline(projectId: string, note: string) {
    const gdb = ctx.db.global() as DrizzleDb;
    const rows = await gdb
      .select({ brief: schema.projects.brief, genre: schema.projects.genre })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    const row = rows[0];
    if (!row) return null;
    return {
      briefText: formatBrief(row.brief),
      hash: computeBriefHash(row.brief, String(row.genre ?? ''), note),
    };
  }

  const storeFor = (projectId: string) => new PipelineStore(ctx.db.kv, projectId);
  /** 宿主已注入 user（/api/plugins/* 一律要求登录），取 id 供子代理上下文与台账留痕 */
  const userOf = (c: unknown) =>
    (c as { get: (k: string) => { id?: string } | undefined }).get('user')?.id ?? '';

  // ---- 读状态 ----
  // ---- 记忆审计 / 冲突（分层记忆架构的用户可见面）----
  // 设计见 docs/multi-agent-memory-architecture.md：`memory_audit` 记「谁在什么用途下读了/被拒了什么」，
  // `fact_conflicts` 记「同批次同槽位矛盾」。以前只能在库里看，这里给它一个面。
  router.get('/memory', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const db = ctx.db.project(projectId) as DrizzleDb | null;
    if (!db) return c.json({ data: { available: false, audit: [], conflicts: [], agents: [] } });

    const audit = await db.select().from(schema.memoryAudit)
      .where(eq(schema.memoryAudit.projectId, projectId))
      .orderBy(desc(schema.memoryAudit.at))
      .limit(80);
    const conflicts = await db.select().from(schema.factConflicts)
      .where(and(eq(schema.factConflicts.projectId, projectId), eq(schema.factConflicts.status, 'open')))
      .orderBy(desc(schema.factConflicts.createdAt))
      .limit(50);
    // 各角色的 L2 条数（看隔离有没有真在用）
    const rows = await db.select().from(schema.agentMemory)
      .where(eq(schema.agentMemory.projectId, projectId));
    const byAgent = new Map<string, { said: number; factRef: number; wheel: number[]; summaries: number[] }>();
    for (const r of rows) {
      const cur = byAgent.get(r.agentId) ?? { said: 0, factRef: 0, wheel: [], summaries: [] };
      if (r.key === 'wheel.slots') {
        // 它自己的水车斗位（斗 1 最新）—— 面板上直接能看到"这个角色现在记得哪几章"
        try {
          const slots = JSON.parse(r.value) as Array<{ chapterNo?: unknown }>;
          if (Array.isArray(slots)) cur.wheel = slots.map((s2) => Number(s2?.chapterNo)).filter((n) => Number.isFinite(n));
        } catch { /* 脏数据忽略 */ }
      } else if (r.key.startsWith('wheel.summary.')) {
        const n = Number(r.key.slice('wheel.summary.'.length));
        if (Number.isFinite(n)) cur.summaries.push(n);
      } else if (r.form === 'experience') {
        cur.said += 1;
      } else {
        cur.factRef += 1;
      }
      byAgent.set(r.agentId, cur);
    }
    return c.json({
      data: {
        available: true,
        audit: audit.map((a) => ({
          id: a.id, agentId: a.agentId, action: a.action, reason: a.reason,
          allow: !!a.allow, keys: safeJson(a.keys), detail: a.detail,
          // ★ drizzle 的 timestamp 列存的是**秒**，前端按毫秒渲染 —— 这里换算，
          //   否则面板上所有时间都会显示成 1970（实测踩过）
          at: Number(a.at) * 1000,
        })),
        conflicts: conflicts.map((f) => ({
          id: f.id, slot: f.slot, existing: f.existingValue, incoming: f.incomingValue, source: f.source,
        })),
        agents: [...byAgent.entries()].map(([agentId, v]) => ({ agentId, ...v })),
      },
    });
  });

  /**
   * 裁决一条冲突（人工判定后调用）。
   *
   * ★ 闭环要点（此前只打了个 status 标记，等于没裁）：
   *   · `decision`：'keep'（以库里既有值为准）/ 'accept'（以本批新值为准）/ 'drop'（两边都不算，删掉这条事实）
   *   · 记 `resolved_by` 与 `resolution`（决策 + 理由），**不删行** —— 审计要留痕
   *   · `accept` / `drop` 需要**重跑该章沉淀**才会真正改库（正文与实体由沉淀器统一写），
   *     这里只如实记录裁决，并在响应里说清这一点 —— 不假装已经改库。
   */
  router.post('/memory/conflicts/resolve', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const userId = (c as unknown as { get?: (k: string) => unknown }).get?.('userId');
    const body = await c.req.json().catch(() => ({})) as { id?: string; decision?: string; note?: string };
    if (!body.id) return fail(c, 400, 'BAD_REQUEST', '缺少 id');
    const decision = body.decision === 'accept' || body.decision === 'drop' ? body.decision : 'keep';
    const db = ctx.db.project(projectId) as DrizzleDb | null;
    if (!db) return fail(c, 400, 'BAD_REQUEST', '项目库未就绪');

    const rows = await db.select().from(schema.factConflicts).where(eq(schema.factConflicts.id, body.id)).limit(1);
    const row = rows[0];
    if (!row) return fail(c, 404, 'NOT_FOUND', '没有这条冲突');

    const resolution = JSON.stringify({
      decision,
      note: (body.note ?? '').slice(0, 200),
      chosenValue: decision === 'accept' ? row.incomingValue : decision === 'keep' ? row.existingValue : null,
      resolver: typeof userId === 'string' ? userId : 'unknown',
      needResink: decision !== 'keep',
      at: new Date().toISOString(),
    });
    await db.update(schema.factConflicts)
      .set({ status: 'resolved', resolvedAt: new Date(), resolution })
      .where(eq(schema.factConflicts.id, body.id));

    await writeAudit(ctx, {
      projectId, agentId: 'orchestrator', action: 'conflict', keys: [row.slot],
      reason: 'ingest', allow: decision !== 'drop',
      detail: `裁决 ${decision}：${row.slot}`,
    });
    return c.json({
      data: {
        ok: true, decision,
        needResink: decision !== 'keep',
        hint: decision === 'keep' ? '以库中既有值为准，无需重跑' : '已记录裁决；要让新值真正入库，需重跑该章沉淀',
      },
    });
  });

  router.get('/pipeline', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const store = storeFor(projectId);
    const state = store.load();
    const baseline = await readBaseline(projectId, state?.note ?? '');
    if (!state) {
      return c.json({
        data: {
          started: false,
          hasBrief: !!baseline?.briefText,
          view: null,
        },
      });
    }
    return c.json({
      data: {
        started: true,
        hasBrief: !!baseline?.briefText,
        view: store.view(state, baseline?.hash ?? state.briefHash),
      },
    });
  });

  // ---- 启动 / 续跑 ----
  router.post('/pipeline/start', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const body = await c.req.json().catch(() => ({})) as { note?: string };
    const store = storeFor(projectId);
    const existing = store.load();
    const note = typeof body.note === 'string' ? body.note.trim() : (existing?.note ?? '');
    const baseline = await readBaseline(projectId, note);
    if (!baseline) return fail(c, 404, 'NOT_FOUND', '项目不存在');
    if (!baseline.briefText) {
      return fail(c, 400, 'NO_BRIEF',
        '这本书还没有开书设定（书名 / 开局 / 世界观 / 笔风 / 主角 / 女主 / 流派）。'
        + '请先在「编辑书籍」里补全 —— 流水线的起点就是它，没有它立出来的设定会凭空长出来。');
    }
    const { state, baselineMismatch } = await store.ensure(baseline.hash, note);
    if (state.note !== note) {
      state.note = note;
      await store.save(state);
    }
    return c.json({
      data: { started: true, hasBrief: true, baselineMismatch, view: store.view(state, baseline.hash) },
    });
  });

  // ---- 跑一个阶段（SSE）----
  router.post('/pipeline/advance', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const body = await c.req.json().catch(() => ({})) as { stage?: StageKey; extra?: string };
    const store = storeFor(projectId);
    const state = store.load();
    if (!state) return fail(c, 400, 'NOT_STARTED', '流水线尚未启动，请先调用 /pipeline/start');

    const stage = (body.stage ?? state.stage) as StageKey;
    // 顺序有讲究：**先判"这段实现了没"**，再判游标。
    // 反过来的话，跳着跑一个还没实现的阶段会得到「不能跳着跑」这种误导性提示。
    if (!IMPLEMENTED_STAGES.includes(stage)) {
      return fail(c, 501, 'NOT_IMPLEMENTED', `「${STAGE_LABEL[stage]}」在 M2/M3 才实现（当前只到「剧情总纲」）`);
    }
    const guard = canRun(state, stage);
    // 校验一律在建立 SSE 之前完成：一旦开始流式，报错就没法用状态码表达了
    if (!guard.ok) return fail(c, 409, 'CONFLICT', guard.reason ?? '当前不能跑这个阶段');
    const baseline = await readBaseline(projectId, state.note ?? '');
    if (!baseline?.briefText) {
      return fail(c, 400, 'NO_BRIEF', '开书设定为空，无法立设定');
    }

    // 基线变了：从本段起作废已批准的产出，并采用新指纹
    let stale: StageKey[] = [];
    if (baseline.hash !== state.briefHash) {
      stale = store.invalidateFrom(state, stage);
      state.briefHash = baseline.hash;
      await store.save(state);
    }

    // 往**回**重跑更早的段：同样从该段起作废后续已批准的产出（「重跑哪段，就从哪段起作废」）
    if (STAGES.indexOf(stage) < STAGES.indexOf(state.stage)) {
      const invalidated = store.invalidateFrom(state, stage);
      state.stages[stage].status = 'idle';
      state.stage = stage;
      await store.save(state);
      await store.appendDecision({
        stage,
        at: Date.now(),
        by: userOf(c),
        action: 'revise',
        note: `作者主动重跑本段（作废了后续 ${invalidated.length} 个已批准阶段）`,
      });
      stale = [...new Set([...stale, ...invalidated])];
    }

    // brief 段不需要模型：开书信息本身就是基线，直接过。
    // ★ 它**没有闸门**（GATED_STAGES 里不含 brief）—— 作者刚刚亲自填过这些内容，
    //   再让他"确认一次自己刚填的东西"是多余的。所以这里只发 stage_skipped，不发 awaiting_user。
    if (stage === 'brief') {
      const nx = nextStage('brief');
      state.stages.brief.status = 'approved';
      state.stages.brief.finishedAt = Date.now();
      if (nx) state.stage = nx;
      await store.save(state);
      return sseStream(async (emit) => {
        if (stale.length) emit({ type: 'baseline_changed', from: state.briefHash, to: baseline.hash, stale });
        emit({ type: 'stage_skipped', stage: 'brief', reason: '开书信息无需模型分析，直接作为基线' });
      });
    }

    const lastRevise = [...store.getDecisions()].reverse()
      .find((d) => d.stage === stage && d.action === 'revise')?.note;

    return sseStream(async (emit) => {
      if (stale.length) {
        emit({ type: 'baseline_changed', from: state.briefHash, to: baseline.hash, stale });
      }
      await runStage(ctx, {
        stage,
        projectId,
        userId: userOf(c),
        extra: typeof body.extra === 'string' ? body.extra.trim() : undefined,
        revisionNote: lastRevise,
      }, emit);
    });
  });

  // ---- 闸门决策 ----
  router.post('/pipeline/decision', async (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const body = await c.req.json().catch(() => ({})) as { stage?: StageKey; action?: DecisionAction; note?: string };
    const stage = body.stage;
    const action = body.action;
    if (!stage || !action) return fail(c, 400, 'BAD_REQUEST', '缺少 stage 或 action');
    if (!['approve', 'revise', 'reject'].includes(action)) return fail(c, 400, 'BAD_REQUEST', `未知动作 ${action}`);

    const store = storeFor(projectId);
    const state = store.load();
    if (!state) return fail(c, 400, 'NOT_STARTED', '流水线尚未启动');
    const rec = state.stages[stage];
    if (!rec) return fail(c, 400, 'BAD_REQUEST', `未知阶段 ${stage}`);
    if (state.stage !== stage) {
      return fail(c, 409, 'WRONG_STAGE', `当前停在「${STAGE_LABEL[state.stage]}」，不能对「${STAGE_LABEL[stage]}」做决策`);
    }
    if (rec.status !== 'awaiting_user') {
      return fail(c, 409, 'NO_PENDING', `「${STAGE_LABEL[stage]}」当前状态是 ${rec.status}，没有待确认的产出`);
    }
    // 打回必须写批注：没批注的重跑等于原样再来一遍，纯烧额度
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (action === 'revise' && !note) {
      return fail(c, 400, 'NOTE_REQUIRED', '打回必须写批注（告诉智能体哪里不对），否则重跑只是原样再来一遍');
    }

    const { movedTo, hitLimit, invalidated } = store.applyDecision(state, stage, action);
    await store.save(state);
    await store.appendDecision({
      stage, at: Date.now(), by: userOf(c), action,
      ...(note ? { note } : {}),
    });

    // 批准之后才落库（被否掉的东西不进项目库）
    let stats = null;
    if (action === 'approve') {
      const baseline = await readBaseline(projectId, state.note ?? '');
      stats = await approveStage(
        ctx,
        { projectId, userId: userOf(c), stage, briefText: baseline?.briefText ?? '' },
        () => { /* 无 SSE 流：结果随 JSON 返回 */ },
      );
    }

    const baseline = await readBaseline(projectId, state.note ?? '');
    return c.json({
      data: {
        view: store.view(state, baseline?.hash ?? state.briefHash),
        movedTo: movedTo ?? null,
        invalidated,
        stats,
        revisionLimit: REVISION_LIMIT,
        // 撞上限不硬撑：把选择交回作者（按现状继续 / 放弃这段）
        hitRevisionLimit: !!hitLimit,
      },
    });
  });

  // ---- 决策台账 ----
  router.get('/pipeline/ledger', (c) => {
    const projectId = c.req.header('x-project-id');
    if (!projectId) return fail(c, 400, 'BAD_REQUEST', '缺少 X-Project-Id 头');
    const store = storeFor(projectId);
    return c.json({ data: { decisions: store.getDecisions() } });
  });

  return router;
}