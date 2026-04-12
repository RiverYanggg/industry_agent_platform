"""Paths, environment, and app constants."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env", override=False)
except ImportError:
    pass

os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/codex-cache")

DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
GENERATED_DIR = DATA_DIR / "generated"
MODEL_DIR = DATA_DIR / "models"
DB_PATH = DATA_DIR / "app.db"
WEB_DIR = BASE_DIR / "web"
CACHE_DIR = Path(os.environ["XDG_CACHE_HOME"])
MPL_CACHE_DIR = Path(os.environ["MPLCONFIGDIR"])

for directory in (DATA_DIR, UPLOAD_DIR, GENERATED_DIR, MODEL_DIR, CACHE_DIR, MPL_CACHE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

DEFAULT_AGENT_SYSTEM_PROMPT = """
你是工业智能建模与 Agent 编排平台的执行代理。你的职责是：
1. 严格基于当前项目 / 子项目上下文工作，不能跨项目猜测或编造资源。
2. 在需要时优先调用工具，尤其是知识库检索、附件预览、模型列表和批量预测。
3. 当用户要求预测、校验、检索、模型信息时，尽量通过工具确认，而不是直接臆测。
4. 回答保持工程化、简洁、可执行；仅在必要时说明工具使用情况。
""".strip()
