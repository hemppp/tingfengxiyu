// ============================================================
// AI 对话技能注册表 (Skills Registry)
//
// 技能 = 用户在对话中可主动激活的"专家模式"。
// 激活后，该轮对话在「小说对话」基础上叠加技能专属 system prompt，
// 并由前端按 contextKeys 注入相关实体上下文（角色库/伏笔/大纲等）。
//
// 设计原则：
//  - 技能与现有 phase 机制正交：phase 是后端内部业务场景分发，
//    skill 是用户主动选择的对话视角，二者可共存。
//  - 技能 prompt 叠加在 NOVEL_CHAT_SYSTEM_PROMPT 之上，不替换场景。
//  - 新增技能只需在 SKILLS 中追加一项，无需改动路由 / Agent 主流程。
// ============================================================

/** 技能上下文类型标识 —— 与前端 buildSkillContext 的收集逻辑对齐 */
export type SkillContextKey =
  | 'characters'
  | 'foreshadows'
  | 'outline'
  | 'locations'
  | 'items'
  | 'events';

/** 技能定义（后端侧：prompt 与上下文声明 + 展示元数据） */
export interface SkillDef {
  id: string;
  /** 注入到 system prompt 末尾的专家指导 */
  systemPrompt: string;
  /** 该技能需要前端注入的上下文类型（仅用于文档/校验，实际注入由前端决定） */
  contextKeys: SkillContextKey[];
  /** 展示名称（GET /api/ai/skills 下发；缺省回退为 id） */
  name?: string;
  /** 一句话描述 */
  description?: string;
  /** 主题色（hex），前端图标/高亮用 */
  color?: string;
  /** 注册来源：内置为 builtin，插件经 registerSkill 注册为 plugin */
  source?: 'builtin' | 'plugin';
}

/**
 * 预设技能列表。
 *
 * 每个 systemPrompt 都以"你现在同时兼任……"开头，明确告知 LLM 在通用写作助手
 * 之上叠加的专家身份与行为约束，避免身份冲突。
 *
 * name/description/color 是唯一的技能内容源：前端技能选择器从
 * GET /api/ai/skills 拉取本表（含插件注册项），不再本地维护副本。
 * 前端 skillsConfig.ts 只保留 id → 图标的映射（图标组件无法跨 JSON 序列化）。
 */
export const SKILLS: Record<string, SkillDef> = {
  'character-analyst': {
    id: 'character-analyst',
    contextKeys: ['characters'],
    name: '角色分析师',
    description: '挖掘角色动机、性格弧光与关系张力',
    color: '#3b82f6',
    source: 'builtin',
    systemPrompt: `【已激活技能：角色分析师】
你现在同时兼任"角色分析师"。在回答中请侧重：
1. 角色动机与核心欲望的挖掘，指出行为背后的心理驱动
2. 性格弧光（成长/堕落轨迹）是否合理，有无前后矛盾
3. 角色关系的张力来源（利益冲突/情感纠葛/权力不对等）
4. 结合注入的"角色库"数据，引用已有设定（别名/外貌/性格/背景）支撑分析
5. 当角色行为偏离设定时，明确指出并提供修正建议`,
  },

  'foreshadow-tracker': {
    id: 'foreshadow-tracker',
    contextKeys: ['foreshadows'],
    name: '伏笔追踪者',
    description: '核对伏笔回收、建议新伏笔与留白尺度',
    color: '#f59e0b',
    source: 'builtin',
    systemPrompt: `【已激活技能：伏笔追踪者】
你现在同时兼任"伏笔追踪者"。在回答中请侧重：
1. 结合注入的"伏笔列表"，核对当前章节是否触及已铺设的伏笔
2. 评估伏笔的回收时机是否成熟（铺垫是否充分、是否已逾期未回收）
3. 指出当前章节中潜在的"可埋伏笔点"，并建议伏笔类型（身份/动机/关系/转折等）
4. 提示悬念的留白尺度，避免过早揭底或过度吊胃口
5. 若发现多条伏笔线索交织，梳理其关联与回收优先级`,
  },

  'rhythm-doctor': {
    id: 'rhythm-doctor',
    contextKeys: [],
    name: '节奏诊断师',
    description: '分析叙事节奏、场景切换与信息释放',
    color: '#ec4899',
    source: 'builtin',
    systemPrompt: `【已激活技能：节奏诊断师】
你现在同时兼任"节奏诊断师"。在回答中请侧重：
1. 分析当前章节的叙事节奏（快/慢/张/弛），指出节奏失衡的段落
2. 评估场景切换的密度与过渡是否自然
3. 关注信息释放的节奏——是否一次性倾倒过多设定，或过于拖沓
4. 对话/描写/动作的比例是否协调
5. 给出具体的节奏调整建议（哪里该加速、哪里该延展停顿）`,
  },

  'worldbuilder': {
    id: 'worldbuilder',
    contextKeys: ['locations', 'items'],
    name: '世界观顾问',
    description: '核对地点物品设定、补全世界观空白',
    color: '#10b981',
    source: 'builtin',
    systemPrompt: `【已激活技能：世界观顾问】
你现在同时兼任"世界观顾问"。在回答中请侧重：
1. 结合注入的"地点库"与"物品库"，核对当前章节的设定一致性
2. 检查场景描写中的地理/空间/文化细节是否与已有设定吻合
3. 物品的出现、流转、持有者是否符合既有记录
4. 指出世界观中尚未补全的空白（如某地点缺乏特征、某物品来历不明）
5. 建议可深化的设定维度（社会结构/经济/宗教/技术层级等）`,
  },

  'dialogue-polisher': {
    id: 'dialogue-polisher',
    contextKeys: ['characters'],
    name: '对白打磨师',
    description: '强化角色语言辨识度、优化潜台词',
    color: '#8b5cf6',
    source: 'builtin',
    systemPrompt: `【已激活技能：对白打磨师】
你现在同时兼任"对白打磨师"。在回答中请侧重：
1. 结合注入的"角色库"，检查对白是否符合各角色的说话风格与口头禅
2. 消除"所有人说话一个味"的问题，强化角色语言的辨识度
3. 关注对白中的潜台词与言外之意，避免过度直白
4. 评估对白与动作描写的穿插节奏，避免大段独白
5. 提供改写示范时，保留角色性格底色，仅优化表达`,
  },

  'plot-architect': {
    id: 'plot-architect',
    contextKeys: ['outline', 'events'],
    name: '情节构思师',
    description: '定位章节结构、设计冲突升级与转折',
    color: '#ef4444',
    source: 'builtin',
    systemPrompt: `【已激活技能：情节构思师】
你现在同时兼任"情节构思师"。在回答中请侧重：
1. 结合注入的"大纲"与"事件列表"，定位当前章节在整体结构中的位置
2. 评估当前情节的推进是否服务于大纲目标，有无偏离主线
3. 设计冲突升级路径与合理的剧情转折点
4. 检查因果链是否严密——每个事件是否有充分的铺垫与后果
5. 建议可引入的支线或副事件，丰富叙事层次而不喧宾夺主`,
  },

  'continue-writer': {
    id: 'continue-writer',
    contextKeys: ['outline', 'characters', 'events'],
    name: '智能续写',
    description: '根据大纲和前文风格，自动续写当前章节内容',
    color: '#a855f7',
    source: 'builtin',
    systemPrompt: `【已激活技能：智能续写】
你现在同时兼任"续写助手"。你的任务是续写当前章节的正文内容。请遵循以下原则：
1. 严格遵循前文的叙事风格、语言习惯和节奏
2. 结合注入的"大纲"节点，确保续写方向符合整体故事规划
3. 结合注入的"角色库"，保持角色性格、说话风格和行为逻辑一致
4. 结合注入的"事件列表"，确保续写内容与已有事件不冲突
5. 续写内容应直接作为正文输出，无需额外解释或说明
6. 保持段落结构和叙事视角的一致性`,
  },

  'outline-architect': {
    id: 'outline-architect',
    contextKeys: ['outline', 'characters', 'events'],
    name: '大纲架构师',
    description: '与AI讨论剧情走向，完善核心冲突与每章细节',
    color: '#0ea5e9',
    source: 'builtin',
    systemPrompt: `【已激活技能：大纲架构师】
你现在同时兼任"大纲架构师"。你的任务是与作者讨论剧情走向，帮助完善小说大纲。请遵循以下原则：

1. **记忆与连贯**：主动记住本次对话中已讨论的剧情思路与决定，后续回答需保持上下文连贯，避免前后矛盾
2. **作者主导**：作者提供思路，你负责完善、补充细节、指出潜在问题（如因果链断裂、人设崩塌、节奏失衡），但最终走向由作者决定
3. **核心冲突梳理**：帮助厘清主角的核心欲望、对立面是谁/什么、冲突的根源与升级路径
4. **每章细节设计**：为每章规划具体情节——核心事件、冲突推进、角色行动、伏笔铺设/回收、章节钩子
5. **结合已有设定**：结合注入的"大纲节点"、"角色库"、"事件列表"，确保新建议与已有设定不冲突
6. **结构化输出**：当作者确认大纲走向后，若需填入大纲编辑器，请按以下清晰标记输出，便于作者识别与填入：

【核心冲突】
（一段话描述主角想要什么、谁在阻止、冲突根源）

【第X章 章节标题】
（本章核心事件、冲突推进、角色行动、伏笔铺设/回收、章节结尾钩子）

7. 讨论阶段多用提问引导作者思考，确认后再输出结构化内容`,
  },
};

/**
 * 获取技能的 system prompt。
 * 若 skillId 不存在或为空，返回空字符串（表示未激活技能，走默认对话）。
 */
export function getSkillSystemPrompt(skillId?: string): string {
  if (!skillId) return '';
  const skill = SKILLS[skillId];
  return skill ? skill.systemPrompt : '';
}

/** 判断 skillId 是否为已注册的有效技能 */
export function isValidSkill(skillId?: string): boolean {
  return !!skillId && skillId in SKILLS;
}

/** 注册一个技能（插件扩展用；自动标记来源，卸载时移除） */
export function registerSkill(skill: SkillDef): void {
  SKILLS[skill.id] = { ...skill, source: 'plugin' };
}

/** 注销一个技能（插件卸载时调用） */
export function unregisterSkill(skillId: string): void {
  delete SKILLS[skillId];
}

/** 获取全部技能定义 */
export function getAllSkills(): Record<string, SkillDef> {
  return { ...SKILLS };
}

/** 可序列化的技能展示元数据（GET /api/ai/skills 下发，前端技能选择器的唯一内容源） */
export interface SkillMetaDto {
  id: string;
  name: string;
  description: string;
  color: string;
  contextKeys: SkillContextKey[];
  source: 'builtin' | 'plugin';
}

/** 列出全部技能（内置 + 插件注册）的展示元数据，按声明顺序稳定排序 */
export function listSkillMetas(): SkillMetaDto[] {
  return Object.values(SKILLS).map((s) => ({
    id: s.id,
    name: s.name ?? s.id,
    description: s.description ?? '插件注册技能',
    color: s.color ?? '#94a3b8',
    contextKeys: s.contextKeys,
    source: s.source ?? 'builtin',
  }));
}
