import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, X, BookOpen, Settings, ArrowDown, ArrowUp } from 'lucide-react';
import { safeConfirm } from '@/utils/safeConfirm';
import { AddBookModal } from '@/components/ui/AddBookModal';
import { BookCard } from '@/components/ui/BookCard';
import { useGlassRipple } from '@/hooks/useGlassRipple';
import type { Project } from '@novel/shared';
import { apiClient, ApiError } from '@/services/api/apiClient';
import { useAuthStore } from '@/stores/authStore';
import {
  useProjectStore,
  useChapterStore,
  useCharacterStore,
  useItemStore,
  useCreditStore,
  useLocationStore,
  useEventStore,
  useForeshadowStore,
  useEarmarkStore,
  useAnnotationStore,
  useOutlineStore,
  useTimelineStore,
  useNoteStore,
} from '@/stores';
import { dispatchToastEvent } from '@/utils/errors';

type SortBy = 'updatedAt' | 'createdAt' | 'name' | 'currentWordCount';
type SortOrder = 'asc' | 'desc';

interface Filter {
  search: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
}

const sortOptions = [
  { value: 'updatedAt', label: '最近更新' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'name', label: '名称' },
  { value: 'currentWordCount', label: '字数' },
];


function CalligraphyTitle() {
  return (
    <h1
      className="select-none"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'STKaiti', 'KaiTi', serif",
        fontSize: 'clamp(22px, 3.6vw, 38px)',
        fontWeight: 700,
        color: 'hsl(var(--foreground))',
        letterSpacing: '0.12em',
        lineHeight: 1,
      }}
    >
      <span className="opacity-90">Novel</span>
      <span style={{ color: 'hsl(var(--primary))' }}>Muse</span>
    </h1>
  );
}

/**
 * 单本书卡片的 memo 包装：把「per-book 的内联箭头函数」收口到此处，
 * 保证父组件重渲染（如 chapterCounts 更新、搜索/排序）时，props 引用稳定，
 * 从而让 BookCard 的 memo 真正生效，避免整列表无谓重渲染。
 */
const BookCardItem = memo(function BookCardItem({
  book,
  chapterCount,
  index,
  onOpen,
  onEdit,
  onDelete,
}: {
  book: Project;
  chapterCount: number;
  index: number;
  onOpen: (b: Project) => void;
  onEdit: (b: Project) => void;
  onDelete: (b: Project) => void;
}) {
  const handleClick = useCallback(() => onOpen(book), [book, onOpen]);
  const handleEdit = useCallback(() => onEdit(book), [book, onEdit]);
  const handleDelete = useCallback(() => onDelete(book), [book, onDelete]);
  return (
    <BookCard
      className="book-card-item"
      book={book}
      chapterCount={chapterCount}
      onClick={handleClick}
      onEdit={handleEdit}
      onDelete={handleDelete}
      index={index}
    />
  );
});


export function BookshelfPage() {
  const navigate = useNavigate();
  const handleSettingsPointerDown = useGlassRipple<HTMLButtonElement>();
  const logout = useAuthStore(s => s.logout);
  const setCurrentProject = useProjectStore(s => s.setProject);
  const [books, setBooks] = useState<Project[]>([]);
  const [chapterCounts, setChapterCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBook, setEditingBook] = useState<Project | null>(null);
  const [filter, setFilter] = useState<Filter>({
    search: '',
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      try {
        const projects = await apiClient.get<Project[]>('/projects');
        if (cancelled) return;
        setBooks(projects ?? []);
        const counts: Record<string, number> = {};
        await Promise.all(
          (projects ?? []).map(async (project) => {
            try {
              // 轻量计数接口：只返回章节数，不拉取章节正文（原实现会拉全量章节）
              const res = await apiClient.get<{ count: number }>(`/chapters/projects/${project.id}/count`);
              counts[project.id] = res?.count ?? 0;
            } catch { counts[project.id] = 0; }
          })
        );
        if (cancelled) return;
        setChapterCounts(counts);
      } catch (error) {
        console.error('Failed to load books', error);
        if (!cancelled) {
          dispatchToastEvent({ type: 'error', message: '书籍加载失败，请刷新重试' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadData();
    return () => { cancelled = true; };
  }, []);

  const filteredBooks = useMemo(() => {
    let result = [...books];
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      result = result.filter(
        (book) =>
          book.name.toLowerCase().includes(searchLower) ||
          book.penName?.toLowerCase().includes(searchLower) ||
          book.genre?.toLowerCase().includes(searchLower)
      );
    }
    result.sort((a, b) => {
      let comparison: number;
      switch (filter.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'currentWordCount':
          comparison = (a.currentWordCount || 0) - (b.currentWordCount || 0);
          break;
        default:
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return filter.sortOrder === 'desc' ? -comparison : comparison;
    });
    return result;
  }, [books, filter]);

  const handleSaveBook = useCallback(async (data: Partial<Project> & { title?: string; author?: string; cover?: string }) => {
    try {
      // AddBookModal 传出的字段名与 Project 不同，需映射
      const name = data.name || data.title || '';
      const penName = data.penName || data.author || '';
      const description = data.description || '';
      const coverImage = data.coverImage || data.cover || '';
      const targetWordCount = data.targetWordCount ?? undefined;
      // 流派：AI 写作向导选出来的展示名（如「系统流 · 末日求生」），手写模式为 undefined
      const genre = data.genre || undefined;
      // 开书设定：仅 AI 写作向导产出，服务端会把它注入每一章的讨论
      const brief = data.brief;
      // 创作模式：两套 UI 互斥，创建时定；编辑时允许切换（数据是同一份，只换工作台形态）
      const mode = data.mode;
      if (editingBook) {
        const result = await apiClient.put<Project>(`/projects/${editingBook.id}`, {
          name, penName, description, coverImage, targetWordCount, genre,
          ...(mode ? { mode } : {}),
          ...(brief ? { brief } : {}),
        });
        setBooks(prev => prev.map(b => b.id === editingBook.id ? (result ?? b) : b));
      } else {
        const result = await apiClient.post<Project>('/projects', {
          name,
          genre,
          description,
          penName,
          coverImage,
          currentWordCount: 0,
          targetWordCount,
          mode: mode ?? 'manual',
          ...(brief ? { brief } : {}),
        });
        if (result) {
          setBooks(prev => [...prev, result]);
          // ★ 新建后**直接进书**：向导刚填完开书设定，作者的下一步就是「立设定 / 开写」，
          //   停在书架还得再点一次卡片 —— 实测这是个明显的体验断点（2026-09-13 走查发现）。
          //   只在**新建**时跳；编辑既有书不跳（改完名字不想被带走）。
          setShowAddModal(false);
          setEditingBook(null);
          // ★ 必须**先设当前项目**再跳：路由只有 /project（index=ProjectIndexPage）与
          //   /project/:bookId/:chapterId 两种形状，`/project/<id>` 单段会落到 404
          //   （2026-09-13 GUI 走查实测踩到）。书卡点击也是这两步，保持一致。
          setCurrentProject(result);
          // ★ 带上 bookId 进 URL（2026-09-15）：项目身份不能只活在内存 store 里，
          //   否则刷新即丢、页面塌成空态。带 id 后由 ProjectLayout 的 URL→store 恢复逻辑接手。
          navigate(`/project/${result.id}`);
          return;
        }
      }
      setShowAddModal(false);
      setEditingBook(null);
    } catch (error) {
      console.error('Failed to save book', error);
      // ★ 创建/更新失败必须给用户可见反馈，避免「以为创建成功但列表没出现」的静默失败
      dispatchToastEvent({ type: 'error', message: editingBook ? '保存失败，请稍后重试' : '创建失败，请检查网络后重试' });
    }
  }, [editingBook]);

  const handleDeleteBook = useCallback(async (book: Project) => {
    const confirmed = await safeConfirm('\u786e\u5b9a\u8981\u5220\u9664\u300c' + book.name + '\u300d\u5417\uff1f\u6240\u6709\u7ae0\u8282\u6570\u636e\u5c06\u6c38\u4e45\u4e22\u5931\u3002');
    if (!confirmed) return;
    try {
      // silent: 404（项目已不存在）视为已达成删除目标，不弹 toast；
      // 其他真实错误在 catch 中手动提示
      await apiClient.delete(`/projects/${book.id}`, { silent: true });
      setBooks(prev => prev.filter(b => b.id !== book.id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // 项目后端已不存在，视为删除成功，从列表移除
        setBooks(prev => prev.filter(b => b.id !== book.id));
      } else {
        console.error('Failed to delete book', error);
        dispatchToastEvent({ type: 'error', message: '删除失败，请稍后重试' });
      }
    }
  }, []);

  const handleLogout = useCallback(async () => {
    const confirmed = await safeConfirm('确定要退出登录吗？');
    if (!confirmed) return;
    logout();
    navigate('/');
  }, [logout, navigate]);

  const handleEditBook = useCallback((book: Project) => {
    setEditingBook(book);
    setShowAddModal(true);
  }, []);

  // 点击书籍：先清空所有项目级 store，再设置新项目并导航
  // 防止旧项目数据残留（syncService 的清空在 ProjectLayout 挂载后才执行，子组件 effect 更早）
  const handleOpenBook = useCallback((book: Project) => {
    useChapterStore.setState({ chapters: [] });
    useCharacterStore.setState({ characters: [] });
    useItemStore.setState({ items: [] });
    useCreditStore.setState({ creditTransactions: [] });
    useLocationStore.setState({ locations: [] });
    useEventStore.setState({ events: [] });
    useForeshadowStore.setState({ foreshadows: [] });
    useEarmarkStore.setState({ earmarks: [] });
    useAnnotationStore.setState({ annotations: [] });
    useOutlineStore.setState({ nodes: [] });
    useTimelineStore.setState({ events: [] });
    useNoteStore.setState({ notes: [] });
    setCurrentProject(book);
    // ★ 同上：URL 带 bookId，刷新才能靠 ProjectLayout 的恢复逻辑救回当前书
    navigate(`/project/${book.id}`);
  }, [navigate, setCurrentProject]);
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* 液态玻璃环境背景由 App.tsx 全局挂载 */}

      {/* Main content layer */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Top bar — 液态玻璃工具栏 */}
        <header
          className="sticky top-0 z-20 mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-10 py-4"
        >
          <div className="flex items-center justify-between gap-4">
            {/* Left: Calligraphy title */}
            <CalligraphyTitle />

            {/* Right: Search + Actions */}
            <div className="flex items-center gap-2.5">
              {/* Search bar — 液态玻璃胶囊 */}
              <div
                className={`glass-surface flex items-center gap-2 rounded-full transition-all duration-300 ${
                  searchFocused ? 'ring-2 ring-primary/30' : 'glass-hover'
                }`}
                style={{ padding: '6px 6px 6px 16px' }}
              >
                <Search size={15} className="shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }} />
                <input
                  type="text"
                  placeholder="搜索作品..."
                  value={filter.search}
                  onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  className="bg-transparent border-none outline-none text-[13px] min-w-[120px] sm:min-w-[160px]"
                  style={{ color: 'hsl(var(--foreground))', fontFamily: "'Noto Serif SC', serif" }}
                  aria-label="搜索作品"
                />
                {filter.search && (
                  <button
                    onClick={() => setFilter(f => ({ ...f, search: '' }))}
                    className="flex items-center justify-center w-5 h-5 rounded-full transition-colors"
                    style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}
                    aria-label="清除搜索"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Settings button — 玻璃图标按钮 */}
              <button
                onClick={() => navigate('/settings')}
                onPointerDown={handleSettingsPointerDown}
                className="glass-surface glass-hover glass-ripple glass-pressable flex items-center justify-center w-9 h-9 rounded-full"
                style={{ color: 'hsl(var(--primary))' }}
                aria-label="设置"
              >
                <Settings size={16} strokeWidth={1.5} />
              </button>

              {/* New Book button */}
              <button
                className="nm-btn-apple-primary"
                style={{ width: 100, height: 34, padding: 0, fontSize: 13 }}
                onClick={() => setShowAddModal(true)}
              >
                <Plus size={14} strokeWidth={2.5} />
                新建
              </button>
            </div>
          </div>
        </header>

        {/* Main content area */}
        <main className="flex-1 mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-10 pb-12">
          {/* Sort & filter bar — 分段排序控件（替代原生 select） */}
          <div className="flex items-center justify-end gap-3 mb-6 mt-2">
            <div className="glass-surface flex items-center gap-1 px-1.5 py-1 rounded-full flex-wrap">
              {sortOptions.map(opt => {
                const active = filter.sortBy === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFilter(f => ({ ...f, sortBy: opt.value as SortBy }))}
                    aria-pressed={active}
                    className="px-2.5 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-[12px] font-medium transition-all duration-200"
                    style={{
                      color: active ? '#ffffff' : 'hsl(var(--muted-foreground))',
                      background: active ? 'hsl(var(--primary) / 0.92)' : 'transparent',
                      boxShadow: active ? '0 2px 10px hsl(var(--primary) / 0.35)' : 'none',
                      fontFamily: "'Noto Serif SC', serif",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
              <span className="w-px h-4 mx-0.5 shrink-0" style={{ background: 'hsl(var(--border))' }} aria-hidden="true" />
              <button
                type="button"
                onClick={() => setFilter(f => ({ ...f, sortOrder: f.sortOrder === 'asc' ? 'desc' : 'asc' }))}
                className="flex items-center justify-center w-7 h-7 rounded-full transition-all shrink-0"
                style={{ color: 'hsl(var(--primary))', background: 'hsl(var(--primary) / 0.1)' }}
                aria-label={filter.sortOrder === 'desc' ? '当前降序，点击切换为升序' : '当前升序，点击切换为降序'}
                title={filter.sortOrder === 'desc' ? '降序' : '升序'}
              >
                {filter.sortOrder === 'desc'
                  ? <ArrowDown size={14} strokeWidth={2.2} />
                  : <ArrowUp size={14} strokeWidth={2.2} />}
              </button>
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-32">
              <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: 'hsl(var(--primary) / 0.15)', borderTopColor: 'hsl(var(--primary))' }} />
              <p className="mt-4 text-[14px]" style={{ color: 'hsl(var(--muted-foreground))', fontFamily: "'Noto Serif SC', serif" }}>墨香渐浓...</p>
            </div>
          )}

          {/* Empty state */}
          {!loading && filteredBooks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="mb-6 glass-surface w-20 h-20 rounded-full flex items-center justify-center" style={{ color: 'hsl(var(--muted-foreground))' }}>
                <BookOpen size={40} strokeWidth={1} />
              </div>
              <h2 className="text-[22px] font-semibold mb-3" style={{
                color: 'hsl(var(--foreground))',
                fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
                letterSpacing: '0.05em',
              }}>
                {filter.search ? '未得此卷' : '开卷以待'}
              </h2>
              <p className="text-[14px] mb-8" style={{ color: 'hsl(var(--muted-foreground))', fontFamily: "'Noto Serif SC', serif" }}>
                {filter.search ? '试以他词寻之' : '点击下方按钮，启笔新篇'}
              </p>
              {!filter.search && (
                <button
                  className="nm-btn-apple-primary"
                  style={{ width: 160, height: 48, padding: 0, fontSize: 15 }}
                  onClick={() => setShowAddModal(true)}
                >
                  <Plus size={18} strokeWidth={2.5} />
                  新建作品
                </button>
              )}
            </div>
          )}

          {/* Book grid */}
          {!loading && filteredBooks.length > 0 && (
            <div className="nm-book-grid">
              {filteredBooks.map((book, i) => (
                <BookCardItem
                  key={book.id}
                  book={book}
                  chapterCount={chapterCounts[book.id] || 0}
                  onOpen={handleOpenBook}
                  onEdit={handleEditBook}
                  onDelete={handleDeleteBook}
                  index={i}
                />
              ))}
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-10 pb-6">
          <div className="flex items-center justify-between text-[11px] border-t pt-4" style={{
            borderColor: 'hsl(var(--border) / 0.4)',
            color: 'hsl(var(--muted-foreground))',
            fontFamily: "'Noto Serif SC', serif",
          }}>
            <span>听风细雨 · 墨香书阁</span>
            <button
              onClick={handleLogout}
              className="transition-colors hover:opacity-70"
              style={{ color: 'inherit' }}
            >
              退出登录
            </button>
          </div>
        </footer>
      </div>

      {/* Add/Edit modal */}
      <AddBookModal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setEditingBook(null); }}
        onSubmit={handleSaveBook}
        editBook={editingBook}
      />

      {/* Inline styles */}
      <style>{`
        .nm-book-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 18px;
        }
        @media (max-width: 1280px) {
          .nm-book-grid { grid-template-columns: repeat(4, 1fr); gap: 16px; }
        }
        @media (max-width: 1024px) {
          .nm-book-grid { grid-template-columns: repeat(3, 1fr); gap: 16px; }
        }
        @media (max-width: 640px) {
          .nm-book-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
        }
        main::-webkit-scrollbar { width: 6px; }
        main::-webkit-scrollbar-track { background: transparent; }
        main::-webkit-scrollbar-thumb {
          background: hsl(var(--primary) / 0.15);
          border-radius: 3px;
        }
        main::-webkit-scrollbar-thumb:hover { background: hsl(var(--primary) / 0.25); }
      `}</style>
    </div>
  );
}
