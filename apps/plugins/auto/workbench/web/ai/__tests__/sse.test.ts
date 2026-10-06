/**
 * AI 对话面板的 SSE 解析单测
 *
 * 覆盖「面板能否真的把后端 /api/ai/chat-stream 的增量吃干净」这条链路里最容易
 * 出错、又最难在浏览器里复现的部分：**网络分包与 SSE 帧边界的错位**。
 *   - 一个帧被拆到多个 chunk（真实 TCP 必现）
 *   - 一个 chunk 里塞多个帧
 *   - 15s 心跳注释行（`: keepalive`）不得被当成数据帧
 *   - 流末尾没有 `\n\n` 的最后一帧必须交付（否则 `done` 丢失、输入框卡在停止态）
 *   - 脏帧丢弃而不是抛错（一次坏帧不能中断整条流）
 *   - CRLF 分隔、多行 data、逐字节喂入
 *
 * ★ 刻意不 mock ReadableStream：被测的就是「字节流 → 事件」的转换，
 *   用假 stream 只会把真实分包行为一起放过。
 */

import { describe, it, expect } from 'vitest';
import { readSseStream, splitFrames, parseFrame } from '../sse';

const encoder = new TextEncoder();

/** 把若干文本片段做成一个已关闭的字节流（模拟服务端逐段写出 + 客户端逐段收到）。 */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** 跑完整条流，收集每个事件的数据载荷。 */
async function collect(chunks: readonly string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const frame of readSseStream(streamOf(chunks))) out.push(frame.data);
  return out;
}

describe('readSseStream · 帧边界', () => {
  it('单帧被网络拆到两个 chunk 也能合成一个事件', async () => {
    const out = await collect(['data: {"chunk":"推进', '剧情"}\n\n']);
    expect(out).toHaveLength(1);
    expect(out[0]?.chunk).toBe('推进剧情');
  });

  it('一个 chunk 里多个帧按顺序全部交付，心跳注释被忽略', async () => {
    const out = await collect([': keepalive\n\ndata: {"chunk":"a"}\n\ndata: {"chunk":"b"}\n\n']);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.chunk).join('')).toBe('ab');
  });

  it('逐字节喂入（最坏分包）也不丢帧', async () => {
    const raw = 'data: {"thinking":"逐字"}\n\ndata: {"chunk":"入场"}\n\ndata: {"done":true}\n\n';
    const out = await collect([...raw]);
    expect(out).toHaveLength(3);
    expect(out[2]?.done).toBe(true);
  });

  it('流结束时最后一帧没有 \\n\\n 也要交付（done 帧不能丢）', async () => {
    const out = await collect(['data: {"thinking":"半个思考"}\n\ndata: {"done":true}']);
    expect(out).toHaveLength(2);
    expect(out[1]?.done).toBe(true);
  });

  it('CRLF 分隔（部分反向代理会改写行尾）可解析', async () => {
    const out = await collect(['data: {"chunk":"crlf"}\r\n\r\n']);
    expect(out).toHaveLength(1);
    expect(out[0]?.chunk).toBe('crlf');
  });

  it('多行 data: 帧按 \\n 拼接后解析', async () => {
    const out = await collect(['data: {"chunk":\ndata: "多行"}\n\n']);
    expect(out).toHaveLength(1);
    expect(out[0]?.chunk).toBe('多行');
  });

  it('纯注释 / 空片段不产生事件', async () => {
    expect(await collect([': keepalive\n\n', '\n\n', ''])).toHaveLength(0);
  });
});

describe('readSseStream · 载荷容错', () => {
  it('非法 JSON 帧被丢弃，且不影响后续帧', async () => {
    const out = await collect(['data: {不是 JSON\n\ndata: {"chunk":"后续正常"}\n\n']);
    expect(out).toHaveLength(1);
    expect(out[0]?.chunk).toBe('后续正常');
  });

  it('身份帧与工具帧的字段可被面板读取', async () => {
    const out = await collect([
      'data: {"agent":{"id":"chat","name":"对话智能体","short":"我","color":"#5B7CFA","mode":"chat"}}\n\n',
      'data: {"tool_call":{"function":{"name":"create_character"}}}\n\n',
      'data: {"error":true,"message":"流式对话失败"}\n\n',
    ]);
    expect(out[0]?.agent).toMatchObject({ id: 'chat', name: '对话智能体' });
    expect(out[1]?.tool_call).toMatchObject({ function: { name: 'create_character' } });
    expect(out[2]).toMatchObject({ error: true, message: '流式对话失败' });
  });
});

describe('splitFrames / parseFrame · 纯函数边界', () => {
  it('splitFrames 把不完整尾巴留在 rest 里', () => {
    expect(splitFrames('data: 1\n\ndata: 2')).toEqual({ frames: ['data: 1'], rest: 'data: 2' });
  });

  it('parseFrame 忽略注释行与数组载荷', () => {
    expect(parseFrame(': keepalive')).toBeNull();
    expect(parseFrame('data: [1,2]')).toBeNull();
  });
});
