import { useState, useMemo, useEffect, useCallback } from 'react';
import { useChapterStore } from '@/stores';
import { loadSnapshots, saveSnapshot, deleteSnapshot as deleteSnapshotInDb } from '@/services/data/databaseService';
import { nanoid } from 'nanoid';
import DOMPurify from 'dompurify';
import { Camera, RotateCcw, Trash2, GitCompare, Clock, RefreshCw } from 'lucide-react';
import { safeConfirm } from '@/utils/safeConfirm';
import type { Snapshot } from '@novel/shared';

/**
 * 快照管理 — 手动/自动快照、预览、对比、恢复
 * 持久化到后端 SQLite，按 chapterId 加载。
 */
export function SnapshotManager() {
  const chapters = useChapterStore((s) => s.chapters);
  const currentChapterId = useChapterStore((s) => s.currentChapterId);
  const updateChapter = useChapterStore((s) => s.updateChapter);
  const currentChapter = chapters.find((ch) => ch.id === currentChapterId);

  // 持久化快照（从后端加载）
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 加载当前章节的所有快照
  const reload = useCallback(async () => {
    if (!currentChapterId) {
      setSnapshots([]);
      return;
    }
    setLoading(true);
    try {
      const list = await loadSnapshots(currentChapterId);
      list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setSnapshots(list);
    } catch (e) {
      console.warn('[SnapshotManager] 加载快照失败:', e);
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [currentChapterId]);

  useEffect(() => {
    setSelectedSnapshot(null);
    setCompareMode(false);
    reload();
  }, [currentChapterId, reload]);

  const chapterSnapshots = useMemo(() => snapshots, [snapshots]);

  const handleCreateSnapshot = useCallback(async () => {
    if (!currentChapter || !currentChapterId) return;
    setBusy(true);
    try {
      const snapshot: Snapshot = {
        id: nanoid(),
        chapterId: currentChapterId,
        content: currentChapter.content,
        wordCount: currentChapter.wordCount,
        label: `手动快照 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        auto: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveSnapshot(snapshot);
      setSnapshots((prev) => [snapshot, ...prev]);
    } catch (e) {
      console.warn('[SnapshotManager] 创建快照失败:', e);
    } finally {
      setBusy(false);
    }
  }, [currentChapter, currentChapterId]);

  const handleRestore = useCallback(async (snapshotId: string) => {
    const snapshot = snapshots.find((s) => s.id === snapshotId);
    if (!snapshot || !currentChapterId) return;
    if (!safeConfirm('恢复此快照？当前内容将被覆盖（会自动创建一个恢复前快照）。')) return;
    setBusy(true);
    try {
      // 恢复前先保存当前内容为自动快照，避免不可逆
      if (currentChapter) {
        const preRestore: Snapshot = {
          id: nanoid(),
          chapterId: currentChapterId,
          content: currentChapter.content,
          wordCount: currentChapter.wordCount,
          label: `恢复前自动快照 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
          auto: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveSnapshot(preRestore);
        setSnapshots((prev) => [preRestore, ...prev]);
      }
      updateChapter(currentChapterId, {
        content: snapshot.content,
        wordCount: snapshot.wordCount,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.warn('[SnapshotManager] 恢复快照失败:', e);
    } finally {
      setBusy(false);
    }
  }, [snapshots, currentChapterId, currentChapter, updateChapter]);

  const handleDelete = useCallback(async (snapshotId: string) => {
    setBusy(true);
    try {
      await deleteSnapshotInDb(snapshotId);
      setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
      if (selectedSnapshot === snapshotId) setSelectedSnapshot(null);
    } catch (e) {
      console.warn('[SnapshotManager] 删除快照失败:', e);
    } finally {
      setBusy(false);
    }
  }, [selectedSnapshot]);

  // 清理过旧的自动快照（每章保留最多 20 个 auto）
  const handleCleanAuto = useCallback(async () => {
    if (!currentChapterId) return;
    const autoSnaps = snapshots
      .filter((s) => s.auto)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const toRemove = autoSnaps.slice(20); // 保留前 20 个
    if (toRemove.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(toRemove.map((s) => deleteSnapshotInDb(s.id).catch(() => {})));
      const removeIds = new Set(toRemove.map((s) => s.id));
      setSnapshots((prev) => prev.filter((s) => !removeIds.has(s.id)));
    } finally {
      setBusy(false);
    }
  }, [snapshots, currentChapterId]);

  const selected = snapshots.find((s) => s.id === selectedSnapshot);

  // 简单 diff：逐行对比
  const diffLines = useMemo(() => {
    if (!compareMode || !selected || !currentChapter) return [];
    const oldLines = selected.content.split('\n').filter((l) => l.trim());
    const newLines = currentChapter.content.split('\n').filter((l) => l.trim());
    const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] === newLines[i]) {
        result.push({ type: 'same', text: oldLines[i] || '' });
      } else {
        if (oldLines[i]) result.push({ type: 'removed', text: oldLines[i] ?? '' });
        if (newLines[i]) result.push({ type: 'added', text: newLines[i] ?? '' });
      }
    }
    return result;
  }, [compareMode, selected, currentChapter]);

  // 净化 HTML 内容用于渲染
  const sanitizedContent = useMemo(() => {
    if (!selected?.content) return '';
    return DOMPurify.sanitize(selected.content, {
      ALLOWED_TAGS: ['p', 'br', 'em', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'],
    });
  }, [selected?.content]);

  if (!currentChapter) {
    return (
      <div className="mc-window p-4 text-center text-muted-foreground text-sm">
        <div className="text-3xl mb-2">📷</div>
        <p className="mc-title-sm">请先选择章节</p>
      </div>
    );
  }

  return (
    <div className="mc-window h-full flex flex-col">
      <div className="p-3 mc-divider-bottom flex items-center gap-2">
        <Camera size={16} aria-hidden="true" />
        <h2 className="mc-title-sm">快照管理</h2>
        <span className="text-[10px] mc-text-sm text-muted-foreground">{chapterSnapshots.length}</span>
        <div className="flex-1" />
        <button
          onClick={reload}
          disabled={loading}
          className="mc-btn text-xs px-2 py-1 flex items-center gap-1"
          aria-label="刷新"
          title="刷新"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
        <button
          onClick={handleCreateSnapshot}
          disabled={busy}
          className="mc-btn mc-btn-primary text-xs px-2 py-1"
          aria-label="创建快照"
        >
          创建快照
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 快照列表 */}
        <div className="w-48 mc-border-r mc-scrollbar overflow-y-auto">
          {chapterSnapshots.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <div className="text-2xl mb-2">📸</div>
              <p className="mc-title-sm">{loading ? '加载中...' : '暂无快照'}</p>
            </div>
          ) : (
            chapterSnapshots.map((snap) => (
              <button
                key={snap.id}
                onClick={() => setSelectedSnapshot(snap.id)}
                className={`w-full text-left px-3 py-2 text-xs mc-border-b hover:bg-accent/50 transition-colors ${
                  selectedSnapshot === snap.id ? 'bg-accent mc-border-l-4 border-l-primary' : ''
                }`}
                aria-selected={selectedSnapshot === snap.id}
              >
                <div className="flex items-center gap-1">
                  {snap.auto ? <Clock size={10} aria-hidden="true" /> : <Camera size={10} aria-hidden="true" />}
                  <span className="font-medium truncate">{snap.label || '未命名快照'}</span>
                </div>
                <div className="mc-text-sm text-muted-foreground mt-0.5">
                  {snap.wordCount} 字 · {formatTime(snap.createdAt ?? 0)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* 快照详情/对比 */}
        <div className="flex-1 mc-scrollbar overflow-y-auto">
          {selected ? (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="mc-title-sm font-semibold">{selected.label}</h3>
                <span className="mc-tag text-xs text-muted-foreground">
                  {selected.wordCount} 字 · {formatTime(selected.createdAt ?? 0)}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setCompareMode(!compareMode)}
                  className={`mc-btn text-xs px-2 py-1 rounded flex items-center gap-1 ${
                    compareMode ? 'mc-btn-primary' : 'hover:bg-accent'
                  }`}
                  aria-label={compareMode ? '退出对比模式' : '对比当前章节'}
                >
                  <GitCompare size={12} aria-hidden="true" />
                  {compareMode ? '退出对比' : '对比当前'}
                </button>
                <button
                  onClick={() => handleRestore(selected.id)}
                  disabled={busy}
                  className="mc-btn mc-btn-success text-xs px-2 py-1 flex items-center gap-1"
                  aria-label="恢复快照"
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  恢复
                </button>
                <button
                  onClick={() => handleDelete(selected.id)}
                  disabled={busy}
                  className="mc-hotbar-btn mc-btn-danger text-xs p-1"
                  aria-label="删除快照"
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </div>

              {compareMode ? (
                <div className="mc-card mc-border-2 rounded-2xl p-3 font-mono text-xs space-y-0.5 max-h-[60vh] overflow-y-auto">
                  {diffLines.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.type === 'added'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : line.type === 'removed'
                          ? 'bg-red-500/10 text-red-700 dark:text-red-400 line-through'
                          : ''
                      }
                    >
                      {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                      {line.text}
                    </div>
                  ))}
                  {diffLines.length === 0 && (
                    <div className="mc-text-sm text-muted-foreground text-center">无差异</div>
                  )}
                </div>
              ) : (
                <div className="mc-card mc-border-2 rounded-2xl p-3 text-sm whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
                  {sanitizedContent ? (
                    <div dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
                  ) : (
                    <em className="text-muted-foreground">空内容</em>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center">
                <div className="text-3xl mb-2">🔍</div>
                <p className="mc-title-sm">选择快照查看详情</p>
                {chapterSnapshots.some((s) => s.auto) && (
                  <button
                    onClick={handleCleanAuto}
                    disabled={busy}
                    className="mc-btn text-xs px-2 py-1 mt-3"
                    title="保留最近 20 个自动快照"
                  >
                    清理旧自动快照
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isSameDay = d.toDateString() === now.toDateString();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  if (isSameDay) return `今天 ${h}:${m}`;
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const da = d.getDate().toString().padStart(2, '0');
  return `${mo}-${da} ${h}:${m}`;
}
