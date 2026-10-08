import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { startSessionKeepalive } from '@/services/auth/sessionKeepalive';
import { CommandPalette } from './components/ui/CommandPalette';
import { ToastProvider } from './components/ui/ToastProvider';
import { PATHS } from './routes/paths';
import { lazyRoute } from './routes/Lazy';
import { NotFoundPage } from './routes/NotFoundPage';
import { ScrollToTop } from './routes/ScrollToTop';
import PageFade from './routes/PageFade';
import { usePluginRegistry, useProjectMode, filterByProjectMode } from './plugin/registry';
import type { PluginRouteDef } from './plugin/types';
import { loadModuleComponent, loadModulePreload } from './plugin/moduleEntries';

// 路由：每个 lazy 路由走统一 fallback。
// ★ loader 提为常量，供「空闲预取」复用 —— 同一个 import() 结果被浏览器/打包器缓存，
//   预取过再导航即为命中缓存，省掉整段 chunk 下载 + 解析时间。
const loadProjectLayout = () => import('./components/shell/ProjectLayout').then(m => ({ default: m.ProjectLayout }));
const loadProjectIndex = () => import('./pages/ProjectIndexPage').then(m => ({ default: m.ProjectIndexPage }));
// ★ D35 + D44：章节编辑器经 **manual 模块公开入口** 惰性引用，kernel 不再静态
//   import `@/components/editor/ChapterEditor`（K2M 边）。
//   D44：说明符改由 **构建期 glob** 解析（`plugin/moduleEntries.ts`）——
//   原写法 `import('@novel-plugins/manual-workbench/web')` 是 vite 静态可解析的
//   模块入口字面量，manual 缺席时 `[vite:load-fallback] ENOENT` 使 build 硬失败。
//   模块缺席 ⇒ loader 为 null ⇒ 该路由不注册（保留 404，不伪造兜底实现）。
const loadChapterEditor = loadModuleComponent<React.ComponentType<any>>('manual', 'ChapterEditor');
const loadBookshelf = () => import('./pages/BookshelfPage').then(m => ({ default: m.BookshelfPage }));
const loadSettings = () => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage }));
const loadAdmin = () => import('./pages/AdminPage').then(m => ({ default: m.AdminPage }));
const loadLogin = () => import('./pages/LoginPage').then(m => ({ default: m.LoginPage }));
const loadRegister = () => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage }));
const loadLanding = () => import('./pages/LandingPage').then(m => ({ default: m.LandingPage }));

const ProjectLayout = lazyRoute(loadProjectLayout);
const ProjectIndexPage = lazyRoute(loadProjectIndex);
// ★ D44：manual 模块缺席 ⇒ loadChapterEditor 为 null ⇒ 不构造 lazy 路由（不伪造兜底）
const ChapterEditor = loadChapterEditor ? lazyRoute(loadChapterEditor) : null;
const BookshelfPage = lazyRoute(loadBookshelf);
const SettingsPage = lazyRoute(loadSettings);
const AdminPage = lazyRoute(loadAdmin);
const LoginPage = lazyRoute(loadLogin);
const RegisterPage = lazyRoute(loadRegister);
const LandingPage = lazyRoute(loadLanding);

/**
 * ★ 2026-10-07「跳转画面会加载一下」修复 —— 模块自持的**面板级**预取。
 *
 * 路由级 loader（上面那批）只覆盖「页面」这一层 chunk。进项目之后才出现的那批
 * chunk 全在模块内部（12 个手写台停靠面板、章节左栏、AI 对话面板），kernel 看不到
 * 它们的 import 说明符 —— 这正是「进项目先出一排『加载中…』，点开面板再出一次」的来源。
 *
 * 预取**内容**因此由模块入口导出的 `preload()` 自己决定，kernel 只经 `import.meta.glob`
 * 解析出的模块入口调用它（D35：kernel 不碰插件内部实现，不新增任何静态 import）。
 * 模块缺席（或没导出 preload）⇒ loader 为 null ⇒ 该条目不参与，不产生悬空 loader。
 */
const loadManualPreload = loadModulePreload('manual');
const loadAutoPreload = loadModulePreload('auto');
const MODULE_PRELOAD_LOADERS: Array<() => Promise<unknown>> = [
  ...(loadManualPreload ? [loadManualPreload] : []),
  ...(loadAutoPreload ? [loadAutoPreload] : []),
];

/**
 * 跳转链路预取表：停在某段路由时，空闲预取「下一步最可能进入」的 chunk，
 * 把「点击之后才开始下载」变成「点击即命中缓存」。
 *
 * /bookshelf → 进项目其实是四段**串行**：ProjectLayout chunk → ProjectIndexPage chunk
 *   → 等章节数据到位 → ProjectIndexPage 自动 redirect → ChapterEditor chunk（编辑器依赖链最重）。
 *   前三块 chunk 一次性预热掉，链路里就只剩数据请求的真实耗时。
 * /project   → 章节编辑器（同上，兜住直接落在 /project 的情况）
 *
 * ★ D44：manual 缺席时 ChapterEditor 不存在，预取表相应剔除（不产生悬空 loader）。
 */
const PRELOAD_ON_PATH: Record<string, Array<() => Promise<unknown>>> = {
  [PATHS.bookshelf]: [
    loadProjectLayout, loadProjectIndex, ...(loadChapterEditor ? [loadChapterEditor] : []),
    // ★ 2026-10-07：再补上**面板级**预取。进项目后立刻要渲染的就是左栏章节树 +
    //   右栏 AI 对话 + 用户可能点开的 12 个停靠面板，它们全在模块内部，
    //   路由级 loader 一个都覆盖不到。在书架页（唯一入口）就把它们发出去，
    //   等真正进项目时面板已是同步命中，不再出现「一排加载中…」。
    ...MODULE_PRELOAD_LOADERS,
  ],
  [PATHS.project]: [
    ...(loadChapterEditor ? [loadChapterEditor] : []),
    ...MODULE_PRELOAD_LOADERS,
  ],
};

/**
 * 全站页面 chunk 清单（★ 2026-10-06「跳转都要加载」全修复）。
 *
 * 每个页面都是独立 chunk，**首次**进入任何一个页面都会走 React.lazy 的
 * Suspense fallback（那个「加载中...」转圈）—— 这才是「每次跳转都加载一下」里
 * 「加载」两个字最直观的来源。首屏稳定后**一次性并行**预热，之后跳转
 * 全部命中模块缓存，页面上只剩数据请求的真实耗时。
 *
 * 顺序 = 访问概率 × 体积：ProjectLayout 单块 448KB、且是「进项目」链路第一段，
 * 所以排第一；编辑器依赖链最重，紧随其后。
 * （顺序自 2026-10-07 起只影响「发起先后」，不再决定「谁被拖到最后」——
 *   全站预热已从串行空闲队列改为并行一次发出。）
 */
const ALL_ROUTE_LOADERS: Array<() => Promise<unknown>> = [
  loadProjectLayout,
  loadProjectIndex,
  ...(loadChapterEditor ? [loadChapterEditor] : []),
  loadBookshelf,
  loadSettings,
  loadAdmin,
  loadLogin,
  loadRegister,
  loadLanding,
];

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Cmd/Ctrl + K 打开命令面板的全局快捷键 */
const CommandPaletteHotkey: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setOpen(o => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return <CommandPalette isOpen={open} onClose={() => setOpen(false)} onNavigate={navigate} />;
};

/**
 * 路由权限守卫：未登录用户自动重定向到登录页，登录后回到原页面。
 * - isLoading 阶段（后台验证 token）：显示加载动画，避免闪烁
 * - 未认证：重定向到 /login，携带 redirect 路径
 * - requireAdmin：需要管理员权限的路由（如 /admin）
 */
const ProtectedRoute: React.FC<{ children: React.ReactNode; requireAdmin?: boolean }> = ({ children, requireAdmin }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const location = useLocation();

  // 初始化未完成或正在后台验证 token：显示加载状态
  // 防止 persist 恢复的 isAuthenticated: true 在验证前短暂绕过守卫
  if (!isInitialized || (!isAuthenticated && isLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{ borderColor: 'hsl(var(--primary))', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  // 未认证：重定向到登录页，登录后回到当前页
  if (!isAuthenticated) {
    return <Navigate to={PATHS.login} state={{ redirect: location.pathname }} replace />;
  }

  // 需要管理员权限但不具备：重定向到书架
  if (requireAdmin && !user?.isAdmin) {
    return <Navigate to={PATHS.bookshelf} replace />;
  }

  return <>{children}</>;
};

/**
 * 路由容器。
 *
 * ★ 2026-10-06 全修复（原「每次跳转都要加载一下」）：
 *   原先这里是 `<AnimatePresence mode="wait"><Routes location={location} key={routeKey}>`。
 *   - AnimatePresence mode="wait" 让旧页 exit 跑完才挂载新页 ⇒ 每次跨段跳转串行硬等 140ms；
 *     已移除（入场淡入改由 PageFade 自己按路由段 key 重放，见 routes/PageFade.tsx）。
 *   - `<Routes>` 上的 `key={routeKey}` 会让整棵路由树重挂载。它**不是**数据重拉的根因
 *     （react-router 本来就只挂载命中的那一个元素，换段必然卸载旧元素、挂载新元素），
 *     真正让每次跳转都出加载态的是「没有数据缓存」与「每个页面是独立 chunk」。
 *     这里仍然去掉它：路由配置树不再无谓重建，key 的职责收敛到 PageFade 一处。
 */
const AppRoutes: React.FC = () => {
  const location = useLocation();
  const routeKey = useMemo(() => {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg}` : '/';
  }, [location.pathname]);

  // ★ 插件化：订阅插件注册的路由，追加到路由表（按当前项目创作模式过滤）
  const projectMode = useProjectMode();
  const pluginRoutes = filterByProjectMode(usePluginRegistry(s => s.routes), projectMode);

  // ★ 空闲预取下一步最可能进入的路由 chunk（表见 PRELOAD_ON_PATH）。
  //   放在 requestIdleCallback 里，不抢首屏；预取失败一律静默，绝不能影响正常流程。
  useEffect(() => {
    const loaders = PRELOAD_ON_PATH[routeKey];
    if (!loaders || loaders.length === 0) return;
    const run = () => { loaders.forEach(l => { void l().catch(() => {}); }); };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(run, { timeout: 1000 });
      return () => { w.cancelIdleCallback?.(id); };
    }
    const t = window.setTimeout(run, 700);
    return () => window.clearTimeout(t);
  }, [routeKey]);

  // ★ 全站 chunk 预热：首屏稳定后**并行一次发出**，绝不抢首屏。
  //   2026-10-07 修：原实现是「一个个排队等空闲时间片」（`queue.shift()` +
  //   每次重新 requestIdleCallback，每个最多等 2.5s 空闲），9 个 loader 里排在
  //   尾巴上的要十几秒后才轮到 —— 那段时间里跳转照样出「加载中」，等于没预热。
  //   现在在同一个空闲回调里把全部 import() 一起发出去：浏览器自己复用连接、
  //   自己排优先级，实际是并行下载；而 requestIdleCallback 仍保证不抢首屏。
  //   同一个 import() 只会真正执行一次（模块表缓存），重复预热是廉价 no-op；
  //   任何失败都静默 —— 预热坏掉绝不能影响正常导航。
  useEffect(() => {
    const w = window as IdleWindow;
    let cancelled = false;
    let idleId: number | undefined;
    let timer: number | undefined;
    const run = () => {
      if (cancelled) return;
      for (const load of ALL_ROUTE_LOADERS) void load().catch(() => {});
    };
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(run, { timeout: 1200 });
    } else {
      timer = window.setTimeout(run, 300);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const renderPluginRoute = (def: PluginRouteDef) => {
    const Comp = def.Component;
    let element = <PageFade><Comp /></PageFade>;
    if (def.guard === 'protected') element = <ProtectedRoute>{element}</ProtectedRoute>;
    if (def.guard === 'admin') element = <ProtectedRoute requireAdmin>{element}</ProtectedRoute>;
    if (def.inProject) {
      return (
        <Route key={def.path} path={def.path} element={<ProtectedRoute><PageFade><ProjectLayout /></PageFade></ProtectedRoute>}>
          <Route index element={<Comp />} />
        </Route>
      );
    }
    return <Route key={def.path} path={def.path} element={element} />;
  };

  return (
    <Routes location={location}>
      <Route path={PATHS.root} element={<PageFade><LandingPage /></PageFade>} />
      <Route path={PATHS.bookshelf} element={<ProtectedRoute><PageFade><BookshelfPage /></PageFade></ProtectedRoute>} />
      <Route path={PATHS.project} element={<ProtectedRoute><PageFade><ProjectLayout /></PageFade></ProtectedRoute>}>
        <Route index element={<ProjectIndexPage />} />
        {/* ★ 带 bookId 的 index 路由（2026-09-15 加）——
            没有它时 `/project/<id>` 单段会落到 path='*' 变 404（2026-09-13 GUI 走查踩过），
            所以那时书架只能**不带 id** 跳 /project，代价是项目身份只活在内存 store 里、
            一刷新就丢（表现为「刷新后内容塌成空态」）。
            加上这条后带 id 的项目页有了自己的 URL，刷新由 ProjectLayout 的
            URL→store 恢复逻辑救回，**URL 成为项目身份的单点真相**。 */}
        <Route path=':bookId' element={<ProjectIndexPage />} />
        {/* ★ D44：manual 模块缺席 ⇒ ChapterEditor 未构造 ⇒ 该路由不注册，
            落到下方 path='*' 的 404（**不**伪造空组件兜底）。 */}
        {ChapterEditor && <Route path=':bookId/:chapterId' element={<ChapterEditor />} />}
      </Route>
      <Route path={PATHS.settings} element={<ProtectedRoute><PageFade><SettingsPage /></PageFade></ProtectedRoute>} />
      <Route path={PATHS.admin} element={<ProtectedRoute requireAdmin><PageFade><AdminPage /></PageFade></ProtectedRoute>} />
      <Route path={PATHS.login} element={<PageFade><LoginPage /></PageFade>} />
      <Route path={PATHS.register} element={<PageFade><RegisterPage /></PageFade>} />
      {/* 插件注册的路由 */}
      {pluginRoutes.map(renderPluginRoute)}
      <Route path='*' element={<PageFade><NotFoundPage /></PageFade>} />
    </Routes>
  );
};

const App: React.FC = () => {
  React.useEffect(() => { useAuthStore.getState().initialize(); startSessionKeepalive(); }, []);
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ScrollToTop />
        <ToastProvider>
          <div className='relative min-h-screen'>
            <AppRoutes />
          </div>
          <CommandPaletteHotkey />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
