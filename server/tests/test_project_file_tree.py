import os
import uuid

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_project_file_tree_{uuid.uuid4().hex}.db"

from fastapi.testclient import TestClient  # noqa: E402

import server.main as main_module  # noqa: E402
from server.database import Base, engine  # noqa: E402


app = main_module.app

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


def _register_user(client: TestClient):
    res = client.post(
        "/auth/register",
        json={
            "username": f"treeuser{uuid.uuid4().hex[:10]}",
            "password": "testpass123",
            "display_name": "Tree User",
        },
    )
    assert res.status_code == 200, res.text
    payload = res.json()
    return {"Authorization": f"Bearer {payload['access_token']}"}


def test_project_file_tree_folders_moves_and_recursive_delete():
    client = TestClient(app)
    headers = _register_user(client)

    res = client.post("/projects", json={"name": "Tree Project"}, headers=headers)
    assert res.status_code == 200, res.text
    project_id = res.json()["id"]

    folder_res = client.post(
        f"/projects/{project_id}/folders",
        json={"name": "src"},
        headers=headers,
    )
    assert folder_res.status_code == 200, folder_res.text
    src = folder_res.json()
    assert src["path"] == "src"

    file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "utils.py", "folder_path": "src", "content": "VALUE = 1\n"},
        headers=headers,
    )
    assert file_res.status_code == 200, file_res.text
    utils_file = file_res.json()
    assert utils_file["name"] == "src/utils.py"

    rename_res = client.patch(
        f"/projects/{project_id}/folders/{src['id']}",
        json={"name": "lib"},
        headers=headers,
    )
    assert rename_res.status_code == 200, rename_res.text
    assert rename_res.json()["path"] == "lib"

    project_res = client.get(f"/projects/{project_id}", headers=headers)
    assert project_res.status_code == 200, project_res.text
    project = project_res.json()
    assert [folder["path"] for folder in project["folders"]] == ["lib"]
    renamed_file = next(file for file in project["files"] if file["id"] == utils_file["id"])
    assert renamed_file["name"] == "lib/utils.py"

    tests_res = client.post(
        f"/projects/{project_id}/folders",
        json={"name": "tests"},
        headers=headers,
    )
    assert tests_res.status_code == 200, tests_res.text

    move_res = client.patch(
        f"/projects/{project_id}/tree/move",
        json={
            "kind": "file",
            "id": utils_file["id"],
            "target_parent_path": "tests",
            "ordered_siblings": [{"kind": "file", "id": utils_file["id"]}],
        },
        headers=headers,
    )
    assert move_res.status_code == 200, move_res.text
    moved_file = next(file for file in move_res.json()["files"] if file["id"] == utils_file["id"])
    assert moved_file["name"] == "tests/utils.py"
    assert moved_file["sort_order"] == 1000

    nested_folder_res = client.post(
        f"/projects/{project_id}/folders",
        json={"name": "helpers", "parent_path": "tests"},
        headers=headers,
    )
    assert nested_folder_res.status_code == 200, nested_folder_res.text
    move_folder_res = client.patch(
        f"/projects/{project_id}/tree/move",
        json={
            "kind": "folder",
            "id": nested_folder_res.json()["id"],
            "target_parent_path": "lib",
            "ordered_siblings": [{"kind": "folder", "id": nested_folder_res.json()["id"]}],
        },
        headers=headers,
    )
    assert move_folder_res.status_code == 200, move_folder_res.text
    assert any(folder["path"] == "lib/helpers" for folder in move_folder_res.json()["folders"])

    delete_res = client.delete(f"/projects/{project_id}/folders/{tests_res.json()['id']}", headers=headers)
    assert delete_res.status_code == 200, delete_res.text

    final_project_res = client.get(f"/projects/{project_id}", headers=headers)
    assert final_project_res.status_code == 200, final_project_res.text
    final_project = final_project_res.json()
    assert all(file["id"] != utils_file["id"] for file in final_project["files"])
    assert {folder["path"] for folder in final_project["folders"]} == {"lib", "lib/helpers"}

    client.close()


def test_project_file_tree_rejects_duplicate_sibling_names_and_implicit_folder_conflicts():
    client = TestClient(app)
    headers = _register_user(client)

    res = client.post("/projects", json={"name": "Tree Duplicate Project"}, headers=headers)
    assert res.status_code == 200, res.text
    project_id = res.json()["id"]

    folder_res = client.post(f"/projects/{project_id}/folders", json={"name": "src"}, headers=headers)
    assert folder_res.status_code == 200, folder_res.text

    duplicate_folder_res = client.post(f"/projects/{project_id}/folders", json={"name": "SRC"}, headers=headers)
    assert duplicate_folder_res.status_code == 409

    file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "main.py", "folder_path": "src", "content": ""},
        headers=headers,
    )
    assert file_res.status_code == 200, file_res.text

    duplicate_file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "MAIN.py", "folder_path": "src", "content": ""},
        headers=headers,
    )
    assert duplicate_file_res.status_code == 409

    folder_file_conflict_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "src", "content": ""},
        headers=headers,
    )
    assert folder_file_conflict_res.status_code == 409

    root_file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "archive", "content": ""},
        headers=headers,
    )
    assert root_file_res.status_code == 200

    child_under_file_res = client.post(
        f"/projects/{project_id}/files",
        json={"name": "nested.py", "folder_path": "archive", "content": ""},
        headers=headers,
    )
    assert child_under_file_res.status_code == 404

    client.close()
