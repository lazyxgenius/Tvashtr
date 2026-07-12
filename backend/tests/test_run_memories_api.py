"""M-memory S2 — GET /api/runs/{run_id}/memories (owner-scoped, mutation-real, offline).

The endpoint returns the durable facts a run TAUGHT (active + pending_review, this run only), each
with polarity/status/tier — backing the "this run taught N things" view. It is owner-scoped exactly
like ``/diff`` and ``/trajectory``: owner B gets a 404 for owner A's run (existence not leaked).
"""

import uuid

from conftest import auth_user_id
from fastapi.testclient import TestClient

from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import NodeMemory, Run


def _make_run(owner: uuid.UUID, status: str = "completed") -> str:
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner,
                idea="x",
                workflow_id=run_id,
                status=status,
            )
        )
    return run_id


def _add_memory(
    owner: uuid.UUID,
    *,
    run_id: str | None,
    status: str,
    polarity: str,
    content: str,
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
) -> None:
    with session_scope() as session:
        session.add(
            NodeMemory(
                owner_id=owner,
                repo_key=repo_key,
                node_id=node_id,
                content=content,
                embedding=None,
                polarity=polarity,
                status=status,
                source_run_id=run_id,
            )
        )


def _register_other() -> TestClient:
    other = TestClient(app)
    other.cookies.clear()
    reg = other.post(
        "/api/auth/register",
        json={"email": f"rm-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert reg.status_code == 200, reg.text
    return other


def test_returns_active_and_pending_facts_for_this_run_only(client):
    owner = auth_user_id()
    run_id = _make_run(owner)
    repo = f"/repo/{uuid.uuid4().hex}"
    node = uuid.uuid4()
    _add_memory(
        owner,
        run_id=run_id,
        status="active",
        polarity="prefer",
        content="active repo fact",
        repo_key=repo,
    )
    _add_memory(
        owner,
        run_id=run_id,
        status="pending_review",
        polarity="avoid",
        content="pending negative",
        repo_key=repo,
    )
    _add_memory(
        owner,
        run_id=run_id,
        status="active",
        polarity="context",
        content="node fact",
        repo_key=repo,
        node_id=node,
    )
    # NOT returned: a superseded fact from this run, and a fact from a DIFFERENT run
    _add_memory(
        owner,
        run_id=run_id,
        status="superseded",
        polarity="prefer",
        content="old superseded fact",
        repo_key=repo,
    )
    _add_memory(
        owner,
        run_id="some-other-run",
        status="active",
        polarity="prefer",
        content="other run fact",
        repo_key=repo,
    )

    resp = client.get(f"/api/runs/{run_id}/memories")
    assert resp.status_code == 200, resp.text
    mems = resp.json()["memories"]
    contents = {m["content"] for m in mems}
    assert contents == {"active repo fact", "pending negative", "node fact"}

    by_content = {m["content"]: m for m in mems}
    # labels are present on every fact
    for m in mems:
        assert m["polarity"] in ("require", "prefer", "allow", "context", "avoid", "forbid")
        assert m["status"] in ("active", "pending_review")
        assert m["tier"] in ("account", "repo", "node")
    assert by_content["pending negative"]["status"] == "pending_review"
    assert by_content["pending negative"]["polarity"] == "avoid"
    assert by_content["active repo fact"]["tier"] == "repo"
    assert by_content["node fact"]["tier"] == "node"  # repo_key + node_id ⇒ node tier


def test_empty_when_run_taught_nothing(client):
    run_id = _make_run(auth_user_id())
    resp = client.get(f"/api/runs/{run_id}/memories")
    assert resp.status_code == 200
    assert resp.json()["memories"] == []


def test_owner_scoped_404_for_another_owners_run(client):
    owner = auth_user_id()
    run_id = _make_run(owner)
    _add_memory(
        owner, run_id=run_id, status="active", polarity="prefer", content="A's fact", repo_key="/r"
    )

    other = _register_other()  # owner B
    resp = other.get(f"/api/runs/{run_id}/memories")
    assert resp.status_code == 404  # existence not even leaked


def test_unknown_run_is_404(client):
    resp = client.get(f"/api/runs/{uuid.uuid4()}/memories")
    assert resp.status_code == 404
