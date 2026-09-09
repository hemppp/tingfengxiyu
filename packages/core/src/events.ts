// ============================================================
// @novel/core - 事件总线（跨插件、跨模块解耦）
// ============================================================

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

interface HandlerEntry<T> {
  handler: EventHandler<T>;
  order: number;
}

/**
 * 事件总线：on/emit/off。
 * - emit 串行 await 所有 handler；单个 handler 抛错被捕获记录，不中断后续订阅者
 *   （一个坏插件不能打断其他订阅者）。
 * - on 返回 disposer，随插件卸载自动移除。
 */
export class EventBus {
  private handlers = new Map<string, HandlerEntry<unknown>[]>();
  private seq = 0;

  on<T>(name: string, handler: EventHandler<T>): () => void {
    const list = this.handlers.get(name) ?? [];
    const entry: HandlerEntry<unknown> = { handler: handler as EventHandler<unknown>, order: this.seq++ };
    list.push(entry);
    this.handlers.set(name, list);
    return () => {
      const cur = this.handlers.get(name);
      if (!cur) return;
      const idx = cur.indexOf(entry);
      if (idx >= 0) cur.splice(idx, 1);
      if (cur.length === 0) this.handlers.delete(name);
    };
  }

  async emit<T>(name: string, payload: T): Promise<void> {
    const list = this.handlers.get(name);
    if (!list) return;
    const snapshot = [...list].sort((a, b) => a.order - b.order);
    for (const entry of snapshot) {
      try {
        await entry.handler(payload);
      } catch (err) {
        console.error(`[core:events] handler "${name}" 执行失败:`, err);
      }
    }
  }

  /** 同步触发（不 await，用于不需要等待的场景） */
  emitSync<T>(name: string, payload: T): void {
    const list = this.handlers.get(name);
    if (!list) return;
    const snapshot = [...list].sort((a, b) => a.order - b.order);
    for (const entry of snapshot) {
      try {
        entry.handler(payload);
      } catch (err) {
        console.error(`[core:events] handler "${name}" 执行失败:`, err);
      }
    }
  }

  listeners(name: string): number {
    return this.handlers.get(name)?.length ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

// ---- 内置事件名（宿主与插件约定） ----

export const EVENTS = {
  chapterSaved: 'chapter.saved',
  chapterDeleted: 'chapter.deleted',
  entityUpdated: 'entity.updated',
  projectOpened: 'project.opened',
  projectCreated: 'project.created',
  aiScanCompleted: 'ai.scan.completed',
  exportBefore: 'export.before',
  exportAfter: 'export.after',
} as const;
