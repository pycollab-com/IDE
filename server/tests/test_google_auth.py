import os

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


def _claims(sub="google-sub-1", email="user@example.com", verified=True, name="Google User"):
    return {
        "google_sub": sub,
        "email": email,
        "email_verified": verified,
        "suggested_username": "googleuser",
        "suggested_display_name": name,
    }


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_google_start_authenticates_existing_google_sub(client, db, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")
    user = models.User(
        username="existinggoogle",
        email="existing@example.com",
        google_sub="google-sub-1",
        password_hash=auth.get_password_hash("not-used"),
        display_name="Existing Google",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    monkeypatch.setattr(
        main.google_oauth,
        "verify_google_id_token",
        lambda *_: _claims(email="existing@example.com"),
    )
    res = client.post("/auth/google/start", json={"id_token": "fake-google-token"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "authenticated"
    assert data["access_token"]
    assert data["user"]["id"] == user.id
    refreshed = db.query(models.User).filter(models.User.id == user.id).first()
    assert refreshed.email_verified is True


def test_google_start_returns_needs_profile_for_new_user(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")
    monkeypatch.setattr(main.google_oauth, "verify_google_id_token", lambda *_: _claims(sub="new-sub", email="new@example.com"))

    res = client.post("/auth/google/start", json={"id_token": "fake-google-token"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "needs_profile"
    assert data["signup_token"]
    assert data["suggested_username"] == "googleuser"
    assert data["suggested_display_name"] == "Google User"


def test_google_complete_signup_creates_user(client, db):
    signup_token = auth.create_google_signup_token(
        {
            "email": "newuser@example.com",
            "google_sub": "google-sub-new",
            "suggested_username": "newuser",
            "suggested_display_name": "New User",
        }
    )
    res = client.post(
        "/auth/google/complete-signup",
        json={
            "signup_token": signup_token,
            "username": "newuser",
            "display_name": "New User",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["username"] == "newuser"

    created = db.query(models.User).filter(models.User.username == "newuser").first()
    assert created is not None
    assert created.email == "newuser@example.com"
    assert created.email_verified is True
    assert created.google_sub == "google-sub-new"
    assert created.password_hash


def test_google_complete_signup_rejects_duplicate_username(client, db):
    existing = models.User(
        username="takenname",
        password_hash=auth.get_password_hash("x"),
        display_name="Taken Name",
    )
    db.add(existing)
    db.commit()

    signup_token = auth.create_google_signup_token(
        {
            "email": "fresh@example.com",
            "google_sub": "google-sub-fresh",
        }
    )
    res = client.post(
        "/auth/google/complete-signup",
        json={
            "signup_token": signup_token,
            "username": "takenname",
            "display_name": "Fresh User",
        },
    )
    assert res.status_code == 400
    assert "Username already registered" in res.json()["detail"]


def test_google_start_rejects_existing_email_not_linked_to_google_sub(client, db, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")
    user = models.User(
        username="emaillinkuser",
        email="emaillink@example.com",
        password_hash=auth.get_password_hash("x"),
        display_name="Email Link",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    monkeypatch.setattr(
        main.google_oauth,
        "verify_google_id_token",
        lambda *_: _claims(sub="google-sub-email-link", email="emaillink@example.com"),
    )
    res = client.post("/auth/google/start", json={"id_token": "fake-google-token"})
    assert res.status_code == 409
    assert "verify with Google in Settings" in res.json()["detail"]

    linked = db.query(models.User).filter(models.User.id == user.id).first()
    assert linked.google_sub is None


def test_google_start_rejects_unverified_email(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")
    monkeypatch.setattr(
        main.google_oauth,
        "verify_google_id_token",
        lambda *_: _claims(sub="google-sub-unverified", email="unverified@example.com", verified=False),
    )

    res = client.post("/auth/google/start", json={"id_token": "fake-google-token"})
    assert res.status_code == 400
    assert "not verified" in res.json()["detail"]


def test_google_start_rejects_invalid_token(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")

    def _raise(*_):
        raise ValueError("Invalid Google token")

    monkeypatch.setattr(main.google_oauth, "verify_google_id_token", _raise)
    res = client.post("/auth/google/start", json={"id_token": "bad-token"})
    assert res.status_code == 400
    assert "Invalid Google token" in res.json()["detail"]


def test_google_start_uses_fallback_client_id_when_env_missing(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    res = client.post("/auth/google/start", json={"id_token": "fake-google-token"})
    assert res.status_code == 400
    assert "Invalid Google token" in res.json()["detail"]


def test_update_me_rejects_direct_email_set(client, db):
    user_a = models.User(
        username="usera",
        email="usera@example.com",
        password_hash=auth.get_password_hash("x"),
        display_name="User A",
    )
    user_b = models.User(
        username="userb",
        email="userb@example.com",
        password_hash=auth.get_password_hash("x"),
        display_name="User B",
    )
    db.add(user_a)
    db.add(user_b)
    db.commit()
    db.refresh(user_a)

    token = auth.create_access_token({"sub": user_a.id})
    res = client.patch(
        "/users/me",
        json={"email": "userb@example.com"},
        headers=_auth_header(token),
    )
    assert res.status_code == 400
    assert "require Google verification" in res.json()["detail"]


def test_verify_email_with_google_updates_email_and_google_sub(client, db, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")
    user = models.User(
        username="plainuser",
        password_hash=auth.get_password_hash("x"),
        display_name="Plain User",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    monkeypatch.setattr(
        main.google_oauth,
        "verify_google_id_token",
        lambda *_: _claims(sub="google-sub-verify", email="verified@example.com"),
    )
    token = auth.create_access_token({"sub": user.id})
    res = client.post(
        "/users/me/email/verify/google",
        json={"id_token": "fake-google-token"},
        headers=_auth_header(token),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["email"] == "verified@example.com"
    assert data["email_verified"] is True
    assert data["has_google"] is True

    refreshed = db.query(models.User).filter(models.User.id == user.id).first()
    assert refreshed.email == "verified@example.com"
    assert refreshed.email_verified is True
    assert refreshed.google_sub == "google-sub-verify"


def test_verify_email_with_google_rejects_taken_email(client, db, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client")
    user = models.User(
        username="owner",
        email="taken@example.com",
        email_verified=True,
        google_sub="google-sub-owner",
        password_hash=auth.get_password_hash("x"),
        display_name="Owner",
    )
    another = models.User(
        username="another",
        password_hash=auth.get_password_hash("x"),
        display_name="Another",
    )
    db.add(user)
    db.add(another)
    db.commit()
    db.refresh(another)

    monkeypatch.setattr(
        main.google_oauth,
        "verify_google_id_token",
        lambda *_: _claims(sub="google-sub-another", email="taken@example.com"),
    )
    token = auth.create_access_token({"sub": another.id})
    res = client.post(
        "/users/me/email/verify/google",
        json={"id_token": "fake-google-token"},
        headers=_auth_header(token),
    )
    assert res.status_code == 400
    assert "Email already taken" in res.json()["detail"]


def test_update_me_removing_email_clears_google_linkage(client, db):
    user = models.User(
        username="googlelinked",
        email="linked@example.com",
        email_verified=True,
        google_sub="google-sub-linked",
        password_hash=auth.get_password_hash("x"),
        display_name="Google Linked",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = auth.create_access_token({"sub": user.id})
    res = client.patch(
        "/users/me",
        json={"email": ""},
        headers=_auth_header(token),
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["email"] is None
    assert payload["email_verified"] is False
    assert payload["has_google"] is False

    refreshed = db.query(models.User).filter(models.User.id == user.id).first()
    assert refreshed.email is None
    assert refreshed.email_verified is False
    assert refreshed.google_sub is None
