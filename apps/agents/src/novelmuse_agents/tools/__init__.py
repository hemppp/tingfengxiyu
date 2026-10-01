"""NovelMuse 工具注册表包。

把后端已有的功能模块 REST 端点声明为 LLM 可调用的 tool 定义，
作为"AI 对话操控其他模块"的单一事实来源（single source of truth）。

- Phase 0/1：先落地「只读」工具（read），零破坏，用于验证全链路。
- Phase 2+：补齐「写 / 删」工具（write / delete），并启用确认门。
"""

from .registry import (
    ToolSpec,
    TOOLS,
    get_tool,
    to_openai_schemas,
    build_request,
)

__all__ = [
    "ToolSpec",
    "TOOLS",
    "get_tool",
    "to_openai_schemas",
    "build_request",
]
