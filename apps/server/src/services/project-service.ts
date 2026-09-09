// ============================================================
// 项目 Service — 带用户隔离
// ============================================================

import { schema, eq, isNull, saveToDisk, deleteProjectDb } from '@novel/db';
import type { Project } from '@novel/shared';
import { BaseService, normalizeTimestamps, toDbTimestamps } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const service = new BaseService<Project>(schema.projects, {
  rowToModel: (r) => normalizeTimestamps<Project>(r),
  modelToRow: (model) => {
    const row = { ...model } as unknown as Record<string, unknown>;
    toDbTimestamps(row);
    return row;
  },
  loadByColumn: 'userId',
  entityLabel: 'Projects',
});

export async function createProject(
  userId: string,
  data: Omit<Project, 'userId' | 'createdAt' | 'updatedAt'>,
): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    ...data,
    id: data.id ?? uuidv4(),
    userId,
    currentWordCount: data.currentWordCount ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await service.save(project);
  return project;
}

export async function getProject(id: string, userId: string): Promise<Project | null> {
  const project = await service.getById(id);
  // 所有权校验：只能访问自己的项目
  if (project && project.userId !== userId) return null;
  return project;
}

export async function listProjects(userId: string): Promise<Project[]> {
  // 先尝试加载当前用户的项目
  const projects = await service.loadAll(userId);

  // 如果没有项目，尝试认领旧数据库中 user_id 为 NULL 的孤立项目
  if (projects.length === 0) {
    const db = (await import('@novel/db')).getDb();
    if (db) {
      const orphaned = db.select()
        .from(schema.projects)
        .where(isNull(schema.projects.userId))
        .all() as Array<typeof schema.projects.$inferSelect>;

      if (orphaned.length > 0) {
        console.warn(`[ProjectService] 发现 ${orphaned.length} 个孤立项目，正在关联到用户 ${userId}`);
        for (const row of orphaned) {
          db.update(schema.projects)
            .set({ userId })
            .where(eq(schema.projects.id, row.id))
            .run();
        }
        await saveToDisk();
        // 重新加载
        return service.loadAll(userId);
      }
    }
  }

  return projects;
}

export async function updateProject(
  id: string,
  userId: string,
  data: Partial<Omit<Project, 'id' | 'userId' | 'createdAt'>>,
): Promise<boolean> {
  // 先验证所有权
  const existing = await getProject(id, userId);
  if (!existing) return false;
  await service.update(id, { ...data, updatedAt: Date.now() });
  return true;
}

export async function deleteProject(id: string, userId: string): Promise<boolean> {
  // 先验证所有权
  const existing = await getProject(id, userId);
  if (!existing) return false;
  await service.delete(id);
  // 同步删除项目库文件（data/projects/{id}.db 及其 -wal/-shm 侧车文件）
  // 失败仅记录日志，不阻塞主库删除流程（孤儿 .db 文件不影响功能，可后续清理）
  try {
    await deleteProjectDb(id);
  } catch (e) {
    console.error(`[deleteProject] 删除项目库文件失败 (${id}):`, e);
  }
  return true;
}
