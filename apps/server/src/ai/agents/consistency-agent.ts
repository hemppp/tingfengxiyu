// ============================================================
// 一致性检查 Agent - 检查角色、情节、时间线、设定的一致性
// ============================================================

import type { ChatMessage } from '../providers/provider-factory.js';
import { parseAgentJson } from './utils.js';
import type { ConsistencyIssue } from '@novel/shared';

/**
 * 一致性检查 Agent 输入参数
 */
export interface ConsistencyInput {
  /** 项目名称 */
  projectName: string;
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
  /** 大纲结构 JSON */
  outlineJson?: string;
  /** 章节摘要 */
  chaptersSummary?: string;
}

/**
 * 一致性检查 Agent 输出结果
 */
export interface ConsistencyResult {
  inconsistencies: ConsistencyCheckItem[];
  overallConsistencyScore: number;
  recommendations: string[];
}

export interface ConsistencyCheckItem {
  type: 'character' | 'item' | 'location' | 'timeline' | 'foreshadow' | 'worldbuilding';
  description: string;
  affectedElements: {
    type: 'character' | 'item' | 'location' | 'event' | 'foreshadow';
    id: string;
    name: string;
  }[];
  evidence: string[];
  severity: 'low' | 'medium' | 'high';
  suggestions: string[];
}

// ---- Prompt 模板 ----

const SYSTEM_PROMPT = `你是一个小说世界一致性检查专家，专门用于检测小说创作中的逻辑矛盾和不一致之处。你的任务是仔细检查项目中的所有元素，找出潜在的不一致问题，并提供修复建议。

检查范围：
1. 角色一致性：性格、背景、能力是否前后一致
2. 物品一致性：物品的描述、属性、所有权是否前后一致
3. 地点一致性：地点的描述、特征、位置是否前后一致
4. 时间线一致性：事件发生顺序、时间跨度是否合理
5. 伏笔一致性：伏笔的铺设与呼应是否合理
6. 世界观一致性：规则、文化、科技水平是否统一

请只报告实际存在的不一致，不要虚构问题。`;

function buildUserPrompt(input: ConsistencyInput): string {
  return [
    '请检查以下项目的整体一致性：',
    '',
    `项目名称：${input.projectName}`,
    '',
    input.charactersJson ? `角色列表：\n${input.charactersJson}\n` : '',
    input.itemsJson ? `物品列表：\n${input.itemsJson}\n` : '',
    input.locationsJson ? `地点列表：\n${input.locationsJson}\n` : '',
    input.eventsJson ? `事件列表：\n${input.eventsJson}\n` : '',
    input.foreshadowsJson ? `伏笔列表：\n${input.foreshadowsJson}\n` : '',
    input.timelineJson ? `时间线：\n${input.timelineJson}\n` : '',
    input.outlineJson ? `大纲结构：\n${input.outlineJson}\n` : '',
    input.chaptersSummary ? `章节摘要：\n${input.chaptersSummary}` : '',
  ].join('\n');
}

function buildOutputFormatSection(): string {
  return `
请按以下 JSON 格式输出检查结果（只输出 JSON，不要包含其他文字）：

{
  "inconsistencies": [
    {
      "type": "character|item|location|timeline|foreshadow|worldbuilding",
      "description": "string",
      "affectedElements": [
        { "type": "character|item|location|event|foreshadow", "id": "string", "name": "string" }
      ],
      "evidence": ["string"],
      "severity": "low|medium|high",
      "suggestions": ["string"]
    }
  ],
  "overallConsistencyScore": 0.0-1.0,
  "recommendations": ["string"]
}`;
}

/**
 * 运行一致性检查
 */
export async function runConsistencyCheck(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: ConsistencyInput,
  options?: { signal?: AbortSignal },
): Promise<ConsistencyResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildUserPrompt(input) + '\n\n' + buildOutputFormatSection(),
    },
  ];

  const response = await chat(messages, {
    temperature: 0.2,
    maxTokens: 4096,
  }, options?.signal);

  const parsed = parseAgentJson(response, 'ConsistencyAgent');

  return {
    inconsistencies: (parsed.inconsistencies as ConsistencyCheckItem[]) || [],
    overallConsistencyScore:
      typeof parsed.overallConsistencyScore === 'number'
        ? parsed.overallConsistencyScore
        : 0.0,
    recommendations: (parsed.recommendations as string[]) || [],
  };
}

/**
 * 将 Agent 输出转换为共享类型 ConsistencyIssue[]
 */
export function toConsistencyIssues(result: ConsistencyResult): ConsistencyIssue[] {
  return result.inconsistencies.map((item) => ({
    type: mapType(item.type),
    severity: mapSeverity(item.severity),
    description: item.description,
    chapterId: '',
    offset: undefined,
    relatedEntityIds: item.affectedElements.map((e) => e.id),
  }));
}

function mapType(
  type: ConsistencyCheckItem['type'],
): ConsistencyIssue['type'] {
  switch (type) {
    case 'foreshadow':
    case 'worldbuilding':
      return 'custom';
    default:
      return type;
  }
}

function mapSeverity(severity: string): ConsistencyIssue['severity'] {
  if (severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'info';
}