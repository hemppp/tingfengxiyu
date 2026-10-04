// ============================================================
// apps/desktop/src/updater/config.ts
// 更新源地址（baseUrl）的持久化。
//
// 契约来源：ADR D14.1 ——
//   持久化位置：`<userData>/updates/config.json`，`{ "baseUrl": "…" }`。
//   **不是** localStorage（主进程需要在渲染进程未起时也能读）。
//   baseUrl 为空字符串 ⇒ 更新功能关闭；首启默认 `''`。
// ============================================================

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

export interface UpdaterConfig {
  baseUrl: string;
}

/** 读取配置；文件缺失 / 损坏 / 非法一律回落到 `{ baseUrl: '' }`（不抛）。 */
export async function readConfig(configPath: string): Promise<UpdaterConfig> {
  try {
    const raw = await fsp.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { baseUrl?: unknown }).baseUrl === 'string') {
      return { baseUrl: (parsed as { baseUrl: string }).baseUrl };
    }
    return { baseUrl: '' };
  } catch {
    return { baseUrl: '' };
  }
}

/**
 * 写入配置（原子写：先写 `.tmp` 再 rename，避免半截文件）。
 * 目录不存在时自动创建。
 */
export async function writeConfig(configPath: string, config: UpdaterConfig): Promise<void> {
  const dir = path.dirname(configPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify({ baseUrl: config.baseUrl }, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, configPath);
}

/**
 * 规范化 baseUrl：去掉尾随 `/`，允许空串。
 * 便于 `${baseUrl}/manifest.json` 与相对 `url` 的解析。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '');
}

/**
 * 校验更新源协议：**必须是 `http:` 或 `https:`**（ADR D14.2 冻结：
 * 「更新源必须是 http: 或 https:；其他协议拒绝」）。
 * 空串视为「关闭」，返回 null（合法）。
 */
export function validateBaseUrl(baseUrl: string): { ok: true } | { ok: false; error: string } {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized === '') return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, error: `更新源地址不是合法 URL: ${normalized}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `更新源地址协议不被支持（仅允许 http: / https:）: ${parsed.protocol}` };
  }
  return { ok: true };
}

/** `${baseUrl}/manifest.json`（ADR D14.1：清单地址 = `${baseUrl}/manifest.json`）。 */
export function manifestUrlOf(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/manifest.json`;
}

/**
 * 解析清单里的 `url` 字段：允许**相对路径**（相对 baseUrl 解析）或绝对 `http(s):` URL
 * （ADR D14.2 冻结）。其他协议拒绝。
 */
export function resolveArtifactUrl(baseUrl: string, artifactUrl: string): string {
  const raw = String(artifactUrl ?? '').trim();
  if (raw === '') throw new Error('manifest 中的 url 为空');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`url 协议不被支持（仅允许 http: / https:）: ${parsed.protocol}`);
    }
    return parsed.toString();
  }
  const base = `${normalizeBaseUrl(baseUrl)}/`;
  const resolved = new URL(raw.replace(/^\/+/, ''), base);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new Error(`url 协议不被支持（仅允许 http: / https:）: ${resolved.protocol}`);
  }
  return resolved.toString();
}