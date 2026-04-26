import os
import uuid

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_auth_case_insensitive_{uuid.uuid4().hex}.db"

from server.main import app  # noqa: E402
from server.database import Base, engine  # noqa: E402


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

def _reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_register_rejects_duplicate_username_different_case():
    _reset_db()
    client = TestClient(app)

    first = client.post(
        "/auth/register",
        json={"username": "tom", "password": "testpass123", "display_name": "Tom"},
    )
    assert first.status_code == 200

    second = client.post(
        "/auth/register",
        json={"username": "Tom", "password": "testpass123", "display_name": "Tom 2"},
    )
    assert second.status_code == 400
    assert "already registered" in second.json()["detail"]

    client.close()


def test_login_accepts_username_regardless_of_case():
    _reset_db()
    client = TestClient(app)

    register = client.post(
        "/auth/register",
        json={"username": "tom", "password": "testpass123", "display_name": "Tom"},
    )
    assert register.status_code == 200

    login = client.post(
        "/auth/login",
        data={"username": "Tom", "password": "testpass123"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["username"] == "tom"

    client.close()


def test_register_normalizes_username_to_lowercase():
    _reset_db()
    client = TestClient(app)

    res = client.post(
        "/auth/register",
        json={"username": "ToM", "password": "testpass123", "display_name": "Tom"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["username"] == "tom"

    client.close()


def test_update_me_rejects_existing_username_with_different_case():
    _reset_db()
    client = TestClient(app)

    res_a = client.post(
        "/auth/register",
        json={"username": "tom", "password": "testpass123", "display_name": "Tom"},
    )
    assert res_a.status_code == 200

    res_b = client.post(
        "/auth/register",
        json={"username": "jerry", "password": "testpass123", "display_name": "Jerry"},
    )
    assert res_b.status_code == 200

    token = res_b.json()["access_token"]
    update = client.patch(
        "/users/me",
        json={"username": "Tom"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update.status_code == 400
    assert "already taken" in update.json()["detail"]

    client.close()
