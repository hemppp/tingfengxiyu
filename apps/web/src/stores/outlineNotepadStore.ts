// ============================================================
// 大纲笔记本 Store
//
// 统一管理大纲编辑器数据（网文大纲模板 + 自由笔记分区），
// 让 OutlineManager 与 AI 对话填入弹窗共享同一份数据：
//   - OutlineManager 负责编辑 UI，通过 store 读写
//   - OutlineFillDialog 通过 store 的 setCoreConflict / setChapterDetail
//     将 AI 生成的内容填入对应文本框
//
// 持久化：按项目 ID 存储到 localStorage，与旧版 OutlineManager 的
// storageKey `novel-outline-notepad:v1:{projectId}` 保持兼容，
// 旧数据（仅 sections）会被自动迁移补全 coreConflict / chapterDetails。
// ============================================================

import { create } from 'zustand';
import { nanoid } from 'nanoid';

// ---- 数据模型 ----

export interface NotepadSection {
  id: string;
  title: string;
  content: string;
  placeholder: string;
}

export interface OutlineNotepadData {
  /** 核心冲突（网文大纲模板） */
  coreConflict: string;
  /** 每章细节：chapterId -> 细节文本 */
  chapterDetails: Record<string, string>;
  /** 自由笔记分区 */
  sections: NotepadSection[];
  updatedAt: number;
}

interface OutlineNotepadState {
  dataByProject: Record<string, OutlineNotepadData>;
  /** 加载项目数据（若 localStorage 无则初始化默认分区） */
  loadProject: (projectId: string) => OutlineNotepadData;
  /** 更新核心冲突 */
  setCoreConflict: (projectId: string, text: string) => void;
  /** 更新某章细节（merge=true 时追加，replace=false 时覆盖） */
  setChapterDetail: (projectId: string, chapterId: string, text: string, merge?: boolean) => void;
  /** 更新自由笔记分区（整体替换） */
  setSections: (projectId: string, sections: NotepadSection[]) => void;
  /** 获取项目数据（不触发加载） */
  getProjectData: (projectId: string) => OutlineNotepadData | null;
}

// ---- 预设分区（与原 OutlineManager 保持一致，便于迁移） ----

const DEFAULT_SECTIONS: Omit<NotepadSection, 'id'>[] = [
  { title: '一句话故事', content: '', placeholder: '用一句话讲清楚主角、冲突与转折，让人一听就想读这本书。' },
  { title: '核心主题', content: '', placeholder: '这个故事想表达什么？爱 / 救赎 / 自由 / 身份认同……' },
  { title: '类型与风格', content: '', placeholder: '类型（玄幻 / 都市 / 悬疑 / 科幻 / 历史…）与文风（冷硬 / 诙谐 / 诗意 / 朴实）。' },
  { title: '故事背景', content: '', placeholder: '时间 / 地点 / 世界观 / 社会形态 / 关键设定。' },
  { title: '视角与时间线', content: '', placeholder: '第几人称、过去还是现在时、故事跨度多久。' },
  { title: '主要人物', content: '', placeholder: '主角 / 关键配角 / 反派各一行：核心动机、性格、外在标签。' },
  { title: '故事梗概', content: '', placeholder: '用一段话描述主线走向（不必剧透结局）。' },
  { title: '结构框架', content: '', placeholder: '开端 / 发展 / 高潮 / 结局大致安排；或三幕剧 / 英雄之旅节点。' },
  { title: '开场与结尾', content: '', placeholder: '故事如何开篇？如何收束？两个画面是否形成呼应？' },
  { title: '伏笔与悬念', content: '', placeholder: '哪里埋下伏笔 / 哪里揭示 / 哪些反转值得保留到最后。' },
  { title: '基调与意象', content: '', placeholder: '整体氛围、反复出现的意象、希望读者读完后留下的"味道"。' },
  { title: '备注', content: '', placeholder: '其他灵感、参考作品、写作禁忌……' },
];

function buildDefaultSections(): NotepadSection[] {
  return DEFAULT_SECTIONS.map((s) => ({ ...s, id: nanoid(10) }));
}

function buildDefaultData(): OutlineNotepadData {
  return {
    coreConflict: '',
    chapterDetails: {},
    sections: buildDefaultSections(),
    updatedAt: Date.now(),
  };
}

// ---- 持久化（与旧版 storageKey 兼容） ----

function storageKey(projectId: string): string {
  return `novel-outline-notepad:v1:${projectId}`;
}

function loadFromStorage(projectId: string): OutlineNotepadData | null {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 兼容旧版数据（仅 sections 字段）
    const sections: NotepadSection[] = Array.isArray(parsed?.sections)
      ? parsed.sections.map((s: Partial<NotepadSection>) => ({
          ...s,
          id: s.id ?? nanoid(10),
          title: s.title ?? '未命名分区',
          content: s.content ?? '',
          placeholder: s.placeholder ?? '请填写…',
        }))
      : buildDefaultSections();
    return {
      coreConflict: typeof parsed?.coreConflict === 'string' ? parsed.coreConflict : '',
      chapterDetails:
        parsed?.chapterDetails && typeof parsed.chapterDetails === 'object'
          ? parsed.chapterDetails
          : {},
      sections,
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch (e) {
    console.warn('[outlineNotepadStore] 加载失败', e);
    return null;
  }
}

function saveToStorage(projectId: string, data: OutlineNotepadData): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(data));
  } catch (e) {
    console.warn('[outlineNotepadStore] 保存失败', e);
  }
}

// ---- Store ----

export const useOutlineNotepadStore = create<OutlineNotepadState>((set, get) => ({
  dataByProject: {},

  loadProject: (projectId) => {
    const existing = get().dataByProject[projectId];
    if (existing) return existing;
    const loaded = loadFromStorage(projectId) ?? buildDefaultData();
    set((state) => ({
      dataByProject: { ...state.dataByProject, [projectId]: loaded },
    }));
    return loaded;
  },

  setCoreConflict: (projectId, text) => {
    set((state) => {
      const prev = state.dataByProject[projectId] ?? buildDefaultData();
      const next: OutlineNotepadData = {
        ...prev,
        coreConflict: text,
        updatedAt: Date.now(),
      };
      saveToStorage(projectId, next);
      return { dataByProject: { ...state.dataByProject, [projectId]: next } };
    });
  },

  setChapterDetail: (projectId, chapterId, text, merge = false) => {
    set((state) => {
      const prev = state.dataByProject[projectId] ?? buildDefaultData();
      const existing = prev.chapterDetails[chapterId] ?? '';
      const finalText = merge && existing.trim()
        ? `${existing.trim()}\n\n${text.trim()}`
        : text;
      const next: OutlineNotepadData = {
        ...prev,
        chapterDetails: { ...prev.chapterDetails, [chapterId]: finalText },
        updatedAt: Date.now(),
      };
      saveToStorage(projectId, next);
      return { dataByProject: { ...state.dataByProject, [projectId]: next } };
    });
  },

  setSections: (projectId, sections) => {
    set((state) => {
      const prev = state.dataByProject[projectId] ?? buildDefaultData();
      const next: OutlineNotepadData = {
        ...prev,
        sections,
        updatedAt: Date.now(),
      };
      saveToStorage(projectId, next);
      return { dataByProject: { ...state.dataByProject, [projectId]: next } };
    });
  },

  getProjectData: (projectId) => {
    return get().dataByProject[projectId] ?? null;
  },
}));
