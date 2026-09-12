// ============================================================
// FloatingBubbles — 功能面板入口的转轮选择器（2026-09-10 重构 / 09-11 可拖动 + 完全收纳）
//
// 待机 = 一颗「罗盘」主气泡；悬停（或点击）如花旋转展开，
// 全部功能面板气泡沿半圆轮盘铺开进页面：
//   - 半径按面板数量自适应，保证相邻气泡中心距 ≥ 直径 + 间隙
//   - 已打开面板的气泡高亮，再次点击 = 关闭该面板（开/关切换）
//   - 屏幕过窄自动钳制半径；移开 280ms 后自动收拢（跨缝隙有感应垫兜底）
//   - ★ 收拢 = 卫星旋转 + 缩到 0.06 并淡出，完全没入罗盘（此前 scale 0.25 会残留一圈可见气泡）
//   - ★ 罗盘可拖动到任意位置，位置存 localStorage；半圆按罗盘所在半屏自动换向（贴右时向左展开）
// ============================================================

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Compass, Puzzle, type LucideIcon } from 'lucide-react';
import type { FloatingPanelDef } from '@/plugin/types';

const BUBBLE = 44;            // 卫星直径
const MIN_CHORD = BUBBLE + 6; // 相邻卫星中心最小间距
const HUB = 52;               // 罗盘主气泡直径
/** 罗盘默认位置：贴页面左缘、垂直居中（右侧由视口高度算出） */
const DEFAULT_HUB_X = 30;
/** 罗盘位置持久化 key */
const POS_STORAGE_KEY = 'novelmuse:floating-hub-pos';
/** 判定为「拖动」而非「点击」的位移阈值（px） */
const DRAG_THRESHOLD = 4;
/** 罗盘中心距视口边缘的最小留白（px） */
const EDGE_PAD = 12;

type HubPos = { x: number; y: number };

/** 把罗盘中心钳制在视口内（留 EDGE_PAD 余量），保证永远抓得到 */
function clampHub(p: HubPos): HubPos {
  const half = HUB / 2;
  const minX = half + EDGE_PAD;
  const minY = half + EDGE_PAD;
  const maxX = Math.max(minX, window.innerWidth - half - EDGE_PAD);
  const maxY = Math.max(minY, window.innerHeight - half - EDGE_PAD);
  return {
    x: Math.min(maxX, Math.max(minX, p.x)),
    y: Math.min(maxY, Math.max(minY, p.y)),
  };
}

function loadHubPos(): HubPos {
  const fallback = { x: DEFAULT_HUB_X, y: Math.round(window.innerHeight / 2) };
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<HubPos>;
    if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return clampHub({ x: p.x, y: p.y });
    }
  } catch {
    /* 存储损坏/被禁用：静默回落默认位置 */
  }
  return fallback;
}

function saveHubPos(p: HubPos): void {
  try {
    window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式等：存不上也不影响本次会话 */
  }
}

interface FloatingBubblesProps {
  panels: FloatingPanelDef[];
  /** 当前打开的面板 key（这些气泡高亮，点击 = 关闭） */
  openKeys: string[];
  /** 开/关切换（面板已开 = 关闭，未开 = 打开） */
  onToggle: (key: string) => void;
}

function WheelBubble({
  icon: Icon, label, active, onClick, x, y, delay,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  x: number;
  y: number;
  delay: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开${label}面板`}
      aria-pressed={active}
      aria-haspopup="dialog"
      title={active ? `${label}（已打开，点击关闭）` : label}
      className="group absolute flex items-center justify-center rounded-full transition-opacity duration-300 ease-out hover:scale-110 active:scale-95"
      style={{
        left: x,
        top: y,
        width: BUBBLE,
        height: BUBBLE,
        marginLeft: -BUBBLE / 2,
        marginTop: -BUBBLE / 2,
        transitionDelay: `${delay}ms`,
        background: active
          ? 'linear-gradient(160deg, hsl(var(--primary)), hsl(var(--primary) / 0.75))'
          : 'radial-gradient(circle at 30% 26%, rgb(255 255 255 / 0.9), rgb(var(--glass-tint) / 0.35) 55%)',
        border: `1px solid ${active ? 'hsl(var(--primary))' : 'rgb(255 255 255 / 0.6)'}`,
        boxShadow: active
          ? '0 4px 16px hsl(var(--primary) / 0.4), inset 0 1px 4px rgb(255 255 255 / 0.5)'
          : '0 3px 12px hsl(var(--foreground) / 0.14), inset 0 1px 4px rgb(255 255 255 / 0.7)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--ink) / 0.7)',
      } as CSSProperties}
    >
      <Icon size={17} aria-hidden="true" />
      <span
        className="absolute top-full mt-1 whitespace-nowrap text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          color: 'hsl(var(--ink))',
          background: 'rgb(var(--glass-tint) / 0.85)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {label}
      </span>
    </button>
  );
}

export function FloatingBubbles({ panels, openKeys, onToggle }: FloatingBubblesProps) {
  const [open, setOpen] = useState(false);
  const [hubPos, setHubPos] = useState<HubPos>(loadHubPos);
  const [dragging, setDragging] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 拖动真值：全程走 ref，松手才回写 state（拖动期间零 React 重渲染）
  const dragRef = useRef<null | { sx: number; sy: number; ox: number; oy: number; moved: boolean }>(null);
  const hubPosRef = useRef(hubPos);
  // 拖动结束会紧跟一次 click，用它吞掉这次误触
  const justDraggedRef = useRef(false);

  useEffect(() => { hubPosRef.current = hubPos; }, [hubPos]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => () => cancelClose(), [cancelClose]);

  // 视口变化：重新钳制，避免罗盘被挤到屏幕外
  useEffect(() => {
    const onResize = () => { setHubPos((p) => clampHub(p)); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, []);

  const handleEnter = useCallback(() => {
    if (dragRef.current) return; // 拖动中不展开，否则轮盘跟着手乱飞
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const handleLeave = useCallback(() => {
    if (dragRef.current) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 280);
  }, [cancelClose]);

  const toggleWheel = useCallback(() => setOpen((v) => !v), []);

  // ---- 罗盘拖动（pointer 事件 + 阈值区分点击）----
  const onHubPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: hubPosRef.current.x,
      oy: hubPosRef.current.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onHubPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      cancelClose();
      setOpen(false);        // 拖动即收拢
      setDragging(true);
      // 与浮窗拖动一致：通知背景 canvas rAF 让路，消除拖动迟滞
      document.body.classList.add('nm-dragging-active');
    }
    setHubPos(clampHub({ x: d.ox + dx, y: d.oy + dy }));
  }, [cancelClose]);

  const onHubPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (!d.moved) return;
    justDraggedRef.current = true;
    setDragging(false);
    document.body.classList.remove('nm-dragging-active');
    saveHubPos(hubPosRef.current);
  }, []);

  const onHubClick = useCallback(() => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    toggleWheel();
  }, [toggleWheel]);

  if (panels.length === 0) return null;

  // ---- 轮盘几何：随数量自适应，相邻卫星不重叠 ----
  // 展开方向随罗盘所在半屏自动换向：贴右半屏时向左铺，避免轮盘整个跑出视口
  const dir: 1 | -1 = hubPos.x > window.innerWidth / 2 ? -1 : 1;
  const n = panels.length;
  const spread = Math.min(180, 40 + n * 12); // 度（半圆，±spread/2）
  const arcRad = (spread * Math.PI) / 180;
  const step = n > 1 ? arcRad / (n - 1) : arcRad;
  // 半径上限：从罗盘朝展开方向到屏幕边缘的距离 - 余量
  const maxR = Math.max(
    120,
    Math.floor(dir === 1 ? window.innerWidth - hubPos.x : hubPos.x) - 64,
  );
  const radius = Math.min(
    maxR,
    Math.max(130, Math.ceil(MIN_CHORD / (2 * Math.sin(step / 2)))),
  );

  const hubClick = (key: string) => {
    onToggle(key);
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-50"
      style={{ left: hubPos.x, top: hubPos.y, width: 0, height: 0 }}
      role="toolbar"
      aria-label="功能转轮"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* 悬停感应垫：展开时罩住整个轮盘，跨缝隙移动不掉线 */}
      <div
        className="absolute rounded-full"
        aria-hidden="true"
        style={{
          left: -(radius + BUBBLE + 20),
          top: -(radius + BUBBLE + 20),
          width: (radius + BUBBLE + 20) * 2,
          height: (radius + BUBBLE + 20) * 2,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* 花开旋转层：收拢时整体旋 120° 缩到 0.06 并淡出（绕罗盘中心），所有卫星完全没入罗盘 */}
      <div
        className="absolute"
        style={{
          left: 0,
          top: 0,
          transform: open
            ? 'rotate(0deg) scale(1)'
            : `rotate(${dir === 1 ? 120 : -120}deg) scale(0.06)`,
          opacity: open ? 1 : 0,
          transformOrigin: '0px 0px',
          transition: 'transform 560ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {panels.map((p, idx) => {
          const aDeg = -spread / 2 + (spread * idx) / (n - 1); // 屏幕坐标：0° = 正右方
          const rad = (aDeg * Math.PI) / 180;
          const x = Math.cos(rad) * radius * dir;
          const y = Math.sin(rad) * radius;
          const Icon = p.icon ?? Puzzle;
          return (
            <WheelBubble
              key={p.key}
              icon={Icon}
              label={p.label}
              active={openKeys.includes(p.key)}
              onClick={() => hubClick(p.key)}
              x={x}
              y={y}
              delay={open ? idx * 30 : 0}
            />
          );
        })}
      </div>

      {/* 中心罗盘主气泡：悬停开花 + 点击兜底切换 + 按住拖动位置 */}
      <button
        type="button"
        onClick={onHubClick}
        onPointerDown={onHubPointerDown}
        onPointerMove={onHubPointerMove}
        onPointerUp={onHubPointerUp}
        onPointerCancel={onHubPointerUp}
        aria-label={open ? '收起功能转轮' : '展开功能转轮'}
        aria-expanded={open}
        title={dragging ? '拖动中…松手放置' : '功能转轮（可拖动）'}
        className="absolute flex items-center justify-center rounded-full transition-all duration-300 hover:scale-110 active:scale-95"
        style={{
          left: -HUB / 2,
          top: -HUB / 2,
          width: HUB,
          height: HUB,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          background: 'linear-gradient(160deg, hsl(var(--primary) / 0.92), hsl(var(--primary) / 0.6))',
          border: '1px solid hsl(var(--primary))',
          boxShadow: open
            ? '0 8px 28px hsl(var(--primary) / 0.55), inset 0 1px 4px rgb(255 255 255 / 0.5)'
            : '0 4px 16px hsl(var(--primary) / 0.35), inset 0 1px 4px rgb(255 255 255 / 0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: 'hsl(var(--primary-foreground))',
          transform: open ? 'rotate(90deg) scale(1.08)' : 'rotate(0deg)',
        }}
      >
        <Compass size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
