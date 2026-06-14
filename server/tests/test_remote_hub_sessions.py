import os

import pytest

os.environ["DATABASE_URL"] = "sqlite://"

import server.main as main  # noqa: E402


@pytest.fixture(autouse=True)
def clean_remote_hub_state():
    original_sid_info = main._sid_info.copy()
    original_sessions = main._remote_hub_sessions.copy()
    yield
    main._sid_info.clear()
    main._sid_info.update(original_sid_info)
    main._remote_hub_sessions.clear()
    main._remote_hub_sessions.update(original_sessions)


@pytest.mark.asyncio
async def test_remote_hub_host_state_creates_and_clears_session(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None, skip_sid=None):
        emitted.append((event, data, room, skip_sid))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_host"] = {
        "user_id": 11,
        "is_admin": False,
        "project_id": 7,
        "can_edit": True,
        "name": "Alex",
    }

    await main.remote_hub_host_state(
        "sid_host",
        {
            "projectId": 7,
            "connected": True,
            "deviceName": "LEGO Hub 12A3",
            "transport": "bluetooth",
            "transportLabel": "Bluetooth",
            "hubRunning": False,
        },
    )

    assert 7 in main._remote_hub_sessions
    session = main._remote_hub_sessions[7]
    assert session.host_user_id == 11
    assert session.device_name == "LEGO Hub 12A3"

    state_events = [event for event in emitted if event[0] == "remote_hub_state"]
    assert state_events[-1][1]["session"]["host"] == {
        "userId": 11,
        "userName": "Alex",
        "deviceName": "LEGO Hub 12A3",
        "transport": "bluetooth",
        "transportLabel": "Bluetooth",
        "hubRunning": False,
    }
    assert state_events[-1][2] == "project_7"

    emitted.clear()
    await main.remote_hub_host_state("sid_host", {"projectId": 7, "connected": False})

    assert 7 not in main._remote_hub_sessions
    state_events = [event for event in emitted if event[0] == "remote_hub_state"]
    assert state_events[-1][1]["session"] is None


@pytest.mark.asyncio
async def test_remote_hub_access_request_accept_and_revoke(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None, skip_sid=None):
        emitted.append((event, data, room, skip_sid))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_host"] = {
        "user_id": 21,
        "is_admin": False,
        "project_id": 8,
        "can_edit": True,
        "name": "Host",
    }
    main._sid_info["sid_guest"] = {
        "user_id": 22,
        "is_admin": False,
        "project_id": 8,
        "can_edit": True,
        "name": "Guest",
    }

    await main.remote_hub_host_state(
        "sid_host",
        {
            "projectId": 8,
            "connected": True,
            "deviceName": "Prime",
            "transport": "usb",
            "transportLabel": "Wired",
            "hubRunning": False,
        },
    )
    emitted.clear()

    await main.remote_hub_request_access("sid_guest", {"projectId": 8})
    assert 22 in main._remote_hub_sessions[8].pending

    pending_events = [event for event in emitted if event[0] == "remote_hub_pending_requests"]
    assert pending_events[-1][1]["requests"] == [{"userId": 22, "userName": "Guest"}]
    state_events = [event for event in emitted if event[0] == "remote_hub_state"]
    assert state_events[-1][1]["session"]["pendingUserIds"] == [22]

    emitted.clear()
    await main.remote_hub_respond_request(
        "sid_host",
        {"projectId": 8, "guestUserId": 22, "approved": True},
    )

    session = main._remote_hub_sessions[8]
    assert 22 not in session.pending
    assert session.guests == {22: "Guest"}

    resolved_events = [event for event in emitted if event[0] == "remote_hub_request_resolved"]
    assert resolved_events[-1][1]["approved"] is True
    assert resolved_events[-1][2] == "sid_guest"

    emitted.clear()
    await main.remote_hub_revoke_access("sid_host", {"projectId": 8, "guestUserId": 22})

    assert main._remote_hub_sessions[8].guests == {}
    revoked_events = [event for event in emitted if event[0] == "remote_hub_access_revoked"]
    assert revoked_events[-1][1]["hostUserName"] == "Host"
    assert revoked_events[-1][2] == "sid_guest"


@pytest.mark.asyncio
async def test_remote_hub_run_and_stop_forward_only_for_approved_guest(monkeypatch):
    emitted = []

    async def fake_emit(event, data, room=None, skip_sid=None):
        emitted.append((event, data, room, skip_sid))

    monkeypatch.setattr(main.sio, "emit", fake_emit)

    main._sid_info["sid_host"] = {
        "user_id": 31,
        "is_admin": False,
        "project_id": 9,
        "can_edit": True,
        "name": "Host",
    }
    main._sid_info["sid_guest"] = {
        "user_id": 32,
        "is_admin": False,
        "project_id": 9,
        "can_edit": True,
        "name": "Guest",
    }
    main._sid_info["sid_other"] = {
        "user_id": 33,
        "is_admin": False,
        "project_id": 9,
        "can_edit": True,
        "name": "Other",
    }

    await main.remote_hub_host_state(
        "sid_host",
        {
            "projectId": 9,
            "connected": True,
            "deviceName": "Prime",
            "transport": "bluetooth",
            "transportLabel": "Bluetooth",
            "hubRunning": False,
        },
    )
    await main.remote_hub_request_access("sid_guest", {"projectId": 9})
    await main.remote_hub_respond_request(
        "sid_host",
        {"projectId": 9, "guestUserId": 32, "approved": True},
    )
    emitted.clear()

    await main.remote_hub_run_request(
        "sid_guest",
        {
            "projectId": 9,
            "runRequest": {
                "entryFileId": 1,
                "entryFileName": "main.py",
                "files": [{"id": 1, "name": "main.py", "content": "print('hi')"}],
            },
        },
    )
    run_events = [event for event in emitted if event[0] == "remote_hub_execute_run"]
    assert len(run_events) == 1
    assert run_events[0][1]["requestedByUserName"] == "Guest"
    assert run_events[0][2] == "sid_host"

    emitted.clear()
    await main.remote_hub_stop_request("sid_guest", {"projectId": 9})
    stop_events = [event for event in emitted if event[0] == "remote_hub_execute_stop"]
    assert len(stop_events) == 1
    assert stop_events[0][2] == "sid_host"

    emitted.clear()
    await main.remote_hub_run_request(
        "sid_other",
        {
            "projectId": 9,
            "runRequest": {"entryFileId": 1, "entryFileName": "main.py", "files": []},
        },
    )
    error_events = [event for event in emitted if event[0] == "remote_hub_error"]
    assert len(error_events) == 1
    assert error_events[0][2] == "sid_other"
