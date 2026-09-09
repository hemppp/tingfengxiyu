// ============================================================
// AI Provider 工厂 - 统一管理 OpenAI / Ollama / Custom 提供商
// ============================================================

import { CircuitBreaker } from '../../lib/circuit-breaker.js';
import { assertSafeOutboundUrl } from '../../lib/ssrf-guard.js';
import { getBuiltinRelay } from '../../lib/builtin-relay.js';

// ---- 类型定义 ----

/** AI 提供商类型 */
export type AIProviderType = 'openai' | 'ollama' | 'custom';

/** 统一 AI 配置 */
export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AIProviderType;
}

/** Chat 消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息携带的工具调用（流式累积组装） */
  tool_calls?: ToolCall[];
  /** tool 角色消息携带的对应 tool_call_id */
  tool_call_id?: string;
  /** tool 角色消息携带的工具名 */
  name?: string;
}

/** 工具调用（OpenAI 兼容格式） */
export interface ToolCall {
  /** 工具调用 ID（由 LLM 生成） */
  id: string;
  /** 固定值 'function' */
  type: 'function';
  /** 函数调用详情 */
  function: {
    name: string;
    /** JSON 字符串形式的参数 */
    arguments: string;
  };
}

/** 工具定义（OpenAI function calling 格式） */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Chat 选项 */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 可用工具列表。传入后 LLM 可选择调用工具 */
  tools?: ToolDefinition[];
  /** 工具调用策略：'auto'（默认）| 'none' | 'required' */
  toolChoice?: 'auto' | 'none' | 'required';
}

/** 流式 chunk：区分正文内容和思考过程（reasoning_content） */
export interface StreamChunk {
  content?: string;
  thinking?: string;
  /** 流式累积的工具调用片段（增量） */
  tool_calls_delta?: ToolCallDelta;
}

/** 流式工具调用增量片段 */
export interface ToolCallDelta {
  /** 工具调用索引（用于累积组装） */
  index: number;
  id?: string;
  /** function.name 的增量（通常首次出现完整） */
  name?: string;
  /** function.arguments 的增量（分片传输，需拼接） */
  arguments?: string;
}

/** AI Provider 接口 */
export interface AIProvider {
  /** 非流式聊天，返回完整响应。signal 用于接收外部取消信号（如用户关闭浏览器） */
  chat(messages: ChatMessage[], options?: ChatOptions, signal?: AbortSignal): Promise<string>;
  /** 流式聊天，返回 AsyncGenerator<StreamChunk> */
  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk>;
}

// ---- 默认配置 ----

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

// ---- 错误类 ----

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

// ---- 工具函数 ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 从环境变量加载配置；无可用 Key 时整体回退到内置公益中转站 */
function loadConfigFromEnv(): AIConfig {
  const provider = (process.env.AI_PROVIDER || 'openai') as AIProviderType;

  let baseUrl: string;
  let apiKey: string;
  let model: string;

  switch (provider) {
    case 'ollama':
      baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
      apiKey = 'ollama'; // Ollama 不需要 API key
      model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
      break;
    case 'custom':
      baseUrl = process.env.CUSTOM_AI_BASE_URL || 'https://api.openai.com/v1';
      apiKey = process.env.CUSTOM_AI_API_KEY || '';
      model = process.env.CUSTOM_AI_MODEL || 'gpt-4-turbo';
      break;
    case 'openai':
    default:
      baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      apiKey = process.env.OPENAI_API_KEY || '';
      model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
      break;
  }

  return applyBuiltinRelayFallback({ baseUrl, apiKey, model, provider });
}

/**
 * 内置公益中转站原子回退：配置无 apiKey 时整体换用内置站
 * （baseUrl/apiKey/model 三者必须同源，避免跨源错配导致鉴权失败）。
 * 有 Key 的配置（用户自配 / 环境变量 / Ollama）原样返回。
 */
export function applyBuiltinRelayFallback(config: AIConfig): AIConfig {
  if (config.apiKey) return config;
  const relay = getBuiltinRelay();
  if (!relay) return config;
  return { ...config, baseUrl: relay.baseUrl, apiKey: relay.apiKey, model: relay.model };
}

/**
 * 模块级配置缓存：按 userId 索引，避免跨用户 API Key 泄漏。
 * 原实现使用单一全局 cachedConfig/cachedProvider，并发请求会互相覆盖 loader，
 * 导致用户 A 的请求可能使用用户 B 的 apiKey。改为按 userId 隔离的 Map。
 */
const configCache = new Map<string, AIConfig>();
export const configLoaders = new Map<string, () => Promise<AIConfig>>();
const DEFAULT_KEY = '__default__';

/**
 * 注册自定义配置加载器（如从数据库读取）。
 * @param userId 用户 ID；同一用户的 loader 会覆盖旧值
 */
export function setConfigLoader(userId: string, loader: () => Promise<AIConfig>): void {
  configLoaders.set(userId, loader);
  configCache.delete(userId);
  providerCache.delete(userId);
}

/** 获取 AI 配置（支持自定义加载器，回退到环境变量） */
export async function getAIConfig(userId?: string): Promise<AIConfig> {
  const key = userId ?? DEFAULT_KEY;
  const cached = configCache.get(key);
  if (cached) return cached;

  let config: AIConfig;
  const loader = configLoaders.get(key);
  if (loader) {
    config = await loader();
  } else {
    config = loadConfigFromEnv();
  }

  // 规范化 baseUrl，确保以 /v1 结尾（避免端点拼接错误）
  config.baseUrl = normalizeBaseUrlV1(config.baseUrl);

  // C8：SSRF 出站守卫——用户可控 baseUrl 指向内网/保留地址时直接拒绝。
  // 覆盖 chat / chatStream / models 探测 / config 测试等全部经 getAIConfig 的出站路径。
  assertSafeOutboundUrl(config.baseUrl);

  configCache.set(key, config);

  return config;
}

/** 清除配置缓存（配置变更后调用）。不传 userId 清除所有用户缓存。 */
export function clearConfigCache(userId?: string): void {
  if (userId) {
    configCache.delete(userId);
  } else {
    configCache.clear();
  }
}

/**
 * 规范化 OpenAI 兼容 API 的 baseUrl。
 *
 * 中转站 / OpenAI 兼容服务的 baseUrl 形态多样：
 *   - https://api.openai.com             → 需要补 /v1
 *   - https://api.deepseek.com           → 需要补 /v1
 *   - https://api.openai.com/v1          → 已含版本号，不补
 *   - https://api.xxx.com/relay/v1       → 已含路径前缀+版本号，不补
 *   - https://api.xxx.com/openai/v1      → 已含路径前缀+版本号，不补
 *   - http://localhost:11434             → Ollama 裸地址，需补 /v1
 *   - http://localhost:11434/v1          → 已含 /v1，不补
 *   - http://localhost:11434/api         → Ollama 原生路径，不补
 *
 * 规则：仅当 URL 是裸域名（无路径或路径仅为 /）时才补 /v1；
 *      路径以 /v\d+ 或 /api 结尾时直接保留；其他路径（如 /openai、/relay）
 *      也尊重用户输入，避免把 /relay/v1 错误补成 /relay/v1/v1。
 */
function normalizeBaseUrlV1(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;

  // 尝试按 URL 解析，区分 hostname 和 pathname
  try {
    const u = new URL(trimmed);
    const path = u.pathname;
    // 裸域名（路径为空或仅 /）：补 /v1
    if (path === '' || path === '/') {
      return `${trimmed}/v1`;
    }
    // 路径以 /v\d+ 结尾：保留
    if (/\/v\d+$/i.test(path)) {
      return trimmed;
    }
    // 路径以 /api 结尾（Ollama 原生）：保留
    if (/\/api$/i.test(path)) {
      return trimmed;
    }
    // 其他路径（/openai、/relay、/proxy 等）：尊重用户输入，不补 /v1
    return trimmed;
  } catch {
    // 非 URL（如 localhost:11434），按字符串处理
    if (/\/v\d+$/i.test(trimmed) || /\/api$/i.test(trimmed)) {
      return trimmed;
    }
    return `${trimmed}/v1`;
  }
}

// ---- SSE → JSON 解析（兼容中转站对非流式请求返回 SSE 格式的情况）----

/**
 * 将 SSE 格式文本（data: {...}\n\ndata: {...}）解析为 JSON 对象。
 * 取第一个 data 行的 JSON 作为结果（非流式请求通常只有一行）。
 */
function parseSSEAsJson<T>(text: string): T {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr && jsonStr !== '[DONE]') {
        return JSON.parse(jsonStr) as T;
      }
    }
  }
  // fallback：直接 JSON.parse（可能不是真正的 SSE）
  return JSON.parse(text) as T;
}

// ---- Fetch-based Provider 实现 ----

/**
 * 基于 OpenAI 兼容 API 的通用 Provider
 * 适用于 OpenAI、兼容 API、自定义 endpoint
 */
function createOpenAICompatibleProvider(config: AIConfig): AIProvider {
  const { baseUrl, apiKey, model, provider } = config;

  /** 发送非流式请求（带重试+超时）。signal 可接收外部取消信号。 */
  async function chat(messages: ChatMessage[], options?: ChatOptions, signal?: AbortSignal): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // 外部信号已取消：不再重试，直接抛出 AbortError
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      // 合并外部取消信号（用户关闭浏览器等）与内部超时信号：
      // 外部 signal abort 时一并中止内部 controller
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      try {
        const requestBody: Record<string, unknown> = {
          model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2048,
        };
        if (options?.tools && options.tools.length > 0) {
          requestBody.tools = options.tools;
          requestBody.tool_choice = options.toolChoice ?? 'auto';
        }
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error(`[AI Provider] HTTP ${response.status} 错误响应:`, errText.slice(0, 500));
          const err = new AIProviderError(
            `AI API 错误 ${response.status}`,
            response.status,
            errText,
          );
          if (response.status >= 400 && response.status < 500) throw err;
          throw err;
        }

        interface ChatCompletionResponse {
          choices?: {
            message?: {
              content?: string | null;
              tool_calls?: Array<{
                id: string;
                type: 'function';
                function: { name: string; arguments: string };
              }>;
            };
          }[];
        }

        // 兼容中转站对非流式请求返回 SSE 格式（data: {...}）的情况
        const contentType = response.headers.get('content-type') ?? '';
        const rawText = await response.text();
        let data: ChatCompletionResponse;
        if (contentType.includes('text/event-stream') || rawText.trimStart().startsWith('data:')) {
          data = parseSSEAsJson<ChatCompletionResponse>(rawText);
        } else {
          data = JSON.parse(rawText) as ChatCompletionResponse;
        }
        const message = data.choices?.[0]?.message;
        // tool_calls 模式下 content 可能为 null，此时返回空字符串
        const content = message?.content ?? '';
        return content.trim();
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        lastError = err instanceof Error ? err : new Error(String(err));

        // 外部信号取消：不重试，抛出 AbortError 供上层识别（如网关返回 aborted 响应）
        if (signal?.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }

        if (
          err instanceof AIProviderError && err.statusCode !== undefined && err.statusCode < 500
        ) {
          throw err;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          throw new AIProviderError('AI 请求超时');
        }

        if (attempt >= MAX_RETRIES) throw lastError;

        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[AI Provider] 请求失败，${delayMs}ms 后重试 (${attempt + 1}/${MAX_RETRIES}):`,
          lastError.message,
        );
        await sleep(delayMs);
      }
    }

    throw lastError || new AIProviderError('AI 请求失败');
  }

  /** 发送流式请求（不重试 — 一旦已 yield 内容，重试会导致重复输出） */
  async function* chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // 流式接口不重试：一旦已向客户端 yield 了部分内容，重试会从头开始 yield，
    // 导致前端显示重复内容。失败由上层（断路器/用户手动重试）处理。
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    // 外部 signal abort 时透传给内部 controller。
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      const requestBody: Record<string, unknown> = {
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
        stream: true,
      };
      if (options?.tools && options.tools.length > 0) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = options.toolChoice ?? 'auto';
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`[AI Provider] HTTP ${response.status} 错误响应:`, errText.slice(0, 500));
        throw new AIProviderError(
          `AI API 错误 ${response.status}`,
          response.status,
          errText,
        );
      }

      if (!response.body) {
        throw new AIProviderError('响应体为空');
      }

      console.log(`[AI Provider Stream] response ok, Content-Type=${response.headers.get('content-type')}, model=${model}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalBytes = 0;
      let yieldedCount = 0;
      let firstChunkLogged = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const decoded = decoder.decode(value, { stream: true });
        totalBytes += decoded.length;

        // 记录第一个 chunk 的原始内容，用于诊断 AI 中转站是否返回 SSE 格式
        if (!firstChunkLogged) {
          console.log(`[AI Provider Stream] 首个chunk(前200字符):`, decoded.slice(0, 200));
          firstChunkLogged = true;
        }

        buffer += decoded;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') {
            console.log(`[AI Provider Stream] 流结束, 总字节=${totalBytes}, yield次数=${yieldedCount}`);
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: {
                delta?: {
                  content?: string | null;
                  reasoning_content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    type?: 'function';
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }[];
            };
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              yieldedCount++;
              yield { thinking: delta.reasoning_content };
            }
            if (delta?.content) {
              yieldedCount++;
              yield { content: delta.content };
            }
            // ★ 解析工具调用增量（流式分片，由上层累积组装）
            if (delta?.tool_calls && delta.tool_calls.length > 0) {
              for (const tc of delta.tool_calls) {
                if (tc.index === undefined) continue;
                yield {
                  tool_calls_delta: {
                    index: tc.index,
                    id: tc.id,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments,
                  },
                };
                yieldedCount++;
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      console.log(`[AI Provider Stream] 流正常结束(reader done), 总字节=${totalBytes}, yield次数=${yieldedCount}`);
    } catch (err: unknown) {
      // 4xx 错误直接抛出（如鉴权失败）
      if (err instanceof AIProviderError && err.statusCode !== undefined && err.statusCode < 500) {
        throw err;
      }
      // 区分外部取消 vs 内部超时
      if (err instanceof Error && err.name === 'AbortError') {
        if (signal?.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        throw new AIProviderError('AI 流式请求超时');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  return { chat, chatStream };
}

// ---- 断路器包裹 ----
// 用通用 CircuitBreaker 包裹 Provider，防止 LLM 下游慢/挂时拖垮请求线程（雪崩）。
// 仅把"真正的故障"（5xx / 超时 / 网络错误）计入熔断；
// 4xx（如鉴权失败）与用户主动取消（AbortError）不计入，避免误熔断。

function isBreakerFailure(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return false;
  if (err instanceof AIProviderError && err.statusCode !== undefined && err.statusCode < 500) {
    return false;
  }
  return true;
}

function withBreaker(provider: AIProvider, name: string): AIProvider {
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    openToHalfOpenMs: 30_000,
    volumeThreshold: 5,
    isFailure: isBreakerFailure,
  });

  breaker.onStateChange((s) => {
    if (s === 'open') {
      console.warn(`[AI CircuitBreaker] ${name} 已熔断，冷却期内对该 Provider 的请求将快速失败`);
    } else if (s === 'closed') {
      console.warn(`[AI CircuitBreaker] ${name} 已恢复`);
    }
  });

  return {
    chat: (messages, options, signal) =>
      breaker
        .fire(() => provider.chat(messages, options, signal), signal)
        .catch((err) => {
          if (err instanceof Error && err.message === 'Circuit breaker is open') {
            throw new AIProviderError('AI 服务暂时不可用（熔断器已打开），请稍后重试', 503);
          }
          throw err;
        }),
    chatStream: async function* (messages, options, signal) {
      if (!breaker.canRun()) {
        throw new AIProviderError('AI 服务暂时不可用（熔断器已打开），请稍后重试', 503);
      }
      yield* provider.chatStream(messages, options, signal);
    },
  };
}

// ---- Provider 工厂 ----

/** 模块级 Provider 缓存：按 userId 索引，与 configCache 对应 */
const providerCache = new Map<string, AIProvider>();

/** 获取 Provider 实例（按 userId 缓存，避免跨用户泄漏） */
export async function getProvider(userId?: string): Promise<AIProvider> {
  const key = userId ?? DEFAULT_KEY;
  const cached = providerCache.get(key);
  if (cached) return cached;

  const config = await getAIConfig(userId);
  const provider = withBreaker(createOpenAICompatibleProvider(config), key);
  providerCache.set(key, provider);
  return provider;
}

/** 清除 Provider 缓存（配置变更后调用）。不传 userId 清除所有用户缓存。 */
export function clearProviderCache(userId?: string): void {
  if (userId) {
    providerCache.delete(userId);
  } else {
    providerCache.clear();
  }
}