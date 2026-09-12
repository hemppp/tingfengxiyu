// ============================================================
// AutoWriteWorkbench — AI 写作模式（project.mode === 'auto'）的固定工作台
//
// 与手写框架**完全互斥**：不渲染罗盘气泡，也不挂载任何手写面板
// （角色/地点/物品/伏笔/地图/关系图/统计/笔记都不出现）。
//
// 布局（三栏常驻，正文不再用 tab 切换）：
//   ┌────────────┬──────────────────────┬─────────────┐
//   │ 左：对话     │  中：世界状态仪表盘    │  右：正文    │
//   │  交流流      │   计划 / 变动 / 伏笔   │  宣纸信笺    │
//   │  输入框      │   物品 / 角色 / 地点   │             │
//   ├────────────┴──────────────────────┴─────────────┤
//   │ 底：花名册 + 批次总控                              │
//   └──────────────────────────────────────────────────┘
//   左右两栏均可拖分隔条调宽窄，也可各自整栏收起。
//
// 「运行过程时间线」不再单独做 —— 交流流本身按时间有序，它就是时间线。
//
// 当前交付：三栏布局 + 双分隔条 + **编排器已接入** ——
//   左栏发送即走 `auto-write` 技能 + 工具调用（novelChatStream），
//   SSE 流被翻译成交流流：文本 chunk 落进「当前发言者」的气泡；
//   工具调用按 TOOL_AGENT 切换发言者，并把动作与结果挂在该气泡的 meta 上。
// 待接入：正文流式落点（右栏）、按台账回放历史运行过程。
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Send, Sparkles,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import type { Project } from '@novel/shared';
import { useChapterStore } from '@/stores';
import { WorldStateBoard } from '@/components/layout/WorldStateBoard';
import { EntityRail } from '@/components/layout/EntityRail';
import { runSession, type SessionEvent } from '@/services/ai/autowriteSession';

/**
 * 底部花名册 —— 设计讨论层阵容，与后端 `discuss/roles.ts` 一一对应。
 * 配色走语义变量（`--agent-*`），不要写死色值 —— 否则换肤时这里不会跟着变。
 * 注意：交流流里每条发言的配色与头像字由后端 turn 事件自带（后端用的是同一套语义值）。
 */
const AGENTS: ReadonlyArray<{ key: string; name: string; short: string; desc: string; color: string }> = [
  { key: 'plot-designer', name: '剧情设计师', short: '剧', desc: '冲突 · 转折 · 钩子', color: 'hsl(var(--agent-plot))' },
  { key: 'character-designer', name: '角色设计师', short: '角', desc: '动机 · 状态 · 关系', color: 'hsl(var(--agent-character))' },
  { key: 'continuity-keeper', name: '设定管家', short: '设', desc: '查库 · 拦冲突 · 伏笔时机', color: 'hsl(var(--agent-continuity))' },
  { key: 'convener', name: '定稿官', short: '定', desc: '收敛本章结论', color: 'hsl(var(--agent-convener))' },
  { key: 'writer', name: '写作官', short: '写', desc: '只读结论写正文', color: 'hsl(var(--agent-writer))' },
];

// 注：早期版本在前端用一张「工具名 → 角色」映射表把单代理的 SSE 流切成四个角色。
// 现在角色由后端 discuss/orchestrator 真实扮演，turn 事件自带身份，那张表已删除。

/**
 * 智能体配色 —— 后端 turn 事件会带一个 hex 兜底色，但**优先走语义变量**，
 * 这样换肤时交流流里的角色配色能跟着主题变（否则又变成"半张皮"）。
 */
const AGENT_COLOR: Record<string, string> = {
  'plot-designer': 'hsl(var(--agent-plot))',
  'character-designer': 'hsl(var(--agent-character))',
  'continuity-keeper': 'hsl(var(--agent-continuity))',
  'convener': 'hsl(var(--agent-convener))',
  'writer': 'hsl(var(--agent-writer))',
  'conclusion': 'hsl(var(--agent-convener))',
  'reviewer': 'hsl(var(--primary))',
  'delivered': 'hsl(var(--state-done))',
  'deliver-blocked': 'hsl(var(--state-blocked))',
  'entities': 'hsl(var(--state-done))',
  'system': 'hsl(var(--state-blocked))',
  'user': 'hsl(var(--ink))',
};

function colorOf(agent: string, fallback: string): string {
  return AGENT_COLOR[agent] ?? fallback;
}

/** 交流流里的一条发言 */
interface ChatTurn {
  id: string;
  /** 'user' = 作者本人；其余为后端下发的角色 key；'system' = 报错 */
  from: string;
  name: string;
  color: string;
  short: string;
  text: string;
  time: string;
  /** 次要元信息，如「模型 xxx」 */
  meta?: string;
  /** 需要引起注意的状态，决定左侧色条 */
  tone?: 'warn' | 'ok';
  /** 'conclusion' 用卡片形式呈现（本章结论） */
  kind?: 'say' | 'conclusion';
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface AutoWriteWorkbenchProps {
  project: Project | null;
  /** 顶栏返回：由宿主决定目标（层级兜底 / 历史后退） */
  onBack: () => void;
  /**
   * 项目数据在服务端变了（本章交付后实体沉淀）时调用，由宿主刷新 store。
   * 必须用**宿主已有的那个 syncService 实例** —— 工作台自己再挂一个 useSyncService
   * 会让每次 store 变更被两个订阅各写一遍，实体重复创建。
   */
  onProjectDataChanged?: () => void;
}

const RAIL_MIN = 260;
const RAIL_MAX = 520;
const RAIL_DEFAULT = 320;

const SIDE_MIN = 200;
const SIDE_MAX_W = 380;
const SIDE_DEFAULT = 252;

/** 窗口再窄也要给中间仪表盘留出的最小宽度 */
const CENTER_MIN = 340;

export function AutoWriteWorkbench({ project, onBack, onProjectDataChanged }: AutoWriteWorkbenchProps) {
  const chapters = useChapterStore((s) => s.chapters);

  const [railOpen, setRailOpen] = useState(true);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);
  const [sideOpen, setSideOpen] = useState(true);
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT);
  const [hotSplitter, setHotSplitter] = useState<null | 'left' | 'right'>(null);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  /** 正在等智能体回应（此时可打断） */
  const [busy, setBusy] = useState(false);
  /** 当前阶段（来自后端 phase 事件），显示在输入框上方 */
  const [phase, setPhase] = useState('');
  /** 讨论收敛出的本章结论 —— 同时落进交流流卡片与中栏「本章计划」卡 */
  const [conclusion, setConclusion] = useState<string | null>(null);
  /** 写作官产出的正文 —— 落在中上方的正文方块里（命名避开输入框的 `draft`） */
  const [prose, setProse] = useState<string | null>(null);
  /** 当前正文是第几稿：0 = 初稿，≥1 = 被意图门打回后的第 N 次重写 */
  const [revision, setRevision] = useState(0);

  const leftSplitRef = useRef<null | { sx: number; ow: number }>(null);
  const rightSplitRef = useRef<null | { sx: number; ow: number }>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const projChapters = useMemo(
    () => (project
      ? chapters.filter((c) => c.projectId === project.id).slice().sort((a, b) => a.order - b.order)
      : []),
    [chapters, project],
  );

  // 输入框随内容长高（上限 96px，超过就内部滚动）
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(96, el.scrollHeight)}px`;
  }, [draft]);

  // 窗口变窄时收钳两栏，保证中间仪表盘不被挤没
  useEffect(() => {
    const onResize = () => {
      const avail = window.innerWidth - CENTER_MIN;
      setRailWidth((cur) => Math.min(cur, Math.max(RAIL_MIN, avail - SIDE_MIN)));
      setSideWidth((cur) => Math.min(cur, Math.max(SIDE_MIN, avail - RAIL_MIN)));
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, []);

  // ---- 左分隔条（对话 | 状态）：向右拖 = 变宽 ----
  const onLeftDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    leftSplitRef.current = { sx: e.clientX, ow: railWidth };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [railWidth]);

  const onLeftMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = leftSplitRef.current;
    if (!d) return;
    // 上限同时受「中间最小宽」约束：别把仪表盘挤没
    const room = window.innerWidth - CENTER_MIN - (sideOpen ? sideWidth : 0);
    const next = Math.min(RAIL_MAX, Math.max(RAIL_MIN, d.ow + (e.clientX - d.sx)), Math.max(RAIL_MIN, room));
    setRailWidth(next);
  }, [sideOpen, sideWidth]);

  const onLeftUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    leftSplitRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  // ---- 右分隔条（状态 | 正文）：向左拖 = 正文变宽，故取反 ----
  const onRightDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    rightSplitRef.current = { sx: e.clientX, ow: sideWidth };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [sideWidth]);

  const onRightMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = rightSplitRef.current;
    if (!d) return;
    const room = window.innerWidth - CENTER_MIN - (railOpen ? railWidth : 0);
    const next = Math.min(
      SIDE_MAX_W,
      Math.max(SIDE_MIN, d.ow - (e.clientX - d.sx)),
      Math.max(SIDE_MIN, room),
    );
    setSideWidth(next);
  }, [railOpen, railWidth]);

  const onRightUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    rightSplitRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const scrollStreamToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = streamRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /** 一轮设计讨论：后端逐个扮演角色把发言推回来，事件自带身份（不再靠前端猜） */
  const runAgent = useCallback(async (text: string) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setPhase('正在召集智能体…');

    const push = (turn: Omit<ChatTurn, 'id' | 'time'>) => {
      setTurns((prev) => [...prev, { ...turn, id: nanoid(), time: nowHHMM() }]);
      scrollStreamToEnd();
    };

    try {
      await runSession(text, { signal: ac.signal }, (e: SessionEvent) => {
        if (e.type === 'phase') {
          setPhase(e.label);
        } else if (e.type === 'turn') {
          push({
            from: e.agent, name: e.name, color: e.color, short: e.short,
            text: e.text, meta: e.meta,
          });
        } else if (e.type === 'conclusion') {
          // 结论是契约：既进交流流（留痕），也进中栏计划卡（供后续写作/复核对照）
          setConclusion(e.text);
          push({
            from: 'conclusion', name: '本章结论', color: 'hsl(var(--agent-convener))', short: '结',
            text: e.text, kind: 'conclusion',
          });
        } else if (e.type === 'draft') {
          // 正文落点：同一份文本既作为写作官的发言进交流流，也进中上正文方块
          setProse(e.text);
          setRevision(e.revision);
        } else if (e.type === 'review') {
          // 复核结论进交流流留痕；tone 让打回一眼能认出来
          push({
            from: 'reviewer', name: '意图复核', color: '#534AB7', short: '核',
            text: e.text,
            meta: e.passed ? '通过' : `第 ${e.attempt} 次打回`,
            tone: e.passed ? 'ok' : 'warn',
          });
        } else if (e.type === 'delivered') {
          push({
            from: 'delivered', name: '交付', color: '#0F6E56', short: '✓',
            text: `${e.created ? '已新建并写入' : '已写入'} ${e.title}（${e.wordCount} 字）`,
            tone: 'ok',
          });
        } else if (e.type === 'deliver_blocked') {
          push({
            from: 'deliver-blocked', name: '交付', color: '#A32D2D', short: '!',
            text: e.title ? `${e.title}：${e.reason}` : e.reason,
            tone: 'warn',
          });
        } else if (e.type === 'entities') {
          // 实体已写进项目库 —— 回流一行让作者看得见「本章世界变了什么」
          push({
            from: 'entities', name: '实体沉淀', color: 'hsl(var(--state-done))', short: '沉',
            text: `新建 ${e.created} · 更新 ${e.updated}${e.skipped > 0 ? ` · 跳过 ${e.skipped}` : ''}`
              + (e.notes.length > 0 ? `\n${e.notes.join('；')}` : ''),
            tone: 'ok',
          });
          // 仪表盘读的是项目 store（Item.states / Foreshadow.payoffChapter），
          // 服务端已落库、store 还是旧的 —— 不刷新则「最近变动」仍然空白。
          onProjectDataChanged?.();
        } else if (e.type === 'error') {
          push({
            from: 'system', name: '系统', color: 'hsl(var(--state-blocked))', short: '!',
            text: `会话失败：${e.message}`, tone: 'warn',
          });
        }
      });
    } catch (err) {
      // 用户主动打断：静默收尾，不当成错误
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        push({
          from: 'system', name: '系统', color: 'hsl(var(--state-blocked))', short: '!',
          text: `会话失败：${err instanceof Error ? err.message : String(err)}`,
          tone: 'warn',
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setPhase('');
      scrollStreamToEnd();
    }
  }, [scrollStreamToEnd, onProjectDataChanged]);

  /** 作者发言：先落到流里，再交给编排器 */
  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setTurns((prev) => [...prev, {
      id: nanoid(),
      from: 'user', name: '你', color: 'hsl(var(--ink))', short: '我',
      text, time: nowHHMM(),
    }]);
    setDraft('');
    scrollStreamToEnd();
    void runAgent(text);
  }, [draft, busy, runAgent, scrollStreamToEnd]);

  /** 打断：中止当前流式请求（编排器会收到 abort） */
  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const onDraftKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const latestChapter = projChapters[projChapters.length - 1];

  return (
    // ★ 必须是 h-screen 而不是 h-full：本组件经 ProjectLayout 的 early return 挂载，
    //   外层（PageFade → min-h-screen）是 min-height 撑出的内容高、并非确定高度，
    //   h-full 的百分比高度会退化成 auto → 工作台只占内容高，下方塌出整片空白。
    <div className="h-screen flex flex-col overflow-hidden">

      {/* ── 顶栏 ── */}
      <header
        className="shrink-0 flex items-center gap-2.5 relative z-40"
        style={{ height: 48, padding: '0 12px' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="nm-btn-apple-icon-sm"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={15} />
        </button>
        <span
          className="text-[13px] font-semibold truncate max-w-[140px] sm:max-w-[220px]"
          style={{ color: 'hsl(var(--foreground))', letterSpacing: '-0.2px' }}
        >
          {project ? project.name : 'NovelMuse'}
        </span>
        <span
          className="hidden sm:flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full"
          style={{ color: 'hsl(var(--muted-foreground))', background: 'rgb(var(--glass-tint) / 0.45)' }}
        >
          <span
            className="rounded-full"
            style={{ width: 5, height: 5, background: 'hsl(var(--primary) / 0.8)' }}
            aria-hidden="true"
          />
          AI 写作
        </span>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px] hidden md:inline mr-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {projChapters.length > 0 ? `共 ${projChapters.length} 章` : '尚未建章'}
          </span>
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className="nm-btn-apple-icon-sm"
            title={railOpen ? '收起对话栏' : '展开对话栏'}
            aria-label={railOpen ? '收起对话栏' : '展开对话栏'}
            aria-pressed={railOpen}
          >
            {railOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
          <button
            type="button"
            onClick={() => setSideOpen((v) => !v)}
            className="nm-btn-apple-icon-sm"
            title={sideOpen ? '收起实体栏' : '展开实体栏'}
            aria-label={sideOpen ? '收起实体栏' : '展开实体栏'}
            aria-pressed={sideOpen}
          >
            {sideOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative z-10">

        {/* ── 左栏：智能体对话 ── */}
        {railOpen && (
          <>
            <section
              className="shrink-0 flex flex-col overflow-hidden"
              style={{
                width: railWidth,
                background: 'rgb(var(--glass-tint) / 0.34)',
                backdropFilter: 'blur(10px) saturate(130%)',
                WebkitBackdropFilter: 'blur(10px) saturate(130%)',
              }}
              aria-label="智能体对话"
            >
              <div
                className="shrink-0 flex items-center gap-2"
                style={{ height: 34, padding: '0 12px', borderBottom: '0.5px solid hsl(var(--border) / 0.5)' }}
              >
                <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))', letterSpacing: '0.06em' }}>
                  智能体对话
                </span>
                <span className="ml-auto flex items-center gap-1" aria-hidden="true">
                  {AGENTS.map((a) => (
                    <span
                      key={a.key}
                      className="rounded-full"
                      title={a.name}
                      style={{ width: 5, height: 5, background: `${a.color}66` }}
                    />
                  ))}
                </span>
              </div>

              <div ref={streamRef} className="flex-1 overflow-y-auto px-3 py-3.5">
                {turns.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center px-2" style={{ maxWidth: 250 }}>
                      <Sparkles size={20} className="mx-auto mb-2.5" style={{ color: 'hsl(var(--primary) / 0.65)' }} />
                      <div className="text-[12px] mb-2" style={{ color: 'hsl(var(--ink))' }}>
                        智能体就位
                      </div>
                      <p className="text-[11px] leading-[1.75]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        对规划官说明要写什么（例如「把第 2 到第 4 章按大纲写出来」），
                        它会把大纲拆成逐章细纲、开出批次。
                        <br />
                        <span style={{ color: 'hsl(var(--muted-foreground) / 0.8)' }}>
                          四位智能体的发言会按时间展开，随时可在下方插话打断。
                        </span>
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {turns.map((t) => (
                      t.kind === 'conclusion' ? (
                        // 本章结论用卡片：它是契约，视觉上要能一眼认出来
                        <div
                          key={t.id}
                          className="rounded-xl px-3.5 py-3"
                          style={{ background: 'hsl(var(--card) / 0.7)', border: '0.5px solid hsl(var(--agent-convener) / 0.5)' }}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className="inline-flex items-center justify-center rounded-full text-white"
                              style={{ width: 18, height: 18, background: colorOf(t.from, t.color), fontSize: 9 }}
                              aria-hidden="true"
                            >
                              {t.short}
                            </span>
                            <span className="text-[12px] font-medium" style={{ color: 'hsl(var(--ink))' }}>
                              {t.name}
                            </span>
                            <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.75)' }}>
                              {t.time}
                            </span>
                          </div>
                          <pre
                            className="text-[11px] leading-[1.75] whitespace-pre-wrap"
                            style={{ color: 'hsl(var(--ink-light))', margin: 0, fontFamily: 'inherit' }}
                          >
                            {t.text}
                          </pre>
                        </div>
                      ) : (
                        <div key={t.id} className="flex gap-2.5">
                          <span
                            className="shrink-0 inline-flex items-center justify-center rounded-full text-white"
                            style={{ width: 24, height: 24, background: colorOf(t.from, t.color), fontSize: 10, marginTop: 1 }}
                            aria-hidden="true"
                          >
                            {t.short}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="flex items-baseline gap-2">
                              <span className="text-[12px] font-medium" style={{ color: 'hsl(var(--ink))' }}>
                                {t.name}
                              </span>
                              <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.75)' }}>
                                {t.time}
                              </span>
                            </div>

                            <div
                              className="text-[12px] leading-[1.7] mt-1"
                              style={{
                                color: 'hsl(var(--ink-light))',
                                whiteSpace: 'pre-wrap',
                                paddingLeft: t.tone ? 8 : 0,
                                borderLeft: t.tone
                                  ? `2px solid ${t.tone === 'warn' ? 'hsl(var(--state-blocked))' : 'hsl(var(--primary) / 0.5)'}`
                                  : undefined,
                              }}
                            >
                              {t.text}
                            </div>

                            {t.meta && (
                              <div className="text-[10px] mt-1.5" style={{ color: 'hsl(var(--muted-foreground) / 0.75)' }}>
                                {t.meta}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>

              <div
                className="shrink-0 px-2.5 py-2.5"
                style={{ borderTop: '0.5px solid hsl(var(--border) / 0.5)' }}
              >
                <div
                  className="flex items-end gap-1.5 rounded-xl px-2.5 py-2"
                  style={{
                    background: 'rgb(var(--glass-tint) / 0.55)',
                    border: '0.5px solid hsl(var(--border) / 0.7)',
                  }}
                >
                  <textarea
                    ref={taRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onDraftKeyDown}
                    rows={1}
                    placeholder="插一句话打断，或补充指令…"
                    aria-label="对智能体说话"
                    className="flex-1 resize-none bg-transparent outline-none text-[12px] leading-[1.65] py-0.5"
                    style={{ color: 'hsl(var(--foreground))', maxHeight: 96, overflowY: 'auto' }}
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim() || busy}
                    className="shrink-0 inline-flex items-center justify-center rounded-lg transition-opacity disabled:opacity-30"
                    title={busy ? '智能体处理中' : '发送（Enter）'}
                    aria-label="发送"
                    style={{
                      width: 26,
                      height: 26,
                      background: 'hsl(var(--primary))',
                      color: 'hsl(var(--primary-foreground))',
                      cursor: draft.trim() && !busy ? 'pointer' : 'default',
                    }}
                  >
                    <Send size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1.5 px-1">
                  <span className="text-[10px] truncate" style={{ color: 'hsl(var(--muted-foreground) / 0.7)' }}>
                    {busy ? (phase || '智能体处理中…') : 'Enter 发送 · Shift+Enter 换行'}
                  </span>
                  {busy && (
                    <button
                      type="button"
                      onClick={interrupt}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded-md"
                      style={{
                        color: 'hsl(var(--destructive))',
                        border: '0.5px solid hsl(var(--destructive) / 0.4)',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      停止
                    </button>
                  )}
                </div>
              </div>
            </section>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整对话栏宽度"
              onPointerDown={onLeftDown}
              onPointerMove={onLeftMove}
              onPointerUp={onLeftUp}
              onPointerCancel={onLeftUp}
              onMouseEnter={() => setHotSplitter('left')}
              onMouseLeave={() => setHotSplitter(null)}
              className="shrink-0"
              style={{
                width: 5,
                cursor: 'col-resize',
                touchAction: 'none',
                background: hotSplitter === 'left' ? 'hsl(var(--primary) / 0.35)' : 'transparent',
                borderLeft: '0.5px solid hsl(var(--border) / 0.6)',
                transition: 'background 0.15s',
              }}
            />
          </>
        )}

        {/* ── 中栏：上＝正文方块，下＝数据面板 ── */}
        <div
          className="flex-1 min-w-0 flex flex-col overflow-hidden"
          style={{ padding: '14px 16px 16px', gap: 12 }}
        >
          {/* 正文方块：只占中上这一块，不与数据面板争高 */}
          <section
            className="shrink-0 flex flex-col overflow-hidden rounded-xl"
            style={{
              height: '42%',
              minHeight: 150,
              background: 'hsl(var(--card) / 0.45)',
              border: '0.5px solid hsl(var(--border) / 0.5)',
            }}
            aria-label="正文"
          >
            <div
              className="shrink-0 flex items-center gap-2"
              style={{ height: 30, padding: '0 14px', borderBottom: '0.5px solid hsl(var(--border) / 0.45)' }}
            >
              <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))', letterSpacing: '0.06em' }}>
                正文
              </span>
              {latestChapter && (
                <span className="text-[11px] truncate" style={{ color: 'hsl(var(--muted-foreground) / 0.75)' }}>
                  · {latestChapter.title}
                </span>
              )}
              {prose && revision > 0 && (
                <span className="ml-auto text-[10px]" style={{ color: 'hsl(var(--state-running))' }}>
                  第 {revision} 次重写
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              {prose ? (
                // 正文落点：写作官产出后逐字出现在这里
                <div
                  className="font-serif whitespace-pre-wrap"
                  style={{ fontSize: 13.5, lineHeight: 1.9, color: 'hsl(var(--foreground))' }}
                >
                  {prose}
                </div>
              ) : (
                <div className="min-h-full flex items-center justify-center">
                  {projChapters.length === 0 ? (
                    <div className="text-center px-4">
                      <div className="font-serif mb-2" style={{ fontSize: 14, color: 'hsl(var(--ink))' }}>
                        还没有章节
                      </div>
                      <p className="text-[11px] leading-[1.8]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        在左侧对智能体说明要写什么，讨论收敛后写作官会在这里落笔。
                      </p>
                    </div>
                  ) : (
                    <div className="text-center px-4">
                      <div className="font-serif mb-2" style={{ fontSize: 14, color: 'hsl(var(--ink))' }}>
                        等待正文流入
                      </div>
                      <p className="text-[11px] leading-[1.8]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        讨论收敛出「本章结论」后，写作官会据此写出正文并出现在这里；
                        同一份正文也会以卡片形式进左侧交流流。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 中下：数据面板（本章计划 + 最近变动）—— 从下方包住正文 */}
          <div className="flex-1 min-h-0">
            {project ? (
              <WorldStateBoard projectId={project.id} conclusion={conclusion} running={busy} />
            ) : (
              <div className="text-[12px] text-center mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>
                未加载项目
              </div>
            )}
          </div>
        </div>

        {/* ── 右栏：实体栏（知识库 / 地点 / 物品 / 伏笔）—— 从右侧包住正文 ── */}
        {sideOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整实体栏宽度"
              onPointerDown={onRightDown}
              onPointerMove={onRightMove}
              onPointerUp={onRightUp}
              onPointerCancel={onRightUp}
              onMouseEnter={() => setHotSplitter('right')}
              onMouseLeave={() => setHotSplitter(null)}
              className="shrink-0"
              style={{
                width: 5,
                cursor: 'col-resize',
                touchAction: 'none',
                background: hotSplitter === 'right' ? 'hsl(var(--primary) / 0.35)' : 'transparent',
                borderLeft: '0.5px solid hsl(var(--border) / 0.6)',
                transition: 'background 0.15s',
              }}
            />

            <section
              className="shrink-0 overflow-hidden"
              style={{
                width: sideWidth,
                padding: '14px 10px 16px',
                background: 'rgb(var(--glass-tint) / 0.18)',
              }}
              aria-label="实体栏"
            >
              {project ? (
                <EntityRail projectId={project.id} />
              ) : (
                <div className="text-[11px] text-center mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  未加载项目
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* ── 底：花名册 + 批次总控 ── */}
      <footer
        className="shrink-0 flex items-center gap-4 flex-wrap"
        style={{
          height: 42,
          padding: '0 14px',
          borderTop: '0.5px solid hsl(var(--border) / 0.6)',
          background: 'rgb(var(--glass-tint) / 0.3)',
        }}
      >
        {AGENTS.map((a) => (
          <span key={a.key} className="flex items-center gap-1.5" title={a.desc}>
            <span
              className="inline-flex items-center justify-center rounded-full text-white"
              style={{ width: 16, height: 16, background: a.color, fontSize: 9 }}
            >
              {a.short}
            </span>
            <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {a.name}
            </span>
          </span>
        ))}
        <span className="ml-auto text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
          批次 <span style={{ color: 'hsl(var(--foreground))' }}>0 / 0</span>
        </span>
      </footer>
    </div>
  );
}
