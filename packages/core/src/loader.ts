// ============================================================
// @novel/core - 插件条目类型 + 依赖排序/分析（纯函数，无运行时内核）
//
// v2（Cordis 底座版）：生命周期由 @deepseek-ai/cordis 承担
// （ctx.plugin / ctx.effect / fiber）。本文件仅保留契约类型与
// 依赖分析工具（供管理端 / 管理 UI 展示）。
// ============================================================

// ============================================================
// @novel/core - 插件加载器（依赖排序 + apply + 生命周期 + 失败隔离 + 运行时开关）
// ============================================================

import type { PluginManifest } from './manifest.js';
import { satisfiesMinVersion } from './manifest.js';
import type { BasePluginContext, PluginModule } from './context.js';
import { DisposerBag } from './registry.js';
import type { EventBus } from './events.js';
import type { HookBus } from './hooks.js';

export const HOST_VERSION = '0.1.0';

export interface PluginEntry {
  /** 插件 id（对应 manifest.id） */
  id: string;
  /** manifest 原始对象（未校验时提供，loader 会校验） */
  rawManifest?: unknown;
  /** 已解析的 manifest */
  manifest?: PluginManifest;
  /** 模块工厂：动态 import 的封装（server/web 面由宿主决定取哪个入口） */
  load: () => Promise<PluginModule>;
  /** 来源：builtin | local | npm */
  source: 'builtin' | 'local' | 'npm';
  /** 来源路径（展示用） */
  sourcePath?: string;
}

export type PluginStatus = 'ok' | 'error' | 'skipped' | 'disabled';

export interface MountedPlugin {
  id: string;
  manifest: PluginManifest;
  source: PluginEntry['source'];
  status: PluginStatus;
  error?: string;
  /** 依赖排序后的序号 */
  order: number;
  /** 是否启用（disabled 插件不 apply、不注册任何扩展点） */
  enabled: boolean;
}

export interface PluginHostOptions {
  /** 宿主版本（用于 minHostVersion 校验） */
  hostVersion?: string;
  /** 构造上下文（宿主注入具体服务） */
  createContext: (entry: PluginEntry, manifest: PluginManifest, config: Record<string, unknown>) => BasePluginContext;
  /** 已就绪的服务名集合（inject 校验用） */
  availableServices?: string[];
  /** 初始禁用清单（持久化的用户选择，mount 时这些插件不 apply） */
  disabledIds?: string[];
  /** 插件 apply 前的配置解析钩子（默认返回 entry 原始 config） */
  resolveConfig?: (entry: PluginEntry, manifest: PluginManifest) => Record<string, unknown>;
  /** 插件状态变化回调（挂载/卸载/开关后触发，供宿主刷新 UI 数据） */
  onStatusChange?: (mounted: MountedPlugin[]) => void;
}

/**
 * 按 inject 服务 + dependsOn 插件依赖拓扑排序（稳定的 Kahn 算法）。
 * - inject 缺失（服务未就绪）与 dependsOn 缺失（插件不存在/未挂载）→ skipped
 * - 剩余无法排序的项 → 报告为循环依赖（cycles）
 */
export function sortByDependencies<T extends { id: string; inject?: string[]; dependsOn?: string[] }>(
  items: T[],
  available: Set<string>,
): { sorted: T[]; skipped: Array<{ item: T; missing: string[] }>; cycles: string[][] } {
  const ids = new Set(items.map((i) => i.id));
  const resolved = new Set<string>(available);
  const sorted: T[] = [];
  const skipped: Array<{ item: T; missing: string[] }> = [];
  const pending: T[] = [];

  // 第一轮：分离 dependsOn 指向不存在插件的项（硬缺失）
  for (const item of items) {
    const hardMissing = (item.dependsOn ?? []).filter((d) => !ids.has(d));
    if (hardMissing.length > 0) {
      skipped.push({ item, missing: hardMissing });
    } else {
      pending.push(item);
    }
  }

  // Kahn 拓扑排序：依赖（inject 服务 + dependsOn 插件）全部满足才出队
  let guard = 0;
  while (pending.length > 0 && guard++ < 1000) {
    const next: T[] = [];
    let progressed = false;
    for (const item of pending) {
      const missingInject = (item.inject ?? []).filter((s) => !resolved.has(s));
      const missingDeps = (item.dependsOn ?? []).filter((d) => !resolved.has(d));
      const missing = [...missingInject, ...missingDeps];
      if (missing.length === 0) {
        sorted.push(item);
        resolved.add(item.id);
        progressed = true;
      } else {
        next.push(item);
      }
    }
    if (!progressed) break; // 死锁：剩余项互相等待（循环依赖或依赖被 skipped）
    pending.splice(0, pending.length, ...next);
  }

  // 剩余项：缺失依赖（指向被 skipped 或服务未就绪）→ skipped；否则判定为循环
  for (const item of pending) {
    const missing = [
      ...(item.inject ?? []).filter((s) => !resolved.has(s)),
      ...(item.dependsOn ?? []).filter((d) => !resolved.has(d)),
    ];
    if (missing.length > 0) {
      skipped.push({ item, missing });
    }
  }

  const cycles = extractCycles(pending, (i) => (i.dependsOn ?? []).filter((d) => ids.has(d)));
  return { sorted, skipped, cycles };
}

/** 从依赖图中提取全部环路（每条为环上节点 id 序列） */
function extractCycles<T extends { id: string }>(items: T[], depsOf: (item: T) => string[]): string[][] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const idx = stack.indexOf(id);
      if (idx >= 0) {
        const cycle = [...stack.slice(idx), id];
        cycles.push(cycle);
      }
      return;
    }
    visiting.add(id);
    stack.push(id);
    const item = byId.get(id);
    for (const dep of item ? depsOf(item) : []) {
      if (byId.has(dep)) dfs(dep);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const item of items) dfs(item.id);
  return cycles;
}

// ============================================================
// 依赖分析（供管理 UI / 插件管理端展示"全局互相依赖性"）
// ============================================================

export interface DependencyNode {
  id: string;
  name?: string;
  /** 依赖的其他插件 id */
  dependsOn: string[];
  /** 被哪些插件依赖 */
  requiredBy: string[];
  /** inject 的服务 */
  inject: string[];
}

export interface DependencyAnalysis {
  /** 全部插件节点（含依赖关系） */
  nodes: DependencyNode[];
  /** dependsOn 指向不存在插件的项 */
  missing: Array<{ id: string; missing: string[] }>;
  /** 循环依赖链 */
  cycles: string[][];
  /** 依赖是否健康（无 missing、无循环） */
  ok: boolean;
}

export function analyzeDependencies(
  entries: Array<{ id: string; name?: string; manifest?: PluginManifest; dependsOn?: string[]; inject?: string[] }>,
): DependencyAnalysis {
  const ids = new Set(entries.map((e) => e.id));
  const nodes: DependencyNode[] = entries.map((e) => ({
    id: e.id,
    name: e.manifest?.name ?? e.name,
    dependsOn: e.dependsOn ?? e.manifest?.dependsOn ?? [],
    requiredBy: [],
    inject: e.inject ?? [],
  }));
  const missing: Array<{ id: string; missing: string[] }> = [];
  for (const n of nodes) {
    const m = n.dependsOn.filter((d) => !ids.has(d));
    if (m.length > 0) missing.push({ id: n.id, missing: m });
    for (const d of n.dependsOn) {
      const target = nodes.find((x) => x.id === d);
      if (target) target.requiredBy.push(n.id);
    }
  }
  const cycles = extractCycles(
    nodes.map((n) => ({ id: n.id })),
    (n) => nodes.find((x) => x.id === n.id)?.dependsOn ?? [],
  );
  return { nodes, missing, cycles, ok: missing.length === 0 && cycles.length === 0 };
}
