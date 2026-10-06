/**
 * 内嵌批注块（annotationBlock）—— 常量 / 类型 / 纯函数 / 对外接口
 *
 * 背景：编辑器里原本只有「offset 锚定的 annotation Mark」
 * （`extensions/AnnotationExtension.ts`）：它只能给**已有正文**套一个下划线式标记，
 * 无法承载目标截图里那种**块级**批注卡片 —— 浅灰底圆角矩形 + 左侧细强调条 +
 * 类型徽标（「待核 · 时间线」）+ 自由文本，独立于正文段落存在。
 *
 * 本文件 + `extensions/AnnotationBlockExtension.ts` + `extensions/AnnotationBlockView.ts`
 * 一起提供该能力，并把「什么算批注块 / 怎么统计 / 怎么过滤」的口径**只收口在这里**，
 * 避免统计口径漂移。三处消费者：
 *   · `editor/EditorPage.tsx`               —— 元信息行的插入入口
 *   · `editor/hooks/useAnnotationBlockBridge.ts` —— 对外发布未解决数量
 *   · `services/data/exportService.ts`      —— 导出时按开关剥离批注块
 *
 * 无 DOM 时的兜底：`strip/count` 都提供正则实现（本模块同时被导出链路与单测引用，
 * 不能假设一定有 `document`）。批注块 content 为 `inline*`（不可能嵌套 `<div>`），
 * 因此「非贪婪匹配到第一个 `</div>`」是安全的。
 */

/** 块级 Node 名（必须与 Tiptap 扩展的 `name` 一致） */
export const ANNOTATION_BLOCK_NODE_NAME = 'annotationBlock';

/** 宿主属性：出现它即认定这段 HTML 是批注块 */
export const ANNOTATION_BLOCK_ATTR = 'data-annotation-block';

/** 宿主 CSS 类：与 `renderHTML` 共用，也是 `parseHTML` 的第二条兜底规则 */
export const ANNOTATION_BLOCK_CLASS = 'nm-annotation-block';

/** 类型徽标缺省值 —— 对齐目标截图里的「待核 · 时间线」 */
export const DEFAULT_ANNOTATION_KIND = '待核 · 时间线';

/** 批注块 HTML 上的属性键名 */
export const ANNOTATION_BLOCK_KIND_ATTR = 'data-kind';
export const ANNOTATION_BLOCK_STATE_ATTR = 'data-state';

/** 批注块生命周期：未解决 / 已解决 */
export type AnnotationBlockState = 'open' | 'resolved';

/** 从 HTML 解析出来的单条批注块记录 */
export interface AnnotationBlockRecord {
  kind: string | null;
  state: AnnotationBlockState;
  text: string;
}

/** 批注块数量（`open` = 未解决，供外壳「N 条问题」使用） */
export interface AnnotationBlockCount {
  total: number;
  open: number;
}

/** 对外发布的快照（带章节归属，避免切章瞬间读到上一章的数字） */
export interface AnnotationBlockSummary extends AnnotationBlockCount {
  chapterId: string | null;
}

export const EMPTY_ANNOTATION_BLOCK_COUNT: AnnotationBlockCount = { total: 0, open: 0 };

export const EMPTY_ANNOTATION_BLOCK_SUMMARY: AnnotationBlockSummary = {
  chapterId: null,
  total: 0,
  open: 0,
};

/** 供 `querySelectorAll` 使用：属性或类名任一命中即算批注块 */
export const ANNOTATION_BLOCK_SELECTOR = `[${ANNOTATION_BLOCK_ATTR}], .${ANNOTATION_BLOCK_CLASS}`;

/**
 * 无 DOM 环境下的兜底匹配。捕获组：
 *   1 = 开标签内的属性串  2 = 块内 HTML
 * `[\s\S]*?` 非贪婪是安全的：content 为 `inline*`，块内不可能出现 `<div>`。
 */
const ANNOTATION_BLOCK_HTML_PATTERN = new RegExp(
  `<div\\b([^>]*(?:${ANNOTATION_BLOCK_ATTR}|${ANNOTATION_BLOCK_CLASS})[^>]*)>([\\s\\S]*?)<\\/div>`,
  'gi',
);

/** 仅用于「是否存在批注块」的快速预检（避免无谓的 DOM 往返） */
const ANNOTATION_BLOCK_HINT_PATTERN = new RegExp(
  `${ANNOTATION_BLOCK_ATTR}|${ANNOTATION_BLOCK_CLASS}`,
  'i',
);

/** 把任意输入规整成 kind：空串 / 纯空白 / 非字符串 → null（不渲染空徽标） */
export function normalizeAnnotationKind(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 把任意输入规整成状态：只认 `resolved`，其余一律 `open` */
export function normalizeAnnotationBlockState(value: unknown): AnnotationBlockState {
  return value === 'resolved' ? 'resolved' : 'open';
}

/** 在临时容器里跑一段 DOM 操作；无 `document` 时返回 null 交给正则兜底 */
function withHtmlContainer<T>(html: string, run: (container: HTMLElement) => T): T | null {
  if (typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.innerHTML = html;
  return run(container);
}

function collectByRegex(html: string): AnnotationBlockRecord[] {
  const records: AnnotationBlockRecord[] = [];
  const matcher = new RegExp(ANNOTATION_BLOCK_HTML_PATTERN.source, 'gi');
  let match: RegExpExecArray | null = matcher.exec(html);
  while (match !== null) {
    const attributes = match[1] ?? '';
    const inner = match[2] ?? '';
    const kindMatch = new RegExp(`${ANNOTATION_BLOCK_KIND_ATTR}="([^"]*)"`).exec(attributes);
    const stateMatch = new RegExp(`${ANNOTATION_BLOCK_STATE_ATTR}="([^"]*)"`).exec(attributes);
    records.push({
      kind: normalizeAnnotationKind(kindMatch ? decodeHtmlEntities(kindMatch[1] ?? '') : null),
      state: normalizeAnnotationBlockState(stateMatch ? stateMatch[1] : null),
      text: decodeHtmlEntities(inner.replace(/<[^>]*>/g, '')).trim(),
    });
    match = matcher.exec(html);
  }
  return records;
}

/** 极简实体解码（仅正则兜底路径需要；DOM 路径由浏览器自己处理） */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * 按文档顺序取出所有批注块（DOM 路径；无 `document` 时走正则）。
 * 顺序即正文顺序，用于「多块顺序稳定」。
 */
export function collectAnnotationBlocks(html: string): AnnotationBlockRecord[] {
  if (!html || !ANNOTATION_BLOCK_HINT_PATTERN.test(html)) return [];
  const fromDom = withHtmlContainer(html, (container) =>
    Array.from(container.querySelectorAll(ANNOTATION_BLOCK_SELECTOR)).map<AnnotationBlockRecord>((element) => ({
      kind: normalizeAnnotationKind(element.getAttribute(ANNOTATION_BLOCK_KIND_ATTR)),
      state: normalizeAnnotationBlockState(element.getAttribute(ANNOTATION_BLOCK_STATE_ATTR)),
      text: (element.textContent ?? '').trim(),
    })),
  );
  return fromDom ?? collectByRegex(html);
}

/** 统计批注块总数与未解决数 */
export function countAnnotationBlocks(html: string): AnnotationBlockCount {
  const records = collectAnnotationBlocks(html);
  let open = 0;
  for (const record of records) {
    if (record.state === 'open') open += 1;
  }
  return { total: records.length, open };
}

/**
 * 剥掉全部批注块（含块内文字），保留其余正文。
 * 无批注块时**原样返回**，避免 DOM 往返改写既有正文的写法。
 */
export function stripAnnotationBlocks(html: string): string {
  if (!html || !ANNOTATION_BLOCK_HINT_PATTERN.test(html)) return html;
  const fromDom = withHtmlContainer(html, (container) => {
    container.querySelectorAll(ANNOTATION_BLOCK_SELECTOR).forEach((element) => element.remove());
    return container.innerHTML;
  });
  if (fromDom !== null) return fromDom;
  return html.replace(new RegExp(ANNOTATION_BLOCK_HTML_PATTERN.source, 'gi'), '');
}

/** 取出所有批注块纯文本（诊断 / 测试用） */
export function annotationBlocksText(html: string): string {
  return collectAnnotationBlocks(html)
    .map((record) => record.text)
    .filter((text) => text.length > 0)
    .join('\n');
}

// ============================================================
// 对外接口：本章未解决批注数量
//
// 外壳（apps/web/src/**，底部细条「N 条问题 Ctrl+J」）**不需要** import 本插件内部
// 文件即可消费，三条通道任选：
//   1. `annotationBlockBridge.subscribe(listener)` + `getSnapshot()`（同进程、有类型）
//   2. `window.__novelmuseAnnotationBlocks` 全局快照（零 import）
//   3. `window.addEventListener('novelmuse:annotation-blocks', e => e.detail)`（零 import，事件驱动）
// 快照只在数值真正变化时换引用（`useSyncExternalStore` 要求引用稳定）。
// ============================================================

/** 对外事件名；`detail` 为 `AnnotationBlockSummary` */
export const ANNOTATION_BLOCKS_EVENT = 'novelmuse:annotation-blocks';

/** 对外全局键名：`window.__novelmuseAnnotationBlocks` */
export const ANNOTATION_BLOCKS_GLOBAL = '__novelmuseAnnotationBlocks';

type AnnotationBlockSummaryListener = (summary: AnnotationBlockSummary) => void;

let currentSummary: AnnotationBlockSummary = EMPTY_ANNOTATION_BLOCK_SUMMARY;

const summaryListeners = new Set<AnnotationBlockSummaryListener>();

function windowLikeTarget(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as Record<string, unknown>;
}

function hasSameValues(left: AnnotationBlockSummary, right: AnnotationBlockSummary): boolean {
  return left.chapterId === right.chapterId && left.total === right.total && left.open === right.open;
}

/** 宽松校验外部（或全局变量里）拿到的值是否像个快照 */
export function isAnnotationBlockSummary(value: unknown): value is AnnotationBlockSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.total === 'number' && typeof candidate.open === 'number';
}

/**
 * 未解决批注数量的对外桥梁。
 * 三条通道都由 `publish` 一次性写出，不存在「只更新了一条通道」的半状态。
 */
export const annotationBlockBridge = {
  /** 当前快照（引用稳定：数值不变则返回同一个对象） */
  getSnapshot(): AnnotationBlockSummary {
    return currentSummary;
  },

  /** 订阅变化；返回取消函数 */
  subscribe(listener: AnnotationBlockSummaryListener): () => void {
    summaryListeners.add(listener);
    return () => {
      summaryListeners.delete(listener);
    };
  },

  /** 发布新快照：更新模块状态 + 全局变量 + 派发事件 */
  publish(input: AnnotationBlockSummary): AnnotationBlockSummary {
    const next = hasSameValues(input, currentSummary)
      ? currentSummary
      : { chapterId: input.chapterId, total: input.total, open: input.open };
    const changed = next !== currentSummary;
    currentSummary = next;

    const target = windowLikeTarget();
    if (target) {
      target[ANNOTATION_BLOCKS_GLOBAL] = currentSummary;
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent<AnnotationBlockSummary>(ANNOTATION_BLOCKS_EVENT, { detail: currentSummary }));
      }
    }

    if (changed) {
      for (const listener of Array.from(summaryListeners)) {
        try {
          listener(currentSummary);
        } catch (error) {
          console.warn('[annotationBlocks] 订阅回调异常', error);
        }
      }
    }
    return currentSummary;
  },
};

/** 便捷发布：由「计数 + 章节 id」直接发布 */
export function publishAnnotationBlockSummary(
  count: AnnotationBlockCount,
  chapterId: string | null,
): AnnotationBlockSummary {
  return annotationBlockBridge.publish({ chapterId, total: count.total, open: count.open });
}

/** 清空（切到无章节 / 编辑器卸载时调用） */
export function resetAnnotationBlockSummary(): AnnotationBlockSummary {
  return annotationBlockBridge.publish(EMPTY_ANNOTATION_BLOCK_SUMMARY);
}

/** 零 import 消费者读全局的辅助函数（全局缺失时回落到模块内快照） */
export function readAnnotationBlockSummary(): AnnotationBlockSummary {
  const target = windowLikeTarget();
  const value = target ? target[ANNOTATION_BLOCKS_GLOBAL] : undefined;
  return isAnnotationBlockSummary(value)
    ? { chapterId: typeof value.chapterId === 'string' ? value.chapterId : null, total: value.total, open: value.open }
    : currentSummary;
}
