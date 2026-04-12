"""Agent sessions, attachments, tools, and streaming turns."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from server.agent_runtime import build_dynamic_tools, stream_agent_turn
from server.db import execute, fetch_all, fetch_one
from server.schemas import SessionCreate, SessionUpdate, TurnRequest
from server.serialize import serialize_attachment, serialize_message
from server.utils import make_id, now_iso, read_table, relative_to_data, save_upload

router = APIRouter()


@router.get("/agent/sessions")
def list_sessions() -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT s.*, p.name AS project_name, sp.name AS subproject_name,
               (SELECT content FROM agent_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
        FROM agent_sessions s
        JOIN projects p ON s.project_id = p.id
        LEFT JOIN subprojects sp ON s.subproject_id = sp.id
        ORDER BY s.pinned DESC, s.updated_at DESC
        """
    )
    return [dict(row) for row in rows]


@router.post("/agent/sessions")
def create_session(payload: SessionCreate) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM projects WHERE id = ?", (payload.project_id,)):
        raise HTTPException(status_code=404, detail="Project not found.")
    session_id = make_id("sess")
    timestamp = now_iso()
    title = payload.title or f"会话 {datetime.utcnow().strftime('%H:%M:%S')}"
    execute(
        """
        INSERT INTO agent_sessions (id, title, project_id, subproject_id, pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        """,
        (session_id, title, payload.project_id, payload.subproject_id or None, timestamp, timestamp),
    )
    row = fetch_one("SELECT * FROM agent_sessions WHERE id = ?", (session_id,))
    return dict(row) if row else {}


@router.get("/agent/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    row = fetch_one(
        """
        SELECT s.*, p.name AS project_name, sp.name AS subproject_name
        FROM agent_sessions s
        JOIN projects p ON s.project_id = p.id
        LEFT JOIN subprojects sp ON s.subproject_id = sp.id
        WHERE s.id = ?
        """,
        (session_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")
    session = dict(row)
    session["tools"] = build_dynamic_tools(session["project_id"], session["subproject_id"] or None)
    messages = fetch_all("SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC", (session_id,))
    attachments = fetch_all("SELECT * FROM session_attachments WHERE session_id = ? ORDER BY created_at DESC", (session_id,))
    session["messages"] = [serialize_message(item) for item in messages]
    session["attachments"] = [serialize_attachment(item) for item in attachments]
    return session


@router.patch("/agent/sessions/{session_id}")
def update_session(session_id: str, payload: SessionUpdate) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM agent_sessions WHERE id = ?", (session_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")
    current = dict(row)
    execute(
        """
        UPDATE agent_sessions
        SET title = ?, project_id = ?, subproject_id = ?, pinned = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            payload.title or current["title"],
            payload.project_id or current["project_id"],
            payload.subproject_id if payload.subproject_id is not None else current["subproject_id"],
            int(payload.pinned if payload.pinned is not None else current["pinned"]),
            now_iso(),
            session_id,
        ),
    )
    fresh = fetch_one("SELECT * FROM agent_sessions WHERE id = ?", (session_id,))
    return dict(fresh) if fresh else current


@router.delete("/agent/sessions/{session_id}")
def delete_session(session_id: str) -> dict[str, str]:
    execute("DELETE FROM agent_sessions WHERE id = ?", (session_id,))
    return {"status": "deleted", "session_id": session_id}


@router.get("/agent/sessions/{session_id}/attachments")
def list_session_attachments(session_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM session_attachments WHERE session_id = ? ORDER BY created_at DESC", (session_id,))
    return [serialize_attachment(row) for row in rows]


@router.post("/agent/sessions/{session_id}/attachments")
def upload_session_attachment(session_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM agent_sessions WHERE id = ?", (session_id,)):
        raise HTTPException(status_code=404, detail="Session not found.")
    path = save_upload("session_attachments", session_id, file)
    row_count = 0
    columns: list[str] = []
    parse_status = "ready"
    try:
        df = read_table(path)
        row_count = int(df.shape[0])
        columns = df.columns.tolist()
    except Exception:  # noqa: BLE001
        parse_status = "stored"

    attachment_id = make_id("att")
    execute(
        """
        INSERT INTO session_attachments (id, session_id, filename, stored_path, file_type, size_bytes, parse_status, row_count, columns_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            attachment_id,
            session_id,
            file.filename or path.name,
            relative_to_data(path),
            path.suffix.lower().lstrip("."),
            path.stat().st_size,
            parse_status,
            row_count,
            json.dumps(columns, ensure_ascii=False),
            now_iso(),
        ),
    )
    row = fetch_one("SELECT * FROM session_attachments WHERE id = ?", (attachment_id,))
    return serialize_attachment(row) if row else {}


@router.delete("/agent/sessions/{session_id}/attachments/{attachment_id}")
def delete_session_attachment(session_id: str, attachment_id: str) -> dict[str, str]:
    execute("DELETE FROM session_attachments WHERE id = ? AND session_id = ?", (attachment_id, session_id))
    return {"status": "deleted", "attachment_id": attachment_id}


@router.get("/agent/sessions/{session_id}/tools")
def get_session_tools(session_id: str) -> list[dict[str, Any]]:
    row = fetch_one("SELECT * FROM agent_sessions WHERE id = ?", (session_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")
    session = dict(row)
    return build_dynamic_tools(session["project_id"], session["subproject_id"] or None)


@router.post("/agent/sessions/{session_id}/turn")
def run_agent_turn(session_id: str, payload: TurnRequest) -> StreamingResponse:
    return StreamingResponse(stream_agent_turn(session_id, payload.message), media_type="text/event-stream")
