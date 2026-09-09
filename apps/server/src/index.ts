// ============================================================
// 主入口 —— Cordis 基座（@deepseek-ai/cordis + dsh-host-webserver）
// 所有业务模块 = cordis 插件，由宿主 mount() 装配，start() 启动 HTTP。
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import { createServerPluginHost } from './plugin/host.js';
import { BUILTIN_PLUGINS } from './plugin/builtin.js';
import { createPluginManagerEntry } from './plugin/manager.js';
import { scanLocalPluginsDetailed } from './plugin/local-scanner.js';
import { setPluginHostForTools } from './ai/tools/plugin-tools.js';
import { createSqliteKvService } from './plugin/kv-service.js';
import { initDatabase, closeDatabase, closeAllProjectDbs, getDb, eq, schema, saveToDisk, getMainSqlite, migrateToProjectDbs } from '@novel/db';
// 代理初始化必须在所有可能发起 fetch 的模块加载前执行
import { initProxy } from './lib/proxy-agent.js';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './lib/jwt.js';

// 端口：支持 PORT 环境变量覆盖（Docker/容器化场景必需），默认 3774
// PORT=0 时让操作系统自动分配可用端口（Electron 桌面端场景）
const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3774;

// 插件宿主（Cordis 基座）：mount 在下方启动流程中执行
const kv = createSqliteKvService();
const serverPluginHost = createServerPluginHost({ kv });

(async () => {
  // ---- 启动守卫：生产环境必须显式配置 JWT_SECRET ----
  // 安全最佳实践：签名密钥缺失/回退到公开值 = 任意用户 token 可伪造。
  // 缺失时拒绝启动（fail-fast），绝不进入「半可用」状态。
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    console.error('[Server] ❌ 生产环境必须设置 JWT_SECRET 环境变量（生成方式：openssl rand -hex 32）。已拒绝启动。');
    process.exit(1);
  }

  // 尽早初始化代理，让后续所有 fetch 自动走代理（解决中国大陆直连 OpenAI 的 ETIMEDOUT）
  try {
    await initProxy();
  } catch (e) {
    console.warn('[Server] 代理初始化失败（继续启动）:', e);
  }

  try {
    // 初始化数据库（schema 自动迁移 / 建表）
    await initDatabase(process.env.DB_PATH);

    // 初始化默认管理员用户（如果不存在）
    try {
      const db = getDb();
      if (db) {
        // 引导条件是「系统里没有任何管理员」，而不是「没有叫 admin 的用户」。
        // 否则管理员一旦改名，下次启动会再造一个 admin 账号出来。
        const adminUsername = process.env.ADMIN_USERNAME ?? 'admin';
        const existingAdmin = db.select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.isAdmin, true))
          .get();

        if (!existingAdmin) {
          // 首次创建管理员：优先用 ADMIN_PASSWORD 环境变量；未设置则生成随机强口令并打印到控制台。
          // 安全最佳实践：移除固定默认口令（admin/novelmuse123 曾公开写死在源码/README，人人可登录管理员）。
          const adminPassword = process.env.ADMIN_PASSWORD ?? randomBytes(16).toString('base64url');
          const now = new Date();
          const userId = uuidv4();
          const passwordHash = await hashPassword(adminPassword);

          db.insert(schema.users).values({
            id: userId,
            username: adminUsername,
            passwordHash,
            displayName: '管理员',
            isAdmin: true,
            createdAt: now,
            updatedAt: now,
          }).run();

          await saveToDisk(true);
          if (process.env.ADMIN_PASSWORD) {
            console.warn(`[Server] ✅ 默认管理员用户创建成功 (${adminUsername} / 密码来自 ADMIN_PASSWORD 环境变量)`);
          } else {
            console.warn(`[Server] ✅ 默认管理员用户创建成功 (${adminUsername})`);
            console.warn(`[Server] 🔑 管理员初始密码（仅本次启动显示，请立即登录后修改）: ${adminPassword}`);
          }
        } else if (process.env.ADMIN_PASSWORD) {
          // ADMIN_PASSWORD 显式设置时：每次启动同步管理员密码（明确意图优先于界面修改）
          const syncedHash = await hashPassword(process.env.ADMIN_PASSWORD);
          db.update(schema.users).set({ passwordHash: syncedHash, updatedAt: new Date() })
            .where(eq(schema.users.username, adminUsername)).run();
          await saveToDisk(true);
          console.warn(`[Server] 已按 ADMIN_PASSWORD 环境变量同步管理员密码（${adminUsername}）`);
        }
      }
    } catch (initErr) {
      console.error('[Server] 初始化默认用户失败', initErr);
    }

    // 主库 → 项目库 数据迁移（首次启动时拆分已有数据到每项目独立库）
    try {
      const db = getDb();
      const mainSqlite = getMainSqlite();
      if (db && mainSqlite) {
        const projects = db.select({ id: schema.projects.id }).from(schema.projects).all() as Array<{ id: string }>;
        const projectIds = projects.map((p) => p.id);
        await migrateToProjectDbs(mainSqlite, projectIds);
      }
    } catch (migErr) {
      console.error('[Server] 主库→项目库迁移失败（非致命，继续启动）：', migErr);
    }
  } catch (e) {
    console.error('[Server] 数据库初始化失败，将以降级模式运行', e);
  }

  // ---- 装配 Cordis 插件树 ----
  // 持久化禁用清单（插件管理界面开关会写入）
  const disabled = kv.get<string[]>('novel.host', 'disabled-plugins') ?? [];
  serverPluginHost.setInitialDisabled(disabled);

  // AI 造插件工具需要访问宿主
  setPluginHostForTools(serverPluginHost);

  // 本地插件（AI 创建 / 手动放置）自动扫描 —— 安装门逐个校验（novel-plugin-standard/1.0），
  // 单个坏插件只被拒绝并上报，不影响其他插件与宿主启动
  let scanResult: ReturnType<typeof scanLocalPluginsDetailed> = { entries: [], rejected: [] };
  try {
    scanResult = scanLocalPluginsDetailed();
  } catch (err) {
    console.error('[Server] 本地插件扫描失败（跳过本地插件，不影响启动）:', err);
  }
  // 被安装门拒绝的插件登记进宿主状态：/api/health 与插件管理界面可见（而非静默消失）
  serverPluginHost.recordInstallRejections(
    scanResult.rejected.map((r) => ({ id: r.id, message: `${r.code}: ${r.message}` })),
  );
  await serverPluginHost.mount([
    ...BUILTIN_PLUGINS,
    createPluginManagerEntry(() => serverPluginHost),
    ...scanResult.entries,
  ]);

  // 端口冲突检测：tsx watch 重启时旧进程可能还没释放端口
  const waitForPort = async (portNum: number, maxWaitMs = 10000): Promise<void> => {
    const net = await import('net');
    const start = Date.now();
    for (;;) {
      const available = await new Promise<boolean>((resolve) => {
        const tester = net.createServer();
        tester.once('error', () => resolve(false));
        tester.once('listening', () => {
          tester.close();
          resolve(true);
        });
        tester.listen(portNum);
      });
      if (available) return;
      if (Date.now() - start > maxWaitMs) {
        throw new Error('端口 ' + portNum + ' 被占用超过 ' + maxWaitMs + 'ms');
      }
      console.warn('[Server] 端口 ' + portNum + ' 被占用，等待旧进程释放...');
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  let started = false;
  try {
    await waitForPort(port);
    // 生产环境：静态文件服务（dist 存在时注册 fallback）
    const distPath = process.env.WEB_DIST_PATH || join(process.cwd(), 'apps/web/dist');
    const distIndex = process.env.NODE_ENV === 'production' && existsSync(distPath)
      ? join(distPath, 'index.html')
      : undefined;
    // 绑定地址：默认仅本机；Linux 服务器部署需对外访问时设 HOST=0.0.0.0
    const bindHost = process.env.HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
    await serverPluginHost.start({ port, host: bindHost, distIndex });
    started = true;
  } catch (e) {
    console.error('[Server] 启动失败（端口冲突或基座初始化失败）:', e);
    // 端口占用诊断只提示端口号，不执行外部命令（历史版本的 netstat|findstr 管道
    // 为 Windows 专属且输出未被使用，已在安全复查中移除）
    if (port !== 0) {
      console.error('[Server] 端口 ' + port + ' 可能被占用，请检查占用该端口的进程。');
    }
  }

  if (!started && port === 0) {
    // PORT=0 时不可能冲突，失败说明基座本身起不来
    process.exit(1);
  }

  // 启动章节回收站清理定时器：每小时硬删除已软删除超过 30 天的章节。
  const { cleanupExpiredChapters } = await import('./services/chapter-service.js');
  const cleanupTimer = setInterval(async () => {
    try {
      const removed = await cleanupExpiredChapters();
      if (removed > 0) {
        console.warn('[Server] 自动清理过期软删除章节: ' + removed + ' 条');
      }
    } catch (e) {
      console.error('[Server] 清理过期章节失败:', e);
    }
  }, 60 * 60 * 1000);
  cleanupTimer.unref();

  // ---- 优雅关闭 ----
  const closeGracefully = async (signal: string) => {
    console.warn('[Server] 收到 ' + signal + '，正在优雅关闭...');
    try {
      await serverPluginHost.dispose();
    } catch (e) {
      console.error('[Server] 释放 Cordis 基座失败:', e);
    }
    try {
      await Promise.race([
        closeAllProjectDbs(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('closeAllProjectDbs 超时')), 3000)),
      ]);
    } catch (e) {
      console.error('[Server] 关闭项目库失败:', e);
    }
    try {
      await Promise.race([
        closeDatabase(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('closeDatabase 超时')), 3000)),
      ]);
    } catch (e) {
      console.error('[Server] 关闭主库失败:', e);
    }
    process.exit(0);
  };

  const handleFatal = async (err: unknown, type: string) => {
    console.error('[Server] 致命错误 (' + type + '):', err);
    // 尽力释放资源，但**不退出进程**：dev 模式下 tsx watch 依赖进程存活；
    // 单独一次异步异常不应拖垮整个服务（原实现 process.exit(1) 会让端口静默消失）。
    try {
      await serverPluginHost.dispose();
    } catch {
      // 忽略释放错误
    }
  };

  process.on('SIGINT', () => void closeGracefully('SIGINT'));
  process.on('SIGTERM', () => void closeGracefully('SIGTERM'));
  process.on('uncaughtException', (err) => void handleFatal(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason) => { console.error('[Server] 未处理的 Promise 拒绝（已忽略，不影响服务）:', reason); });
})();

// 兼容导出：宿主实例（测试/工具可访问）
export { serverPluginHost as default };
export { createServerPluginHost } from './plugin/host.js';
