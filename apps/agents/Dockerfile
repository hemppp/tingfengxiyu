# ============================================================
# NovelMuse Agents — Python Strands Agents 微服务
#
# 可选服务：仅在使用 Python agents 功能时启动
# 默认不构建/不启动，需通过 docker compose --profile agents up 显式启用
#
# 运行端口：3775（仅容器内，不对外暴露，由主服务转发）
# 构建上下文：项目根目录（docker compose build 默认行为）
# ============================================================

FROM python:3.11-slim AS builder

WORKDIR /app

# 系统依赖（编译 C 扩展用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖清单和应用源码（pip install 需要源码以解析包结构）
COPY apps/agents/pyproject.toml apps/agents/src ./

# 创建虚拟环境并安装依赖
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# ---------- 生产镜像 ----------
FROM python:3.11-slim AS runner

# 从 builder 复制虚拟环境（含已安装的 novelmuse_agents 包）
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# 创建 non-root 用户
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

USER appuser

ENV AGENTS_PORT=3775 \
    AGENTS_HOST=0.0.0.0

EXPOSE 3775

# 使用 uvicorn 启动（host 0.0.0.0 允许容器间通信）
CMD ["python", "-m", "uvicorn", "novelmuse_agents.main:app", "--host", "0.0.0.0", "--port", "3775"]
