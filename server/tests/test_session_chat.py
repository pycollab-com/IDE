import asyncio
import os

import pytest

os.environ["DATABASE_URL"] = "sqlite://"

import server.main as main  # noqa: E402


@pytest.fixture(autouse=True)
def clean_sid_info():
    """Reset _sid_info between tests."""
    original = main._sid_info.copy()
    yield
    main._sid_info.clear()
    main._sid_info.update(original)


@pytest.mark.asyncio
async def test_session_chat_broadcasts_to_room(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_alice"] = {
        "user_id": 1,
        "is_admin": False,
        "project_id": 42,
        "can_edit": True,
        "name": "Alice",
    }

    await main.session_chat("sid_alice", {"projectId": 42, "message": "hello team"})

    assert len(emitted) == 1
    event, data, room = emitted[0]
    assert event == "session_chat"
    assert data["userId"] == 1
    assert data["userName"] == "Alice"
    assert data["message"] == "hello team"
    assert data["projectId"] == 42
    assert "timestamp" in data
    assert room == "project_42"


@pytest.mark.asyncio
async def test_session_chat_rejects_unknown_sid(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    # sid not in _sid_info
    await main.session_chat("unknown_sid", {"projectId": 1, "message": "hi"})
    assert len(emitted) == 0


@pytest.mark.asyncio
async def test_session_chat_rejects_wrong_project(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_bob"] = {
        "user_id": 2,
        "is_admin": False,
        "project_id": 10,
        "can_edit": True,
        "name": "Bob",
    }

    # Wrong project_id
    await main.session_chat("sid_bob", {"projectId": 99, "message": "hi"})
    assert len(emitted) == 0


@pytest.mark.asyncio
async def test_session_chat_rejects_empty_message(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_carol"] = {
        "user_id": 3,
        "is_admin": False,
        "project_id": 5,
        "can_edit": True,
        "name": "Carol",
    }

    await main.session_chat("sid_carol", {"projectId": 5, "message": "   "})
    assert len(emitted) == 0


@pytest.mark.asyncio
async def test_session_chat_rejects_too_long_message(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_dave"] = {
        "user_id": 4,
        "is_admin": False,
        "project_id": 7,
        "can_edit": True,
        "name": "Dave",
    }

    long_msg = "x" * 501
    await main.session_chat("sid_dave", {"projectId": 7, "message": long_msg})
    assert len(emitted) == 0


@pytest.mark.asyncio
async def test_session_chat_rejects_invalid_data(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_eve"] = {
        "user_id": 5,
        "is_admin": False,
        "project_id": 1,
        "can_edit": True,
        "name": "Eve",
    }

    # Non-dict data
    await main.session_chat("sid_eve", "not a dict")
    assert len(emitted) == 0

    # Missing message field
    await main.session_chat("sid_eve", {"projectId": 1})
    assert len(emitted) == 0

    # Non-string message
    await main.session_chat("sid_eve", {"projectId": 1, "message": 12345})
    assert len(emitted) == 0


@pytest.mark.asyncio
async def test_session_chat_strips_whitespace(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None):
        emitted.append((event, data, room))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_fay"] = {
        "user_id": 6,
        "is_admin": False,
        "project_id": 3,
        "can_edit": True,
        "name": "Fay",
    }

    await main.session_chat("sid_fay", {"projectId": 3, "message": "  hi there  "})
    assert len(emitted) == 1
    assert emitted[0][1]["message"] == "hi there"
