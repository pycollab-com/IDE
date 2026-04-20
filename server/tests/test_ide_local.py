import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient


def test_local_project_create_task_snapshot_and_restore():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["PYCOLLAB_IDE_HOME"] = os.path.join(temp_dir, "ide-home")

        from server.ide_app import app

        client = TestClient(app)
        project_root = Path(temp_dir) / "projects"
        project_root.mkdir(parents=True, exist_ok=True)

        create = client.post(
            "/ide/projects/create",
            json={
                "name": "Offline Bot",
                "project_type": "normal",
                "location_path": str(project_root),
            },
        )
        assert create.status_code == 200
        project = create.json()
        project_id = project["id"]
        assert project["project_type"] == "normal"
        assert project["files"][0]["name"] == "main.py"

        main_file = project["files"][0]
        update_file = client.patch(
            f"/projects/{project_id}/files/{main_file['id']}",
            json={"content": "print('v1')"},
        )
        assert update_file.status_code == 200
        assert update_file.json()["content"] == "print('v1')"

        create_task = client.post(
            f"/projects/{project_id}/tasks",
            json={"content": "Check drivetrain"},
        )
        assert create_task.status_code == 200
        task = create_task.json()
        assert task["content"] == "Check drivetrain"

        snapshot = client.post(
            f"/projects/{project_id}/snapshots",
            json={"name": "Baseline"},
        )
        assert snapshot.status_code == 200
        snapshot_id = snapshot.json()["id"]

        mutate_file = client.patch(
            f"/projects/{project_id}/files/{main_file['id']}",
            json={"content": "print('v2')"},
        )
        assert mutate_file.status_code == 200

        restore = client.post(f"/projects/{project_id}/snapshots/{snapshot_id}/restore")
        assert restore.status_code == 200

        refreshed = client.get(f"/projects/{project_id}")
        assert refreshed.status_code == 200
        assert refreshed.json()["files"][0]["content"] == "print('v1')"


def test_open_existing_folder_creates_local_manifest():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["PYCOLLAB_IDE_HOME"] = os.path.join(temp_dir, "ide-home")

        from server.ide_app import app

        client = TestClient(app)
        existing_folder = Path(temp_dir) / "robot-code"
        existing_folder.mkdir(parents=True, exist_ok=True)
        (existing_folder / "main.py").write_text("from pybricks.hubs import PrimeHub\n", encoding="utf-8")

        opened = client.post(
            "/ide/projects/open-folder",
            json={"folder_path": str(existing_folder)},
        )
        assert opened.status_code == 200
        payload = opened.json()
        assert payload["project_type"] == "pybricks"
        assert len(payload["block_documents"]) == 1
        assert (existing_folder / ".pycollab" / "project.json").exists()


def test_open_folder_only_indexes_python_files_and_recent_can_be_removed():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["PYCOLLAB_IDE_HOME"] = os.path.join(temp_dir, "ide-home")

        from server.ide_app import app

        client = TestClient(app)
        existing_folder = Path(temp_dir) / "mission"
        (existing_folder / ".git").mkdir(parents=True, exist_ok=True)
        (existing_folder / "pkg").mkdir(parents=True, exist_ok=True)
        (existing_folder / "main.py").write_text("print('hello')\n", encoding="utf-8")
        (existing_folder / "pkg" / "helpers.py").write_text("def helper():\n    return 1\n", encoding="utf-8")
        (existing_folder / ".git" / "config").write_text("[core]\n", encoding="utf-8")
        (existing_folder / "README.md").write_text("# ignored\n", encoding="utf-8")
        (existing_folder / "notes.txt").write_text("ignored\n", encoding="utf-8")

        opened = client.post(
            "/ide/projects/open-folder",
            json={"folder_path": str(existing_folder)},
        )
        assert opened.status_code == 200
        payload = opened.json()
        assert sorted(file["name"] for file in payload["files"]) == ["main.py", "pkg/helpers.py"]

        create_non_python = client.post(
            f"/projects/{payload['id']}/files",
            json={"name": "README.md", "content": "# nope\n"},
        )
        assert create_non_python.status_code == 400
        assert create_non_python.json()["detail"] == "Only Python files are supported"

        recents = client.get("/ide/recents")
        assert recents.status_code == 200
        assert len(recents.json()) == 1

        remove_recent = client.delete(f"/ide/recents/{payload['id']}")
        assert remove_recent.status_code == 200

        recents_after = client.get("/ide/recents")
        assert recents_after.status_code == 200
        assert recents_after.json() == []
