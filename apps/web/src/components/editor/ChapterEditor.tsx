import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { EditorPage } from '@/components/editor/EditorPage';
import { useChapterStore } from '@/stores';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * 章节编辑器入口。
 *
 * 数据加载由 syncService（ProjectLayout 中调用）统一负责，
 * 本组件只负责设置当前章节 ID，避免双入口竞态导致旧项目数据残留。
 */
export function ChapterEditor() {
  const { chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const chapters = useChapterStore(s => s.chapters);
  const setCurrentChapter = useChapterStore(s => s.setCurrentChapter);
  const [isWaitingForData, setIsWaitingForData] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);

  useEffect(() => {
    if (!chapterId) return;

    // 如果章节数据已加载，直接设置当前章节
    if (chapters.length > 0) {
      setCurrentChapter(chapterId);
      setIsWaitingForData(false);
      setLoadTimeout(false);
      return;
    }

    // Store 为空：syncService 正在加载，等待数据到达
    setIsWaitingForData(true);
    setLoadTimeout(false);

    // 10 秒超时保护，防止 syncService 失败时永久 loading
    const timer = setTimeout(() => {
      setIsWaitingForData(false);
      setLoadTimeout(true);
    }, 10000);

    return () => clearTimeout(timer);
  }, [chapterId, chapters.length, setCurrentChapter]);

  // 加载中状态
  if (isWaitingForData) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: 'hsl(var(--bg))' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'hsl(var(--primary))' }} />
          <span style={{ fontSize: '13px', color: 'hsl(var(--mountain-deep))' }}>加载章节中...</span>
        </div>
      </div>
    );
  }

  // 加载超时状态
  if (loadTimeout && chapters.length === 0) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: 'hsl(var(--bg))' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', maxWidth: '400px', textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: 'hsl(var(--error-bg, #fef2f2))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <RefreshCw size={24} style={{ color: 'hsl(var(--error, #dc2626))' }} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'hsl(var(--ink))', marginBottom: '8px' }}>
              加载失败
            </h3>
            <p style={{ fontSize: '14px', color: 'hsl(var(--mountain-deep))', lineHeight: '1.5' }}>
              无法加载章节数据，可能是网络连接问题或后端服务未启动
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              backgroundColor: 'hsl(var(--primary))',
              color: 'white',
              fontSize: '14px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'opacity 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            onFocus={(e) => e.currentTarget.style.opacity = '0.9'}
            onBlur={(e) => e.currentTarget.style.opacity = '1'}
          >
            <RefreshCw size={14} />
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return <EditorPage />;
}
