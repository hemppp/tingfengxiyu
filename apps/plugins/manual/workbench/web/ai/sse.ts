// ============================================================
// SSE 帧解析 —— `POST /api/ai/chat-stream` 的 `data:` 帧 → 事件对象
//
// ★ 归属：本文件是 **manual（手写台）自有**实现，与同目录的 `AiChatPanel.tsx` 配套。
//   迁移来源：`apps/plugins/auto/workbench/web/ai/sse.ts`（逐行同源，仅本头注不同）。
//   隔离口径：手写模块的组件只作用在手写模式，且不反向引用 auto（AI 写作）模块。
//
// 为什么单独一个文件：这是 AI 面板里**唯一**有独立逻辑、又不依赖
// React/DOM 的部分。抽成纯函数后才能脱离浏览器跑断言（Node 24 可直
// 接执行 .ts），否则「分包边界」这类最容易错的逻辑只能靠肉眼看流。
//
// 协议真源：apps/server/src/modules/ai.ts:839-857
//   · 每个事件一帧：`data: <JSON>\n\n`
//   · 心跳是注释行：`: keepalive\n\n`（没有 data:，必须忽略，否则
//     每次心跳都会被当成一次「空事件」误触发状态变更）
//   · 事件 JSON 形状：{thinking} | {chunk} | {agent}
//                     | {tool_call} | {tool_result}
//                     | {done:true} | {error:true,message}
//
// ★ 分包边界（本文件存在的理由）：切分单位是**字节流**，不是消息。
//   一个 `data:` 帧可能被 TCP 拆到两个 chunk（半截 JSON），一个 chunk
//   也可能塞着多个帧 ⇒ 必须缓冲到 `\n\n` 再解析；逐 chunk JSON.parse
//   在真实网络下必然偶发丢字/抛错。
// ============================================================

export interface SseFrame {
  /** 解析后的事件对象（服务端 `send(obj)` 的原样回放） */
  data: Record<string, unknown>;
  /** 原始帧文本（JSON 非法时保留，便于诊断） */
  raw: string;
}

/**
 * 从缓冲文本里切出「已完整的帧」。
 * 返回值第二项是**尚未遇到分隔符的尾巴**，必须回填到下一次 read。
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((p) => p.trim().length > 0), rest };
}

/**
 * 单个帧文本 → 事件对象；非 data: 帧（心跳注释 / 空帧）返回 null。
 * JSON 非法时**丢弃而不是抛错** —— 一次脏帧不该掐断整条流。
 */
export function parseFrame(frame: string): SseFrame | null {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    // `:` 注释行与 event:/id:/retry: 一律忽略（本端点不使用这些字段）
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { data: parsed as Record<string, unknown>, raw };
  } catch {
    return null;
  }
}

/** 读 fetch Response.body（字节流）→ 逐帧 yield */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const f of frames) {
        const parsed = parseFrame(f);
        if (parsed) yield parsed;
      }
    }
    // 流结束：flush 解码器残留 + 处理最后一帧（服务端正常会带 \n\n，
    // 但被代理截断的最后半帧也要尽力交付，否则末段文字会丢）
    buffer += decoder.decode();
    for (const f of splitFrames(`${buffer}\n\n`).frames) {
      const parsed = parseFrame(f);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 消费方提前退出（用户点「停止」）时锁已随 abort 释放，忽略
    }
  }
}
