// ============================================================
// 自动写作框架单测 —— 流转状态机（纯逻辑）+ KV 存储层
// 运行载体：apps/server 的 vitest（vitest.config.ts include 已收录本目录）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  applyAction,
  stepAfterGateFail,
  budgetVerdict,
} from './flow-state.js';
import { FlowStore } from './flow-store.js';
import type { BatchPlan } from './flow-store.js';
import type { KvService } from '@novel/core';

// ---- 状态机：越界转移必须被拒绝（编排器提议，状态机裁决） ----

describe('autowrite flow-state 状态机', () => {
  it('write 仅允许从 planned / written 出发', () => {
    expect(canTransition('planned', 'write').ok).toBe(true);
    expect(canTransition('written', 'write').ok).toBe(true);
    expect(canTransition('checked', 'write').ok).toBe(false);
    expect(canTransition('polished', 'write').ok).toBe(false);
    expect(canTransition('delivered', 'write').ok).toBe(false);
  });

  it('check 仅允许从 written 出发（先出稿后校对）', () => {
    expect(canTransition('written', 'check').ok).toBe(true);
    expect(canTransition('planned', 'check').ok).toBe(false);
    expect(canTransition('checked', 'check').ok).toBe(false);
    expect(canTransition('delivered', 'check').ok).toBe(false);
  });

  it('polish 仅允许从 checked 出发（硬门先于软门）', () => {
    expect(canTransition('checked', 'polish').ok).toBe(true);
    expect(canTransition('written', 'polish').ok).toBe(false);
    expect(canTransition('polished', 'polish').ok).toBe(false);
  });

  it('confirm 允许从 checked / polished 出发', () => {
    expect(canTransition('checked', 'confirm').ok).toBe(true);
    expect(canTransition('polished', 'confirm').ok).toBe(true);
    expect(canTransition('written', 'confirm').ok).toBe(false);
    expect(canTransition('planned', 'confirm').ok).toBe(false);
    expect(canTransition('delivered', 'confirm').ok).toBe(false);
  });

  it('拒绝时给出可回喂编排器的原因', () => {
    const v = canTransition('planned', 'confirm');
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it('applyAction 正确推进步骤', () => {
    expect(applyAction('planned', 'write')).toBe('written');
    expect(applyAction('written', 'check')).toBe('checked');
    expect(applyAction('checked', 'polish')).toBe('polished');
    expect(applyAction('polished', 'confirm')).toBe('delivered');
  });

  it('门失败回退到 written（强制重写后再审）', () => {
    expect(stepAfterGateFail()).toBe('written');
  });

  it('预算判定：无预算/未超 → ok，超支 → exceeded', () => {
    expect(budgetVerdict(999999, undefined)).toBe('ok');
    expect(budgetVerdict(100, 30000)).toBe('ok');
    expect(budgetVerdict(30001, 30000)).toBe('exceeded');
    expect(budgetVerdict(100, 0)).toBe('ok'); // 0/负数视为未设预算
  });
});

// ---- KV 存储层：批次 / 单章流转 / 台账往返 ----

/** 内存 KV mock（KvService 契约的最小实现） */
function mockKv(): KvService {
  const rows = new Map<string, unknown>();
  return {
    get<T>(pluginId: string, key: string): T | undefined {
      return rows.get(`${pluginId}::${key}`) as T | undefined;
    },
    async set(pluginId: string, key: string, value: unknown): Promise<void> {
      rows.set(`${pluginId}::${key}`, JSON.parse(JSON.stringify(value)));
    },
    list(pluginId: string, prefix?: string): Array<{ key: string; value: unknown }> {
      const p = `${pluginId}::${prefix ?? ''}`;
      return [...rows.entries()]
        .filter(([k]) => k.startsWith(p))
        .map(([k, v]) => ({ key: k.slice(p.length), value: v as unknown }));
    },
    async delete(pluginId: string, key: string): Promise<void> {
      rows.delete(`${pluginId}::${key}`);
    },
  } as KvService;
}

describe('autowrite FlowStore（KV 往返）', () => {
  it('批次保存/加载/活跃查询', async () => {
    const store = new FlowStore(mockKv(), 'p1');
    const batch: BatchPlan = {
      id: 'b1', from: 1, to: 2, status: 'running', cursor: 0, createdAt: 1,
      chapters: [
        { order: 1, title: '一章', brief: '开篇' },
        { order: 2, title: '二章', brief: '推进' },
      ],
    };
    await store.saveBatch(batch);
    expect(store.loadBatch('b1')?.chapters.length).toBe(2);
    expect(store.findActiveBatch()?.id).toBe('b1');

    batch.status = 'done';
    await store.saveBatch(batch);
    expect(store.findActiveBatch()).toBeUndefined(); // done 不算活跃
  });

  it('单章流转：状态与打回计数持久化', async () => {
    const store = new FlowStore(mockKv(), 'p1');
    const flow = FlowStore.newFlow('b1', 1);
    flow.step = 'written';
    flow.draft = '正文……';
    flow.revisions = 1;
    flow.checkFails = 1;
    flow.check = { pass: false, conflicts: ['时间线矛盾'], instructions: '修正' };
    await store.saveFlow(flow);

    const loaded = store.loadFlow('b1', 1);
    expect(loaded?.step).toBe('written');
    expect(loaded?.revisions).toBe(1);
    expect(loaded?.check?.pass).toBe(false);
    expect(loaded?.draft).toContain('正文');
  });

  it('审计台账强制留痕且可查询（超限裁剪）', async () => {
    const store = new FlowStore(mockKv(), 'p1');
    for (let i = 0; i < 505; i++) {
      await store.appendAudit('b1', { ts: i, step: 'write', order: 1, decision: `第${i}步` });
    }
    const log = store.getAudit('b1');
    expect(log.length).toBe(500); // 上限裁剪
    expect(log[log.length - 1].decision).toBe('第504步'); // 保留最新
  });

  it('项目隔离：不同 projectId 互不可见', async () => {
    const s1 = new FlowStore(mockKv(), 'p1');
    const s2 = new FlowStore(mockKv(), 'p2');
    const batch: BatchPlan = { id: 'bx', from: 1, to: 1, status: 'running', cursor: 0, createdAt: 1, chapters: [] };
    await s1.saveBatch(batch);
    expect(s2.findActiveBatch()).toBeUndefined();
  });
});
