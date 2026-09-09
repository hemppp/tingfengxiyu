import { useEffect, useRef, useCallback } from 'react';

// ── 用扁平 Float32Array 替代对象数组，提升缓存局部性 ──
// 每片叶子占用 18 个 slot
const SLOT_COUNT = 18;
const IDX = {
  x: 0, y: 1, vx: 2, vy: 3,
  rotation: 4, rotationSpeed: 5,
  opacity: 6, maxOpacity: 7,
  swayOffset: 8, swaySpeed: 9,
  grounded: 10, groundedTime: 11,
  scale: 12, stayDuration: 13,
  groundSlideVx: 14, groundRotationDir: 15,
  groundY: 16, spriteIndex: 17,
};

interface BambooLeafRainProps {
  active?: boolean;
  count?: number;
}

// 竹叶颜色
const LEAF_COLORS: [number, number, number][] = [
  [25, 80, 25], [35, 100, 30], [55, 95, 40], [70, 120, 45],
];
const SPRITE_SIZES = [
  { length: 35, width: 7 }, { length: 50, width: 10 }, { length: 65, width: 13 },
];
const SPRITE_COUNT = LEAF_COLORS.length * SPRITE_SIZES.length;

// ── 快速 PRNG（替换 Math.random，约 3x 更快）──
// xorshift32
let prngState = Date.now() & 0x7fffffff;
function fastRand(): number {
  prngState ^= prngState << 13;
  prngState ^= prngState >> 17;
  prngState ^= prngState << 5;
  return (prngState >>> 0) / 4294967296;
}

// ── sin 查找表 ──
const SIN_TABLE = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  SIN_TABLE[i] = Math.sin((i / 256) * Math.PI * 2);
}

// ── 重置一片叶子（内联复用）──
function resetLeaf(data: Float32Array, off: number, w: number, h: number) {
  data[off + IDX.x] = fastRand() * w;
  data[off + IDX.y] = -50 - fastRand() * 150;
  data[off + IDX.vx] = 0.2 + fastRand() * 0.4;
  data[off + IDX.vy] = 0.5 + fastRand() * 0.8;
  data[off + IDX.rotation] = fastRand() * Math.PI * 2;
  data[off + IDX.rotationSpeed] = (fastRand() - 0.5) * 0.03;
  data[off + IDX.maxOpacity] = 0.5 + fastRand() * 0.35;
  data[off + IDX.opacity] = data[off + IDX.maxOpacity]!;
  data[off + IDX.swayOffset] = (fastRand() * 256) | 0;
  data[off + IDX.swaySpeed] = 0.02 + fastRand() * 0.02;
  data[off + IDX.grounded] = 0;
  data[off + IDX.groundedTime] = 0;
  data[off + IDX.scale] = 1;
  data[off + IDX.stayDuration] = 2.5 + fastRand() * 1.5;
  data[off + IDX.groundSlideVx] = 0;
  data[off + IDX.groundRotationDir] = fastRand() > 0.5 ? 1 : -1;
  data[off + IDX.groundY] = h * 0.92 + fastRand() * (h * 0.05);
  data[off + IDX.spriteIndex] = (fastRand() * SPRITE_COUNT) | 0;
}

export function BambooLeafFollow({
  active = true,
  count = 45,
}: BambooLeafRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<Float32Array>(new Float32Array(0));
  const rafRef = useRef<number>(0);
  // 拖拽挂起标记：为 true 时不注册下一帧 rAF，由 MutationObserver 恢复
  const pausedRef = useRef(false);
  const sizeRef = useRef({ w: 0, h: 0 });
  const spritesRef = useRef<HTMLCanvasElement[]>([]);

  // 预渲染竹叶精灵
  const createSprites = useCallback(() => {
    const sprites: HTMLCanvasElement[] = [];
    for (let ci = 0; ci < LEAF_COLORS.length; ci++) {
      const color = LEAF_COLORS[ci]!;
      for (let si = 0; si < SPRITE_SIZES.length; si++) {
        const size = SPRITE_SIZES[si]!;
        const canvas = document.createElement('canvas');
        const padding = 4;
        const w = size.width * 2 + padding * 2;
        const h = size.length + padding * 2;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const halfLen = size.length / 2;
        const halfWid = size.width / 2;
        const cx = w / 2;
        const cy = h / 2;

        ctx.beginPath();
        ctx.moveTo(cx, cy - halfLen);
        ctx.bezierCurveTo(cx + halfWid * 1.2, cy - halfLen * 0.3, cx + halfWid * 1.2, cy + halfLen * 0.3, cx, cy + halfLen);
        ctx.bezierCurveTo(cx - halfWid * 1.2, cy + halfLen * 0.3, cx - halfWid * 1.2, cy - halfLen * 0.3, cx, cy - halfLen);
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgb(' + Math.max(0, color[0] - 10) + ',' + Math.max(0, color[1] - 10) + ',' + Math.max(0, color[2] - 5) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - halfLen * 0.9);
        ctx.lineTo(cx, cy + halfLen * 0.9);
        ctx.stroke();
        sprites.push(canvas);
      }
    }
    spritesRef.current = sprites;
  }, []);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeRef.current = { w, h };

    const totalSlots = count * SLOT_COUNT;
    let data = dataRef.current;
    if (data.length !== totalSlots) {
      data = new Float32Array(totalSlots);
      dataRef.current = data;
    }

    for (let i = 0; i < count; i++) {
      const off = i * SLOT_COUNT;
      data[off + IDX.x] = fastRand() * w;
      data[off + IDX.y] = fastRand() * h;
      data[off + IDX.vx] = 0.2 + fastRand() * 0.4;
      data[off + IDX.vy] = 0.5 + fastRand() * 0.8;
      data[off + IDX.rotation] = fastRand() * Math.PI * 2;
      data[off + IDX.rotationSpeed] = (fastRand() - 0.5) * 0.03;
      data[off + IDX.maxOpacity] = 0.5 + fastRand() * 0.35;
      data[off + IDX.opacity] = data[off + IDX.maxOpacity]!;
      data[off + IDX.swayOffset] = (fastRand() * 256) | 0;
      data[off + IDX.swaySpeed] = 0.02 + fastRand() * 0.02;
      data[off + IDX.grounded] = 0;
      data[off + IDX.groundedTime] = 0;
      data[off + IDX.scale] = 1;
      data[off + IDX.stayDuration] = 2.5 + fastRand() * 1.5;
      data[off + IDX.groundSlideVx] = 0;
      data[off + IDX.groundRotationDir] = fastRand() > 0.5 ? 1 : -1;
      data[off + IDX.groundY] = h * 0.92 + fastRand() * (h * 0.05);
      data[off + IDX.spriteIndex] = (fastRand() * SPRITE_COUNT) | 0;
    }

    return ctx;
  }, [count]);

  useEffect(() => {
    if (!active) return;

    const sprites = spritesRef.current;
    if (sprites.length === 0) {
      createSprites();
    }

    const ctx = setupCanvas();
    if (!ctx) return;

    // 延迟一帧再启动，确保 sprites 已创建
    if (spritesRef.current.length === 0) return;

    const data = dataRef.current;
    let { w, h } = sizeRef.current;
    const fadeInZone = h * 0.06;
    // ★ 帧率无关的时间步进：rAF 被节流时（后台标签页/嵌入式视口可低至 ~1fps），
    //   固定 step=1 会让叶子以 1/60 速度落下与消散，堆积成色带。
    //   改为按真实时间推进：以 60fps 为基准步长 1，单帧最多补 120 步
    //   （约 2 秒物理量），防止长时间暂停后叶子瞬移。
    let lastTime = performance.now();
    const sinPhaseStep = 0.5;
    let sinPhase = 0;
    const spritesArray = spritesRef.current;
        const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const handleResize = () => {
      const dpr2 = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr2;
      canvas.height = h * dpr2;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
    };

    window.addEventListener('resize', handleResize);

    // 拖拽结束时由 observer 恢复 rAF 循环
    const resumeLoop = () => {
      if (pausedRef.current && !document.body.classList.contains('nm-dragging-active')) {
        pausedRef.current = false;
        lastTime = performance.now();
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    const loop = (now: number) => {
      // 拖拽浮窗时真正挂起雨效渲染：不注册下一帧 rAF，空转循环同样占用帧预算
      if (document.body.classList.contains('nm-dragging-active')) {
        pausedRef.current = true;
        return;
      }
      const step = Math.min((now - lastTime) / 16.667, 120);
      lastTime = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      sinPhase += sinPhaseStep * step;
      const sinPhaseInt = (sinPhase | 0) & 255;

      for (let i = 0; i < count; i++) {
        const off = i * SLOT_COUNT;

        let x = data[off + IDX.x]!;
        let y = data[off + IDX.y]!;
        let vx = data[off + IDX.vx]!;
        let vy = data[off + IDX.vy]!;
        let rotation = data[off + IDX.rotation]!;
        let rotationSpeed = data[off + IDX.rotationSpeed]!;
        let opacity: number;
        let maxOpacity = data[off + IDX.maxOpacity]!;
        let swayOffset = data[off + IDX.swayOffset]!;
        let grounded = data[off + IDX.grounded]!;
        let groundedTime = data[off + IDX.groundedTime]!;
        let scale = data[off + IDX.scale]!;
        let stayDuration = data[off + IDX.stayDuration]!;
        let groundY = data[off + IDX.groundY]!;
        let spriteIndex = data[off + IDX.spriteIndex]!;

        if (grounded) {
          groundedTime += step;
          opacity = maxOpacity * Math.max(0, 1 - (groundedTime - stayDuration * 0.5) / (stayDuration * 0.5));
          x += data[off + IDX.groundSlideVx]! * step;
          data[off + IDX.groundedTime] = groundedTime;
          data[off + IDX.opacity] = opacity;
          data[off + IDX.x] = x;

          if (opacity <= 0) {
            resetLeaf(data, off, w, h);
            continue;
          }
        } else {
          const sinIdx = (sinPhaseInt + swayOffset) & 255;
          x += (vx + SIN_TABLE[sinIdx]! * 0.6) * step;
          y += vy * step;
          rotation += rotationSpeed * step;

          if (y < fadeInZone) {
            opacity = maxOpacity * (y / fadeInZone);
          } else {
            opacity = maxOpacity;
          }

          if (y >= groundY) {
            y = groundY;
            grounded = 1;
            groundedTime = 0;
            data[off + IDX.groundSlideVx] = (fastRand() - 0.5) * 1.5;
          }

          if (x > w + 100 || x < -100) {
            resetLeaf(data, off, w, h);
            continue;
          }
        }

        data[off + IDX.x] = x;
        data[off + IDX.y] = y;
        data[off + IDX.rotation] = rotation;
        data[off + IDX.opacity] = opacity;
        data[off + IDX.scale] = scale;
        data[off + IDX.grounded] = grounded;
        data[off + IDX.groundedTime] = groundedTime;

        const sprite = spritesArray[spriteIndex];
        if (sprite && opacity > 0.01) {
          ctx.globalAlpha = opacity > 1 ? 1 : opacity;
          ctx.setTransform(
            Math.cos(rotation) * scale * dpr,
            Math.sin(rotation) * scale * dpr,
            -Math.sin(rotation) * scale * dpr,
            Math.cos(rotation) * scale * dpr,
            x * dpr,
            y * dpr,
          );
          ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    // 监听 body 的 class 变化：拖拽结束（.nm-dragging-active 移除）时恢复渲染
    const observer = new MutationObserver(resumeLoop);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, count, createSprites, setupCanvas]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
        display: 'block',
        willChange: 'transform',
        transform: 'translateZ(0)',
        contain: 'paint strict',
      }}
    />
  );
}
