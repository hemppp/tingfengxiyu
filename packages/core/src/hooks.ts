// ============================================================
// @novel/core - 钩子系统（before/after/around，可拦截可短路）
// ============================================================

export interface HookContext<T = unknown> {
  /** 钩子名称 */
  name: string;
  /** 载荷（可被 before 修改后传递给后续） */
  payload: T;
  /** 调用方传入的附加信息 */
  meta?: Record<string, unknown>;
}

export type BeforeHook<T = unknown> = (ctx: HookContext<T>) => boolean | void | Promise<boolean | void>;
export type AfterHook<T = unknown> = (ctx: HookContext<T>, result: unknown) => void | Promise<void>;
export type AroundHook<T = unknown> = (
  ctx: HookContext<T>,
  next: () => Promise<unknown>,
) => Promise<unknown>;

interface HookEntry<T> {
  kind: 'before' | 'after' | 'around';
  fn: BeforeHook<T> | AfterHook<T> | AroundHook<T>;
  order: number;
}

/**
 * 钩子总线：围绕一个操作（如 export、scan、delete）挂 before/after/around。
 * - before 返回 false → 操作被拦截（短路，返回 cancelled）
 * - around 包裹操作（可注入横切逻辑）
 * - after 在操作成功后执行
 */
export class HookBus {
  private hooks = new Map<string, HookEntry<unknown>[]>();
  private seq = 0;

  before<T>(name: string, fn: BeforeHook<T>): () => void {
    return this.add(name, 'before', fn);
  }

  after<T>(name: string, fn: AfterHook<T>): () => void {
    return this.add(name, 'after', fn);
  }

  around<T>(name: string, fn: AroundHook<T>): () => void {
    return this.add(name, 'around', fn);
  }

  private add<T>(name: string, kind: HookEntry<T>['kind'], fn: unknown): () => void {
    const list = this.hooks.get(name) ?? [];
    const entry = { kind, fn, order: this.seq++ } as HookEntry<unknown>;
    list.push(entry);
    this.hooks.set(name, list);
    return () => {
      const cur = this.hooks.get(name);
      if (!cur) return;
      const idx = cur.indexOf(entry);
      if (idx >= 0) cur.splice(idx, 1);
      if (cur.length === 0) this.hooks.delete(name);
    };
  }

  /**
   * 执行钩子链。
   * @returns { status: 'ok', result } 或 { status: 'cancelled' }（被 before 拦截）
   */
  async run<T>(name: string, payload: T, op: () => Promise<unknown> | unknown, meta?: Record<string, unknown>): Promise<{ status: 'ok'; result: unknown } | { status: 'cancelled' }> {
    const list = this.hooks.get(name);
    if (!list) return { status: 'ok', result: await op() };

    const sorted = [...list].sort((a, b) => a.order - b.order);
    const ctx: HookContext<T> = { name, payload, meta };

    // 1. before 链
    for (const entry of sorted) {
      if (entry.kind !== 'before') continue;
      try {
        const r = await (entry.fn as BeforeHook<T>)(ctx);
        if (r === false) return { status: 'cancelled' };
      } catch (err) {
        console.error(`[core:hooks] before "${name}" 失败:`, err);
      }
    }

    // 2. around 链（从内到外包裹 op）
    let runner: () => Promise<unknown> = async () => op();
    const arounds = sorted.filter((e) => e.kind === 'around').reverse();
    for (const entry of arounds) {
      const next = runner;
      runner = () => (entry.fn as AroundHook<T>)(ctx, next);
    }
    let result: unknown;
    try {
      result = await runner();
    } catch (err) {
      // 操作失败：仍执行 after（带 error 信息）
      console.error(`[core:hooks] 操作 "${name}" 失败:`, err);
      for (const entry of sorted) {
        if (entry.kind !== 'after') continue;
        try {
          await (entry.fn as AfterHook<T>)(ctx, { error: err });
        } catch { /* after 失败不阻断 */ }
      }
      throw err;
    }

    // 3. after 链
    for (const entry of sorted) {
      if (entry.kind !== 'after') continue;
      try {
        await (entry.fn as AfterHook<T>)(ctx, result);
      } catch (err) {
        console.error(`[core:hooks] after "${name}" 失败:`, err);
      }
    }
    return { status: 'ok', result };
  }

  has(name: string): boolean {
    return (this.hooks.get(name)?.length ?? 0) > 0;
  }

  clear(): void {
    this.hooks.clear();
  }
}
