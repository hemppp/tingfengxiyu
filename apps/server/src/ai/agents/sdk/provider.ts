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
//
// ★ 思维链（reasoning_content）旁路 —— 2026-09-16
//   实测 @openai/agents-openai@0.14.3 的 Chat Completions 适配器
//   **完全不解析 reasoning_content**（整个包 grep "reasoning" 0 命中），
//   所以 SDK 层拿不到推理内容：
//     · sdk/agent.ts 里的 mapReasoning / reasoning_item_created 分支在本通道下是死代码
//     · newItems 里只有 message，没有 reasoning
//   而项目自己的 provider-factory 是解析这个字段的 —— 说明**是 SDK 那一层丢的**。
//   因此这里给 OpenAI client 注入一个**只读旁路 fetch**：把 SSE 流 tee 一份出来
//   扫 reasoning_content，原流原样交回 SDK，主链路（正文 / 工具调用 / 轮次）零改动。
//   实测：截到 104 个分片 / 464 字，同时流式正文与 finalOutput 完全正常。
// ============================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIProvider } from '@openai/agents';
import OpenAI from 'openai';

import { type AIConfig, getAIConfig } from '../../providers/provider-factory.js';

// ============================================================
// 思维链旁路
// ============================================================

/** 本 run 的思维链接收器。用 ALS 而不是全局变量：并发 run 各拿各的，不串台。 */
const thinkingSink = new AsyncLocalStorage<(delta: string) => void>();

/**
 * 排查开关（`NM_DEBUG_THINKING=1`）。
 *
 * 为什么值得留一个：旁路挂不上时的表现是**「思维链一条都没有」且零报错** ——
 * 两行日志能立刻分清是「sink 没注册（ALS 问题）」还是
 * 「响应不是 SSE（调用方忘了 `stream: true`）」，省掉一整轮瞎猜。
 */
const NM_DEBUG = process.env.NM_DEBUG_THINKING === '1';

/**
 * 在「本 run 的思维链接收器」作用域内执行。
 *
 * provider 是按 userId **缓存复用**的，所以接收器不能挂在 provider 上 ——
 * 只能每次请求时从 ALS 现取。不传 sink 时退化成直接执行（零开销）。
 */
export function runWithThinkingSink<T>(
  sink: ((delta: string) => void) | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return sink ? thinkingSink.run(sink, fn) : fn();
}

/**
 * 从一行 SSE `data:` 负载里取 reasoning_content 增量。
 *
 * 抽成纯函数是为了能单测钉住 —— 这段解析在 fetch 旁路里，真机跑才看得到，
 * 没有单测的话改坏了只会表现为「思维链偶尔少一段」。
 *
 * @returns 增量文本；不是 reasoning 增量时返回 null（包括空串）
 */
export function reasoningDeltaOf(payload: string): string | null {
  const p = payload.trim();
  if (!p || p === '[DONE]') return null;
  let j: unknown;
  try {
    j = JSON.parse(p);
  } catch {
    return null; // 中转站偶尔插入非 JSON 的心跳行
  }
  const delta = (j as { choices?: Array<{ delta?: Record<string, unknown> }> })?.choices?.[0]?.delta;
  const rc = delta?.reasoning_content;
  return typeof rc === 'string' && rc.length > 0 ? rc : null;
}

/**
 * 造一个只读旁路 fetch：命中 SSE 响应时 tee 一份扫 reasoning_content。
 *
 * 关键点：
 *   · **没有 sink 就完全不介入**（直接原样返回）—— 其他调用方零开销
 *   · 只对 `text/event-stream` 生效；非流式 JSON 响应原样放行
 *   · 旁路里的异常一律吞掉：它是观测，不许反过来弄坏主链路
 */
export function createTappingFetch(inner: typeof fetch): typeof fetch {
  // ★ 入参类型一律用 Parameters<typeof fetch>：服务端 tsconfig 不含 DOM lib，
  //   RequestInfo 这个名字在这里不存在（RequestInit 有，是 undici 提供的）。
  return async function tappingFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const sink = thinkingSink.getStore();
    const res = (await inner(input as never, init as never)) as unknown as Response;
    // ★ 调试日志必须在 sink 判空**之前**：要区分的正是「sink 没注册」这种情况。
    //   带上请求体形状 —— 排查「模型不吐 reasoning」时，**请求体差异**才是首要嫌疑
    //   （实测：同一个模型，`tools: []` 与带工具的请求行为可能不同）。
    if (NM_DEBUG) {
      const sinkState = sink ? '有' : '无';
      const ct = res.headers?.get?.('content-type') ?? '';
      let shape = '';
      try {
        const raw = String(init?.body ?? '');
        const body = JSON.parse(raw) as Record<string, unknown>;
        const tools = body.tools;
        const msgs = (body.messages ?? []) as Array<{ role?: string; content?: unknown }>;
        const sysLen = msgs.filter((x) => x.role === 'system')
          .reduce((n, x) => n + String(x.content ?? '').length, 0);
        shape = ` model=${String(body.model)}`
          + ` keys=${Object.keys(body).join(',')}`
          + ` msgs=${msgs.length}/sys${sysLen}字/共${raw.length}字`
          + ` tools=${Array.isArray(tools) ? `[${tools.length}]` : 'none'}`;
        // 落盘真实请求体：排查「同模型别的请求吐、这个不吐」时，只有原样重放才说得清。
        // 路径走 tmpdir：桌面端 / Docker 里没有 F: 盘。
        writeFileSync(join(tmpdir(), 'novelmuse-last-sdk-request.json'), raw);
      } catch { /* body 不是 JSON */ }
      console.log(`[thinking-tap] sink=${sinkState} ctype=${ct}${shape}`);
    }
    if (!sink || !res.body) return res;

    const ctype = res.headers?.get?.('content-type') ?? '';
    if (!ctype.includes('event-stream')) return res;

    const [forSdk, forTap] = (res.body as ReadableStream<Uint8Array>).tee();

    // 旁路消费（不 await）：两边都必须被读走，否则 tee 会持续缓冲
    void (async () => {
      const decoder = new TextDecoder();
      const reader = forTap.getReader();
      let buf = '';
      /** 调试用：只打前几帧的 delta 字段名，看清中转站到底发了什么 */
      let seen = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            if (NM_DEBUG && seen++ < 6) {
              try {
                const j = JSON.parse(t.slice(5)) as { choices?: Array<{ delta?: Record<string, unknown> }> };
                console.log('[thinking-tap] delta keys =', Object.keys(j.choices?.[0]?.delta ?? {}).join(','));
              } catch { /* 非 JSON 行 */ }
            }
            const delta = reasoningDeltaOf(t.slice(5));
            if (delta) sink(delta);
          }
        }
      } catch {
        /* 旁路失败不影响主链路：思维链没有就没有 */
      }
    })();

    return new Response(forSdk, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } as typeof fetch;
}

// ============================================================
// Provider
// ============================================================

/**
 * 根据给定的 AIConfig 创建 OpenAI Agents SDK 的 Provider 实例。
 *
 * @param config OpenAI 兼容配置（baseUrl / apiKey / model / provider）
 * @returns OpenAIProvider 实例（使用 Chat Completions API 模式）
 */
export function createSdkProvider(config: AIConfig): OpenAIProvider {
  // 自定义 client：目的是挂上思维链旁路 fetch（见文件头说明）。
  // 代理由 proxy-agent 的 setGlobalDispatcher 落实，这里转调的仍是全局 fetch，
  // 所以走代理的行为与之前完全一致。
  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    fetch: createTappingFetch(globalThis.fetch.bind(globalThis)),
  });

  return new OpenAIProvider({
    openAIClient: client as never,
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
