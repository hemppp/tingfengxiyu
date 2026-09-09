import React, { Suspense, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

/** 全局路由 fallback：复用统一动画 */
export const RouteFallback: React.FC = () => (
  <div className='h-full flex items-center justify-center' style={{ background: 'transparent' }}>
    <div className='flex flex-col items-center gap-3'>
      <Loader2 size={32} className='animate-spin text-primary' />
      <span className='text-sm text-muted-foreground'>加载中...</span>
    </div>
  </div>
);

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
