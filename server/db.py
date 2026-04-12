"""SQLite connection, schema, and low-level persistence helpers."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterable

from server.config import DB_PATH
from server.utils import now_iso


@contextmanager
def get_conn() -> Iterable[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                tags_json TEXT DEFAULT '[]',
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_docs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                mime_type TEXT DEFAULT '',
                chunk_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY(doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS subprojects (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                goal TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY,
                subproject_id TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT DEFAULT 'training',
                stored_path TEXT NOT NULL,
                file_type TEXT DEFAULT '',
                row_count INTEGER DEFAULT 0,
                columns_json TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY(subproject_id) REFERENCES subprojects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                subproject_id TEXT NOT NULL,
                dataset_id TEXT NOT NULL,
                template_id TEXT NOT NULL,
                status TEXT NOT NULL,
                target_column TEXT NOT NULL,
                feature_columns_json TEXT NOT NULL,
                params_json TEXT DEFAULT '{}',
                metrics_json TEXT DEFAULT '{}',
                model_path TEXT DEFAULT '',
                log_text TEXT DEFAULT '',
                error_text TEXT DEFAULT '',
                started_at TEXT NOT NULL,
                completed_at TEXT DEFAULT '',
                FOREIGN KEY(subproject_id) REFERENCES subprojects(id) ON DELETE CASCADE,
                FOREIGN KEY(dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS models (
                id TEXT PRIMARY KEY,
                subproject_id TEXT NOT NULL,
                name TEXT NOT NULL,
                source_run_id TEXT NOT NULL,
                task_type TEXT NOT NULL,
                target_column TEXT NOT NULL,
                feature_columns_json TEXT NOT NULL,
                metrics_json TEXT DEFAULT '{}',
                model_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(subproject_id) REFERENCES subprojects(id) ON DELETE CASCADE,
                FOREIGN KEY(source_run_id) REFERENCES runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                subproject_id TEXT NOT NULL,
                run_id TEXT DEFAULT '',
                title TEXT NOT NULL,
                type TEXT NOT NULL,
                description TEXT DEFAULT '',
                stored_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(subproject_id) REFERENCES subprojects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                project_id TEXT NOT NULL,
                subproject_id TEXT DEFAULT NULL,
                pinned INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(subproject_id) REFERENCES subprojects(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS agent_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata_json TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS session_attachments (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                file_type TEXT DEFAULT '',
                size_bytes INTEGER DEFAULT 0,
                parse_status TEXT DEFAULT 'ready',
                row_count INTEGER DEFAULT 0,
                columns_json TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        existing_run_columns = {row["name"] for row in conn.execute("PRAGMA table_info(runs)").fetchall()}
        if "target_columns_json" not in existing_run_columns:
            conn.execute("ALTER TABLE runs ADD COLUMN target_columns_json TEXT DEFAULT '[]'")
        if "auto_model_name" not in existing_run_columns:
            conn.execute("ALTER TABLE runs ADD COLUMN auto_model_name TEXT DEFAULT ''")

        existing_model_columns = {row["name"] for row in conn.execute("PRAGMA table_info(models)").fetchall()}
        if "target_columns_json" not in existing_model_columns:
            conn.execute("ALTER TABLE models ADD COLUMN target_columns_json TEXT DEFAULT '[]'")


def json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def fetch_one(query: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(query, params).fetchone()


def fetch_all(query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(query, params).fetchall()


def execute(query: str, params: tuple[Any, ...] = ()) -> None:
    with get_conn() as conn:
        conn.execute(query, params)


def set_app_settings(values: dict[str, Any]) -> None:
    timestamp = now_iso()
    with get_conn() as conn:
        for key, value in values.items():
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, json.dumps(value, ensure_ascii=False), timestamp),
            )


def load_app_settings(prefix: str | None = None) -> dict[str, Any]:
    query = "SELECT key, value FROM app_settings"
    params: tuple[Any, ...] = ()
    if prefix:
        query += " WHERE key LIKE ?"
        params = (f"{prefix}%",)
    rows = fetch_all(query, params)
    result: dict[str, Any] = {}
    for row in rows:
        result[row["key"]] = json_loads(row["value"], row["value"])
    return result


init_db()
