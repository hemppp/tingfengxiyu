// ============================================================
// 子代理「输出预算被打穿」的取证与补救 —— 纯函数单测
//
// 背景（2026-09-17）：流水线 cast 段跑到第 5 个发言人「定稿官」就报
// `Max turns (4) exceeded`，前 4 个发言人全部正常。真根因不是「模型不兼容」——
// 推理模型（glm-5.3-flash）的**思考 token 也计入 max_tokens**，实测量级从
// 26 到 4787 token 剧烈波动；某一轮思考吃满额度时中转站回 `content: null`
// + `finish_reason: length`，SDK 的 turnResolution 就认为「这一轮没结束」，
// 一路 `next_step_run_again` 空转到轮次耗尽，**整次调用作废**。
//
// 修法是两层：① 单次发言预算 8192 → 16384（roles-phase.ts）；
// ② 宿主层捕获这种空转并补救一次（host.ts 的 runSubagent）。
//
// 这里钉住第 ② 层的两个纯函数。它们判错一边的代价都很实：
//   · 判宽了 → 该原样抛的真错误被重试盖住（重演「静默跳过比报错更危险」）
//   · 判严了 → 白跑一整段（cast 一次 ≈ 2 分钟起步，长输入更久）
// ============================================================

import { describe, expect, it } from 'vitest';
import { MaxTurnsExceededError } from '@openai/agents';

import {
  isStarvationFailure,
  noteStreamEvidence,
  retryBudgetOf,
  STARVATION_RETRY_HINT,
} from '../plugin/host.js';

/** 一次全新 run 的取证状态 */
const fresh = () => ({ text: false, tool: false });
/** 造一个 SDK 的 RunItemStreamEvent（type 固定，name 是 RunItemStreamEventName） */
const ev = (name: string) => ({ type: 'run_item_stream_event', name });

describe('noteStreamEvidence —— 空转取证', () => {
  it('message_output_created ⇒ 判定「有正文产出」', () => {
    const saw = fresh();
    noteStreamEvidence(ev('message_output_created'), saw);
    expect(saw.text).toBe(true);
  });

  it('tool_called / tool_search_called ⇒ 判定「发起过工具调用」', () => {
    const a = fresh();
    noteStreamEvidence(ev('tool_called'), a);
    expect(a.tool).toBe(true);

    const b = fresh();
    noteStreamEvidence(ev('tool_search_called'), b);
    expect(b.tool).toBe(true);
  });

  it('★ reasoning / tool_output 一类事件不算「有产出」——它们正是空转现场的特征', () => {
    const saw = fresh();
    for (const name of [
      'reasoning_item_created', // 只思考、没出正文
      'tool_output',
      'compaction_item_created',
      'handoff_requested',
      'tool_approval_requested',
    ]) {
      noteStreamEvidence(ev(name), saw);
    }
    expect(saw).toEqual({ text: false, tool: false });
  });

  it('非 run_item_stream_event（原始模型事件 / 换 agent 事件）不改判定', () => {
    const saw = fresh();
    noteStreamEvidence({ type: 'raw_model_stream_event', name: 'message_output_created' }, saw);
    noteStreamEvidence({ type: 'agent_updated_stream_event' }, saw);
    expect(saw).toEqual({ text: false, tool: false });
  });

  it('畸形输入不抛 —— 这是旁路取证，宁可判不出来也不能弄坏主链路', () => {
    const saw = fresh();
    for (const bad of [null, undefined, 0, 'x', {}, { type: 'run_item_stream_event' }]) {
      expect(() => noteStreamEvidence(bad, saw)).not.toThrow();
    }
    expect(saw).toEqual({ text: false, tool: false });
  });

  it('两类产出可叠加记录（工具轮次 + 最终正文）', () => {
    const saw = fresh();
    noteStreamEvidence(ev('tool_called'), saw);
    noteStreamEvidence(ev('message_output_created'), saw);
    expect(saw).toEqual({ text: true, tool: true });
  });
});

describe('retryBudgetOf —— 补救轮预算', () => {
  it('不传首次预算时给 16384', () => {
    expect(retryBudgetOf(undefined)).toBe(16384);
  });

  it('★ 8192（修复前的定稿官预算）补救到 16384 —— 本次修复的直接对照', () => {
    expect(retryBudgetOf(8192)).toBe(16384);
  });

  it('首次已是 16384 ⇒ 翻倍到 32768', () => {
    expect(retryBudgetOf(16384)).toBe(32768);
  });

  it('下限：首次预算再小也不许低于 16384（否则补救轮还会被打穿）', () => {
    expect(retryBudgetOf(1)).toBe(16384);
    expect(retryBudgetOf(512)).toBe(16384);
  });

  it('上限 65536：首次预算畸大时不无限翻倍', () => {
    expect(retryBudgetOf(100000)).toBe(65536);
    expect(retryBudgetOf(65536)).toBe(65536);
  });
});

describe('STARVATION_RETRY_HINT —— 补救提示', () => {
  it('必须点明「直接作答、压缩推理」：推理模型被告知额度告急才会收敛思考', () => {
    expect(STARVATION_RETRY_HINT).toContain('直接');
    expect(STARVATION_RETRY_HINT).toContain('推理');
  });

  it('提示非空且不过长（它会被追加进每一次补救调用的 system）', () => {
    expect(STARVATION_RETRY_HINT.length).toBeGreaterThan(30);
    expect(STARVATION_RETRY_HINT.length).toBeLessThan(400);
  });
});

describe('isStarvationFailure —— 该不该补救', () => {
  /** 造一个 SDK 的轮次耗尽错误（state 参数可省，这里不需要） */
  const maxTurns = (n = 4) => new MaxTurnsExceededError(`Max turns (${n}) exceeded`);

  it('轮次耗尽 + 零正文 + 零工具 ⇒ 要补救', () => {
    expect(isStarvationFailure(maxTurns(), { text: false, tool: false })).toBe(true);
  });

  it('★ 轮次耗尽 + 零正文 + **有**工具调用 ⇒ 依然要补救', () => {
    // 2026-09-17 故障注入实测的现场：设定管家先成功查了一次库（tool=true），
    // 之后每轮都拿不到正文 → `Max turns (6) exceeded`。
    // 早期实现把「有工具调用」当排除条件，于是这类现场被放行了 —— 这条用例就是防它回退。
    expect(isStarvationFailure(maxTurns(6), { text: false, tool: true })).toBe(true);
  });

  it('★ 产出过正文就绝不重试 —— 正常的工具流程不该被误判', () => {
    // 正常流程：调工具 → 拿到结果 → 作答，saw.text 必为 true。
    expect(isStarvationFailure(maxTurns(), { text: true, tool: true })).toBe(false);
    expect(isStarvationFailure(maxTurns(), { text: true, tool: false })).toBe(false);
  });

  it('其他类型的错误一律不补救（拿重试盖真错误比失败更糟）', () => {
    expect(isStarvationFailure(new Error('fetch failed'), { text: false, tool: false })).toBe(false);
    expect(isStarvationFailure(new Error('401 Unauthorized'), { text: false, tool: false })).toBe(false);
    expect(isStarvationFailure(null, { text: false, tool: false })).toBe(false);
    expect(isStarvationFailure('Max turns (4) exceeded', { text: false, tool: false })).toBe(false);
  });
});
