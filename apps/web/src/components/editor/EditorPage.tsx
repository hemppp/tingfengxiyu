import { EditorContent } from '@tiptap/react';
import { useChapterStore, useProjectStore } from '@/stores';
import { useChapterJumpStore } from '@/stores/chapterJumpStore';
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PATHS } from '@/routes/paths';
import { gsap, useGSAP } from '@/utils/gsap';
import { pickFallbackChapterId } from '@/utils/chapter';
import { SelectionMenu } from './SelectionMenu';
import { Pen } from 'lucide-react';
import { WriterMode } from './WriterMode';
import { ForeshadowWarning } from '@/components/foreshadow/ForeshadowWarning';
import { StyleAdvisor } from './panels/StyleAdvisor';
import { styleService } from '@/services/editor/styleService';
import type { StyleProfile } from '@/services/editor/styleService';
import { QuickPhraseBubble, QP_BUBBLE_CLEARANCE } from './panels/QuickPhraseBubble';
import { PluginEditorToolbar } from './PluginEditorToolbar';
import { EditorPanelRail } from './EditorPanelRail';
import { useEditorInstance } from './hooks/useEditorInstance';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAutoEntityDetection } from '@/hooks/useAutoEntityDetection';
import { useLatestChapterPolling } from '@/hooks/useLatestChapterPolling';
import { useEntityChapterSync } from '@/hooks/useEntityChapterSync';
import { htmlToText, ensureHtmlContent } from '@/services/editor/entityDetector';
import { FileText, Plus, BookOpen as BookOpenIcon } from 'lucide-react';
import { FindReplaceBar } from './FindReplaceBar';
import { saveSnapshot, saveChapter } from '@/services/data/databaseService';
import { getCachedChapterContent, cacheChapterContent } from '@/services/data/chapterLocalCache';
import { nanoid } from 'nanoid';
import type { Snapshot } from '@novel/shared';

// ★ 样式常量：避免每次渲染创建新对象
const TITLE_INPUT_STYLE: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  color: 'hsl(var(--ink))',
  backgroundColor: 'transparent',
  border: 'none',
  outline: 'none',
  lineHeight: '1.3',
  textAlign: 'center',
};

const SUBTITLE_STYLE: React.CSSProperties = {
  color: 'hsl(var(--mountain-deep))',
};

export function EditorPage() {
  const [writerMode, setWriterMode] = useState(false);
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(null);
  const [findVisible, setFindVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  /** 正文底部需要预留的高度（px），用来给「快捷短语」浮层让位 —— 推导见下方 useLayoutEffect */
  const [qpReserve, setQpReserve] = useState(0);
  const navigate = useNavigate();
  // 拆 selector：原一次性订阅整个 store 导致 addWords、setXxx 都触发 re-render。
  // 现在每个 selector 独立，只有对应字段变化才 re-render。
  const chapters = useChapterStore((s) => s.chapters);
  const currentChapterId = useChapterStore((s) => s.currentChapterId);
  const getCurrentChapter = useChapterStore((s) => s.getCurrentChapter);
  const updateChapter = useChapterStore((s) => s.updateChapter);
  const currentProject = useProjectStore((s) => s.currentProject);
  const jumpSignal = useChapterJumpStore((s) => s.jumpSignal);
  const jumpAnchor = useChapterJumpStore((s) => s.jumpAnchor);

  const currentChapter = getCurrentChapter();

  // ★ 「最近章节」= 当前项目里 updatedAt 最新的那一章。
  //   早先按钮直接取 `chapters[0]`，但后端 listChapters 按 `order` 升序返回
  //   （chapter-service.ts），于是它打开的是**第一章** —— 与文案不符：
  //   空状态页的用途是「接着上次写」，对写作者来说"第一章"没有意义。
  //   后端 updateChapter 每次保存都会刷新 updatedAt，所以这个定义可靠。
  //   按 projectId 过滤，与 handleCreateChapter 的计数口径保持一致
  //   （store 在同一次会话里切换项目时可能短暂混有其它项目的章节）。
  //   口径与 ChapterEditor 的失效链接兜底共用 pickFallbackChapterId。
  const recentChapterId = useMemo(() => {
    const scoped = currentProject
      ? chapters.filter((c) => c.projectId === currentProject.id)
      : chapters;
    return pickFallbackChapterId(scoped);
  }, [chapters, currentProject]);

  const {
    editor,
    prevWordCount: _prevWordCount,
    resetWordCount,
  } = useEditorInstance({
    initialContent: currentChapter?.content,
    styleProfile,
  });

  const editorRef = useRef(editor);
  editorRef.current = editor;

  // 空章节状态下「新建章节」：同步落库 + 写内存 + 打开新章，兑现空状态文案承诺
  const handleCreateChapter = useCallback(async () => {
    if (!currentProject) return;
    const id = nanoid();
    const now = Date.now();
    // ★ 按 当前项目 的章节数计算 order，避免跨项目导致编号不连续
    const projectChapterCount = chapters.filter(c => c.projectId === currentProject.id).length;
    const order = projectChapterCount + 1;
    const chapter = {
      id,
      projectId: currentProject.id,
      title: `第 ${order} 章`,
      content: '',
      order,
      wordCount: 0,
      summary: undefined,
      status: 'draft' as const,
      label: undefined,
      pov: undefined,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await saveChapter(chapter as never);
      useChapterStore.getState().addChapter(chapter as never);
      useChapterStore.getState().setCurrentChapter(id);
    } catch (e) {
      console.error('创建章节失败:', e);
    }
  }, [currentProject, chapters.length]);

  // ★ 实时字数由 useEditorInstance 的 onUpdate 回调驱动，直接传入 StatusBar
  // 不再在 EditorPage 中单独监听 editor.on('update')，避免重复订阅和潜在的字数冻结
  // 章节列表的字数显示走 store 的 chapter.wordCount，由 useEditorInstance 的 200ms 防抖 flushPersist 更新

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    const learnStyle = async () => {
      if (chapters.length < 1) return;
      const texts = chapters.slice(0, 5).map(ch => ch.content);
      try {
        const { profile: p, isLocalFallback } = await styleService.analyzeStyle(texts);
        if (!aborted && !controller.signal.aborted) {
          // 后端不可用时仍写入兜底结果（StyleAdvisor 仅用于本地启发式检查）
          if (!isLocalFallback) setStyleProfile(p);
        }
      } catch {
        // style analysis is 可选
      }
    };
    learnStyle();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [chapters]);

  useKeyboardShortcuts({
    onFind: () => setFindVisible(true),
    onCloseFind: () => setFindVisible(false),
  });

  // 空状态 — 未选择章节时显示引导
  const _entityChapterIdx = chapters.findIndex(c => c.id === currentChapterId) + 1;
  useAutoEntityDetection(
    currentChapterId,
    currentChapter?.content ?? '',
    currentChapter?.order ?? _entityChapterIdx,
  );

  // ★ 实体-章节反向同步：本地关键词匹配，移除失效引用 + 孤儿实体清理
  // 与 useAutoEntityDetection 互补：AI 加实体，本地清引用
  useEntityChapterSync(
    currentChapterId,
    currentChapter?.content ?? '',
    currentChapter?.order ?? _entityChapterIdx,
  );

  // 后台轮询扫描最新章节（静默，与当前编辑章节双路径规避）
  useLatestChapterPolling(currentChapterId);

  const prevChapterIdRef = useRef<string | null>(null);

  // Editor entrance 动画 on 挂载
  useGSAP(() => {
    if (!containerRef.current) return;
    // Fade in the 编辑器 area
    if (editorAreaRef.current) {
      gsap.from(editorAreaRef.current, {
        opacity: 0,
        y: 12,
        duration: 0.5,
        ease: 'power2.out',
      });
    }
    // Stagger toolbar 按钮
    if (toolbarRef.current) {
      const buttons = toolbarRef.current.querySelectorAll('button');
      if (buttons.length > 0) {
        gsap.from(buttons, {
          opacity: 0,
          y: -8,
          duration: 0.3,
          ease: 'power2.out',
          stagger: 0.06,
        });
      }
    }
  }, { scope: containerRef });

  // Chapter switch 过渡 动画
  useEffect(() => {
    if (!contentRef.current || !prevChapterIdRef.current) return;
    if (prevChapterIdRef.current === currentChapterId) return;
    gsap.fromTo(contentRef.current,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
    );
  }, [currentChapterId]);

  // ★ 给「快捷短语」浮层让出底部空间。
  //   气泡是 position:fixed 的覆盖层（见 QuickPhraseBubble），不在文档流里，
  //   正文滚到底时末段会被它压住 —— 实测 520px 窄屏压住 39px（宽屏只是因为内容短才没暴露）。
  //
  //   ★ 为什么"量"而不是写死常量：预留量 = 滚动容器底边 → 气泡顶边 的距离。
  //     气泡顶边固定在视口底上方 QP_BUBBLE_CLEARANCE，但滚动容器底边到视口底的距离
  //     随布局变（侧栏折叠 / 沉浸模式 / 状态栏），写死一个数在别的布局下必然对不齐。
  useLayoutEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    // GAP 取 24 而不是"看着够"的十几：气泡自身有漂浮动画
    // （nm-qp-drift-a/b，垂直方向最大 ±12px），按静止位置算会在漂到最低点时贴住字。
    const GAP = 24; // 正文末行与气泡之间的安全间隙（含动画位移余量）
    const recompute = () => {
      const hostBottom = host.getBoundingClientRect().bottom;
      const bubbleTop = window.innerHeight - QP_BUBBLE_CLEARANCE;
      setQpReserve(Math.max(0, Math.round(hostBottom - bubbleTop) + GAP));
    };
    recompute();
    // ★ box:'border-box'：下面要改的正是这个元素的 paddingBottom，
    //   用默认的 content-box 会被自己的改动反复触发（padding 变 → 内容盒变 → 回调 → …）
    const ro = new ResizeObserver(recompute);
    ro.observe(host, { box: 'border-box' });
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, []);

  // 时间线跳转：监听 jumpSignal，定位到目标段落并高亮 3 秒
  // jumpSignal 从 0 起步，首次跳转才触发；避免挂载时误触
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (jumpSignal === 0) return;

    // 章节内容加载是异步的（editor.commands.setContent 在另一个 effect 中），
    // 用 setTimeout 400ms 延迟查找，确保 ProseMirror DOM 已更新完毕
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;

    // 解析锚点：jumpAnchor 是 JSON 字符串 { title, desc, chars }
    let anchorTitle = '';
    let anchorDesc = '';
    let anchorChars: string[] = [];
    try {
      if (jumpAnchor) {
        const parsed = JSON.parse(jumpAnchor);
        anchorTitle = parsed.title ?? '';
        anchorDesc = parsed.desc ?? '';
        anchorChars = Array.isArray(parsed.chars) ? parsed.chars : [];
      }
    } catch {
      anchorTitle = jumpAnchor ?? '';
    }

    /** 从文本中提取有意义的关键词（2 字以上的片段） */
    const extractKeywords = (text: string): string[] => {
      if (!text) return [];
      const tokens = text.split(/[，。！？、；：\s,.;!?()[\]{}""''《》\-—…]+/).filter(t => t.length >= 2);
      return tokens;
    };

    /** 计算段落与锚点的匹配得分（命中关键词数越多越好） */
    const scoreParagraph = (paraText: string): number => {
      let score = 0;
      // 1. description 完整包含 → 最高分
      if (anchorDesc && anchorDesc.length >= 4 && paraText.includes(anchorDesc)) return 100;
      // 2. title 完整包含 → 高分
      if (anchorTitle && anchorTitle.length >= 2 && paraText.includes(anchorTitle)) return 80;
      // 3. 角色名命中（原文必定出现角色名，强信号）
      for (const cn of anchorChars) {
        if (cn.length >= 2 && paraText.includes(cn)) score += 4;
      }
      // 4. description 的关键词命中
      const descKeywords = extractKeywords(anchorDesc);
      for (const kw of descKeywords) {
        if (kw.length >= 2 && paraText.includes(kw)) score += 3;
      }
      // 5. title 的关键词命中
      const titleKeywords = extractKeywords(anchorTitle);
      for (const kw of titleKeywords) {
        if (kw.length >= 2 && paraText.includes(kw)) score += 5;
      }
      return score;
    };

    const findAndHighlight = (attempt: number) => {
      const host = editorAreaRef.current;
      if (!host) return;

      const paragraphs = Array.from(
        host.querySelectorAll<HTMLParagraphElement>('.ProseMirror p, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3')
      ).filter(p => (p.textContent || '').trim().length > 0); // 排除空段落

      console.debug('[JumpHighlight] attempt', attempt, '段落数', paragraphs.length, '锚点', { anchorTitle, anchorDesc, anchorChars });

      // 编辑器内容可能还没加载完，空段落时重试（最多 5 次，每次间隔 200ms）
      if (paragraphs.length === 0) {
        if (attempt < 5) {
          delayTimer = setTimeout(() => findAndHighlight(attempt + 1), 200);
        }
        return;
      }

      // 评分匹配：找得分最高的段落
      let bestP: HTMLElement | null = null;
      let bestScore = 0;
      const scores: number[] = [];
      for (const p of paragraphs) {
        const score = scoreParagraph((p.textContent || '').trim());
        scores.push(score);
        if (score > bestScore) {
          bestScore = score;
          bestP = p;
        }
      }
      console.debug('[JumpHighlight] 各段落得分', scores, '最高分', bestScore);

      // 得分为 0 说明完全没匹配到，首次尝试时重试（内容可能还在加载）
      if ((!bestP || bestScore === 0) && attempt < 5) {
        delayTimer = setTimeout(() => findAndHighlight(attempt + 1), 200);
        return;
      }
      if (!bestP || bestScore === 0) {
        console.debug('[JumpHighlight] 匹配失败，不高亮');
        return;
      }

      console.debug('[JumpHighlight] 命中段落:', (bestP.textContent || '').slice(0, 50));
      // 滚动到目标段落
      bestP.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 给段落添加淡红色背景
      bestP.style.transition = 'background-color 0.5s ease';
      bestP.style.backgroundColor = 'rgba(220, 120, 120, 0.18)';
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        bestP!.style.backgroundColor = '';
      }, 3000);
    };

    delayTimer = setTimeout(() => findAndHighlight(0), 300);

    return () => {
      if (delayTimer) clearTimeout(delayTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    };
  }, [jumpSignal, jumpAnchor]);

  // 旧「滚动进度 → 渐隐遮罩」监听已移除：卡片透明化后玻璃渐隐条失去意义

  useEffect(() => {
    if (!editor || !currentChapter) return;

    if (prevChapterIdRef.current === currentChapterId) return;

    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const switchingChapter = prevChapterIdRef.current && currentChapterId;
    if (switchingChapter) {
      // Animate fade-out of old 内容 before switching
      if (contentRef.current) {
        gsap.to(contentRef.current, { opacity: 0, y: -4, duration: 0.15, ease: 'power2.in' });
      }

      const currentContent = editor.getHTML();
      const prevChapter = chapters.find(c => c.id === prevChapterIdRef.current);
      if (prevChapter && currentContent !== prevChapter.content) {
        const prevWordCount = htmlToText(currentContent).length;
        const prevWcNow = Date.now();
        // ★ 同步写本地缓存兜底（不依赖 50ms setTimeout 是否执行）：
        // 浏览器在 50ms 内关闭时，store 和后端可能都没更新，但缓存已落盘，下次加载可恢复
        cacheChapterContent(prevChapter.id, {
          content: currentContent,
          wordCount: prevWordCount,
          updatedAt: prevWcNow,
        });
        saveTimer = setTimeout(() => {
          if (!cancelled) {
            updateChapter(prevChapter.id, {
              content: currentContent,
              wordCount: prevWordCount,
              updatedAt: prevWcNow,
            });
            // 切换章节前为旧章节留一个自动快照（便于反悔）
            const snap: Snapshot = {
              id: nanoid(),
              chapterId: prevChapter.id,
              content: currentContent,
              wordCount: prevWordCount,
              label: `切换前自动快照 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
              auto: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            saveSnapshot(snap).catch((e) => console.warn('[EditorPage] 切换前自动快照失败:', e));
          }
        }, 50);
      }
    }

    // ★ 本地缓存兜底：若 localStorage 中有比后端（store/DB）更新的章节内容，
    // 优先使用，避免热更新/刷新把未落库的内容冲掉（见 chapterLocalCache）。
    // 注意：mount 竞态已被 useEditorInstance 的 prevWordCount guard 阻止，不会写入空缓存，
    // 因此空缓存只来自用户主动清空章节，可安全使用。
    const cached = getCachedChapterContent(currentChapterId!);
    const backendUpdatedAt = currentChapter.updatedAt ?? 0;
    const useCached = !!cached && cached.updatedAt >= backendUpdatedAt;
    const sourceContentRaw = useCached ? cached.content : currentChapter.content;
    // ★ 剔除正文中的 <hr>：禁用 horizontalRule 后编辑器不再渲染分隔线，
    // 但旧 localStorage 缓存可能仍残留带 hr 的内容，需在此净化，避免重新注入或回写后端。
    const sourceContent = (sourceContentRaw || '').replace(/<hr\b[^>]*\/?>/gi, '');

    // ★ 纯文本正文（AI 写作链路落库的是 `\n\n` 分段纯文本）必须转成 HTML 再注入：
    //   tiptap 的 setContent(字符串) 按 HTML 解析，直接喂纯文本会把换行当空白吞掉、段落全并成一段。
    //   已是 HTML 的内容原样返回，不受影响。
    const injectContent = ensureHtmlContent(sourceContent);

    const currentEditorContent = editor.getHTML();
    if (currentEditorContent !== injectContent) {
      editor.commands.setContent(injectContent, false);
    }
    // ★ 从 HTML 内容直接计算字数，不依赖 characterCount（setContent 不触发 update 时 storage 可能未更新）
    //   用 injectContent 算：纯文本正文经转换后，htmlToText 才能正确按段落取到全部文字
    //   （直接对纯文本算会把 `<` 等字符漏掉，且与编辑器实际渲染的内容不一致）
    const actualWc = htmlToText(injectContent).length;
    _prevWordCount.current = actualWc;
    resetWordCount(actualWc);
    // ★ 修正 store 中的 wordCount + 回写缓存内容（合并为一次 updateChapter）
    const needContentUpdate = useCached && currentEditorContent !== injectContent;
    const needWcFix = currentChapter.wordCount !== actualWc;
    if (needContentUpdate || needWcFix) {
      updateChapter(currentChapterId!, {
        ...(needContentUpdate ? { content: sourceContent, updatedAt: cached.updatedAt } : {}),
        wordCount: actualWc,
      });
    }

    prevChapterIdRef.current = currentChapterId;

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [currentChapterId, editor]);

  if (writerMode && editor) {
    return (
      <WriterMode
        editor={editor}
        onExit={() => setWriterMode(false)}
      />
    );
  }

  if (!currentChapter) {
    return (
      <div className="h-full flex flex-col bg-transparent font-[Inter,sans-serif]">
        <div className="flex-1 nm-editor-empty flex items-center justify-center px-6">
          <div className="max-w-md text-center space-y-5 animate-fade-in">
            <div className="mx-auto w-16 h-16 rounded-full nm-book-cover flex items-center justify-center shadow-lg">
              <FileText size={26} className="text-[rgba(255,255,255,0.92)]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-[22px] font-[Noto_Serif_SC,serif] font-semibold" style={{ color: 'hsl(var(--ink))' }}>
                尚未开启章节
              </h2>
              <p className="text-[13px] leading-7" style={{ color: 'hsl(var(--ink-light))' }}>
                在左侧章节树中点选一个章节开始你的创作。
                <br />
                或者从下方新建一个章节。
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={handleCreateChapter}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-xl nm-btn-mist-primary transition-all duration-200"
              >
                <Plus size={14} />
                <span>新建章节</span>
              </button>
              <button
                onClick={() => useChapterStore.getState().setCurrentChapter(recentChapterId)}
                disabled={!recentChapterId}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-xl nm-btn-mist-primary transition-all duration-200 disabled:opacity-40"
              >
                <BookOpenIcon size={14} />
                <span>打开最近章节</span>
              </button>
              <button
                onClick={() => navigate(PATHS.bookshelf)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-xl nm-btn-mist-soft transition-all duration-200"
              >
                <Plus size={14} />
                <span>前往书架</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-transparent font-[Inter,sans-serif]">
      {/* 沉浸式写作按钮 - 浮于右上角（已移除字数/章节统计 bar） */}
      <button
        onClick={() => setWriterMode(true)}
        className="absolute right-4 sm:right-6 top-3 z-20 flex items-center justify-center gap-1.5 min-w-6 min-h-6 px-2.5 py-1 text-[12px] rounded-xl transition-all duration-200 hover:bg-[hsl(var(--mist-pale))]"
        style={{ color: 'hsl(var(--ink-light))' }}
        title="沉浸式写作"
        aria-label="沉浸式写作"
      >
        <Pen size={12} aria-hidden="true" />
        <span className="hidden sm:inline">沉浸式写作</span>
      </button>

      {/* 编辑器面板栏（scope: 'editor' 的插件面板开关；无面板时不渲染） */}
      <EditorPanelRail />

      {/* Chapter 内容 包裹 为 过渡 animations */}
      <div ref={contentRef} className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Chapter 标题 — Noto Serif 居中 */}
      <div className="nm-editor-responsive" style={{ paddingTop: 'clamp(24px, 4vh, 40px)', paddingBottom: '16px' }}>
        <input
          type="text"
          value={currentChapter.title}
          onChange={(e) =>
            updateChapter(currentChapterId!, { title: e.target.value })
          }
          className="w-full nm-editor-title text-center"
          style={TITLE_INPUT_STYLE}
          placeholder="输入章节标题..."
          aria-label="输入章节标题"
        />
        {/* 副标题：所属卷 */}
        {currentChapter.label && (
          <div className="text-center mt-2 text-[12px] font-[Noto_Serif_SC,serif] tracking-wider" style={SUBTITLE_STYLE}>
            {currentChapter.label}
          </div>
        )}
      </div>

      {/* Foreshadow 警告 */}
      <div className="nm-editor-responsive">
        <ForeshadowWarning />
      </div>

      {/* 插件工具栏 — 无插件注册时不渲染 */}
      <div className="nm-editor-responsive">
        <PluginEditorToolbar editor={editor} />
      </div>

      {/* Editor area - 卡片化容器（外层不滚动，文本框内部独立滑动） */}
      <div className="flex-1 overflow-hidden min-h-0 relative nm-editor-responsive">
        {/* 查找替换浮层 */}
        <FindReplaceBar
          editor={editor}
          visible={findVisible}
          onClose={() => setFindVisible(false)}
        />
        {/* 外层：玻璃卡片壳（backdrop-filter 单独一层，避免与 overflow:auto 同元素产生渲染瑕疵） */}
        <div
          ref={editorAreaRef}
          className="nm-editor-card nm-editor-content relative overflow-hidden"
          style={{ height: '100%' }}
        >
          {/* 内层：滚动容器（独立 overflow，内部 padding） */}
          <div
            ref={scrollHostRef}
            className="nm-editor-scroll-host"
            style={{
              paddingLeft: 'clamp(16px, 4vw, 48px)',
              paddingRight: 'clamp(16px, 4vw, 48px)',
              paddingTop: 'clamp(20px, 4vh, 32px)',
              // 底部取「基础呼吸留白」与「快捷短语气泡预留量」的较大者 —— 后者由上面的
              // useLayoutEffect 量出（写死会在别的布局下对不齐，原因见那段注释）。
              paddingBottom: `max(clamp(20px, 4vh, 32px), ${qpReserve}px)`,
            }}
          >

            <EditorContent editor={editor} />
            {editor && <SelectionMenu editor={editor} />}
          </div>
        </div>
      </div>

      </div>

      {/* Style advisor */}
      <StyleAdvisor />

      {/* 快捷短语气泡 */}
      <QuickPhraseBubble editor={editor} />

      {/* 时间线自动识别内联提示已移除：改为静默写入 */}
    </div>
  );
}
