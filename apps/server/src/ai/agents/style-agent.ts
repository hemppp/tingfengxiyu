// ============================================================
// 写作风格分析 Agent - 句式/人称/对话风格/段落长度分析
// ============================================================

import type { ChatMessage } from '../providers/provider-factory.js';
import { parseAgentJson } from './utils.js';

/**
 * 风格分析 Agent 输入
 */
export interface StyleInput {
  /** 参考文本（章节内容） */
  referenceText: string;
  /** 文本来源 */
  source?: string;
  /** 作者 */
  author?: string;
  /** 体裁 */
  genre?: string;
  /** 时代背景 */
  era?: string;
}

/**
 * 风格分析 Agent 输出
 */
export interface StyleResult {
  style: StyleProfile;
  styleSignature: string;
  guidelines: string[];
  warnings: string[];
}

export interface StyleProfile {
  sentenceStructure: {
    averageLength: number;
    complexity: 'low' | 'medium' | 'high';
    rhythm: string;
    patterns: string[];
  };
  vocabulary: {
    preferredWords: string[];
    avoidedWords: string[];
    technicalTerms: string[];
    dialectFeatures: string[];
    formalityLevel: 'veryFormal' | 'formal' | 'neutral' | 'informal' | 'veryInformal';
  };
  rhetoric: {
    metaphors: 'rare' | 'common' | 'frequent';
    similes: 'rare' | 'common' | 'frequent';
    personification: 'rare' | 'common' | 'frequent';
    alliteration: 'rare' | 'common' | 'frequent';
    other: string[];
  };
  narrativePerspective: {
    type:
      | 'firstPerson'
      | 'thirdPersonLimited'
      | 'thirdPersonOmniscient'
      | 'secondPerson';
    distance: 'close' | 'medium' | 'distant';
    voice: string;
  };
  pacing: {
    descriptionToDialogueRatio: number;
    sceneTransitionSpeed: 'slow' | 'medium' | 'fast';
    actionSequenceLength: 'short' | 'medium' | 'long';
  };
  emotionalExpression: {
    intensity: 'low' | 'medium' | 'high';
    expressionStyle: 'direct' | 'indirect' | 'subtle';
    emotionalRange: 'narrow' | 'medium' | 'wide';
  };
  dialogue: {
    naturalness: 'low' | 'medium' | 'high';
    length: 'short' | 'medium' | 'long';
    content: string;
    tags: string[];
  };
  description: {
    detailDensity: 'low' | 'medium' | 'high';
    sensoryFocus: string[];
    abstractToConcreteRatio: number;
    focus: string;
  };
}

// ---- 简化版输出（单独调用分析维度） ----

export interface SimplifiedStyleResult {
  sentenceLength: {
    average: number;
    complexity: 'low' | 'medium' | 'high';
    rhythm: string;
  };
  perspective: {
    type: string;
    person: '第一人称' | '第二人称' | '第三人称有限' | '第三人称全知';
  };
  dialogueStyle: {
    frequency: 'low' | 'medium' | 'high';
    avgLength: 'short' | 'medium' | 'long';
    naturalness: string;
  };
  paragraphLength: {
    average: number;
    pattern: 'short' | 'medium' | 'long' | 'mixed';
  };
}

// ---- Prompt 模板 ----

const SYSTEM_PROMPT = `你是一个文学风格分析专家，专门用于识别和锁定写作风格。你的任务是分析提供的参考文本，提取其独特的写作风格特征，并为后续创作提供风格指导。

分析维度：
1. 句式结构：句子长度、复杂度、节奏
2. 词汇选择：用词偏好、专业术语、方言使用
3. 修辞手法：比喻、拟人、排比等的使用频率和类型
4. 叙事视角：第一人称、第三人称、全知视角等
5. 节奏控制：描述与对话的比例、场景转换速度
6. 情感表达：情感浓度、表达方式（直接/间接）
7. 对话风格：对话的自然度、长度、内容特点
8. 描写风格：细节密度、感官描写、抽象与具象的平衡

请提取这些特征，并为后续创作提供明确的风格指导。`;

function buildUserPrompt(input: StyleInput): string {
  return [
    '请分析以下参考文本的写作风格：',
    '',
    input.referenceText,
    '',
    '参考文本信息：',
    input.source ? `- 来源：${input.source}` : '',
    input.author ? `- 作者：${input.author}` : '',
    input.genre ? `- 体裁：${input.genre}` : '',
    input.era ? `- 时代背景：${input.era}` : '',
    '',
    '请分析并锁定该文本的写作风格，为后续创作提供指导。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildOutputFormatSection(): string {
  return `
请按以下 JSON 格式输出分析结果（只输出 JSON，不要包含其他文字）：

{
  "style": {
    "sentenceStructure": {
      "averageLength": 数字,
      "complexity": "low|medium|high",
      "rhythm": "string",
      "patterns": ["string"]
    },
    "vocabulary": {
      "preferredWords": ["string"],
      "avoidedWords": ["string"],
      "technicalTerms": ["string"],
      "dialectFeatures": ["string"],
      "formalityLevel": "veryFormal|formal|neutral|informal|veryInformal"
    },
    "rhetoric": {
      "metaphors": "rare|common|frequent",
      "similes": "rare|common|frequent",
      "personification": "rare|common|frequent",
      "alliteration": "rare|common|frequent",
      "other": ["string"]
    },
    "narrativePerspective": {
      "type": "firstPerson|thirdPersonLimited|thirdPersonOmniscient|secondPerson",
      "distance": "close|medium|distant",
      "voice": "string"
    },
    "pacing": {
      "descriptionToDialogueRatio": 数字,
      "sceneTransitionSpeed": "slow|medium|fast",
      "actionSequenceLength": "short|medium|long"
    },
    "emotionalExpression": {
      "intensity": "low|medium|high",
      "expressionStyle": "direct|indirect|subtle",
      "emotionalRange": "narrow|medium|wide"
    },
    "dialogue": {
      "naturalness": "low|medium|high",
      "length": "short|medium|long",
      "content": "string",
      "tags": ["string"]
    },
    "description": {
      "detailDensity": "low|medium|high",
      "sensoryFocus": ["visual|auditory|tactile|olfactory|gustatory"],
      "abstractToConcreteRatio": 数字,
      "focus": "string"
    }
  },
  "styleSignature": "string",
  "guidelines": ["string"],
  "warnings": ["string"]
}`;
}

/**
 * 运行风格分析
 */
export async function runStyleAnalysis(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: StyleInput,
  options?: { signal?: AbortSignal },
): Promise<StyleResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildUserPrompt(input) + '\n\n' + buildOutputFormatSection(),
    },
  ];

  const response = await chat(messages, {
    temperature: 0.3,
    maxTokens: 4096,
  }, options?.signal);

  const parsed = parseAgentJson(response, 'StyleAgent');
  const style = (parsed.style || {}) as StyleProfile;

  return {
    style: {
      sentenceStructure: style.sentenceStructure || {
        averageLength: 0,
        complexity: 'medium',
        rhythm: '',
        patterns: [],
      },
      vocabulary: style.vocabulary || {
        preferredWords: [],
        avoidedWords: [],
        technicalTerms: [],
        dialectFeatures: [],
        formalityLevel: 'neutral',
      },
      rhetoric: style.rhetoric || {
        metaphors: 'rare',
        similes: 'rare',
        personification: 'rare',
        alliteration: 'rare',
        other: [],
      },
      narrativePerspective: style.narrativePerspective || {
        type: 'thirdPersonOmniscient',
        distance: 'medium',
        voice: '',
      },
      pacing: style.pacing || {
        descriptionToDialogueRatio: 0,
        sceneTransitionSpeed: 'medium',
        actionSequenceLength: 'medium',
      },
      emotionalExpression: style.emotionalExpression || {
        intensity: 'medium',
        expressionStyle: 'direct',
        emotionalRange: 'medium',
      },
      dialogue: style.dialogue || {
        naturalness: 'medium',
        length: 'medium',
        content: '',
        tags: [],
      },
      description: style.description || {
        detailDensity: 'medium',
        sensoryFocus: [],
        abstractToConcreteRatio: 0,
        focus: '',
      },
    },
    styleSignature: (parsed.styleSignature as string) || '',
    guidelines: (parsed.guidelines as string[]) || [],
    warnings: (parsed.warnings as string[]) || [],
  };
}

/**
 * 简化风格分析：仅提取句式长短/人称/视角/对话风格/段落长度
 */
export async function runSimplifiedStyleAnalysis(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: { referenceText: string },
  options?: { signal?: AbortSignal },
): Promise<SimplifiedStyleResult> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是一个文学风格分析专家。请分析以下文本的写作风格特征。只输出 JSON，不要其他文字。`,
    },
    {
      role: 'user',
      content: `${input.referenceText}\n\n请分析并输出 JSON：
{
  "sentenceLength": { "average": 数字, "complexity": "low|medium|high", "rhythm": "string" },
  "perspective": { "type": "string", "person": "第一人称|第二人称|第三人称有限|第三人称全知" },
  "dialogueStyle": { "frequency": "low|medium|high", "avgLength": "short|medium|long", "naturalness": "string" },
  "paragraphLength": { "average": 数字, "pattern": "short|medium|long|mixed" }
}`,
    },
  ];

  const response = await chat(messages, { temperature: 0.3, maxTokens: 2048 }, options?.signal);
  const parsed = parseAgentJson(response, 'StyleAgent');

  return {
    sentenceLength: (parsed.sentenceLength as SimplifiedStyleResult['sentenceLength']) || {
      average: 0,
      complexity: 'medium',
      rhythm: '',
    },
    perspective: (parsed.perspective as SimplifiedStyleResult['perspective']) || {
      type: '',
      person: '第三人称有限',
    },
    dialogueStyle: (parsed.dialogueStyle as SimplifiedStyleResult['dialogueStyle']) || {
      frequency: 'medium',
      avgLength: 'medium',
      naturalness: '',
    },
    paragraphLength: (parsed.paragraphLength as SimplifiedStyleResult['paragraphLength']) || {
      average: 0,
      pattern: 'mixed',
    },
  };
}