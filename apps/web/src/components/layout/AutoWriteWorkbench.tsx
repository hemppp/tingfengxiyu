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
//   │ 底：花名册 + 会话状态                            │
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
  Workflow, ClipboardList, Boxes, ShieldCheck,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import type { Project } from '@novel/shared';
import { useChapterStore, useCharacterStore, useItemStore, useLocationStore, useForeshadowStore } from '@/stores';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WorldStateBoard } from '@/components/layout/WorldStateBoard';
import type { StageKey, StageState } from '@/components/layout/WorkbenchPlan';
import { EntityRail } from '@/components/layout/EntityRail';
import { PipelinePanel, type PipelineTurn } from '@/components/layout/PipelinePanel';
import { BubbleRail, type PanelSignal } from '@/components/layout/BubbleRail';
import { WorkspacePane, clampPaneHeight, type PaneMode } from '@/components/layout/WorkspacePane';
import { TabBar } from '@/components/layout/TabBar';
import { QuickOpen } from '@/components/layout/QuickOpen';
import { MemoryAuditPanel } from '@/components/layout/MemoryAuditPanel';
import { fetchMemoryView, type MemoryView } from '@/services/ai/memorySession';
import {
  BODY_MIN_SOFT, BODY_MIN_WIDTH, BODY_PAD_X, EDITOR_BG, PANE_H_DEFAULT, PANE_W_MIN_SOFT, RAIL_WIDTH,
  type WorkbenchPanel,
} from '@/components/layout/workspaceDefs';
import { runSession, type SessionEvent } from '@/services/ai/autowriteSession';
import type { PipelineView } from '@/services/ai/pipelineSession';

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
// 右侧实体栏并入分页区后，原来的 SIDE_* 三个常量与右分隔条一并删除

export function AutoWriteWorkbench({ project, onBack, onProjectDataChanged }: AutoWriteWorkbenchProps) {
  const chapters = useChapterStore((s) => s.chapters);

  const [railOpen, setRailOpen] = useState(true);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);
  // 右侧实体栏已并入分页区（作为「实体与设定」面板），原来的 sideOpen/sideWidth 与右分隔条一并删掉
  const [hotSplitter, setHotSplitter] = useState<null | 'left'>(null);

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
  /**
   * 阶段推进（讨论 / 写作 / 意图门 / 校对门 / 润色门 / 交付）——
   * 按**收到的事件累积**，不解析 phase 文案（文案会改，事件契约不会）。
   */
  const [stages, setStages] = useState<Partial<Record<StageKey, StageState>>>({});
  /**
   * 连写章数（1 = 单章）。>1 时后端逐章跑完整闭环（讨论→结论→落笔→三道门→交付→沉淀），
   * 后一章自动「接着上一章往下写」，不重复作者这句指令（它是指向第 1 章的）。
   */
  const [chapterCount, setChapterCount] = useState(1);
  /** 连写进度（仅 total > 1 时显示） */
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  /** 当前正文是第几稿：0 = 初稿，≥1 = 被意图门打回后的第 N 次重写 */
  const [revision, setRevision] = useState(0);

  const leftSplitRef = useRef<null | { sx: number; ow: number }>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** 交流流发言推送（定义在下方，这里留 ref 供分页区的面板回调） */
  const onTurnRef = useRef<(t: PipelineTurn) => void>(() => {});

  // ============================================================
  // 分页工作区（AI 写作模式专用，设计见 docs/ui-tab-workspace-design.md）
  //
  //   结构：AI 交流栏 │ 气泡列 │ 正文（常驻，永不卸载）│ 辅助分页区
  //
  // 三条不变量：
  //   ① **正文不进 tabs** —— 它不在分页区里，所以切标签永远不会"替换"它
  //   ② **气泡是显示/隐藏开关** —— 二次点击只收起分页区，不销毁面板（面板里的筛选/滚动都留着）
  //   ③ **任何档位都不覆盖正文** —— 宽度不够时按「收 AI 栏 → 压分页区 → 挪到下方」逐级让位
  // ============================================================
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activePane = useWorkspaceStore((s) => s.active);
  const paneOpen = useWorkspaceStore((s) => s.paneOpen);
  const paneWidth = useWorkspaceStore((s) => s.paneWidth);
  const toggleBubble = useWorkspaceStore((s) => s.toggleBubble);
  const activatePane = useWorkspaceStore((s) => s.activate);
  const openPanel = useWorkspaceStore((s) => s.openPanel);
  /** 双击气泡 = 固定打开（把预览标签晋级；IDE 里双击文件就是这个语义） */
  const openPanelPinned = useCallback((key: string) => openPanel(key, { preview: false }), [openPanel]);
  const closePane = useWorkspaceStore((s) => s.closePanel);
  const closeOthers = useWorkspaceStore((s) => s.closeOthers);
  const closeToRight = useWorkspaceStore((s) => s.closeToRight);
  const promotePane = useWorkspaceStore((s) => s.promote);
  const movePaneTab = useWorkspaceStore((s) => s.moveTab);
  const setPaneOpen = useWorkspaceStore((s) => s.setPaneOpen);
  const setPaneWidth = useWorkspaceStore((s) => s.setWidth);
  const previewKey = useWorkspaceStore((s) => s.previewKey);

  const [quickOpen, setQuickOpen] = useState(false);

  const [paneHeight, setPaneHeight] = useState(PANE_H_DEFAULT);
  const [pipelineView, setPipelineView] = useState<PipelineView | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1600 : window.innerWidth,
    h: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /**
   * 让位阶梯（**绝不覆盖正文**，且**优先让看板留在正文旁边**）。
   *   ① 放得下就并排（用户设的宽度）
   *   ② 放不下 → 自动收 AI 交流栏（空间回来后自动恢复，不改写作者的 railOpen 偏好）
   *   ③ 还放不下 → **先把侧组压窄**（最低 PANE_W_MIN_SOFT）——作者的诉求是"在正文旁边打开"，
   *      所以压窄侧组比把它甩到下方角落更符合预期
   *   ④ 压到最窄仍放不下（窗口极窄）→ 才把侧组挪到正文下方（正文宽度完整，仍**不覆盖**）
   *
   * ★ 预算要含正文外框的内边距（BODY_PAD_X）：漏算的话判定"放得下"、正文实测却比最小宽还窄。
   */
  const bodyBudget = BODY_MIN_WIDTH + BODY_PAD_X;
  const bodyBudgetSoft = BODY_MIN_SOFT + BODY_PAD_X;
  const paneWanted = paneOpen ? paneWidth : 0;
  let aiVisible = railOpen;
  let paneMode: PaneMode = 'right';
  let effectivePaneWidth = paneWidth;
  if (paneOpen) {
    if (viewport.w - RAIL_WIDTH - railWidth - paneWanted < bodyBudget) {
      // ② 收 AI 栏
      aiVisible = false;
      if (viewport.w - RAIL_WIDTH - paneWanted < bodyBudget) {
        // ③ 压窄侧组，保住"在正文旁边"
        effectivePaneWidth = Math.max(
          PANE_W_MIN_SOFT,
          Math.min(paneWanted, viewport.w - RAIL_WIDTH - bodyBudget),
        );
        if (viewport.w - RAIL_WIDTH - effectivePaneWidth < bodyBudgetSoft) {
          // ④ 实在放不下：落到下方（仍不覆盖正文）
          paneMode = 'bottom';
          effectivePaneWidth = paneWanted;
          aiVisible = railOpen && (viewport.w - RAIL_WIDTH - railWidth >= bodyBudgetSoft);
        }
      }
    }
  }
  /** 下方档也要给正文留高：窗口很矮时把分页区压回去，而不是把正文挤没 */
  const effectivePaneHeight = Math.min(paneHeight, Math.max(160, viewport.h - 320));

  // ---- AI 模式的看板清单（**不挂手写面板**：两套 UI 互斥的既有约定不变）----
  const aiPanels = useMemo<WorkbenchPanel[]>(() => [
    { key: 'pipeline', label: '流水线', icon: Workflow, group: 'live', Component: PipelinePanel as WorkbenchPanel['Component'] },
    { key: 'chapterPlan', label: '本章计划', icon: ClipboardList, group: 'live', Component: WorldStateBoard as WorkbenchPanel['Component'] },
    { key: 'entities', label: '实体与设定', icon: Boxes, group: 'data', Component: EntityRail as WorkbenchPanel['Component'] },
    // M-e：记忆审计 / 冲突（分层记忆架构的用户可见面）
    { key: 'memory', label: '记忆审计', icon: ShieldCheck, group: 'data', Component: MemoryAuditPanel as WorkbenchPanel['Component'] },
  ], []);

  /** 面板实时 props：宿主把工作台的状态绑进去（面板本身不接 props 的那套是插件浮窗，不是这里） */
  // ★ onTurn 走 ref 转发：`pushTurn` 在本文件里定义得更靠后（它依赖交流流的滚动收尾），
  //   直接写进依赖数组会撞 TDZ。用 ref 让它在调用时取最新值，既避免时序问题又不丢依赖。
  const hasChaptersInProject = project ? chapters.some((c) => c.projectId === project.id) : false;
  const panelProps = useMemo(() => ({
    projectId: project?.id ?? null,
    hasChapters: hasChaptersInProject,
    conclusion,
    running: busy,
    stages,
    onProjectDataChanged,
    onTurn: (t: PipelineTurn) => onTurnRef.current(t),
    onStatus: (v: PipelineView | null) => setPipelineView(v),
  }), [project?.id, hasChaptersInProject, conclusion, busy, stages, onProjectDataChanged]);

  // 记忆视图（只为徽标服务：有未裁决冲突时提醒）。触发点：项目变化 / 流水线阶段状态变化。
  // ★ 不轮询：审计不是实时指标，每次都要读三张表，为徽标常驻开销不值得。
  const [memoryView, setMemoryView] = useState<MemoryView | null>(null);
  const pipelineSig = pipelineView?.stages.map((st) => st.status).join(',') ?? '';
  useEffect(() => {
    let cancelled = false;
    void fetchMemoryView()
      .then((v) => { if (!cancelled) setMemoryView(v); })
      .catch(() => { /* 徽标失败就算了，不影响工作台 */ });
    return () => { cancelled = true; };
  }, [project?.id, pipelineSig]);

  const entityCount = useCharacterStore((s) => s.characters.length)
    + useLocationStore((s) => s.locations.length)
    + useItemStore((s) => s.items.length)
    + useForeshadowStore((s) => s.foreshadows.length);

  const bubbleSignals = useMemo<Record<string, PanelSignal>>(() => {
    const done = pipelineView?.stages.filter((s) => s.status === 'approved').length ?? 0;
    const total = pipelineView?.stages.length ?? 0;
    return {
      pipeline: {
        ...(total > 0 ? { badge: `${done}/${total}` } : {}),
        ...(pipelineView?.stages.some((s) => s.status === 'running') || busy ? { running: true } : {}),
      },
      chapterPlan: { ...(busy ? { running: true } : {}) },
      // 0 不显示徽标（空项目上挂个「0」是纯噪音）
      entities: { ...(entityCount > 0 ? { badge: entityCount } : {}) },
      // 记忆审计：只在**有未裁决冲突**时挂徽标（这是真正的"记忆污染预警"）
      memory: {
        ...((memoryView?.conflicts.length ?? 0) > 0 ? { badge: memoryView!.conflicts.length } : {}),
      },
    };
  }, [pipelineView, busy, entityCount]);

  // ---- 快捷键（IDE 习惯）：Ctrl+P 快速打开 / Ctrl+B 收起侧组 / Ctrl+\ 分栏 / Ctrl+W 关标签 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const inSide = !!target?.closest('[data-pane-mode]');
      const k = e.key.toLowerCase();

      if (k === 'p') {
        // Ctrl+P 快速打开（IDE 的 Quick Open）
        e.preventDefault();
        setQuickOpen(true);
      } else if (k === 'b') {
        e.preventDefault();
        setPaneOpen(!paneOpen);
      } else if (e.key === '\\') {
        // Ctrl+\ 分栏：有看板就收起/展开侧编辑器组（IDE 里是 split editor）
        e.preventDefault();
        setPaneOpen(!paneOpen);
      } else if (k === 'w' && activePane && paneOpen) {
        // ★ 只在焦点位于侧编辑器组时拦截：否则会和浏览器「关闭标签页」抢
        if (inSide) {
          e.preventDefault();
          closePane(activePane);
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx === 0) activatePane(null);
        else if (tabs[idx - 1]) activatePane(tabs[idx - 1]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paneOpen, activePane, tabs, closePane, activatePane, setPaneOpen]);

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

  // 窗口变窄时收钳 AI 栏宽度，保证正文不被挤没（分页区的高度/宽度各自有自己的钳制）
  useEffect(() => {
    const onResize = () => {
      const avail = window.innerWidth - BODY_MIN_WIDTH;
      setRailWidth((cur) => Math.min(cur, Math.max(RAIL_MIN, avail)));
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, []);

  // ---- 左侧分隔条（对话栏 | 气泡列+正文）：向右拖 = 对话栏变宽 ----
  const onLeftDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    leftSplitRef.current = { sx: e.clientX, ow: railWidth };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [railWidth]);

  const onLeftMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = leftSplitRef.current;
    if (!d) return;
    // 上限同时受「正文最小宽」与「分页区当前宽度」约束：别把正文挤没
    const room = window.innerWidth - BODY_MIN_WIDTH - (paneOpen ? paneWidth : 0);
    const next = Math.min(RAIL_MAX, Math.max(RAIL_MIN, d.ow + (e.clientX - d.sx)), Math.max(RAIL_MIN, room));
    setRailWidth(next);
  }, [paneOpen, paneWidth]);

  const onLeftUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    leftSplitRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const scrollStreamToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = streamRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /**
   * 往交流流里推一条发言。
   * 提到组件作用域（原先只在 runAgent 内部）是因为**设定流水线也要往里推** ——
   * 它的 stage_turn 事件与单章讨论的 turn 是同一种东西，都该出现在同一交流流里。
   */
  const pushTurn = useCallback((turn: Omit<ChatTurn, 'id' | 'time'>) => {
    setTurns((prev) => [...prev, { ...turn, id: nanoid(), time: nowHHMM() }]);
    scrollStreamToEnd();
  }, [scrollStreamToEnd]);
  onTurnRef.current = pushTurn;

  /** 一轮设计讨论：后端逐个扮演角色把发言推回来，事件自带身份（不再靠前端猜） */
  const runAgent = useCallback(async (text: string) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setPhase('正在召集智能体…');
    // 新一轮会话：阶段推进从「讨论」重来
    setStages({ discuss: 'running' });
    setProgress(chapterCount > 1 ? { index: 1, total: chapterCount } : null);

    const push = pushTurn;

    try {
      await runSession(text, { signal: ac.signal, chapterCount }, (e: SessionEvent) => {
        if (e.type === 'chapter_start') {
          // 连写：每章开跑前把上一章的结论/正文/阶段状态清干净，否则会串台
          setProgress({ index: e.index, total: e.total });
          if (e.total > 1) {
            setConclusion(null);
            setProse(null);
            setStages({ discuss: 'running' });
            push({
              from: 'system', name: `第 ${e.order} 章`, color: 'hsl(var(--primary))', short: '章',
              text: `开始第 ${e.index} / ${e.total} 章`,
            });
          }
        } else if (e.type === 'chapter_done') {
          // 一章收尾（不论是否交付成功都会发）—— 让作者知道 30 章跑到第几章了
          push({
            from: e.delivered ? 'delivered' : 'system',
            name: `第 ${e.order} 章`,
            color: e.delivered ? 'hsl(var(--state-done))' : 'hsl(var(--state-blocked))',
            short: e.delivered ? '✓' : '!',
            text: e.delivered
              ? `第 ${e.order} 章完成（${e.index}/${e.total}）`
              : `第 ${e.order} 章未完成（${e.index}/${e.total}），已继续下一章`,
            tone: e.delivered ? 'ok' : 'warn',
          });
          if (e.index >= e.total) setProgress(null);
        } else if (e.type === 'phase') {
          setPhase(e.label);
        } else if (e.type === 'turn') {
          push({
            from: e.agent, name: e.name, color: e.color, short: e.short,
            text: e.text, meta: e.meta,
          });
        } else if (e.type === 'conclusion') {
          // 结论是契约：既进交流流（留痕），也进中栏计划卡（供后续写作/复核对照）
          setConclusion(e.text);
          setStages((s) => ({ ...s, discuss: 'done', write: 'running' }));
          push({
            from: 'conclusion', name: '本章结论', color: 'hsl(var(--agent-convener))', short: '结',
            text: e.text, kind: 'conclusion',
          });
        } else if (e.type === 'draft') {
          // 正文落点：同一份文本既作为写作官的发言进交流流，也进中上正文方块
          setProse(e.text);
          setRevision(e.revision);
          setStages((s) => ({ ...s, write: 'done', review: 'running' }));
        } else if (e.type === 'review') {
          // 复核结论进交流流留痕；tone 让打回一眼能认出来
          push({
            from: 'reviewer', name: '意图复核', color: '#534AB7', short: '核',
            text: e.text,
            meta: e.passed ? '通过' : `第 ${e.attempt} 次打回`,
            tone: e.passed ? 'ok' : 'warn',
          });
          // 通过 → 意图门完成、进入校对门；打回 → 停在意图门（写作官正在重写）
          setStages((s) => (e.passed ? { ...s, review: 'done', check: 'running' } : { ...s, review: 'running' }));
        } else if (e.type === 'gate') {
          // 校对门 / 润色门（三道门里的后两道）—— 与意图门一样，结论进交流流留痕。
          // 注意：校对门 passed=false **不代表没交付**（它只做一次定向修订，之后照样交付），
          // 所以 meta 里写明「不拦交付」，别让作者误以为整章废了。
          const isCheck = e.name === 'check';
          push({
            from: 'gate',
            name: isCheck ? '校对门' : '润色门',
            color: isCheck ? 'hsl(var(--state-blocked))' : 'hsl(var(--entity-foreshadow))',
            short: isCheck ? '校' : '润',
            text: !isCheck && typeof e.score === 'number' ? `${e.score}/10 · ${e.detail}` : e.detail,
            meta: e.passed ? '通过' : (isCheck ? '有冲突（不拦交付）' : '低于通过线'),
            tone: e.passed ? 'ok' : 'warn',
          });
          // 校对门做完 → 进润色门；润色门做完 → 进交付。两道门都不阻塞流程，
          // 所以状态只区分「完成 / 有冲突」，不表示流程中断。
          setStages((s) => (isCheck
            ? { ...s, check: e.passed ? 'done' : 'blocked', polish: 'running' }
            : { ...s, polish: e.passed ? 'done' : 'blocked', deliver: 'running' }));
        } else if (e.type === 'delivered') {
          // warnings：交付了但需要人工复核（例如意图门打回上限用尽仍交付）——
          // 连写时不丢章，但必须让作者知道哪一章要回头看
          const warn = e.warnings?.length ? `\n⚠ ${e.warnings.join('；')}` : '';
          push({
            from: 'delivered', name: '交付', color: '#0F6E56', short: '✓',
            text: `${e.created ? '已新建并写入' : '已写入'} ${e.title}（${e.wordCount} 字）${warn}`,
            tone: e.warnings?.length ? 'warn' : 'ok',
          });
          setStages((s) => ({ ...s, deliver: 'done' }));
        } else if (e.type === 'deliver_blocked') {
          push({
            from: 'deliver-blocked', name: '交付', color: '#A32D2D', short: '!',
            text: e.title ? `${e.title}：${e.reason}` : e.reason,
            tone: 'warn',
          });
          setStages((s) => ({ ...s, deliver: 'blocked' }));
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
  }, [pushTurn, scrollStreamToEnd, onProjectDataChanged, chapterCount]);

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

  /**
   * 正在查看的章号（库里的）。
   *
   * ★ 为什么需要它：正文区原先只显示 `prose` —— 那是**本次会话**流出来的稿子，
   *   页面一刷新就没了，于是「30 章都在库里」和「界面上什么都看不到」同时成立。
   *   AI 写作模式又没有章节编辑器的入口，等于写完了却没法读。
   */
  const [viewOrder, setViewOrder] = useState<number | null>(null);
  /** 默认落在最新一章；只有用户没手动切、或那一章被删了才重设 */
  useEffect(() => {
    if (projChapters.length === 0) return;
    setViewOrder((cur) =>
      cur != null && projChapters.some((c) => c.order === cur)
        ? cur
        : (projChapters[projChapters.length - 1]?.order ?? null),
    );
  }, [projChapters]);
  const viewChapter = useMemo(
    () => (viewOrder != null ? projChapters.find((c) => c.order === viewOrder) ?? null : null),
    [projChapters, viewOrder],
  );
  /** 正文区显示什么：**本次会话刚产出的稿优先**（那是刚发生的事），否则读库里那一章 */
  const shownText = prose ?? viewChapter?.content ?? null;

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
            onClick={() => setPaneOpen(!paneOpen)}
            className="nm-btn-apple-icon-sm"
            title={paneOpen ? '收起分页区（Ctrl+B）' : '展开分页区（Ctrl+B）'}
            aria-label={paneOpen ? '收起分页区' : '展开分页区'}
            aria-pressed={paneOpen}
          >
            {paneOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative z-10">

        {/* ── 侧栏：智能体对话（aiVisible = 作者的偏好 且 让位阶梯允许） ── */}
        {aiVisible && (
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
                        说清这一章要写什么，写明章号（例如「写第 2 章：陈默去公司查姐姐的行踪」）。
                        <br />
                        <span style={{ color: 'hsl(var(--muted-foreground) / 0.8)' }}>
                          剧情设计师 / 角色设计师 / 设定管家会先来回讨论，定稿官收敛成本章结论，
                          写作官据此落笔并过三道门 —— 发言按时间展开，随时可在下方插话。
                          <br />
                          想连着写就在输入框右下角设「连写 N 章」：从章号起逐章写下去，每章都会完整走完复核与沉淀。
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
                    // 进工作台就把焦点给输入框：作者来这里就是要说话的。
                    // （顺带让「无人值守驱动界面」这条链路能用键盘走完，不必依赖点击坐标 —— 实测坐标点击在
                    //   满屏/窗口位移时并不可靠）
                    autoFocus
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

                  {/* 连写章数：>1 时后端逐章跑完整闭环（讨论 → 结论 → 三道门 → 交付 → 沉淀），
                      后续章自动「接着上一章往下写」。每章约一分钟，别在忙的时候改它 */}
                  {!busy && (
                    <label
                      className="ml-auto flex items-center gap-1 text-[10px] shrink-0"
                      style={{ color: 'hsl(var(--muted-foreground))' }}
                      title="连写章数：从指令里的章号开始逐章写，每章约一分钟"
                    >
                      连写
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={chapterCount}
                        onChange={(ev) => {
                          const n = Math.floor(Number(ev.target.value) || 1);
                          setChapterCount(Math.max(1, Math.min(50, n)));
                        }}
                        className="rounded-md text-center"
                        style={{
                          width: 40,
                          height: 20,
                          background: 'rgb(var(--glass-tint) / 0.5)',
                          border: '0.5px solid hsl(var(--border) / 0.8)',
                          color: 'hsl(var(--ink))',
                        }}
                      />
                      章
                    </label>
                  )}

                  {progress && (
                    <span className="text-[10px] shrink-0 ml-auto" style={{ color: 'hsl(var(--primary))' }}>
                      第 {progress.index} / {progress.total} 章
                    </span>
                  )}

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
          </>
        )}

        {/* ── 功能看板气泡列：紧贴 AI 对话区**右边**，竖直漂浮 ──
            单击 = 预览打开（会被下一个预览顶掉）；双击 = 固定打开 */}
        <BubbleRail
          panels={aiPanels}
          openKeys={tabs}
          activeKey={activePane}
          previewKey={previewKey}
          signals={bubbleSignals}
          onToggle={toggleBubble}
          onPin={(key) => openPanelPinned(key)}
        />

        {/* AI 栏与（气泡列 + 编辑器区）之间的分隔条：向右拖 = 对话栏变宽 */}
        {aiVisible && (
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
        )}

        {/* ── 主区：编辑器组 1（正文，常驻）+ 下方的编辑器组 2（宽度不够时才落下来）── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* ★ 编辑器组 1 的标签栏：只有一个固定的「正文」项，不可关闭。
                它是"主编辑器里打开的那份稿子" —— 组 2 怎么切都动不到这里 */}
            <TabBar
              panels={aiPanels}
              tabs={tabs}
              active={activePane}
              variant="main"
              onActivate={() => activatePane(null)}
              onBackToBody={() => activatePane(null)}
              bodyFocused={!paneOpen || activePane === null}
              bodySubtitle={viewChapter ? `第 ${viewChapter.order} 章 · ${viewChapter.wordCount ?? 0} 字` : undefined}
            />
            {/* 正文区域：占据剩余全部高度。★ **永不参与分页、永不卸载** ——
                切标签只影响侧编辑器组，这里的 DOM 与滚动位置一个字节都不动 */}
            <section
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
              style={{ background: EDITOR_BG }}
              aria-label="正文"
            >
            <div
              className="shrink-0 flex items-center gap-2"
              style={{ height: 30, padding: '0 14px', borderBottom: '0.5px solid hsl(var(--border) / 0.45)' }}
            >
              {/* 编辑器头部：章节切换 + 稿件状态（IDE 这里放的是面包屑，我们放章号） */}
              <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))', letterSpacing: '0.06em' }}>
                {viewChapter ? `第 ${viewChapter.order} 章` : '未建章'}
              </span>
              {/* 章节切换：AI 模式没有章节编辑器，这里就是唯一的「读已写章节」入口 */}
              {projChapters.length > 0 && (
                <select
                  value={viewOrder ?? ''}
                  onChange={(ev) => {
                    setViewOrder(Number(ev.target.value));
                    setProse(null); // 切章看库内容，不再占着本次会话的稿
                  }}
                  className="text-[11px] bg-transparent outline-none cursor-pointer truncate"
                  style={{ color: 'hsl(var(--muted-foreground) / 0.85)', maxWidth: 170, border: 'none' }}
                  title="切换查看已交付的章节"
                >
                  {projChapters.map((c) => (
                    <option key={c.id} value={c.order}>
                      第 {c.order} 章 · {c.wordCount ?? 0} 字
                    </option>
                  ))}
                </select>
              )}
              {prose ? (
                <span className="ml-auto text-[10px]" style={{ color: 'hsl(var(--state-running))' }}>
                  {revision > 0 ? `第 ${revision} 次重写` : '本次生成'}
                </span>
              ) : viewChapter ? (
                <span className="ml-auto text-[10px]" style={{ color: 'hsl(var(--muted-foreground) / 0.7)' }}>
                  已入库 · {viewChapter.wordCount ?? 0} 字
                </span>
              ) : null}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              {shownText ? (
                <div
                  className="font-serif whitespace-pre-wrap"
                  style={{ fontSize: 13.5, lineHeight: 1.9, color: 'hsl(var(--foreground))' }}
                >
                  {shownText}
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
                        这一章还没有正文
                      </div>
                      <p className="text-[11px] leading-[1.8]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        用上方下拉切到别的章节看看，或在左侧让智能体写这一章。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
          </div>

          {/* 下方分页区：只有宽度真的不够（收掉 AI 栏也放不下正文）时才落到这里 ——
              正文保持**完整宽度**，只是高度变小；**绝不覆盖正文** */}
          {paneMode === 'bottom' && (
            <WorkspacePane
              mode="bottom"
              open={paneOpen}
              height={effectivePaneHeight}
              onHeightChange={(h) => setPaneHeight(clampPaneHeight(h))}
              panels={aiPanels}
              tabs={tabs}
              active={activePane}
              previewKey={previewKey}
              onActivate={activatePane}
              onClose={closePane}
              onCloseOthers={closeOthers}
              onCloseRight={closeToRight}
              onPromote={promotePane}
              onOpenQuick={() => setQuickOpen(true)}
              onMoveTab={movePaneTab}
              panelProps={panelProps}
            />
          )}
        </div>

        {/* ── 编辑器组 2（侧组）：看板在这里以标签方式打开 ── */}
        {paneMode === 'right' && (
          <WorkspacePane
            mode="right"
            open={paneOpen}
            width={effectivePaneWidth}
            onWidthChange={setPaneWidth}
            panels={aiPanels}
            tabs={tabs}
            active={activePane}
            previewKey={previewKey}
            onActivate={activatePane}
            onClose={closePane}
            onCloseOthers={closeOthers}
            onCloseRight={closeToRight}
            onPromote={promotePane}
            onOpenQuick={() => setQuickOpen(true)}
            onMoveTab={movePaneTab}
            panelProps={panelProps}
          />
        )}
      </div>

      {/* ── 状态栏（IDE 的底条）：左＝花名册，右＝当前状态 ── */}
      <footer
        className="shrink-0 flex items-center gap-4 flex-wrap"
        style={{
          height: 26,
          padding: '0 14px',
          borderTop: '0.5px solid hsl(var(--border) / 0.6)',
          background: 'rgb(var(--glass-tint) / 0.42)',
        }}
        aria-label="状态栏"
      >
        {AGENTS.map((a) => (
          <span key={a.key} className="flex items-center gap-1.5" title={a.desc}>
            <span
              className="inline-flex items-center justify-center rounded-full text-white"
              style={{ width: 14, height: 14, background: a.color, fontSize: 8 }}
            >
              {a.short}
            </span>
            <span className="text-[10.5px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {a.name}
            </span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 text-[10.5px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {pipelineView && (
            <span title="设定流水线进度">
              流水线 <span style={{ color: 'hsl(var(--foreground))' }}>
                {pipelineView.stages.filter((s) => s.status === 'approved').length}/{pipelineView.stages.length}
              </span>
            </span>
          )}
          <span title="库中章节数">
            库中 <span style={{ color: 'hsl(var(--foreground))' }}>{chapters.length}</span> 章
          </span>
          <span title="侧编辑器组当前看板">
            组 2：<span style={{ color: 'hsl(var(--foreground))' }}>
              {activePane ? (aiPanels.find((p) => p.key === activePane)?.label ?? activePane) : '未打开'}
            </span>
          </span>
          <span style={{ opacity: 0.75 }}>Ctrl+P 快速打开 · Ctrl+\ 分栏 · Ctrl+W 关标签</span>
        </span>
      </footer>

      {/* Ctrl+P 快速打开（IDE 的 Quick Open） */}
      <QuickOpen
        open={quickOpen}
        panels={aiPanels}
        openKeys={tabs}
        onPick={(key) => openPanelPinned(key)}
        onClose={() => setQuickOpen(false)}
      />
    </div>
  );
}
