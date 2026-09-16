// ============================================================
// 流转状态 KV 存储（plugin_kv，项目隔离）
//
// key 约定（docs/architecture/ai-writing-architecture.md）：
//   batch:<id>            批次计划与进度指针
//   flow:<batchId>:<order> 单章流转状态（步骤/草稿/审查结论/计数）
//   audit:<batchId>       审计台账（每步留痕，强制开启）
// ============================================================

import type { KvService } from '@novel/core';
import type { BatchStatus, FlowStep } from './flow-state.js';

/** KV 命名空间（typography 同款：用完整插件 id） */
const NS = 'novel.autowrite';

/** 批次中的一章 */
export interface BatchChapter {
  order: number;
  title: string;
  /** 本章细纲（规划官产出） */
  brief: string;
}

export interface BatchPlan {
  id: string;
  /** 章节范围 */
  from: number;
  to: number;
  chapters: BatchChapter[];
  status: BatchStatus;
  /** 当前处理到的 chapters 下标 */
  cursor: number;
  /** 隔离/暂停原因（展示用） */
  note?: string;
  createdAt: number;
}

export interface ChapterFlow {
  batchId: string;
  order: number;
  step: FlowStep;
  /** 写作官产出（全文，仅存 KV 不进聊天） */
  draft?: string;
  /** 校对官结论（机判） */
  check?: { pass: boolean; conflicts: string[]; instructions?: string };
  /** 评审官结论（软门） */
  polish?: { score: number; comments: string };
  /** 交付后的本章摘要（传给下一章保连贯） */
  summary?: string;
  /** 重写次数 / 门失败计数 */
  revisions: number;
  checkFails: number;
  polishFails: number;
  /** 本章累计产出字符数（预算用） */
  usedChars: number;
  updatedAt: number;
}

export interface AuditEntry {
  ts: number;
  /** 流程步：plan/write/check/polish/deliver */
  step: string;
  order?: number;
  model?: string;
  ms?: number;
  /** 决策理由（为何通过/打回/重试/跳过） */
  decision: string;
}

export class FlowStore {
  constructor(
    private readonly kv: KvService,
    private readonly projectId: string,
  ) {}

  // ---- 批次 ----

  loadBatch(batchId: string): BatchPlan | undefined {
    return this.kv.get<BatchPlan>(NS, `batch:${batchId}`, { projectId: this.projectId });
  }

  async saveBatch(batch: BatchPlan): Promise<void> {
    await this.kv.set(NS, `batch:${batch.id}`, batch, { projectId: this.projectId });
  }

  /** 当前项目的活跃批次（status 非 done 的最新一笔） */
  findActiveBatch(): BatchPlan | undefined {
    const batches = this.listBatches();
    return batches.find((b) => b.status !== 'done');
  }

  /** 全部批次（按创建时间倒序） */
  listBatches(): BatchPlan[] {
    const rows = this.kv.list(NS, 'batch:', { projectId: this.projectId });
    return rows
      .map((r) => r.value as BatchPlan)
      .filter((b) => b && b.id && Array.isArray(b.chapters))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---- 单章流转 ----

  loadFlow(batchId: string, order: number): ChapterFlow | undefined {
    return this.kv.get<ChapterFlow>(NS, `flow:${batchId}:${order}`, { projectId: this.projectId });
  }

  async saveFlow(flow: ChapterFlow): Promise<void> {
    flow.updatedAt = Date.now();
    await this.kv.set(NS, `flow:${flow.batchId}:${flow.order}`, flow, { projectId: this.projectId });
  }

  static newFlow(batchId: string, order: number): ChapterFlow {
    return {
      batchId,
      order,
      step: 'planned',
      revisions: 0,
      checkFails: 0,
      polishFails: 0,
      usedChars: 0,
      updatedAt: Date.now(),
    };
  }

  // ---- 审计台账（强制留痕） ----

  async appendAudit(batchId: string, entry: AuditEntry): Promise<void> {
    const key = `audit:${batchId}`;
    const log = this.kv.get<AuditEntry[]>(NS, key, { projectId: this.projectId }) ?? [];
    log.push(entry);
    // 台账上限防膨胀：保留最近 500 条（单批次生命周期内足够回溯）
    const trimmed = log.length > 500 ? log.slice(log.length - 500) : log;
    await this.kv.set(NS, key, trimmed, { projectId: this.projectId });
  }

  getAudit(batchId: string): AuditEntry[] {
    return this.kv.get<AuditEntry[]>(NS, `audit:${batchId}`, { projectId: this.projectId }) ?? [];
  }

  // ---- 交付章节的覆写保险（旧正文备份在 KV，独立于 snapshots 表） ----

  async backupChapter(batchId: string, order: number, content: string, title: string): Promise<void> {
    await this.kv.set(NS, `backup:${batchId}:${order}`, { title, content, at: Date.now() }, { projectId: this.projectId });
  }
}
