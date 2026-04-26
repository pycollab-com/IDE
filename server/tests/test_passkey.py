import os
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite://"

from server import auth, models  # noqa: E402
from server.database import Base  # noqa: E402
from server.main import app  # noqa: E402
import server.main as main  # noqa: E402


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[auth.get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _register_user(client, username="passkeyuser", password="testpass123"):
    res = client.post("/auth/register", json={
        "username": username,
        "password": password,
        "display_name": "Passkey User",
    })
    return res


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_options_requires_auth(client):
    res = client.post("/auth/passkey/register/options")
    assert res.status_code == 401


def test_register_options_returns_webauthn_data(client):
    reg = _register_user(client, "pkuser1")
    assert reg.status_code == 200
    token = reg.json()["access_token"]

    res = client.post(
        "/auth/passkey/register/options",
        json={},
        headers=_auth_header(token),
    )
    assert res.status_code == 200
    data = res.json()
    assert "challenge" in data
    assert "rp" in data
    assert "user" in data
    # RP ID is derived from the request Host header (TestClient sends "testserver")
    assert data["rp"]["id"] == "testserver"


def test_register_complete_rejects_invalid_credential(client):
    reg = _register_user(client, "pkuser2")
    token = reg.json()["access_token"]

    # First get options so a challenge is stored
    client.post(
        "/auth/passkey/register/options",
        json={},
        headers=_auth_header(token),
    )

    # Send bogus credential
    res = client.post(
        "/auth/passkey/register/complete",
        json={"id": "fake", "rawId": "fake", "response": {}, "type": "public-key"},
        headers=_auth_header(token),
    )
    assert res.status_code == 400


def test_login_options_returns_challenge(client):
    res = client.post("/auth/passkey/login/options")
    assert res.status_code == 200
    data = res.json()
    assert "challenge" in data
    assert "rpId" in data


def test_login_complete_rejects_unknown_credential(client):
    res = client.post("/auth/passkey/login/complete", json={
        "id": "dW5rbm93bg",
        "rawId": "dW5rbm93bg",
        "response": {
            "clientDataJSON": "e30",
            "authenticatorData": "e30",
            "signature": "e30",
        },
        "type": "public-key",
    })
    assert res.status_code == 400


def test_list_credentials_empty(client):
    reg = _register_user(client, "pkuser3")
    token = reg.json()["access_token"]

    res = client.get(
        "/auth/passkey/credentials",
        headers=_auth_header(token),
    )
    assert res.status_code == 200
    assert res.json() == []


def test_delete_credential_not_found(client):
    reg = _register_user(client, "pkuser4")
    token = reg.json()["access_token"]

    res = client.delete(
        "/auth/passkey/credentials/nonexistent-id",
        headers=_auth_header(token),
    )
    assert res.status_code == 404


def test_list_credentials_requires_auth(client):
    res = client.get("/auth/passkey/credentials")
    assert res.status_code == 401


def test_register_options_rp_id_from_custom_host(client):
    """RP ID should be derived from the Host header when env var is not set."""
    reg = _register_user(client, "pkuser5")
    token = reg.json()["access_token"]

    res = client.post(
        "/auth/passkey/register/options",
        json={},
        headers={**_auth_header(token), "Host": "example.com"},
    )
    assert res.status_code == 200
    assert res.json()["rp"]["id"] == "example.com"


def test_register_options_rp_id_strips_port(client):
    """RP ID should strip the port from the Host header."""
    reg = _register_user(client, "pkuser6")
    token = reg.json()["access_token"]

    res = client.post(
        "/auth/passkey/register/options",
        json={},
        headers={**_auth_header(token), "Host": "myapp.example.com:8000"},
    )
    assert res.status_code == 200
    assert res.json()["rp"]["id"] == "myapp.example.com"


def test_login_options_rp_id_from_host(client):
    """Login options should also derive RP ID from Host header."""
    res = client.post(
        "/auth/passkey/login/options",
        headers={"Host": "example.com"},
    )
    assert res.status_code == 200
    assert res.json()["rpId"] == "example.com"


def test_rp_id_env_var_takes_priority(client, monkeypatch):
    """WEBAUTHN_RP_ID env var should take priority over Host header."""
    import server.passkey as pk
    monkeypatch.setattr(pk, "_ENV_RP_ID", "custom-rp.example.com")

    reg = _register_user(client, "pkuser7")
    token = reg.json()["access_token"]

    res = client.post(
        "/auth/passkey/register/options",
        json={},
        headers={**_auth_header(token), "Host": "other.example.com"},
    )
    assert res.status_code == 200
    assert res.json()["rp"]["id"] == "custom-rp.example.com"
