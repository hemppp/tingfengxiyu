// ============================================================
// 本地启发式短语提取（manual 模块内）
//
// 从 kernel `apps/web/src/services/ai/quickPhraseService.ts` 的
// `extractHeuristicPhrases` 原样搬入（t4，D35/D36）：
//   · `ai.quickPhrases` 能力缺失（auto 模块缺席）时走本函数（设计 §5.3）
//   · 零 AI 依赖：只用正文文本 + 角色名/别名做包含匹配
// ============================================================

interface Character {
  name?: string;
  aliases?: string[];
}

export function extractHeuristicPhrases(content: string, characters: Character[]): string[] {
  const phrases: string[] = [];
  const seen = new Set<string>();

  for (const c of characters) {
    if (c.name && content.includes(c.name)) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        phrases.push(c.name);
      }
    }
    if (c.aliases) {
      for (const alias of c.aliases) {
        if (alias && content.includes(alias) && !seen.has(alias)) {
          seen.add(alias);
          phrases.push(alias);
        }
      }
    }
  }

  const patterns = [
    /「([^」]{1,15})」/g,
    /“([^”]{1,15})”/g,
    /‘([^’]{1,15})’/g,
  ];
  const dialogueSet = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length >= 2 && text.length <= 15) {
        dialogueSet.add(text);
      }
    }
  }

  const dialogueCounts = new Map<string, number>();
  for (const d of dialogueSet) {
    let count = 0;
    let idx = 0;
    while ((idx = content.indexOf(d, idx)) !== -1) {
      count++;
      idx += d.length;
    }
    if (count >= 2) {
      dialogueCounts.set(d, count);
    }
  }

  const ranked = [...dialogueCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [text] of ranked) {
    if (phrases.length >= 8) break;
    if (!seen.has(text)) {
      seen.add(text);
      phrases.push(text);
    }
  }

  return phrases.slice(0, 8);
}