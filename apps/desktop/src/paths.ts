// ============================================================
// apps/desktop/src/paths.ts
// userData 布局解析与首启播种（ADR-0008 D2 第 4 项、D7、D8.2）。
//
// 冻结内容：
//   D7.1  userData 布局（11 个 updater 需要的字段 + 本 shell 的派生字段）
//   D7.2  首次启动播种（version.json 不存在时）
//   D7.3  <userData>/app-runtime/app-server/data → <userData>/data   ★关键
//   D7.4  <userData>/plugins/node_modules → app-runtime/app-server/node_modules
//   D8.2  app-server/node_modules/better-sqlite3 → asar.unpacked 副本
//   F20   junction 的 lstat().isDirectory() === false ⇒ 存在性判断必须用
//         fs.statSync / fs.existsSync
//
// ★ 数据安全红线（ADR D7.3 硬规则）：
//   `data` 是 junction 指向 <userData>/data（主库 + 全部项目库）。
//   **绝不允许**对 junction 做 recursive 删除 —— Node 的
//   `fs.rmSync(link, { recursive: true })` 会穿过 reparse point 删掉
//   目标目录里的真实数据。本文件所有删除路径都只对**非 junction 的
//   空目录**生效，或用 `unlink` 语义只摘除链接本身。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

import type { Logger, UserDataLayout, VersionJson } from './types.js';

/** 需要投递到 userData 的资源子目录名（D16 extraResources 的 `to` 名）。 */
const RES_APP_SERVER = 'app-server';
const RES_WEB_DIST = 'web-dist';
const RES_SEED_PLUGINS = 'seed-plugins';

/** D7.2 步骤 3：播种的三个插件模式目录（`local` 单独创建，不播种）。 */
const SEEDED_PLUGIN_MODES = ['auto', 'manual', 'shared'] as const;

/** 真实目录被 junction 顶替前的备份后缀（仅用于 better-sqlite3，见 D8.2）。 */
const ABI_BACKUP_SUFFIX = '.node-abi-bak';

// ------------------------------------------------------------
// 布局解析
// ------------------------------------------------------------

/**
 * 由 `<userData>` 根解析出完整布局（ADR D7.1）。
 *
 * 纯计算，**不触碰磁盘** —— 播种与建目录由 `ensureLayout()` 负责。
 * 字段名与 `updater/types.ts:22-45` 的 `UpdaterLayout` 前 11 项逐字一致。
 */
export function resolveLayout(userData: string): UserDataLayout {
  const dataDir = path.join(userData, 'data');
  const pluginsRoot = path.join(userData, 'plugins');
  const appRuntimeDir = path.join(userData, 'app-runtime');
  const appServerDir = path.join(appRuntimeDir, RES_APP_SERVER);
  const logsDir = path.join(userData, 'logs');
  const updatesDir = path.join(userData, 'updates');

  return {
    // ---- 与 updater/types.ts 的 UpdaterLayout 逐字对齐的 11 项 ----
    userData,
    dataDir,
    dbPath: path.join(dataDir, 'novelmuse.db'),
    pluginsRoot,
    appRuntimeDir,
    webDistDir: path.join(appRuntimeDir, RES_WEB_DIST),
    versionJsonPath: path.join(appRuntimeDir, 'version.json'),
    updatesDir,
    backupsDir: path.join(userData, 'backups'),
    logsDir,
    updatesConfigPath: path.join(updatesDir, 'config.json'),

    // ---- 本 shell 的派生路径 ----
    jwtSecretPath: path.join(dataDir, '.jwt-secret'),
    projectsDir: path.join(dataDir, 'projects'),
    localPluginsDir: path.join(pluginsRoot, 'local'),
    appServerDir,
    appServerDataLink: path.join(appServerDir, 'data'),
    pluginsNodeModulesLink: path.join(pluginsRoot, 'node_modules'),
    appServerNodeModules: path.join(appServerDir, 'node_modules'),
    mainLogPath: path.join(logsDir, 'main.log'),
    serverOutLogPath: path.join(logsDir, 'server.out.log'),
    serverErrLogPath: path.join(logsDir, 'server.err.log'),
    initialAdminPasswordPath: path.join(logsDir, 'initial-admin-password.txt'),
  };
}

// ------------------------------------------------------------
// junction 工具（F20 陷阱集中在此）
// ------------------------------------------------------------

/** 判断路径是否存在（**跟随** junction；F20：不能用 lstat().isDirectory()）。 */
export function pathExists(target: string): boolean {
  try {
    // statSync 跟随 reparse point；junction 目标存在时返回 true。
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

/** 判断路径自身是否为链接（Windows 目录 junction 在 lstat 下即 symbolic link）。 */
export function isLink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 读链接指向的目标（junction 返回其目标路径；失败返回 null）。 */
function readLinkTarget(target: string): string | null {
  try {
    return fs.readlinkSync(target);
  } catch {
    return null;
  }
}

/**
 * 摘除一个**链接**（绝不递归）。
 *
 * Windows 上 junction 用 `unlinkSync` 可能报 EPERM，故按
 * unlink → rmdir → rm(force, 非递归) 依次尝试。
 * **禁止**传 `recursive: true`：那会穿透 junction 删掉目标真实数据。
 */
function removeLink(link: string): void {
  try {
    fs.unlinkSync(link);
    return;
  } catch {
    /* 继续尝试 */
  }
  try {
    fs.rmdirSync(link);
    return;
  } catch {
    /* 继续尝试 */
  }
  fs.rmSync(link, { force: true, recursive: false });
}

/** 目录是否为空（仅用于「非 junction 的真实空目录」判定）。 */
function isEmptyDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/** 比较两个路径是否指向同一处（Windows 大小写不敏感）。 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * 幂等确保 `link` 是指向 `target` 的**目录 junction**。
 *
 * 行为矩阵：
 * | 现状 | 动作 |
 * |---|---|
 * | 不存在 | 建目标目录 → `symlinkSync(target, link, 'junction')` |
 * | 已是 junction 且指向 target | 无操作 |
 * | 已是 junction 但指向别处 | 摘除链接（不递归）→ 重建 |
 * | 是真实**空**目录 | 删除该空目录（不递归）→ 重建为 junction |
 * | 是真实**非空**目录 | **拒绝操作**，记 error 日志并返回 false（绝不销毁数据） |
 *
 * @returns 最终 `link` 是否为指向 `target` 的 junction
 */
export function ensureDirectoryJunction(
  link: string,
  target: string,
  log: Logger,
): boolean {
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (error) {
    log('error', `junction 目标目录创建失败：${target} —— ${String(error)}`);
    return false;
  }

  const lstatOk = (() => {
    try {
      fs.lstatSync(link);
      return true;
    } catch {
      return false;
    }
  })();

  if (lstatOk) {
    if (isLink(link)) {
      const current = readLinkTarget(link);
      if (current !== null && samePath(current, target)) {
        // 已就位。注意：链接存在但目标被删时 statSync 为 false，
        // 此时仍算「存在但悬空」，交由下方 pathExists 复核。
        if (pathExists(link)) {
          return true;
        }
        log('warn', `junction 悬空（目标缺失），重建：${link} → ${target}`);
      } else {
        log('warn', `junction 指向错误目标，重建：${link}（原 ${String(current)}）→ ${target}`);
      }
      try {
        removeLink(link);
      } catch (error) {
        log('error', `junction 摘除失败：${link} —— ${String(error)}`);
        return false;
      }
    } else if (isEmptyDir(link)) {
      log('warn', `发现真实空目录占位，替换为 junction：${link} → ${target}`);
      try {
        fs.rmdirSync(link);
      } catch (error) {
        log('error', `空目录删除失败：${link} —— ${String(error)}`);
        return false;
      }
    } else {
      log(
        'error',
        `junction 位置被真实非空目录占用，拒绝删除以免销毁数据：${link}；` +
          `期望指向 ${target}。请人工处理后重试。`,
      );
      return false;
    }
  }

  try {
    fs.symlinkSync(target, link, 'junction');
    log('info', `已建立 junction：${link} → ${target}`);
    return true;
  } catch (error) {
    log('error', `junction 创建失败：${link} → ${target} —— ${String(error)}`);
    return false;
  }
}

// ------------------------------------------------------------
// 目录创建
// ------------------------------------------------------------

/** 创建 D7.1 布局里的全部**普通目录**（不含 junction）。 */
function ensureBaseDirs(layout: UserDataLayout): void {
  const dirs = [
    layout.userData,
    layout.dataDir,
    layout.projectsDir,
    layout.pluginsRoot,
    layout.localPluginsDir,
    layout.appRuntimeDir,
    // ★ 必须建 appServerDir：它是 appServerDataLink（<app-server>/data → <userData>/data）
    //   与 appServerNodeModules（plugins/node_modules 的 junction 目标）的**父目录**。
    //   ensureDirectoryJunction 只建 junction 的目标目录，不建链接自身的父目录；
    //   开发态跳过播种 ⇒ 若不在此建，<app-server> 不存在 ⇒ symlink ENOENT ⇒
    //   D7.3 junction 建不起来并打出「一次更新销毁全部项目数据」的误导性 error。
    layout.appServerDir,
    layout.updatesDir,
    layout.backupsDir,
    layout.logsDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ------------------------------------------------------------
// 首启播种（D7.2）
// ------------------------------------------------------------

/** 递归复制目录（不覆盖已存在文件，符合 D7.2「不覆盖用户改动」）。 */
function copyDirNoClobber(from: string, to: string): { copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;
  if (!pathExists(from)) {
    return { copied, skipped };
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      const nested = copyDirNoClobber(src, dst);
      copied += nested.copied;
      skipped += nested.skipped;
    } else if (entry.isSymbolicLink()) {
      // 负载生成器已解引用（D4.2 排除插件局部 node_modules），此处保守跳过。
      skipped += 1;
    } else if (pathExists(dst)) {
      skipped += 1;
    } else {
      fs.copyFileSync(src, dst);
      copied += 1;
    }
  }
  return { copied, skipped };
}

/** 读 `version.json`（不存在或损坏返回 null）。 */
export function readVersionJson(layout: UserDataLayout): VersionJson | null {
  try {
    const raw = fs.readFileSync(layout.versionJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<VersionJson>;
    if (typeof parsed.appVersion === 'string') {
      return {
        appVersion: parsed.appVersion,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 写 `version.json`（D7.2 步骤 6）。 */
function writeVersionJson(layout: UserDataLayout, appVersion: string): void {
  const payload: VersionJson = {
    appVersion,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(layout.versionJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * D7.2 首启播种（冻结 6 步）。
 *
 * **仅打包态调用**：开发态直接跑仓库源码（D12.5），不使用 app-runtime。
 *
 * @param resourcesRoot 打包态的 `process.resourcesPath`
 */
function seedFromResources(
  layout: UserDataLayout,
  resourcesRoot: string,
  appVersion: string,
  log: Logger,
): void {
  const srcAppServer = path.join(resourcesRoot, RES_APP_SERVER);
  const srcWebDist = path.join(resourcesRoot, RES_WEB_DIST);
  const srcSeedPlugins = path.join(resourcesRoot, RES_SEED_PLUGINS);

  if (!pathExists(srcAppServer)) {
    log(
      'error',
      `首启播种失败：未找到 ${srcAppServer}。请确认安装包 extraResources 已投递 app-server（ADR D4.2/D16.2）。`,
    );
    throw new Error(`app-server payload missing at ${srcAppServer}`);
  }

  // 步骤 1：app-server 负载
  const appServerCopy = copyDirNoClobber(srcAppServer, layout.appServerDir);
  log(
    'info',
    `首启播种：app-server → ${layout.appServerDir}（复制 ${appServerCopy.copied} 个文件，跳过 ${appServerCopy.skipped}）`,
  );

  // 步骤 2：web-dist
  if (pathExists(srcWebDist)) {
    const webCopy = copyDirNoClobber(srcWebDist, layout.webDistDir);
    log(
      'info',
      `首启播种：web-dist → ${layout.webDistDir}（复制 ${webCopy.copied} 个文件，跳过 ${webCopy.skipped}）`,
    );
  } else {
    log(
      'warn',
      `首启播种：未找到 ${srcWebDist} ⇒ 打包态将没有前端静态资源（窗口会 404）。` +
        `请确认已执行 pnpm --filter @novel/web build 后重新打包。`,
    );
  }

  // 步骤 3：seed-plugins 三个模式目录（已存在则跳过，不覆盖用户改动）
  for (const mode of SEEDED_PLUGIN_MODES) {
    const src = path.join(srcSeedPlugins, mode);
    const dst = path.join(layout.pluginsRoot, mode);
    if (!pathExists(src)) {
      log('warn', `首启播种：缺少 seed-plugins/${mode}（跳过）`);
      continue;
    }
    const stats = copyDirNoClobber(src, dst);
    log(
      'info',
      `首启播种：seed-plugins/${mode} → ${dst}（复制 ${stats.copied} 个文件，跳过 ${stats.skipped}）`,
    );
  }

  // 步骤 4：plugins/local（ensureBaseDirs 已建，此处仅为显式对齐冻结步骤）
  fs.mkdirSync(layout.localPluginsDir, { recursive: true });

  // 步骤 5 的 junction 由 ensureRuntimeJunctions() 在播种后调用。

  // 步骤 6：version.json
  writeVersionJson(layout, appVersion);
  log('info', `首启播种完成，已写 ${layout.versionJsonPath}（appVersion=${appVersion}）`);
}

// ------------------------------------------------------------
// 运行期 junction（D7.3 / D7.4 / D8.2）
// ------------------------------------------------------------

/** `ensureRuntimeJunctions` 的结论，供日志与自证使用。 */
export interface JunctionReport {
  /** D7.3：app-server/data → <userData>/data（**关键**，失败即数据风险） */
  dataJunction: boolean;
  /** D7.4：plugins/node_modules → app-server/node_modules */
  pluginsNodeModulesJunction: boolean;
  /** D8.2：app-server/node_modules/better-sqlite3 → asar.unpacked 副本 */
  betterSqlite3Junction: boolean;
  /** D8.2 是否尝试过（打包态才尝试） */
  betterSqlite3Attempted: boolean;
}

/**
 * 确保 D7.3 / D7.4 / D8.2 三个 junction 就位。
 *
 * D7.3 是**不可协商项**：`packages/db/src/project-db.ts` 的
 * `resolveProjectRoot()` 向上找 `pnpm-workspace.yaml`（`:79-87`，全文无
 * `process.env`）⇒ Mode B 下项目库恒落 `<app-server>/data/projects/`，
 * 而 `<app-server>` 会被应用更新整体替换 ⇒ 不做 junction 就会在一次更新中
 * 毁掉全部项目数据。ADR D7.3 硬规则：「若 `data` junction 丢失，每次启动
 * 必须重建」。
 *
 * @param unpackedBetterSqlite3 打包态 asar.unpacked 里的 better-sqlite3 实体目录；
 *   开发态传 null（dev 直接跑仓库 node_modules，ABI 137 与 Node 匹配）。
 */
export function ensureRuntimeJunctions(
  layout: UserDataLayout,
  log: Logger,
  unpackedBetterSqlite3: string | null,
): JunctionReport {
  const report: JunctionReport = {
    dataJunction: false,
    pluginsNodeModulesJunction: false,
    betterSqlite3Junction: false,
    betterSqlite3Attempted: false,
  };

  // D7.3 ★ 关键：<app-server>/data → <userData>/data
  report.dataJunction = ensureDirectoryJunction(
    layout.appServerDataLink,
    layout.dataDir,
    log,
  );
  if (!report.dataJunction) {
    log(
      'error',
      'D7.3 junction 未能建立：项目库将落在可被更新替换的目录中，' +
        '存在一次更新销毁全部项目数据的风险。',
    );
  }

  // D7.4：<plugins>/node_modules → <app-server>/node_modules
  report.pluginsNodeModulesJunction = ensureDirectoryJunction(
    layout.pluginsNodeModulesLink,
    layout.appServerNodeModules,
    log,
  );
  if (!report.pluginsNodeModulesJunction) {
    log(
      'warn',
      'D7.4 junction 未能建立：依赖 hono 等第三方包的插件会被隔离（Cannot find package）。',
    );
  }

  // D8.2：<app-server>/node_modules/better-sqlite3 → asar.unpacked 副本
  if (unpackedBetterSqlite3 !== null) {
    report.betterSqlite3Attempted = true;
    const link = path.join(layout.appServerNodeModules, 'better-sqlite3');
    if (!pathExists(unpackedBetterSqlite3)) {
      log(
        'warn',
        `D8.2：未找到重建后的 better-sqlite3（${unpackedBetterSqlite3}）` +
          `⇒ 将回退 sql.js 引擎（D8.3，不阻断启动）。`,
      );
    } else {
      // 负载闭包里已含一份 ABI 137 的 better-sqlite3（D4.2 依赖闭包），
      // 必须先把它挪开再建 junction，否则 junction 建不起来。
      const linkExists = (() => {
        try {
          fs.lstatSync(link);
          return true;
        } catch {
          return false;
        }
      })();
      if (linkExists && !isLink(link)) {
        const backup = `${link}${ABI_BACKUP_SUFFIX}`;
        try {
          if (pathExists(backup)) {
            fs.rmSync(backup, { recursive: true, force: true });
          }
          fs.renameSync(link, backup);
          log(
            'info',
            `D8.2：负载内的 better-sqlite3（Node ABI）已挪到 ${path.basename(backup)}，` +
              `改用 asar.unpacked 的 Electron ABI 副本。`,
          );
        } catch (error) {
          log('warn', `D8.2：挪开负载内 better-sqlite3 失败（${String(error)}）⇒ 继续尝试建 junction。`);
        }
      }
      report.betterSqlite3Junction = ensureDirectoryJunction(
        link,
        unpackedBetterSqlite3,
        log,
      );
      if (!report.betterSqlite3Junction) {
        log(
          'warn',
          'D8.2：better-sqlite3 junction 未建立 ⇒ 预期回退 sql.js（D8.3）。' +
            'sql.js 为内存库，仅在 saveToDisk 时落盘，掉电/强杀有数据损失风险。',
        );
      }
    }
  }

  return report;
}

// ------------------------------------------------------------
// 总入口
// ------------------------------------------------------------

/** `ensureLayout()` 的结果。 */
export interface EnsureLayoutResult {
  layout: UserDataLayout;
  /** 本次是否执行了首启播种（D7.2） */
  seeded: boolean;
  /** 打包态是否检测到 app-server 负载 */
  appServerPresent: boolean;
  junctions: JunctionReport;
}

/**
 * D12.3 启动顺序的第 3、4 步：解析布局 → 建目录 → （打包态）首启播种 →
 * 建运行期 junction。
 *
 * @param userDataPath `app.getPath('userData')`
 * @param isPackaged `app.isPackaged`
 * @param resourcesRoot 打包态 `process.resourcesPath`；开发态传 null
 * @param appVersion `app.getVersion()`（写 version.json 用）
 */
export function ensureLayout(
  userDataPath: string,
  isPackaged: boolean,
  resourcesRoot: string | null,
  appVersion: string,
  log: Logger,
): EnsureLayoutResult {
  const layout = resolveLayout(userDataPath);
  ensureBaseDirs(layout);
  log('info', `userData 布局已就绪：${layout.userData}`);

  let seeded = false;
  if (isPackaged) {
    if (resourcesRoot === null) {
      throw new Error('打包态必须提供 resourcesRoot（process.resourcesPath）');
    }
    // D7.2 触发条件：version.json 不存在
    const existing = readVersionJson(layout);
    if (existing === null) {
      log('info', '未检测到 version.json ⇒ 执行首启播种（D7.2）');
      seedFromResources(layout, resourcesRoot, appVersion, log);
      seeded = true;
    } else {
      log(
        'info',
        `已存在 version.json（appVersion=${existing.appVersion}，updatedAt=${existing.updatedAt}）⇒ 跳过播种`,
      );
    }
  } else {
    log('info', '开发态：跳过 app-runtime 播种，直接使用仓库源码（D12.5）');
  }

  const unpackedBetterSqlite3 =
    isPackaged && resourcesRoot !== null
      ? path.join(
          resourcesRoot,
          'app.asar.unpacked',
          'node_modules',
          'better-sqlite3',
        )
      : null;

  const junctions = ensureRuntimeJunctions(layout, log, unpackedBetterSqlite3);

  return {
    layout,
    seeded,
    appServerPresent: pathExists(layout.appServerDir),
    junctions,
  };
}

/**
 * 定位仓库根（开发态用，D12.5「server 来源 = 仓库 apps/server/src/index.ts，
 * cwd = 仓库根」）。
 *
 * 从 `app.getAppPath()` 向上查找 `pnpm-workspace.yaml` 标记 —— 与
 * `packages/db/src/index.ts:53-61` 等 4 处路径解析同型（ADR F11），
 * 保证 dev 态与 server 侧对「仓库根」的理解一致。
 */
export function findRepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    if (pathExists(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}