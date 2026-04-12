"""Projects, knowledge base, subprojects, datasets, training, models, artifacts."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from server.db import execute, fetch_all, fetch_one, get_conn
from server.knowledge_search import search_project_knowledge
from server.ml import (
    generate_dataset_artifacts,
    get_template,
    perform_batch_prediction,
    perform_single_prediction,
    register_model,
    train_run,
)
from server.schemas import (
    ArtifactUpdate,
    ModelRegisterRequest,
    ProjectCreate,
    ProjectUpdate,
    SinglePredictionRequest,
    SubProjectCreate,
    SubProjectUpdate,
    TrainingRequest,
)
from server.serialize import (
    serialize_artifact,
    serialize_dataset,
    serialize_doc,
    serialize_model,
    serialize_project,
    serialize_run,
    serialize_subproject,
)
from server.utils import (
    absolute_from_data,
    chunk_text,
    dataframe_preview,
    extract_document_text,
    make_id,
    now_iso,
    read_table,
    relative_to_data,
    save_upload,
)

router = APIRouter()


def _store_knowledge_doc(project_id: str, file: UploadFile) -> dict[str, Any]:
    path = save_upload("knowledge", project_id, file)
    text = extract_document_text(path)
    chunks = chunk_text(text)
    doc_id = make_id("doc")
    created_at = now_iso()
    execute(
        """
        INSERT INTO knowledge_docs (id, project_id, filename, stored_path, mime_type, chunk_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (doc_id, project_id, file.filename or path.name, relative_to_data(path), file.content_type or "", len(chunks), created_at),
    )
    with get_conn() as conn:
        for index, content in enumerate(chunks):
            conn.execute(
                """
                INSERT INTO knowledge_chunks (id, doc_id, project_id, chunk_index, content)
                VALUES (?, ?, ?, ?, ?)
                """,
                (make_id("chunk"), doc_id, project_id, index, content),
            )
    doc = fetch_one("SELECT * FROM knowledge_docs WHERE id = ?", (doc_id,))
    return serialize_doc(doc) if doc else {}


@router.get("/projects")
def list_projects() -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM projects ORDER BY updated_at DESC")
    return [serialize_project(row) for row in rows]


@router.post("/projects")
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    project_id = make_id("project")
    timestamp = now_iso()
    execute(
        """
        INSERT INTO projects (id, name, description, tags_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (project_id, payload.name, payload.description, json.dumps(payload.tags, ensure_ascii=False), "active", timestamp, timestamp),
    )
    row = fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not row:
        raise HTTPException(status_code=500, detail="Project creation failed.")
    return serialize_project(row)


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Project not found.")
    project = serialize_project(row)
    docs = fetch_all("SELECT * FROM knowledge_docs WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
    subprojects = fetch_all("SELECT * FROM subprojects WHERE project_id = ? ORDER BY updated_at DESC", (project_id,))
    project["knowledge_docs"] = [serialize_doc(item) for item in docs]
    project["subprojects"] = [serialize_subproject(item) for item in subprojects]
    return project


@router.patch("/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdate) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Project not found.")
    current = serialize_project(row)
    updated = {
        "name": payload.name or current["name"],
        "description": payload.description if payload.description is not None else current["description"],
        "tags_json": json.dumps(payload.tags if payload.tags is not None else current["tags"], ensure_ascii=False),
        "status": payload.status or current["status"],
    }
    execute(
        "UPDATE projects SET name = ?, description = ?, tags_json = ?, status = ?, updated_at = ? WHERE id = ?",
        (updated["name"], updated["description"], updated["tags_json"], updated["status"], now_iso(), project_id),
    )
    fresh = fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    return serialize_project(fresh) if fresh else current


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, str]:
    execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return {"status": "deleted", "project_id": project_id}


@router.get("/projects/{project_id}/knowledge")
def list_knowledge_docs(project_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM knowledge_docs WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
    return [serialize_doc(row) for row in rows]


@router.post("/projects/{project_id}/knowledge")
def upload_knowledge_doc(project_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    project = fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return _store_knowledge_doc(project_id, file)


@router.post("/projects/{project_id}/knowledge/batch")
def upload_knowledge_docs(project_id: str, files: list[UploadFile] = File(...)) -> list[dict[str, Any]]:
    project = fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    uploads = [file for file in files if file.filename]
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one file is required.")
    return [_store_knowledge_doc(project_id, file) for file in uploads]


@router.delete("/projects/{project_id}/knowledge/{doc_id}")
def delete_knowledge_doc(project_id: str, doc_id: str) -> dict[str, str]:
    execute("DELETE FROM knowledge_docs WHERE id = ? AND project_id = ?", (doc_id, project_id))
    return {"status": "deleted", "doc_id": doc_id}


@router.get("/projects/{project_id}/knowledge/search")
def query_knowledge(project_id: str, q: str) -> list[dict[str, Any]]:
    return search_project_knowledge(project_id, q, limit=6)


@router.get("/projects/{project_id}/subprojects")
def list_subprojects(project_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM subprojects WHERE project_id = ? ORDER BY updated_at DESC", (project_id,))
    return [serialize_subproject(row) for row in rows]


@router.post("/projects/{project_id}/subprojects")
def create_subproject(project_id: str, payload: SubProjectCreate) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM projects WHERE id = ?", (project_id,)):
        raise HTTPException(status_code=404, detail="Project not found.")
    subproject_id = make_id("sub")
    timestamp = now_iso()
    execute(
        """
        INSERT INTO subprojects (id, project_id, name, goal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (subproject_id, project_id, payload.name, payload.goal, timestamp, timestamp),
    )
    row = fetch_one("SELECT * FROM subprojects WHERE id = ?", (subproject_id,))
    return serialize_subproject(row) if row else {}


@router.get("/projects/{project_id}/subprojects/{subproject_id}")
def get_subproject(project_id: str, subproject_id: str) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM subprojects WHERE id = ? AND project_id = ?", (subproject_id, project_id))
    if not row:
        raise HTTPException(status_code=404, detail="Subproject not found.")
    subproject = serialize_subproject(row)
    datasets = fetch_all("SELECT * FROM datasets WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    runs = fetch_all("SELECT * FROM runs WHERE subproject_id = ? ORDER BY started_at DESC", (subproject_id,))
    models = fetch_all("SELECT * FROM models WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    artifacts = fetch_all("SELECT * FROM artifacts WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    subproject["datasets"] = [serialize_dataset(item) for item in datasets]
    subproject["runs"] = [serialize_run(item) for item in runs]
    subproject["models"] = [serialize_model(item) for item in models]
    subproject["artifacts"] = [serialize_artifact(item) for item in artifacts]
    return subproject


@router.delete("/projects/{project_id}/subprojects/{subproject_id}")
def delete_subproject(project_id: str, subproject_id: str) -> dict[str, str]:
    execute("DELETE FROM subprojects WHERE id = ? AND project_id = ?", (subproject_id, project_id))
    return {"status": "deleted", "subproject_id": subproject_id}


@router.patch("/projects/{project_id}/subprojects/{subproject_id}")
def update_subproject(project_id: str, subproject_id: str, payload: SubProjectUpdate) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM subprojects WHERE id = ? AND project_id = ?", (subproject_id, project_id))
    if not row:
        raise HTTPException(status_code=404, detail="Subproject not found.")
    current = serialize_subproject(row)
    execute(
        """
        UPDATE subprojects
        SET name = ?, goal = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
        """,
        (
            payload.name if payload.name is not None else current["name"],
            payload.goal if payload.goal is not None else current["goal"],
            now_iso(),
            subproject_id,
            project_id,
        ),
    )
    fresh = fetch_one("SELECT * FROM subprojects WHERE id = ?", (subproject_id,))
    return serialize_subproject(fresh) if fresh else current


@router.get("/projects/{project_id}/subprojects/{subproject_id}/data")
def list_datasets(project_id: str, subproject_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM datasets WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    return [serialize_dataset(row) for row in rows]


@router.post("/projects/{project_id}/subprojects/{subproject_id}/data")
def upload_dataset(
    project_id: str,
    subproject_id: str,
    file: UploadFile = File(...),
    kind: str = Form("training"),
) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM subprojects WHERE id = ? AND project_id = ?", (subproject_id, project_id)):
        raise HTTPException(status_code=404, detail="Subproject not found.")
    path = save_upload("datasets", subproject_id, file)
    df = read_table(path)
    dataset_id = make_id("data")
    execute(
        """
        INSERT INTO datasets (id, subproject_id, name, kind, stored_path, file_type, row_count, columns_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            subproject_id,
            file.filename or path.name,
            kind,
            relative_to_data(path),
            path.suffix.lower().lstrip("."),
            int(df.shape[0]),
            json.dumps(df.columns.tolist(), ensure_ascii=False),
            now_iso(),
        ),
    )
    generate_dataset_artifacts(subproject_id, df)
    row = fetch_one("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
    return serialize_dataset(row) if row else {}


@router.get("/projects/{project_id}/subprojects/{subproject_id}/data/{dataset_id}/preview")
def preview_dataset(project_id: str, subproject_id: str, dataset_id: str) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM datasets WHERE id = ? AND subproject_id = ?", (dataset_id, subproject_id))
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    dataset = serialize_dataset(row)
    df = read_table(absolute_from_data(dataset["stored_path"]))
    return dataframe_preview(df)


@router.post("/projects/{project_id}/subprojects/{subproject_id}/runs")
def start_training_run(project_id: str, subproject_id: str, payload: TrainingRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM subprojects WHERE id = ? AND project_id = ?", (subproject_id, project_id)):
        raise HTTPException(status_code=404, detail="Subproject not found.")
    get_template(payload.template_id)
    target_columns = payload.target_columns or ([payload.target_column] if payload.target_column else [])
    if not target_columns:
        raise HTTPException(status_code=400, detail="At least one target column is required.")
    if not payload.feature_columns:
        raise HTTPException(status_code=400, detail="At least one input feature column is required.")
    if set(target_columns) & set(payload.feature_columns):
        raise HTTPException(status_code=400, detail="Input and output columns cannot overlap.")
    run_id = make_id("run")
    params = dict(payload.params)
    params.setdefault("test_size", 0.2)
    params.setdefault("random_state", 42)
    params["auto_register_model"] = payload.auto_register_model
    execute(
        """
        INSERT INTO runs (id, subproject_id, dataset_id, template_id, status, target_column, target_columns_json, feature_columns_json, params_json, started_at, auto_model_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            subproject_id,
            payload.dataset_id,
            payload.template_id,
            "queued",
            target_columns[0],
            json.dumps(target_columns, ensure_ascii=False),
            json.dumps(payload.feature_columns, ensure_ascii=False),
            json.dumps(params, ensure_ascii=False),
            now_iso(),
            payload.model_name or "",
        ),
    )
    background_tasks.add_task(train_run, run_id)
    row = fetch_one("SELECT * FROM runs WHERE id = ?", (run_id,))
    return serialize_run(row) if row else {}


@router.get("/projects/{project_id}/subprojects/{subproject_id}/runs")
def list_runs(project_id: str, subproject_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM runs WHERE subproject_id = ? ORDER BY started_at DESC", (subproject_id,))
    return [serialize_run(row) for row in rows]


@router.post("/projects/{project_id}/subprojects/{subproject_id}/runs/{run_id}/register-model")
def register_model_endpoint(project_id: str, subproject_id: str, run_id: str, payload: ModelRegisterRequest) -> dict[str, Any]:
    model = register_model(run_id, payload.name)
    return model


@router.get("/projects/{project_id}/subprojects/{subproject_id}/models")
def list_models(project_id: str, subproject_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM models WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    return [serialize_model(row) for row in rows]


@router.delete("/projects/{project_id}/subprojects/{subproject_id}/models/{model_id}")
def delete_model(project_id: str, subproject_id: str, model_id: str) -> dict[str, str]:
    execute("DELETE FROM models WHERE id = ? AND subproject_id = ?", (model_id, subproject_id))
    return {"status": "deleted", "model_id": model_id}


@router.post("/projects/{project_id}/subprojects/{subproject_id}/models/{model_id}/batch-predict")
def batch_predict_manual(project_id: str, subproject_id: str, model_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM models WHERE id = ? AND subproject_id = ?", (model_id, subproject_id)):
        raise HTTPException(status_code=404, detail="Model not found.")
    path = save_upload("predictions", model_id, file)
    return perform_batch_prediction(model_id, path, f"manual_{uuid.uuid4().hex[:6]}")


@router.post("/projects/{project_id}/subprojects/{subproject_id}/models/{model_id}/predict")
def single_predict_manual(project_id: str, subproject_id: str, model_id: str, payload: SinglePredictionRequest) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM models WHERE id = ? AND subproject_id = ?", (model_id, subproject_id)):
        raise HTTPException(status_code=404, detail="Model not found.")
    return perform_single_prediction(model_id, payload.inputs)


@router.get("/projects/{project_id}/subprojects/{subproject_id}/artifacts")
def list_artifacts(project_id: str, subproject_id: str) -> list[dict[str, Any]]:
    rows = fetch_all("SELECT * FROM artifacts WHERE subproject_id = ? ORDER BY created_at DESC", (subproject_id,))
    return [serialize_artifact(row) for row in rows]


@router.post("/projects/{project_id}/subprojects/{subproject_id}/artifacts")
def upload_artifact(
    project_id: str,
    subproject_id: str,
    title: str = Form(...),
    type: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    if not fetch_one("SELECT * FROM subprojects WHERE id = ? AND project_id = ?", (subproject_id, project_id)):
        raise HTTPException(status_code=404, detail="Subproject not found.")
    path = save_upload("artifacts", subproject_id, file)
    artifact_id = make_id("artifact")
    execute(
        """
        INSERT INTO artifacts (id, subproject_id, run_id, title, type, description, stored_path, created_at)
        VALUES (?, ?, '', ?, ?, ?, ?, ?)
        """,
        (artifact_id, subproject_id, title, type, description, relative_to_data(path), now_iso()),
    )
    row = fetch_one("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    return serialize_artifact(row) if row else {}


@router.patch("/projects/{project_id}/subprojects/{subproject_id}/artifacts/{artifact_id}")
def update_artifact(project_id: str, subproject_id: str, artifact_id: str, payload: ArtifactUpdate) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM artifacts WHERE id = ? AND subproject_id = ?", (artifact_id, subproject_id))
    if not row:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    artifact = dict(row)
    execute(
        """
        UPDATE artifacts
        SET title = ?, type = ?, description = ?
        WHERE id = ? AND subproject_id = ?
        """,
        (
            payload.title if payload.title is not None else artifact["title"],
            payload.type if payload.type is not None else artifact["type"],
            payload.description if payload.description is not None else artifact["description"],
            artifact_id,
            subproject_id,
        ),
    )
    fresh = fetch_one("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    return serialize_artifact(fresh) if fresh else serialize_artifact(row)


@router.delete("/projects/{project_id}/subprojects/{subproject_id}/artifacts/{artifact_id}")
def delete_artifact(project_id: str, subproject_id: str, artifact_id: str) -> dict[str, str]:
    execute("DELETE FROM artifacts WHERE id = ? AND subproject_id = ?", (artifact_id, subproject_id))
    return {"status": "deleted", "artifact_id": artifact_id}
