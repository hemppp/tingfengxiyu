// ============================================================
// 全局环境背景 (Ambient Backdrop)
// 用 CSS + SVG 构建分层氛围底，为玻璃质感提供可折射的背景：
//   1) 基底：瓷白 → 淡霁青 → 底部晕入靛 的氛围渐变
//   2) 远山地平线剪影（低透明度，mountain/mist 语义色）
//   3) 三颗彩色光球（霁青 / 雾靛 / 靛），呼吸漂移全走 GPU transform
//   4) 极低透明度噪点纹理，增加表面质感
// 整层固定铺满视口、z-index:-1、不响应鼠标事件（pointer-events:none）。
// 尊重 prefers-reduced-motion：减少动态时关闭背景动画（见 globals.css）。
// ============================================================

// 远山剪影路径，viewBox 0 0 1440 320，底部对齐拉伸
const MOUNTAIN_PATHS = {
  far: 'M0,210 C140,175 300,225 460,190 C620,155 780,205 940,180 C1100,155 1280,195 1440,168 L1440,320 L0,320 Z',
  near: 'M0,262 C200,230 420,258 640,240 C860,222 1080,252 1260,234 C1340,228 1400,238 1440,234 L1440,320 L0,320 Z',
};

export function AmbientBackdrop() {
  return (
    <div className="ambient-backdrop" aria-hidden="true">
      {/* 基底渐变 + 靛色薄纱 */}
      <div className="ambient-base" />
      {/* 远山地平线剪影 */}
      <svg
        className="ambient-mountains"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="ambient-mountain-far" d={MOUNTAIN_PATHS.far} />
        <path className="ambient-mountain-near" d={MOUNTAIN_PATHS.near} />
      </svg>
      {/* 三颗呼吸漂移的氛围光球 */}
      <div className="ambient-orb ambient-orb-a" />
      <div className="ambient-orb ambient-orb-b" />
      <div className="ambient-orb ambient-orb-c" />
      {/* 噪点纹理 */}
      <div className="ambient-grain" />
    </div>
  );
}

export default AmbientBackdrop;
