import os

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, or_
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite://"

from server import auth, models  # noqa: E402
from server.database import Base  # noqa: E402
from server.main import app  # noqa: E402


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


def _create_user(db, username: str, is_admin: bool = False):
    user = models.User(
        username=username,
        display_name=username.title(),
        password_hash=auth.get_password_hash("pw"),
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_header(user_id: int):
    token = auth.create_access_token({"sub": user_id})
    return {"Authorization": f"Bearer {token}"}


def _seed_user_graph(db, target: models.User, other: models.User):
    owned_project = models.Project(name="owned", owner_id=target.id, description="x")
    db.add(owned_project)
    db.commit()
    db.refresh(owned_project)

    db.add(models.ProjectFile(project_id=owned_project.id, name="main.py", content="print('x')"))
    db.add(models.ProjectShareToken(project_id=owned_project.id))
    db.add(models.ProjectCollaborator(project_id=owned_project.id, user_id=other.id, role="editor"))

    other_project = models.Project(name="other-owned", owner_id=other.id, description="y")
    db.add(other_project)
    db.commit()
    db.refresh(other_project)
    db.add(models.ProjectCollaborator(project_id=other_project.id, user_id=target.id, role="editor"))

    db.add(models.Follow(follower_id=target.id, followed_id=other.id))
    db.add(models.Follow(follower_id=other.id, followed_id=target.id))
    db.add(models.Block(blocker_id=target.id, blocked_id=other.id))

    convo = models.Conversation(
        user_a_id=min(target.id, other.id),
        user_b_id=max(target.id, other.id),
        pair_key=f"{min(target.id, other.id)}:{max(target.id, other.id)}",
        requester_id=target.id,
        status="accepted",
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    db.add(models.Message(conversation_id=convo.id, sender_id=target.id, body="hello"))

    db.add(models.Presence(user_id=target.id, status="online"))
    db.add(
        models.UserCredential(
            user_id=target.id,
            credential_id=b"cred-id",
            public_key=b"pk",
            sign_count=1,
            device_name="test-device",
        )
    )
    db.commit()


def test_admin_force_follow_and_force_project(client, db):
    admin = _create_user(db, "admin", is_admin=True)
    follower = _create_user(db, "follower")
    followed = _create_user(db, "followed")

    res_follow = client.post(
        "/admin/force/follow",
        headers=_auth_header(admin.id),
        params={"follower_id": follower.id, "followed_id": followed.id},
    )
    assert res_follow.status_code == 200
    assert res_follow.json()["status"] in {"forced follow", "already following"}

    follow_row = (
        db.query(models.Follow)
        .filter(models.Follow.follower_id == follower.id, models.Follow.followed_id == followed.id)
        .first()
    )
    assert follow_row is not None

    res_project = client.post(
        "/admin/force/project",
        headers=_auth_header(admin.id),
        params={"user_id": follower.id},
        json={"name": "  seeded  ", "description": "seeded project", "is_public": False},
    )
    assert res_project.status_code == 200
    body = res_project.json()
    assert body["name"] == "seeded"
    assert body["owner_id"] == follower.id


def test_admin_api_namespace_supports_mutation_actions(client, db):
    admin = _create_user(db, "admin", is_admin=True)
    follower = _create_user(db, "follower")
    followed = _create_user(db, "followed")
    target = _create_user(db, "target")

    res_follow = client.post(
        "/admin/api/force/follow",
        headers=_auth_header(admin.id),
        params={"follower_id": follower.id, "followed_id": followed.id},
    )
    assert res_follow.status_code == 200
    assert res_follow.json()["status"] in {"forced follow", "already following"}

    res_project = client.post(
        "/admin/api/force/project",
        headers=_auth_header(admin.id),
        params={"user_id": follower.id},
        json={"name": "admin-api-project", "description": "seeded project", "is_public": False},
    )
    assert res_project.status_code == 200
    assert res_project.json()["owner_id"] == follower.id

    res_impersonate = client.post(
        f"/admin/api/impersonate/{target.id}",
        headers=_auth_header(admin.id),
    )
    assert res_impersonate.status_code == 200

    res_delete = client.delete(f"/admin/api/users/{target.id}", headers=_auth_header(admin.id))
    assert res_delete.status_code == 200
    assert db.query(models.User).filter(models.User.id == target.id).first() is None


def test_admin_impersonation_token_contains_impersonator_claim(client, db):
    admin = _create_user(db, "admin", is_admin=True)
    target = _create_user(db, "target")

    res = client.post(f"/admin/impersonate/{target.id}", headers=_auth_header(admin.id))
    assert res.status_code == 200
    token = res.json()["access_token"]
    payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    assert payload["sub"] == str(target.id)
    assert payload["impersonator_id"] == admin.id


def test_admin_delete_user_cleans_related_rows(client, db):
    admin = _create_user(db, "admin", is_admin=True)
    target = _create_user(db, "target")
    other = _create_user(db, "other")
    _seed_user_graph(db, target, other)

    res = client.delete(f"/admin/users/{target.id}", headers=_auth_header(admin.id))
    assert res.status_code == 200

    assert db.query(models.User).filter(models.User.id == target.id).first() is None
    assert (
        db.query(models.Follow)
        .filter(or_(models.Follow.follower_id == target.id, models.Follow.followed_id == target.id))
        .count()
        == 0
    )
    assert (
        db.query(models.Block)
        .filter(or_(models.Block.blocker_id == target.id, models.Block.blocked_id == target.id))
        .count()
        == 0
    )
    assert (
        db.query(models.ProjectCollaborator)
        .filter(models.ProjectCollaborator.user_id == target.id)
        .count()
        == 0
    )
    assert (
        db.query(models.Conversation)
        .filter(or_(models.Conversation.user_a_id == target.id, models.Conversation.user_b_id == target.id))
        .count()
        == 0
    )
    assert db.query(models.Message).filter(models.Message.sender_id == target.id).count() == 0
    assert db.query(models.Presence).filter(models.Presence.user_id == target.id).count() == 0
    assert db.query(models.UserCredential).filter(models.UserCredential.user_id == target.id).count() == 0


def test_delete_me_cleans_related_rows(client, db):
    target = _create_user(db, "deleteme")
    other = _create_user(db, "other")
    _seed_user_graph(db, target, other)

    res = client.delete("/users/me", headers=_auth_header(target.id))
    assert res.status_code == 200
    assert db.query(models.User).filter(models.User.id == target.id).first() is None
    assert (
        db.query(models.Follow)
        .filter(or_(models.Follow.follower_id == target.id, models.Follow.followed_id == target.id))
        .count()
        == 0
    )
    assert (
        db.query(models.Block)
        .filter(or_(models.Block.blocker_id == target.id, models.Block.blocked_id == target.id))
        .count()
        == 0
    )
    assert (
        db.query(models.ProjectCollaborator)
        .filter(models.ProjectCollaborator.user_id == target.id)
        .count()
        == 0
    )
    assert (
        db.query(models.Conversation)
        .filter(or_(models.Conversation.user_a_id == target.id, models.Conversation.user_b_id == target.id))
        .count()
        == 0
    )
    assert db.query(models.Message).filter(models.Message.sender_id == target.id).count() == 0
    assert db.query(models.Presence).filter(models.Presence.user_id == target.id).count() == 0
    assert db.query(models.UserCredential).filter(models.UserCredential.user_id == target.id).count() == 0
