import { useEffect, useRef } from 'react';
import { useChapterStore } from '@/stores';
import { styleService } from '@/services/editor/styleService';
import type { StyleProfile } from '@/services/editor/styleService';

interface StyleSuggestion {
  type: 'sentence_length' | 'paragraph' | 'dialogue' | 'perspective';
  message: string;
  original: string;
  suggestion: string;
}

export function analyzeLocalStyle(text: string, profile: StyleProfile | null): StyleSuggestion | null {
  if (!text || text.length < 10 || !profile) return null;

  const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 0);
  const avgSentenceLen = sentences.reduce((sum, s) => sum + s.length, 0) / (sentences.length || 1);

  if (profile.sentenceLength === 'long' && avgSentenceLen < 15) {
    return { type: 'sentence_length', message: '句子偏长，不符合"细腻绵长"的风格', original: text.slice(0, 30) + '...', suggestion: '尝试增加细节描写和修饰语' };
  }
  if (profile.sentenceLength === 'short' && avgSentenceLen > 40) {
    return { type: 'sentence_length', message: '句子偏长，不符合"简洁明快"的风格', original: text.slice(0, 30) + '...', suggestion: '尝试拆分长句，使用更直接的表达' };
  }

  const dialogueCount = (text.match(/[""''『』「」]/g) || []).length;
  if (profile.dialogueStyle === 'formal' && dialogueCount > 2) {
    return { type: 'dialogue', message: '对话过多，不够正式', original: text.slice(0, 30) + '...', suggestion: '减少直接引用的对话，使用叙述代替' };
  }

  const paragraphs = text.split(/\n\n/).filter(p => p.trim());
  const avgParaLen = paragraphs.reduce((sum, p) => sum + p.length, 0) / (paragraphs.length || 1);
  if (profile.paragraphLength === 'short' && avgParaLen > 200) {
    return { type: 'paragraph', message: '段落偏长，不符合"短段落"风格', original: text.slice(0, 30) + '...', suggestion: '在适当位置添加空行，拆分为短段落' };
  }
  if (profile.paragraphLength === 'long' && avgParaLen < 50 && paragraphs.length > 3) {
    return { type: 'paragraph', message: '段落偏短，不够舒展', original: text.slice(0, 30) + '...', suggestion: '合并短段落，延长每个段落的展开' };
  }

  return null;
}

function contentSignature(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

const MIN_CHANGE_CHARS = 200;

export function StyleAdvisor() {
  const chapters = useChapterStore(s => s.chapters);
  const lastSigRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (chapters.length < 1) return;

    const texts = chapters.slice(0, 5).map(ch => ch.content);
    const combined = texts.join('\n\n');
    if (combined.trim().length < 100) return;

    const sig = contentSignature(combined);
    const prevSig = lastSigRef.current;
    if (prevSig !== 0 && Math.abs(sig - prevSig) < MIN_CHANGE_CHARS) {
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    timerRef.current = setTimeout(() => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      const controller = new AbortController();
      abortRef.current = controller;

      styleService.analyzeStyle(texts).then(({ profile, isLocalFallback }) => {
        if (!controller.signal.aborted && !isLocalFallback) {
          lastSigRef.current = sig;
          void profile;
        }
      }).catch((err) => {
        if (!controller.signal.aborted) {
          console.warn('[StyleAdvisor] 风格分析失败:', err);
        }
      });
    }, 3000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [chapters]);

  return null;
}
