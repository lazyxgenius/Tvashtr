"""Mode A — "Ask the node": reproduce + contract tests for
``POST /api/runs/{run_id}/nodes/{node_id}/ask``.

The endpoint lets a user converse with ONE node about what it did during a run. It assembles the
node's recorded TRAIL (role/prompt, its ``AgentInvocation`` outcome + detail + manifest, the
invocation-scoped ``RunEvent``s, the run idea + latest spec, and — for a worker — its diff) into a
SYSTEM message pinning the model to answer ONLY from that record, then calls the gateway with the
node's model + the run-owner's BYOK key.

These are mutation-real: the gateway ``complete`` is MOCKED (no live LLM), and the happy-path test
CAPTURES the messages passed to it and asserts the node's REAL outcome + outcome_detail + event text
are present in the system message — so it fails against an assembler that returns an empty string.
Owner-isolation mirrors ``test_run_diff.py`` (a foreign user is 404, existence not even probeable),
and the cost test proves the ask is NOT attributed to the run (``workflow_id=None``).
"""

import uuid
from decimal import Decimal

from conftest import auth_user_id
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr import routers
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, GatewayError
from tvashtr.main import app
from tvashtr.metering import running_cost
from tvashtr.models import AgentInvocation, AgentNode, Run, RunEvent

_SENTINEL_DETAIL = "SENTINEL_DETAIL the bulk_discount edge case had no test"
_SENTINEL_EVENT = "SENTINEL_EVENT ran pytest -> 5 passed, 0 failed"
_IDEA = "Add a bulk_discount(total, pct) to the shop pricing module."


def _canned_result(
    text: str = "I requested changes because the edge case lacked a test.",
) -> CompletionResult:
    """A real frozen ``CompletionResult`` (the gateway's return type), cost 0.0."""
    model = "openrouter/meta-llama/llama-3.1-8b-instruct"
    return CompletionResult(
        text=text,
        model_requested=model,
        model_used=model,
        prompt_tokens=12,
        completion_tokens=9,
        total_tokens=21,
        cost_usd=0.0,
        raw_provider="openrouter",
        latency_ms=1.0,
    )


def _seed_run_with_trail(
    *,
    role: str = "engineer",
    with_invocation: bool = True,
    outcome: str = "changes_requested",
    detail: str | None = _SENTINEL_DETAIL,
    event_text: str = _SENTINEL_EVENT,
    model_override: str | None = None,
) -> tuple[str, str, str]:
    """Seed an owned, completed run over a real review_loop team and (optionally) one recorded
    invocation + event on ``role``'s node. Returns ``(run_id, node_id, node_model)``."""
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        nodes = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .all()
        )
        node = {n.role_name: n for n in nodes}[role]
        node_id = str(node.id)
        if model_override is not None:
            node.model = model_override
        node_model = node.model
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=_IDEA,
                workflow_id=run_id,
                status="completed",
            )
        )
        if with_invocation:
            inv = AgentInvocation(
                run_id=run_id,
                node_id=node.id,
                iteration=1,
                status="done",
                outcome=outcome,
                outcome_detail=detail,
                context_manifest={
                    "parts": [{"name": "instruction", "tokens": 8}],
                    "total_tokens": 8,
                    "budget": 110000,
                    "handle_used": False,
                },
            )
            session.add(inv)
            session.flush()
            session.add(
                RunEvent(
                    run_id=run_id,
                    invocation_id=inv.id,
                    seq=0,
                    kind="message",
                    payload={"text": event_text},
                )
            )
    return run_id, node_id, node_model


def test_node_ask_system_message_carries_the_node_trail(client, monkeypatch):
    """(a) The assembled SYSTEM message contains the node's REAL outcome + outcome_detail + event
    text (+ the run idea + role); the client's message rides after it; the gateway is called with
    the node's model + the resolved BYOK key (fails against a stubbed-empty assembler)."""
    run_id, node_id, node_model = _seed_run_with_trail()

    captured: dict = {}

    def _capture(request):
        captured["messages"] = list(request.messages)
        captured["model"] = request.model
        captured["api_key"] = request.api_key
        return _canned_result()

    monkeypatch.setattr(routers, "complete", _capture)

    resp = client.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask",
        json={"messages": [{"role": "user", "content": "Why did you request changes?"}]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"answer": "I requested changes because the edge case lacked a test."}

    # The system message pins the model to the recorded trail.
    system = captured["messages"][0]
    assert system["role"] == "system"
    content = system["content"]
    assert "changes_requested" in content  # the invocation outcome
    assert _SENTINEL_DETAIL in content  # the invocation outcome_detail
    assert _SENTINEL_EVENT in content  # the invocation-scoped run event text
    assert "bulk_discount" in content  # the run idea
    assert "engineer" in content.lower()  # the node role

    # The client's turns are appended AFTER the system message, unmodified.
    assert captured["messages"][1] == {"role": "user", "content": "Why did you request changes?"}
    # Called with the node's own model + the run-owner's resolved (dummy) BYOK key.
    assert captured["model"] == node_model
    assert captured["api_key"] == "dummy-offline-test-key-0000"


def test_node_ask_is_owner_scoped(client, monkeypatch):
    """(b) A DIFFERENT authenticated user gets 404 (existence not probeable); an absent run is 404;
    the owner gets 200."""
    monkeypatch.setattr(routers, "complete", lambda request: _canned_result())
    run_id, node_id, _ = _seed_run_with_trail()

    other = TestClient(app)
    other.cookies.clear()
    reg = other.post(
        "/api/auth/register",
        json={"email": f"nodeask-other-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert reg.status_code == 200, reg.text

    body = {"messages": [{"role": "user", "content": "hi"}]}
    assert other.post(f"/api/runs/{run_id}/nodes/{node_id}/ask", json=body).status_code == 404
    assert other.post(f"/api/runs/{uuid.uuid4()}/nodes/{node_id}/ask", json=body).status_code == 404
    assert client.post(f"/api/runs/{run_id}/nodes/{node_id}/ask", json=body).status_code == 200


def test_node_ask_does_not_attribute_cost_to_the_run(client, monkeypatch):
    """(c) ``running_cost(run_id)`` is UNCHANGED after an ask — the meta-question's spend is
    recorded with ``workflow_id=None`` (not attributed to the run)."""
    monkeypatch.setattr(routers, "complete", lambda request: _canned_result())
    run_id, node_id, _ = _seed_run_with_trail()

    before = running_cost(run_id)
    assert before == Decimal("0")

    resp = client.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask",
        json={"messages": [{"role": "user", "content": "explain"}]},
    )
    assert resp.status_code == 200, resp.text
    assert running_cost(run_id) == before  # still Decimal("0") — the ask is not on the run's ledger


def test_node_ask_rejects_more_than_24_messages(client, monkeypatch):
    """(d) The turn cap: > 24 client messages is rejected 4xx (before any model call)."""
    monkeypatch.setattr(routers, "complete", lambda request: _canned_result())
    run_id, node_id, _ = _seed_run_with_trail()

    too_many = [{"role": "user", "content": f"m{i}"} for i in range(25)]
    resp = client.post(f"/api/runs/{run_id}/nodes/{node_id}/ask", json={"messages": too_many})
    assert resp.status_code == 422, resp.text

    # sanity: 24 is allowed (the boundary) — the mock keeps it offline
    ok = [{"role": "user", "content": f"m{i}"} for i in range(24)]
    assert (
        client.post(f"/api/runs/{run_id}/nodes/{node_id}/ask", json={"messages": ok}).status_code
        == 200
    )


def test_node_ask_node_without_invocations_is_rejected(client, monkeypatch):
    """(e) A node that has NOT run yet (no AgentInvocation) is rejected 4xx — there is no trail to
    explain."""
    monkeypatch.setattr(routers, "complete", lambda request: _canned_result())
    run_id, node_id, _ = _seed_run_with_trail(with_invocation=False)

    resp = client.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask",
        json={"messages": [{"role": "user", "content": "what did you do?"}]},
    )
    assert 400 <= resp.status_code < 500, resp.text
    assert resp.status_code != 404  # the node EXISTS in the graph; it just has no runs


def test_node_ask_non_agent_completion_node_is_rejected(client, monkeypatch):
    """(f) A gate/terminal node is not askable — 4xx (only agent/completion nodes carry a trail)."""
    monkeypatch.setattr(routers, "complete", lambda request: _canned_result())
    # The prd_gate node exists in the review_loop graph but is kind="gate".
    run_id, node_id, _ = _seed_run_with_trail(role="prd_gate", with_invocation=False)

    resp = client.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask",
        json={"messages": [{"role": "user", "content": "explain"}]},
    )
    assert 400 <= resp.status_code < 500, resp.text


def test_node_ask_gateway_failure_is_5xx(client, monkeypatch):
    """(g) A ``GatewayError`` (all provider models failed) surfaces as 5xx, not a 200/4xx."""

    def _boom(request):
        raise GatewayError("all models failed")

    monkeypatch.setattr(routers, "complete", _boom)
    run_id, node_id, _ = _seed_run_with_trail()

    resp = client.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask",
        json={"messages": [{"role": "user", "content": "explain"}]},
    )
    assert resp.status_code >= 500, resp.text


def test_node_ask_missing_owner_credential_is_4xx(client, monkeypatch):
    """(h) When the run-owner has no BYOK key for the node's model provider, the ask is refused 4xx
    (NoCredentialError), not a 500 — the resolve runs before the model call."""
    monkeypatch.setattr(routers, "complete", lambda request: _canned_result())
    # A provider the conftest never seeds a dummy credential for -> NoCredentialError.
    run_id, node_id, _ = _seed_run_with_trail(model_override="ghostprovider/nope-9b")

    resp = client.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask",
        json={"messages": [{"role": "user", "content": "explain"}]},
    )
    assert 400 <= resp.status_code < 500, resp.text
