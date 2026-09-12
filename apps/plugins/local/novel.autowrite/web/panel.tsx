// ============================================================
// 自动写作 —— 独立浮窗面板
//
// 工作台顶部气泡打开；轮询状态路由（5s），展示：
//   批次列表 → 选中批次：总进度 + 逐章流转状态 + 审计台账（最近 50 条）
// 暂停/隔离的批次提供「恢复」按钮（人工显式操作，写台账）。
// 编排动作仍在 AI 聊天里进行——面板与聊天共享同一份 KV 状态。
// ============================================================

import React from 'react';
import { Loader2, RotateCcw, ScrollText, Sparkles, Zap, X } from 'lucide-react';
import type { WebApiFetch } from '@novel/core/web';
import { SkillsBar } from '@/components/ai/ChatPanel';

let apiFetch: WebApiFetch = (path, init) => fetch(path, init);

/** 由 apply() 注入（替代裸 fetch） */
export function setApiFetch(fn: WebApiFetch): void {
  apiFetch = fn;
}

// ============================================================
// 技能气泡 —— 贴附在自动写作浮窗左缘外侧（与 AI 对话气泡栏同款交互：
// 一个「技能」气泡包住全部技能，点击弹出选择网格，而不是逐个摊开）
// 选中 = 打开 AI 对话并激活该技能（nm:open-panel + nm-chat:skill 事件桥）
// ============================================================

function SkillBubble({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="group relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95"
      style={{
        background: active
          ? 'linear-gradient(160deg, hsl(var(--primary)), hsl(var(--primary) / 0.75))'
          : 'radial-gradient(circle at 30% 26%, rgb(255 255 255 / 0.9), rgb(var(--glass-tint) / 0.35) 55%)',
        border: `1px solid ${active ? 'hsl(var(--primary))' : 'rgb(255 255 255 / 0.6)'}`,
        boxShadow: active
          ? '0 4px 16px hsl(var(--primary) / 0.4), inset 0 1px 4px rgb(255 255 255 / 0.5)'
          : '0 3px 12px hsl(var(--foreground) / 0.14), inset 0 1px 4px rgb(255 255 255 / 0.7)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--ink) / 0.7)',
      }}
    >
      <Zap size={16} aria-hidden="true" />
      <span
        className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          color: 'hsl(var(--ink))',
          background: 'rgb(var(--glass-tint) / 0.85)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {label}
      </span>
    </button>
  );
}

/** 技能气泡：自动写作浮窗左缘外侧（单气泡 + 弹出技能网格）
 *  ★ 智能翻转 + 宽度钳制：按浮窗两侧剩余空间选择翻出方向（不足 420px 一律向更宽一侧翻，
 *    平局取左与 AI 对话一致）；弹层宽度按该侧空间钳制，保证完整落在视口内。
 *  拖拽结束（pointerup）与窗口缩放时重算。 */
export function AutowriteSkillRail() {
  const [open, setOpen] = React.useState(false);
  const [side, setSide] = React.useState<'left' | 'right'>('left');
  const [flyoutWidth, setFlyoutWidth] = React.useState(320);
  const railRef = React.useRef<HTMLDivElement>(null);

  const measure = React.useCallback(() => {
    // offsetParent = 浮窗根（absolute 定位基准）
    const host = (railRef.current?.offsetParent as HTMLElement | null);
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const leftRoom = rect.left;                       // 浮窗左缘到屏幕左缘
    const rightRoom = window.innerWidth - rect.right; // 浮窗右缘到屏幕右缘
    const next: 'left' | 'right' = rightRoom > leftRoom ? 'right' : 'left';
    setSide(next);
    // 弹层宽度 = 该侧空间 - 气泡 56px - 间隙 16px，上限 320
    const room = next === 'left' ? leftRoom : rightRoom;
    setFlyoutWidth(Math.max(240, Math.min(320, Math.floor(room) - 72)));
  }, []);

  React.useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('pointerup', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('pointerup', measure);
    };
  }, [measure]);

  // 与 AI 对话同款事件桥：选中 → 打开聊天浮窗并激活技能；传 null = 取消当前技能
  const pick = (id: string | null) => {
    if (id != null) {
      window.dispatchEvent(new CustomEvent('nm:open-panel', { detail: { key: 'ai-chat' } }));
    }
    window.dispatchEvent(new CustomEvent('nm-chat:skill', { detail: id }));
    setOpen(false);
  };

  return (
    <div
      ref={railRef}
      className={`absolute top-4 flex flex-col items-center gap-2.5 z-20 ${side === 'left' ? '-left-14' : '-right-14'}`}
      role="toolbar"
      aria-label="自动写作技能气泡"
    >
      <SkillBubble label="选择技能" active={open} onClick={() => setOpen((v) => !v)} />

      {open && (
        <div
          className={`absolute top-0 max-h-[65vh] overflow-y-auto p-3 rounded-2xl space-y-2 nm-glass-frost ${side === 'left' ? 'right-12' : 'left-12'}`}
          style={{ width: flyoutWidth, border: '1px solid hsl(var(--border) / 0.5)' }}
          role="dialog"
          aria-label="选择技能"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">技能 · 选中后在 AI 对话生效</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="nm-btn-apple-icon-sm"
              aria-label="关闭技能选择"
              title="关闭"
            >
              <X size={12} />
            </button>
          </div>
          {/* 复用核心 SkillsBar（embedded 网格）；技能数据与图标均来自注册表/插件注册 */}
          <SkillsBar
            embedded
            activeSkillId={null}
            onActivate={(id) => pick(id)}
            onCancel={() => pick(null)}
            disabled={false}
          />
        </div>
      )}
    </div>
  );
}

// ---- 数据视图（与服务端 routes.ts 的 JSON 对齐） ----

type FlowStepDto = 'planned' | 'written' | 'checked' | 'polished' | 'delivered';

interface ChapterDto {
  order: number;
  title: string;
  brief: string;
  step: FlowStepDto;
  revisions: number;
  checkFails: number;
  polishFails: number;
  usedChars: number;
  checkPass?: boolean;
  conflicts?: string[];
  polishScore?: number;
  polishComments?: string;
  summary?: string;
}

interface BatchDto {
  id: string;
  from: number;
  to: number;
  status: 'planned' | 'running' | 'gate' | 'paused' | 'quarantined' | 'done';
  note?: string;
  cursor: number;
  createdAt: number;
  total: number;
  delivered: number;
  chapters: ChapterDto[];
}

interface AuditDto {
  ts: number;
  step: string;
  order?: number;
  model?: string;
  ms?: number;
  decision: string;
}

const STEP_META: Record<FlowStepDto, { label: string; color: string }> = {
  planned: { label: '待写作', color: 'hsl(var(--ink-pale))' },
  written: { label: '已出稿', color: 'hsl(var(--mist-blue, 205 30% 60%))' },
  checked: { label: '校对过', color: 'hsl(var(--primary))' },
  polished: { label: '润色完', color: 'hsl(var(--primary))' },
  delivered: { label: '已交付', color: 'hsl(var(--willow, 152 45% 42%))' },
};

const STATUS_META: Record<BatchDto['status'], { label: string; color: string }> = {
  planned: { label: '已规划', color: 'hsl(var(--ink-light))' },
  running: { label: '流转中', color: 'hsl(var(--primary))' },
  gate: { label: '待确认', color: '#d97706' },
  paused: { label: '已暂停', color: '#d97706' },
  quarantined: { label: '已隔离', color: 'hsl(var(--destructive))' },
  done: { label: '已完成', color: 'hsl(var(--willow, 152 45% 42%))' },
};

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

export function AutowritePanel() {
  const [batches, setBatches] = React.useState<BatchDto[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [audit, setAudit] = React.useState<AuditDto[]>([]);
  const [showAudit, setShowAudit] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/plugins/autowrite/batches');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) as { batches?: BatchDto[] };
      const list = data.batches ?? [];
      setBatches(list);
      setError('');
      // 默认选中最新活跃批次；当前选中项若已消失则回落
      setSelectedId((prev) => (prev && list.some((b) => b.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 批次列表轮询 + 详情（台账）随选中项加载
  React.useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  React.useEffect(() => {
    if (!selectedId) { setAudit([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/plugins/autowrite/batches/${selectedId}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = (await res.json()) as { audit?: AuditDto[] };
        if (alive) setAudit(data.audit ?? []);
      } catch { /* 详情拉取失败静默，下一轮轮询自愈 */ }
    })();
    return () => { alive = false; };
  }, [selectedId, batches]);

  const selected = batches.find((b) => b.id === selectedId) ?? null;

  const resume = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/plugins/autowrite/batches/${id}/resume`, { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  // ---- 渲染 ----

  if (loading && batches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[13px]" style={{ color: 'hsl(var(--ink-light))' }}>
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> 加载批次中…
      </div>
    );
  }

  if (error && batches.length === 0) {
    return <div className="p-4 text-[13px]" style={{ color: 'hsl(var(--destructive))' }}>加载失败：{error}</div>;
  }

  if (batches.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
        <Sparkles size={28} style={{ color: 'hsl(var(--primary) / 0.55)' }} aria-hidden="true" />
        <div className="text-[14px] font-medium" style={{ color: 'hsl(var(--ink))' }}>还没有自动写作批次</div>
        <div className="text-[12.5px] leading-6" style={{ color: 'hsl(var(--ink-light))' }}>
          打开 AI 聊天，选「自动写作」技能，说「从第 X 章写到第 Y 章」发起批次。
          <br />批次建立后这里会实时点亮每一章的流转进度。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col text-[13px]">
      {/* 批次切换条 */}
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2 overflow-x-auto shrink-0">
        {batches.map((b) => {
          const active = b.id === selectedId;
          const sm = STATUS_META[b.status];
          return (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              className="px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors border"
              style={{
                fontSize: 12,
                borderColor: active ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--border) / 0.5)',
                background: active ? 'hsl(var(--primary) / 0.10)' : 'transparent',
                color: active ? 'hsl(var(--primary))' : 'hsl(var(--ink-light))',
              }}
            >
              第{b.from}-{b.to}章 · {b.delivered}/{b.total}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0">
          {/* 批次头：状态 + 进度 */}
          <div className="rounded-xl border px-3 py-2.5 mb-2" style={{ borderColor: 'hsl(var(--border) / 0.5)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold" style={{ color: 'hsl(var(--ink))' }}>
                  第 {selected.from}-{selected.to} 章
                </span>
                <span
                  className="px-1.5 py-0.5 rounded-md text-[11px] shrink-0"
                  style={{ background: `${STATUS_META[selected.status].color}1a`, color: STATUS_META[selected.status].color }}
                >
                  {STATUS_META[selected.status].label}
                </span>
              </div>
              {(selected.status === 'paused' || selected.status === 'quarantined') && (
                <button
                  onClick={() => resume(selected.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] border transition-opacity disabled:opacity-40"
                  style={{ borderColor: 'hsl(var(--primary) / 0.4)', color: 'hsl(var(--primary))' }}
                  title="人工恢复批次（编排器将从断点继续）"
                >
                  <RotateCcw size={11} aria-hidden="true" /> 恢复
                </button>
              )}
            </div>
            {selected.note && (
              <div className="mt-1.5 text-[12px]" style={{ color: STATUS_META[selected.status].color }}>
                {selected.note}
              </div>
            )}
            {/* 进度条 */}
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--border) / 0.4)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${selected.total ? (selected.delivered / selected.total) * 100 : 0}%`, background: 'hsl(var(--primary))' }}
              />
            </div>
            <div className="mt-1 text-[11px]" style={{ color: 'hsl(var(--ink-pale))' }}>
              {selected.delivered}/{selected.total} 章已交付 · 建于 {timeStr(selected.createdAt)}
            </div>
          </div>

          {/* 逐章状态 */}
          <div className="space-y-1.5">
            {selected.chapters.map((ch) => {
              const sm = STEP_META[ch.step];
              return (
                <div
                  key={ch.order}
                  className="rounded-lg border px-2.5 py-2"
                  style={{ borderColor: 'hsl(var(--border) / 0.4)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate" style={{ color: 'hsl(var(--ink))' }}>
                      第{ch.order}章 · {ch.title}
                    </span>
                    <span className="shrink-0 text-[11.5px]" style={{ color: sm.color }}>
                      {ch.step === 'written' && ch.checkFails > 0 ? `✗ 校对打回×${ch.checkFails}` : sm.label}
                      {ch.step === 'written' && ch.checkFails === 0 && ch.polishFails > 0 ? `（评分${ch.polishScore ?? '—'}打回）` : ''}
                    </span>
                  </div>
                  {ch.conflicts && ch.conflicts.length > 0 && (
                    <div className="mt-1 text-[11.5px] leading-5" style={{ color: 'hsl(var(--destructive) / 0.85)' }}>
                      {ch.conflicts.join('；')}
                    </div>
                  )}
                  {ch.summary && ch.step === 'delivered' && (
                    <div className="mt-1 text-[11.5px] leading-5" style={{ color: 'hsl(var(--ink-light))' }}>
                      {ch.summary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 审计台账（可折叠） */}
          <div className="mt-3">
            <button
              onClick={() => setShowAudit((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-lg border transition-colors"
              style={{ borderColor: 'hsl(var(--border) / 0.5)', color: 'hsl(var(--ink-light))' }}
            >
              <ScrollText size={11} aria-hidden="true" />
              审计台账（{audit.length}）
            </button>
            {showAudit && (
              <div
                className="mt-1.5 rounded-lg border px-2.5 py-2 max-h-56 overflow-y-auto font-mono"
                style={{ borderColor: 'hsl(var(--border) / 0.4)', fontSize: 11, lineHeight: 1.7 }}
              >
                {audit.length === 0 ? (
                  <span style={{ color: 'hsl(var(--ink-pale))' }}>（暂无记录）</span>
                ) : (
                  audit.map((e, i) => (
                    <div key={i} style={{ color: 'hsl(var(--ink-light))' }}>
                      <span style={{ color: 'hsl(var(--ink-pale))' }}>{timeStr(e.ts)}</span>{' '}
                      <span style={{ color: 'hsl(var(--primary))' }}>{e.step}</span>
                      {e.order != null ? <span>·第{e.order}章</span> : null} {e.decision}
                      {e.ms != null ? <span style={{ color: 'hsl(var(--ink-pale))' }}> {e.ms}ms</span> : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="mt-3 text-[11px] text-center" style={{ color: 'hsl(var(--ink-pale))' }}>
            编排与交付在 AI 聊天中进行，面板每 5 秒自动刷新
          </div>
        </div>
      )}
    </div>
  );
}
