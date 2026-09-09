#!/usr/bin/env bash
# ============================================================
# NovelMuse — Docker 镜像构建与导出脚本（方案 B）
#
# 功能：
#   1. 构建 novelmuse:latest 主服务镜像
#   2. 构建 novelmuse-agents:latest Python agents 镜像（可选）
#   3. 导出为 .tar 包，便于离线传输
#   4. 生成 MD5 校验文件
#   5. 打包 docker-compose.yml + .env.docker.example + 加载脚本
#
# 使用方式：
#   chmod +x scripts/docker-build.sh
#   ./scripts/docker-build.sh             # 仅构建主服务
#   ./scripts/docker-build.sh --agents    # 同时构建 agents
#   ./scripts/docker-build.sh --agents --no-export  # 仅构建不导出
#
# 输出目录：./dist-docker/
#   ├── novelmuse.tar
#   ├── novelmuse-agents.tar （--agents 时）
#   ├── docker-compose.yml
#   ├── .env.docker.example
#   ├── docker-load.sh
#   └── *.md5
# ============================================================

set -euo pipefail

# ---- 配置 ----
IMAGE_MAIN="novelmuse:latest"
IMAGE_AGENTS="novelmuse-agents:latest"
OUTPUT_DIR="./dist-docker"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- 参数解析 ----
BUILD_AGENTS=false
EXPORT=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agents) BUILD_AGENTS=true; shift ;;
    --no-export) EXPORT=false; shift ;;
    --help|-h)
      echo "Usage: $0 [--agents] [--no-export]"
      echo "  --agents     同时构建 Python agents 镜像"
      echo "  --no-export  仅构建不导出 tar 包"
      exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"

# ---- 前置检查 ----
echo "==> 前置检查"
command -v docker >/dev/null 2>&1 || { echo "❌ 未安装 docker"; exit 1; }
docker info >/dev/null 2>&1 || { echo "❌ docker daemon 未运行"; exit 1; }

# 检查关键文件是否存在
[[ -f "Dockerfile" ]] || { echo "❌ 未找到 Dockerfile"; exit 1; }
[[ -f "docker-compose.yml" ]] || { echo "❌ 未找到 docker-compose.yml"; exit 1; }
[[ -f "package.json" ]] || { echo "❌ 未找到 package.json（不在项目根？）"; exit 1; }
[[ -f "pnpm-lock.yaml" ]] || { echo "❌ 未找到 pnpm-lock.yaml"; exit 1; }

# ---- 数据安全检查 ----
echo "==> 数据安全检查（确认无 .env / *.db 进入构建上下文）"
if [[ -f ".env" ]]; then
  echo "⚠️  检测到根目录 .env 文件，.dockerignore 已排除，但请确认无敏感信息泄露风险"
fi
if find . -name "*.db" -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null | grep -q .; then
  echo "⚠️  检测到 .db 文件存在，.dockerignore 已排除，不会进入镜像"
fi

# ---- 构建主服务镜像 ----
echo ""
echo "==> [1/2] 构建主服务镜像 $IMAGE_MAIN"
docker build \
  --target runner \
  -t "$IMAGE_MAIN" \
  -f Dockerfile \
  .

# 镜像大小报告
MAIN_SIZE=$(docker images "$IMAGE_MAIN" --format "{{.Size}}" | head -1)
echo "✅ 主服务镜像构建完成: $IMAGE_MAIN ($MAIN_SIZE)"

# ---- 构建 agents 镜像（可选）----
if [[ "$BUILD_AGENTS" == "true" ]]; then
  echo ""
  echo "==> [2/2] 构建 Python agents 镜像 $IMAGE_AGENTS"
  docker build \
    -t "$IMAGE_AGENTS" \
    -f apps/agents/Dockerfile \
    .
  AGENTS_SIZE=$(docker images "$IMAGE_AGENTS" --format "{{.Size}}" | head -1)
  echo "✅ Agents 镜像构建完成: $IMAGE_AGENTS ($AGENTS_SIZE)"
fi

# ---- 导出 tar 包 ----
if [[ "$EXPORT" != "true" ]]; then
  echo ""
  echo "==> --no-export 模式，跳过导出"
  echo "✅ 完成。镜像已构建到本地 docker，可直接 docker compose up -d"
  exit 0
fi

echo ""
echo "==> 导出 tar 包到 $OUTPUT_DIR/"
mkdir -p "$OUTPUT_DIR"

# 主服务
echo "  导出 $IMAGE_MAIN → $OUTPUT_DIR/novelmuse.tar"
docker save "$IMAGE_MAIN" -o "$OUTPUT_DIR/novelmuse.tar"
md5sum "$OUTPUT_DIR/novelmuse.tar" > "$OUTPUT_DIR/novelmuse.tar.md5"

# Agents
if [[ "$BUILD_AGENTS" == "true" ]]; then
  echo "  导出 $IMAGE_AGENTS → $OUTPUT_DIR/novelmuse-agents.tar"
  docker save "$IMAGE_AGENTS" -o "$OUTPUT_DIR/novelmuse-agents.tar"
  md5sum "$OUTPUT_DIR/novelmuse-agents.tar" > "$OUTPUT_DIR/novelmuse-agents.tar.md5"
fi

# 复制部署文件
echo "  复制 docker-compose.yml"
cp docker-compose.yml "$OUTPUT_DIR/"
echo "  复制 .env.docker.example"
cp .env.docker.example "$OUTPUT_DIR/"

# 生成加载脚本
cat > "$OUTPUT_DIR/docker-load.sh" <<'LOAD_EOF'
#!/usr/bin/env bash
# ============================================================
# NovelMuse — 离线机器镜像加载与启动脚本
#
# 使用方式：
#   1. 将整个 dist-docker/ 目录传到目标 Linux 机器
#   2. cd dist-docker
#   3. cp .env.docker.example .env && vim .env  # 填入 API Key 等
#   4. chmod +x docker-load.sh
#   5. ./docker-load.sh          # 仅主服务
#   6. ./docker-load.sh --agents # 含 Python agents
# ============================================================

set -euo pipefail

LOAD_AGENTS=false
[[ "${1:-}" == "--agents" ]] && LOAD_AGENTS=true

echo "==> 校验 MD5"
md5sum -c novelmuse.tar.md5
if [[ "$LOAD_AGENTS" == "true" ]]; then
  [[ -f novelmuse-agents.tar.md5 ]] && md5sum -c novelmuse-agents.tar.md5
fi

echo "==> 加载主服务镜像"
docker load -i novelmuse.tar

if [[ "$LOAD_AGENTS" == "true" ]]; then
  echo "==> 加载 agents 镜像"
  docker load -i novelmuse-agents.tar
fi

echo "==> 启动服务"
if [[ "$LOAD_AGENTS" == "true" ]]; then
  docker compose --profile agents up -d
else
  docker compose up -d
fi

echo ""
echo "✅ 启动完成"
echo "   访问: http://localhost:${PORT:-3774}"
echo "   日志: docker compose logs -f"
echo "   停止: docker compose down"
LOAD_EOF
chmod +x "$OUTPUT_DIR/docker-load.sh"

# 生成说明文件
cat > "$OUTPUT_DIR/README.md" <<'README_EOF'
# NovelMuse Docker 离线部署包

## 包含文件
- `novelmuse.tar` — 主服务镜像（Web + API + SQLite）
- `novelmuse-agents.tar` — Python agents 镜像（可选，需单独构建）
- `docker-compose.yml` — 编排配置
- `.env.docker.example` — 环境变量模板
- `docker-load.sh` — 一键加载并启动脚本
- `*.md5` — 校验文件

## 部署步骤
1. 将整个目录传到目标 Linux 机器
2. `cp .env.docker.example .env` 并填入配置
3. `./docker-load.sh` 启动（含 agents 用 `--agents`）
4. 访问 http://localhost:3774

## 数据持久化
数据存储在 Docker 命名卷 `novelmuse-data`，不会随容器删除。
备份：`docker run --rm -v novelmuse-data:/data -v $(pwd):/backup alpine tar czf /backup/novelmuse-data.tar.gz /data`
README_EOF

echo ""
echo "✅ 全部完成"
echo ""
echo "📦 输出目录: $OUTPUT_DIR/"
ls -lh "$OUTPUT_DIR/"
echo ""
echo "下一步：将 $OUTPUT_DIR/ 整个目录传到目标 Linux 机器"
echo "  scp -r $OUTPUT_DIR user@linux-host:/opt/novelmuse"
echo "  ssh user@linux-host"
echo "  cd /opt/novelmuse && cp .env.docker.example .env && vim .env"
echo "  ./docker-load.sh"
