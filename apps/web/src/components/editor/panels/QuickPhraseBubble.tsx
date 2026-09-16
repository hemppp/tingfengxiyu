import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  User,
  MapPin,
  Package,
  Wand2,
} from 'lucide-react';
import { useQuickPhraseStore, type QuickPhrase } from '@/stores';
import { useCharacterStore, useLocationStore, useItemStore } from '@/stores';
import { useCurrentProjectId } from '@/hooks/useCurrentProjectId';
import { generateQuickPhrases } from '@/services/ai/quickPhraseService';
import type { Editor } from '@tiptap/core';

interface QuickPhraseBubbleProps {
  editor: Editor | null;
}

const categoryConfig: Record<QuickPhrase['category'], { icon: typeof User; color: string; label: string }> = {
  character: { icon: User, color: '#3b82f6', label: '角色' },
  location: { icon: MapPin, color: '#a855f7', label: '地点' },
  item: { icon: Package, color: '#22c55e', label: '物品' },
  ai: { icon: Wand2, color: '#f59e0b', label: 'AI推荐' },
  custom: { icon: Sparkles, color: '#6b7280', label: '自定义' },
};

/**
 * 气泡的固定几何（`position: fixed`，见下方 style）。
 *
 * ★ 编辑器必须据此在滚动内容底部预留空隙 —— 气泡是**覆盖层**，不在文档流里。
 *   不预留的话正文滚到底时末段会被它压住（2026-09-16 实测 520px 窄屏压住 39px）。
 *   所以这两个值导出给 EditorPage 用，避免改了一处忘了另一处。
 */
export const QP_BUBBLE_BOTTOM = 80;   // 气泡底边距视口底
export const QP_BUBBLE_HEIGHT = 44;   // 胶囊高（对应 h-11）
/** 气泡顶边距视口底的距离 —— 正文必须停在它上面才不被遮 */
export const QP_BUBBLE_CLEARANCE = QP_BUBBLE_BOTTOM + QP_BUBBLE_HEIGHT;

export function QuickPhraseBubble({ editor }: QuickPhraseBubbleProps) {
  const projectId = useCurrentProjectId();
  const { phrases, addPhrase, removePhrase, incrementUsage, setIsGenerating, isGenerating } = useQuickPhraseStore();
  const characters = useCharacterStore((s) => s.characters);
  const locations = useLocationStore((s) => s.locations);
  const items = useItemStore((s) => s.items);

  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPhraseText, setNewPhraseText] = useState('');
  const [hoverProgress, setHoverProgress] = useState(0);
  const progressIntervalRef = useRef<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const projectPhrases = useMemo(
    () => phrases.filter((p) => (p as QuickPhrase & { projectId?: string }).projectId === projectId || !('projectId' in p)),
    [phrases, projectId]
  );

  const displayPhrases = useMemo(() => {
    const result: QuickPhrase[] = [];
    const seenTexts = new Set<string>();

    for (const p of projectPhrases) {
      const key = p.text.toLowerCase();
      if (!seenTexts.has(key)) {
        seenTexts.add(key);
        result.push(p);
      }
    }

    const projectChars = characters.filter((c) => c.projectId === projectId);
    for (const c of projectChars.slice(0, 5)) {
      if (!seenTexts.has(c.name.toLowerCase())) {
        seenTexts.add(c.name.toLowerCase());
        result.push({
          id: `char-${c.id}`,
          text: c.name,
          category: 'character',
          source: c.aliases?.[0],
          usageCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      if (c.aliases) {
        for (const alias of c.aliases.slice(0, 2)) {
          if (!seenTexts.has(alias.toLowerCase())) {
            seenTexts.add(alias.toLowerCase());
            result.push({
              id: `char-alias-${c.id}-${alias}`,
              text: alias,
              category: 'character',
              source: c.name,
              usageCount: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
      }
    }

    const projectLocs = locations.filter((l) => l.projectId === projectId);
    for (const l of projectLocs.slice(0, 3)) {
      if (!seenTexts.has(l.name.toLowerCase())) {
        seenTexts.add(l.name.toLowerCase());
        result.push({
          id: `loc-${l.id}`,
          text: l.name,
          category: 'location',
          usageCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    const projectItems = items.filter((i) => i.projectId === projectId);
    for (const i of projectItems.slice(0, 3)) {
      if (!seenTexts.has(i.name.toLowerCase())) {
        seenTexts.add(i.name.toLowerCase());
        result.push({
          id: `item-${i.id}`,
          text: i.name,
          category: 'item',
          usageCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    return result.sort((a, b) => b.usageCount - a.usageCount).slice(0, 12);
  }, [projectPhrases, characters, locations, items, projectId]);

  const handleMouseEnter = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    let progress = hoverProgress;
    const totalDuration = 500;
    const interval = 30;
    progressIntervalRef.current = window.setInterval(() => {
      progress += interval;
      setHoverProgress(Math.min(progress / totalDuration, 1));
      if (progress >= totalDuration) {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setExpanded(true);
      }
    }, interval);
  };

  const handleMouseLeave = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setHoverProgress(0);
    if (!showAddForm) {
      setTimeout(() => {
        setExpanded(false);
      }, 200);
    }
  };

  const handleInsertPhrase = (phrase: QuickPhrase) => {
    if (!editor) return;
    editor.chain().focus().insertContent(phrase.text).run();
    incrementUsage(phrase.id);
  };

  const handleAddCustomPhrase = () => {
    if (!newPhraseText.trim()) return;
    addPhrase({
      text: newPhraseText.trim(),
      category: 'custom',
      ...(projectId ? { projectId } : {}),
    } as QuickPhrase);
    setNewPhraseText('');
    setShowAddForm(false);
  };

  const handleGenerateAIPhrases = async () => {
    if (!editor || !projectId) return;
    setIsGenerating(true);
    try {
      const content = editor.getText();
      const aiPhrases = await generateQuickPhrases(content, characters);
      for (const p of aiPhrases) {
        addPhrase({
          text: p,
          category: 'ai',
          ...(projectId ? { projectId } : {}),
        } as QuickPhrase);
      }
    } catch (e) {
      console.debug('[QuickPhrase] AI生成失败:', e);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (showAddForm && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAddForm]);

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, []);

  const isReady = hoverProgress >= 1 || expanded;

  return createPortal(
    <div
      ref={bubbleRef}
      className={`
        fixed z-50
        flex flex-col items-center
        transition-all duration-300 ease-out
      `}
      style={{
        left: '50%',
        // 用常量而非字面量：EditorPage 靠同一个值算正文底部预留（见 QP_BUBBLE_CLEARANCE）
        bottom: QP_BUBBLE_BOTTOM,
        transform: 'translateX(-50%)',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {expanded && (
        <div
          className="mb-3 animate-fade-in-up"
          style={{
            background: 'rgb(var(--glass-tint) / 0.65)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid hsl(var(--border) / 0.4)',
            borderRadius: '16px',
            boxShadow:
              '0 12px 40px hsl(var(--ink-deep) / 0.15), 0 4px 12px hsl(var(--ink-deep) / 0.08), inset 0 1px 0 hsl(var(--glass-highlight) / 0.6)',
            padding: '12px',
            maxWidth: 'min(560px, 85vw)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[11px] font-medium"
              style={{ color: 'hsl(var(--ink-light))', fontFamily: "'Noto Serif SC', serif" }}
            >
              快捷短语
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleGenerateAIPhrases}
                disabled={isGenerating}
                className="flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] transition-colors"
                style={{
                  color: 'hsl(var(--ink-soft))',
                  backgroundColor: isGenerating ? 'hsl(var(--mountain-cyan) / 0.1)' : 'transparent',
                  cursor: isGenerating ? 'wait' : 'pointer',
                }}
                title="AI 智能提取常用短语"
              >
                <Wand2 size={12} className={isGenerating ? 'animate-spin' : ''} />
                <span>{isGenerating ? '提取中' : 'AI提取'}</span>
              </button>
              <button
                onClick={() => {
                  setShowAddForm((v) => !v);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] transition-colors hover:bg-white/40"
                style={{ color: 'hsl(var(--ink-soft))' }}
                title="添加自定义短语"
              >
                <Plus size={12} />
                <span>添加</span>
              </button>
            </div>
          </div>

          {showAddForm && (
            <div className="flex gap-2 mb-2">
              <input
                ref={inputRef}
                type="text"
                value={newPhraseText}
                onChange={(e) => setNewPhraseText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddCustomPhrase();
                  if (e.key === 'Escape') {
                    setShowAddForm(false);
                    setNewPhraseText('');
                  }
                }}
                placeholder="输入常用句子..."
                className="flex-1 px-3 py-1.5 text-[13px] rounded-[14px] outline-none transition-all"
                style={{
                  background: 'hsl(var(--card) / 0.6)',
                  border: '1px solid hsl(var(--border) / 0.5)',
                  color: 'hsl(var(--ink))',
                  fontFamily: "'Noto Serif SC', serif",
                }}
              />
              <button
                onClick={handleAddCustomPhrase}
                disabled={!newPhraseText.trim()}
                className="px-3 py-1.5 text-[12px] rounded-xl font-medium transition-all"
                style={{
                  background: newPhraseText.trim() ? 'hsl(var(--mountain-cyan))' : 'hsl(var(--mountain-cyan) / 0.3)',
                  color: 'white',
                  cursor: newPhraseText.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                确认
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
            {displayPhrases.length === 0 ? (
              <div className="w-full py-4 text-center text-[12px]" style={{ color: 'hsl(var(--ink-pale))' }}>
                暂无快捷短语，点击「AI提取」或「添加」开始
              </div>
            ) : (
              displayPhrases.map((phrase) => {
                const config = categoryConfig[phrase.category];
                const Icon = config.icon;
                return (
                  <div
                    key={phrase.id}
                    className="group relative"
                  >
                    <button
                      onClick={() => handleInsertPhrase(phrase)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] transition-all hover:scale-105 active:scale-95"
                      style={{
                        background: 'hsl(var(--card) / 0.7)',
                        border: `1px solid ${config.color}33`,
                        color: 'hsl(var(--ink))',
                        fontFamily: "'Noto Serif SC', serif",
                        cursor: 'pointer',
                      }}
                      title={phrase.source ? `${config.label} · 来源: ${phrase.source}` : config.label}
                    >
                      <Icon size={11} style={{ color: config.color }} />
                      <span className="max-w-[120px] truncate">{phrase.text}</span>
                    </button>
                    {(phrase.category === 'custom' || phrase.category === 'ai') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removePhrase(phrase.id);
                        }}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{
                          background: 'hsl(var(--destructive) / 0.9)',
                          color: 'white',
                          cursor: 'pointer',
                        }}
                        title="删除"
                        aria-label={`删除短语：${phrase.text}`}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-center mt-2">
            <button
              onClick={() => setExpanded(false)}
              className="p-1 rounded-full transition-colors hover:bg-white/30"
              style={{ color: 'hsl(var(--ink-light))' }}
              aria-label="收起快捷短语"
              title="收起"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 漂移层 A：外层容器做 X 主导的缓慢游移，与按钮层的 Y 主导漂移叠加 → 不规则复合轨迹 */}
      <div className="nm-qp-blob-drift">
        <button
          className={`
            nm-qp-blob-morph nm-qp-edge-wave
            flex items-center gap-2
            px-5 h-11
            cursor-pointer select-none
            ${isReady ? 'nm-qp-bubble--active' : ''}
          `}
          style={{
            // 玻璃球面质感：左上高光 + 底部透出环境，模拟一颗悬浮的椭圆气泡
            background:
              'radial-gradient(circle at 30% 24%, rgb(255 255 255 / 0.9), rgb(255 255 255 / 0.32) 45%, rgb(var(--glass-tint) / 0.3) 100%)',
            backdropFilter: 'blur(14px) saturate(170%)',
            WebkitBackdropFilter: 'blur(14px) saturate(170%)',
            color: 'hsl(var(--ink-soft))',
            fontFamily: "'Noto Serif SC', serif",
            fontSize: '13px',
            fontWeight: 500,
          }}
          onClick={() => setExpanded((v) => !v)}
          // ★ 无障碍：图标/装饰性 class 让可访问名不好推导，显式给 aria-label；
          //   并暴露展开态（此前只有视觉箭头，屏读器读不出开合）。
          aria-label={expanded ? '收起快捷短语' : '展开快捷短语'}
          aria-expanded={expanded}
          title="快捷短语"
        >
          <Sparkles size={14} style={{ color: 'hsl(var(--mountain-cyan))' }} />
          <span>快捷短语</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <style>{`
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.25s ease-out;
        }
        .nm-qp-bubble--active {
          border-color: hsl(var(--mountain-cyan) / 0.5) !important;
          box-shadow:
            0 12px 40px hsl(var(--ink-deep) / 0.16),
            0 0 0 3px hsl(var(--mountain-cyan) / 0.08),
            inset 0 1px 0 hsl(var(--glass-highlight) / 0.7) !important;
          transform: translateX(-50%) translateY(-1px);
        }
      `}</style>
    </div>,
    document.body
  );
}

export default QuickPhraseBubble;
