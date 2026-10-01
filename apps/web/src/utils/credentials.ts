// ============================================================
// 记住我：仅记住用户名（C4 收尾 · 移除本地密码存储）
//
// 历史版本（混淆级 AES-GCM）：把密码加密后连同加密密钥一并存 localStorage。
// 作者注释也承认该方案非安全存储——能读 localStorage 的代码（XSS/恶意扩展）
// 均可解密。C4 把会话凭据迁到 HttpOnly Cookie 后，本地密码存储彻底失去
// 存在意义（Cookie 本身即持久会话，刷新/重启自动恢复），因此移除：
//
//   - 密码明文、密文、IV、加密密钥、盐：一律不再落盘
//   - 「记住我」只记忆用户名（预填登录框）
//   - autoLogin（自动登录）废弃：会话恢复完全由 HttpOnly Cookie + /auth/me 校准承担
//
// 启动时一次性清理历史遗留的凭据/密钥键。
// ============================================================

const USERNAME_KEY = 'novelmuse_remembered_username';
// 历史遗留键（旧版密码存储 + 自动登录标记），加载时清除
const LEGACY_KEYS = [
  'novelmuse_remembered_credentials',
  'novelmuse_cred_key',
  'novelmuse_cred_salt',
  'novelmuse_auto_login',
];

// 一次性清理历史遗留（幂等；隐私模式等异常环境忽略）
try {
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
  }
} catch {
  // 忽略
}

export interface StoredUsername {
  username: string;
  rememberMe: boolean;
  timestamp: number;
}

/**
 * 保存「记住我」信息：仅用户名（密码不再落 localStorage）
 */
export async function saveCredentials(
  username: string,
  _rememberMe: boolean = true,
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      USERNAME_KEY,
      JSON.stringify({ username, rememberMe: true, timestamp: Date.now() } satisfies StoredUsername),
    );
  } catch (error) {
    console.warn('[Credentials] 保存失败:', error);
  }
}

/**
 * 读取记住的用户名（无密码字段）
 * @返回 { username, rememberMe, timestamp } | null
 */
export async function getCredentials(): Promise<StoredUsername | null> {
  if (typeof window === 'undefined') return null;
  try {
    const data = window.localStorage.getItem(USERNAME_KEY);
    if (!data) return null;
    const stored = JSON.parse(data) as StoredUsername;
    // 30 天过期
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - stored.timestamp > thirtyDays) {
      clearCredentials();
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

/**
 * 自动登录已废弃：会话恢复由 HttpOnly Cookie 承载，恒返回 false
 */
export function shouldAutoLogin(): boolean {
  return false;
}

/**
 * 清除记住的用户名（及历史遗留键）
 */
export function clearCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(USERNAME_KEY);
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('[Credentials] 清除失败:', error);
  }
}

/**
 * 自动登录状态已废弃（no-op，保留签名兼容旧调用）
 */
export async function setAutoLogin(): Promise<void> {
  // 无操作：会话恢复由 Cookie 承担
}
