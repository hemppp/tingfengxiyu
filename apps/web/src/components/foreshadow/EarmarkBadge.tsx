import { Bookmark, CheckCircle, Lightbulb } from 'lucide-react';
import type { Earmark, EarmarkType } from '@novel/shared';
import { cva } from 'class-variance-authority';

interface EarmarkBadgeProps {
  earmark: Earmark;
  onClick?: (earmark: Earmark) => void;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const earmarkConfig: Record<EarmarkType, { icon: typeof Bookmark; color: string; bgColor: string; label: string }> = {
  foreshadow_seed: {
    icon: Bookmark,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 hover:bg-green-500/20',
    label: '伏笔播种',
  },
  foreshadow_payoff: {
    icon: CheckCircle,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10 hover:bg-amber-500/20',
    label: '伏笔回收',
  },
  possibility: {
    icon: Lightbulb,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10 hover:bg-blue-500/20',
    label: '可能性',
  },
};

const sizeVariants = cva('inline-flex items-center gap-1 rounded-xl transition-colors cursor-pointer', {
  variants: {
    size: {
      sm: 'px-1.5 py-0.5 text-xs',
      md: 'px-2 py-1 text-sm',
    },
  },
  defaultVariants: {
    size: 'sm',
  },
});

export function EarmarkBadge({ earmark, onClick, size = 'sm', showLabel = true }: EarmarkBadgeProps) {
  const config = earmarkConfig[earmark.type];
  const Icon = config.icon;

  const handleClick = () => {
    onClick?.(earmark);
  };

  return (
    <div
      className={`${sizeVariants({ size })} ${config.bgColor}`}
      onClick={handleClick}
      title={earmark.description || config.label}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onClick) {
          onClick(earmark);
        }
      }}
    >
      <Icon className={`${config.color} ${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}`} />
      {showLabel && (
        <span className={`font-medium ${config.color}`}>{config.label}</span>
      )}
    </div>
  );
}
