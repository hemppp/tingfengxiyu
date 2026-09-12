// ============================================================
// novel.autowrite 框架核心类型
//
// 技能 = 一等公民模块：
//   - chat 型：改变聊天视角（systemPrompt + contextKeys），框架零加工直通宿主
//   - flow 型：声明 FlowSpec，由框架驱动多代理流转 + 治理
// ============================================================

/** 技能定义（与宿主 ctx.ai.skills.register 的内联契约对齐） */
export interface SkillDef {
  id: string;
  systemPrompt: string;
  contextKeys: string[];
  name?: string;
  description?: string;
  color?: string;
}

/** 聊天型技能模块：只有 def */
export interface ChatSkillModule {
  kind: 'chat';
  def: SkillDef;
}

/** 治理配置（flow 型技能强制携带） */
export interface GovernanceConfig {
  /** 硬门步骤：机判不通过则流程不得前进（如一致性校对） */
  hardGates: string[];
  /** 软门：评审评分低于阈值时打回重写 */
  reviewer?: { step: string; threshold: number };
  /** 自愈重试上限（同一章同一门失败 N 次后批次转隔离） */
  retries: number;
  /** 每章 token 预算（粗粒度：以字符数近似；超支暂停请示） */
  budgetPerChapter?: number;
  /** 台账强制开启——框架常量，不提供关闭项 */
  auditLog: true;
}

/** 流程型技能声明 */
export interface FlowSpec {
  /** 流程步（有序） */
  steps: string[];
  /** 人工卡点：'per-chapter' 每章交付前停 / 'final' 仅批次结束停 */
  gate: 'per-chapter' | 'final';
  governance: GovernanceConfig;
}

export type SkillModule = ChatSkillModule;
