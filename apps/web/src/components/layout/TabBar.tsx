// ============================================================
// TabBar —— 编辑器组的标签栏（IDE 语义）
//
// 与浏览器标签的区别（都对标 VSCode）：
//   · **组 1（variant='main'）只有一个不可关闭的「正文」标签**：它是主编辑器里打开的那份稿子
//   · **组 2（variant='side'）**才是可开可关的看板标签
//   · **单击 = 预览**（斜体，只有一个预览槽位，再点别的会顶掉它）；**双击 = 固定**
//   · 中键 / × / Ctrl+W 关闭；右键：关闭 / 关闭其他 / 关闭右侧 / 固定
//   · 溢出：横向滚动 + 右端下拉「已打开的看板」
//
// ★ 正文标签永不参与分页切换：它属于组 1，组 2 怎么切都动不到它。
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Pin, X, ChevronDown, Check } from 'lucide-react';
import { EDITOR_BG, type WorkbenchPanel } from './workspaceDefs';

interface TabBarProps {
  panels: WorkbenchPanel[];
  tabs: string[];
  active: string | null;
  /** 预览标签的 key（斜体显示） */
  previewKey?: string | null;
  /**
   * 'main'    = 主编辑器组（只有固定的正文项）
   * 'side'    = 侧编辑器组（可开可关的看板）
   * 'unified' = **合并档**（2026-09-15 新增）：正文 + 看板在**同一条**标签栏里。
   *   用于「页面切换」模式 —— 正文与看板互斥，点哪个标签哪个占满，
   *   像浏览器切标签页（作者在「看板占满全屏」的选项里选的这一档）。
   */
  variant?: 'main' | 'side' | 'unified';
  onActivate: (key: string) => void;
  onClose?: (key: string) => void;
  onCloseOthers?: (key: string) => void;
  onCloseRight?: (key: string) => void;
  onPromote?: (key: string) => void;
  /** 组 1 专属：点正文项 = 收起组 2、焦点回正文 */
  onBackToBody?: () => void;
  bodyFocused?: boolean;
  /** 溢出下拉里的「显示全部看板」入口（通常接 Ctrl+P） */
  onOpenQuick?: () => void;
  /** 拖动重排（from/to 都是 tabs 里的下标）—— IDE 的标签拖拽 */
  onMove?: (from: number, to: number) => void;
  /** 组 1 的正文标签上显示的副标题（如「第 2 章 · 8,420 字」） */
  bodySubtitle?: string;
  /**
   * 组 1：关闭「正文」标签。**传了才显示 ×** —— 宿主负责渲染关闭后的占位
   * 与「重新打开正文」入口（2026-09-15 起正文改为可关闭）。
   */
  onCloseBody?: () => void;
}

interface MenuState {
  key: string;
  x: number;
  y: number;
}

export function TabBar({
  panels, tabs, active, previewKey, variant = 'side',
  onActivate, onClose, onCloseOthers, onCloseRight, onPromote, onBackToBody, bodyFocused,
  onOpenQuick, bodySubtitle, onMove, onCloseBody,
}: TabBarProps) {
  const isMain = variant === 'main';
  /**
   * 「档位 → 显示什么」的两个派生判断（2026-09-15 加 unified 后统一走这里）：
   *   · showBody     —— 是否渲染固定的「正文」标签（main / unified）
   *   · showPaneTabs —— 是否渲染可开可关的看板标签（side / unified）
   * 原先散写 `isMain` / `!isMain`，加第三档后必须收口，否则必然漏改一处。
   */
  const showBody = variant !== 'side';
  const showPaneTabs = variant !== 'main';
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 点空白/按 Esc 收起菜单与溢出下拉
  useEffect(() => {
    if (!menu && !overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menu && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
      if (overflowOpen && !(e.target as HTMLElement).closest?.('[data-tab-overflow]')) setOverflowOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); setOverflowOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, overflowOpen]);

  const labelOf = (key: string) => panels.find((p) => p.key === key)?.label ?? key;
  const iconOf = (key: string) => {
    const Icon = panels.find((p) => p.key === key)?.icon;
    return Icon ? <Icon size={12} aria-hidden="true" /> : null;
  };

  return (
    <div
      className="shrink-0 flex items-stretch overflow-hidden relative"
      style={{
        // VSCode 的标签栏：一条浅色条 + 底边线，激活标签比条更亮、且顶部有一条强调线
        // ★ 2026-09-15「让标题贴紧」：35 → 30。它和下方 24px 的章节头部叠起来，
        //   在正文顶部占掉 59px；作者反馈这一块像「标签下面挂了一条空白带」。
        height: 30,
        // ★ 2026-09-15：底色改为**与正文区同色**（EDITOR_BG），消除「标签栏是一条独立横带」
        //   的色差断层 —— 作者反馈标签栏与正文之间看着像有道间隔（实测 gap 为 0，
        //   所以问题不在间距而在底色：secondary/0.55 ≈ 96% 明度 vs 正文 card/0.9 ≈ 99%）。
        //   选中态原本就有「顶部强调线 + 文字加深」，不依赖底色差异，所以去掉底色照样分得清。
        background: EDITOR_BG,
        borderBottom: '0.5px solid hsl(var(--border) / 0.7)',
      }}
    >
      {/* ── 组 1：「正文」主文档标签 ──
          ★ 2026-09-15 改为**可关闭**（作者要求「正文做可以关闭的页面」）。
          此前它是写死的 pinned（无关闭按钮、注释写「常驻，不可关闭」）。
          现在保留图钉图标（它仍是主文档）但给出 × —— 宿主负责渲染关闭后的占位
          与「重新打开正文」入口，所以关掉不会让人找不回来。 */}
      {showBody && (
        <div
          role="tab"
          aria-selected={!!bodyFocused}
          data-panel-key="__body__"
          data-pinned="false"
          tabIndex={0}
          onClick={onBackToBody}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBackToBody?.(); } }}
          title={onCloseBody ? '正文 —— 主编辑器里打开的那份稿子' : '正文 —— 主编辑器里打开的那份稿子（常驻，不可关闭）'}
          className="group shrink-0 flex items-center gap-1.5 cursor-pointer select-none"
          style={{
            height: '100%',
            padding: '0 10px',
            background: bodyFocused ? EDITOR_BG : 'transparent',
            borderRight: '0.5px solid hsl(var(--border) / 0.5)',
            // 激活标签：顶部强调线（VSCode 就是这条，不是底部下划线）
            boxShadow: bodyFocused ? 'inset 0 1px 0 hsl(var(--primary))' : undefined,
            color: bodyFocused ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            fontSize: 12.5,
          }}
        >
          <Pin size={12} aria-hidden="true" style={{ color: bodyFocused ? 'hsl(var(--primary))' : undefined }} />
          <span>正文</span>
          {bodySubtitle && (
            <span className="text-[10.5px]" style={{ color: 'hsl(var(--muted-foreground))' }}>{bodySubtitle}</span>
          )}
          {onCloseBody && (
            <button
              type="button"
              aria-label="关闭正文"
              data-close="__body__"
              onClick={(e) => { e.stopPropagation(); onCloseBody(); }}
              className={`shrink-0 flex items-center justify-center rounded ${bodyFocused ? '' : 'opacity-0 group-hover:opacity-100'}`}
              style={{
                width: 16, height: 16, background: 'transparent', border: 'none',
                color: 'inherit', cursor: 'pointer', opacity: bodyFocused ? 0.7 : undefined,
                transition: 'opacity 0.12s, background 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--foreground) / 0.1)'; e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = bodyFocused ? '0.7' : ''; }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div
        role="tablist"
        aria-label={variant === 'unified' ? '编辑器标签' : isMain ? '主编辑器组' : '侧编辑器组'}
        className="flex items-stretch flex-1 min-w-0 overflow-x-auto nm-tab-scroll"
      >
        {showPaneTabs && tabs.map((key, idx) => {
          const on = active === key;
          const isPreview = previewKey === key;
          return (
            <div
              key={key}
              role="tab"
              tabIndex={0}
              data-panel-key={key}
              data-preview={isPreview ? 'true' : undefined}
              aria-selected={on}
              onClick={() => onActivate(key)}
              onDoubleClick={() => onPromote?.(key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(key); } }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose?.(key); } }}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ key, x: e.clientX, y: e.clientY }); }}
              // 拖动重排：dataTransfer 里放下标（同区内重排，够用且不引第三方库）
              draggable={!!onMove}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (onMove) e.preventDefault(); }}
              onDrop={(e) => {
                if (!onMove) return;
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                if (Number.isFinite(from) && from !== idx) onMove(from, idx);
              }}
              title={`${labelOf(key)}${isPreview ? '（预览 —— 双击固定）' : ''}`}
              className="group shrink-0 flex items-center gap-1.5 cursor-pointer select-none"
              style={{
                height: '100%',
                // VSCode 的标签：最小宽约 120、最大约 240
                minWidth: 110,
                maxWidth: 200,
                padding: '0 8px 0 10px',
                background: on ? EDITOR_BG : 'transparent',
                borderRight: '0.5px solid hsl(var(--border) / 0.45)',
                boxShadow: on ? 'inset 0 1px 0 hsl(var(--primary))' : undefined,
                color: on ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                // VSCode 的预览标签：标题斜体
                fontStyle: isPreview ? 'italic' : 'normal',
                fontSize: 12.5,
              }}
            >
              {iconOf(key)}
              <span className="truncate flex-1">{labelOf(key)}</span>
              {/* ★ VSCode 的 × 只在**激活或悬停**的标签上出现（常显会让整排标签很吵） */}
              <button
                type="button"
                aria-label={`关闭${labelOf(key)}`}
                data-close={key}
                onClick={(e) => { e.stopPropagation(); onClose?.(key); }}
                className={`shrink-0 flex items-center justify-center rounded ${on ? '' : 'opacity-0 group-hover:opacity-100'}`}
                style={{
                  width: 16, height: 16, background: 'transparent', border: 'none',
                  color: 'inherit', cursor: 'pointer', opacity: on ? 0.7 : undefined,
                  transition: 'opacity 0.12s, background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--foreground) / 0.1)'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = on ? '0.7' : ''; }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 溢出下拉：窗口窄/标签多时，溢出标签从这里找（IDE 的「已打开的编辑器」） ── */}
      {showPaneTabs && tabs.length > 0 && (
        <div className="shrink-0 flex items-center" data-tab-overflow>
          <button
            type="button"
            aria-label="已打开的看板"
            onClick={() => setOverflowOpen((v) => !v)}
            title="已打开的看板"
            className="flex items-center justify-center"
            style={{ width: 26, height: '100%', background: 'transparent', border: 'none', borderLeft: '0.5px solid hsl(var(--border) / 0.5)', color: 'hsl(var(--muted-foreground))', cursor: 'pointer' }}
          >
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {overflowOpen && (
            <div
              className="absolute right-0 rounded-lg py-1 z-50"
              style={{
                top: 34, width: 220, maxHeight: 320, overflowY: 'auto',
                background: 'hsl(var(--card))', border: '0.5px solid hsl(var(--border))',
                boxShadow: '0 12px 32px hsl(var(--glass-shadow) / 0.18)',
              }}
            >
              {tabs.map((k) => (
                <button
                  key={k}
                  type="button"
                  data-overflow-item={k}
                  onClick={() => { onActivate(k); setOverflowOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 text-left"
                  style={{ height: 26, background: 'transparent', border: 'none', fontSize: 12, color: 'hsl(var(--foreground))', cursor: 'pointer' }}
                >
                  {iconOf(k)}
                  <span className="truncate flex-1">{labelOf(k)}</span>
                  {previewKey === k && <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>预览</span>}
                  {active === k && <Check size={11} style={{ color: 'hsl(var(--primary))' }} aria-hidden="true" />}
                </button>
              ))}
              {onOpenQuick && (
                <button
                  type="button"
                  onClick={() => { onOpenQuick(); setOverflowOpen(false); }}
                  className="w-full px-3 text-left"
                  style={{ height: 26, background: 'transparent', border: 'none', borderTop: '0.5px solid hsl(var(--border) / 0.5)', fontSize: 12, color: 'hsl(var(--primary))', cursor: 'pointer' }}
                >
                  显示全部看板…（Ctrl+P）
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 标签右键菜单 ── */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          data-tab-menu={menu.key}
          className="fixed rounded-lg py-1 z-[60]"
          style={{
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 170),
            width: 180,
            background: 'hsl(var(--card))',
            border: '0.5px solid hsl(var(--border))',
            boxShadow: '0 12px 32px hsl(var(--glass-shadow) / 0.2)',
          }}
        >
          {[
            { label: '关闭', run: () => onClose?.(menu.key) },
            { label: '关闭其他', run: () => onCloseOthers?.(menu.key) },
            { label: '关闭右侧', run: () => onCloseRight?.(menu.key) },
            {
              label: previewKey === menu.key ? '固定（取消预览）' : '固定',
              run: () => onPromote?.(menu.key),
            },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { item.run(); setMenu(null); }}
              className="w-full px-3 text-left"
              style={{ height: 26, background: 'transparent', border: 'none', fontSize: 12, color: 'hsl(var(--foreground))', cursor: 'pointer' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <style>{`
        .nm-tab-scroll::-webkit-scrollbar { height: 3px; }
        .nm-tab-scroll::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 2px; }
      `}</style>
    </div>
  );
}
