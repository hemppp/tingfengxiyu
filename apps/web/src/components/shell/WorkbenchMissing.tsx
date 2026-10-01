// ============================================================
// WorkbenchMissing — 工作台未安装占位（kernel 壳）
//
// 三层拆分后，工作台根组件由各模块经 ctx.registerWorkbench 注册
// （manual → 手写台，auto → AI 写作台）。当某模式对应的模块被关闭 /
// 分离（未注册工作台）时，kernel 渲染本占位而非报错或空白 —— 保证
// 「关闭任一模块后另一模块仍完全可用」时，被移除的那侧有明确提示。
// ============================================================

import { Puzzle } from 'lucide-react';
import type { ProjectMode } from '@novel/core/web';

export interface WorkbenchMissingProps {
  /** 缺失工作台对应的创作模式（用于文案区分） */
  mode?: ProjectMode;
}

const MODE_LABEL: Record<string, string> = {
  manual: '手写台',
  auto: 'AI 写作台',
};

export function WorkbenchMissing({ mode }: WorkbenchMissingProps) {
  const label = mode ? MODE_LABEL[mode] ?? '工作台' : '工作台';
  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-3 px-6 text-center"
      role="status"
      aria-label="工作台未安装"
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(120,120,128,0.12)' }}
      >
        <Puzzle size={26} style={{ color: '#aeaeb2' }} />
      </div>
      <div className="text-[15px] font-medium" style={{ color: 'var(--nm-text-primary, #1d1d1f)' }}>
        {label}未安装
      </div>
      <div className="text-[13px] max-w-[280px]" style={{ color: '#8e8e93' }}>
        该创作模式对应的模块未启用。启用后刷新即可使用。
      </div>
    </div>
  );
}

export default WorkbenchMissing;
