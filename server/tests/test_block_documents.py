import asyncio
import os
import uuid

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_block_documents_{uuid.uuid4().hex}.db"

import server.main as main_module  # noqa: E402
from server.database import Base, engine, SessionLocal  # noqa: E402
from server import models  # noqa: E402

app = main_module.app

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

_user_counter = 0


def _register_user(client: TestClient):
    global _user_counter
    _user_counter += 1
    response = client.post(
        "/auth/register",
        json={
            "username": f"blockuser{_user_counter}",
            "password": "testpass123",
            "display_name": f"Block User {_user_counter}",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    return {"Authorization": f"Bearer {payload['access_token']}"}, payload["user"]


def _clear_block_state():
    for state in list(main_module._block_states.values()):
        if state.persist_task and not state.persist_task.done():
            state.persist_task.cancel()
    main_module._block_states.clear()
    main_module._block_locks.clear()
    main_module._sid_info.clear()


def test_pybricks_project_creates_default_block_document():
    _clear_block_state()
    client = TestClient(app)
    headers, _ = _register_user(client)

    response = client.post(
        "/projects",
        json={"name": "Blocks Lab", "project_type": "pybricks"},
        headers=headers,
    )
    assert response.status_code == 200
    project = response.json()

    assert project["editor_mode"] == "text"
    assert len(project["block_documents"]) == 1
    assert project["entry_block_document_id"] == project["block_documents"][0]["id"]
    assert project["block_documents"][0]["generated_entry_module"] == "main.py"
    assert "blockGlobalStart" in project["block_documents"][0]["workspace_json"]

    client.close()
    _clear_block_state()


def test_duplicate_project_copies_block_documents():
    _clear_block_state()
    client = TestClient(app)
    headers, _ = _register_user(client)

    response = client.post(
        "/projects",
        json={"name": "Blocks Source", "project_type": "pybricks"},
        headers=headers,
    )
    assert response.status_code == 200
    project = response.json()

    duplicate = client.post(f"/projects/{project['id']}/duplicate", headers=headers)
    assert duplicate.status_code == 200
    duplicated_project = duplicate.json()

    assert duplicated_project["editor_mode"] == "text"
    assert len(duplicated_project["block_documents"]) == 1
    assert duplicated_project["block_documents"][0]["workspace_json"] == project["block_documents"][0]["workspace_json"]
    assert duplicated_project["entry_block_document_id"] == duplicated_project["block_documents"][0]["id"]

    client.close()
    _clear_block_state()


def test_block_document_crud_routes():
    _clear_block_state()
    client = TestClient(app)
    headers, _ = _register_user(client)

    response = client.post(
        "/projects",
        json={"name": "Blocks CRUD", "project_type": "pybricks"},
        headers=headers,
    )
    assert response.status_code == 200
    project = response.json()
    default_document = project["block_documents"][0]

    created = client.post(
        f"/projects/{project['id']}/block-documents",
        json={"name": "Drive Base"},
        headers=headers,
    )
    assert created.status_code == 200
    created_document = created.json()
    assert created_document["name"] == "Drive Base"
    assert created_document["generated_entry_module"] == "drive_base.py"

    renamed = client.patch(
        f"/projects/{project['id']}/block-documents/{created_document['id']}",
        json={"name": "Sensors"},
        headers=headers,
    )
    assert renamed.status_code == 200
    renamed_document = renamed.json()
    assert renamed_document["name"] == "Sensors"
    assert renamed_document["generated_entry_module"] == "sensors.py"

    deleted = client.delete(
        f"/projects/{project['id']}/block-documents/{default_document['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200

    refreshed = client.get(f"/projects/{project['id']}", headers=headers)
    assert refreshed.status_code == 200
    refreshed_project = refreshed.json()
    assert len(refreshed_project["block_documents"]) == 1
    assert refreshed_project["block_documents"][0]["id"] == created_document["id"]
    assert refreshed_project["entry_block_document_id"] == created_document["id"]

    client.close()
    _clear_block_state()


def test_normal_projects_hide_and_reject_block_documents():
    _clear_block_state()
    client = TestClient(app)
    headers, _ = _register_user(client)

    response = client.post(
        "/projects",
        json={"name": "Plain Python", "project_type": "normal"},
        headers=headers,
    )
    assert response.status_code == 200
    project = response.json()
    assert project["block_documents"] == []

    db = SessionLocal()
    try:
        db.add(
            models.ProjectBlockDocument(
                project_id=project["id"],
                name="Leaked Blocks",
                workspace_json="{}",
                workspace_version=1,
                generated_entry_module="leaked_blocks.py",
            )
        )
        db.commit()
    finally:
        db.close()

    refreshed = client.get(f"/projects/{project['id']}", headers=headers)
    assert refreshed.status_code == 200
    assert refreshed.json()["block_documents"] == []

    created = client.post(
        f"/projects/{project['id']}/block-documents",
        json={"name": "Should Fail"},
        headers=headers,
    )
    assert created.status_code == 400
    assert created.json()["detail"] == "Block files are only supported for Pybricks projects"

    client.close()
    _clear_block_state()


def test_pybricks_host_page_is_served_directly():
    client = TestClient(app)

    response = client.get("/pybricks-blocks-host.html")

    assert response.status_code == 200
    assert "Pybricks Blocks Host" in response.text
    assert "<script type=\"module\" src=\"/pybricks-blocks-host.js\"></script>" in response.text

    client.close()


def test_pybricks_host_page_bypasses_spa_html_fallback():
    client = TestClient(app)

    response = client.get(
        "/pybricks-blocks-host.html",
        headers={"Accept": "text/html"},
    )

    assert response.status_code == 200
    assert "Pybricks Blocks Host" in response.text
    assert "Did you forget a semicolon somewhere" not in response.text

    client.close()


def test_blocks_op_and_snapshot_roundtrip():
    _clear_block_state()
    client = TestClient(app)
    headers, user = _register_user(client)

    response = client.post(
        "/projects",
        json={"name": "Realtime Blocks", "project_type": "pybricks"},
        headers=headers,
    )
    assert response.status_code == 200
    project = response.json()
    document = project["block_documents"][0]

    main_module._sid_info["sid-1"] = {
        "user_id": user["id"],
        "is_admin": False,
        "project_id": project["id"],
        "can_edit": True,
        "name": user["display_name"],
    }

    emitted = []

    async def fake_emit(event, payload, room=None, skip_sid=None):
        emitted.append((event, payload, room, skip_sid))

    original_emit = main_module.sio.emit
    main_module.sio.emit = fake_emit
    try:
        workspace_json = '{"languageVersion":0,"blocks":{"blocks":[]}}'
        asyncio.run(
            main_module.blocks_op(
                "sid-1",
                {
                    "projectId": project["id"],
                    "documentId": document["id"],
                    "baseRev": 0,
                    "opId": "op-1",
                    "event": {"type": "create"},
                    "workspaceJson": workspace_json,
                },
            )
        )

        assert any(event == "blocks_op_ack" for event, *_ in emitted)
        state = main_module._block_states[document["id"]]
        assert state.rev == 1
        assert state.workspace_json == workspace_json

        emitted.clear()
        asyncio.run(
            main_module.blocks_sync_request(
                "sid-1",
                {
                    "projectId": project["id"],
                    "documentId": document["id"],
                    "fromRev": 0,
                },
            )
        )
        assert any(event == "blocks_ops" for event, *_ in emitted)

        db = SessionLocal()
        try:
            persisted = (
                db.query(models.ProjectBlockDocument)
                .filter(models.ProjectBlockDocument.id == document["id"])
                .first()
            )
            assert persisted is not None
        finally:
            db.close()
    finally:
        main_module.sio.emit = original_emit
        client.close()
        _clear_block_state()
