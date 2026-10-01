/**
 * 风格锁定服务
 *
 * analyzeStyle 调用后端 POST /ai/analyze-style (simple=true)，
 * 由 style-agent.runSimplifiedStyleAnalysis 调 LLM 完成真实分析。
 * 后端不可用时回退到本地启发式，并在返回结果中标注 isLocalFallback=true。
 */

// 风格标签映射
export const sentenceLengthLabels: Record<StyleProfile['sentenceLength'], string> = {
  short: '短句简洁',
  medium: '中等长度',
  long: '细腻绵长',
};

export const perspectiveLabels: Record<StyleProfile['perspective'], string> = {
  first_person: '第一人称',
  third_person: '第三人称',
  omniscient: '全知视角',
};

export const dialogueLabels: Record<StyleProfile['dialogueStyle'], string> = {
  natural: '自然对话',
  formal: '正式书面',
  colloquial: '口语化',
};

export const paragraphLabels: Record<StyleProfile['paragraphLength'], string> = {
  short: '短段落',
  medium: '中等段落',
  long: '长段落舒展',
};

export interface StyleProfile {
  sentenceLength: 'short' | 'medium' | 'long';
  wordFrequency: Record<string, number>;
  avoidedWords: string[];
  perspective: 'first_person' | 'third_person' | 'omniscient';
  dialogueStyle: 'natural' | 'formal' | 'colloquial';
  paragraphLength: 'short' | 'medium' | 'long';
}

/** 带兜底标志的分析结果 */
export interface StyleAnalysisResult {
  profile: StyleProfile;
  /** true 表示后端 AI 不可用，profile 为本地启发式兜底结果 */
  isLocalFallback: boolean;
}

/** 后端 runSimplifiedStyleAnalysis 返回的简化结构 */
interface ServerSimplifiedStyleResult {
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

/** 将后端简化结构映射为前端 StyleProfile */
function mapServerResult(data: ServerSimplifiedStyleResult): StyleProfile {
  // 句长：根据 average 落点映射到 short/medium/long
  const avgLen = data.sentenceLength?.average ?? 0;
  const sentenceLength: StyleProfile['sentenceLength'] =
    avgLen < 20 ? 'short' : avgLen < 40 ? 'medium' : 'long';

  // 人称
  const person = data.perspective?.person ?? '第三人称有限';
  const perspective: StyleProfile['perspective'] =
    person === '第一人称'
      ? 'first_person'
      : person === '第三人称全知'
        ? 'omniscient'
        : 'third_person';

  // 对话风格：以 naturalness 字段为主，avgLength 为辅
  const naturalness = (data.dialogueStyle?.naturalness || '').toLowerCase();
  const dialogueStyle: StyleProfile['dialogueStyle'] =
    naturalness.includes('正式') || naturalness.includes('formal')
      ? 'formal'
      : naturalness.includes('口语') || naturalness.includes('colloquial')
        ? 'colloquial'
        : 'natural';

  // 段落长度
  const pattern = data.paragraphLength?.pattern ?? 'mixed';
  const paragraphLength: StyleProfile['paragraphLength'] =
    pattern === 'short'
      ? 'short'
      : pattern === 'long'
        ? 'long'
        : 'medium';

  return {
    sentenceLength,
    wordFrequency: {},
    avoidedWords: [],
    perspective,
    dialogueStyle,
    paragraphLength,
  };
}

/** 本地启发式兜底（后端不可用时使用） */
function localHeuristic(chapters: string[]): StyleProfile {
  const combined = chapters.join('\n\n');
  const sentences = combined.split(/[。！？.!?]/).filter((s) => s.trim());
  const avgSentenceLength =
    sentences.reduce((sum, s) => sum + s.length, 0) / (sentences.length || 1);

  const paragraphs = combined.split('\n\n').filter((p) => p.trim());
  const avgParagraphLength =
    paragraphs.reduce((sum, p) => sum + p.length, 0) / (paragraphs.length || 1);

  return {
    sentenceLength:
      avgSentenceLength < 20 ? 'short' : avgSentenceLength < 40 ? 'medium' : 'long',
    wordFrequency: {},
    avoidedWords: [],
    perspective: 'third_person',
    dialogueStyle: 'natural',
    paragraphLength:
      avgParagraphLength < 100 ? 'short' : avgParagraphLength < 300 ? 'medium' : 'long',
  };
}

export const styleService = {
  /**
   * 分析已有章节的写作风格
   *
   * 调用后端 POST /ai/analyze-style (simple=true)，
   * 失败时回退本地启发式并标注 isLocalFallback=true。
   */
  async analyzeStyle(chapters: string[]): Promise<StyleAnalysisResult> {
    const combined = chapters.join('\n\n');
    if (!combined.trim()) {
      return { profile: localHeuristic(chapters), isLocalFallback: true };
    }

    try {
      // 动态导入避免循环依赖
      const { apiClient } = await import('../api/apiClient');
      const data = await apiClient.post<ServerSimplifiedStyleResult & { degraded?: boolean; reason?: string }>(
        '/ai/analyze-style',
        {
          referenceText: combined,
          simple: true,
        },
        { silent: true, timeoutMs: 60_000 },
      );
      // 后端返回降级结果（AI 不可用 / JSON 解析失败）→ 走本地启发式
      if (data?.degraded) {
        console.warn('[styleService] 后端返回降级结果，回退本地启发式。原因:', data.reason || '(未提供)');
        return { profile: localHeuristic(chapters), isLocalFallback: true };
      }
      return { profile: mapServerResult(data), isLocalFallback: false };
    } catch (e) {
      console.warn('[styleService] 后端风格分析失败，回退本地启发式:', e);
      return { profile: localHeuristic(chapters), isLocalFallback: true };
    }
  },

  /**
   * 基于风格档案改写文本
   * 将给定的文本按风格档案调整（实验性功能）
   *
   * prompt 模板由后端 chat-agent 按 phase='风格改写' 组装，
   * 前端只传文本与风格档案标签。
   */
  async rewriteInStyle(text: string, profile: StyleProfile): Promise<string> {
    // 动态导入 apiClient 避免循环依赖
    const { apiClient } = await import('../api/apiClient');

    if (!text.trim()) return text;

    try {
      const result = await apiClient.post<{ response: string }>(
        '/ai/chat',
        {
          simple: true,
          phase: '风格改写',
          text,
          styleProfile: {
            sentenceLength: sentenceLengthLabels[profile.sentenceLength],
            perspective: perspectiveLabels[profile.perspective],
            dialogueStyle: dialogueLabels[profile.dialogueStyle],
            paragraphLength: paragraphLabels[profile.paragraphLength],
          },
        },
        { silent: true, timeoutMs: 60_000 }
      );
      return result.response || text;
    } catch (e) {
      console.warn('[styleService] rewriteInStyle 失败:', e);
      return text; // 失败时返回原文
    }
  },
};
