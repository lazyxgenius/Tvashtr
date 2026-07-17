"""M-h1b — HOSTED GitHub run mode: schema (migration 0030), the create_run source postures + the
POST /api/repo/inspect fence, the durable clone step, and the push+PR Ship terminal.

The offline suite runs at the SELF-HOSTED default (hosted_mode False); hosted-posture tests flip it
per-test with monkeypatch (mirroring test_github_endpoints._configure_hosted). Outbound GitHub HTTP
is faked at the github_app seam — the repo convention (no respx/MockTransport).
"""

import uuid

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run
from tvashtr.routers import _run_to_dict

# ---------------------------------------------------------------- migration 0030 (schema)


def test_run_to_dict_surfaces_github_repo_and_pr_url(client):
    """Migration 0030: the hosted-GitHub columns round-trip through the run serializer — the
    owner/name + PR url when set, and NULL for a local/greenfield run (every existing row)."""
    team_graph_id = build_two_node_team()
    hosted_id, plain_id = uuid.uuid4(), uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=hosted_id,
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(hosted_id),
                status="completed",
                github_repo="lazyxgenius/trade_mcp",
                pr_url="https://github.com/lazyxgenius/trade_mcp/pull/1",
            )
        )
        s.add(
            Run(
                id=plain_id,
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=str(plain_id),
                status="completed",
            )
        )
    with session_scope() as s:
        hosted = s.execute(select(Run).where(Run.id == hosted_id)).scalar_one()
        plain = s.execute(select(Run).where(Run.id == plain_id)).scalar_one()
        hosted_d, plain_d = _run_to_dict(hosted), _run_to_dict(plain)
    assert hosted_d["github_repo"] == "lazyxgenius/trade_mcp"
    assert hosted_d["pr_url"] == "https://github.com/lazyxgenius/trade_mcp/pull/1"
    assert plain_d["github_repo"] is None and plain_d["pr_url"] is None
