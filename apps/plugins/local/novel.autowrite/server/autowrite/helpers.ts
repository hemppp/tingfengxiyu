// ============================================================
// 自动写作工具集 —— 共享助手（治理常量 / 解析 / 写库细节）
// ============================================================

import type { ServerPluginContext, ToolHandlerResult } from '@novel/core';
import { schema, eq, and, isNull, type DrizzleDb } from '@novel/db';
import { FlowStore, type BatchPlan } from '../framework/flow-store.js';

/** 治理配置（FlowSpec.governance 的 autowrite 实例） */
export const GOVERNANCE = {
  hardGates: ['check'],
  reviewer: { step: 'polish', threshold: 7 },
  retries: 2,
  budgetPerChapter: 30000,
  auditLog: true as const,
};

/**
 * 长文写作调用的输出 token 预算（两条流水线共用：discuss 的写作官 / autowrite 的 write_draft）。
 *
 * 不传时 SDK 根本不发送 max_tokens，由服务商默认值兜底；而 glm-5.3-flash 这类
 * **推理模型的思考 token 也计入该上限**（见 apps/server/src/ai/agents/chat-agent.ts 的同款注释），
 * 预算不足时模型会主动收短篇幅 —— 表现为「总是写不到约定字数」。故显式给足。
 */
export const WRITER_MAX_TOKENS = 16384;

export type ToolCtx = { projectId: string; user?: { id?: string } };

export const fail = (result: string): ToolHandlerResult => ({ success: false, result });
export const ok = (result: string): ToolHandlerResult => ({ success: true, result });

/** 从工具上下文取 userId（provider 配置按用户走） */
export function userIdOf(toolCtx: unknown): string | undefined {
  return (toolCtx as ToolCtx).user?.id;
}

/** 宽松 JSON 解析：截取首尾大括号之间内容，容忍模型输出围栏或前后缀 */
/**
 * 从自由文本里取出**第一个配平**的 JSON（对象或数组）。
 *
 * 为什么不能"第一个 { 到最后一个 }"：模型经常输出**两个 JSON**，
 * 或者 JSON 后面跟一句带 `}` 的话 —— 那样切片会跨过两个对象，JSON.parse 直接报
 * `Unexpected non-whitespace character after JSON`（实测在校对门上连撞 2/3 次）。
 * 这里按括号配平扫描，字符串内的括号与转义都跳过。
 */
export function extractFirstJson(raw: string): string | null {
  const open = raw.search(/[{[]/);
  if (open < 0) return null;
  const openCh = raw[open]!;
  const closeCh = openCh === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return raw.slice(open, i + 1);
    }
  }
  return null;   // 没配平（多半被 maxTokens 截断）
}

export function parseJsonLoose<T>(raw: string): T {
  const first = extractFirstJson(raw);
  if (first) {
    try { return JSON.parse(first) as T; } catch { /* 落下去试老办法与更明确的报错 */ }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('输出中未找到 JSON 对象：' + raw.slice(0, 120));
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/** 与 chapter-service 一致的字数口径：剥 HTML 标记后计字符 */
export function countChars(content: string): number {
  return content.replace(/<[^>]+>/g, '').trim().length;
}

export function nowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 批次给编排器的紧凑视图（不含草稿全文——全文只在 KV） */
export function batchSummary(b: BatchPlan, store: FlowStore): string {
  const lines = b.chapters.map((ch) => {
    const f = store.loadFlow(b.id, ch.order);
    const step = f?.step ?? 'planned';
    const mark = step === 'delivered' ? '✅' : step === 'planned' ? '○' : '⠙';
    const extra = f?.check?.pass === false
      ? `（校对打回×${f.checkFails}）`
      : f?.polish && f.polish.score < GOVERNANCE.reviewer.threshold
        ? `（评分${f.polish.score}打回）`
        : '';
    return `${mark} 第${ch.order}章《${ch.title}》[${step}]${extra}`;
  });
  return `批次 ${b.id}（第${b.from}-${b.to}章，状态：${b.status}${b.note ? `，原因：${b.note}` : ''}）\n${lines.join('\n')}`;
}

/** 读取前一章摘要：优先流转 KV（本次批次刚交付的），回退章节表自带摘要 */
export async function resolvePrevSummary(
  ctx: ServerPluginContext, store: FlowStore, projectId: string, batchId: string, order: number,
): Promise<string> {
  if (order <= 1) return '（本章是开篇，无前情）';
  const prevFlow = store.loadFlow(batchId, order - 1);
  if (prevFlow?.summary) return prevFlow.summary;
  const db = ctx.db.project(projectId) as DrizzleDb;
  const rows = await db
    .select({ summary: schema.chapters.summary })
    .from(schema.chapters)
    .where(and(eq(schema.chapters.projectId, projectId), eq(schema.chapters.order, order - 1), isNull(schema.chapters.deletedAt)))
    .limit(1);
  return rows[0]?.summary ?? '（前章无摘要，写作时注意衔接自然）';
}

/** 覆写前快照（snapshots 表，auto=true；与手动快照同表可回滚） */
export async function insertSnapshot(ctx: ServerPluginContext, projectId: string, chapterId: string, content: string): Promise<void> {
  const db = ctx.db.project(projectId) as DrizzleDb;
  const now = new Date();
  await db.insert(schema.snapshots).values({
    id: nowId(),
    chapterId,
    content,
    wordCount: countChars(content),
    label: '自动写作覆写备份',
    auto: true,
    createdAt: now,
    updatedAt: now,
  });
}
