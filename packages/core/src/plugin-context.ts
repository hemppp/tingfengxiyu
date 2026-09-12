// ============================================================
// @novel/core - 插件上下文契约（Server 面 / Web 面）
//
// 插件作者只依赖 @novel/core 即可获得全部扩展点类型。
// 宿主（apps/server、apps/web）实现这些上下文并注入具体服务。
// 本文件全部为类型（type-only），运行时零开销。
// ============================================================

import type { BasePluginContext } from './context.js';

// ---- AI 工具类型（与 server 的 provider-factory 结构化一致）----

/** 工具定义（OpenAI function calling 格式） */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 工具执行上下文 */
export interface ToolContext {
  /** 当前项目 ID（项目隔离：所有写入必须绑定项目） */
  projectId: string;
}

/** 工具处理结果 */
export interface ToolHandlerResult {
  success: boolean;
  result: string;
  entity?: {
    type: string;
    action: 'create' | 'update';
    id?: string;
    name?: string;
    payload?: Record<string, unknown>;
  };
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolHandlerResult>;

// ---- 插件 KV 服务 ----

export interface KvService {
  get<T>(pluginId: string, key: string, opts?: { projectId?: string }): T | undefined;
  set(pluginId: string, key: string, value: unknown, opts?: { projectId?: string }): Promise<void>;
  list(pluginId: string, prefix?: string, opts?: { projectId?: string }): Array<{ key: string; value: unknown }>;
  delete(pluginId: string, key: string, opts?: { projectId?: string }): Promise<void>;
}

// ---- 插件正式表迁移（v2 数据扩展，替代「只能走 KV」的限制）----

/** 一条插件迁移：版本号严格升序唯一，幂等应用（已记录版本自动跳过） */
export interface PluginMigration {
  /** 版本号（正整数，同一插件内升序唯一） */
  version: number;
  /** 迁移名（记账与排查用） */
  name: string;
  /** 建表/加列 SQL（可多语句；禁止 PRAGMA/ATTACH） */
  sql: string;
}

export interface PluginMigrateResult {
  /** 本次实际执行的迁移 */
  applied: Array<{ version: number; name: string }>;
  /** 因已应用而跳过的数量 */
  skipped: number;
}

// ---- Server 面上下文 ----

export interface ServerPluginContext extends BasePluginContext {
  /** 路由：注册 Hono 子路由（prefix + router） */
  routes: {
    register(prefix: string, router: unknown): () => void;
  };

  /** 服务：注册/获取业务服务（供插件间复用） */
  services: {
    register<T>(name: string, instance: T): () => void;
    get<T>(name: string): T | undefined;
  };

  /** 数据库 */
  db: {
    /** 主库（用户/设置/插件 KV） */
    global(): unknown;
    /** 项目库（项目隔离） */
    project(projectId: string): unknown;
    /** 插件 KV（v1 数据扩展） */
    kv: KvService;
    /**
     * 插件正式表迁移（v2 数据扩展）。
     * - scope 'global'（缺省）：表建在主库，需要权限 db:global；
     * - scope 'project'：表建在每个项目库，需要权限 db:project；对已打开的库立即执行，
     *   之后新创建的项目库由宿主在 initProjectDb 钩子里自动补跑。
     * - 幂等：以 plugin_migrations 记账表为准，重复调用只返回 skipped。
     * 注意：非内置插件经守护器代理获得此方法（按 pluginId 归因记账）；
     * 内置插件数据请走 KV。
     */
    migrate(migrations: PluginMigration[], opts?: { scope?: 'global' | 'project' }): Promise<PluginMigrateResult>;
  };

  /** AI 层 */
  ai: {
    /** 注册 AI 工具 */
    tools: {
      register(definition: ToolDefinition, handler: ToolHandler): () => void;
      getAllDefinitions(): ToolDefinition[];
    };
    /** 注册 AI 技能 */
    skills: {
      register(skill: {
        id: string;
        systemPrompt: string;
        contextKeys: string[];
        /** 展示名称（GET /api/ai/skills 下发；缺省回退为 id） */
        name?: string;
        /** 一句话描述 */
        description?: string;
        /** 主题色（hex） */
        color?: string;
      }): () => void;
      getAll(): Record<string, unknown>;
    };
    /** 注册 AI 智能体 */
    agents: {
      register(def: { name: string; description?: string; handler: (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown> }): () => void;
      /**
       * 运行一个子代理（宿主实现：SDK 装配 + 工具白名单 + 项目隔离上下文）。
       * flow 型技能的执行底座：插件只声明 system/input/工具名单，运行细节归宿主。
       * 需要 ai:agents 权限。
       */
      run(opts: AgentRunOptions): Promise<AgentRunResult>;
    };
    /**
     * 裸补全（无工具，机判/生成步骤用）。需要 ai:agents 权限。
     * json=true 时请求 JSON 输出（不保证合法，调用方自行解析兜底）。
     */
    complete(opts: {
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      /** 覆盖默认模型（缺省用当前 AI 配置的模型） */
      model?: string;
      json?: boolean;
      temperature?: number;
      /** 输出 token 上限（语义同 AgentRunOptions.maxTokens） */
      maxTokens?: number;
      userId?: string;
    }): Promise<string>;
    /** 注册模型提供商（扩展 provider-factory 的 provider 池） */
    providers: {
      register(def: { name: string; create: (config: Record<string, unknown>) => unknown }): () => void;
    };
  };

  /** 设置 section */
  settings: {
    registerSection(def: { key: string; title: string }): () => void;
  };

  /** 定时任务 */
  scheduler: {
    register(def: { label: string; intervalMs: number; run: () => void | Promise<void> }): () => void;
  };

  /** 系统提示 section（AI 能力声明） */
  prompt: {
    section(def: { name: string; order: number; text: string }): () => void;
  };
}

// ---- Web 面上下文 ----

export interface FloatingPanelDef {
  icon: unknown;
  label: string;
  key: string;
  Component: unknown;
  width?: number;
  height?: number;
  /** 排序权重（升序；缺省 0，同权重按注册先后） */
  order?: number;
  /**
   * 呈现位置：'workspace'（缺省）进工作台顶栏按钮组，由 ProjectLayout 承载；
   * 'editor' 不进顶栏，由编辑器内的面板栏（EditorPanelRail）开关，
   * 面板组件自行经 useEditorStore 获取编辑器实例。
   */
  scope?: 'workspace' | 'editor';
  /**
   * 浮窗左缘外侧贴附的功能气泡栏（如 AI 写作面板旁的技能快捷入口）。
   * 浮窗根 div 是绝对定位基准，组件自行绝对定位（参考 AI 对话气泡栏：absolute -left-14 top-4）。
   */
  rail?: unknown;
}

export interface WebCommandDef {
  id: string;
  title: string;
  keywords?: string[];
  run: () => void | Promise<void>;
  order?: number;
}

export type WebRouteGuard = 'landing' | 'protected' | 'admin';

export interface WebRouteDef {
  path: string;
  Component: unknown;
  guard?: WebRouteGuard;
  inProject?: boolean;
  order?: number;
}

/** 设置页可挂载的分类（对应 SettingsPage 左侧导航） */
export type SettingsCategory = 'general' | 'appearance' | 'ai' | 'security' | 'plugins' | 'updates';

/**
 * 设置页区块：渲染在指定分类下方，宿主负责卡片外壳（标题 + 描述 + nm-card）。
 * Component 无 props，自行通过 ctx.api 读写自己的配置。
 */
export interface SettingsSectionDef {
  key: string;
  title: string;
  /** 卡片标题下的一行说明（可选） */
  description?: string;
  icon?: unknown;
  Component: unknown;
  /** 挂载到哪个设置分类，缺省 'plugins' */
  category?: SettingsCategory;
  order?: number;
}

/**
 * 编辑器 Tiptap 扩展：create() 返回 Tiptap Extension/Mark/Node 实例。
 * 用工厂函数而非实例，避免多个编辑器实例共享同一份扩展状态。
 * 宿主在构造编辑器时收集，注册表变更会重建编辑器扩展列表。
 */
export interface EditorExtensionDef {
  key: string;
  create: () => unknown;
  order?: number;
}

/** 编辑器工具栏条目：渲染在正文卡片上方的插件工具栏 */
export interface EditorToolbarItemDef {
  key: string;
  label: string;
  icon?: unknown;
  /** 点击回调，收到当前 Tiptap editor 实例（unknown，插件侧自行断言） */
  run: (editor: unknown) => void | Promise<void>;
  /** 是否处于激活态（如 mark 已应用）；用于按钮高亮 */
  isActive?: (editor: unknown) => boolean;
  order?: number;
}

/** 选区菜单动作：选中正文时浮出的菜单里追加一项 */
export interface SelectionActionDef {
  key: string;
  label: string;
  /** 图标（LucideIcon 组件或 emoji 字符串皆可） */
  icon?: unknown;
  /** hover 背景色（缺省用主题色） */
  color?: string;
  /** 点击回调，收到选中文本与 editor 实例 */
  run: (payload: { text: string; editor: unknown }) => void | Promise<void>;
  order?: number;
}

/**
 * 带鉴权的 API fetch：自动附加 JWT Authorization 与当前项目 X-Project-Id 头。
 * 插件 Web 面必须通过它访问后端（不要使用裸 fetch——服务端 /api/plugins/* 默认要求登录）。
 */
export type WebApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

// ---- 子代理运行契约（宿主实现，flow 型技能执行底座）----

/** 子代理运行选项 */
export interface AgentRunOptions {
  /** 子代理 system 指令 */
  system: string;
  /** 任务输入（任务描述 + 上下文材料） */
  input: string;
  /** 允许调用的工具名白名单（缺省 = 不挂任何工具，纯生成） */
  tools?: string[];
  /** 覆盖默认模型（缺省用当前 AI 配置的模型） */
  model?: string;
  /**
   * 单次模型调用的输出 token 上限。
   * 不传时宿主不发送 max_tokens，由服务商默认值兜底 —— 而推理模型的**思考 token
   * 也计入该上限**，默认值偏小时模型会自行收短输出（长文写作尤其明显），
   * 所以需要长输出的调用方应显式给足。
   */
  maxTokens?: number;
  /** 项目隔离上下文 */
  context: { projectId: string; userId?: string };
  /** 章节写入能力（默认 false；仅流程收尾交付步显式开启，宿主二次校验） */
  allowWriteChapter?: boolean;
  /** 最大工具轮数（防失控，缺省 8） */
  maxTurns?: number;
}

/** 子代理运行结果（审计台账的最小记录面） */
export interface AgentRunResult {
  /** 最终文本输出 */
  text: string;
  /** 实际使用的模型名（审计台账用） */
  model: string;
}

export interface WebPluginContext extends BasePluginContext {
  /** 注册项目浮窗面板（插件主功能 UI 入口） */
  registerProjectPanel(panel: FloatingPanelDef): () => void;
  /** 注册命令（Ctrl+K） */
  registerCommand(cmd: WebCommandDef): () => void;
  /** 注册顶级路由 */
  registerRoute(def: WebRouteDef): () => void;
  /** 注册设置页区块（默认挂在「插件」分类下） */
  registerSettingsSection(def: SettingsSectionDef): () => void;
  /** 注册编辑器 Tiptap 扩展（正文高亮/标记/输入规则等） */
  registerEditorExtension(def: EditorExtensionDef): () => void;
  /** 注册编辑器工具栏按钮 */
  registerEditorToolbarItem(def: EditorToolbarItemDef): () => void;
  /** 注册选区菜单动作（选中正文后浮出） */
  registerSelectionAction(def: SelectionActionDef): () => void;
  /**
   * 注册技能图标映射（key = 技能 id，value = 图标组件）。
   * 技能内容归插件所有后，图标映射也随技能走：技能选择器按「插件注册 → 内置兜底 → Puzzle」解析。
   */
  registerSkillIcons(icons: Record<string, unknown>): () => void;
  /**
   * 接管 AI 聊天浮窗左缘的功能气泡栏（模式开关/技能/快捷语）。
   * 宿主持有全部状态，按 ChatRailProps 下发并接收回调；先注册者生效，无插件注册时回退内置气泡栏。
   * 组件 props：syncInsert/enableTools/enableAgent/activeSkillId +
   * onToggleSync/onToggleTools/onToggleAgent/onSkillChange(id: string | null)。
   */
  registerChatRail(def: { key: string; Component: unknown }): () => void;
  /** 带鉴权的 API fetch（自动附加 JWT 与项目头，替代裸 fetch） */
  api: WebApiFetch;
}

// ---- Web 插件模块契约 ----

export interface WebPluginModule {
  name?: string;
  inject?: string[];
  apply(ctx: WebPluginContext): void | Promise<void>;
}
