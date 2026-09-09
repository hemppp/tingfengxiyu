import { useMemo, useEffect, useState } from 'react';
import { useChapterStore } from '@/stores';
import { Loader2 } from 'lucide-react';

function formatRelativeTime(ts: number | undefined | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 30_000) return '刚刚';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface StatusBarProps {
  /** 实时字数（编辑器输入即更新），null 表示未初始化，此时回退到 store 的 chapter.wordCount */
  liveWordCount?: number | null;
  /** 是否正在 AI 扫描时间线 */
  isScanning?: boolean;
}

export function StatusBar({ liveWordCount, isScanning }: StatusBarProps) {
  // 拆 selector：仅订阅必要字段
  const chapter = useChapterStore((s) =>
    s.currentChapterId ? s.chapters.find((c) => c.id === s.currentChapterId) ?? null : null,
  );

  const display = useMemo(() => {
    if (!chapter) return null;
    return {
      title: chapter.title,
      // liveWordCount 为 null（未初始化）时回退到 store 的 chapter.wordCount
      wordCount: liveWordCount != null ? liveWordCount : chapter.wordCount,
      status: chapter.status,
      updatedAt: chapter.updatedAt,
    };
  }, [chapter, liveWordCount]);

  // 1 分钟刷新一次「相对时间」
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!display) {
    return (
      <div
        className="h-7 nm-statusbar glass-frost flex items-center px-4 text-[11px] font-[Inter,sans-serif] tabular-nums fixed bottom-0 left-0 right-0 z-30"
        aria-label="写作状态"
      >
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>未选择章节</span>
      </div>
    );
  }

  const wordCount = display.wordCount || 0;
  const readMinutes = wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 300));

  return (
    <div
      className="h-7 nm-statusbar glass-frost flex items-center px-3 sm:px-4 text-[11px] font-[Inter,sans-serif] tabular-nums gap-2 sm:gap-3 fixed bottom-0 left-0 right-0 z-30"
      aria-label="写作状态"
    >
      <span className="font-[Noto_Serif_SC,serif] font-medium truncate max-w-[140px] sm:max-w-[260px]" style={{ color: 'hsl(var(--foreground))' }}>
        {display.title}
      </span>
      <span className="w-px h-3 shrink-0" style={{ background: 'hsl(var(--border) / 0.6)' }} />
      <span className="shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }}>{wordCount.toLocaleString()} 字</span>
      {wordCount > 0 && (
        <span className="nm-statusbar-secondary shrink-0">
          <span style={{ color: 'hsl(var(--ink-pale))' }}>·</span>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>约 {readMinutes} 分钟</span>
        </span>
      )}
      <span className="nm-statusbar-secondary shrink-0">
        <span style={{ color: 'hsl(var(--ink-pale))' }}>·</span>
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>
          {display.status === 'draft' ? '草稿' : display.status === 'final' ? '已完成' : display.status === 'revised' ? '已修订' : '已归档'}
        </span>
      </span>
      <div className="flex-1" />
      {isScanning && (
        <span className="nm-statusbar-secondary shrink-0">
          <span className="flex items-center gap-1" style={{ color: 'hsl(var(--primary))' }}>
            <Loader2 size={10} className="animate-spin" />
            <span>正在读取时间线...</span>
          </span>
          <span className="w-px h-3" style={{ background: 'hsl(var(--border) / 0.6)' }} />
        </span>
      )}
      <span className="shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }}>已自动保存 · {formatRelativeTime(display.updatedAt)}</span>
    </div>
  );
}
