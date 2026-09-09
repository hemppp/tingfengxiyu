// ============================================================
// @novel/core - 通用注册表（register/get/list/clear + dispose 配对）
// ============================================================

export interface RegistryEntry<V> {
  value: V;
  /** 注册顺序（同 key 覆盖时保留最早顺序） */
  order: number;
}

/**
 * 通用注册表：任何"注册 → 查询 → 清理"模式（路由/服务/面板/命令）都走它。
 * register 返回 disposer，宿主卸载插件时逆序调用。
 */
export class Registry<K, V> {
  private map = new Map<K, RegistryEntry<V>>();
  private seq = 0;

  /** 注册；同 key 覆盖（保留最早 order），返回卸载函数 */
  register(key: K, value: V): () => void {
    const order = this.seq++;
    const existing = this.map.get(key);
    this.map.set(key, { value, order: existing ? existing.order : order });
    return () => {
      const cur = this.map.get(key);
      if (cur && cur.value === value) this.map.delete(key);
    };
  }

  get(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** 按注册顺序返回全部值 */
  list(): V[] {
    return Array.from(this.map.values())
      .sort((a, b) => a.order - b.order)
      .map((e) => e.value);
  }

  /** 按 key 返回全部条目 */
  entries(): Array<{ key: K; value: V }> {
    return Array.from(this.map.entries()).map(([key, e]) => ({ key, value: e.value }));
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * 生命周期容器：收集 disposer，统一逆序执行（后注册先清理）。
 * 插件 apply 内部所有 ctx.effect() 都汇入此容器。
 */
export class DisposerBag {
  private disposers: Array<{ fn: () => void; label?: string }> = [];

  add(fn: () => void, label?: string): void {
    this.disposers.push({ fn, label });
  }

  /** 逆序执行全部 disposer；单个失败不阻断其余 */
  dispose(): void {
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      const d = this.disposers[i];
      if (!d) continue;
      const { fn, label } = d;
      try {
        fn();
      } catch (err) {
        console.error(`[core] disposer ${label ?? '<unnamed>'} 执行失败:`, err);
      }
    }
    this.disposers = [];
  }

  get size(): number {
    return this.disposers.length;
  }
}
