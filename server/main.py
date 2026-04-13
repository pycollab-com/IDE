import asyncio
import io
import json
import re
import time
import uuid
import os
import secrets
import datetime as dt
import logging
import zipfile
from urllib.parse import urlparse, urlunparse
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Load environment variables from .env file if it exists (for local development)
# In production/Docker, environment variables should be set directly
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # python-dotenv not installed, skip
    pass

import socketio
from sqlalchemy import text, or_, and_, func
from sqlalchemy.exc import IntegrityError
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from . import auth, google_oauth, models, schemas, passkey as passkey_module
from .auth import get_current_user, get_db, get_optional_user
from .database import Base, engine, SessionLocal, DATABASE_URL, is_transient_db_startup_error
from .realtime_messaging import PresenceManager, TypingManager
from fastapi import UploadFile, File
import shutil
import base64

app = FastAPI(
    title="Collaborative Python IDE",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect",
)
logger = logging.getLogger("pycollab.runtime")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Socket.IO setup
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


# Presence tracking
presence = {}  # project_id -> {sid: {user_id, name, color, cursor}}
voice_rooms: Dict[int, Dict[str, Dict[str, Any]]] = {}  # project_id -> {sid: participant}

# --- Messaging realtime state ---
MESSAGING_NAMESPACE = "/messages"
MESSAGE_RATE_LIMIT_PER_MINUTE = 30
REQUEST_RATE_LIMIT_PER_HOUR = 10
PRESENCE_STALE_SECONDS = 35
PRESENCE_CHECK_INTERVAL_SECONDS = 10
TYPING_THROTTLE_SECONDS = 1.0
TYPING_TIMEOUT_SECONDS = 4.0
SHARE_TOKEN_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
SHARE_TOKEN_LENGTH = 6
SHARE_TOKEN_RE = re.compile(rf"^[{SHARE_TOKEN_ALPHABET}]{{{SHARE_TOKEN_LENGTH}}}$")
PROJECT_TYPE_NORMAL = "normal"
PROJECT_TYPE_PYBRICKS = "pybricks"
EDITOR_MODE_TEXT = "text"
EDITOR_MODE_BLOCKS = "blocks"
NORMAL_PROJECT_STARTER = "# main entry point\n\nprint('Hello from your new project!')\n"
PYBRICKS_PROJECT_STARTER = """from pybricks.hubs import PrimeHub
from pybricks.tools import wait

hub = PrimeHub()

while True:
    print("PyBricks project ready")
    wait(1000)
"""
DEFAULT_BLOCK_DOCUMENT_NAME = "Blocks"
BLOCK_WORKSPACE_VERSION = 1
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
                }
            ]
        },
    }
)

message_presence = PresenceManager(stale_seconds=PRESENCE_STALE_SECONDS)
typing_manager = TypingManager(
    throttle_seconds=TYPING_THROTTLE_SECONDS,
    timeout_seconds=TYPING_TIMEOUT_SECONDS,
)
message_sid_info: Dict[str, int] = {}

DB_STARTUP_MAX_ATTEMPTS = 8
DB_STARTUP_RETRY_SECONDS = 2.0


def _normalize_username(username: str) -> str:
    return username.strip().lower()


def _run_db_startup_step(step_name: str, operation) -> None:
    last_error: Optional[Exception] = None
    for attempt in range(1, DB_STARTUP_MAX_ATTEMPTS + 1):
        try:
            operation()
            if attempt > 1:
                logger.info(
                    "Database startup step '%s' succeeded on attempt %s/%s",
                    step_name,
                    attempt,
                    DB_STARTUP_MAX_ATTEMPTS,
                )
            return
        except Exception as exc:
            last_error = exc
            if not is_transient_db_startup_error(exc) or attempt == DB_STARTUP_MAX_ATTEMPTS:
                raise
            logger.warning(
                "Database startup step '%s' failed on attempt %s/%s: %s. Retrying in %.1fs.",
                step_name,
                attempt,
                DB_STARTUP_MAX_ATTEMPTS,
                exc,
                DB_STARTUP_RETRY_SECONDS,
            )
            time.sleep(DB_STARTUP_RETRY_SECONDS)

    if last_error is not None:
        raise last_error


def _generate_share_token() -> str:
    return "".join(secrets.choice(SHARE_TOKEN_ALPHABET) for _ in range(SHARE_TOKEN_LENGTH))


def _normalize_share_token(token: Optional[str]) -> Optional[str]:
    if token is None:
        return None
    normalized = token.strip().lower()
    if not SHARE_TOKEN_RE.fullmatch(normalized):
        return None
    return normalized


MAX_PROFILE_LINKS = 20
MAX_PROFILE_DESCRIPTION_LENGTH = 1200
MAX_PROFILE_LINK_LENGTH = 300
_URL_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
_MAILTO_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_profile_description(description: str) -> Optional[str]:
    trimmed = description.strip()
    if not trimmed:
        return None
    if len(trimmed) > MAX_PROFILE_DESCRIPTION_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Description must be {MAX_PROFILE_DESCRIPTION_LENGTH} characters or less",
        )
    return trimmed


def _normalize_profile_link(link: str) -> str:
    trimmed = link.strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="Profile links cannot be empty")
    if re.search(r"\s", trimmed):
        raise HTTPException(status_code=400, detail="Profile links cannot contain spaces")
    if len(trimmed) > MAX_PROFILE_LINK_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Profile links must be {MAX_PROFILE_LINK_LENGTH} characters or less",
        )
    candidate = trimmed if _URL_SCHEME_RE.match(trimmed) else f"https://{trimmed}"
    parsed = urlparse(candidate)
    scheme = parsed.scheme.lower()
    if scheme in {"http", "https"}:
        if not parsed.netloc:
            raise HTTPException(status_code=400, detail="Profile links must be valid HTTP(S) or mailto URLs")
        normalized_path = "" if parsed.path in {"", "/"} else parsed.path
        return urlunparse((scheme, parsed.netloc.lower(), normalized_path, "", parsed.query, parsed.fragment))
    if scheme == "mailto":
        email = parsed.path.strip().lower()
        if not _MAILTO_RE.match(email):
            raise HTTPException(status_code=400, detail="Profile links must be valid HTTP(S) or mailto URLs")
        return f"mailto:{email}"
    raise HTTPException(status_code=400, detail="Profile links must be valid HTTP(S) or mailto URLs")


def _normalize_profile_links(links: List[str]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for raw_link in links:
        if not isinstance(raw_link, str):
            raise HTTPException(status_code=400, detail="Profile links must be strings")
        if not raw_link.strip():
            continue
        canonical = _normalize_profile_link(raw_link)
        dedupe_key = canonical.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized.append(canonical)
        if len(normalized) > MAX_PROFILE_LINKS:
            raise HTTPException(
                status_code=400,
                detail=f"Profile links cannot exceed {MAX_PROFILE_LINKS} entries",
            )
    return normalized


def _decode_profile_links(raw_links: Optional[str]) -> List[str]:
    if not raw_links:
        return []
    try:
        payload = json.loads(raw_links)
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    links: List[str] = []
    seen = set()
    for item in payload:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if not trimmed:
            continue
        key = trimmed.lower()
        if key in seen:
            continue
        seen.add(key)
        links.append(trimmed)
        if len(links) >= MAX_PROFILE_LINKS:
            break
    return links


# --- Realtime collaborative editing state ---

PERSIST_DEBOUNCE_SECONDS = 0.5
MAX_FILE_OPS_BUFFER = 2000  # per file, before we fall back to full sync


@dataclass
class _FileOp:
    op_id: str
    user_id: int
    changeset: Any
    cursor: Optional[Dict[str, int]] = None
    ts: float = field(default_factory=time.monotonic)


@dataclass
class _FileSyncState:
    project_id: int
    content: str
    rev: int = 0
    base_rev: int = 0  # revision number of ops[0]
    ops: List[_FileOp] = field(default_factory=list)  # one op per revision increment
    persist_task: Optional[asyncio.Task] = None


_file_states: Dict[int, _FileSyncState] = {}
_file_locks: Dict[int, asyncio.Lock] = {}
_sid_info: Dict[str, Dict[str, Any]] = {}  # sid -> {user_id, is_admin, project_id}


@dataclass
class _BlockOp:
    op_id: str
    user_id: int
    event: Dict[str, Any]
    workspace_json: Optional[str] = None
    ts: float = field(default_factory=time.monotonic)


@dataclass
class _BlockSyncState:
    project_id: int
    workspace_json: str
    rev: int = 0
    base_rev: int = 0
    ops: List[_BlockOp] = field(default_factory=list)
    persist_task: Optional[asyncio.Task] = None


_block_states: Dict[int, _BlockSyncState] = {}
_block_locks: Dict[int, asyncio.Lock] = {}


def _apply_changeset(text: str, changeset: Any) -> Optional[str]:
    """
    Apply a CodeMirror ChangeSet JSON representation (ChangeSet.toJSON()) to `text`.
    Returns the updated text, or None if the changeset doesn't apply.
    """
    if not isinstance(changeset, list):
        return None
    pos = 0
    out: List[str] = []
    text_len = len(text)
    for part in changeset:
        if isinstance(part, int):
            if part < 0 or pos + part > text_len:
                return None
            out.append(text[pos : pos + part])
            pos += part
            continue
        if isinstance(part, list):
            if not part or not isinstance(part[0], int):
                return None
            delete_count = part[0]
            if delete_count < 0 or pos + delete_count > text_len:
                return None
            pos += delete_count
            if len(part) > 1:
                insert_lines = part[1:]
                if not all(isinstance(line, str) for line in insert_lines):
                    return None
                out.append("\n".join(insert_lines))
            continue
        return None
    if pos != text_len:
        return None
    return "".join(out)


def _ensure_file_state(db: Session, project_id: int, file_id: int) -> Optional[_FileSyncState]:
    state = _file_states.get(file_id)
    if state and state.project_id == project_id:
        return state

    pf = (
        db.query(models.ProjectFile)
        .filter(models.ProjectFile.id == file_id, models.ProjectFile.project_id == project_id)
        .first()
    )
    if not pf:
        return None

    state = _FileSyncState(project_id=project_id, content=pf.content or "")
    _file_states[file_id] = state
    _file_locks.setdefault(file_id, asyncio.Lock())
    return state


def _ensure_block_state(db: Session, project_id: int, document_id: int) -> Optional[_BlockSyncState]:
    state = _block_states.get(document_id)
    if state and state.project_id == project_id:
        return state

    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project or not _project_supports_blocks(project):
        return None

    doc = (
        db.query(models.ProjectBlockDocument)
        .filter(
            models.ProjectBlockDocument.id == document_id,
            models.ProjectBlockDocument.project_id == project_id,
        )
        .first()
    )
    if not doc:
        return None

    state = _BlockSyncState(project_id=project_id, workspace_json=doc.workspace_json or "{}")
    _block_states[document_id] = state
    _block_locks.setdefault(document_id, asyncio.Lock())
    return state


async def _persist_file_to_db(file_id: int):
    try:
        await asyncio.sleep(PERSIST_DEBOUNCE_SECONDS)
        lock = _file_locks.get(file_id)
        state = _file_states.get(file_id)
        if not lock or not state:
            return
        async with lock:
            content = state.content
            project_id = state.project_id

        db = SessionLocal()
        try:
            pf = (
                db.query(models.ProjectFile)
                .filter(models.ProjectFile.id == file_id, models.ProjectFile.project_id == project_id)
                .first()
            )
            if pf:
                pf.content = content
                db.commit()
        finally:
            db.close()
    except asyncio.CancelledError:
        return
    finally:
        state = _file_states.get(file_id)
        if state and state.persist_task is asyncio.current_task():
            state.persist_task = None


def _schedule_persist(file_id: int):
    state = _file_states.get(file_id)
    if not state:
        return
    if state.persist_task and not state.persist_task.done():
        state.persist_task.cancel()
    state.persist_task = asyncio.create_task(_persist_file_to_db(file_id))


async def _persist_block_to_db(document_id: int):
    try:
        await asyncio.sleep(PERSIST_DEBOUNCE_SECONDS)
        lock = _block_locks.get(document_id)
        state = _block_states.get(document_id)
        if not lock or not state:
            return
        async with lock:
            workspace_json = state.workspace_json
            project_id = state.project_id

        db = SessionLocal()
        try:
            doc = (
                db.query(models.ProjectBlockDocument)
                .filter(
                    models.ProjectBlockDocument.id == document_id,
                    models.ProjectBlockDocument.project_id == project_id,
                )
                .first()
            )
            if doc:
                doc.workspace_json = workspace_json
                doc.workspace_version = BLOCK_WORKSPACE_VERSION
                db.commit()
        finally:
            db.close()
    except asyncio.CancelledError:
        return
    finally:
        state = _block_states.get(document_id)
        if state and state.persist_task is asyncio.current_task():
            state.persist_task = None


def _schedule_block_persist(document_id: int):
    state = _block_states.get(document_id)
    if not state:
        return
    if state.persist_task and not state.persist_task.done():
        state.persist_task.cancel()
    state.persist_task = asyncio.create_task(_persist_block_to_db(document_id))


def _pair_key(user_a_id: int, user_b_id: int):
    if user_a_id < user_b_id:
        return user_a_id, user_b_id, f"{user_a_id}:{user_b_id}"
    return user_b_id, user_a_id, f"{user_b_id}:{user_a_id}"


def _message_preview(body: str, limit: int = 120) -> str:
    compact = " ".join(body.split())
    return compact[:limit]


def _is_blocked(db: Session, user_a_id: int, user_b_id: int) -> bool:
    return (
        db.query(models.Block)
        .filter(
            or_(
                and_(
                    models.Block.blocker_id == user_a_id,
                    models.Block.blocked_id == user_b_id,
                ),
                and_(
                    models.Block.blocker_id == user_b_id,
                    models.Block.blocked_id == user_a_id,
                ),
            )
        )
        .first()
        is not None
    )


def _block_state(db: Session, viewer_id: int, other_id: int) -> str:
    if (
        db.query(models.Block)
        .filter(
            models.Block.blocker_id == viewer_id,
            models.Block.blocked_id == other_id,
        )
        .first()
    ):
        return "blocked_by_me"
    if (
        db.query(models.Block)
        .filter(
            models.Block.blocker_id == other_id,
            models.Block.blocked_id == viewer_id,
        )
        .first()
    ):
        return "blocked_by_them"
    return "none"


def _is_mutual(db: Session, user_a_id: int, user_b_id: int) -> bool:
    follows_ab = (
        db.query(models.Follow)
        .filter(
            models.Follow.follower_id == user_a_id,
            models.Follow.followed_id == user_b_id,
        )
        .first()
    )
    follows_ba = (
        db.query(models.Follow)
        .filter(
            models.Follow.follower_id == user_b_id,
            models.Follow.followed_id == user_a_id,
        )
        .first()
    )
    return bool(follows_ab and follows_ba)


def _serialize_user(db: Session, viewer_id: Optional[int], user: models.User) -> schemas.UserOut:
    profile_path = user.profile_picture_path
    links = _decode_profile_links(user.links)
    if viewer_id:
        blocked_by_user = (
            db.query(models.Block)
            .filter(
                models.Block.blocker_id == user.id,
                models.Block.blocked_id == viewer_id,
            )
            .first()
        )
        if blocked_by_user:
            profile_path = None
    return schemas.UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        is_admin=user.is_admin,
        bio=user.bio,
        description=user.description,
        links=links,
        profile_picture_path=profile_path,
    )


def _serialize_users(db: Session, viewer_id: Optional[int], users: List[models.User]) -> List[schemas.UserOut]:
    if not viewer_id or not users:
        return [_serialize_user(db, None, user) for user in users]
    user_ids = [user.id for user in users]
    blocked_by_ids = {
        block.blocker_id
        for block in db.query(models.Block)
        .filter(
            models.Block.blocked_id == viewer_id,
            models.Block.blocker_id.in_(user_ids),
        )
        .all()
    }
    results = []
    for user in users:
        profile_path = user.profile_picture_path
        links = _decode_profile_links(user.links)
        if user.id in blocked_by_ids:
            profile_path = None
        results.append(
            schemas.UserOut(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                is_admin=user.is_admin,
                bio=user.bio,
                description=user.description,
                links=links,
                profile_picture_path=profile_path,
            )
        )
    return results


def _enforce_message_rate_limit(db: Session, user_id: int):
    since = dt.datetime.utcnow() - dt.timedelta(minutes=1)
    count = (
        db.query(models.Message)
        .filter(
            models.Message.sender_id == user_id,
            models.Message.created_at >= since,
        )
        .count()
    )
    if count >= MESSAGE_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Message rate limit exceeded")


def _enforce_request_rate_limit(db: Session, user_id: int):
    since = dt.datetime.utcnow() - dt.timedelta(hours=1)
    count = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.requester_id == user_id,
            models.Conversation.status == "pending",
            models.Conversation.created_at >= since,
        )
        .count()
    )
    if count >= REQUEST_RATE_LIMIT_PER_HOUR:
        raise HTTPException(status_code=429, detail="Request rate limit exceeded")


def _emit_message_event(event: str, data: dict, room: Optional[str] = None):
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(
        sio.emit(
            event,
            data,
            room=room,
            namespace=MESSAGING_NAMESPACE,
        )
    )

FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "client", "dist"))
INDEX_FILE = os.path.join(FRONTEND_DIST, "index.html")
FAVICON_FILE = os.path.join(FRONTEND_DIST, "favicon.ico")
_raw_uploads_dir = os.getenv("PYCOLLAB_UPLOADS_DIR", "").strip()
UPLOADS_DIR = os.path.abspath(_raw_uploads_dir) if _raw_uploads_dir else os.path.join(os.path.dirname(__file__), "uploads")
PROFILE_PICTURES_DIR = os.path.join(UPLOADS_DIR, "profile_pictures")
COOP_VALUE = "same-origin"
COEP_VALUE = "require-corp"
DEFAULT_PYODIDE_VERSION = "0.29.3"
DEFAULT_PYODIDE_BASE_URL = f"https://cdn.jsdelivr.net/pyodide/v{DEFAULT_PYODIDE_VERSION}/full/"
DEFAULT_PYODIDE_MAX_RUN_SECONDS = 0
DEFAULT_GOOGLE_OAUTH_CLIENT_ID = "673654005602-gecd1ltp10rttmh177k0onqignmcofag.apps.googleusercontent.com"


def _get_google_client_id() -> str:
    return os.getenv("GOOGLE_OAUTH_CLIENT_ID", DEFAULT_GOOGLE_OAUTH_CLIENT_ID).strip()


def _verify_google_claims(id_token: str) -> Dict[str, Any]:
    google_client_id = _get_google_client_id()
    if not google_client_id:
        raise HTTPException(status_code=501, detail="Google OAuth is not configured")

    try:
        claims = google_oauth.verify_google_id_token(id_token, google_client_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    email = (claims.get("email") or "").strip().lower()
    google_sub = str(claims.get("google_sub") or "").strip()
    email_verified = bool(claims.get("email_verified"))
    if not email_verified or not email:
        raise HTTPException(status_code=400, detail="Google email is not verified")
    if not google_sub:
        raise HTTPException(status_code=400, detail="Google token missing subject")

    claims["email"] = email
    claims["google_sub"] = google_sub
    claims["email_verified"] = email_verified
    return claims


def _parse_allowed_packages(raw: str) -> List[str]:
    if not raw:
        return []
    seen = set()
    allowed = []
    for part in raw.split(","):
        normalized = part.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        allowed.append(normalized)
    return allowed


def _runtime_pyodide_config() -> Dict[str, Any]:
    version = os.getenv("PYCOLLAB_PYODIDE_VERSION", DEFAULT_PYODIDE_VERSION).strip() or DEFAULT_PYODIDE_VERSION
    base_url = os.getenv("PYCOLLAB_PYODIDE_BASE_URL", DEFAULT_PYODIDE_BASE_URL).strip() or DEFAULT_PYODIDE_BASE_URL
    allowed_packages = _parse_allowed_packages(os.getenv("PYCOLLAB_PYODIDE_ALLOWED_PACKAGES", ""))

    raw_timeout = os.getenv("PYCOLLAB_PYODIDE_MAX_RUN_SECONDS", str(DEFAULT_PYODIDE_MAX_RUN_SECONDS)).strip()
    try:
        max_run_seconds = max(0, int(raw_timeout))
    except ValueError:
        max_run_seconds = DEFAULT_PYODIDE_MAX_RUN_SECONDS

    return {
        "pyodide_version": version,
        "pyodide_base_url": base_url,
        "allowed_packages": allowed_packages,
        "max_run_seconds": max_run_seconds,
    }


def _project_starter_content(project_type: str) -> str:
    if project_type == PROJECT_TYPE_PYBRICKS:
        return PYBRICKS_PROJECT_STARTER
    return NORMAL_PROJECT_STARTER


def _default_project_editor_mode(project_type: str) -> str:
    return EDITOR_MODE_TEXT


def _project_supports_blocks(project_or_type: Any) -> bool:
    project_type = getattr(project_or_type, "project_type", project_or_type)
    return (project_type or PROJECT_TYPE_NORMAL) == PROJECT_TYPE_PYBRICKS


def _project_block_document_payload(document: models.ProjectBlockDocument, *, rev: Optional[int] = None) -> Dict[str, Any]:
    payload = {
        "id": document.id,
        "name": document.name,
        "workspace_json": document.workspace_json or "{}",
        "workspace_version": document.workspace_version or BLOCK_WORKSPACE_VERSION,
        "generated_entry_module": document.generated_entry_module or "main.py",
    }
    if rev is not None:
        payload["rev"] = rev
    return payload


def _derive_block_entry_module(name: Optional[str], fallback: str = "main.py") -> str:
    raw_name = (name or "").strip().lower()
    stem = re.sub(r"[^a-z0-9._-]+", "_", raw_name).strip("._-")
    if not stem:
        return fallback
    if stem.endswith(".py"):
        return stem
    return f"{stem}.py"


def _create_default_block_document(db: Session, project: models.Project) -> models.ProjectBlockDocument:
    block_document = models.ProjectBlockDocument(
        project_id=project.id,
        name=DEFAULT_BLOCK_DOCUMENT_NAME,
        workspace_json=PYBRICKS_BLOCKS_STARTER,
        workspace_version=BLOCK_WORKSPACE_VERSION,
        generated_entry_module="main.py",
    )
    db.add(block_document)
    db.flush()
    project.entry_block_document_id = block_document.id
    return block_document


def _generate_project_public_id() -> str:
    return models.generate_project_public_id()


def _project_payload(db: Session, project: models.Project) -> Dict[str, Any]:
    owner = db.query(models.User).filter(models.User.id == project.owner_id).first()
    return {
        "id": project.id,
        "public_id": project.public_id or "",
        "name": project.name,
        "project_type": project.project_type or PROJECT_TYPE_NORMAL,
        "description": project.description,
        "editor_mode": project.editor_mode or _default_project_editor_mode(project.project_type or PROJECT_TYPE_NORMAL),
        "entry_block_document_id": project.entry_block_document_id,
        "owner_id": project.owner_id,
        "owner_name": owner.display_name if owner else "Unknown",
        "is_public": project.is_public,
        "files": project.files,
        "block_documents": project.block_documents if _project_supports_blocks(project) else [],
        "collaborators": project.collaborators,
    }


def _ensure_pybricks_project(project: models.Project) -> None:
    if _project_supports_blocks(project):
        return
    raise HTTPException(status_code=400, detail="Block files are only supported for Pybricks projects")


def _cross_origin_isolation_enabled() -> bool:
    raw = os.getenv("PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION", "true")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _cross_origin_isolation_exempt_path(path: str) -> bool:
    normalized_path = (path or "").rstrip("/") or "/"
    exempt_paths = {"/", "/welcome", "/login", "/register", "/support"}
    return normalized_path in exempt_paths or normalized_path.startswith("/support/")


def _apply_cross_origin_isolation_headers(response, request_path: str = ""):
    if _cross_origin_isolation_enabled() and not _cross_origin_isolation_exempt_path(request_path):
        response.headers["Cross-Origin-Opener-Policy"] = COOP_VALUE
        response.headers["Cross-Origin-Embedder-Policy"] = COEP_VALUE
    return response


def _frontend_html_response(path: str, request_path: str):
    response = FileResponse(path)
    response.headers["Cache-Control"] = "no-store"
    return _apply_cross_origin_isolation_headers(response, request_path=request_path)


@app.on_event("startup")
def startup_db_client():
    isolation_enabled = _cross_origin_isolation_enabled()
    logger.info(
        "Cross-origin isolation headers enabled=%s COOP=%s COEP=%s",
        isolation_enabled,
        COOP_VALUE if isolation_enabled else "disabled",
        COEP_VALUE if isolation_enabled else "disabled",
    )
    logger.info("Pyodide runtime config loaded: %s", _runtime_pyodide_config())

    def _initialize_database() -> None:
        Base.metadata.create_all(bind=engine)

        # 1. Add columns if not exists (Migration)
        with engine.connect() as conn:
            # Check is_admin
            column_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT is_admin FROM users LIMIT 1"))
                trans.commit()
                column_exists = True
            except Exception:
                trans.rollback()
                column_exists = False

            if not column_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE"))
                    trans.commit()
                    print("Migration successful: Added is_admin column.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (is_admin): {e}")

            # password_plain migration removed

            # Check bio
            col_bio_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT bio FROM users LIMIT 1"))
                trans.commit()
                col_bio_exists = True
            except Exception:
                trans.rollback()
                col_bio_exists = False

            if not col_bio_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN bio TEXT"))
                    trans.commit()
                    print("Migration successful: Added bio column.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (bio): {e}")

            # Check user description
            col_user_description_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT description FROM users LIMIT 1"))
                trans.commit()
                col_user_description_exists = True
            except Exception:
                trans.rollback()
                col_user_description_exists = False

            if not col_user_description_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN description TEXT"))
                    trans.commit()
                    print("Migration successful: Added description column to users.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (user_description): {e}")

            # Check user links
            col_user_links_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT links FROM users LIMIT 1"))
                trans.commit()
                col_user_links_exists = True
            except Exception:
                trans.rollback()
                col_user_links_exists = False

            if not col_user_links_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN links TEXT"))
                    trans.commit()
                    print("Migration successful: Added links column to users.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (user_links): {e}")

            # Check profile_picture_path
            col_pfp_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT profile_picture_path FROM users LIMIT 1"))
                trans.commit()
                col_pfp_exists = True
            except Exception:
                trans.rollback()
                col_pfp_exists = False

            if not col_pfp_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN profile_picture_path VARCHAR"))
                    trans.commit()
                    print("Migration successful: Added profile_picture_path column.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (profile_picture_path): {e}")

            # Check email
            col_email_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT email FROM users LIMIT 1"))
                trans.commit()
                col_email_exists = True
            except Exception:
                trans.rollback()
                col_email_exists = False

            if not col_email_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
                    trans.commit()
                    print("Migration successful: Added email column.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (email): {e}")

            trans = conn.begin()
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email)"))
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (uq_users_email): {e}")

            # Check email_verified
            col_email_verified_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT email_verified FROM users LIMIT 1"))
                trans.commit()
                col_email_verified_exists = True
            except Exception:
                trans.rollback()
                col_email_verified_exists = False

            if not col_email_verified_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE"))
                    trans.commit()
                    print("Migration successful: Added email_verified column.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (email_verified): {e}")

            trans = conn.begin()
            try:
                conn.execute(text("UPDATE users SET email_verified = FALSE WHERE email_verified IS NULL"))
                conn.execute(
                    text(
                        "UPDATE users SET email_verified = TRUE WHERE google_sub IS NOT NULL "
                        "AND email IS NOT NULL AND email_verified = FALSE"
                    )
                )
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (email_verified_backfill): {e}")

            # Check google_sub
            col_google_sub_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT google_sub FROM users LIMIT 1"))
                trans.commit()
                col_google_sub_exists = True
            except Exception:
                trans.rollback()
                col_google_sub_exists = False

            if not col_google_sub_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR"))
                    trans.commit()
                    print("Migration successful: Added google_sub column.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (google_sub): {e}")

            trans = conn.begin()
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users (google_sub)"))
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (uq_users_google_sub): {e}")

            # Check is_public on projects
            col_public_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT is_public FROM projects LIMIT 1"))
                trans.commit()
                col_public_exists = True
            except Exception:
                trans.rollback()
                col_public_exists = False

            if not col_public_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN is_public BOOLEAN DEFAULT FALSE"))
                    trans.commit()
                    print("Migration successful: Added is_public column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (is_public): {e}")

            # Check description
            col_desc_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT description FROM projects LIMIT 1"))
                trans.commit()
                col_desc_exists = True
            except Exception:
                trans.rollback()
                col_desc_exists = False

            if not col_desc_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN description TEXT"))
                    trans.commit()
                    print("Migration successful: Added description column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (description): {e}")

            # Check project_type on projects
            col_project_type_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT project_type FROM projects LIMIT 1"))
                trans.commit()
                col_project_type_exists = True
            except Exception:
                trans.rollback()
                col_project_type_exists = False

            if not col_project_type_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN project_type VARCHAR DEFAULT 'normal'"))
                    conn.execute(text("UPDATE projects SET project_type = 'normal' WHERE project_type IS NULL OR project_type = ''"))
                    trans.commit()
                    print("Migration successful: Added project_type column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (project_type): {e}")

            trans = conn.begin()
            try:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_project_type ON projects (project_type)"))
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (ix_projects_project_type): {e}")

            # Check editor_mode on projects
            col_editor_mode_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT editor_mode FROM projects LIMIT 1"))
                trans.commit()
                col_editor_mode_exists = True
            except Exception:
                trans.rollback()
                col_editor_mode_exists = False

            if not col_editor_mode_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN editor_mode VARCHAR DEFAULT 'text'"))
                    conn.execute(
                        text(
                            "UPDATE projects SET editor_mode = 'text' "
                            "WHERE editor_mode IS NULL OR editor_mode = ''"
                        )
                    )
                    trans.commit()
                    print("Migration successful: Added editor_mode column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (editor_mode): {e}")

            # Check entry_block_document_id on projects
            col_entry_block_document_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT entry_block_document_id FROM projects LIMIT 1"))
                trans.commit()
                col_entry_block_document_exists = True
            except Exception:
                trans.rollback()
                col_entry_block_document_exists = False

            if not col_entry_block_document_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN entry_block_document_id INTEGER"))
                    trans.commit()
                    print("Migration successful: Added entry_block_document_id column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (entry_block_document_id): {e}")

            trans = conn.begin()
            try:
                conn.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS project_block_documents ("
                        "id INTEGER PRIMARY KEY, "
                        "project_id INTEGER NOT NULL, "
                        "name VARCHAR NOT NULL, "
                        "workspace_json TEXT NOT NULL DEFAULT '{}', "
                        "workspace_version INTEGER NOT NULL DEFAULT 1, "
                        "generated_entry_module VARCHAR NOT NULL DEFAULT 'main.py', "
                        "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                        "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                        "FOREIGN KEY(project_id) REFERENCES projects(id)"
                        ")"
                    )
                )
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_project_block_document_name "
                        "ON project_block_documents (project_id, name)"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_project_block_documents_project_id "
                        "ON project_block_documents (project_id)"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_projects_entry_block_document_id "
                        "ON projects (entry_block_document_id)"
                    )
                )
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (project_block_documents): {e}")

            # Check public_id on projects
            col_public_id_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT public_id FROM projects LIMIT 1"))
                trans.commit()
                col_public_id_exists = True
            except Exception:
                trans.rollback()
                col_public_id_exists = False

            if not col_public_id_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN public_id VARCHAR"))
                    trans.commit()
                    print("Migration successful: Added public_id column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (public_id): {e}")

            trans = conn.begin()
            try:
                rows_missing_public_id = conn.execute(
                    text("SELECT id FROM projects WHERE public_id IS NULL OR public_id = ''")
                ).fetchall()
                for row in rows_missing_public_id:
                    while True:
                        candidate = _generate_project_public_id()
                        existing = conn.execute(
                            text("SELECT 1 FROM projects WHERE public_id = :public_id LIMIT 1"),
                            {"public_id": candidate},
                        ).fetchone()
                        if existing:
                            continue
                        conn.execute(
                            text("UPDATE projects SET public_id = :public_id WHERE id = :project_id"),
                            {"public_id": candidate, "project_id": row[0]},
                        )
                        break
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (public_id_backfill): {e}")

            trans = conn.begin()
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_public_id ON projects (public_id)"))
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (uq_projects_public_id): {e}")

            # Check share_pin on projects
            col_share_pin_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT share_pin FROM projects LIMIT 1"))
                trans.commit()
                col_share_pin_exists = True
            except Exception:
                trans.rollback()
                col_share_pin_exists = False

            if not col_share_pin_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN share_pin VARCHAR"))
                    trans.commit()
                    print("Migration successful: Added share_pin column to projects.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (share_pin): {e}")

                trans = conn.begin()
                try:
                    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_share_pin ON projects (share_pin)"))
                    trans.commit()
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (uq_projects_share_pin): {e}")

            # Check assigned_to_user_id on project_tasks
            col_task_assigned_user_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT assigned_to_user_id FROM project_tasks LIMIT 1"))
                trans.commit()
                col_task_assigned_user_exists = True
            except Exception:
                trans.rollback()
                col_task_assigned_user_exists = False

            if not col_task_assigned_user_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE project_tasks ADD COLUMN assigned_to_user_id INTEGER"))
                    trans.commit()
                    print("Migration successful: Added assigned_to_user_id column to project_tasks.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (assigned_to_user_id): {e}")

            # Check assigned_to_name on project_tasks
            col_task_assigned_name_exists = False
            trans = conn.begin()
            try:
                conn.execute(text("SELECT assigned_to_name FROM project_tasks LIMIT 1"))
                trans.commit()
                col_task_assigned_name_exists = True
            except Exception:
                trans.rollback()
                col_task_assigned_name_exists = False

            if not col_task_assigned_name_exists:
                trans = conn.begin()
                try:
                    conn.execute(text("ALTER TABLE project_tasks ADD COLUMN assigned_to_name VARCHAR"))
                    trans.commit()
                    print("Migration successful: Added assigned_to_name column to project_tasks.")
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (assigned_to_name): {e}")

            trans = conn.begin()
            try:
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_project_tasks_assigned_to_user_id ON project_tasks (assigned_to_user_id)"))
                trans.commit()
            except Exception as e:
                trans.rollback()
                print(f"Migration warning (ix_project_tasks_assigned_to_user_id): {e}")

            # Sync PostgreSQL sequences for all tables with auto-increment integer PKs.
            # This prevents UniqueViolation errors when the sequence value falls behind
            # the actual maximum id (e.g. after data imports or manual inserts).
            if DATABASE_URL.startswith("postgresql"):
                _tables_with_serial_pk = [
                    "users", "projects", "project_files", "project_collaborators",
                    "project_share_tokens", "project_tasks", "project_snapshots",
                    "project_snapshot_files", "project_block_documents",
                ]
                trans = conn.begin()
                try:
                    for _tbl in _tables_with_serial_pk:
                        conn.execute(text(
                            f"SELECT setval(pg_get_serial_sequence('{_tbl}', 'id'), "
                            f"COALESCE((SELECT MAX(id) FROM {_tbl}), 1), true)"
                        ))
                    trans.commit()
                except Exception as e:
                    trans.rollback()
                    print(f"Migration warning (sync_sequences): {e}")

        # 2. Ensure admin user 'adam' exists
        db = SessionLocal()
        try:
            try:
                adam = db.query(models.User).filter(models.User.username == "adam").first()
                if not adam:
                    hashed = auth.get_password_hash("adam")
                    adam = models.User(username="adam", password_hash=hashed, display_name="Adam (Admin)", is_admin=True)
                    db.add(adam)
                    db.commit()
                elif not adam.is_admin:
                    adam.is_admin = True
                    db.commit()

                # 3. Purge guest users (Deprecation of Guest Feature)
                # Explicitly delete dependent data to avoid NotNullViolation on owner_id
                guests = db.query(models.User).filter(models.User.username.like("guest-%")).all()
                for guest in guests:
                    # Manually delete projects to ensure files/collabs/tokens are cleared via cascade
                    for project in guest.projects:
                        db.delete(project)
                    # Delete their collaborations in other projects
                    for collab in guest.collaborations:
                        db.delete(collab)
                    # Finally delete the user
                    db.delete(guest)
                if guests:
                    db.commit()
                    print(f"Purged {len(guests)} guest users and their projects.")
            except Exception as exc:
                db.rollback()
                logger.warning("Startup user bootstrap skipped: %s", exc)
        finally:
            db.close()

    _run_db_startup_step("database initialization", _initialize_database)


@app.on_event("startup")
async def start_presence_reaper():
    async def _presence_reaper():
        while True:
            await asyncio.sleep(PRESENCE_CHECK_INTERVAL_SECONDS)
            now = dt.datetime.utcnow()
            stale_users = message_presence.reap_stale(now)
            if not stale_users:
                continue
            db = SessionLocal()
            try:
                for user_id in stale_users:
                    _set_presence_row(db, user_id, "offline", now)
                db.commit()
            finally:
                db.close()
            for user_id in stale_users:
                await _broadcast_presence_update(user_id)

    asyncio.create_task(_presence_reaper())


@app.middleware("http")
async def add_cross_origin_isolation_headers(request: Request, call_next):
    response = await call_next(request)
    return _apply_cross_origin_isolation_headers(response, request_path=request.url.path)


@app.middleware("http")
async def spa_fallback(request: Request, call_next):
    """
    Serve the built SPA for direct browser navigations (Accept: text/html) so
    that deep links like /projects/:id return index.html instead of hitting API routes.
    """
    spa_passthrough_prefixes = (
        "/docs",
        "/redoc",
        "/openapi",
        "/static",
        "/assets",
        "/vendor",
        "/socket.io",
        "/admin/api",
        "/support",
        "/pybricks-blocks-host",
        "/uploads",
    )
    if (
        request.method == "GET"
        and "text/html" in request.headers.get("accept", "")
        and os.path.exists(INDEX_FILE)
        and not request.url.path.startswith(spa_passthrough_prefixes)
    ):
        return _frontend_html_response(INDEX_FILE, request_path=request.url.path)
    return await call_next(request)


@app.get("/favicon.ico")
async def favicon():
    return _apply_cross_origin_isolation_headers(FileResponse(FAVICON_FILE), request_path="/favicon.ico")


def _get_project_by_ref(db: Session, project_ref: int | str) -> Optional[models.Project]:
    normalized_ref = str(project_ref).strip()
    if not normalized_ref:
        return None
    project = db.query(models.Project).filter(models.Project.public_id == normalized_ref).first()
    if project is not None:
        return project
    if normalized_ref.isdigit():
        return db.query(models.Project).filter(models.Project.id == int(normalized_ref)).first()
    return None


def _ensure_project_access(db: Session, project_ref: int | str, user: models.User, require_write: bool = False) -> models.Project:
    project = _get_project_by_ref(db, project_ref)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project_id = project.id
    is_owner = project.owner_id == user.id
    is_collab = (
        db.query(models.ProjectCollaborator)
        .filter(models.ProjectCollaborator.project_id == project_id, models.ProjectCollaborator.user_id == user.id)
        .first()
        is not None
    )
    
    # If admin, always allowed (writes included)
    if user.is_admin:
        return project
        
    # If write is required, must be owner or collaborator
    if require_write:
        if not (is_owner or is_collab):
            raise HTTPException(status_code=403, detail="Write permissions required")
        return project
        
    # If read/run (no write), public is okay
    if project.is_public and not (is_owner or is_collab):
        return project # Allowed read-only

    if not (is_owner or is_collab):
        raise HTTPException(status_code=403, detail="Not allowed")
    return project

def check_admin(user: models.User = Depends(get_current_user)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def _delete_user_dependencies(db: Session, user_id: int):
    # Clean up conversations and messages first to satisfy FK constraints.
    conversation_ids = [
        cid
        for (cid,) in (
            db.query(models.Conversation.id)
            .filter(
                or_(
                    models.Conversation.user_a_id == user_id,
                    models.Conversation.user_b_id == user_id,
                )
            )
            .all()
        )
    ]
    if conversation_ids:
        db.query(models.Message).filter(models.Message.conversation_id.in_(conversation_ids)).delete(
            synchronize_session=False
        )
        db.query(models.Conversation).filter(models.Conversation.id.in_(conversation_ids)).delete(
            synchronize_session=False
        )

    # Defensive cleanup if any user-authored messages exist outside removed conversations.
    db.query(models.Message).filter(models.Message.sender_id == user_id).delete(synchronize_session=False)

    owned_project_ids = [
        pid for (pid,) in db.query(models.Project.id).filter(models.Project.owner_id == user_id).all()
    ]
    if owned_project_ids:
        db.query(models.ProjectBlockDocument).filter(
            models.ProjectBlockDocument.project_id.in_(owned_project_ids)
        ).delete(synchronize_session=False)
        snapshot_ids = [
            sid
            for (sid,) in db.query(models.ProjectSnapshot.id).filter(
                models.ProjectSnapshot.project_id.in_(owned_project_ids)
            ).all()
        ]
        if snapshot_ids:
            db.query(models.ProjectSnapshotFile).filter(
                models.ProjectSnapshotFile.snapshot_id.in_(snapshot_ids)
            ).delete(synchronize_session=False)
        db.query(models.ProjectSnapshot).filter(
            models.ProjectSnapshot.project_id.in_(owned_project_ids)
        ).delete(synchronize_session=False)
        db.query(models.ProjectTask).filter(
            models.ProjectTask.project_id.in_(owned_project_ids)
        ).delete(synchronize_session=False)
        db.query(models.ProjectShareToken).filter(
            models.ProjectShareToken.project_id.in_(owned_project_ids)
        ).delete(synchronize_session=False)
        db.query(models.ProjectCollaborator).filter(
            models.ProjectCollaborator.project_id.in_(owned_project_ids)
        ).delete(synchronize_session=False)
        db.query(models.ProjectFile).filter(models.ProjectFile.project_id.in_(owned_project_ids)).delete(
            synchronize_session=False
        )
        db.query(models.Project).filter(models.Project.id.in_(owned_project_ids)).delete(
            synchronize_session=False
        )

    # Remove collaborator rows where the user is not owner.
    db.query(models.ProjectCollaborator).filter(
        models.ProjectCollaborator.user_id == user_id
    ).delete(synchronize_session=False)

    db.query(models.Follow).filter(
        or_(models.Follow.follower_id == user_id, models.Follow.followed_id == user_id)
    ).delete(synchronize_session=False)
    db.query(models.Block).filter(
        or_(models.Block.blocker_id == user_id, models.Block.blocked_id == user_id)
    ).delete(synchronize_session=False)
    db.query(models.Presence).filter(models.Presence.user_id == user_id).delete(synchronize_session=False)
    db.query(models.UserCredential).filter(models.UserCredential.user_id == user_id).delete(
        synchronize_session=False
    )


def _delete_user_account(db: Session, user: models.User):
    _delete_user_dependencies(db, user.id)
    db.delete(user)


# --- Admin Routes ---

@app.get("/admin/api/users", response_model=List[schemas.AdminUserOut])
@app.get("/admin/users", response_model=List[schemas.AdminUserOut])
def admin_list_users(current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    return db.query(models.User).all()

@app.patch("/admin/api/users/{user_id}", response_model=schemas.AdminUserOut)
@app.patch("/admin/users/{user_id}", response_model=schemas.AdminUserOut)
def admin_update_user(user_id: int, user_in: schemas.AdminUserUpdate, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user_in.username is not None:
        user.username = user_in.username
    if user_in.display_name is not None:
        user.display_name = user_in.display_name
    if user_in.password is not None:
        user.password_hash = auth.get_password_hash(user_in.password)
        # user.password_plain = user_in.password
    db.commit()
    db.refresh(user)
    return user

@app.delete("/admin/api/users/{user_id}")
@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account from admin panel")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == "adam":
        raise HTTPException(status_code=400, detail="Cannot delete protected admin account")
    _delete_user_account(db, user)
    db.commit()
    return {"status": "deleted"}

@app.get("/admin/api/projects", response_model=List[schemas.ProjectOut])
@app.get("/admin/projects", response_model=List[schemas.ProjectOut])
def admin_list_projects(current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    return _enrich_projects_with_owner(db, db.query(models.Project).all())

@app.get("/admin/api/projects/{project_id}", response_model=schemas.ProjectOut)
@app.get("/admin/projects/{project_id}", response_model=schemas.ProjectOut)
def admin_get_project(project_id: int, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_payload(db, project)

@app.delete("/admin/api/projects/{project_id}")
@app.delete("/admin/projects/{project_id}")
def admin_delete_project(project_id: int, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"status": "deleted"}

@app.patch("/admin/api/projects/{project_id}/files/{file_id}", response_model=schemas.ProjectFileOut)
@app.patch("/admin/projects/{project_id}/files/{file_id}", response_model=schemas.ProjectFileOut)
def admin_update_file(project_id: int, file_id: int, file_in: schemas.FileUpdate, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    pf = db.query(models.ProjectFile).filter(models.ProjectFile.id == file_id, models.ProjectFile.project_id == project_id).first()
    if not pf:
        raise HTTPException(status_code=404, detail="File not found")
    if file_in.name is not None:
        pf.name = file_in.name
    if file_in.content is not None:
        pf.content = file_in.content
    db.commit()
    db.refresh(pf)
    return pf

@app.post("/admin/api/impersonate/{user_id}", response_model=schemas.TokenResponse)
@app.post("/admin/impersonate/{user_id}", response_model=schemas.TokenResponse)
def admin_impersonate(user_id: int, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot impersonate your own account")
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Create token with impersonator claim
    token = auth.create_access_token({"sub": target.id, "impersonator_id": current_user.id})
    print(f"[AUDIT] Admin {current_user.username} started impersonating {target.username}")
    return schemas.TokenResponse(access_token=token, user=target)

# --- End Admin Routes ---


@app.post("/auth/register", response_model=schemas.TokenResponse)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    import re
    username = _normalize_username(user_in.username)
    # Validate username format: only a-z and 0-9
    if not re.match(r'^[a-z0-9]+$', username):
        raise HTTPException(status_code=400, detail="Username can only contain letters (a-z) and/or numbers (0-9)")
    existing = (
        db.query(models.User)
        .filter(func.lower(models.User.username) == username)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed = auth.get_password_hash(user_in.password)
    user = models.User(username=username, password_hash=hashed, display_name=user_in.display_name or username)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = auth.create_access_token({"sub": user.id})
    return schemas.TokenResponse(access_token=token, user=user)


@app.post("/auth/login", response_model=schemas.TokenResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = _normalize_username(form_data.username)
    user = (
        db.query(models.User)
        .filter(func.lower(models.User.username) == username)
        .first()
    )
    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    token = auth.create_access_token({"sub": user.id})
    return schemas.TokenResponse(access_token=token, user=user)


@app.post("/auth/google/start", response_model=schemas.GoogleAuthStartResponse)
def google_auth_start(body: schemas.GoogleAuthStartRequest, db: Session = Depends(get_db)):
    claims = _verify_google_claims(body.id_token)
    email = claims["email"]
    google_sub = claims["google_sub"]

    existing_by_sub = db.query(models.User).filter(models.User.google_sub == google_sub).first()
    if existing_by_sub:
        if existing_by_sub.email and existing_by_sub.email != email:
            raise HTTPException(status_code=409, detail="Google account is already linked to another email")
        existing_by_sub.email = email
        existing_by_sub.email_verified = True
        db.commit()
        db.refresh(existing_by_sub)
        token = auth.create_access_token({"sub": existing_by_sub.id})
        return schemas.GoogleAuthStartResponse(
            status="authenticated",
            access_token=token,
            token_type="bearer",
            user=existing_by_sub,
        )

    existing_by_email = db.query(models.User).filter(models.User.email == email).first()
    if existing_by_email:
        if existing_by_email.google_sub == google_sub:
            existing_by_email.email_verified = True
            db.commit()
            db.refresh(existing_by_email)
            token = auth.create_access_token({"sub": existing_by_email.id})
            return schemas.GoogleAuthStartResponse(
                status="authenticated",
                access_token=token,
                token_type="bearer",
                user=existing_by_email,
            )
        raise HTTPException(
            status_code=409,
            detail="Email is already in use. Log in to that account and verify with Google in Settings.",
        )

    signup_token = auth.create_google_signup_token(
        {
            "email": email,
            "google_sub": google_sub,
            "suggested_username": claims.get("suggested_username") or "user",
            "suggested_display_name": claims.get("suggested_display_name") or "User",
        }
    )
    return schemas.GoogleAuthStartResponse(
        status="needs_profile",
        signup_token=signup_token,
        suggested_username=claims.get("suggested_username") or "user",
        suggested_display_name=claims.get("suggested_display_name") or "User",
    )


@app.post("/auth/google/complete-signup", response_model=schemas.TokenResponse)
def google_complete_signup(body: schemas.GoogleSignupCompleteRequest, db: Session = Depends(get_db)):
    try:
        payload = auth.decode_google_signup_token(body.signup_token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired signup token")

    email = (payload.get("email") or "").strip().lower()
    google_sub = str(payload.get("google_sub") or "").strip()
    if not email or not google_sub:
        raise HTTPException(status_code=400, detail="Invalid signup token payload")

    username = _normalize_username(body.username)
    if not re.match(r"^[a-z0-9]+$", username):
        raise HTTPException(status_code=400, detail="Username can only contain letters (a-z) and/or numbers (0-9)")
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    existing_by_sub = db.query(models.User).filter(models.User.google_sub == google_sub).first()
    if existing_by_sub:
        if existing_by_sub.email and existing_by_sub.email != email:
            raise HTTPException(status_code=409, detail="Google account is already linked to another email")
        existing_by_sub.email = email
        existing_by_sub.email_verified = True
        db.commit()
        db.refresh(existing_by_sub)
        token = auth.create_access_token({"sub": existing_by_sub.id})
        return schemas.TokenResponse(access_token=token, user=existing_by_sub)

    existing_by_email = db.query(models.User).filter(models.User.email == email).first()
    if existing_by_email:
        if existing_by_email.google_sub == google_sub:
            existing_by_email.email_verified = True
            db.commit()
            db.refresh(existing_by_email)
            token = auth.create_access_token({"sub": existing_by_email.id})
            return schemas.TokenResponse(access_token=token, user=existing_by_email)
        raise HTTPException(
            status_code=409,
            detail="Email is already in use. Log in to that account and verify with Google in Settings.",
        )

    existing_username = (
        db.query(models.User)
        .filter(func.lower(models.User.username) == username)
        .first()
    )
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already registered")

    display_name = body.display_name.strip() or username
    password_hash = auth.get_password_hash(secrets.token_urlsafe(48))
    user = models.User(
        username=username,
        display_name=display_name,
        password_hash=password_hash,
        email=email,
        email_verified=True,
        google_sub=google_sub,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Unable to complete signup")
    db.refresh(user)

    token = auth.create_access_token({"sub": user.id})
    return schemas.TokenResponse(access_token=token, user=user)


# --- Passkey (WebAuthn) Routes ---


@app.post("/auth/passkey/register/options")
def passkey_register_options(
    request: Request,
    body: schemas.PasskeyRegisterStart = schemas.PasskeyRegisterStart(),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing_creds = (
        db.query(models.UserCredential)
        .filter(models.UserCredential.user_id == current_user.id)
        .all()
    )
    existing_ids = [c.credential_id for c in existing_creds]
    options = passkey_module.create_registration_options(
        user_id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        existing_credential_ids=existing_ids,
        request_host=request.headers.get("host"),
    )
    from webauthn import options_to_json
    return json.loads(options_to_json(options))


@app.post("/auth/passkey/register/complete")
def passkey_register_complete(
    request: Request,
    request_body: dict,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        verified = passkey_module.verify_registration(
            user_id=current_user.id,
            credential_json=json.dumps(request_body),
            request_host=request.headers.get("host"),
            request_origin=request.headers.get("origin"),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    device_name = str(request_body.get("device_name", "Passkey"))[:64] or "Passkey"
    cred = models.UserCredential(
        user_id=current_user.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        device_name=device_name,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return {"status": "ok", "credential_id": cred.id}


@app.post("/auth/passkey/login/options")
def passkey_login_options(request: Request):
    # For discoverable credentials (passkeys), we don't need allow_credentials
    options = passkey_module.create_authentication_options(
        credential_ids=[],
        request_host=request.headers.get("host"),
    )
    from webauthn import options_to_json
    return json.loads(options_to_json(options))


@app.post("/auth/passkey/login/complete", response_model=schemas.TokenResponse)
def passkey_login_complete(request: Request, request_body: dict, db: Session = Depends(get_db)):
    from webauthn.helpers import base64url_to_bytes

    raw_id = request_body.get("rawId") or request_body.get("id", "")
    try:
        cred_id_bytes = base64url_to_bytes(raw_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid credential")

    stored = (
        db.query(models.UserCredential)
        .filter(models.UserCredential.credential_id == cred_id_bytes)
        .first()
    )
    if not stored:
        raise HTTPException(status_code=400, detail="Credential not recognized")

    # Extract challenge from clientDataJSON to look up stored challenge
    import base64
    client_data_b64 = request_body.get("response", {}).get("clientDataJSON", "")
    try:
        client_data = json.loads(base64.urlsafe_b64decode(client_data_b64 + "=="))
        challenge_from_client = client_data.get("challenge", "")
        # Convert base64url challenge to hex for lookup
        challenge_bytes = base64url_to_bytes(challenge_from_client)
        challenge_hex = challenge_bytes.hex()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid credential data")

    try:
        verification = passkey_module.verify_authentication(
            credential_json=json.dumps(request_body),
            challenge_hex=challenge_hex,
            credential_public_key=stored.public_key,
            credential_current_sign_count=stored.sign_count,
            request_host=request.headers.get("host"),
            request_origin=request.headers.get("origin"),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Update sign count
    stored.sign_count = verification.new_sign_count
    db.commit()

    user = db.query(models.User).filter(models.User.id == stored.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    token = auth.create_access_token({"sub": user.id})
    return schemas.TokenResponse(access_token=token, user=user)


@app.get("/auth/passkey/credentials", response_model=List[schemas.PasskeyCredentialOut])
def list_passkey_credentials(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    creds = (
        db.query(models.UserCredential)
        .filter(models.UserCredential.user_id == current_user.id)
        .order_by(models.UserCredential.created_at.desc())
        .all()
    )
    return creds


@app.delete("/auth/passkey/credentials/{credential_id}")
def delete_passkey_credential(
    credential_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cred = (
        db.query(models.UserCredential)
        .filter(
            models.UserCredential.id == credential_id,
            models.UserCredential.user_id == current_user.id,
        )
        .first()
    )
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    db.delete(cred)
    db.commit()
    return {"status": "ok"}


# --- End Passkey Routes ---


def _to_user_me_out(user: models.User) -> schemas.UserMeOut:
    links = _decode_profile_links(user.links)
    return schemas.UserMeOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        is_admin=user.is_admin,
        bio=user.bio,
        description=user.description,
        links=links,
        profile_picture_path=user.profile_picture_path,
        email=user.email,
        email_verified=bool(user.email_verified),
        has_google=bool(user.google_sub),
    )


@app.get("/users/me", response_model=schemas.UserMeOut)
def get_me(current_user: models.User = Depends(get_current_user)):
    return _to_user_me_out(current_user)


@app.get("/projects", response_model=List[schemas.ProjectOut])
def list_projects(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    owned = db.query(models.Project).filter(models.Project.owner_id == current_user.id)
    collab_ids = [
        pc.project_id
        for pc in db.query(models.ProjectCollaborator).filter(models.ProjectCollaborator.user_id == current_user.id)
    ]
    shared = db.query(models.Project).filter(models.Project.id.in_(collab_ids))
    projects = owned.union(shared).all()
    return _enrich_projects_with_owner(db, projects)


@app.post("/projects", response_model=schemas.ProjectOut)
def create_project(project_in: schemas.ProjectCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = models.Project(
        name=project_in.name,
        project_type=project_in.project_type,
        editor_mode=_default_project_editor_mode(project_in.project_type),
        description=project_in.description,
        owner_id=current_user.id,
        is_public=project_in.is_public,
    )
    db.add(project)
    db.flush()
    if project.project_type == PROJECT_TYPE_PYBRICKS:
        _create_default_block_document(db, project)
    # default file
    default_file = models.ProjectFile(
        project_id=project.id,
        name="main.py",
        content=_project_starter_content(project.project_type),
    )
    db.add(default_file)
    db.commit()
    db.refresh(project)
    return _project_payload(db, project)


# --- IMPORTANT: These routes MUST be defined BEFORE /projects/{project_id} ---

# Helper to add owner_name to project
def _enrich_projects_with_owner(db: Session, projects):
    return [_project_payload(db, project) for project in projects]

@app.get("/projects/explore/all")
def explore_projects(db: Session = Depends(get_db)):
    projects = (
        db.query(models.Project)
        .filter(models.Project.is_public == True)
        .order_by(models.Project.updated_at.desc())
        .limit(50)
        .all()
    )
    return _enrich_projects_with_owner(db, projects)

@app.get("/projects/search")
def search_projects(q: str = "", db: Session = Depends(get_db)):
    if not q:
        return []
    pattern = f"%{q}%"
    projects = (
        db.query(models.Project)
        .filter(
            models.Project.is_public == True,
            (models.Project.name.ilike(pattern) | models.Project.description.ilike(pattern))
        )
        .order_by(models.Project.updated_at.desc())
        .limit(50)
        .all()
    )
    return _enrich_projects_with_owner(db, projects)
# --- End of specific routes ---


@app.get("/projects/{project_ref}", response_model=schemas.ProjectOut)
def get_project(project_ref: str, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _ensure_project_access(db, project_ref, current_user)
    return _project_payload(db, project)


@app.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, project_in: schemas.ProjectCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _ensure_project_access(db, project_id, current_user, require_write=True)
    project.name = project_in.name
    if project_in.description is not None:
        project.description = project_in.description
    db.commit()
    db.refresh(project)
    return _project_payload(db, project)


@app.post("/projects/{project_id}/duplicate", response_model=schemas.ProjectOut)
def duplicate_project(
    project_id: int,
    payload: Optional[schemas.ProjectDuplicateRequest] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    source_project = _ensure_project_access(db, project_id, current_user)

    duplicate_name = ((payload.name if payload else None) or f"{source_project.name} Copy").strip()
    if not duplicate_name:
        raise HTTPException(status_code=400, detail="Project name is required")

    duplicated_project = models.Project(
        name=duplicate_name,
        project_type=source_project.project_type or PROJECT_TYPE_NORMAL,
        editor_mode=source_project.editor_mode or _default_project_editor_mode(source_project.project_type or PROJECT_TYPE_NORMAL),
        description=source_project.description,
        owner_id=current_user.id,
        is_public=False,
    )
    db.add(duplicated_project)
    db.flush()

    source_files = (
        db.query(models.ProjectFile)
        .filter(models.ProjectFile.project_id == source_project.id)
        .all()
    )
    for source_file in source_files:
        db.add(
            models.ProjectFile(
                project_id=duplicated_project.id,
                name=source_file.name,
                content=source_file.content or "",
            )
        )

    source_block_documents = (
        db.query(models.ProjectBlockDocument)
        .filter(models.ProjectBlockDocument.project_id == source_project.id)
        .all()
    )
    duplicated_entry_block_document_id = None
    for source_block_document in source_block_documents:
        duplicated_block_document = models.ProjectBlockDocument(
            project_id=duplicated_project.id,
            name=source_block_document.name,
            workspace_json=source_block_document.workspace_json or "{}",
            workspace_version=source_block_document.workspace_version or BLOCK_WORKSPACE_VERSION,
            generated_entry_module=source_block_document.generated_entry_module or "main.py",
        )
        db.add(duplicated_block_document)
        db.flush()
        if source_project.entry_block_document_id == source_block_document.id:
            duplicated_entry_block_document_id = duplicated_block_document.id

    if duplicated_entry_block_document_id is not None:
        duplicated_project.entry_block_document_id = duplicated_entry_block_document_id

    db.commit()
    db.refresh(duplicated_project)
    return _project_payload(db, duplicated_project)


@app.delete("/projects/{project_id}")
def delete_project(project_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _ensure_project_access(db, project_id, current_user, require_write=True)
    db.delete(project)
    db.commit()
    return {"status": "deleted"}


@app.post("/projects/{project_id}/files", response_model=schemas.ProjectFileOut)
def add_file(project_id: int, file_in: schemas.FileCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    pf = models.ProjectFile(project_id=project_id, name=file_in.name, content=file_in.content or "")
    db.add(pf)
    db.commit()
    db.refresh(pf)
    return pf


@app.post("/projects/{project_id}/block-documents", response_model=schemas.ProjectBlockDocumentOut)
def add_block_document(
    project_id: int,
    document_in: schemas.ProjectBlockDocumentCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _ensure_project_access(db, project_id, current_user, require_write=True)
    _ensure_pybricks_project(project)
    document = models.ProjectBlockDocument(
        project_id=project_id,
        name=document_in.name,
        workspace_json=document_in.workspace_json or PYBRICKS_BLOCKS_STARTER,
        workspace_version=document_in.workspace_version or BLOCK_WORKSPACE_VERSION,
        generated_entry_module=document_in.generated_entry_module or _derive_block_entry_module(document_in.name),
    )
    db.add(document)
    db.flush()
    if project.entry_block_document_id is None:
        project.entry_block_document_id = document.id
    db.commit()
    db.refresh(document)
    return document


@app.patch("/projects/{project_id}/files/{file_id}", response_model=schemas.ProjectFileOut)
def update_file(project_id: int, file_id: int, file_in: schemas.FileUpdate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    pf = db.query(models.ProjectFile).filter(models.ProjectFile.id == file_id, models.ProjectFile.project_id == project_id).first()
    if not pf:
        raise HTTPException(status_code=404, detail="File not found")
    if file_in.name is not None:
        pf.name = file_in.name
    if file_in.content is not None:
        pf.content = file_in.content
    db.commit()
    db.refresh(pf)
    return pf


@app.delete("/projects/{project_id}/files/{file_id}")
def delete_file(project_id: int, file_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    pf = db.query(models.ProjectFile).filter(models.ProjectFile.id == file_id, models.ProjectFile.project_id == project_id).first()
    if not pf:
        raise HTTPException(status_code=404, detail="File not found")
    db.delete(pf)
    db.commit()
    return {"status": "deleted"}


@app.patch("/projects/{project_id}/block-documents/{document_id}", response_model=schemas.ProjectBlockDocumentOut)
def update_block_document(
    project_id: int,
    document_id: int,
    document_in: schemas.ProjectBlockDocumentUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _ensure_project_access(db, project_id, current_user, require_write=True)
    _ensure_pybricks_project(project)
    document = (
        db.query(models.ProjectBlockDocument)
        .filter(
            models.ProjectBlockDocument.id == document_id,
            models.ProjectBlockDocument.project_id == project_id,
        )
        .first()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Block document not found")
    if document_in.name is not None:
        document.name = document_in.name
        if document_in.generated_entry_module is None:
            document.generated_entry_module = _derive_block_entry_module(document_in.name)
    if document_in.workspace_json is not None:
        document.workspace_json = document_in.workspace_json
    if document_in.workspace_version is not None:
        document.workspace_version = document_in.workspace_version
    if document_in.generated_entry_module is not None:
        document.generated_entry_module = document_in.generated_entry_module
    db.commit()
    db.refresh(document)
    return document


@app.delete("/projects/{project_id}/block-documents/{document_id}")
def delete_block_document(
    project_id: int,
    document_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _ensure_project_access(db, project_id, current_user, require_write=True)
    _ensure_pybricks_project(project)
    document = (
        db.query(models.ProjectBlockDocument)
        .filter(
            models.ProjectBlockDocument.id == document_id,
            models.ProjectBlockDocument.project_id == project_id,
        )
        .first()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Block document not found")

    db.delete(document)
    db.flush()

    if project.entry_block_document_id == document_id:
        replacement = (
            db.query(models.ProjectBlockDocument)
            .filter(models.ProjectBlockDocument.project_id == project_id)
            .order_by(models.ProjectBlockDocument.created_at.asc(), models.ProjectBlockDocument.id.asc())
            .first()
        )
        project.entry_block_document_id = replacement.id if replacement else None

    db.commit()
    return {"status": "deleted"}


def _project_task_query(db: Session, project_id: int):
    return (
        db.query(models.ProjectTask)
        .filter(models.ProjectTask.project_id == project_id)
        .order_by(models.ProjectTask.is_done.asc(), models.ProjectTask.created_at.desc(), models.ProjectTask.id.desc())
    )


def _project_task_payload(task: models.ProjectTask) -> Dict[str, Any]:
    return schemas.ProjectTaskOut.model_validate(task).model_dump(mode="json")


def _resolve_task_assignee(
    db: Session,
    project_id: int,
    assignee_user_id: Optional[int],
) -> tuple[Optional[int], Optional[str]]:
    if assignee_user_id is None:
        return None, None

    user = db.query(models.User).filter(models.User.id == assignee_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Assignee user not found")

    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    is_owner = project.owner_id == user.id
    is_collaborator = (
        db.query(models.ProjectCollaborator)
        .filter(models.ProjectCollaborator.project_id == project_id, models.ProjectCollaborator.user_id == user.id)
        .first()
        is not None
    )
    if not (is_owner or is_collaborator or user.is_admin):
        raise HTTPException(status_code=400, detail="Assignee must have project access")

    assignee_name = (user.display_name or user.username).strip() or user.username
    return user.id, assignee_name


@app.get("/projects/{project_id}/tasks", response_model=List[schemas.ProjectTaskOut])
def list_project_tasks(
    project_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user)
    return _project_task_query(db, project_id).all()


@app.post("/projects/{project_id}/tasks", response_model=schemas.ProjectTaskOut)
async def create_project_task(
    project_id: int,
    task_in: schemas.ProjectTaskCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    content = (task_in.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Task content is required")
    if len(content) > 240:
        raise HTTPException(status_code=400, detail="Task content is too long (max 240 characters)")

    actor_name = (current_user.display_name or current_user.username).strip() or current_user.username
    task = models.ProjectTask(
        project_id=project_id,
        content=content,
        is_done=False,
        created_by_user_id=current_user.id,
        created_by_name=actor_name,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    await sio.emit(
        "task_created",
        {"projectId": project_id, "task": _project_task_payload(task)},
        room=f"project_{project_id}",
    )
    return task


@app.patch("/projects/{project_id}/tasks/{task_id}", response_model=schemas.ProjectTaskOut)
async def update_project_task(
    project_id: int,
    task_id: int,
    task_in: schemas.ProjectTaskUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    task = (
        db.query(models.ProjectTask)
        .filter(models.ProjectTask.id == task_id, models.ProjectTask.project_id == project_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    changed = False
    if task_in.content is not None:
        content = task_in.content.strip()
        if not content:
            raise HTTPException(status_code=400, detail="Task content is required")
        if len(content) > 240:
            raise HTTPException(status_code=400, detail="Task content is too long (max 240 characters)")
        if content != task.content:
            task.content = content
            changed = True

    if task_in.is_done is not None and task_in.is_done != task.is_done:
        changed = True
        task.is_done = task_in.is_done
        if task.is_done:
            task.completed_at = dt.datetime.utcnow()
            task.completed_by_user_id = current_user.id
            task.completed_by_name = (current_user.display_name or current_user.username).strip() or current_user.username
        else:
            task.completed_at = None
            task.completed_by_user_id = None
            task.completed_by_name = None

    if "assigned_to_user_id" in task_in.model_fields_set:
        if isinstance(task_in.assigned_to_user_id, bool):
            raise HTTPException(status_code=400, detail="Invalid assignee user id")
        next_assignee_user_id, next_assignee_name = _resolve_task_assignee(
            db,
            project_id,
            task_in.assigned_to_user_id,
        )
        if (
            task.assigned_to_user_id != next_assignee_user_id
            or task.assigned_to_name != next_assignee_name
        ):
            task.assigned_to_user_id = next_assignee_user_id
            task.assigned_to_name = next_assignee_name
            changed = True

    if changed:
        db.commit()
        db.refresh(task)

        await sio.emit(
            "task_updated",
            {"projectId": project_id, "task": _project_task_payload(task)},
            room=f"project_{project_id}",
        )

    return task


@app.delete("/projects/{project_id}/tasks/{task_id}")
async def delete_project_task(
    project_id: int,
    task_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    task = (
        db.query(models.ProjectTask)
        .filter(models.ProjectTask.id == task_id, models.ProjectTask.project_id == project_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()

    await sio.emit(
        "task_deleted",
        {"projectId": project_id, "taskId": task_id},
        room=f"project_{project_id}",
    )

    return {"status": "deleted"}


def _project_snapshot_query(db: Session, project_id: int):
    return (
        db.query(models.ProjectSnapshot)
        .filter(models.ProjectSnapshot.project_id == project_id)
        .order_by(models.ProjectSnapshot.created_at.desc(), models.ProjectSnapshot.id.desc())
    )


def _project_snapshot_payload(snapshot: models.ProjectSnapshot) -> Dict[str, Any]:
    return {
        "id": snapshot.id,
        "project_id": snapshot.project_id,
        "name": snapshot.name,
        "created_by_user_id": snapshot.created_by_user_id,
        "created_by_name": snapshot.created_by_name,
        "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
        "file_count": len(snapshot.files or []),
    }


_ARCHIVE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _archive_safe_segment(value: str, fallback: str) -> str:
    normalized = _ARCHIVE_SEGMENT_RE.sub("-", (value or "").strip()).strip("._-")
    return normalized or fallback


def _archive_safe_file_parts(file_name: str) -> List[str]:
    raw_parts = [part for part in re.split(r"[\\/]+", (file_name or "").strip()) if part and part not in {".", ".."}]
    if not raw_parts:
        return ["file.py"]

    safe_parts: List[str] = []
    last_index = len(raw_parts) - 1
    for index, raw_part in enumerate(raw_parts):
        fallback = "file.py" if index == last_index else "folder"
        safe_part = _archive_safe_segment(raw_part, fallback)
        if index == last_index and not safe_part.lower().endswith(".py"):
            stem = os.path.splitext(safe_part)[0] or "file"
            safe_part = f"{stem}.py"
        safe_parts.append(safe_part)
    return safe_parts


def _dedupe_archive_path(path: str, used_paths: set[str]) -> str:
    if path not in used_paths:
        used_paths.add(path)
        return path

    stem, ext = os.path.splitext(path)
    suffix = 2
    candidate = f"{stem}-{suffix}{ext}"
    while candidate in used_paths:
        suffix += 1
        candidate = f"{stem}-{suffix}{ext}"
    used_paths.add(candidate)
    return candidate


@app.get("/projects/{project_id}/snapshots", response_model=List[schemas.ProjectSnapshotOut])
def list_project_snapshots(
    project_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user)
    snapshots = _project_snapshot_query(db, project_id).all()
    return [_project_snapshot_payload(snapshot) for snapshot in snapshots]


@app.get("/projects/{project_id}/snapshots/{snapshot_id}/export")
def export_project_snapshot(
    project_id: int,
    snapshot_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _ensure_project_access(db, project_id, current_user)
    snapshot = (
        db.query(models.ProjectSnapshot)
        .filter(models.ProjectSnapshot.project_id == project_id, models.ProjectSnapshot.id == snapshot_id)
        .first()
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    python_files = (
        db.query(models.ProjectSnapshotFile)
        .filter(models.ProjectSnapshotFile.snapshot_id == snapshot.id)
        .order_by(models.ProjectSnapshotFile.file_name.asc(), models.ProjectSnapshotFile.id.asc())
        .all()
    )
    python_files = [snapshot_file for snapshot_file in python_files if snapshot_file.file_name.lower().endswith(".py")]
    if not python_files:
        raise HTTPException(status_code=400, detail="No Python checkpoint files to export")

    archive_buffer = io.BytesIO()
    used_paths: set[str] = set()
    project_folder = _archive_safe_segment(project.name, "project")
    snapshot_folder = _archive_safe_segment(snapshot.name, f"checkpoint-{snapshot.id}")

    with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for snapshot_file in python_files:
            file_parts = _archive_safe_file_parts(snapshot_file.file_name)
            archive_path = "/".join([project_folder, snapshot_folder, *file_parts])
            archive_path = _dedupe_archive_path(archive_path, used_paths)
            archive.writestr(archive_path, snapshot_file.content or "")

    archive_filename = f"{project_folder}-{snapshot_folder}.zip"
    headers = {
        "Content-Disposition": f'attachment; filename="{archive_filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    }
    return Response(content=archive_buffer.getvalue(), media_type="application/zip", headers=headers)


@app.post("/projects/{project_id}/snapshots", response_model=schemas.ProjectSnapshotOut)
async def create_project_snapshot(
    project_id: int,
    body: schemas.ProjectSnapshotCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    snapshot_name = (body.name or "").strip()
    if not snapshot_name:
        snapshot_name = f"Checkpoint {dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}"
    if len(snapshot_name) > 120:
        raise HTTPException(status_code=400, detail="Snapshot name is too long (max 120 characters)")

    project_files = (
        db.query(models.ProjectFile)
        .filter(models.ProjectFile.project_id == project_id)
        .order_by(models.ProjectFile.created_at.asc(), models.ProjectFile.id.asc())
        .all()
    )
    actor_name = (current_user.display_name or current_user.username).strip() or current_user.username
    snapshot = models.ProjectSnapshot(
        project_id=project_id,
        name=snapshot_name,
        created_by_user_id=current_user.id,
        created_by_name=actor_name,
    )
    db.add(snapshot)
    db.flush()

    for project_file in project_files:
        in_memory = _file_states.get(project_file.id)
        content = in_memory.content if in_memory and in_memory.project_id == project_id else (project_file.content or "")
        db.add(
            models.ProjectSnapshotFile(
                snapshot_id=snapshot.id,
                file_name=project_file.name,
                content=content,
            )
        )
    db.commit()
    db.refresh(snapshot)

    payload = _project_snapshot_payload(snapshot)
    await sio.emit("snapshot_created", {"projectId": project_id, "snapshot": payload}, room=f"project_{project_id}")
    return payload


@app.post("/projects/{project_id}/snapshots/{snapshot_id}/restore")
async def restore_project_snapshot(
    project_id: int,
    snapshot_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    snapshot = (
        db.query(models.ProjectSnapshot)
        .filter(models.ProjectSnapshot.id == snapshot_id, models.ProjectSnapshot.project_id == project_id)
        .first()
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    snapshot_files = (
        db.query(models.ProjectSnapshotFile)
        .filter(models.ProjectSnapshotFile.snapshot_id == snapshot.id)
        .order_by(models.ProjectSnapshotFile.file_name.asc(), models.ProjectSnapshotFile.id.asc())
        .all()
    )
    if not snapshot_files:
        raise HTTPException(status_code=400, detail="Snapshot has no files")

    snapshot_names = {snapshot_file.file_name for snapshot_file in snapshot_files}
    existing_files = {
        project_file.name: project_file
        for project_file in db.query(models.ProjectFile).filter(models.ProjectFile.project_id == project_id).all()
    }

    removed_count = 0
    for file_name, project_file in list(existing_files.items()):
        if file_name in snapshot_names:
            continue
        state = _file_states.pop(project_file.id, None)
        if state and state.persist_task and not state.persist_task.done():
            state.persist_task.cancel()
        _file_locks.pop(project_file.id, None)
        db.delete(project_file)
        existing_files.pop(file_name, None)
        removed_count += 1

    touched: List[models.ProjectFile] = []
    for snapshot_file in snapshot_files:
        existing = existing_files.get(snapshot_file.file_name)
        if existing is None:
            existing = models.ProjectFile(
                project_id=project_id,
                name=snapshot_file.file_name,
                content=snapshot_file.content or "",
            )
            db.add(existing)
            db.flush()
            existing_files[snapshot_file.file_name] = existing
            touched.append(existing)
            continue

        new_content = snapshot_file.content or ""
        if (existing.content or "") != new_content:
            existing.content = new_content
            touched.append(existing)

    db.commit()

    project_files = (
        db.query(models.ProjectFile)
        .filter(models.ProjectFile.project_id == project_id)
        .order_by(models.ProjectFile.created_at.asc(), models.ProjectFile.id.asc())
        .all()
    )

    for project_file in project_files:
        lock = _file_locks.setdefault(project_file.id, asyncio.Lock())
        async with lock:
            state = _file_states.get(project_file.id)
            if not state or state.project_id != project_id:
                state = _FileSyncState(project_id=project_id, content=project_file.content or "")
                _file_states[project_file.id] = state
            else:
                if state.content != (project_file.content or ""):
                    state.rev += 1
                state.content = project_file.content or ""
            state.base_rev = state.rev
            state.ops = []

    # Broadcast the full room state so all collaborators get identical file lists/content.
    tasks = (
        db.query(models.ProjectTask)
        .filter(models.ProjectTask.project_id == project_id)
        .order_by(models.ProjectTask.is_done.asc(), models.ProjectTask.created_at.desc(), models.ProjectTask.id.desc())
        .all()
    )
    payload_files = []
    for project_file in project_files:
        state = _file_states.get(project_file.id)
        if not state or state.project_id != project_id:
            state = _FileSyncState(project_id=project_id, content=project_file.content or "")
            _file_states[project_file.id] = state
            _file_locks.setdefault(project_file.id, asyncio.Lock())
        payload_files.append(
            {
                "id": project_file.id,
                "name": project_file.name,
                "content": state.content,
                "rev": state.rev,
            }
        )
    payload_block_documents = []
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project and _project_supports_blocks(project):
        block_documents = (
            db.query(models.ProjectBlockDocument)
            .filter(models.ProjectBlockDocument.project_id == project_id)
            .order_by(models.ProjectBlockDocument.created_at.asc(), models.ProjectBlockDocument.id.asc())
            .all()
        )
        for block_document in block_documents:
            state = _block_states.get(block_document.id)
            if not state or state.project_id != project_id:
                state = _BlockSyncState(project_id=project_id, workspace_json=block_document.workspace_json or "{}")
                _block_states[block_document.id] = state
                _block_locks.setdefault(block_document.id, asyncio.Lock())
            payload_block_documents.append(_project_block_document_payload(block_document, rev=state.rev))
    payload_tasks = [_project_task_payload(task) for task in tasks]
    await sio.emit(
        "project_state",
        {"projectId": project_id, "files": payload_files, "blockDocuments": payload_block_documents, "tasks": payload_tasks},
        room=f"project_{project_id}",
    )

    await sio.emit(
        "snapshot_restored",
        {
            "projectId": project_id,
            "snapshot": _project_snapshot_payload(snapshot),
            "updatedFiles": len(touched) + removed_count,
            "restoredByUserId": current_user.id,
            "restoredByName": (current_user.display_name or current_user.username).strip() or current_user.username,
        },
        room=f"project_{project_id}",
    )

    return {"status": "restored", "updated_files": len(touched) + removed_count, "snapshot_id": snapshot.id}


@app.delete("/projects/{project_id}/snapshots/{snapshot_id}")
async def delete_project_snapshot(
    project_id: int,
    snapshot_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, project_id, current_user, require_write=True)
    snapshot = (
        db.query(models.ProjectSnapshot)
        .filter(models.ProjectSnapshot.id == snapshot_id, models.ProjectSnapshot.project_id == project_id)
        .first()
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(snapshot)
    db.commit()

    await sio.emit(
        "snapshot_deleted",
        {"projectId": project_id, "snapshotId": snapshot_id},
        room=f"project_{project_id}",
    )

    return {"status": "deleted"}


@app.post("/projects/{project_id}/share")
def create_share_token(project_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _ensure_project_access(db, project_id, current_user, require_write=True)
    project = (
        db.query(models.Project)
        .filter(models.Project.id == project.id)
        .with_for_update()
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.share_pin:
        for _ in range(8):
            project.share_pin = _generate_share_token()
            try:
                db.commit()
                break
            except IntegrityError:
                db.rollback()
                project = (
                    db.query(models.Project)
                    .filter(models.Project.id == project_id)
                    .with_for_update()
                    .first()
                )
                if not project:
                    raise HTTPException(status_code=404, detail="Project not found")
                if project.share_pin:
                    break
        if not project.share_pin:
            raise HTTPException(status_code=503, detail="Unable to generate share code")
    return {"token": project.share_pin}


@app.post("/projects/access/{token}", response_model=schemas.ProjectOut)
def access_via_token(token: str, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    normalized_token = _normalize_share_token(token)
    if not normalized_token:
        raise HTTPException(status_code=404, detail="Project not found")
    project = db.query(models.Project).filter(models.Project.share_pin == normalized_token).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Share-joining a PyBricks project should grant edit access even when the project is public.
    existing = (
        db.query(models.ProjectCollaborator)
        .filter(models.ProjectCollaborator.project_id == project.id, models.ProjectCollaborator.user_id == current_user.id)
        .first()
    )
    should_add_collaborator = (
        not project.is_public
        or (project.project_type or PROJECT_TYPE_NORMAL) == PROJECT_TYPE_PYBRICKS
    )
    if not existing and project.owner_id != current_user.id and should_add_collaborator:
        collab = models.ProjectCollaborator(project_id=project.id, user_id=current_user.id)
        db.add(collab)
        db.commit()
        db.refresh(project)
    return _project_payload(db, project)


@app.post("/projects/{project_id}/run")
def run_project_code(project_id: int, run_req: schemas.RunRequest):
    del project_id, run_req
    raise HTTPException(status_code=410, detail="Server runner removed. Refresh to use browser runtime.")


@app.get("/runtime/pyodide-config")
def runtime_pyodide_config():
    return _runtime_pyodide_config()


@app.websocket("/ws/compiler/{project_id}")
async def compiler_socket(websocket: WebSocket, project_id: int):
    del project_id
    await websocket.accept()
    try:
        await websocket.send_json(
            {
                "type": "stderr",
                "data": "[compiler] Server compiler removed. Refresh to use browser runtime.\n",
            }
        )
        await websocket.send_json({"type": "status", "state": "stopped"})
    finally:
        await websocket.close(code=1000)


# Socket handlers
async def _get_user_from_token(token: str):
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            return None
        db = SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            return user
        finally:
            db.close()
    except Exception:
        return None


def _user_can_access_project(user_id: int, project_id: int) -> bool:
    db = SessionLocal()
    try:
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if not project:
            return False
        if project.owner_id == user_id:
            return True
        collab = (
            db.query(models.ProjectCollaborator)
            .filter(models.ProjectCollaborator.project_id == project_id, models.ProjectCollaborator.user_id == user_id)
            .first()
        )
        if collab:
            return True
        return bool(project.is_public)
    finally:
        db.close()


def _user_can_edit_project(user_id: int, project_id: int) -> bool:
    db = SessionLocal()
    try:
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if not project:
            return False
        if project.owner_id == user_id:
            return True
        collab = (
            db.query(models.ProjectCollaborator)
            .filter(models.ProjectCollaborator.project_id == project_id, models.ProjectCollaborator.user_id == user_id)
            .first()
        )
        return collab is not None
    finally:
        db.close()


def _extract_socket_token(environ, auth_payload) -> Optional[str]:
    if auth_payload and isinstance(auth_payload, dict):
        token = auth_payload.get("token")
        if token:
            return token
    query = environ.get("QUERY_STRING", "")
    params = dict(qc.split("=", 1) for qc in query.split("&") if "=" in qc)
    return params.get("token")


def _set_presence_row(db: Session, user_id: int, status: str, last_seen_at: dt.datetime):
    row = db.query(models.Presence).filter(models.Presence.user_id == user_id).first()
    if row:
        row.status = status
        row.last_seen_at = last_seen_at
    else:
        db.add(models.Presence(user_id=user_id, status=status, last_seen_at=last_seen_at))


async def _broadcast_presence_update(user_id: int):
    db = SessionLocal()
    try:
        presence_row = db.query(models.Presence).filter(models.Presence.user_id == user_id).first()
        if not presence_row:
            return
        conversations = (
            db.query(models.Conversation)
            .filter(
                or_(
                    models.Conversation.user_a_id == user_id,
                    models.Conversation.user_b_id == user_id,
                )
            )
            .all()
        )
        partner_ids = {
            convo.user_b_id if convo.user_a_id == user_id else convo.user_a_id
            for convo in conversations
        }
        if partner_ids:
            blocked_pairs = (
                db.query(models.Block)
                .filter(
                    or_(
                        and_(
                            models.Block.blocker_id == user_id,
                            models.Block.blocked_id.in_(partner_ids),
                        ),
                        and_(
                            models.Block.blocked_id == user_id,
                            models.Block.blocker_id.in_(partner_ids),
                        ),
                    )
                )
                .all()
            )
            blocked_ids = {
                pair.blocked_id if pair.blocker_id == user_id else pair.blocker_id
                for pair in blocked_pairs
            }
            partner_ids.difference_update(blocked_ids)
        payload = {
            "user_id": user_id,
            "status": presence_row.status,
            "last_seen_at": presence_row.last_seen_at.isoformat(),
        }
    finally:
        db.close()
    for partner_id in partner_ids:
        await sio.emit(
            "presence:update",
            payload,
            room=f"user_{partner_id}",
            namespace=MESSAGING_NAMESPACE,
        )
    await sio.emit(
        "presence:update",
        payload,
        room=f"user_{user_id}",
        namespace=MESSAGING_NAMESPACE,
    )


async def _broadcast_presence(project_id: int):
    users = list(presence.get(project_id, {}).values())
    await sio.emit("presence", {"projectId": project_id, "users": users}, room=f"project_{project_id}")


def _voice_participants_payload(project_id: int) -> List[Dict[str, Any]]:
    participants = list(voice_rooms.get(project_id, {}).values())
    participants.sort(key=lambda item: (item.get("user_name") or "", item.get("sid") or ""))
    return participants


@sio.event
async def connect(sid, environ, auth=None):
    query = environ.get("QUERY_STRING", "")
    params = dict(qc.split("=", 1) for qc in query.split("&") if "=" in qc)
    token = params.get("token")
    project_id = params.get("projectId")
    share_token = params.get("shareToken")
    is_ghost = params.get("ghost") == "true"

    user = await _get_user_from_token(token) if token else None
    if user is None:
        return False

    if project_id is None:
        return False
    try:
        pid = int(project_id)
    except ValueError:
        return False

    if user.is_admin:
        allowed = True
    else:
        # Non-admins cannot be ghosts
        is_ghost = False
        db = SessionLocal()
        try:
            if share_token:
                normalized_share_token = _normalize_share_token(share_token)
                if normalized_share_token:
                    project = db.query(models.Project).filter(
                        models.Project.id == pid,
                        models.Project.share_pin == normalized_share_token,
                    ).first()
                    if (
                        project
                        and user.id != project.owner_id
                        and not project.is_public
                    ):
                        existing = (
                            db.query(models.ProjectCollaborator)
                            .filter(models.ProjectCollaborator.project_id == pid, models.ProjectCollaborator.user_id == user.id)
                            .first()
                        )
                        if not existing:
                            try:
                                db.add(models.ProjectCollaborator(project_id=pid, user_id=user.id))
                                db.commit()
                            except IntegrityError:
                                db.rollback()
            allowed = _user_can_access_project(user.id, pid)
        finally:
            db.close()

    if not allowed:
        return False

    can_edit = user.is_admin or _user_can_edit_project(user.id, pid)
    user_name = (user.display_name or user.username).strip() or user.username
    _sid_info[sid] = {
        "user_id": user.id,
        "is_admin": user.is_admin,
        "project_id": pid,
        "can_edit": can_edit,
        "name": user_name,
    }

    await sio.enter_room(sid, f"project_{pid}")

    if not is_ghost:
        color = f"#{uuid.uuid4().hex[:6]}"
        presence.setdefault(pid, {})[sid] = {
            "user_id": user.id, 
            "name": getattr(user, 'display_name', user.username), 
            "color": color, 
            "cursor": None, 
            "block_presence": None,
            "avatar": user.profile_picture_path,
            "is_admin": user.is_admin
        }

        await _broadcast_presence(pid)

    # send initial project state
    db2 = SessionLocal()
    try:
        project = db2.query(models.Project).filter(models.Project.id == pid).first()
        files = (
            db2.query(models.ProjectFile)
            .filter(models.ProjectFile.project_id == pid)
            .order_by(models.ProjectFile.created_at.asc())
            .all()
        )
        tasks = (
            db2.query(models.ProjectTask)
            .filter(models.ProjectTask.project_id == pid)
            .order_by(models.ProjectTask.is_done.asc(), models.ProjectTask.created_at.desc(), models.ProjectTask.id.desc())
            .all()
        )
        block_documents = (
            db2.query(models.ProjectBlockDocument)
            .filter(models.ProjectBlockDocument.project_id == pid)
            .order_by(models.ProjectBlockDocument.created_at.asc(), models.ProjectBlockDocument.id.asc())
            .all()
        )
        payload_files = []
        for f in files:
            state = _file_states.get(f.id)
            if not state or state.project_id != pid:
                state = _FileSyncState(project_id=pid, content=f.content or "")
                _file_states[f.id] = state
                _file_locks.setdefault(f.id, asyncio.Lock())
            payload_files.append({"id": f.id, "name": f.name, "content": state.content, "rev": state.rev})
        payload_block_documents = []
        if project and _project_supports_blocks(project):
            for block_document in block_documents:
                state = _block_states.get(block_document.id)
                if not state or state.project_id != pid:
                    state = _BlockSyncState(project_id=pid, workspace_json=block_document.workspace_json or "{}")
                    _block_states[block_document.id] = state
                    _block_locks.setdefault(block_document.id, asyncio.Lock())
                payload_block_documents.append(_project_block_document_payload(block_document, rev=state.rev))
        payload_tasks = [_project_task_payload(task) for task in tasks]
        payload_voice = _voice_participants_payload(pid)
    finally:
        db2.close()
    await sio.emit(
        "project_state",
        {
            "projectId": pid,
            "files": payload_files,
            "blockDocuments": payload_block_documents,
            "tasks": payload_tasks,
            "voiceParticipants": payload_voice,
        },
        room=sid,
    )


@sio.event
async def disconnect(sid):
    session = _sid_info.pop(sid, None)
    # find project ids containing sid
    to_remove = []
    for pid, users in presence.items():
        if sid in users:
            to_remove.append(pid)
    for pid in to_remove:
        presence[pid].pop(sid, None)
        await _broadcast_presence(pid)

    voice_project_id = session.get("project_id") if session else None
    if voice_project_id is not None:
        room = voice_rooms.get(voice_project_id)
        participant = room.pop(sid, None) if room else None
        if room is not None and not room:
            voice_rooms.pop(voice_project_id, None)
        if participant:
            await sio.emit(
                "voice_participant_left",
                {
                    "projectId": voice_project_id,
                    "sid": sid,
                    "userId": participant["user_id"],
                    "userName": participant["user_name"],
                },
                room=f"project_{voice_project_id}",
            )


@sio.event(namespace=MESSAGING_NAMESPACE)
async def connect_messages(sid, environ, auth=None):
    token = _extract_socket_token(environ, auth)
    user = await _get_user_from_token(token) if token else None
    if user is None:
        return False

    message_sid_info[sid] = user.id
    message_presence.connect(user.id, sid)
    now = dt.datetime.utcnow()
    db = SessionLocal()
    try:
        _set_presence_row(db, user.id, "online", now)
        db.commit()
    finally:
        db.close()

    await sio.enter_room(sid, f"user_{user.id}", namespace=MESSAGING_NAMESPACE)
    await _broadcast_presence_update(user.id)
    return True


@sio.event(namespace=MESSAGING_NAMESPACE)
async def disconnect_messages(sid):
    user_id = message_sid_info.pop(sid, None)
    if not user_id:
        return
    now = dt.datetime.utcnow()
    status_changed = message_presence.disconnect(user_id, sid, now)
    db = SessionLocal()
    try:
        entry = message_presence.get(user_id)
        status = entry["status"] if entry else "offline"
        _set_presence_row(db, user_id, status, now)
        db.commit()
    finally:
        db.close()
    if status_changed:
        await _broadcast_presence_update(user_id)


@sio.on("presence:heartbeat", namespace=MESSAGING_NAMESPACE)
async def presence_heartbeat(sid, data=None):
    user_id = message_sid_info.get(sid)
    if not user_id:
        return
    now = dt.datetime.utcnow()
    status_changed = message_presence.heartbeat(user_id, now)
    db = SessionLocal()
    try:
        _set_presence_row(db, user_id, "online", now)
        db.commit()
    finally:
        db.close()
    if status_changed:
        await _broadcast_presence_update(user_id)


@sio.on("join_conversation", namespace=MESSAGING_NAMESPACE)
async def join_conversation(sid, data):
    if not isinstance(data, dict):
        return
    conversation_id = data.get("conversation_id")
    user_id = message_sid_info.get(sid)
    if not conversation_id or not user_id:
        return
    db = SessionLocal()
    try:
        conversation = (
            db.query(models.Conversation)
            .filter(models.Conversation.id == conversation_id)
            .first()
        )
        if not conversation:
            return
        if user_id not in (conversation.user_a_id, conversation.user_b_id):
            return
        other_id = _get_other_user_id(conversation, user_id)
        if _is_blocked(db, user_id, other_id):
            return
    finally:
        db.close()
    await sio.enter_room(sid, f"conversation_{conversation_id}", namespace=MESSAGING_NAMESPACE)


@sio.on("leave_conversation", namespace=MESSAGING_NAMESPACE)
async def leave_conversation(sid, data):
    if not isinstance(data, dict):
        return
    conversation_id = data.get("conversation_id")
    if not conversation_id:
        return
    await sio.leave_room(sid, f"conversation_{conversation_id}", namespace=MESSAGING_NAMESPACE)


@sio.on("typing:start", namespace=MESSAGING_NAMESPACE)
async def typing_start(sid, data):
    if not isinstance(data, dict):
        return
    conversation_id = data.get("conversation_id")
    user_id = message_sid_info.get(sid)
    if not conversation_id or not user_id:
        return
    db = SessionLocal()
    try:
        conversation = (
            db.query(models.Conversation)
            .filter(models.Conversation.id == conversation_id)
            .first()
        )
        if not conversation:
            return
        if conversation.status != "accepted":
            return
        if user_id not in (conversation.user_a_id, conversation.user_b_id):
            return
        other_id = _get_other_user_id(conversation, user_id)
        if _is_blocked(db, user_id, other_id):
            return
    finally:
        db.close()

    if not typing_manager.should_emit(user_id, conversation_id):
        return
    typing_manager.mark_emit(user_id, conversation_id)
    await sio.emit(
        "typing:start",
        {"conversation_id": conversation_id, "user_id": user_id},
        room=f"conversation_{conversation_id}",
        skip_sid=sid,
        namespace=MESSAGING_NAMESPACE,
    )

    async def _emit_stop():
        await sio.emit(
            "typing:stop",
            {"conversation_id": conversation_id, "user_id": user_id},
            room=f"conversation_{conversation_id}",
            skip_sid=sid,
            namespace=MESSAGING_NAMESPACE,
        )

    await typing_manager.schedule_timeout(user_id, conversation_id, _emit_stop)


@sio.on("typing:stop", namespace=MESSAGING_NAMESPACE)
async def typing_stop(sid, data):
    if not isinstance(data, dict):
        return
    conversation_id = data.get("conversation_id")
    user_id = message_sid_info.get(sid)
    if not conversation_id or not user_id:
        return
    typing_manager.cancel_timeout(user_id, conversation_id)
    await sio.emit(
        "typing:stop",
        {"conversation_id": conversation_id, "user_id": user_id},
        room=f"conversation_{conversation_id}",
        skip_sid=sid,
        namespace=MESSAGING_NAMESPACE,
    )


@sio.event
async def ping(sid, data=None):
    await sio.emit("pong", {}, to=sid)


@sio.event
async def file_op(sid, data):
    project_id = data.get("projectId")
    file_id = data.get("fileId")
    base_rev = data.get("baseRev")
    changeset = data.get("changeset")
    op_id = data.get("opId")
    cursor = data.get("cursor")

    if project_id is None or file_id is None or base_rev is None or changeset is None or op_id is None:
        return

    try:
        pid = int(project_id)
        fid = int(file_id)
        client_rev = int(base_rev)
    except (TypeError, ValueError):
        return

    if not isinstance(op_id, str) or not op_id:
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid:
        return
    if not session.get("can_edit"):
        return
    user_id = int(session["user_id"])
    state = _file_states.get(fid)
    if not state or state.project_id != pid:
        db = SessionLocal()
        try:
            state = _ensure_file_state(db, pid, fid)
            if not state:
                return
        finally:
            db.close()

    lock = _file_locks.setdefault(fid, asyncio.Lock())
    async with lock:
        state = _file_states.get(fid)
        if not state or state.project_id != pid:
            return

        if client_rev != state.rev:
            # Client is behind (or ahead). Send missing ops if we still have them, else full sync.
            if client_rev < state.base_rev or client_rev > state.rev:
                await sio.emit(
                    "file_sync",
                    {"projectId": pid, "fileId": fid, "rev": state.rev, "content": state.content, "opId": op_id},
                    room=sid,
                )
                return

            start_idx = client_rev - state.base_rev
            ops = []
            for idx in range(start_idx, len(state.ops)):
                op = state.ops[idx]
                ops.append(
                    {
                        "rev": state.base_rev + idx + 1,
                        "changeset": op.changeset,
                        "opId": op.op_id,
                        "userId": op.user_id,
                        "cursor": op.cursor,
                    }
                )
            await sio.emit(
                "op_reject",
                {"projectId": pid, "fileId": fid, "expectedRev": state.rev, "opId": op_id, "ops": ops},
                room=sid,
            )
            return

        next_content = _apply_changeset(state.content, changeset)
        if next_content is None:
            await sio.emit(
                "file_sync",
                {"projectId": pid, "fileId": fid, "rev": state.rev, "content": state.content, "opId": op_id},
                room=sid,
            )
            return

        state.content = next_content
        state.ops.append(_FileOp(op_id=op_id, user_id=user_id, changeset=changeset, cursor=cursor))
        state.rev += 1

        # Trim op history to avoid unbounded memory growth.
        if len(state.ops) > MAX_FILE_OPS_BUFFER:
            trim = len(state.ops) - MAX_FILE_OPS_BUFFER
            del state.ops[:trim]
            state.base_rev += trim

        new_rev = state.rev

    _schedule_persist(fid)

    # Broadcast to collaborators (excluding the sender). Sender gets an explicit ACK.
    await sio.emit(
        "file_op",
        {"projectId": pid, "fileId": fid, "changeset": changeset, "rev": new_rev, "opId": op_id, "userId": user_id, "cursor": cursor},
        room=f"project_{pid}",
        skip_sid=sid,
    )
    await sio.emit("op_ack", {"projectId": pid, "fileId": fid, "opId": op_id, "rev": new_rev}, room=sid)


@sio.event
async def sync_file(sid, data):
    project_id = data.get("projectId")
    file_id = data.get("fileId")
    from_rev = data.get("fromRev")
    if project_id is None or file_id is None:
        return
    try:
        pid = int(project_id)
        fid = int(file_id)
        from_rev_int = int(from_rev) if from_rev is not None else None
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid:
        return

    db = SessionLocal()
    try:
        state = _ensure_file_state(db, pid, fid)
        if not state:
            return
    finally:
        db.close()

    lock = _file_locks.setdefault(fid, asyncio.Lock())
    async with lock:
        state = _file_states.get(fid)
        if not state or state.project_id != pid:
            return

        if from_rev_int is None or from_rev_int < state.base_rev or from_rev_int > state.rev:
            await sio.emit(
                "file_sync",
                {"projectId": pid, "fileId": fid, "rev": state.rev, "content": state.content},
                room=sid,
            )
            return

        if from_rev_int == state.rev:
            await sio.emit("file_ops", {"projectId": pid, "fileId": fid, "rev": state.rev, "ops": []}, room=sid)
            return

        start_idx = from_rev_int - state.base_rev
        ops = []
        for idx in range(start_idx, len(state.ops)):
            op = state.ops[idx]
            ops.append(
                {
                    "rev": state.base_rev + idx + 1,
                    "changeset": op.changeset,
                    "opId": op.op_id,
                    "userId": op.user_id,
                    "cursor": op.cursor,
                }
            )
        await sio.emit("file_ops", {"projectId": pid, "fileId": fid, "rev": state.rev, "ops": ops}, room=sid)


@sio.event
async def blocks_op(sid, data):
    project_id = data.get("projectId")
    document_id = data.get("documentId")
    base_rev = data.get("baseRev")
    op_id = data.get("opId")
    event = data.get("event")
    workspace_json = data.get("workspaceJson")

    if project_id is None or document_id is None or base_rev is None or op_id is None:
        return

    try:
        pid = int(project_id)
        did = int(document_id)
        client_rev = int(base_rev)
    except (TypeError, ValueError):
        return

    if not isinstance(op_id, str) or not op_id:
        return
    if not isinstance(event, dict):
        event = {}
    if workspace_json is not None and not isinstance(workspace_json, str):
        workspace_json = None

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    user_id = int(session["user_id"])
    state = _block_states.get(did)
    if not state or state.project_id != pid:
        db = SessionLocal()
        try:
            state = _ensure_block_state(db, pid, did)
            if not state:
                return
        finally:
            db.close()

    lock = _block_locks.setdefault(did, asyncio.Lock())
    async with lock:
        state = _block_states.get(did)
        if not state or state.project_id != pid:
            return

        if client_rev != state.rev:
            if client_rev < state.base_rev or client_rev > state.rev:
                await sio.emit(
                    "blocks_snapshot",
                    {"projectId": pid, "documentId": did, "rev": state.rev, "workspaceJson": state.workspace_json, "opId": op_id},
                    room=sid,
                )
                return

            start_idx = client_rev - state.base_rev
            ops = []
            for idx in range(start_idx, len(state.ops)):
                op = state.ops[idx]
                ops.append(
                    {
                        "rev": state.base_rev + idx + 1,
                        "event": op.event,
                        "opId": op.op_id,
                        "userId": op.user_id,
                        "workspaceJson": op.workspace_json,
                    }
                )
            await sio.emit(
                "blocks_op_reject",
                {"projectId": pid, "documentId": did, "expectedRev": state.rev, "opId": op_id, "ops": ops},
                room=sid,
            )
            return

        if workspace_json is not None:
            state.workspace_json = workspace_json
        state.ops.append(_BlockOp(op_id=op_id, user_id=user_id, event=event, workspace_json=workspace_json))
        state.rev += 1

        if len(state.ops) > MAX_FILE_OPS_BUFFER:
            trim = len(state.ops) - MAX_FILE_OPS_BUFFER
            del state.ops[:trim]
            state.base_rev += trim

        new_rev = state.rev

    _schedule_block_persist(did)

    await sio.emit(
        "blocks_op",
        {
            "projectId": pid,
            "documentId": did,
            "event": event,
            "rev": new_rev,
            "opId": op_id,
            "userId": user_id,
            "workspaceJson": workspace_json,
        },
        room=f"project_{pid}",
        skip_sid=sid,
    )
    await sio.emit("blocks_op_ack", {"projectId": pid, "documentId": did, "opId": op_id, "rev": new_rev}, room=sid)


@sio.event
async def blocks_sync_request(sid, data):
    project_id = data.get("projectId")
    document_id = data.get("documentId")
    from_rev = data.get("fromRev")
    if project_id is None or document_id is None:
        return
    try:
        pid = int(project_id)
        did = int(document_id)
        from_rev_int = int(from_rev) if from_rev is not None else None
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid:
        return

    db = SessionLocal()
    try:
        state = _ensure_block_state(db, pid, did)
        if not state:
            return
    finally:
        db.close()

    lock = _block_locks.setdefault(did, asyncio.Lock())
    async with lock:
        state = _block_states.get(did)
        if not state or state.project_id != pid:
            return

        if from_rev_int is None or from_rev_int < state.base_rev or from_rev_int > state.rev:
            await sio.emit(
                "blocks_snapshot",
                {"projectId": pid, "documentId": did, "rev": state.rev, "workspaceJson": state.workspace_json},
                room=sid,
            )
            return

        if from_rev_int == state.rev:
            await sio.emit("blocks_ops", {"projectId": pid, "documentId": did, "rev": state.rev, "ops": []}, room=sid)
            return

        start_idx = from_rev_int - state.base_rev
        ops = []
        for idx in range(start_idx, len(state.ops)):
            op = state.ops[idx]
            ops.append(
                {
                    "rev": state.base_rev + idx + 1,
                    "event": op.event,
                    "opId": op.op_id,
                    "userId": op.user_id,
                    "workspaceJson": op.workspace_json,
                }
            )
        await sio.emit("blocks_ops", {"projectId": pid, "documentId": did, "rev": state.rev, "ops": ops}, room=sid)


# Backwards compat: older clients emit `edit_file`
@sio.event
async def edit_file(sid, data):
    await file_op(sid, data)


@sio.event
async def cursor(sid, data):
    project_id = data.get("projectId")
    cursor_pos = data.get("cursor")
    if project_id is None:
        return
    pid = int(project_id)
    if pid in presence and sid in presence[pid]:
        presence[pid][sid]["cursor"] = cursor_pos
        await _broadcast_presence(pid)


@sio.event
async def blocks_presence(sid, data):
    project_id = data.get("projectId")
    block_presence = data.get("presence")
    if project_id is None:
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return
    if pid in presence and sid in presence[pid]:
        presence[pid][sid]["block_presence"] = block_presence if isinstance(block_presence, dict) else None
        await _broadcast_presence(pid)


@sio.event
async def voice_join(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    if project_id is None:
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    room = voice_rooms.setdefault(pid, {})
    existing = room.get(sid)
    if existing:
        existing["sid"] = sid
        existing["user_id"] = int(session["user_id"])
        existing["user_name"] = session.get("name") or f"User {session['user_id']}"
        if not isinstance(existing.get("muted"), bool):
            existing["muted"] = False
        if not isinstance(existing.get("speaking"), bool):
            existing["speaking"] = False
        await sio.emit("voice_state", {"projectId": pid, "participants": _voice_participants_payload(pid)}, room=sid)
        return

    room[sid] = {
        "sid": sid,
        "user_id": int(session["user_id"]),
        "user_name": session.get("name") or f"User {session['user_id']}",
        "muted": False,
        "speaking": False,
    }

    await sio.emit("voice_state", {"projectId": pid, "participants": _voice_participants_payload(pid)}, room=sid)
    await sio.emit("voice_participant_joined", {"projectId": pid, "participant": room[sid]}, room=f"project_{pid}", skip_sid=sid)


@sio.event
async def voice_leave(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    if project_id is None:
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    room = voice_rooms.get(pid)
    participant = room.pop(sid, None) if room else None
    if room is not None and not room:
        voice_rooms.pop(pid, None)
    if participant:
        await sio.emit(
            "voice_participant_left",
            {
                "projectId": pid,
                "sid": sid,
                "userId": participant["user_id"],
                "userName": participant["user_name"],
            },
            room=f"project_{pid}",
        )


@sio.event
async def voice_offer(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    to_sid = data.get("toSid")
    sdp = data.get("sdp")
    if project_id is None or not isinstance(to_sid, str) or not isinstance(sdp, dict):
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return
    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return
    room = voice_rooms.get(pid) or {}
    if sid not in room or to_sid not in room:
        return
    await sio.emit(
        "voice_offer",
        {
            "projectId": pid,
            "fromSid": sid,
            "fromUserId": room[sid]["user_id"],
            "fromUserName": room[sid]["user_name"],
            "sdp": sdp,
        },
        room=to_sid,
    )


@sio.event
async def voice_answer(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    to_sid = data.get("toSid")
    sdp = data.get("sdp")
    if project_id is None or not isinstance(to_sid, str) or not isinstance(sdp, dict):
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return
    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return
    room = voice_rooms.get(pid) or {}
    if sid not in room or to_sid not in room:
        return
    await sio.emit(
        "voice_answer",
        {
            "projectId": pid,
            "fromSid": sid,
            "fromUserId": room[sid]["user_id"],
            "fromUserName": room[sid]["user_name"],
            "sdp": sdp,
        },
        room=to_sid,
    )


@sio.event
async def voice_ice(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    to_sid = data.get("toSid")
    candidate = data.get("candidate")
    if project_id is None or not isinstance(to_sid, str) or not isinstance(candidate, dict):
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return
    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return
    room = voice_rooms.get(pid) or {}
    if sid not in room or to_sid not in room:
        return
    await sio.emit(
        "voice_ice",
        {
            "projectId": pid,
            "fromSid": sid,
            "fromUserId": room[sid]["user_id"],
            "fromUserName": room[sid]["user_name"],
            "candidate": candidate,
        },
        room=to_sid,
    )


@sio.event
async def voice_state(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    if project_id is None:
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return
    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    room = voice_rooms.get(pid) or {}
    participant = room.get(sid)
    if not participant:
        return

    muted = data.get("muted")
    speaking = data.get("speaking")
    has_changes = False
    if isinstance(muted, bool) and participant.get("muted") != muted:
        participant["muted"] = muted
        has_changes = True
    if isinstance(speaking, bool) and participant.get("speaking") != speaking:
        participant["speaking"] = speaking
        has_changes = True
    if not has_changes:
        return

    await sio.emit(
        "voice_participant_state",
        {
            "projectId": pid,
            "sid": sid,
            "userId": participant["user_id"],
            "userName": participant["user_name"],
            "muted": participant["muted"],
            "speaking": participant["speaking"],
        },
        room=f"project_{pid}",
    )


SESSION_CHAT_MAX_LENGTH = 500


@sio.event
async def session_chat(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    message_raw = data.get("message")
    if project_id is None or not isinstance(message_raw, str):
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid:
        return

    message = message_raw.strip()
    if not message or len(message) > SESSION_CHAT_MAX_LENGTH:
        return

    await sio.emit(
        "session_chat",
        {
            "projectId": pid,
            "userId": session["user_id"],
            "userName": session.get("name") or f"User {session['user_id']}",
            "message": message,
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        room=f"project_{pid}",
    )


@sio.event
async def task_create(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    content_raw = data.get("content")
    if project_id is None:
        return
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    content = (content_raw or "").strip() if isinstance(content_raw, str) else ""
    if not content or len(content) > 240:
        return

    db = SessionLocal()
    try:
        user_id = int(session["user_id"])
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            return
        task = models.ProjectTask(
            project_id=pid,
            content=content,
            is_done=False,
            created_by_user_id=user_id,
            created_by_name=(user.display_name or user.username).strip() or user.username,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        payload = _project_task_payload(task)
    finally:
        db.close()

    await sio.emit("task_created", {"projectId": pid, "task": payload}, room=f"project_{pid}")


@sio.event
async def task_update(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    task_id = data.get("taskId")
    if project_id is None or task_id is None:
        return
    try:
        pid = int(project_id)
        tid = int(task_id)
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    has_content = "content" in data
    has_done = "isDone" in data
    has_assignee = "assignedToUserId" in data
    if not has_content and not has_done and not has_assignee:
        return

    next_content = None
    if has_content:
        raw = data.get("content")
        if not isinstance(raw, str):
            return
        next_content = raw.strip()
        if not next_content or len(next_content) > 240:
            return

    next_done = None
    if has_done:
        raw_done = data.get("isDone")
        if not isinstance(raw_done, bool):
            return
        next_done = raw_done

    next_assignee_user_id = None
    next_assignee_name = None
    raw_assignee = None
    if has_assignee:
        raw_assignee = data.get("assignedToUserId")
        if isinstance(raw_assignee, bool):
            return
        if raw_assignee is not None and not isinstance(raw_assignee, int):
            return

    db = SessionLocal()
    try:
        user_id = int(session["user_id"])
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            return
        task = (
            db.query(models.ProjectTask)
            .filter(models.ProjectTask.id == tid, models.ProjectTask.project_id == pid)
            .first()
        )
        if not task:
            return

        if has_assignee:
            try:
                next_assignee_user_id, next_assignee_name = _resolve_task_assignee(db, pid, raw_assignee)
            except HTTPException:
                return

        changed = False
        if next_content is not None and next_content != task.content:
            task.content = next_content
            changed = True

        if next_done is not None and next_done != task.is_done:
            task.is_done = next_done
            changed = True
            if task.is_done:
                task.completed_at = dt.datetime.utcnow()
                task.completed_by_user_id = user_id
                task.completed_by_name = (user.display_name or user.username).strip() or user.username
            else:
                task.completed_at = None
                task.completed_by_user_id = None
                task.completed_by_name = None

        if has_assignee and (
            task.assigned_to_user_id != next_assignee_user_id
            or task.assigned_to_name != next_assignee_name
        ):
            task.assigned_to_user_id = next_assignee_user_id
            task.assigned_to_name = next_assignee_name
            changed = True

        if not changed:
            return

        db.commit()
        db.refresh(task)
        payload = _project_task_payload(task)
    finally:
        db.close()

    await sio.emit("task_updated", {"projectId": pid, "task": payload}, room=f"project_{pid}")


@sio.event
async def task_delete(sid, data):
    if not isinstance(data, dict):
        return
    project_id = data.get("projectId")
    task_id = data.get("taskId")
    if project_id is None or task_id is None:
        return
    try:
        pid = int(project_id)
        tid = int(task_id)
    except (TypeError, ValueError):
        return

    session = _sid_info.get(sid)
    if not session or session.get("project_id") != pid or not session.get("can_edit"):
        return

    db = SessionLocal()
    try:
        task = (
            db.query(models.ProjectTask)
            .filter(models.ProjectTask.id == tid, models.ProjectTask.project_id == pid)
            .first()
        )
        if not task:
            return
        db.delete(task)
        db.commit()
    finally:
        db.close()

    await sio.emit("task_deleted", {"projectId": pid, "taskId": tid}, room=f"project_{pid}")


# --- Settings & Profile Routes ---

@app.patch("/users/me", response_model=schemas.UserMeOut)
def update_me(user_in: schemas.UserUpdate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user_in.display_name is not None:
        current_user.display_name = user_in.display_name
    if user_in.bio is not None:
        current_user.bio = user_in.bio
    if user_in.description is not None:
        current_user.description = _normalize_profile_description(user_in.description)
    if user_in.links is not None:
        normalized_links = _normalize_profile_links(user_in.links)
        current_user.links = json.dumps(normalized_links) if normalized_links else None
    if user_in.password is not None:
        current_user.password_hash = auth.get_password_hash(user_in.password)
        # current_user.password_plain = user_in.password
    # Username change - check uniqueness and format
    if user_in.username is not None:
        normalized_username = _normalize_username(user_in.username)
        if normalized_username != current_user.username.lower():
            # Validate username format: only a-z and 0-9
            if not re.match(r'^[a-z0-9]+$', normalized_username):
                raise HTTPException(status_code=400, detail="Username can only contain letters (a-z) and/or numbers (0-9)")
            existing = (
                db.query(models.User)
                .filter(
                    func.lower(models.User.username) == normalized_username,
                    models.User.id != current_user.id,
                )
                .first()
            )
            if existing:
                raise HTTPException(status_code=400, detail="Username already taken")
            current_user.username = normalized_username

    if user_in.email is not None:
        normalized_email = user_in.email.strip().lower()
        if normalized_email == "":
            current_user.email = None
            current_user.email_verified = False
            current_user.google_sub = None
        else:
            if normalized_email != (current_user.email or "").strip().lower():
                raise HTTPException(
                    status_code=400,
                    detail="Email updates require Google verification in Settings.",
                )

    db.commit()
    db.refresh(current_user)
    return _to_user_me_out(current_user)


@app.post("/users/me/email/verify/google", response_model=schemas.UserMeOut)
def verify_my_email_with_google(
    body: schemas.GoogleEmailVerifyRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    claims = _verify_google_claims(body.id_token)
    email = claims["email"]
    google_sub = claims["google_sub"]

    existing_email = (
        db.query(models.User)
        .filter(models.User.email == email, models.User.id != current_user.id)
        .first()
    )
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already taken")

    existing_google_sub = (
        db.query(models.User)
        .filter(models.User.google_sub == google_sub, models.User.id != current_user.id)
        .first()
    )
    if existing_google_sub:
        raise HTTPException(status_code=409, detail="Google account is already linked to another user")

    if current_user.google_sub and current_user.google_sub != google_sub:
        raise HTTPException(status_code=409, detail="Your account is already linked to a different Google account")

    current_user.email = email
    current_user.email_verified = True
    current_user.google_sub = google_sub
    db.commit()
    db.refresh(current_user)
    return _to_user_me_out(current_user)

@app.put("/users/me/picture", response_model=schemas.UserMeOut)
def upload_profile_picture(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    ext = os.path.splitext(file.filename)[1].lower()
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    if ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    # Save file to uploads/profile_pictures/ on disk
    upload_dir = PROFILE_PICTURES_DIR
    os.makedirs(upload_dir, exist_ok=True)

    content = file.file.read()
    max_size = 5 * 1024 * 1024  # 5 MB
    if len(content) > max_size:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")

    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, filename)
    with open(file_path, "wb") as f:
        f.write(content)

    # Remove old profile picture file if it exists
    old_path = current_user.profile_picture_path
    if old_path and old_path.startswith("/uploads/profile_pictures/"):
        old_file = os.path.join(upload_dir, os.path.basename(old_path))
        try:
            if os.path.isfile(old_file):
                os.remove(old_file)
        except OSError:
            logger.warning("Failed to remove old profile picture: %s", old_file)

    current_user.profile_picture_path = f"/uploads/profile_pictures/{filename}"
    db.commit()
    db.refresh(current_user)
    return _to_user_me_out(current_user)

@app.delete("/users/me")
def delete_me(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    _delete_user_account(db, current_user)
    db.commit()
    return {"status": "deleted"}

@app.get("/users/search", response_model=List[schemas.UserOut])
def search_users(
    q: str = "",
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    if not q:
        return []
    pattern = f"%{q}%"
    users = (
        db.query(models.User)
        .filter(
            models.User.username.ilike(pattern) | models.User.display_name.ilike(pattern)
        )
        .order_by(models.User.username)
        .limit(20)
        .all()
    )
    return _serialize_users(db, current_user.id if current_user else None, users)

@app.get("/users/{user_id}", response_model=schemas.UserOut)
def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_user(db, current_user.id if current_user else None, user)

@app.get("/users/{user_id}/stats")
def get_user_stats(user_id: int, db: Session = Depends(get_db)):
    follower_count = db.query(models.Follow).filter(models.Follow.followed_id == user_id).count()
    following_count = db.query(models.Follow).filter(models.Follow.follower_id == user_id).count()
    return {"followers": follower_count, "following": following_count}

@app.get("/users/{user_id}/projects", response_model=List[schemas.ProjectOut])
def get_user_public_projects(user_id: int, db: Session = Depends(get_db)):
    # Profile pages only show PUBLIC projects - private projects are managed via Dashboard
    # Admin can view all projects from the Admin Dashboard
    projects = (
        db.query(models.Project)
        .filter(
            models.Project.owner_id == user_id,
            models.Project.is_public == True
        )
        .order_by(models.Project.updated_at.desc())
        .all()
    )
    return _enrich_projects_with_owner(db, projects)

@app.get("/users/{user_id}/followers", response_model=List[schemas.UserOut])
def get_user_followers(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    """Get list of users who follow this user"""
    followers = db.query(models.User).join(
        models.Follow, models.Follow.follower_id == models.User.id
    ).filter(models.Follow.followed_id == user_id).all()
    return _serialize_users(db, current_user.id if current_user else None, followers)

@app.get("/users/{user_id}/following", response_model=List[schemas.UserOut])
def get_user_following(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    """Get list of users this user follows"""
    following = db.query(models.User).join(
        models.Follow, models.Follow.followed_id == models.User.id
    ).filter(models.Follow.follower_id == user_id).all()
    return _serialize_users(db, current_user.id if current_user else None, following)

@app.post("/users/{user_id}/follow")
def follow_user(user_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if _is_blocked(db, current_user.id, user_id):
        raise HTTPException(status_code=403, detail="Cannot follow while blocked")
        
    existing = db.query(models.Follow).filter(models.Follow.follower_id == current_user.id, models.Follow.followed_id == user_id).first()
    if existing:
        return {"status": "already followed"}
        
    follow = models.Follow(follower_id=current_user.id, followed_id=user_id)
    db.add(follow)
    db.commit()
    return {"status": "followed"}

@app.delete("/users/{user_id}/follow")
def unfollow_user(user_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(models.Follow).filter(models.Follow.follower_id == current_user.id, models.Follow.followed_id == user_id).first()
    if existing:
        db.delete(existing)
        db.commit()
    return {"status": "unfollowed"}


def _get_other_user_id(conversation: models.Conversation, user_id: int) -> int:
    return conversation.user_b_id if conversation.user_a_id == user_id else conversation.user_a_id


def _get_other_user(db: Session, conversation: models.Conversation, user_id: int) -> models.User:
    other_id = _get_other_user_id(conversation, user_id)
    return db.query(models.User).filter(models.User.id == other_id).first()


def _build_conversation_summary(db: Session, conversation: models.Conversation, user_id: int) -> schemas.ConversationSummary:
    other = _get_other_user(db, conversation, user_id)
    block_state = _block_state(db, user_id, other.id)
    unread_count = (
        db.query(models.Message)
        .filter(
            models.Message.conversation_id == conversation.id,
            models.Message.sender_id != user_id,
            models.Message.read_at.is_(None),
        )
        .count()
    )
    if block_state != "none":
        unread_count = 0
    presence_row = db.query(models.Presence).filter(models.Presence.user_id == other.id).first()
    return schemas.ConversationSummary(
        conversation=schemas.ConversationOut.model_validate(conversation),
        other_user=_serialize_user(db, user_id, other),
        unread_count=unread_count,
        online_status=presence_row.status if presence_row else None,
        last_seen_at=presence_row.last_seen_at if presence_row else None,
        is_request_sent=conversation.status == "pending" and conversation.requester_id == user_id,
        block_state=block_state,
    )


def _build_request_summary(db: Session, conversation: models.Conversation, user_id: int) -> schemas.RequestSummary:
    other = _get_other_user(db, conversation, user_id)
    return schemas.RequestSummary(
        conversation=schemas.ConversationOut.model_validate(conversation),
        other_user=_serialize_user(db, user_id, other),
        preview_message=conversation.last_message_preview,
        last_message_at=conversation.last_message_at,
    )


def _build_conversation_detail(
    db: Session,
    conversation: models.Conversation,
    user_id: int,
    messages: List[models.Message],
) -> schemas.ConversationDetail:
    other = _get_other_user(db, conversation, user_id)
    unread_count = (
        db.query(models.Message)
        .filter(
            models.Message.conversation_id == conversation.id,
            models.Message.sender_id != user_id,
            models.Message.read_at.is_(None),
        )
        .count()
    )
    if conversation.status == "accepted":
        can_send = True
    else:
        sent_count = (
            db.query(models.Message)
            .filter(models.Message.conversation_id == conversation.id)
            .count()
        )
        can_send = conversation.requester_id == user_id and sent_count == 0
    block_state = _block_state(db, user_id, other.id)
    if block_state != "none":
        unread_count = 0
        can_send = False
    return schemas.ConversationDetail(
        conversation=schemas.ConversationOut.model_validate(conversation),
        other_user=_serialize_user(db, user_id, other),
        messages=[schemas.MessageOut.model_validate(m) for m in messages],
        unread_count=unread_count,
        block_state=block_state,
        can_send=can_send,
    )


def _create_message(
    db: Session,
    conversation: models.Conversation,
    sender_id: int,
    body: str,
    client_message_id: Optional[str] = None,
) -> models.Message:
    now = dt.datetime.utcnow()
    message = models.Message(
        conversation_id=conversation.id,
        sender_id=sender_id,
        body=body,
        created_at=now,
        delivered_at=now,
        client_message_id=client_message_id,
    )
    conversation.last_message_at = now
    conversation.last_message_preview = _message_preview(body)
    conversation.updated_at = now
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


@app.get("/messages/inbox", response_model=List[schemas.ConversationSummary])
def get_inbox(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    conversations = (
        db.query(models.Conversation)
        .filter(
            or_(
                models.Conversation.user_a_id == current_user.id,
                models.Conversation.user_b_id == current_user.id,
            )
        )
        .all()
    )
    filtered = []
    for convo in conversations:
        if convo.status == "pending" and convo.requester_id != current_user.id:
            continue
        other_id = _get_other_user_id(convo, current_user.id)
        if _block_state(db, current_user.id, other_id) == "blocked_by_them":
            continue
        filtered.append(convo)
    filtered.sort(
        key=lambda c: c.last_message_at or c.created_at,
        reverse=True,
    )
    return [_build_conversation_summary(db, convo, current_user.id) for convo in filtered]


@app.get("/messages/requests", response_model=List[schemas.RequestSummary])
def get_requests(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    conversations = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.status == "pending",
            or_(
                models.Conversation.user_a_id == current_user.id,
                models.Conversation.user_b_id == current_user.id,
            ),
        )
        .all()
    )
    filtered = []
    for convo in conversations:
        if convo.requester_id == current_user.id:
            continue
        other_id = _get_other_user_id(convo, current_user.id)
        if _is_blocked(db, current_user.id, other_id):
            continue
        filtered.append(convo)
    filtered.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return [_build_request_summary(db, convo, current_user.id) for convo in filtered]


@app.get("/messages/conversation/{conversation_id}", response_model=schemas.ConversationDetail)
def get_conversation(
    conversation_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(models.Conversation)
        .filter(models.Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if current_user.id not in (conversation.user_a_id, conversation.user_b_id):
        raise HTTPException(status_code=403, detail="Not a participant")
    other_id = _get_other_user_id(conversation, current_user.id)
    block_state = _block_state(db, current_user.id, other_id)
    if block_state == "blocked_by_them":
        raise HTTPException(status_code=403, detail="Messaging disabled")
    if block_state == "blocked_by_me":
        return schemas.ConversationDetail(
            conversation=schemas.ConversationOut.model_validate(conversation),
            other_user=_serialize_user(db, current_user.id, _get_other_user(db, conversation, current_user.id)),
            messages=[],
            unread_count=0,
            block_state=block_state,
            can_send=False,
        )

    messages = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conversation.id)
        .order_by(models.Message.created_at.asc())
        .all()
    )
    unread = [
        m
        for m in messages
        if m.sender_id != current_user.id and m.read_at is None
    ]
    if unread:
        now = dt.datetime.utcnow()
        for message in unread:
            message.read_at = now
        db.commit()

    return _build_conversation_detail(db, conversation, current_user.id, messages)


@app.post("/messages/conversation/start", response_model=schemas.ConversationDetail)
def start_conversation(
    payload: schemas.ConversationStart,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.target_user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    target = (
        db.query(models.User)
        .filter(models.User.id == payload.target_user_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if _is_blocked(db, current_user.id, target.id):
        raise HTTPException(status_code=403, detail="Messaging disabled")

    _, _, pair_key = _pair_key(current_user.id, target.id)
    conversation = (
        db.query(models.Conversation)
        .filter(models.Conversation.pair_key == pair_key)
        .first()
    )
    if conversation:
        if current_user.is_admin and conversation.status == "pending":
            conversation.status = "accepted"
            conversation.updated_at = dt.datetime.utcnow()
            db.commit()
        if payload.initial_message:
            if conversation.status == "pending" and conversation.requester_id != current_user.id:
                raise HTTPException(status_code=403, detail="Request pending approval")
            if conversation.status == "pending":
                sent_count = (
                    db.query(models.Message)
                    .filter(models.Message.conversation_id == conversation.id)
                    .count()
                )
                if sent_count > 0:
                    raise HTTPException(status_code=403, detail="Request already sent")
            _enforce_message_rate_limit(db, current_user.id)
            message = _create_message(
                db,
                conversation,
                current_user.id,
                payload.initial_message,
            )
            _emit_message_event(
                "message:new",
                {"conversation_id": conversation.id, "message": schemas.MessageOut.model_validate(message).model_dump(mode="json")},
                room=f"conversation_{conversation.id}",
            )
            _emit_message_event(
                "message:new",
                {"conversation_id": conversation.id, "message": schemas.MessageOut.model_validate(message).model_dump(mode="json")},
                room=f"user_{target.id}",
            )
            _emit_message_event(
                "message:new",
                {"conversation_id": conversation.id, "message": schemas.MessageOut.model_validate(message).model_dump(mode="json")},
                room=f"user_{current_user.id}",
            )
        messages = (
            db.query(models.Message)
            .filter(models.Message.conversation_id == conversation.id)
            .order_by(models.Message.created_at.asc())
            .all()
        )
        return _build_conversation_detail(db, conversation, current_user.id, messages)

    status_value = "accepted" if current_user.is_admin or _is_mutual(db, current_user.id, target.id) else "pending"
    if status_value == "pending":
        _enforce_request_rate_limit(db, current_user.id)
    user_a_id, user_b_id, pair_key = _pair_key(current_user.id, target.id)
    conversation = models.Conversation(
        user_a_id=user_a_id,
        user_b_id=user_b_id,
        pair_key=pair_key,
        requester_id=current_user.id,
        status=status_value,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    _emit_message_event(
        "conversation:new",
        {"conversation": schemas.ConversationOut.model_validate(conversation).model_dump(mode="json")},
        room=f"user_{current_user.id}",
    )
    _emit_message_event(
        "conversation:new",
        {"conversation": schemas.ConversationOut.model_validate(conversation).model_dump(mode="json")},
        room=f"user_{target.id}",
    )

    if payload.initial_message:
        _enforce_message_rate_limit(db, current_user.id)
        message = _create_message(
            db,
            conversation,
            current_user.id,
            payload.initial_message,
        )
        _emit_message_event(
            "message:new",
            {"conversation_id": conversation.id, "message": schemas.MessageOut.model_validate(message).model_dump(mode="json")},
            room=f"conversation_{conversation.id}",
        )
        _emit_message_event(
            "message:new",
            {"conversation_id": conversation.id, "message": schemas.MessageOut.model_validate(message).model_dump(mode="json")},
            room=f"user_{target.id}",
        )
        _emit_message_event(
            "message:new",
            {"conversation_id": conversation.id, "message": schemas.MessageOut.model_validate(message).model_dump(mode="json")},
            room=f"user_{current_user.id}",
        )
    messages = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conversation.id)
        .order_by(models.Message.created_at.asc())
        .all()
    )
    return _build_conversation_detail(db, conversation, current_user.id, messages)


@app.post("/messages/conversation/{conversation_id}/send", response_model=schemas.MessageOut)
def send_message(
    conversation_id: str,
    payload: schemas.MessageSend,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(models.Conversation)
        .filter(models.Conversation.id == conversation_id)
        .with_for_update()
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if current_user.id not in (conversation.user_a_id, conversation.user_b_id):
        raise HTTPException(status_code=403, detail="Not a participant")
    other_id = _get_other_user_id(conversation, current_user.id)
    if _is_blocked(db, current_user.id, other_id):
        raise HTTPException(status_code=403, detail="Messaging disabled")

    if payload.client_message_id:
        existing = (
            db.query(models.Message)
            .filter(
                models.Message.conversation_id == conversation.id,
                models.Message.sender_id == current_user.id,
                models.Message.client_message_id == payload.client_message_id,
            )
            .first()
        )
        if existing:
            return schemas.MessageOut.model_validate(existing)

    if conversation.status == "pending":
        if current_user.is_admin:
            conversation.status = "accepted"
            conversation.updated_at = dt.datetime.utcnow()
        elif conversation.requester_id != current_user.id:
            raise HTTPException(status_code=403, detail="Request pending approval")
        else:
            sent_count = (
                db.query(models.Message)
                .filter(models.Message.conversation_id == conversation.id)
                .count()
            )
            if sent_count > 0:
                raise HTTPException(status_code=403, detail="Request already sent")
    _enforce_message_rate_limit(db, current_user.id)

    message = _create_message(
        db,
        conversation,
        current_user.id,
        payload.body,
        payload.client_message_id,
    )
    message_payload = schemas.MessageOut.model_validate(message).model_dump(mode="json")
    _emit_message_event(
        "message:new",
        {"conversation_id": conversation.id, "message": message_payload},
        room=f"conversation_{conversation.id}",
    )
    _emit_message_event(
        "message:new",
        {"conversation_id": conversation.id, "message": message_payload},
        room=f"user_{other_id}",
    )
    _emit_message_event(
        "message:new",
        {"conversation_id": conversation.id, "message": message_payload},
        room=f"user_{current_user.id}",
    )
    return message


@app.post("/messages/conversation/{conversation_id}/accept", response_model=schemas.ConversationDetail)
def accept_conversation(
    conversation_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(models.Conversation)
        .filter(models.Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if current_user.id not in (conversation.user_a_id, conversation.user_b_id):
        raise HTTPException(status_code=403, detail="Not a participant")
    other_id = _get_other_user_id(conversation, current_user.id)
    if _is_blocked(db, current_user.id, other_id):
        raise HTTPException(status_code=403, detail="Messaging disabled")
    if conversation.status != "pending":
        raise HTTPException(status_code=400, detail="Conversation already accepted")
    if conversation.requester_id == current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Cannot accept your own request")

    conversation.status = "accepted"
    conversation.updated_at = dt.datetime.utcnow()
    db.commit()
    _emit_message_event(
        "conversation:accepted",
        {"conversation_id": conversation.id},
        room=f"user_{other_id}",
    )
    _emit_message_event(
        "conversation:accepted",
        {"conversation_id": conversation.id},
        room=f"user_{current_user.id}",
    )
    messages = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == conversation.id)
        .order_by(models.Message.created_at.asc())
        .all()
    )
    return _build_conversation_detail(db, conversation, current_user.id, messages)


@app.post("/messages/conversation/{conversation_id}/decline")
def decline_conversation(
    conversation_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(models.Conversation)
        .filter(models.Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if current_user.id not in (conversation.user_a_id, conversation.user_b_id):
        raise HTTPException(status_code=403, detail="Not a participant")
    if conversation.status != "pending":
        raise HTTPException(status_code=400, detail="Conversation already accepted")
    if conversation.requester_id == current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Cannot decline your own request")
    other_id = _get_other_user_id(conversation, current_user.id)
    if _is_blocked(db, current_user.id, other_id):
        raise HTTPException(status_code=403, detail="Messaging disabled")
    db.delete(conversation)
    db.commit()
    _emit_message_event(
        "conversation:removed",
        {"conversation_id": conversation_id},
        room=f"user_{other_id}",
    )
    _emit_message_event(
        "conversation:removed",
        {"conversation_id": conversation_id},
        room=f"user_{current_user.id}",
    )
    return {"status": "declined"}


@app.post("/users/{user_id}/block")
def block_user(
    user_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.is_admin:
        raise HTTPException(status_code=400, detail="Admins cannot be blocked")

    existing = (
        db.query(models.Block)
        .filter(
            models.Block.blocker_id == current_user.id,
            models.Block.blocked_id == user_id,
        )
        .first()
    )
    if existing:
        return {"status": "already blocked"}

    db.add(models.Block(blocker_id=current_user.id, blocked_id=user_id))
    db.query(models.Follow).filter(
        or_(
            and_(
                models.Follow.follower_id == current_user.id,
                models.Follow.followed_id == user_id,
            ),
            and_(
                models.Follow.follower_id == user_id,
                models.Follow.followed_id == current_user.id,
            ),
        )
    ).delete(synchronize_session=False)

    pending_conversations = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.status == "pending",
            or_(
                and_(
                    models.Conversation.user_a_id == current_user.id,
                    models.Conversation.user_b_id == user_id,
                ),
                and_(
                    models.Conversation.user_a_id == user_id,
                    models.Conversation.user_b_id == current_user.id,
                ),
            ),
        )
        .all()
    )
    for convo in pending_conversations:
        db.delete(convo)
    db.commit()
    _emit_message_event(
        "conversation:blocked",
        {"user_id": current_user.id, "blocked_id": user_id},
        room=f"user_{user_id}",
    )
    _emit_message_event(
        "conversation:blocked",
        {"user_id": current_user.id, "blocked_id": user_id},
        room=f"user_{current_user.id}",
    )
    return {"status": "blocked"}


@app.post("/users/{user_id}/unblock")
def unblock_user(
    user_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.Block)
        .filter(
            models.Block.blocker_id == current_user.id,
            models.Block.blocked_id == user_id,
        )
        .first()
    )
    if not existing:
        return {"status": "not blocked"}
    db.delete(existing)
    db.commit()
    _emit_message_event(
        "conversation:unblocked",
        {"user_id": current_user.id, "unblocked_id": user_id},
        room=f"user_{user_id}",
    )
    _emit_message_event(
        "conversation:unblocked",
        {"user_id": current_user.id, "unblocked_id": user_id},
        room=f"user_{current_user.id}",
    )
    return {"status": "unblocked"}


# --- Project Visibility Routes ---

@app.patch("/projects/{project_id}/visibility", response_model=schemas.ProjectOut)
def toggle_project_visibility(project_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _ensure_project_access(db, project_id, current_user, require_write=True) # Only owner/collabs can change visibility? Or just owner?
    # Usually only owner.
    if project.owner_id != current_user.id and not current_user.is_admin:
         raise HTTPException(status_code=403, detail="Only owner can change visibility")
         
    project.is_public = not project.is_public
    db.commit()
    db.refresh(project)
    return _project_payload(db, project)

# Moved to before /projects/{project_id}


# --- Admin Extra Routes ---

@app.post("/admin/api/force/follow")
@app.post("/admin/force/follow")
def admin_force_follow(follower_id: int, followed_id: int, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    if follower_id == followed_id:
        raise HTTPException(status_code=400, detail="Same ids")
    follower = db.query(models.User).filter(models.User.id == follower_id).first()
    if not follower:
        raise HTTPException(status_code=404, detail=f"Follower user {follower_id} not found")
    followed = db.query(models.User).filter(models.User.id == followed_id).first()
    if not followed:
        raise HTTPException(status_code=404, detail=f"Target user {followed_id} not found")
    existing = db.query(models.Follow).filter(models.Follow.follower_id == follower_id, models.Follow.followed_id == followed_id).first()
    if not existing:
        follow = models.Follow(follower_id=follower_id, followed_id=followed_id)
        db.add(follow)
        db.commit()
        return {"status": "forced follow"}
    return {"status": "already following"}

@app.post("/admin/api/force/project", response_model=schemas.ProjectOut)
@app.post("/admin/force/project", response_model=schemas.ProjectOut)
def admin_create_project_for_user(user_id: int, project_in: schemas.ProjectCreate, current_user: models.User = Depends(check_admin), db: Session = Depends(get_db)):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    project_name = (project_in.name or "").strip()
    if not project_name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    
    project = models.Project(
        name=project_name,
        project_type=project_in.project_type,
        editor_mode=_default_project_editor_mode(project_in.project_type),
        owner_id=user_id,
        is_public=project_in.is_public,
        description=project_in.description,
    )
    db.add(project)
    db.flush()
    if project.project_type == PROJECT_TYPE_PYBRICKS:
        _create_default_block_document(db, project)
    
    default_file = models.ProjectFile(
        project_id=project.id,
        name="main.py",
        content=_project_starter_content(project.project_type),
    )
    db.add(default_file)
    db.commit()
    db.refresh(project)
    return _project_payload(db, project)

# --- Socket Logic Updates ---
# see bottom for cursor/presence


# Static frontend serving (if built)
if os.path.exists(INDEX_FILE):
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
    vendor_dir = os.path.join(FRONTEND_DIST, "vendor")
    if os.path.isdir(vendor_dir):
        app.mount("/vendor", StaticFiles(directory=vendor_dir), name="vendor")

    docs_dir = os.path.join(FRONTEND_DIST, "docs")
    if os.path.isdir(docs_dir):
        @app.get("/docs")
        async def docs_redirect():
            return RedirectResponse(url="/docs/")

        app.mount("/docs", StaticFiles(directory=docs_dir, html=True), name="docs")
    
    # Mount uploads
    upload_dir = UPLOADS_DIR
    os.makedirs(upload_dir, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")

    support_index = os.path.join(FRONTEND_DIST, "support", "index.html")
    pybricks_blocks_host_html = os.path.join(FRONTEND_DIST, "pybricks-blocks-host.html")
    pybricks_blocks_host_js = os.path.join(FRONTEND_DIST, "pybricks-blocks-host.js")

    @app.get("/support")
    @app.get("/support/")
    async def support_page():
        if os.path.exists(support_index):
            return _frontend_html_response(support_index, request_path="/support")
        return _frontend_html_response(INDEX_FILE, request_path="/support")

    @app.get("/pybricks-blocks-host.html")
    async def pybricks_blocks_host_page():
        if not os.path.exists(pybricks_blocks_host_html):
            raise HTTPException(status_code=404, detail="Not found")
        return _frontend_html_response(
            pybricks_blocks_host_html,
            request_path="/pybricks-blocks-host.html",
        )

    @app.get("/pybricks-blocks-host.js")
    async def pybricks_blocks_host_script():
        if not os.path.exists(pybricks_blocks_host_js):
            raise HTTPException(status_code=404, detail="Not found")
        response = FileResponse(pybricks_blocks_host_js)
        response.headers["Cache-Control"] = "no-store"
        return _apply_cross_origin_isolation_headers(
            response,
            request_path="/pybricks-blocks-host.js",
        )

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("uploads/"):
            upload_rel_path = full_path[len("uploads/"):]
            upload_file_path = os.path.abspath(os.path.join(UPLOADS_DIR, upload_rel_path))
            if not upload_file_path.startswith(os.path.abspath(UPLOADS_DIR) + os.sep):
                raise HTTPException(status_code=404, detail="Not found")
            return _apply_cross_origin_isolation_headers(
                FileResponse(upload_file_path),
                request_path=f"/{full_path}",
            )
        return _frontend_html_response(INDEX_FILE, request_path=f"/{full_path}")
