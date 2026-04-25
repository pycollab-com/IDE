import os
import uuid

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_profile_links_{uuid.uuid4().hex}.db"

from server.main import app  # noqa: E402
from server.database import Base, engine  # noqa: E402


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


def _reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _auth_header(token: str):
    return {"Authorization": f"Bearer {token}"}


def test_update_me_supports_description_and_links():
    _reset_db()
    client = TestClient(app)

    register = client.post(
        "/auth/register",
        json={"username": "adam", "password": "testpass123", "display_name": "Adam"},
    )
    assert register.status_code == 200
    token = register.json()["access_token"]
    user_id = register.json()["user"]["id"]

    update = client.patch(
        "/users/me",
        headers=_auth_header(token),
        json={
            "description": "  Building cool tools in public.  ",
            "links": [
                "github.com/adam",
                "https://x.com/adam",
                "https://adamzafir.com/",
                "https://x.com/adam",
                "mailto:adam@example.com",
            ],
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["description"] == "Building cool tools in public."
    assert payload["links"] == [
        "https://github.com/adam",
        "https://x.com/adam",
        "https://adamzafir.com",
        "mailto:adam@example.com",
    ]

    profile = client.get(f"/users/{user_id}")
    assert profile.status_code == 200
    profile_payload = profile.json()
    assert profile_payload["description"] == "Building cool tools in public."
    assert profile_payload["links"] == [
        "https://github.com/adam",
        "https://x.com/adam",
        "https://adamzafir.com",
        "mailto:adam@example.com",
    ]

    client.close()


def test_update_me_rejects_invalid_links():
    _reset_db()
    client = TestClient(app)

    register = client.post(
        "/auth/register",
        json={"username": "jerry", "password": "testpass123", "display_name": "Jerry"},
    )
    assert register.status_code == 200
    token = register.json()["access_token"]

    update = client.patch(
        "/users/me",
        headers=_auth_header(token),
        json={"links": ["good.com", "bad link"]},
    )
    assert update.status_code == 400
    assert "Profile links" in update.json()["detail"]

    client.close()
