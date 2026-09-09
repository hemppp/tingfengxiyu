// ============================================================
// splatTerrain — 高斯泼溅程序化地形引擎
// 用一组随机各向异性高斯核在低分辨率高度场上"泼溅"出
// 大陆、山脊、丘陵与海洋，经边缘衰减、高程配色、山体阴影
// 与颗粒纹理渲染到 Canvas。同一项目种子 → 同一地势；
// 重新泼溅（换种子）即可重掷一个世界。
// ============================================================

/** 泼溅核：二维（可旋转、各向异性）高斯 */
export interface Splat {
  /** 中心 u ∈ [0,100]（对应经度/x） */
  x: number;
  /** 中心 v ∈ [0,100]（对应纬度/y） */
  y: number;
  /** u 向 σ（世界单位） */
  sx: number;
  /** v 向 σ（世界单位） */
  sy: number;
  /** 旋转角（弧度） */
  angle: number;
  /** 振幅：正值隆起，负值凹陷 */
  amp: number;
}

/** 海平面高度（高度场单位） */
export const SEA_LEVEL = 0.32;

/** djb2 变种确定性哈希 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/** mulberry32 伪随机数生成器（确定性） */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 依据种子生成一批地形泼溅核：
 * 大陆基底 + 扁长山脊 + 丘陵 + 海湾（负核）+ 细节碎核。
 * 同一种子输出完全一致，保证同一项目地势稳定。
 */
export function makeTerrainSplats(seed: string): Splat[] {
  const rng = mulberry32(hashString(seed));
  const rand = (a: number, b: number) => a + rng() * (b - a);
  const splats: Splat[] = [];

  // 2-3 块大陆基底
  const continents = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < continents; i++) {
    splats.push({
      x: rand(30, 70), y: rand(32, 68),
      sx: rand(22, 38), sy: rand(18, 32),
      angle: rng() * Math.PI,
      amp: rand(0.9, 1.7),
    });
  }

  // 8-12 条山脊（扁长核，随机走向）
  const ridges = 8 + Math.floor(rng() * 5);
  for (let i = 0; i < ridges; i++) {
    splats.push({
      x: rand(15, 85), y: rand(15, 85),
      sx: rand(8, 20), sy: rand(1.5, 3.5),
      angle: rng() * Math.PI,
      amp: rand(0.25, 0.6),
    });
  }

  // 丘陵
  for (let i = 0; i < 9; i++) {
    splats.push({
      x: rand(10, 90), y: rand(10, 90),
      sx: rand(3, 7), sy: rand(3, 7),
      angle: 0, amp: rand(0.15, 0.45),
    });
  }

  // 海湾（负核，凿出海域）
  for (let i = 0; i < 3; i++) {
    splats.push({
      x: rand(8, 92), y: rand(8, 92),
      sx: rand(7, 14), sy: rand(7, 14),
      angle: 0, amp: -rand(0.3, 0.6),
    });
  }

  // 细节碎核（地形噪声）
  for (let i = 0; i < 42; i++) {
    splats.push({
      x: rand(0, 100), y: rand(0, 100),
      sx: rand(0.8, 2.2), sy: rand(0.8, 2.2),
      angle: 0, amp: rand(-0.07, 0.07),
    });
  }

  return splats;
}

/** 地点聚落核：每个故事地点在地形上顶起一座平缓丘地，让故事地理参与塑形 */
export function makeLocationSplats(points: { x: number; y: number }[]): Splat[] {
  return points.map((p) => ({
    x: p.x, y: p.y,
    sx: 5, sy: 5,
    angle: 0, amp: 0.3,
  }));
}

// ---- 高程配色 ----

type Stop = [t: number, r: number, g: number, b: number];

/** 亮色主题：陆地高程色带 */
const LIGHT_LAND: Stop[] = [
  [SEA_LEVEL, 232, 215, 168],
  [0.42, 185, 204, 143],
  [0.56, 127, 160, 101],
  [0.72, 141, 135, 118],
  [0.86, 185, 180, 166],
  [0.97, 242, 239, 230],
];
/** 亮色主题：海面深度色带（t=0 浅 → 1 深） */
const LIGHT_SEA: Stop[] = [
  [0, 168, 205, 224],
  [0.45, 108, 160, 190],
  [1, 38, 84, 118],
];
/** 暗色主题：陆地 */
const DARK_LAND: Stop[] = [
  [SEA_LEVEL, 86, 90, 72],
  [0.35, 74, 90, 66],
  [0.55, 56, 76, 56],
  [0.72, 88, 84, 76],
  [0.86, 118, 114, 104],
  [0.97, 168, 172, 168],
];
/** 暗色主题：海面 */
const DARK_SEA: Stop[] = [
  [0, 38, 74, 96],
  [0.45, 24, 52, 72],
  [1, 10, 24, 38],
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** smoothstep(0,1,t) */
function smooth01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** 在升序色带中取 t 处的插值颜色 */
function sampleStops(stops: Stop[], t: number): [number, number, number] {
  if (t <= stops[0]![0]) return [stops[0]![1], stops[0]![2], stops[0]![3]];
  for (let i = 1; i < stops.length; i++) {
    const s = stops[i]!;
    if (t <= s[0]) {
      const p = stops[i - 1]!;
      const f = (t - p[0]) / (s[0] - p[0] || 1);
      return [
        p[1] + (s[1] - p[1]) * f,
        p[2] + (s[2] - p[2]) * f,
        p[3] + (s[3] - p[3]) * f,
      ];
    }
  }
  const last = stops[stops.length - 1]!;
  return [last[1], last[2], last[3]];
}

export interface SplatRenderOptions {
  /** CSS 像素宽 */
  width: number;
  /** CSS 像素高 */
  height: number;
  dpr: number;
  splats: Splat[];
  theme: 'light' | 'dark';
}

/**
 * 将泼溅地形渲染到 canvas：
 * 高度场累积（低分辨率网格）→ 边缘衰减 → 高程配色 + 山体阴影 + 颗粒 → 双线性上采样。
 */
export function renderSplatTerrain(canvas: HTMLCanvasElement, opts: SplatRenderOptions): void {
  const { width, height, dpr, splats, theme } = opts;
  const gw = Math.max(72, Math.min(224, Math.round(width / 5)));
  const gh = Math.max(54, Math.min(168, Math.round(height / 5)));
  // 以 v 轴（0-100）为规范单位，u 距离按纵横比缩放，保证泼溅在像素空间近似各向同性
  const aspect = width / Math.max(1, height);

  const field = new Float32Array(gw * gh);

  const pre = splats.map((s) => {
    const sx = Math.max(0.6, s.sx) * aspect;
    const sy = Math.max(0.6, s.sy);
    const c = Math.cos(s.angle);
    const si = Math.sin(s.angle);
    return {
      x: s.x * aspect,
      y: s.y,
      c, si,
      isx: 1 / (2 * sx * sx),
      isy: 1 / (2 * sy * sy),
      amp: s.amp,
    };
  });

  for (let j = 0; j < gh; j++) {
    const v = (j / (gh - 1)) * 100;
    const rowBase = j * gw;
    for (let i = 0; i < gw; i++) {
      const u = (i / (gw - 1)) * 100 * aspect;
      let hgt = 0;
      for (let k = 0; k < pre.length; k++) {
        const p = pre[k]!;
        const dx = u - p.x;
        const dy = v - p.y;
        const rx = p.c * dx + p.si * dy;
        const ry = -p.si * dx + p.c * dy;
        const q = rx * rx * p.isx + ry * ry * p.isy;
        if (q > 4.6) continue; // exp(-4.6) ≈ 0.01，直接截断
        hgt += p.amp * Math.exp(-q);
      }
      // 边缘衰减：四周渐入海洋，形成"世界尽头"的岛围感
      const ex = Math.min(i, gw - 1 - i) / gw;
      const ey = Math.min(j, gh - 1 - j) / gh;
      field[rowBase + i] = hgt * smooth01(Math.min(ex, ey) / 0.09);
    }
  }

  // 配色到低分辨率画布
  const off = document.createElement('canvas');
  off.width = gw;
  off.height = gh;
  const octx = off.getContext('2d');
  if (!octx) return;
  const img = octx.createImageData(gw, gh);
  const data = img.data;

  const landStops = theme === 'light' ? LIGHT_LAND : DARK_LAND;
  const seaStops = theme === 'light' ? LIGHT_SEA : DARK_SEA;
  const shadeBase = theme === 'light' ? 0.84 : 0.72;
  const shadeGain = theme === 'light' ? 0.34 : 0.5;
  // 光源方向（西北偏上），归一化
  const lx = -0.55, ly = -0.5, lz = 0.673;

  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const idx = j * gw + i;
      const h = field[idx]!;
      let r: number, g: number, b: number;
      if (h < SEA_LEVEL) {
        const t = clamp01((SEA_LEVEL - h) / 0.5);
        [r, g, b] = sampleStops(seaStops, t);
        // 近岸浪花：浅水处略提亮
        if (t < 0.045) {
          const foam = 1 - t / 0.045;
          const foamR = theme === 'light' ? 244 : 132;
          const foamG = theme === 'light' ? 248 : 168;
          const foamB = theme === 'light' ? 240 : 176;
          r += (foamR - r) * foam * 0.4;
          g += (foamG - g) * foam * 0.4;
          b += (foamB - b) * foam * 0.4;
        }
      } else {
        const t = clamp01((h - SEA_LEVEL) / 1.15);
        [r, g, b] = sampleStops(landStops, t);
      }

      // 山体阴影：由中心差分梯度重建法线，与光源点积
      const hx1 = field[j * gw + Math.min(i + 1, gw - 1)]!;
      const hx0 = field[j * gw + Math.max(i - 1, 0)]!;
      const hy1 = field[Math.min(j + 1, gh - 1) * gw + i]!;
      const hy0 = field[Math.max(j - 1, 0) * gw + i]!;
      const nx = -(hx1 - hx0) * 48;
      const ny = -(hy1 - hy0) * 48;
      const len = Math.sqrt(nx * nx + ny * ny + 1);
      const shade = clamp01((nx * lx + ny * ly + lz) / len);
      const k = shadeBase + shadeGain * shade;

      // 颗粒纹理（确定性哈希噪声，避免大色块的塑料感）
      const n = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0;
      const grain = ((n % 97) / 97 - 0.5) * 5;

      const o = idx * 4;
      data[o] = clampByte(r * k + grain);
      data[o + 1] = clampByte(g * k + grain);
      data[o + 2] = clampByte(b * k + grain);
      data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);

  // 双线性上采样到目标画布
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, gw, gh, 0, 0, canvas.width, canvas.height);
}
