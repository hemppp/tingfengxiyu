// ============================================================
// PipelinePanel —— 多智能体协作流水线的进度与闸门
//
// 位置：AI 写作工作台的中栏（正文方块上方）。设计见
// docs/ai-writing-multiagent-pipeline.md。
//
// 它只做三件事：
//   1. 显示 7 个阶段走到哪了（含"已批准但基线已变"的过期提醒）
//   2. 跑当前那一段（SSE，发言会转发到左栏交流流）
//   3. 到闸门时给出三态决策：通过 / 带批注打回 / 退回上一段
//
// ★ 拿不到开书设定就不让启动（后端也会拦，这里提前告诉作者去哪儿补）——
//   没有它立出来的设定会凭空长出来。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Play, Loader2, Check, X } from 'lucide-react';
import {
  fetchPipeline, startPipeline, decidePipeline, runPipelineStage,
  type DecisionAction, type PipelineStageView, type PipelineStatus, type PipelineView, type StageKey,
} from '@/services/ai/pipelineSession';
import { dispatchToastEvent } from '@/utils/errors';

/** 转发到左栏交流流的一条发言（与工作台的 ChatTurn 结构兼容） */
export interface PipelineTurn {
  from: string;
  name: string;
  color: string;
  short: string;
  text: string;
  meta?: string;
  tone?: 'warn' | 'ok';
}

interface PipelinePanelProps {
  projectId: string | null;
  /** 阶段落库后刷新宿主 store（与 entity-sink 的刷新同一条规矩：用宿主已有的实例） */
  onProjectDataChanged?: () => void;
  /** 把发言推进工作台的交流流 */
  onTurn?: (t: PipelineTurn) => void;
  /** 有没有已交付章节：有则默认收起（那时作者的注意力在正文上） */
  hasChapters?: boolean;
  /**
   * 状态变更上报（宿主用它算气泡徽标「n/7」）。
   * 为什么要回调而不是让气泡自己再拉一次：两个地方各请求一次 = 双倍请求 + 状态可能不一致。
   */
  onStatus?: (view: PipelineView | null, status: PipelineStatus | null) => void;
}

const STATUS_DOT: Record<PipelineStageView['status'], string> = {
  approved: 'hsl(var(--state-done))',
  awaiting_user: 'hsl(var(--primary))',
  running: 'hsl(var(--state-running))',
  failed: 'hsl(var(--destructive))',
  idle: 'hsl(var(--muted-foreground) / 0.45)',
};

const STATUS_TEXT: Record<PipelineStageView['status'], string> = {
  approved: '已定稿',
  awaiting_user: '等确认',
  running: '进行中',
  failed: '失败',
  idle: '未开始',
};

const ACTION_TEXT: Record<DecisionAction, string> = { approve: '通过', revise: '打回', reject: '退回' };
const ACTION_COLOR: Record<DecisionAction, string> = {
  approve: 'hsl(var(--state-done))',
  revise: 'hsl(var(--primary))',
  reject: 'hsl(var(--destructive))',
};

/**
 * 实测成本（2026-09-13 真机）：一段 = 三个角色发言 + 主笔回应 + 定稿官收敛 ≈ 5 次模型调用，
 * 1–3 分钟；三段设定跑完约 15–20 次。**必须提前说**，别让作者以为点一下就完事。
 */
const COST_PER_STAGE = '约 5 次模型调用 · 1–3 分钟';
const COST_TOTAL = '三段设定跑完约 15–20 次模型调用';

/** 台账时间：今天只显示时:分，跨天带上月-日 */
function fmtDecisionTime(ts: number): string {
  const d = new Date(ts);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? hhmm : `${d.getMonth() + 1}-${d.getDate()} ${hhmm}`;
}

export function PipelinePanel({ projectId, onProjectDataChanged, onTurn, hasChapters, onStatus }: PipelinePanelProps) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(!hasChapters);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setStatus(await fetchPipeline());
    } catch (e) {
      // 未启动/无项目都会走到这里，不弹 toast（避免每次挂载都吵一次）
      console.warn('[PipelinePanel] 读取流水线状态失败:', e);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** 状态变更上报（气泡徽标用）—— 收在一处，避免每个 setStatus 都补一遍 */
  useEffect(() => {
    onStatus?.(status?.view ?? null, status);
  }, [status, onStatus]);

  // 有章节了默认收起（只在首次拿到数据时决定，之后尊重用户的手动展开/收起）
  const decidedRef = useRef(false);
  useEffect(() => {
    if (decidedRef.current || !status) return;
    decidedRef.current = true;
    setExpanded(!hasChapters);
  }, [status, hasChapters]);

  const view = status?.view ?? null;
  const current: PipelineStageView | null = view?.stages.find((s) => s.key === view.stage) ?? null;

  const handleStart = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await startPipeline(note.trim() || undefined);
      setNote('');
      setStatus({ started: true, hasBrief: true, view: r.view });
      dispatchToastEvent({ type: 'success', message: '流水线已启动，从「开书信息」开始' });
      if (r.baselineMismatch) {
        dispatchToastEvent({ type: 'info', message: '开书设定改过了，已定稿的阶段可能过期', duration: 5000 });
      }
    } catch (e) {
      dispatchToastEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [projectId, note]);

  const handleRun = useCallback(async (stage: StageKey) => {
    if (!projectId || busy) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setPhase('正在召集智能体…');
    setExpanded(true);
    try {
      await runPipelineStage(stage, { signal: ac.signal }, (e) => {
        if (e.type === 'stage_phase') setPhase(e.label);
        else if (e.type === 'stage_turn') {
          onTurn?.({
            from: e.agent, name: e.name, color: e.color, short: e.short, text: e.text, meta: e.meta,
          });
        } else if (e.type === 'stage_summary') {
          onTurn?.({
            from: 'conclusion', name: `《${e.stage === 'cast' ? '角色与节奏宪章' : e.stage === 'bible' ? '世界圣经' : '剧情总纲'}》`,
            color: 'hsl(var(--agent-convener))', short: '稿', text: e.text, tone: 'ok',
          });
        } else if (e.type === 'awaiting_user') {
          setPhase('');
          dispatchToastEvent({ type: 'info', message: '这一段写完了，等你确认', duration: 4000 });
        } else if (e.type === 'stage_skipped') {
          onTurn?.({ from: 'system', name: '流水线', color: 'hsl(var(--primary))', short: '·', text: e.reason });
        } else if (e.type === 'baseline_changed') {
          dispatchToastEvent({
            type: 'info',
            message: `开书设定变了：${e.stale.length} 个已定稿阶段被标记为过期（从这一段起重跑）`,
            duration: 6000,
          });
        } else if (e.type === 'stage_failed') {
          dispatchToastEvent({ type: 'error', message: e.message, duration: 8000 });
          onTurn?.({ from: 'system', name: '流水线', color: 'hsl(var(--state-blocked))', short: '!', text: e.message, tone: 'warn' });
        } else if (e.type === 'error') {
          dispatchToastEvent({ type: 'error', message: e.message, duration: 8000 });
        }
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatchToastEvent({ type: 'error', message: msg, duration: 8000 });
        onTurn?.({ from: 'system', name: '流水线', color: 'hsl(var(--state-blocked))', short: '!', text: msg, tone: 'warn' });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setPhase('');
      await refresh();
    }
  }, [projectId, busy, onTurn, refresh]);

  const handleDecide = useCallback(async (stage: StageKey, action: DecisionAction) => {
    if (!projectId || busy) return;
    if (action === 'revise' && !note.trim()) {
      dispatchToastEvent({ type: 'error', message: '打回要写批注：告诉它哪里不对，否则重跑只是原样再来一遍' });
      return;
    }
    setBusy(true);
    try {
      const r = await decidePipeline(stage, action, note.trim() || undefined);
      setNote('');
      setStatus((s) => (s ? { ...s, view: r.view } : s));
      if (action === 'approve') {
        const st = r.stats;
        if (st) {
          const parts = [
            st.characters.created ? `角色 +${st.characters.created}` : '',
            st.characters.updated ? `角色补全 ${st.characters.updated}` : '',
            st.outline ? `大纲/设定 +${st.outline}` : '',
            st.foreshadows ? `伏笔 +${st.foreshadows}` : '',
            st.skipped ? `跳过 ${st.skipped}` : '',
          ].filter(Boolean).join(' · ');
          dispatchToastEvent({ type: 'success', message: parts ? `已定稿并落库：${parts}` : '已定稿', duration: 5000 });
          for (const n of st.notes) {
            dispatchToastEvent({ type: 'warning', message: n, duration: 8000 });
          }
          onProjectDataChanged?.();
        } else {
          dispatchToastEvent({ type: 'success', message: '已通过' });
        }
      } else if (action === 'reject') {
        dispatchToastEvent({ type: 'info', message: `已退回上一段${r.invalidated.length ? `，作废 ${r.invalidated.length} 段产出` : ''}` });
      } else {
        dispatchToastEvent({ type: 'info', message: '已打回，本段会带着你的批注重跑' });
        if (r.hitRevisionLimit) {
          dispatchToastEvent({
            type: 'warning',
            message: `这一段已经打回 ${r.revisionLimit} 次了 —— 要么按现在这版通过，要么从更早的阶段重开`,
            duration: 9000,
          });
        }
      }
    } catch (e) {
      dispatchToastEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [projectId, busy, note, onProjectDataChanged]);

  if (!projectId) return null;

  const started = status?.started ?? false;
  const hasBrief = status?.hasBrief ?? true;
  const staleSet = new Set(view?.staleStages ?? []);

  // ---- 收起态：一条窄条，别占正文的地方 ----
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="shrink-0 flex items-center gap-2 w-full text-left rounded-xl px-3"
        style={{
          height: 30,
          background: 'rgb(var(--glass-tint) / 0.3)',
          border: '0.5px solid hsl(var(--border) / 0.5)',
          color: 'hsl(var(--muted-foreground))',
        }}
      >
        <ChevronRight size={13} />
        <span className="text-[11px]">设定流水线</span>
        {current && (
          <span className="text-[11px]" style={{ color: 'hsl(var(--foreground))' }}>
            {current.label}
            <span style={{ color: STATUS_DOT[current.status] }}> · {STATUS_TEXT[current.status]}</span>
          </span>
        )}
        {!started && <span className="text-[11px]">未启动</span>}
        {(view?.staleStages.length ?? 0) > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px]" style={{ color: 'hsl(var(--state-blocked))' }}>
            <AlertTriangle size={11} />
            设定已改，建议重跑
          </span>
        )}
      </button>
    );
  }

  return (
    <section
      className="shrink-0 flex flex-col overflow-hidden rounded-xl"
      style={{
        // 中栏已经挤了正文 + 数据面板，这里封顶并内部滚动，别把下面挤没
        maxHeight: 240,
        background: 'rgb(var(--glass-tint) / 0.34)',
        border: '0.5px solid hsl(var(--border) / 0.5)',
      }}
      aria-label="设定流水线"
    >
      <div
        className="shrink-0 flex items-center gap-2"
        style={{ height: 30, padding: '0 10px', borderBottom: '0.5px solid hsl(var(--border) / 0.45)' }}
      >
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="收起流水线"
          style={{ color: 'hsl(var(--muted-foreground))', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}
        >
          <ChevronDown size={13} />
        </button>
        <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))', letterSpacing: '0.06em' }}>
          设定流水线
        </span>
        {loading && <Loader2 size={11} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />}
        {view && (
          <span className="text-[11px] ml-auto" style={{ color: 'hsl(var(--muted-foreground) / 0.8)' }}>
            {view.stages.filter((s) => s.status === 'approved').length} / {view.stages.length} 段已定稿
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 没开书设定：先把话说清楚，别让作者点半天 */}
        {!hasBrief && (
          <div
            className="rounded-lg px-2.5 py-2 text-[11px] leading-[1.7]"
            style={{ background: 'hsl(var(--destructive) / 0.08)', border: '0.5px solid hsl(var(--destructive) / 0.3)', color: 'hsl(var(--destructive))' }}
          >
            这本书还没有开书设定（书名 / 开局 / 世界观 / 笔风 / 主角 / 女主 / 流派）。
            去书架的「编辑书籍」里补全后，这里才立得起来 —— 流水线的起点就是它。
          </div>
        )}

        {/* 未启动 */}
        {!started && hasBrief && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] leading-[1.7]" style={{ color: 'hsl(var(--muted-foreground))' }}>
              从开书设定出发，依次立起：角色与节奏 → 世界观与势力 → 剧情总纲。
              每段都会停下等你确认，确认后才落库、才进下一段。
              <span style={{ color: 'hsl(var(--muted-foreground) / 0.8)' }}>（{COST_TOTAL}）</span>
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="有什么要额外交代的？（可留空）例如：不要太慢热；女主别写成工具人"
              className="w-full resize-none rounded-lg px-2.5 py-2 text-[11px] leading-[1.6] outline-none"
              style={{ background: 'rgb(var(--glass-tint) / 0.5)', border: '0.5px solid hsl(var(--border) / 0.7)', color: 'hsl(var(--foreground))' }}
            />
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="self-start inline-flex items-center gap-1 rounded-full disabled:opacity-40"
              style={{ padding: '5px 14px', fontSize: 12, background: 'hsl(var(--primary) / 0.92)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              开始立设定
            </button>
          </div>
        )}

        {/* 阶段步进条 */}
        {view && (
          <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1">
            {view.stages.map((s) => {
              const isCurrent = s.key === view.stage;
              return (
                <span key={s.key} className="flex items-center gap-1" title={`${s.label} · ${STATUS_TEXT[s.status]}${s.gated ? '（有确认闸门）' : ''}`}>
                  <span
                    className="rounded-full"
                    style={{
                      width: isCurrent ? 9 : 7,
                      height: isCurrent ? 9 : 7,
                      background: STATUS_DOT[s.status],
                      boxShadow: isCurrent ? `0 0 0 3px ${STATUS_DOT[s.status].replace(')', ' / 0.18)')}` : undefined,
                    }}
                    aria-hidden="true"
                  />
                  <span
                    className="text-[11px]"
                    style={{
                      color: isCurrent ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                      fontWeight: isCurrent ? 500 : 400,
                    }}
                  >
                    {s.label}
                    {staleSet.has(s.key) && (
                      <span style={{ color: 'hsl(var(--state-blocked))' }}> ·过期</span>
                    )}
                    {s.revision > 0 && (
                      <span style={{ color: 'hsl(var(--muted-foreground) / 0.7)' }}> ×{s.revision}</span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* 当前段的产出 + 闸门 */}
        {view && current && (
          <>
            {current.artifact && (
              <div
                className="rounded-lg px-2.5 py-2 text-[11px] leading-[1.75] whitespace-pre-wrap"
                style={{
                  background: 'hsl(var(--card) / 0.55)',
                  border: '0.5px solid hsl(var(--border) / 0.5)',
                  color: 'hsl(var(--ink-light))',
                  maxHeight: 150,
                  overflowY: 'auto',
                }}
              >
                {current.artifact}
              </div>
            )}

            {current.status === 'failed' && current.error && (
              <div className="text-[11px] leading-[1.7]" style={{ color: 'hsl(var(--destructive))' }}>
                {current.error}
              </div>
            )}

            {current.status === 'awaiting_user' ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="要打回就写清楚哪里不对（打回必须写）；通过可以不填"
                  className="w-full resize-none rounded-lg px-2.5 py-2 text-[11px] leading-[1.6] outline-none"
                  style={{ background: 'rgb(var(--glass-tint) / 0.5)', border: '0.5px solid hsl(var(--border) / 0.7)', color: 'hsl(var(--foreground))' }}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleDecide(current.key, 'approve')}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full disabled:opacity-40"
                    style={{ padding: '5px 14px', fontSize: 12, background: 'hsl(var(--state-done))', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    通过并落库
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecide(current.key, 'revise')}
                    disabled={busy || !note.trim()}
                    title={note.trim() ? '带着批注重跑这一段' : '先写批注'}
                    className="inline-flex items-center gap-1 rounded-full disabled:opacity-40"
                    style={{ padding: '5px 14px', fontSize: 12, background: 'hsl(var(--primary) / 0.14)', color: 'hsl(var(--primary))', border: '0.5px solid hsl(var(--primary) / 0.4)', cursor: 'pointer' }}
                  >
                    <X size={12} />
                    打回重跑
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecide(current.key, 'reject')}
                    disabled={busy}
                    title="方向就错了：退回上一段重立（本段与更晚的产出作废）"
                    className="rounded-full disabled:opacity-40"
                    style={{ padding: '5px 12px', fontSize: 12, background: 'transparent', color: 'hsl(var(--destructive))', border: '0.5px solid hsl(var(--destructive) / 0.4)', cursor: 'pointer' }}
                  >
                    退回上一段
                  </button>
                  {current.revision > 0 && (
                    <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.8)' }}>
                      已打回 {current.revision} 次
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRun(current.key)}
                  disabled={busy || !current.implemented}
                  title={current.implemented ? `跑这一段（${COST_PER_STAGE}）` : '这一段在 M2/M3 才实现'}
                  className="inline-flex items-center gap-1 rounded-full disabled:opacity-40"
                  style={{ padding: '5px 14px', fontSize: 12, background: 'hsl(var(--primary) / 0.92)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  {current.status === 'failed' ? '重试这一段' : `跑「${current.label}」`}
                </button>
                {!current.implemented && (
                  <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    这一段（{current.label}）尚未实现
                  </span>
                )}
                {busy && phase && (
                  <span className="text-[10px]" style={{ color: 'hsl(var(--primary))' }}>{phase}</span>
                )}
                {!busy && current.implemented && (
                  <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.8)' }}>
                    {COST_PER_STAGE}
                  </span>
                )}
              </div>
            )}

            {busy && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="self-start rounded-md text-[10px] px-2 py-0.5"
                style={{ color: 'hsl(var(--destructive))', border: '0.5px solid hsl(var(--destructive) / 0.4)', background: 'transparent', cursor: 'pointer' }}
              >
                停止
              </button>
            )}

            {/* 最近决策台账：谁在什么时候批了什么、批注是什么。
                数据来自 GET /pipeline/ledger（后端一直在写），这里只是把它显示出来 */}
            {view.decisions.length > 0 && (
              <div
                className="flex flex-col gap-1 pt-1.5"
                style={{ borderTop: '0.5px solid hsl(var(--border) / 0.4)' }}
              >
                <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground))', letterSpacing: '0.08em' }}>
                  最近决策
                </span>
                {(view.decisions ?? []).slice(0, 4).map((d, i) => (
                  <div
                    key={`${d.at}-${i}`}
                    className="flex items-baseline gap-1.5 text-[10px] min-w-0"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    <span className="shrink-0" style={{ color: ACTION_COLOR[d.action] }}>{ACTION_TEXT[d.action]}</span>
                    <span className="shrink-0" style={{ color: 'hsl(var(--foreground) / 0.78)' }}>
                      {view.stages.find((s) => s.key === d.stage)?.label ?? d.stage}
                    </span>
                    <span className="shrink-0" style={{ opacity: 0.7 }}>{fmtDecisionTime(d.at)}</span>
                    {d.note && (
                      <span className="truncate" title={d.note} style={{ opacity: 0.85 }}>· {d.note}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
