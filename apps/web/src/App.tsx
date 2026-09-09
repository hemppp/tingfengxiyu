import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { startSessionKeepalive } from '@/services/auth/sessionKeepalive';
import { CommandPalette } from './components/ui/CommandPalette';
import { ToastProvider } from './components/ui/ToastProvider';
import { BambooLeafFollow } from './components/effects/BambooLeafFollow';
import { AmbientBackdrop } from './components/effects/AmbientBackdrop';
import { PATHS } from './routes/paths';
import { lazyRoute } from './routes/Lazy';
import { NotFoundPage } from './routes/NotFoundPage';
import { ScrollToTop } from './routes/ScrollToTop';
import PageFade from './routes/PageFade';
import { usePluginRegistry } from './plugin/registry';
import type { PluginRouteDef } from './plugin/types';

// 路由：每个 lazy 路由走统一 fallback
const ProjectLayout = lazyRoute(() => import('./components/layout/ProjectLayout').then(m => ({ default: m.ProjectLayout })));
const ProjectIndexPage = lazyRoute(() => import('./pages/ProjectIndexPage').then(m => ({ default: m.ProjectIndexPage })));
const ChapterEditor = lazyRoute(() => import('./components/editor/ChapterEditor').then(m => ({ default: m.ChapterEditor })));
const BookshelfPage = lazyRoute(() => import('./pages/BookshelfPage').then(m => ({ default: m.BookshelfPage })));
const SettingsPage = lazyRoute(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AdminPage = lazyRoute(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const LoginPage = lazyRoute(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazyRoute(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const LandingPage = lazyRoute(() => import('./pages/LandingPage').then(m => ({ default: m.LandingPage })));

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

/** 雨效 canvas：始终挂载（避免重新加载卡顿），但仅 active 时绘制 */
const RainCanvas: React.FC = () => {
  const [active, setActive] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('nm-rain-on');
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'nm-rain-on') {
        setActive(e.newValue === '1');
      }
    };
    window.addEventListener('storage', onStorage);

    // 同步同窗口多次更新的按钮
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean }>).detail;
      if (detail) setActive(detail.active);
    };
    window.addEventListener('nm:rain-toggle', onCustom as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('nm:rain-toggle', onCustom as EventListener);
    };
  }, []);

  return <BambooLeafFollow active={active} />;
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
 * 路由切换退场/入场动画容器。
 * AnimatePresence mode="wait" — 旧页面退场完成后才挂载新页面。
 * key 取 pathname 第一段：/project/:bookId/:chapterId 切换章节时 key 不变（都是 /project），
 * 不触发退场动画，编辑器实例与浮窗状态得以保留。
 */
const AppRoutes: React.FC = () => {
  const location = useLocation();
  const routeKey = useMemo(() => {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg}` : '/';
  }, [location.pathname]);

  // ★ 插件化：订阅插件注册的路由，追加到路由表
  const pluginRoutes = usePluginRegistry(s => s.routes);

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
    <AnimatePresence mode="wait">
      <Routes location={location} key={routeKey}>
        <Route path={PATHS.root} element={<PageFade><LandingPage /></PageFade>} />
        <Route path={PATHS.bookshelf} element={<ProtectedRoute><PageFade><BookshelfPage /></PageFade></ProtectedRoute>} />
        <Route path={PATHS.project} element={<ProtectedRoute><PageFade><ProjectLayout /></PageFade></ProtectedRoute>}>
          <Route index element={<ProjectIndexPage />} />
          <Route path=':bookId/:chapterId' element={<ChapterEditor />} />
        </Route>
        <Route path={PATHS.settings} element={<ProtectedRoute><PageFade><SettingsPage /></PageFade></ProtectedRoute>} />
        <Route path={PATHS.admin} element={<ProtectedRoute requireAdmin><PageFade><AdminPage /></PageFade></ProtectedRoute>} />
        <Route path={PATHS.login} element={<PageFade><LoginPage /></PageFade>} />
        <Route path={PATHS.register} element={<PageFade><RegisterPage /></PageFade>} />
        {/* 插件注册的路由 */}
        {pluginRoutes.map(renderPluginRoute)}
        <Route path='*' element={<PageFade><NotFoundPage /></PageFade>} />
      </Routes>
    </AnimatePresence>
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
            <AmbientBackdrop />
            <RainCanvas />
            <AppRoutes />
          </div>
          <CommandPaletteHotkey />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
