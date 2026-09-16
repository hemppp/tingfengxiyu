import React, { useState, useEffect, Suspense, useCallback, useRef, useMemo, lazy } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen, Settings, LogOut, User, MessageSquare,
  X, Shield, AlertTriangle,
} from 'lucide-react';
import { useProjectStore } from '@/stores';
import { useReferenceStore } from '@/stores/referenceStore';
import { InkBackButton } from '@/components/ui/InkBackButton';
import { useAuthStore } from '@/stores/authStore';
import { PATHS } from '@/routes/paths';
import { apiClient } from '@/services/api/apiClient';
import { useSyncService } from '@/services/data/syncService';
import type { Project } from '@novel/shared';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { PanelSection } from '@/components/layout/PanelSection';
import { FloatingBubbles } from '@/components/layout/FloatingBubbles';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { usePluginRegistry } from '@/plugin/registry';
import { usePanelOpenStore } from '@/stores/panelOpenStore';
import type { FloatingPanelDef } from '@/plugin/types';
import type { ChatPanelControlProps } from '@/components/ai/ChatPanel';
import { AiChatBubbleRail } from '@/components/ai/AiChatBubbleRail';

// ★ 浮窗面板已插件化：面板定义在 src/plugin/builtin.ts 注册（12 个内置面板 + 编辑器面板），
// 这里通过 usePluginRegistry 订阅，宿主只负责渲染/拖拽/限流。
// 章节与 AI 对话面板不受面板数上限限制（上限在 panelOpenStore）。
const ChatPanel = lazy(() => import('@/components/ai/ChatPanel').then(m => ({ default: m.ChatPanel })));

// AI 写作模式的工作台：独立懒加载 chunk —— 手写模式不会为它付出任何包体代价
const AutoWriteWorkbench = lazy(() =>
  import('@/components/layout/AutoWriteWorkbench').then(m => ({ default: m.AutoWriteWorkbench })),
);

function PanelFallback() {
  return (
    <div className="h-full flex items-center justify-center" aria-label="Loading" role="status">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin" size={20} style={{ color: '#aeaeb2' }} />
        <span className="text-[12px]" style={{ color: '#aeaeb2' }}>Loading...</span>
      </div>
    </div>
  );
}

// 面板级渲染边界：面板组件（内置或插件注册）抛错只隔离在本面板内，
// 不再冒泡到根 ErrorBoundary 导致整个应用被替换成错误页。重试 = 换 key 重挂。
function PanelGuard({ label, children }: { label: string; children: React.ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ErrorBoundary
      key={attempt}
      renderError={function(error) {
        return (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center overflow-auto">
            <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
            <div className="text-[12px]" style={{ color: '#aeaeb2' }}>「{label}」面板组件运行出错，已隔离在本面板内</div>
            <div className="text-[11px] font-mono break-all max-w-full" style={{ color: '#f59e0b' }}>
              {String(error.message || error)}
              <br />
              {(error.stack || '').split('\n').slice(1, 5).join('\n')}
            </div>
            <button
              type="button"
              className="nm-btn-mist-soft px-3 py-1 rounded-md text-xs"
              onClick={() => setAttempt(function (a) { return a + 1; })}
            >
              重试
            </button>
          </div>
        );
      }}
      fallback={
        <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
          <div className="text-[12px]" style={{ color: '#aeaeb2' }}>「{label}」面板组件运行出错，已隔离在本面板内</div>
          <button
            type="button"
            className="nm-btn-mist-soft px-3 py-1 rounded-md text-xs"
            onClick={() => setAttempt(function (a) { return a + 1; })}
          >
            重试
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

// ★ 面板内容壳（memo）：props 引用稳定（config 来自插件注册表的常量定义），
//   抓取/松手/拖拽中任何宿主 state 变化都不再波及内容子树——此前图表/力导向图/
//   地图等重组件在每次重渲染时被整棵重算，是拖拽起手顿挫的主因。
//   AI 对话面板例外：chatControls 变化时需要重渲染（开关/技能状态由浮窗层持有）。
var PanelContent = React.memo(function PanelContent({ config, chatControls }: {
  config: FloatingPanelDef;
  chatControls?: ChatPanelControlProps;
}) {
  // 宽类型转any：AI 对话面板需要 controls，其余面板组件不接受额外 props（多传无害）
  var PanelComponent = config.Component as React.ComponentType<any>;
  return (
    <Suspense fallback={<PanelFallback />}>
      <PanelGuard label={config.label}>
        <PanelComponent {...(chatControls ?? {})} />
      </PanelGuard>
    </Suspense>
  );
});

// 浮窗拖拽 + 尺寸调整 hook：返回位置/大小、手势状态、容器 ref 与事件处理器
function useFloatingPanel(
  initialX: number,
  initialY: number,
  sizeOpts?: {
    w: number; h: number;
    minW: number; minH: number;
    maxW: number | (() => number); maxH: number | (() => number);
    // 章节/聊天等与外部布局联动的窗口：尺寸写入宿主 CSS 变量，布局实时跟随、松手免提交
    cssVar?: { prefix: string; host: () => HTMLElement | null };
  }
) {
  var [pos, setPos] = useState({ x: initialX, y: initialY });
  var [dragging, setDragging] = useState<null | {
    startX: number; startY: number;
    originX: number; originY: number;
  }>(null);
  // 浮窗容器 DOM ref：拖动期间直接写 transform，完全绕过 React 重渲染 → 零迟滞
  var elRef = useRef<HTMLDivElement | null>(null);
  // 真理值：拖动中持续更新，松手时再回写 React state
  var posRef = useRef({ x: initialX, y: initialY });

  // —— 尺寸调整 ——
  // 直接尺寸模式（插件浮窗）：尺寸先直写 DOM，松手时提交 React state；
  // cssVar 模式（章节/聊天）：尺寸写入宿主 CSS 变量（编辑器避让等实时跟随），无需提交。
  var [size, setSize] = useState<{ w: number; h: number } | undefined>(
    sizeOpts ? { w: sizeOpts.w, h: sizeOpts.h } : undefined
  );
  var [resizing, setResizing] = useState(false);
  var resizeStartRef = useRef<null | {
    dir: string; startX: number; startY: number;
    startW: number; startH: number; startPX: number; startPY: number;
  }>(null);

  // ★ 修复：用 useEffect 同步 pos 到 ref，避免渲染期直接赋值
  useEffect(function() {
    posRef.current = pos;
  }, [pos]);

  // 开始调整大小：记录起点、起始尺寸与起始位置（dir ∈ n/s/e/w/ne/nw/se/sw），
  // 手势监听由下方 effect 统一挂载
  var onResizeStart = useCallback(function(e: React.MouseEvent, dir: string) {
    if (e.button !== 0 || !sizeOpts || !elRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = {
      dir: dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: elRef.current.offsetWidth,
      startH: elRef.current.offsetHeight,
      startPX: posRef.current.x,
      startPY: posRef.current.y,
    };
    setResizing(true);
  }, [sizeOpts]);

  var onHeaderMouseDown = useCallback(function(e: React.MouseEvent) {
    if (e.button !== 0) return;
    var target = e.target as HTMLElement;
    if (target.closest('button')) return;
    setDragging({
      startX: e.clientX,
      startY: e.clientY,
      originX: posRef.current.x,
      originY: posRef.current.y,
    });
    e.preventDefault();
  }, []);

  // ★ 响应式：窗口缩放时自动钳制浮窗位置，防止面板飘出可视区域
  // ★ 坐标语义：transform 相对 main（main 顶部在 48px header 之下），因此
  //   y 的最小钳制值按 main 内坐标取 8（视觉 ≈ header 底缘下 8px），而不是视口的 56
  useEffect(function() {
    var onResize = function() {
      var el = elRef.current;
      if (!el) return;
      var w = el.offsetWidth;
      var maxX = Math.max(8, window.innerWidth - Math.min(w, 80));
      var maxY = Math.max(8, window.innerHeight - 108); // 视觉下缘留白 60px → main 内坐标再减 header 高 48
      var cur = posRef.current;
      var nx = Math.max(8, Math.min(maxX, cur.x));
      var ny = Math.max(8, Math.min(maxY, cur.y));
      if (nx !== cur.x || ny !== cur.y) {
        posRef.current = { x: nx, y: ny };
        setPos({ x: nx, y: ny });
      }
    };
    window.addEventListener('resize', onResize);
    return function() { window.removeEventListener('resize', onResize); };
  }, []);

  useEffect(function() {
    if (!dragging) return;
    var d = dragging;
    var rafId = 0;
    var pendingX = 0;
    var pendingY = 0;
    // 拖拽开始：通知背景层暂停 rAF 循环（BambooLeafFollow 雨效 / InkWash 鸟群）
    // 这些持续运行的 canvas rAF 与拖拽 transform 更新竞争主线程，是拖拽卡顿的主因
    document.body.classList.add('nm-dragging-active');
    var onMove = function(e: MouseEvent) {
      var dx = e.clientX - d.startX;
      var dy = e.clientY - d.startY;
      var newX = d.originX + dx;
      var newY = d.originY + dy;
      // 边界约束：保留至少 80px 可见；y 按 main 内坐标钳制（8 = 视觉上贴 header 底缘下 8px，
      // 此前误用视口坐标 56，导致面板与顶栏之间有一段拖不上去的"空气屏障"）
      var maxX = window.innerWidth - 80;
      var maxY = window.innerHeight - 108;
      pendingX = Math.max(8, Math.min(maxX, newX));
      pendingY = Math.max(8, Math.min(maxY, newY));
      // ★ 关键：拖动期间同步直写 DOM（不经 React 重渲染/VDOM diff），
      // 浮窗位置即时跟随鼠标，彻底消除「迟滞感」
      if (elRef.current) {
        elRef.current.style.transform = 'translate3d(' + pendingX + 'px, ' + pendingY + 'px, 0)';
      }
      // 仅在 rAF 中同步真理值，绝不在 mousemove 里 setState
      if (rafId) return;
      rafId = requestAnimationFrame(function() {
        rafId = 0;
        if (posRef.current.x !== pendingX || posRef.current.y !== pendingY) {
          posRef.current = { x: pendingX, y: pendingY };
          // ★ rAF 中同步 React state（面板内容已 memo，重渲染只剩廉价窗壳）：
          //   state 与 DOM 始终一致，拖拽中任何外部 store 触发的重渲染
          //   都不会再把浮窗闪跳回旧位置
          setPos(posRef.current);
        }
      });
    };
    var onUp = function() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      // ★ 松手时回写一次 React state，避免后续（其它 state 变化引起的）重渲染跳回旧位置
      posRef.current = { x: pendingX, y: pendingY };
      setPos({ x: pendingX, y: pendingY });
      setDragging(null);
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return function() {
      if (rafId) cancelAnimationFrame(rafId);
      document.body.style.userSelect = '';
      document.body.classList.remove('nm-dragging-active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // 调整大小手势：按方向（n/s/e/w 及对角）计算新尺寸；北/西边缘缩放时同步平移位置，
  // 直写 DOM/CSS 变量（不触发 React 重渲染），松手时提交 React state
  useEffect(function() {
    if (!resizing) return;
    var start = resizeStartRef.current;
    if (!start || !sizeOpts) {
      setResizing(false);
      return;
    }
    const s = start; // 闭包内保持非空收窄
    var maxW = typeof sizeOpts.maxW === 'function' ? sizeOpts.maxW() : sizeOpts.maxW;
    var maxH = typeof sizeOpts.maxH === 'function' ? sizeOpts.maxH() : sizeOpts.maxH;
    var pendingW = s.startW, pendingH = s.startH, pendingX = s.startPX, pendingY = s.startPY;
    var apply = function(w: number, h: number, px: number, py: number) {
      if (sizeOpts.cssVar) {
        var host = sizeOpts.cssVar.host();
        if (host) {
          host.style.setProperty('--' + sizeOpts.cssVar.prefix + '-w', w + 'px');
          host.style.setProperty('--' + sizeOpts.cssVar.prefix + '-h', h + 'px');
        }
      } else if (elRef.current) {
        elRef.current.style.width = w + 'px';
        elRef.current.style.height = h + 'px';
      }
      // 北/西边缘：位置随尺寸变化平移（transform 直写，与拖拽同路径）
      if (elRef.current) {
        elRef.current.style.transform = 'translate3d(' + px + 'px, ' + py + 'px, 0)';
      }
      posRef.current = { x: px, y: py };
      setPos({ x: px, y: py });
    };
    var onMove = function(e: MouseEvent) {
      var dx = e.clientX - s.startX;
      var dy = e.clientY - s.startY;
      var w = s.startW, h = s.startH, px = s.startPX, py = s.startPY;
      if (s.dir.indexOf('e') >= 0) {
        w = Math.max(sizeOpts.minW, Math.min(maxW, s.startW + dx));
      }
      if (s.dir.indexOf('s') >= 0) {
        h = Math.max(sizeOpts.minH, Math.min(maxH, s.startH + dy));
      }
      if (s.dir.indexOf('w') >= 0) {
        w = Math.max(sizeOpts.minW, Math.min(maxW, s.startW - dx));
        px = s.startPX + (s.startW - w);
      }
      if (s.dir.indexOf('n') >= 0) {
        h = Math.max(sizeOpts.minH, Math.min(maxH, s.startH - dy));
        py = s.startPY + (s.startH - h);
      }
      pendingW = w; pendingH = h; pendingX = px; pendingY = py;
      apply(w, h, px, py);
    };
    var onUp = function() {
      if (!sizeOpts.cssVar) {
        setSize({ w: pendingW, h: pendingH });
      }
      setPos({ x: pendingX, y: pendingY });
      setResizing(false);
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return function() {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizing, sizeOpts]);

  return {
    pos: pos, dragging: dragging, resizing: resizing, size: size,
    elRef: elRef, onHeaderMouseDown: onHeaderMouseDown, onResizeStart: onResizeStart,
  };
}

// 单个受限浮窗：内部管理拖拽位置；默认居中显示，多面板按序号错层避免完全重叠
function FloatingPanelWindow({
  config, index, onClose,
}: {
  config: FloatingPanelDef;
  index: number;
  onClose: () => void;
}) {
  var resizeCfg = useMemo(function() {
    return {
      w: Math.min(config.width || 320, Math.floor(window.innerWidth * 0.92)),
      h: Math.min(config.height || 240, Math.floor(window.innerHeight * 0.8)),
      minW: 240,
      minH: 160,
      maxW: function() { return Math.floor(window.innerWidth * 0.92); },
      maxH: function() { return Math.floor(window.innerHeight * 0.8); },
    };
  }, [config]);
  // 居中：水平/垂直都以视口为准（面板锚定在 main 内，main 顶部在 48px header 之下）
  var defaultX = Math.max(8, Math.round((window.innerWidth - resizeCfg.w) / 2) + index * 24);
  var defaultY = Math.max(8, Math.round((window.innerHeight - 48 - resizeCfg.h) / 2) + index * 24);
  var { pos, dragging, resizing, size, elRef, onHeaderMouseDown, onResizeStart } = useFloatingPanel(defaultX, defaultY, resizeCfg);
  // ★ AI 对话浮窗：功能开关/技能状态由浮窗持有，贴附气泡（左缘）切换
  var isAiChat = config.key === 'ai-chat';
  // 气泡栏可被插件接管（chatRail 扩展点）：插件注册优先，宿主内置兜底
  var pluginChatRail = usePluginRegistry(function(s) { return s.chatRail; });
  var [chatControls, setChatControls] = useState({ syncInsert: false, enableTools: false, enableAgent: false, skillId: null as string | null });
  var chatControlProps: ChatPanelControlProps | undefined = undefined;
  var aiRail: React.ReactNode = null;
  if (isAiChat) {
    const c = chatControls;
    chatControlProps = {
      syncInsert: c.syncInsert,
      enableTools: c.enableTools,
      enableAgent: c.enableAgent,
      activeSkillId: c.skillId,
      onSyncInsertChange: function(v) { setChatControls(function(p) { return { ...p, syncInsert: v }; }); },
      onEnableToolsChange: function(v) {
        // 与 Agent 模式互斥
        setChatControls(function(p) { return { ...p, enableTools: v, enableAgent: v ? false : p.enableAgent }; });
      },
      onEnableAgentChange: function(v) {
        // 与工具调用互斥
        setChatControls(function(p) { return { ...p, enableAgent: v, enableTools: v ? false : p.enableTools }; });
      },
      onActiveSkillChange: function(id) { setChatControls(function(p) { return { ...p, skillId: id }; }); },
    };
    const ccp = chatControlProps; // const 窄化进闭包
    const RailComponent = (pluginChatRail?.Component ?? AiChatBubbleRail) as typeof AiChatBubbleRail;
    aiRail = (
      <RailComponent
        key={pluginChatRail?.key ?? 'builtin-chat-rail'}
        syncInsert={ccp.syncInsert}
        enableTools={ccp.enableTools}
        enableAgent={ccp.enableAgent}
        activeSkillId={ccp.activeSkillId}
        onToggleSync={function() { ccp.onSyncInsertChange(!ccp.syncInsert); }}
        onToggleTools={function() { ccp.onEnableToolsChange(!ccp.enableTools); }}
        onToggleAgent={function() { ccp.onEnableAgentChange(!ccp.enableAgent); }}
        onSkillChange={ccp.onActiveSkillChange}
      />
    );
  }

  return (
    <div
      className={`absolute z-30 flex flex-col nm-float-panel-mobile${dragging ? ' is-dragging' : ''}`}
      ref={elRef}
      style={{
        // ★ GPU 友好定位：用 transform 替代 left/top，移动时只触发合成（composite），
        // 不再触发 layout/reflow，配合 .is-dragging 临时禁用 backdrop-filter 大幅降低拖动开销。
        // 用 left:0/top:0 锚定基准点，translate3d 的位移才等价于原先的 left/top。
        // ★ 响应式：宽度用 min(config.width, 92vw) 防止小屏溢出，移动端由 .nm-float-panel-mobile 全屏化
        left: 0,
        top: 0,
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        width: (size ? size.w : resizeCfg.w) + 'px',
        height: (size ? size.h : resizeCfg.h) + 'px',
        opacity: dragging ? 0.92 : 1,
        // 拖拽/缩放中禁用过渡：transform 直写即时跟手
        transition: dragging || resizing ? 'none' : 'opacity 0.2s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: dragging || resizing ? 'transform' : undefined,
        pointerEvents: 'auto',
      }}
    >
      {/* ★ AI 对话：功能气泡贴附在浮窗左缘外侧（根 div 是 absolute 定位基准，不受内容区裁剪） */}
      {aiRail}
      {/* ★ 插件面板可选的左缘气泡栏（FloatingPanelDef.rail，如自动写作面板旁的技能入口） */}
      {config.rail ? <config.rail /> : null}
      <PanelSection
        title={config.label}
        icon={config.icon}
        grow="flex-1"
        headerHeight={36}
        collapsed={false}
        onHeaderMouseDown={onHeaderMouseDown}
        dragging={!!dragging}
        headerActions={
          <button
            type="button"
            onClick={onClose}
            className="nm-btn-apple-icon-sm"
            title={'关闭' + config.label}
            aria-label={'关闭' + config.label}
          >
            <X size={13} />
          </button>
        }
      >
        <PanelContent config={config} chatControls={chatControlProps} />
      </PanelSection>
      <ResizeFrame onResizeStart={onResizeStart} label={config.label} />
    </div>
  );
}

// 八向调整大小手柄：四边 + 四角均可拖拽缩放（北/西方向缩放时窗口位置随之平移）
function ResizeFrame({ onResizeStart, label }: { onResizeStart: (e: React.MouseEvent, dir: string) => void; label: string }) {
  var handles = [
    { dir: 'n', cls: 'top-0 left-3 right-3 h-1.5 cursor-n-resize' },
    { dir: 's', cls: 'bottom-0 left-3 right-3 h-1.5 cursor-s-resize' },
    { dir: 'w', cls: 'left-0 top-3 bottom-3 w-1.5 cursor-w-resize' },
    { dir: 'e', cls: 'right-0 top-3 bottom-3 w-1.5 cursor-e-resize' },
    { dir: 'nw', cls: 'left-0 top-0 w-3.5 h-3.5 cursor-nw-resize' },
    { dir: 'ne', cls: 'right-0 top-0 w-3.5 h-3.5 cursor-ne-resize' },
    { dir: 'sw', cls: 'left-0 bottom-0 w-3.5 h-3.5 cursor-sw-resize' },
    { dir: 'se', cls: 'right-0 bottom-0 w-3.5 h-3.5 cursor-se-resize' },
  ];
  var dirNames: Record<string, string> = { n: '上', s: '下', w: '左', e: '右', nw: '左上', ne: '右上', sw: '左下', se: '右下' };
  return (
    <>
      {handles.map(function(h) {
        return (
          <div
            key={h.dir}
            className={`absolute ${h.cls} z-20`}
            onMouseDown={function(e) { onResizeStart(e, h.dir); }}
            aria-label={`${label}，从${dirNames[h.dir]}边缘拖动调整大小`}
            title="拖动调整大小"
          />
        );
      })}
    </>
  );
}

export function ProjectLayout() {
  var navigate = useNavigate();
  var params = useParams<{ bookId: string }>();
  var urlBookId = params.bookId;
  // ★「返回」策略（2026-09-12 重写）：统一为「退出项目、回书架」，**不再依赖历史栈**。
  //
  //   ⚠ 为什么不能用 navigate(-1)：
  //     `/project` 是**瞬态页** —— 只要有章节，ProjectIndexPage 就会用 replace 跳到章节编辑器，
  //     而 replace 会把 `/project` 这条历史记录**抹掉**。从书架进来时的历史栈实际是
  //     [书架, 章节页]，于是 navigate(-1) 会越过「上一层」直接弹回书架。
  //
  //   ⚠ 为什么不能用 navigate(PATHS.project)：
  //     ProjectIndexPage 挂载后立刻又把你 replace 回章节编辑器，表现为
  //     「点了返回没反应、还在原界面」。
  //
  //   固定回书架后行为稳定可预测：无章节项目的首页本身就在 /project，返回同样出到书架。
  var backTarget = PATHS.bookshelf;
  var backLabel = '返回书架';
  var handleBack = useCallback(function() {
    navigate(backTarget);
  }, [backTarget, navigate]);
  var project = useProjectStore(function(s) { return s.currentProject; });
  var setProject = useProjectStore(function(s) { return s.setProject; });
  var user = useAuthStore(function(s) { return s.user; });
  var logout = useAuthStore(function(s) { return s.logout; });
  // 受限浮窗开闭状态上移到 store（编辑器内的插件面板栏共享同一份，可开关面板）
  var openPanelKeys = usePanelOpenStore(function(s) { return s.keys; });
  var openPanel = usePanelOpenStore(function(s) { return s.open; });
  var closePanelStore = usePanelOpenStore(function(s) { return s.close; });

  // ★ 插件化：面板列表来自插件注册表（内置 12 面板 + 插件新增面板）
  var floatingPanels = usePluginRegistry(function(s) { return s.projectPanels; });

  // ★ 章节 / AI 对话并入气泡浮窗体系：与功能面板同为「气泡 → 居中浮窗」交互
  var chapterBubbleDef = useMemo<FloatingPanelDef>(function() {
    return { key: 'chapters', label: '章节', icon: BookOpen, Component: LeftSidebar, width: 320, height: 640 };
  }, []);
  var chatBubbleDef = useMemo<FloatingPanelDef>(function() {
    return { key: 'ai-chat', label: 'AI 对话', icon: MessageSquare, Component: ChatPanel, width: 400, height: 620 };
  }, []);
  var bubblePanels = useMemo(function() {
    return [chapterBubbleDef, chatBubbleDef].concat(
      floatingPanels.filter(function(p) { return p.scope !== 'editor'; })
    );
  }, [chapterBubbleDef, chatBubbleDef, floatingPanels]);

  // ★ 刷新恢复：URL 带有 :bookId 但 store 已重置（currentProject 为 null 或 id 不匹配）时，
  // 从后端拉取项目元数据写回 store。这样刷新 /project/:bookId/:chapterId 不会丢失书籍。
  useEffect(function() {
    if (!urlBookId) return;
    var current = useProjectStore.getState().currentProject;
    if (current && current.id === urlBookId) return;
    var cancelled = false;
    apiClient.get<Project>('/projects/' + urlBookId).then(function(p) {
      if (cancelled) return;
      if (p) setProject(p);
    }).catch(function(e) {
      console.warn('[ProjectLayout] 从 URL bookId 恢复项目失败', e);
    });
    return function() { cancelled = true; };
  }, [urlBookId, setProject]);

  // ★ 优先用 URL 的 bookId 触发 syncService，避免 project 暂未恢复时 syncService 拿到 undefined
  //   取回 reload 下传给 AI 写作工作台：交付后实体已在服务端落库，
  //   需要这个实例（而**不能**在工作台里再挂一个 useSyncService —— 那会让每次 store
  //   变更被两个订阅各写一遍，实体重复创建）把项目数据重新拉进 store。
  var { reload: reloadProjectData } = useSyncService(urlBookId || project?.id);

  // ★ 加载参考书：当项目 ID 可用时从后端加载参考书列表
  // 参考书独立于 syncService 的实体同步，且 ReferenceReader 是惰性加载的浮窗面板，
  // 刷新页面时面板未打开，ReferenceReader 不会挂载，loadBooks 也不会被调用。
  // 因此需要在 ProjectLayout 层面主动加载，确保参考书数据在项目加载时即可用。
  var referenceProjectId = urlBookId || project?.id;
  useEffect(function() {
    if (!referenceProjectId) return;
    useReferenceStore.getState().loadBooks(referenceProjectId);
  }, [referenceProjectId]);

  // 跨组件请求打开浮窗（如 ForeshadowWarning 的"查看"按钮派发 nm:open-panel 事件）
  useEffect(function() {
    var onOpenPanel = function(e: Event) {
      var key = (e as CustomEvent<{ key: string }>).detail?.key;
      if (!key) return;
      openPanel(key);
    };
    window.addEventListener('nm:open-panel', onOpenPanel as EventListener);
    return function() { window.removeEventListener('nm:open-panel', onOpenPanel as EventListener); };
  }, [openPanel]);

  var closePanel = useCallback(function(key: string) {
    closePanelStore(key);
  }, [closePanelStore]);

  var handleLogout = useCallback(async function() {
    await logout();
    navigate(PATHS.login);
  }, [logout, navigate]);

  // ★ 创作模式分流：AI 写作模式走固定工作台 —— 不渲染罗盘气泡，也不挂载任何手写浮窗面板。
  //   刻意放在所有 hooks 之后，保证两种模式下 hooks 的调用顺序完全一致。
  if ((project?.mode ?? 'manual') === 'auto') {
    return (
      <Suspense fallback={<PanelFallback />}>
        <AutoWriteWorkbench project={project} onBack={handleBack} onProjectDataChanged={reloadProjectData} />
      </Suspense>
    );
  }

  return (
    <div
      className="h-screen flex flex-col overflow-hidden relative"
    >
      {/* 液态玻璃环境背景由 App.tsx 全局挂载 */}

      {/* 顶栏：透明（无霜层，融入背景）；功能入口全部在气泡层 */}
      <header
        className="relative z-40 grid items-center shrink-0"
        style={{ height: 48, padding: '0 16px', gridTemplateColumns: '1fr auto 1fr', background: 'transparent' }}
      >
        {/* 左侧：返回书架 + 项目名 */}
        <div className="flex items-center gap-2 justify-self-start">
          <InkBackButton onClick={handleBack} size={15} label="返回" />
          <span
            className="text-[13px] font-semibold select-none cursor-pointer truncate max-w-[120px] sm:max-w-[200px]"
            style={{ color: 'hsl(var(--foreground))', letterSpacing: '-0.2px' }}
            onClick={() => navigate(backTarget)}
            title={backLabel}
            aria-label={backLabel}
          >
            {project ? project.name : 'NovelMuse'}
          </span>
        </div>

        <div />

        <div className="flex items-center gap-1.5 justify-self-end">
          <button
            onClick={function() { navigate(PATHS.settings); }}
            className="nm-btn-apple-icon-sm"
            title="设置"
            aria-label="设置"
          >
            <Settings size={15} />
          </button>
          {user?.isAdmin && (
            <button
              onClick={() => navigate(PATHS.admin)}
              className="nm-btn-apple-icon-sm"
              title="管理员后台"
              aria-label="管理员后台"
            >
              <Shield size={15} />
            </button>
          )}
          {user && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-full"
              style={{
                color: 'hsl(var(--muted-foreground))',
                background: 'rgb(var(--glass-tint) / 0.4)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              <div
                className="w-5 h-5 flex items-center justify-center rounded-full text-white text-[9px] font-semibold"
                style={{ background: '#2383C7' }}
              >
                {user.displayName ? user.displayName.charAt(0).toUpperCase() : <User size={10} />}
              </div>
              <span className="text-[11px] max-w-[60px] truncate hidden md:inline" style={{ color: 'hsl(var(--muted-foreground))' }}>{user.displayName}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="nm-btn-apple-icon-sm"
            title="登出"
            aria-label="登出"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* 主区：透明背景，让环境层透过 */}
      <main className="flex-1 flex overflow-hidden relative z-10" style={{ background: 'transparent' }}>
        {/* 编辑器区域 — 功能面板均为居中浮窗，编辑器不再做边距避让 */}
        <div
          className="flex-1 flex flex-col overflow-hidden nm-editor-main"
          style={{ minWidth: 0 }}
        >
          <div className="flex-1 overflow-hidden flex flex-col">
            <Suspense fallback={<PanelFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>

        {/* 浮窗组（章节 / AI 对话 / 功能面板统一）：最多 MAX_OPEN_PANELS 个，居中显示，可拖拽 + 八向缩放 */}
        {openPanelKeys.map(function(key, idx) {
          var config = bubblePanels.find(function(p) { return p.key === key; });
          if (!config) return null;
          return (
            <FloatingPanelWindow
              key={key}
              config={config}
              index={idx}
              onClose={function() { closePanel(key); }}
            />
          );
        })}
      </main>

      {/* 功能转轮 — 放在 main 之外（main 的 z-10 层叠上下文会限制内部 z-index），确保真正全局最顶层。
          待机 = 顶栏中央一颗罗盘泡；悬停花开出全部功能面板（开/关切换） */}
      <FloatingBubbles
        panels={bubblePanels}
        openKeys={openPanelKeys}
        onToggle={function(key) {
          if (openPanelKeys.includes(key)) {
            closePanel(key);
          } else {
            openPanel(key);
          }
        }}
      />
    </div>
  );
}
