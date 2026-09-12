// ============================================================
// 自动写作工具 —— 交付（人工卡点后的确定性写库）
// ============================================================

import type { ServerPluginContext, ToolDefinition } from '@novel/core';
import { schema, eq, and, isNull, type DrizzleDb } from '@novel/db';
import { FlowStore } from '../framework/flow-store.js';
import { canTransition } from '../framework/flow-state.js';
import { readChapterByOrder, resolveSettingsDigest } from '../framework/context-resolver.js';
import { persistChapterEntities } from '../framework/entity-sink.js';
import { countChars, nowId, insertSnapshot, userIdOf, ok, fail, type ToolCtx } from './helpers.js';
import { SUMMARY_SYSTEM } from './prompts.js';

export const confirmChapterDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'autowrite_confirm_chapter',
    description: '人工卡点交付：作者同意后调用，把草稿确定性写入章节（自动备份旧稿并打快照）。confirm 必须在作者明确同意后才是 true。',
    parameters: {
      type: 'object',
      properties: {
        batchId: { type: 'string' },
        order: { type: 'number' },
        confirm: { type: 'boolean', description: '作者已明确同意才可传 true' },
      },
      required: ['batchId', 'order', 'confirm'],
    },
  },
};

export function confirmChapterHandler(ctx: ServerPluginContext) {
  return async (args: Record<string, unknown>, toolCtx: unknown) => {
    const projectId = (toolCtx as ToolCtx).projectId;
    const userId = userIdOf(toolCtx);
    const store = new FlowStore(ctx.db.kv, projectId);
    const batchId = String(args.batchId ?? '');
    const order = Math.floor(Number(args.order));

    // 卡点第一道闸：confirm 必须来自作者明确同意（编排器只许转述，不许代答）
    if (args.confirm !== true) {
      return fail('作者未确认：不可交付。请先向作者呈报本章概要与审查结论，获得明确同意后以 confirm=true 调用。');
    }
    const batch = store.loadBatch(batchId);
    if (!batch) return fail('批次不存在：' + batchId);
    const flow = store.loadFlow(batchId, order);
    if (!flow?.draft) return fail(`第${order}章尚无草稿`);
    const verdict = canTransition(flow.step, 'confirm');
    if (!verdict.ok) return fail(verdict.reason ?? '状态机拒绝');
    if (batch.status !== 'running') return fail(`批次状态为 ${batch.status}，不能交付`);

    const existing = await readChapterByOrder(ctx, projectId, order);
    // 覆写保险：非空旧稿 → KV 备份 + snapshots 表快照（可回滚）
    if (existing && existing.content && existing.content.trim()) {
      await store.backupChapter(batchId, order, existing.content, existing.title);
      await insertSnapshot(ctx, projectId, existing.id, existing.content);
    }

    const db = ctx.db.project(projectId) as DrizzleDb;
    const wc = countChars(flow.draft);
    const now = new Date();
    let chapterId: string;
    let title: string;
    if (existing) {
      chapterId = existing.id;
      title = existing.title;
      await db.update(schema.chapters)
        .set({ content: flow.draft, wordCount: wc, updatedAt: now })
        .where(eq(schema.chapters.id, existing.id));
    } else {
      chapterId = nowId();
      title = batch.chapters.find((c) => c.order === order)?.title ?? `第${order}章`;
      await db.insert(schema.chapters).values({
        id: chapterId,
        projectId,
        title,
        content: flow.draft,
        order,
        wordCount: wc,
        status: '草稿',
        createdAt: now,
        updatedAt: now,
      });
    }

    // 同步项目总字数（与 chapter-service 同口径：非删除章节求和）
    const all = await db
      .select({ wordCount: schema.chapters.wordCount })
      .from(schema.chapters)
      .where(and(eq(schema.chapters.projectId, projectId), isNull(schema.chapters.deletedAt)));
    const total = all.reduce((s, r) => s + (r.wordCount ?? 0), 0);
    const gdb = ctx.db.global() as DrizzleDb;
    await gdb.update(schema.projects)
      .set({ currentWordCount: total, updatedAt: now })
      .where(eq(schema.projects.id, projectId));

    // 本章摘要（前情链燃料；失败不阻断交付）
    let summary = '';
    try {
      summary = (await ctx.ai.complete({
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: flow.draft },
        ],
        userId,
      })).trim();
    } catch {
      summary = flow.draft.slice(0, 100);
    }

    flow.step = 'delivered';
    flow.summary = summary.slice(0, 200);
    await store.saveFlow(flow);

    const idx = batch.chapters.findIndex((c) => c.order === order);
    if (idx >= 0) batch.cursor = Math.min(idx + 1, batch.chapters.length);
    const allDone = batch.chapters.every((c) => store.loadFlow(batchId, c.order)?.step === 'delivered');
    if (allDone) batch.status = 'done';
    await store.saveBatch(batch);
    await store.appendAudit(batchId, {
      ts: Date.now(), step: 'deliver', order,
      decision: `交付《${title}》${wc}字${existing?.content ? '（旧稿已备份+快照）' : '（新建章节）'}`,
    });

    // —— 实体沉淀：与讨论路径共用同一落库器 ——
    // 工具流水线没有「本章结论」（只有细纲），故只喂正文；失败非致命，不阻断交付。
    let sinkLine = '';
    try {
      const digest = await resolveSettingsDigest(ctx, projectId);
      const sink = await persistChapterEntities(ctx, {
        projectId,
        order,
        draft: flow.draft,
        existingForeshadows: digest.foreshadows,
        userId,
      });
      sinkLine = `\n实体沉淀：新建 ${sink.created} · 更新 ${sink.updated}${sink.skipped ? ` · 跳过 ${sink.skipped}` : ''}`
        + (sink.notes.length > 0 ? `\n（${sink.notes.join('；')}）` : '');
      await store.appendAudit(batchId, {
        ts: Date.now(), step: 'sink', order,
        decision: `实体沉淀 新建${sink.created}/更新${sink.updated}/跳过${sink.skipped}`,
      });
    } catch (e) {
      sinkLine = `\n实体沉淀失败（不影响本章交付）：${e instanceof Error ? e.message : String(e)}`;
    }

    const remaining = batch.status === 'done'
      ? '\n🎉 批次全部交付完成。'
      : `\n下一章：第${batch.chapters[batch.cursor]?.order ?? '—'}章（autowrite_write_draft）`;
    return ok(`第${order}章《${title}》已交付（${wc} 字${existing?.content ? '，旧稿已备份' : ''}）。\n本章摘要：${flow.summary}${sinkLine}\n${remaining}`);
  };
}
