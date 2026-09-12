import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Project, ProjectMode } from '@novel/shared';
import { modalEnter, modalExit } from '@/utils/gsap';
import { dispatchToastEvent } from '@/utils/errors';

interface AddBookFormData {
  title: string;
  author: string;
  description?: string;
  cover?: string;
  targetWordCount?: number;
  /** 创作模式：决定该项目加载哪一套工作台（两套 UI 互斥） */
  mode?: ProjectMode;
}

interface AddBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AddBookFormData) => Promise<void>;
  editBook?: Project | null;
}

export function AddBookModal({ isOpen, onClose, onSubmit, editBook }: AddBookModalProps) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [targetWordCount, setTargetWordCount] = useState('');
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  /** 创作模式：新建默认「手写」，AI 写作需显式切换 */
  const [mode, setMode] = useState<ProjectMode>('manual');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const prevIsOpenRef = useRef(false);
  const [shouldRender, setShouldRender] = useState(false);
  const isMountedRef = useRef(true);
  const animationRef = useRef<gsap.core.Timeline | null>(null);

  // Track mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Cleanup animation on unmount
      if (animationRef.current) {
        animationRef.current.kill();
        animationRef.current = null;
      }
    };
  }, []);

  // Handle 打开/关闭 animations
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    // Kill any existing animation
    if (animationRef.current) {
      animationRef.current.kill();
      animationRef.current = null;
    }

    if (isOpen && !wasOpen) {
      setShouldRender(true);
      // 使用 useLayoutEffect 的时机确保 DOM 已更新
      // 但这里用 setTimeout 确保 React 完成渲染后再触发动画
      setTimeout(() => {
        if (!isMountedRef.current) return;
        if (modalRef.current) {
          animationRef.current = modalEnter(modalRef.current, backdropRef.current || undefined);
        }
      }, 0);
    } else if (!isOpen && wasOpen) {
      if (modalRef.current && isMountedRef.current) {
        animationRef.current = modalExit(modalRef.current, backdropRef.current || undefined);
        // Use a safe callback that checks mount status
        animationRef.current.then(() => {
          if (isMountedRef.current) {
            setShouldRender(false);
          }
        });
      } else {
        // If no modal ref or not mounted, just update state safely
        if (isMountedRef.current) {
          setShouldRender(false);
        }
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (editBook) {
      setTitle(editBook.name);
      setAuthor(editBook.penName || '');
      setDescription(editBook.description || '');
      setTargetWordCount(editBook.targetWordCount?.toString() || '');
      setCoverPreview(editBook.coverImage || null);
      setMode(editBook.mode ?? 'manual');
    } else {
      setTitle('');
      setAuthor('');
      setDescription('');
      setTargetWordCount('');
      setCoverPreview(null);
      setMode('manual');
    }
    setError('');
     
  }, [editBook?.id ?? 'new', isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('请输入书名');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        author: author.trim(),
        description: description.trim() || undefined,
        targetWordCount: targetWordCount ? parseInt(targetWordCount) : undefined,
        cover: coverPreview || undefined,
        mode,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : '提交失败，请重试';
      console.error('[AddBookModal] 提交失败:', message);
      setError(message);
      dispatchToastEvent({ type: 'error', message, duration: 4000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!shouldRender) return null;

  const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderWidth: '0.5px',
    borderStyle: 'solid',
    borderColor: 'hsl(var(--border) / 0.6)',
    borderRadius: 10,
    fontSize: 14,
    color: 'hsl(var(--foreground))',
    background: 'rgb(var(--glass-tint) / 0.4)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
    boxSizing: 'border-box',
  };

  const inputFocusStyle: React.CSSProperties = {
    borderColor: 'hsl(var(--ring) / 0.7)',
    background: 'rgb(var(--glass-tint) / 0.6)',
    boxShadow: '0 0 0 4px hsl(var(--ring) / 0.12), inset 0 1px 0 rgb(var(--glass-highlight) / 0.4)',
  };

  return (
    <div
      ref={backdropRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'hsl(var(--glass-shadow) / 0.32)',
        backdropFilter: 'blur(16px) saturate(120%)',
        WebkitBackdropFilter: 'blur(16px) saturate(120%)',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={modalRef}
        className="addbook-modal-card glass-modal"
        style={{
          width: '100%',
          maxWidth: 440,
          borderRadius: 20,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px 0 24px',
        }}>
          <h2 style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'hsl(var(--foreground))',
            margin: 0,
          }}>
            {editBook ? '编辑书籍' : '新建书籍'}
          </h2>
          <button
            onClick={onClose}
            className="addbook-modal-close"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 999,
              border: 'none',
              background: 'transparent',
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'hsl(var(--secondary))';
              e.currentTarget.style.color = 'hsl(var(--foreground))';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'hsl(var(--muted-foreground))';
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px 24px' }} className="addbook-form">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 创作方式 —— 创建时的第一步决策：决定这个项目加载哪一套工作台（两套 UI 互斥） */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'hsl(var(--secondary-foreground))',
                marginBottom: 6,
              }}>
                创作方式
              </label>
              <div
                role="radiogroup"
                aria-label="创作方式"
                style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  padding: 3,
                  borderRadius: 999,
                  background: 'rgb(var(--glass-tint) / 0.45)',
                  border: '0.5px solid hsl(var(--border) / 0.6)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                }}
              >
                {/* 滑动指示块：靠 translateX 在两项之间滑，而不是重新布局 */}
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 3,
                    bottom: 3,
                    left: 3,
                    width: 'calc(50% - 3px)',
                    borderRadius: 999,
                    background: 'linear-gradient(160deg, hsl(var(--primary)), hsl(var(--primary) / 0.78))',
                    boxShadow: '0 2px 10px hsl(var(--primary) / 0.32), inset 0 1px 0 rgb(var(--glass-highlight) / 0.5)',
                    transform: mode === 'auto' ? 'translateX(100%)' : 'translateX(0)',
                    transition: 'transform 0.32s cubic-bezier(0.34, 1.4, 0.64, 1)',
                  }}
                />
                {([
                  { key: 'manual' as ProjectMode, label: '手写' },
                  { key: 'auto' as ProjectMode, label: 'AI 写作' },
                ]).map((opt) => {
                  const active = mode === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMode(opt.key)}
                      style={{
                        position: 'relative',
                        zIndex: 1,
                        padding: '8px 0',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 500,
                        color: active ? '#fff' : 'hsl(var(--muted-foreground))',
                        transition: 'color 0.2s',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p style={{
                fontSize: 11,
                lineHeight: 1.55,
                color: 'hsl(var(--muted-foreground))',
                margin: '6px 2px 0 2px',
              }}>
                {mode === 'manual'
                  ? '自己执笔，AI 打辅助 —— 罗盘气泡 + 角色 / 地图 / 时间线等浮窗面板'
                  : 'AI 主笔、你审稿 —— 智能体交流流 + 流式写文，手写面板不加载'}
              </p>
            </div>

            {/* Title */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'hsl(var(--secondary-foreground))',
                marginBottom: 6,
              }}>
                书名 <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setError(''); }}
                onFocus={() => setFocusedField('title')}
                onBlur={() => setFocusedField(null)}
                placeholder="输入书名"
                style={{
                  ...inputBaseStyle,
                  ...(focusedField === 'title' ? inputFocusStyle : {}),
                }}
                autoFocus
              />
              {error && (
                <p style={{
                  fontSize: 12,
                  color: 'hsl(var(--destructive))',
                  margin: '6px 0 0 0',
                }}>
                  {error}
                </p>
              )}
            </div>

            {/* Author */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'hsl(var(--secondary-foreground))',
                marginBottom: 6,
              }}>
                作者
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                onFocus={() => setFocusedField('author')}
                onBlur={() => setFocusedField(null)}
                placeholder="输入作者名"
                style={{
                  ...inputBaseStyle,
                  ...(focusedField === 'author' ? inputFocusStyle : {}),
                }}
              />
            </div>

            {/* 描述 */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'hsl(var(--secondary-foreground))',
                marginBottom: 6,
              }}>
                简介
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => setFocusedField('description')}
                onBlur={() => setFocusedField(null)}
                placeholder="简要描述..."
                rows={3}
                style={{
                  ...inputBaseStyle,
                  resize: 'vertical',
                  minHeight: 72,
                  ...(focusedField === 'description' ? inputFocusStyle : {}),
                }}
              />
            </div>

            {/* Target word count */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'hsl(var(--secondary-foreground))',
                marginBottom: 6,
              }}>
                目标字数
              </label>
              <input
                type="number"
                value={targetWordCount}
                onChange={(e) => setTargetWordCount(e.target.value)}
                onFocus={() => setFocusedField('targetWordCount')}
                onBlur={() => setFocusedField(null)}
                placeholder="例如：100000"
                style={{
                  ...inputBaseStyle,
                  ...(focusedField === 'targetWordCount' ? inputFocusStyle : {}),
                }}
              />
            </div>
          </div>

          {/* Buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 24,
          }}>
            <button
              type="button"
              onClick={onClose}
              className="addbook-modal-cancel"
              style={{
                padding: '8px 18px',
                borderRadius: 980,
                border: '0.5px solid hsl(var(--border) / 0.6)',
                background: 'rgb(var(--glass-tint) / 0.5)',
                backdropFilter: 'blur(12px) saturate(150%)',
                WebkitBackdropFilter: 'blur(12px) saturate(150%)',
                color: 'hsl(var(--foreground))',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s, border-color 0.2s, transform 0.2s',
                boxShadow: 'inset 0 1px 0 rgb(var(--glass-highlight) / 0.5)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgb(var(--glass-tint) / 0.7)';
                e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.9)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgb(var(--glass-tint) / 0.5)';
                e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.6)';
              }}
            >
              取消
            </button>
            <button
              className="nm-btn-apple-primary"
              style={{ width: 80, height: 34, padding: 0, fontSize: 13 }}
              disabled={isSubmitting}
              onClick={() => (document.querySelector('.addbook-form') as HTMLFormElement | null)?.requestSubmit()}
            >
              {editBook ? '保存' : '创建'}
            </button>
          </div>
        </form>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

