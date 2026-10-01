// ============================================================
// Agent 编排管道 - 定义处理流水线
//
// onChapterSave → scanner → consistency → plot → style
// 支持并行执行独立 Agent，顺序执行有依赖的 Agent
// ============================================================

import type { ChatMessage } from './providers/provider-factory.js';
import type { ScannerInput, ScannerResult } from './agents/scanner-agent.js';
import { scanChapter } from './agents/scanner-agent.js';
import type { ConsistencyInput, ConsistencyResult } from './agents/consistency-agent.js';
import { runConsistencyCheck } from './agents/consistency-agent.js';
import type { PlotInput, PlotResult } from './agents/plot-agent.js';
import { runPlotAnalysis } from './agents/plot-agent.js';
import type { StyleInput, StyleResult } from './agents/style-agent.js';
import { runStyleAnalysis } from './agents/style-agent.js';

// ---- 管道输入/输出 ----

export interface PipelineInput {
  /** 章节内容 */
  chapterContent: string;
  /** 章节标题 */
  chapterTitle: string;
  /** 章节序号 */
  chapterOrder: number;
  /** 项目名称 */
  projectName: string;
  /** 前一章节摘要 */
  previousSummary?: string;
  /** 已有实体列表 JSON */
  existingEntities?: string;
  /** 角色列表 JSON */
  charactersJson?: string;
  /** 物品列表 JSON */
  itemsJson?: string;
  /** 地点列表 JSON */
  locationsJson?: string;
  /** 事件列表 JSON */
  eventsJson?: string;
  /** 伏笔列表 JSON */
  foreshadowsJson?: string;
  /** 时间线 JSON */
  timelineJson?: string;
  /** 大纲 JSON */
  outlineJson?: string;
  /** 章节摘要 */
  chaptersSummary?: string;
}

export interface PipelineResult {
  /** 章节扫描结果 */
  scan: ScannerResult | null;
  /** 一致性检查结果 */
  consistency: ConsistencyResult | null;
  /** 伏笔检测结果 */
  plot: PlotResult | null;
  /** 风格分析结果 */
  style: StyleResult | null;
  /** 各阶段的错误信息（Agent 名 → 错误消息） */
  errors: Record<string, string>;
}

// ---- 管道运行器 ----

/** Pipeline 执行选项 */
export interface PipelineOptions {
  /** 是否并行执行独立 Agent（默认 true） */
  parallel?: boolean;
  /** 要跳过执行的 Agent 名称列表 */
  skip?: string[];
  /** 外部取消信号，透传给各 Agent 的 LLM 调用 */
  signal?: AbortSignal;
}

/**
 * 执行完整的 Agent 流水线
 *
 * 流水线顺序：scanner → consistency → plot → style
 * - scanner、style 可以并行
 * - consistency、plot 的输入已在调用前构建，不依赖 scanner 运行时结果
 * - 单个 Agent 失败不影响其他
 */
export async function runPipeline(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: PipelineInput,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    scan: null,
    consistency: null,
    plot: null,
    style: null,
    errors: {},
  };

  const skip = new Set(options?.skip ?? []);
  const useParallel = options?.parallel !== false;

  // 构建扫描输入
  const scanInput: ScannerInput = {
    chapterContent: input.chapterContent,
    chapterTitle: input.chapterTitle,
    chapterOrder: input.chapterOrder,
    projectName: input.projectName,
    previousSummary: input.previousSummary,
    existingEntities: input.existingEntities,
  };

  // 构建风格输入
  const styleInput: StyleInput = {
    referenceText: input.chapterContent,
  };

  // 构建一致性检查输入（两种模式共用）
  const consistencyInput: ConsistencyInput = {
    projectName: input.projectName,
    charactersJson: input.charactersJson,
    itemsJson: input.itemsJson,
    locationsJson: input.locationsJson,
    eventsJson: input.eventsJson,
    foreshadowsJson: input.foreshadowsJson,
    timelineJson: input.timelineJson,
    outlineJson: input.outlineJson,
    chaptersSummary: input.chaptersSummary,
  };

  // 构建伏笔分析输入（两种模式共用）
  const plotInput: PlotInput = {
    chapterContent: input.chapterContent,
    chapterOrder: input.chapterOrder,
    existingForeshadowsJson: input.foreshadowsJson,
    charactersJson: input.charactersJson,
  };

  if (useParallel) {
    // ---- 并行阶段 1：scanner + style（互不依赖） ----
    const tasks: Promise<void>[] = [];

    if (!skip.has('scanner')) {
      tasks.push(
        (async () => {
          try {
            result.scan = await scanChapter(chat, scanInput, { signal: options?.signal });
          } catch (e) {
            result.errors.scanner = e instanceof Error ? e.message : String(e);
          }
        })(),
      );
    }

    if (!skip.has('style')) {
      tasks.push(
        (async () => {
          try {
            result.style = await runStyleAnalysis(chat, styleInput, { signal: options?.signal });
          } catch (e) {
            result.errors.style = e instanceof Error ? e.message : String(e);
          }
        })(),
      );
    }

    await Promise.all(tasks);

    // ---- 串行阶段 2：consistency（与串行模式一致，不依赖 scanner 结果） ----
    if (!skip.has('consistency')) {
      try {
        result.consistency = await runConsistencyCheck(chat, consistencyInput, { signal: options?.signal });
      } catch (e) {
        result.errors.consistency =
          e instanceof Error ? e.message : String(e);
      }
    }

    // ---- 串行阶段 3：plot（与串行模式一致，不依赖 scanner 结果） ----
    if (!skip.has('plot')) {
      try {
        result.plot = await runPlotAnalysis(chat, plotInput, { signal: options?.signal });
      } catch (e) {
        result.errors.plot = e instanceof Error ? e.message : String(e);
      }
    }
  } else {
    // ---- 全串行模式 ----
    // Stage 1: scanner → 阶段 1：扫描器
    if (!skip.has('scanner')) {
      try {
        result.scan = await scanChapter(chat, scanInput, { signal: options?.signal });
      } catch (e) {
        result.errors.scanner = e instanceof Error ? e.message : String(e);
      }
    }

    // Stage 2: consistency → 阶段 2：一致性
    if (!skip.has('consistency')) {
      try {
        result.consistency = await runConsistencyCheck(chat, consistencyInput, { signal: options?.signal });
      } catch (e) {
        result.errors.consistency =
          e instanceof Error ? e.message : String(e);
      }
    }

    // Stage 3: plot → 阶段 3：伏笔
    if (!skip.has('plot')) {
      try {
        result.plot = await runPlotAnalysis(chat, plotInput, { signal: options?.signal });
      } catch (e) {
        result.errors.plot = e instanceof Error ? e.message : String(e);
      }
    }

    // Stage 4: style → 阶段 4：风格
    if (!skip.has('style')) {
      try {
        result.style = await runStyleAnalysis(chat, styleInput, { signal: options?.signal });
      } catch (e) {
        result.errors.style = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return result;
}

/**
 * 仅执行扫描流水线（scanner → consistency → plot）
 */
export async function runScanPipeline(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: PipelineInput,
): Promise<Pick<PipelineResult, 'scan' | 'consistency' | 'plot' | 'errors'>> {
  return runPipeline(chat, input, { skip: ['style'] });
}

/**
 * 聚合结果辅助：检查管道是否完全成功
 */
export function isPipelineSuccess(result: PipelineResult): boolean {
  return Object.keys(result.errors).length === 0;
}