/**
 * PDF/EPUB/DOCX 导出服务
 * 使用浏览器端生成，无需后端
 */

import DOMPurify from 'dompurify';

function toText(html: string): string {
  // XSS 防护：先净化 HTML 再提取纯文本
  const sanitized = DOMPurify.sanitize(html, { ALLOWED_TAGS: [] });
  const div = document.createElement('div');
  div.innerHTML = sanitized;
  return div.textContent || '';
}

interface ExportOptions {
  title: string;
  author?: string;
  chapters: { title: string; content: string }[];
  format: 'markdown' | 'html' | 'txt' | 'pdf' | 'docx' | 'epub';
}

/**
 * 导出为 TXT
 */
function exportTXT(options: ExportOptions): string {
  const lines: string[] = [];
  lines.push(`${options.title}`);
  if (options.author) lines.push(`作者：${options.author}`);
  lines.push('='.repeat(40));
  lines.push('');

  for (const ch of options.chapters) {
    lines.push(`## ${ch.title}`);
    lines.push('');
    lines.push(toText(ch.content));
    lines.push('');
    lines.push('-'.repeat(40));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 导出为 Markdown
 */
function exportMarkdown(options: ExportOptions): string {
  const lines: string[] = [];
  lines.push(`# ${options.title}`);
  if (options.author) lines.push(`> 作者：${options.author}`);
  lines.push('');

  for (const ch of options.chapters) {
    lines.push(`## ${ch.title}`);
    lines.push('');
    lines.push(toText(ch.content));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 导出为 HTML
 */
function exportHTML(options: ExportOptions): string {
  const chapters = options.chapters
    .map(
      (ch) => `
    <section class="chapter">
      <h2>${ch.title}</h2>
      <div>${ch.content}</div>
    </section>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${options.title}</title>
  <style>
    body { font-family: "Noto Serif SC", serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.8; }
    h1 { text-align: center; margin-bottom: 40px; }
    h2 { margin-top: 2em; border-bottom: 1px solid #ccc; padding-bottom: 0.5em; }
    .chapter { margin-bottom: 3em; }
    p { text-indent: 2em; margin: 0.5em 0; }
    blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #666; }
  </style>
</head>
<body>
  <h1>${options.title}</h1>
  ${options.author ? `<p style="text-align:center;color:#666">作者：${options.author}</p>` : ''}
  ${chapters}
</body>
</html>`;
}

/**
 * 下载文件
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出为 PDF（使用浏览器打印）
 */
function exportPDF(options: ExportOptions) {
  const html = exportHTML(options);
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 500);
  }
}

/**
 * 导出为 DOCX（使用 HTML 转 DOCX 格式）
 * 简单方案：保存为 .doc 扩展名的 HTML
 */
function exportDOCX(options: ExportOptions) {
  // 添加 Word 兼容头
  const docContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>打印</w:View>
      <w:Zoom>100</w:Zoom>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body { font-family: "SimSun", serif; font-size: 12pt; line-height: 1.5; }
    h1 { font-size: 22pt; text-align: center; }
    h2 { font-size: 16pt; margin-top: 24pt; }
    p { text-indent: 2em; }
  </style>
</head>
<body>
  <h1>${options.title}</h1>
  ${options.author ? `<p style="text-align:center">作者：${options.author}</p>` : ''}
  ${options.chapters
    .map(
      (ch) => `<h2>${ch.title}</h2>\n<div>${ch.content}</div>`
    )
    .join('\n')}
</body>
</html>`;

  downloadFile(docContent, `${options.title}.doc`, 'application/msword');
}

/**
 * 导出为 EPUB（简化版，生成 EPUB HTML）
 */
function exportEPUB(options: ExportOptions) {
  // 简化方案：生成可阅读的 HTML 文件
  // 完整 EPUB 需要 zip 库支持
  const html = exportHTML(options);
  downloadFile(html, `${options.title}.html`, 'text/html');
}

/**
 * 主导出函数
 */
export function exportBook(options: ExportOptions) {
  switch (options.format) {
    case 'txt':
      const txt = exportTXT(options);
      downloadFile(txt, `${options.title}.txt`, 'text/plain');
      break;
    case 'pdf':
      exportPDF(options);
      break;
    case 'docx':
      exportDOCX(options);
      break;
    case 'epub':
      exportEPUB(options);
      break;
    default:
      const md = exportMarkdown(options);
      downloadFile(md, `${options.title}.md`, 'text/markdown');
  }
}
