// ============================================================
// DocTabs.tsx —— 中心编辑区**文档标签行**（t1 外壳改造 / t6 去层 / ★ 全动态标签）
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
//      故本组件只读**模块级** store / 注册表（useChapterStore / useOutlineStore /
//      panelOpenStore / usePluginRegistry / useProjectMode），不得依赖任何 Provider。
//   ⚠️ 本组件被渲染在 dockview 的 `[role="tab"]` 元素**内部**，因此自身**不能**再声明
//      `role="tablist"/"tab"`（嵌套交互元素是 a11y 反模式）。这里用
//      `role="group"` + 普通按钮 + `aria-current` 表达「当前文档」。
//
// ## ★ 2026-10-11 全动态标签（用户口径「点击打开功能需要和人物设定一样的在这个栏里面
//    可以关闭」→「全部功能都需要变成动态标签」）
//
//   本栏现在**只表达「打开了什么」**：
//     · 第 1 格恒为「章节正文」——**基础标签**：中心文档本身，不是功能面板，
//       不受任何面板开关影响（「+」菜单可在它被关掉后恢复）。
//     · 其后每一格 = `panelOpenStore.keys` 里的一个已打开面板，**一视同仁**：
//       章节树 / AI 对话 / 人物设定 / 大纲 / 时间线 … 没有任何面板被特殊对待。
//       （此前「目录三件套固定 + 常驻栏例外」的口径已按用户口径废弃。）
//     · × = 关闭它代表的面板（`getPanelNavigation().close(key)`）；
//       面板在**别处**被关闭（活动栏收起 / 上限淘汰 / 面板内关闭）⇒ 标签自动消失。
//     · 「+」菜单 = 面板候选池（与顶栏面板菜单**同一口径**：内置槽 ∪ 插件面板、
//       按 key 去重、按项目模式过滤、保持注册表 order），点击 = 打开或聚焦，
//       已打开的项带「已打开」标记。
//
//   真源唯一 = `panelOpenStore.keys`（打开集合）+ 插件注册表（标题）。
//   ⚠️ store 的既有上限 `MAX_OPEN_PANELS = 3`（超限 LRU 淘汰 + toast）照旧生效，
//      标签条数随之增减；本组件**不做**任何补偿或绕过。
//
// ## 契约
//   · × 关闭后激活**相邻**标签（右邻优先）；关到 0 个不崩（activeId → null）。
//   · 面板被聚焦（点活动栏 / 命令式 open）⇒ 对应标签跟着激活。
//   · 激活态＝顶部 2px 强调线（见 project-shell.css `.shell-doctab.is-active`）。
//
// 数据一律真实：无当前章节 ⇒ 基础标签回落「章节正文」；大纲面板的标签取
// `useOutlineStore` 里 order 最小的顶层 act 节点标题，无数据时回落「卷一」。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { useChapterStore, useOutlineStore } from '@/stores';
import { BASE_TAB_KEY, focusDocBase, getPanelNavigation, usePanelOpenStore } from '@/stores/panelOpenStore';
import { filterByProjectMode, usePluginRegistry, useProjectMode } from '@/plugin/registry';
import type { PluginMode } from '@/plugin/types';

/** 一个文档标签。`kind==='chapter'` 是基础文档标签，`'panel'` 代表一个已打开的功能面板。 */
export interface DocTab {
  id: string;
  kind: 'chapter' | 'panel';
  /** `kind==='panel'` 时指向真实面板 key（注册表） */
  panelKey?: string;
  /** 静态标题；基础标签与 `panelKey==='outline'` 的标题在渲染时按真实数据覆盖 */
  title: string;
}

/**
 * ★ 基础标签（永远排在第 1 格）：中心文档 = 章节正文。
 * 它不是功能面板 —— 正文由中心区章节编辑器出口（`<Outlet/>`）渲染，
 * 本标签只表达「当前文档是章节正文」；标题取 `useChapterStore` 的真实章节名
 * （`Chapter.title` 自带「第N章」前缀，见 apps/server/src/services/chapter-service.ts:277）。
 */
export const DOC_BASE_TAB: DocTab = { id: BASE_TAB_KEY, kind: 'chapter', title: '章节正文' };

/** 功能面板标签的 id 前缀（`doc:panel:<key>`）——它们由 `panelOpenStore.keys` 推导，不进本地状态。 */
const DYNAMIC_TAB_PREFIX = 'doc:panel:';

/** 「+」菜单里的一条候选面板（与 ProjectLayout 合池口径一致的最小字段集）。 */
interface PanelEntry {
  key: string;
  label: string;
  modes?: PluginMode[];
  order?: number;
}

interface DocTabsState {
  /**
   * ★ 2026-10-11：本地状态**只**承载「当前激活的是哪条标签」。
   * 标签集合（基础标签 + 功能面板）全部由 `panelOpenStore` 推导 —— 基础标签的
   * 开/关真源是 `store.baseOpen`，功能面板是 `store.keys`。
   */
  activeId: string | null;
}

/**
 * 中心组组头里的文档标签行。
 *
 * dockview 会以 `IDockviewPanelHeaderProps` 调用它（本组件不消费这些 props）；
 * 参数声明为 `Partial` 且带缺省值，便于单测直接 `<DocTabsHeader />` 渲染。
 */
export function DocTabsHeader(_props: Partial<IDockviewPanelHeaderProps<never>> = {}) {
  const [state, setState] = useState<DocTabsState>(() => ({ activeId: DOC_BASE_TAB.id }));
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

  // ---- ★ 动态标签真源（见文件头「全动态标签」） ----
  const openPanelKeys = usePanelOpenStore((s) => s.keys);
  const focusedPanelKey = usePanelOpenStore((s) => s.activeKey);
  // ★ 2026-10-11：基础标签（章节正文）也由 store 驱动（可关、计入总上限）
  const baseOpen = usePanelOpenStore((s) => s.baseOpen);
  const builtinPanels = usePluginRegistry((s) => s.builtinPanels);
  const projectPanels = usePluginRegistry((s) => s.projectPanels);
  const projectMode = useProjectMode();

  // 候选池：内置槽 ∪ 插件面板（按 key 去重、内置优先）→ 按项目模式过滤。
  // ★ 与 ProjectLayout 的合池口径**同源**（那边多带 Component / dock 字段供 dockview 用）；
  //   顺序沿用注册表排序（`order`），与活动栏 / 顶栏面板菜单一致。
  const panelCatalog = useMemo<PanelEntry[]>(() => {
    const byKey = new Map<string, PanelEntry>();
    for (const b of builtinPanels) {
      if (b) byKey.set(b.key, { key: b.key, label: b.label ?? b.key, modes: b.modes, order: b.order });
    }
    for (const p of projectPanels) {
      if (p && !byKey.has(p.key)) {
        byKey.set(p.key, { key: p.key, label: p.label ?? p.key, modes: p.modes, order: p.order });
      }
    }
    return filterByProjectMode(Array.from(byKey.values()), projectMode);
  }, [builtinPanels, projectPanels, projectMode]);

  // 面板标题：注册表 label；未注册（模块仍在加载）⇒ 回落 key 本身，标签仍然可关
  const panelLabelOf = useCallback(
    (key: string): string => panelCatalog.find((p) => p.key === key)?.label ?? key,
    [panelCatalog],
  );

  /** 每个已打开面板一条标签，顺序 = 打开顺序（`panelOpenStore.keys`）。 */
  const dynamicTabs = useMemo<DocTab[]>(
    () =>
      openPanelKeys.map((k) => ({
        id: DYNAMIC_TAB_PREFIX + k,
        kind: 'panel' as const,
        panelKey: k,
        title: panelLabelOf(k),
      })),
    [openPanelKeys, panelLabelOf],
  );

  /**
   * 实际渲染的标签 = 基础标签（`store.baseOpen` 为真时，恒排第 1 格）+ 功能面板标签。
   * ★ 2026-10-11：基础标签也计入总上限（由 store 在打开面板时裁剪保证），且可被 × 关闭。
   */
  const tabs = useMemo<DocTab[]>(
    () => (baseOpen ? [{ ...DOC_BASE_TAB }, ...dynamicTabs] : dynamicTabs),
    [baseOpen, dynamicTabs],
  );

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
    setState((s) => (s.activeId === tab.id ? s : { ...s, activeId: tab.id }));
    setMenuPos(null);
    // 真实动作（标签集合由 store 推导，这里只切激活态 + 触发打开）：
    //  · 基础标签（章节正文）= 中心编辑区本身，不是业务面板 ⇒ store 置 baseOpen + 切回中心组；
    //  · 功能面板标签 ⇒ 打开/聚焦真实面板（未 ready 时静默排队、ready 后回放）。
    if (tab.kind === 'chapter') {
      usePanelOpenStore.getState().openBase();
      focusDocBase();
    } else if (tab.panelKey) {
      getPanelNavigation().open(tab.panelKey);
    }
  }, []);

  // ---- 关闭（切到相邻标签；关到 0 个不崩） ----
  const closeTab = useCallback(
    (id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const closed = tabs[idx];
      if (!closed) return;
      // 关掉它代表的真实对象（标签随之从 store 推导中消失）：
      //  · 基础标签 ⇒ store.closeBase()（中心文档标签退场，可经「+」菜单恢复）
      //  · 功能面板 ⇒ getPanelNavigation().close(key)
      if (closed.kind === 'chapter') usePanelOpenStore.getState().closeBase();
      else if (closed.kind === 'panel' && closed.panelKey) getPanelNavigation().close(closed.panelKey);
      const remaining = tabs.filter((t) => t.id !== id);
      // 右邻优先（同 index），越界取左邻；remaining 为空时 `undefined` ⇒ activeId = null
      const neighbor = remaining[Math.min(idx, remaining.length - 1)];
      setState((s) => (s.activeId === id ? { activeId: neighbor?.id ?? null } : s));
    },
    [tabs],
  );

  // 面板被聚焦（点活动栏 / 命令式 open / 在面板里操作）⇒ 对应标签跟着激活，
  // 让「刚点开的那一项」在栏里立刻是当前项（而不是仍停在「章节正文」）。
  useEffect(() => {
    if (!focusedPanelKey) return;
    const hit = tabs.find((t) => t.kind === 'panel' && t.panelKey === focusedPanelKey);
    if (!hit) return;
    setState((s) => (s.activeId === hit.id ? s : { ...s, activeId: hit.id }));
  }, [focusedPanelKey, tabs]);

  // 标签在别处消失（活动栏收起 / 上限淘汰 / 基础标签被关）⇒ 若当时的激活项正是它，
  // 落回第一个标签，避免出现「标签区没有激活项」的空档。
  useEffect(() => {
    setState((s) => {
      if (!s.activeId) return s;
      if (tabs.some((t) => t.id === s.activeId)) return s;
      return { activeId: tabs[0]?.id ?? null };
    });
  }, [tabs]);

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
        {tabs.map((t) => {
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
          title="打开功能"
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
                aria-label="打开功能"
                style={{ top: menuPos.top, right: menuPos.right }}
              >
                {/* 基础标签（正文）——被关掉后从这里恢复；点它 = 回到正文 */}
                <button
                  type="button"
                  role="menuitem"
                  aria-pressed={baseOpen}
                  className={baseOpen ? 'shell-doctab-menu-item is-open' : 'shell-doctab-menu-item'}
                  onClick={() => openTab(DOC_BASE_TAB)}
                >
                  {labelOf(DOC_BASE_TAB)}
                </button>
                <div className="shell-doctab-menu-sep" aria-hidden="true" />
                {/* 功能面板候选池：点击 = 打开（已打开 ⇒ 聚焦，不重复开） */}
                {panelCatalog.map((p) => {
                  const isOpen = openPanelKeys.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      role="menuitem"
                      aria-pressed={isOpen}
                      title={isOpen ? `${p.label}（已打开，点击聚焦）` : p.label}
                      className={isOpen ? 'shell-doctab-menu-item is-open' : 'shell-doctab-menu-item'}
                      onClick={() =>
                        openTab({
                          id: DYNAMIC_TAB_PREFIX + p.key,
                          kind: 'panel',
                          panelKey: p.key,
                          title: p.label,
                        })
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}
