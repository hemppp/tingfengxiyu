// ============================================================
// FloatingBubbles — 功能面板的气泡化入口
//
// 气泡整齐排布在界面底部一行，做波浪式有序漂浮：
//   原地点击 → 气泡破裂动画 → 打开对应浮窗面板；
//   按住拖动 → 气泡跟随鼠标（漂移暂停），松手后弹回原位（不占新位置）；
//   面板关闭 → 气泡复合（重新聚成球）回到队列继续漂浮。
// 气泡的大小由面板 key 确定性哈希生成（刷新后不变），位置固定在底部队列。
// ============================================================

import { useCallback, useRef, useState } from 'react';
import { Puzzle } from 'lucide-react';
import type { FloatingPanelDef } from '@/plugin/types';

/** djb2 确定性哈希 → [0,1) */
function hashFraction(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 10000) / 10000;
}

const DRAG_THRESHOLD = 5; // px，超过即判定为拖动而非点击
/** 顶面横排队列：水平范围（%）。EDGE 放大以避开顶栏左右两侧的按钮区 */
const EDGE = 20;
/** 顶面横排的垂直位置（%）：气泡中心贴近页面最顶端（顶栏中央空带，z-50 在顶栏之上） */
const TOP_ROW = 5;

interface FloatingBubblesProps {
  panels: FloatingPanelDef[];
  /** 当前打开的面板 key（这些气泡隐藏——内容已展开） */
  openKeys: string[];
  onOpen: (key: string) => void;
}

/** 面板在顶面横排中的原位：水平均匀分布，垂直固定 */
function defaultPos(idx: number, total: number): { left: number; top: number } {
  const span = 100 - EDGE * 2;
  const left = total <= 1 ? 50 : EDGE + (idx / (total - 1)) * span;
  return { left, top: TOP_ROW };
}

interface DragState {
  key: string;
  startX: number;
  startY: number;
  moved: boolean;
}

export function FloatingBubbles({ panels, openKeys, onOpen }: FloatingBubblesProps) {
  // 正在破裂的气泡（burst 动画 0.22s 后真正打开面板；用定时器而非 animationend——
  // 切换 animation 属性时浏览器可能对旧动画补发 animationend，时序不可靠）
  const [burstingKey, setBurstingKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const handleClick = useCallback((key: string) => {
    setBurstingKey((cur) => cur ?? key);
    window.setTimeout(() => {
      onOpen(key);
      setBurstingKey((cur) => (cur === key ? null : cur));
    }, 230);
  }, [onOpen]);

  // ---- 拖动：pointerdown 起手，移动超阈值进入拖动；原点松手 = 点击 ----
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 指针捕获不可用时降级
    }
    dragRef.current = { key, startX: e.clientX, startY: e.clientY, moved: false };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    const d = dragRef.current;
    if (!d || d.key !== key) return;
    const el = e.currentTarget;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDraggingKey(key);
      // 吸收波浪偏移：把当前视觉位置（含漂浮偏移）写死为 left/top 基准，
      // 随后 animation:none 归零 transform，气泡不跳
      const r = el.getBoundingClientRect();
      el.style.left = ((r.left + r.width / 2) / window.innerWidth * 100) + '%';
      el.style.top = ((r.top + r.height / 2) / window.innerHeight * 100) + '%';
    }
    // 跟随鼠标：气泡中心对齐指针，clamp 在视口内
    el.style.left = Math.min(96, Math.max(2, e.clientX / window.innerWidth * 100)) + '%';
    el.style.top = Math.min(92, Math.max(6, e.clientY / window.innerHeight * 100)) + '%';
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>, key: string, idx: number, total: number) => {
    const d = dragRef.current;
    if (!d || d.key !== key) return;
    dragRef.current = null;
    const el = e.currentTarget;
    if (d.moved) {
      // 弹回原位：移除拖动类恢复过渡，把 inline 位置写回队列原位 → 平滑滑回去。
      // 注意保留 inline 值不清除：React 的 style prop 未变化时不会重写 DOM，
      // 清掉会让气泡失去定位；写回的值与声明值一致，无冲突。
      const home = defaultPos(idx, total);
      el.classList.remove('is-dragging');
      el.style.left = home.left + '%';
      el.style.top = home.top + '%';
    } else {
      // 原地点击 → 破裂打开面板
      handleClick(key);
    }
    setDraggingKey((cur) => (cur === key ? null : cur));
  }, [handleClick]);

  if (panels.length === 0) return null;

  return (
    <div className="nm-bubble-layer" aria-label="功能气泡" role="group">
      {panels.map((p, idx) => {
        if (openKeys.includes(p.key)) return null; // 面板开着 → 气泡已"破裂"展开
        const bursting = burstingKey === p.key;
        const dragging = draggingKey === p.key;
        const f2 = hashFraction(p.key + ':size');
        const home = defaultPos(idx, panels.length);
        const size = Math.round((46 + f2 * 18) * 0.8); // 基准缩小 20% → 37~51px
        const Icon = p.icon ?? Puzzle;
        return (
          <button
            key={p.key}
            type="button"
            className={`nm-bubble${bursting ? ' is-bursting' : ''}${dragging ? ' is-dragging' : ''}`}
            style={{
              left: `${home.left}%`,
              top: `${home.top}%`,
              // 有序波浪：统一幅度，按序号错开相位形成波浪传递
              '--bubble-dur': '4.2s',
              '--bubble-delay': `${-(idx * 0.32)}s`,
            } as React.CSSProperties}
            onPointerDown={(e) => handlePointerDown(e, p.key)}
            onPointerMove={(e) => handlePointerMove(e, p.key)}
            onPointerUp={(e) => handlePointerUp(e, p.key, idx, panels.length)}
            onPointerCancel={(e) => handlePointerUp(e, p.key, idx, panels.length)}
            title={p.label}
            aria-label={`打开${p.label}面板`}
            aria-haspopup="dialog"
          >
            <span
              className="nm-bubble-core"
              style={{ width: size, height: size }}
            >
              <Icon size={Math.round(size * 0.36)} aria-hidden="true" />
            </span>
            <span className="nm-bubble-label">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
