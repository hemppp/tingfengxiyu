import { useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

interface RightSidebarProps {
  children: React.ReactNode;
}

export function RightSidebar({ children }: RightSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`shrink-0 glass-panel flex flex-col transition-all duration-300 font-[Inter,sans-serif]
        ${collapsed ? 'w-10' : 'w-80'}
      `}
      style={{ borderRadius: 0, borderRight: 'none', borderTop: 'none', borderBottom: 'none' }}
    >
      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="nm-btn-apple-icon h-10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-100 border-b border-border/50"
        title={collapsed ? '展开工具面板' : '收起工具面板'}
        aria-label={collapsed ? '展开工具面板' : '收起工具面板'}
      >
        {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
      </button>

      {/* 内容 */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
