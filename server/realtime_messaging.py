import asyncio
import datetime as dt
import time


class PresenceManager:
    def __init__(self, stale_seconds: int = 35):
        self.stale_seconds = stale_seconds
        self.state = {}

    def connect(self, user_id: int, sid: str, now: dt.datetime | None = None) -> bool:
        now = now or dt.datetime.utcnow()
        entry = self.state.setdefault(
            user_id,
            {"sids": set(), "last_seen_at": now, "status": "offline"},
        )
        entry["sids"].add(sid)
        entry["last_seen_at"] = now
        changed = entry["status"] != "online"
        entry["status"] = "online"
        return changed

    def heartbeat(self, user_id: int, now: dt.datetime | None = None) -> bool:
        now = now or dt.datetime.utcnow()
        entry = self.state.setdefault(
            user_id,
            {"sids": set(), "last_seen_at": now, "status": "offline"},
        )
        entry["last_seen_at"] = now
        changed = entry["status"] != "online"
        entry["status"] = "online"
        return changed

    def disconnect(self, user_id: int, sid: str, now: dt.datetime | None = None) -> bool:
        now = now or dt.datetime.utcnow()
        entry = self.state.get(user_id)
        if not entry:
            return False
        entry["sids"].discard(sid)
        entry["last_seen_at"] = now
        if entry["sids"]:
            return False
        changed = entry["status"] != "offline"
        entry["status"] = "offline"
        return changed

    def reap_stale(self, now: dt.datetime | None = None) -> list[int]:
        now = now or dt.datetime.utcnow()
        changed = []
        for user_id, entry in self.state.items():
            if entry["status"] != "online":
                continue
            if (now - entry["last_seen_at"]).total_seconds() > self.stale_seconds:
                entry["status"] = "offline"
                changed.append(user_id)
        return changed

    def get(self, user_id: int):
        return self.state.get(user_id)


class TypingManager:
    def __init__(self, throttle_seconds: float = 1.0, timeout_seconds: float = 4.0):
        self.throttle_seconds = throttle_seconds
        self.timeout_seconds = timeout_seconds
        self.last_emit = {}
        self.timeout_tasks = {}

    def should_emit(self, user_id: int, conversation_id: str, now: float | None = None) -> bool:
        if now is None:
            now = time.monotonic()
        key = (user_id, conversation_id)
        last = self.last_emit.get(key)
        return last is None or (now - last) >= self.throttle_seconds

    def mark_emit(self, user_id: int, conversation_id: str, now: float | None = None) -> None:
        if now is None:
            now = time.monotonic()
        self.last_emit[(user_id, conversation_id)] = now

    async def schedule_timeout(self, user_id: int, conversation_id: str, emit_stop):
        key = (user_id, conversation_id)
        existing = self.timeout_tasks.get(key)
        if existing:
            existing.cancel()

        async def _task():
            try:
                await asyncio.sleep(self.timeout_seconds)
                result = emit_stop()
                if asyncio.iscoroutine(result):
                    await result
            except asyncio.CancelledError:
                return
            finally:
                self.timeout_tasks.pop(key, None)

        task = asyncio.create_task(_task())
        self.timeout_tasks[key] = task
        return task

    def cancel_timeout(self, user_id: int, conversation_id: str) -> None:
        key = (user_id, conversation_id)
        task = self.timeout_tasks.pop(key, None)
        if task:
            task.cancel()
