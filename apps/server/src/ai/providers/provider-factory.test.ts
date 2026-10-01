// ============================================================
// provider-factory 生成参数透传回归
//
// 为什么单列：`temperature / top_p / frequency_penalty / presence_penalty`
// 是 2026-09 新增的「作者可调」字段，链路是
//   UI(AIConfigPanel) → POST /api/ai/config(zod 收口) → user_settings →
//   getAIConfig → createOpenAICompatibleProvider 组请求体。
// 这条链路此前**零单测**，最容易在重构里被悄悄打断（字段名写错、默认值覆盖用户值）。
//
// 关键契约（改动前先读）：
//   ① 配置**未设置**这些字段时，**不发** top_p/frequency_penalty/presence_penalty
//      —— 保持与「新增字段之前」完全一致的行为（服务商默认值兜底）。
//   ② temperature 有历史默认值 0.7（配置未设时也发）。
//   ③ 显式 options（如校对门 temperature:0.1）**优先于**配置。
//
// 手法：不真联网。baseUrl 用回环地址（SSRF 默认放行回环），把 global fetch 换掉，
// 捕获真正发出去的请求体来断言。
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getProvider,
  setConfigLoader,
  clearConfigCache,
  clearProviderCache,
  type AIConfig,
} from './provider-factory.js';

/** 每个用例用独立 userId，避免 provider / config 的模块级缓存互相污染 */
let seq = 0;
function freshUser(): string {
  return `test-user-${++seq}`;
}

/** 换掉 global fetch：返回固定成功响应，并捕获请求体 */
function stubFetch(): { body: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { body?: string }) => {
      captured = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return { body: () => captured };
}

/** 注册一个只返回固定配置的 loader（跳过 env / DB） */
function useConfig(userId: string, config: Partial<AIConfig>): void {
  setConfigLoader(userId, async () => ({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    provider: 'openai',
    ...config,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearConfigCache();
  clearProviderCache();
});

describe('provider-factory · 生成参数透传', () => {
  it('配置未设置采样参数时，不发 top_p / frequency_penalty / presence_penalty', async () => {
    const u = freshUser();
    useConfig(u, {}); // 无任何采样参数
    const cap = stubFetch();

    await (await getProvider(u)).chat([{ role: 'user', content: 'hi' }]);

    const b = cap.body();
    expect(b).not.toHaveProperty('top_p');
    expect(b).not.toHaveProperty('frequency_penalty');
    expect(b).not.toHaveProperty('presence_penalty');
    // temperature 保留历史默认 0.7（不能变成 undefined / 不发）
    expect(b.temperature).toBe(0.7);
  });

  it('配置里设置采样参数时，原样透传', async () => {
    const u = freshUser();
    useConfig(u, { temperature: 1.2, topP: 0.9, frequencyPenalty: 0.5, presencePenalty: 0.3 });
    const cap = stubFetch();

    await (await getProvider(u)).chat([{ role: 'user', content: 'hi' }]);

    const b = cap.body();
    expect(b.temperature).toBe(1.2);
    expect(b.top_p).toBe(0.9);
    expect(b.frequency_penalty).toBe(0.5);
    expect(b.presence_penalty).toBe(0.3);
  });

  it('显式 options 优先于配置（校对门 temperature:0.1 不被用户配置覆盖）', async () => {
    const u = freshUser();
    useConfig(u, { temperature: 1.5, topP: 0.9, frequencyPenalty: 0.5 });
    const cap = stubFetch();

    await (await getProvider(u)).chat([{ role: 'user', content: 'hi' }], {
      temperature: 0.1,
      topP: 0.2,
    });

    const b = cap.body();
    expect(b.temperature).toBe(0.1); // 显式值胜出
    expect(b.top_p).toBe(0.2);
    expect(b.frequency_penalty).toBe(0.5); // 未显式传的仍取配置
  });

  it('frequencyPenalty=0 是有效值，必须发出去（不能被 falsy 判断吞掉）', async () => {
    const u = freshUser();
    useConfig(u, { frequencyPenalty: 0 });
    const cap = stubFetch();

    await (await getProvider(u)).chat([{ role: 'user', content: 'hi' }]);

    // 0 是合法惩罚值，语义与「不设」不同；`!= null` 判定保证 0 会发出
    expect(cap.body().frequency_penalty).toBe(0);
  });

  it('每次请求独立组体，不残留上一次的参数', async () => {
    const u = freshUser();
    useConfig(u, { topP: 0.8 });
    const cap = stubFetch();
    const provider = await getProvider(u);

    await provider.chat([{ role: 'user', content: 'a' }], { temperature: 0.1 });
    expect(cap.body().top_p).toBe(0.8);
    expect(cap.body().temperature).toBe(0.1);

    await provider.chat([{ role: 'user', content: 'b' }]);
    // 第二次没传显式 temperature → 回到配置/默认，不残留 0.1
    expect(cap.body().temperature).toBe(0.7);
  });
});
