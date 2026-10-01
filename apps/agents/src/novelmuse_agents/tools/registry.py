"""工具注册表（Tool Registry）—— AI 编排层的单一事实来源。

设计原则（详见 docs/AI对话操控模块可行性论证.md）：
1. 所有 tool 直接映射到现有模块 REST 端点，不重写任何业务逻辑。
2. 每个 tool 带 risk 分级（read / write / delete）与 requires_confirm 标记，
   破坏性操作默认需要二次确认（Phase 2+ 接入）。
3. 所有 tool 强制携带 projectId，且后端端点已含 requireAuth + verifyProjectOwnership，
   因此 AI 调用与 UI 点击走同一条鉴权链，无权限提升风险。
4. 注册表与具体 LLM SDK 解耦：to_openai_schemas() 输出标准 function schema，
   可被 Strands / OpenAI / Anthropic 等直接消费。

实现说明：本模块刻意不依赖 pydantic，保持零三方依赖，
便于在任意运行时校验与复用作契约层。当前阶段（Phase 0/1）仅登记「只读」工具，
零破坏，用于打通「意图 → tool → 结果 → UI」全链路。写/删工具预留位置，待后续阶段启用。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

# 后端 Hono 服务地址（agents 微服务回调后端用）。默认 3774，见工作记忆。
SERVER_URL = "http://127.0.0.1:3774"

Risk = Literal["read", "write", "delete"]


@dataclass
class ToolSpec:
    """单个工具的定义。

    path 为带 /api 前缀的模板，{param} 形式的占位符会从 args 中提取作为路径参数；
    其余 args 作为 query（GET）或 body（POST/PUT）参数。
    """

    name: str
    description: str
    method: Literal["GET", "POST", "PUT", "DELETE"]
    path: str
    params: Dict[str, Any] = field(default_factory=dict)
    risk: Risk = "read"
    requires_confirm: bool = False

    def to_openai_schema(self) -> Dict[str, Any]:
        """转换为 OpenAI / Strands 兼容的 function tool schema。"""

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.params.get("properties", {}),
                    "required": self.params.get("required", []),
                },
            },
        }


# ---------------------------------------------------------------------------
# 只读工具（Phase 0/1）—— 端点形状均对照 apps/server/src/modules/*.ts 实测
# ---------------------------------------------------------------------------

_READ_TOOLS: list[ToolSpec] = [
    ToolSpec(
        name="list_characters",
        description="列出某部作品中已有的全部角色，返回名称、别名、关系等概览。",
        method="GET",
        path="/api/projects/{projectId}/characters",
        params={
            "type": "object",
            "properties": {
                "projectId": {"type": "string", "description": "作品（项目）ID，必填"},
            },
            "required": ["projectId"],
        },
    ),
    ToolSpec(
        name="get_character",
        description="获取单个角色的完整档案（性格、动机、外貌、生平、关系等）。",
        method="GET",
        path="/api/characters/{id}",
        params={
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "角色 ID"},
            },
            "required": ["id"],
        },
    ),
    ToolSpec(
        name="search_characters",
        description="在当前作品内按关键词检索角色，适合「提到过 X 吗」这类问题。",
        method="GET",
        path="/api/characters/search",
        params={
            "type": "object",
            "properties": {
                "projectId": {"type": "string", "description": "作品 ID，必填"},
                "q": {"type": "string", "description": "检索关键词"},
            },
            "required": ["projectId", "q"],
        },
    ),
    ToolSpec(
        name="list_notes",
        description="列出某部作品下的全部笔记（标题、标签、关联章节等）。",
        method="GET",
        path="/api/notes/projects/{projectId}",
        params={
            "type": "object",
            "properties": {
                "projectId": {"type": "string", "description": "作品 ID，必填"},
            },
            "required": ["projectId"],
        },
    ),
    ToolSpec(
        name="get_note",
        description="获取单条笔记的完整内容。",
        method="GET",
        path="/api/notes/{id}",
        params={
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "笔记 ID"},
            },
            "required": ["id"],
        },
    ),
    ToolSpec(
        name="web_search",
        description="联网检索外部资料（如历史背景、写作技巧），不触及用户私有数据。",
        method="POST",
        path="/api/search",
        params={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "maxResults": {"type": "integer", "description": "返回条数，1-20，默认 5"},
            },
            "required": ["query"],
        },
    ),
]

# 写 / 删工具预留（Phase 2+ 启用，当前不暴露给 LLM）。
_WRITE_TOOLS: list[ToolSpec] = [
    ToolSpec(
        name="create_note",
        description="[预留] 为某作品创建一条笔记。",
        method="POST",
        path="/api/notes",
        params={
            "type": "object",
            "properties": {
                "projectId": {"type": "string"},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "linkedChapterId": {"type": "string"},
            },
            "required": ["projectId"],
        },
        risk="write",
        requires_confirm=True,
    ),
    ToolSpec(
        name="add_character",
        description="[预留] 为某作品新增一个角色。",
        method="POST",
        path="/api/characters",
        params={
            "type": "object",
            "properties": {
                "projectId": {"type": "string"},
                "name": {"type": "string"},
                "aliases": {"type": "array", "items": {"type": "string"}},
                "personality": {"type": "string"},
                "backstory": {"type": "string"},
            },
            "required": ["projectId", "name"],
        },
        risk="write",
        requires_confirm=True,
    ),
]

# 当前暴露给 LLM 的工具集合（Phase 0/1 仅只读）。
TOOLS: list[ToolSpec] = _READ_TOOLS

# 全量注册（含预留），供网关做能力白名单与审计。
ALL_TOOLS: list[ToolSpec] = _READ_TOOLS + _WRITE_TOOLS


def get_tool(name: str) -> Optional[ToolSpec]:
    """按名称查找工具定义。"""

    for t in ALL_TOOLS:
        if t.name == name:
            return t
    return None


def to_openai_schemas() -> list[Dict[str, Any]]:
    """输出当前暴露工具的标准 function schema 列表（供 LLM SDK 消费）。"""

    return [t.to_openai_schema() for t in TOOLS]


def build_request(
    tool: ToolSpec,
    args: Dict[str, Any],
    token: str,
) -> Dict[str, Any]:
    """根据工具定义与参数，构造对后端 Hono 的实际 HTTP 请求。

    返回 dict：{ method, url, headers, params?, json? }
    - 路径参数 {param} 从 args 提取；
    - GET 的其余参数放 query（params）；
    - POST/PUT 的其余参数放 body（json）。
    """

    path_params: Dict[str, str] = {}
    cleaned = dict(args)

    def _repl(match: "re.Match[str]") -> str:
        key = match.group(1)
        val = cleaned.pop(key, None)
        if val is None:
            raise ValueError(f"工具 {tool.name} 缺少路径参数: {key}")
        path_params[key] = str(val)
        return str(val)

    url_path = re.sub(r"\{(\w+)\}", _repl, tool.path)
    url = f"{SERVER_URL}{url_path}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    if tool.method == "GET":
        return {"method": tool.method, "url": url, "headers": headers, "params": cleaned}
    return {"method": tool.method, "url": url, "headers": headers, "json": cleaned}
