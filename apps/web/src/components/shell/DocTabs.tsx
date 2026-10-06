// ============================================================
// DocTabs.tsx —— 中心编辑区**文档标签行**（t1 外壳改造 / t6 去层）
//
// 截图形态：「第一章 山雨欲来 ×」「人物设定」「大纲 · 卷一」 + 最右「+」，
// 与左「章节」、右「AI 对话」**共用同一条 35px 头部带**。
//
// ## 去层（t6，用户口径「上栏多了一层」）
//   原先标签行是顶栏之下一条**独立的 30px 横条**（`.shell-doctabs` 常驻在
//   `.shell-topbar` 与 `.shell-main` 之间），于是顶部叠了三层：
//   顶栏 35 + 独立标签行 30 + dock 组头 35。参考图只有**两层**
//   （顶栏 + 一条「左标题 / 中标签 / 右标题」共用带）。
//   现改为把标签行**放进中心 dock 组的组头**（`tabComponent`），三列标题同处一带，
//   独立横条消失 —— 见 DockShell 的 `DOCK_DOC_TABS_TAB_COMPONENT_ID`。
//
//   ⚠️ dockview 的 tabComponent 经 `createPortal` 渲染进组头元素，**不继承宿主
//      React 上下文**（dockview-react 的 ReactPart 只提供它自己的 ReactPartContext）。
//      故本组件只读**模块级** store（useChapterStore / useOutlineStore /
//      panelOpenStore），不得依赖任何 Provider。
//   ⚠️ 本组件被渲染在 dockview 的 `[role="tab"]` 元素**内部**，因此自身**不能**再声明
//      `role="tablist"/"tab"`（嵌套交互元素是 a11y 反模式）。这里用
//      `role="group"` + 普通按钮 + `aria-current` 表达「当前文档」。
//
// ## 契约（t4 集成点）
//   · 「章节正文」= 真实文档：正文本身由中心区章节编辑器出口（`<Outlet/>`）渲染，
//     本标签只表达「当前文档是章节正文」；标题取 `useChapterStore` 的真实章节名
//     （`Chapter.title` 自带「第N章」前缀，见 apps/server/src/services/chapter-service.ts:277）。
//   · 「人物设定」「大纲」= **视图标签**：点击经 `getPanelNavigation().open(key)`
//     打开**真实面板**（key = `characters` / `outline`，注册于
//     apps/plugins/manual/workbench/web/panels.tsx）；× 关闭时同步关闭该面板。
//   · × 关闭后激活**相邻**标签（右邻优先）；关到 0 个不崩（activeId → null）；
//     「+」菜单可重新打开任一标签（三类都关掉后也能恢复）。
//   · 激活态＝顶部 2px 强调线（见 project-shell.css `.shell-doctab.is-active`）。
//
// 数据一律真实：无当前章节 ⇒ 标签回落「章节正文」；大纲卷名取 `useOutlineStore`
// 里 order 最小的顶层 act 节点标题，无数据时回落「卷一」。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { useChapterStore, useOutlineStore } from '@/stores';
import { getPanelNavigation } from '@/stores/panelOpenStore';

/** 一个文档标签。`kind==='chapter'` 是真实文档，其余是「打开某个面板」的视图标签。 */
export interface DocTab {
  id: string;
  kind: 'chapter' | 'panel';
  /** `kind==='panel'` 时指向真实面板 key（panels.tsx 注册表） */
  panelKey?: string;
  /** 静态标题；`kind==='chapter'` 与 `panelKey==='outline'` 的标题在渲染时按真实数据覆盖 */
  title: string;
}

/** 截图里的三类文档标签（「+」菜单与初始布局共用同一份定义）。 */
export const DOC_TAB_CATALOG: DocTab[] = [
  { id: 'doc:chapter', kind: 'chapter', title: '章节正文' },
  { id: 'doc:characters', kind: 'panel', panelKey: 'characters', title: '人物设定' },
  { id: 'doc:outline', kind: 'panel', panelKey: 'outline', title: '大纲 · 卷一' },
];

/** 初始标签集：截图默认三项全打开，激活「章节正文」。 */
export function initialDocTabs(): DocTab[] {
  return DOC_TAB_CATALOG.map((t) => ({ ...t }));
}

interface DocTabsState {
  tabs: DocTab[];
  activeId: string | null;
}

/**
 * 中心组组头里的文档标签行。
 *
 * dockview 会以 `IDockviewPanelHeaderProps` 调用它（本组件不消费这些 props）；
 * 参数声明为 `Partial` 且带缺省值，便于单测直接 `<DocTabsHeader />` 渲染。
 */
export function DocTabsHeader(_props: Partial<IDockviewPanelHeaderProps<never>> = {}) {
  const [state, setState] = useState<DocTabsState>(() => ({
    tabs: initialDocTabs(),
    activeId: DOC_TAB_CATALOG[0]?.id ?? null,
  }));
  // ---- 「+」菜单的定位（F2 修复） ----
  // 标签条 `.shell-doctabs` 是 `overflow:hidden`（防止标签条被撑破，
  // 这是必须保留的约束）。菜单若作为它的绝对定位子节点，会被裁到只剩几个像素，
  // 真实鼠标无法命中（t1 首版即此问题）。因此菜单改为 **portal 到 <body>**，
  // 用固定定位挂在自己算出的坐标上：不再有被 overflow 裁剪的祖先，
  // 也不参与标签条的布局（不换行、不横向溢出）。
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuOpen = menuPos !== null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 按「+」按钮的视口矩形摆放菜单（右对齐按钮右缘，下方 4px），并夹在视口内。
  const placeMenu = useCallback(() => {
    const btn = addBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({
      top: Math.round(r.bottom + 4),
      right: Math.round(Math.max(4, window.innerWidth - r.right)),
    });
  }, []);

  // ---- 真实数据源 ----
  // 当前章节名（无章节 ⇒ null，标签回落静态标题）
  const chapterTitle = useChapterStore((s) => s.getCurrentChapter()?.title ?? null);
  // 大纲卷名：order 最小的顶层 act 节点（无数据 ⇒ null，回落「卷一」）
  const outlineTitle = useOutlineStore((s) => {
    const acts = s.nodes.filter((n) => n.type === 'act').sort((a, b) => a.order - b.order);
    return acts[0]?.title ?? null;
  });

  const labelOf = useCallback(
    (t: DocTab): string => {
      if (t.kind === 'chapter') return chapterTitle ?? t.title;
      if (t.panelKey === 'outline') return '大纲 · ' + (outlineTitle ?? '卷一');
      return t.title;
    },
    [chapterTitle, outlineTitle],
  );

  // ---- 打开 / 激活 ----
  const openTab = useCallback((tab: DocTab) => {
    setState((s) =>
      s.tabs.some((t) => t.id === tab.id)
        ? { tabs: s.tabs, activeId: tab.id }
        : { tabs: [...s.tabs, { ...tab }], activeId: tab.id },
    );
    setMenuPos(null);
    // 真实动作：打开真实面板。DockShell 未 ready 时 `getPanelNavigation().open`
    // 会静默排队、ready 后回放（panelOpenStore 的既有语义）。
    if (tab.kind === 'panel' && tab.panelKey) getPanelNavigation().open(tab.panelKey);
  }, []);

  // ---- 关闭（切到相邻标签；关到 0 个不崩） ----
  const closeTab = useCallback(
    (id: string) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const closed = state.tabs[idx];
      if (!closed) return;
      const tabs = state.tabs.filter((t) => t.id !== id);
      // 右邻优先（同 index），越界取左邻；tabs 为空时 `undefined` ⇒ activeId = null
      const neighbor = tabs[Math.min(idx, tabs.length - 1)];
      const activeId = state.activeId === id ? (neighbor?.id ?? null) : state.activeId;
      setState({ tabs, activeId });
      // 视图标签 ⇒ 同步关闭它代表的真实面板
      if (closed.kind === 'panel' && closed.panelKey) getPanelNavigation().close(closed.panelKey);
    },
    [state],
  );

  // ---- 「+」菜单：点外部 / Esc 关闭；视口或任意祖先滚动时重算位置 ----
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // 菜单已 portal 到 body，不在 rootRef 里，需单独判归属
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuPos(null);
    };
    const onReflow = () => placeMenu();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [menuOpen, placeMenu]);

  return (
    <div className="shell-doctabs" ref={rootRef} role="group" aria-label="文档标签">
      <div className="shell-doctabs-list">
        {state.tabs.map((t) => {
          const active = t.id === state.activeId;
          const label = labelOf(t);
          return (
            <div
              key={t.id}
              className={active ? 'shell-doctab is-active' : 'shell-doctab'}
            >
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                className="shell-doctab-main"
                title={label}
                onClick={() => openTab(t)}
              >
                <span className="shell-doctab-label">{label}</span>
              </button>
              <button
                type="button"
                className="shell-doctab-close"
                aria-label={'关闭 ' + label}
                title="关闭"
                onClick={() => closeTab(t.id)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="shell-doctabs-actions">
        <button
          type="button"
          className="shell-doctab-add"
          ref={addBtnRef}
          aria-label="打开文档标签"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="打开文档标签"
          onClick={() => (menuOpen ? setMenuPos(null) : placeMenu())}
        >
          <Plus size={13} aria-hidden="true" />
        </button>
        {menuPos
          ? createPortal(
              <div
                ref={menuRef}
                className="shell-doctab-menu"
                role="menu"
                style={{ top: menuPos.top, right: menuPos.right }}
              >
                {DOC_TAB_CATALOG.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    className="shell-doctab-menu-item"
                    onClick={() => openTab(t)}
                  >
                    {labelOf(t)}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}
