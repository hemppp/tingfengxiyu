// ============================================================
// 内置插件清单 —— 现有 19 个 API 模块以"内置插件"形式注册
//
// 每个模块 = { id, prefix, load } 一条记录：
//  - 模块文件保持不动（仍是 `export default router`）
//  - 挂载方式与外部插件完全一致（走 ctx.routes.register）
//  - 新增模块只需在这里加一行，无需再改 index.ts
// ============================================================

import type { PluginEntry } from '@novel/core';
import { builtinEntry } from './host.js';

/** 完整插件条目（插件自带 apply，注册任意扩展点） */
function moduleEntry(id: string, manifest: PluginEntry['manifest'], load: PluginEntry['load']): PluginEntry {
  return { id, source: 'builtin', manifest, load };
}

export const BUILTIN_PLUGINS: PluginEntry[] = [
  // 认证（公开路由，必须最先注册）
  builtinEntry('novel.auth', '/api/auth', () => import('../modules/auth.js')),
  // 项目与核心
  builtinEntry('novel.projects', '/api/projects', () => import('../modules/projects.js')),
  builtinEntry('novel.chapters', '/api/chapters', () => import('../modules/chapters.js')),
  // 知识库实体
  builtinEntry('novel.characters', '/api/characters', () => import('../modules/characters.js')),
  builtinEntry('novel.items', '/api/items', () => import('../modules/items.js')),
  builtinEntry('novel.credits', '/api/credits', () => import('../modules/credits.js')),
  builtinEntry('novel.locations', '/api/locations', () => import('../modules/locations.js')),
  builtinEntry('novel.events', '/api/events', () => import('../modules/events.js')),
  // 伏笔/标注/书角
  builtinEntry('novel.foreshadows', '/api/foreshadows', () => import('../modules/foreshadows.js')),
  builtinEntry('novel.earmarks', '/api/earmarks', () => import('../modules/earmarks.js')),
  builtinEntry('novel.annotations', '/api/annotations', () => import('../modules/annotations.js')),
  // 大纲/时间线/笔记
  builtinEntry('novel.outline', '/api/outline', () => import('../modules/outline.js')),
  builtinEntry('novel.timeline', '/api/timeline', () => import('../modules/timeline.js')),
  builtinEntry('novel.notes', '/api/notes', () => import('../modules/notes.js')),
  // 快照/统计/搜索/引用
  builtinEntry('novel.snapshots', '/api/snapshots', () => import('../modules/snapshots.js')),
  builtinEntry('novel.stats', '/api/stats', () => import('../modules/stats.js')),
  builtinEntry('novel.search', '/api/search', () => import('../modules/search.js')),
  builtinEntry('novel.references', '/api/references', () => import('../modules/references.js')),
  // AI / 管理
  builtinEntry('novel.ai', '/api/ai', () => import('../modules/ai.js')),
  builtinEntry('novel.admin', '/api/admin', () => import('../modules/admin.js')),

  // ── 完整插件（自带 apply，演示插件契约）──
  // 世界观建造师：路由 + AI 工具 + 技能 + 事件订阅（数据走 KV，无需迁移）
  moduleEntry('novel.worldbuilding', {
    id: 'novel.worldbuilding',
    name: '世界观建造师',
    description: '势力管理 + AI 世界观顾问（示例插件）',
    version: '0.1.0',
    permissions: ['routes', 'db:project', 'ai:tools', 'ai:skills', 'events'],
    dependsOn: ['novel.projects'],
    server: { inject: ['routes', 'db', 'ai', 'events'] },
    web: { inject: ['projectPanels', 'commands', 'selection', 'toolbar'] },
  }, () => import('@novel-plugins/worldbuilding')),
];
