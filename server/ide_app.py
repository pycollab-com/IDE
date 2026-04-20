import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ide_store


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = (BASE_DIR / "client" / "dist") if (BASE_DIR / "client" / "dist").is_dir() else (BASE_DIR / "dist")
INDEX_FILE = FRONTEND_DIST / "index.html"
DEFAULT_PYODIDE_VERSION = "0.29.3"
DEFAULT_PYODIDE_BASE_URL = f"/vendor/pyodide/v{DEFAULT_PYODIDE_VERSION}/full/"

app = FastAPI(
    title="PyCollab IDE",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_cross_origin_isolation_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    path = request.url.path
    if path.startswith("/vendor/") or path.endswith("/pyodide.worker.js") or "/assets/pyodide.worker-" in path:
        response.headers["Cache-Control"] = "no-store"
    return response


class ProjectCreateBody(BaseModel):
    name: str
    project_type: str = ide_store.PROJECT_TYPE_NORMAL
    location_path: str


class ProjectOpenBody(BaseModel):
    folder_path: str
    project_type: Optional[str] = None


class ProjectImportBody(BaseModel):
    source_path: str
    project_type: Optional[str] = None


class ProjectUpdateBody(BaseModel):
    name: Optional[str] = None


class FileCreateBody(BaseModel):
    name: str
    content: str = ""


class FileUpdateBody(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None


class BlockDocumentCreateBody(BaseModel):
    name: str


class BlockDocumentUpdateBody(BaseModel):
    name: Optional[str] = None
    workspace_json: Optional[str] = None
    generated_entry_module: Optional[str] = None
    workspace_version: Optional[int] = None


class TaskCreateBody(BaseModel):
    content: str


class TaskUpdateBody(BaseModel):
    content: Optional[str] = None
    is_done: Optional[bool] = None
    assigned_to_user_id: Optional[int] = None


class SnapshotCreateBody(BaseModel):
    name: Optional[str] = None


class PinRecentBody(BaseModel):
    pinned: bool


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.get("/projects")
def list_projects():
    return ide_store.list_projects()


@app.get("/projects/{project_id}")
def get_project(project_id: int):
    return ide_store.get_project(project_id)


@app.patch("/projects/{project_id}")
def update_project(project_id: int, body: ProjectUpdateBody):
    return ide_store.update_project(project_id, name=body.name)


@app.post("/projects/{project_id}/files")
def add_file(project_id: int, body: FileCreateBody):
    return ide_store.add_file(project_id, name=body.name, content=body.content)


@app.patch("/projects/{project_id}/files/{file_id}")
def update_file(project_id: int, file_id: int, body: FileUpdateBody):
    return ide_store.update_file(project_id, file_id, name=body.name, content=body.content)


@app.delete("/projects/{project_id}/files/{file_id}")
def delete_file(project_id: int, file_id: int):
    return ide_store.delete_file(project_id, file_id)


@app.post("/projects/{project_id}/block-documents")
def add_block_document(project_id: int, body: BlockDocumentCreateBody):
    return ide_store.add_block_document(project_id, body.name)


@app.patch("/projects/{project_id}/block-documents/{document_id}")
def update_block_document(project_id: int, document_id: int, body: BlockDocumentUpdateBody):
    return ide_store.update_block_document(
        project_id,
        document_id,
        name=body.name,
        workspace_json=body.workspace_json,
        generated_entry_module=body.generated_entry_module,
        workspace_version=body.workspace_version,
    )


@app.delete("/projects/{project_id}/block-documents/{document_id}")
def delete_block_document(project_id: int, document_id: int):
    return ide_store.delete_block_document(project_id, document_id)


@app.get("/projects/{project_id}/tasks")
def list_tasks(project_id: int):
    return ide_store.list_tasks(project_id)


@app.post("/projects/{project_id}/tasks")
def create_task(project_id: int, body: TaskCreateBody):
    return ide_store.create_task(project_id, body.content)


@app.patch("/projects/{project_id}/tasks/{task_id}")
def update_task(project_id: int, task_id: int, body: TaskUpdateBody):
    return ide_store.update_task(project_id, task_id, body.model_dump(exclude_unset=True))


@app.delete("/projects/{project_id}/tasks/{task_id}")
def delete_task(project_id: int, task_id: int):
    return ide_store.delete_task(project_id, task_id)


@app.get("/projects/{project_id}/snapshots")
def list_snapshots(project_id: int):
    return ide_store.list_snapshots(project_id)


@app.post("/projects/{project_id}/snapshots")
def create_snapshot(project_id: int, body: SnapshotCreateBody):
    return ide_store.create_snapshot(project_id, body.name)


@app.post("/projects/{project_id}/snapshots/{snapshot_id}/restore")
def restore_snapshot(project_id: int, snapshot_id: int):
    return ide_store.restore_snapshot(project_id, snapshot_id)


@app.delete("/projects/{project_id}/snapshots/{snapshot_id}")
def delete_snapshot(project_id: int, snapshot_id: int):
    return ide_store.delete_snapshot(project_id, snapshot_id)


@app.get("/projects/{project_id}/snapshots/{snapshot_id}/export")
def export_snapshot(project_id: int, snapshot_id: int):
    payload = ide_store.export_snapshot(project_id, snapshot_id)
    response = FileResponse(payload["archive_path"], media_type="application/zip")
    response.headers["Content-Disposition"] = f'attachment; filename="{payload["download_name"]}"'
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response


@app.post("/ide/projects/create")
def ide_create_project(body: ProjectCreateBody):
    return ide_store.create_project(body.name, body.project_type, body.location_path)


@app.post("/ide/projects/open-folder")
def ide_open_project_folder(body: ProjectOpenBody):
    return ide_store.open_project_folder(body.folder_path, body.project_type)


@app.post("/ide/projects/import")
def ide_import_project(body: ProjectImportBody):
    return ide_store.import_project(body.source_path, body.project_type)


@app.get("/ide/recents")
def ide_recents():
    return ide_store.list_recent_projects()


@app.post("/ide/recents/{project_id}/pin")
def ide_pin_recent(project_id: int, body: PinRecentBody):
    return ide_store.pin_recent_project(project_id, body.pinned)


@app.delete("/ide/recents/{project_id}")
def ide_remove_recent(project_id: int):
    return ide_store.remove_recent_project(project_id)


@app.get("/runtime/pyodide-config")
def runtime_pyodide_config():
    version = os.getenv("PYCOLLAB_PYODIDE_VERSION", DEFAULT_PYODIDE_VERSION).strip() or DEFAULT_PYODIDE_VERSION
    base_url = os.getenv("PYCOLLAB_PYODIDE_BASE_URL", DEFAULT_PYODIDE_BASE_URL).strip() or DEFAULT_PYODIDE_BASE_URL
    return {
        "pyodide_version": version,
        "pyodide_base_url": base_url,
        "allowed_packages": [],
        "max_run_seconds": 0,
    }


def _html_response(path: Path) -> HTMLResponse:
    return HTMLResponse(path.read_text(encoding="utf-8"))


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    vendor_dir = FRONTEND_DIST / "vendor"
    if vendor_dir.is_dir():
        app.mount("/vendor", StaticFiles(directory=vendor_dir), name="vendor")

    pybricks_host_html = FRONTEND_DIST / "pybricks-blocks-host.html"
    pybricks_host_js = FRONTEND_DIST / "pybricks-blocks-host.js"

    @app.get("/pybricks-blocks-host.html")
    async def pybricks_blocks_host_page():
        return _html_response(pybricks_host_html)

    @app.get("/pybricks-blocks-host.js")
    async def pybricks_blocks_host_script():
        response = FileResponse(pybricks_host_js)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        del full_path
        return _html_response(INDEX_FILE)
