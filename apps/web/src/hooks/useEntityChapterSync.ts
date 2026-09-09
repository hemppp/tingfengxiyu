// ============================================================
// 实体-章节反向同步 Hook
//
// 设计动机：
// - useAutoEntityDetection 只加不减（AI 识别新实体时把当前章节 order 加入 chapters 数组）
// - 当用户编辑章节内容，删除了某角色的所有提及，角色的 chapters 数组仍保留该 order
// - 当 chapters 数组为空时，实体成为"幽灵"，仍显示在面板中
//
// 本 Hook 用本地关键词匹配做反向清理（不耗 AI 调用）：
// - 防抖监听当前章节内容变化
// - 遍历所有实体（角色/物品/地点），检查其名字+别名是否出现在章节纯文本中
// - 若未出现但 chapters 包含当前 order，则移除该 order
// - 移除后 chapters 为空 → 删除实体（与 cascadeCleanChapterClient 孤儿清理语义一致）
// - 章节内容从有到无（>20字 → ≤20字）时，批量移除该章节的所有实体引用
//
// 与 AI 扫描的关系：
// - AI 扫描负责"添加"：识别新实体并创建，把当前章节 order 加入 chapters
// - 本 Hook 负责"清理"：本地关键词匹配，移除失效引用
// 两者互补，共同维护实体-章节引用的实时准确性
// ============================================================

import { useEffect, useRef } from 'react';
import { useCharacterStore, useItemStore, useLocationStore } from '@/stores';
import { cascadeCleanFlag } from '@/stores/cascadeCleanFlag';
import { htmlToText } from '@/services/editor/entityDetector';

/** 防抖时间：用户停止输入后等待多久开始反向清理 (ms) */
const SYNC_DEBOUNCE_MS = 1000;

/** 章节纯文本最小长度阈值，用于判断内容是否"接近清空" */
const EMPTY_TEXT_THRESHOLD = 20;

/**
 * 新建实体保护期（ms）。
 *
 * 背景：AI 扫描（useAutoEntityDetection）创建新角色时用规范名（如"诸葛亮"），
 * 但章节文本中可能是别名（如"孔明"）。AI 的实体行先到达，alias_match 行后到达，
 * 两者之间存在时间窗口。如果 useEntityChapterSync 在此窗口内跑反向清理，
 * `plainText.includes("诸葛亮")` 返回 false → 误删角色。
 *
 * 保护策略：updatedAt 在最近 NEW_ENTITY_GRACE_MS 内的实体跳过清理，
 * 等 alias_match 行处理完毕后再参与反向同步。
 */
const NEW_ENTITY_GRACE_MS = 30_000;

/**
 * 实体-章节反向同步
 *
 * @param chapterId - 当前章节 ID（null 时不执行）
 * @param chapterContent - 当前章节 HTML 内容
 * @param chapterOrder - 当前章节序号
 */
export function useEntityChapterSync(
  chapterId: string | null | undefined,
  chapterContent: string,
  chapterOrder: number,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chapterIdRef = useRef(chapterId);
  chapterIdRef.current = chapterId;
  const chapterContentRef = useRef(chapterContent);
  chapterContentRef.current = chapterContent;
  const chapterOrderRef = useRef(chapterOrder);
  chapterOrderRef.current = chapterOrder;
  const lastSignatureRef = useRef<string>('');
  // 记录上一次的纯文本长度，用于检测"从有到无"的边界
  const lastTextLenRef = useRef<number>(0);

  useEffect(() => {
    if (!chapterId || !chapterContent) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    // ★ 捕获触发时的 chapterId，setTimeout 触发时校验是否仍是同一章节
    // 防止场景：旧章节 1000ms debounce 期间用户切到新章节（空），旧 timer 触发时
    // chapterIdRef.current 已指向新章节，但 lastTextLenRef 仍是旧章节字数 → 误清新章节关联实体
    const triggerChapterId = chapterId;

    timerRef.current = setTimeout(() => {
      const cid = chapterIdRef.current;
      const content = chapterContentRef.current;
      const order = chapterOrderRef.current;
      if (!cid || !content) return;
      // ★ 跨章节保护：debounce 期间切换了章节，旧 timer 直接作废
      if (cid !== triggerChapterId) return;

      const plainText = htmlToText(content);
      const textLen = plainText.trim().length;
      const prevLen = lastTextLenRef.current;

      // 内容签名比对：完全相同则跳过
      const signature = `${cid}:${content.length}:${content.slice(0, 100)}`;
      if (signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;

      // 两种情况触发清理：
      // 1. 内容充足（>20字）：关键词匹配，精细清理
      // 2. 内容从有到无（之前>20字，现在≤20字）：批量移除该章节的所有实体引用
      const wasNotEmpty = prevLen > EMPTY_TEXT_THRESHOLD;
      const nowEmpty = textLen <= EMPTY_TEXT_THRESHOLD;
      const isFlushEmpty = wasNotEmpty && nowEmpty;

      if (!isFlushEmpty && nowEmpty) {
        // 内容一直很短（如新章节刚写了几个字），不触发清理，避免 mount 竞态
        lastTextLenRef.current = textLen;
        return;
      }

      let charsUpdated = 0;
      let charsDeleted = 0;
      let itemsUpdated = 0;
      let itemsDeleted = 0;
      let locsUpdated = 0;
      let locsDeleted = 0;

      // ★ 新建保护期：AI 刚创建的实体（updatedAt 在最近 NEW_ENTITY_GRACE_MS 内）跳过清理，
      // 等 alias_match 行处理完毕后再参与反向同步。
      // 关键：AI 用规范名创建角色时 aliases:[]，alias_match 行稍后到达才填充别名，
      // 此窗口内 plainText.includes(c.name) 可能失败导致误删。
      const now = Date.now();
      const isWithinGrace = (updatedAt: number | undefined): boolean =>
        !!updatedAt && now - updatedAt < NEW_ENTITY_GRACE_MS;

      // ---- 角色反向清理 ----
      const charStore = useCharacterStore.getState();
      const survivedChars: typeof charStore.characters = [];
      for (const c of charStore.characters) {
        if (!(c.chapters || []).includes(order)) {
          survivedChars.push(c);
          continue;
        }
        // ★ 新建保护期内的角色跳过清理（alias_match 行可能尚未到达）
        if (isWithinGrace(c.updatedAt)) {
          survivedChars.push(c);
          continue;
        }
        // 清空模式：直接移除该 order（内容都没了，肯定不再提及）
        // 正常模式：关键词匹配检查是否仍提及
        const mentioned = isFlushEmpty
          ? false
          : [c.name, ...(c.aliases || [])].filter(Boolean).some((n) => plainText.includes(n));
        if (mentioned) {
          survivedChars.push(c);
          continue;
        }
        const newChapters = (c.chapters || []).filter((ch) => ch !== order);
        if (newChapters.length === 0) {
          charsDeleted++;
          continue;
        }
        survivedChars.push({ ...c, chapters: newChapters, updatedAt: Date.now() });
        charsUpdated++;
      }

      // ---- 物品反向清理 ----
      const itemStore = useItemStore.getState();
      const survivedItems: typeof itemStore.items = [];
      for (const it of itemStore.items) {
        if (!(it.chapters || []).includes(order)) {
          survivedItems.push(it);
          continue;
        }
        if (isWithinGrace(it.updatedAt)) {
          survivedItems.push(it);
          continue;
        }
        const mentioned = isFlushEmpty
          ? false
          : [it.name].filter(Boolean).some((n) => plainText.includes(n));
        if (mentioned) {
          survivedItems.push(it);
          continue;
        }
        const newChapters = (it.chapters || []).filter((ch) => ch !== order);
        if (newChapters.length === 0 && (it.holders || []).length === 0) {
          itemsDeleted++;
          continue;
        }
        survivedItems.push({ ...it, chapters: newChapters, updatedAt: Date.now() });
        itemsUpdated++;
      }

      // ---- 地点反向清理 ----
      const locStore = useLocationStore.getState();
      const survivedLocs: typeof locStore.locations = [];
      for (const l of locStore.locations) {
        if (!(l.chapters || []).includes(order)) {
          survivedLocs.push(l);
          continue;
        }
        if (isWithinGrace(l.updatedAt)) {
          survivedLocs.push(l);
          continue;
        }
        const mentioned = isFlushEmpty
          ? false
          : [l.name].filter(Boolean).some((n) => plainText.includes(n));
        if (mentioned) {
          survivedLocs.push(l);
          continue;
        }
        const newChapters = (l.chapters || []).filter((ch) => ch !== order);
        if (newChapters.length === 0) {
          locsDeleted++;
          continue;
        }
        survivedLocs.push({ ...l, chapters: newChapters, updatedAt: Date.now() });
        locsUpdated++;
      }

      const totalDeleted = charsDeleted + itemsDeleted + locsDeleted;
      if (charsUpdated || charsDeleted || itemsUpdated || itemsDeleted || locsUpdated || locsDeleted) {
        // ★ 修复时序：必须在 setCharacters/setItems/setLocations 之前激活 cascadeCleanFlag，
        // 否则 useEntitySync 的 subscribe 回调会在 activate() 之前执行，
        // 检测到 3+ 实体消失时跳过 DELETE 请求，导致后端残留
        if (totalDeleted >= 3) {
          cascadeCleanFlag.activate();
          console.debug(`[EntityChapterSync] 批量删除 ${totalDeleted} 个实体，已激活批量删除豁免标志`);
        }

        if (charsUpdated > 0 || charsDeleted > 0) {
          charStore.setCharacters(survivedChars);
        }
        if (itemsUpdated > 0 || itemsDeleted > 0) {
          itemStore.setItems(survivedItems);
        }
        if (locsUpdated > 0 || locsDeleted > 0) {
          locStore.setLocations(survivedLocs);
        }

        console.debug(
          `[EntityChapterSync] chapter=${order} ${isFlushEmpty ? '清空模式' : '关键词模式'}反向清理: ` +
          `characters更新=${charsUpdated} 删除=${charsDeleted} ` +
          `items更新=${itemsUpdated} 删除=${itemsDeleted} ` +
          `locations更新=${locsUpdated} 删除=${locsDeleted}`,
        );
      }

      lastTextLenRef.current = textLen;
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [chapterId, chapterContent]);

  // 章节切换时重置签名和长度记录，确保新章节首次触发清理
  useEffect(() => {
    lastSignatureRef.current = '';
    lastTextLenRef.current = 0;
  }, [chapterId]);
}
