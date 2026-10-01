import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * 页面级入场/退场过渡。
 *
 * ★ 时长即等待：上游是 AnimatePresence mode="wait" —— 旧页面 exit 跑完才挂载新页面，
 *   因此 exit 时长是**串行硬等待**，直接叠加在每次跨段跳转上。此处刻意压短：
 *   入场 0.28s（原 0.5s）、退场 0.14s（原 0.35s），保留质感但砍掉大部分空等。
 *
 * 需配合 AnimatePresence 使用：AnimatePresence 检测到 Routes 的 key 变化时，
 * 保留旧 PageFade 触发 exit，挂载新 PageFade 触发 initial→animate。
 *
 * ProjectLayout 路由的 key 取 pathname 第一段（/project），章节切换（/project/:bookId/:chapterId）
 * 时 key 不变，不触发退场动画，编辑器/浮窗状态得以保留。
 */
const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.28, 1, 0.22, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] as const },
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
