// ============================================================
// @novel-plugins/data-core/skills — AI 对话技能注册表（共享层）
//
// ★ D46 修复①：本文件从 **auto 模块**（`auto/workbench/web/skills/skillsConfig.ts`）
//   下沉到 shared 的 data-core。原因与 `ui-kit/aiBars.tsx` 相同：
//   `apps/plugins/auto/novel.autowrite`（独立插件包）需要「技能列表 + 图标解析」，
//   若这份注册表留在 auto 模块内，novel.autowrite 就只能经
//   `@novel-plugins/auto-workbench/web` 引用 —— 移走 auto 模块即解析失败。
//
//   ★ 分层修正：原实现 import `@/plugin/registry`（kernel）。shared 包**不得**
//   依赖 kernel（会形成 shared→kernel 反向边，且 kernel 本就依赖 shared 的
//   stores，将构成环）。故图标表改为 **kernel 主动 push**：
//   `apps/web/src/plugin/host.ts` 的 `registerSkillIcons` 转发到本模块的
//   `registerSkillIcons`，方向恒为 kernel → shared。
//
// 技能内容的唯一来源是后端注册表（apps/server/src/ai/agents/skills.ts，
// 含插件经 ctx.ai.skills.register 注册的技能），经 GET /api/ai/skills 下发。
// 本文件只保留两样前端专属的东西：
//   1. id → 图标映射（LucideIcon 组件无法跨 JSON 序列化；未知 id 用 Puzzle 兜底，
//      所以插件技能无需改前端即可出现在技能选择器里）
//   2. 纯前端的展示行为（历史 key 策略）
// ============================================================

import { useMemo } from 'react';
import { create } from 'zustand';
import { Puzzle, type LucideIcon } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import { useProjectStore } from '../stores';

/** 技能上下文类型标识 —— 与后端 SkillContextKey 对齐 */
export type SkillContextKey =
  | 'characters'
  | 'foreshadows'
  | 'outline'
  | 'locations'
  | 'items'
  | 'events';

/** 技能展示元数据（内容来自 GET /api/ai/skills，icon 由本地映射补全） */
export interface SkillMeta {
  id: string;
  /** 展示名称 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 展示图标（后端无法下发组件，按 id 映射，未知技能用 Puzzle） */
  icon: LucideIcon;
  /** 主题色（hex） */
  color: string;
  /** 该技能需要注入的上下文类型 */
  contextKeys: SkillContextKey[];
  /** 注册来源 */
  source: 'builtin' | 'plugin';
}

const FALLBACK_ICON = Puzzle;

interface SkillRegistryState {
  /** 合并后的技能列表（后端顺序：内置按声明顺序，插件技能追加在后） */
  skills: SkillMeta[];
  /** 是否已成功拉取过 */
  loaded: boolean;
  /** 插件注册的 id → 图标映射（kernel 经 registerSkillIcons 推入） */
  icons: Record<string, LucideIcon>;
  /** 拉取技能列表（幂等；失败不置 loaded，下次调用重试） */
  ensureLoaded: () => Promise<void>;
  /** 内部：写入图标映射 */
  _setIcons: (icons: Record<string, LucideIcon>) => void;
  /** 内部：移除图标映射 */
  _removeIcons: (keys: string[]) => void;
}

export const useSkillRegistry = create<SkillRegistryState>((set, get) => ({
  skills: [],
  loaded: false,
  icons: {},

  _setIcons: (icons) => set((s) => ({ icons: { ...s.icons, ...icons } })),

  _removeIcons: (keys) => set((s) => {
    const next = { ...s.icons };
    for (const k of keys) delete next[k];
    return { icons: next };
  }),

  ensureLoaded: async () => {
    if (get().loaded) return;
    try {
      const resp = await apiClient.get<{ skills?: Array<Omit<SkillMeta, 'icon'>> }>('/ai/skills');
      const list = resp.skills ?? [];
      const { icons } = get();
      set({
        skills: list.map((s) => ({ ...s, icon: icons[s.id] ?? FALLBACK_ICON })),
        loaded: true,
      });
    } catch (err) {
      // 不置 loaded：技能面板下次展开时重试（server 未就绪 / 网络抖动自愈）
      console.warn('[skills] 技能列表拉取失败（将在下次展开时重试）:', err);
    }
  },
}));

/**
 * 注册技能图标（由 kernel `ctx.registerSkillIcons` 转发）。
 *
 * ★ 方向：kernel → shared。shared 侧只存数据，不认识 kernel registry。
 * 图标在技能列表已拉取时**即时回填**（否则插件后注册的图标要等下次拉取才生效）。
 */
export function registerSkillIcons(icons: Record<string, LucideIcon>): () => void {
  useSkillRegistry.getState()._setIcons(icons);
  // 已拉取过 ⇒ 把新图标补到现有列表（插件注册晚于首次拉取的常见时序）
  const { loaded, skills } = useSkillRegistry.getState();
  if (loaded) {
    useSkillRegistry.setState({
      skills: skills.map((s) => (icons[s.id] ? { ...s, icon: icons[s.id]! } : s)),
    });
  }
  return () => {
    useSkillRegistry.getState()._removeIcons(Object.keys(icons));
  };
}

/** 根据 id 查找技能元数据（同步读注册表；未拉取完成时返回 null） */
export function getSkillMeta(id?: string): SkillMeta | null {
  if (!id) return null;
  const skills = useSkillRegistry.getState().skills;
  return skills.find((s) => s.id === id) ?? null;
}

/**
 * 按「图标 key」解析图标组件。
 *
 * 给 skills 库面板用：库里的技能是**数据**（后端存 iconKey，组件跨不了 JSON），
 * 与技能选择器共用同一套来源（插件注册的图标表 + 兜底 Puzzle），
 * 这样同一条技能在选择器与库面板里长得一样。
 */
export function resolveSkillIcon(key?: string): LucideIcon {
  if (!key) return FALLBACK_ICON;
  return useSkillRegistry.getState().icons[key] ?? FALLBACK_ICON;
}

/**
 * 判断技能是否使用项目级独立对话历史（不绑定章节）。
 *
 * 大纲架构师等"跨章节"技能需要独立的历史 key，确保：
 *   - 切换章节不影响该技能的对话记忆
 *   - 该技能的对话历史与章节级对话历史互不干扰
 *
 * 返回该技能的历史 key 后缀（如 'outline'），拼接为 `${projectId}:outline`；
 * 若返回 null，表示走默认的章节级历史 `${projectId}:${chapterId}`。
 */
export function getSkillHistorySuffix(id?: string): string | null {
  if (!id) return null;
  if (id === 'outline-architect') return 'outline';
  return null;
}

/**
 * 当前项目模式下可用的技能列表（连接层：把 store 数据接进纯展示的 `SkillsBar`）。
 *
 * ★ 双模块分离（2026-09-11）：手写模式下不暴露流程型「自动写作」技能 ——
 *   否则用户能在手写框架里启动 AI 写作批次，两套框架又混在一起。
 *   注意：技能元数据目前没有 kind/modes 字段，这里暂按 id 过滤；
 *   日后应由服务端下发「适用模式」声明，前端按声明过滤。
 */
export function useSkillsForMode(): { skills: SkillMeta[]; loading: boolean } {
  const allSkills = useSkillRegistry((s) => s.skills);
  const loaded = useSkillRegistry((s) => s.loaded);
  const projectMode = useProjectStore((s) => s.currentProject?.mode ?? 'manual');
  const skills = useMemo(
    () => (projectMode === 'auto' ? allSkills : allSkills.filter((s) => s.id !== 'auto-write')),
    [allSkills, projectMode],
  );
  return { skills, loading: !loaded };
}

/**
 * 组装 `@novel-plugins/ui-kit` 的 `SkillsBar` 所需 props（连接层）。
 *
 * 纯展示组件不碰 store / router；本 hook 把技能列表、激活技能与「展开即拉取」
 * 接好。`onOpenSettings` 由调用方注入（kernel 壳与各插件都能提供自己的跳转）。
 */
export function useSkillBarProps(activeSkillId: string | null) {
  const { skills, loading } = useSkillsForMode();
  const ensureLoaded = useSkillRegistry((s) => s.ensureLoaded);
  const activeSkill = getSkillMeta(activeSkillId ?? undefined);
  return {
    skills,
    activeSkill,
    activeSkillId,
    loading,
    onExpand: () => { void ensureLoaded(); },
  };
}