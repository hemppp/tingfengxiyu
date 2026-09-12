// ============================================================
// AI 对话技能注册表（前端侧）
//
// 技能内容的唯一来源是后端注册表（apps/server/src/ai/agents/skills.ts，
// 含插件经 ctx.ai.skills.register 注册的技能），经 GET /api/ai/skills 下发。
// 本文件只保留两样前端专属的东西：
//   1. id → 图标映射（LucideIcon 组件无法跨 JSON 序列化；未知 id 用 Puzzle 兜底，
//      所以插件技能无需改前端即可出现在技能选择器里）
//   2. 纯前端的展示行为（历史 key 策略）
// 此前这里维护过一份与后端平行的静态技能副本（另在 services/ai/skills.ts
// 还有第三份），插件技能在界面上不可见——已改为动态拉取合并。
// ============================================================

import { create } from 'zustand';
import {
  Puzzle, type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/services/api/apiClient';
import { usePluginRegistry } from '@/plugin/registry';

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

/** 技能图标：内容归插件所有（2026-09 剥离，docs/autowrite-plugin-framework.md §7），
 *  经插件 web 面 ctx.registerSkillIcons 注册；此处只留兜底表（未知技能用 Puzzle）。 */
const SKILL_ICONS: Record<string, LucideIcon> = {};

const FALLBACK_ICON = Puzzle;

interface SkillRegistryState {
  /** 合并后的技能列表（后端顺序：内置按声明顺序，插件技能追加在后） */
  skills: SkillMeta[];
  /** 是否已成功拉取过 */
  loaded: boolean;
  /** 拉取技能列表（幂等；失败不置 loaded，下次调用重试） */
  ensureLoaded: () => Promise<void>;
}

export const useSkillRegistry = create<SkillRegistryState>((set, get) => ({
  skills: [],
  loaded: false,

  ensureLoaded: async () => {
    if (get().loaded) return;
    try {
      const resp = await apiClient.get<{ skills?: Array<Omit<SkillMeta, 'icon'>> }>('/ai/skills');
      const list = resp.skills ?? [];
      const pluginIcons = usePluginRegistry.getState().skillIcons;
      set({
        skills: list.map((s) => ({ ...s, icon: pluginIcons[s.id] ?? SKILL_ICONS[s.id] ?? FALLBACK_ICON })),
        loaded: true,
      });
    } catch (err) {
      // 不置 loaded：技能面板下次展开时重试（server 未就绪 / 网络抖动自愈）
      console.warn('[skills] 技能列表拉取失败（将在下次展开时重试）:', err);
    }
  },
}));

/** 根据 id 查找技能元数据（同步读注册表；未拉取完成时返回 null） */
export function getSkillMeta(id?: string): SkillMeta | null {
  if (!id) return null;
  const skills = useSkillRegistry.getState().skills;
  return skills.find((s) => s.id === id) ?? null;
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
