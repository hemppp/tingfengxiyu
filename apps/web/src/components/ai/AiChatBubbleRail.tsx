// ============================================================
// AiChatBubbleRail — 贴附在 AI 对话浮窗左缘的功能气泡栏
//
// AI 对话面板内的功能 UI（模式开关 / 技能 / 快捷语）收拢为
// 一列贴附在框框旁边的小气泡：
//   - 同步写入 / 工具调用 / Agent 模式：点击直接切换（互斥在宿主处理），激活态高亮
//   - 技能：点击弹出技能选择网格（SkillsBar embedded）
//   - 快捷语：点击弹出快捷语分组（QuickPromptsBar embedded），选择后经
//     nm-chat:pick-prompt 事件回填输入框
// 技能选择经 nm-chat:skill 事件回传 ChatPanel（保留续写弹窗拦截逻辑）。
// ============================================================

import { useState } from 'react';
import { PenLine, Wrench, Bot, Zap, MessageCircle, X, type LucideIcon } from 'lucide-react';
import { SkillsBar, QuickPromptsBar } from './ChatPanel';

interface AiChatBubbleRailProps {
  syncInsert: boolean;
  enableTools: boolean;
  enableAgent: boolean;
  activeSkillId: string | null;
  onToggleSync: () => void;
  onToggleTools: () => void;
  onToggleAgent: () => void;
  /** 技能选择（id 或 null=取消），宿主转发为 nm-chat:skill 事件给 ChatPanel */
  onSkillChange: (id: string | null) => void;
}

function RailBubble({
  icon: Icon, label, active, onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="group relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95"
      style={{
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
      }}
    >
      <Icon size={16} aria-hidden="true" />
      <span
        className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
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

export function AiChatBubbleRail({
  syncInsert, enableTools, enableAgent, activeSkillId,
  onToggleSync, onToggleTools, onToggleAgent, onSkillChange,
}: AiChatBubbleRailProps) {
  // 弹出的功能面板：技能选择 / 快捷语
  const [openFlyout, setOpenFlyout] = useState<null | 'skills' | 'prompts'>(null);

  const toggleFlyout = (which: 'skills' | 'prompts') => {
    setOpenFlyout((cur) => (cur === which ? null : which));
  };

  /** 技能选择经事件桥回传 ChatPanel（保留 continue-writer 弹窗拦截），选择后收起弹层 */
  const emitSkill = (id: string | null) => {
    onSkillChange(id);
    window.dispatchEvent(new CustomEvent('nm-chat:skill', { detail: id }));
    setOpenFlyout(null);
  };

  /** 快捷语选择经事件桥回填 ChatPanel 输入框 */
  const emitPrompt = (text: string) => {
    window.dispatchEvent(new CustomEvent('nm-chat:pick-prompt', { detail: text }));
    setOpenFlyout(null);
  };

  return (
    <div
      className="absolute -left-14 top-4 flex flex-col items-center gap-2.5 z-20"
      role="toolbar"
      aria-label="AI 对话功能气泡"
    >
      <RailBubble
        icon={PenLine}
        label={syncInsert ? '同步写入：开' : '同步写入：关'}
        active={syncInsert}
        onClick={onToggleSync}
      />
      <RailBubble
        icon={Wrench}
        label={enableTools ? '工具调用：开' : '工具调用：关'}
        active={enableTools}
        onClick={onToggleTools}
      />
      <RailBubble
        icon={Bot}
        label={enableAgent ? 'Agent 模式：开' : 'Agent 模式：关'}
        active={enableAgent}
        onClick={onToggleAgent}
      />
      <div className="w-6 h-px" style={{ background: 'hsl(var(--border) / 0.6)' }} aria-hidden="true" />
      <RailBubble
        icon={Zap}
        label={activeSkillId ? '技能（已激活）' : '选择技能'}
        active={activeSkillId !== null}
        onClick={() => toggleFlyout('skills')}
      />
      <RailBubble
        icon={MessageCircle}
        label="快捷语"
        active={openFlyout === 'prompts'}
        onClick={() => toggleFlyout('prompts')}
      />

      {/* 功能弹出层：快捷语 = 居中固定的椭圆气泡场；技能 = 覆盖浮窗上部 */}
      {openFlyout === 'prompts' && (
        <div
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[380px] p-4 rounded-2xl nm-glass-frost"
          style={{ border: '1px solid hsl(var(--border) / 0.5)' }}
          role="dialog"
          aria-label="快捷语"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">快捷语 · 点击填入</span>
            <button
              type="button"
              onClick={() => setOpenFlyout(null)}
              className="nm-btn-apple-icon-sm"
              aria-label="关闭快捷语"
              title="关闭"
            >
              <X size={12} />
            </button>
          </div>
          <QuickPromptsBar variant="bubbles" embedded onPick={emitPrompt} disabled={false} />
        </div>
      )}
      {openFlyout === 'skills' && (
        <div
          className="absolute left-12 top-0 w-80 max-h-[65vh] overflow-y-auto p-3 rounded-2xl space-y-2 nm-glass-frost"
          style={{ border: '1px solid hsl(var(--border) / 0.5)' }}
          role="dialog"
          aria-label="选择技能"
        >
          <SkillsBar
            embedded
            activeSkillId={activeSkillId}
            onActivate={emitSkill}
            onCancel={() => emitSkill(null)}
            disabled={false}
          />
        </div>
      )}
    </div>
  );
}
