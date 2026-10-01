// ============================================================
// InkBackButton —— 毛笔手绘返回按钮（水墨化 2026-09-15）
//
// 为什么单独做：全站有 4 处「返回上一层」入口 ——
//   管理页 AdminPage / 设置页 SettingsPage / 写作工作台 AutoWriteWorkbench / 项目布局 ProjectLayout，
//   原先各自用 lucide 的几何箭头（ArrowLeft），线条均匀、无笔锋，与水墨风格不搭。
//
// 本组件统一提供两件东西：
//   ① 手绘笔触图标：非几何箭头 —— 有起笔顿点、弧线笔身、上下挑锋与飞白，
//      path 手绘并叠加不同粗细，模拟毛笔的提按。
//   ② 水墨交互反馈：
//      hover  墨迹自中心晕开（径向渐变 + blur 扩散），笔身轻微左移如起笔
//      active 墨点扩散一圈墨环向外化开，同时笔身下沉
//      focus  墨环（键盘可达，不用 outline）
//
// 样式类放在 globals.css 的 @layer components，前缀 nm-ink-back（避开既有 nm-* 命名）。
// 无障碍：默认 aria-label="返回"，可通过 label 覆盖；尊重 prefers-reduced-motion。
// ============================================================

export interface InkBackButtonProps {
  /** 点击行为（通常 navigate(-1) 或跳固定路由） */
  onClick?: () => void;
  /** 图标尺寸，默认 18 */
  size?: number;
  /** 无障碍标签，默认「返回」 */
  label?: string;
  /** 原生 title（悬停提示），默认同 label */
  title?: string;
  /** 追加类名 */
  className?: string;
  /** 禁用态 */
  disabled?: boolean;
}

/** 手绘毛笔左向箭头 —— 起笔顿点 + 弧形笔身 + 上下挑锋 + 飞白 */
function InkBrushArrow({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="nm-ink-back-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* 笔身主痕：自右向左的弧线（略带波折，非直线） */}
      <path
        d="M19.4 12.55c-3.5-.42-6.9-.6-10.2-.5-1.05.04-2.1.12-3.13.25"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 笔身副痕：偏下方叠一笔，形成提按的粗细变化 */}
      <path
        d="M17.6 13.5c-2.6-.2-5.15-.24-7.6-.12"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
        opacity="0.62"
      />
      {/* 起笔顿点：左端最重的一按 */}
      <path
        d="M5.55 12.35c-.62-.06-1.24.08-1.8.4"
        stroke="currentColor"
        strokeWidth="2.65"
        strokeLinecap="round"
      />
      {/* 上挑锋（箭头的一撇） */}
      <path
        d="M9.15 8.15C8.1 9.35 7.0 10.55 5.85 11.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {/* 下挑锋（箭头的另一撇，略短，模拟笔锋自然收束） */}
      <path
        d="M8.85 15.9c-1.05-1.05-2.05-2.15-2.98-3.3"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      {/* 飞白：笔身斜上方的断续细痕，模拟毫毛分叉 */}
      <path
        d="M18.0 11.15c-2.7-.3-5.35-.38-7.95-.24"
        stroke="currentColor"
        strokeWidth="0.85"
        strokeLinecap="round"
        strokeDasharray="2.4 2.6"
        opacity="0.42"
      />
      {/* 墨点：起笔处溅出的一点，破掉机械感 */}
      <circle cx="4.1" cy="14.15" r="0.62" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

export function InkBackButton({
  onClick,
  size = 18,
  label = '返回',
  title,
  className = '',
  disabled = false,
}: InkBackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={`nm-ink-back ${className}`.trim()}
    >
      <InkBrushArrow size={size} />
    </button>
  );
}

export default InkBackButton;
