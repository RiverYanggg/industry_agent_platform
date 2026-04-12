"""Health, agent LLM settings, model catalog, OpenAI-compatible /v1 endpoints."""
from __future__ import annotations

import json
import textwrap
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from server.agent_runtime import build_programmatic_reply, openai_completion_payload
from server.ml import MODEL_TEMPLATES
from server.schemas import AgentSettingsUpdate, ChatCompletionRequest
from server.settings import build_openai_client, load_agent_settings, public_agent_settings, set_app_settings

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    from server.utils import now_iso

    return {"status": "ok", "timestamp": now_iso()}


@router.get("/settings/agent-model")
def get_agent_model_settings() -> dict[str, Any]:
    return public_agent_settings()


@router.patch("/settings/agent-model")
def update_agent_model_settings(payload: AgentSettingsUpdate) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    for field in ("enabled", "base_url", "api_key", "model", "temperature", "system_prompt"):
        value = getattr(payload, field)
        if value is not None:
            updates[f"agent_{field}"] = value
    if updates:
        set_app_settings(updates)
    return public_agent_settings()


@router.post("/settings/agent-model/test")
def test_agent_model_settings() -> dict[str, Any]:
    config = load_agent_settings()
    if config["runtime_mode"] != "llm":
        raise HTTPException(status_code=400, detail="LLM runtime is not fully configured.")
    client = build_openai_client(config)
    response = client.chat.completions.create(
        model=config["model"],
        messages=[
            {"role": "system", "content": "You are a connectivity test agent."},
            {"role": "user", "content": "Reply with pong and one short status sentence."},
        ],
        temperature=0,
    )
    preview = (response.choices[0].message.content or "").strip()
    return {"status": "ok", "runtime_mode": config["runtime_mode"], "preview": preview}


@router.get("/catalog/model-templates")
def list_model_templates() -> list[dict[str, Any]]:
    return [{k: v for k, v in template.items() if k != "factory"} for template in MODEL_TEMPLATES.values()]


@router.get("/v1/models")
def openai_models() -> dict[str, Any]:
    config = load_agent_settings()
    models = [
        {"id": "industry-agent-default", "object": "model", "owned_by": "platform"},
        *[{"id": template_id, "object": "model", "owned_by": "platform"} for template_id in MODEL_TEMPLATES.keys()],
    ]
    if config["model"]:
        models.insert(0, {"id": config["model"], "object": "model", "owned_by": "upstream-proxy"})
    return {"object": "list", "data": models}


@router.post("/v1/chat/completions")
def openai_chat_completions(payload: ChatCompletionRequest):
    config = load_agent_settings()
    if config["runtime_mode"] == "llm":
        try:
            client = build_openai_client(config)
            if not payload.stream:
                response = client.chat.completions.create(
                    model=payload.model,
                    messages=payload.messages,
                )
                return JSONResponse(response.model_dump())

            upstream_stream = client.chat.completions.create(
                model=payload.model,
                messages=payload.messages,
                stream=True,
            )

            def streamer():
                for chunk in upstream_stream:
                    yield f"data: {json.dumps(chunk.model_dump(), ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(streamer(), media_type="text/event-stream")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Upstream LLM proxy failed: {exc}") from exc

    last_message = ""
    for message in reversed(payload.messages):
        if message.get("role") == "user":
            content = message.get("content", "")
            if isinstance(content, list):
                last_message = " ".join([str(item.get("text", "")) for item in content if isinstance(item, dict)])
            else:
                last_message = str(content)
            break
    reply = build_programmatic_reply(payload.model, last_message, payload.metadata)
    if not payload.stream:
        return JSONResponse(openai_completion_payload(payload.model, reply))

    def streamer():
        completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        chunks = textwrap.wrap(reply, width=36, break_long_words=False, break_on_hyphens=False)
        for chunk in chunks:
            data = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": payload.model,
                "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
            time.sleep(0.03)
        final = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": payload.model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(streamer(), media_type="text/event-stream")
