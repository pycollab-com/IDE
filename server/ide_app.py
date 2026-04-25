import os
import secrets
import json
import ssl
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, HTTPException, Request
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
DESKTOP_GOOGLE_AUTH_TTL_SECONDS = 600
desktop_google_auth_sessions: Dict[str, Dict[str, Any]] = {}

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
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
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


class HostedProjectCacheBody(BaseModel):
    project: dict


class HostedProjectCopyBody(BaseModel):
    name: Optional[str] = None


class DesktopGoogleAuthCallbackBody(BaseModel):
    state: str
    result: dict


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


@app.get("/ide/asset-proxy")
def ide_asset_proxy(asset_url: str):
    parsed = urlparse(asset_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Only HTTP and HTTPS asset URLs are supported")

    request = UrlRequest(
        asset_url,
        headers={
            "User-Agent": "PyCollab IDE",
            "Accept": "image/*,*/*;q=0.8",
        },
    )

    try:
        with urlopen(request, timeout=10, context=ssl._create_unverified_context()) as upstream:
            return Response(
                content=upstream.read(),
                media_type=upstream.headers.get_content_type() or "application/octet-stream",
                headers={
                    "Cache-Control": upstream.headers.get("Cache-Control", "public, max-age=300"),
                },
            )
    except HTTPError as error:
        raise HTTPException(status_code=error.code, detail="Hosted asset request failed") from error
    except URLError as error:
        raise HTTPException(status_code=502, detail="Hosted asset could not be fetched") from error


def _cleanup_desktop_google_auth_sessions() -> None:
    now = time.time()
    expired = [
        session_id
        for session_id, payload in desktop_google_auth_sessions.items()
        if now - float(payload.get("created_at") or 0) > DESKTOP_GOOGLE_AUTH_TTL_SECONDS
    ]
    for session_id in expired:
        desktop_google_auth_sessions.pop(session_id, None)


async def _read_desktop_google_auth_callback(request: Request) -> DesktopGoogleAuthCallbackBody:
    content_type = (request.headers.get("content-type") or "").lower()

    if "application/json" in content_type:
        payload = await request.json()
    elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        raw_result = form.get("result")
        try:
            result = json.loads(str(raw_result or "null"))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail="Desktop Google auth result payload was invalid") from error

        payload = {
            "state": form.get("state"),
            "result": result,
        }
    else:
        payload = {
            "state": request.query_params.get("state"),
            "result": request.query_params.get("result"),
        }
        if isinstance(payload["result"], str):
            try:
                payload["result"] = json.loads(payload["result"])
            except json.JSONDecodeError as error:
                raise HTTPException(status_code=400, detail="Desktop Google auth result payload was invalid") from error

    try:
        return DesktopGoogleAuthCallbackBody.model_validate(payload)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Desktop Google auth callback payload was invalid") from error


def _desktop_google_auth_completed_page() -> HTMLResponse:
    return HTMLResponse(
        """
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>PyCollab IDE</title>
            <style>
              :root {
                color-scheme: dark;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              }
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                background:
                  radial-gradient(circle at top left, rgba(137, 152, 120, 0.22), transparent 36%),
                  #121113;
                color: #f7f7f2;
              }
              .card {
                width: min(92vw, 520px);
                padding: 28px;
                border-radius: 24px;
                background: rgba(18, 17, 19, 0.9);
                border: 1px solid rgba(247, 247, 242, 0.14);
                box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
              }
              .kicker {
                display: inline-flex;
                margin-bottom: 12px;
                padding: 6px 10px;
                border-radius: 999px;
                border: 1px solid rgba(137, 152, 120, 0.35);
                background: rgba(137, 152, 120, 0.12);
                color: #899878;
                font-size: 12px;
                letter-spacing: 0.12em;
                text-transform: uppercase;
              }
              h1 {
                margin: 0 0 10px;
                font-size: clamp(2rem, 6vw, 2.6rem);
                line-height: 1;
                letter-spacing: -0.05em;
              }
              p {
                margin: 0;
                color: rgba(247, 247, 242, 0.72);
                line-height: 1.6;
              }
            </style>
          </head>
          <body>
            <main class="card">
              <div class="kicker">PyCollab IDE</div>
              <h1>Sign-in complete</h1>
              <p>Return to the desktop app. You can close this browser tab.</p>
            </main>
            <script>
              window.setTimeout(() => {
                window.close();
              }, 300);
            </script>
          </body>
        </html>
        """
    )


@app.get("/projects")
def list_projects():
    return ide_store.list_projects()


@app.get("/projects/{project_id}")
def get_project(project_id: int):
    return ide_store.get_project(project_id)


@app.patch("/projects/{project_id}")
def update_project(project_id: int, body: ProjectUpdateBody):
    return ide_store.update_project(project_id, name=body.name)


@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    return ide_store.delete_project(project_id)


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


@app.post("/ide/hosted-cache/{project_id}")
def ide_cache_hosted_project(project_id: str, body: HostedProjectCacheBody):
    return ide_store.cache_hosted_project(project_id, body.project)


@app.get("/ide/hosted-cache/{project_id}")
def ide_get_hosted_project_cache(project_id: str):
    return ide_store.get_hosted_project_cache(project_id)


@app.post("/ide/hosted-cache/{project_id}/copy")
def ide_copy_hosted_project_cache(project_id: str, body: HostedProjectCopyBody):
    return ide_store.create_local_copy_from_hosted_cache(project_id, body.name)


@app.post("/ide/auth/google/desktop/start")
def ide_start_desktop_google_auth(request: Request):
    _cleanup_desktop_google_auth_sessions()
    session_id = secrets.token_urlsafe(24)
    state = secrets.token_urlsafe(24)
    callback_url = str(request.base_url).rstrip("/") + f"/ide/auth/google/desktop/{session_id}/complete"
    desktop_google_auth_sessions[session_id] = {
        "state": state,
        "created_at": time.time(),
        "result": None,
    }
    return {
        "session_id": session_id,
        "state": state,
        "callback_url": callback_url,
    }


@app.get("/ide/auth/google/desktop/{session_id}")
def ide_poll_desktop_google_auth(session_id: str):
    _cleanup_desktop_google_auth_sessions()
    session = desktop_google_auth_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Desktop Google auth session not found or expired")
    if session.get("result") is None:
        return {"status": "pending"}
    return {
        "status": "completed",
        "result": session["result"],
    }


@app.api_route("/ide/auth/google/desktop/{session_id}/complete", methods=["GET", "POST"])
async def ide_complete_desktop_google_auth(session_id: str, request: Request):
    _cleanup_desktop_google_auth_sessions()
    session = desktop_google_auth_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Desktop Google auth session not found or expired")
    body = await _read_desktop_google_auth_callback(request)
    if body.state != session.get("state"):
        raise HTTPException(status_code=400, detail="Desktop Google auth state mismatch")
    session["result"] = body.result
    session["completed_at"] = time.time()
    accepts_html = "text/html" in (request.headers.get("accept") or "").lower()
    if accepts_html:
        return _desktop_google_auth_completed_page()
    return {"status": "ok"}


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
