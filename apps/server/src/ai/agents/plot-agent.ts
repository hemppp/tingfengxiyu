// ============================================================
// 伏笔检测 Agent - 从文本中识别潜在伏笔，关联已有伏笔库
// ============================================================

import type { ChatMessage } from '../providers/provider-factory.js';
import type { ForeshadowType } from '@novel/shared';
import { parseAgentJson } from './utils.js';

/**
 * 伏笔检测 Agent 输入
 */
export interface PlotInput {
  /** 章节内容 */
  chapterContent: string;
  /** 章节序号 */
  chapterOrder: number;
  /** 已有伏笔列表 JSON */
  existingForeshadowsJson?: string;
  /** 角色列表 JSON */
  charactersJson?: string;
}

/**
 * 伏笔检测 Agent 输出
 */
export interface PlotResult {
  /** 新检测到的潜在伏笔 */
  newForeshadows: PlotForeshadow[];
  /** 与已有伏笔的关联 */
  relatedForeshadows: PlotForeshadowRelation[];
  /** 整体分析 */
  analysis: string;
}

export interface PlotForeshadow {
  description: string;
  type: ForeshadowType;
  relatedCharacters: string[];
  reasons: string;
  confidence: number;
  /** 伏笔在文中的上下文 */
  context: string;
}

export interface PlotForeshadowRelation {
  existingForeshadowId: string;
  existingDescription: string;
  relationType: 'reinforce' | 'contradict' | 'extend' | 'payoff';
  description: string;
}

// ---- Prompt 模板 ----

const SYSTEM_PROMPT = `你是一个专业的伏笔分析专家，专门用于从小说文本中识别潜在伏笔。你的任务是仔细阅读章节内容，提取所有可能的伏笔，并关联已有的伏笔库。

分析要点：
1. 识别暗示未来事件或转折的文字
2. 识别未完成的叙事线索
3. 识别人物对话中的潜台词
4. 识别环境描写中的暗示
5. 识别看似不经意的细节，但可能影响后续剧情
6. 与已有伏笔对比，判断关联关系

请详细分析，但只报告确有根据的发现，不要虚构。`;

function buildUserPrompt(input: PlotInput): string {
  return [
    '请分析以下章节中的伏笔：',
    '',
    `章节序号：第 ${input.chapterOrder} 章`,
    '',
    '章节内容：',
    input.chapterContent,
    '',
    input.existingForeshadowsJson
      ? `已有伏笔库：\n${input.existingForeshadowsJson}`
      : '',
    input.charactersJson ? `角色列表：\n${input.charactersJson}` : '',
  ].join('\n');
}

function buildOutputFormatSection(): string {
  return `
请按以下 JSON 格式输出分析结果（只输出 JSON，不要包含其他文字）：

{
  "newForeshadows": [
    {
      "description": "伏笔描述",
      "type": "identity|motivation|relation|trauma|turning|fate",
      "relatedCharacters": ["角色名"],
      "reasons": "判断依据",
      "confidence": 0.0-1.0,
      "context": "文中的上下文原文片段"
    }
  ],
  "relatedForeshadows": [
    {
      "existingForeshadowId": "已有伏笔的描述",
      "existingDescription": "已有伏笔的原始描述",
      "relationType": "reinforce|contradict|extend|payoff",
      "description": "关联说明"
    }
  ],
  "analysis": "整体伏笔分析总结"
}`;
}

/**
 * 运行伏笔检测
 */
export async function runPlotAnalysis(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: PlotInput,
  options?: { signal?: AbortSignal },
): Promise<PlotResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildUserPrompt(input) + '\n\n' + buildOutputFormatSection(),
    },
  ];

  const response = await chat(messages, {
    temperature: 0.4,
    maxTokens: 4096,
  }, options?.signal);

  const parsed = parseAgentJson(response, 'PlotAgent');

  return {
    newForeshadows: (parsed.newForeshadows as PlotForeshadow[]) || [],
    relatedForeshadows:
      (parsed.relatedForeshadows as PlotForeshadowRelation[]) || [],
    analysis: (parsed.analysis as string) || '',
  };
}