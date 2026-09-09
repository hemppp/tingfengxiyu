import { useMemo, useState, useEffect, useCallback } from 'react';
import { useChapterStore, useCharacterStore, useOutlineStore, useForeshadowStore } from '@/stores';
import type { BadgeId } from '@/components/stats/AchievementBadge';

export interface UnlockedAchievement {
  id: BadgeId;
  unlockedAt: number;
}

const ACHIEVEMENTS_KEY = 'novelmuse_achievements';

/**
 * 读取 localStorage 中的成就列表
 */
function readUnlockedAchievements(): UnlockedAchievement[] {
  try {
    const stored = localStorage.getItem(ACHIEVEMENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useAchievements() {
  const chapters = useChapterStore((s) => s.chapters);
  const characters = useCharacterStore((s) => s.characters);
  const nodes = useOutlineStore((s) => s.nodes);
  const foreshadows = useForeshadowStore((s) => s.foreshadows);

  // 计算连续写作天数
  const consecutiveDays = useMemo(() => {
    if (chapters.length === 0) return 0;

    const dates = [...new Set(
      chapters
        .filter(ch => ch.updatedAt)
        .map(ch => ch.updatedAt ? new Date(ch.updatedAt).toISOString().split('T')[0] : '')
    )].sort().reverse();

    if (dates.length === 0) return 0;

    const today = new Date().toISOString().split('T')[0];
    const startDate = dates[0];

    // 如果最近有章节更新的日期不是今天或昨天，连续天数为0
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (startDate !== today && startDate !== yesterdayStr) return 0;

    let streak = 0;
    const current = new Date(startDate!);
    for (const dateStr of dates) {
      const expected = current.toISOString().split('T')[0];
      if (dateStr === expected) {
        streak++;
        current.setDate(current.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }, [chapters]);

  // 仅在挂载时从 localStorage 读取一次，避免每次渲染同步读 localStorage
  const [unlockedAchievements, setUnlockedAchievements] = useState<UnlockedAchievement[]>(() =>
    readUnlockedAchievements(),
  );

  // 监听 storage 事件（其他标签页更新时同步）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACHIEVEMENTS_KEY) {
        setUnlockedAchievements(readUnlockedAchievements());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const unlockedIds = useMemo(
    () => new Set(unlockedAchievements.map(a => a.id)),
    [unlockedAchievements],
  );

  // 检测成就
  const checkAchievements = useCallback((): BadgeId[] => {
    const newlyUnlocked: BadgeId[] = [];
    const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);

    if (!unlockedIds.has('first_chapter') && chapters.filter(ch => ch.wordCount > 0).length >= 1) {
      newlyUnlocked.push('first_chapter');
    }
    if (!unlockedIds.has('ten_thousand_words') && totalWords >= 10000) {
      newlyUnlocked.push('ten_thousand_words');
    }
    if (!unlockedIds.has('fifty_thousand_words') && totalWords >= 50000) {
      newlyUnlocked.push('fifty_thousand_words');
    }
    if (!unlockedIds.has('hundred_thousand_words') && totalWords >= 100000) {
      newlyUnlocked.push('hundred_thousand_words');
    }
    if (!unlockedIds.has('seven_day_streak') && consecutiveDays >= 7) {
      newlyUnlocked.push('seven_day_streak');
    }
    if (!unlockedIds.has('thirty_day_streak') && consecutiveDays >= 30) {
      newlyUnlocked.push('thirty_day_streak');
    }
    if (!unlockedIds.has('character_complete') && characters.length >= 5) {
      newlyUnlocked.push('character_complete');
    }
    if (!unlockedIds.has('foreshadow_resolved') && foreshadows.filter(f => f.status === 'payed_off').length >= 3) {
      newlyUnlocked.push('foreshadow_resolved');
    }
    if (!unlockedIds.has('all_chapters_outlined') && chapters.length > 0 && nodes.length > 0) {
      const linkedChapterIds = new Set(nodes.flatMap(n => n.linkedChapterIds || []));
      if (chapters.every(ch => linkedChapterIds.has(ch.id))) {
        newlyUnlocked.push('all_chapters_outlined');
      }
    }

    return newlyUnlocked;
  }, [chapters, characters, foreshadows, nodes, unlockedIds, consecutiveDays]);

  // 解锁成就：更新 state + localStorage
  const unlock = useCallback((id: BadgeId) => {
    setUnlockedAchievements((prev) => {
      if (prev.some(a => a.id === id)) return prev;
      const updated = [...prev, { id, unlockedAt: Date.now() }];
      try {
        localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(updated));
      } catch {
        // 静默忽略
      }
      return updated;
    });
  }, []);

  return { unlockedIds, unlockedAchievements, checkAchievements, unlock };
}
