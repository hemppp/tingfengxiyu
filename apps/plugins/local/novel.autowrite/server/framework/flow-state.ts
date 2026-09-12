// ============================================================
// 流转状态机（纯函数，无 I/O —— 可单测）
//
// 章节内流程：planned → written → checked → polished → delivered
//   - 校对（硬门）不通过：停在 written，附修正指令，重写后再校
//   - 评审（软门）低于阈值：打回 written，附评语
//   - 同一门连续失败 retries 次由调用方判定隔离（纯状态机不管计数）
//
// 编排器（LLM）提议，本状态机裁决：越界转移一律拒绝并回喂原因。
// ============================================================

/** 章节内流程步骤 */
export type FlowStep = 'planned' | 'written' | 'checked' | 'polished' | 'delivered';

/** 编排器可请求的动作 */
export type FlowAction = 'write' | 'check' | 'polish' | 'confirm';

export interface TransitionVerdict {
  ok: boolean;
  /** 拒绝原因（回喂给编排器，指导其纠正） */
  reason?: string;
}

const STEP_LABEL: Record<FlowStep, string> = {
  planned: '待写作',
  written: '已出稿',
  checked: '校对通过',
  polished: '润色完成',
  delivered: '已交付',
};

/** 查询某动作在当前步骤下是否合法（不改变状态） */
export function canTransition(step: FlowStep, action: FlowAction): TransitionVerdict {
  switch (action) {
    case 'write':
      if (step === 'planned' || step === 'written') return { ok: true };
      return { ok: false, reason: `本章当前状态「${STEP_LABEL[step]}」，不能重新出稿（已通过审查的稿件请勿覆盖，如需重写请说明理由并走确认）` };
    case 'check':
      if (step === 'written') return { ok: true };
      return { ok: false, reason: `校对前必须先出稿：当前状态「${STEP_LABEL[step]}」` };
    case 'polish':
      if (step === 'checked') return { ok: true };
      return { ok: false, reason: `润色前必须通过一致性校对：当前状态「${STEP_LABEL[step]}」` };
    case 'confirm':
      if (step === 'checked' || step === 'polished') return { ok: true };
      return { ok: false, reason: `交付前必须通过审查：当前状态「${STEP_LABEL[step]}」` };
  }
}

/** 应用动作，返回新步骤（调用前须先 canTransition） */
export function applyAction(step: FlowStep, action: FlowAction): FlowStep {
  switch (action) {
    case 'write':
      return 'written';
    case 'check':
      return 'checked'; // 失败时调用方回退为 'written'
    case 'polish':
      return 'polished'; // 打回时调用方回退为 'written'
    case 'confirm':
      return 'delivered';
  }
}

/** 门失败后的回退步骤 */
export function stepAfterGateFail(): FlowStep {
  return 'written';
}

/**
 * 预算判定：本章累计产出字符数是否超预算。
 * 返回 'ok'（继续）| 'exceeded'（调用方应暂停批次请示作者）。
 */
export function budgetVerdict(usedChars: number, budget?: number): 'ok' | 'exceeded' {
  if (!budget || budget <= 0) return 'ok';
  return usedChars > budget ? 'exceeded' : 'ok';
}

/** 批次级状态 */
export type BatchStatus = 'planned' | 'running' | 'gate' | 'paused' | 'quarantined' | 'done';
