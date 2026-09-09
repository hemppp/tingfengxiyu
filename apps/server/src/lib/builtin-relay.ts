// ============================================================
// 内置公益中转站（分层加密）
//
// 为未配置自有 AI 服务商的用户提供开箱即用的 AI 服务：
//   - 密文层：URL/Key/model 以 AES-256-GCM 密文存放于
//     builtin-relay-data.ts（明文不出现在任何源码/文档/日志中）
//   - 密钥分层：材料 A（data 文件）⊕ 材料 B（builtin-relay-seal.ts）
//     → SHA-256 → AES-256 密钥；单一文件无法还原内容
//   - 使用层：Key 仅在服务端出站请求的 Authorization 头中使用，
//     永不返回给前端（publicAIConfig 仅回脱敏 hint）
//   - 出站安全：解封后强制 https + host 钉死校验，随后仍统一经过
//     ssrf-guard 的出站校验（getAIConfig / 各直连 fetch 路径）
// ============================================================

import { createDecipheriv, createHash } from 'node:crypto';
import { RELAY_CIPHERTEXT, RELAY_KEY_PART_A } from './builtin-relay-data.js';
import { RELAY_KEY_PART_B } from './builtin-relay-seal.js';

/** 内置中转站出站配置（apiKey 仅限服务端内存中使用） */
export interface BuiltinRelayConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/** 内置中转站唯一允许的出站主机（钉死，防篡改密文把流量引向他处） */
const ALLOWED_RELAY_HOST = 'new-api.dadfafwada.dpdns.org';

export const BUILTIN_RELAY_LABEL = '公益中转站（内置）';

let cached: BuiltinRelayConfig | null | undefined;

/**
 * 解封内置公益中转站配置（首次调用解密并缓存；失败返回 null 并告警）。
 * 明文仅在服务端内存中存在，任何日志/接口都不得输出 apiKey。
 */
export function getBuiltinRelay(): BuiltinRelayConfig | null {
  if (cached !== undefined) return cached;
  try {
    const partA = Buffer.from(RELAY_KEY_PART_A, 'hex');
    const partB = Buffer.from(RELAY_KEY_PART_B, 'hex');
    if (partA.length !== 32 || partB.length !== 32 || partA.length !== partB.length) {
      throw new Error('密封材料长度异常');
    }
    const xored = Buffer.alloc(partA.length);
    for (let i = 0; i < partA.length; i++) xored[i] = partA[i] ^ partB[i];
    const aesKey = createHash('sha256').update(xored).digest();

    const raw = Buffer.from(RELAY_CIPHERTEXT, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(json) as { baseUrl?: string; apiKey?: string; model?: string; label?: string };

    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) {
      throw new Error('密文内容字段缺失');
    }
    // 出站安全验收（约束：仅 http/https、校验 host、拒绝私网/环回/保留地址）：
    // 内置站钉死为 https + 指定公网域名，其余一律拒绝解封结果。
    let url: URL;
    try {
      url = new URL(parsed.baseUrl);
    } catch {
      throw new Error('baseUrl 不是合法 URL');
    }
    if (url.protocol !== 'https:') throw new Error('内置站仅允许 https 出站');
    if (url.hostname.toLowerCase() !== ALLOWED_RELAY_HOST) {
      throw new Error(`内置站 host 不匹配（${url.hostname}）`);
    }

    cached = {
      baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
      apiKey: parsed.apiKey,
      model: parsed.model,
      label: parsed.label || BUILTIN_RELAY_LABEL,
    };
  } catch (error) {
    console.error('[BuiltinRelay] 内置中转站解封失败:', error instanceof Error ? error.message : error);
    cached = null;
  }
  return cached;
}

/** 判断某个 apiKey 是否来自内置中转站（用于 _source 标记，不泄漏内容） */
export function isBuiltinRelayKey(apiKey: string): boolean {
  const relay = getBuiltinRelay();
  return Boolean(relay && apiKey && apiKey === relay.apiKey);
}
