import os
import tempfile
from email.message import Message
from pathlib import Path
from unittest.mock import patch

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


def test_cached_hosted_project_can_create_explicit_local_copy():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["PYCOLLAB_IDE_HOME"] = os.path.join(temp_dir, "ide-home")

        from server.ide_app import app

        client = TestClient(app)

        cached = client.post(
            "/ide/hosted-cache/hosted-abc",
            json={
                "project": {
                    "id": 42,
                    "public_id": "hosted-abc",
                    "name": "Competition Robot",
                    "project_type": "normal",
                    "files": [
                        {"id": 1, "name": "main.py", "content": "print('cached')\n"},
                        {"id": 2, "name": "lib/helpers.py", "content": "def helper():\n    return 1\n"},
                    ],
                }
            },
        )
        assert cached.status_code == 200
        assert cached.json()["file_count"] == 2

        read_cache = client.get("/ide/hosted-cache/hosted-abc")
        assert read_cache.status_code == 200
        assert read_cache.json()["project"]["files"][0]["content"] == "print('cached')\n"

        copied = client.post(
            "/ide/hosted-cache/hosted-abc/copy",
            json={"name": "Competition Robot Offline Copy"},
        )
        assert copied.status_code == 200
        local_project = copied.json()
        assert local_project["name"] == "Competition Robot Offline Copy"
        assert local_project["origin"]["kind"] == "hosted-cache"
        assert local_project["origin"]["hostedProjectId"] == "hosted-abc"
        assert local_project["local_project_kind"] == "offline-copy"
        assert local_project["is_offline_copy"] is True
        assert sorted(file["name"] for file in local_project["files"]) == ["lib/helpers.py", "main.py"]
        assert next(file for file in local_project["files"] if file["name"] == "main.py")["content"] == "print('cached')\n"

        delete_local = client.delete(f"/projects/{local_project['id']}")
        assert delete_local.status_code == 200
        assert delete_local.json()["deleted_files"] is True

        project_after_delete = client.get(f"/projects/{local_project['id']}")
        assert project_after_delete.status_code == 404


def test_desktop_google_auth_complete_accepts_form_post():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["PYCOLLAB_IDE_HOME"] = os.path.join(temp_dir, "ide-home")

        from server.ide_app import app

        client = TestClient(app)

        started = client.post("/ide/auth/google/desktop/start")
        assert started.status_code == 200
        payload = started.json()
        session_id = payload["session_id"]
        state = payload["state"]

        complete = client.post(
            f"/ide/auth/google/desktop/{session_id}/complete",
            data={
                "state": state,
                "result": '{"status":"authenticated","payload":{"access_token":"token","user":{"id":1}}}',
            },
            headers={"accept": "text/html"},
        )
        assert complete.status_code == 200
        assert "Sign-in complete" in complete.text

        polled = client.get(f"/ide/auth/google/desktop/{session_id}")
        assert polled.status_code == 200
        assert polled.json()["status"] == "completed"
        assert polled.json()["result"]["payload"]["access_token"] == "token"


def test_hosted_proxy_relays_requests_through_local_service():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["PYCOLLAB_IDE_HOME"] = os.path.join(temp_dir, "ide-home")

        from server.ide_app import app

        client = TestClient(app)
        captured = {}

        headers = Message()
        headers["Content-Type"] = "application/json"
        headers["Cache-Control"] = "no-store"

        class FakeResponse:
            def __init__(self):
                self.status = 200
                self.headers = headers

            def read(self):
                return b'{"status":"ok"}'

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def fake_urlopen(request, timeout=0, context=None):
            captured["url"] = request.full_url
            captured["authorization"] = request.headers.get("Authorization")
            return FakeResponse()

        with patch("server.ide_app.urlopen", side_effect=fake_urlopen):
            proxied = client.get(
                "/ide/hosted-proxy/health?probe=1",
                headers={"Authorization": "Bearer desktop-token"},
            )

        assert proxied.status_code == 200
        assert proxied.json() == {"status": "ok"}
        assert captured["url"].endswith("/health?probe=1")
        assert captured["authorization"] == "Bearer desktop-token"
