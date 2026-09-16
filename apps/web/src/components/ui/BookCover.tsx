import React, { useMemo } from 'react';
import type { Project } from '@novel/shared';

/**
 * 程序化小说封面 — 根据 book.id 哈希选一套中国风模板。
 * 每次新书用新的 id 即得到新封面；同一本书 id 永远显示同一封面（确定性随机）。
 * 不依赖外部图片，零网络请求。
 */

const hashCode = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** 8 套中国风"空山雨后"主题封面 */
type TemplateKind = 'mountains' | 'bamboo' | 'clouds' | 'moon' | 'pagoda' | 'rain' | 'waves' | 'plum';

interface Template {
  kind: TemplateKind;
  label: string;
  /** 三段渐变：从上到下 */
  gradient: [string, string, string];
  /** 装饰色：用于 SVG 描边/填充 */
  ink: string;
  inkSoft: string;
  /** 卷印记印色 */
  seal: string;
}

const TEMPLATES: Template[] = [
  {
    kind: 'mountains',
    label: '远山',
    gradient: ['#e9e9e9', '#c8c8c8', '#8e8e8e'],
    ink: 'rgba(28, 28, 28, 0.78)',
    inkSoft: 'rgba(28, 28, 28, 0.32)',
    seal: '#3a3a3a',
  },
  {
    kind: 'bamboo',
    label: '竹影',
    gradient: ['#e2e2e2', '#b0b0b0', '#6a6a6a'],
    ink: 'rgba(28, 28, 28, 0.82)',
    inkSoft: 'rgba(28, 28, 28, 0.30)',
    seal: '#3a3a3a',
  },
  {
    kind: 'clouds',
    label: '云海',
    gradient: ['#f3f3f3', '#d8d8d8', '#a4a4a4'],
    ink: 'rgba(28, 28, 28, 0.72)',
    inkSoft: 'rgba(28, 28, 28, 0.28)',
    seal: '#3a3a3a',
  },
  {
    kind: 'moon',
    label: '秋月',
    gradient: ['#e6e6e6', '#b8b8b8', '#6b6b6b'],
    ink: 'rgba(28, 28, 28, 0.82)',
    inkSoft: 'rgba(28, 28, 28, 0.32)',
    seal: '#3a3a3a',
  },
  {
    kind: 'pagoda',
    label: '古寺',
    gradient: ['#e8e8e8', '#b8b8b8', '#6e6e6e'],
    ink: 'rgba(28, 28, 28, 0.82)',
    inkSoft: 'rgba(28, 28, 28, 0.32)',
    seal: '#3a3a3a',
  },
  {
    kind: 'rain',
    label: '听雨',
    gradient: ['#dcdcdc', '#a8a8a8', '#6a6a6a'],
    ink: 'rgba(28, 28, 28, 0.80)',
    inkSoft: 'rgba(28, 28, 28, 0.30)',
    seal: '#3a3a3a',
  },
  {
    kind: 'waves',
    label: '碧波',
    gradient: ['#e0e0e0', '#a0a0a0', '#4e4e4e'],
    ink: 'rgba(28, 28, 28, 0.82)',
    inkSoft: 'rgba(28, 28, 28, 0.30)',
    seal: '#3a3a3a',
  },
  {
    kind: 'plum',
    label: '寒梅',
    gradient: ['#ececec', '#c8c8c8', '#7a7a7a'],
    ink: 'rgba(28, 28, 28, 0.80)',
    inkSoft: 'rgba(28, 28, 28, 0.30)',
    seal: '#3a3a3a',
  },
];

/** 装饰元素：远山 */
const Mountains = ({ ink, soft }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M0 78 L24 64 L46 76 L72 58 L96 72 L120 50 L150 70 L178 56 L200 72 L200 100 L0 100 Z" fill={soft} />
    <path d="M0 90 L30 80 L56 88 L82 76 L108 86 L138 72 L168 84 L200 78 L200 100 L0 100 Z" fill={ink} opacity="0.65" />
    <circle cx="160" cy="22" r="9" fill={soft} />
  </svg>
);

/** 装饰元素：竹子 */
const Bamboo = ({ ink, soft }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    {[20, 55, 100, 145, 180].map((x, i) => (
      <g key={i} opacity="0.6">
        <line x1={x} y1={i % 2 === 0 ? 20 : 30} x2={x} y2={i % 2 === 0 ? 92 : 95} stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
        {[36, 56, 78].map((y, j) => (
          <line key={j} x1={x - 4} y1={y} x2={x + 4} y2={y} stroke={ink} strokeWidth="1.2" />
        ))}
        <path d={`M${x + 1} 28 Q${x + 18} ${28 + (i % 2) * 2} ${x + 26} ${28}`} stroke={soft} strokeWidth="1.4" fill="none" />
        <path d={`M${x - 1} 50 Q${x - 18} ${54} ${x - 24} ${50}`} stroke={soft} strokeWidth="1.4" fill="none" />
      </g>
    ))}
  </svg>
);

/** 装饰元素：云带 */
const Clouds = ({ ink, soft }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M-10 38 Q20 30 50 38 T110 38 T170 38 T220 38 L220 50 Q190 58 150 50 T90 50 T30 50 T-10 50 Z" fill={soft} opacity="0.85" />
    <path d="M-10 64 Q30 56 70 64 T130 64 T200 64 T240 64 L240 76 Q200 84 160 76 T100 76 T40 76 T-10 76 Z" fill={ink} opacity="0.55" />
    <path d="M-10 86 Q40 78 80 86 T160 86 T240 86 L240 100 L-10 100 Z" fill={ink} opacity="0.85" />
  </svg>
);

/** 装饰元素：秋月 */
const Moon = ({ ink, soft }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <circle cx="148" cy="28" r="18" fill={soft} />
    <circle cx="148" cy="28" r="18" fill="none" stroke={ink} strokeWidth="0.6" opacity="0.5" />
    <path d="M0 88 Q30 78 60 84 T120 82 T200 86 L200 100 L0 100 Z" fill={ink} opacity="0.5" />
    <path d="M0 94 Q40 88 80 92 T160 92 T200 94 L200 100 L0 100 Z" fill={ink} opacity="0.8" />
    {/* 几颗小点：星 */}
    {[[28, 18], [56, 30], [80, 14], [110, 26], [30, 50], [70, 46]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r="0.8" fill={ink} opacity="0.7" />
    ))}
  </svg>
);

/** 装饰元素：古塔 */
const Pagoda = ({ ink }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M0 80 Q40 70 80 76 T160 74 T200 80 L200 100 L0 100 Z" fill={ink} opacity="0.5" />
    <path d="M0 90 Q50 84 100 88 T200 90 L200 100 L0 100 Z" fill={ink} opacity="0.85" />
    {/* 塔 */}
    <g transform="translate(100 28)">
      <rect x="-3" y="36" width="6" height="22" fill={ink} />
      <path d="M-7 36 L7 36 L5 32 L-5 32 Z" fill={ink} />
      <rect x="-4" y="22" width="8" height="10" fill={ink} />
      <path d="M-8 22 L8 22 L6 18 L-6 18 Z" fill={ink} />
      <rect x="-3" y="12" width="6" height="6" fill={ink} />
      <path d="M-6 12 L6 12 L4 9 L-4 9 Z" fill={ink} />
      <line x1="0" y1="0" x2="0" y2="9" stroke={ink} strokeWidth="1.2" />
      <circle cx="0" cy="0" r="1.2" fill={ink} />
    </g>
  </svg>
);

/** 装饰元素：雨 */
const Rain = ({ ink, soft }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    {Array.from({ length: 26 }).map((_, i) => {
      const x = (i * 13 + 7) % 200;
      const y = (i * 17 + 4) % 100;
      return <line key={i} x1={x} y1={y} x2={x - 2} y2={y + 8} stroke={ink} strokeWidth="0.6" opacity="0.55" />;
    })}
    <path d="M0 86 Q40 78 80 84 T160 82 T200 86 L200 100 L0 100 Z" fill={soft} opacity="0.55" />
    <path d="M0 92 Q50 88 100 92 T200 94 L200 100 L0 100 Z" fill={ink} opacity="0.7" />
  </svg>
);

/** 装饰元素：波 */
const Waves = ({ ink, soft }: { ink: string; soft: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M-10 50 Q20 44 50 50 T110 50 T170 50 T220 50" stroke={soft} strokeWidth="0.7" fill="none" opacity="0.6" />
    <path d="M-10 60 Q30 54 70 60 T130 60 T200 60 T240 60" stroke={ink} strokeWidth="0.8" fill="none" opacity="0.65" />
    <path d="M-10 72 Q40 66 80 72 T160 72 T240 72" stroke={ink} strokeWidth="0.9" fill="none" opacity="0.8" />
    <path d="M-10 86 Q50 80 100 86 T200 86 T240 86 L240 100 L-10 100 Z" fill={ink} opacity="0.85" />
  </svg>
);

/** 装饰元素：梅 */
const Plum = ({ ink, soft, seal }: { ink: string; soft: string; seal?: string }) => (
  <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M-10 92 Q60 84 120 90 T240 92 L240 100 L-10 100 Z" fill={ink} opacity="0.5" />
    {/* 梅枝 */}
    <path d="M20 30 Q60 50 110 60 Q150 66 180 76" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M20 30 Q60 50 110 60 Q150 66 180 76" stroke={soft} strokeWidth="0.6" fill="none" strokeLinecap="round" opacity="0.7" />
    <path d="M40 38 Q56 44 76 56" stroke={ink} strokeWidth="1.2" fill="none" />
    <path d="M90 50 Q104 58 124 64" stroke={ink} strokeWidth="1.2" fill="none" />
    {/* 梅花 */}
    {[[28, 28], [58, 42], [80, 54], [110, 60], [140, 66], [172, 74]].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`}>
        {[0, 72, 144, 216, 288].map((rot, k) => (
          <ellipse key={k} cx="0" cy="-3" rx="2.2" ry="3.4" fill={seal} opacity="0.78" transform={`rotate(${rot})`} />
        ))}
        <circle cx="0" cy="0" r="0.9" fill={ink} />
      </g>
    ))}
  </svg>
);

const ElementByKind: Record<TemplateKind, React.FC<{ ink: string; soft: string; seal?: string }>> = {
  mountains: Mountains,
  bamboo: Bamboo,
  clouds: Clouds,
  moon: Moon,
  pagoda: Pagoda,
  rain: Rain,
  waves: Waves,
  plum: Plum,
};

export interface BookCoverProps {
  book: Pick<Project, 'id' | 'name'>;
  className?: string;
  style?: React.CSSProperties;
  /** 显示大字号书名首字（默认 true） */
  showFirstChar?: boolean;
}

/**
 * 程序化小说封面。
 * - book.id 决定模板（确定性随机：同 id 永远同一封面）
 * - 8 套中国风：远山/竹/云/月/塔/雨/波/梅
 * - 显示渐变背景 + SVG 装饰 + 大首字 + 底部书名 + 卷印记印
 */
export const BookCover: React.FC<BookCoverProps> = ({ book, className, style, showFirstChar = true }) => {
  const idx = useMemo(() => {
    if (!book.id) return 0;
    return hashCode(book.id) % TEMPLATES.length;
  }, [book.id]);
  const tpl = TEMPLATES[idx]!;
  const Element = ElementByKind[tpl.kind];
  const firstChar = (book.name || '·').trim().charAt(0) || '·';

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(180deg, ${tpl.gradient[0]} 0%, ${tpl.gradient[1]} 50%, ${tpl.gradient[2]} 100%)`,
        ...style,
      }}
      aria-label={`${tpl.label}封面`}
    >
      {/* 装饰 SVG 层 */}
      <Element ink={tpl.ink} soft={tpl.inkSoft} seal={tpl.seal} />

      {/* 顶部细线 + 模板名（中文小字） */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          right: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: tpl.ink,
          opacity: 0.75,
        }}
      >
        <span
          style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: 10,
            letterSpacing: '0.4em',
            writingMode: 'vertical-rl',
            textOrientation: 'upright',
          }}
        >
          {tpl.label}
        </span>
        {/* 卷章记印 */}
        <span
          style={{
            display: 'inline-block',
            padding: '1px 5px',
            background: tpl.seal,
            color: 'rgba(245, 245, 245, 0.95)',
            fontFamily: "'Noto Serif SC', serif",
            fontSize: 9,
            letterSpacing: '0.1em',
            borderRadius: 1,
            boxShadow: '0 0 0 1px rgba(28, 28, 28, 0.06)',
          }}
        >
          卷
        </span>
      </div>

      {/* 中央大首字 */}
      {showFirstChar && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
              fontSize: 'min(38%, 92px)',
              fontWeight: 500,
              color: tpl.ink,
              opacity: 0.42,
              writingMode: 'vertical-rl',
              textOrientation: 'upright',
              lineHeight: 1,
              letterSpacing: '0.05em',
              userSelect: 'none',
            }}
          >
            {firstChar}
          </span>
        </div>
      )}

      {/* 底部书名 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 6,
          textAlign: 'center',
          color: tpl.ink,
          fontFamily: "'Noto Serif SC', 'Source Han Serif SC', serif",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.1em',
          padding: '0 8px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: 0.92,
        }}
        title={book.name}
      >
        {book.name || '未命名'}
      </div>
    </div>
  );
};

/** 工具：给一个项目生成确定性的封面色调/标签（用于统计/分组） */
export function getBookCoverMeta(book: Pick<Project, 'id'>): Template {
  const idx = book.id ? hashCode(book.id) % TEMPLATES.length : 0;
  return TEMPLATES[idx]!;
}
