import { useState, useMemo } from 'react';
import { useForeshadowStore, useEarmarkStore, useChapterStore, getForeshadowThreshold } from '@/stores';
import { useCurrentProjectId } from '@/hooks/useCurrentProjectId';
import { EarmarkBadge } from './EarmarkBadge';
import { EarmarkDialog } from './EarmarkDialog';
import { ChevronDown, ChevronRight, Plus, Trash2, AlertCircle } from 'lucide-react';
import { nanoid } from 'nanoid';
import { safeConfirm } from '@/utils/safeConfirm';
import type { Foreshadow, Earmark, ForeshadowType } from '@novel/shared';

type FilterStatus = 'all' | 'planted' | 'hinted' | 'payed_off' | 'abandoned';
type FilterType = 'all' | ForeshadowType;

const statusConfig: Record<string, { label: string; icon: string; color: string }> = {
  planted: { label: '已播种', icon: '🌱', color: 'text-green-500' },
  hinted: { label: '已暗示', icon: '💡', color: 'text-amber-500' },
  payed_off: { label: '已回收', icon: '✨', color: 'text-blue-500' },
  abandoned: { label: '已废弃', icon: '❌', color: 'text-gray-500' },
};

const typeConfig: Record<ForeshadowType, { label: string; icon: string }> = {
  identity: { label: '身份', icon: '👤' },
  motivation: { label: '动机', icon: '🎯' },
  relation: { label: '关系', icon: '🔗' },
  trauma: { label: '创伤', icon: '💔' },
  turning: { label: '转折', icon: '🔄' },
  fate: { label: '命运', icon: '⭐' },
};

export function EarmarkPanel() {
  const foreshadows = useForeshadowStore((s) => s.foreshadows);
  const earmarks = useEarmarkStore((s) => s.earmarks);
  const addEarmark = useEarmarkStore((s) => s.addEarmark);
  const updateEarmark = useEarmarkStore((s) => s.updateEarmark);
  const deleteEarmark = useEarmarkStore((s) => s.deleteEarmark);
  const chapters = useChapterStore((s) => s.chapters);
  const currentChapterId = useChapterStore((s) => s.currentChapterId);
  const projectId = useCurrentProjectId();

  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEarmark, setEditingEarmark] = useState<Partial<Earmark> | undefined>();
  const [selectedForeshadowId, setSelectedForeshadowId] = useState<string>('');

  // 统计数据
  const stats = useMemo(() => {
    const activeForeshadows = foreshadows.filter(
      (f) => f.status === 'planted' || f.status === 'hinted'
    );
    const pendingForeshadows = foreshadows.filter((f) => {
      if (f.status === 'payed_off' || f.status === 'abandoned') return false;

      // 获取当前最后一章的 order 作为"当前进度"
      const currentChapterOrder = chapters.length > 0
        ? Math.max(...chapters.map((ch) => ch.order))
        : 0;

      const lastHintChapter = f.hints.length > 0
        ? Math.max(...f.hints.map((h) => h.chapter))
        : f.seedChapter;

      const chaptersSinceHint = currentChapterOrder - lastHintChapter;

      // 使用该伏笔类型的 警告 阈值
      const threshold = getForeshadowThreshold(f.type).warning;
      return chaptersSinceHint >= threshold;
    });

    const unrealizedEarmarks = earmarks.filter((e) => e.type === 'possibility' && !e.outcome);

    return {
      totalForeshadows: foreshadows.length,
      activeForeshadows: activeForeshadows.length,
      pendingForeshadows: pendingForeshadows.length,
      totalEarmarks: earmarks.length,
      unrealizedEarmarks: unrealizedEarmarks.length,
    };
  }, [foreshadows, earmarks, chapters]);

  // 筛选后的伏笔列表
  const filteredForeshadows = useMemo(() => {
    return foreshadows.filter((f) => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (typeFilter !== 'all' && f.type !== typeFilter) return false;
      return true;
    });
  }, [foreshadows, statusFilter, typeFilter]);

  // 如果没有项目 ID，显示提示信息
  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">请先选择一个项目</p>
        </div>
      </div>
    );
  }

  // 获取伏笔关联的 Earmarks
  const getForeshadowEarmarks = (foreshadowId: string) => {
    return earmarks.filter((e) => e.foreshadowId === foreshadowId);
  };

  // 获取章节号
  const getChapterNumber = (foreshadow: Foreshadow) => {
    return foreshadow.seedChapter;
  };

  // 获取上次提及章节
  const getLastMentionChapter = (foreshadow: Foreshadow) => {
    if (foreshadow.hints.length === 0) return foreshadow.seedChapter;
    return Math.max(...foreshadow.hints.map((h) => h.chapter));
  };

  // 处理 Earmark 保存
  const handleSaveEarmark = (earmark: Partial<Earmark>) => {
    if (editingEarmark?.id) {
      updateEarmark(editingEarmark.id, earmark);
    } else {
      const newEarmark: Earmark = {
        id: nanoid(),
        projectId,
        type: earmark.type || 'foreshadow_seed',
        description: earmark.description,
        outcome: earmark.outcome,
        probability: earmark.probability,
        chapterId: earmark.chapterId ?? '',
        foreshadowId: earmark.foreshadowId ?? selectedForeshadowId,
        relatedCharacters: [],
        relatedItems: [],
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addEarmark(newEarmark);
    }
    setDialogOpen(false);
    setEditingEarmark(undefined);
  };

  // 打开编辑对话框
  const handleEditEarmark = (earmark: Earmark) => {
    setEditingEarmark(earmark);
    setSelectedForeshadowId(earmark.foreshadowId || '');
    setDialogOpen(true);
  };

  // 打开新增对话框
  const handleAddEarmark = (foreshadowId: string) => {
    setEditingEarmark(undefined);
    setSelectedForeshadowId(foreshadowId);
    setDialogOpen(true);
  };

  // 删除 Earmark
  const handleDeleteEarmark = (earmarkId: string) => {
    try {
      if (!safeConfirm('确定删除此书角标记？')) return;
      deleteEarmark(earmarkId);
    } catch {
      // 删除失败静默处理
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b">
        <h2 className="font-semibold text-sm flex items-center gap-1.5">
          <span>📌</span>
          <span>伏笔 & 书角标记</span>
        </h2>
      </div>

      {/* 统计区域 */}
      <div className="px-3 py-2 border-b bg-muted/30">
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-4">
            <span>
              <span className="text-muted-foreground">伏笔:</span>
              <span className="font-medium ml-1">{stats.totalForeshadows}</span>
            </span>
            <span>
              <span className="text-green-500">活跃:</span>
              <span className="font-medium ml-1">{stats.activeForeshadows}</span>
            </span>
            <span>
              <span className="text-amber-500">待回收:</span>
              <span className="font-medium ml-1">{stats.pendingForeshadows}</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span>
              <span className="text-muted-foreground">书角标记:</span>
              <span className="font-medium ml-1">{stats.totalEarmarks}</span>
            </span>
            <span>
              <span className="text-blue-500">待实现:</span>
              <span className="font-medium ml-1">{stats.unrealizedEarmarks}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 筛选区域 */}
      <div className="px-3 py-2 border-b space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">状态:</span>
          <div className="flex gap-1">
            {(['all', 'planted', 'hinted', 'payed_off', 'abandoned'] as FilterStatus[]).map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-2 py-0.5 rounded-xl ${
                    statusFilter === status
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  {status === 'all' ? '全部' : statusConfig[status]?.label}
                </button>
              )
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">类型:</span>
          <div className="flex gap-1 flex-wrap">
            {(['all', 'identity', 'motivation', 'relation', 'trauma', 'turning', 'fate'] as FilterType[]).map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={`px-2 py-0.5 rounded-xl ${
                    typeFilter === type
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  {type === 'all' ? '全部' : typeConfig[type]?.label}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* 伏笔列表 */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredForeshadows.length === 0 ? (
          <div className="text-center text-muted-foreground p-8">
            <p>暂无伏笔</p>
            <p className="text-sm mt-1">在编辑器中选中文字，点击 🔖 添加伏笔</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredForeshadows.map((fs) => {
              const fsEarmarks = getForeshadowEarmarks(fs.id);
              const isExpanded = expandedId === fs.id;
              const status = (statusConfig[fs.status] || statusConfig.planted)!;
              const type = (typeConfig[fs.type] || typeConfig.motivation)!;

              return (
                <div
                  key={fs.id}
                  className="border rounded-lg overflow-hidden bg-card"
                >
                  {/* 伏笔头 */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50"
                    onClick={() => setExpandedId(isExpanded ? null : fs.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium flex-1">{fs.description}</span>
                  </div>

                  {/* 展开内容 */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t pt-2 space-y-2">
                      {/* 基本信息 */}
                      <div className="text-xs text-muted-foreground">
                        <span>{type.icon} {type.label}</span>
                        <span className="mx-2">·</span>
                        <span className={status.color}>{status.icon} {status.label}</span>
                        <span className="mx-2">·</span>
                        <span>播种: 第{getChapterNumber(fs)}章</span>
                        <span className="mx-2">·</span>
                        <span>上次提及: 第{getLastMentionChapter(fs) + 1}章</span>
                      </div>

                      {/* Earmarks 显示 */}
                      {fsEarmarks.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {fsEarmarks.map((earmark) => (
                            <div key={earmark.id} className="flex items-center gap-1">
                              <EarmarkBadge
                                earmark={earmark}
                                onClick={handleEditEarmark}
                                size="sm"
                                showLabel={false}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteEarmark(earmark.id);
                                }}
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors p-1 rounded-xl"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 可能性 Earmarks */}
                      {fsEarmarks.some((e) => e.type === 'possibility') && (
                        <div className="text-xs space-y-1 pt-1">
                          {fsEarmarks
                            .filter((e) => e.type === 'possibility')
                            .map((e) => (
                              <div key={e.id} className="flex items-center gap-2 text-blue-500">
                                <span>💡</span>
                                <span className="flex-1">{e.description || '可能性'}</span>
                                {e.probability !== undefined && (
                                  <span className="font-medium">
                                    {e.probability}%
                                  </span>
                                )}
                              </div>
                            ))}
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddEarmark(fs.id);
                          }}
                          className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-xl hover:bg-primary/20 flex items-center gap-1"
                        >
                          <Plus size={12} />
                          添加书角标记
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Earmark 编辑对话框 */}
      <EarmarkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveEarmark}
        onCreateForeshadow={async (description, fsType) => {
          const fsId = nanoid();
          useForeshadowStore.getState().addForeshadow({
            id: fsId,
            projectId,
            description,
            type: fsType,
            status: 'planted',
            seedChapter: chapters.find(ch => ch.id === currentChapterId)?.order ?? 1,
            hints: [],
            relatedCharacters: [],
            relatedItems: [],
            relatedEvents: [],
            earmarks: [],
            tags: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return fsId;
        }}
        initialData={editingEarmark}
        existingForeshadows={foreshadows}
      />
    </div>
  );
}
