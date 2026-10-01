"""NovelMuse Agents 微服务入口 - FastAPI + Uvicorn

提供 HTTP 接口供 TS 后端 /api/ai/gateway 转发调用。
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Dict

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# L5: 在模块加载时加载 .env 文件（.env.example 暗示支持 .env 配置）
load_dotenv()

# L2: 配置统一日志格式和级别
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---- FastAPI 应用 ----


@asynccontextmanager
async def lifespan(app: FastAPI):
    """L1: 使用 lifespan 异步上下文管理器替代已废弃的 @app.on_event("startup")"""
    logger.info("NovelMuse Agents 微服务启动")
    yield


app = FastAPI(
    title="NovelMuse Agents",
    description="AI Agent 微服务 - 基于 Strands Agents SDK",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""

    return {
        "status": "ok",
        "service": "novelmuse-agents",
        "version": "0.1.0",
    }


# ---- 全局异常处理 ----


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # M1: 详细错误仅记录到日志，对外返回通用错误消息
    logger.exception("未处理异常")
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {"code": "INTERNAL_ERROR", "message": "AI Agent 处理失败"},
        },
    )


# ---- 启动入口 ----


def main() -> None:
    port = int(os.getenv("AGENTS_PORT", "3775"))
    # L3: reload 通过环境变量 AGENTS_RELOAD 控制（默认 false，生产安全）
    reload = os.getenv("AGENTS_RELOAD", "false").lower().strip() in ("1", "true", "yes")
    uvicorn.run(
        "novelmuse_agents.main:app",
        host="127.0.0.1",
        port=port,
        reload=reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
