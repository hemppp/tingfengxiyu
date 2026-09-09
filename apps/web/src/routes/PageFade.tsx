import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * 页面级入场/退场过渡。
 * - 入场：淡入 + 轻微上移（0.4s expo-out）
 * - 退场：淡出 + 轻微上移（0.3s，比入场略快，退场不抢戏）
 *
 * 需配合 AnimatePresence 使用：AnimatePresence 检测到 Routes 的 key 变化时，
 * 保留旧 PageFade 触发 exit，挂载新 PageFade 触发 initial→animate。
 *
 * ProjectLayout 路由的 key 取 pathname 第一段（/project），章节切换（/project/:bookId/:chapterId）
 * 时 key 不变，不触发退场动画，编辑器/浮窗状态得以保留。
 */
const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.28, 1, 0.22, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const },
  },
};

const PageFade = ({ children }: { children: ReactNode }) => {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ minHeight: '100%' }}
    >
      {children}
    </motion.div>
  );
};

export default PageFade;
