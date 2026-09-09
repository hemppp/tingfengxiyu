import { useState, memo, useEffect, useRef, useCallback } from 'react';
import type { Project } from '@novel/shared';
import { formatDistanceToNow } from '@/utils/date';
import { MoreVertical, Pencil, Trash2, BookOpen, Clock, FileText } from 'lucide-react';
import { BookCover } from './BookCover';
import { useGlassRipple } from '@/hooks/useGlassRipple';

interface BookCardProps {
  book: Project;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  chapterCount?: number;
  index?: number;
  className?: string;
}

const DROPDOWN_ITEM_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'transparent',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.15s',
  fontFamily: "'Noto Serif SC', serif",
};

const BookCard = memo(function BookCard({ book, onClick, onEdit, onDelete, chapterCount = 0, index: _index = 0, className }: BookCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const handlePointerDown = useGlassRipple<HTMLDivElement>();

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const {
    name: bookName,
    penName: bookAuthor,
    genre: bookGenre = '未分类',
    currentWordCount: bookWordCountRaw = 0,
    updatedAt,
  } = book;

  const wordCountDisplay = (() => {
    const wc = bookWordCountRaw;
    return wc >= 10000
      ? `${(wc / 10000).toFixed(1)}万字`
      : `${wc.toLocaleString()} 字`;
  })();

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => { setIsHovered(false); setIsPressed(false); }, []);
  const handleMouseDown = useCallback(() => setIsPressed(true), []);
  const handleMouseUp = useCallback(() => setIsPressed(false), []);
  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(prev => !prev);
  }, []);

  return (
    <div
      ref={cardRef}
      className={`${className} glass-ripple glass-pressable`}
      style={{
        position: 'relative',
        cursor: 'pointer',
        borderRadius: 20,
        overflow: 'hidden',
        aspectRatio: '3 / 4',
        transition: 'transform 0.4s cubic-bezier(0.16,1,0.3,1), box-shadow 0.4s cubic-bezier(0.16,1,0.3,1)',
        boxShadow: isHovered
          ? '0 20px 50px hsl(var(--glass-shadow) / 0.35), 0 6px 16px hsl(var(--glass-shadow) / 0.20)'
          : '0 6px 20px hsl(var(--glass-shadow) / 0.18), 0 2px 6px hsl(var(--glass-shadow) / 0.10)',
        transform: isPressed
          ? 'translateY(-2px) scale(0.97)'
          : isHovered
          ? 'translateY(-6px) scale(1.02)'
          : 'translateY(0) scale(1)',
        animation: `slideTop 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${_index * 0.04}s both`,
      }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onPointerDown={handlePointerDown}
    >
      {/* 封面层 — 铺满整张卡片 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transition: 'transform 0.6s cubic-bezier(0.16,1,0.3,1)',
          transform: isHovered ? 'scale(1.08)' : 'scale(1)',
        }}
      >
        <BookCover
          book={book}
          showFirstChar={true}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* 顶部渐变遮罩 — 让 genre 标签和菜单按钮在亮色封面上也清晰 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 80,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* 底部渐变遮罩 — 让文字信息可读 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '55%',
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.75) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
          transition: 'opacity 0.3s ease',
          opacity: isHovered ? 1 : 0.92,
        }}
      />

      {/* 顶部：genre 标签 + 更多按钮 */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            border: '0.5px solid rgba(255,255,255,0.25)',
            fontSize: 11,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.92)',
            fontFamily: "'Noto Serif SC', serif",
            maxWidth: '70%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            letterSpacing: '0.04em',
          }}
        >
          {bookGenre}
        </span>
        <button
          onClick={handleMenuToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '0.5px solid rgba(255,255,255,0.2)',
            background: 'rgba(0,0,0,0.25)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            color: 'rgba(255,255,255,0.85)',
            cursor: 'pointer',
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.25s ease, background 0.2s, transform 0.15s',
            transform: isHovered ? 'translateY(0)' : 'translateY(-4px)',
            flexShrink: 0,
          }}
          aria-label="更多操作"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.25)'; }}
        >
          <MoreVertical size={13} />
        </button>
      </div>

      {/* 底部信息区 — 毛玻璃悬浮（haowallpaper 风格） */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 3,
          padding: '14px 14px 16px',
          transform: isHovered ? 'translateY(0)' : 'translateY(0)',
          transition: 'transform 0.35s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* 书名 */}
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.95)',
            margin: 0,
            lineHeight: 1.3,
            fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            letterSpacing: '0.02em',
          }}
        >
          {bookName}
        </h3>

        {/* 作者 */}
        {bookAuthor && (
          <p
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.65)',
              margin: '4px 0 0 0',
              fontFamily: "'Noto Serif SC', serif",
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {bookAuthor}
          </p>
        )}

        {/* 统计行 — 毛玻璃胶囊 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            padding: '5px 10px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.10)',
            backdropFilter: 'blur(14px) saturate(180%)',
            WebkitBackdropFilter: 'blur(14px) saturate(180%)',
            border: '0.5px solid rgba(255,255,255,0.15)',
            fontSize: 11,
            color: 'rgba(255,255,255,0.75)',
            fontFamily: "'Noto Serif SC', serif",
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <BookOpen size={10} />
            {wordCountDisplay}
          </span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <FileText size={10} />
            {chapterCount} 章
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: 0.8 }}>
            <Clock size={10} />
            {formatDistanceToNow(updatedAt || Date.now())}
          </span>
        </div>
      </div>

      {/* Dropdown 菜单 — 液态玻璃 */}
      {showMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            top: 44,
            right: 10,
            zIndex: 20,
            width: 140,
            borderRadius: 12,
            background: 'rgb(var(--glass-tint) / var(--glass-modal-bg))',
            backdropFilter: 'blur(40px) saturate(200%)',
            WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            border: '0.5px solid rgb(var(--glass-highlight) / 0.3)',
            boxShadow: '0 24px 64px hsl(var(--glass-shadow) / 0.18), 0 8px 24px hsl(var(--glass-shadow) / 0.08), inset 0 1px 0 rgb(var(--glass-highlight) / 0.8)',
            padding: '4px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.();
              setShowMenu(false);
            }}
            className="hover:bg-[hsl(var(--secondary))]"
            style={{
              ...DROPDOWN_ITEM_BASE,
              color: 'hsl(var(--foreground) / 0.75)',
            }}
          >
            <Pencil size={14} />
            编辑
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.();
              setShowMenu(false);
            }}
            className="hover:bg-destructive/10"
            style={{
              ...DROPDOWN_ITEM_BASE,
              color: 'hsl(var(--destructive))',
            }}
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}
    </div>
  );
});

export { BookCard };
