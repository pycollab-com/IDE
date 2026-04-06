import asyncio
import datetime as dt
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
from server.realtime_messaging import PresenceManager, TypingManager  # noqa: E402
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
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def create_user(db, username, is_admin=False):
    user = models.User(
        username=username,
        password_hash=auth.get_password_hash("password"),
        display_name=username.capitalize(),
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_headers(user):
    token = auth.create_access_token({"sub": user.id})
    return {"Authorization": f"Bearer {token}"}


def add_follow(db, follower_id, followed_id):
    db.add(models.Follow(follower_id=follower_id, followed_id=followed_id))
    db.commit()


def test_mutual_follow_allows_immediate_dm(client, db):
    alice = create_user(db, "alice")
    bob = create_user(db, "bob")
    add_follow(db, alice.id, bob.id)
    add_follow(db, bob.id, alice.id)

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": bob.id, "initial_message": "hi"},
        headers=auth_headers(alice),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["conversation"]["status"] == "accepted"
    convo_id = data["conversation"]["id"]

    res2 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "second"},
        headers=auth_headers(alice),
    )
    assert res2.status_code == 200


def test_non_mutual_pending_and_single_message_limit(client, db):
    carol = create_user(db, "carol")
    dave = create_user(db, "dave")

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": dave.id, "initial_message": "hello"},
        headers=auth_headers(carol),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["conversation"]["status"] == "pending"
    convo_id = data["conversation"]["id"]

    res2 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "second"},
        headers=auth_headers(carol),
    )
    assert res2.status_code == 403


def test_accept_unlocks_sending(client, db):
    emma = create_user(db, "emma")
    frank = create_user(db, "frank")

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": frank.id, "initial_message": "request"},
        headers=auth_headers(emma),
    )
    convo_id = res.json()["conversation"]["id"]

    accept = client.post(
        f"/messages/conversation/{convo_id}/accept",
        headers=auth_headers(frank),
    )
    assert accept.status_code == 200
    assert accept.json()["conversation"]["status"] == "accepted"

    res2 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "now allowed"},
        headers=auth_headers(emma),
    )
    assert res2.status_code == 200


def test_decline_allows_future_request(client, db):
    gina = create_user(db, "gina")
    hank = create_user(db, "hank")

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": hank.id, "initial_message": "request"},
        headers=auth_headers(gina),
    )
    convo_id = res.json()["conversation"]["id"]

    decline = client.post(
        f"/messages/conversation/{convo_id}/decline",
        headers=auth_headers(hank),
    )
    assert decline.status_code == 200

    blocked_send = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "should fail"},
        headers=auth_headers(gina),
    )
    assert blocked_send.status_code in (403, 404)

    res2 = client.post(
        "/messages/conversation/start",
        json={"target_user_id": hank.id, "initial_message": "new request"},
        headers=auth_headers(gina),
    )
    assert res2.status_code == 200
    assert res2.json()["conversation"]["status"] == "pending"


def test_unfollow_does_not_disable_messaging(client, db):
    ivy = create_user(db, "ivy")
    jules = create_user(db, "jules")
    add_follow(db, ivy.id, jules.id)
    add_follow(db, jules.id, ivy.id)

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": jules.id, "initial_message": "start"},
        headers=auth_headers(ivy),
    )
    convo_id = res.json()["conversation"]["id"]

    unfollow = client.delete(
        f"/users/{jules.id}/follow",
        headers=auth_headers(ivy),
    )
    assert unfollow.status_code == 200

    res2 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "still ok"},
        headers=auth_headers(ivy),
    )
    assert res2.status_code == 200


def test_block_removes_follows_and_disables_messaging(client, db):
    kara = create_user(db, "kara")
    liam = create_user(db, "liam")
    add_follow(db, kara.id, liam.id)
    add_follow(db, liam.id, kara.id)

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": liam.id, "initial_message": "hello"},
        headers=auth_headers(kara),
    )
    convo_id = res.json()["conversation"]["id"]

    block = client.post(
        f"/users/{liam.id}/block",
        headers=auth_headers(kara),
    )
    assert block.status_code == 200

    follow_count = (
        db.query(models.Follow)
        .filter(
            models.Follow.follower_id.in_([kara.id, liam.id]),
            models.Follow.followed_id.in_([kara.id, liam.id]),
        )
        .count()
    )
    assert follow_count == 0

    res2 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "blocked"},
        headers=auth_headers(kara),
    )
    assert res2.status_code == 403

    res3 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "blocked"},
        headers=auth_headers(liam),
    )
    assert res3.status_code == 403


def test_unblock_restores_messaging_for_accepted_conversation(client, db):
    mia = create_user(db, "mia")
    noah = create_user(db, "noah")
    add_follow(db, mia.id, noah.id)
    add_follow(db, noah.id, mia.id)

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": noah.id, "initial_message": "hello"},
        headers=auth_headers(mia),
    )
    convo_id = res.json()["conversation"]["id"]

    client.post(f"/users/{noah.id}/block", headers=auth_headers(mia))
    unblock = client.post(f"/users/{noah.id}/unblock", headers=auth_headers(mia))
    assert unblock.status_code == 200

    res2 = client.post(
        f"/messages/conversation/{convo_id}/send",
        json={"body": "back again"},
        headers=auth_headers(mia),
    )
    assert res2.status_code == 200


def test_presence_manager_online_offline():
    manager = PresenceManager(stale_seconds=1)
    now = dt.datetime.utcnow()
    assert manager.connect(1, "sid1", now=now) is True
    assert manager.get(1)["status"] == "online"

    later = now + dt.timedelta(seconds=5)
    assert manager.disconnect(1, "sid1", now=later) is True
    assert manager.get(1)["status"] == "offline"

    manager.connect(2, "sid2", now=now)
    stale = manager.reap_stale(now=now + dt.timedelta(seconds=5))
    assert 2 in stale


@pytest.mark.asyncio
async def test_typing_throttle_and_timeout():
    manager = TypingManager(throttle_seconds=1.0, timeout_seconds=0.05)
    assert manager.should_emit(1, "c1", now=0.0) is True
    manager.mark_emit(1, "c1", now=0.0)
    assert manager.should_emit(1, "c1", now=0.2) is False
    assert manager.should_emit(1, "c1", now=1.2) is True

    fired = {"value": False}

    async def emit_stop():
        fired["value"] = True

    await manager.schedule_timeout(1, "c1", emit_stop)
    await asyncio.sleep(0.1)
    assert fired["value"] is True


def test_read_marks_do_not_broadcast(client, db, monkeypatch):
    oliver = create_user(db, "oliver")
    pia = create_user(db, "pia")
    add_follow(db, oliver.id, pia.id)
    add_follow(db, pia.id, oliver.id)

    res = client.post(
        "/messages/conversation/start",
        json={"target_user_id": pia.id, "initial_message": "hey"},
        headers=auth_headers(oliver),
    )
    convo_id = res.json()["conversation"]["id"]

    events = []

    def fake_emit(event, data, room=None):
        events.append((event, data, room))

    monkeypatch.setattr(main, "_emit_message_event", fake_emit)

    convo = client.get(
        f"/messages/conversation/{convo_id}",
        headers=auth_headers(pia),
    )
    assert convo.status_code == 200
    messages = convo.json()["messages"]
    assert messages[0]["read_at"] is not None
    assert not any(event[0] == "message:read" for event in events)
