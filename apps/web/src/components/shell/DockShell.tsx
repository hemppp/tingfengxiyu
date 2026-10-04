// ============================================================
// DockShell.tsx — 停靠系统内核（P2 · t3）
//
// 用 dockview 实现 8 项能力（验收逐条对应）：
//   1. 多停靠面板，面板来源为**外部传入**的 `panels` 数组，不硬编码业务面板
//   2. 标题栏可拖拽 → 拖出为 dockview **floating group**（悬浮窗口），可再拖回
//   3. 上/下/左/右**四个 dock area** + **中心编辑区**，面板可吸附到任一 dock area
//   4. 同一 group 内**多面板标签堆叠**（Tabbed Dock Group），可拖出/拖入重组
//   5. 拖拽时**落点预览指示器**（Dock Preview Indicator），样式对齐 VS Code
//   6. **中心区为可替换插槽**，关系图/图谱以既有 `@xyflow/react` 承载（D16：无 C++/Qt）
//   7. 面板间**可拖动 Splitter** 调整大小（dockview sash；--dv-active-sash-color 接主题）
//   8. VS Code 式**外壳骨架**：活动栏 + 侧边栏 + 编辑区 + 底部面板区 + 状态栏 + 辅助侧栏
//
// 颜色：一律 `--vscode-*`（ADR §5.3）与 `--dv-*`（§5.5 经 .dv-theme-vscode 映射）。
//       本文件**不含任何字面色值**（约定 C-3：不写 `var(--x, #fff)` 兜底）。
//
// 依赖：dockview / dockview-react（t3 已在 apps/web/package.json 声明）。
// ============================================================

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  type DockviewReadyEvent,
  type DockviewApi,
  type DockviewTheme,
  type IDockviewPanel,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type TabDragEvent,
} from 'dockview';
import { DockviewReact } from 'dockview-react';
import 'dockview/dist/styles/dockview.css';
import './dock/dock-tokens.css';
import './dock/dock-theme.css';

import {
  DockPanelContent,
  DockWatermark,
  DockCenterSlot,
  type DockPanelParams,
} from './dock/DockPanelContent';
import { CenterGraphPanel } from './dock/CenterGraphPanel';
import {
  CENTER_DEFAULT_PANEL_ID,
  DOCK_PANEL_COMPONENT_ID,
  buildLayoutSteps,
  centerPanelInstanceId,
  isCenterPanelInstanceId,
  panelInstanceId,
  panelKeyFromInstanceId,
  planDockAreas,
  slotToDockDirection,
} from './dock/layout';
import {
  resolveDockMeta,
  type DockAreaSlot,
  type DockPanelDef,
  type DockShellApi,
  type DockShellProps,
} from './dock/types';

// ---- 内部渲染器：中心区默认占用者（章节编辑器出口） ----------------------

interface CenterDefaultParams {
  centerDefault: ReactNode;
}

/**
 * 中心编辑区的**根面板**内容。它承载 `centerDefault`（章节编辑器路由出口），
 * 当被 center panel 抢占时，改由该 center panel 的 Component 渲染（见下方 useEffect）。
 */
function CenterDefaultContent(props: IDockviewPanelProps<CenterDefaultParams>) {
  return (
    <DockCenterSlot>
      <div className="dock-editor-surface">{props.params.centerDefault}</div>
    </DockCenterSlot>
  );
}

/**
 * dockview 的 components 注册表。只注册 3 个**通用**渲染器，
 * 没有任何业务面板 key —— 满足「不硬编码具体业务面板」。
 */
const DOCK_COMPONENTS: Record<string, React.ComponentType<IDockviewPanelProps<never>>> = {
  [DOCK_PANEL_COMPONENT_ID]: DockPanelContent as unknown as React.ComponentType<
    IDockviewPanelProps<never>
  >,
};

const CENTER_DEFAULT_COMPONENT_ID = 'dock:center-default';

/**
 * 关系图 / 图谱中心面板的渲染器（D16：以既有 `@xyflow/react` 承载，**无 C++/Qt/QGraphicsView**）。
 * 它是「中心区为可替换插槽」的**演示实现**：任何声明 `dock:{center:true}` 的插件面板
 * 都可经同一 `DOCK_PANEL_COMPONENT_ID` 通道抢占中心区，此处不硬编码业务 key。
 */
function CenterGraphContent() {
  return (
    <DockCenterSlot>
      <CenterGraphPanel />
    </DockCenterSlot>
  );
}

const CENTER_GRAPH_COMPONENT_ID = 'dock:center-graph';

/**
 * §5.5 冻结的 dockview 主题：`className` 指向 dock-theme.css 的 `.dv-theme-vscode`，
 * 由该 CSS 把 dockview 的 `--dv-*` 映射到 `--vscode-*`（不新增字面色值）。
 *
 * 能力 5（拖拽预览指示器）经由主题选项对齐 VS Code：
 *   - `dndPanelOverlay: 'group'`  → 预览覆盖整个 group（VS Code 拖拽预览的落区感）
 *   - `dndTabIndicator: 'line'`   → 标签插入指示为细线（VS Code 标签位）
 *   - `dndOverlayBorder`          → 2px 焦点边框（§5.6 冻结）
 */
export const VSCODE_DOCK_THEME: DockviewTheme = {
  name: 'vscode-dark-modern',
  className: 'dv-theme-vscode',
  colorScheme: 'dark',
  dndPanelOverlay: 'group',
  dndTabIndicator: 'line',
  dndOverlayBorder: '2px solid var(--vscode-focusBorder)',
  tabGroupIndicator: 'none',
};

const DOCK_TAB_COMPONENT_ID = 'dock:tab';

/**
 * 自定义标签渲染器：
 *   1. 读取 `params.def` 的 `resolveDockMeta().closable` —— 能力 4 的标签堆叠里，
 *      只有 `closable !== false` 的面板才显示 × （dockview 无内建 per-panel closable）。
 *   2. 前置显示插件提供的 `icon`（ADR §1.1 字段 3）。
 *   3. 视觉沿用 `--vscode-tab-*`（D15：类名保留、只换值）。
 */
function DockTab(props: IDockviewPanelHeaderProps<DockPanelParams>) {
  const def = props.params?.def;
  const meta = def ? resolveDockMeta(def) : null;
  const Icon = def?.icon;
  return (
    <div className="dock-tab">
      {Icon ? (
        <span className="dock-tab-icon">
          <Icon size={13} />
        </span>
      ) : null}
      <span className="dock-tab-label">{typeof props.api.title === 'string' ? props.api.title : ''}</span>
      {meta?.closable !== false ? (
        <button
          type="button"
          className="dock-tab-close"
          aria-label={`关闭 ${def?.label ?? ''}`}
          onClick={(e) => {
            e.stopPropagation();
            props.api.close();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

const ALL_COMPONENTS = {
  ...DOCK_COMPONENTS,
  [CENTER_DEFAULT_COMPONENT_ID]: CenterDefaultContent as unknown as React.ComponentType<
    IDockviewPanelProps<never>
  >,
  [CENTER_GRAPH_COMPONENT_ID]: CenterGraphContent as unknown as React.ComponentType<
    IDockviewPanelProps<never>
  >,
};

/** 标签渲染器注册表（能力 4：堆叠标签的 × 受 `dock.closable` 控制）。 */
const ALL_TAB_COMPONENTS = {
  [DOCK_TAB_COMPONENT_ID]: DockTab as unknown as React.ComponentType<
    IDockviewPanelHeaderProps<never>
  >,
};

// ---- 外壳骨架的小组件（VS Code 结构，颜色全取变量） ----------------------

/** 活动栏（Activity Bar）：最左侧窄条，图标入口。 */
function ActivityBar({
  items,
  activeKey,
  onSelect,
}: {
  items: { key: string; label: string; icon: React.ComponentType<{ size?: number }> }[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="dock-activity-bar" aria-label="活动栏">
      {items.map((it) => {
        const Icon = it.icon;
        const active = it.key === activeKey;
        return (
          <button
            key={it.key}
            type="button"
            className={active ? 'dock-activity-item is-active' : 'dock-activity-item'}
            title={it.label}
            aria-label={it.label}
            aria-pressed={active}
            onClick={() => onSelect(it.key)}
          >
            <Icon size={22} />
          </button>
        );
      })}
    </nav>
  );
}

/** 侧边栏 / 辅助侧栏 / 底部面板区的**分区标题条**。 */
function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="dock-section-header">
      <span className="dock-section-title">{title}</span>
      {children}
    </div>
  );
}

/** 状态栏（Status Bar）：底部窄条。 */
function StatusBar({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <footer className="dock-status-bar">
      <div className="dock-status-group">{left}</div>
      <div className="dock-status-group">{right}</div>
    </footer>
  );
}

// ---- 主体 -----------------------------------------------------------------

/**
 * DockShell —— 停靠系统内核。
 *
 * 「上/下/左/右四个 dock area」由 dockview 的 `addPanel({ position: { direction } })`
 * 动态建立（left/right/above/below），每个 area 天然是一个可继续吸附的 drop target；
 * 中心编辑区由根面板（CENTER_DEFAULT_PANEL_ID）承载。
 */
export const DockShell = forwardRef<DockShellApi, DockShellProps>(function DockShell(
  props,
  ref,
) {
  const { panels, centerDefault, activeCenterKey, openKeys, onOpenChange, onActiveChange } = props;

  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // 候选池：key → def。外部数组变化时整体重建（t4 会按 project.mode 过滤后传入）。
  const defByKey = useMemo(() => {
    const map = new Map<string, DockPanelDef>();
    for (const def of panels) map.set(def.key, def);
    return map;
  }, [panels]);

  const defByKeyRef = useRef(defByKey);
  defByKeyRef.current = defByKey;

  const propsRef = useRef({ openKeys, onOpenChange, onActiveChange, centerDefault });
  propsRef.current = { openKeys, onOpenChange, onActiveChange, centerDefault };

  /** 受控优先：外部给了 openKeys 就用它，否则用 defaultOpen 推导的内部状态。 */
  const initialOpenKeys = useMemo(() => {
    if (openKeys) return openKeys;
    return panels.filter((d) => resolveDockMeta(d).defaultOpen).map((d) => d.key);
    // 仅在首次挂载 / panels 身份变化时重算（外部受控时以 openKeys 为准）
  }, [panels, openKeys]);

  /** 把当前 dockview 面板集合回写成业务 key 数组（中心默认面板不算业务面板）。 */
  const emitOpenChange = useCallback((dock: DockviewApi) => {
    // ★ 防御性去重（保留**首次出现**顺序）：`keyOfPanel` 把 `nm-center:<key>` 与
    //   `nm-panel:<key>` 映射成**同一个**业务 key，故实例一旦重复，同一个 key 会被
    //   写进宿主 store 两次，污染「打开顺序」与状态栏计数。
    //   单一所有者修好之后重复本不该发生，但 store 不该被内核的瞬时状态污染。
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const p of dock.panels) {
      const k = keyOfPanel(p);
      if (k === null || seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
    propsRef.current.onOpenChange?.(keys);
  }, []);

  // ---- 能力 1/3/4/7：初始布局（多面板 + 四区 + 标签堆叠在运行时由拖拽达成） ----
  const onReady = useCallback((event: DockviewReadyEvent) => {
    const dock = event.api;
    apiRef.current = dock;

    const all = defByKeyRef.current;
    const wanted = new Set(initialOpenKeys);
    // ★ 单一所有者：声明 `dock:{center:true}` 的面板**不进初始布局** —— 它只由下方
    //   activeCenterKey effect 经中心替换槽 id（`nm-center:<key>`）建立。
    //   若在此处也建一份，它会用 `buildPanelSpec` 的普通 id（`nm-panel:<key>`），
    //   与中心槽实例构成**双实例**；且 `buildLayoutSteps` 会把首个 center 面板判为
    //   `isRoot`（不传 position），与根面板 CENTER_DEFAULT_PANEL_ID 争夺 grid 根。
    //   判定口径经 `resolveDockMeta` 唯一真源（ADR §1.5 / §1.6：center 是替换槽，
    //   不参与侧栏候选池）。
    const opened = [...all.values()].filter(
      (d) => wanted.has(d.key) && !resolveDockMeta(d).center,
    );
    const plan = planDockAreas(opened);

    // 根面板 = 中心编辑区（章节编辑器出口），它是 grid 的锚点
    dock.addPanel({
      id: CENTER_DEFAULT_PANEL_ID,
      component: CENTER_DEFAULT_COMPONENT_ID,
      title: '编辑区',
      params: { centerDefault: propsRef.current.centerDefault },
      // 不传 position：它建立 grid 根
      minimumWidth: 320,
      minimumHeight: 200,
    });

    // 其余面板按 resolveDockMeta 分桶，逐条 addPanel（串行是 dockview 的硬约束）
    for (const step of buildLayoutSteps(plan, CENTER_DEFAULT_PANEL_ID)) {
      const { spec, isRoot } = step;
      // planDockAreas 里已剔除 center 默认面板，但保险起见仍跳过根 id
      if (spec.id === CENTER_DEFAULT_PANEL_ID) continue;
      dock.addPanel(
        isRoot ? { ...spec, position: undefined } : { ...spec, position: spec.position },
      );
    }

    // 聚焦事件 → 上报 activeKey（§2.4 activePanel）
    dock.onDidActivePanelChange((e) => {
      const panel = e.panel;
      const key = panel ? keyOfPanel(panel) : null;
      setActiveKey(key);
      propsRef.current.onActiveChange?.(key);
    });

    // 能力 2/4：拖拽守卫 —— `floatable:false` 的面板不允许被拖出为悬浮 / 拖走
    dock.onWillDragPanel((e: TabDragEvent) => {
      const key = keyOfPanel(e.panel);
      const def = key ? defByKeyRef.current.get(key) : undefined;
      if (def && !resolveDockMeta(def).floatable) e.nativeEvent.preventDefault();
    });

    // 打开/关闭集合变化 → 上报（§2.4 listPanels）
    dock.onDidRemovePanel(() => emitOpenChange(dock));
    dock.onDidAddPanel(() => emitOpenChange(dock));

    setReady(true);
  }, []);

  // ---- 能力 6：中心区可替换插槽（center panel 抢占 → 替换 centerDefault） ----
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api) return;

    const centerPanel = api.getPanel(CENTER_DEFAULT_PANEL_ID);
    if (!centerPanel) return;

    // 1) 程序化更新根面板承载的 centerDefault（路由切换时）
    centerPanel.api.updateParameters({ centerDefault });

    // 2) activeCenterKey 不为 null ⇒ 用该 center 面板抢占中心区
    if (activeCenterKey) {
      const def = defByKeyRef.current.get(activeCenterKey);
      if (def) {
        const id = centerPanelInstanceId(def.key);
        const existing = api.getPanel(id);
        if (existing) {
          existing.api.setActive();
        } else {
          const meta = resolveDockMeta(def);
          api.addPanel({
            id,
            component: DOCK_PANEL_COMPONENT_ID,
            title: def.label,
            params: { defKey: def.key, def },
            position: { direction: 'within', referencePanel: CENTER_DEFAULT_PANEL_ID },
            minimumWidth: meta.minSize.width,
            minimumHeight: meta.minSize.height,
          });
        }
      }
    } else {
      // 退出抢占：移除所有 center 实例 + 普通面板里 key===activeCenterKey 的实例，回到默认出口
      for (const p of [...api.panels]) {
        if (isCenterPanelInstanceId(p.id)) api.removePanel(p);
      }
    }
  }, [activeCenterKey, centerDefault, ready]);

  // ---- 能力 1：外部受控打开集合 → 同步到 dockview ----
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api) return;
    if (!openKeys) return; // 非受控模式：由 api 自管

    const wanted = new Set(openKeys);

    // 关闭：已存在但不在 wanted 里的普通面板。
    // ★ 中心面板（`nm-center:<key>`）**跳过**：它由上面的 activeCenterKey effect 独占，
    //   关闭语义由宿主置 activeCenterKey=null 表达（§1.6：center 是「替换槽」而非
    //   侧栏候选池成员）。此处若按 key 把它一并移除，会与中心槽的所有者打架。
    for (const p of [...api.panels]) {
      const key = keyOfPanel(p);
      if (key === null) continue;
      if (isCenterPanelInstanceId(p.id)) continue;
      if (!wanted.has(key)) api.removePanel(p);
    }

    // 打开：wanted 里缺失的（按 slot 吸附到对应 dock area）
    for (const key of openKeys) {
      const def = defByKeyRef.current.get(key);
      if (!def) continue;
      const meta = resolveDockMeta(def);
      // ★ 单一所有者：声明 `dock:{center:true}` 的面板**只**经中心替换槽
      //   （`nm-center:<key>`）渲染，由 activeCenterKey effect 建/删，本 effect 一律让位。
      //   判定口径经 `resolveDockMeta` 唯一真源（ADR §1.5），不自写 `?? 默认值`。
      //   旧代码此处是 `isCenterPanelInstanceId(panelInstanceId(key))` —— 恒为 false
      //   的死代码（`panelInstanceId` 恒产 `nm-panel:<key>`），故 center 面板会在这里
      //   被建成普通实例，与中心槽实例构成**双实例**（同 key 两个标签）。
      if (meta.center) continue;
      if (api.getPanel(panelInstanceId(key))) continue;
      api.addPanel(buildAddSpec(def, meta.slot));
    }
  }, [openKeys, ready]);

  // ---- §2.4 DockShellApi：命令式控制句柄（t4 消费） ----
  const api: DockShellApi = useMemo(
    () => ({
      openPanel(key: string) {
        const a = apiRef.current;
        const def = defByKeyRef.current.get(key);
        if (!a || !def) return;
        const meta = resolveDockMeta(def);
        // ★ §1.4 allowMultiple=false（缺省）⇒ 已存在只聚焦。
        //   幂等守卫必须查**该面板的规范实例 id**：center 面板的规范 id 是
        //   `nm-center:<key>`（由 activeCenterKey effect 建），普通面板是 `nm-panel:<key>`。
        //   旧代码只查普通 id，故对已抢占中心区的 center 面板会再 addPanel 同一个
        //   `nm-center:<key>`（重复 id）——靠 dockview 静默忽略才没炸，属隐式依赖。
        const canonicalId = meta.center ? centerPanelInstanceId(key) : panelInstanceId(key);
        const existing = a.getPanel(canonicalId);
        if (existing) {
          existing.api.setActive();
          return;
        }
        if (meta.center) {
          a.addPanel({
            id: canonicalId,
            component: DOCK_PANEL_COMPONENT_ID,
            title: def.label,
            params: { defKey: key, def },
            position: { direction: 'within', referencePanel: CENTER_DEFAULT_PANEL_ID },
            minimumWidth: meta.minSize.width,
            minimumHeight: meta.minSize.height,
          });
          return;
        }
        a.addPanel(buildAddSpec(def, meta.slot));
      },
      closePanel(key: string) {
        const a = apiRef.current;
        if (!a) return;
        const p = a.getPanel(panelInstanceId(key)) ?? a.getPanel(centerPanelInstanceId(key));
        if (p) a.removePanel(p);
      },
      focusPanel(key: string) {
        const a = apiRef.current;
        if (!a) return;
        const p = a.getPanel(panelInstanceId(key)) ?? a.getPanel(centerPanelInstanceId(key));
        p?.api.setActive();
      },
      listPanels() {
        const a = apiRef.current;
        if (!a) return [];
        return a.panels.map((p) => keyOfPanel(p)).filter((k): k is string => k !== null);
      },
      activePanel() {
        return activeKey;
      },
      floatPanel(key: string) {
        const a = apiRef.current;
        if (!a) return;
        const p = a.getPanel(panelInstanceId(key)) ?? a.getPanel(centerPanelInstanceId(key));
        if (!p) return;
        const def = defByKeyRef.current.get(key);
        const meta = def ? resolveDockMeta(def) : null;
        // 能力 2：拖出为 floating group 的程序化等价物
        a.addFloatingGroup(p, {
          width: meta?.floatingSize.width,
          height: meta?.floatingSize.height,
        });
      },
      dockPanel(key: string, slot: DockAreaSlot) {
        const a = apiRef.current;
        if (!a) return;
        const p = a.getPanel(panelInstanceId(key)) ?? a.getPanel(centerPanelInstanceId(key));
        if (!p) return;
        // 能力 3：恢复停靠 = 用面板公开 API 把标签移到目标 dock area。
        // `position` 用 dockview 的 Position 字面量（'bottom' 而非 'below'）。
        p.api.moveTo({ position: slotToPosition(slot) });
      },
    }),
    [activeKey],
  );

  // §2.4：同时支持 `ref`（惯用）与 `apiRef`（ADR 冻结的 prop 名），两者都可拿到 DockShellApi。
  useImperativeHandle(ref, () => api, [api]);
  useImperativeHandle(props.apiRef ?? null, () => api, [api]);

  // ---- 外壳骨架：活动栏条目由**候选池**派生（不硬编码业务面板） ----
  const activityItems = useMemo(
    () =>
      panels.map((d) => ({
        key: d.key,
        label: d.label,
        icon: d.icon as unknown as React.ComponentType<{ size?: number }>,
      })),
    [panels],
  );

  const onActivitySelect = useCallback(
    (key: string) => {
      const a = apiRef.current;
      if (!a) return;
      const p = a.getPanel(panelInstanceId(key));
      if (p) {
        p.api.setActive();
      } else {
        api.openPanel(key);
      }
    },
    [api],
  );

  return (
    // 能力 8：VS Code 式外壳骨架；.dv-theme-vscode 是 §5.5 冻结的 --dv-* → --vscode-* 映射层
    <div className="dock-shell dv-theme-vscode">
      {/* 活动栏（最左窄条） */}
      <ActivityBar items={activityItems} activeKey={activeKey} onSelect={onActivitySelect} />

      {/* 侧边栏骨架（主侧栏） */}
      <aside className="dock-side-bar" aria-label="侧边栏">
        <SectionHeader title="资源管理器" />
        <div className="dock-side-body">
          <div className="dock-side-empty">面板由插件注册，经候选池注入此处。</div>
        </div>
      </aside>

      {/* 中心：dockview（编辑区 + 四个 dock area + 悬浮 + 标签堆叠 + Splitter） */}
      <main className="dock-main" aria-label="编辑区">
        {ready ? null : <div className="dock-booting">正在初始化停靠系统…</div>}
        <DockviewReact
          className="dockview-host"
          components={ALL_COMPONENTS as never}
          tabComponents={ALL_TAB_COMPONENTS as never}
          defaultTabComponent={DockTab as never}
          onReady={onReady}
          // 能力 5：主题层给出落点预览指示器（dndPanelOverlay/dndTabIndicator/边框）
          theme={VSCODE_DOCK_THEME}
          // 能力 2：悬浮组用 titlebar 作为拖动手柄，可再拖回停靠区
          disableFloatingGroups={false}
          floatingGroupDragHandle="titlebar"
          singleTabMode="fullwidth"
          noPanelsOverlay="watermark"
          watermarkComponent={DockWatermark}
        />
      </main>

      {/* 辅助侧栏骨架（右侧，scope==='editor' 面板的落点） */}
      <aside className="dock-aux-bar" aria-label="辅助侧栏">
        <SectionHeader title="辅助侧栏" />
        <div className="dock-side-body">
          <div className="dock-side-empty">编辑器面板在此堆叠。</div>
        </div>
      </aside>

      {/* 底部面板区骨架：与 dockview 的 bottom dock area 同一视觉带 */}
      <section className="dock-bottom-area" aria-label="底部面板区">
        <SectionHeader title="面板" />
        <div className="dock-bottom-hint">拖拽标签到此处即吸附为底部停靠区。</div>
      </section>

      {/* 状态栏（最底窄条） */}
      <StatusBar
        left={<span className="dock-status-item">停靠内核 · dockview</span>}
        right={<span className="dock-status-item">{activeKey ?? '无活动面板'}</span>}
      />
    </div>
  );
});

// ---- 工具 ---------------------------------------------------------------

/** 从 dockview 面板对象反解业务 key（中心默认面板返回 null）。 */
function keyOfPanel(p: IDockviewPanel): string | null {
  if (p.id === CENTER_DEFAULT_PANEL_ID) return null;
  if (isCenterPanelInstanceId(p.id)) return panelKeyFromInstanceId(p.id.replace('nm-center:', ''));
  return panelKeyFromInstanceId(p.id);
}

/** 构造吸附到指定 dock area 的 addPanel 规格。 */
function buildAddSpec(def: DockPanelDef, slot: 'left' | 'right' | 'bottom' | 'center') {
  const meta = resolveDockMeta(def);
  return {
    id: panelInstanceId(def.key),
    component: DOCK_PANEL_COMPONENT_ID,
    title: def.label,
    params: { defKey: def.key, def },
    position: {
      direction: slot === 'center' ? ('within' as const) : slotToDockDirection(slot),
      referencePanel: CENTER_DEFAULT_PANEL_ID,
    },
    minimumWidth: meta.minSize.width,
    minimumHeight: meta.minSize.height,
  };
}

/** ADR 槽位名 → dockview `Position`（用于 `panel.api.moveTo`）。 */
function slotToPosition(slot: DockAreaSlot): 'left' | 'right' | 'bottom' {
  return slot;
}
