// ============================================================
// OpenAI Agents SDK Provider 桥接层
//
// 将项目现有的 AIConfig（OpenAI 兼容配置）转换为 OpenAI Agents SDK
// 使用的 OpenAIProvider。
//
// 关键兼容性保障：
//   项目支持 OpenAI / Ollama / DeepSeek / 自定义中转站，这些服务
//   都只暴露 /chat/completions 端点，不支持 OpenAI 的 Responses API。
//   因此这里强制设置 useResponses: false，让 SDK 走 Chat Completions
//   通道，避免对中转站/Ollama 调用 /responses 时返回 404。
//
// 注意：
//   - tracing 不在此处禁用，而在 run 时通过 RunOptions.tracingDisabled
//     控制，避免影响其他可能需要 tracing 的路径。
//   - provider 实例按 userId 缓存，与 provider-factory 的缓存策略一致，
//     避免跨用户 API Key 泄漏。
// ============================================================

import { OpenAIProvider } from '@openai/agents';

import { type AIConfig, getAIConfig } from '../../providers/provider-factory.js';

/**
 * 根据给定的 AIConfig 创建 OpenAI Agents SDK 的 Provider 实例。
 *
 * @param config OpenAI 兼容配置（baseUrl / apiKey / model / provider）
 * @returns OpenAIProvider 实例（使用 Chat Completions API 模式）
 */
export function createSdkProvider(config: AIConfig): OpenAIProvider {
  return new OpenAIProvider({
    // 项目里的字段名是 baseUrl，SDK 期望 baseURL，这里做一次映射
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    // ★ 强制使用 Chat Completions API：
    //   Ollama / DeepSeek / 自定义中转站均不支持 Responses API，
    //   若开启会请求 /responses 端点导致 404 或格式错误。
    useResponses: false,
  });
}

// ---- 按 userId 缓存 Provider 实例 ----

/** 模块级 SDK Provider 缓存：按 userId 索引，避免重复创建实例 */
const sdkProviderCache = new Map<string, OpenAIProvider>();

/** 默认缓存键（未传入 userId 时使用），与 provider-factory 保持一致 */
const DEFAULT_KEY = '__default__';

/**
 * 获取 SDK Provider 实例（按 userId 缓存）。
 *
 * 内部调用 getAIConfig 获取配置后调用 createSdkProvider。
 * 同一 userId 的实例会被缓存，避免重复构造 OpenAIProvider。
 *
 * @param userId 用户 ID（可选）；未传时使用默认配置
 * @returns OpenAIProvider 实例
 */
export async function getSdkProvider(userId?: string): Promise<OpenAIProvider> {
  const key = userId ?? DEFAULT_KEY;
  const cached = sdkProviderCache.get(key);
  if (cached) return cached;

  const config = await getAIConfig(userId);
  const provider = createSdkProvider(config);
  sdkProviderCache.set(key, provider);
  return provider;
}

/**
 * 清除 SDK Provider 缓存（配置变更后调用）。
 *
 * @param userId 指定用户 ID 时仅清除该用户的缓存；
 *               不传时清除所有用户的缓存。
 */
export function clearSdkProviderCache(userId?: string): void {
  if (userId) {
    sdkProviderCache.delete(userId);
  } else {
    sdkProviderCache.clear();
  }
}
