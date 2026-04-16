"""Agent tool catalog, planning, SSE turn stream, and OpenAI helper replies."""
from __future__ import annotations

import json
import textwrap
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from server.db import execute, fetch_all, fetch_one
from server.knowledge_search import search_project_knowledge
from server.ml import perform_batch_prediction, perform_single_prediction
from server.serialize import serialize_attachment, serialize_message, serialize_model
from server.settings import build_openai_client, extract_json_object, load_agent_settings
from server.utils import absolute_from_data, make_id, now_iso, read_table
from server.utils import dataframe_preview


def list_project_subprojects(project_id: str) -> list[dict[str, Any]]:
    from server.serialize import serialize_subproject

    rows = fetch_all("SELECT * FROM subprojects WHERE project_id = ? ORDER BY updated_at DESC", (project_id,))
    return [serialize_subproject(row) for row in rows]


def list_subproject_models(subproject_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM models WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    return [serialize_model(row) for row in rows]


def list_session_attachment_models(session_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM session_attachments WHERE session_id = ? ORDER BY created_at DESC", (session_id,))
    return [serialize_attachment(row) for row in rows]


def model_tool_payload(model: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": model["id"],
        "name": model["name"],
        "description": model.get("description", ""),
        "task_type": model.get("task_type", ""),
        "feature_columns": model.get("feature_columns", []),
        "target_columns": model.get("target_columns", []),
        "metrics": model.get("metrics", {}),
    }


def tokenize_model_selection_text(value: str) -> list[str]:
    raw = str(value or "").lower()
    normalized = "".join(char if (char.isalnum() or "\u4e00" <= char <= "\u9fff") else " " for char in raw)
    return [item for item in normalized.split() if len(item) >= 2]


def resolve_model_for_message(models: list[dict[str, Any]], message: str) -> dict[str, Any] | None:
    if not models:
        return None
    if len(models) == 1:
        return models[0]
    lowered = message.lower()
    for model in models:
        if model["id"].lower() in lowered or model["name"].lower() in lowered:
            return model

    query_tokens = tokenize_model_selection_text(message)
    if not query_tokens:
        return None

    best_model: dict[str, Any] | None = None
    best_score = 0
    for model in models:
        searchable_parts = [
            model.get("id", ""),
            model.get("name", ""),
            model.get("description", ""),
            model.get("task_type", ""),
            " ".join(model.get("feature_columns", [])),
            " ".join(model.get("target_columns", [])),
            " ".join(model.get("metrics", {}).keys()),
        ]
        searchable_text = " ".join([str(item) for item in searchable_parts if item]).lower()
        score = 0
        for token in query_tokens:
            if token in searchable_text:
                score += 3
            elif token in model.get("name", "").lower():
                score += 5
        if model.get("task_type") and model["task_type"] in lowered:
            score += 4
        if score > best_score:
            best_score = score
            best_model = model
    return best_model if best_score > 0 else None


def extract_prediction_inputs(message: str, feature_columns: list[str]) -> dict[str, Any]:
    if not feature_columns:
        return {}

    candidates: list[dict[str, Any]] = []
    parsed = extract_json_object(message)
    if isinstance(parsed, dict):
        if isinstance(parsed.get("inputs"), dict):
            candidates.append(parsed["inputs"])
        candidates.append(parsed)

    pair_map: dict[str, Any] = {}
    for raw_line in message.splitlines():
        text = raw_line.strip().strip("，,;；")
        if not text:
            continue
        for separator in ("：", ":", "="):
            if separator not in text:
                continue
            key, value = text.split(separator, 1)
            key = key.strip()
            value = value.strip().strip("，,;；")
            if key:
                pair_map[key] = value
            break
    if pair_map:
        candidates.append(pair_map)

    normalized_features = {column.lower(): column for column in feature_columns}
    best: dict[str, Any] = {}
    for candidate in candidates:
        resolved: dict[str, Any] = {}
        for key, value in candidate.items():
            column = normalized_features.get(str(key).strip().lower())
            if column:
                resolved[column] = value
        if len(resolved) > len(best):
            best = resolved
    return best


def extract_search_citations(tool_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for item in tool_results:
        if item.get("name") != "search_project_kb":
            continue
        for hit in item.get("result", {}).get("hits", []):
            marker = str(hit.get("citation") or "").strip()
            doc_id = str(hit.get("doc_id") or "").strip()
            chunk_index = int(hit.get("chunk_index") or 0)
            key = (marker, doc_id, chunk_index)
            if not marker or key in seen:
                continue
            seen.add(key)
            citations.append(
                {
                    "citation": marker,
                    "doc_id": doc_id,
                    "filename": str(hit.get("filename") or ""),
                    "chunk_index": chunk_index,
                    "content": str(hit.get("content") or ""),
                    "download_url": str(hit.get("download_url") or ""),
                }
            )
    return citations


def append_citation_footer(text: str, citations: list[dict[str, Any]]) -> str:
    text = text.strip()
    if not citations:
        return text
    footer_lines = [
        f"[{item['citation']}] {item['filename']} / chunk {item['chunk_index']}"
        for item in citations[:3]
    ]
    if "引用来源" in text:
        return text
    return f"{text}\n\n引用来源：\n" + "\n".join(footer_lines)


def build_dynamic_tools(project_id: str, subproject_id: str | None) -> list[dict[str, Any]]:
    tools = [
        {
            "name": "search_project_kb",
            "description": "检索当前项目知识库。",
            "schema": {"type": "object", "properties": {"query": {"type": "string"}}},
        },
        {
            "name": "list_subprojects",
            "description": "列出当前项目下的子项目。",
            "schema": {"type": "object", "properties": {}},
        },
    ]
    if subproject_id:
        tools.append(
            {
                "name": "list_user_models",
                "description": "列出当前子项目下已注册的用户模型及描述，用于理解每个模型的适用场景。",
                "schema": {"type": "object", "properties": {}},
            }
        )
    if not subproject_id:
        return tools
    models = list_subproject_models(subproject_id)
    if models:
        tools.append(
            {
                "name": "predict_with_model",
                "description": "使用当前子项目中的指定模型，对用户提供的一条结构化输入做单次预测。若模型描述与用户问题可明确匹配，可自动选择模型。",
                "schema": {
                    "type": "object",
                    "properties": {
                        "model_id": {"type": "string", "enum": [item["id"] for item in models]},
                        "inputs": {
                            "type": "object",
                            "description": "键值对输入，键必须来自模型的 feature_columns。",
                        },
                    },
                },
                "models": [model_tool_payload(item) for item in models],
            }
        )
    tools.append(
        {
            "name": "batch_predict_with_file",
            "description": "使用当前子项目中的指定模型，对会话附件里的表格文件做批量推理。",
            "schema": {
                "type": "object",
                "properties": {
                    "attachment_id": {"type": "string", "description": "会话附件 ID"},
                    "model_id": {"type": "string", "enum": [item["id"] for item in models]},
                },
            },
            "models": [model_tool_payload(item) for item in models],
        }
    )
    return tools


def build_session_tool_catalog(
    session_id: str,
    project_id: str,
    subproject_id: str | None,
    attachment_ids: list[str] | None = None,
) -> dict[str, Any]:
    attachments, active_attachment = resolve_turn_attachments(session_id, attachment_ids)
    models = list_subproject_models(subproject_id) if subproject_id else []
    subprojects = list_project_subprojects(project_id)
    tools: list[dict[str, Any]] = [
        {
            "name": "search_project_kb",
            "description": "检索当前项目知识库。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "检索问题或关键词"}},
                "required": ["query"],
            },
        },
        {
            "name": "list_subprojects",
            "description": "列出当前项目下的子项目及其统计信息。",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "list_session_attachments",
            "description": "列出当前会话已上传的附件文件。",
            "parameters": {"type": "object", "properties": {}},
        },
    ]
    if attachments:
        tools.append(
            {
                "name": "preview_attachment",
                "description": "查看某个会话附件的列结构、行数与前几行。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "attachment_id": {
                            "type": "string",
                            "enum": [item["id"] for item in attachments],
                            "description": "附件 ID；如未提供，默认使用最近上传的附件。",
                        }
                    },
                },
            }
        )
    if subproject_id:
        tools.append(
            {
                "name": "list_user_models",
                "description": "列出当前子项目下可用的用户模型及描述。",
                "parameters": {"type": "object", "properties": {}},
            }
        )
    if subproject_id and models:
        tools.append(
            {
                "name": "predict_with_model",
                "description": "使用当前子项目模型，对一条结构化输入做单次预测。多模型时应优先依据模型描述、输入字段、输出目标选择最合适的模型。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "model_id": {
                            "type": "string",
                            "enum": [item["id"] for item in models],
                            "description": "模型 ID；如只存在一个模型，或能根据用户问题与模型描述明确匹配，可省略。",
                        },
                        "inputs": {
                            "type": "object",
                            "description": "键值对输入；键必须匹配模型 feature_columns。",
                        },
                    },
                    "required": ["inputs"],
                },
            }
        )
    if subproject_id and attachments and models:
        tools.append(
            {
                "name": "batch_predict_with_file",
                "description": "使用模型对表格附件做批量预测。多模型时应优先依据模型描述、字段语义和用户意图选择模型。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "model_id": {
                            "type": "string",
                            "enum": [item["id"] for item in models],
                            "description": "模型 ID；如只存在一个模型，或能根据用户问题与模型描述明确匹配，可省略。",
                        },
                        "attachment_id": {
                            "type": "string",
                            "enum": [item["id"] for item in attachments],
                            "description": "附件 ID；如未提供，默认使用最近附件。",
                        },
                    },
                },
            }
        )
    return {
        "tools": tools,
        "attachments": attachments,
        "active_attachment": active_attachment,
        "models": models,
        "subprojects": subprojects,
    }


def heuristic_tool_plan(
    message: str,
    project_id: str,
    subproject_id: str | None,
    session_id: str,
    attachment_ids: list[str] | None = None,
) -> dict[str, Any]:
    catalog = build_session_tool_catalog(session_id, project_id, subproject_id, attachment_ids)
    attachments = catalog["attachments"]
    models = catalog["models"]
    plan: list[dict[str, Any]] = []
    lowered = message.lower()

    if any(token in message for token in ("知识", "文档", "检索", "标准", "规范")):
        plan.append({"name": "search_project_kb", "arguments": {"query": message}})
    if attachments and any(token in message for token in ("预览", "校验", "列", "数据")):
        plan.append({"name": "preview_attachment", "arguments": {"attachment_id": attachments[0]["id"]}})
    wants_prediction = any(token in lowered for token in ("predict", "batch", "forecast")) or any(
        token in message for token in ("预测", "推理")
    )
    wants_batch = any(token in lowered for token in ("batch", "csv", "excel", "sheet")) or any(
        token in message for token in ("批量", "附件", "文件", "表格")
    )
    if subproject_id and models and wants_prediction:
        selected_model = resolve_model_for_message(models, message)
        extracted_inputs = extract_prediction_inputs(message, (selected_model or models[0]).get("feature_columns", []))
        if extracted_inputs and not wants_batch:
            arguments: dict[str, Any] = {"inputs": extracted_inputs}
            if selected_model:
                arguments["model_id"] = selected_model["id"]
            plan.append({"name": "predict_with_model", "arguments": arguments})
        elif attachments:
            arguments = {"attachment_id": attachments[0]["id"]}
            if selected_model:
                arguments["model_id"] = selected_model["id"]
            elif len(models) == 1:
                arguments["model_id"] = models[0]["id"]
            plan.append({"name": "batch_predict_with_file", "arguments": arguments})
    if not plan and "子项目" in message:
        plan.append({"name": "list_subprojects", "arguments": {}})
    return {"assistant_message": "", "tool_calls": plan[:4]}


def invoke_tool(
    session_id: str,
    project_id: str,
    subproject_id: str | None,
    tool_name: str,
    arguments: dict[str, Any],
    user_message: str = "",
    attachment_ids: list[str] | None = None,
) -> dict[str, Any]:
    attachments, latest_attachment_item = resolve_turn_attachments(session_id, attachment_ids)
    models = list_subproject_models(subproject_id) if subproject_id else []

    if tool_name == "search_project_kb":
        query = str(arguments.get("query") or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="search_project_kb requires a query.")
        return {"hits": search_project_knowledge(project_id, query, limit=5)}

    if tool_name == "list_subprojects":
        return {"subprojects": list_project_subprojects(project_id)}

    if tool_name == "list_session_attachments":
        return {"attachments": attachments}

    if tool_name == "list_user_models":
        if not subproject_id:
            raise HTTPException(status_code=400, detail="No subproject is bound for this session.")
        return {"models": models}

    if tool_name == "predict_with_model":
        if not subproject_id:
            raise HTTPException(status_code=400, detail="No subproject is bound for this session.")
        model_id = str(arguments.get("model_id") or "")
        if not model_id and len(models) == 1:
            model_id = models[0]["id"]
        if not model_id:
            matched_model = resolve_model_for_message(models, user_message)
            if matched_model:
                model_id = matched_model["id"]
        if not model_id:
            raise HTTPException(status_code=400, detail="predict_with_model requires model_id when multiple models exist.")
        inputs = arguments.get("inputs") if isinstance(arguments.get("inputs"), dict) else {}
        if not inputs:
            raise HTTPException(status_code=400, detail="predict_with_model requires structured inputs.")
        model = next((item for item in models if item["id"] == model_id), None)
        prediction = perform_single_prediction(model_id, inputs)
        return {"model": model_tool_payload(model) if model else {"id": model_id}, "prediction": prediction}

    if tool_name == "preview_attachment":
        attachment_id = str(arguments.get("attachment_id") or latest_attachment_item["id"] if latest_attachment_item else "")
        if not attachment_id:
            raise HTTPException(status_code=400, detail="No attachment is available for preview.")
        attachment = next((item for item in attachments if item["id"] == attachment_id), None)
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment not found.")
        df = read_table(absolute_from_data(attachment["stored_path"]))
        return {"attachment": attachment, "preview": dataframe_preview(df)}

    if tool_name == "batch_predict_with_file":
        if not subproject_id:
            raise HTTPException(status_code=400, detail="No subproject is bound for this session.")
        attachment_id = str(arguments.get("attachment_id") or latest_attachment_item["id"] if latest_attachment_item else "")
        attachment = next((item for item in attachments if item["id"] == attachment_id), None)
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment not found for prediction.")
        model_id = str(arguments.get("model_id") or "")
        if not model_id and len(models) == 1:
            model_id = models[0]["id"]
        if not model_id:
            matched_model = resolve_model_for_message(models, user_message)
            if matched_model:
                model_id = matched_model["id"]
        if not model_id:
            raise HTTPException(status_code=400, detail="batch_predict_with_file requires model_id when multiple models exist.")
        prediction = perform_batch_prediction(
            model_id,
            absolute_from_data(attachment["stored_path"]),
            f"agent_{session_id}_{uuid.uuid4().hex[:6]}",
        )
        return {"attachment": attachment, "prediction": prediction}

    raise HTTPException(status_code=404, detail=f"Unsupported tool: {tool_name}")


def plan_with_llm(
    session_id: str,
    project_id: str,
    subproject_id: str | None,
    user_message: str,
    attachment_ids: list[str] | None = None,
) -> dict[str, Any]:
    config = load_agent_settings()
    catalog = build_session_tool_catalog(session_id, project_id, subproject_id, attachment_ids)
    client = build_openai_client(config)
    payload = {
        "context": {
            "project_id": project_id,
            "subproject_id": subproject_id,
            "attachment_count": len(catalog["attachments"]),
            "model_count": len(catalog["models"]),
            "active_attachment_id": catalog["active_attachment"]["id"] if catalog["active_attachment"] else None,
        },
        "available_tools": catalog["tools"],
        "attachments": [{"id": item["id"], "filename": item["filename"], "columns": item["columns"]} for item in catalog["attachments"]],
        "models": [model_tool_payload(item) for item in catalog["models"]],
        "user_message": user_message,
        "instruction": "返回 JSON 对象，格式为 {assistant_message: string, tool_calls: [{name: string, arguments: object}] }。不要输出 Markdown。tool_calls 最多 4 个。",
    }
    response = client.chat.completions.create(
        model=config["model"],
        messages=[
            {
                "role": "system",
                "content": f"{config['system_prompt']}\n你当前负责决定是否要调用工具。必须输出 JSON 对象。",
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        temperature=min(config["temperature"], 0.3),
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    plan = extract_json_object(content)
    tool_names = {tool["name"] for tool in catalog["tools"]}
    normalized_calls: list[dict[str, Any]] = []
    for item in plan.get("tool_calls", [])[:4]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if name not in tool_names:
            continue
        arguments = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
        normalized_calls.append({"name": name, "arguments": arguments})
    return {
        "assistant_message": str(plan.get("assistant_message") or "").strip(),
        "tool_calls": normalized_calls,
        "raw": content,
    }


def summarize_with_llm(
    user_message: str,
    project_name: str,
    subproject_name: str | None,
    tool_results: list[dict[str, Any]],
) -> str:
    config = load_agent_settings()
    client = build_openai_client(config)
    citations = extract_search_citations(tool_results)
    response = client.chat.completions.create(
        model=config["model"],
        messages=[
            {
                "role": "system",
                "content": (
                    f"{config['system_prompt']}\n"
                    "你现在负责根据工具结果输出最终答复。回答风格要简洁，先结论后细节。"
                    "如果引用知识库内容，必须只使用提供的 citation 标记，例如 [S1]、[S2]；"
                    "没有依据时不要虚构引用。若存在工具调用结果，用一句话概括每个关键结果。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "project": project_name,
                        "subproject": subproject_name or "未绑定子项目",
                        "user_message": user_message,
                        "tool_results": tool_results,
                        "citation_candidates": [
                            {
                                "citation": item["citation"],
                                "filename": item["filename"],
                                "chunk_index": item["chunk_index"],
                                "excerpt": item["content"][:180],
                            }
                            for item in citations
                        ],
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        temperature=config["temperature"],
    )
    return append_citation_footer((response.choices[0].message.content or "").strip(), citations)


def create_message(session_id: str, role: str, content: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    message_id = make_id("msg")
    created_at = now_iso()
    execute(
        """
        INSERT INTO agent_messages (id, session_id, role, content, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (message_id, session_id, role, content, json.dumps(metadata or {}, ensure_ascii=False), created_at),
    )
    row = fetch_one("SELECT * FROM agent_messages WHERE id = ?", (message_id,))
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create message.")
    execute("UPDATE agent_sessions SET updated_at = ? WHERE id = ?", (created_at, session_id))
    return serialize_message(row)


def sse_payload(event_type: str, payload: dict[str, Any]) -> str:
    return f"data: {json.dumps({'type': event_type, 'payload': payload}, ensure_ascii=False)}\n\n"


def latest_attachment(session_id: str) -> dict[str, Any] | None:
    row = fetch_one("SELECT * FROM session_attachments WHERE session_id = ? ORDER BY created_at DESC LIMIT 1", (session_id,))
    return serialize_attachment(row) if row else None


def resolve_turn_attachments(session_id: str, attachment_ids: list[str] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    all_attachments = list_session_attachment_models(session_id)
    if not attachment_ids:
        return all_attachments, (all_attachments[0] if all_attachments else None)

    requested_ids = {str(item) for item in attachment_ids if str(item).strip()}
    prioritized = [item for item in all_attachments if item["id"] in requested_ids]
    remaining = [item for item in all_attachments if item["id"] not in requested_ids]
    ordered = prioritized + remaining
    return ordered, (prioritized[0] if prioritized else (ordered[0] if ordered else None))


def fallback_summary(
    message: str,
    project_name: str,
    subproject_name: str | None,
    attachment: dict[str, Any] | None,
    tool_results: list[dict[str, Any]],
) -> str:
    if not tool_results:
        attachment_hint = f"当前会话最近附件为 `{attachment['filename']}`。" if attachment else "当前会话没有附件。"
        return (
            f"当前上下文为项目 `{project_name}`，子项目 `{subproject_name or '未绑定'}`。"
            f"{attachment_hint} 你可以让我检索知识库、预览附件、列出模型，或在绑定子项目后调用模型做批量预测。"
        )

    citations = extract_search_citations(tool_results)
    summaries: list[str] = []
    for item in tool_results:
        name = item["name"]
        result = item["result"]
        if name == "search_project_kb":
            hits = result.get("hits", [])
            if hits:
                top_hits = hits[:3]
                summaries.append(
                    "知识库结论："
                    + "；".join(
                        [f"{hit['content'][:70]}... [{hit['citation']}]" for hit in top_hits]
                    )
                )
            else:
                summaries.append("知识库未命中相关片段。")
        elif name == "preview_attachment":
            preview = result.get("preview", {})
            summaries.append(
                f"附件预览：{preview.get('row_count', 0)} 行，{preview.get('column_count', 0)} 列，列名为 {', '.join(preview.get('columns', []))}。"
            )
        elif name == "batch_predict_with_file":
            prediction = result.get("prediction", {})
            summaries.append(
                f"批量预测完成，共处理 {prediction.get('row_count', 0)} 行。结果文件：{prediction.get('result_file_url', '')}"
            )
        elif name == "predict_with_model":
            prediction = result.get("prediction", {})
            prediction_values = prediction.get("prediction", {})
            model_name = result.get("model", {}).get("name") or prediction.get("model_id", "模型")
            summaries.append(
                f"单次预测完成，使用 {model_name} 输出："
                + "，".join([f"{key}={value}" for key, value in prediction_values.items()])
            )
        elif name == "list_user_models":
            models = result.get("models", [])
            summaries.append("当前子项目模型：" + ", ".join([model["name"] for model in models]) if models else "当前子项目暂无模型。")
        elif name == "list_subprojects":
            subprojects = result.get("subprojects", [])
            summaries.append("当前项目子项目：" + ", ".join([sub["name"] for sub in subprojects]) if subprojects else "当前项目暂无子项目。")
        elif name == "list_session_attachments":
            attachments = result.get("attachments", [])
            summaries.append("当前会话附件：" + ", ".join([att["filename"] for att in attachments]) if attachments else "当前会话暂无附件。")
    return append_citation_footer("\n\n".join([summary for summary in summaries if summary]), citations)


def stream_text_chunks(text: str):
    for chunk in textwrap.wrap(text, width=32, break_long_words=False, break_on_hyphens=False):
        yield chunk
        time.sleep(0.03)


def stream_agent_turn(session_id: str, message: str, attachment_ids: list[str] | None = None):
    session_row = fetch_one("SELECT * FROM agent_sessions WHERE id = ?", (session_id,))
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found.")
    session = dict(session_row)
    attachments, attachment = resolve_turn_attachments(session_id, attachment_ids)
    requested_ids = {str(value) for value in (attachment_ids or []) if str(value).strip()}
    bound_attachments = [item for item in attachments if item["id"] in requested_ids]
    create_message(
        session_id,
        "user",
        message,
        metadata={
            "attachments": [
                {
                    "id": item["id"],
                    "filename": item["filename"],
                    "download_url": item["download_url"],
                    "is_image": item["is_image"],
                    "size_bytes": item["size_bytes"],
                }
                for item in bound_attachments
            ]
        },
    )

    project = fetch_one("SELECT * FROM projects WHERE id = ?", (session["project_id"],))
    subproject = fetch_one("SELECT * FROM subprojects WHERE id = ?", (session["subproject_id"],)) if session["subproject_id"] else None

    events: list[dict[str, Any]] = []
    tool_results: list[dict[str, Any]] = []

    def emit(event_type: str, payload: dict[str, Any]) -> str:
        events.append({"type": event_type, "payload": payload})
        return sse_payload(event_type, payload)

    yield emit(
        "context",
        {
            "project": project["name"] if project else "Unknown",
            "subproject": subproject["name"] if subproject else "未绑定子项目",
            "attachment": attachment["filename"] if attachment else None,
            "attachment_ids": [item["id"] for item in bound_attachments],
        },
    )

    config = load_agent_settings()
    yield emit("agent_mode", {"mode": config["runtime_mode"], "model": config["model"] or "local-fallback"})

    try:
        if config["runtime_mode"] == "llm":
            plan = plan_with_llm(session_id, session["project_id"], session["subproject_id"] or None, message, attachment_ids)
            yield emit("terminal_stdout", {"text": f"[planner] using upstream model {config['model']}"})
            yield emit("tool_plan", {"assistant_message": plan["assistant_message"], "tool_calls": plan["tool_calls"]})
        else:
            plan = heuristic_tool_plan(message, session["project_id"], session["subproject_id"] or None, session_id, attachment_ids)
            yield emit("terminal_stdout", {"text": "[planner] using local fallback planner"})
            yield emit("tool_plan", plan)
    except Exception as exc:  # noqa: BLE001
        plan = heuristic_tool_plan(message, session["project_id"], session["subproject_id"] or None, session_id, attachment_ids)
        yield emit("terminal_stdout", {"text": f"[planner_fallback] {exc}"})
        yield emit("tool_plan", plan)

    for tool_call in plan.get("tool_calls", []):
        started_at = time.perf_counter()
        try:
            yield emit("tool_start", {"tool": tool_call["name"], "arguments": tool_call.get("arguments", {})})
            result = invoke_tool(
                session_id,
                session["project_id"],
                session["subproject_id"] or None,
                tool_call["name"],
                tool_call.get("arguments", {}),
                message,
                attachment_ids,
            )
            duration = int((time.perf_counter() - started_at) * 1000)
            tool_payload = {"tool": tool_call["name"], "status": "success", "duration_ms": duration, "result": result}
            tool_results.append({"name": tool_call["name"], "result": result})
            yield emit("terminal_stdout", {"text": f"[tool] {tool_call['name']} succeeded in {duration}ms"})
            if tool_call["name"] == "batch_predict_with_file" and result.get("prediction", {}).get("result_file_url"):
                yield emit(
                    "file_ready",
                    {
                        "file_url": result["prediction"]["result_file_url"],
                        "row_count": result["prediction"]["row_count"],
                    },
                )
            yield emit("tool_result", tool_payload)
        except Exception as exc:  # noqa: BLE001
            duration = int((time.perf_counter() - started_at) * 1000)
            yield emit("terminal_stdout", {"text": f"[tool_error] {tool_call['name']} -> {exc}"})
            yield emit(
                "tool_result",
                {"tool": tool_call["name"], "status": "failed", "duration_ms": duration, "error": str(exc)},
            )

    try:
        if config["runtime_mode"] == "llm":
            full_text = summarize_with_llm(
                message,
                project["name"] if project else "Unknown",
                subproject["name"] if subproject else None,
                tool_results,
            )
        else:
            full_text = fallback_summary(
                message,
                project["name"] if project else "Unknown",
                subproject["name"] if subproject else None,
                attachment,
                tool_results,
            )
    except Exception as exc:  # noqa: BLE001
        yield emit("terminal_stdout", {"text": f"[summary_fallback] {exc}"})
        full_text = fallback_summary(
            message,
            project["name"] if project else "Unknown",
            subproject["name"] if subproject else None,
            attachment,
            tool_results,
        )

    for chunk in stream_text_chunks(full_text):
        yield emit("message_delta", {"delta": chunk})

    create_message(session_id, "assistant", full_text, metadata={"events": events})
    yield emit("done", {"message": full_text})


def build_programmatic_reply(model: str, message: str, metadata: dict[str, Any] | None = None) -> str:
    metadata = metadata or {}
    blocks = [f"Model `{model}` 已接收请求。"]
    project_id = metadata.get("project_id")
    hits: list[dict[str, Any]] = []
    if project_id:
        hits = search_project_knowledge(project_id, message, limit=3)
        if hits:
            blocks.append("基于项目知识库的摘要：")
            blocks.extend([f"- [{item['citation']}] {item['filename']} / chunk {item['chunk_index']}: {item['content'][:120]}..." for item in hits])
        else:
            blocks.append("当前项目知识库没有命中相关片段。")
    else:
        blocks.append("这是 OpenAI 兼容入口的基础回复；如需绑定项目上下文，可在 metadata 中附带 project_id / subproject_id。")
    blocks.append(f"用户消息摘要：{message[:300]}")
    return append_citation_footer("\n".join(blocks), hits)


def openai_completion_payload(model: str, content: str) -> dict[str, Any]:
    prompt_tokens = max(1, len(content) // 4)
    completion_tokens = max(1, len(content) // 5)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }
