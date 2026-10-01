// ============================================================
// 持久化适配器（Persistence Adapter）
//
// 把"用什么引擎存数据"从业务层（BaseService / 各 router）解耦出来。
// 当前默认实现是 sql.js（WASM SQLite，整库常驻内存）。未来可平滑切换为
// better-sqlite3（本地 WAL、增量写入）或服务端数据库（Postgres / LibSQL），
// 业务层零改动。
//
// 注意：本文件只定义接口与管理器，不引入任何具体引擎依赖。
// 具体引擎在各自的适配器模块中实现并 register 到 adapterManager。
// ============================================================

/** 支持的数据库引擎标识 */
export type DbEngine = 'sqljs' | 'better-sqlite3';

/**
 * 数据库适配器接口。
 * 所有方法签名刻意与 @novel/db 现有公共 API 对齐，便于现有 sql.js 实现直接委托。
 */
export interface DatabaseAdapter {
  /** 引擎标识 */
  readonly engine: DbEngine;
  /** 初始化（异步加载/创建数据库、跑迁移）。返回 Drizzle 实例或 null（浏览器等无 DB 环境） */
  init(dbPath?: string): Promise<unknown | null>;
  /** 获取已初始化的 Drizzle 实例（未初始化返回 null） */
  getDb(): unknown | null;
  /** 获取底层 sqlite 引擎实例（better-sqlite3 的 Database / sql.js 的 Database）。未初始化返回 null */
  getRawSqlite?(): unknown | null;
  /** 持久化到磁盘。force=true 立即写入，否则走实现内部的合并/防抖策略 */
  persist(force?: boolean): Promise<void>;
  /** 关闭并落盘 */
  close(): Promise<void>;
  /** 是否已完成初始化、可对外提供查询 */
  isReady(): boolean;
}

/**
 * 适配器管理器：注册各引擎实现，并维护"当前活动适配器"。
 * 通过 setActive 切换引擎；getActive() 返回当前引擎。
 */
export class AdapterManager {
  private adapters = new Map<DbEngine, DatabaseAdapter>();
  private active: DatabaseAdapter | null = null;

  /** 注册一个引擎实现（同名会覆盖） */
  register(adapter: DatabaseAdapter): void {
    this.adapters.set(adapter.engine, adapter);
  }

  /** 设置当前活动引擎（必须在已注册列表中） */
  setActive(engine: DbEngine): void {
    const a = this.adapters.get(engine);
    if (!a) {
      throw new Error(`[AdapterManager] 未注册的数据库适配器: ${engine}`);
    }
    this.active = a;
  }

  /** 当前活动适配器（未设置时抛错） */
  get activeAdapter(): DatabaseAdapter {
    if (!this.active) {
      throw new Error('[AdapterManager] 尚未设置活动数据库适配器');
    }
    return this.active;
  }

  /** 是否已注册某引擎 */
  has(engine: DbEngine): boolean {
    return this.adapters.has(engine);
  }
}

/** 全局单例管理器 */
export const adapterManager = new AdapterManager();
