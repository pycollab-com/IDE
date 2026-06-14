import asyncio
import io
import os
import uuid
import zipfile

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_project_snapshots_{uuid.uuid4().hex}.db"

import server.main as main_module  # noqa: E402
from server.database import Base, engine  # noqa: E402

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
            "username": f"snapuser{_user_counter}",
            "password": "testpass123",
            "display_name": f"Snapshot User {_user_counter}",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    return {"Authorization": f"Bearer {payload['access_token']}"}, payload["user"]


def _project_file_by_name(project_payload: dict, name: str):
    for file_entry in project_payload.get("files", []):
        if file_entry.get("name") == name:
            return file_entry
    return None


def _clear_realtime_file_state():
    for state in list(main_module._file_states.values()):
        if state.persist_task and not state.persist_task.done():
            state.persist_task.cancel()
    main_module._file_states.clear()
    main_module._file_locks.clear()


def test_snapshot_create_restore_and_delete_roundtrip():
    _clear_realtime_file_state()
    client = TestClient(app)
    owner_headers, _ = _register_user(client)

    create_project = client.post(
        "/projects",
        json={"name": "Snapshot Lab", "description": "restore test", "is_public": True},
        headers=owner_headers,
    )
    assert create_project.status_code == 200
    project = create_project.json()
    project_id = project["id"]
    main_file = _project_file_by_name(project, "main.py")
    assert main_file is not None

    set_main_v1 = client.patch(
        f"/projects/{project_id}/files/{main_file['id']}",
        json={"content": "print('main-v1')"},
        headers=owner_headers,
    )
    assert set_main_v1.status_code == 200

    create_helper = client.post(
        f"/projects/{project_id}/files",
        json={"name": "helpers.py", "content": "print('helper-v1')"},
        headers=owner_headers,
    )
    assert create_helper.status_code == 200
    helper_file = create_helper.json()

    create_snapshot = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": "Baseline"},
        headers=owner_headers,
    )
    assert create_snapshot.status_code == 200
    snapshot = create_snapshot.json()
    assert snapshot["name"] == "Baseline"
    assert snapshot["file_count"] >= 2
    snapshot_id = snapshot["id"]

    mutate_helper = client.patch(
        f"/projects/{project_id}/files/{helper_file['id']}",
        json={"content": "print('helper-v2')"},
        headers=owner_headers,
    )
    assert mutate_helper.status_code == 200

    create_temp = client.post(
        f"/projects/{project_id}/files",
        json={"name": "temp.py", "content": "print('temp-live')"},
        headers=owner_headers,
    )
    assert create_temp.status_code == 200
    temp_file = create_temp.json()

    # Simulate an in-memory edit that hasn't been persisted yet.
    main_module._file_states[main_file["id"]] = main_module._FileSyncState(
        project_id=project_id,
        content="print('main-unsaved')",
        rev=3,
        base_rev=3,
    )
    main_module._file_locks.setdefault(main_file["id"], asyncio.Lock())

    restore_snapshot = client.post(
        f"/projects/{project_id}/snapshots/{snapshot_id}/restore",
        headers=owner_headers,
    )
    assert restore_snapshot.status_code == 200
    assert restore_snapshot.json()["status"] == "restored"
    assert restore_snapshot.json()["updated_files"] == 2
    assert restore_snapshot.json()["restore_scope"] == "full"
    assert restore_snapshot.json()["safety_snapshot"]["name"] == "Before restoring checkpoint: Baseline"

    project_after_restore = client.get(f"/projects/{project_id}", headers=owner_headers)
    assert project_after_restore.status_code == 200
    restored = project_after_restore.json()

    restored_main = _project_file_by_name(restored, "main.py")
    restored_helper = _project_file_by_name(restored, "helpers.py")
    restored_temp = _project_file_by_name(restored, "temp.py")

    assert restored_main is not None
    assert restored_helper is not None
    assert restored_temp is None
    assert restored_main["content"] == "print('main-v1')"
    assert restored_helper["content"] == "print('helper-v1')"
    assert main_module._file_states[main_file["id"]].content == "print('main-v1')"
    assert temp_file["id"] not in main_module._file_states

    list_snapshots = client.get(f"/projects/{project_id}/snapshots", headers=owner_headers)
    assert list_snapshots.status_code == 200
    snapshots_after_restore = list_snapshots.json()
    assert len(snapshots_after_restore) == 2

    delete_snapshot = client.delete(f"/projects/{project_id}/snapshots/{snapshot_id}", headers=owner_headers)
    assert delete_snapshot.status_code == 200

    safety_snapshot_id = next(
        entry["id"]
        for entry in snapshots_after_restore
        if entry["name"] == "Before restoring checkpoint: Baseline"
    )
    delete_safety_snapshot = client.delete(
        f"/projects/{project_id}/snapshots/{safety_snapshot_id}",
        headers=owner_headers,
    )
    assert delete_safety_snapshot.status_code == 200

    list_after_delete = client.get(f"/projects/{project_id}/snapshots", headers=owner_headers)
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []

    client.close()
    _clear_realtime_file_state()


def test_snapshot_inspect_and_partial_restore():
    _clear_realtime_file_state()
    client = TestClient(app)
    owner_headers, _ = _register_user(client)

    create_project = client.post(
        "/projects",
        json={"name": "Snapshot Inspector Lab", "description": "inspect test", "is_public": True},
        headers=owner_headers,
    )
    assert create_project.status_code == 200
    project = create_project.json()
    project_id = project["id"]
    main_file = _project_file_by_name(project, "main.py")
    assert main_file is not None

    set_main_v1 = client.patch(
        f"/projects/{project_id}/files/{main_file['id']}",
        json={"content": "print('main-v1')"},
        headers=owner_headers,
    )
    assert set_main_v1.status_code == 200

    create_helper = client.post(
        f"/projects/{project_id}/files",
        json={"name": "helpers.py", "content": "print('helper-v1')"},
        headers=owner_headers,
    )
    assert create_helper.status_code == 200
    helper_file = create_helper.json()

    create_stable = client.post(
        f"/projects/{project_id}/files",
        json={"name": "stable.py", "content": "print('stable-v1')"},
        headers=owner_headers,
    )
    assert create_stable.status_code == 200

    create_snapshot = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": "Before changes"},
        headers=owner_headers,
    )
    assert create_snapshot.status_code == 200
    snapshot_id = create_snapshot.json()["id"]

    mutate_main = client.patch(
        f"/projects/{project_id}/files/{main_file['id']}",
        json={"content": "print('main-v2')"},
        headers=owner_headers,
    )
    assert mutate_main.status_code == 200

    delete_helper = client.delete(
        f"/projects/{project_id}/files/{helper_file['id']}",
        headers=owner_headers,
    )
    assert delete_helper.status_code == 200

    create_current_only = client.post(
        f"/projects/{project_id}/files",
        json={"name": "current_only.py", "content": "print('added-now')"},
        headers=owner_headers,
    )
    assert create_current_only.status_code == 200

    inspect_snapshot = client.get(
        f"/projects/{project_id}/snapshots/{snapshot_id}/inspect",
        headers=owner_headers,
    )
    assert inspect_snapshot.status_code == 200
    inspection = inspect_snapshot.json()
    assert inspection["changed_file_count"] == 3

    files_by_name = {entry["file_name"]: entry for entry in inspection["files"]}
    assert files_by_name["main.py"]["status"] == "modified"
    assert files_by_name["main.py"]["snapshot_content"] == "print('main-v1')"
    assert files_by_name["main.py"]["current_content"] == "print('main-v2')"
    assert files_by_name["helpers.py"]["status"] == "deleted"
    assert files_by_name["current_only.py"]["status"] == "added"
    assert files_by_name["stable.py"]["status"] == "unchanged"

    delete_without_confirmation = client.post(
        f"/projects/{project_id}/snapshots/{snapshot_id}/restore",
        json={"file_names": ["current_only.py"], "create_safety_snapshot": False},
        headers=owner_headers,
    )
    assert delete_without_confirmation.status_code == 400

    partial_restore = client.post(
        f"/projects/{project_id}/snapshots/{snapshot_id}/restore",
        json={
            "file_names": ["helpers.py", "current_only.py"],
            "allow_added_file_deletions": True,
            "create_safety_snapshot": False,
        },
        headers=owner_headers,
    )
    assert partial_restore.status_code == 200
    payload = partial_restore.json()
    assert payload["restore_scope"] == "partial"
    assert payload["updated_files"] == 2
    assert payload["safety_snapshot"] is None

    project_after_restore = client.get(f"/projects/{project_id}", headers=owner_headers)
    assert project_after_restore.status_code == 200
    restored = project_after_restore.json()

    restored_main = _project_file_by_name(restored, "main.py")
    restored_helper = _project_file_by_name(restored, "helpers.py")
    restored_current_only = _project_file_by_name(restored, "current_only.py")
    restored_stable = _project_file_by_name(restored, "stable.py")

    assert restored_main is not None
    assert restored_main["content"] == "print('main-v2')"
    assert restored_helper is not None
    assert restored_helper["content"] == "print('helper-v1')"
    assert restored_current_only is None
    assert restored_stable is not None
    assert restored_stable["content"] == "print('stable-v1')"

    client.close()
    _clear_realtime_file_state()


def test_snapshot_export_zip_includes_only_python_files():
    _clear_realtime_file_state()
    client = TestClient(app)
    owner_headers, _ = _register_user(client)

    create_project = client.post(
        "/projects",
        json={"name": "Snapshot Export Lab", "description": "export test", "is_public": True},
        headers=owner_headers,
    )
    assert create_project.status_code == 200
    project = create_project.json()
    project_id = project["id"]
    main_file = _project_file_by_name(project, "main.py")
    assert main_file is not None

    update_main = client.patch(
        f"/projects/{project_id}/files/{main_file['id']}",
        json={"content": "print('baseline-main')"},
        headers=owner_headers,
    )
    assert update_main.status_code == 200

    add_notes = client.post(
        f"/projects/{project_id}/files",
        json={"name": "notes.txt", "content": "ignore me"},
        headers=owner_headers,
    )
    assert add_notes.status_code == 200

    add_helper = client.post(
        f"/projects/{project_id}/files",
        json={"name": "helpers.py", "content": "print('helper-v1')"},
        headers=owner_headers,
    )
    assert add_helper.status_code == 200

    create_first_snapshot = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": "Baseline"},
        headers=owner_headers,
    )
    assert create_first_snapshot.status_code == 200
    baseline_snapshot_id = create_first_snapshot.json()["id"]

    update_helper = client.patch(
        f"/projects/{project_id}/files/{add_helper.json()['id']}",
        json={"content": "print('helper-v2')"},
        headers=owner_headers,
    )
    assert update_helper.status_code == 200

    add_runner = client.post(
        f"/projects/{project_id}/files",
        json={"name": "runner.py", "content": "print('runner-v1')"},
        headers=owner_headers,
    )
    assert add_runner.status_code == 200

    create_second_snapshot = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": "Release Candidate"},
        headers=owner_headers,
    )
    assert create_second_snapshot.status_code == 200
    release_snapshot_id = create_second_snapshot.json()["id"]

    baseline_export = client.get(
        f"/projects/{project_id}/snapshots/{baseline_snapshot_id}/export",
        headers=owner_headers,
    )
    assert baseline_export.status_code == 200
    assert baseline_export.headers["content-type"] == "application/zip"
    assert "attachment;" in baseline_export.headers["content-disposition"]

    baseline_archive = zipfile.ZipFile(io.BytesIO(baseline_export.content))
    baseline_names = sorted(baseline_archive.namelist())
    assert baseline_names == [
        "Snapshot-Export-Lab/Baseline/helpers.py",
        "Snapshot-Export-Lab/Baseline/main.py",
    ]
    assert all(name.endswith(".py") for name in baseline_names)
    assert baseline_archive.read("Snapshot-Export-Lab/Baseline/helpers.py").decode() == "print('helper-v1')"
    baseline_archive.close()

    release_export = client.get(
        f"/projects/{project_id}/snapshots/{release_snapshot_id}/export",
        headers=owner_headers,
    )
    assert release_export.status_code == 200

    release_archive = zipfile.ZipFile(io.BytesIO(release_export.content))
    release_names = sorted(release_archive.namelist())
    assert release_names == [
        "Snapshot-Export-Lab/Release-Candidate/helpers.py",
        "Snapshot-Export-Lab/Release-Candidate/main.py",
        "Snapshot-Export-Lab/Release-Candidate/runner.py",
    ]
    assert all(name.endswith(".py") for name in release_names)
    assert release_archive.read("Snapshot-Export-Lab/Release-Candidate/helpers.py").decode() == "print('helper-v2')"
    assert release_archive.read("Snapshot-Export-Lab/Release-Candidate/runner.py").decode() == "print('runner-v1')"
    release_archive.close()

    client.close()
    _clear_realtime_file_state()


def test_snapshot_permissions_for_collaborator_and_viewer():
    _clear_realtime_file_state()
    client = TestClient(app)
    owner_headers, _ = _register_user(client)
    collaborator_headers, _ = _register_user(client)
    outsider_headers, _ = _register_user(client)

    create_project = client.post(
        "/projects",
        json={"name": "Private Checkpoint Room", "description": "private", "is_public": False},
        headers=owner_headers,
    )
    assert create_project.status_code == 200
    project = create_project.json()
    project_id = project["id"]

    share_res = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res.status_code == 200
    token = share_res.json()["token"]

    join_res = client.post(f"/projects/access/{token}", headers=collaborator_headers)
    assert join_res.status_code == 200

    collab_snapshot = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": "Collab Save"},
        headers=collaborator_headers,
    )
    assert collab_snapshot.status_code == 200
    snapshot_id = collab_snapshot.json()["id"]

    collaborator_export = client.get(
        f"/projects/{project_id}/snapshots/{snapshot_id}/export",
        headers=collaborator_headers,
    )
    assert collaborator_export.status_code == 200

    outsider_inspect = client.get(
        f"/projects/{project_id}/snapshots/{snapshot_id}/inspect",
        headers=outsider_headers,
    )
    assert outsider_inspect.status_code == 403

    outsider_list = client.get(f"/projects/{project_id}/snapshots", headers=outsider_headers)
    assert outsider_list.status_code == 403

    outsider_export = client.get(
        f"/projects/{project_id}/snapshots/{snapshot_id}/export",
        headers=outsider_headers,
    )
    assert outsider_export.status_code == 403

    outsider_create = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": "No Access"},
        headers=outsider_headers,
    )
    assert outsider_create.status_code == 403

    too_long_name = "x" * 121
    bad_name = client.post(
        f"/projects/{project_id}/snapshots",
        json={"name": too_long_name},
        headers=owner_headers,
    )
    assert bad_name.status_code == 400

    restore_by_owner = client.post(
        f"/projects/{project_id}/snapshots/{snapshot_id}/restore",
        headers=owner_headers,
    )
    assert restore_by_owner.status_code == 200

    client.close()
    _clear_realtime_file_state()
