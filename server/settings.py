"""Agent LLM settings and OpenAI client."""
from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

from server.config import DEFAULT_AGENT_SYSTEM_PROMPT
from server.db import load_app_settings, set_app_settings
from server.utils import env_bool


def load_agent_settings() -> dict[str, Any]:
    defaults = {
        "enabled": env_bool("AGENT_LLM_ENABLED", False),
        "base_url": os.getenv("AGENT_LLM_BASE_URL", "").strip(),
        "api_key": os.getenv("AGENT_LLM_API_KEY", "").strip(),
        "model": os.getenv("AGENT_LLM_MODEL", "").strip(),
        "temperature": float(os.getenv("AGENT_LLM_TEMPERATURE", "0.2")),
        "system_prompt": os.getenv("AGENT_LLM_SYSTEM_PROMPT", DEFAULT_AGENT_SYSTEM_PROMPT),
    }
    stored = load_app_settings("agent_")
    config = {
        "enabled": bool(stored.get("agent_enabled", defaults["enabled"])),
        "base_url": str(stored.get("agent_base_url", defaults["base_url"]) or "").strip(),
        "api_key": str(stored.get("agent_api_key", defaults["api_key"]) or "").strip(),
        "model": str(stored.get("agent_model", defaults["model"]) or "").strip(),
        "temperature": float(stored.get("agent_temperature", defaults["temperature"]) or defaults["temperature"]),
        "system_prompt": str(stored.get("agent_system_prompt", defaults["system_prompt"]) or DEFAULT_AGENT_SYSTEM_PROMPT),
    }
    config["configured"] = all(config[key] for key in ("base_url", "api_key", "model"))
    config["runtime_mode"] = "llm" if config["enabled"] and config["configured"] else "fallback"
    config["api_key_present"] = bool(config["api_key"])
    return config


def public_agent_settings() -> dict[str, Any]:
    config = load_agent_settings()
    api_key = config["api_key"]
    api_key_mask = ""
    if api_key:
        api_key_mask = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "已配置"
    return {
        "enabled": config["enabled"],
        "configured": config["configured"],
        "runtime_mode": config["runtime_mode"],
        "base_url": config["base_url"],
        "model": config["model"],
        "temperature": config["temperature"],
        "system_prompt": config["system_prompt"],
        "api_key_present": config["api_key_present"],
        "api_key_mask": api_key_mask,
    }


def build_openai_client(config: dict[str, Any]) -> OpenAI:
    base_url = str(config["base_url"]).strip()
    if base_url and not base_url.endswith("/"):
        base_url = f"{base_url}/"
    return OpenAI(api_key=config["api_key"], base_url=base_url)


def extract_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(text[index:])
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            continue
    raise ValueError("No JSON object found in model response.")
