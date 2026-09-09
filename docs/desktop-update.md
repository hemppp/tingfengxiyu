# NovelMuse 桌面端与远程更新

## 1. 桌面端架构（apps/desktop · Electron 33）

```
┌─────────────────────────────────────────────┐
│ Electron 主进程 (main.ts)                    │
│  ├─ spawn(ELECTRON_RUN_AS_NODE) ── 后端      │
│  │    apps/desktop/dist/server/index.js      │
│  │    （esbuild CJS 单文件 bundle）           │
│  ├─ BrowserWindow ── web UI                  │
│  │    resources/web-dist（vite 产物）         │
│  ├─ updater.ts（远程更新器）                  │
│  └─ ipcMain ←→ preload ←→ 渲染进程            │
└─────────────────────────────────────────────┘
        ▲                                      ▲
   resources/（只读，app 更新目标）       userData/（可写，用户数据）
   ├─ server/  ← app 更新替换            ├─ data/novelmuse.db（SQLite）
   ├─ web-dist/ ← app 更新替换           ├─ plugins/ ← 远程插件更新落盘
   └─ drizzle/                           └─ staging/（下载暂存 + 旧版备份）
```

关键点：

| 项 | 说明 |
| --- | --- |
| 后端 | esbuild 打包 CJS 单文件；`better-sqlite3`/`drizzle-orm`/`sql.js` 走 external（resources/server/node_modules） |
| 数据库 | 桌面版默认 `NOVELMUSE_DB_ENGINE=sqljs`（WASM，无原生 ABI 问题）；`DB_PATH` 指向 userData |
| 插件目录 | `PLUGINS_DIR` 环境变量 → `userData/plugins/`（**可写**，远程更新目标） |
| 端口 | `PORT=0` 自动选择可用端口 |

## 2. 远程更新流程

### 更新源（发布侧）

```
release/updates/                 ← 上传到任意静态服务器 / GitHub Pages / OSS
├── manifest.json                # 更新清单
├── app-0.2.0.tar.gz             # 应用包（server/ + web-dist/）
└── plugins/
    └── novel.xxx-0.1.1.tar.gz   # 插件包（{shortId}/ 结构）
```

`manifest.json`：

```json
{
  "app":    { "version": "0.2.0", "url": "app-0.2.0.tar.gz", "sha256": "…", "notes": "更新日志" },
  "plugins": [
    { "id": "novel.xxx", "name": "…", "version": "0.1.1", "url": "plugins/novel.xxx-0.1.1.tar.gz", "sha256": "…", "notes": "…" }
  ]
}
```

### 客户端（updater.ts）

| 阶段 | 机制 |
| --- | --- |
| 检查 | GET `{baseUrl}/manifest.json`，语义化版本对比（应用 + 插件各自独立） |
| 下载 | fetch 到 staging，**SHA-256 校验**（不匹配即中止） |
| 应用更新 | 解压 staging → **备份旧版**到 staging/backup → 原子替换 `resources/server` + `resources/web-dist` → 重启 |
| 插件更新 | 解压 → 备份旧版 → 替换 `userData/plugins/{shortId}` → 记录版本 → 重启生效（server 重新扫描加载） |
| 安全 | 解压防路径穿越（绝对路径 / `..` 拒绝）+ 校验和 + 失败保留旧版 |

### UI（设置 → 更新）

- 更新源 URL 配置（保存到 userData/update-config.json）
- 「检查更新」→ 应用新版本提示 + 插件更新列表（逐项可更新）
- 「一键更新」应用 → 下载/校验/替换 → 自动重启
- 已安装本地插件清单（id + 版本）

## 3. 发布命令

```bash
# 1. 构建完整桌面安装包（NSIS 安装器）
pnpm --filter @novel/desktop dist

# 2. 构建远程更新源（esbuild server + vite web + 插件编译打包 + manifest）
node apps/desktop/scripts/build-update.mjs --notes "0.2.0: 新功能…"

# 3. 上传 release/updates/ 到你的静态服务器 → 客户端设置里填 URL 即可
```

- 应用版本：`apps/desktop/package.json` 的 `version`（或 `UPDATE_VERSION` 环境变量覆盖）
- 插件版本：各插件 `plugin.json` 的 `version` 字段
- 插件包构建时会把 `server/index.ts` **esbuild 编译为 CJS `server/index.js`**（桌面端 Node 无法加载 .ts），`plugin.json` 的 `serverEntry` 自动改写

## 4. 插件在桌面端的行为差异

| 能力 | 开发模式（tsx） | 桌面端（CJS bundle） |
| --- | --- | --- |
| 本地插件扫描 | `apps/plugins/local/`（源码定位） | `userData/plugins/`（PLUGINS_DIR） |
| server 面 | TypeScript 源码（tsx 加载） | 编译后 CJS（更新包内置） |
| web 面 | vite glob 收集 TSX | 随 app 包构建进 bundle |
| AI 创建插件 | 直接可用（tsx 热加载） | 生成源码后需走发布流程编译安装 |
| 插件开关/依赖检查 | ✅ 运行时（非路由扩展点即时生效） | ✅ 同（路由扩展点重启生效） |

## 5. 已知限制

- **应用更新不替换 Electron 壳/exe**（server + web-dist 热替换；壳更新走安装包手动升级）
- 插件路由扩展点在 Hono matcher 构建后无法注册 → 更新后需重启
- web 插件面是构建期收集（CSP script-src 'self'），新增插件 Web 面需随 app 包发布
- 更新源需 HTTPS（或本机 http）
