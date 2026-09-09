/**
 * 节奏校准服务
 *
 * analyzeRhythm 调用后端 POST /ai/analyze-rhythm（rhythm-agent.runRhythmAnalysis），
 * 由 LLM 真实识别呼吸点 / 停顿 / 情绪低谷 / 情绪高涨。
 * 后端不可用时回退本地启发式，并在返回结果中标注 isLocalFallback=true。
 */

export interface RhythmMark {
  type: 'breath' | 'pause' | 'dip' | 'surge';
  position: number;    // 字符偏移
  label: string;       // 提示文字
  intensity: number;   // 0-1 强度
}

/** 带兜底标志的分析结果 */
export interface RhythmAnalysisResult {
  marks: RhythmMark[];
  /** 整体节奏概览（来自后端 summary 或本地 summarizeRhythm 推导） */
  summary: string;
  /** true 表示后端 AI 不可用，marks 为本地启发式兜底结果 */
  isLocalFallback: boolean;
}

/** 后端 rhythm-agent 返回结构（与 ServerRhythmResult 对齐） */
interface ServerRhythmResult {
  marks: RhythmMark[];
  summary: string;
}

/**
 * 本地启发式兜底（后端不可用时使用）
 * 保留原有规则逻辑，仅做纯文本分析。
 */
function localHeuristic(text: string): RhythmMark[] {
  const marks: RhythmMark[] = [];
  const plain = text.replace(/<[^>]*>/g, ''); // 去 HTML

  for (let i = 0; i < plain.length; i++) {
    const char = plain[i] ?? '';

    // 呼吸点：长句结束（句号、问号、感叹号后）
    if ('。！？'.includes(char)) {
      const prevSentence = plain.slice(Math.max(0, i - 100), i);
      const sentenceLen = (prevSentence.split(/[。！？]/).pop()?.length ?? 0) || 0;

      if (sentenceLen > 40) {
        marks.push({
          type: 'breath',
          position: i,
          label: '长句后，可换气',
          intensity: Math.min(1, sentenceLen / 80),
        });
      }
    }

    // 停顿：省略号、破折号、逗号密集区
    if ('…—'.includes(char) || (char === '、' && i > 0 && plain[i - 1] === '、')) {
      marks.push({
        type: 'pause',
        position: i,
        label: char === '…' ? '留白停顿' : char === '—' ? '转折停顿' : '密集逗号，考虑重组',
        intensity: char === '…' ? 0.8 : 0.5,
      });
    }

    // 情绪低谷：否定词、消极词
    const window = plain.slice(i, i + 4);
    const dipWords = ['绝望', '崩溃', '无助', '孤独', '黑暗', '死亡', '失败', '放弃', '痛苦', '悲伤', '寂寞', '空虚'];
    if (dipWords.some((w) => window.startsWith(w))) {
      marks.push({
        type: 'dip',
        position: i,
        label: `情绪低谷：${window.slice(0, 2)}`,
        intensity: 0.7,
      });
    }

    // 情绪高涨：积极词、激烈词
    const surgeWords = ['希望', '胜利', '狂喜', '燃烧', '爆发', '突破', '觉醒', '重生', '拯救', '守护'];
    if (surgeWords.some((w) => window.startsWith(w))) {
      marks.push({
        type: 'surge',
        position: i,
        label: `情绪高涨：${window.slice(0, 2)}`,
        intensity: 0.7,
      });
    }
  }

  return marks;
}

export const rhythmService = {
  /**
   * 分析章节内容的节奏标记
   *
   * 调用后端 POST /ai/analyze-rhythm，失败时回退本地启发式并标注 isLocalFallback=true。
   */
  async analyzeRhythm(text: string, chapterTitle?: string): Promise<RhythmAnalysisResult> {
    const plain = text.replace(/<[^>]*>/g, '');
    if (!plain.trim()) {
      return { marks: [], summary: '章节内容为空', isLocalFallback: true };
    }

    try {
      const { apiClient } = await import('../api/apiClient');
      const data = await apiClient.post<ServerRhythmResult>(
        '/ai/analyze-rhythm',
        { text: plain, chapterTitle },
        { silent: true, timeoutMs: 60_000 },
      );
      return {
        marks: data.marks ?? [],
        summary: data.summary || summarizeRhythm(data.marks ?? []),
        isLocalFallback: false,
      };
    } catch (e) {
      console.warn('[rhythmService] 后端节奏分析失败，回退本地启发式:', e);
      const marks = localHeuristic(text);
      return {
        marks,
        summary: summarizeRhythm(marks),
        isLocalFallback: true,
      };
    }
  },
};

/**
 * 生成节奏概览文本（兜底场景使用，或与后端 summary 合并展示）
 */
export function summarizeRhythm(marks: RhythmMark[]): string {
  const breaths = marks.filter((m) => m.type === 'breath').length;
  const pauses = marks.filter((m) => m.type === 'pause').length;
  const dips = marks.filter((m) => m.type === 'dip').length;
  const surges = marks.filter((m) => m.type === 'surge').length;

  const parts: string[] = [];
  if (breaths > 3) parts.push(`长句较多（${breaths}处呼吸点），注意断句`);
  if (pauses > 5) parts.push(`停顿密集（${pauses}处），节奏偏碎`);
  if (dips > surges + 2) parts.push('情绪持续走低，考虑插入希望');
  if (surges > dips + 2) parts.push('情绪持续高涨，需要低谷衬托');
  if (dips === 0 && surges === 0) parts.push('情绪平稳，缺少波动');

  return parts.length > 0 ? parts.join('；') : '节奏良好';
}
