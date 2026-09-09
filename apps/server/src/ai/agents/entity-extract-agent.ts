// ============================================================
// 实体提取 Agent - 从纯文本中提取角色/物品/地点实体
//
// 输入：原始文本 + 可选的目标实体类型
// 输出：提取到的实体列表（名称+类型+描述）
// ============================================================

import type { ChatMessage } from '../providers/provider-factory.js';
import { parseAgentJson } from './utils.js';

export interface ExtractInput {
  /** 待分析的原始文本 */
  text: string;
  /** 目标实体类型（不指定则提取全部） */
  entityType?: 'character' | 'item' | 'location';
  /** 已有实体列表（用于去重和补充描述） */
  existingEntities?: string;
}

export interface ExtractedEntity {
  name: string;
  type: 'character' | 'item' | 'location';
  description: string;
  confidence: number;
}

export interface ExtractResult {
  entities: ExtractedEntity[];
}

const SYSTEM_PROMPT = `你是一个专业的文学分析助手，擅长从小说文本中识别和提取实体（角色、物品、地点）。
你的任务是从给定的文本中准确提取所有提及到的实体，并给出简要描述。

规则：
- 只提取明确在文本中出现或有强烈暗示的实体
- 为每个实体提供简短描述（一句话）
- 置信度 0.0-1.0，表示该实体在文本中的确定性
- 不要凭空创造文本中不存在的实体
- 如果某个实体的类型不确定，选择最可能的一个
- 严格遵循 JSON 格式输出`;

function buildUserPrompt(input: ExtractInput): string {
  const typeHint = input.entityType
    ? `\n只提取类型为 "${input.entityType}" 的实体。`
    : '\n提取所有类型的实体（角色、物品、地点）。';

  const existingHint = input.existingEntities
    ? `\n\n已有的实体列表（用于参考和避免重复）：\n${input.existingEntities}`
    : '';

  return [
    '请从以下文本中提取实体：',
    '',
    typeHint,
    '',
    '=== 待分析文本 ===',
    input.text,
    '=== 文本结束 ===',
    existingHint,
    '',
    '请按以下 JSON 格式输出（只输出 JSON）：',
    `{ "entities": [`,
    `  { "name": "实体名", "type": "character|item|location", "description": "简短描述", "confidence": 0.9 },`,
    `  ...`,
    `] }`,
  ].filter(Boolean).join('\n');
}

export async function runExtract(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: ExtractInput,
  options?: { signal?: AbortSignal },
): Promise<ExtractResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ];

  const response = await chat(messages, {
    temperature: 0.2,
    maxTokens: 4096,
  }, options?.signal);

  const parsed = parseAgentJson(response, 'ExtractAgent');
  const rawEntities = (parsed.entities as ExtractedEntity[]) || [];

  const validTypes = new Set(['character', 'item', 'location']);
  const entities: ExtractedEntity[] = rawEntities
    .filter(
      (e): e is ExtractedEntity =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as unknown as Record<string, unknown>).name === 'string' &&
        validTypes.has((e as unknown as Record<string, unknown>).type as string),
    )
    .map((e) => ({
      name: e.name,
      type: e.type as 'character' | 'item' | 'location',
      description: e.description || '',
      confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.5)),
    }));

  return { entities };
}
