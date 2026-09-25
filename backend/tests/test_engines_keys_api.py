"""Revamp (Engines): API keys gain timestamps + a replace flag and a prefix check; the subscription
mirror gains the Desktop check-in (``runner``) and a validated ``state`` vocabulary."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.credentials import PROVIDER_SLUG_ERROR, validate_provider_slug
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import DesktopRunnerHeartbeat


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"engines-keys-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "engines-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


# ------------------------------------------------------------------------- API keys ----


def test_add_returns_timestamps_and_replaced_false_for_a_new_key():
    c, _ = _fresh()
    resp = c.post("/api/providers", json={"provider": "anthropic", "api_key": "sk-ant-aaaa1111"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["provider"] == "anthropic" and body["key_last4"] == "1111"
    assert body["replaced"] is False
    created = datetime.fromisoformat(body["created_at"])
    updated = datetime.fromisoformat(body["updated_at"])
    assert created.tzinfo is not None and updated >= created
    listed = c.get("/api/providers").json()["providers"]
    assert listed == [{k: body[k] for k in ("provider", "key_last4", "created_at", "updated_at")}]


def test_replacing_a_key_says_so_and_keeps_created_at():
    c, _ = _fresh()
    first = c.post("/api/providers", json={"provider": "xai", "api_key": "xai-first-1111"}).json()
    second = c.post("/api/providers", json={"provider": "xai", "api_key": "xai-second-2222"})
    assert second.status_code == 200, second.text
    second = second.json()
    assert second["replaced"] is True
    assert second["key_last4"] == "2222"
    assert second["created_at"] == first["created_at"]
    assert datetime.fromisoformat(second["updated_at"]) > datetime.fromisoformat(
        first["updated_at"]
    )
    (row,) = c.get("/api/providers").json()["providers"]
    assert row["updated_at"] == second["updated_at"] and row["key_last4"] == "2222"


@pytest.mark.parametrize(
    ("raw", "canonical"),
    [
        ("mistral", "mistral"),
        ("  Mistral ", "mistral"),
        ("mistral/large", "mistral"),  # canonicalized to the prefix, as before
        ("nvidia_nim", "nvidia_nim"),
        ("x.ai-2", "x.ai-2"),
        ("a" * 64, "a" * 64),
    ],
)
def test_valid_prefixes_save_under_their_canonical_slug(raw, canonical):
    assert validate_provider_slug(raw) == canonical
    c, _ = _fresh()
    resp = c.post("/api/providers", json={"provider": raw, "api_key": "k-0000"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["provider"] == canonical


@pytest.mark.parametrize("raw", ["my provider", "mistral!", "_mistral", "-x", ".x", "a" * 65])
def test_an_invalid_prefix_is_refused_with_the_design_copy(raw):
    with pytest.raises(ValueError, match="model prefix"):
        validate_provider_slug(raw)
    c, _ = _fresh()
    resp = c.post("/api/providers", json={"provider": raw, "api_key": "k-0000"})
    assert resp.status_code == 422
    assert resp.json() == {
        "detail": "Use just the model prefix — the part before the slash, like mistral."
    }
    assert PROVIDER_SLUG_ERROR == resp.json()["detail"]
    assert c.get("/api/providers").json()["providers"] == []  # nothing saved


def test_empty_provider_and_empty_key_keep_their_messages():
    c, _ = _fresh()
    resp = c.post("/api/providers", json={"provider": "  ", "api_key": "k"})
    assert resp.status_code == 422 and resp.json()["detail"] == "A provider is required."
    resp = c.post("/api/providers", json={"provider": "mistral", "api_key": "  "})
    assert resp.status_code == 422 and resp.json()["detail"] == "An API key is required."


# ------------------------------------------------------------------ subscriptions: runner ----


def test_runner_is_absent_until_desktop_checks_in():
    c, _ = _fresh()
    body = c.get("/api/engines/subscriptions").json()
    assert body["runner"] == {"fresh": False, "last_seen_at": None, "providers": []}
    assert [s["provider"] for s in body["subscriptions"]] == ["claude", "grok", "codex"]


def test_runner_is_fresh_right_after_a_poll_and_lists_what_it_offered():
    c, owner = _fresh()
    desktop_jobs.heartbeat(owner, ["grok", "claude", "codex"])
    runner = c.get("/api/engines/subscriptions").json()["runner"]
    assert runner["fresh"] is True
    assert runner["providers"] == ["claude", "grok"]  # codex cannot run nodes, never offered
    seen = datetime.fromisoformat(runner["last_seen_at"])
    assert datetime.now(UTC) - seen < timedelta(minutes=1)


def test_runner_goes_stale_after_the_freshness_window():
    c, owner = _fresh()
    desktop_jobs.heartbeat(owner, ["claude"])
    old = datetime.now(UTC) - timedelta(hours=1)
    with session_scope() as session:
        session.get(DesktopRunnerHeartbeat, owner).last_seen_at = old
    body = c.get("/api/engines/subscriptions").json()
    assert body["runner"]["fresh"] is False
    assert datetime.fromisoformat(body["runner"]["last_seen_at"]) == old
    assert body["runner"]["providers"] == ["claude"]  # kept, so the UI can still name it
    # ...and the per-subscription flag agrees with it.
    assert all(s["runner_fresh"] is False for s in body["subscriptions"])


def test_runner_is_owner_scoped():
    c, _ = _fresh()
    _, other = _fresh()
    desktop_jobs.heartbeat(other, ["claude"])
    assert c.get("/api/engines/subscriptions").json()["runner"]["fresh"] is False


# ------------------------------------------------------------ subscriptions: state vocab ----


@pytest.mark.parametrize(
    "state", ["disconnected", "needs_install", "needs_login", "api_key", "connected", "error"]
)
def test_every_known_state_is_accepted(state):
    c, _ = _fresh()
    resp = c.put(
        "/api/engines/subscriptions/claude",
        json={"connected": state == "connected", "state": state, "source": "harness"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["state"] == state


@pytest.mark.parametrize("state", ["checking", "Connected", "logged_in", "  ", "ok"])
def test_an_unknown_state_is_refused(state):
    c, _ = _fresh()
    resp = c.put("/api/engines/subscriptions/grok", json={"connected": False, "state": state})
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "state must be one of: api_key, connected, disconnected, error, needs_install, needs_login"
    )
    grok = next(
        s
        for s in c.get("/api/engines/subscriptions").json()["subscriptions"]
        if s["provider"] == "grok"
    )
    assert grok["checked_at"] is None  # nothing was written


def test_state_still_defaults_from_connected_when_omitted():
    c, _ = _fresh()
    resp = c.put("/api/engines/subscriptions/claude", json={"connected": True})
    assert resp.status_code == 200 and resp.json()["state"] == "connected"
    resp = c.put("/api/engines/subscriptions/claude", json={"connected": False})
    assert resp.status_code == 200 and resp.json()["state"] == "disconnected"
