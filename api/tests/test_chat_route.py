"""Wiring tests for POST /chat.

Exercises the real route through FastAPI -- dependency injection, the
StreamingResponse, NDJSON framing and the persistence callback -- with Supabase
and Gemini faked. Unit tests cover the pieces; these cover them plugged
together, which is where wiring bugs live.
"""

import json

import pytest
from fastapi.testclient import TestClient

import main
import routes.chat as chat_route
from deps import get_current_user_client

USER_ID = "user-a"

PROFILE = {
    "user_id": USER_ID, "goal": "gain", "rate_lb_per_week": 0.5, "sex": "male",
    "weight_kg": 67, "height_cm": 179, "age": 20, "activity_level": "moderate",
    "cuisines": ["South Indian"], "exclusions": ["Seafood"], "gym_days": 5,
    "budget_level": "medium",
}


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def gte(self, *_):
        return self

    def lte(self, *_):
        return self

    def order(self, *_):
        return self

    def single(self):
        return self

    def execute(self):
        return type("R", (), {"data": self.db.rows.get(self.name, [])})()

    def insert(self, payload):
        rows = payload if isinstance(payload, list) else [payload]
        stored = self.db.rows.setdefault(self.name, [])
        for row in rows:
            stored.append({**row, "id": f"{self.name}-{len(stored)}"})
        self.db.inserted.setdefault(self.name, []).extend(rows)
        return type("Q", (), {"execute": lambda _s=None: type("R", (), {"data": stored[-len(rows):]})()})()


class FakeDB:
    def __init__(self, **rows):
        self.rows = {"profiles": PROFILE, "meals": [], "messages": [], "conversations": [], **rows}
        self.inserted = {}

    def table(self, name):
        return FakeTable(self, name)


@pytest.fixture
def client_and_db(monkeypatch):
    db = FakeDB(conversations=[{"id": "conv-1"}])
    main.app.dependency_overrides[get_current_user_client] = lambda: (USER_ID, db)
    yield TestClient(main.app), db
    main.app.dependency_overrides.clear()


def read_lines(response) -> list[dict]:
    return [json.loads(l) for l in response.text.splitlines() if l.strip()]


def test_streams_a_reply_and_persists_both_sides(client_and_db, monkeypatch):
    client, db = client_and_db
    monkeypatch.setattr(chat_route, "stream_reply",
                        lambda *a, **k: iter(["You have ", "60g of protein left."]))

    res = client.post("/chat", json={"message": "how much protein left?", "today": "2026-07-24"})
    assert res.status_code == 200

    lines = read_lines(res)
    assert "".join(l["text"] for l in lines if l["type"] == "chunk") == "You have 60g of protein left."
    assert lines[-1]["type"] == "done"

    saved = db.inserted["messages"]
    assert [m["role"] for m in saved] == ["user", "assistant"]
    assert saved[0]["content"] == "how much protein left?"
    assert saved[1]["content"] == "You have 60g of protein left."
    assert all(m["user_id"] == USER_ID for m in saved)


def test_real_numbers_reach_the_system_prompt(client_and_db, monkeypatch):
    client, db = client_and_db
    db.rows["meals"] = [
        {"logged_on": "2026-07-24", "kcal": 1200, "protein_g": 60, "carbs_g": 100, "fat_g": 30}
    ]
    captured = {}

    def fake_stream(system_prompt, history, tools, **_):
        captured["prompt"] = system_prompt
        captured["history"] = history
        return iter(["ok"])

    monkeypatch.setattr(chat_route, "stream_reply", fake_stream)
    client.post("/chat", json={"message": "how am I doing?", "today": "2026-07-24"})

    # Today's real total, the target, and the remainder all arrive precomputed.
    prompt = captured["prompt"].replace(",", "")
    assert "1200" in prompt and "2875" in prompt and "1675" in prompt
    assert "Seafood" in prompt  # exclusions are always in context
    assert captured["history"][-1] == {"role": "user", "content": "how am I doing?"}


def test_partial_reply_is_not_persisted_when_generation_fails(client_and_db, monkeypatch):
    client, db = client_and_db

    def failing(*_a, **_k):
        yield "here's the start"
        raise RuntimeError("gemini fell over")

    monkeypatch.setattr(chat_route, "stream_reply", lambda *a, **k: failing())

    lines = read_lines(client.post("/chat", json={"message": "hi", "today": "2026-07-24"}))
    assert lines[-1]["type"] == "error"
    # Nothing half-finished gets attributed to the Coach in history.
    assert "messages" not in db.inserted


def test_empty_message_is_rejected(client_and_db):
    client, _ = client_and_db
    assert client.post("/chat", json={"message": "   ", "today": "2026-07-24"}).status_code == 400


def test_history_is_returned_for_rendering(client_and_db):
    client, db = client_and_db
    db.rows["messages"] = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
    res = client.get("/chat/history")
    assert res.status_code == 200
    assert [m["role"] for m in res.json()] == ["user", "assistant"]


def test_chat_requires_authentication():
    # No dependency override here: the real dependency must reject the request.
    assert TestClient(main.app).post(
        "/chat", json={"message": "hi", "today": "2026-07-24"}
    ).status_code in (401, 422)
