/**
 * @fileoverview panelOpenStore —— 打开数量上限（ADR §4.4 / 用户口径 m01407）
 *
 * 契约：最多同时打开 `MAX_OPEN_PANELS`（3）个面板；打开第 4 个时淘汰
 * **最久没用过**的那一个（LRU：被打开或被聚焦都算「用过」），并且淘汰**可见**
 * （抛一条 `novelmuse:toast-notify`），不是静默挤掉。
 *
 * 背景：旧 `MAX_OPEN_PANELS = 3` 在 ADR §4.2（D10）因「静默挤掉第一个」被删除，
 * 改为「无限打开」；2026-10-07 用户口径要求上限回归、淘汰依据改为最近使用。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  MAX_OPEN_PANELS,
  _resetPanelOpenStore,
  getPanelNavigation,
  seedPanelOpenKeys,
  usePanelOpenStore,
} from '../panelOpenStore';

const keys = (): string[] => usePanelOpenStore.getState().keys;
const open = (key: string): void => getPanelNavigation().open(key);
const setActive = (key: string): void => usePanelOpenStore.getState()._setActive(key);
const syncFromView = (k: string[]): void => usePanelOpenStore.getState()._syncFromView(k);

describe('panelOpenStore · 打开数量上限（ADR §4.4）', () => {
  beforeEach(() => _resetPanelOpenStore());
  afterEach(() => _resetPanelOpenStore());

  it('上限常量 = 3，且首屏种子（2 个）不触发淘汰', () => {
    expect(MAX_OPEN_PANELS).toBe(3);
    expect(seedPanelOpenKeys(['chapters', 'ai-chat'])).toBe(true);
    expect(keys()).toEqual(['chapters', 'ai-chat']);
  });

  it('打开第 4 个 ⇒ 裁到 3 个，淘汰最久没用过的那个', () => {
    for (const k of ['a', 'b', 'c']) open(k);
    setActive('c'); // 刚看过 c
    open('d'); // 第 4 个
    expect(keys()).toHaveLength(MAX_OPEN_PANELS);
    expect(keys()).toEqual(['b', 'c', 'd']); // 最久没用过的是 a ⇒ 被淘汰
  });

  it('淘汰依据是「最近使用」而不是「最早打开」', () => {
    open('a');
    open('b');
    open('c');
    setActive('a'); // 回头看了 a ⇒ a 变成最近使用
    open('d');
    expect(keys()).toEqual(['a', 'c', 'd']); // 被淘汰的是 b，不是最早打开的 a
  });

  it('重复打开已存在的面板只聚焦，不新增也不淘汰', () => {
    for (const k of ['a', 'b', 'c']) open(k);
    open('a');
    expect(keys()).toEqual(['a', 'b', 'c']);
    // 没有淘汰发生 ⇒ 没有提示
    const seen = collectToasts(() => open('a'));
    expect(seen).toHaveLength(0);
  });

  it('toggle 打开第 4 个时同样受上限约束', () => {
    for (const k of ['a', 'b', 'c']) open(k);
    getPanelNavigation().toggle('d');
    expect(keys()).toEqual(['b', 'c', 'd']);
  });

  it('视图回写超过上限时裁剪，且不会误杀刚打开的那个', () => {
    open('a');
    open('b');
    open('c');
    // 模拟活动栏：走 DockShellApi.openPanel 直接 addPanel（绕过 store 的 open），
    // DockShell 随后整集合回写 = [a,b,c,d] —— d 是刚开的，绝不能被裁掉。
    syncFromView(['a', 'b', 'c', 'd']);
    expect(keys()).toEqual(['b', 'c', 'd']);
  });

  it('淘汰时抛出可见提示（不是静默挤掉）', () => {
    for (const k of ['a', 'b', 'c']) open(k);
    const seen = collectToasts(() => open('d'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message ?? '').toContain(`最多同时打开 ${MAX_OPEN_PANELS} 个`);
  });

  it('close / closeAll 语义不受上限影响', () => {
    for (const k of ['a', 'b', 'c']) open(k);
    getPanelNavigation().close('b');
    expect(keys()).toEqual(['a', 'c']);
    // 关掉的不是当前激活者 ⇒ 激活态不动（关掉激活者才清空）
    expect(usePanelOpenStore.getState().activeKey).toBe('c');
    getPanelNavigation().close('c');
    expect(usePanelOpenStore.getState().activeKey).toBeNull();
    getPanelNavigation().closeAll();
    expect(keys()).toEqual([]);
    expect(usePanelOpenStore.getState().activeKey).toBeNull();
  });

  it('同一批淘汰只提示一次（收敛过程去抖）', () => {
    for (const k of ['a', 'b', 'c']) open(k);
    const seen = collectToasts(() => {
      open('d');
      syncFromView(['a', 'b', 'c', 'd']); // 收敛过程中的重复上报
      syncFromView(['a', 'b', 'c', 'd']);
    });
    expect(seen).toHaveLength(1);
  });
});

/** 收集一次操作期间派发的 toast 事件（`ToastProvider` 监听的同一通道）。 */
function collectToasts(run: () => void): Array<{ message?: string }> {
  const seen: Array<{ message?: string }> = [];
  const onToast = (e: Event) => seen.push((e as CustomEvent<{ message?: string }>).detail);
  window.addEventListener('novelmuse:toast-notify', onToast);
  try {
    run();
  } finally {
    window.removeEventListener('novelmuse:toast-notify', onToast);
  }
  return seen;
}
