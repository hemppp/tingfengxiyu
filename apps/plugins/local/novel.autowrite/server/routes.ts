// ============================================================
// 自动写作 —— 状态路由（独立面板的数据源）
//
//   GET  /batches            批次列表（项目隔离，含各章流转摘要）
//   GET  /batches/:id        批次详情（逐章流转状态 + 最近 50 条台账）
//   POST /batches/:id/resume 恢复被暂停/隔离的批次（人工显式操作）
//
// 鉴权由宿主统一处理（/api/plugins/* 默认要求登录）；项目隔离读 X-Project-Id 头。
// 与聊天编排器共享同一份 KV 状态：面板是只读视图 + 一个人工恢复按钮。
// ============================================================

import { Hono } from 'hono';
import type { ServerPluginContext } from '@novel/core';
import { FlowStore, type ChapterFlow } from './framework/flow-store.js';
import { runDiscussion } from './discuss/orchestrator.js';

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

    let body: { message?: string; chapterOrder?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      // 允许空体，下面统一校验 message
    }
    const message = String(body.message ?? '').trim();
    if (!message) return c.json({ error: '缺少 message' }, 400);

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
            await runDiscussion(
              ctx,
              {
                projectId,
                userId: user?.id ?? '',
                message,
                chapterOrder: body.chapterOrder,
              },
              send,
            );
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

  return router;
}
