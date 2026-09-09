// ============================================================
// 节奏分析 Agent - 识别文本的呼吸点 / 停顿 / 情绪低谷 / 情绪高涨
//
// 由前端 rhythmService.analyzeRhythm 调用，对应路由 POST /api/ai/analyze-rhythm。
// 后端不可用时，前端会回退到本地启发式（isLocalFallback=true）。
// ============================================================

import type { ChatMessage } from '../providers/provider-factory.js';
import { parseAgentJson } from './utils.js';

/**
 * 节奏分析 Agent 输入
 */
export interface RhythmInput {
  /** 待分析的章节文本（已去 HTML） */
  text: string;
  /** 章节标题（可选，提供给 LLM 做上下文判断） */
  chapterTitle?: string;
}

/**
 * 单条节奏标记（与前端 RhythmMark 结构对齐）
 */
export interface RhythmMarkDTO {
  type: 'breath' | 'pause' | 'dip' | 'surge';
  /** 字符偏移 */
  position: number;
  /** 提示文字 */
  label: string;
  /** 0-1 强度 */
  intensity: number;
}

/**
 * 节奏分析 Agent 输出
 */
export interface RhythmResult {
  marks: RhythmMarkDTO[];
  /** 整体节奏概览文本 */
  summary: string;
}

const SYSTEM_PROMPT = `你是一个小说节奏分析专家。你的任务是分析给定章节文本的节奏特征，识别以下四类节奏标记：

- breath（呼吸点）：长句结束后的换气位置，通常出现在句号、问号、感叹号之后，且前句较长（>40字）。
- pause（停顿）：省略号、破折号、密集逗号造成的留白或转折。
- dip（情绪低谷）：出现否定、消极、绝望、悲伤等情绪词的段落起点。
- surge（情绪高涨）：出现希望、胜利、爆发、觉醒等积极或激烈词的段落起点。

请严格按 JSON 输出，不要包含其他文字。position 字段必须是该标记在原文中的字符偏移（从 0 开始）。intensity 取 0-1 之间的小数。summary 字段返回一句话整体节奏点评。`;

function buildUserPrompt(input: RhythmInput): string {
  return [
    input.chapterTitle ? `章节标题：${input.chapterTitle}` : '',
    '章节正文：',
    input.text,
    '',
    '请分析并输出 JSON：',
    '{',
    '  "marks": [',
    '    { "type": "breath|pause|dip|surge", "position": 数字, "label": "string", "intensity": 0.0-1.0 }',
    '  ],',
    '  "summary": "string"',
    '}',
  ].filter(Boolean).join('\n');
}

/**
 * 运行节奏分析
 */
export async function runRhythmAnalysis(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: RhythmInput,
  options?: { signal?: AbortSignal },
): Promise<RhythmResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ];

  const response = await chat(messages, {
    temperature: 0.3,
    maxTokens: 4096,
  }, options?.signal);

  const parsed = parseAgentJson(response, 'RhythmAgent');

  const rawMarks = Array.isArray(parsed.marks) ? parsed.marks : [];
  const validTypes = new Set(['breath', 'pause', 'dip', 'surge']);

  const marks: RhythmMarkDTO[] = rawMarks
    .map((m: unknown): RhythmMarkDTO | null => {
      if (!m || typeof m !== 'object') return null;
      const obj = m as Record<string, unknown>;
      const type = obj.type;
      if (typeof type !== 'string' || !validTypes.has(type)) return null;
      const position = typeof obj.position === 'number' ? Math.max(0, Math.floor(obj.position)) : 0;
      const label = typeof obj.label === 'string' ? obj.label : '';
      const rawIntensity = typeof obj.intensity === 'number' ? obj.intensity : 0;
      const intensity = Math.max(0, Math.min(1, rawIntensity));
      return { type: type as RhythmMarkDTO['type'], position, label, intensity };
    })
    .filter((m): m is RhythmMarkDTO => m !== null);

  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';

  return { marks, summary };
}
