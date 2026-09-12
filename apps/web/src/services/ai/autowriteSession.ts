// ============================================================
// 设计讨论会话 —— 前端 SSE 客户端
//
// 对接插件路由 POST /api/plugins/autowrite/session。
// 与 /api/ai/chat-stream 不同：那边是「一个代理逐字说话」，
// 这边是「多个角色各说一段」—— 所以事件里带 agent 身份，不是裸 chunk。
//
// 事件：
//   { type:'phase', label }      正在做什么（显示在输入框上方）
//   { type:'turn', agent, ... }  某个角色的完整发言
//   { type:'conclusion', text }  收敛出的本章结论
//   { type:'error' | 'done' }
// ============================================================

import { getToken, getCurrentProjectId } from '../api/apiClient';
import { forEachSSEDataLine } from './sseStream';

export interface SessionTurn {
  type: 'turn';
  agent: string;
  name: string;
  color: string;
  short: string;
  text: string;
  meta?: string;
}

export type SessionEvent =
  | { type: 'phase'; label: string }
  | SessionTurn
  | { type: 'conclusion'; text: string }
  /** 写作官产出的本章正文 —— 落在正文方块里；revision 0 = 初稿，≥1 = 第 N 次重写 */
  | { type: 'draft'; text: string; revision: number }
  /** 意图复核结论（对照本章结论验收） */
  | { type: 'review'; text: string; attempt: number; passed: boolean }
  /** 交付成功：正文已写入章节 */
  | { type: 'delivered'; order: number; title: string; wordCount: number; created: boolean }
  /** 交付被拦：多为「该章已有正文，不自动覆盖」，或「没认出章号」 */
  | { type: 'deliver_blocked'; order: number; title: string; reason: string }
  /** 实体沉淀：交付后写入项目库的角色/物品/地点/伏笔条数 */
  | { type: 'entities'; created: number; updated: number; skipped: number; notes: string[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * 跑一轮设计讨论。
 * @param message 作者这一轮说的话
 * @param onEvent 每个 SSE 事件的回调（角色发言是**整段**到达的，不是逐字）
 */
export async function runSession(
  message: string,
  opts: { chapterOrder?: number; signal?: AbortSignal } = {},
  onEvent: (e: SessionEvent) => void,
): Promise<void> {
  const token = getToken();
  // ★ 这里走裸 fetch（SSE 需要自己读流），不经过 apiClient，
  //   所以要手动补它平时自动注入的 X-Project-Id —— 后端缺这个头会直接 400。
  const projectId = getCurrentProjectId();
  const resp = await fetch('/api/plugins/autowrite/session', {
    method: 'POST',
    credentials: 'include', // 会话走 HttpOnly Cookie
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(projectId ? { 'X-Project-Id': projectId } : {}),
    },
    body: JSON.stringify({ message, chapterOrder: opts.chapterOrder }),
    signal: opts.signal,
  });

  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = (await resp.json()) as { error?: string | { message?: string } };
      if (j?.error) detail = typeof j.error === 'string' ? j.error : (j.error.message ?? detail);
    } catch {
      // 非 JSON 响应，保留 HTTP 状态码
    }
    throw new Error(detail);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleBlock = (block: string) => {
    forEachSSEDataLine(block, (dataStr) => {
      try {
        onEvent(JSON.parse(dataStr) as SessionEvent);
      } catch {
        // 单行解析失败不中断整条流
      }
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        handleBlock(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    // 最后一条事件可能没有尾部空行
    buffer += decoder.decode();
    handleBlock(buffer);
  } finally {
    reader.releaseLock?.();
  }
}
