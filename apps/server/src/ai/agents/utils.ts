/**
 * 解析 AI Agent 返回的 JSON 字符串。
 * 处理 LLM 输出中常见的格式问题：
 * - markdown 代码块包裹（```json ... ```）
 * - 字符串值中未转义的双引号/换行符
 * - 被 maxTokens 截断的不完整 JSON（尝试补全闭合括号）
 *
 * 解析失败时抛出错误，而非静默返回空对象，让上层 catch 统一处理，
 * 避免下游消费者误把空对象当作有效结果。
 */
export function parseAgentJson(content: string, agentLabel: string): Record<string, unknown> {
  const cleaned = content
    .replace(/```json\s*\n?/gi, '')
    .replace(/```/g, '')
    .trim();

  if (!cleaned) return {};

  // 第一次尝试：直接解析
  try {
    return JSON.parse(cleaned);
  } catch {
    // 继续走修复路径
  }

  // 第二次尝试：修复常见的 LLM 输出问题
  const repaired = repairJson(cleaned);
  try {
    return JSON.parse(repaired);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`[${agentLabel}] JSON 解析失败: ${reason}`);
  }
}

/**
 * 修复 LLM 输出的常见 JSON 格式问题：
 *
 * 1. 截断的 JSON：被 maxTokens 截断时，补全缺失的闭合引号、括号、花括号
 * 2. 字符串值中包含未转义的双引号：将值内部的裸双引号转为转义形式
 * 3. 字符串值中包含裸换行符：转为 \n 转义
 *
 * 这不是完整的 JSON 修复器，只处理 LLM 最常见的几种失败模式。
 * 复杂的格式问题仍会让 JSON.parse 失败，由上层 catch 处理。
 */
function repairJson(raw: string): string {
  let s = raw;

  // 1. 提取第一个 { 到最后一个 } 之间的内容（去除前后杂文字）
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  } else if (firstBrace !== -1) {
    // 只有开括号没有闭括号 —— JSON 被截断，取从开括号到末尾
    s = s.slice(firstBrace);
  }

  // 2. 修复字符串值中的裸换行符（JSON 规范不允许字符串内有真实换行）
  // 匹配 "key": "value..." 中 value 部分的裸换行，转为 \n
  s = s.replace(/:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, strContent: string) => {
    if (!strContent.includes('\n') && !strContent.includes('\r')) return match;
    const escaped = strContent
      .replace(/\r\n/g, '\\n')
      .replace(/\r/g, '\\n')
      .replace(/\n/g, '\\n');
    return match.replace(strContent, escaped);
  });

  // 3. 补全被截断的 JSON：统计未闭合的 { 和 [，并在末尾补上
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }

  // 如果在字符串中被截断，先闭合字符串
  if (inString) {
    s += '"';
  }

  // 补全缺失的闭合符号
  while (openBrackets > 0) {
    s += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    s += '}';
    openBraces--;
  }

  return s;
}