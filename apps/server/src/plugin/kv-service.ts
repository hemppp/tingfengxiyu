// ============================================================
// 插件 KV 服务（SQLite 实现）—— 插件数据扩展 v1
//
// 存储位置：
//  - opts.projectId 缺省 → 主库 plugin_kv（全局数据）
//  - opts.projectId 指定 → 项目库 plugin_kv（项目隔离数据）
// 规则：
//  - key 必须带插件语义前缀（建议 'settings.x' / 'data.x'），KvService 自动加 pluginId 隔离
//  - value 一律 JSON 序列化存储
//  - 主库不可用时降级返回空（不影响宿主启动）
// ============================================================

import { getDb, getProjectDbSync, initProjectDb, schema, eq, and, like, isNull } from '@novel/db';
import { v4 as uuidv4 } from 'uuid';
import type { KvService } from './types.js';

interface KvRow {
  id: string;
  pluginId: string;
  key: string;
  value: string;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createSqliteKvService(): KvService {
  const parse = (raw: string | null): unknown => {
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  return {
    get(pluginId, key, opts) {
      const db = opts?.projectId ? getProjectDbSync(opts.projectId) : getDb();
      if (!db) return undefined;
      try {
        const row = db.select()
          .from(schema.pluginKv)
          .where(and(
            eq(schema.pluginKv.pluginId, pluginId),
            eq(schema.pluginKv.key, key),
            opts?.projectId ? eq(schema.pluginKv.projectId, opts.projectId) : isNull(schema.pluginKv.projectId),
          ))
          .get() as unknown as KvRow | undefined;
        return row ? (parse(row.value) as never) : undefined;
      } catch (err) {
        console.warn(`[plugin-kv] get 失败 (${pluginId}:${key}):`, err);
        return undefined;
      }
    },

    async set(pluginId, key, value, opts) {
      // 项目作用域：确保项目库已初始化（创建并缓存），否则写入静默丢失
      if (opts?.projectId) {
        try {
          await initProjectDb(opts.projectId);
        } catch (err) {
          console.warn(`[plugin-kv] 项目库初始化失败 (${opts.projectId}):`, err);
          return;
        }
      }
      const db = opts?.projectId ? getProjectDbSync(opts.projectId) : getDb();
      if (!db) return;
      const now = new Date();
      const projectId = opts?.projectId ?? null;
      try {
        const existing = db.select({ id: schema.pluginKv.id })
          .from(schema.pluginKv)
          .where(and(
            eq(schema.pluginKv.pluginId, pluginId),
            eq(schema.pluginKv.key, key),
            projectId ? eq(schema.pluginKv.projectId, projectId) : isNull(schema.pluginKv.projectId),
          ))
          .get() as unknown as { id: string } | undefined;

        if (existing) {
          db.update(schema.pluginKv)
            .set({ value: JSON.stringify(value), updatedAt: now })
            .where(eq(schema.pluginKv.id, existing.id))
            .run();
        } else {
          db.insert(schema.pluginKv).values({
            id: uuidv4(),
            pluginId,
            key,
            value: JSON.stringify(value),
            projectId,
            createdAt: now,
            updatedAt: now,
          }).run();
        }
      } catch (err) {
        console.warn(`[plugin-kv] set 失败 (${pluginId}:${key}):`, err);
      }
    },

    list(pluginId, prefix, opts) {
      const db = opts?.projectId ? getProjectDbSync(opts.projectId) : getDb();
      if (!db) return [];
      try {
        const projectId = opts?.projectId ?? null;
        const rows = db.select()
          .from(schema.pluginKv)
          .where(and(
            eq(schema.pluginKv.pluginId, pluginId),
            projectId ? eq(schema.pluginKv.projectId, projectId) : isNull(schema.pluginKv.projectId),
            prefix ? like(schema.pluginKv.key, `${prefix}%`) : undefined,
          ))
          .all() as unknown as KvRow[];
        return rows.map((r) => ({ key: r.key, value: parse(r.value) }));
      } catch (err) {
        console.warn(`[plugin-kv] list 失败 (${pluginId}):`, err);
        return [];
      }
    },

    async delete(pluginId, key, opts) {
      if (opts?.projectId) {
        try {
          await initProjectDb(opts.projectId);
        } catch (err) {
          console.warn(`[plugin-kv] 项目库初始化失败 (${opts.projectId}):`, err);
          return;
        }
      }
      const db = opts?.projectId ? getProjectDbSync(opts.projectId) : getDb();
      if (!db) return;
      try {
        const projectId = opts?.projectId ?? null;
        db.delete(schema.pluginKv)
          .where(and(
            eq(schema.pluginKv.pluginId, pluginId),
            eq(schema.pluginKv.key, key),
            projectId ? eq(schema.pluginKv.projectId, projectId) : isNull(schema.pluginKv.projectId),
          ))
          .run();
      } catch (err) {
        console.warn(`[plugin-kv] delete 失败 (${pluginId}:${key}):`, err);
      }
    },
  };
}
