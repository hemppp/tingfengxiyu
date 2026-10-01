// ============================================================
// HTML 文本工具
//
// 历史上的实体检测（正则 + 词典 + 缓存）已移除，改由后端 /ai/scan
// 提供 LLM 实体抽取与关系检测。这里仅保留纯工具函数 htmlToText / plainTextToHtml。
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

/** 转义 HTML 特殊字符，避免纯文本里的 `<` / `&` 被当成标签解析 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 判断一段内容是否**不含任何 HTML 标签**（即纯文本）。
 * 纯文本正文（如 AI 写作链路落库的 `\n\n` 分段文本）必须转成 HTML 再交给
 * tiptap，否则 `setContent(字符串)` 会按 HTML 解析、把换行当空白吞掉、段落全并成一段。
 */
export function isPlainText(content: string): boolean {
  return !/<\/?[a-zA-Z][^>]*>/.test(content);
}

/**
 * 将纯文本转换为 HTML —— `htmlToText` 的逆函数（段落数可往返，空段落不保留）。
 *
 * 分段规则：
 * - `\n\n`（空行）→ 段落边界 `<p>`；连续多个空行只当一个段界
 * - 单个 `\n`（段内换行）→ `<br>`
 * - `\r\n` / `\r` 先归一为 `\n`
 * - 首尾空行被裁掉，不产生前导/尾随空段落
 *
 * ⚠️ **仅对纯文本调用**（先用 `isPlainText` 判断）。传入 HTML 会被转义成可见字符。
 */
export function plainTextToHtml(text: string): string {
  if (!text) return '';
  const normalized = text.replace(/\r\n?/g, '\n');
  // ★ 口径与项目其它处一致（如 StyleAdvisor 的 `text.split(/\n\n/)`）：
  //   空行 = 段落分隔符，连续多个空行**只当一个段界**（HTML 的 <p> 之间本就靠边距撑开，
  //   tiptap 也会按 schema 归一化，空 <p> 无法无损保留）。
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p !== '');
  if (paragraphs.length === 0) return '';
  return paragraphs
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * 注入编辑器前的安全转换：**纯文本才转换，已是 HTML 则原样返回**。
 *
 * 两处注入点都走它，避免「AI 落库的纯文本正文」与「编辑器自身的 HTML」
 * 两种数据格式在 `setContent` 里被混为一谈（这是段落被打平的根因）。
 */
export function ensureHtmlContent(content: string): string {
  if (!content) return '';
  return isPlainText(content) ? plainTextToHtml(content) : content;
}
