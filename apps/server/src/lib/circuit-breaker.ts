// ============================================================
// 通用断路器（Circuit Breaker）
//
// 依赖无关、零外部包。用于包裹对不稳定下游（如 LLM Provider）的调用，
// 当其连续失败达到阈值时"熔断"（open），在冷却窗口内快速失败，
// 避免请求线程被慢/挂的下游拖垮（雪崩）。冷却结束后进入半开（half-open）
// 试探，成功则恢复（closed），失败则再次熔断。
//
// 设计取舍：
// - 仅统计"真正的失败"（通过 isFailure 自定义，例如把 4xx、用户取消 AbortError 排除）。
// - 不内置超时：超时由被包裹的函数自身处理（provider 已有 120s 超时），
//   避免两层超时互相干扰。
// ============================================================

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** 连续失败多少次后熔断（默认 5） */
  failureThreshold?: number;
  /** 半开状态下连续成功多少次后恢复（默认 2） */
  successThreshold?: number;
  /** 熔断后多久进入半开试探（毫秒，默认 30000） */
  openToHalfOpenMs?: number;
  /** 触发熔断所需的最小调用样本数（默认 5，避免低流量下误熔断） */
  volumeThreshold?: number;
  /** 判断某次错误是否计入失败（默认：所有错误都计） */
  isFailure?: (err: unknown) => boolean;
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly openToHalfOpenMs: number;
  private readonly volumeThreshold: number;
  private readonly isFailure: (err: unknown) => boolean;

  private listeners: Array<(s: BreakerState) => void> = [];

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.successThreshold = opts.successThreshold ?? 2;
    this.openToHalfOpenMs = opts.openToHalfOpenMs ?? 30_000;
    this.volumeThreshold = opts.volumeThreshold ?? 5;
    this.isFailure = opts.isFailure ?? (() => true);
  }

  get currentState(): BreakerState {
    return this.state;
  }

  /** 是否已熔断（且冷却窗口未到，不允许试探） */
  get isOpen(): boolean {
    return this.state === 'open' && !this.halfOpenElapsed();
  }

  /** 订阅状态变化（open / half-open / closed），可用于日志与流式接口的短路判断 */
  onStateChange(cb: (s: BreakerState) => void): void {
    this.listeners.push(cb);
  }

  private halfOpenElapsed(): boolean {
    return Date.now() - this.openedAt >= this.openToHalfOpenMs;
  }

  private transition(next: BreakerState): void {
    if (this.state === next) return;
    this.state = next;
    if (next === 'open') this.openedAt = Date.now();
    if (next === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    }
    if (next === 'half-open') {
      this.consecutiveSuccesses = 0;
    }
    for (const cb of this.listeners) cb(next);
  }

  /**
   * 供流式接口快速失败判断：
   * - closed / half-open → 允许
   * - open 且冷却未到 → 拒绝
   * - open 但冷却已到 → 转为 half-open 并允许一次试探
   */
  canRun(): boolean {
    if (this.state === 'closed' || this.state === 'half-open') return true;
    if (this.halfOpenElapsed()) {
      this.transition('half-open');
      return true;
    }
    return false;
  }

  /**
   * 执行受保护调用。
   * - open 且冷却未到：直接抛 'Circuit breaker is open'（由上层转换为友好错误）。
   * - 成功：累计成功；半开状态下达标则恢复 closed。
   * - 失败且 isFailure 为真：累计失败；达标且样本足够则熔断。
   * - 失败但 isFailure 为假（如 4xx / 用户取消）：照常向上抛出，但不计入熔断统计。
   */
  async fire<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.state === 'open') {
      if (this.halfOpenElapsed()) this.transition('half-open');
      else throw new Error('Circuit breaker is open');
    }

    try {
      const result = await fn(signal);
      this.totalCalls++;
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;
      if (this.state === 'half-open' && this.consecutiveSuccesses >= this.successThreshold) {
        this.transition('closed');
      }
      return result;
    } catch (err) {
      this.totalCalls++;
      if (!this.isFailure(err)) {
        throw err;
      }
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
      if (this.state === 'half-open') {
        // 半开试探失败，立即重新熔断
        this.transition('open');
      } else if (
        this.consecutiveFailures >= this.failureThreshold &&
        this.totalCalls >= this.volumeThreshold
      ) {
        this.transition('open');
      }
      throw err;
    }
  }
}
