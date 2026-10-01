-- ============================================================
-- skill_library 加归属列（2026-09-17）
--
-- 口径修订（作者原话）：
--   「每个用户自己上传的 skills 不是全局的，只有公共插件才是全局的」
--
--   · user_id IS NULL  → 公共技能（内置 / 插件带），所有用户可见、可装可删
--   · user_id = <uid>  → 该用户自己上传的私有技能，只有本人可见、只有本人能删
--
-- 私有技能的 `id` 同时带 `${userId}:` 前缀（在服务层拼），
-- 因为 `id` 是主键 —— 两个用户各传一个同名技能会直接撞主键。
-- 这个命名空间做法与 agent_skill_toggles.id 一致（见 0001 里那份注释）。
--
-- 已有行不来回填：它们全是 builtin，保持 NULL 正是"公共"语义。
-- ============================================================

ALTER TABLE `skill_library` ADD COLUMN `user_id` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_skill_library_user` ON `skill_library` (`user_id`);
