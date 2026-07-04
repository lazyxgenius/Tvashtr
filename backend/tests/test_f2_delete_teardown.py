"""F2-delete — deleting a team STOPS its in-flight run and hard-deletes the team + ALL its runs.

The bug this closes: ``DELETE /api/teams/{team_id}`` used to remove only the library team, leaving a
run executing (and spending) on its immutable clone — a zombie run under a deleted team. The fix
FIRST cancels every non-terminal run of the team (the shared cancel core: ``DBOS.cancel_workflow`` +
``Run.status='cancelled'`` + close pending ``HumanTask``s), THEN tears each run down across EVERY
run-scoped table (``cost_records`` by ``workflow_id``; ``run_events`` / ``agent_invocations`` /
``human_tasks`` / ``engineer_run_attempts`` by ``run_id``), the ``Run`` row, and its clone
``TeamGraph`` (nodes/edges cascade), THEN the library team.

Every run here is built the LAUNCH way — clone the library team via the actual clone helper (so the
clone nodes carry ``cloned_from_node_id``) + a ``Run`` pointing at the clone + real rows in all five
run-scoped tables — so the teardown is exercised for real (no faked shortcut).
``DBOS.cancel_workflow`` is spied so the tests can assert the cancel core WAS invoked for a
non-terminal run and NOT for an already-terminal one, without a live workflow. Offline: pure DB +
the in-process client."""

import uuid
from decimal import Decimal

from conftest import auth_user_id
from dbos import DBOS
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tvashtr.control_plane.teams import (
    clone_team_graph,
    create_team_from_template,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Edge,
    EngineerRunAttempt,
    HumanTask,
    Run,
    RunEvent,
    TeamGraph,
)

# Every table that links to a run by its id (grep-verified census of run_id / workflow_id columns):
# cost_records keys on ``workflow_id`` (== str(run_id)); the other four on ``run_id``.
_RUN_SCOPED = (
    (CostRecord, "workflow_id"),
    (RunEvent, "run_id"),
    (AgentInvocation, "run_id"),
    (HumanTask, "run_id"),
    (EngineerRunAttempt, "run_id"),
)


def _run_with_records(library_team_id, *, status, owner=None, cost="1.00"):
    """A launch-shaped run: clone the team via the REAL clone helper (clone nodes carry
    ``cloned_from_node_id`` back to origin), insert a ``Run`` at the clone, plus a real row in each
    of the five run-scoped tables. Returns ``(run_id_str, clone_graph_id_str)``."""
    clone_id = clone_team_graph(library_team_id)
    run_id = uuid.uuid4()
    rid = str(run_id)
    with session_scope() as session:
        node_id = (
            session.execute(
                select(AgentNode.id).where(AgentNode.team_graph_id == uuid.UUID(clone_id))
            )
            .scalars()
            .first()
        )
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_id),
                owner_id=owner if owner is not None else auth_user_id(),
                idea="f2-delete run",
                workflow_id=rid,
                status=status,
                cost_total_usd=Decimal(cost),
            )
        )
        session.add(
            CostRecord(
                workflow_id=rid,
                idempotency_key=f"{rid}:0",
                model_requested="m",
                model_used="m",
                prompt_tokens=1,
                completion_tokens=1,
                total_tokens=2,
                cost_usd=Decimal(cost),
            )
        )
        session.add(RunEvent(run_id=rid, seq=0, kind="message", payload={"t": "hi"}))
        session.add(
            AgentInvocation(
                run_id=rid, node_id=node_id, iteration=1, status="done", outcome="built"
            )
        )
        session.add(
            HumanTask(
                run_id=rid,
                kind="gate_approval",
                priority="high_blocker",
                blocking=True,
                topic=f"gate:{rid}",
                title="t",
                description="d",
                status="pending",
            )
        )
        session.add(EngineerRunAttempt(run_id=rid, pid=1234))
    return rid, clone_id


def _register_owner() -> uuid.UUID:
    """A SECOND account (a valid ``users`` row) via a bare TestClient — no ``with`` block, so it
    never re-runs the app lifespan (DBOS is already up from ``client``); we only need its id."""
    bare = TestClient(app)
    resp = bare.post(
        "/api/auth/register",
        json={"email": f"f2del-owner2-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-owner2"},
    )
    assert resp.status_code == 200, resp.text
    return uuid.UUID(resp.json()["id"])


def _run_scoped_counts(rid: str) -> dict[str, int]:
    """Rows still keyed to ``rid`` across EVERY run-scoped table — all zero == no orphan left."""
    with session_scope() as session:
        return {
            model.__tablename__: session.execute(
                select(func.count()).select_from(model).where(getattr(model, col) == rid)
            ).scalar_one()
            for model, col in _RUN_SCOPED
        }


def _run_exists(rid: str) -> bool:
    with session_scope() as session:
        return (
            session.execute(
                select(func.count()).select_from(Run).where(Run.workflow_id == rid)
            ).scalar_one()
            > 0
        )


def _graph_exists(gid: str) -> bool:
    with session_scope() as session:
        return (
            session.execute(
                select(func.count()).select_from(TeamGraph).where(TeamGraph.id == uuid.UUID(gid))
            ).scalar_one()
            > 0
        )


def _nodes_edges_count(gid: str) -> tuple[int, int]:
    with session_scope() as session:
        n = session.execute(
            select(func.count())
            .select_from(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(gid))
        ).scalar_one()
        e = session.execute(
            select(func.count()).select_from(Edge).where(Edge.team_graph_id == uuid.UUID(gid))
        ).scalar_one()
        return n, e


def _spy_cancel(monkeypatch) -> list[str]:
    """Record every ``DBOS.cancel_workflow`` call id (and no-op the real cancel — the runs here have
    no live workflow). Lets a test assert the cancel core WAS / WAS NOT invoked for a given run."""
    cancelled: list[str] = []
    monkeypatch.setattr(DBOS, "cancel_workflow", lambda workflow_id: cancelled.append(workflow_id))
    return cancelled


def test_reproduce_delete_stops_and_purges_inflight_run(client, monkeypatch):
    """REPRODUCE-FIRST: a team with a NON-terminal (running) run + real rows in all five run-scoped
    tables + its clone. After DELETE the DESIRED state is: the run was cancelled (the cancel core
    was invoked) AND the run + all run-scoped rows + its clone graph + the team + its nodes/edges
    are GONE. Pre-fix, the run survives (cancel never invoked; run/records/clone still present), so
    this fails today; the fix makes it pass."""
    cancelled = _spy_cancel(monkeypatch)
    tid = create_team_from_template("review_loop", "f2del inflight", auth_user_id())
    rid, clone_id = _run_with_records(tid, status="running")

    # Sanity: the fixture really populated all five run-scoped tables + the clone.
    assert all(v > 0 for v in _run_scoped_counts(rid).values())
    assert _graph_exists(clone_id)

    resp = client.delete(f"/api/teams/{tid}")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"team_graph_id": tid, "deleted": True}

    # The in-flight run was cancelled (the shared cancel core was invoked for it) ...
    assert rid in cancelled
    # ... and nothing tied to the run or the team survives.
    assert not _run_exists(rid), "the run row must be gone"
    assert _run_scoped_counts(rid) == {t.__tablename__: 0 for t, _ in _RUN_SCOPED}
    assert not _graph_exists(clone_id), "the clone snapshot graph must be gone"
    assert not _graph_exists(tid), "the library team must be gone"
    assert _nodes_edges_count(tid) == (0, 0)
    assert _nodes_edges_count(clone_id) == (0, 0)
    assert client.get(f"/api/teams/{tid}/graph").status_code == 404


def test_completed_run_is_purged_but_not_cancelled(client, monkeypatch):
    """An already-terminal (completed) run is torn down too — but the cancel core must NOT touch it
    (no re-cancel of a finished run). Everything still ends up gone."""
    cancelled = _spy_cancel(monkeypatch)
    tid = create_team_from_template("two_node", "f2del completed", auth_user_id())
    rid, clone_id = _run_with_records(tid, status="completed")

    resp = client.delete(f"/api/teams/{tid}")
    assert resp.status_code == 200, resp.text

    assert rid not in cancelled, "a terminal run must not be re-cancelled"
    assert not _run_exists(rid)
    assert _run_scoped_counts(rid) == {t.__tablename__: 0 for t, _ in _RUN_SCOPED}
    assert not _graph_exists(clone_id)
    assert not _graph_exists(tid)


def test_never_run_team_deletes_cleanly(client, monkeypatch):
    """A team that was never run still deletes fine (no runs to stop/purge); team + nodes/edges
    gone, the cancel core is never invoked."""
    cancelled = _spy_cancel(monkeypatch)
    tid = create_team_from_template("two_node", "f2del never run", auth_user_id())
    assert _nodes_edges_count(tid)[0] > 0  # it has nodes before delete

    resp = client.delete(f"/api/teams/{tid}")
    assert resp.status_code == 200, resp.text

    assert cancelled == []
    assert not _graph_exists(tid)
    assert _nodes_edges_count(tid) == (0, 0)
    assert client.get(f"/api/teams/{tid}/graph").status_code == 404


def test_isolation_sibling_team_and_other_owner_untouched_and_no_orphans(client, monkeypatch):
    """Deleting team A leaves team B's run/records/clone (same owner) AND another account's team C
    fully intact, and leaves ZERO run-scoped orphans for A's deleted run (count == 0 across every
    run_id-keyed table)."""
    _spy_cancel(monkeypatch)
    owner = auth_user_id()
    team_a = create_team_from_template("two_node", "f2del iso A", owner)
    team_b = create_team_from_template("two_node", "f2del iso B", owner)
    rid_a, clone_a = _run_with_records(team_a, status="running")
    rid_b, clone_b = _run_with_records(team_b, status="running")

    owner2 = _register_owner()
    team_c = create_team_from_template("two_node", "f2del iso C (owner2)", owner2)
    rid_c, clone_c = _run_with_records(team_c, status="running", owner=owner2)

    resp = client.delete(f"/api/teams/{team_a}")
    assert resp.status_code == 200, resp.text

    # A and everything under it is gone — no orphan rows anywhere.
    assert not _graph_exists(team_a)
    assert not _run_exists(rid_a)
    assert not _graph_exists(clone_a)
    assert _run_scoped_counts(rid_a) == {t.__tablename__: 0 for t, _ in _RUN_SCOPED}

    # Sibling team B (same owner) is fully intact — run, all its records, and its clone.
    assert _graph_exists(team_b)
    assert _run_exists(rid_b)
    assert _graph_exists(clone_b)
    assert all(v > 0 for v in _run_scoped_counts(rid_b).values())

    # Another account's team C is untouched.
    assert _graph_exists(team_c)
    assert _run_exists(rid_c)
    assert _graph_exists(clone_c)
    assert all(v > 0 for v in _run_scoped_counts(rid_c).values())
