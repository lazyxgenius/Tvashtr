"""Rename a team + the per-run history drill-down — the two dashboard reads/writes this slice adds.

REPRODUCE-FIRST. Before this slice there was NO rename path at all (a team's name was fixed at
creation: ``PATCH /api/teams/{id}`` 405'd) and NO way to see more than the LATEST run of a team
(``TeamSummary.last_run`` is one run; the other N were unreachable from the API).
:func:`test_rename_updates_the_team_name` and
:func:`test_list_team_runs_returns_every_run_newest_first`
are those two gaps; on the pre-change code they failed with ``405 Method Not Allowed`` and
``404 Not Found`` respectively.

Every run here is built the LAUNCH way — clone the library team via the REAL ``clone_team_graph``
(so the clone's nodes carry ``cloned_from_node_id``) then insert a Run pointing at the clone — NOT a
hand-faked shortcut, so the history read exercises the genuine clone→origin join that
``_run_rollup_by_origin`` / ``_team_run_teardown_targets`` already use. Offline: pure DB + the
in-process client (no LLM / no workflow).
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from conftest import auth_user_id
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tvashtr.control_plane.teams import (
    clone_team_graph,
    create_team_from_template,
    list_team_runs,
    rename_library_team,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentNode, Run, TeamGraph

_T0 = datetime(2026, 3, 1, tzinfo=UTC)


def _run_on_clone(library_team_id, *, status="completed", cost=Decimal("0"), created_at=_T0, idea):
    """Launch-shaped run: clone the library team via the REAL clone helper (so the clone's nodes
    carry ``cloned_from_node_id`` back to the origin), then insert a Run pointing at the clone."""
    clone_id = clone_team_graph(library_team_id)
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_id),
                owner_id=auth_user_id(),
                idea=idea,
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
        json={"email": f"rn-owner2-{uuid.uuid4().hex}@tvashtr.local", "password": "rn-owner2-pw"},
    )
    assert resp.status_code == 200, resp.text
    return uuid.UUID(resp.json()["id"])


# ---------------------------------------------------------------------------------------------
# RENAME — an owner-checked UPDATE of TeamGraph.name.
# ---------------------------------------------------------------------------------------------


def test_rename_updates_the_team_name(client):
    """THE GAP: teams were named at creation only, with no way to correct one afterwards."""
    tid = create_team_from_template("two_node", "Old name", auth_user_id())

    resp = client.patch(f"/api/teams/{tid}", json={"name": "New name"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "New name"
    # And it PERSISTED — the list read (a different query) sees it too.
    listed = {t["team_graph_id"]: t["name"] for t in client.get("/api/teams").json()["teams"]}
    assert listed[tid] == "New name", "the rename did not persist"


def test_rename_returns_the_full_updated_summary(client):
    """The FE swaps the renamed row in place, so the response must be a whole summary — the same
    shape ``POST /api/teams`` returns — not just an ack."""
    tid = create_team_from_template("review_loop", "Summary shape", auth_user_id())

    body = client.patch(f"/api/teams/{tid}", json={"name": "Renamed"}).json()

    assert set(body) >= {
        "team_graph_id",
        "name",
        "created_at",
        "node_count",
        "last_run",
        "spend_usd",
    }, body
    assert body["team_graph_id"] == tid
    assert body["node_count"] > 0, "the summary lost its node count"


def test_rename_only_touches_the_named_team(client):
    """A bulk UPDATE with a missing/wrong predicate would rename the whole library."""
    keep = create_team_from_template("two_node", "Untouched", auth_user_id())
    target = create_team_from_template("two_node", "Target", auth_user_id())

    client.patch(f"/api/teams/{target}", json={"name": "Renamed"})

    names = {t["team_graph_id"]: t["name"] for t in client.get("/api/teams").json()["teams"]}
    assert names[target] == "Renamed"
    assert names[keep] == "Untouched", "the rename leaked onto another team"


def test_rename_trims_surrounding_whitespace(client):
    """A padded name is a typo, not an intent — stored trimmed, so the row never renders ragged."""
    tid = create_team_from_template("two_node", "Padded", auth_user_id())

    body = client.patch(f"/api/teams/{tid}", json={"name": "  Trimmed  "}).json()

    assert body["name"] == "Trimmed"


@pytest.mark.parametrize("name", ["", "   ", "\t\n"])
def test_rename_rejects_a_blank_name(client, name):
    """422 on empty/whitespace — an unnamed row is unusable in the rail; the old name is kept."""
    tid = create_team_from_template("two_node", "Keeps its name", auth_user_id())

    resp = client.patch(f"/api/teams/{tid}", json={"name": name})

    assert resp.status_code == 422, resp.text
    names = {t["team_graph_id"]: t["name"] for t in client.get("/api/teams").json()["teams"]}
    assert names[tid] == "Keeps its name", "a rejected rename still mutated the row"


def test_rename_404s_on_a_foreign_team(client):
    """OWNER ISOLATION. Another account's team is not renameable — and 404, not 403, so its
    existence is not even probeable (the suite's convention)."""
    other = _register_owner()
    foreign = create_team_from_template("two_node", "Not yours", other)

    resp = client.patch(f"/api/teams/{foreign}", json={"name": "Hijacked"})

    assert resp.status_code == 404, resp.text
    with session_scope() as session:
        graph = session.get(TeamGraph, uuid.UUID(foreign))
        assert graph.name == "Not yours", "a foreign team was renamed"


def test_rename_404s_on_an_absent_team(client):
    resp = client.patch(f"/api/teams/{uuid.uuid4()}", json={"name": "Ghost"})

    assert resp.status_code == 404, resp.text


def test_rename_404s_on_a_run_snapshot_clone(client):
    """A clone is an immutable run snapshot, not a library team — renaming one would corrupt the
    record of what actually ran. It is filtered by the same ``is_library`` predicate DELETE uses."""
    tid = create_team_from_template("two_node", "Origin", auth_user_id())
    clone_id = clone_team_graph(tid)

    resp = client.patch(f"/api/teams/{clone_id}", json={"name": "Rewriting history"})

    assert resp.status_code == 404, resp.text


def test_rename_400s_on_a_malformed_team_id(client):
    """Mirrors ``DELETE /api/teams/{id}``: a non-UUID id is malformed, not missing."""
    resp = client.patch("/api/teams/not-a-uuid", json={"name": "Nope"})

    assert resp.status_code == 400, resp.text


def test_rename_library_team_is_owner_scoped_at_the_core(client):
    """The owner check lives in the core, not only in the endpoint — so no future caller can reach
    a foreign team by skipping the router. ``None`` is the not-found signal the router 404s."""
    other = _register_owner()
    foreign = create_team_from_template("two_node", "Core-guarded", other)

    assert rename_library_team(uuid.UUID(foreign), "Hijacked", auth_user_id()) is None

    mine = create_team_from_template("two_node", "Mine", auth_user_id())
    assert rename_library_team(uuid.UUID(mine), "Renamed", auth_user_id())["name"] == "Renamed"


# ---------------------------------------------------------------------------------------------
# HISTORY — every run of a team, newest first.
# ---------------------------------------------------------------------------------------------


def test_list_team_runs_returns_every_run_newest_first(client):
    """THE GAP: only the LATEST run was reachable (``TeamSummary.last_run``); a team's other runs
    existed in the database with no way to read them."""
    tid = create_team_from_template("review_loop", "History", auth_user_id())
    _run_on_clone(tid, idea="oldest", created_at=_T0)
    _run_on_clone(tid, idea="middle", created_at=_T0 + timedelta(hours=1))
    _run_on_clone(tid, idea="newest", created_at=_T0 + timedelta(hours=2))

    resp = client.get(f"/api/teams/{tid}/runs")

    assert resp.status_code == 200, resp.text
    runs = resp.json()["runs"]
    assert [r["idea"] for r in runs] == ["newest", "middle", "oldest"], runs


def test_list_team_runs_carries_status_idea_cost_and_time(client):
    """The drill-down row's whole payload, asserted field by field."""
    tid = create_team_from_template("two_node", "Payload", auth_user_id())
    run_id = _run_on_clone(
        tid, idea="ship the thing", status="failed", cost=Decimal("2.25"), created_at=_T0
    )

    row = client.get(f"/api/teams/{tid}/runs").json()["runs"][0]

    assert row["run_id"] == run_id
    assert row["status"] == "failed"
    assert row["idea"] == "ship the thing"
    assert row["cost_total_usd"] == 2.25
    assert row["created_at"].startswith("2026-03-01")


def test_list_team_runs_reports_a_null_cost_as_zero(client):
    """A run that never recorded spend must render ``$0.00``, not ``null`` — same coalesce the
    rollup applies."""
    tid = create_team_from_template("two_node", "No cost", auth_user_id())
    with session_scope() as session:
        run_id = uuid.uuid4()
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_team_graph(tid)),
                owner_id=auth_user_id(),
                idea="never spent",
                workflow_id=str(run_id),
                status="pending",
                cost_total_usd=None,
                created_at=_T0,
            )
        )

    assert client.get(f"/api/teams/{tid}/runs").json()["runs"][0]["cost_total_usd"] == 0


def test_list_team_runs_collapses_the_node_fan_out_to_one_row_per_run(client):
    """THE ``DISTINCT``. A clone has MANY nodes and each joins back to an origin node in the same
    library team, so the un-collapsed join returns one row PER NODE — a single run would appear 6×.
    ``review_loop`` is used deliberately: it has several nodes, so a missing ``DISTINCT`` fails
    loudly here rather than passing on a one-node team."""
    tid = create_team_from_template("review_loop", "Fan out", auth_user_id())
    with session_scope() as session:
        node_count = session.execute(
            select(func.count())
            .select_from(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(tid))
        ).scalar_one()
    assert node_count > 1, "this test is vacuous on a single-node team"
    _run_on_clone(tid, idea="one run only")

    runs = client.get(f"/api/teams/{tid}/runs").json()["runs"]

    assert len(runs) == 1, f"the node fan-out was not collapsed: {len(runs)} rows for 1 run"


def test_list_team_runs_is_empty_for_a_never_run_team(client):
    """An empty list, NOT a 404 — the team exists, it just has no history yet."""
    tid = create_team_from_template("two_node", "Never run", auth_user_id())

    resp = client.get(f"/api/teams/{tid}/runs")

    assert resp.status_code == 200, resp.text
    assert resp.json()["runs"] == []


def test_list_team_runs_excludes_another_teams_runs(client):
    """The join must be anchored to THIS team — a sibling team's runs are not history here."""
    mine = create_team_from_template("two_node", "Mine", auth_user_id())
    sibling = create_team_from_template("two_node", "Sibling", auth_user_id())
    _run_on_clone(mine, idea="mine")
    _run_on_clone(sibling, idea="sibling's")

    ideas = [r["idea"] for r in client.get(f"/api/teams/{mine}/runs").json()["runs"]]

    assert ideas == ["mine"], ideas


def test_list_team_runs_404s_on_a_foreign_team(client):
    """OWNER ISOLATION — another account's run history is not readable, and not probeable."""
    other = _register_owner()
    foreign = create_team_from_template("two_node", "Not yours", other)

    resp = client.get(f"/api/teams/{foreign}/runs")

    assert resp.status_code == 404, resp.text


def test_list_team_runs_404s_on_an_absent_team(client):
    assert client.get(f"/api/teams/{uuid.uuid4()}/runs").status_code == 404


def test_list_team_runs_400s_on_a_malformed_team_id(client):
    assert client.get("/api/teams/not-a-uuid/runs").status_code == 400


def test_list_team_runs_is_owner_scoped_at_the_core(client):
    """Owner-checking in the core, not only the endpoint — and the two not-found answers stay
    DISTINGUISHABLE: ``None`` (no such team of yours → 404) vs ``[]`` (your team, no runs → 200)."""
    other = _register_owner()
    foreign = create_team_from_template("two_node", "Core-guarded", other)
    mine = create_team_from_template("two_node", "Mine, unrun", auth_user_id())

    assert list_team_runs(uuid.UUID(foreign), auth_user_id()) is None
    assert list_team_runs(uuid.UUID(mine), auth_user_id()) == []


def test_list_team_runs_matches_the_summarys_latest_run(client):
    """The drill-down and the collapsed row must agree: the first history row IS ``last_run``. They
    are two different queries over the same join, so a divergence would be a silent inconsistency
    the user sees as the dashboard contradicting itself."""
    tid = create_team_from_template("review_loop", "Agreement", auth_user_id())
    _run_on_clone(tid, idea="older", created_at=_T0)
    newest = _run_on_clone(
        tid, idea="newer", status="completed", created_at=_T0 + timedelta(days=1)
    )

    summary = next(t for t in client.get("/api/teams").json()["teams"] if t["team_graph_id"] == tid)
    first = client.get(f"/api/teams/{tid}/runs").json()["runs"][0]

    assert summary["last_run"]["run_id"] == newest == first["run_id"]
    assert summary["last_run"]["status"] == first["status"]
