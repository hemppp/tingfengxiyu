import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EditorPage } from '@/components/editor/EditorPage';
import { useChapterStore } from '@/stores';
import { PATHS } from '@/routes/paths';
import { pickFallbackChapterId } from '@/utils/chapter';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * 章节编辑器入口。
 *
 * 数据加载由 syncService（ProjectLayout 中调用）统一负责，
 * 本组件只负责设置当前章节 ID，避免双入口竞态导致旧项目数据残留。
 *
 * ★ URL 的 chapterId 只是**进入时的初始值**：左侧章节树切章时只改 store、不改 URL
 *   （见 LeftSidebar 的 handleSelectChapter），所以本组件不能持续把 store 当作 URL 的镜像
 *   去校正 —— 只在"数据就绪但该 id 查无此章"时纠正一次，之后完全交还给 store。
 */
export function ChapterEditor() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const navigate = useNavigate();
  const chapters = useChapterStore(s => s.chapters);
  const setCurrentChapter = useChapterStore(s => s.setCurrentChapter);
  const [isWaitingForData, setIsWaitingForData] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);
  // 失效 URL 只纠正一次。之后用户怎么切章（只改 store）都不再被本 effect 干涉。
  const handledInvalidRef = useRef(false);

  useEffect(() => {
    if (!chapterId) return;

    if (chapters.length > 0) {
      const exists = chapters.some((ch) => ch.id === chapterId);

      if (exists) {
        setCurrentChapter(chapterId);
        setIsWaitingForData(false);
        setLoadTimeout(false);
        return;
      }

      // ★ 数据已就绪却查无此章：URL 里的 chapterId 是失效的（手输/改错的链接、
      //   陈旧书签、分享后章节被删）。此前会不校验直接 setCurrentChapter(坏 id)，
      //   把编辑器挂在一个 store 里不存在的"幽灵章节"上 —— 界面停在空状态，
      //   而 flushToBackend 仍按该 id 发 PUT /api/chapters/<乱码>，
      //   配合 silent:true 就是一连串用户完全无感的 400。
      //   处理：纠正 URL 到真实存在的章节（一章都没有则回项目首页），使路由与 store 一致。
      //   落到**最近编辑过**的那章而非 chapters[0]：失效链接的用户期待「接着上次写」，
      //   口径与 EditorPage 的「打开最近章节」按钮共用 pickFallbackChapterId。
      if (handledInvalidRef.current) return;
      handledInvalidRef.current = true;

      const fallback = pickFallbackChapterId(chapters);
      navigate(
        fallback ? `${PATHS.project}/${bookId}/${fallback}` : `${PATHS.project}/${bookId}`,
        { replace: true },
      );
      setCurrentChapter(fallback);
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
  }, [bookId, chapterId, chapters, setCurrentChapter, navigate]);

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
            backgroundColor: 'hsl(var(--error-bg, 0 0% 95%))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <RefreshCw size={24} style={{ color: 'hsl(var(--error, 0 0% 35%))' }} />
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
              borderRadius: 'var(--r-2xs)',
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
