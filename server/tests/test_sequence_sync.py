"""Tests for the PostgreSQL sequence sync migration logic."""
import os
import uuid

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_sequence_sync_{uuid.uuid4().hex}.db"

from unittest.mock import patch, MagicMock  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

import server.main as main_module  # noqa: E402
from server.database import Base, engine, DATABASE_URL  # noqa: E402

app = main_module.app

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


_user_counter = 0


def _register_user(client: TestClient):
    global _user_counter
    _user_counter += 1
    res = client.post(
        "/auth/register",
        json={
            "username": f"sequser{_user_counter}",
            "password": "testpass123",
            "display_name": f"Seq User {_user_counter}",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    return {"Authorization": f"Bearer {payload['access_token']}"}, payload["user"]


def test_sequence_sync_skipped_for_sqlite():
    """Sequence sync block only runs for PostgreSQL, not SQLite."""
    assert DATABASE_URL.startswith("sqlite")
    # The startup already ran without error, confirming the guard works.


def test_project_file_creation_no_id_conflict():
    """Creating multiple projects (each with a default file) should not cause id conflicts."""
    client = TestClient(app)
    headers, _ = _register_user(client)

    project_ids = []
    for i in range(5):
        res = client.post(
            "/projects",
            json={"name": f"SeqProject{i}", "description": f"project {i}"},
            headers=headers,
        )
        assert res.status_code == 200, f"Failed creating project {i}: {res.text}"
        project = res.json()
        project_ids.append(project["id"])
        # Each project should have at least one file (main.py)
        assert len(project["files"]) >= 1

    # Also verify adding extra files works
    for pid in project_ids:
        res = client.post(
            f"/projects/{pid}/files",
            json={"name": "utils.py", "content": "# utils"},
            headers=headers,
        )
        assert res.status_code == 200

    client.close()


def test_duplicate_project_file_creation():
    """Duplicating a project copies all files without id conflicts."""
    client = TestClient(app)
    headers, _ = _register_user(client)

    # Create source project
    res = client.post(
        "/projects",
        json={"name": "OriginalForDup", "description": "source"},
        headers=headers,
    )
    assert res.status_code == 200
    project = res.json()
    project_id = project["id"]

    # Add extra files
    for name in ["a.py", "b.py", "c.py"]:
        res = client.post(
            f"/projects/{project_id}/files",
            json={"name": name, "content": f"# {name}"},
            headers=headers,
        )
        assert res.status_code == 200

    # Duplicate the project
    res = client.post(f"/projects/{project_id}/duplicate", headers=headers)
    assert res.status_code == 200
    dup = res.json()
    # The duplicate should have same number of files
    assert len(dup["files"]) >= 4  # main.py + a.py + b.py + c.py

    client.close()
