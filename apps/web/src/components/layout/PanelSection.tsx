import { type ReactNode, type ElementType } from 'react';
import { LoadingPixels } from '@/components/ai/primitives';

export interface PanelSectionProps {
  title: string;
  icon: ElementType;
  children: ReactNode;
  /** 是否折叠 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** flex 行为：'flex-1' = 占满剩余空间；'none' = 按内容高度 */
  grow?: 'flex-1' | 'none';
  /** 折叠时的最小高度（顶部标题栏） */
  headerHeight?: number;
  /** 右侧额外操作 */
  headerActions?: ReactNode;
  /** 用于 z-index / 选中态 */
  active?: boolean;
  /** 加载状态：显示 skeleton */
  loading?: boolean;
  /** 标题栏鼠标按下：用于浮窗拖拽 */
  onHeaderMouseDown?: (e: React.MouseEvent) => void;
  /** 拖拽中状态（用于光标/视觉反馈） */
  dragging?: boolean;
}

/**
 * 三栏布局中的可折叠面板
 * - 标题栏：图标 + 标题 + 操作区
 * - 内容区：可滚动
 * - 折叠时仅显示标题栏
 */
export function PanelSection({
  title,
  icon: Icon,
  children,
  collapsed = false,
  onToggleCollapsed: _onToggleCollapsed,
  grow = 'flex-1',
  headerHeight = 36,
  headerActions,
  active = false,
  loading = false,
  onHeaderMouseDown,
  dragging = false,
}: PanelSectionProps) {
  const heightStyle: React.CSSProperties = { minHeight: collapsed ? headerHeight : undefined };

  return (
    <section
      /* 墨韵工艺层改造（2026-09-18）：
         · 原来 `borderRadius: 28` + 硬编码阴影
           `0 8px 32px rgba(31,38,80,…)` —— 那个 (31,38,80) 是**偏蓝**的，
             属「青霭玻璃」时代的残留。全站已迁到中性墨黑投影
             （globals.css: "投影自中性墨黑发出，而非靛蓝"），这里是漏网的一处。
             现改用 --shadow-raised 档位令牌，与其它面板同一套。
         · 圆角 28px → --radius-window(14px)：28 远超这套体系的最大档位，
             在已收窄的面板内显得"玩具化"，14px 与全站其它容器对齐。 */
      className={`nm-panel-section glass-panel glass-edge-glow flex flex-col overflow-hidden rounded-window border-0 shadow-raised ${
        grow === 'flex-1' ? 'flex-1' : ''
      } ${active ? 'nm-panel-section-active' : ''}`}
      style={heightStyle}
      aria-label={title}
    >
      {/* 标题栏 */}
      <header
        className="nm-panel-section-header flex shrink-0 select-none items-center gap-2 px-3"
        style={{
          height: headerHeight,
          cursor: onHeaderMouseDown ? (dragging ? 'grabbing' : 'grab') : undefined,
        }}
        onMouseDown={onHeaderMouseDown}
      >
        <span className="nm-panel-section-icon shrink-0 text-tone-3">
          <Icon size={13} aria-hidden="true" />
        </span>
        <h3 className="flex-1 truncate text-[12px] font-semibold tracking-wide text-tone font-[Noto_Serif_SC,serif]">
          {title}
        </h3>
        {headerActions && (
          <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {headerActions}
          </div>
        )}
      </header>

      {/* 内容区 */}
      {!collapsed && (
        <div className="relative flex-1 overflow-hidden">
          {loading ? (
            /* 原来是 borderTopColor/RightColor 手搓的转圈。
               改用像素网格加载器：单一元素、无边框技巧、与全站加载态统一。 */
            <div className="flex h-full items-center justify-center">
              <LoadingPixels label="加载中" />
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
