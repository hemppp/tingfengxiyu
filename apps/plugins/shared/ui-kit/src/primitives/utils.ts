/**
 * AI 交互原语 · 共用工具
 *
 * 本目录下的组件统一取用 globals.css「墨韵工艺层」的令牌：
 *   纸面  bg-paper / bg-canvas / bg-inset / bg-field / bg-hover
 *   墨线  border-paper-line / border-paper-line-strong
 *   文字  text-tone / text-tone-2 / text-tone-3
 *   圆角  rounded-chip / rounded-control / rounded-card / rounded-window
 *   投影  shadow-hairline / shadow-card / shadow-raised / shadow-overlay
 *   缓动  ease-link / ease-out-strong
 *
 * ⚠️ 三条不可越的线（否则这套体系会烂掉）：
 *   1. **不得引入新的彩色**。状态色一律走 SignalTone（bg-sig-* / text-sig-*）。
 *   2. **text-tone-3 只准用于 placeholder / disabled / 重复性的辅助元信息**
 *      （时间戳、装饰性序号这类「旁边还有别处也在说同一件事」的位置）。
 *      凡是**唯一承载某条信息**的文字都用 text-tone-2 —— tone-3 亮色只有 3.31:1，
 *      压在 paper-inset(94%) 上实测 3.47:1，**不过 WCAG AA(4.5)**；tone-2 在同底色上 4.85:1。
 *      ⚠️ 2026-09-18 真机实测踩过：SignalChip 的 idle 态（文案「待开始」）原本映射到 tone-3，
 *      是状态胶囊里唯一的信息载体 → 已在 TONE_TEXT 改为 tone-2。
 *   3. 数字一律加 mc-num（等宽数位），否则计数跳动。
 */

/** 条件类名拼接。项目里没有全局 cn，这里给原语层一个本地实现。 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * 状态语义 —— 全体系唯一的彩色出口。
 *
 * idle 待开始（灰，无彩色）· run 进行中 · done 已完成 · warn 待确认 · stop 失败
 * 映射到 globals.css 的 --sig-* 令牌；idle 刻意不给彩色，回到墨阶。
 */
export type SignalTone = 'idle' | 'run' | 'done' | 'warn' | 'stop';

/** 文字色 */
export const TONE_TEXT: Record<SignalTone, string> = {
  // ★ idle 必须是 tone-2 而不是 tone-3：胶囊里「待开始」是**唯一**的状态指示，
  //   tone-3(50%) 在亮色下只有 3.47:1，读屏之外的人得眯着眼看（2026-09-18 实测）
  idle: 'text-tone-2',
  run: 'text-sig-run',
  done: 'text-sig-done',
  warn: 'text-sig-warn',
  stop: 'text-sig-stop',
};

/** 极淡同色底（用于胶囊/指示条） */
export const TONE_BG: Record<SignalTone, string> = {
  idle: 'bg-paper-inset',
  run: 'bg-sig-run-tint',
  done: 'bg-sig-done-tint',
  warn: 'bg-sig-warn-tint',
  stop: 'bg-sig-stop-tint',
};

/** 状态 → 中文动词，用于无障碍名（"进行中"这类视觉标签读屏员读不到） */
export const TONE_LABEL: Record<SignalTone, string> = {
  idle: '待开始',
  run: '进行中',
  done: '已完成',
  warn: '待确认',
  stop: '失败',
};
