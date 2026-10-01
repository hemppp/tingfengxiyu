import { create } from 'zustand';

// ---- 写作统计状态 ----

// localStorage 持久化：todayWordCount 跨刷新保留，跨日自动归零
const STATS_STORAGE_KEY = 'novelmuse:stats';
const todayStr = () => new Date().toISOString().split('T')[0]!;

function loadPersistedStats(): { todayWordCount: number; dailyGoal: number; lastWriteDate: string } {
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return { todayWordCount: 0, dailyGoal: 2000, lastWriteDate: todayStr() };
    const parsed = JSON.parse(raw);
    const lastDate = parsed.lastWriteDate ?? todayStr();
    // 跨日重置：如果上次写作日期不是今天，todayWordCount 归零
    const todayWordCount = lastDate === todayStr() ? (parsed.todayWordCount ?? 0) : 0;
    return {
      todayWordCount,
      dailyGoal: parsed.dailyGoal ?? 2000,
      lastWriteDate: todayStr(),
    };
  } catch {
    return { todayWordCount: 0, dailyGoal: 2000, lastWriteDate: todayStr() };
  }
}

function savePersistedStats(state: { todayWordCount: number; dailyGoal: number; lastWriteDate: string }) {
  try {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 不可用时静默降级
  }
}

interface StatsState {
  todayWordCount: number;
  dailyGoal: number;
  lastWriteDate: string;
  addWords: (count: number) => void;
  setDailyGoal: (goal: number) => void;
}

const _initialStats = loadPersistedStats();

export const useStatsStore = create<StatsState>((set, get) => ({
  todayWordCount: _initialStats.todayWordCount,
  dailyGoal: _initialStats.dailyGoal,
  lastWriteDate: _initialStats.lastWriteDate,
  addWords: (count) =>
    set((state) => {
      // 跨日重置：如果上次记录的日期不是今天，先归零再累加
      const date = todayStr();
      const base = state.lastWriteDate === date ? state.todayWordCount : 0;
      const next = { todayWordCount: base + count, dailyGoal: state.dailyGoal, lastWriteDate: date };
      savePersistedStats(next);
      return next;
    }),
  setDailyGoal: (goal) => {
    const next = { todayWordCount: get().todayWordCount, dailyGoal: goal, lastWriteDate: todayStr() };
    savePersistedStats(next);
    set({ dailyGoal: goal, lastWriteDate: todayStr() });
  },
}));
