import { useState, useEffect } from 'react';
import { Pin, Sprout, Sparkles, Lightbulb, X } from 'lucide-react';
import type { Earmark, EarmarkType, Foreshadow, ForeshadowType } from '@novel/shared';

interface EarmarkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (earmark: Partial<Earmark>) => void;
  onCreateForeshadow?: (description: string, type: ForeshadowType) => Promise<string | null>;
  initialData?: Partial<Earmark>;
  chapterId?: string;
  existingForeshadows?: Foreshadow[];
}

const earmarkTypeConfig: Record<EarmarkType, { label: string; Icon: typeof Sprout }> = {
  foreshadow_seed: { label: '伏笔播种', Icon: Sprout },
  foreshadow_payoff: { label: '伏笔回收', Icon: Sparkles },
  possibility: { label: '可能性', Icon: Lightbulb },
};

export function EarmarkDialog({
  open,
  onOpenChange,
  onSave,
  onCreateForeshadow,
  initialData,
  chapterId,
  existingForeshadows = [],
}: EarmarkDialogProps) {
  const [type, setType] = useState<EarmarkType>('foreshadow_seed');
  const [foreshadowId, setForeshadowId] = useState<string>('');
  const [foreshadowInput, setForeshadowInput] = useState<string>('');
  const [useExistingForeshadow, setUseExistingForeshadow] = useState<boolean>(true);
  const [description, setDescription] = useState<string>('');
  const [outcome, setOutcome] = useState<string>('');
  const [probability, setProbability] = useState<number>(50);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setType(initialData.type || 'foreshadow_seed');
        setForeshadowId(initialData.foreshadowId || '');
        setDescription(initialData.description || '');
        setOutcome(initialData.outcome || '');
        setProbability(initialData.probability ?? 50);
        setUseExistingForeshadow(!!initialData.foreshadowId);
        setForeshadowInput('');
      } else {
        setType('foreshadow_seed');
        setForeshadowId('');
        setForeshadowInput('');
        setUseExistingForeshadow(true);
        setDescription('');
        setOutcome('');
        setProbability(50);
      }
    }
  }, [open, initialData]);

  // Esc 关闭（模态可达性）
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const handleSubmit = async () => {
    let resolvedForeshadowId = foreshadowId;

    // 如果选择创建新伏笔
    if (!useExistingForeshadow && foreshadowInput && onCreateForeshadow) {
      const newFsId = await onCreateForeshadow(foreshadowInput, 'motivation');
      if (newFsId) {
        resolvedForeshadowId = newFsId;
      } else {
        return; // 创建失败，不关闭对话框
      }
    }

    const earmark: Partial<Earmark> = {
      ...(initialData?.id ? { id: initialData.id } : {}),
      type,
      description: description || undefined,
      outcome: outcome || undefined,
      probability: probability > 0 && probability < 100 ? probability : undefined,
      relatedCharacters: [],
      relatedItems: [],
      tags: [],
    };

    if (chapterId) {
      earmark.chapterId = chapterId;
    }

    if (resolvedForeshadowId) {
      earmark.foreshadowId = resolvedForeshadowId;
    }

    onSave(earmark);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      className="nm-modal-overlay"
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
      aria-label="书角标记"
    >
      <div
        className="nm-modal-card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="nm-modal-header">
          <Pin size={15} aria-hidden="true" className="text-primary" />
          <h2 className="nm-modal-title">
            {initialData?.id ? '编辑书角标记' : '添加书角标记'}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="nm-modal-close"
            aria-label="关闭"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="nm-modal-body space-y-4">
          {/* Type Selection */}
          <div>
            <label className="nm-modal-label">标记类型</label>
            <div className="flex gap-2">
              {(Object.keys(earmarkTypeConfig) as EarmarkType[]).map((t) => {
                const active = type === t;
                const TypeIcon = earmarkTypeConfig[t].Icon;
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`nm-modal-btn flex-1 ${active ? 'is-active' : ''}`}
                    aria-pressed={active}
                  >
                    <TypeIcon size={13} aria-hidden="true" />
                    <span>{earmarkTypeConfig[t].label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Foreshadow Selection */}
          {(type === 'foreshadow_seed' || type === 'foreshadow_payoff') && (
            <div>
              <label className="nm-modal-label">关联伏笔</label>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setUseExistingForeshadow(true)}
                  className={`nm-modal-btn flex-1 ${useExistingForeshadow ? 'is-active' : ''}`}
                  aria-pressed={useExistingForeshadow}
                >
                  从列表选择
                </button>
                <button
                  onClick={() => setUseExistingForeshadow(false)}
                  className={`nm-modal-btn flex-1 ${!useExistingForeshadow ? 'is-active' : ''}`}
                  aria-pressed={!useExistingForeshadow}
                >
                  创建新伏笔
                </button>
              </div>

              {useExistingForeshadow ? (
                <select
                  value={foreshadowId}
                  onChange={(e) => setForeshadowId(e.target.value)}
                  className="nm-modal-select"
                >
                  <option value="">请选择伏笔...</option>
                  {existingForeshadows.map((fs) => (
                    <option key={fs.id} value={fs.id}>
                      {fs.description} (第{fs.seedChapter}章)
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={foreshadowInput}
                  onChange={(e) => setForeshadowInput(e.target.value)}
                  placeholder="输入新伏笔描述..."
                  className="nm-modal-input"
                />
              )}
            </div>
          )}

          {/* 描述 */}
          <div>
            <label className="nm-modal-label">
              备注说明
              <span className="font-normal ml-1 opacity-60">(可选)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="添加备注..."
              rows={3}
              className="nm-modal-textarea"
            />
          </div>

          {/* Outcome */}
          <div>
            <label className="nm-modal-label">
              预期结局
              <span className="font-normal ml-1 opacity-60">(可选)</span>
            </label>
            <textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="描述预期的结局..."
              rows={2}
              className="nm-modal-textarea"
            />
          </div>

          {/* Probability */}
          <div>
            <label className="nm-modal-label">
              可能性
              <span className="font-normal ml-1 opacity-60">(用于多重结局)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={probability}
                onChange={(e) => setProbability(Number(e.target.value))}
                className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
                style={{ background: 'hsl(var(--border) / 0.4)' }}
              />
              <span className="text-sm font-medium w-12 text-right" style={{ color: 'hsl(var(--foreground))' }}>
                {probability}%
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="nm-modal-footer">
          <button
            onClick={() => onOpenChange(false)}
            className="nm-modal-btn"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="nm-modal-btn nm-modal-btn-primary"
          >
            {initialData?.id ? '确认保存' : '确认添加'}
          </button>
        </div>
      </div>
    </div>
  );
}
