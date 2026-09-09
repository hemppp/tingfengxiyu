// ============================================================
// NovelMuse - Drizzle ORM 数据库 Schema (SQLite)
// ============================================================

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ---- 插件 KV（插件数据扩展 v1）----

export const pluginKv = sqliteTable('plugin_kv', {
  id: text('id').primaryKey(),
  pluginId: text('plugin_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  projectId: text('project_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  uniqueKey: uniqueIndex('idx_plugin_kv_unique').on(table.pluginId, table.key, table.projectId),
}));

// ---- 用户 ----

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  avatar: text('avatar'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  usernameIdx: index('idx_users_username').on(table.username),
}));

// ---- 项目 ----

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  coverImage: text('cover_image'),
  penName: text('pen_name'),
  genre: text('genre'),
  targetWordCount: integer('target_word_count'),
  currentWordCount: integer('current_word_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdIdx: index('idx_projects_user_id').on(table.userId),
}));

// ---- 章节 ----

export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  order: integer('order').notNull(),
  wordCount: integer('word_count').notNull().default(0),
  summary: text('summary'),
  status: text('status').notNull().default('draft'), // 草稿|已修订|已完成|已归档
  label: text('label'),
  pov: text('pov'), // 视角角色 ID
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // 软删除时间戳，null = 未删除
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_chapters_project_id').on(table.projectId),
  orderIdx: index('idx_chapters_order').on(table.order),
}));

// ---- 角色 ----

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  aliases: text('aliases'), // JSON 字符串数组
  thumbnail: text('thumbnail'),
  color: text('color'),
  role: text('role'),       // 角色定位：protagonist / supporting / minor
  // 内核
  desire: text('desire'),
  fear: text('fear'),
  belief: text('belief'),
  weakness: text('weakness'),
  // 描述
  appearance: text('appearance'),
  personality: text('personality'),
  backstory: text('backstory'),
  speechStyle: text('speech_style'),
  // 动态
  states: text('states'),        // JSON EntityState[]
  relations: text('relations'),  // JSON CharacterRelation[]
  chapters: text('chapters'),    // JSON 数字数组
  tags: text('tags'),            // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_characters_project_id').on(table.projectId),
}));

// ---- 物品 ----

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type'),
  description: text('description'),
  thumbnail: text('thumbnail'),
  color: text('color'),
  creditPrice: real('credit_price'),      // 积分定价（系统文：商城兑换所需积分）
  states: text('states'),                // JSON EntityState[]
  holders: text('holders'),              // JSON ItemHolder[] 装备流转史
  currentHolders: text('current_holders'), // JSON string[] 当前持有者（可共享、可空）
  relations: text('relations'),           // JSON ItemRelation[] 物品间关系
  chapters: text('chapters'),            // JSON 数字数组
  tags: text('tags'),                    // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_items_project_id').on(table.projectId),
}));

// ---- 系统积分（系统文：积分使用结余追踪） ----

export const creditTransactions = sqliteTable('credit_transactions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  characterId: text('character_id'),     // 积分持有者（绑定系统者）
  chapter: integer('chapter').notNull(), // 发生章节
  type: text('type').notNull(),          // gain|spend
  amount: real('amount').notNull(),      // 数额（恒为正，方向由 type 决定）
  reason: text('reason'),                // 事由
  relatedItemId: text('related_item_id'), // 关联物品（兑换所得 / 获得之物）
  tags: text('tags'),                    // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_credit_transactions_project_id').on(table.projectId),
  characterIdIdx: index('idx_credit_transactions_character_id').on(table.characterId),
}));

// ---- 地点 ----

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  thumbnail: text('thumbnail'),
  color: text('color'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  mapZoom: integer('map_zoom'),
  world: text('world'),
  states: text('states'),       // JSON EntityState[]
  chapters: text('chapters'),   // JSON 数字数组
  tags: text('tags'),           // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_locations_project_id').on(table.projectId),
}));

// ---- 事件 ----

export const storyEvents = sqliteTable('story_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  chapter: integer('chapter').notNull(),
  participants: text('participants'),       // JSON 字符串数组（角色 ID）
  relatedItems: text('related_items'),      // JSON 字符串数组
  relatedLocations: text('related_locations'), // JSON 字符串数组
  consequences: text('consequences'),       // JSON 字符串数组
  tags: text('tags'),                       // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_story_events_project_id').on(table.projectId),
}));

// ---- 伏笔 ----

export const foreshadows = sqliteTable('foreshadows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  type: text('type').notNull(),       // 身份|动机|关系|创伤|转折|命运
  status: text('status').notNull().default('planted'), // 已播种|已暗示|已回收|已废弃
  // 生命周期
  seedChapter: integer('seed_chapter').notNull(),
  seedText: text('seed_text'),
  seedAnnotationId: text('seed_annotation_id'),
  hints: text('hints'),               // JSON ForeshadowHint[]
  payoffChapter: integer('payoff_chapter'),
  payoffText: text('payoff_text'),
  payoffAnnotationId: text('payoff_annotation_id'),
  // 关联
  relatedCharacters: text('related_characters'), // JSON 字符串数组
  relatedItems: text('related_items'),           // JSON 字符串数组
  relatedEvents: text('related_events'),         // JSON 字符串数组
  earmarks: text('earmarks'),                    // JSON 字符串数组 - 关联的 Earmark IDs
  tags: text('tags'),                            // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_foreshadows_project_id').on(table.projectId),
}));

// ---- 书角标记 ----

export const earmarks = sqliteTable('earmarks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),  // 伏笔播种|伏笔回收|可能性
  foreshadowId: text('foreshadow_id').references(() => foreshadows.id, { onDelete: 'set null' }),  // 关联的伏笔 ID（可选）
  description: text('description'),
  outcome: text('outcome'),
  probability: real('probability'),  // 0-100
  relatedCharacters: text('related_characters'),  // JSON 字符串数组
  relatedItems: text('related_items'),  // JSON 字符串数组
  tags: text('tags'),  // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_earmarks_project_id').on(table.projectId),
  chapterIdIdx: index('idx_earmarks_chapter_id').on(table.chapterId),
}));

// ---- 标注 ----

export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),       // 角色|物品|地点|伏笔|事件|关系|自定义
  startOffset: integer('start_offset').notNull(),
  endOffset: integer('end_offset').notNull(),
  selectedText: text('selected_text').notNull(),
  color: text('color'),
  // 关联
  targetId: text('target_id'),
  targetType: text('target_type'),    // 角色|物品|地点|事件|伏笔
  description: text('description'),
  // 伏笔专用
  foreshadowType: text('foreshadow_type'),
  foreshadowStatus: text('foreshadow_status'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_annotations_project_id').on(table.projectId),
  chapterIdIdx: index('idx_annotations_chapter_id').on(table.chapterId),
}));

// ---- 大纲 ----

export const outlineNodes = sqliteTable('outline_nodes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),  // 自引用外键因 TS 循环类型推断限制未添加，由 service 层校验完整性
  type: text('type').notNull(),       // 幕|章节|场景|节拍|笔记
  title: text('title').notNull(),
  description: text('description'),
  order: integer('order').notNull(),
  linkedChapterIds: text('linked_chapter_ids'), // JSON 字符串数组
  tags: text('tags'),                           // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_outline_nodes_project_id').on(table.projectId),
}));

// ---- 时间线 ----

export const timelineEvents = sqliteTable('timeline_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  chapter: integer('chapter'),
  timestamp: text('timestamp'),       // 故事内时间（自由文本）
  order: integer('order').notNull(),
  characterIds: text('character_ids'), // JSON 字符串数组
  type: text('type').notNull(),       // 事件|伏笔|状态变化
  color: text('color'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_timeline_events_project_id').on(table.projectId),
}));

// ---- 笔记/片段 ----

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title'),
  content: text('content').notNull().default(''),
  tags: text('tags'),                 // JSON 字符串数组
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  linkedChapterId: text('linked_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_notes_project_id').on(table.projectId),
}));

// ---- 参考书（纯阅读对照）----

export const referenceBooks = sqliteTable('reference_books', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  author: text('author'),
  content: text('content').notNull().default(''),
  chapters: text('chapters', { mode: 'json' }).notNull().default([]),  // JSON { title, content }[]
  currentChapter: integer('current_chapter').notNull().default(0),
  source: text('source'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_reference_books_project_id').on(table.projectId),
}));

// ---- 写作统计 ----

export const writingStats = sqliteTable('writing_stats', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),       // YYYY-MM-DD
  wordCount: integer('word_count').notNull().default(0),
  chapterId: text('chapter_id'),
  duration: integer('duration'),      // 写作时长（秒）
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_writing_stats_project_id').on(table.projectId),
}));

// ---- 快照 ----

export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  wordCount: integer('word_count').notNull(),
  label: text('label'),
  auto: integer('auto', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  chapterIdIdx: index('idx_snapshots_chapter_id').on(table.chapterId),
}));

// ---- AI 对话 ----

export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id'),
  messages: text('messages'),         // JSON AIMessage[]
  context: text('context'),           // JSON AIContext
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdIdx: index('idx_ai_conversations_project_id').on(table.projectId),
}));

// ---- 文本标记 ----

export const textMarkers = sqliteTable('text_markers', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  startOffset: integer('start_offset').notNull(),
  endOffset: integer('end_offset').notNull(),
  color: text('color').notNull(),
  label: text('label'),
}, (table) => ({
  chapterIdIdx: index('idx_text_markers_chapter_id').on(table.chapterId),
}));

// ---- 系列 ----

// 注意：series 数据量预期很小（每位作者通常仅维护少数系列），
// 此处索引主要用于按名称查找，避免全表扫描。
export const series = sqliteTable('series', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  projectIds: text('project_ids'),       // JSON 字符串数组
  sharedCharacterIds: text('shared_character_ids'), // JSON 字符串数组
  sharedLocationIds: text('shared_location_ids'),   // JSON 字符串数组
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  nameIdx: index('idx_series_name').on(table.name),
}));

// ============================================================
// Relations（Drizzle relations，用于查询时自动 join）
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  chapters: many(chapters),
  characters: many(characters),
  items: many(items),
  creditTransactions: many(creditTransactions),
  locations: many(locations),
  events: many(storyEvents),
  foreshadows: many(foreshadows),
  earmarks: many(earmarks),
  outlineNodes: many(outlineNodes),
  notes: many(notes),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  project: one(projects, { fields: [chapters.projectId], references: [projects.id] }),
  annotations: many(annotations),
  snapshots: many(snapshots),
  markers: many(textMarkers),
}));

export const charactersRelations = relations(characters, ({ one }) => ({
  project: one(projects, { fields: [characters.projectId], references: [projects.id] }),
}));

export const itemsRelations = relations(items, ({ one }) => ({
  project: one(projects, { fields: [items.projectId], references: [projects.id] }),
}));

export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  project: one(projects, { fields: [creditTransactions.projectId], references: [projects.id] }),
}));

export const locationsRelations = relations(locations, ({ one }) => ({
  project: one(projects, { fields: [locations.projectId], references: [projects.id] }),
}));

export const foreshadowsRelations = relations(foreshadows, ({ one }) => ({
  project: one(projects, { fields: [foreshadows.projectId], references: [projects.id] }),
}));

export const earmarksRelations = relations(earmarks, ({ one }) => ({
  project: one(projects, { fields: [earmarks.projectId], references: [projects.id] }),
  chapter: one(chapters, { fields: [earmarks.chapterId], references: [chapters.id] }),
  foreshadow: one(foreshadows, { fields: [earmarks.foreshadowId], references: [foreshadows.id] }),
}));

export const annotationsRelations = relations(annotations, ({ one }) => ({
  chapter: one(chapters, { fields: [annotations.chapterId], references: [chapters.id] }),
}));

// ---- 用户 AI 设置 ----

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  aiFeatures: text('ai_features', { mode: 'json' }).notNull().default('{}'),
  aiProviderConfig: text('ai_provider_config', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
