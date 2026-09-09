// ============================================================
// HTML 文本工具
//
// 历史上的实体检测（正则 + 词典 + 缓存）已移除，改由后端 /ai/scan
// 提供 LLM 实体抽取与关系检测。这里仅保留纯工具函数 htmlToText。
// ============================================================

/**
 * 将 HTML 章节内容转换为纯文本。
 * 保留段落换行，去除所有标签并解码常见 HTML 实体。
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return text;
}
