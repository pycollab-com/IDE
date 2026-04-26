import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable, List, Tuple

from . import models

PYTHON_EXECUTABLE_ENV = "PYCOLLAB_PYTHON_EXECUTABLE"


def _iter_python_candidates() -> Iterable[str]:
    configured = os.getenv(PYTHON_EXECUTABLE_ENV, "").strip()
    static_candidates = [
        sys.executable,
        "python3",
        "python",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
        "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
    ]
    seen = set()
    for candidate in [configured, *static_candidates]:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        yield candidate


def resolve_python_executable() -> str | None:
    for candidate in _iter_python_candidates():
        if os.path.isabs(candidate):
            if os.path.exists(candidate) and os.access(candidate, os.X_OK):
                return candidate
            continue
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


def build_python_env() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _normalize_project_path(raw_name: str) -> str:
    name = (raw_name or "").strip().replace("\\", "/")
    if not name:
        raise ValueError("Project file name cannot be empty.")

    normalized = os.path.normpath(name).replace("\\", "/")
    if normalized in {"", ".", ".."}:
        raise ValueError(f"Invalid project file path: {raw_name!r}")
    if normalized.startswith("../") or normalized.startswith("/"):
        raise ValueError(f"Unsafe project file path: {raw_name!r}")

    return normalized


def _select_entry_file(
    files: List[models.ProjectFile],
    entry_file_id: int | None,
) -> models.ProjectFile:
    entry = next((f for f in files if f.id == entry_file_id), None)
    if entry is not None:
        return entry
    return next((f for f in files if f.name == "main.py"), files[0])


def prepare_project_workspace(
    files: List[models.ProjectFile],
    entry_file_id: int | None = None,
) -> Tuple[tempfile.TemporaryDirectory, str]:
    if not files:
        raise ValueError("No files in project.")

    entry = _select_entry_file(files, entry_file_id)
    workspace = tempfile.TemporaryDirectory(prefix="pycollab-runner-")

    try:
        workspace_root = Path(workspace.name)
        for project_file in files:
            rel_path = _normalize_project_path(project_file.name or "")
            output_path = workspace_root / rel_path
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(project_file.content or "", encoding="utf-8")

        entry_rel_path = _normalize_project_path(entry.name or "main.py")
        entry_path = workspace_root / entry_rel_path
        if not entry_path.exists():
            raise ValueError(f"Entry file not found in workspace: {entry_rel_path}")

        return workspace, str(entry_path)
    except Exception:
        workspace.cleanup()
        raise


def _coerce_stream_value(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def run_project(
    project: models.Project,
    files: List[models.ProjectFile],
    entry_file_id: int | None = None,
    timeout: int = 5,
    stdin_data: str = "",
):
    """
    Execute Python code locally on the server using an unbuffered Python process.

    Args:
        project: The project model (kept for compatibility with existing call sites).
        files: List of project files to materialize in a temporary workspace.
        entry_file_id: ID of the entry file to run (defaults to main.py or first file).
        timeout: Maximum execution timeout in seconds.
        stdin_data: Standard input to pass to the program.

    Returns:
        Dict with 'output' and 'return_code' keys.
    """
    del project  # The object is currently not needed for local execution.

    if not files:
        return {"output": "No files in project.", "return_code": 1}

    python_exec = resolve_python_executable()
    if not python_exec:
        return {"output": "Error: Could not find a Python executable on the server.", "return_code": 1}

    try:
        workspace, entry_path = prepare_project_workspace(files, entry_file_id)
    except ValueError as exc:
        return {"output": str(exc), "return_code": 1}
    except Exception as exc:
        return {"output": f"Failed to prepare execution workspace: {str(exc)}", "return_code": 1}

    run_timeout = max(1, int(timeout))
    try:
        completed = subprocess.run(
            [python_exec, "-u", entry_path],
            cwd=workspace.name,
            env=build_python_env(),
            input=stdin_data or "",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            timeout=run_timeout,
        )
        output = f"{completed.stdout or ''}{completed.stderr or ''}" or "(no output)"
        return {"output": output, "return_code": completed.returncode}
    except subprocess.TimeoutExpired as exc:
        stdout = _coerce_stream_value(exc.stdout)
        stderr = _coerce_stream_value(exc.stderr)
        output = f"{stdout}{stderr}"
        if output and not output.endswith("\n"):
            output += "\n"
        output += f"Execution timed out after {run_timeout} seconds."
        return {"output": output, "return_code": -1}
    except Exception as exc:
        return {"output": f"Unexpected error: {str(exc)}", "return_code": 1}
    finally:
        workspace.cleanup()
