"""M-subs-desktop — a Desktop launch of a subscription-covered team reaches the Desktop runner.

The owner's own Claude/Grok CLI sign-in is the credential: the Desktop main process mirrors its
status (``PUT /api/engines/subscriptions/{provider}``) and its runner's polls are the heartbeat
(A3). A desktop-targeted launch counts a FRESH connected mirror in place of an API key; a hosted
launch is unchanged (still 422 without a key).
"""

import uuid

from fastapi.testclient import TestClient

from tvashtr import db
from tvashtr.main import app
from tvashtr.models import AgentNode


def _fresh_account() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"desktop-launch-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "desktop-launch-pass"})
    assert resp.status_code == 200, resp.text
    return c


def _team_with_models(c: TestClient, *models: str) -> str:
    """A two_node team whose model-bearing nodes carry ``models`` in order (cycled)."""
    team_id = c.post("/api/teams", json={"template": "two_node", "name": "desktop-sub"}).json()[
        "team_graph_id"
    ]
    with db.session_scope() as session:
        rows = (
            session.query(AgentNode)
            .filter(AgentNode.team_graph_id == uuid.UUID(team_id), AgentNode.model.isnot(None))
            .order_by(AgentNode.role_name)
            .all()
        )
        for i, row in enumerate(rows):
            row.model = models[i % len(models)]
    return team_id


def _connect_desktop(c: TestClient, *providers: str) -> None:
    """What a running Tvashtr Desktop does for a signed-in user: push status, then poll."""
    for p in providers:
        put = c.put(
            f"/api/engines/subscriptions/{p}",
            json={"connected": True, "state": "connected", "source": "harness"},
        )
        assert put.status_code == 200, put.text
    c.post("/api/desktop-runner/claim", json={"providers": list(providers)})


def test_desktop_launch_of_subscription_only_team_is_accepted(monkeypatch):
    """E1 reproduction: on f20664a this 422s ``subscription_only`` — the Desktop Run never reaches
    the user's CLI. The fix: a desktop-targeted launch with a fresh Claude mirror is accepted."""
    from tvashtr import routers

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c = _fresh_account()
    team_id = _team_with_models(c, "anthropic/claude-sonnet-5")
    _connect_desktop(c, "claude")
    assert c.get("/api/providers").json()["providers"] == []

    resp = c.post(
        "/api/runs", json={"team_graph_id": team_id, "idea": "hi", "desktop_target": True}
    )
    assert resp.status_code == 200, resp.text


def _launch(c: TestClient, team_id: str, desktop: bool):
    body = {"team_graph_id": team_id, "idea": "hi"}
    if desktop:
        body["desktop_target"] = True
    return c.post("/api/runs", json=body)


def _run_row(run_id: str):
    from tvashtr.models import Run

    with db.session_scope() as session:
        run = session.get(Run, uuid.UUID(run_id))
        return run.desktop_target, run.desktop_subscriptions


def test_desktop_launch_records_which_subscriptions_route_to_the_desktop(monkeypatch):
    from tvashtr import routers

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c = _fresh_account()
    team_id = _team_with_models(c, "xai/grok-4.7", "anthropic/claude-sonnet-5")
    _connect_desktop(c, "claude", "grok")
    resp = _launch(c, team_id, desktop=True)
    assert resp.status_code == 200, resp.text
    assert _run_row(resp.json()["run_id"]) == (True, ["claude", "grok"])


def test_hosted_launch_is_unchanged_even_with_a_fresh_desktop(monkeypatch):
    """Invariant 5: a non-desktop launch still requires an API key."""
    from tvashtr import routers

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c = _fresh_account()
    team_id = _team_with_models(c, "anthropic/claude-sonnet-5")
    _connect_desktop(c, "claude")
    resp = _launch(c, team_id, desktop=False)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["missing_providers"] == ["anthropic"]


def test_desktop_launch_with_a_stale_desktop_is_refused_readably(monkeypatch):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from tvashtr import routers
    from tvashtr.models import DesktopRunnerHeartbeat

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c = _fresh_account()
    team_id = _team_with_models(c, "anthropic/claude-sonnet-5")
    _connect_desktop(c, "claude")
    me = c.get("/api/auth/me").json()["id"]
    with db.session_scope() as session:
        session.execute(
            update(DesktopRunnerHeartbeat)
            .where(DesktopRunnerHeartbeat.owner_id == uuid.UUID(me))
            .values(last_seen_at=datetime.now(UTC) - timedelta(minutes=30))
        )
    resp = _launch(c, team_id, desktop=True)
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["missing_providers"] == ["anthropic"]
    assert detail["desktop_target"] is True
    assert "Tvashtr Desktop" in detail["message"]


def test_desktop_launch_without_a_connected_subscription_needs_a_key(monkeypatch):
    from tvashtr import routers

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c = _fresh_account()
    team_id = _team_with_models(c, "anthropic/claude-sonnet-5")
    c.post(
        "/api/desktop-runner/claim", json={"providers": []}
    )  # Desktop open, Claude not connected
    resp = _launch(c, team_id, desktop=True)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["missing_providers"] == ["anthropic"]


def test_desktop_launch_prefers_the_subscription_over_a_held_key(monkeypatch):
    from tvashtr import routers

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    c = _fresh_account()
    assert c.post(
        "/api/providers", json={"provider": "anthropic", "api_key": "sk-ant-api03-test"}
    ).status_code in (200, 201)
    team_id = _team_with_models(c, "anthropic/claude-sonnet-5")
    _connect_desktop(c, "claude")
    resp = _launch(c, team_id, desktop=True)
    assert resp.status_code == 200, resp.text
    assert _run_row(resp.json()["run_id"]) == (True, ["claude"])
