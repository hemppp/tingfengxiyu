"""配置管理 - 处理 AIConfig 与请求级覆盖"""

from __future__ import annotations

import logging
import os
from typing import Literal, Optional

from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


ProviderType = Literal["openai", "ollama", "custom"]

# 合法的 provider 值（用于校验 AI_PROVIDER 环境变量）
_VALID_PROVIDERS = {"openai", "ollama", "custom"}


class AIConfig(BaseModel):
    """AI Provider 配置（与 TS 后端 provider-factory.ts 对齐）"""

    base_url: str = Field(default="https://api.openai.com/v1")
    api_key: str = Field(default="")
    model: str = Field(default="gpt-4-turbo")
    provider: ProviderType = Field(default="openai")


def load_config_from_env() -> AIConfig:
    """从环境变量加载默认配置（当请求未携带 config 时使用）"""

    # M4: 规范化 provider 值（大小写 / 前后空白），非法值记录警告并回退到 openai
    raw_provider = os.getenv("AI_PROVIDER", "openai") or "openai"
    provider = raw_provider.lower().strip()

    if provider not in _VALID_PROVIDERS:
        logger.warning(
            "AI_PROVIDER=%r 非法（合法值: %s），回退到 'openai'",
            raw_provider,
            ", ".join(sorted(_VALID_PROVIDERS)),
        )
        provider = "openai"

    if provider == "ollama":
        return AIConfig(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            api_key="ollama",
            model=os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
            provider="ollama",
        )

    if provider == "custom":
        return AIConfig(
            base_url=os.getenv("CUSTOM_AI_BASE_URL", "https://api.openai.com/v1"),
            api_key=os.getenv("CUSTOM_AI_API_KEY", ""),
            model=os.getenv("CUSTOM_AI_MODEL", "gpt-4-turbo"),
            provider="custom",
        )

    # 默认 openai
    return AIConfig(
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        api_key=os.getenv("OPENAI_API_KEY", ""),
        model=os.getenv("OPENAI_MODEL", "gpt-4-turbo"),
        provider="openai",
    )


def merge_config(request_config: Optional[AIConfig]) -> AIConfig:
    """
    合并请求级配置与环境变量默认配置。
    请求中未提供的字段回退到环境变量。

    修复：使用 model_fields_set 区分"请求未提供字段"与"提供了默认值"，
    避免空 config 对象被 Pydantic 填充默认值后覆盖环境变量配置。
    """
    base = load_config_from_env()
    if request_config is None:
        return base

    merged = base.model_copy()
    # 仅覆盖请求中显式提供的字段（通过 model_fields_set 判断）
    fields_set = request_config.model_fields_set
    if "base_url" in fields_set and request_config.base_url and request_config.base_url.strip():
        merged.base_url = request_config.base_url
    if "api_key" in fields_set and request_config.api_key and request_config.api_key.strip():
        merged.api_key = request_config.api_key
    if "model" in fields_set and request_config.model and request_config.model.strip():
        merged.model = request_config.model
    if "provider" in fields_set:
        merged.provider = request_config.provider
    return merged
