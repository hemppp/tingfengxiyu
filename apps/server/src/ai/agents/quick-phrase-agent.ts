import type { ChatMessage } from '../providers/provider-factory.js';
import { parseAgentJson } from './utils.js';

const SYSTEM_PROMPT = `你是一个网文写作助手，负责从小说章节内容中提取最常用的快捷短语，方便作者快速插入到正文中。

你需要提取以下类型的常用短语：
1. 主角名字及其别名（最重要，出现频率最高的角色名）
2. 重要配角名字
3. 常用地点名
4. 高频出现的标志性物品/法宝名
5. 反复出现的动作/神态描写短语（如"微微一笑"、"眉头微皱"等）
6. 标志性的口头禅/对话短句

要求：
- 短语要简洁实用，长度控制在2-15个字
- 优先提取出现频率高的
- 提取6-10个最常用的
- 按重要程度排序（最重要的放前面）
- 只返回短语本身，不要解释或说明`;

function buildUserPrompt(content: string, characters?: string): string {
  return `请从以下小说章节内容中提取最常用的快捷短语：

${characters ? `已知角色（供参考）：${characters}\n\n` : ''}章节内容：
---
${content.slice(0, 4000)}
---

请提取6-10个最常用的快捷短语，按重要程度排序。`;
}

function buildOutputFormatSection(): string {
  return `
输出格式要求：返回纯JSON数组，不要任何额外文字、不要Markdown代码块包裹。
示例输出：
["周粥", "粥粥", "林墨", "青云宗", "微微一笑", "眉头微皱", "传音道"]`;
}

export async function runQuickPhraseExtract(
  chat: (messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }, signal?: AbortSignal) => Promise<string>,
  input: { content: string; characters?: string },
  options?: { signal?: AbortSignal },
): Promise<{ suggestions: string[] }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildUserPrompt(input.content, input.characters) + '\n\n' + buildOutputFormatSection(),
    },
  ];

  try {
    const response = await chat(messages, {
      temperature: 0.3,
      maxTokens: 512,
    }, options?.signal);

    const parsed = parseAgentJson(response, 'QuickPhraseAgent');

    let suggestions: string[] = [];
    if (Array.isArray(parsed)) {
      suggestions = parsed.filter((s: unknown): s is string => typeof s === 'string' && s.length >= 2 && s.length <= 20);
    } else if (parsed && Array.isArray((parsed as Record<string, unknown>).suggestions)) {
      suggestions = (parsed as Record<string, unknown>).suggestions as string[];
    }

    return { suggestions: suggestions.slice(0, 10) };
  } catch (e) {
    console.debug('[QuickPhraseAgent] AI调用失败，返回空结果:', e instanceof Error ? e.message : e);
    return { suggestions: [] };
  }
}
