// ============================================================
// OpenAI Agents SDK Agent 核心
//
// 基于 OpenAI Agents SDK 构建通用 Agent，具备以下能力：
//   1. 多步规划与自主执行（SDK 内置工具调用循环，maxTurns 控制）
//   2. 网页搜索（web_search 工具）
//   3. 跨章节/跨项目记忆（read_chapter / write_chapter / list_chapters + 实体工具）
//   4. 文件与项目操作（实体工具 create_character / update_foreshadow 等）
//
// 事件映射（SDK RunStreamEvent → 项目 ToolStreamChunk）：
//   - raw_model_stream_event (output_text_delta)  → { content: delta }
//   - run_item_stream_event / reasoning_item_created → { thinking: text }
//   - run_item_stream_event / tool_called         → { tool_call: {id,name,arguments} }
//   - run_item_stream_event / tool_output         → { tool_result: {id,name,success,result,entity?} }
//
// 注意：
//   - provider 通过 RunConfig.modelProvider 注入，支持 OpenAI/Ollama/中转站
//   - tracingDisabled: true，避免无意义的 trace 上报
//   - useResponses: false 已在 provider 层强制，走 Chat Completions API
// ============================================================

import { Agent, Runner } from '@openai/agents';
import type {
  RunStreamEvent,
  RunItemStreamEvent,
  RunRawModelStreamEvent,
} from '@openai/agents';
import type { FunctionCallItem, FunctionCallResultItem, ReasoningItem } from '@openai/agents';

import { getAIConfig } from '../../providers/provider-factory.js';
import { getSdkProvider } from './provider.js';
import { getAllSdkTools, type NovelAgentContext } from './tools.js';
import { getSkillSystemPrompt } from '../skills.js';
import type { ChatInput, ToolStreamChunk } from '../chat-agent.js';

// ---- Agent 系统提示 ----

/**
 * Agent 模式专用系统提示。
 *
 * 相比普通对话模式，强调：
 *   - 自主规划：复杂任务先拆解步骤再执行
 *   - 工具使用：优先调用工具读写项目数据，而非凭空回答
 *   - 多步执行：可连续调用多个工具完成复合任务
 *   - 结果汇总：工具执行后向用户汇报结果
 */
const AGENT_SYSTEM_PROMPT = `你是一个具备通用 Agent 能力的小说写作助手。你不仅能与作者对话，还能主动调用工具读写项目数据、搜索互联网、操作章节内容。

核心能力：
1. **多步规划与自主执行**：面对复杂需求（如"检查所有角色的设定一致性"），先拆解步骤，再依次调用工具完成，最后汇总结果。
2. **网页搜索**：需要查证写作素材、历史背景、科学知识、地名考证时，调用 web_search 工具。
3. **跨章节记忆**：通过 read_chapter / list_chapters 工具读取已有章节内容，保持前后文一致性。
4. **文件与项目操作**：通过 create_character / update_foreshadow / create_location 等工具直接读写角色、伏笔、地点、物品、大纲模块。

行为准则：
- 优先基于工具返回的真实数据作答，而非凭空推测。
- 调用工具前简要说明意图（如"我先读取第三章的内容"），让作者了解你的操作。
- 工具执行后，用自然语言汇报结果，必要时给出后续建议。
- 实体写入（创建角色等）前，若意图不明确，先与作者确认。
- 保持简洁，避免空话套话。

当作者上传了"当前章节内容"或"项目上下文"时，结合这些信息理解需求。`;

// ---- 对话历史 → AgentInputItem 转换 ----

/**
 * 将项目的 conversationHistory 转换为 SDK 的 AgentInputItem 数组。
 *
 * SDK 的 run() 接受 string 或 AgentInputItem[]。当存在对话历史时，
 * 我们将历史消息转为 input items，最后追加当前用户消息。
 *
 * 注意：SDK 会在内部自动注入 agent.instructions 作为系统提示，
 * 因此这里只构造 user/assistant 消息项。
 */
function buildAgentInputItems(input: ChatInput): string | Array<{ type: string; role: string; content: Array<{ type: string; text: string }> }> {
  const history = input.conversationHistory ?? [];
  const userMessage = (input.userMessage ?? '').trim();

  // 无历史时直接返回字符串，让 SDK 自行包装
  if (history.length === 0) {
    return userMessage;
  }

  // 有历史时构造 input items 数组
  const items: Array<{ type: string; role: string; content: Array<{ type: string; text: string }> }> = [];

  for (const msg of history) {
    const text = msg.content ?? '';
    if (!text.trim()) continue;
    if (msg.role === 'user') {
      items.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      });
    } else {
      items.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      });
    }
  }

  // 追加当前用户消息
  if (userMessage) {
    items.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: userMessage }],
    });
  }

  return items;
}

// ---- 构建附加上下文（注入到用户消息开头）----

/**
 * 将项目上下文（章节、角色、技能 extraContext 等）拼装为前缀文本。
 *
 * Agent 模式下，这些上下文作为"环境信息"注入用户消息，
 * 让模型在调用工具前就能了解当前项目状态。
 */
function buildContextPrefix(input: ChatInput): string {
  const parts: string[] = [];

  if (input.projectName) {
    parts.push(`【项目】${input.projectName}`);
  }
  if (input.chapterTitle) {
    parts.push(`【当前章节】${input.chapterTitle}`);
  }
  if (input.characterNames && input.characterNames.length > 0) {
    parts.push(`【出场角色】${input.characterNames.join('、')}`);
  }
  if (input.currentChapter) {
    parts.push(`【当前章节标识】${input.currentChapter}`);
  }
  if (input.keyCharacters) {
    parts.push(`【关键角色】${input.keyCharacters}`);
  }
  if (input.keyThemes) {
    parts.push(`【关键主题】${input.keyThemes}`);
  }
  if (input.phase) {
    parts.push(`【创作阶段】${input.phase}`);
  }
  // 技能激活时前端收集的实体上下文
  if (input.extraContext) {
    parts.push(`【技能上下文】\n${input.extraContext}`);
  }
  // 智能续写/章节分析的增强上下文
  if (input.enhancedContext) {
    parts.push(`【项目全局上下文】\n${input.enhancedContext}`);
  }
  // 当前章节内容（小说对话场景）
  if (input.chapterContent) {
    const truncated = input.chapterContent.length > 8000
      ? input.chapterContent.slice(0, 8000) + '\n\n[... 章节内容过长，已截断至前 8000 字 ...]'
      : input.chapterContent;
    parts.push(`【当前章节内容】\n${truncated}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

// ---- 创建 Agent 实例 ----

/**
 * 创建 NovelAgent 实例。
 *
 * 技能叠加：若 skillId 对应已注册技能，将技能专属 system prompt 追加到
 * AGENT_SYSTEM_PROMPT 之后，与普通模式的 buildSkillSection 行为一致。
 * extraContext（前端注入的实体上下文）已在 buildContextPrefix 中处理，
 * 此处只负责技能身份 prompt。
 *
 * @param model 模型名称（来自 AIConfig.model）
 * @param skillId 可选技能 ID（激活技能时传入）
 * @returns 配置好工具和系统提示的 Agent
 */
function createNovelAgent(model: string, skillId?: string, context?: NovelAgentContext): Agent<NovelAgentContext> {
  const skillPrompt = getSkillSystemPrompt(skillId);
  const instructions = skillPrompt
    ? `${AGENT_SYSTEM_PROMPT}\n\n${skillPrompt}`
    : AGENT_SYSTEM_PROMPT;
  return new Agent<NovelAgentContext>({
    name: 'NovelAgent',
    instructions,
    tools: getAllSdkTools({ allowWriteChapter: context?.allowWriteChapter === true }),
    model,
  });
}

// ---- 主入口：流式运行 Agent ----

/**
 * 流式运行 NovelAgent，将 SDK 事件映射为项目现有的 ToolStreamChunk。
 *
 * @param input 对话输入（含历史、上下文、用户消息）
 * @param context Agent 运行上下文（projectId / userId）
 * @param signal 取消信号
 * @returns AsyncGenerator<ToolStreamChunk>，与 runChatAgentWithTools 输出格式一致
 */
export async function* runNovelAgentStream(
  input: ChatInput,
  context: NovelAgentContext,
  signal?: AbortSignal,
): AsyncGenerator<ToolStreamChunk> {
  // 获取配置和 provider
  const config = await getAIConfig(context.userId);
  const provider = await getSdkProvider(context.userId);

  // 创建 Agent 实例（叠加技能 prompt，若已激活技能；工具集随上下文写入能力开关变化）
  const agent = createNovelAgent(config.model, input.skillId, context);

  // 构建输入：上下文前缀 + 用户消息/历史
  const contextPrefix = buildContextPrefix(input);
  const userInput = buildAgentInputItems(input);

  // 如果有上下文前缀，将其注入到第一条用户消息前
  let finalInput: string | Array<{ type: string; role: string; content: Array<{ type: string; text: string }> }>;
  if (contextPrefix) {
    if (typeof userInput === 'string') {
      finalInput = `${contextPrefix}\n\n【作者请求】\n${userInput}`;
    } else {
      // 数组模式：在首条用户消息前插入上下文
      const items = [...userInput];
      if (items.length > 0 && items[0].role === 'user') {
        const firstText = items[0].content[0]?.text ?? '';
        items[0] = {
          ...items[0],
          content: [{ type: 'input_text', text: `${contextPrefix}\n\n【作者请求】\n${firstText}` }],
        };
      } else {
        // 历史首条非 user，插入一条上下文用户消息
        items.unshift({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: contextPrefix }],
        });
      }
      finalInput = items;
    }
  } else {
    finalInput = userInput;
  }

  // 运行 Agent（流式模式）
  // ★ 使用 Runner 而非便捷函数 run()，因为 modelProvider 和 tracingDisabled
  //   属于 RunConfig（Runner 配置），而非 StreamRunOptions（每次 run 的选项）
  // ★ cast finalInput as any：手动构造的 input items 结构与 AgentInputItem 联合类型兼容，
  //   但 TypeScript 无法自动推断 discriminated union，需 cast 绕过类型检查
  const runner = new Runner({
    modelProvider: provider,
    tracingDisabled: true,
  });
  const result = await runner.run(agent, finalInput as any, {
    stream: true,
    context,
    maxTurns: 15, // 允许较多轮次以支持多步规划
    signal,
  });

  // 迭代流式事件，映射为 ToolStreamChunk
  for await (const event of result) {
    const chunk = mapSdkEventToChunk(event);
    if (chunk) {
      yield chunk;
    }
  }
}

// ---- 事件映射 ----

/**
 * 将 SDK 的 RunStreamEvent 映射为项目的 ToolStreamChunk。
 *
 * 返回 null 表示该事件无需向前端推送（如 agent_updated、response_started 等）。
 */
function mapSdkEventToChunk(event: RunStreamEvent): ToolStreamChunk | null {
  // 1. 原始模型流事件：处理 output_text_delta（逐 token 文本流）
  if (event.type === 'raw_model_stream_event') {
    return mapRawModelEvent(event as RunRawModelStreamEvent);
  }

  // 2. RunItem 事件：工具调用、工具输出、消息、推理
  if (event.type === 'run_item_stream_event') {
    return mapRunItemEvent(event as RunItemStreamEvent);
  }

  // 3. agent_updated 事件：无需推送
  return null;
}

/**
 * 处理原始模型流事件，提取文本增量。
 *
 * Chat Completions 模式下，SDK 会将 delta 转换为 output_text_delta 事件。
 * 推理内容（reasoning_content）会通过 reasoning_item_created RunItem 事件推送。
 */
function mapRawModelEvent(event: RunRawModelStreamEvent): ToolStreamChunk | null {
  const data = event.data as { type?: string; delta?: string };
  // output_text_delta：正文文本增量
  if (data.type === 'output_text_delta' && typeof data.delta === 'string' && data.delta.length > 0) {
    return { content: data.delta };
  }
  // 其他 raw 事件（response_started / response_done 等）不推送
  return null;
}

/**
 * 处理 RunItem 事件，映射工具调用、工具输出、推理内容。
 */
function mapRunItemEvent(event: RunItemStreamEvent): ToolStreamChunk | null {
  switch (event.name) {
    case 'tool_called':
      return mapToolCalled(event);
    case 'tool_output':
      return mapToolOutput(event);
    case 'reasoning_item_created':
      return mapReasoning(event);
    case 'message_output_created':
      // 消息已通过 raw_model_stream_event 的 output_text_delta 流式推送，
      // 此处无需再次推送完整消息，避免重复。
      return null;
    default:
      return null;
  }
}

/**
 * 工具调用事件 → tool_call chunk。
 */
function mapToolCalled(event: RunItemStreamEvent): ToolStreamChunk | null {
  const rawItem = event.item.rawItem as Partial<FunctionCallItem> | undefined;
  if (!rawItem || !rawItem.callId || !rawItem.name) {
    return null;
  }
  return {
    tool_call: {
      id: rawItem.callId,
      name: rawItem.name,
      arguments: rawItem.arguments ?? '{}',
    },
  };
}

/**
 * 工具输出事件 → tool_result chunk。
 *
 * 我们的工具 execute 返回 JSON.stringify(ToolHandlerResult)，
 * 其中可能包含 entity 字段（实体写入工具）。
 * 这里尝试解析 output 字符串，提取 entity 信息供前端展示。
 */
function mapToolOutput(event: RunItemStreamEvent): ToolStreamChunk | null {
  const rawItem = event.item.rawItem as Partial<FunctionCallResultItem> | undefined;
  if (!rawItem || !rawItem.callId || !rawItem.name) {
    return null;
  }

  // output 可能是 string 或结构化对象
  const output = rawItem.output;
  let resultText = '';
  // entity 从工具返回的 JSON 中解析（ToolHandlerResult.entity），可能为 undefined
  let entity: NonNullable<NonNullable<ToolStreamChunk['tool_result']>['entity']> | undefined;

  if (typeof output === 'string') {
    resultText = output;
    // 尝试解析为 ToolHandlerResult，提取 entity
    try {
      const parsed = JSON.parse(output) as { success?: boolean; result?: string; entity?: NonNullable<typeof entity> };
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.success === 'boolean') {
          // 是 ToolHandlerResult 格式
        }
        if (typeof parsed.result === 'string') {
          resultText = parsed.result;
        }
        if (parsed.entity && typeof parsed.entity === 'object') {
          entity = parsed.entity;
        }
      }
    } catch {
      // 非 JSON 字符串，保持原样
    }
  } else if (output && typeof output === 'object') {
    // 结构化输出（ToolCallOutputContent）
    const obj = output as { text?: string };
    resultText = obj.text ?? JSON.stringify(output);
  }

  // 判断成功状态：completed = 成功
  const success = rawItem.status === 'completed';

  const toolResult: ToolStreamChunk['tool_result'] = {
    id: rawItem.callId,
    name: rawItem.name,
    success,
    result: resultText,
  };
  if (entity) {
    toolResult.entity = entity;
  }
  return { tool_result: toolResult };
}

/**
 * 推理内容事件 → thinking chunk。
 *
 * DeepSeek R1 等模型在 Chat Completions 模式下返回 reasoning_content，
 * SDK 会将其转为 ReasoningItem。
 */
function mapReasoning(event: RunItemStreamEvent): ToolStreamChunk | null {
  const rawItem = event.item.rawItem as Partial<ReasoningItem> | undefined;
  if (!rawItem) {
    return null;
  }
  // ReasoningItem 的 content 是 ReasoningText 数组
  const content = rawItem.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((c) => (typeof c === 'object' && c !== null && 'text' in c ? String((c as { text: string }).text) : ''))
      .filter((t) => t.length > 0);
    if (texts.length > 0) {
      return { thinking: texts.join('\n') };
    }
  }
  return null;
}
