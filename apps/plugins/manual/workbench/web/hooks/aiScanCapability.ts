// ============================================================
// manual 模块内的 AI 扫描能力契约（本地声明，结构兼容 auto 侧 scanService）
//
// 为什么在模块内声明类型而不 import auto 的 scanService：
//   三层拆分禁止 manual → auto 的静态 import（门禁断言 A 的 M2A）。
//   模块内只保留「能力形状」的类型声明（纯类型，零运行时依赖），
//   运行时经 kernel 注册表 getCapability('ai.scan') 取实现；
//   auto 模块缺席 ⇒ 能力为 null ⇒ 调用点静默 return（设计 §5.3）。
// ============================================================

/** 流式时间线事件（与 auto 侧 scanService.StreamTimelineEvent 结构一致） */
export interface StreamTimelineEvent {
  title: string;
  description: string;
  type: 'event' | 'foreshadow' | 'state_change';
  characterNames: string[];
  chapterOrder: number;
  timestamp?: string;
}

/** 流式实体（角色/物品/地点） */
export interface StreamEntity {
  entityType: 'character' | 'item' | 'location';
  name: string;
  description: string;
  context: string;
  appearance?: string;
  personality?: string;
  role?: 'protagonist' | 'femaleLead' | 'supporting' | 'minor';
  speechStyle?: string;
  itemType?: string;
}

/** 流式物品流转 */
export interface StreamItemTransfer {
  transferType: 'item_transfer';
  itemName: string;
  fromCharacter: string;
  toCharacter: string;
  action: 'gained' | 'lost' | 'transferred' | 'held';
  context: string;
}

/** 流式角色别名关系 */
export interface StreamAliasMatch {
  aliasType: 'alias_match';
  primaryName: string;
  aliases: string[];
  context: string;
}

/** 扫描被跳过（后端红石开关关闭）时抛出的错误 —— 本地同名类，调用方用 instanceof 判定 */
export class ScanSkippedError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`扫描被跳过：${reason}`);
    this.name = 'ScanSkippedError';
    this.reason = reason;
  }
}

/**
 * `ai.scan` 能力的形状（auto 模块经 ctx.registerCapability('ai.scan', impl) 提供）。
 * 缺失（null）时：自动实体检测 / 最新章节轮询**静默 return**（设计 §5.3）。
 */
export interface AIScanCapability {
  scanTimelineStream(
    chapterContent: string,
    chapterOrder: number,
    existingEntities: {
      characters: Array<string | { name: string; aliases: string[] }>;
      items: string[];
      locations: string[];
    },
    onEvent: (event: StreamTimelineEvent) => void,
    onEntity?: (entity: StreamEntity) => void,
    onItemTransfer?: (transfer: StreamItemTransfer) => void,
    onAliasMatch?: (aliasMatch: StreamAliasMatch) => void,
    signal?: AbortSignal,
    projectId?: string,
  ): Promise<StreamTimelineEvent[]>;
  extractEventsByKeyword(
    content: string,
    title: string,
    order: number,
    keyword: string,
    onEvent: (event: StreamTimelineEvent) => void,
  ): Promise<void>;

  // ---- 红石开关面（见 AIScanRedstone）----
  isScannerEnabled: () => boolean;
  isExtractEnabled: () => boolean;
  registerAbort: (feature: string, controller: AbortController) => () => void;
  subscribeRedstone: (cb: () => void) => () => void;
}

/**
 * 红石开关面（scanner/extract）—— 与 scanService 同属 `ai.scan` 能力的一部分
 * （设计 §5.2 只允许 5 个能力名，故不新造 `ai.redstone` 契约）。
 * 能力缺失时：视为「已启用」，保持原行为（不改变既有语义）。
 */
export interface AIScanRedstone {
  isScannerEnabled: () => boolean;
  isExtractEnabled: () => boolean;
  registerAbort: (feature: string, controller: AbortController) => () => void;
  /** 订阅红石开关变化（供 useSyncExternalStore 保持响应性） */
  subscribeRedstone: (cb: () => void) => () => void;
}