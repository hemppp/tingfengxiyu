// ============================================================
// 时间线分析 Agent - 分析时间线事件，生成结构化的流程图数据
// ============================================================

import type { ChatMessage } from '../providers/provider-factory.js';
import { parseAgentJson } from './utils.js';

export interface TimelineAnalysisInput {
  events: Array<{
    id: string;
    title: string;
    description?: string;
    chapter?: number | null;
    type: 'event' | 'foreshadow' | 'state_change';
    characterIds?: string[];
    order: number;
    color?: string;
  }>;
  characters?: Array<{ id: string; name: string; color?: string }>;
  projectName?: string;
}

export interface TimelineFlowNode {
  id: string;
  title: string;
  type: 'event' | 'foreshadow' | 'state_change' | 'chapter';
  chapter?: number;
  description?: string;
  characterNames?: string[];
  color?: string;
  x: number;
  y: number;
}

export interface TimelineFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type: 'causal' | 'sequence' | 'foreshadow';
}

export interface TimelineAnalysisResult {
  nodes: TimelineFlowNode[];
  edges: TimelineFlowEdge[];
  summary: string;
  insights: string[];
}

const SYSTEM_PROMPT = `你是一个专业的小说情节分析助手。你的任务是分析时间线事件，识别事件之间的因果关系、时间顺序和伏笔关联，生成结构化的流程图数据。

分析原则：
1. 识别事件之间的因果关系（A导致B）
2. 识别时间顺序关系（A发生在B之前）
3. 识别伏笔与回收的关系（foreshadow类型的事件与后续事件的关联）
4. 识别状态变化事件的触发条件和结果
5. 保持分析的逻辑清晰和合理性

输出格式要求：
- 返回 JSON 格式数据
- nodes 数组包含所有事件节点
- edges 数组包含节点之间的关系
- summary 提供整体情节分析摘要
- insights 提供深入的情节洞察

请仔细分析以下时间线事件，生成完整的流程图数据。`;

const OUTPUT_FORMAT = `
请按以下 JSON 格式输出（只输出 JSON，不要包含其他文字）：

{
  "nodes": [
    {
      "id": "事件ID",
      "title": "事件标题",
      "type": "event|foreshadow|state_change|chapter",
      "chapter": 章节号（如果有关联）,
      "description": "事件描述（可选）",
      "characterNames": ["涉及角色名"],
      "color": "颜色代码",
      "x": 水平位置（0-1000）,
      "y": 垂直位置（0-800）
    }
  ],
  "edges": [
    {
      "id": "边ID",
      "source": "源节点ID",
      "target": "目标节点ID",
      "label": "关系标签（可选）",
      "type": "causal|sequence|foreshadow"
    }
  ],
  "summary": "整体情节分析摘要（100字以内）",
  "insights": ["洞察1", "洞察2", "洞察3"]
}`;

function buildUserMessage(input: TimelineAnalysisInput): string {
  const eventsDesc = input.events.map((ev) => {
    const chapterPart = ev.chapter != null ? `（第${ev.chapter}章）` : '';
    const typePart = ev.type === 'foreshadow' ? '[伏笔]' : ev.type === 'state_change' ? '[状态变化]' : '[事件]';
    const charsPart = ev.characterIds && ev.characterIds.length > 0
      ? ` | 涉及角色: ${ev.characterIds.join(', ')}`
      : '';
    return `${typePart} ${ev.title}${chapterPart}${charsPart}`;
  }).join('\n');

  const charsDesc = input.characters && input.characters.length > 0
    ? '\n\n【角色列表】\n' + input.characters.map(c => `${c.id}: ${c.name}`).join('\n')
    : '';

  return [
    '【时间线事件】',
    eventsDesc,
    charsDesc,
    OUTPUT_FORMAT,
  ].join('\n');
}

export async function runTimelineAnalysis(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: TimelineAnalysisInput,
  options?: { signal?: AbortSignal },
): Promise<TimelineAnalysisResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(input) },
  ];

  const response = await chat(messages, {
    temperature: 0.6,
    maxTokens: 4096,
  }, options?.signal);

  const parsed = parseAgentJson(response, 'TimelineAnalysisAgent');

  return {
    nodes: (parsed.nodes as TimelineFlowNode[]) || [],
    edges: (parsed.edges as TimelineFlowEdge[]) || [],
    summary: (parsed.summary as string) || '',
    insights: (parsed.insights as string[]) || [],
  };
}