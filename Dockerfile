# ============================================================
# NovelMuse — Docker 多阶段构建（Linux/amd64 优化）
#
# 阶段：
#   1. builder — 安装依赖 + 构建前端 dist（含编译工具）
#   2. runner  — 生产镜像（alpine，无编译工具，最小化攻击面）
#
# 说明：
#   - @novel/db 入口为 src/index.ts，生产环境需 tsx 运行
#   - tsx 在 devDependencies，因此 runner 保留完整 node_modules
#   - 使用 nodeLinker: hoisted（pnpm-workspace.yaml）避免 pnpm 符号链接跨阶段丢失
#
# 运行：
#   docker build -t novelmuse .
#   docker run -p 3774:3774 -v ./data:/app/data novelmuse
# ============================================================

# ---------- Stage 1: 构建依赖 + 前端产物 ----------
# ★ pnpm@11.8.0 要求 Node.js v22.13+（使用 node:sqlite 内置模块）
FROM node:22-alpine AS builder

# better-sqlite3 编译需要 python3/make/g++
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

# 复制全部源码 + 依赖清单（.dockerignore 已排除 node_modules / dist / data）
# 一次性复制避免后续 COPY 覆盖已安装的 node_modules
COPY . .

# 安装全部依赖（hoisted 模式，所有依赖扁平化在根 node_modules 和子包 node_modules）
# --frozen-lockfile 保证与 lockfile 一致
RUN pnpm install --frozen-lockfile

# 调试：检查 hoisted 模式下的依赖位置
RUN echo "=== 根 node_modules/vite ==="; ls node_modules/vite/bin/ 2>&1 | head -3; \
    echo "=== 根 .bin/vite ==="; ls -la node_modules/.bin/vite 2>&1; \
    echo "=== apps/web/node_modules ==="; ls apps/web/node_modules/ 2>&1 | head -15

# 构建前端（输出到 apps/web/dist）
# ★ 不用 pnpm build：pnpm hoisted 模式下 vite 在根 node_modules，
#   pnpm --filter 执行子包 script 时硬编码查找 apps/web/node_modules/vite，找不到
#   直接用 node 调用 vite.js 绕过此问题
RUN cd apps/web && node ../../node_modules/vite/bin/vite.js build

# ---------- Stage 2: 生产镜像 ----------
FROM node:22-alpine AS runner

# tini 作为 init 进程，正确处理信号转发（SIGTERM 优雅关闭数据库）
RUN apk add --no-cache tini

WORKDIR /app

# 创建 non-root 用户
RUN addgroup -S appuser && adduser -S -G appuser -h /app appuser

# 创建数据目录
RUN mkdir -p /app/data && chown -R appuser:appuser /app

# 复制完整 node_modules（含 tsx + better-sqlite3 二进制）
# 注：tsx 在 devDeps 但运行时必需，故不 prune
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/pnpm-lock.yaml ./
COPY --from=builder --chown=appuser:appuser /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=appuser:appuser /app/package.json ./
COPY --from=builder --chown=appuser:appuser /app/packages ./packages
COPY --from=builder --chown=appuser:appuser /app/apps/server ./apps/server

# 复制前端构建产物
COPY --from=builder --chown=appuser:appuser /app/apps/web/dist ./apps/web/dist

# 环境变量
ENV NODE_ENV=production \
    PORT=3774 \
    DB_PATH=/app/data/novelmuse.db

EXPOSE 3774

USER appuser

# tini 接管 PID 1，确保 SIGTERM 正确传递（优雅关闭数据库）
ENTRYPOINT ["/sbin/tini", "--"]

# 使用 tsx 运行服务端（@novel/db 为 .ts 源码）
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]
