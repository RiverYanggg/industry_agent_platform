"""Model templates, training runs, predictions, and chart artifacts."""
from __future__ import annotations

import json
import math
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import matplotlib

matplotlib.use("Agg")
import numpy as np
import pandas as pd
from fastapi import HTTPException
from matplotlib import pyplot as plt
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from server.config import GENERATED_DIR, MODEL_DIR
from server.db import execute, fetch_one
from server.serialize import serialize_artifact, serialize_dataset, serialize_model, serialize_run
from server.utils import absolute_from_data, dataframe_preview, now_iso, read_table, relative_to_data
from server.utils import make_id


def build_model_templates() -> dict[str, dict[str, Any]]:
    return {
        "linear_regression": {
            "template_id": "linear_regression",
            "name": "Linear Regression",
            "task_type": "regression",
            "resource": "CPU",
            "input_type": "tabular",
            "supports_multi_output": True,
            "description": "适合连续值预测的轻量回归基线模型。",
            "highlights": ["线性可解释", "训练速度快", "适合基线建模"],
            "schema": {
                "fit_intercept": {"type": "boolean", "default": True},
                "positive": {"type": "boolean", "default": False},
            },
            "factory": lambda params: LinearRegression(
                fit_intercept=bool(params.get("fit_intercept", True)),
                positive=bool(params.get("positive", False)),
            ),
        },
        "random_forest_regression": {
            "template_id": "random_forest_regression",
            "name": "Random Forest Regressor",
            "task_type": "regression",
            "resource": "CPU",
            "input_type": "tabular",
            "supports_multi_output": True,
            "description": "适合非线性表格回归任务的随机森林模型。",
            "highlights": ["非线性拟合能力强", "对异常值较稳健", "适合工艺回归"],
            "schema": {
                "n_estimators": {"type": "integer", "default": 200},
                "max_depth": {"type": "integer", "default": 8},
            },
            "factory": lambda params: RandomForestRegressor(
                n_estimators=int(params.get("n_estimators", 200)),
                max_depth=int(params.get("max_depth", 8)) if params.get("max_depth") else None,
                random_state=42,
            ),
        },
        "logistic_regression": {
            "template_id": "logistic_regression",
            "name": "Logistic Regression",
            "task_type": "classification",
            "resource": "CPU",
            "input_type": "tabular",
            "supports_multi_output": False,
            "description": "适合二分类与多分类的线性基线模型。",
            "highlights": ["决策边界清晰", "适合分类基线", "参数较少"],
            "schema": {
                "max_iter": {"type": "integer", "default": 500},
                "C": {"type": "number", "default": 1.0},
            },
            "factory": lambda params: LogisticRegression(
                max_iter=int(params.get("max_iter", 500)),
                C=float(params.get("C", 1.0)),
            ),
        },
        "random_forest_classification": {
            "template_id": "random_forest_classification",
            "name": "Random Forest Classifier",
            "task_type": "classification",
            "resource": "CPU",
            "input_type": "tabular",
            "supports_multi_output": False,
            "description": "适合非线性表格分类任务的随机森林模型。",
            "highlights": ["非线性分类", "特征鲁棒", "适合中小规模表格数据"],
            "schema": {
                "n_estimators": {"type": "integer", "default": 200},
                "max_depth": {"type": "integer", "default": 8},
            },
            "factory": lambda params: RandomForestClassifier(
                n_estimators=int(params.get("n_estimators", 200)),
                max_depth=int(params.get("max_depth", 8)) if params.get("max_depth") else None,
                random_state=42,
            ),
        },
    }


MODEL_TEMPLATES = build_model_templates()


def get_template(template_id: str) -> dict[str, Any]:
    template = MODEL_TEMPLATES.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail=f"Unknown template: {template_id}")
    return template


def build_pipeline(df: pd.DataFrame, feature_columns: list[str], estimator: Any) -> Pipeline:
    numeric_features = [column for column in feature_columns if pd.api.types.is_numeric_dtype(df[column])]
    categorical_features = [column for column in feature_columns if column not in numeric_features]

    transformers: list[tuple[str, Any, list[str]]] = []
    if numeric_features:
        transformers.append(("num", SimpleImputer(strategy="median"), numeric_features))
    if categorical_features:
        transformers.append(
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_features,
            )
        )

    if not transformers:
        raise HTTPException(status_code=400, detail="No usable feature columns were supplied.")

    preprocessor = ColumnTransformer(transformers=transformers)
    return Pipeline(steps=[("preprocessor", preprocessor), ("model", estimator)])


def create_artifact_record(
    subproject_id: str,
    stored_path: Path,
    title: str,
    artifact_type: str,
    description: str,
    run_id: str = "",
) -> dict[str, Any]:
    artifact_id = make_id("artifact")
    created_at = now_iso()
    execute(
        """
        INSERT INTO artifacts (id, subproject_id, run_id, title, type, description, stored_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            artifact_id,
            subproject_id,
            run_id,
            title,
            artifact_type,
            description,
            relative_to_data(stored_path),
            created_at,
        ),
    )
    row = fetch_one("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    return serialize_artifact(row) if row else {}


def generate_artifact(subproject_id: str, run_id: str, task_type: str, y_true: pd.Series, y_pred: Any, title: str = "训练评估图") -> dict[str, Any]:
    artifact_dir = GENERATED_DIR / "artifacts" / subproject_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / f"{make_id('artifact_plot')}.png"

    fig, ax = plt.subplots(figsize=(6, 4))
    if task_type == "regression":
        ax.scatter(y_true, y_pred, c="#38bdf8", edgecolors="#0f172a", alpha=0.8)
        line_min = min(float(pd.Series(y_true).min()), float(pd.Series(y_pred).min()))
        line_max = max(float(pd.Series(y_true).max()), float(pd.Series(y_pred).max()))
        ax.plot([line_min, line_max], [line_min, line_max], "--", color="#f59e0b")
        ax.set_title(title, color="#e8eaed")
        ax.set_xlabel("Actual")
        ax.set_ylabel("Predicted")
    else:
        ConfusionMatrixDisplay.from_predictions(y_true, y_pred, ax=ax, cmap="Blues", colorbar=False)
        ax.set_title(title, color="#e8eaed")

    fig.patch.set_facecolor("#161a20")
    ax.set_facecolor("#161a20")
    for spine in ax.spines.values():
        spine.set_color("#334155")
    ax.tick_params(colors="#cbd5e1")
    plt.tight_layout()
    fig.savefig(artifact_path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)
    return create_artifact_record(subproject_id, artifact_path, title, "evaluation", "由训练运行自动生成的评估图像。", run_id=run_id)


def generate_dataset_artifacts(subproject_id: str, df: pd.DataFrame) -> list[dict[str, Any]]:
    artifact_dir = GENERATED_DIR / "artifacts" / subproject_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    created: list[dict[str, Any]] = []
    numeric_df = df.select_dtypes(include="number")

    if numeric_df.shape[1] >= 2:
        corr_path = artifact_dir / f"{make_id('corr')}.png"
        corr = numeric_df.corr(numeric_only=True)
        fig, ax = plt.subplots(figsize=(7, 5))
        im = ax.imshow(corr.values, cmap="YlGnBu", aspect="auto")
        ax.set_xticks(range(len(corr.columns)))
        ax.set_xticklabels(corr.columns, rotation=45, ha="right", fontsize=8, color="#e2e8f0")
        ax.set_yticks(range(len(corr.index)))
        ax.set_yticklabels(corr.index, fontsize=8, color="#e2e8f0")
        ax.set_title("Correlation Heatmap", color="#e8eaed")
        fig.colorbar(im, ax=ax, fraction=0.045, pad=0.04)
        fig.patch.set_facecolor("#161a20")
        ax.set_facecolor("#161a20")
        plt.tight_layout()
        fig.savefig(corr_path, dpi=160, facecolor=fig.get_facecolor())
        plt.close(fig)
        created.append(create_artifact_record(subproject_id, corr_path, "相关性热力图", "correlation", "根据当前数据集自动生成的数值列相关性热力图。"))

    if numeric_df.shape[1] >= 1:
        profile_path = artifact_dir / f"{make_id('profile')}.png"
        selected = numeric_df.iloc[:, : min(4, numeric_df.shape[1])]
        fig, axes = plt.subplots(len(selected.columns), 1, figsize=(7, max(3.2, len(selected.columns) * 2.1)))
        if not isinstance(axes, (list, tuple, np.ndarray)):
            axes = [axes]
        for axis, column in zip(axes, selected.columns):
            axis.hist(selected[column].dropna(), bins=12, color="#38bdf8", edgecolor="#0f172a", alpha=0.85)
            axis.set_title(f"{column} distribution", color="#e8eaed", fontsize=10)
            axis.set_facecolor("#161a20")
            axis.tick_params(colors="#cbd5e1", labelsize=8)
        fig.patch.set_facecolor("#161a20")
        plt.tight_layout()
        fig.savefig(profile_path, dpi=160, facecolor=fig.get_facecolor())
        plt.close(fig)
        created.append(create_artifact_record(subproject_id, profile_path, "数值分布概览", "eda", "根据当前数据集自动生成的数值分布概览图。"))
    return created


def train_run(run_id: str) -> None:
    row = fetch_one("SELECT * FROM runs WHERE id = ?", (run_id,))
    if not row:
        return

    run = serialize_run(row)
    dataset_row = fetch_one("SELECT * FROM datasets WHERE id = ?", (run["dataset_id"],))
    if not dataset_row:
        execute(
            "UPDATE runs SET status = ?, error_text = ?, completed_at = ? WHERE id = ?",
            ("failed", "Dataset not found.", now_iso(), run_id),
        )
        return

    execute("UPDATE runs SET status = ?, log_text = ? WHERE id = ?", ("running", "Loading dataset...", run_id))

    try:
        dataset = serialize_dataset(dataset_row)
        df = read_table(absolute_from_data(dataset["stored_path"]))
        feature_columns = run["feature_columns"]
        target_columns = run["target_columns"] or [run["target_column"]]
        missing = [column for column in feature_columns + target_columns if column not in df.columns]
        if missing:
            raise ValueError(f"Dataset is missing columns: {', '.join(missing)}")

        template = get_template(run["template_id"])
        if len(target_columns) > 1 and not template["supports_multi_output"]:
            raise ValueError(f"Template {run['template_id']} does not support multiple output targets.")
        estimator = template["factory"](run["params"])
        pipeline = build_pipeline(df, feature_columns, estimator)

        X = df[feature_columns].copy()
        y = df[target_columns].copy() if len(target_columns) > 1 else df[target_columns[0]].copy()
        stratify = y if template["task_type"] == "classification" and len(target_columns) == 1 and y.nunique() > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=float(run["params"].get("test_size", 0.2)),
            random_state=int(run["params"].get("random_state", 42)),
            stratify=stratify,
        )

        execute("UPDATE runs SET log_text = ? WHERE id = ?", ("Fitting pipeline...", run_id))
        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)

        metrics: dict[str, float] = {}
        if template["task_type"] == "regression":
            metrics = {
                "r2": round(float(r2_score(y_test, y_pred, multioutput="uniform_average")), 4),
                "mae": round(float(mean_absolute_error(y_test, y_pred)), 4),
                "rmse": round(float(math.sqrt(mean_squared_error(y_test, y_pred))), 4),
            }
        else:
            metrics = {
                "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
                "f1_macro": round(float(f1_score(y_test, y_pred, average="macro")), 4),
            }

        bundle_path = MODEL_DIR / f"{run_id}.joblib"
        joblib.dump(
            {
                "pipeline": pipeline,
                "template_id": run["template_id"],
                "task_type": template["task_type"],
                "feature_columns": feature_columns,
                "target_column": target_columns[0],
                "target_columns": target_columns,
                "metrics": metrics,
                "trained_at": now_iso(),
            },
            bundle_path,
        )
        if len(target_columns) > 1:
            primary_true = y_test[target_columns[0]] if isinstance(y_test, pd.DataFrame) else pd.Series(y_test)
            primary_pred = pd.DataFrame(y_pred, columns=target_columns)[target_columns[0]]
        else:
            primary_true = y_test if isinstance(y_test, pd.Series) else y_test[target_columns[0]]
            primary_pred = y_pred
        generate_artifact(run["subproject_id"], run_id, template["task_type"], primary_true, primary_pred)
        execute(
            """
            UPDATE runs
            SET status = ?, metrics_json = ?, model_path = ?, log_text = ?, completed_at = ?, error_text = ''
            WHERE id = ?
            """,
            (
                "succeeded",
                json.dumps(metrics, ensure_ascii=False),
                relative_to_data(bundle_path),
                "Training completed successfully.",
                now_iso(),
                run_id,
            ),
        )
        if bool(run["params"].get("auto_register_model", True)):
            generated_name = run.get("auto_model_name") or f"{run['template_id']}_{datetime.utcnow().strftime('%m%d_%H%M%S')}"
            register_model(run_id, generated_name)
    except Exception as exc:  # noqa: BLE001
        execute(
            "UPDATE runs SET status = ?, error_text = ?, completed_at = ?, log_text = ? WHERE id = ?",
            ("failed", str(exc), now_iso(), "Training failed.", run_id),
        )


def register_model(run_id: str, model_name: str) -> dict[str, Any]:
    run_row = fetch_one("SELECT * FROM runs WHERE id = ?", (run_id,))
    if not run_row:
        raise HTTPException(status_code=404, detail="Run not found.")
    run = serialize_run(run_row)
    if run["status"] != "succeeded":
        raise HTTPException(status_code=400, detail="Only succeeded runs can be registered as models.")

    existing = fetch_one("SELECT * FROM models WHERE source_run_id = ? AND name = ?", (run_id, model_name))
    if existing:
        return serialize_model(existing)

    bundle = joblib.load(absolute_from_data(run["model_path"]))
    model_id = make_id("model")
    created_at = now_iso()
    execute(
        """
        INSERT INTO models (id, subproject_id, name, source_run_id, task_type, target_column, target_columns_json, feature_columns_json, metrics_json, model_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            model_id,
            run["subproject_id"],
            model_name,
            run_id,
            bundle["task_type"],
            bundle["target_column"],
            json.dumps(bundle.get("target_columns", [bundle["target_column"]]), ensure_ascii=False),
            json.dumps(bundle["feature_columns"], ensure_ascii=False),
            json.dumps(bundle["metrics"], ensure_ascii=False),
            run["model_path"],
            created_at,
        ),
    )
    row = fetch_one("SELECT * FROM models WHERE id = ?", (model_id,))
    if not row:
        raise HTTPException(status_code=500, detail="Model registration failed.")
    return serialize_model(row)


def perform_batch_prediction(model_id: str, input_path: Path, output_stem: str) -> dict[str, Any]:
    model_row = fetch_one("SELECT * FROM models WHERE id = ?", (model_id,))
    if not model_row:
        raise HTTPException(status_code=404, detail="Model not found.")
    model = serialize_model(model_row)
    bundle = joblib.load(absolute_from_data(model["model_path"]))
    df = read_table(input_path)
    missing = [column for column in model["feature_columns"] if column not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Prediction file is missing columns: {', '.join(missing)}")

    result_df = df.copy()
    predictions = bundle["pipeline"].predict(df[model["feature_columns"]])
    target_columns = bundle.get("target_columns") or model.get("target_columns") or [model["target_column"]]
    if len(target_columns) > 1:
        prediction_frame = pd.DataFrame(predictions, columns=target_columns)
        for column in target_columns:
            result_df[f"prediction__{column}"] = prediction_frame[column]
    else:
        result_df[f"prediction__{target_columns[0]}"] = predictions

    output_dir = GENERATED_DIR / "predictions"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{output_stem}_{model_id}.csv"
    result_df.to_csv(output_path, index=False)

    return {
        "model_id": model_id,
        "result_file_url": f"/files/{relative_to_data(output_path)}",
        "row_count": int(result_df.shape[0]),
        "preview": dataframe_preview(result_df),
    }


def coerce_prediction_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text == "":
        return None
    try:
        numeric = pd.to_numeric(pd.Series([text]), errors="raise").iloc[0]
        return numeric.item() if hasattr(numeric, "item") else numeric
    except Exception:  # noqa: BLE001
        return text


def perform_single_prediction(model_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    model_row = fetch_one("SELECT * FROM models WHERE id = ?", (model_id,))
    if not model_row:
        raise HTTPException(status_code=404, detail="Model not found.")
    model = serialize_model(model_row)
    bundle = joblib.load(absolute_from_data(model["model_path"]))
    feature_columns = model["feature_columns"]
    missing = [column for column in feature_columns if column not in inputs]
    if missing:
        raise HTTPException(status_code=400, detail=f"Prediction input is missing columns: {', '.join(missing)}")
    row = {column: coerce_prediction_value(inputs.get(column)) for column in feature_columns}
    frame = pd.DataFrame([row])
    prediction = bundle["pipeline"].predict(frame[feature_columns])
    target_columns = bundle.get("target_columns") or model.get("target_columns") or [model["target_column"]]
    if len(target_columns) > 1:
        values = pd.DataFrame(prediction, columns=target_columns).iloc[0].to_dict()
    else:
        scalar = prediction[0].item() if hasattr(prediction[0], "item") else prediction[0]
        values = {target_columns[0]: scalar}
    return {"model_id": model_id, "inputs": row, "prediction": values}
