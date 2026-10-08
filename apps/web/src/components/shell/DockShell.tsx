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
import { ChevronDown, ChevronRight } from 'lucide-react';
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
// ★ t6 去层：中心组头渲染「文档标签行」（原先顶栏之下的独立 30px 横条）
import { DocTabsHeader } from './DocTabs';
import {
  CENTER_DEFAULT_PANEL_ID,
  DOCK_BOTTOM_PANEL_DEFAULT_HEIGHT,
  DOCK_PANEL_COMPONENT_ID,
  buildLayoutSteps,
  centerPanelInstanceId,
  dockSideWidth,
  isCenterPanelInstanceId,
  panelInstanceId,
  panelKeyFromInstanceId,
  planDockAreas,
  slotToDockDirection,
  type DockPanelSpec,
} from './dock/layout';
import {
  resolveDockMeta,
  type DockAreaSlot,
  type DockSlot,
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
 * ★ t6 去层：中心组的组头渲染器 id。
 *
 * 中心组（章节编辑器出口）的组头不再显示一个「编辑区」标签，而是渲染**文档标签行**
 * （`.shell-doctabs`：章节正文 / 人物设定 / 大纲 · 卷一 / +）。这样左「章节」、
 * 中三张文档标签、右「AI 对话」共享同一条组头带，顶部由三层收敛为两层。
 */
const DOCK_DOC_TABS_TAB_COMPONENT_ID = 'dock:doc-tabs';

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
          aria-label={`关闭 ${def?.label ?? (typeof props.api.title === 'string' ? props.api.title : '')}`}
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
  // ★ t6 去层：中心组头 = 文档标签行（不再是一条独立横条）
  [DOCK_DOC_TABS_TAB_COMPONENT_ID]: DocTabsHeader as unknown as React.ComponentType<
    IDockviewPanelHeaderProps<never>
  >,
};

// ---- 外壳骨架的小组件（VS Code 结构，颜色全取变量） ----------------------

/**
 * 活动栏（Activity Bar）：最左侧窄条，图标入口。
 *
 * ★ 2026-10-07 用户口径（m01200「让他点击对应的按钮可以收起来」）：
 *   每个图标是该面板的**开/关开关** —— 已打开再点 = 收起，未打开点击 = 打开。
 *   因此这里有两个独立视觉维度，**不能**像改造前那样用 `activeKey` 兼任两者：
 *     · `is-active`   = 当前**聚焦**的面板（VS Code 活动栏的左缘高亮条语义，沿用）
 *     · `aria-pressed` = 该面板当前**是否已打开**（开关语义，供读屏与测试判定）
 *   改造前两者都取 `activeKey`，于是「已打开但未聚焦」的面板按钮显示为未按下，
 *   点它只会聚焦、永远不会收起 —— 这正是用户反馈的现象。
 */
function ActivityBar({
  items,
  activeKey,
  openKeys,
  onSelect,
}: {
  items: { key: string; label: string; icon: React.ComponentType<{ size?: number }> }[];
  activeKey: string | null;
  /** 当前已打开的面板 key（受控集合；用于开关态的 aria-pressed 与提示文案） */
  openKeys: readonly string[];
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="dock-activity-bar" aria-label="活动栏">
      {items.map((it) => {
        const Icon = it.icon;
        const active = it.key === activeKey;
        const open = openKeys.includes(it.key);
        return (
          <button
            key={it.key}
            type="button"
            className={active ? 'dock-activity-item is-active' : 'dock-activity-item'}
            title={open ? `${it.label}（点击收起）` : `${it.label}（点击打开）`}
            aria-label={it.label}
            aria-pressed={open}
            onClick={() => onSelect(it.key)}
          >
            {/* ★ t6 尺寸对齐参考图：参考图条目内图标墨迹实测 ~15×10（≈18px lucide），原 22px 偏大。 */}
            <Icon size={18} />
          </button>
        );
      })}
    </nav>
  );
}

// ★ t1（外壳改造）已删除两个**纯占位**骨架与内核自带的第二根状态栏：
//   · `SectionHeader`（侧栏 / 辅助侧栏 / 底部面板区的分区标题条）
//   · `StatusBar`（`.dock-status-bar`，与 ProjectLayout 的通栏状态栏重复）
//   真实面板由 dockview 在中心区内左右停靠渲染，占位骨架（`.dock-side-bar` /
//   `.dock-aux-bar`）只会白占 260px + 240px，使截图里的 240/340 侧栏无法成立。
//   截图只有**一根通栏状态栏**，由 ProjectLayout 的 `footer.shell-statusbar` 承担。

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
  const {
    panels,
    centerDefault,
    activeCenterKey,
    openKeys,
    onOpenChange,
    onActiveChange,
    bottomPanel,
  } = props;

  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** ★ t1：底部面板细条的展开态（Ctrl+J / 点击左端标题切换）。 */
  const [bottomOpen, setBottomOpen] = useState(false);

  // ★ t1：Ctrl+J 展开/收起底部面板。监听挂 window（与编辑器快捷键解耦），
  //   并 preventDefault 掉浏览器把 Ctrl+J 当「下载」的默认行为。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'j' && e.key !== 'J') return;
      e.preventDefault();
      setBottomOpen((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    // ★ t4（集成接线）：`onReady` 是 `useCallback(…, [])`，`initialOpenKeys` 是**首帧**
    //   闭包值；受控模式下首帧往往还是空集合（宿主播种 / 插件面板注册都发生在其后的
    //   effect 里）。故优先取 propsRef 里的**最新**受控集合；非受控时仍回落
    //   first-render 的 `defaultOpen` 推导，语义不变。
    const wanted = new Set(propsRef.current.openKeys ?? initialOpenKeys);
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
      // ★ t6 去层：中心组头渲染文档标签行（`.shell-doctabs`），不再是「编辑区」标签
      tabComponent: DOCK_DOC_TABS_TAB_COMPONENT_ID,
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
    // ★ t4（集成接线）：deps 必须包含 `defByKey` —— 插件面板是**异步注册**的。首屏播种
    //   时 `openKeys` 里可能已有某 key，但它的 def 还没进候选池（模块仍在加载），
    //   上面的循环 `if (!def) continue` 会跳过；若 deps 只有 `[openKeys, ready]`，
    //   def 到达后 openKeys 未变化 ⇒ 该面板**永久不会被打开**（冷启动实测左栏缺席）。
    // ★ t6 F-2：移除面板后 dockview 会**均分**网格空间（`initialWidth` 只在 addPanel
    //   生效），必须在这里重放左右列宽，否则「开→关」一次就把 240/636/340 变成
    //   405/405/406 且不可恢复。
    reapplySideWidths(api, defByKeyRef.current);
  }, [openKeys, ready, defByKey]);

  // ---- ★ t6 去层：只保留中心组的组头，其余组的组头一律隐藏 ------------------
  //
  // 用户口径「上栏多了一层」：参考图顶部只有**两条带** —— 顶栏 + 一条分栏头
  // （左「章节」/ 中三张文档标签 / 右「AI 对话」，三者同在 y36..68 这一行）。
  // 而 dockview 给**每个组**各配一条 35px 组头，于是左右列出现
  // 「dock 组头 + 面板内 h-9 标题条」两层，顶部总共三层。
  //
  // 中心组的组头渲染文档标签行（`DOCK_DOC_TABS_TAB_COMPONENT_ID`），必须保留；
  // 其余组的组头是多余的 —— 隐藏后 `.dv-groupview` 的 flex 布局会把空间还给内容：
  //   `dockview.css:885-891 .dv-groupview{display:flex;flex-direction:column}`
  //   `dockview.css:895-899 .dv-groupview > .dv-content-container{flex-grow:1;min-height:0}`
  // 另需 `relayout()` 让组的 `_cachedHeaderSize` 失效并按新头高重排内容
  //   （`dockview-core.js:9989 set hidden` → `display:none`；
  //    `:11297-11299 relayout()` → `invalidateHeaderSize()` → `contentDimensions()` 读到 0）。
  //
  // 为什么不用 `hideHeader`：它只存在于 `CoreGroupOptions`
  // （`dockviewGroupPanelModel.d.ts:27-35`），**不在** `AddPanelOptions` 里
  // （`options.d.ts:741-775`，grep `hideHeader` = 0 命中），无法经 `addPanel` 传入。
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api) return;

    const apply = () => {
      for (const group of api.groups) {
        // 中心组 = 承载「中心默认面板」或任一中心替换槽实例（`nm-center:<key>`）的组。
        const isCenter = group.panels.some(
          (p) => p.id === CENTER_DEFAULT_PANEL_ID || isCenterPanelInstanceId(p.id),
        );
        const wantHidden = !isCenter;
        const header = group.model.header;
        if (header.hidden !== wantHidden) {
          header.hidden = wantHidden;
          group.relayout();
        }
      }
    };

    // 订阅回调可能在 dockview 自身的一次布局过程中触发；延到微任务再改，避免重入。
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        apply();
      });
    };

    apply();
    const disposables = [
      api.onDidAddGroup(schedule),
      api.onDidRemoveGroup(schedule),
      api.onDidAddPanel(schedule),
      api.onDidRemovePanel(schedule),
    ];
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [ready, openKeys, activeCenterKey]);

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
        // ★ t6 F-2：dockview 移除面板后会**均分**腾出的网格空间，且不会恢复
        //   `initialWidth`（那只在 addPanel 时生效）。这里显式把左右列宽重放一次，
        //   保证「开→关」后仍是 240 / 636 / 340。
        reapplySideWidths(a, defByKeyRef.current);
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

  /**
   * ★ 2026-10-07 用户口径（m01200）：活动栏按钮 = 该面板的开/关开关。
   *   已打开 ⇒ **收起**（不再只 `setActive()`）；未打开 ⇒ 打开。
   *
   *   为什么收起走 `api.closePanel()` 而不是自己 `removePanel`：
   *   它内部还会重放左右列宽（见下方 `closePanel` 实现里的 `reapplySideWidths`），
   *   否则 dockview 会把腾出的空间均分掉，「开→关」后侧栏宽度回不到 240 / 340。
   *
   *   存在性判定与 `closePanel` 保持一致：普通面板是 `nm-panel:<key>`，
   *   抢占中心区的面板是 `nm-center:<key>`（中心面板也要能收起，如「关系图」）。
   *
   *   双向都会经 dockview 的 `onDidAddPanel` / `onDidRemovePanel` → `emitOpenChange`
   *   → 宿主 `onOpenChange`（= `_syncFromView`）回写 store，故 store 的 `keys`
   *   与视图始终一致，`aria-pressed` 与提示文案随之更新。
   *
   *   注：字段名沿用既有 `onActivitySelect`，仅语义从「打开或聚焦」收窄为「开关」。
   *   若日后要回到 VS Code 原生的「点未聚焦的已打开项 = 先聚焦、点当前聚焦项 = 收起」，
   *   把下面的分支改成 `if (p && key === activeKey) closePanel else if (p) setActive else openPanel` 即可。
   */
  const onActivitySelect = useCallback(
    (key: string) => {
      const a = apiRef.current;
      if (!a) return;
      const p = a.getPanel(panelInstanceId(key)) ?? a.getPanel(centerPanelInstanceId(key));
      if (p) {
        api.closePanel(key);
      } else {
        api.openPanel(key);
      }
    },
    [api],
  );

  return (
    // 能力 8：VS Code 式外壳骨架；.dv-theme-vscode 是 §5.5 冻结的 --dv-* → --vscode-* 映射层
    <div className="dock-shell dv-theme-vscode">
      {/* 活动栏（最左窄条）：条目由**候选池**派生，故图标集合 = 当前模式真实面板集合。
          `openKeys` 只用于按钮的开关态（aria-pressed / 提示文案）；受控缺席时为空集合。 */}
      <ActivityBar
        items={activityItems}
        activeKey={activeKey}
        openKeys={openKeys ?? []}
        onSelect={onActivitySelect}
      />

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

      {/* 底部面板细条（t1 截图）：左端「底部面板」、右端「N 条问题 Ctrl+J」。
          常驻 DOM（原骨架即常驻，测试按该契约断言），展开高度由 CSS 控制，
          条数与展开内容由调用方注入（见 DockShellProps.bottomPanel）。 */}
      <section
        className="dock-bottom-area"
        data-open={bottomOpen ? 'true' : 'false'}
        aria-label="底部面板"
      >
        <div className="dock-bottom-bar">
          <button
            type="button"
            className="dock-bottom-toggle"
            onClick={() => setBottomOpen((v) => !v)}
            aria-expanded={bottomOpen}
            title={bottomOpen ? '收起底部面板（Ctrl+J）' : '展开底部面板（Ctrl+J）'}
          >
            {bottomOpen ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
            <span className="dock-bottom-title">底部面板</span>
          </button>
          <div className="dock-bottom-right">
            <span className="dock-bottom-issues" title="当前章节未解决批注（问题清单）条数">
              {bottomPanel?.issueCount ?? 0} 条问题
            </span>
            <kbd className="dock-bottom-kbd">Ctrl+J</kbd>
          </div>
        </div>
        {bottomOpen ? <div className="dock-bottom-body">{bottomPanel?.children}</div> : null}
      </section>
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

/**
 * ★ t6 F-2：把左右停靠列宽重放回设计值（左 240 / 右 340）。
 *
 * 背景：`initialWidth` **只在 `addPanel` 那一刻**被 dockview 采用；一旦某列的面板被
 * 移除，网格会按剩余视图**均分**腾出的空间，且没有任何机制恢复原宽。实测
 * `48:240 | 288:636 | 924:340` → 开「人物设定」→ 用标签 × 关掉 →
 * `48:405 | 453:405 | 858:406`，且再开关也回不去。
 *
 * 公开杠杆是 `group.api.setSize({ width })`
 * （`api/dockviewGroupPanelApi.d.ts:80-86`；`dockview-core.js:5616-5618` 它只 fire
 * `onDidSizeChange`，由 splitview 的 pane `onDidChange` → `resize`/`distributeEmptySpace`
 * 真正落位）。中心列**不设宽**：它是剩余空间的接收者，两侧收窄后会自动补回。
 */
export function reapplySideWidths(
  api: Pick<DockviewApi, 'groups'>,
  defByKey: Map<string, DockPanelDef>,
) {
  // 第一遍：把每个「单一槽位」的组归到它所属的停靠列。
  const bySlot = new Map<'left' | 'right', { group: (typeof api.groups)[number] }[]>();
  for (const group of api.groups) {
    const slots = new Set<DockSlot>();
    for (const p of group.panels) {
      const key = keyOfPanel(p);
      const def = key ? defByKey.get(key) : undefined;
      if (!def) continue;
      const meta = resolveDockMeta(def);
      if (meta.center) continue;
      slots.add(meta.slot);
    }
    // 混合槽位的组（用户拖拽后的结果）不参与，避免与用户意图打架。
    if (slots.size !== 1) continue;
    const slot = [...slots][0];
    if (slot !== 'left' && slot !== 'right') continue;
    const bucket = bySlot.get(slot) ?? [];
    bucket.push({ group });
    bySlot.set(slot, bucket);
  }

  // 第二遍：**只有该停靠列恰好一个组**时才重放设计宽度。
  //
  // 为什么必须这样收窄：打开第二个同槽面板时（实测：开「人物设定」后右槽同时有
  // 「角色」与「AI 对话」两个组），dockview 会把新组按 `initialWidth` 放到 340、
  // 把老组压到 240 —— 这是**它自己的合理分配**。此时若按设计值强推，两个组都会被
  // 拉到 340，右列总宽翻倍、中栏被挤没。所以：多组状态交给 dockview 自己管，
  // 本函数只负责「某列被关空/关回单组后，宽度退回设计值」这一种情形。
  for (const [slot, bucket] of bySlot) {
    if (bucket.length !== 1) continue;
    const { group } = bucket[0]!;
    const target = dockSideWidth(slot);
    if (Math.abs(group.width - target) < 1) continue;
    group.api.setSize({ width: target });
  }
}

/** 构造吸附到指定 dock area 的 addPanel 规格。 */
function buildAddSpec(def: DockPanelDef, slot: 'left' | 'right' | 'bottom' | 'center') {
  const meta = resolveDockMeta(def);
  const spec: DockPanelSpec = {
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
  // ★ t1：命令式 `openPanel()` 也必须拿到与初始布局**同一份**尺寸（左 240 / 右 340 / 底 240），
  //   否则 dockview 给侧栏组一个缺省宽度 ⇒ 截图里的左右栏宽度只在首屏成立、点开后变味。
  if (slot === 'left' || slot === 'right') {
    spec.initialWidth = dockSideWidth(slot);
  } else if (slot === 'bottom') {
    spec.initialHeight = DOCK_BOTTOM_PANEL_DEFAULT_HEIGHT;
  }
  return spec;
}

/** ADR 槽位名 → dockview `Position`（用于 `panel.api.moveTo`）。 */
function slotToPosition(slot: DockAreaSlot): 'left' | 'right' | 'bottom' {
  return slot;
}
