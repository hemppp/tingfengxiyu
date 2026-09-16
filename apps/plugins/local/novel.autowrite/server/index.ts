// ============================================================
// 自动写作引擎插件 —— Server 面
//
// 写作技能框架（docs/architecture/ai-writing-architecture.md）：
//   1. 注册 8 个聊天型技能（自核心 skills.ts 剥离，内容归插件所有）
//   2. 注册自动写作 flow 型技能（编排器协议）+ 8 个流程工具（状态机裁决 + 治理）
//   3. 批次/流转/台账状态全部存插件 KV（项目隔离），零迁移依赖
// ============================================================

import type { ServerPluginContext } from '@novel/core';
import { CHAT_SKILLS } from './skills/index.js';
import { AUTOWRITE_SKILL, registerAutowrite } from './autowrite/index.js';
import { createAutowriteRouter } from './routes.js';

export const name = 'novel.autowrite';
export const inject = ['routes', 'db', 'ai'];

export function apply(ctx: ServerPluginContext): void {
  // ── 1. 聊天型技能（剥离内容，直通宿主注册表）──
  for (const def of CHAT_SKILLS) {
    ctx.effect(() => ctx.ai.skills.register(def), `autowrite: skill ${def.id}`);
  }

  // ── 2. 自动写作 flow 型技能 + 流程工具 ──
  ctx.effect(() => ctx.ai.skills.register(AUTOWRITE_SKILL), 'autowrite: skill auto-write');
  registerAutowrite(ctx);

  // ── 3. 状态路由（独立面板数据源）──
  ctx.effect(
    () => ctx.routes.register('/api/plugins/autowrite', createAutowriteRouter(ctx)),
    'autowrite: routes',
  );

  ctx.logger.info(`自动写作引擎已挂载（${CHAT_SKILLS.length + 1} 个技能 + 自动写作流程工具 + 状态路由）`);
}
