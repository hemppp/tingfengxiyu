// ============================================================
// 从「孤儿项目库」恢复主库 projects 行
//
// 什么时候需要它：
//   `projects.user_id` 是 **ON DELETE cascade** —— 删用户会连带删掉它的项目行，
//   而 `data/projects/{id}.db` 不受影响 → 项目库文件还在、主库行没了。
//   表现是"书架上的书凭空消失、磁盘上还有正文"（实测踩过：30 章 / 96,774 字）。
//
// 本脚本从**项目库自己**重建那行：章节数、总字数、时间戳都从库里读，
// 不猜、不编。**brief / genre 属于主库列，随行一起丢了，恢复不了 —— 需要作者重填**，
// 脚本会在结尾明确说出来。
//
// 用法：
//   node scripts/restore-project-from-orphan-db.mjs <projectId> "<书名>" <ownerUsername>
//   例：node scripts/restore-project-from-orphan-db.mjs c980335a-... "空山雨后" user
//
// 前置：**先停 server**（Windows 下库文件被占用会写失败；且避免它缓存里的旧状态覆盖）。
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const MAIN_DB = 'F:/new1.2/data/novelmuse.db';
const PROJ_DIR = 'F:/new1.2/data/projects';

const [projectId, name, ownerUsername] = process.argv.slice(2);
if (!projectId || !name || !ownerUsername) {
  console.log('用法: node scripts/restore-project-from-orphan-db.mjs <projectId> "<书名>" <ownerUsername>');
  process.exit(1);
}

const dbPath = `${PROJ_DIR}/${projectId}.db`;
if (!fs.existsSync(dbPath)) {
  console.error(`✗ 找不到项目库文件：${dbPath}`);
  process.exit(1);
}

// ---- ① 从项目库里读事实（不猜）----
const pdb = new DatabaseSync(dbPath, { readOnly: true });
const ch = pdb.prepare(`
  select count(*) c, coalesce(sum(word_count),0) w, min(created_at) mn, max(created_at) mx
  from chapters where deleted_at is null
`).get();
const characters = pdb.prepare('select count(*) c from characters').get().c;
const foreshadows = pdb.prepare('select count(*) c from foreshadows').get().c;
pdb.close();

if (!ch || ch.c === 0) {
  console.error('✗ 项目库里一章都没有 —— 这本书没有可恢复的内容，先确认是不是选错了库文件');
  process.exit(1);
}

// ---- ② 查主库：不能覆盖已存在的行 ----
const db = new DatabaseSync(MAIN_DB);
db.prepare('select 1').get();
const exists = db.prepare('select id, name from projects where id = ?').get(projectId);
if (exists) {
  console.error(`✗ 主库里已经有这个项目（${exists.name}）—— 本脚本只做恢复，不覆盖`);
  db.close();
  process.exit(1);
}
const owner = db.prepare('select id, username from users where username = ?').get(ownerUsername);
if (!owner) {
  console.error(`✗ 找不到用户 ${ownerUsername}`);
  db.close();
  process.exit(1);
}

const createdAt = ch.mn ?? Math.floor(Date.now() / 1000);
const updatedAt = ch.mx ?? createdAt;

// ---- ③ 重建那一行 ----
db.prepare(`
  insert into projects
    (id, user_id, name, description, cover_image, pen_name, genre,
     target_word_count, current_word_count, created_at, updated_at, mode, brief)
  values (?, ?, ?, null, null, null, null, null, ?, ?, ?, 'auto', null)
`).run(projectId, owner.id, name, ch.w, createdAt, updatedAt);
db.close();

console.log('✅ 已恢复主库 projects 行');
console.log(`   项目 id    ：${projectId}`);
console.log(`   书名       ：${name}`);
console.log(`   归属       ：${owner.username} (${owner.id})`);
console.log(`   章节       ：${ch.c} 章，合计 ${ch.w} 字`);
console.log(`   实体       ：角色 ${characters} 条，伏笔 ${foreshadows} 条`);
console.log(`   时间戳     ：${new Date(createdAt * 1000).toISOString()} ~ ${new Date(updatedAt * 1000).toISOString()}`);
console.log('');
console.log('⚠️ 以下字段随主库行一起丢了，脚本不编造，需要作者在「编辑书籍」里重填：');
console.log('   · brief（开书设定：开局/世界观/笔风/主角/女主/流派）—— AI 写作模式会用到它');
console.log('   · genre（书架标签上的流派名）');
console.log('');
console.log('下一步：重启 server 后确认书架能看到它，并跑一次 `node scripts/clean-orphan-project-dbs.mjs --list`（应不再列为孤儿）。');
