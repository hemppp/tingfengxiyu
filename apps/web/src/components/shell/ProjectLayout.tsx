// ============================================================
// ProjectLayout.tsx —— 项目壳（P3 · t4：气泡浮窗 → dockview 停靠系统）
//
// 契约真源：docs/architecture/dock-protocol-adr.md
//   §1.1–1.3  既有 11 字段全部保留；`scope` 语义收窄；`rail` 不再由宿主读取
//   §1.6      三类内容落位；中心槽默认占用者 = 章节编辑器路由出口
//   §2.3.2    'nm:open-panel' 迁移（监听体改调 getPanelNavigation().open）
//   §2.3.3    'nm:open-settings' 保留（navigate(PATHS.settings)）
//   §3.4      候选池合成 = 内置面板槽 ∪ 插件面板槽，按 key 去重
//   §4.3      MAX_OPEN_PANELS 退役（已在 stores/panelOpenStore.ts 落地）
//
// ## 本次净变化（对照 ADR §0.1「现状」表）
//   ❌ 删除：`useFloatingPanel` / `FloatingPanelWindow` / `ResizeFrame`
//            （自研绝对定位浮窗引擎 + 八向缩放，共 ~350 行死代码）
//   ❌ 删除：`FloatingBubbles`「功能转轮」（罗盘 + 卫星气泡入口）
//   ❌ 删除：`PanelFallback`（转圈加载壳，浮窗引擎专用）
//   ✅ 新增：`DockShell`（t3 交付的停靠内核）承载全部面板
//   ✅ 新增：`PanelMenu`（顶栏下拉菜单）= 活动栏 / 侧边栏之外的第三入口
//   ✅ 新增：顶栏 + 状态栏的 VS Code Dark Modern 视觉（project-shell.css）
//
// ## 保留不变的既有语义（t9 验收逐条对照）
//   1. `filterByProjectMode` 模式过滤      —— 见下方 §3.4 合池后的过滤
//   2. auto 模式工作台分支 + WorkbenchMissing 降级 —— 见 `mode === 'auto'` 分支
//   3. PanelGuard 错误隔离                 —— 已按 §3.4-3 搬进 DockShell
//                                             （dock/DockPanelContent.tsx 的
//                                             PanelErrorBoundary），不得留在
//                                             已删的浮窗引擎里
//   4. chapters / ai-chat 按 key 取用      —— 降级为**普通面板**（§3.2 决策 3-A），
//                                             由统一候选池承载，无特殊分支
//
// ## 中心槽语义（§1.6）
//   `<Outlet/>`（章节编辑器路由出口）是**中心槽的默认占用者**，
//   经 `DockShellProps.centerDefault` 注入；被声明 `dock:{center:true}`
//   的面板抢占时替换（由 DockShell 内部处理）。
// ============================================================

import React, { useEffect, useMemo, useCallback, Suspense } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { Settings, LogOut, User, Shield, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';
import { useProjectStore } from '@/stores';
import { useReferenceStore } from '@/stores/referenceStore';
import { useAuthStore } from '@/stores/authStore';
import { PATHS } from '@/routes/paths';
import { apiClient } from '@/services/api/apiClient';
import { useSyncService } from '@/services/data/syncService';
import type { Project } from '@novel/shared';
import { WorkbenchMissing } from '@/components/shell/WorkbenchMissing';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { DockShell } from '@/components/shell/DockShell';
import type { DockPanelDef, DockShellApi } from '@/components/shell/dock/types';
// ★ §1.5：`resolveDockMeta` 是缺省行为的**唯一真源** —— center 判定一律经它取值，
//   本壳不得自写 `?? false` 兜底（否则与 DockShell 的分桶口径漂移）。
import { resolveDockMeta } from '@/components/shell/dock/types';
import { PanelMenu } from '@/components/shell/PanelMenu';
import { usePluginRegistry, useProjectMode, filterByProjectMode, entryAppliesToProjectMode } from '@/plugin/registry';
import { getPanelNavigation, registerPanelViewOpener, registerPanelViewSync, usePanelOpenStore } from '@/stores/panelOpenStore';
import type { FloatingPanelDef } from '@/plugin/types';
import './project-shell.css';

// ★ 面板定义在 src/plugin/builtin.ts 注册（内置 12 面板 + 编辑器面板），
// 这里通过 usePluginRegistry 订阅；宿主**不再**负责渲染/拖拽/限流 ——
// 位置、尺寸、标签堆叠、悬浮全部由 DockShell（dockview）承担。

// ★ AI 写作模式的工作台：经 **注册表 `workbench` 槽**（auto 模块 `registerWorkbench` 填充）。
//   kernel 不再硬编码 `import('@novel-plugins/auto-workbench/web')` 说明符 ——
//   那是 vite 静态可解析的模块入口字面量，auto 缺席时 `[vite:load-fallback] ENOENT`
//   会让 build 硬失败。改由注册表取（模块缺席 ⇒ 槽为空 ⇒ 不渲染，降级语义）。

/** 面板内容加载态（Suspense fallback）。VS Code 风格：无边框转圈 + 次级文字。 */
function PanelFallback() {
  return (
    <div className="shell-panel-fallback" role="status" aria-label="加载中">
      <Loader2 size={18} className="dock-spin" style={{ color: 'var(--vscode-descriptionForeground)' }} />
      <span style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>加载中…</span>
    </div>
  );
}

/**
 * 应用级致命错误兜底（根 ErrorBoundary 的 renderError）。
 * 面板级错误由 DockShell 内部的 PanelGuard 隔离，不会到这里。
 */
function ShellFatal({ error }: { error: Error }) {
  return (
    <div className="shell-fatal" role="alert">
      <AlertTriangle size={22} style={{ color: 'var(--vscode-semantic-warning)' }} />
      <div style={{ fontSize: 13 }}>应用发生错误，已停止渲染</div>
      <div
        style={{
          fontSize: 11,
          fontFamily: 'var(--vscode-font-family-mono)',
          wordBreak: 'break-all',
          maxWidth: 640,
          color: 'var(--vscode-semantic-error)',
        }}
      >
        {String(error?.message || error)}
      </div>
      <button
        type="button"
        className="nm-btn-apple-icon-sm"
        style={{ padding: '4px 12px', fontSize: 12 }}
        onClick={function () { window.location.reload(); }}
      >
        重新加载
      </button>
    </div>
  );
}

export function ProjectLayout() {
  var navigate = useNavigate();
  var params = useParams<{ bookId: string }>();
  var urlBookId = params.bookId;
  // ★「返回」策略（2026-09-12 重写）：统一为「退出项目、回书架」，**不再依赖历史栈**。
  //
  //   ⚠ 为什么不能用 navigate(-1)：
  //     `/project` 是**瞬态页** —— 只要有章节，ProjectIndexPage 就会用 replace 跳到章节编辑器，
  //     而 replace 会把 `/project` 这条历史记录**抹掉**。从书架进来时的历史栈实际是
  //     [书架, 章节页]，于是 navigate(-1) 会越过「上一层」直接弹回书架。
  //
  //   ⚠ 为什么不能用 navigate(PATHS.project)：
  //     ProjectIndexPage 挂载后立刻又把你 replace 回章节编辑器，表现为
  //     「点了返回没反应、还在原界面」。
  //
  //   固定回书架后行为稳定可预测：无章节项目的首页本身就在 /project，返回同样出到书架。
  var backTarget = PATHS.bookshelf;
  var backLabel = '返回书架';
  var handleBack = useCallback(function() {
    navigate(backTarget);
  }, [backTarget, navigate]);
  var project = useProjectStore(function(s) { return s.currentProject; });
  var setProject = useProjectStore(function(s) { return s.setProject; });
  var user = useAuthStore(function(s) { return s.user; });
  var logout = useAuthStore(function(s) { return s.logout; });

  // 打开状态来自 store（编辑器内的插件面板栏共享同一份，可开关面板）
  var openPanelKeys = usePanelOpenStore(function(s) { return s.keys; });
  var activeKey = usePanelOpenStore(function(s) { return s.activeKey; });
  var syncFromView = usePanelOpenStore(function(s) { return s._syncFromView; });
  var setActiveKey = usePanelOpenStore(function(s) { return s._setActive; });

  // ★ 插件化：面板列表来自插件注册表（内置 12 面板 + 插件新增面板）
  // ★ 按当前项目创作模式过滤：手写台只渲染 manual + shared 面板（auto 面板归 AI 工作台）
  var projectMode = useProjectMode();
  var allFloatingPanels = usePluginRegistry(function(s) { return s.projectPanels; });
  // ★ §3.3：扩展点已由 `builtinBubbles` 更名为 `builtinPanels`。读到的是
  //   `BuiltinPanelDef`（`FloatingPanelDef` 的真子集），**合池后类型天然成立**，
  //   不再需要 `as unknown as FloatingPanelDef` 双断言（§3.2）。
  var builtinPanels = usePluginRegistry(function(s) { return s.builtinPanels; });

  // ★ §3.4 候选池合成（冻结）：内置面板槽 ∪ 插件面板槽，按 key 去重（前者优先）。
  //   这一条同时修掉了实测缺陷：`'ai-chat'` 全仓 0 注册点 ⇒ 合池前 `chatBubbleDef`
  //   恒为 null、AI 对话面板**从不渲染**；合池后只要有模块注册 `'ai-chat'` 即自然生效。
  var candidatePanels = useMemo<FloatingPanelDef[]>(function() {
    var byKey = new Map<string, FloatingPanelDef>();
    for (var i = 0; i < builtinPanels.length; i++) {
      var b = builtinPanels[i];
      if (!b) continue;
      // BuiltinPanelDef 字段集 ⊂ FloatingPanelDef（§3.2），此处是**安全的**收窄
      byKey.set(b.key, {
        key: b.key,
        label: b.label ?? b.key,
        icon: b.icon ?? undefined,
        Component: b.Component,
        width: b.width,
        height: b.height,
        order: b.order,
        modes: b.modes,
      } as FloatingPanelDef);
    }
    for (var j = 0; j < allFloatingPanels.length; j++) {
      var p = allFloatingPanels[j];
      if (!p) continue;
      if (!byKey.has(p.key)) byKey.set(p.key, p);
    }
    return Array.from(byKey.values());
  }, [builtinPanels, allFloatingPanels]);

  // ★ 保留语义 1/4：`filterByProjectMode` 模式过滤 —— 函数名与行为均不变
  var floatingPanels = useMemo(function() {
    return filterByProjectMode(candidatePanels, projectMode);
  }, [candidatePanels, projectMode]);

  // ★ §1.2 scope 语义收窄：'editor' → 辅助侧栏；缺省/'workspace' → 主候选池。
  //   分类真源唯一为 `resolveDockMeta(def).slot`（DockShell 内分桶），
  //   故本壳**不做** scope 分流，整池透传给 DockShell（避免两处各写一套缺省）。
  var allShellPanels = useMemo<DockPanelDef[]>(function() {
    return floatingPanels as DockPanelDef[];
  }, [floatingPanels]);

  // ★ F1 / §1.6 中心槽抢占：`activeCenterKey` = 「被占用时显示的中心面板 key」
  //   （null = 中心槽交回 `centerDefault` 的章节编辑器路由出口）。
  //
  //   判定口径**与 DockShell 完全一致**：只认 `resolveDockMeta(def).center`（§1.5 唯一真源）。
  //   本壳不得自写 `?? false` 之类的兜底 —— 那会让宿主与内核的 center 判据各写一份、逐渐漂移。
  //
  //   取值优先级（闭环 t9 评审遗留的 F1：原实现硬编码 null，使该能力实际不可达）：
  //     1. dockview 当前**激活**面板若声明了 center ⇒ 用它（用户正聚焦者抢占中心槽）
  //     2. 否则回落：已打开的 center 面板中**最近打开**的那个
  //        （`keys` 为打开顺序，故倒序扫描取首个命中）
  //     3. 无任何已打开的 center 面板 ⇒ null
  //   关闭 center 面板后它同时从 `keys` 与 `activeKey` 消失 ⇒ 自然回落 null；
  //   多个 center 面板并存时，后开者关闭会重新占用先前那个（互斥语义），无需额外状态。
  //
  //   ⚠ 本推导是 hook，必须位于下方 `mode === 'auto'` 提前 return **之前**，
  //     以保证两种创作模式下 hooks 调用顺序完全一致。
  var defByKey = useMemo(function() {
    var map = new Map<string, DockPanelDef>();
    for (var i = 0; i < allShellPanels.length; i++) {
      var def = allShellPanels[i];
      if (def) map.set(def.key, def);
    }
    return map;
  }, [allShellPanels]);

  var activeCenterKey = useMemo<string | null>(function() {
    var isCenterPanel = function(key: string): boolean {
      var def = defByKey.get(key);
      return !!def && resolveDockMeta(def).center;
    };
    // 1) 激活面板优先（仅当它确实处于已打开集合中）
    if (activeKey && openPanelKeys.indexOf(activeKey) !== -1 && isCenterPanel(activeKey)) {
      return activeKey;
    }
    // 2) 回落：已打开集合中最近打开的 center 面板
    for (var i = openPanelKeys.length - 1; i >= 0; i--) {
      var key = openPanelKeys[i];
      if (key && isCenterPanel(key)) return key;
    }
    // 3) 无 center 面板被打开 ⇒ 中心槽用 centerDefault
    return null;
  }, [defByKey, openPanelKeys, activeKey]);

  // ★ 章节 / AI 对话面板：§3.2 决策 3-A —— 取消 ProjectLayout 的 key 硬编码查找，
  //   降级为**普通面板**，由上面的统一候选池承载，DockShell 对二者无特殊分支。
  //   「内置面板缺席 ⇒ 不渲染」的优雅降级语义因此天然成立。

  // ★ AI 工作台壳经**注册表 `workbench` 槽**取（auto 模块经 ctx.registerWorkbench 填充）。
  //   模块缺席 ⇒ 槽为空 ⇒ 不渲染该工作台（降级语义）。kernel 侧不再出现
  //   `@novel-plugins/auto-workbench/web` 这一模块入口说明符。
  var workbenchSlots = usePluginRegistry(function(s) { return s.workbenches; });
  var activeWorkbench = useMemo(function() {
    var def = workbenchSlots[projectMode] ?? workbenchSlots.shared;
    if (!def) return null;
    return entryAppliesToProjectMode(def, projectMode) ? def : null;
  }, [workbenchSlots, projectMode]);

  // ★ 刷新恢复：URL 带有 :bookId 但 store 已重置（currentProject 为 null 或 id 不匹配）时，
  // 从后端拉取项目元数据写回 store。这样刷新 /project/:bookId/:chapterId 不会丢失书籍。
  useEffect(function() {
    if (!urlBookId) return;
    var current = useProjectStore.getState().currentProject;
    if (current && current.id === urlBookId) return;
    var cancelled = false;
    apiClient.get<Project>('/projects/' + urlBookId).then(function(p) {
      if (cancelled) return;
      if (p) setProject(p);
    }).catch(function(e) {
      console.warn('[ProjectLayout] 从 URL bookId 恢复项目失败', e);
    });
    return function() { cancelled = true; };
  }, [urlBookId, setProject]);

  // ★ 优先用 URL 的 bookId 触发 syncService，避免 project 暂未恢复时 syncService 拿到 undefined
  //   取回 reload 下传给 AI 写作工作台：交付后实体已在服务端落库，
  //   需要这个实例（而**不能**在工作台里再挂一个 useSyncService —— 那会让每次 store
  //   变更被两个订阅各写一遍，实体重复创建）把项目数据重新拉进 store。
  var { reload: reloadProjectData } = useSyncService(urlBookId || project?.id);

  // ★ 加载参考书：当项目 ID 可用时从后端加载参考书列表
  // 参考书独立于 syncService 的实体同步，且 ReferenceReader 是惰性加载的停靠面板，
  // 刷新页面时面板未打开，ReferenceReader 不会挂载，loadBooks 也不会被调用。
  // 因此需要在 ProjectLayout 层面主动加载，确保参考书数据在项目加载时即可用。
  var referenceProjectId = urlBookId || project?.id;
  useEffect(function() {
    if (!referenceProjectId) return;
    useReferenceStore.getState().loadBooks(referenceProjectId);
  }, [referenceProjectId]);

  // ★ 把 store 的开闭状态桥到 DockShell（视图层）：
  //   · 打开路径由 getPanelNavigation() 的「执行器注册 + 排队回放」承担（§2.4）
  //   · 关闭路径（减少集合）无法表示为单个 open 调用，故注册整集合同步回调
  //   ⇒ 用户点标签 ×、拖走面板等视图层交互，DockShell 经 onOpenChange 回写 store。
  var dockApiRef = React.useRef<DockShellApi | null>(null);
  useEffect(function() {
    var unregisterOpen = registerPanelViewOpener(function(key) {
      dockApiRef.current?.openPanel(key);
    });
    registerPanelViewSync(function(keys) {
      syncFromView(keys);
    });
    return function() {
      unregisterOpen();
      registerPanelViewSync(null);
    };
  }, [syncFromView]);

  // ★ 跨组件请求打开面板（ForeshadowWarning 的「查看」、正文高亮、AI 生成插件模板…）
  //
  //   ⚠ 本事件**不得删除**（ADR D6 / §2.3.2）：apps/server/src/ai/tools/plugin-tools.ts:189
  //     的 AI 插件生成模板会**永久**为已落盘插件吐 `'nm:open-panel'` 这个字面量，
  //     已发布的第三方插件也只会发这个事件。前端 4 个派发点（worldbuilding 2 处、
  //     ForeshadowWarning、LeadCharacterHighlight）**一行不改**。
  //
  //   迁移动作（§2.3.2）：回调体从旧的 `openPanel(key)` 改为
  //   `getPanelNavigation().open(key)`；前置校验逐字保留。
  //   监听挂载点：**保留在 `ProjectLayout`**（§2.3.2 允许「DockShell 或其父层」二选一）。
  //     选 ProjectLayout 的理由：它是项目的路由壳，即使 DockShell 尚未 ready
  //     （dockview 初始化是异步的）事件也不会丢 —— 命令式入口会**静默排队**（§2.4），
  //     DockShell ready 后回放。挂在 DockShell 内则要额外处理 ready 前的窗口期。
  //
  //   退出条件（§2.3.2-5 要求写进代码）：当 apps/server 的模板改为派发新的
  //     `nm:panel` 事件 **且** 已落盘的第三方插件完成迁移后，才可删除本监听。
  //     **本重构不满足该条件，故长期保留。**
  useEffect(function() {
    var onOpenPanel = function(e: Event) {
      var key = (e as CustomEvent<{ key: string }>).detail?.key;
      if (!key) return;
      getPanelNavigation().open(key);
    };
    window.addEventListener('nm:open-panel', onOpenPanel as EventListener);
    // ★ D7 / §2.3.3：跨域「打开设置页」事件桥 —— auto 模块/独立插件包内的技能栏
    //   点「添加技能」时派发。插件包不依赖 react-router-dom，故经此桥由 kernel 壳导航
    //   （与 nm:open-panel 同构）。实测当前**零派发点**，但属公开契约
    //   （docs/architecture/web-workbench-split.md:896 有正式记载），保留监听。
    var onOpenSettings = function() { navigate(PATHS.settings); };
    window.addEventListener('nm:open-settings', onOpenSettings as EventListener);
    return function() {
      window.removeEventListener('nm:open-panel', onOpenPanel as EventListener);
      window.removeEventListener('nm:open-settings', onOpenSettings as EventListener);
    };
  }, [navigate]);

  var handleLogout = useCallback(async function() {
    await logout();
    navigate(PATHS.login);
  }, [logout, navigate]);

  // ★ 创作模式分流：AI 写作模式走固定工作台 —— 不渲染停靠外壳。
  //   刻意放在所有 hooks 之后，保证两种模式下 hooks 的调用顺序完全一致。
  //   ★ 工作台组件来自注册表槽（auto 模块注册）。模块缺席 ⇒ activeWorkbench 为 null
  //     ⇒ 渲染「AI 写作台未安装」占位（WorkbenchMissing），保留项目壳与返回入口，
  //       不伪造兜底实现，也**不**用转圈占位（那会让用户永远等待一个不会来的组件）。
  //     本分支只覆盖 mode==='auto'，手写台（manual）路径不受任何影响。
  if ((project?.mode ?? 'manual') === 'auto') {
    var WorkbenchComponent = activeWorkbench?.Component as React.ComponentType<any> | undefined;
    if (!WorkbenchComponent) return <WorkbenchMissing mode="auto" />;
    return (
      <Suspense fallback={<PanelFallback />}>
        <WorkbenchComponent project={project} onBack={handleBack} onProjectDataChanged={reloadProjectData} />
      </Suspense>
    );
  }

  // 中心槽占用者 `activeCenterKey` 已在上方（提前 return 之前）经
  // `resolveDockMeta(def).center` 派生 —— 见 F1 / §1.6 注释块。

  return (
    <ErrorBoundary renderError={function(error) { return <ShellFatal error={error} />; }}>
      <div className="shell-root">
        {/* 顶栏（§5.3.6）：VS Code titleBar/topBar 视觉，颜色全取 --vscode-* */}
        <header className="shell-topbar" role="banner">
          {/* 左侧：返回书架 + 项目名 */}
          <div className="shell-topbar-left">
            {/* ★ 返回入口：原 `InkBackButton`（水墨毛笔箭头）已随水墨体系退役（ADR §6.4）。
                全站返回入口统一改用 lucide 的 `ArrowLeft`（同 AdminPage 的做法），
                保留原有 onClick 行为与中文无障碍标签。 */}
            <button
              type="button"
              onClick={handleBack}
              className="nm-btn-apple-icon-sm"
              title={backLabel}
              aria-label="返回"
            >
              <ArrowLeft size={15} aria-hidden="true" />
            </button>
            <span
              className="shell-topbar-title"
              onClick={function() { navigate(backTarget); }}
              title={backLabel}
              aria-label={backLabel}
            >
              {project ? project.name : '听风细雨'}
            </span>
          </div>

          <div />

          <div className="shell-topbar-right">
            {/* ★ 面板菜单 = 退役的功能转轮的替代入口（ADR §0.3） */}
            <PanelMenu panels={floatingPanels} />
            <button
              onClick={function() { navigate(PATHS.settings); }}
              className="nm-btn-apple-icon-sm"
              title="设置"
              aria-label="设置"
            >
              <Settings size={15} />
            </button>
            {user?.isAdmin && (
              <button
                onClick={function() { navigate(PATHS.admin); }}
                className="nm-btn-apple-icon-sm"
                title="管理员后台"
                aria-label="管理员后台"
              >
                <Shield size={15} />
              </button>
            )}
            {user && (
              <div className="shell-user-chip">
                <div className="shell-user-avatar">
                  {user.displayName ? user.displayName.charAt(0).toUpperCase() : <User size={10} />}
                </div>
                <span className="shell-user-name">{user.displayName}</span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="nm-btn-apple-icon-sm"
              title="登出"
              aria-label="登出"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* 主区：DockShell 承载全部面板（编辑区 + 四区 + 悬浮 + 标签堆叠 + Splitter） */}
        <main className="shell-main">
          <DockShell
            panels={allShellPanels}
            centerDefault={<Outlet />}
            activeCenterKey={activeCenterKey}
            apiRef={dockApiRef}
            openKeys={openPanelKeys}
            onOpenChange={syncFromView}
            onActiveChange={setActiveKey}
          />
        </main>

        {/* 状态栏（§5.3.5）：VS Code 窄条，颜色全取 --vscode-* */}
        <footer className="shell-statusbar" role="contentinfo">
          <div className="shell-statusbar-group">
            <span className="shell-statusbar-item is-remote">
              {projectMode === 'auto' ? 'AI 写作模式' : '手写模式'}
            </span>
            <span className="shell-statusbar-item">
              {openPanelKeys.length === 0 ? '无打开面板' : openPanelKeys.length + ' 个面板'}
            </span>
          </div>
          <div className="shell-statusbar-group">
            <span className="shell-statusbar-item">
              {activeKey ? '焦点：' + activeKey : '无活动面板'}
            </span>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
