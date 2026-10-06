/**
 * 章节元信息行（标题下方那行小字）的纯函数推导。
 *
 * 单独成文件的原因：这段逻辑要能被单测直接钉住——四段必须**全部来自真实数据**
 * （实时字数 / chapter.updatedAt / chapter.label 或 order / 人物-章节关联），
 * 且任一段缺失时整段不进入数组，绝不渲染空占位或 "null"。
 * 本文件不依赖 React、stores 或 @novel/shared，只做结构化输入 → 展示文本。
 */

/** 元信息行的一段 */
export interface MetaSegment {
  key: string;
  text: string;
  title: string;
}

/** 推导「在场人物」所需的最小角色形状（结构兼容 @novel/shared 的 Character） */
export interface ChapterMetaCharacter {
  name?: string | null;
  /** 出场章节列表，存的是章节的 order 序号 */
  chapters?: readonly number[] | null;
}

/** 推导一段元信息所需的全部真实输入 */
export interface ChapterMetaInput {
  /** 章节持久化字数（编辑器未就绪时的回落值） */
  wordCount?: number | null;
  /** 章节最后修改时间戳（ms） */
  updatedAt?: number | null;
  /** 章节真实标签，如 "D1" */
  label?: string | null;
  /** 章节真实序号（全书序） */
  order?: number | null;
  /** 编辑器实时字数（useEditorInstance 产出，未就绪为 null） */
  liveWordCount?: number | null;
  /** 全部角色，用于推导本章在场人物 */
  characters?: readonly ChapterMetaCharacter[] | null;
}

/** 字数千分位：2410 → 2,410 */
export function formatWordCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * 章节最后修改时间：同一天只给 HH:mm（对齐目标截图口径），跨天补 MM-DD；
 * 缺失或非法（0 / NaN / 非数字）返回 null —— 调用方据此整段不渲染。
 * `now` 可注入，便于测试跨天分支。
 */
export function formatUpdatedAt(timestamp: number | null | undefined, now: Date = new Date()): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

/**
 * 推导元信息行。返回空数组表示这一章没有任何可展示的真实数据（不产生空占位）。
 *
 * 四段的取舍：
 *  1. 字数：编辑器实时字数优先，未就绪时回落 chapter.wordCount；
 *  2. 最后修改：chapter.updatedAt；
 *  3. 本章标识：chapter.label（真实标签）优先，否则 chapter.order → `D{order}`；
 *  4. 在场人物：character.chapters 含本章 order 的角色名（不写死）。
 */
export function buildChapterMetaSegments(
  input: ChapterMetaInput | null | undefined,
  now: Date = new Date(),
): MetaSegment[] {
  if (!input) return [];
  const segments: MetaSegment[] = [];

  const live = input.liveWordCount;
  const persisted = input.wordCount;
  const wordCount =
    typeof live === 'number' && Number.isFinite(live)
      ? live
      : typeof persisted === 'number' && Number.isFinite(persisted)
        ? persisted
        : null;
  if (wordCount !== null && wordCount >= 0) {
    segments.push({
      key: 'words',
      text: `${formatWordCount(wordCount)} 字`,
      title: '本章字数（编辑器实时统计）',
    });
  }

  const updatedAtText = formatUpdatedAt(input.updatedAt, now);
  if (updatedAtText && typeof input.updatedAt === 'number') {
    segments.push({
      key: 'updated',
      text: `最后修改 ${updatedAtText}`,
      title: `最后修改于 ${new Date(input.updatedAt).toLocaleString('zh-CN')}`,
    });
  }

  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const order = input.order;
  const hasOrder = typeof order === 'number' && Number.isFinite(order);
  const badge = label || (hasOrder ? `D${order}` : '');
  if (badge) {
    segments.push({
      key: 'badge',
      text: `本章 ${badge}`,
      title: label ? '本章标签' : `本章序号（全书第 ${order} 章）`,
    });
  }

  const present = (input.characters ?? [])
    .filter((character) => hasOrder && (character.chapters ?? []).includes(order as number))
    .map((character) => character.name?.trim())
    .filter((name): name is string => !!name);
  if (present.length > 0) {
    segments.push({
      key: 'cast',
      text: `在场: ${present.join(' / ')}`,
      title: '本章在场人物（由人物-章节关联推导）',
    });
  }

  return segments;
}
