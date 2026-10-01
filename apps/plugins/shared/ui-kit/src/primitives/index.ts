/**
 * AI 交互原语（AI Primitives）
 *
 * 一组面向"Agent 交互"的原子组件 —— 思考轨迹、工具调用、任务行、
 * 审批卡片、流式文本、代码块、提示栏、状态指示。
 *
 * 全部基于 globals.css「墨韵工艺层」的令牌，**不引入任何新彩色**：
 * 唯一的彩色出口是 SignalTone（bg-sig-* / text-sig-*），只用于状态指示。
 *
 * 排版纪律（务必遵守，否则这套体系会烂掉）：
 *   · text-tone-3 只用于 placeholder / disabled / 重复性辅助元信息（时间戳、装饰性序号、aria-hidden 图标）
 *   · **唯一承载某条信息**的文字一律 text-tone-2（亮色 4.61:1，过 AA）；
 *     tone-3 亮色 3.31:1、压在 paper-inset 上 3.47:1，不过 AA（2026-09-18 真机实测）
 *   · 数字加 mc-num
 *   · 圆角只用 chip / control / card / window 四档
 *   · 交互反馈用 .mc-press（active:scale）而不是"变暗"
 */

export { cn, TONE_BG, TONE_LABEL, TONE_TEXT, type SignalTone } from './utils';

export { Collapse, LoadingPixels, SignalChip, SignalDot } from './Signal';

export { ThinkingTrace, ThinkingStateChip, type ThinkingKind, type ThinkingStep } from './ThinkingTrace';

export { ToolChip, type ToolCallLike, type ToolStatus } from './ToolChip';

export { TaskList, TaskRow, type TaskItem, type TaskStatus } from './TaskRow';

export { ApprovalCard, ApprovalCardSkeleton, approvalMeta } from './ApprovalCard';

export { InlineActions, SourceStack, StreamingText, type SourceRef } from './StreamingText';

export { CodeBlock, type CodeLineKind } from './CodeBlock';

export { PromptBar } from './PromptBar';
