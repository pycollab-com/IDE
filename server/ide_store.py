import datetime as dt
import json
import os
import re
import shutil
import sqlite3
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException


SCHEMA_VERSION = 1
PROJECT_TYPE_NORMAL = "normal"
PROJECT_TYPE_PYBRICKS = "pybricks"
PROJECT_TYPES = {PROJECT_TYPE_NORMAL, PROJECT_TYPE_PYBRICKS}
BLOCK_WORKSPACE_VERSION = 1
PROJECT_META_DIR_NAME = ".pycollab"
SNAPSHOT_INDEX_FILE = "index.json"
PYTHON_FILE_SUFFIX = ".py"
IGNORED_WORKSPACE_PARTS = {
    PROJECT_META_DIR_NAME,
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    "node_modules",
}

NORMAL_PROJECT_STARTER = "# main entry point\n\nprint('Hello from your new project!')\n"
PYBRICKS_PROJECT_STARTER = """from pybricks.hubs import PrimeHub
from pybricks.tools import wait

hub = PrimeHub()

while True:
    print("PyBricks project ready")
    wait(1000)
"""
PYBRICKS_BLOCKS_STARTER = json.dumps(
    {
        "blocks": {
            "languageVersion": 0,
            "blocks": [
                {
                    "type": "blockGlobalSetup",
                    "id": "pycollab-upstream-setup",
                    "x": 150,
                    "y": 100,
                    "deletable": False,
                },
                {
                    "type": "blockGlobalStart",
                    "id": "pycollab-upstream-program",
                    "x": 150,
                    "y": 300,
                    "deletable": False,
                    "next": {
                        "block": {
                            "type": "blockPrint",
                            "id": "pycollab-upstream-print",
                            "extraState": {"optionLevel": 0},
                            "inputs": {
                                "TEXT0": {
                                    "shadow": {
                                        "type": "text",
                                        "id": "pycollab-upstream-print-text",
                                        "fields": {"TEXT": "Hello, world!"},
                                    }
                                }
                            },
                        }
                    },
                },
            ],
        },
    }
)

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def project_type_label(project_type: str) -> str:
    return "PyBricks" if project_type == PROJECT_TYPE_PYBRICKS else "Normal"


def app_home() -> Path:
    raw = os.getenv("PYCOLLAB_IDE_HOME", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".pycollab-ide").resolve()


def library_home() -> Path:
    return app_home() / "library"


def catalog_db_path() -> Path:
    return app_home() / "catalog.db"


def ensure_app_home() -> None:
    library_home().mkdir(parents=True, exist_ok=True)


def _catalog_connect() -> sqlite3.Connection:
    ensure_app_home()
    conn = sqlite3.connect(catalog_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_uid TEXT NOT NULL UNIQUE,
            root_path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            project_type TEXT NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT NOT NULL
        )
        """
    )
    return conn


def _project_meta_dir(root_path: Path) -> Path:
    return root_path / PROJECT_META_DIR_NAME


def _manifest_path(root_path: Path) -> Path:
    return _project_meta_dir(root_path) / "project.json"


def _blocks_dir(root_path: Path) -> Path:
    return _project_meta_dir(root_path) / "blocks"


def _tasks_path(root_path: Path) -> Path:
    return _project_meta_dir(root_path) / "tasks.json"


def _snapshots_dir(root_path: Path) -> Path:
    return _project_meta_dir(root_path) / "snapshots"


def _snapshots_index_path(root_path: Path) -> Path:
    return _snapshots_dir(root_path) / SNAPSHOT_INDEX_FILE


def _ensure_project_dirs(root_path: Path) -> None:
    _project_meta_dir(root_path).mkdir(parents=True, exist_ok=True)
    _blocks_dir(root_path).mkdir(parents=True, exist_ok=True)
    _snapshots_dir(root_path).mkdir(parents=True, exist_ok=True)


def _normalize_project_type(project_type: Optional[str]) -> str:
    normalized = (project_type or PROJECT_TYPE_NORMAL).strip().lower()
    if normalized not in PROJECT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid project type")
    return normalized


def _safe_directory_name(value: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("-", (value or "").strip()).strip(" .-")
    return cleaned or "PyCollab Project"


def _validate_relative_path(value: str) -> str:
    normalized = str(value or "").replace("\\", "/").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="File name is required")
    if normalized.startswith("/") or "\x00" in normalized:
        raise HTTPException(status_code=400, detail="Invalid project file path")
    parts = []
    for part in normalized.split("/"):
        if not part or part == ".":
            continue
        if part == ".." or part == PROJECT_META_DIR_NAME:
            raise HTTPException(status_code=400, detail="Invalid project file path")
        parts.append(part)
    if not parts:
        raise HTTPException(status_code=400, detail="Invalid project file path")
    return "/".join(parts)


def _validate_python_file_path(value: str) -> str:
    normalized = _validate_relative_path(value)
    if not normalized.lower().endswith(PYTHON_FILE_SUFFIX):
        raise HTTPException(status_code=400, detail="Only Python files are supported")
    return normalized


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


def _is_probably_pybricks(text: str) -> bool:
    lowered = text.lower()
    return "from pybricks" in lowered or "import pybricks" in lowered


def detect_project_type(root_path: Path) -> str:
    for file_path in sorted(root_path.rglob("*.py")):
        if PROJECT_META_DIR_NAME in file_path.parts:
            continue
        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if _is_probably_pybricks(content):
            return PROJECT_TYPE_PYBRICKS
    return PROJECT_TYPE_NORMAL


def _initial_manifest(name: str, project_type: str) -> Dict[str, Any]:
    now = utc_now()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "projectId": str(uuid.uuid4()),
        "name": name,
        "projectType": project_type,
        "editorMode": "blocks" if project_type == PROJECT_TYPE_PYBRICKS else "text",
        "entryFile": "main.py",
        "entryBlockDocument": 1 if project_type == PROJECT_TYPE_PYBRICKS else None,
        "entryBlockDocumentId": 1 if project_type == PROJECT_TYPE_PYBRICKS else None,
        "createdAt": now,
        "updatedAt": now,
        "nextFileId": 1,
        "files": [],
        "nextBlockDocumentId": 1,
        "blockDocuments": [],
    }


def _ensure_manifest(root_path: Path, project_type: Optional[str] = None, name: Optional[str] = None) -> Dict[str, Any]:
    _ensure_project_dirs(root_path)
    manifest_file = _manifest_path(root_path)
    if manifest_file.exists():
        manifest = _read_json(manifest_file, {})
    else:
        resolved_type = _normalize_project_type(project_type or detect_project_type(root_path))
        manifest = _initial_manifest(name or root_path.name, resolved_type)

    manifest.setdefault("schemaVersion", SCHEMA_VERSION)
    manifest.setdefault("projectId", str(uuid.uuid4()))
    manifest["projectType"] = _normalize_project_type(project_type or manifest.get("projectType"))
    manifest["name"] = (name or manifest.get("name") or root_path.name).strip() or root_path.name
    manifest.setdefault("editorMode", "blocks" if manifest["projectType"] == PROJECT_TYPE_PYBRICKS else "text")
    manifest.setdefault("entryFile", "main.py")
    manifest.setdefault("createdAt", utc_now())
    manifest["updatedAt"] = utc_now()
    manifest.setdefault("nextFileId", 1)
    manifest.setdefault("files", [])
    manifest.setdefault("nextBlockDocumentId", 1)
    manifest.setdefault("blockDocuments", [])
    manifest.setdefault("entryBlockDocument", manifest.get("entryBlockDocumentId"))
    manifest.setdefault("entryBlockDocumentId", manifest.get("entryBlockDocument"))
    return manifest


def _iter_text_project_files(root_path: Path) -> List[str]:
    discovered: List[str] = []
    for file_path in sorted(root_path.rglob(f"*{PYTHON_FILE_SUFFIX}")):
        relative_parts = file_path.relative_to(root_path).parts
        if any(part in IGNORED_WORKSPACE_PARTS or part.startswith(".") for part in relative_parts):
            continue
        rel_path = Path(*relative_parts).as_posix()
        try:
            file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        discovered.append(rel_path)
    return discovered


def _ensure_default_project_files(root_path: Path, manifest: Dict[str, Any]) -> None:
    existing = _iter_text_project_files(root_path)
    if existing:
        return
    starter = PYBRICKS_PROJECT_STARTER if manifest["projectType"] == PROJECT_TYPE_PYBRICKS else NORMAL_PROJECT_STARTER
    (root_path / "main.py").write_text(starter, encoding="utf-8")


def _sync_manifest_file_index(root_path: Path, manifest: Dict[str, Any]) -> None:
    _ensure_default_project_files(root_path, manifest)
    existing_map = {
        _validate_relative_path(entry["path"]): int(entry["id"])
        for entry in manifest.get("files", [])
        if entry.get("path")
    }
    next_file_id = int(manifest.get("nextFileId") or 1)
    synced = []
    for rel_path in _iter_text_project_files(root_path):
        file_id = existing_map.get(rel_path)
        if file_id is None:
            file_id = next_file_id
            next_file_id += 1
        synced.append({"id": file_id, "path": rel_path})
    manifest["files"] = synced
    manifest["nextFileId"] = next_file_id
    if not any(entry["path"] == manifest.get("entryFile") for entry in synced):
        manifest["entryFile"] = "main.py" if any(entry["path"] == "main.py" for entry in synced) else (synced[0]["path"] if synced else "main.py")


def _ensure_default_block_document(root_path: Path, manifest: Dict[str, Any]) -> None:
    if manifest["projectType"] != PROJECT_TYPE_PYBRICKS:
        manifest["blockDocuments"] = []
        manifest["entryBlockDocument"] = None
        manifest["entryBlockDocumentId"] = None
        return
    if manifest.get("blockDocuments"):
        return
    document_id = int(manifest.get("nextBlockDocumentId") or 1)
    manifest["nextBlockDocumentId"] = document_id + 1
    now = utc_now()
    file_name = f"{document_id}.json"
    (_blocks_dir(root_path) / file_name).write_text(PYBRICKS_BLOCKS_STARTER, encoding="utf-8")
    manifest["blockDocuments"] = [
        {
            "id": document_id,
            "name": "Blocks",
            "fileName": file_name,
            "generatedEntryModule": "main.py",
            "workspaceVersion": BLOCK_WORKSPACE_VERSION,
            "createdAt": now,
            "updatedAt": now,
        }
    ]
    manifest["entryBlockDocument"] = document_id
    manifest["entryBlockDocumentId"] = document_id


def _load_tasks(root_path: Path) -> Dict[str, Any]:
    tasks = _read_json(_tasks_path(root_path), {"nextTaskId": 1, "items": []})
    tasks.setdefault("nextTaskId", 1)
    tasks.setdefault("items", [])
    return tasks


def _save_tasks(root_path: Path, tasks: Dict[str, Any]) -> None:
    _write_json(_tasks_path(root_path), tasks)


def _load_snapshot_index(root_path: Path) -> Dict[str, Any]:
    index = _read_json(_snapshots_index_path(root_path), {"nextSnapshotId": 1, "items": []})
    index.setdefault("nextSnapshotId", 1)
    index.setdefault("items", [])
    return index


def _save_snapshot_index(root_path: Path, index: Dict[str, Any]) -> None:
    _write_json(_snapshots_index_path(root_path), index)


def _save_manifest(root_path: Path, manifest: Dict[str, Any]) -> None:
    manifest["updatedAt"] = utc_now()
    _write_json(_manifest_path(root_path), manifest)


def _register_catalog_project(project_uid: str, root_path: Path, name: str, project_type: str) -> int:
    now = utc_now()
    with _catalog_connect() as conn:
        existing = conn.execute(
            "SELECT id, pinned FROM projects WHERE project_uid = ? OR root_path = ?",
            (project_uid, str(root_path)),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE projects
                SET project_uid = ?, root_path = ?, name = ?, project_type = ?, updated_at = ?, last_opened_at = ?
                WHERE id = ?
                """,
                (project_uid, str(root_path), name, project_type, now, now, int(existing["id"])),
            )
            return int(existing["id"])
        cursor = conn.execute(
            """
            INSERT INTO projects (project_uid, root_path, name, project_type, pinned, created_at, updated_at, last_opened_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (project_uid, str(root_path), name, project_type, now, now, now),
        )
        return int(cursor.lastrowid)


def _catalog_row_for_project(project_id: int) -> sqlite3.Row:
    with _catalog_connect() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return row


def _touch_project_catalog(project_id: int, manifest: Dict[str, Any], root_path: Path) -> None:
    now = utc_now()
    with _catalog_connect() as conn:
        conn.execute(
            """
            UPDATE projects
            SET name = ?, project_type = ?, root_path = ?, updated_at = ?, last_opened_at = ?
            WHERE id = ?
            """,
            (manifest["name"], manifest["projectType"], str(root_path), now, now, project_id),
        )


def list_recent_projects() -> List[Dict[str, Any]]:
    with _catalog_connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM projects
            ORDER BY pinned DESC, last_opened_at DESC, updated_at DESC, id DESC
            """
        ).fetchall()
    items = []
    for row in rows:
        root_path = Path(row["root_path"])
        if not root_path.exists():
            continue
        items.append(
            {
                "id": int(row["id"]),
                "name": row["name"],
                "project_type": row["project_type"],
                "root_path": row["root_path"],
                "pinned": bool(row["pinned"]),
                "last_opened_at": row["last_opened_at"],
                "updated_at": row["updated_at"],
                "project_type_label": project_type_label(row["project_type"]),
            }
        )
    return items


def pin_recent_project(project_id: int, pinned: bool) -> Dict[str, Any]:
    with _catalog_connect() as conn:
        updated = conn.execute(
            "UPDATE projects SET pinned = ?, updated_at = ? WHERE id = ?",
            (1 if pinned else 0, utc_now(), project_id),
        )
        if updated.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "ok", "project_id": project_id, "pinned": pinned}


def remove_recent_project(project_id: int) -> Dict[str, Any]:
    with _catalog_connect() as conn:
        deleted = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        if deleted.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted", "project_id": project_id}


def _file_payload(root_path: Path, entry: Dict[str, Any]) -> Dict[str, Any]:
    rel_path = _validate_relative_path(entry["path"])
    file_path = root_path / rel_path
    content = file_path.read_text(encoding="utf-8") if file_path.exists() else ""
    return {
        "id": int(entry["id"]),
        "name": rel_path,
        "content": content,
    }


def _block_document_payload(root_path: Path, entry: Dict[str, Any]) -> Dict[str, Any]:
    workspace_path = _blocks_dir(root_path) / entry["fileName"]
    return {
        "id": int(entry["id"]),
        "name": entry["name"],
        "workspace_json": workspace_path.read_text(encoding="utf-8") if workspace_path.exists() else PYBRICKS_BLOCKS_STARTER,
        "workspace_version": int(entry.get("workspaceVersion") or BLOCK_WORKSPACE_VERSION),
        "generated_entry_module": entry.get("generatedEntryModule") or "main.py",
        "created_at": entry.get("createdAt"),
        "updated_at": entry.get("updatedAt"),
    }


def _project_payload(project_id: int, root_path: Path, manifest: Dict[str, Any]) -> Dict[str, Any]:
    files = [_file_payload(root_path, entry) for entry in manifest.get("files", [])]
    block_documents = [_block_document_payload(root_path, entry) for entry in manifest.get("blockDocuments", [])]
    return {
        "id": project_id,
        "public_id": manifest["projectId"],
        "name": manifest["name"],
        "project_type": manifest["projectType"],
        "description": None,
        "editor_mode": manifest.get("editorMode") or ("blocks" if manifest["projectType"] == PROJECT_TYPE_PYBRICKS else "text"),
        "entry_block_document_id": manifest.get("entryBlockDocumentId"),
        "owner_id": 0,
        "owner_name": "Local",
        "is_public": False,
        "root_path": str(root_path),
        "files": files,
        "block_documents": block_documents,
        "collaborators": [],
    }


def _load_project_state(root_path: Path, project_type: Optional[str] = None, name: Optional[str] = None) -> Dict[str, Any]:
    manifest = _ensure_manifest(root_path, project_type=project_type, name=name)
    _sync_manifest_file_index(root_path, manifest)
    _ensure_default_block_document(root_path, manifest)
    _save_manifest(root_path, manifest)
    project_id = _register_catalog_project(manifest["projectId"], root_path, manifest["name"], manifest["projectType"])
    return {"project_id": project_id, "root_path": root_path, "manifest": manifest}


def open_project_folder(folder_path: str, project_type: Optional[str] = None) -> Dict[str, Any]:
    root_path = Path(folder_path).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise HTTPException(status_code=400, detail="Folder does not exist")
    state = _load_project_state(root_path, project_type=project_type)
    return _project_payload(state["project_id"], state["root_path"], state["manifest"])


def create_project(name: str, project_type: str, location_path: str) -> Dict[str, Any]:
    resolved_type = _normalize_project_type(project_type)
    root_path = Path(location_path).expanduser().resolve() / _safe_directory_name(name)
    if root_path.exists():
        if any(root_path.iterdir()):
            raise HTTPException(status_code=400, detail="Project folder already exists and is not empty")
    else:
        root_path.mkdir(parents=True, exist_ok=True)
    state = _load_project_state(root_path, project_type=resolved_type, name=name)
    return _project_payload(state["project_id"], state["root_path"], state["manifest"])


def import_project(source_path: str, project_type: Optional[str] = None) -> Dict[str, Any]:
    source = Path(source_path).expanduser().resolve()
    if not source.exists():
        raise HTTPException(status_code=400, detail="Import source does not exist")

    library_root = library_home()
    library_root.mkdir(parents=True, exist_ok=True)
    target_root = library_root / _safe_directory_name(source.stem if source.is_file() else source.name)
    suffix = 2
    while target_root.exists():
        target_root = library_root / f"{_safe_directory_name(source.stem if source.is_file() else source.name)}-{suffix}"
        suffix += 1
    target_root.mkdir(parents=True, exist_ok=True)

    if source.is_dir():
        shutil.copytree(source, target_root, dirs_exist_ok=True)
    elif source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source, "r") as archive:
            archive.extractall(target_root)
    elif source.suffix.lower() == ".py":
        shutil.copy2(source, target_root / "main.py")
    else:
        raise HTTPException(status_code=400, detail="Unsupported import type")

    state = _load_project_state(target_root, project_type=project_type)
    return _project_payload(state["project_id"], state["root_path"], state["manifest"])


def get_project(project_id: int) -> Dict[str, Any]:
    row = _catalog_row_for_project(project_id)
    root_path = Path(row["root_path"]).expanduser().resolve()
    if not root_path.exists():
        raise HTTPException(status_code=404, detail="Project folder no longer exists")
    state = _load_project_state(root_path)
    _touch_project_catalog(project_id, state["manifest"], root_path)
    return _project_payload(project_id, root_path, state["manifest"])


def list_projects() -> List[Dict[str, Any]]:
    projects = []
    for item in list_recent_projects():
        try:
            projects.append(get_project(int(item["id"])))
        except HTTPException:
            continue
    return projects


def update_project(project_id: int, name: Optional[str] = None) -> Dict[str, Any]:
    row = _catalog_row_for_project(project_id)
    root_path = Path(row["root_path"]).expanduser().resolve()
    state = _load_project_state(root_path)
    manifest = state["manifest"]
    if name is not None:
        next_name = name.strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="Project name is required")
        manifest["name"] = next_name
        _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return _project_payload(project_id, root_path, manifest)


def _manifest_file_entry(manifest: Dict[str, Any], file_id: int) -> Dict[str, Any]:
    for entry in manifest.get("files", []):
        if int(entry["id"]) == int(file_id):
            return entry
    raise HTTPException(status_code=404, detail="File not found")


def add_file(project_id: int, name: str, content: str = "") -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    rel_path = _validate_python_file_path(name)
    target = root_path / rel_path
    if target.exists():
        raise HTTPException(status_code=400, detail="File already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content or "", encoding="utf-8")
    _sync_manifest_file_index(root_path, manifest)
    _save_manifest(root_path, manifest)
    entry = next(item for item in manifest["files"] if item["path"] == rel_path)
    _touch_project_catalog(project_id, manifest, root_path)
    return _file_payload(root_path, entry)


def update_file(project_id: int, file_id: int, name: Optional[str] = None, content: Optional[str] = None) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    entry = _manifest_file_entry(manifest, file_id)
    current_path = root_path / entry["path"]
    if not current_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if name is not None:
        next_rel_path = _validate_python_file_path(name)
        next_path = root_path / next_rel_path
        if next_path != current_path:
            if next_path.exists():
                raise HTTPException(status_code=400, detail="Target file already exists")
            next_path.parent.mkdir(parents=True, exist_ok=True)
            current_path.rename(next_path)
            entry["path"] = next_rel_path
            current_path = next_path

    if content is not None:
        current_path.write_text(content, encoding="utf-8")

    _sync_manifest_file_index(root_path, manifest)
    _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return _file_payload(root_path, _manifest_file_entry(manifest, file_id))


def delete_file(project_id: int, file_id: int) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    entry = _manifest_file_entry(manifest, file_id)
    file_path = root_path / entry["path"]
    if file_path.exists():
        file_path.unlink()
    _sync_manifest_file_index(root_path, manifest)
    _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return {"status": "deleted"}


def _manifest_block_entry(manifest: Dict[str, Any], document_id: int) -> Dict[str, Any]:
    for entry in manifest.get("blockDocuments", []):
        if int(entry["id"]) == int(document_id):
            return entry
    raise HTTPException(status_code=404, detail="Block document not found")


def add_block_document(project_id: int, name: str) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    if manifest["projectType"] != PROJECT_TYPE_PYBRICKS:
        raise HTTPException(status_code=400, detail="Only PyBricks projects support block documents")
    next_id = int(manifest.get("nextBlockDocumentId") or 1)
    manifest["nextBlockDocumentId"] = next_id + 1
    now = utc_now()
    entry = {
        "id": next_id,
        "name": (name or "Blocks").strip() or "Blocks",
        "fileName": f"{next_id}.json",
        "generatedEntryModule": "main.py",
        "workspaceVersion": BLOCK_WORKSPACE_VERSION,
        "createdAt": now,
        "updatedAt": now,
    }
    (_blocks_dir(root_path) / entry["fileName"]).write_text(PYBRICKS_BLOCKS_STARTER, encoding="utf-8")
    manifest["blockDocuments"].append(entry)
    if not manifest.get("entryBlockDocumentId"):
        manifest["entryBlockDocumentId"] = next_id
        manifest["entryBlockDocument"] = next_id
    _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return _block_document_payload(root_path, entry)


def update_block_document(
    project_id: int,
    document_id: int,
    name: Optional[str] = None,
    workspace_json: Optional[str] = None,
    generated_entry_module: Optional[str] = None,
    workspace_version: Optional[int] = None,
) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    entry = _manifest_block_entry(manifest, document_id)
    if name is not None:
        entry["name"] = name.strip() or entry["name"]
    if generated_entry_module is not None:
        entry["generatedEntryModule"] = _validate_python_file_path(generated_entry_module)
    if workspace_version is not None:
        entry["workspaceVersion"] = int(workspace_version)
    if workspace_json is not None:
        (_blocks_dir(root_path) / entry["fileName"]).write_text(workspace_json, encoding="utf-8")
    entry["updatedAt"] = utc_now()
    _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return _block_document_payload(root_path, entry)


def delete_block_document(project_id: int, document_id: int) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    entry = _manifest_block_entry(manifest, document_id)
    workspace_path = _blocks_dir(root_path) / entry["fileName"]
    if workspace_path.exists():
        workspace_path.unlink()
    manifest["blockDocuments"] = [item for item in manifest.get("blockDocuments", []) if int(item["id"]) != int(document_id)]
    if manifest.get("entryBlockDocumentId") == int(document_id):
        replacement = manifest["blockDocuments"][0]["id"] if manifest["blockDocuments"] else None
        manifest["entryBlockDocumentId"] = replacement
        manifest["entryBlockDocument"] = replacement
    _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return {"status": "deleted"}


def _task_payload(project_id: int, task: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(task["id"]),
        "project_id": project_id,
        "content": task["content"],
        "is_done": bool(task.get("is_done")),
        "created_by_user_id": 0,
        "created_by_name": "Local",
        "assigned_to_user_id": None,
        "assigned_to_name": "You" if task.get("assigned_to_me") else None,
        "completed_by_user_id": 0 if task.get("completed_at") else None,
        "completed_by_name": "Local" if task.get("completed_at") else None,
        "completed_at": task.get("completed_at"),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }


def list_tasks(project_id: int) -> List[Dict[str, Any]]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    tasks = _load_tasks(root_path)
    items = [_task_payload(project_id, task) for task in tasks["items"]]
    return sorted(items, key=lambda item: (item["is_done"], item["created_at"]), reverse=False)


def create_task(project_id: int, content: str) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    trimmed = (content or "").strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="Task content is required")
    if len(trimmed) > 240:
        raise HTTPException(status_code=400, detail="Task content is too long (max 240 characters)")
    tasks = _load_tasks(root_path)
    now = utc_now()
    item = {
        "id": int(tasks["nextTaskId"]),
        "content": trimmed,
        "is_done": False,
        "assigned_to_me": False,
        "completed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    tasks["nextTaskId"] = int(tasks["nextTaskId"]) + 1
    tasks["items"].insert(0, item)
    _save_tasks(root_path, tasks)
    return _task_payload(project_id, item)


def update_task(project_id: int, task_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    tasks = _load_tasks(root_path)
    item = next((task for task in tasks["items"] if int(task["id"]) == int(task_id)), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if "content" in patch and patch["content"] is not None:
        trimmed = str(patch["content"]).strip()
        if not trimmed:
            raise HTTPException(status_code=400, detail="Task content is required")
        if len(trimmed) > 240:
            raise HTTPException(status_code=400, detail="Task content is too long (max 240 characters)")
        item["content"] = trimmed
    if "is_done" in patch and patch["is_done"] is not None:
        item["is_done"] = bool(patch["is_done"])
        item["completed_at"] = utc_now() if item["is_done"] else None
    if "assigned_to_user_id" in patch:
        item["assigned_to_me"] = patch["assigned_to_user_id"] is not None
    item["updated_at"] = utc_now()
    _save_tasks(root_path, tasks)
    return _task_payload(project_id, item)


def delete_task(project_id: int, task_id: int) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    tasks = _load_tasks(root_path)
    next_items = [task for task in tasks["items"] if int(task["id"]) != int(task_id)]
    if len(next_items) == len(tasks["items"]):
        raise HTTPException(status_code=404, detail="Task not found")
    tasks["items"] = next_items
    _save_tasks(root_path, tasks)
    return {"status": "deleted"}


def _snapshot_payload(project_id: int, item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(item["id"]),
        "project_id": project_id,
        "name": item["name"],
        "created_by_user_id": 0,
        "created_by_name": "Local",
        "created_at": item["created_at"],
        "file_count": int(item.get("file_count") or 0),
    }


def list_snapshots(project_id: int) -> List[Dict[str, Any]]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    index = _load_snapshot_index(root_path)
    return [_snapshot_payload(project_id, item) for item in sorted(index["items"], key=lambda entry: entry["created_at"], reverse=True)]


def create_snapshot(project_id: int, name: Optional[str]) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    manifest = _ensure_manifest(root_path)
    index = _load_snapshot_index(root_path)
    snapshot_id = int(index["nextSnapshotId"])
    snapshot_name = (name or "").strip() or f"Checkpoint {dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    archive_path = _snapshots_dir(root_path) / f"{snapshot_id}.zip"
    file_count = 0

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{PROJECT_META_DIR_NAME}/project.json", json.dumps(manifest, indent=2))
        for rel_path in _iter_text_project_files(root_path):
            archive.write(root_path / rel_path, arcname=f"workspace/{rel_path}")
            file_count += 1
        for block_document in manifest.get("blockDocuments", []):
            workspace_path = _blocks_dir(root_path) / block_document["fileName"]
            if workspace_path.exists():
                archive.write(workspace_path, arcname=f"{PROJECT_META_DIR_NAME}/blocks/{block_document['fileName']}")

    item = {
        "id": snapshot_id,
        "name": snapshot_name,
        "created_at": utc_now(),
        "archive_name": archive_path.name,
        "file_count": file_count,
    }
    index["nextSnapshotId"] = snapshot_id + 1
    index["items"].append(item)
    _save_snapshot_index(root_path, index)
    return _snapshot_payload(project_id, item)


def _remove_project_files(root_path: Path) -> None:
    for rel_path in _iter_text_project_files(root_path):
        file_path = root_path / rel_path
        if file_path.exists():
            file_path.unlink()


def restore_snapshot(project_id: int, snapshot_id: int) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    index = _load_snapshot_index(root_path)
    item = next((entry for entry in index["items"] if int(entry["id"]) == int(snapshot_id)), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    archive_path = _snapshots_dir(root_path) / item["archive_name"]
    if not archive_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot archive missing")

    _remove_project_files(root_path)

    with zipfile.ZipFile(archive_path, "r") as archive:
        manifest_data = json.loads(archive.read(f"{PROJECT_META_DIR_NAME}/project.json").decode("utf-8"))
        for name in archive.namelist():
            if not name.startswith("workspace/") or name.endswith("/"):
                continue
            rel_path = _validate_relative_path(name[len("workspace/"):])
            target = root_path / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))

        blocks_dir = _blocks_dir(root_path)
        if blocks_dir.exists():
            shutil.rmtree(blocks_dir)
        blocks_dir.mkdir(parents=True, exist_ok=True)
        for name in archive.namelist():
            if not name.startswith(f"{PROJECT_META_DIR_NAME}/blocks/") or name.endswith("/"):
                continue
            file_name = Path(name).name
            (blocks_dir / file_name).write_bytes(archive.read(name))

    manifest = _ensure_manifest(root_path, project_type=manifest_data.get("projectType"), name=manifest_data.get("name"))
    manifest.update({key: value for key, value in manifest_data.items() if key not in {"updatedAt"}})
    _sync_manifest_file_index(root_path, manifest)
    _ensure_default_block_document(root_path, manifest)
    _save_manifest(root_path, manifest)
    _touch_project_catalog(project_id, manifest, root_path)
    return {"status": "restored", "updated_files": int(item.get("file_count") or 0), "snapshot_id": int(item["id"])}


def delete_snapshot(project_id: int, snapshot_id: int) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    index = _load_snapshot_index(root_path)
    item = next((entry for entry in index["items"] if int(entry["id"]) == int(snapshot_id)), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    archive_path = _snapshots_dir(root_path) / item["archive_name"]
    if archive_path.exists():
        archive_path.unlink()
    index["items"] = [entry for entry in index["items"] if int(entry["id"]) != int(snapshot_id)]
    _save_snapshot_index(root_path, index)
    return {"status": "deleted"}


def export_snapshot(project_id: int, snapshot_id: int) -> Dict[str, Any]:
    project = get_project(project_id)
    root_path = Path(project["root_path"])
    index = _load_snapshot_index(root_path)
    item = next((entry for entry in index["items"] if int(entry["id"]) == int(snapshot_id)), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    archive_path = _snapshots_dir(root_path) / item["archive_name"]
    if not archive_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot archive missing")
    safe_project = _safe_directory_name(project["name"]).replace(" ", "-")
    safe_snapshot = _safe_directory_name(item["name"]).replace(" ", "-")
    return {
        "archive_path": archive_path,
        "download_name": f"{safe_project}-{safe_snapshot}.zip",
    }
