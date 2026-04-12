"""ORM-style serializers for API responses."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from server.db import fetch_one, json_loads
from server.utils import relative_to_data


def project_stats(project_id: str) -> dict[str, int]:
    row = fetch_one(
        """
        SELECT
            (SELECT COUNT(*) FROM subprojects WHERE project_id = ?) AS subproject_count,
            (SELECT COUNT(*) FROM knowledge_docs WHERE project_id = ?) AS doc_count,
            (
                SELECT COUNT(*)
                FROM models m
                JOIN subprojects s ON m.subproject_id = s.id
                WHERE s.project_id = ?
            ) AS model_count
        """,
        (project_id, project_id, project_id),
    )
    return {
        "subproject_count": int(row["subproject_count"]) if row else 0,
        "doc_count": int(row["doc_count"]) if row else 0,
        "model_count": int(row["model_count"]) if row else 0,
    }


def serialize_project(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["tags"] = json_loads(data.pop("tags_json", "[]"), [])
    data.update(project_stats(data["id"]))
    return data


def serialize_subproject(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    stats = fetch_one(
        """
        SELECT
            (SELECT COUNT(*) FROM datasets WHERE subproject_id = ?) AS dataset_count,
            (SELECT COUNT(*) FROM runs WHERE subproject_id = ?) AS run_count,
            (SELECT COUNT(*) FROM models WHERE subproject_id = ?) AS model_count,
            (SELECT COUNT(*) FROM artifacts WHERE subproject_id = ?) AS artifact_count
        """,
        (data["id"], data["id"], data["id"], data["id"]),
    )
    data.update(
        {
            "dataset_count": int(stats["dataset_count"]) if stats else 0,
            "run_count": int(stats["run_count"]) if stats else 0,
            "model_count": int(stats["model_count"]) if stats else 0,
            "artifact_count": int(stats["artifact_count"]) if stats else 0,
        }
    )
    return data


def serialize_dataset(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["columns"] = json_loads(data.pop("columns_json", "[]"), [])
    data["download_url"] = f"/files/{data['stored_path']}"
    return data


def serialize_run(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["feature_columns"] = json_loads(data.pop("feature_columns_json", "[]"), [])
    data["target_columns"] = json_loads(data.pop("target_columns_json", "[]"), [data.get("target_column")] if data.get("target_column") else [])
    data["params"] = json_loads(data.pop("params_json", "{}"), {})
    data["metrics"] = json_loads(data.pop("metrics_json", "{}"), {})
    return data


def serialize_model(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["feature_columns"] = json_loads(data.pop("feature_columns_json", "[]"), [])
    data["target_columns"] = json_loads(data.pop("target_columns_json", "[]"), [data.get("target_column")] if data.get("target_column") else [])
    data["metrics"] = json_loads(data.pop("metrics_json", "{}"), {})
    return data


def serialize_artifact(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["download_url"] = f"/files/{data['stored_path']}"
    suffix = Path(data["stored_path"]).suffix.lower()
    data["is_image"] = suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    return data


def serialize_doc(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["download_url"] = f"/files/{data['stored_path']}"
    return data


def serialize_attachment(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["columns"] = json_loads(data.pop("columns_json", "[]"), [])
    data["download_url"] = f"/files/{data['stored_path']}"
    suffix = Path(data["stored_path"]).suffix.lower()
    data["is_image"] = suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    return data


def serialize_message(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["metadata"] = json_loads(data.pop("metadata_json", "{}"), {})
    return data
