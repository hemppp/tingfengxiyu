// ============================================================
// Server 插件宿主 —— 基于 @deepseek-ai/cordis 的基座装配
//
// v2（Cordis 底座版）：不再使用自研 PluginHost。
//   - 内核：真实 cordis（Context / ctx.plugin / ctx.effect / fiber）
//   - HTTP：DSH 的 dsh-host-webserver 服务（exact/prefix 动态路由 + disposer）
//   - 全部业务模块 = cordis 插件：{ name, inject, apply(ctx) }
//   - 兼容面：ctx.routes / ctx.db / ctx.ai / ctx.events / ctx.effect / ctx.logger
//     （与旧 ServerPluginContext 契约一致，插件代码无需改动）
// ============================================================

import { Hono } from 'hono';
import type { IncomingMessage, ServerResponse } from 'http';
import { Context, type Plugin } from '@deepseek-ai/cordis';
import { WebServer } from '@deepseek-ai/dsh-host-webserver';
import { honoListener } from '../lib/hono-adapter.js';
import { createApp } from '../lib/app-factory.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyProjectOwnership } from '../lib/ownership.js';
import { getDb, getProjectDbSync } from '@novel/db';
import { EventBus } from '@novel/core';
import {
  HookBus,
  analyzeDependencies,
  sortByDependencies,
  checkManifestPolicy,
  validateManifest,
  INSTALL_STANDARD_VERSION,
  SERVER_SERVICES,
  type PluginEntry,
  type PluginManifest,
  type PluginModule,
  type ServerPluginContext,
  type DependencyAnalysis,
} from '@novel/core';
import { registerTool, unregisterTool, getAllToolDefinitions, markPluginTool } from '../ai/tools/registry.js';
import { registerSkill, unregisterSkill, SKILLS } from '../ai/agents/skills.js';
import { declareSkillTarget, undeclareSkillTarget, listSkillTargets } from '../ai/agents/skill-targets.js';
import { listEnabledSkills } from '../services/skill-library.js';
import { Agent, Runner } from '@openai/agents';
import { getAIConfig } from '../ai/providers/provider-factory.js';
import { ensureConfigMiddleware } from '../ai/user-config-loader.js';
import { getSdkProvider, runWithThinkingSink } from '../ai/agents/sdk/provider.js';
import { getAllSdkTools, type NovelAgentContext } from '../ai/agents/sdk/tools.js';
import { createSqliteKvService } from './kv-service.js';
import { createStaticFallback } from './frontend-static.js';
import { createPluginGuardian, createGuardedPluginHandle, type GuardianSnapshot } from './guardian.js';

export interface ServerPluginHostOptions {
  port?: number;
  host?: '127.0.0.1' | '0.0.0.0';
  kv?: import('@novel/core').KvService;
  disabledIds?: string[];
}

export interface PluginStatusItem {
  id: string;
  name: string;
  status: 'ok' | 'error' | 'disabled' | 'skipped';
  error?: string;
  order: number;
  enabled: boolean;
  /** 来源（builtin | local | npm），便于诊断坏插件出处 */
  source: PluginEntry['source'];
  permissions: string[];
  dependsOn: string[];
  /** 守护器状态（仅非内置插件有：隔离中/已放行/已熔断） */
  guardian?: GuardianSnapshot;
}

export interface ServerPluginHost {
  readonly ctx: Context;
  readonly events: Context;
  readonly hooks: HookBus;
  mount(entries: PluginEntry[]): Promise<void>;
  start(opts?: { port?: number; host?: '127.0.0.1' | '0.0.0.0'; distIndex?: string }): Promise<{ port: number; url: string }>;
  getPluginStatus(): PluginStatusItem[];
  setPluginEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>;
  /** 手动放行（跳过剩余隔离期） */
  promotePlugin(id: string): { ok: boolean; error?: string };
  /** 重置守护计数回隔离态；被禁用的插件同时重新挂载启用 */
  requarantinePlugin(id: string): Promise<{ ok: boolean; error?: string; remounted: boolean }>;
  /** 守护器策略（放行/熔断阈值，供管理 UI 展示） */
  getGuardianPolicy(): { promoteAfterSessions: number; errorThreshold: number };
  addPluginEntry(entry: PluginEntry): Promise<{ ok: boolean; error?: string }>;
  /** 登记"安装门"拒绝的插件（如扫描器发现 manifest 非法），使其在 /api/health 与管理界面可见 */
  recordInstallRejections(items: Array<{ id: string; message: string }>): void;
  setInitialDisabled(ids: string[]): void;
  getDependencyAnalysis(): DependencyAnalysis;
  getDisabledIds(): string[];
  dispose(): Promise<void>;
}

/** 便捷工具：从 (id, prefix, load) 构造内置插件条目（Hono 模块 → cordis 插件） */
export function builtinEntry(
  id: string,
  prefix: string,
  load: () => Promise<{ default: any }>,
  extra?: Partial<PluginManifest>,
): PluginEntry {
  return {
    id,
    source: 'builtin',
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      permissions: ['routes', 'db:project'],
      server: { inject: ['routes'] },
      ...extra,
    },
    load: async () => {
      const mod = await load();
      return {
        name: id,
        apply: (ctx: ServerPluginContext) => {
          ctx.routes.register(prefix, mod.default);
        },
      };
    },
  };
}

// ============================================================
// 宿主装配
// ============================================================

export function createServerPluginHost(options: ServerPluginHostOptions = {}): ServerPluginHost {
  const kv = options.kv ?? createSqliteKvService();
  const ctx = new Context();
  const hookBus = new HookBus();

  // ---- 状态 / fiber / 条目跟踪 ----
  const statuses = new Map<string, PluginStatusItem>();
  const fibers = new Map<string, { dispose(): unknown }>();
  const entriesById = new Map<string, PluginEntry>();
  const disabledIds = new Set<string>(options.disabledIds ?? []);
  let seq = 0;

  const persistDisabled = async () => {
    try {
      await kv.set('novel.host', 'disabled-plugins', [...disabledIds]);
    } catch (err) {
      console.error('[cordis-host] 持久化禁用清单失败:', err);
    }
  };

  // ---- 插件守护器：非内置插件进隔离箱（错误归因 / 熔断 / 自动放行） ----
  let hostRef: ServerPluginHost | null = null;
  const guardian = createPluginGuardian({
    kv,
    onFuse: (pluginId) => {
      // 熔断 = 复用宿主禁用（dispose fiber，逆序清理插件注册的资源）
      void hostRef?.setPluginEnabled(pluginId, false).catch((err) => {
        console.error('[guardian] 熔断禁用 ' + pluginId + ' 失败:', err);
      });
    },
  });
  // 守护包装层兜底资源清理器（插件忘记 ctx.effect 包裹时熔断/禁用也能清干净）
  const guardedBags = new Map<string, () => void>();

  // ---- 根 Hono 应用（全局中间件 + 全部模块路由 + 健康检查） ----
  const rootApp = createApp();

  // ★ 插件禁用/熔断后的路由 active gate：
  //   Hono 已合并路由无法摘除（架构限制），但插件禁用/被守护器熔断时，
  //   其 fiber disposer 会把路由前缀加入 mutedRoutePrefixes，
  //   本中间件立即对这些前缀返回 404，不再等重启。仅作用于 /api/plugins/* 动态插件路由。
  const mutedRoutePrefixes = new Set<string>();
  (rootApp as Hono).use('/api/*', async (c, next) => {
    if (mutedRoutePrefixes.size > 0) {
      const path = new URL(c.req.url).pathname;
      for (const p of mutedRoutePrefixes) {
        if (path === p || path.startsWith(p + '/')) {
          return c.json({ error: { code: 'PLUGIN_DISABLED', message: '插件已禁用或熔断，该路由不可用' } }, 404);
        }
      }
    }
    await next();
  });

  const registeredPrefixes = new Set<string>();

  const routesService = {
    register(prefix: string, router: unknown, opts?: { pluginId?: string }): () => void {
      if (registeredPrefixes.has(prefix)) return () => undefined;
      // ★ 前缀边界：动态/本地插件（携带 pluginId）只允许注册 /api/plugins/{id}；
      //   /api/admin、/api/auth 等其他前缀仅限内置模块，防止插件劫持宿主或管理面。
      if (opts?.pluginId && !/^\/api\/plugins\/[a-z0-9][a-z0-9-]*$/.test(prefix)) {
        console.error(`[cordis-host] 插件 ${opts.pluginId} 试图注册非插件前缀路由 ${prefix}，已拒绝（仅允许 /api/plugins/{id}）`);
        return () => undefined;
      }
      registeredPrefixes.add(prefix);
      mutedRoutePrefixes.delete(prefix);
      try {
        let target = router as Hono;
        // ★ 插件路由默认认证（C7）：/api/plugins/* 一律要求登录；
        //   若请求携带 X-Project-Id 则额外校验项目所有权（防跨项目读写）。
        //   内置模块（/api/auth 等）不走此前缀，登录/注册等公开路由不受影响。
        if (prefix.startsWith('/api/plugins/')) {
          const guarded = new Hono();
          guarded.use('*', requireAuth as never);
          // ★ 插件路由也必须先注册用户的 AI 配置 loader（2026-09-17 加）。
          //   插件里大量路由会调 AI（如 autowrite 的讨论 / 连写），而
          //   `ensureConfigMiddleware` 原先只挂在 /api/ai/* 上 —— 用户不进设置页时
          //   loader 就没注册，`getAIConfig(userId)` 静默回退到内置公益中转站。
          //   表现：讨论照跑、但模型被悄悄换掉（思维链因此永远是空的）。
          guarded.use('*', ensureConfigMiddleware as never);
          guarded.use('*', async (c, next) => {
            const projectId = c.req.header('X-Project-Id');
            if (projectId) {
              const denial = await verifyProjectOwnership(c as never, projectId);
              if (denial) return denial;
            }
            await next();
          });
          guarded.route('/', router as Hono);
          target = guarded;
        }
        (rootApp as Hono).route(prefix, target);
      } catch (err) {
        console.error('[cordis-host] 路由注册失败', prefix, err);
      }
      return () => {
        // ★ fiber dispose（插件禁用/熔断）→ 动态插件路由立即进入 muted，
        //   由上方 active gate 返回 404；重启后路由才真正从 Hono 中移除。
        if (prefix.startsWith('/api/plugins/')) {
          mutedRoutePrefixes.add(prefix);
        }
        console.warn('[cordis-host] 路由 ' + prefix + ' 需要重启才能卸载（Hono 架构限制）');
      };
    },
  };

  // ---- 插件间服务注册表 ----
  const servicesMap = new Map<string, unknown>();
  const servicesService = {
    register(name: string, instance: unknown): () => void {
      servicesMap.set(name, instance);
      return () => servicesMap.delete(name);
    },
    get(name: string): unknown {
      return servicesMap.get(name);
    },
  };

  // ---- AI 注册表（复用既有实现，暴露为 ctx.ai） ----
  const agentRegistry = new Map<string, unknown>();
  const providerRegistry = new Map<string, unknown>();

  /**
   * 子代理运行器（ctx.ai.agents.run / ctx.ai.complete 的实现底座）。
   * SDK 装配与 runNovelAgentStream 同款：getSdkProvider + Runner（Chat Completions 强制）。
   * tools 白名单缺省 = 纯生成；allowWriteChapter 只影响 write_chapter 是否进入候选集，
   * 且 SDK 工具 handler 内还有二次拒绝兜底（tools.ts）。
   */
  async function runSubagent(o: {
    system: string;
    input: string;
    tools?: string[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxTurns?: number;
    projectId?: string;
    userId?: string;
    allowWriteChapter?: boolean;
    /** 思维链增量回调；不传 = 不做旁路截取（零开销，也不会去解析 reasoning_content） */
    onThinking?: (delta: string) => void;
  }): Promise<{ text: string; model: string; thinking?: string }> {
    const config = await getAIConfig(o.userId);
    const provider = await getSdkProvider(o.userId);
    const model = o.model ?? config.model;
    const allowed = o.tools ? new Set(o.tools) : undefined;
    const sdkTools = allowed
      ? getAllSdkTools({ allowWriteChapter: o.allowWriteChapter === true })
          .filter((t) => allowed.has((t as { name: string }).name))
      : [];
    // ★ maxTokens 必须显式透传：不传时 SDK 不发送 max_tokens，由服务商默认值兜底；
    //   推理模型（如 glm-5.3-flash）的思考 token 也计入该上限，默认值偏小时
    //   模型会自行收短输出 —— 长文写作上表现为「总是写不到约定字数」。
    const modelSettings = (o.temperature != null || o.maxTokens != null)
      ? {
          ...(o.temperature != null ? { temperature: o.temperature } : {}),
          ...(o.maxTokens != null ? { maxTokens: o.maxTokens } : {}),
        }
      : undefined;
    const agent = new Agent({
      name: 'novel-subagent',
      instructions: o.system,
      tools: sdkTools,
      model,
      ...(modelSettings ? { modelSettings } : {}),
    });
    const runner = new Runner({ modelProvider: provider, tracingDisabled: true });
    const context: NovelAgentContext = {
      projectId: o.projectId ?? '',
      userId: o.userId ?? '',
      allowWriteChapter: o.allowWriteChapter === true,
    };

    // ★ 思维链旁路：SDK 的 Chat Completions 通道不解析 reasoning_content（见 sdk/provider.ts 文件头），
    //   所以这里把 sink 放进 ALS，由 provider 的 fetch 旁路推回来。
    //   不传 onThinking 时完全不注册 sink —— 不白花解流的开销。
    let thinking = '';
    const sink = o.onThinking
      ? (d: string) => { thinking += d; o.onThinking?.(d); }
      : undefined;

    // ★★ 必须走 `stream: true`：旁路只挂在 SSE 响应上。
    //   非流式时中转站返回的是 `application/json`（实测 content-type 就是它），
    //   reasoning_content 在那一整个 JSON body 里，旁路**一次都不会触发** ——
    //   表现就是「思维链一条都没有」，而且不报任何错。
    //   流式结果的 `finalOutput` 与之前一样可用（已实测：正文一致，工具轮次不会污染它），
    //   所以正文口径没变。整个 run（含流消费）都在 sink 作用域内，保证旁路拿得到接收器。
    const result = await runWithThinkingSink(sink, async () => {
      const streamed = await runner.run(agent, o.input as any, {
        stream: true,
        context,
        maxTurns: o.maxTurns ?? 8,
      } as any);
      // 流式结果必须被**消费**才会真正跑完（模型调用就发生在这一步）
      for await (const _ev of streamed as unknown as AsyncIterable<unknown>) {
        /* 只为驱动流；正文取 finalOutput，不逐字推送（子代理没有逐字展示的需求） */
      }
      return streamed;
    });
    const text = String(result.finalOutput ?? '');
    return thinking ? { text, model, thinking } : { text, model };
  }

  const aiService = {
    tools: {
      register(definition: import('@novel/core').ToolDefinition, handler: unknown) {
        registerTool(definition.function.name, definition, handler as Parameters<typeof registerTool>[2]);
        markPluginTool(definition.function.name); // 聊天工具白名单动态纳入插件工具
        return () => unregisterTool(definition.function.name);
      },
      getAllDefinitions: () => getAllToolDefinitions(),
    },
    skills: {
      register(skill: unknown) {
        registerSkill(skill as import('../ai/agents/skills.js').SkillDef);
        return () => unregisterSkill((skill as { id: string }).id);
      },
      getAll: () => ({ ...SKILLS }),
    },
    skillTargets: {
      // 插件声明自己的 agent（"后续还要继续加入其他 agent 的 skills"靠这个入口）
      declare(def: Omit<import('../ai/agents/skill-targets.js').SkillTarget, 'source'>) {
        declareSkillTarget({ ...def, source: 'plugin' });
        return () => undeclareSkillTarget(def.id);
      },
      getAll: () => listSkillTargets().map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
    },
    agentSkills: {
      // 执行链路用：返回"这个智能体当前启用、且有正文"的技能（库在主库，插件读不到 → 宿主代读）
      getEnabled: (agentId: string, opts?: { userId?: string }) => listEnabledSkills(agentId, opts?.userId),
    },
    agents: {
      register(def: { name: string }) {
        const id = 'plugin:ai:agents:' + def.name;
        agentRegistry.set(id, def);
        return () => agentRegistry.delete(id);
      },
      run: (opts: import('@novel/core').AgentRunOptions) => runSubagent({
        system: opts.system,
        input: opts.input,
        tools: opts.tools,
        model: opts.model,
        maxTokens: opts.maxTokens,
        maxTurns: opts.maxTurns,
        projectId: opts.context.projectId,
        userId: opts.context.userId,
        allowWriteChapter: opts.allowWriteChapter,
        onThinking: opts.onThinking,
      }),
    },
    providers: {
      register(def: { name: string }) {
        const id = 'plugin:ai:providers:' + def.name;
        providerRegistry.set(id, def);
        return () => providerRegistry.delete(id);
      },
    },
    complete: (opts: {
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      model?: string;
      json?: boolean;
      temperature?: number;
      maxTokens?: number;
      userId?: string;
    }) => {
      const systemParts = opts.messages.filter((m) => m.role === 'system').map((m) => m.content);
      if (opts.json) {
        systemParts.push('只输出 JSON。不要输出 JSON 以外的任何文字（不要代码围栏、不要解释）。');
      }
      const input = opts.messages
        .filter((m) => m.role !== 'system')
        .map((m) => (m.role === 'assistant' ? `[上一轮助手回复]\n${m.content}` : m.content))
        .join('\n\n');
      return runSubagent({
        system: systemParts.join('\n\n'),
        input,
        model: opts.model,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        maxTurns: 1,
        userId: opts.userId,
      }).then((r) => r.text);
    },
  };

  // ---- db / settings / scheduler / prompt / events ----
  const dbService = {
    global: () => getDb(),
    project: (projectId: string) => getProjectDbSync(projectId),
    kv,
    // 注意：ctx.db.migrate 只在守护器包装层提供（guardian.wrapDb → migrations.ts），
    // 按挂载条目归因 pluginId 并校验 db:global / db:project 权限；
    // 内置插件不经包装层，数据请走 KV（plugin_kv）或直接使用 global()/project()。
  };
  // ★ events 服务（C7 附带修复）：插件 manifest 常 inject 'events'（如 worldbuilding 订阅
  //   chapter.saved）。此前宿主未提供该服务 → cordis 使插件停留在等待态，apply 永不执行、
  //   路由/工具全部丢失（worldbuilding 的 /api/plugins/worldbuilding 一直 404 即此原因）。
  const eventBus = new EventBus();
  const eventsService = {
    on<T>(name: string, handler: (payload: T) => void | Promise<void>): () => void {
      return eventBus.on(name, handler);
    },
    emit<T>(name: string, payload: T): Promise<void> {
      return eventBus.emit(name, payload);
    },
  };
  const settingsService = {
    // 已废弃：插件 UI 统一走工作台面板；设置页只显示插件管理列表
    registerSection: () => () => undefined,
  };
  const schedulerService = {
    register(def: { label: string; intervalMs: number; run: () => Promise<void> | void }) {
      const timer = setInterval(() => {
        Promise.resolve(def.run()).catch((err: unknown) =>
          console.error('[cordis-plugin] 定时任务 ' + def.label + ' 失败:', err));
      }, def.intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  const promptSections = new Map<string, { order: number; text: string }>();
  const promptService = {
    section(def: { name: string; order: number; text: string }) {
      const key = 'plugin:prompt:' + def.name;
      promptSections.set(key, { order: def.order, text: def.text });
      return () => promptSections.delete(key);
    },
  };

  // ---- 注入服务到 cordis ctx（命名与旧契约一致 → 插件 inject 直接生效） ----
  const proxy = ctx as unknown as { provide?: (name: string, value: unknown) => void };
  proxy.provide?.('routes', routesService);
  proxy.provide?.('services', servicesService);
  proxy.provide?.('db', dbService);
  proxy.provide?.('ai', aiService);
  proxy.provide?.('settings', settingsService);
  proxy.provide?.('scheduler', schedulerService);
  proxy.provide?.('prompt', promptService);
  proxy.provide?.('events', eventsService);
  proxy.provide?.('hooks', hookBus);

  // ---- 健康检查 ----
  rootApp.get('/api/health', (c) => {
    const dbReady = !!getDb();
    return c.json({
      status: dbReady ? 'ok' : 'degraded',
      database: dbReady ? 'connected' : 'unavailable',
      pluginStandard: INSTALL_STANDARD_VERSION,
      plugins: [...statuses.values()].map((p) => ({ id: p.id, status: p.status, error: p.error })),
      timestamp: Date.now(),
    });
  });

  // ---- 插件挂载（真实 cordis：ctx.plugin + fiber） ----
  async function mountEntry(entry: PluginEntry): Promise<void> {
    const order = seq++;
    entriesById.set(entry.id, entry);

    if (disabledIds.has(entry.id)) {
      statuses.set(entry.id, {
        id: entry.id,
        name: entry.manifest?.name ?? entry.id,
        source: entry.source,
        status: 'disabled',
        order,
        enabled: false,
        permissions: entry.manifest?.permissions ?? [],
        dependsOn: entry.manifest?.dependsOn ?? [],
      });
      return;
    }

    try {
      const mod = await entry.load();
      if (typeof (mod as PluginModule | undefined)?.apply !== 'function') {
        throw new Error('插件模块缺少 apply() 导出');
      }
      // 非内置插件：给 apply 收到的 ctx 套守护归因（路由/AI/事件/定时器/db 错误按插件计数）
      const watched = entry.source !== 'builtin';
      let mountedMod: PluginModule = mod as unknown as PluginModule;
      if (watched) {
        // 重挂场景：先清理上一次经包装层注册的资源
        guardedBags.get(entry.id)?.();
        guardedBags.delete(entry.id);
        const handle = createGuardedPluginHandle(mod as PluginModule, entry.id, guardian, entry.manifest?.permissions ?? []);
        mountedMod = handle.mod;
        guardedBags.set(entry.id, handle.disposeTracked);
      }
      const fiber = await ctx.plugin(mountedMod as Plugin, {});
      fibers.set(entry.id, fiber as unknown as { dispose(): unknown });
      statuses.set(entry.id, {
        id: entry.id,
        name: entry.manifest?.name ?? entry.id,
        source: entry.source,
        status: 'ok',
        order,
        enabled: true,
        permissions: entry.manifest?.permissions ?? [],
        dependsOn: entry.manifest?.dependsOn ?? [],
      });
      guardian.onMounted(entry.id, entry.source);
      console.info('[cordis-host] 插件已挂载: ' + entry.id + ' (cordis fiber)');
    } catch (err) {
      // 挂载失败：已产生的包装层资源一并清理
      guardedBags.get(entry.id)?.();
      guardedBags.delete(entry.id);
      const message = err instanceof Error ? err.message : String(err);
      statuses.set(entry.id, {
        id: entry.id,
        name: entry.manifest?.name ?? entry.id,
        source: entry.source,
        status: 'error',
        error: 'LOAD_FAILED: ' + message,
        order,
        enabled: false,
        permissions: entry.manifest?.permissions ?? [],
        dependsOn: entry.manifest?.dependsOn ?? [],
      });
      console.error('[cordis-host] 插件 ' + entry.id + ' 挂载失败（已隔离，不影响宿主）: ' + message);
    }
  }

  const host: ServerPluginHost = {
    ctx,
    events: ctx,
    hooks: hookBus,

    async mount(entries: PluginEntry[]) {
      // ── 安装管线（novel-plugin-standard/1.0，见 docs/architecture/plugin-standard.md）──
      // 逐门校验：任何一门失败都只隔离该插件并记录标准错误码，绝不中断整批挂载。
      //   G0 Manifest 门 → G2 身份门（重复 id）→ G3 版本门 + G4 静态依赖门
      //   → G4/G5 挂载期门（拓扑排序 + 环检测 + 注入校验）→ mountEntry（load/apply 隔离）
      const admitted: PluginEntry[] = [];
      for (const entry of entries) {
        const order = seq++;
        // G0 Manifest 门（AI 创建的本地产物可能是 rawManifest）
        if (!entry.manifest && entry.rawManifest) {
          try {
            entry.manifest = validateManifest(entry.rawManifest as Parameters<typeof validateManifest>[0]);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            statuses.set(entry.id, {
              id: entry.id,
              name: entry.id,
              source: entry.source,
              status: 'error',
              error: 'MANIFEST_INVALID: ' + message,
              order,
              enabled: false,
              permissions: [],
              dependsOn: [],
            });
            console.error('[install-gate] ' + entry.id + ' 未通过 G0 Manifest 门: ' + message);
            continue;
          }
        }
        if (!entry.manifest) {
          statuses.set(entry.id, {
            id: entry.id,
            name: entry.id,
            source: entry.source,
            status: 'error',
            error: 'MANIFEST_INVALID: 插件条目缺少 manifest',
            order,
            enabled: false,
            permissions: [],
            dependsOn: [],
          });
          continue;
        }
        const manifest = entry.manifest;
        // G2 身份门：id 全局唯一（重复注册会覆盖 fibers/statuses，引发卸载错乱）
        if (entriesById.has(entry.id) || admitted.some((e) => e.id === entry.id)) {
          statuses.set(entry.id, {
            id: entry.id,
            name: manifest.name,
            source: entry.source,
            status: 'error',
            error: 'ID_CONFLICT: 插件 id 与已注册插件重复',
            order,
            enabled: false,
            permissions: manifest.permissions,
            dependsOn: manifest.dependsOn ?? [],
          });
          console.error('[install-gate] ' + entry.id + ' 未通过 G2 身份门: id 重复注册');
          continue;
        }
        // G3 版本门 + G4 静态依赖门（自依赖 / 依赖被禁用）
        const policyIssues = checkManifestPolicy(manifest, { disabledPluginIds: disabledIds });
        if (policyIssues.length > 0) {
          statuses.set(entry.id, {
            id: entry.id,
            name: manifest.name,
            source: entry.source,
            status: 'error',
            error: policyIssues.map((i) => i.code + ': ' + i.message).join('; '),
            order,
            enabled: false,
            permissions: manifest.permissions,
            dependsOn: manifest.dependsOn ?? [],
          });
          console.error('[install-gate] ' + entry.id + ' 未通过安装门: ' + policyIssues.map((i) => i.code).join('/'));
          continue;
        }
        admitted.push(entry);
      }

      // G4/G5 挂载期门：按 inject 服务 + dependsOn 拓扑排序；
      // 已禁用插件不进 available 集合 → 依赖它的插件按标准跳过（硬依赖不可用）。
      const available = new Set<string>(SERVER_SERVICES);
      for (const e of admitted) {
        if (!disabledIds.has(e.id)) available.add(e.id);
      }
      const plan = sortByDependencies(
        admitted.map((e) => ({
          entry: e,
          id: e.id,
          inject: e.manifest?.server?.inject ?? [],
          dependsOn: e.manifest?.dependsOn ?? [],
        })),
        available,
      );
      for (const cycle of plan.cycles) {
        for (const id of cycle) {
          const entry = admitted.find((e) => e.id === id);
          statuses.set(id, {
            id,
            name: entry?.manifest?.name ?? id,
            source: entry?.source ?? 'local',
            status: 'error',
            error: 'DEP_CYCLE: 循环依赖 ' + cycle.join(' → '),
            order: seq++,
            enabled: false,
            permissions: entry?.manifest?.permissions ?? [],
            dependsOn: entry?.manifest?.dependsOn ?? [],
          });
        }
        console.error('[install-gate] 检测到循环依赖，已整环隔离: ' + cycle.join(' → '));
      }
      const serviceNames: readonly string[] = SERVER_SERVICES;
      for (const { item, missing } of plan.skipped) {
        const entry: PluginEntry = item.entry;
        const missingServices = missing.filter((x) => serviceNames.includes(x));
        const error = missingServices.length === missing.length
          ? 'INJECT_MISSING: 宿主无法提供注入服务（' + missing.join(', ') + '）'
          : 'DEP_MISSING: 硬依赖不可用（' + missing.join(', ') + '）';
        statuses.set(entry.id, {
          id: entry.id,
          name: entry.manifest?.name ?? entry.id,
          source: entry.source,
          status: 'skipped',
          error,
          order: seq++,
          enabled: false,
          permissions: entry.manifest?.permissions ?? [],
          dependsOn: entry.manifest?.dependsOn ?? [],
        });
        console.error('[install-gate] ' + entry.id + ' 被跳过: ' + error);
      }
      // 按拓扑序挂载（load/apply 失败在 mountEntry 内隔离为 LOAD_FAILED）
      for (const item of plan.sorted) {
        await mountEntry(item.entry);
      }
    },

    async start(startOpts) {
      const port = startOpts?.port ?? options.port ?? 3774;
      const hostAddr = startOpts?.host ?? options.host ?? '127.0.0.1';
      const distIndex = startOpts?.distIndex;

      // 真实 DSH webServer 服务（node:http，动态路由 + disposer）
      await ctx.plugin(WebServer, { host: hostAddr, port });

      // /api → 根 Hono 应用（全部模块路由 + 全局中间件）
      // 路由插件依赖 webServer 服务存在后才注册（inject）
      await ctx.plugin({
        name: 'novel.web-bridge',
        inject: ['webServer'],
        apply(c: any) {
          c.effect(
            () => c.webServer.register({ kind: 'prefix', path: '/api', handler: honoListener(rootApp) }),
            'novel: /api 路由桥',
          );
          if (distIndex) {
            const handler = createStaticFallback(distIndex);
            c.effect(() => c.webServer.registerFallback(async (req: IncomingMessage, res: ServerResponse) => {
              try {
                await handler(req, res);
              } catch (err) {
                console.error('[cordis-host] fallback 处理异常:', err);
                if (!res.headersSent) { res.writeHead(500); res.end(); } else { res.destroy(); }
              }
            }), 'novel: 前端静态资源 fallback');
          } else {
            console.warn('[cordis-host] distIndex 未提供，跳过静态服务');
          }
        },
      } as Plugin);

      const port2 = (ctx as unknown as { webServer: { port: number } }).webServer.port;
      const url = 'http://localhost:' + port2;
      console.warn('[Server] Cordis 基座已就绪 → ' + url);
      return { port: port2, url };
    },

    getPluginStatus() {
      // 守护器快照实时合并（调用次数/错误数随运行变化）
      return [...statuses.values()].map((p) => {
        const g = guardian.snapshotOf(p.id);
        return g ? { ...p, guardian: { ...g } } : p;
      });
    },

    promotePlugin(id) {
      if (!entriesById.has(id)) return { ok: false, error: '未知插件 ' + id };
      const rec = guardian.promote(id);
      if (!rec) return { ok: false, error: '插件 ' + id + ' 不受守护器观察（内置插件）' };
      return { ok: true };
    },

    async requarantinePlugin(id) {
      if (!entriesById.has(id)) return { ok: false, error: '未知插件 ' + id, remounted: false };
      // 被熔断禁用的插件：直接重新挂载（onMounted 见 failed 态会自动重置为隔离观察）
      if (disabledIds.has(id)) {
        const r = await this.setPluginEnabled(id, true);
        if (!r.ok) return { ok: false, error: r.error ?? '重新挂载失败', remounted: false };
        return { ok: true, remounted: true };
      }
      const rec = guardian.requarantine(id);
      if (!rec) return { ok: false, error: '插件 ' + id + ' 不受守护器观察（内置插件）', remounted: false };
      return { ok: true, remounted: false };
    },

    getGuardianPolicy() {
      return { ...guardian.policy };
    },

    async setPluginEnabled(id: string, enabled: boolean) {
      const entry = entriesById.get(id);
      if (!entry) return { ok: false, error: '未知插件 ' + id };

      if (enabled) {
        // 标准 G4 依赖门：硬依赖必须已启用（与安装管线/动态安装语义一致），
        // 否则插件挂上了但依赖能力缺失，运行时才炸 —— 那正是"装插件就崩"的根源之一。
        for (const d of entry.manifest?.dependsOn ?? []) {
          const dep = statuses.get(d);
          if (!dep || !dep.enabled || dep.status !== 'ok') {
            return { ok: false, error: '依赖插件 ' + d + ' 未启用（请先启用依赖，或重启 server 由安装管线自动排序）' };
          }
        }
        if (disabledIds.has(id)) {
          disabledIds.delete(id);
          await mountEntry(entry);
          if (statuses.get(id)?.status !== 'ok') {
            disabledIds.add(id);
            await persistDisabled();
            return { ok: false, error: '插件 ' + id + ' 重新挂载失败（详见服务端日志）' };
          }
          await persistDisabled();
        }
        return { ok: true };
      }

      const fiber = fibers.get(id);
      if (fiber) {
        try {
          await Promise.resolve(fiber.dispose());
        } catch (err) {
          console.error('[cordis-host] 卸载插件 ' + id + ' 出错:', err);
        }
        fibers.delete(id);
      }
      // 守护包装层兜底清理（插件未用 ctx.effect 包裹的注册物：定时器/AI 工具/事件订阅等）
      const disposeTracked = guardedBags.get(id);
      if (disposeTracked) {
        try {
          disposeTracked();
        } catch (err) {
          console.error('[guardian] 兜底清理 ' + id + ' 失败:', err);
        }
        guardedBags.delete(id);
      }
      const st = statuses.get(id);
      statuses.set(id, {
        id,
        name: st?.name ?? id,
        source: entry.source,
        status: 'disabled',
        order: st?.order ?? 0,
        enabled: false,
        permissions: st?.permissions ?? [],
        dependsOn: st?.dependsOn ?? [],
      });
      disabledIds.add(id);
      await persistDisabled();
      return { ok: true };
    },

    async addPluginEntry(entry: PluginEntry) {
      // 标准安装门：运行时动态安装与启动挂载走同一套校验（novel-plugin-standard/1.0）
      if (!entry.manifest && entry.rawManifest) {
        try {
          entry.manifest = validateManifest(entry.rawManifest as Parameters<typeof validateManifest>[0]);
        } catch (err) {
          return { ok: false, error: 'MANIFEST_INVALID: ' + (err instanceof Error ? err.message : String(err)) };
        }
      }
      if (!entry.manifest) return { ok: false, error: 'MANIFEST_INVALID: 插件条目缺少 manifest' };
      const policyIssues = checkManifestPolicy(entry.manifest, { disabledPluginIds: disabledIds });
      if (policyIssues.length > 0) {
        return { ok: false, error: policyIssues.map((i) => i.code + ': ' + i.message).join('; ') };
      }
      if (entriesById.has(entry.id)) {
        return { ok: false, error: 'ID_CONFLICT: 插件 ' + entry.id + ' 已注册' };
      }
      // G4 运行时依赖门：依赖必须已挂载且启用
      const deps = entry.manifest?.dependsOn ?? [];
      for (const d of deps) {
        const dep = [...statuses.values()].find((s) => s.id === d);
        if (!dep || !dep.enabled || dep.status !== 'ok') {
          return { ok: false, error: 'DEP_MISSING: 依赖插件 ' + d + ' 未启用' };
        }
      }
      entriesById.set(entry.id, entry);
      await mountEntry(entry);
      const st = statuses.get(entry.id);
      if (!st || st.status !== 'ok') return { ok: false, error: '插件 ' + entry.id + ' 挂载失败（详见服务端日志）' };
      return { ok: true };
    },

    recordInstallRejections(items: Array<{ id: string; message: string }>) {
      for (const item of items) {
        if (statuses.has(item.id) || entriesById.has(item.id)) continue;
        statuses.set(item.id, {
          id: item.id,
          name: item.id,
          source: 'local',
          status: 'error',
          error: item.message,
          order: seq++,
          enabled: false,
          permissions: [],
          dependsOn: [],
        });
      }
    },

    setInitialDisabled(ids: string[]) {
      disabledIds.clear();
      for (const id of ids) disabledIds.add(id);
    },

    getDependencyAnalysis() {
      return analyzeDependencies([...entriesById.values()]);
    },

    getDisabledIds() {
      return [...disabledIds];
    },

    async dispose() {
      try {
        await Promise.resolve((ctx as unknown as { fiber?: { dispose(): unknown } }).fiber?.dispose?.());
      } catch (err) {
        console.error('[cordis-host] 释放基座出错:', err);
      }
    },
  };

  // 守护器熔断回调经 hostRef 延迟引用宿主（避免构造期循环依赖）
  hostRef = host;

  return host;
}
