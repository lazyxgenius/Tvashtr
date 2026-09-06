"""M-live D2: the launch pre-flight refuses a model the provider no longer serves.

M-accounts Slice B taught the pre-flight to ask *"does the owner hold a key for this provider?"*.
It never asked *"does that provider still serve this model?"*, so NVIDIA's retirement of
``meta/llama-3.3-70b-instruct`` sailed through validation and killed the run forty seconds in, with
an opaque error, on stage. This is the sibling check — same 422, same contract, one new field.

Ordering is load-bearing and pinned below: the credential check runs FIRST, because without a key
we cannot even ask the provider what it serves.
"""

import uuid

from fastapi.testclient import TestClient

from tvashtr import db
from tvashtr.control_plane import provider_models
from tvashtr.main import app
from tvashtr.models import AgentNode

_DEAD = "nvidia_nim/meta/llama-3.3-70b-instruct"
_LIVE = "nvidia_nim/openai/gpt-oss-20b"


def _fresh_account() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"m-live-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "m-live-pass"})
    assert resp.status_code == 200, resp.text
    return c


def _force_node_models(team_id: str, model: str) -> list[str]:
    """Pin every model-bearing node to ``model``; return the role names touched."""
    with db.session_scope() as session:
        rows = session.query(AgentNode).filter(AgentNode.team_graph_id == uuid.UUID(team_id)).all()
        touched = []
        for row in rows:
            if row.model:
                row.model = model
                touched.append(row.role_name)
        return sorted(touched)


def _nim_list(*served: str):
    body = {"data": [{"id": s} for s in served]}

    def _get(url, headers, timeout):  # noqa: ARG001
        return 200, body

    return _get


def _team_with(c: TestClient, model: str) -> tuple[str, list[str]]:
    team_id = c.post("/api/teams", json={"template": "review_loop", "name": "m-live"}).json()[
        "team_graph_id"
    ]
    return team_id, _force_node_models(team_id, model)


def test_a_retired_model_is_refused_before_the_run_starts(monkeypatch):
    """The M-live case, end to end through the real endpoint: 422 naming the slug AND the nodes."""
    provider_models.reset_cache()
    monkeypatch.setattr(
        provider_models, "_default_http_get", _nim_list("openai/gpt-oss-20b"), raising=True
    )
    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nvapi-dummy"})
    team_id, nodes = _team_with(c, _DEAD)

    resp = c.post("/api/runs", json={"team_graph_id": team_id})

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["unservable_models"] == [_DEAD], detail
    assert set(detail["missing_nodes"]) == set(nodes), detail
    # The FE launch banner renders `message` verbatim (M-legible) — the slug AND every offending
    # node must be IN it, or the user still has to guess what to fix.
    assert _DEAD in detail["message"], detail["message"]
    assert "nvidia_nim" in detail["message"], detail["message"]
    for node in nodes:
        assert node in detail["message"], detail["message"]


def test_a_served_model_launches_normally(monkeypatch):
    """The converse: a live slug must not be refused by the new check."""
    provider_models.reset_cache()
    monkeypatch.setattr(
        provider_models, "_default_http_get", _nim_list("openai/gpt-oss-20b"), raising=True
    )
    from tvashtr.routers import _unservable_node_models

    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nvapi-dummy"})
    team_id, _nodes = _team_with(c, _LIVE)
    owner_id = uuid.UUID(c.get("/api/auth/me").json()["id"])
    assert _unservable_node_models(owner_id, team_id) == ([], [])


def test_an_unreachable_provider_never_blocks_a_launch(monkeypatch):
    """FAIL OPEN at the pre-flight, not just inside the resolver: the check being down is not a
    reason to refuse. This is the invariant that keeps a provider blip from becoming an outage."""
    provider_models.reset_cache()

    def _boom(url, headers, timeout):  # noqa: ARG001
        raise OSError("provider unreachable")

    monkeypatch.setattr(provider_models, "_default_http_get", _boom, raising=True)
    from tvashtr.routers import _unservable_node_models

    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nvapi-dummy"})
    team_id, _nodes = _team_with(c, _DEAD)  # a KNOWN-dead slug…
    owner_id = uuid.UUID(c.get("/api/auth/me").json()["id"])
    assert _unservable_node_models(owner_id, team_id) == ([], [])  # …still launches.


def test_the_credential_check_still_wins_when_both_would_fire(monkeypatch):
    """Ordering: no key ⇒ we cannot ask the provider anything, so the CREDENTIAL refusal must be
    what the user sees. A 'your model is dead' message for a provider they never configured would
    send them to fix the wrong thing."""
    provider_models.reset_cache()
    monkeypatch.setattr(
        provider_models, "_default_http_get", _nim_list("openai/gpt-oss-20b"), raising=True
    )
    c = _fresh_account()  # holds NO keys at all
    team_id, _nodes = _team_with(c, _DEAD)

    resp = c.post("/api/runs", json={"team_graph_id": team_id})

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["missing_providers"] == ["nvidia_nim"], detail
    assert "unservable_models" not in detail, detail


def test_the_ab_launch_path_is_covered_too(monkeypatch):
    """routers.py runs the same pre-flight per A/B side; the new check must ride along, or the
    instrument becomes a hole through which a dead model still reaches a real run."""
    import inspect

    from tvashtr import routers

    source = inspect.getsource(routers.create_ab_runs)
    assert "_unservable_node_models" in source, "the A/B path skips the servability pre-flight"
    assert "_unservable_models_detail" in source


def test_gate_and_terminal_nodes_are_skipped(monkeypatch):
    """Nodes with no model carry nothing to check — same rule the credential check already uses."""
    provider_models.reset_cache()
    monkeypatch.setattr(
        provider_models, "_default_http_get", _nim_list("nothing/at-all"), raising=True
    )
    from tvashtr.routers import _unservable_node_models

    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nvapi-dummy"})
    team_id, nodes = _team_with(c, _DEAD)
    owner_id = uuid.UUID(c.get("/api/auth/me").json()["id"])
    models, offending = _unservable_node_models(owner_id, team_id)
    assert models == [_DEAD]
    # exactly the model-bearing nodes, no gate/terminal names leaked in
    assert offending == nodes
