"""Small helpers: ids, time, uploads, tabular I/O."""
from __future__ import annotations

import os
import textwrap
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException, UploadFile
from PyPDF2 import PdfReader

from server.config import DATA_DIR, UPLOAD_DIR


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def relative_to_data(path: Path) -> str:
    return str(path.relative_to(DATA_DIR)).replace("\\", "/")


def absolute_from_data(relative_path: str) -> Path:
    return DATA_DIR / relative_path


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", ""}


def parse_tags(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def save_upload(project_scope: str, entity_id: str, file: UploadFile) -> Path:
    target_dir = UPLOAD_DIR / project_scope / entity_id
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = file.filename or f"upload_{uuid.uuid4().hex[:6]}"
    target_path = target_dir / safe_name
    target_path.write_bytes(file.file.read())
    return target_path


def read_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")


def dataframe_preview(df: pd.DataFrame, rows: int = 8) -> dict[str, Any]:
    preview_rows = df.head(rows).where(pd.notna(df.head(rows)), None).to_dict(orient="records")
    return {
        "columns": df.columns.tolist(),
        "rows": preview_rows,
        "row_count": int(df.shape[0]),
        "column_count": int(df.shape[1]),
    }


def extract_document_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    return path.read_text(encoding="utf-8", errors="ignore")


def chunk_text(content: str, chunk_size: int = 600) -> list[str]:
    collapsed = " ".join(content.split())
    if not collapsed:
        return []
    return textwrap.wrap(collapsed, width=chunk_size, break_long_words=False, break_on_hyphens=False)
