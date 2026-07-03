"""F2b — per-team Status + Spend on the teams list.

Each library-team summary now carries ``last_run`` (the most recent run across ALL clones of the
team, or ``None`` if never run) + ``spend_usd`` (the SUM of ``cost_total_usd`` across them, NULL as
0), joined via the REAL ``cloned_from_node_id`` clone->origin link. Every run here is built the
LAUNCH way — clone the library team via the actual clone helper (so the clone nodes carry
``cloned_from_node_id``) then insert a Run pointing at the clone — NOT a hand-faked shortcut, so the
tests exercise the genuine join. Offline: pure DB + the in-process client (no LLM / no workflow)."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from conftest import auth_user_id
from fastapi.testclient import TestClient

from tvashtr.control_plane.teams import (
    clone_team_graph,
    create_team_from_template,
    get_team_summary,
    list_library_teams,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import Run

_T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _run_on_clone(library_team_id, *, status, cost, created_at, owner=None):
    """Launch-shaped run: clone the library team via the REAL clone helper (so the clone's nodes
    carry ``cloned_from_node_id`` back to the origin), then insert a Run pointing at the clone.
    Returns the run id (str)."""
    clone_id = clone_team_graph(library_team_id)
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_id),
                owner_id=owner if owner is not None else auth_user_id(),
                idea="f2b run",
                workflow_id=str(run_id),
                status=status,
                cost_total_usd=cost,
                created_at=created_at,
            )
        )
    return str(run_id)


def _register_owner() -> uuid.UUID:
    """A SECOND account (a valid ``users`` row) via a bare TestClient — no ``with`` block, so it
    never re-runs the app lifespan (DBOS is already up from ``client``); we only need its id."""
    bare = TestClient(app)
    resp = bare.post(
        "/api/auth/register",
        json={"email": f"f2b-owner2-{uuid.uuid4().hex}@tvashtr.local", "password": "f2b-owner2-pw"},
    )
    assert resp.status_code == 200, resp.text
    return uuid.UUID(resp.json()["id"])


def test_never_run_team_has_null_last_run_and_zero_spend(client):
    tid = create_team_from_template("two_node", "f2b never run", auth_user_id())
    summary = get_team_summary(tid)
    assert summary["last_run"] is None
    assert summary["spend_usd"] == 0


def test_one_run_reports_status_run_id_and_cost(client):
    tid = create_team_from_template("review_loop", "f2b one run", auth_user_id())
    run_id = _run_on_clone(tid, status="completed", cost=Decimal("1.50"), created_at=_T0)
    summary = get_team_summary(tid)
    assert summary["last_run"] is not None
    assert summary["last_run"]["status"] == "completed"
    assert summary["last_run"]["run_id"] == run_id
    assert summary["last_run"]["at"].startswith("2026-01-01")  # = the run's created_at
    assert summary["spend_usd"] == 1.5


def test_multiple_runs_pick_latest_and_sum_spend_null_as_zero(client):
    tid = create_team_from_template("two_node", "f2b multi", auth_user_id())
    _run_on_clone(tid, status="failed", cost=Decimal("2.00"), created_at=_T0)
    _run_on_clone(tid, status="rejected", cost=None, created_at=_T0 + timedelta(hours=1))
    latest = _run_on_clone(
        tid, status="completed", cost=Decimal("0.25"), created_at=_T0 + timedelta(hours=2)
    )
    summary = get_team_summary(tid)
    # last_run = the MOST RECENT by created_at.
    assert summary["last_run"]["status"] == "completed"
    assert summary["last_run"]["run_id"] == latest
    # spend = 2.00 + 0 (the NULL cost) + 0.25.
    assert summary["spend_usd"] == 2.25


def test_isolation_second_team_and_second_owner_excluded(client):
    owner = auth_user_id()
    team_a = create_team_from_template("two_node", "f2b iso A", owner)
    team_b = create_team_from_template("two_node", "f2b iso B", owner)
    _run_on_clone(team_a, status="completed", cost=Decimal("1.00"), created_at=_T0)
    _run_on_clone(
        team_b, status="failed", cost=Decimal("9.00"), created_at=_T0 + timedelta(hours=1)
    )

    owner2 = _register_owner()
    team_c = create_team_from_template("two_node", "f2b iso C (owner2)", owner2)
    _run_on_clone(
        team_c,
        status="completed",
        cost=Decimal("100.00"),
        created_at=_T0 + timedelta(hours=2),
        owner=owner2,
    )

    # Team A rolls up ONLY its own run — not team B's (same owner) nor team C's (other owner).
    a = get_team_summary(team_a)
    assert a["last_run"]["status"] == "completed" and a["spend_usd"] == 1.0
    b = get_team_summary(team_b)
    assert b["last_run"]["status"] == "failed" and b["spend_usd"] == 9.0
    # owner2's own team correctly rolls up its own run (the mechanism is keyed per origin team).
    assert get_team_summary(team_c)["spend_usd"] == 100.0
    # The owner's LIST is owner-scoped: it includes A + B, never owner2's team C.
    listed = {t["team_graph_id"] for t in list_library_teams(owner)}
    assert team_a in listed and team_b in listed
    assert team_c not in listed


def test_get_teams_endpoint_carries_last_run_and_spend(client):
    run_team = create_team_from_template("review_loop", "f2b endpoint run", auth_user_id())
    create_team_from_template("two_node", "f2b endpoint never", auth_user_id())
    _run_on_clone(run_team, status="completed", cost=Decimal("3.50"), created_at=_T0)

    by_name = {t["name"]: t for t in client.get("/api/teams").json()["teams"]}
    assert by_name["f2b endpoint run"]["last_run"]["status"] == "completed"
    assert by_name["f2b endpoint run"]["spend_usd"] == 3.5
    assert by_name["f2b endpoint never"]["last_run"] is None
    assert by_name["f2b endpoint never"]["spend_usd"] == 0
