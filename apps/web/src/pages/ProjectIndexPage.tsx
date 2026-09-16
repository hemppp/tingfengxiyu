/**
 * /project 索引页 — 当用户直接打开 /project（未指定章节）时展示
 *
 * 行为：
 * 1. 无 currentProject → 提示去书架选书
 * 2. 有项目 + 有章节 → 用 replace 跳到第一章节的编辑器（不进路由死循环）
 * 3. 有项目 + 无章节 → 展示"创建第一章"空状态（含输入框 + 创建按钮）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { useChapterStore, useProjectStore } from '@/stores';
import { saveChapter } from '@/services/data/databaseService';
import { apiClient } from '@/services/api/apiClient';
import { PATHS } from '@/routes/paths';
import type { Project } from '@novel/shared';
import { BookOpen, Library, Plus, Sparkles } from 'lucide-react';

export const ProjectIndexPage: React.FC = () => {
  const navigate = useNavigate();
  // 使用独立选择器，避免订阅整个 store 导致不必要的重渲染
  const currentProject = useProjectStore(s => s.currentProject);
  const chapters = useChapterStore(s => s.chapters);
  const setCurrentChapter = useChapterStore(s => s.setCurrentChapter);
  const addChapter = useChapterStore(s => s.addChapter);
  const [newTitle, setNewTitle] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // —— 空态用：书架里的书 ——
  // 2026-09-15 加：原先「无项目」分支只有一行提示，直接打开 /project 的人是走到死路。
  // 这里拉一份列表，给出「一步进书」的入口。
  const setProject = useProjectStore(s => s.setProject);
  const [shelf, setShelf] = useState<Project[]>([]);
  useEffect(() => {
    if (currentProject) return; // 已有项目就不用拉列表
    let alive = true;
    void apiClient
      .get<Project[]>('/projects')
      .then((list) => { if (alive) setShelf(list ?? []); })
      .catch(() => { /* 拉不到就只留「去书架」按钮，不打扰用户 */ });
    return () => { alive = false; };
  }, [currentProject?.id]);

  /** 从空态一步进书：写 store + URL 带 bookId（与书架点书一致，刷新不会丢） */
  const openFromShelf = (b: Project) => {
    setProject(b);
    navigate(`/project/${b.id}`);
  };

  // 项目章节按 order 排序
  const projChapters = useMemo(
    () => currentProject
      ? chapters.filter(c => c.projectId === currentProject.id).slice().sort((a, b) => a.order - b.order)
      : [],
    [chapters, currentProject],
  );

  // 1️ 有项目 + 有章节 → 跳到第一章（用 ref 防止重复触发）
  const hasNavigatedRef = useRef(false);
  useEffect(() => {
    if (!currentProject) {
      hasNavigatedRef.current = false;  // 项目变化时重置
      return;
    }
    if (hasNavigatedRef.current) return;
    const first = projChapters[0];
    if (!first) return;
    hasNavigatedRef.current = true;
    // 不调用 setCurrentChapter —— ChapterEditor 挂载时会自己设置
    navigate(`/project/${currentProject.id}/${first.id}`, { replace: true });
  }, [currentProject?.id, projChapters[0]?.id]);   

  // 自动 focus 新建输入
  useEffect(() => {
    if (currentProject && projChapters.length === 0) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [currentProject?.id, projChapters.length]);

  const handleCreate = async () => {
    if (!currentProject) return;
    const title = newTitle.trim() || '第一章';
    setCreatingBusy(true);
    try {
      const newOrder = projChapters.length + 1;
      const id = nanoid();
      const now = Date.now();
      const chapter = {
        id,
        projectId: currentProject.id,
        title,
        content: '',
        order: newOrder,
        wordCount: 0,
        status: 'draft' as const,
        label: undefined,
        createdAt: now,
        updatedAt: now,
      };
      await saveChapter(chapter as never);
      addChapter({
        id,
        projectId: currentProject.id,
        title,
        content: '',
        order: newOrder,
        wordCount: 0,
        summary: undefined,
        status: 'draft',
        label: undefined,
        createdAt: now,
        updatedAt: now,
      });
      setCurrentChapter(id);
      setNewTitle('');
      // 直接跳到新章节的编辑器
      navigate(`/project/${currentProject.id}/${id}`, { replace: true });
    } catch (err) {
      console.error('[ProjectIndexPage] 创建章节失败', err);
    } finally {
      setCreatingBusy(false);
    }
  };

  // 2️⃣ 无项目 —— 空态引导卡
  // 2026-09-15 UI 优化：原版只有一个图标 + 一行小字，既无行动入口也无信息，
  // 直接访问 /project 的人等于撞墙。改成与「无章节」分支同规格的引导卡：
  // 主按钮「去书架」+ 书架里的书一步直达。
  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'transparent' }}>
        <div
          className="rounded-xl flex flex-col items-center"
          style={{
            maxWidth: 460,
            width: '90%',
            padding: '40px 32px',
            background: 'hsla(0, 0%, 98%, 0.62)',
            backdropFilter: 'blur(12px) saturate(140%)',
            WebkitBackdropFilter: 'blur(12px) saturate(140%)',
            border: '1px solid hsl(var(--border) / 0.5)',
            boxShadow: '0 4px 16px hsl(var(--ink) / 0.05)',
            textAlign: 'center',
          }}
        >
          <BookOpen size={28} style={{ color: 'hsl(var(--ink-light))' }} className="mb-3" />
          <h2
            style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: 18,
              fontWeight: 600,
              color: 'hsl(var(--ink))',
              margin: '0 0 6px',
            }}
          >
            还没有打开任何书
          </h2>
          <p
            style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: 13,
              color: 'hsl(var(--ink-light))',
              margin: '0 0 20px',
            }}
          >
            从书架挑一本继续写，或新建一本
          </p>
          <button
            type="button"
            onClick={() => navigate(PATHS.bookshelf)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md transition-all"
            style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: 13,
              color: 'hsl(var(--card))',
              background: 'hsl(var(--mountain-deep))',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Library size={14} />
            去书架
          </button>

          {shelf.length > 0 && (
            <div className="w-full" style={{ marginTop: 26 }}>
              <div className="flex items-center gap-2" style={{ color: 'hsl(var(--ink-pale))', marginBottom: 10 }}>
                <span style={{ flex: 1, height: 1, background: 'hsl(var(--border) / 0.6)' }} />
                <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 11, letterSpacing: '0.1em' }}>
                  书架里的书
                </span>
                <span style={{ flex: 1, height: 1, background: 'hsl(var(--border) / 0.6)' }} />
              </div>
              <div className="flex flex-col gap-1.5">
                {shelf.slice(0, 5).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openFromShelf(b)}
                    className="w-full px-3 py-2 rounded-md transition-all text-left truncate"
                    style={{
                      fontFamily: "'Noto Serif SC', serif",
                      fontSize: 13,
                      color: 'hsl(var(--ink))',
                      background: 'hsl(var(--card) / 0.6)',
                      border: '1px solid hsl(var(--border) / 0.5)',
                      cursor: 'pointer',
                    }}
                    title={b.name}
                  >
                    《{b.name}》
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3️⃣ 有项目 + 有章节 → useEffect 已经在 redirect 中，渲染一个轻量占位避免空白闪烁
  if (projChapters.length > 0) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: 'transparent', color: 'hsl(var(--ink-light))' }}
      >
        <div
          className="flex items-center gap-2"
          style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 13 }}
        >
          <Sparkles size={14} style={{ color: 'hsl(var(--mountain-deep))' }} />
          正在打开《{currentProject.name}》的编辑器…
        </div>
      </div>
    );
  }

  // 4️⃣ 有项目 + 无章节 → 空状态 + 创建第一章
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{ background: 'transparent' }}
    >
      <div
        className="rounded-xl flex flex-col items-center"
        style={{
          maxWidth: 440,
          width: '90%',
          padding: '40px 32px',
          background: 'hsla(0, 0%, 98%, 0.62)',
          backdropFilter: 'blur(12px) saturate(140%)',
          WebkitBackdropFilter: 'blur(12px) saturate(140%)',
          border: '1px solid hsl(var(--border) / 0.5)',
          boxShadow: '0 4px 16px hsl(var(--ink) / 0.05)',
          textAlign: 'center',
        }}
      >
        <Sparkles size={28} style={{ color: 'hsl(var(--mountain-deep))' }} className="mb-3" />
        <h2
          style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: 18,
            fontWeight: 600,
            color: 'hsl(var(--ink))',
            margin: '0 0 6px',
          }}
        >
          《{currentProject.name}》还没有章节
        </h2>
        <p
          style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: 13,
            color: 'hsl(var(--ink-light))',
            margin: '0 0 20px',
          }}
        >
          创建第一章，开始你的写作之旅
        </p>
        <div className="flex items-center gap-2 w-full">
          <input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            placeholder="章节标题（留空则默认「第一章」）"
            disabled={creatingBusy}
            className="flex-1 px-3 py-2 rounded-md outline-none transition-all"
            style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: 13,
              color: 'hsl(var(--ink))',
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--mountain-deep) / 0.3)',
            }}
          />
          <button
            onClick={() => void handleCreate()}
            disabled={creatingBusy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md transition-all disabled:opacity-50"
            style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: 13,
              color: 'hsl(var(--card))',
              background: 'hsl(var(--mountain-deep))',
              border: 'none',
            }}
          >
            <Plus size={14} />
            {creatingBusy ? '创建中…' : '开始写作'}
          </button>
        </div>
      </div>
    </div>
  );
};

