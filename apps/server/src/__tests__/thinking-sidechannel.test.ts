// ============================================================
// 思维链旁路（reasoning_content）单测
//
// 为什么必须有：这段代码在 **fetch 旁路**里，真机才跑得到 —— 改坏了的表现是
// 「思维链偶尔少一段 / 少一整条」，没有任何报错。所以解析与转发都要在这里钉住。
//
// 背景：@openai/agents-openai@0.14.3 的 Chat Completions 适配器不解析 reasoning_content，
//      SDK 层拿不到，只能在 provider 的 fetch 上做只读旁路（见 sdk/provider.ts 文件头）。
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { reasoningDeltaOf, createTappingFetch, runWithThinkingSink } from '../ai/agents/sdk/provider.js';

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe('reasoningDeltaOf —— SSE data 行解析', () => {
  it('取出 reasoning_content 增量', () => {
    expect(reasoningDeltaOf('{"choices":[{"delta":{"reasoning_content":"先看"}}]}')).toBe('先看');
  });

  it('正文 delta 不算思维链', () => {
    expect(reasoningDeltaOf('{"choices":[{"delta":{"content":"正文"}}]}')).toBeNull();
  });

  it('reasoning_content 为空串时返回 null（不产生空分片）', () => {
    expect(reasoningDeltaOf('{"choices":[{"delta":{"reasoning_content":""}}]}')).toBeNull();
  });

  it('[DONE] 与空行返回 null', () => {
    expect(reasoningDeltaOf('[DONE]')).toBeNull();
    expect(reasoningDeltaOf('')).toBeNull();
    expect(reasoningDeltaOf('   ')).toBeNull();
  });

  it('非 JSON 行（中转站心跳）不抛错，返回 null', () => {
    expect(reasoningDeltaOf('this is not json')).toBeNull();
    expect(() => reasoningDeltaOf('{')).not.toThrow();
  });

  it('choices 缺失/为空时返回 null', () => {
    expect(reasoningDeltaOf('{"usage":{"total_tokens":1}}')).toBeNull();
    expect(reasoningDeltaOf('{"choices":[]}')).toBeNull();
  });

  it('reasoning_content 不是字符串时返回 null', () => {
    expect(reasoningDeltaOf('{"choices":[{"delta":{"reasoning_content":123}}]}')).toBeNull();
  });
});

describe('createTappingFetch —— 只读旁路', () => {
  /** 等条件成立（旁路是后台消费，不阻塞主链路） */
  async function waitFor(fn: () => boolean, ms = 1000) {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('等待超时');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  function sseResponse(body: string) {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('把 reasoning 增量推给 sink，同时**原样**把正文流交回调用方', async () => {
    const body =
      ': keepalive\n\n'
      + sse({ choices: [{ delta: { reasoning_content: '先看' } }] })
      + sse({ choices: [{ delta: { reasoning_content: '再想' } }] })
      + sse({ choices: [{ delta: { content: '正文' } }] })
      + 'data: [DONE]\n\n';

    const inner = vi.fn(async () => sseResponse(body));
    const fetched = createTappingFetch(inner as unknown as typeof fetch);

    const got: string[] = [];
    const res = await runWithThinkingSink((d) => got.push(d), () =>
      fetched('http://example.com/v1/chat/completions' as never));

    // 主链路：拿到的必须是完整原文（少一个字节都会让 SDK 解析失败）
    const passthrough = await res.text();
    expect(passthrough).toBe(body);

    await waitFor(() => got.length === 2);
    expect(got).toEqual(['先看', '再想']);
  });

  it('没有 sink 时完全不介入：原响应对象直接返回', async () => {
    const original = sseResponse(sse({ choices: [{ delta: { reasoning_content: '不该被截' } }] }));
    const inner = vi.fn(async () => original);
    const fetched = createTappingFetch(inner as unknown as typeof fetch);

    const res = await fetched('http://example.com/v1/chat/completions' as never);
    expect(res).toBe(original); // 同一个对象，说明连 tee 都没做
  });

  it('非 SSE 响应（普通 JSON）原样返回', async () => {
    const original = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    const inner = vi.fn(async () => original);
    const fetched = createTappingFetch(inner as unknown as typeof fetch);

    const res = await runWithThinkingSink(() => { /* 永不触发 */ }, () =>
      fetched('http://example.com/v1/chat/completions' as never));
    expect(res).toBe(original);
  });

  it('跨多个 chunk 被切断的 SSE 行也能拼回来（分片边界不丢字）', async () => {
    const body = sse({ choices: [{ delta: { reasoning_content: '甲' } }] });
    const bytes = new TextEncoder().encode(body);
    // 切成 3 段，正好切在 JSON 中间
    const cuts = [Math.floor(bytes.length / 3), Math.floor((bytes.length * 2) / 3)];
    const parts = [bytes.slice(0, cuts[0]), bytes.slice(cuts[0], cuts[1]), bytes.slice(cuts[1])];

    const inner = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(c) { for (const p of parts) c.enqueue(p); c.close(); },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    const fetched = createTappingFetch(inner as unknown as typeof fetch);

    const got: string[] = [];
    const res = await runWithThinkingSink((d) => got.push(d), () =>
      fetched('http://example.com/v1/chat/completions' as never));
    expect(await res.text()).toBe(body);
    await waitFor(() => got.length === 1);
    expect(got).toEqual(['甲']);
  });
});

describe('runWithThinkingSink —— 作用域与并发隔离', () => {
  it('sink 在作用域内的异步链路里可见（旁路就是靠它取接收器）', async () => {
    const seen: string[] = [];
    const fetched = createTappingFetch(
      (async () => new Response(
        sse({ choices: [{ delta: { reasoning_content: '甲' } }] }),
        { headers: { 'content-type': 'text/event-stream' } },
      )) as unknown as typeof fetch,
    );
    await runWithThinkingSink((d) => seen.push(d), () =>
      fetched('http://example.com/v1/chat/completions' as never));
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toEqual(['甲']);
  });

  it('两个并发 run 各拿各的 sink，不串台', async () => {
    const a: string[] = [];
    const b: string[] = [];
    const makeFetched = (word: string) => createTappingFetch(
      (async () => new Response(
        sse({ choices: [{ delta: { reasoning_content: word } }] }),
        { headers: { 'content-type': 'text/event-stream' } },
      )) as unknown as typeof fetch,
    );
    await Promise.all([
      runWithThinkingSink((d) => a.push(d), () => makeFetched('甲')('http://x/v1' as never)),
      runWithThinkingSink((d) => b.push(d), () => makeFetched('乙')('http://x/v1' as never)),
    ]);
    await new Promise((r) => setTimeout(r, 150));
    expect(a).toEqual(['甲']);
    expect(b).toEqual(['乙']);
  });

  it('没有 sink 时照常执行并返回结果', async () => {
    await expect(runWithThinkingSink(undefined, async () => 42)).resolves.toBe(42);
  });
});
