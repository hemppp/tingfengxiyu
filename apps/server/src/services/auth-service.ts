// ============================================================
// 认证业务逻辑服务
// 处理用户注册、登录、查询等核心业务逻辑
// ============================================================

import { getDb, eq, saveToDisk, schema } from '@novel/db';
import { hashPassword, comparePassword, signToken } from '../lib/jwt.js';
import { toNumber } from './base-service.js';
import { v4 as uuidv4 } from 'uuid';

const { users } = schema;

// ---- 类型定义 ----

/** 用户实体（不含密码哈希） */
export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt?: number;
  updatedAt: number;
}

/** 注册结果 */
export interface RegisterResult {
  user: User;
  token: string;
}

/** 登录结果 */
export interface LoginResult {
  user: User;
  token: string;
}

// ---- 辅助函数 ----

/**
 * 将数据库行转换为 User 对象（排除 passwordHash）
 */
function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.displayName),
    avatar: row.avatar ? String(row.avatar) : undefined,
    isAdmin: !!row.isAdmin,
    createdAt: toNumber(row.createdAt),
    lastLoginAt: row.lastLoginAt ? toNumber(row.lastLoginAt) : undefined,
    updatedAt: toNumber(row.updatedAt),
  };
}

// ---- 公共 API ----

/**
 * 注册新用户
 * @param username - 用户名（唯一）
 * @param password - 明文密码（将被 bcrypt 哈希）
 * @param displayName - 显示昵称
 * @returns 用户信息和 JWT Token
 * @throws 用户名已存在时抛出错误
 */
export async function registerUser(
  username: string,
  password: string,
  displayName: string,
): Promise<RegisterResult> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }

  // 1. 检查用户名是否已存在
  const existing = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
  if (existing) {
    throw new Error('用户名已被占用');
  }

  // 2. 哈希密码
  const passwordHash = await hashPassword(password);

  // 3. 创建用户
  const now = new Date();
  const userId = uuidv4();

  // 3.1 第一个注册的用户自动成为管理员（保证系统至少有一个管理员）
  const userCount = db.select({ id: users.id }).from(users).all().length;
  const isAdmin = userCount === 0;

  db.insert(users).values({
    id: userId,
    username,
    passwordHash,
    displayName,
    isAdmin,
    createdAt: now,
    updatedAt: now,
  }).run();

  await saveToDisk(true); // 注册是关键操作，强制立即写入

  // 4. 签发 Token
  const token = signToken({ userId, username });

  // 5. 返回用户信息（不含密码）
  const user: User = {
    id: userId,
    username,
    displayName,
    isAdmin,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  };

  return { user, token };
}

/**
 * 验证用户凭据并登录
 * @param username - 用户名
 * @param password - 明文密码
 * @returns 用户信息和 JWT Token
 * @throws 用户不存在或密码错误时抛出错误
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<LoginResult> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }

  // 1. 查询用户（包含密码哈希）
  const row = db.select().from(users).where(eq(users.username, username)).get();
  if (!row) {
    throw new Error('用户名或密码错误');
  }

  // 2. 验证密码
  const isValid = await comparePassword(password, String(row.passwordHash));
  if (!isValid) {
    throw new Error('用户名或密码错误');
  }

  // 3. 更新最后登录时间
  const now = new Date();
  db.update(users)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(users.id, String(row.id)))
    .run();
  await saveToDisk(true); // 登录态更新强制写入，防止 token 签发后崩溃丢失

  // 4. 签发 Token
  const token = signToken({
    userId: String(row.id),
    username: String(row.username),
  });

  // 5. 返回用户信息（不含密码）
  const user = rowToUser(row as unknown as Record<string, unknown>);
  user.lastLoginAt = now.getTime();
  user.updatedAt = now.getTime();

  return { user, token };
}

/**
 * 根据 ID 查询用户
 * @param id - 用户 ID
 * @returns 用户对象（不含密码），不存在则返回 null
 */
export async function getUserById(id: string): Promise<User | null> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }

  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) {
    return null;
  }

  return rowToUser(row as unknown as Record<string, unknown>);
}

/**
 * 根据用户名查询用户
 * @param username - 用户名
 * @returns 用户对象（不含密码），不存在则返回 null
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }

  const row = db.select().from(users).where(eq(users.username, username)).get();
  if (!row) {
    return null;
  }

  return rowToUser(row as unknown as Record<string, unknown>);
}

/**
 * 检查用户名是否已被占用（注册页实时检测用）
 */
export async function checkUsernameExists(username: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }
  const row = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
  return !!row;
}

/**
 * 检查用户是否为管理员
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }
  const row = db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).get();
  return !!row?.isAdmin;
}

// ---- 管理员后台 API ----

/**
 * 列出所有用户（不含密码哈希）
 */
export async function listAllUsers(): Promise<User[]> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }
  const rows = db.select().from(users).all();
  return rows.map((r) => rowToUser(r as unknown as Record<string, unknown>));
}

/**
 * 管理员重置任意用户密码
 */
export async function adminResetUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }
  if (newPassword.length < 6) {
    throw new Error('密码至少 6 个字符');
  }
  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    throw new Error('用户不存在');
  }
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  db.update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, userId))
    .run();
  await saveToDisk(true);
}

/**
 * 管理员删除用户
 * 注意：不删除该用户关联的项目/章节等数据（按需另行清理），
 *       但会把当前用户从 user_settings 等用户级表中清除。
 */
export async function adminDeleteUser(userId: string): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }
  const existing = db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    throw new Error('用户不存在');
  }
  // 防止删除最后一个管理员
  const adminCount = db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).all().length;
  if (existing.isAdmin && adminCount <= 1) {
    throw new Error('不能删除最后一个管理员账号');
  }
  db.delete(users).where(eq(users.id, userId)).run();
  // 同时清理 user_settings
  try {
    db.delete(schema.userSettings).where(eq(schema.userSettings.userId, userId)).run();
  } catch {
    /* user_settings 表可能不存在该用户记录，忽略 */
  }
  await saveToDisk(true);
}

/**
 * 管理员设置/取消某用户的管理员权限
 */
export async function adminSetUserAdminStatus(
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('[AuthService] 数据库不可用');
  }
  const existing = db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    throw new Error('用户不存在');
  }
  // 取消最后一个管理员权限时拒绝
  if (!isAdmin && existing.isAdmin) {
    const adminCount = db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).all().length;
    if (adminCount <= 1) {
      throw new Error('不能取消最后一个管理员账号的权限');
    }
  }
  const now = new Date();
  db.update(users)
    .set({ isAdmin, updatedAt: now })
    .where(eq(users.id, userId))
    .run();
  await saveToDisk(true);
}
