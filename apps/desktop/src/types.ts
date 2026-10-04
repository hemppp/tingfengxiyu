// ============================================================
// apps/desktop/src/types.ts
// 主进程内部共享类型（ADR-0008 D2 冻结清单第 11 项）。
//
// 只放**主进程内部**使用的类型；对外契约类型在 desktop-api.ts。
// 本文件不 import electron（由各使用者自己持有 electron 类型）。
// ============================================================

// ------------------------------------------------------------
// 日志
// ------------------------------------------------------------

/** 日志级别。落盘格式 `[<ISO8601>] [<LEVEL>] <message>`。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志写入函数（logger.ts 产出，注入各模块）。 */
export type Logger = (level: LogLevel, message: string) => void;

/** 子进程输出流归属，决定落 `server.out.log` 还是 `server.err.log`。 */
export type ServerStream = 'out' | 'err';

// ------------------------------------------------------------
// 就绪握手（ADR D5）
// ------------------------------------------------------------

/**
 * `/api/health` 的响应体。
 * 字段名逐字来自 ADR D5.4（源头 `apps/server/src/plugin/host.ts:697-714`）。
 */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'connected' | 'unavailable';
  pluginStandard: string;
  hostMode: string;
  plugins: Array<{
    id: string;
    status: string;
    modes: string[];
    error: string | null;
  }>;
  timestamp: number;
}

/** 就绪结果：握手拿到的端口 + 健康探针结论。 */
export interface ServerReadyInfo {
  /** stderr 握手解析出的真实端口（D5.1）。 */
  port: number;
  /** `http://127.0.0.1:<port>/` —— 渲染进程与窗口 URL 的**同源**基址（D5.2）。 */
  origin: string;
  /** 探针响应体。 */
  health: HealthResponse;
  /** 子进程 pid，供优雅退出使用（D13.4 的 `taskkill /PID`）。 */
  pid: number;
}

/**
 * 启动失败的结构化原因，供错误对话框展示（D5.3）。
 * 每个失败分支都必须填 `reason`（人类可读）+ `stderrTail`。
 */
export interface ServerStartFailure {
  /** 失败阶段的机器可读标记。 */
  stage:
    | 'spawn'
    | 'handshake-timeout'
    | 'early-exit'
    | 'health-timeout'
    | 'total-budget-exceeded'
    | 'shutdown-requested';
  /** 人类可读的一行原因（进对话框标题区）。 */
  reason: string;
  /** stderr 末尾 2000 字符（D5.3 冻结：失败对话框必须含此内容）。 */
  stderrTail: string;
  /** 早期退出时的退出码（未退出为 null）。 */
  exitCode: number | null;
  /** 早期退出时的信号（未退出为 null）。 */
  signalCode: string | null;
}

// ------------------------------------------------------------
// 环境变量装配（ADR D6）
// ------------------------------------------------------------

/** 装配好的子进程环境变量（D6 冻结表的完整集合）。 */
export interface ServerEnv {
  env: Record<string, string>;
  /** 本次是否为「首启生成 JWT_SECRET」（仅日志用）。 */
  jwtSecretGenerated: boolean;
  /** 本次实际注入的键清单（日志与自证用，按字典序）。 */
  injectedKeys: string[];
}

// ------------------------------------------------------------
// userData 布局（ADR D7）
// ------------------------------------------------------------

/**
 * userData 布局解析结果。
 *
 * **重要**：字段名必须与 `apps/desktop/src/updater/types.ts` 的
 * `UpdaterLayout`（11 个字段）**完全一致** —— updater 侧刻意不 import
 * 本文件（它要能在纯 Node 下独立跑验证），靠结构赋值通过类型检查。
 * 改动任何字段名都会同时打断 updater 的编译。
 *
 * 对齐清单（updater/types.ts:22-45）：
 *   userData / dataDir / dbPath / pluginsRoot / appRuntimeDir /
 *   webDistDir / versionJsonPath / updatesDir / backupsDir / logsDir /
 *   updatesConfigPath
 */
export interface UserDataLayout {
  /** `<userData>` = `app.getPath('userData')` */
  userData: string;
  /** `<userData>/data` */
  dataDir: string;
  /** `<userData>/data/novelmuse.db` */
  dbPath: string;
  /** `<userData>/plugins` = PLUGINS_ROOT */
  pluginsRoot: string;
  /** `<userData>/app-runtime`（updater 的替换目标根） */
  appRuntimeDir: string;
  /** `<userData>/app-runtime/web-dist` */
  webDistDir: string;
  /** `<userData>/app-runtime/version.json` */
  versionJsonPath: string;
  /** `<userData>/updates` */
  updatesDir: string;
  /** `<userData>/backups` */
  backupsDir: string;
  /** `<userData>/logs` */
  logsDir: string;
  /** `<userData>/updates/config.json` */
  updatesConfigPath: string;

  // ---- 以下为本 shell 额外需要的派生路径（updater 不需要，故不在其接口里）----

  /** `<userData>/data/.jwt-secret`（D6：0o600） */
  jwtSecretPath: string;
  /** `<userData>/data/projects` */
  projectsDir: string;
  /** `<userData>/plugins/local`（D7.2 步骤 4） */
  localPluginsDir: string;
  /** `<userData>/app-runtime/app-server`（Mode B 负载运行副本） */
  appServerDir: string;
  /** `<userData>/app-runtime/app-server/data`（D7.3 junction 载体） */
  appServerDataLink: string;
  /** `<userData>/plugins/node_modules`（D7.4 junction 载体） */
  pluginsNodeModulesLink: string;
  /** `<userData>/app-runtime/app-server/node_modules`（D7.4 junction 目标） */
  appServerNodeModules: string;
  /** `<userData>/logs/main.log` */
  mainLogPath: string;
  /** `<userData>/logs/server.out.log` */
  serverOutLogPath: string;
  /** `<userData>/logs/server.err.log` */
  serverErrLogPath: string;
  /** `<userData>/logs/initial-admin-password.txt`（D6.2：0o600） */
  initialAdminPasswordPath: string;
}

/** `version.json` 的形状（ADR D7.1 逐字）。 */
export interface VersionJson {
  appVersion: string;
  updatedAt: string;
}

// ------------------------------------------------------------
// 窗口（ADR D12.2）
// ------------------------------------------------------------

/** 窗口可导航的允许来源（同源白名单，D12.2「同源」行）。 */
export interface WindowNavigationPolicy {
  /** 打包态：`http://127.0.0.1:<port>` */
  serverOrigin: string | null;
  /** 开发态：vite dev server 的 origin（含 5174 与 5173 两种候选）。 */
  devOrigin: string | null;
}