// ============================================================
// 自动写作引擎插件 —— Web 面
//
// ★ 2026-09-11「双模块分离」：本插件**不再注册手写框架的浮窗面板**。
//   手写（manual）与 AI 写作（auto）自此是两个互斥模块：
//     · 手写侧只保留 AI 对话与它的技能，不再有「自动写作」入口
//     · AI 写作侧由宿主工作台（AutoWriteWorkbench）承载，不依赖气泡面板
//
// 仍然注册：
//   1. AI 聊天气泡栏（chatRail）—— 属于 AI 对话本身，保留
//   2. 技能图标（registerSkillIcons）—— 技能内容归插件所有，保留
//
// 注：AutowritePanel / AutowriteSkillRail 仍留在 panel.tsx，
//     供日后 AI 工作台复用（那套面板的批次视图是现成的），此处只是不注册。
// ============================================================

import {
  Users, Lightbulb, Activity, Globe, MessageSquare, Network, PenTool, BookOpen, Sparkles,
} from 'lucide-react';
import type { WebPluginContext } from '@novel/core/web';
import { ChatWheelRail } from './chat-wheel.js';
import { setApiFetch } from './panel.js';

export const name = 'novel.autowrite';
export const inject = ['projectPanels', 'skills', 'chatRail', 'api'];

export function apply(ctx: WebPluginContext): void {
  // ★ 带鉴权 API：面板全部请求经 ctx.api（自动带 JWT/项目头）
  setApiFetch(ctx.api);

  // ── 已移除：registerProjectPanel({ key: 'autowrite', label: '自动写作' }) ──
  //   手写框架不再提供自动写作入口。AI 写作是独立模块，有自己的工作台；
  //   在手写模式下露出这个入口会让两套框架重新混在一起。

  // ── 接管 AI 聊天气泡栏（转轮选择器：中心按钮 + 扇形功能轮）──
  ctx.registerChatRail({ key: 'novel.autowrite:chat-wheel', Component: ChatWheelRail });

  // ── 技能选择器图标（key = 技能 id；未注册的技能走宿主 Puzzle 兜底）──
  ctx.registerSkillIcons({
    'character-analyst': Users,
    'foreshadow-tracker': Lightbulb,
    'rhythm-doctor': Activity,
    'worldbuilder': Globe,
    'dialogue-polisher': MessageSquare,
    'plot-architect': Network,
    'continue-writer': PenTool,
    'outline-architect': BookOpen,
    'auto-write': Sparkles,
  });
}
