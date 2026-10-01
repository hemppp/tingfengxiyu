/**
 * RealtimeRhythm - 实时节奏检测 Tiptap 扩展
 *
 * 监听编辑器内容变化，计算并报告文本节奏指标：
 * - 平均句长
 * - 段落数
 * - 短句 / 长句比例
 * - 场景切换频率
 *
 * 通过 Tiptap 的 appendTransaction / onUpdate 钩子更新。
 * 实际指标消费由外部面板（如 RhythmPanel）通过事件订阅获取。
 */
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

export interface RhythmMetrics {
  paragraphs: number;
  sentences: number;
  avgSentenceLength: number;
  shortSentenceRatio: number;  // < 12 字短句占比
  longSentenceRatio: number;   // > 40 字长句占比
  sceneBreaks: number;         // 场景切换标记数
  totalChars: number;
  updatedAt: number;
}

export type RhythmListener = (metrics: RhythmMetrics) => void;

const STORAGE_KEY = '__novelmuse_rhythm_listeners__';

function getListeners(): Set<RhythmListener> {
  if (typeof window === 'undefined') return new Set();
  const w = window as unknown as { [STORAGE_KEY]?: Set<RhythmListener> };
  if (!w[STORAGE_KEY]) w[STORAGE_KEY] = new Set();
  return w[STORAGE_KEY]!;
}

/** 订阅节奏更新 */
export function onRhythmUpdate(listener: RhythmListener): () => void {
  const ls = getListeners();
  ls.add(listener);
  return () => ls.delete(listener);
}

function computeMetrics(text: string): RhythmMetrics {
  // 段落（空行分割）
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

  // 句号、问号、感叹号、省略号切分
  const sentences = text
    .split(/[。！？!?…]+/g)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const totalSentences = sentences.length;
  const totalChars = text.replace(/\s/g, '').length;

  const lengths = sentences.map(s => s.length);
  const avgLen = totalSentences > 0
    ? lengths.reduce((a, b) => a + b, 0) / totalSentences
    : 0;
  const shortCount = lengths.filter(l => l > 0 && l < 12).length;
  const longCount = lengths.filter(l => l > 40).length;

  // 场景切换：识别"***"或"——"或"「"等标记
  const sceneBreaks = (text.match(/^\s*(\*\*\*+|——|◇+|●+|▲+)\s*$/gm) || []).length;

  return {
    paragraphs: Math.max(1, paragraphs),
    sentences: totalSentences,
    avgSentenceLength: Math.round(avgLen * 10) / 10,
    shortSentenceRatio: totalSentences > 0 ? shortCount / totalSentences : 0,
    longSentenceRatio: totalSentences > 0 ? longCount / totalSentences : 0,
    sceneBreaks,
    totalChars,
    updatedAt: Date.now(),
  };
}

function emit(metrics: RhythmMetrics) {
  getListeners().forEach(fn => {
    try { fn(metrics); } catch (e) { console.error('[Rhythm] listener error:', e); }
  });
}

export const RealtimeRhythm = Extension.create({
  name: 'realtimeRhythm',

  addOptions() {
    return {
      debounceMs: 600,
    };
  },

  addStorage() {
    return {
      lastMetrics: null as RhythmMetrics | null,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
  },

  onUpdate(this: { editor: Editor; storage: { lastMetrics: RhythmMetrics | null; timer: ReturnType<typeof setTimeout> | null }; options: { debounceMs: number } }) {
    const { editor, storage, options } = this;
    if (storage.timer) clearTimeout(storage.timer);
    storage.timer = setTimeout(() => {
      const text = editor.getText();
      const metrics = computeMetrics(text);
      storage.lastMetrics = metrics;
      emit(metrics);
    }, options.debounceMs);
  },
});

export default RealtimeRhythm;
