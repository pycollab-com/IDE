import os
import re
import uuid

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_execution_{uuid.uuid4().hex}.db"

import server.main as main_module  # noqa: E402
from server.main import app  # noqa: E402
from server.database import Base, engine  # noqa: E402


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


_user_counter = 0


def _register_user(client: TestClient):
    global _user_counter
    _user_counter += 1
    res = client.post(
        "/auth/register",
        json={
            "username": f"vieweruser{_user_counter}",
            "password": "testpass123",
            "display_name": f"Viewer {_user_counter}",
        },
    )
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, res.json()["user"]


def test_runtime_config_endpoint_defaults(monkeypatch):
    monkeypatch.delenv("PYCOLLAB_PYODIDE_VERSION", raising=False)
    monkeypatch.delenv("PYCOLLAB_PYODIDE_BASE_URL", raising=False)
    monkeypatch.delenv("PYCOLLAB_PYODIDE_ALLOWED_PACKAGES", raising=False)
    monkeypatch.delenv("PYCOLLAB_PYODIDE_MAX_RUN_SECONDS", raising=False)

    client = TestClient(app)
    res = client.get("/runtime/pyodide-config")
    client.close()

    assert res.status_code == 200
    payload = res.json()
    assert payload["pyodide_version"] == "0.29.3"
    assert payload["pyodide_base_url"] == "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/"
    assert payload["allowed_packages"] == []
    assert payload["max_run_seconds"] == 0


def test_legacy_run_endpoint_returns_410():
    client = TestClient(app)
    res = client.post("/projects/1/run", json={"file_id": 1, "stdin": ""})
    client.close()

    assert res.status_code == 410
    assert res.json()["detail"] == "Server runner removed. Refresh to use browser runtime."


def test_legacy_compiler_ws_tombstone_no_execution():
    client = TestClient(app)
    with client.websocket_connect("/ws/compiler/1") as ws:
        first = ws.receive_json()
        second = ws.receive_json()
    client.close()

    assert first["type"] == "stderr"
    assert "Server compiler removed" in first["data"]
    assert second == {"type": "status", "state": "stopped"}


def test_coop_coep_headers_present_by_default(monkeypatch):
    monkeypatch.delenv("PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION", raising=False)
    client = TestClient(app)
    res = client.get("/runtime/pyodide-config")
    client.close()

    assert res.headers["cross-origin-opener-policy"] == "same-origin"
    assert res.headers["cross-origin-embedder-policy"] == "require-corp"


def test_coop_coep_headers_absent_when_disabled(monkeypatch):
    monkeypatch.setenv("PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION", "false")
    client = TestClient(app)
    res = client.get("/runtime/pyodide-config")
    client.close()

    assert "cross-origin-opener-policy" not in res.headers
    assert "cross-origin-embedder-policy" not in res.headers


def test_coop_coep_headers_absent_on_google_auth_entry_paths(monkeypatch):
    monkeypatch.delenv("PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION", raising=False)
    client = TestClient(app)
    res = client.get("/login")
    client.close()

    assert "cross-origin-opener-policy" not in res.headers
    assert "cross-origin-embedder-policy" not in res.headers


def test_coop_coep_headers_present_outside_google_auth_entry_paths(monkeypatch):
    monkeypatch.delenv("PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION", raising=False)
    client = TestClient(app)
    res = client.get("/projects/123")
    client.close()

    assert res.headers["cross-origin-opener-policy"] == "same-origin"
    assert res.headers["cross-origin-embedder-policy"] == "require-corp"


def test_coop_coep_headers_present_on_share_paths(monkeypatch):
    monkeypatch.delenv("PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION", raising=False)
    client = TestClient(app)
    res = client.get("/share/123456")
    client.close()

    assert res.headers["cross-origin-opener-policy"] == "same-origin"
    assert res.headers["cross-origin-embedder-policy"] == "require-corp"


def test_public_project_viewer_cannot_write_or_mutate_files():
    client = TestClient(app)
    owner_headers, _ = _register_user(client)
    viewer_headers, _ = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Public Demo", "description": "x", "is_public": True},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project = create_project_res.json()
    project_id = project["id"]

    assert project["files"]
    file_id = project["files"][0]["id"]

    update_project_res = client.patch(
        f"/projects/{project_id}",
        json={"name": "Nope", "description": "no", "is_public": True},
        headers=viewer_headers,
    )
    assert update_project_res.status_code == 403

    add_file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "other.py", "content": ""},
        headers=viewer_headers,
    )
    assert add_file_res.status_code == 403

    patch_file_res = client.patch(
        f"/projects/{project_id}/files/{file_id}",
        json={"content": "print('changed')"},
        headers=viewer_headers,
    )
    assert patch_file_res.status_code == 403

    delete_file_res = client.delete(f"/projects/{project_id}/files/{file_id}", headers=viewer_headers)
    assert delete_file_res.status_code == 403
    client.close()


def test_project_permissions_are_server_derived_for_owner_collaborator_and_viewer():
    client = TestClient(app)
    owner_headers, owner = _register_user(client)
    collaborator_headers, collaborator = _register_user(client)
    viewer_headers, _ = _register_user(client)

    private_project_res = client.post(
        "/projects",
        json={"name": "Private Permissions", "description": "x", "is_public": False},
        headers=owner_headers,
    )
    assert private_project_res.status_code == 200
    private_project = private_project_res.json()

    share_res = client.post(f"/projects/{private_project['id']}/share", headers=owner_headers)
    assert share_res.status_code == 200
    join_res = client.post(f"/projects/access/{share_res.json()['token']}", headers=collaborator_headers)
    assert join_res.status_code == 200

    owner_project_res = client.get(f"/projects/{private_project['id']}", headers=owner_headers)
    assert owner_project_res.status_code == 200
    owner_permissions = owner_project_res.json()["permissions"]
    assert owner_permissions == {
        "is_owner": True,
        "is_collaborator": False,
        "can_view": True,
        "can_edit": True,
        "can_manage": True,
        "can_share": True,
        "can_toggle_visibility": True,
    }

    collaborator_project_res = client.get(f"/projects/{private_project['id']}", headers=collaborator_headers)
    assert collaborator_project_res.status_code == 200
    collaborator_permissions = collaborator_project_res.json()["permissions"]
    assert collaborator_permissions == {
        "is_owner": False,
        "is_collaborator": True,
        "can_view": True,
        "can_edit": True,
        "can_manage": False,
        "can_share": True,
        "can_toggle_visibility": False,
    }
    collaborator_ids = {
        entry["user_id"]
        for entry in collaborator_project_res.json().get("collaborators", [])
    }
    assert collaborator["id"] in collaborator_ids

    public_project_res = client.post(
        "/projects",
        json={"name": "Public Permissions", "description": "y", "is_public": True},
        headers=owner_headers,
    )
    assert public_project_res.status_code == 200
    public_project = public_project_res.json()

    viewer_project_res = client.get(f"/projects/{public_project['id']}", headers=viewer_headers)
    assert viewer_project_res.status_code == 200
    viewer_permissions = viewer_project_res.json()["permissions"]
    assert viewer_permissions == {
        "is_owner": False,
        "is_collaborator": False,
        "can_view": True,
        "can_edit": False,
        "can_manage": False,
        "can_share": False,
        "can_toggle_visibility": False,
    }
    assert viewer_project_res.json()["owner_id"] == owner["id"]
    client.close()


def test_collaborator_can_edit_and_share_but_cannot_delete_project(monkeypatch):
    main_module._clear_rate_limit_buckets()
    monkeypatch.setattr(main_module, "JOIN_CODE_RATE_LIMIT_PER_MINUTE", 100000)
    client = TestClient(app)
    owner_headers, _ = _register_user(client)
    collaborator_headers, _ = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Owner Delete Only", "description": "x", "is_public": False},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project_id = create_project_res.json()["id"]

    share_res = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res.status_code == 200
    join_res = client.post(f"/projects/access/{share_res.json()['token']}", headers=collaborator_headers)
    assert join_res.status_code == 200
    assert join_res.json()["permissions"]["can_edit"] is True
    assert join_res.json()["permissions"]["can_share"] is True

    edit_res = client.patch(
        f"/projects/{project_id}",
        json={"name": "Edited By Collaborator", "description": "x", "is_public": False},
        headers=collaborator_headers,
    )
    assert edit_res.status_code == 200

    collaborator_share_res = client.post(f"/projects/{project_id}/share", headers=collaborator_headers)
    assert collaborator_share_res.status_code == 200
    assert collaborator_share_res.json()["token"] == share_res.json()["token"]

    collaborator_delete_res = client.delete(f"/projects/{project_id}", headers=collaborator_headers)
    assert collaborator_delete_res.status_code == 403
    assert collaborator_delete_res.json()["detail"] == "Only owner can delete project"

    owner_delete_res = client.delete(f"/projects/{project_id}", headers=owner_headers)
    assert owner_delete_res.status_code == 200
    client.close()
    main_module._clear_rate_limit_buckets()


def test_join_code_attempts_are_rate_limited(monkeypatch):
    main_module._clear_rate_limit_buckets()
    monkeypatch.setattr(main_module, "JOIN_CODE_RATE_LIMIT_PER_MINUTE", 2)
    client = TestClient(app)
    headers, _ = _register_user(client)

    first = client.post("/projects/access/aaaaaa", headers=headers)
    second = client.post("/projects/access/bbbbbb", headers=headers)
    third = client.post("/projects/access/cccccc", headers=headers)

    assert first.status_code == 404
    assert second.status_code == 404
    assert third.status_code == 429
    assert third.json()["detail"] == "Rate limit exceeded"

    client.close()
    main_module._clear_rate_limit_buckets()


def test_project_public_id_is_generated_and_resolves_project_route():
    client = TestClient(app)
    owner_headers, _ = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Opaque Route", "description": "x", "is_public": False},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project = create_project_res.json()

    assert re.fullmatch(r"[a-z][a-z0-9]{19}", project["public_id"])

    get_by_public_id = client.get(f"/projects/{project['public_id']}", headers=owner_headers)
    assert get_by_public_id.status_code == 200
    assert get_by_public_id.json()["id"] == project["id"]
    assert get_by_public_id.json()["public_id"] == project["public_id"]
    client.close()


def test_public_normal_share_access_does_not_promote_viewer_to_collaborator():
    client = TestClient(app)
    owner_headers, _ = _register_user(client)
    viewer_headers, viewer = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Public Share", "description": "x", "is_public": True},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project_id = create_project_res.json()["id"]

    share_res = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res.status_code == 200
    token = share_res.json()["token"]

    access_res = client.post(f"/projects/access/{token}", headers=viewer_headers)
    assert access_res.status_code == 200
    collaborator_ids = {c["user_id"] for c in access_res.json().get("collaborators", [])}
    assert viewer["id"] not in collaborator_ids
    client.close()


def test_share_pin_is_project_based_and_idempotent():
    """Sharing a project returns the same PIN on multiple calls (project-based, not session-based)."""
    client = TestClient(app)
    owner_headers, _ = _register_user(client)
    viewer_headers, viewer = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Pin Project", "description": "test", "is_public": False},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project_id = create_project_res.json()["id"]

    # First share call generates a PIN
    share_res1 = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res1.status_code == 200
    pin1 = share_res1.json()["token"]
    assert len(pin1) == 6
    assert re.fullmatch(r"[0-9a-z]{6}", pin1)

    # Second share call returns the same PIN
    share_res2 = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res2.status_code == 200
    pin2 = share_res2.json()["token"]
    assert pin1 == pin2

    # Viewer can join via the PIN
    access_res = client.post(f"/projects/access/{pin1}", headers=viewer_headers)
    assert access_res.status_code == 200
    assert access_res.json()["id"] == project_id
    collaborator_ids = {c["user_id"] for c in access_res.json().get("collaborators", [])}
    assert viewer["id"] in collaborator_ids

    # Uppercase input should still resolve to the same lowercase share code.
    access_res_upper = client.post(f"/projects/access/{pin1.upper()}", headers=viewer_headers)
    assert access_res_upper.status_code == 200
    assert access_res_upper.json()["id"] == project_id

    client.close()


def test_project_can_be_renamed_and_duplicated_with_files():
    client = TestClient(app)
    owner_headers, _ = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Original Project", "description": "seed", "is_public": True},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project = create_project_res.json()
    project_id = project["id"]

    add_file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "helpers.py", "content": "print('helper')"},
        headers=owner_headers,
    )
    assert add_file_res.status_code == 200

    rename_res = client.patch(
        f"/projects/{project_id}",
        json={"name": "Renamed Project", "description": "seed", "is_public": True},
        headers=owner_headers,
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["name"] == "Renamed Project"

    duplicate_res = client.post(f"/projects/{project_id}/duplicate", headers=owner_headers)
    assert duplicate_res.status_code == 200

    duplicated = duplicate_res.json()
    assert duplicated["id"] != project_id
    assert duplicated["name"] == "Renamed Project Copy"
    assert duplicated["owner_id"] == project["owner_id"]
    assert duplicated["is_public"] is False
    assert duplicated["project_type"] == "normal"

    file_names = {f["name"] for f in duplicated["files"]}
    assert {"main.py", "helpers.py"}.issubset(file_names)
    helpers = next(f for f in duplicated["files"] if f["name"] == "helpers.py")
    assert helpers["content"] == "print('helper')"
    client.close()


def test_pybricks_project_type_is_persisted_and_gets_pybricks_starter():
    client = TestClient(app)
    owner_headers, _ = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Robot Code", "project_type": "pybricks", "description": "hub", "is_public": False},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project = create_project_res.json()

    assert project["project_type"] == "pybricks"
    assert project["files"]
    assert "from pybricks.hubs import PrimeHub" in project["files"][0]["content"]

    duplicate_res = client.post(f"/projects/{project['id']}/duplicate", headers=owner_headers)
    assert duplicate_res.status_code == 200
    assert duplicate_res.json()["project_type"] == "pybricks"

    client.close()


def test_public_pybricks_share_access_promotes_viewer_to_collaborator():
    client = TestClient(app)
    owner_headers, _ = _register_user(client)
    viewer_headers, viewer = _register_user(client)

    create_project_res = client.post(
        "/projects",
        json={"name": "Robot Share", "project_type": "pybricks", "description": "hub", "is_public": True},
        headers=owner_headers,
    )
    assert create_project_res.status_code == 200
    project_id = create_project_res.json()["id"]

    share_res = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res.status_code == 200
    token = share_res.json()["token"]

    access_res = client.post(f"/projects/access/{token}", headers=viewer_headers)
    assert access_res.status_code == 200
    collaborator_ids = {c["user_id"] for c in access_res.json().get("collaborators", [])}
    assert collaborator_ids == {viewer["id"]}
    client.close()
