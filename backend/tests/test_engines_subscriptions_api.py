"""Status-only engine subscription mirror — no secrets on Fly."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"engines-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "engines-password"}).status_code
        == 200
    )
    return c


def test_list_defaults_to_three_disconnected():
    c = _fresh()
    body = c.get("/api/engines/subscriptions").json()
    assert [s["provider"] for s in body["subscriptions"]] == ["claude", "grok", "codex"]
    for s in body["subscriptions"]:
        assert s["connected"] is False
        assert s["state"] == "disconnected"
        assert s["account_hint"] is None
        assert "api_key" not in s and "token" not in s and "secret" not in s


def test_put_status_round_trip_no_secrets_in_response():
    c = _fresh()
    resp = c.put(
        "/api/engines/subscriptions/claude",
        json={
            "connected": True,
            "state": "connected",
            "account_hint": "ada@example.com",
            "source": "harness",
        },
    )
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["provider"] == "claude"
    assert row["connected"] is True
    assert row["account_hint"] == "ada@example.com"
    assert row["source"] == "harness"
    assert row["checked_at"]
    listed = c.get("/api/engines/subscriptions").json()["subscriptions"]
    claude = next(s for s in listed if s["provider"] == "claude")
    assert claude["connected"] is True


def test_put_rejects_secret_bearing_bodies():
    c = _fresh()
    for poison in (
        {"connected": True, "api_key": "sk-leak"},
        {"connected": True, "token": "t"},
        {"connected": True, "cookies": "session=1"},
        {"connected": True, "secret": "x"},
        {"connected": True, "authorization": "Bearer x"},
    ):
        resp = c.put("/api/engines/subscriptions/claude", json=poison)
        assert resp.status_code == 422, poison


def test_delete_clears_mirror():
    c = _fresh()
    c.put(
        "/api/engines/subscriptions/grok",
        json={"connected": True, "state": "connected", "source": "harness"},
    )
    assert c.delete("/api/engines/subscriptions/grok").status_code == 204
    grok = next(
        s
        for s in c.get("/api/engines/subscriptions").json()["subscriptions"]
        if s["provider"] == "grok"
    )
    assert grok["connected"] is False and grok["state"] == "disconnected"


def test_unknown_provider_404():
    c = _fresh()
    assert c.put("/api/engines/subscriptions/nope", json={"connected": True}).status_code == 404
