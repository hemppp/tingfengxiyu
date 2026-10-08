import React, { Suspense, useEffect, useState, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * 全局路由 fallback：复用统一动画。
 *
 * ★ 2026-10-07「跳转加载转圈」全修复（⑤）：**防闪烁**。
 *
 * 为什么需要它：React.lazy 首次读取**必然**抛 thenable（即使 chunk 早已在模块缓存里，
 * `lazyInitializer` 也先置 Pending 再抛，只能在后续微任务里重试）。于是「chunk 已缓存」
 * 这种**零耗时**挂起也会挂载一次 fallback、紧接着卸载 —— 用户看到的就是整页大转圈
 * 闪一下。这正是「跳转画面会加载一下」里那个「加载一下」的观感来源。
 *
 * 做法：**延迟出现**。挂载后先什么都不渲染，超过 `SHOW_DELAY_MS` 才把转圈显示出来；
 * 若内容在这之前就绪，fallback 直接卸载、计时器一并清掉 ⇒ 全程无闪烁。
 *
 * 为什么不额外做「最短显示时长」：那需要把已就绪的路由内容也压住不放（否则
 * fallback 已被卸载，无从延长），等于让**已经可用的页面**为动画让路 —— 与「少转圈」
 * 的目标相反。延迟出现已经消除了「一闪而过」，留下的都是真实等待，本就该显示。
 */
const SHOW_DELAY_MS = 180;

export const RouteFallback: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // 延迟窗口内什么都不画（背景本就 transparent，与旧行为视觉一致）
  if (!visible) return null;

  return (
    <div className='h-full flex items-center justify-center' style={{ background: 'transparent' }}>
      <div className='flex flex-col items-center gap-3'>
        <Loader2 size={32} className='animate-spin text-primary' />
        <span className='text-sm text-muted-foreground'>加载中...</span>
      </div>
    </div>
  );
};

/**
 * 消除每个 lazy 路由都要写
 *   <Suspense fallback={<RouteFallback />}><X /></Suspense>
 * 的样板代码。
 */
export function lazyRoute<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): React.FC<React.ComponentPropsWithRef<T>> {
  const Lazy = React.lazy(loader);
  const Wrapped = ((props: React.ComponentPropsWithRef<T>) => (
    <Suspense fallback={<RouteFallback />}>
      <Lazy {...(props as any)} />
    </Suspense>
  )) as React.FC<React.ComponentPropsWithRef<T>>;
  Wrapped.displayName = 'LazyRoute';
  return Wrapped;
}
