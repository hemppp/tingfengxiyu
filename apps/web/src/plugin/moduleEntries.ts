// ============================================================
// 模块入口解析（kernel 侧）—— 经 **构建期 glob** 而非硬编码说明符
//
// ★ D44：kernel 曾直接写 `import('@novel-plugins/manual-workbench/web')` /
//   `import('@novel-plugins/auto-workbench/web')`。那是 vite **静态可解析**的模块入口
//   字面量：模块目录缺席时，vite 在 `load-fallback` 阶段就 ENOENT 硬失败
//   （`[vite:load-fallback] Could not load …/web/index.tsx`），build exit 1 ——
//   与「任一模块缺席另一模块仍可用」直接冲突。
//
//   本文件复用 `main.tsx` 已在用的同一机制（`import.meta.glob`）：
//   **构建期静态收集 + 目录缺席时静默为空**，不产生悬空 import。
//
//   与 main.tsx 的分工：
//     · main.tsx 的 glob —— 收集模块入口用于 **挂载插件**（apply(ctx) 注册扩展点）；
//     · 本文件的 glob —— 解析模块**公开导出的组件**（如 ChapterEditor），供 kernel
//       的惰性路由使用。二者**用途不同、模式不同**（见下）。
//
// ★ 模式必须**精确到 `workbench`**，不得用 `manual/*/web/index.tsx` 通配：
//   同目录下还有 `novel.bookscan` / `novel.autowrite` 等**独立插件包**（设计 L152/L164），
//   它们的 `web/index.tsx` 同样会被通配模式匹配。实测 tinyglobby 的键顺序为
//   `auto/novel.autowrite` → `auto/workbench` → `manual/novel.bookscan` → `manual/workbench`，
//   故 `find(k => k.includes('/plugins/manual/'))` 会**错误命中 `novel.bookscan`**：
//     · `loadModuleComponent('manual','ChapterEditor')` 取不到导出 → 运行时报错；
//     · `hasModule()` 恒为 true（兄弟插件总在）→ **「模块缺席检测」彻底失效**，
//       D44 的优雅降级会退化为空转。
//   精确到 `workbench` 后，键与 `MODULE_DIRS`（门禁）口径一致，且模块目录缺席即不出现。
// ============================================================

import type { FloatingPanelDockMeta, DockSlot } from '@/components/shell/dock/types';

/**
 * ADR §1.4 冻结的 `FloatingPanelDockMeta`（逐字段与 `dock/types.ts` 一致；
 * 后者是停靠内核的视图层定义，不能反向 import 插件层，故在此收口）。
 *
 * ⚠ 本接口**只描述形状**，不含任何缺省值 —— 缺省行为的唯一真源始终是
 *   `DockShell` 里的 `resolveDockMeta()`（ADR §1.5 冻结）。
 */
export interface FloatingPanelDockMetaShape {
  /** 初始落位建议（可被用户拖拽覆盖）。缺省 → 'right' */
  slot?: DockSlot;
  /** 初始启用状态。false = 注册进候选池但默认不显示。缺省 → false */
  defaultOpen?: boolean;
  /** 同 key 多实例。缺省 false = 再次 open 只聚焦，不新开 */
  allowMultiple?: boolean;
  /** 允许用户关闭（标签上的 ×）。缺省 → true */
  closable?: boolean;
  /** 可被拖出为 floating group。缺省 → true */
  floatable?: boolean;
  /** 首次作为 floating group 出现时的几何建议值 */
  floatingSize?: { width: number; height: number };
  /** 强制最小尺寸。缺省 → {width:240, height:160} */
  minSize?: { width: number; height: number };
  /** 打开时抢占中心编辑区。缺省 → false */
  center?: boolean;
}

/** 编译期护栏：本镜像类型必须与停靠内核的 `FloatingPanelDockMeta` 逐字段一致。 */
type _AssertDockMetaShapeMatches = FloatingPanelDockMetaShape extends FloatingPanelDockMeta
  ? FloatingPanelDockMeta extends FloatingPanelDockMetaShape
    ? true
    : never
  : never;
const _DOCK_META_SHAPE_IN_SYNC: _AssertDockMetaShapeMatches = true;
void _DOCK_META_SHAPE_IN_SYNC;

/** 模块目录名（D1：一模块一包，目录即模式事实来源） */
export type ModuleDir = 'manual' | 'auto';

/** 模块入口的仓库相对后缀 —— 与 `scripts/verify/verify-workbench-isolation.mjs` 的 `MODULE_DIRS` 同口径 */
const ENTRY_SUFFIX: Record<ModuleDir, string> = {
  manual: '/plugins/manual/workbench/web/index.tsx',
  auto: '/plugins/auto/workbench/web/index.tsx',
};

/**
 * 构建期收集的两模块入口（精确路径，不通配兄弟插件包）。
 * 目录缺席 ⇒ 该条目不出现 ⇒ 下面的 getter 返回 null（优雅降级，无 ENOENT）。
 */
const MODULE_ENTRIES: Record<string, () => Promise<unknown>> = import.meta.glob([
  '../../../plugins/manual/workbench/web/index.tsx',
  '../../../plugins/auto/workbench/web/index.tsx',
]);

/** 解析某模块入口的加载器；模块缺席返回 null */
export function getModuleEntryLoader(dir: ModuleDir): (() => Promise<unknown>) | null {
  const suffix = ENTRY_SUFFIX[dir];
  const key = Object.keys(MODULE_ENTRIES).find((k) => k.endsWith(suffix));
  return key ? MODULE_ENTRIES[key] ?? null : null;
}

/** 该模块是否在场（构建期事实；模块目录缺席 ⇒ false） */
export function hasModule(dir: ModuleDir): boolean {
  return getModuleEntryLoader(dir) !== null;
}

/**
 * 取模块公开导出的某个组件，包成 React.lazy 可用的 loader。
 * 模块缺席 / 导出不存在 ⇒ 返回 null（调用方据此**不渲染**，不得伪造兜底实现）。
 */
/**
 * 解析某模块入口的**面板级预取**函数（模块公开导出 `preload`）。
 *
 * ★ 2026-10-07「跳转画面会加载一下」修复：
 *   路由级 chunk 由 kernel 的 `ALL_ROUTE_LOADERS` / `PRELOAD_ON_PATH` 兜住了，但
 *   **进项目之后才出现的那批 chunk 全在模块内部** —— 12 个手写台停靠面板、章节左栏、
 *   AI 对话面板，kernel 看不到它们的 import 说明符，也就无从预热。表现就是
 *   「进项目先出一排『加载中…』，点开面板再出一次」。
 *   解法是把预取的**内容**留在模块里：模块入口导出一个 `preload()`，kernel 只在
 *   空闲时间片里调用它。kernel 依旧不触碰插件内部实现（D35 / K2M 边保持不变），
 *   模块缺席或未导出 `preload` ⇒ 返回 null（调用方静默跳过，不伪造兜底）。
 */
export function loadModulePreload(dir: ModuleDir): (() => Promise<unknown>) | null {
  const load = getModuleEntryLoader(dir);
  if (!load) return null;
  return async () => {
    const mod = (await load()) as { preload?: () => unknown };
    if (typeof mod.preload !== 'function') return;
    await mod.preload();
  };
}

export function loadModuleComponent<T>(
  dir: ModuleDir,
  exportName: string,
): (() => Promise<{ default: T }>) | null {
  const load = getModuleEntryLoader(dir);
  if (!load) return null;
  return () =>
    load().then((mod) => {
      const comp = (mod as Record<string, unknown>)[exportName];
      if (!comp) {
        throw new Error(`模块 ${dir} 的公开入口未导出 ${exportName}`);
      }
      return { default: comp as T };
    });
}