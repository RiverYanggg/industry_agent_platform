"""FastAPI application entry: mounts static files and includes domain routers."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import DATA_DIR, WEB_DIR
from server.routers import agent, misc, projects

app = FastAPI(title="Industry Agent Platform", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/files", StaticFiles(directory=str(DATA_DIR)), name="files")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

app.include_router(misc.router)
app.include_router(projects.router)
app.include_router(agent.router)


@app.get("/")
def root() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")
