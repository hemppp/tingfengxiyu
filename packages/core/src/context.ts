// ============================================================
// @novel/core - 插件上下文基类
// ============================================================

import type { EventBus } from './events.js';
import type { HookBus } from './hooks.js';
import type { DisposerBag } from './registry.js';

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** 插件日志：带插件名前缀 */
export function createPluginLogger(pluginId: string): Logger {
  const prefix = `[plugin:${pluginId}]`;
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

/**
 * 插件上下文基类 —— 内核提供的最小契约。
 * Server/Web 宿主的扩展上下文继承它并补充具体服务（routes/db/ai/…）。
 */
export interface BasePluginContext {
  /** 插件 id */
  readonly id: string;
  /** 解析后的配置（默认配置 + 用户设置合并） */
  readonly config: Readonly<Record<string, unknown>>;
  /** 事件总线 */
  readonly events: EventBus;
  /** 钩子总线 */
  readonly hooks: HookBus;
  /** 生命周期：注册清理器，卸载时逆序执行 */
  effect(disposer: () => void, label?: string): void;
  /** 带插件名前缀的日志 */
  readonly logger: Logger;
}

/** 由宿主构造基础上下文（供插件 apply 使用） */
export function createBaseContext(opts: {
  id: string;
  config: Record<string, unknown>;
  events: EventBus;
  hooks: HookBus;
  bag: DisposerBag;
}): BasePluginContext {
  return {
    id: opts.id,
    config: opts.config,
    events: opts.events,
    hooks: opts.hooks,
    effect: (fn, label) => opts.bag.add(fn, label),
    logger: createPluginLogger(opts.id),
  };
}

// ---- 插件模块约定（Server/Web 面入口的导出形状） ----

/** Server 面 / Web 面插件的统一模块契约 */
export interface PluginModule {
  /** 插件名（应与 manifest.id 一致；不一致时以 manifest.id 为准） */
  name?: string;
  /** 需要的服务（依赖注入声明） */
  inject?: string[];
  /** 挂载函数 */
  apply(ctx: never, config?: Record<string, unknown>): void | Promise<void>;
  /** 可选：配置默认值 */
  defaultConfig?: Record<string, unknown>;
}

export type PluginModuleFactory = () => Promise<PluginModule> | PluginModule;
