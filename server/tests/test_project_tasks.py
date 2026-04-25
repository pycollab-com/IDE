import os
import uuid

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_project_tasks_{uuid.uuid4().hex}.db"

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
            "username": f"taskuser{_user_counter}",
            "password": "testpass123",
            "display_name": f"Task User {_user_counter}",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    return {"Authorization": f"Bearer {payload['access_token']}"}, payload["user"]


def test_project_tasks_crud_and_public_viewer_permissions():
    client = TestClient(app)
    owner_headers, owner = _register_user(client)
    viewer_headers, viewer = _register_user(client)

    create_project = client.post(
        "/projects",
        json={"name": "Task Board", "description": "task test", "is_public": True},
        headers=owner_headers,
    )
    assert create_project.status_code == 200
    project_id = create_project.json()["id"]

    create_task = client.post(
        f"/projects/{project_id}/tasks",
        json={"content": "Investigate flaky test"},
        headers=owner_headers,
    )
    assert create_task.status_code == 200
    task = create_task.json()
    assert task["content"] == "Investigate flaky test"
    assert task["is_done"] is False
    assert task["created_by_user_id"] == owner["id"]
    assert task["assigned_to_user_id"] is None
    assert task["completed_by_user_id"] is None

    task_id = task["id"]

    list_tasks_owner = client.get(f"/projects/{project_id}/tasks", headers=owner_headers)
    assert list_tasks_owner.status_code == 200
    assert len(list_tasks_owner.json()) == 1

    list_tasks_viewer = client.get(f"/projects/{project_id}/tasks", headers=viewer_headers)
    assert list_tasks_viewer.status_code == 200
    assert len(list_tasks_viewer.json()) == 1

    viewer_create = client.post(
        f"/projects/{project_id}/tasks",
        json={"content": "Should fail"},
        headers=viewer_headers,
    )
    assert viewer_create.status_code == 403

    assign_to_owner = client.patch(
        f"/projects/{project_id}/tasks/{task_id}",
        json={"assigned_to_user_id": owner["id"]},
        headers=owner_headers,
    )
    assert assign_to_owner.status_code == 200
    assert assign_to_owner.json()["assigned_to_user_id"] == owner["id"]
    assert assign_to_owner.json()["assigned_to_name"] == owner["display_name"]

    clear_assignment = client.patch(
        f"/projects/{project_id}/tasks/{task_id}",
        json={"assigned_to_user_id": None},
        headers=owner_headers,
    )
    assert clear_assignment.status_code == 200
    assert clear_assignment.json()["assigned_to_user_id"] is None
    assert clear_assignment.json()["assigned_to_name"] is None

    # Public viewers can read tasks, but cannot be selected as assignees.
    invalid_public_viewer_assignee = client.patch(
        f"/projects/{project_id}/tasks/{task_id}",
        json={"assigned_to_user_id": viewer["id"]},
        headers=owner_headers,
    )
    assert invalid_public_viewer_assignee.status_code == 400

    complete_task = client.patch(
        f"/projects/{project_id}/tasks/{task_id}",
        json={"is_done": True},
        headers=owner_headers,
    )
    assert complete_task.status_code == 200
    completed_payload = complete_task.json()
    assert completed_payload["is_done"] is True
    assert completed_payload["completed_by_user_id"] == owner["id"]
    assert completed_payload["completed_at"] is not None

    invalid_update = client.patch(
        f"/projects/{project_id}/tasks/{task_id}",
        json={"content": "   "},
        headers=owner_headers,
    )
    assert invalid_update.status_code == 400

    reopen_task = client.patch(
        f"/projects/{project_id}/tasks/{task_id}",
        json={"is_done": False},
        headers=owner_headers,
    )
    assert reopen_task.status_code == 200
    reopened_payload = reopen_task.json()
    assert reopened_payload["is_done"] is False
    assert reopened_payload["completed_by_user_id"] is None
    assert reopened_payload["completed_at"] is None

    delete_task = client.delete(f"/projects/{project_id}/tasks/{task_id}", headers=owner_headers)
    assert delete_task.status_code == 200

    list_after_delete = client.get(f"/projects/{project_id}/tasks", headers=owner_headers)
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []

    client.close()


def test_private_collaborator_can_manage_tasks_after_joining_via_share():
    client = TestClient(app)
    owner_headers, owner = _register_user(client)
    collaborator_headers, collaborator = _register_user(client)

    create_project = client.post(
        "/projects",
        json={"name": "Private Task Room", "description": "private", "is_public": False},
        headers=owner_headers,
    )
    assert create_project.status_code == 200
    project_id = create_project.json()["id"]

    share_res = client.post(f"/projects/{project_id}/share", headers=owner_headers)
    assert share_res.status_code == 200
    token = share_res.json()["token"]

    access_res = client.post(f"/projects/access/{token}", headers=collaborator_headers)
    assert access_res.status_code == 200
    collaborator_ids = {entry["user_id"] for entry in access_res.json().get("collaborators", [])}
    assert collaborator["id"] in collaborator_ids

    create_task = client.post(
        f"/projects/{project_id}/tasks",
        json={"content": "Draft release checklist"},
        headers=collaborator_headers,
    )
    assert create_task.status_code == 200
    task = create_task.json()
    assert task["created_by_user_id"] == collaborator["id"]

    update_task = client.patch(
        f"/projects/{project_id}/tasks/{task['id']}",
        json={
            "content": "Draft release checklist v2",
            "is_done": True,
            "assigned_to_user_id": owner["id"],
        },
        headers=collaborator_headers,
    )
    assert update_task.status_code == 200
    assert update_task.json()["content"] == "Draft release checklist v2"
    assert update_task.json()["is_done"] is True
    assert update_task.json()["assigned_to_user_id"] == owner["id"]
    assert update_task.json()["assigned_to_name"] == owner["display_name"]

    owner_reads = client.get(f"/projects/{project_id}/tasks", headers=owner_headers)
    assert owner_reads.status_code == 200
    assert len(owner_reads.json()) == 1

    client.close()
