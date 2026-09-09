import { type ReactNode, type ElementType } from 'react';

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
      className={`nm-panel-section glass-panel glass-edge-glow flex flex-col overflow-hidden ${grow === 'flex-1' ? 'flex-1' : ''} ${active ? 'nm-panel-section-active' : ''}`}
      style={{
        ...heightStyle,
        borderRadius: 28,
        border: 'none',
        boxShadow: '0 8px 32px rgba(31, 38, 80, 0.10), 0 2px 8px rgba(31, 38, 80, 0.06), inset 0 1px 0 rgba(255,255,255,0.5)',
      }}
      aria-label={title}
    >
      {/* 标题栏 */}
      <header
        className="nm-panel-section-header shrink-0 flex items-center gap-2 px-3 select-none"
        style={{
          height: headerHeight,
          cursor: onHeaderMouseDown ? (dragging ? 'grabbing' : 'grab') : undefined,
        }}
        onMouseDown={onHeaderMouseDown}
      >
        <span className="nm-panel-section-icon shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }}>
          <Icon size={13} aria-hidden="true" />
        </span>
        <h3
          className="text-[12px] font-[Noto_Serif_SC,serif] font-semibold tracking-wide flex-1 truncate"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          {title}
        </h3>
        {headerActions && (
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerActions}
          </div>
        )}
      </header>

      {/* 内容区 */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full border-2 border-transparent animate-spin"
                  style={{ borderTopColor: 'hsl(var(--mountain-cyan))', borderRightColor: 'hsl(var(--mountain-cyan))' }}
                />
                <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>加载中...</span>
              </div>
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
