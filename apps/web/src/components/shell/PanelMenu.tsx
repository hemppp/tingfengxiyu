// ============================================================
// PanelMenu.tsx —— 面板入口（VS Code 式），取代退役的「功能转轮」
//
// ## 退役说明（ADR §0.3 / D15 · 本次重构的核心动作之一）
//   本文件**取代**了原 `components/shell/` 下的「功能转轮」组件（该文件已整体删除）：
//   一颗可拖动的「罗盘」主气泡，悬停时半圆铺开全部面板卫星气泡
//   （`fixed z-50` + 旋转缩放入场 + `localStorage` 记忆罗盘位置）。
//   该形态与 VS Code Dark Modern 的外壳语义冲突，**整体退役**。
//
//   按 ADR §0.3 的用词，「气泡」在本仓有三个含义，此处退役的是
//   **功能转轮**这一种；「内置气泡槽」（`BuiltinPanelDef` 注册的
//   `'chapters'` / `'ai-chat'` 面板定义）作为**扩展点保留**（§3.3），
//   「面板」本身保留（§1）。
//
// ## 取代形态（ADR §0.3 表：功能转轮 → 活动栏 / 侧边栏 / 面板菜单）
//   1. **活动栏**（最左窄条）—— 由 DockShell 从候选池派生，见 `DockShell.tsx`。
//   2. **侧边栏**（主侧栏）—— 同样由 DockShell 承载。
//   3. **面板菜单** —— 就是本文件：顶栏右侧的一个下拉菜单，
//      按 `order` 排序列出候选池全部面板，点击 = 打开或聚焦。
//
// ## 职责边界
//   本组件是**纯入口**，不渲染任何面板本体：
//   · 面板本体由 `DockShell`（dockview）承载
//   · 打开状态在 `usePanelOpenStore`
//   · 打开动作经 `getPanelNavigation().open(key)`（ADR §2.3.1 命令式单例）
//
// ## 颜色
//   全部取自 `--vscode-*`（ADR §5.3 / 约定 C-3：不写自带兜底的
//   `var(--x, #fff)`）。类名沿用 `nm-*`（D15：保留类名、只换值）。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Layers, Puzzle } from 'lucide-react';
import type { FloatingPanelDef } from '@/plugin/types';
import { usePanelOpenStore, getPanelNavigation } from '@/stores/panelOpenStore';

interface PanelMenuProps {
  /** 候选面板定义池（已按 project.mode 过滤；由 ProjectLayout 传入） */
  panels: FloatingPanelDef[];
}

/**
 * 顶栏「面板」下拉菜单 —— 功能转轮的替代入口。
 *
 * 交互与 VS Code 的命令浮层一致：点击开合、`Esc` 关闭、点击外部关闭、
 * 打开项高亮。**不再有**悬停开花 / 拖拽 / 半圆几何 / 位置持久化。
 */
export function PanelMenu({ panels }: PanelMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 已打开 key：订阅 store（点击后立即反映高亮态）
  const openKeys = usePanelOpenStore((s) => s.keys);

  const close = useCallback(() => setOpen(false), []);

  // Esc 关闭 + 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, close]);

  const onPick = useCallback((key: string) => {
    // ADR §2.3.1：非 React 派发点一律走命令式单例；此处虽是 React，
    // 仍统一走同一入口，保证「排队回放」（§2.4）与事件桥行为逐字一致。
    getPanelNavigation().open(key);
    setOpen(false);
  }, []);

  // 候选池为空 ⇒ 不渲染入口（与转轮「panels.length === 0 → null」语义一致）
  if (panels.length === 0) return null;

  return (
    <div className="panel-menu" ref={rootRef}>
      <button
        type="button"
        className="nm-btn-apple-icon-sm panel-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="面板菜单"
        title="面板"
        onClick={() => setOpen((v) => !v)}
      >
        <Layers size={15} aria-hidden="true" />
        <ChevronDown size={11} aria-hidden="true" className="panel-menu-caret" />
      </button>

      {open && (
        <div className="panel-menu-popover" role="menu" aria-label="面板">
          <div className="panel-menu-header">面板</div>
          <ul className="panel-menu-list">
            {panels.map((p) => {
              const Icon = p.icon ?? Puzzle;
              const active = openKeys.includes(p.key);
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    role="menuitem"
                    className={active ? 'panel-menu-item is-active' : 'panel-menu-item'}
                    aria-pressed={active}
                    title={active ? `${p.label}（已打开，点击聚焦）` : p.label}
                    onClick={() => onPick(p.key)}
                  >
                    <span className="panel-menu-item-icon">
                      <Icon size={14} aria-hidden="true" />
                    </span>
                    <span className="panel-menu-item-label">{p.label}</span>
                    {active && <span className="panel-menu-item-dot" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
