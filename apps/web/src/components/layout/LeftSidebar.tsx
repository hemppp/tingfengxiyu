import { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { Plus, Pencil, X, Check, Trash2, FileText } from 'lucide-react';
import { useChapterStore, useProjectStore, cascadeCleanChapterClient } from '@/stores';
import { saveChapter, updateChapter as updateChapterInDb } from '@/services/data/databaseService';
import { useGSAP, chapterListEnter } from '@/utils/gsap';
import { nanoid } from 'nanoid';
import { safeConfirm } from '@/utils/safeConfirm';
import { TrashDialog } from './TrashDialog';

// ★ memo + 拆分 wordCount 为独立 prop + 稳定 handler：
// 之前 `onClick={() => setCurrentChapter(chapter.id)}` 等内联箭头函数每次渲染都产生新引用，
// 导致 memo 浅比较失效，所有章节项每次都重渲染。
// 现在传入稳定的 useCallback handler（通过 chapterId 参数区分），真正实现"用户在 A 章打字时，B/C/D 章跳过渲染"。
const ChapterListItem = memo(function ChapterListItem({
  chapter,
  wordCount,
  isActive,
  onSelectChapter,
  onEditChapter,
  onDeleteChapter,
  editing,
  editTitle,
  onEditTitleChange,
  onSaveEdit,
  onCancelEdit,
  index = 0,
}: {
  chapter: { id: string; order: number; title: string; status: string };
  wordCount: number;
  isActive: boolean;
  // ★ 稳定 handler：接收 chapterId 参数，避免内联箭头函数导致 memo 失效
  onSelectChapter: (chapterId: string) => void;
  onEditChapter: (chapterId: string, title: string) => void;
  onDeleteChapter: (chapterId: string, e: React.MouseEvent) => void;
  editing: boolean;
  editTitle: string;
  onEditTitleChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  index?: number;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const statusDots = {
    draft: 'rgba(150,150,160,0.9)',
    revised: 'rgba(255,180,90,0.95)',
    final: 'rgba(90,200,150,0.95)',
    archived: 'rgba(120,120,130,0.7)',
  } as const;

  const statusDot = statusDots[chapter.status as keyof typeof statusDots] ?? statusDots.draft;
  const gradientHue = (chapter.order * 37) % 360;

  return (
    <div
      onClick={() => onSelectChapter(chapter.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={() => onEditChapter(chapter.id, chapter.title)}
      className="sidebar-chapter-item"
      style={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 28,
        position: 'relative',
        background: isActive
          ? 'hsl(var(--mountain-cyan) / 0.14)'
          : isHovered
          ? 'rgb(var(--glass-tint) / 0.55)'
          : 'rgb(var(--glass-tint) / 0.28)',
        border: isActive
          ? '0.5px solid hsl(var(--mountain-cyan) / 0.45)'
          : '0.5px solid hsl(var(--border) / 0.35)',
        boxShadow: isActive
          ? 'inset 0 1px 0 rgb(var(--glass-highlight) / 0.4), 0 4px 14px hsl(var(--glass-shadow) / 0.18)'
          : isHovered
          ? 'inset 0 1px 0 rgb(var(--glass-highlight) / 0.3), 0 3px 10px hsl(var(--glass-shadow) / 0.12)'
          : 'inset 0 1px 0 rgb(var(--glass-highlight) / 0.2)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        animation: `slideTop 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.04}s both`,
      }}
    >
      {/* 序号徽章 — 圆弧UI */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          flexShrink: 0,
          marginRight: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "'Inter', sans-serif",
          color: 'hsl(var(--foreground) / 0.95)',
          background: `linear-gradient(135deg, hsl(${gradientHue} 55% 70% / 0.9), hsl(${(gradientHue + 40) % 360} 50% 60% / 0.9))`,
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 2px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.15)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          position: 'relative',
        }}
      >
        {chapter.order}
      </div>

      {/* 标题 + 字数 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {editing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={onSaveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            style={{
              width: '100%',
              padding: '3px 6px',
              fontSize: 13,
              borderRadius: 14,
              outline: 'none',
              border: '0.5px solid hsl(var(--mountain-cyan) / 0.5)',
              background: 'rgb(var(--glass-tint) / 0.6)',
              color: 'hsl(var(--foreground))',
              fontFamily: "'Noto Serif SC', serif",
            }}
          />
        ) : (
          <>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "'Noto Serif SC', serif",
                color: isActive ? 'hsl(var(--foreground))' : 'hsl(var(--foreground) / 0.88)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.3,
              }}
            >
              {chapter.title}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10.5,
                color: 'hsl(var(--ink-pale))',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: statusDot,
                  boxShadow: `0 0 6px ${statusDot}80`,
                }}
              />
              <span>{wordCount > 0 ? `${wordCount.toLocaleString()} 字` : '未开始'}</span>
            </div>
          </>
        )}
      </div>

      {/* 操作按钮 - 右侧 */}
      {!editing && (
        <div
          style={{
            display: 'flex',
            gap: 2,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.2s ease',
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onEditChapter(chapter.id, chapter.title); }}
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgb(var(--glass-tint) / 0.5)',
              color: 'hsl(var(--foreground) / 0.8)',
              border: '0.5px solid hsl(var(--border) / 0.4)',
              cursor: 'pointer',
            }}
            title="重命名"
          >
            <Pencil size={10} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onDeleteChapter(chapter.id, e)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgb(var(--glass-tint) / 0.5)',
              color: 'hsl(var(--foreground) / 0.8)',
              border: '0.5px solid hsl(var(--border) / 0.4)',
              cursor: 'pointer',
            }}
            title="删除"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  );
});

export function LeftSidebar() {
  // 拆 selector：精确订阅，避免无关字段变化触发 re-render
  const chapters = useChapterStore((s) => s.chapters);
  const currentChapterId = useChapterStore((s) => s.currentChapterId);
  const liveWordCount = useChapterStore((s) => s.liveWordCount);
  const setCurrentChapter = useChapterStore((s) => s.setCurrentChapter);
  const addChapter = useChapterStore((s) => s.addChapter);
  const updateChapter = useChapterStore((s) => s.updateChapter);
  const deleteChapter = useChapterStore((s) => s.deleteChapter);
  const currentProject = useProjectStore((s) => s.currentProject);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // 创建章节的弹层
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newVolume, setNewVolume] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);
  // 回收站弹窗
  const [trashVisible, setTrashVisible] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    // ★ scope 未挂载或无章节时跳过，避免 "Invalid scope" / "GSAP target not found" 警告
    if (!sidebarRef.current) return;
    const items = sidebarRef.current.querySelectorAll('.sidebar-chapter-item');
    if (items.length === 0) return;
    chapterListEnter('.sidebar-chapter-item');
  }, { scope: sidebarRef, dependencies: [chapters.length] });

  // 按 order 排序章节
  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order),
    [chapters],
  );

  // 卷-章 分组
  const volumeGroups = useMemo(() => {
    const map = new Map<string, typeof sortedChapters>();
    for (const ch of sortedChapters) {
      const v = ch.label?.trim() || '未分卷';
      const arr = map.get(v) ?? [];
      arr.push(ch);
      map.set(v, arr);
    }
    return Array.from(map.entries());
  }, [sortedChapters]);

  // ★ 稳定的章节选择 handler（useCallback 保证引用稳定，配合 ChapterListItem 的 memo）
  const handleSelectChapter = useCallback((id: string) => {
    setCurrentChapter(id);
  }, [setCurrentChapter]);

  // ★ 稳定的取消编辑 handler
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle('');
  }, []);

  // 双击编辑标题
  const handleDoubleClick = useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  }, []);

  // 保存编辑（章节标题）
  // ★ Bug 修复：之前用 content: '' / wordCount: 0 / status: 'draft' 等默认值调用 saveChapter，
  //   会把已有内容清空。这里改用「先读后写」，只更新 title / updatedAt，其它字段原样保留。
  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editTitle.trim();
    const existing = chapters.find((c) => c.id === editingId);
    if (!existing) {
      setEditingId(null);
      setEditTitle('');
      return;
    }
    if (!trimmed) {
      // 标题为空 → 视作取消
      setEditingId(null);
      setEditTitle('');
      return;
    }
    const updated = { ...existing, title: trimmed, updatedAt: Date.now() };
    updateChapter(editingId, { title: trimmed, updatedAt: updated.updatedAt });
    try {
      await updateChapterInDb(editingId, { title: trimmed, updatedAt: updated.updatedAt });
    } catch (e) {
      console.warn('保存章节标题失败:', e);
    }
    setEditingId(null);
    setEditTitle('');
  }, [editingId, editTitle, chapters, updateChapter]);

  // 按 Escape 取消编辑
  useEffect(() => {
    if (!editingId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingId(null);
        setEditTitle('');
      } else if (e.key === 'Enter') {
        handleSaveEdit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingId, handleSaveEdit]);

  // 创建章节
  const handleCreate = useCallback(async () => {
    if (!currentProject) return;
    const title = newTitle.trim();
    if (!title) return;
    setCreatingBusy(true);
    try {
      // ★ 按 当前项目 的章节数计算 order，避免跨项目导致编号不连续
      const newOrder = chapters.filter(c => c.projectId === currentProject.id).length + 1;
      const id = nanoid();
      const now = new Date();
      const chapter = {
        id,
        projectId: currentProject.id,
        title,
        content: '',
        order: newOrder,
        wordCount: 0,
        status: 'draft' as const,
        label: newVolume.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      // 写入 DB
      await saveChapter(chapter as never);
      addChapter({
        id,
        projectId: currentProject.id,
        title,
        content: '',
        order: newOrder,
        wordCount: 0,
        summary: undefined,
        status: 'draft',
        label: newVolume.trim() || undefined,
        pov: undefined,
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      } as never);
      // 自动选中新章节
      setCurrentChapter(id);
      setNewTitle('');
      setNewVolume('');
      setCreating(false);
    } catch (e) {
      console.error('创建章节失败:', e);
    } finally {
      setCreatingBusy(false);
    }
  }, [currentProject, newTitle, newVolume, chapters.length, addChapter, setCurrentChapter]);

  // 删除章节（软删除 → 移入回收站）
  // 仅更新 store，由 syncService 自动同步到后端（DELETE /chapters/:id 软删除）
  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!safeConfirm('将此章节移入回收站？可随时从回收站还原。')) return;
      // 先获取被删章节的 order，联动清理前端各 store 的关联数据
      const chapter = chapters.find((c) => c.id === id);
      if (chapter) {
        cascadeCleanChapterClient(chapter.order);
      }
      deleteChapter(id);
    },
    [deleteChapter, chapters],
  );

  if (!currentProject) {
    return null;
  }

  return (
    <div
      ref={sidebarRef}
      className="h-full flex flex-col font-[Inter,sans-serif]"
      aria-label="章节侧边栏"
    >
      {/* 章节列表（卷分组） */}
      <div className="flex-1 overflow-y-auto py-3 mc-scrollbar">
        {sortedChapters.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <FileText size={20} className="mx-auto mb-2" style={{ color: 'hsl(var(--ink-pale))' }} />
            <p className="text-[12px]" style={{ color: 'hsl(var(--ink-pale))' }}>
              暂无章节 · 在下方创建第一章
            </p>
          </div>
        ) : (
          <div className="px-3 space-y-4">
            {volumeGroups.map(([volume, volChapters]) => {
              return (
                <div key={volume} className="space-y-1.5">
                  {/* 卷标题 */}
                  {volumeGroups.length > 1 && (
                    <div
                      className="text-[10px] font-semibold tracking-wide px-1"
                      style={{ color: 'hsl(var(--ink-pale))' }}
                    >
                      {volume}
                    </div>
                  )}
                  {/* 章节列表 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {volChapters.map((chapter, chapIdx) => {
                      const isActive = currentChapterId === chapter.id;
                      const wc = liveWordCount?.chapterId === chapter.id
                        ? liveWordCount.wordCount
                        : chapter.wordCount;
                      return (
                        <ChapterListItem
                          key={chapter.id}
                          chapter={chapter}
                          wordCount={wc}
                          isActive={isActive}
                          // ★ 传入稳定的 useCallback handler，避免内联箭头函数导致 memo 失效
                          onSelectChapter={handleSelectChapter}
                          onEditChapter={handleDoubleClick}
                          onDeleteChapter={handleDelete}
                          editing={editingId === chapter.id}
                          editTitle={editTitle}
                          onEditTitleChange={setEditTitle}
                          onSaveEdit={handleSaveEdit}
                          onCancelEdit={handleCancelEdit}
                          index={chapIdx}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部 — 新建章节 + 回收站 */}
      <div className="px-3 py-2 border-t" style={{ borderColor: 'hsl(var(--border) / 0.5)' }}>
        {!creating ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setCreating(true);
                setNewVolume(volumeGroups[0]?.[0] ?? '');
              }}
              className="nm-btn-apple nm-btn-apple-secondary flex-1 justify-center text-[12px] py-2"
            >
              <Plus size={13} />
              <span>新建章节</span>
            </button>
            <button
              onClick={() => setTrashVisible(true)}
              className="nm-btn-apple-icon-sm shrink-0"
              aria-label="回收站"
              title="回收站"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <div className="space-y-2 animate-slide-up">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="章节名"
              autoFocus
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md outline-none transition-colors"
              style={{
                color: 'hsl(var(--foreground))',
                background: 'rgb(var(--glass-tint) / 0.45)',
                border: '0.5px solid hsl(var(--border) / 0.6)',
                backdropFilter: 'blur(10px) saturate(150%)',
                WebkitBackdropFilter: 'blur(10px) saturate(150%)',
                boxShadow: 'inset 0 1px 0 rgb(var(--glass-highlight) / 0.35)',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewTitle('');
                  setNewVolume('');
                }
              }}
            />
            <input
              type="text"
              value={newVolume}
              onChange={(e) => setNewVolume(e.target.value)}
              placeholder="卷名（可选）"
              list="volume-suggestions"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md outline-none transition-colors"
              style={{
                color: 'hsl(var(--foreground))',
                background: 'rgb(var(--glass-tint) / 0.45)',
                border: '0.5px solid hsl(var(--border) / 0.6)',
                backdropFilter: 'blur(10px) saturate(150%)',
                WebkitBackdropFilter: 'blur(10px) saturate(150%)',
                boxShadow: 'inset 0 1px 0 rgb(var(--glass-highlight) / 0.35)',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewTitle('');
                  setNewVolume('');
                }
              }}
            />
            <datalist id="volume-suggestions">
              {volumeGroups.map(([v]) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCreate}
                disabled={creatingBusy || !newTitle.trim()}
                className="flex-1 nm-btn-apple nm-btn-apple-primary text-[12px] py-1.5"
              >
                <Check size={11} />
                <span>创建</span>
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewTitle('');
                  setNewVolume('');
                }}
                className="nm-btn-apple-icon-sm"
                aria-label="取消新建"
                title="取消"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 回收站弹窗 */}
      <TrashDialog visible={trashVisible} onClose={() => setTrashVisible(false)} />
    </div>
  );
}
