import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

/**
 * 页面级入场过渡（**只做入场，不做退场**）。
 *
 * ★ 2026-10-06「跳转页面都要加载」全修复：
 *   原先是 `<AnimatePresence mode="wait">` 包着 `<Routes>`，旧页 exit 跑完才挂载新页面 ——
 *   exit 时长因此是**串行硬等待**，直接叠加在每次跨段跳转上：新页面不仅晚 140ms 挂载，
 *   它的数据请求、chunk 求值也全部顺延。
 *   试过 `mode="sync"`（新旧并行），但两棵**全高**页面会同时留在文档流里，页面高度瞬时翻倍、
 *   出现可见跳动。所以这里干脆去掉 AnimatePresence：旧页立即卸载、新页立即挂载并播放入场淡入。
 *   零等待、零布局跳动，视觉上仍保留过渡感。
 *
 * key 取 pathname 第一段：`/project/:bookId/:chapterId` 切换章节时 key 不变，入场动画不重放，
 * 编辑器实例与浮窗状态得以保留。key 放在 motion.div 上（而不是放在调用处），
 * 这样所有 `<PageFade>` 调用点都不用改。
 *
 * ★ 2026-10-07「跳转画面会加载一下」修复（第二轮）：
 *   上面那版虽然去掉了 exit 串行等待，但入场仍从 `opacity: 0` 起、跑 280ms ——
 *   **透明度归零等于整页闪一下**，尤其是深色界面上白底（`index.html` 的
 *   `color-scheme: light`）透出来的一瞬最刺眼，用户感知就是「又加载了一下」。
 *   现在起点抬到 `opacity: 0.4`（页面上任何东西都不会消失），时长压到 160ms、
 *   位移减到 4px：保留「换了页面」的过渡感，但不再出现空白帧。
 */
const pageVariants = {
  initial: { opacity: 0.4, y: 4 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.16, ease: [0.28, 1, 0.22, 1] as const },
  },
};

const PageFade = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  // 路由段指纹：只在「跨大段」跳转时变化，段内（切章节/切书）保持不变
  const routeKey = location.pathname.split('/').filter(Boolean)[0] ?? '';
  return (
    <motion.div
      key={routeKey}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      style={{ minHeight: '100%' }}
    >
      {children}
    </motion.div>
  );
};

export default PageFade;
