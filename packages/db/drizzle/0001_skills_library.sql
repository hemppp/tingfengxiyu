-- ============================================================
-- 集中式 Skills 库（主库，全局）
--
-- 设计见 docs/skills-library.md。两张表：
--   · skill_library        —— 一处集中存放所有技能，内部按 assistant / agent 两类分开
--   · agent_skill_toggles  —— 每个智能体的技能开关（按用户存），左关右开的那对状态
--
-- 为什么用 IF NOT EXISTS：迁移执行器是按文件名排序逐条 exec 的，
-- 而这张库表属于"全局"语义 —— 即使某个环境里被重复执行一次，也必须是幂等的
-- （参考 project_tables.sql 同款做法）。0000 用的是裸 CREATE TABLE，那是它的历史包袱。
-- ============================================================

CREATE TABLE IF NOT EXISTS `skill_library` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#94a3b8' NOT NULL,
	`icon_key` text DEFAULT 'sparkles' NOT NULL,
	`category` text NOT NULL,
	`owner_agent` text,
	`system_prompt` text DEFAULT '' NOT NULL,
	`context_keys` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'installed' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_skill_library_category` ON `skill_library` (`category`,`owner_agent`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_skill_toggles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_agent_skill_toggles_unique` ON `agent_skill_toggles` (`user_id`,`agent_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_skill_toggles_agent` ON `agent_skill_toggles` (`user_id`,`agent_id`);
