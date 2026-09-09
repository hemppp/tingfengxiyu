// ============================================================
// 编辑器面板栏（EditorPanelRail）—— 编辑器侧插件面板的开关入口
//
// 渲染注册表中 scope: 'editor' 的浮窗面板按钮（AI 扫描 / 节奏 / 文风 /
// 章节统计 / 本章批注，以及插件注册的同类面板）。点击切换面板开闭，
// 面板本体由 ProjectLayout 的浮窗宿主渲染（与顶栏面板同一套窗口机制）。
// 无面板注册时不渲染任何 DOM。
// ============================================================

import { usePluginRegistry } from '@/plugin/registry';
import { usePanelOpenStore } from '@/stores/panelOpenStore';

export function EditorPanelRail() {
  const panels = usePluginRegistry((s) => s.projectPanels).filter((p) => p.scope === 'editor');
  const openKeys = usePanelOpenStore((s) => s.keys);
  const toggle = usePanelOpenStore((s) => s.toggle);

  if (panels.length === 0) return null;

  return (
    <div
      className="absolute right-3 top-12 z-20 flex flex-col gap-1.5"
      role="toolbar"
      aria-label="编辑器面板栏"
    >
      {panels.map((p) => {
        const Icon = p.icon;
        const active = openKeys.includes(p.key);
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => toggle(p.key)}
            title={p.label}
            aria-label={p.label}
            aria-pressed={active}
            className="nm-btn-apple-icon-sm"
            style={active ? { background: 'hsl(var(--primary) / 0.14)', color: 'hsl(var(--primary))' } : undefined}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
