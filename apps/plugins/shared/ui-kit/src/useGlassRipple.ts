import { useCallback, useEffect, useRef } from 'react';

/**
 * useGlassRipple — iOS 26 液态玻璃点击发光扩散
 *
 * 在点击位置注入一个临时 span.glass-ripple-ink，从点击点向外扩散光晕，
 * 0.7s 后自动移除。配合 .glass-ripple 容器类（overflow:hidden）裁切波纹。
 *
 * 用法：
 *   const rippleProps = useGlassRipple();
 *   <button className="glass-ripple glass-pressable" {...rippleProps}>...</button>
 *
 * 或在已有 onClick 上叠加：
 *   const handleClick = useGlassRipple((e) => props.onClick?.());
 */
export function useGlassRipple<T extends HTMLElement = HTMLElement>(
  onPointerDown?: (e: React.PointerEvent<T>) => void,
) {
  // 持有所有在飞的 ripple 定时器，组件卸载时统一清理，避免 setState/DOM 操作 after unmount
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
    };
  }, []);

  return useCallback(
    (e: React.PointerEvent<T>) => {
      // 在点击位置注入波纹
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ink = document.createElement('span');
      ink.className = 'glass-ripple-ink';
      // 点击位置相对元素中心的偏移百分比，供 globals.css 色散渐变以正确位置为中心扩散
      const offsetX = ((x - rect.width / 2) / rect.width) * 100;
      const offsetY = ((y - rect.height / 2) / rect.height) * 100;
      ink.style.setProperty('--ripple-x', `${offsetX}%`);
      ink.style.setProperty('--ripple-y', `${offsetY}%`);
      ink.style.width = `${size}px`;
      ink.style.height = `${size}px`;
      ink.style.left = `${x}px`;
      ink.style.top = `${y}px`;
      target.appendChild(ink);

      // 动画结束后移除（定时器登记到 ref，卸载时清理）
      const timer = setTimeout(() => {
        if (ink.parentNode) ink.parentNode.removeChild(ink);
        timersRef.current.delete(timer);
      }, 750);
      timersRef.current.add(timer);

      onPointerDown?.(e);
    },
    [onPointerDown],
  );
}
