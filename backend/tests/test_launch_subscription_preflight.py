"""Fly hosted launch preflight: subscription mirror must not unlock Fly; clear copy when it would."""

import uuid

from fastapi.testclient import TestClient

from tvashtr import db
from tvashtr.main import app
from tvashtr.models import AgentNode


def _fresh_account() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"sub-preflight-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "sub-preflight-pass"})
    assert resp.status_code == 200, resp.text
    return c


def _force_node_models(team_id: str, model: str) -> list[str]:
    with db.session_scope() as session:
        rows = session.query(AgentNode).filter(AgentNode.team_graph_id == uuid.UUID(team_id)).all()
        touched = []
        for row in rows:
            if row.model:
                row.model = model
                touched.append(row.role_name)
        return sorted(touched)


def _team_with_anthropic(c: TestClient) -> str:
    team_id = c.post("/api/teams", json={"template": "review_loop", "name": "sub-preflight"}).json()[
        "team_graph_id"
    ]
    _force_node_models(team_id, "anthropic/claude-sonnet-4")
    return team_id


def test_hosted_launch_subscription_only_message():
    """Claude mirror connected + no anthropic BYOK → 422 with subscription_only copy, not a launch."""
    c = _fresh_account()
    team_id = _team_with_anthropic(c)
    put = c.put(
        "/api/engines/subscriptions/claude",
        json={"connected": True, "state": "connected", "source": "harness"},
    )
    assert put.status_code == 200, put.text
    assert c.get("/api/providers").json()["providers"] == []

    resp = c.post("/api/runs", json={"team_graph_id": team_id, "idea": "hi"})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail.get("subscription_only") is True
    assert "Hosted runs need an API key" in detail["message"]
    assert "Desktop" in detail["message"]
    assert "anthropic" in detail["missing_providers"]
    assert detail["missing_nodes"]


def test_hosted_launch_ordinary_missing_key_when_no_subscription():
    """No subscription mirror → ordinary missing-key message (regression); still not subscription_only."""
    c = _fresh_account()
    team_id = _team_with_anthropic(c)

    resp = c.post("/api/runs", json={"team_graph_id": team_id, "idea": "hi"})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail.get("subscription_only") is not True
    assert "you have no API key for:" in detail["message"]
    assert "anthropic" in detail["missing_providers"]
    assert "Hosted runs need an API key" not in detail["message"]


def test_ab_hosted_launch_subscription_only_message(monkeypatch):
    """POST /api/ab-runs: Claude mirror + no anthropic BYOK → same subscription_only 422 as /api/runs."""
    from tvashtr import routers
    from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team

    # Never launch if preflight regresses.
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)

    def _anthro_builder(builder):
        def _build(*args, **kwargs):
            team_id = builder(*args, **kwargs)
            _force_node_models(team_id, "anthropic/claude-sonnet-4")
            return team_id

        return _build

    monkeypatch.setitem(routers._TEAM_BUILDERS, "two_node", _anthro_builder(build_two_node_team))
    monkeypatch.setitem(
        routers._TEAM_BUILDERS, "review_loop", _anthro_builder(build_review_loop_team)
    )

    c = _fresh_account()
    put = c.put(
        "/api/engines/subscriptions/claude",
        json={"connected": True, "state": "connected", "source": "harness"},
    )
    assert put.status_code == 200, put.text
    assert c.get("/api/providers").json()["providers"] == []

    resp = c.post("/api/ab-runs", json={"idea": "hi"})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail.get("subscription_only") is True
    assert "Hosted runs need an API key" in detail["message"]
    assert "Desktop" in detail["message"]
    assert "anthropic" in detail["missing_providers"]
    assert detail["missing_nodes"]


def test_ab_hosted_launch_ordinary_missing_key_when_no_subscription(monkeypatch):
    """POST /api/ab-runs without subscription mirror → ordinary missing-key copy (not subscription_only)."""
    from tvashtr import routers
    from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team

    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)

    def _anthro_builder(builder):
        def _build(*args, **kwargs):
            team_id = builder(*args, **kwargs)
            _force_node_models(team_id, "anthropic/claude-sonnet-4")
            return team_id

        return _build

    monkeypatch.setitem(routers._TEAM_BUILDERS, "two_node", _anthro_builder(build_two_node_team))
    monkeypatch.setitem(
        routers._TEAM_BUILDERS, "review_loop", _anthro_builder(build_review_loop_team)
    )

    c = _fresh_account()
    resp = c.post("/api/ab-runs", json={"idea": "hi"})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail.get("subscription_only") is not True
    assert "you have no API key for:" in detail["message"]
    assert "anthropic" in detail["missing_providers"]
    assert "Hosted runs need an API key" not in detail["message"]
