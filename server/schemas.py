"""Pydantic request/response models for API routes."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    status: str | None = None


class SubProjectCreate(BaseModel):
    name: str
    goal: str = ""


class SubProjectUpdate(BaseModel):
    name: str | None = None
    goal: str | None = None


class TrainingRequest(BaseModel):
    dataset_id: str
    template_id: str
    target_column: str | None = None
    target_columns: list[str] = Field(default_factory=list)
    feature_columns: list[str]
    params: dict[str, Any] = Field(default_factory=dict)
    model_name: str | None = None
    auto_register_model: bool = True


class ArtifactUpdate(BaseModel):
    title: str | None = None
    type: str | None = None
    description: str | None = None


class ModelRegisterRequest(BaseModel):
    name: str


class SinglePredictionRequest(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)


class SessionCreate(BaseModel):
    title: str | None = None
    project_id: str
    subproject_id: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    project_id: str | None = None
    subproject_id: str | None = None
    pinned: bool | None = None


class TurnRequest(BaseModel):
    message: str


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[dict[str, Any]]
    stream: bool = False
    metadata: dict[str, Any] | None = None


class AgentSettingsUpdate(BaseModel):
    enabled: bool | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    temperature: float | None = None
    system_prompt: str | None = None
