import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 路由切换时把主滚动容器滚到顶部。
 * - 适用于整个页面级别 scroll（document.scrollingElement）
 * - 项目内/设置页内部 main 区域自己的滚动行为不受影响
 *
 * 延迟 320ms 执行：等待 AnimatePresence mode="wait" 的退场动画（0.3s）完成后才滚动，
 * 避免旧页面退场时 document 突然跳到顶部导致内容跳变。
 */
export const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const timer = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, 320);
    return () => clearTimeout(timer);
  }, [pathname]);
  return null;
};
