// ============================================================
// 全局环境背景 —— 水墨作画层（2026-09-15 重制）
//
// 设计取向：不再是「灰底 + 纹理」，而是**一幅铺满视口的水墨画**：
//   · 远山三重（近浓远浅，山腰有云气横穿）
//   · 竹枝一丛（左上，经典水墨构图）
//   · 三道飞白扫笔（如书法掠过纸面）
//   · 数点溅墨
//
// 为什么用 SVG 而不是 canvas：
//   ① 手绘 path 的粗细起收可直接控制，笔意比程序化绘制更「像手画的」
//   ② 不占 rAF、不随滚动重绘 —— canvas 那套（BambooLeafFollow）留给「会动」的东西
//   ③ feTurbulence + feDisplacementMap 把规则边缘打散，得到宣纸晕染的自然毛边
//
// 性能：两个滤镜只作用在这张**静态** SVG 上（挂载即渲染完成），没有动画，
//   因此不会持续占 GPU。整层 pointer-events:none，不干扰任何交互。
// 配色：全部走 hsl(var(--ink) / x) 与 hsl(var(--foreground) / x)，
//   因此浅色（水墨）与暗色（夜墨）两套主题都能自动反相。
// ============================================================

/** 远山三重轮廓（在 viewBox 0 0 1440 900 里占 y≈200–360 一段）
 *  ★ 山形必须有明显峰谷起伏 —— 平缓的弧线在 1440 宽上会被读成「一条灰色横带」，
 *    而不是山。因此每条都手绘 4–5 个高低不一的峰。 */
const INK_MOUNTAINS = {
  far:
    'M0,296 C70,272 120,224 186,214 C252,204 292,252 356,262 C420,272 466,226 534,216 C602,206 646,256 714,266 C782,276 828,230 896,220 C964,210 1008,258 1076,268 C1144,278 1200,236 1272,226 C1344,216 1404,252 1440,244 L1440,360 L0,360 Z',
  mid:
    'M0,318 C110,292 180,244 268,236 C356,228 410,272 496,280 C582,288 636,246 724,240 C812,234 866,276 954,284 C1042,292 1096,252 1184,246 C1272,240 1330,272 1440,264 L1440,360 L0,360 Z',
  near:
    'M0,338 C150,320 260,296 400,292 C540,288 640,314 780,312 C920,310 1020,290 1160,288 C1300,286 1380,302 1440,300 L1440,360 L0,360 Z',
};

/** 竹叶月牙形（一笔扫出的面，非描边）—— 以原点为叶柄，指向右上方 */
const LEAF_PATH = 'M0,0 C7,-11 19,-17 31,-15 C19,-6 8,2 0,0 Z';

/** 竹枝上的叶位：{x, y, rotate, scale} —— 手工摆出疏密，避免均匀分布 */
const BAMBOO_LEAVES: Array<{ x: number; y: number; r: number; s: number }> = [
  { x: 92, y: 132, r: -18, s: 1.0 },
  { x: 104, y: 150, r: 12, s: 0.86 },
  { x: 78, y: 156, r: -42, s: 0.92 },
  { x: 126, y: 118, r: -34, s: 0.78 },
  { x: 68, y: 186, r: -8, s: 0.82 },
  { x: 88, y: 196, r: 34, s: 0.7 },
  { x: 132, y: 168, r: -56, s: 0.68 },
  { x: 112, y: 210, r: 20, s: 0.6 },
  { x: 56, y: 148, r: -26, s: 0.74 },
];

export function AmbientBackdrop() {
  return (
    <div className="ambient-backdrop" aria-hidden="true">
      {/* 基底：宣纸色 + 大面积墨晕（CSS 层，见 globals.css） */}
      <div className="ambient-base" />

      {/* ★ 水墨作画层 */}
      <svg
        className="ambient-ink-painting"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          {/* 晕染：低频湍流 + 位移，把规则边缘打散成宣纸化开的毛边。
              ⚠️ feTurbulence 是这份背景里最贵的一步 —— 它按 filter 区域逐像素计算。
              numOctaves 从 3 降到 2：视觉几乎无差，计算与噪点量省约三分之一
              （首屏截图从 888KB 降到明显更小即为此处收敛的证据）。 */}
          <filter id="nm-ink-bleed" x="-8%" y="-14%" width="116%" height="132%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.019" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="1.1" />
          </filter>

          {/* 干笔飞白：高频湍流，把笔画打出断续的干涩感（同理收敛 octaves） */}
          <filter id="nm-ink-dry" x="-8%" y="-30%" width="116%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.55 0.85" numOctaves="2" seed="19" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" />
          </filter>

          {/* 墨韵渐变：模拟蘸墨后一笔之内的浓淡过渡 */}
          <linearGradient id="nm-ink-fade-x" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--ink))" stopOpacity="0" />
            <stop offset="18%" stopColor="hsl(var(--ink))" stopOpacity="0.5" />
            <stop offset="52%" stopColor="hsl(var(--ink))" stopOpacity="0.72" />
            <stop offset="86%" stopColor="hsl(var(--ink))" stopOpacity="0.32" />
            <stop offset="100%" stopColor="hsl(var(--ink))" stopOpacity="0" />
          </linearGradient>
          {/* 山体渲染：山脊浓、山脚渐隐 —— 这是远山不「发实」的关键。
              若用纯色实心填充，path 底边那条水平直线会让整座山读成「一块灰」，
              而不是「水墨里退到远处的山」。 */}
          <linearGradient id="nm-ink-fade-y" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--ink))" stopOpacity="0.9" />
            <stop offset="52%" stopColor="hsl(var(--ink))" stopOpacity="0.34" />
            <stop offset="100%" stopColor="hsl(var(--ink))" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* ── 远山三重：靠「位移差」拉开纵深 ──
             ★ 三条 path 原始山脊都在 y 200–340 这一段，若只整体平移会叠成「一片丘陵」。
             这里给每条**不同的纵向位移**（6 / 34 / 74），让远山最高、近山最低，
             形成山峦层叠的纵深感。
             ★ 填充用 nm-ink-fade-y（山脊浓、山脚渐隐），而不是纯色 —— 见该渐变的说明。 */}
        <g filter="url(#nm-ink-bleed)">
          <path d={INK_MOUNTAINS.far} transform="translate(0 6)" fill="url(#nm-ink-fade-y)" opacity="0.12" />
          <path d={INK_MOUNTAINS.mid} transform="translate(0 34)" fill="url(#nm-ink-fade-y)" opacity="0.2" />
          <path d={INK_MOUNTAINS.near} transform="translate(0 74)" fill="url(#nm-ink-fade-y)" opacity="0.28" />
        </g>

        {/* ── 水岸：远山脚下两道极淡墨线（起笔实、收笔虚），交代地平 ──
             ★ 此处曾试过画「云气」，但扁椭圆在 1440 宽上叠加必然被读成「背景条纹」……
             水墨构图宁可留白，也不要含糊的横带。删掉后画面反而更透气。 */}
        <g filter="url(#nm-ink-dry)" fill="none" strokeLinecap="round">
          <path
            d="M-20,772 C240,762 520,776 800,766 C1040,758 1260,770 1460,762"
            stroke="url(#nm-ink-fade-x)"
            strokeWidth="2.2"
            opacity="0.16"
          />
          <path
            d="M180,806 C420,798 640,810 900,802 C1080,796 1260,804 1420,798"
            stroke="url(#nm-ink-fade-x)"
            strokeWidth="1.4"
            opacity="0.11"
            strokeDasharray="200 26 140 34 240 20"
          />
        </g>

        {/* ── 竹枝一丛（左上）：竿用细笔折线，叶是一笔扫出的面 ── */}
        <g className="ambient-ink-bamboo" filter="url(#nm-ink-dry)">
          {/* 主竿：三段折线，带竹节顿挫 */}
          <path
            d="M40,286 C52,238 58,196 68,152 C74,124 84,100 96,78"
            stroke="hsl(var(--ink))"
            strokeOpacity="0.34"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
          {/* 分枝 */}
          <path
            d="M64,176 C84,168 104,164 128,162"
            stroke="hsl(var(--ink))"
            strokeOpacity="0.26"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M72,140 C92,132 112,130 134,130"
            stroke="hsl(var(--ink))"
            strokeOpacity="0.2"
            strokeWidth="1.2"
            fill="none"
            strokeLinecap="round"
          />
          {/* 叶：疏密不均，浓淡有别 */}
          {BAMBOO_LEAVES.map((l, i) => (
            <path
              key={i}
              d={LEAF_PATH}
              transform={`translate(${l.x} ${l.y}) rotate(${l.r}) scale(${l.s})`}
              fill="hsl(var(--ink))"
              opacity={0.3 - (i % 3) * 0.06}
            />
          ))}
        </g>

        {/* ── 飞白扫笔：三道横向掠过，像书法写完一横 ── */}
        <g filter="url(#nm-ink-dry)" fill="none" strokeLinecap="round">
          <path
            d="M760,150 C900,132 1060,146 1220,128 C1310,118 1380,126 1440,118"
            stroke="url(#nm-ink-fade-x)"
            strokeWidth="9"
            strokeDasharray="120 18 64 26 200 14 96 22 160 12"
            opacity="0.14"
          />
          <path
            d="M1180,262 C1270,252 1350,258 1440,248"
            stroke="url(#nm-ink-fade-x)"
            strokeWidth="13"
            strokeDasharray="150 20 90 30 120 16"
            opacity="0.1"
          />
          <path
            d="M-20,506 C120,494 260,510 400,498"
            stroke="url(#nm-ink-fade-x)"
            strokeWidth="7"
            strokeDasharray="86 22 130 18 70 26"
            opacity="0.09"
          />
        </g>

        {/* ── 溅墨：破掉整齐感，像收笔时甩出的点 ── */}
        <g fill="hsl(var(--ink))">
          <circle cx="1318" cy="96" r="3.4" opacity="0.2" />
          <circle cx="1348" cy="118" r="1.8" opacity="0.15" />
          <circle cx="1296" cy="126" r="2.2" opacity="0.13" />
          <circle cx="118" cy="322" r="2.6" opacity="0.16" />
          <circle cx="146" cy="336" r="1.5" opacity="0.11" />
          <circle cx="1428" cy="452" r="2.8" opacity="0.12" />
        </g>
      </svg>

      {/* 纸纹噪点（CSS 层） */}
      <div className="ambient-grain" />
    </div>
  );
}

export default AmbientBackdrop;
