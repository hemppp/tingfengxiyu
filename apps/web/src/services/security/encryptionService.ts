/**
 * 加密存储服务
 * 所有草稿加密保存，不传云端
 * 使用 Web Crypto API 进行 AES-GCM 加密
 */

const DB_NAME = 'novelmuse_db';
const STORE_NAME = 'encrypted_data';

/**
 * 密码强度验证结果
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 验证密码强度
 * - 最少 8 个字符
 * - 必须包含大写字母
 * - 必须包含小写字母
 * - 必须包含数字
 *
 * @param 密码 待验证的密码
 * @返回 验证结果，包含是否通过和错误信息列表
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('密码至少需要 8 个字符');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('密码必须包含至少一个大写字母');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('密码必须包含至少一个小写字母');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('密码必须包含至少一个数字');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// 初始化 IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        try {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error('数据库初始化失败'));
        }
      };
    } catch (err) {
      reject(err instanceof Error ? err : new Error('无法打开数据库'));
    }
  });
}

// 从密码派生密钥
// OWASP 推荐 PBKDF2-HMAC-SHA256 最低迭代次数为 600,000
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      // BufferSource 取 salt，Uint8Array 符合 ArrayBufferView，
      // 但由于 TypeScript 5.x ArrayBufferLike 泛型窄化，显式转换是必要的
      salt: salt as BufferSource,
      iterations: 600000, // OWASP 推荐：PBKDF2-HMAC-SHA256 最低 600,000
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 加密数据
export async function encryptData(data: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(data)
  );

  // 组合 salt + iv + 已加密
  const combined = new Uint8Array(salt.length + iv.length + new Uint8Array(encrypted).length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return btoa(String.fromCharCode(...combined));
}

// 解密数据
export async function decryptData(encryptedBase64: string, password: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const data = combined.slice(28);

  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return new TextDecoder().decode(decrypted);
}

// 保存到 IndexedDB（加密）
export async function saveEncrypted(key: string, data: string, password: string): Promise<void> {
  try {
    const encrypted = await encryptData(data, password);
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(encrypted, key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('保存数据失败'));
    });
  } catch (err) {
    throw new Error(`加密保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
  }
}

// 从 IndexedDB 读取（解密）
export async function loadEncrypted(key: string, password: string): Promise<string | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        try {
          if (!request.result) {
            resolve(null);
            return;
          }
          const decrypted = await decryptData(request.result, password);
          resolve(decrypted);
        } catch {
          reject(new Error('解密失败，密码错误'));
        }
      };
      request.onerror = () => reject(request.error || new Error('读取数据失败'));
    });
  } catch {
    throw new Error(`读取数据失败`);
  }
}

// 删除
export async function deleteEncrypted(key: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('删除数据失败'));
    });
  } catch (err) {
    throw new Error(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
  }
}

// 列出所有 键
export async function listEncryptedKeys(): Promise<string[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAllKeys();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error || new Error('获取密钥列表失败'));
    });
  } catch (err) {
    throw new Error(`获取密钥列表失败: ${err instanceof Error ? err.message : '未知错误'}`);
  }
}