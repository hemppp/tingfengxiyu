"""Strands Model 工厂 - 创建 OpenAI 兼容的 Strands 模型实例"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Tuple

from strands.models.openai import OpenAIModel

from .config import AIConfig


logger = logging.getLogger(__name__)


@lru_cache(maxsize=16)
def _create_model_cached(cache_key: Tuple[str, str, str, str]) -> OpenAIModel:
    """带缓存的模型创建（按 config 关键字段做 key）"""

    base_url, api_key, model_id, provider = cache_key

    # Ollama 不需要 API key，但 OpenAI SDK 仍要求字段存在
    auth_token = api_key if api_key else "ollama"

    # Strands 1.45+ 的 OpenAIModel：api_key / base_url 走 client_args
    # timeout 走 client_args（传给底层 OpenAI / httpx 客户端），避免 LLM 调用永久挂起
    return OpenAIModel(
        model_id=model_id,
        client_args={
            "api_key": auth_token,
            "base_url": base_url,
            "timeout": 30.0,
        },
        params={
            "temperature": 0.75,
            "max_tokens": 1024,
        },
    )


def get_strands_model(config: AIConfig) -> OpenAIModel:
    """根据配置获取 Strands OpenAIModel 实例（带缓存）"""

    cache_key = (config.base_url, config.api_key, config.model, config.provider)
    return _create_model_cached(cache_key)


def clear_model_cache() -> None:
    """清空模型缓存（配置变更时调用）"""

    _create_model_cached.cache_clear()
