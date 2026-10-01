// ============================================================
// 插件守护器（Plugin Guardian）—— 隔离箱 / 熔断 / 自动放行
//
// 对非内置插件（source: local / npm）做运行期错误归因与计数：
//   挂载 → quarantined（隔离中）
//     ├─ 隔离期累计错误 ≥ errorThreshold → 自动熔断禁用（failed）
//     ├─ 连续 promoteAfterSessions 个完整会话 0 错误 → 自动放行（trusted）
//     └─ failed 插件被重新启用 → 自动重置回 quarantined 重新观察
//
// 边界（诚实声明）：插件与宿主同进程，守护器提供的是
// 「观测 + 归因 + 熔断止损 + 可见性」，不是内存级沙箱。
// ============================================================

import type { KvService, PluginMigration, PluginModule } from '@novel/core';
import { DisposerBag } from '@novel/core';
import { migrateForPlugin } from './migrations.js';

export type GuardianState = 'quarantined' | 'trusted' | 'failed';

export interface GuardianRecord {
  state: GuardianState;
  /** 进入当前状态的时间戳 */
  since: number;
  /** 隔离期已通过的无错误完整会话数（每次重启/重挂结算一次） */
  sessions: number;
  /** 隔离期累计错误数（持久化） */
  errors: number;
  /** 当前会话错误数（持久化，跨重启保守视为有错） */
  sessionErrors: number;
  /** 运行期调用次数（仅内存展示，重启清零） */
  invocations: number;
  lastError?: { at: number; where: string; message: string };
  promotedAt?: number;
}

export interface GuardianSnapshot extends GuardianRecord {
  pluginId: string;
}

export interface GuardianPolicy {
  /** 连续无错误会话数达标后自动放行 */
  promoteAfterSessions: number;
  /** 隔离期累计错误达到该值即熔断禁用 */
  errorThreshold: number;
}

/** KV 存储结构（invocations 不持久化） */
interface GuardianStore {
  policy: GuardianPolicy;
  records: Record<string, Omit<GuardianRecord, 'invocations'>>;
}

const KV_NAMESPACE = 'novel.host';
const KV_KEY = 'guardian';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface PluginGuardian {
  readonly policy: GuardianPolicy;
  /** 挂载成功后调用：判定/迁移守护状态（内置插件返回 undefined 不观察） */
  onMounted(pluginId: string, source: 'builtin' | 'local' | 'npm'): GuardianRecord | undefined;
  recordInvocation(pluginId: string, where: string): void;
  recordError(pluginId: string, where: string, err: unknown): void;
  /** 手动放行（跳过剩余隔离期） */
  promote(pluginId: string): GuardianRecord | undefined;
  /** 重置计数回隔离态（failed 插件修复后重新观察用） */
  requarantine(pluginId: string): GuardianRecord | undefined;
  snapshotOf(pluginId: string): GuardianSnapshot | undefined;
  all(): GuardianSnapshot[];
}

export function createPluginGuardian(opts: {
  kv: KvService;
  /** 隔离期错误达到阈值时触发（宿主据此禁用插件） */
  onFuse: (pluginId: string, record: GuardianRecord) => void | Promise<void>;
  policy?: Partial<GuardianPolicy>;
}): PluginGuardian {
  const policy: GuardianPolicy = {
    promoteAfterSessions: envInt('NOVEL_GUARDIAN_SESSIONS', 2),
    errorThreshold: envInt('NOVEL_GUARDIAN_ERRORS', 3),
    ...opts.policy,
  };

  // ---- 从 KV 恢复持久化状态 ----
  // ★ 延迟恢复：宿主/守护器在模块加载期构造，此刻 initDatabase 尚未执行，
  //   kv.get 会静默失败（返回 undefined）。首次真正访问（onMounted 等，
  //   都发生在 DB 初始化之后）时再载入。
  let restored = false;
  function ensureRestored(): void {
    if (restored) return;
    restored = true;
    try {
      const store = opts.kv.get<GuardianStore>(KV_NAMESPACE, KV_KEY);
      if (store && typeof store === 'object') {
        for (const [id, rec] of Object.entries(store.records ?? {})) {
          if (rec && (rec.state === 'quarantined' || rec.state === 'trusted' || rec.state === 'failed')) {
            records.set(id, { ...rec, invocations: 0, sessionErrors: Math.max(0, rec.sessionErrors ?? 0) });
          }
        }
      }
    } catch (err) {
      console.warn('[guardian] 恢复守护状态失败（按空状态启动）:', err);
    }
  }

  const records = new Map<string, GuardianRecord>();

  function persist(): void {
    const out: GuardianStore['records'] = {};
    for (const [id, rec] of records) {
      const { invocations: _invocations, ...rest } = rec;
      out[id] = rest;
    }
    void opts.kv.set(KV_NAMESPACE, KV_KEY, { policy, records: out } satisfies GuardianStore).catch((err) => {
      console.error('[guardian] 持久化守护状态失败:', err);
    });
  }

  function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  const guardian: PluginGuardian = {
    policy,

    onMounted(pluginId, source) {
      ensureRestored();
      if (source === 'builtin') return undefined;

      let rec = records.get(pluginId);
      if (!rec) {
        rec = {
          state: 'quarantined',
          since: Date.now(),
          sessions: 0,
          errors: 0,
          sessionErrors: 0,
          invocations: 0,
        };
        records.set(pluginId, rec);
        console.info('[guardian] 插件 ' + pluginId + ' 进入隔离箱试运行（放行条件：连续 ' + policy.promoteAfterSessions + ' 个会话零错误）');
        persist();
        return rec;
      }

      if (rec.state === 'failed') {
        // 被熔断禁用的插件经管理员重新启用 → 重置为隔离观察
        rec.state = 'quarantined';
        rec.since = Date.now();
        rec.sessions = 0;
        rec.errors = 0;
        rec.sessionErrors = 0;
        delete rec.lastError;
        console.info('[guardian] 插件 ' + pluginId + ' 已重新启用，重置为隔离观察');
        persist();
        return rec;
      }

      if (rec.state === 'quarantined') {
        // 结算上一会话：零错误才累计；达标且全程零错误 → 自动放行
        if (rec.sessionErrors === 0) {
          rec.sessions += 1;
          if (rec.sessions >= policy.promoteAfterSessions && rec.errors === 0) {
            rec.state = 'trusted';
            rec.promotedAt = Date.now();
            rec.since = rec.promotedAt;
            console.info('[guardian] ✅ 插件 ' + pluginId + ' 已通过 ' + rec.sessions + ' 个会话零错误，自动放行');
          } else {
            console.info('[guardian] 插件 ' + pluginId + ' 隔离会话进度 ' + rec.sessions + '/' + policy.promoteAfterSessions);
          }
        } else {
          console.warn('[guardian] 插件 ' + pluginId + ' 上一会话有 ' + rec.sessionErrors + ' 次错误，隔离会话计数保持 ' + rec.sessions + '（累计错误 ' + rec.errors + '）');
        }
        rec.sessionErrors = 0;
        persist();
        return rec;
      }

      // trusted：继续运行，仅开新会话
      rec.sessionErrors = 0;
      return rec;
    },

    recordInvocation(pluginId, _where) {
      const rec = records.get(pluginId);
      if (rec) rec.invocations += 1;
    },

    recordError(pluginId, where, err) {
      const rec = records.get(pluginId);
      if (!rec) return;
      rec.errors += 1;
      rec.sessionErrors += 1;
      rec.lastError = { at: Date.now(), where, message: messageOf(err) };
      console.warn('[guardian] 插件 ' + pluginId + ' 运行期错误 #' + rec.errors + ' @ ' + where + ': ' + rec.lastError.message);

      if (rec.state === 'quarantined' && rec.errors >= policy.errorThreshold) {
        rec.state = 'failed';
        rec.since = Date.now();
        persist();
        console.error('[guardian] ⛔ 插件 ' + pluginId + ' 隔离期错误达 ' + rec.errors + ' 次（阈值 ' + policy.errorThreshold + '），已熔断禁用');
        void Promise.resolve(opts.onFuse(pluginId, rec)).catch((fuseErr) => {
          console.error('[guardian] 熔断禁用 ' + pluginId + ' 失败:', fuseErr);
        });
        return;
      }
      persist();
    },

    promote(pluginId) {
      ensureRestored();
      const rec = records.get(pluginId);
      if (!rec || rec.state === 'trusted') return rec;
      rec.state = 'trusted';
      rec.promotedAt = Date.now();
      rec.since = rec.promotedAt;
      console.info('[guardian] 插件 ' + pluginId + ' 已由管理员手动放行');
      persist();
      return rec;
    },

    requarantine(pluginId) {
      ensureRestored();
      const rec = records.get(pluginId);
      if (!rec) return undefined;
      rec.state = 'quarantined';
      rec.since = Date.now();
      rec.sessions = 0;
      rec.errors = 0;
      rec.sessionErrors = 0;
      delete rec.promotedAt;
      console.info('[guardian] 插件 ' + pluginId + ' 已重置回隔离箱（计数清零，上次错误记录保留）');
      persist();
      return rec;
    },

    snapshotOf(pluginId) {
      ensureRestored();
      const rec = records.get(pluginId);
      return rec ? { pluginId, ...rec } : undefined;
    },

    all() {
      ensureRestored();
      return [...records.entries()].map(([pluginId, rec]) => ({ pluginId, ...rec }));
    },
  };

  return guardian;
}

// ============================================================
// 按插件归因的上下文包装
//
// 宿主的 routes/events/scheduler/ai/db 服务是全局共享单例，
// 服务内部不知道调用者是哪个插件。这里用 Proxy 包装传给插件
// apply 的 ctx：白名单拦截五个服务属性，返回带 pluginId 的
// 归因版（注册/调用经过守护器计数）；其余属性原样透传且
// receiver 绑定原始 ctx（cordis 自身方法依赖内部 this 状态）。
//
// ★ 资源自动跟踪：包装版 register/on 返回的 disposer 会同时
//   汇入守护器的 per-plugin DisposerBag —— 插件忘记用
//   ctx.effect 包裹注册时，熔断/禁用也能兜底清理（定时器/
//   路由守卫/AI 工具/事件订阅不残留）。
// ============================================================

type RouteMiddleware = (c: unknown, next: () => Promise<void>) => Promise<void> | void;

type AnyRecord = Record<string, unknown>;

/** 给插件 router 挂错误计数中间件（必须在 rootApp.route 合并前调用） */
function attachRouteGuard(router: unknown, pluginId: string, guardian: PluginGuardian): void {
  const r = router as { use?: (path: string, mw: RouteMiddleware) => void } | null;
  if (!r || typeof r.use !== 'function') return;
  try {
    r.use('*', (async (c: unknown, next: () => Promise<void>) => {
      const hc = c as { req?: { method?: string; path?: string }; res?: { status?: number } };
      const label = 'route ' + String(hc?.req?.method ?? '?') + ' ' + String(hc?.req?.path ?? '');
      guardian.recordInvocation(pluginId, label);
      try {
        await next();
        const status = hc?.res?.status;
        if (typeof status === 'number' && status >= 500) {
          guardian.recordError(pluginId, label, new Error('HTTP ' + status));
        }
      } catch (err) {
        guardian.recordError(pluginId, label, err);
        throw err;
      }
    }) as RouteMiddleware);
  } catch (err) {
    console.warn('[guardian] 路由守护包装失败（按原样注册）:', err);
  }
}

interface WrapEnv {
  pluginId: string;
  guardian: PluginGuardian;
  bag: DisposerBag;
  /** manifest 声明的权限（db:migrate 按此放行 db:global / db:project） */
  permissions: string[];
}

function wrapRoutes(raw: AnyRecord, env: WrapEnv): AnyRecord {
  const { pluginId, guardian, bag } = env;
  const out: AnyRecord = { ...raw };
  const rawRegister = raw.register as
    | ((prefix: string, router: unknown, opts?: { pluginId?: string }) => () => void)
    | undefined;
  out.register = (prefix: string, router: unknown) => {
    attachRouteGuard(router, pluginId, guardian);
    // ★ 透传 pluginId：宿主据此强制插件路由只能注册 /api/plugins/{id} 前缀
    const disposer = rawRegister
      ? rawRegister.call(raw, prefix, router, { pluginId })
      : () => undefined;
    bag.add(disposer, 'routes ' + prefix);
    return disposer;
  };
  return out;
}

function wrapEvents(raw: AnyRecord, env: WrapEnv): AnyRecord {
  const { pluginId, guardian, bag } = env;
  const out: AnyRecord = { ...raw };
  const rawOn = raw.on as ((name: string, handler: (payload: unknown) => unknown) => () => void) | undefined;
  out.on = (name: string, handler: (payload: unknown) => unknown) => {
    if (typeof handler !== 'function' || typeof rawOn !== 'function') {
      return typeof rawOn === 'function' ? rawOn.call(raw, name, handler) : () => undefined;
    }
    const label = 'event ' + String(name);
    const disposer = rawOn.call(raw, name, async (payload: unknown) => {
      guardian.recordInvocation(pluginId, label);
      try {
        return await handler(payload);
      } catch (err) {
        guardian.recordError(pluginId, label, err);
        throw err;
      }
    });
    bag.add(disposer, label);
    return disposer;
  };
  return out;
}

function wrapScheduler(raw: AnyRecord, env: WrapEnv): AnyRecord {
  const { pluginId, guardian, bag } = env;
  const out: AnyRecord = { ...raw };
  const rawRegister = raw.register as
    | ((def: { label: string; intervalMs: number; run: () => Promise<void> | void }) => () => void)
    | undefined;
  out.register = (def: { label: string; intervalMs: number; run: () => Promise<void> | void }) => {
    if (typeof rawRegister !== 'function') return () => undefined;
    const label = 'timer ' + String(def.label ?? 'unnamed');
    const disposer = rawRegister.call(raw, {
      ...def,
      run: async () => {
        guardian.recordInvocation(pluginId, label);
        try {
          return await def.run();
        } catch (err) {
          guardian.recordError(pluginId, label, err);
          throw err;
        }
      },
    });
    bag.add(disposer, label);
    return disposer;
  };
  return out;
}

function wrapAi(raw: AnyRecord, env: WrapEnv): AnyRecord {
  const { pluginId, guardian, bag } = env;
  const out: AnyRecord = { ...raw };
  const tools = raw.tools as
    | { register?: (definition: unknown, handler: (args: unknown, ctx: unknown) => Promise<unknown>) => () => void }
    | undefined;
  if (tools && typeof tools.register === 'function') {
    const rawRegister = tools.register.bind(tools);
    out.tools = {
      ...tools,
      register: (definition: { function?: { name?: string } }, handler: (args: unknown, ctx: unknown) => Promise<unknown>) => {
        const label = 'tool ' + String(definition?.function?.name ?? 'unknown');
        const disposer = rawRegister(definition, async (args: unknown, toolCtx: unknown) => {
          guardian.recordInvocation(pluginId, label);
          try {
            return await handler(args, toolCtx);
          } catch (err) {
            guardian.recordError(pluginId, label, err);
            throw err;
          }
        });
        bag.add(disposer, label);
        return disposer;
      },
    };
  }
  return out;
}

function wrapDb(raw: AnyRecord, env: WrapEnv): AnyRecord {
  const { pluginId, guardian, permissions } = env;
  const out: AnyRecord = { ...raw };
  const rawGlobal = raw.global as (() => unknown) | undefined;
  const rawProject = raw.project as ((projectId: string) => unknown) | undefined;
  out.global = () => {
    guardian.recordInvocation(pluginId, 'db:global');
    return rawGlobal ? rawGlobal.call(raw) : undefined;
  };
  out.project = (projectId: string) => {
    guardian.recordInvocation(pluginId, 'db:project');
    return rawProject ? rawProject.call(raw, projectId) : undefined;
  };
  // 正式表迁移通道（v2 数据扩展）：按挂载条目归因 pluginId，按 manifest 权限放行
  out.migrate = (migrations: PluginMigration[], opts?: { scope?: 'global' | 'project' }) => {
    guardian.recordInvocation(pluginId, 'db:migrate');
    return migrateForPlugin({ pluginId, permissions, migrations, opts }).catch((err: unknown) => {
      guardian.recordError(pluginId, 'db:migrate', err);
      throw err;
    });
  };
  return out;
}

const GUARDED_PROPS = new Set(['routes', 'events', 'scheduler', 'ai', 'db']);

/** 守护包装产物：带归因的插件模块 + 兜底资源清理 */
export interface GuardedPluginHandle {
  mod: PluginModule;
  /** 逆序清理插件经包装层注册的全部资源（与 ctx.effect 双保险，幂等） */
  disposeTracked(): void;
}

export function createGuardedPluginHandle(
  mod: PluginModule,
  pluginId: string,
  guardian: PluginGuardian,
  permissions: string[] = [],
): GuardedPluginHandle {
  const bag = new DisposerBag();
  const env: WrapEnv = { pluginId, guardian, bag, permissions };
  const rawApply = mod.apply;
  return {
    mod: {
      name: mod.name,
      inject: mod.inject,
      defaultConfig: mod.defaultConfig,
      apply(pluginCtx: never, config?: Record<string, unknown>) {
        const guardedCtx = new Proxy(pluginCtx as unknown as object, {
          get(target, prop) {
            const key = String(prop);
            if (GUARDED_PROPS.has(key)) {
              const svc = (target as AnyRecord)[key];
              if (!svc || typeof svc !== 'object') return svc;
              const r = svc as AnyRecord;
              switch (key) {
                case 'routes': return wrapRoutes(r, env);
                case 'events': return wrapEvents(r, env);
                case 'scheduler': return wrapScheduler(r, env);
                case 'ai': return wrapAi(r, env);
                case 'db': return wrapDb(r, env);
              }
            }
            // receiver 绑定原始 target：保证 cordis 自有方法（effect/plugin/…）的 this 不漂移
            return Reflect.get(target, prop, target);
          },
        });
        return rawApply(guardedCtx as never, config);
      },
    },
    disposeTracked() {
      bag.dispose();
    },
  };
}
