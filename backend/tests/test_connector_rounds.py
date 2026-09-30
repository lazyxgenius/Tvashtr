"""Connectors: what a run shows (stream B3.5). ``connector_use`` turns a round's ``connector_call``
and ``connector_skipped`` events into the ``connectors`` block of each round
(``GET /api/teams/{team}/nodes/{node}/runs``) and of each invocation (``GET /api/runs/{id}/graph``);
``recent_use`` is the connection page's "recent use".

The events are written by the real writers (``record_call``, ``record_skip``).

Contract: ``docs/superpowers/plans/api/connectors.md`` (What a run shows)."""

import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from mcp.types import CallToolResult, TextContent
from sqlalchemy import delete, event, select, update

from tvashtr.control_plane import connector_proxy
from tvashtr.control_plane.connector_proxy import (
    RunGrant,
    connector_use,
    recent_use,
    record_call,
    record_skip,
)
from tvashtr.control_plane.teams import clone_team_graph, create_team_from_template
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentInvocation, AgentNode, ConnectorConnection, Run, RunEvent

BAND = 1_000_000_000
OK = CallToolResult(content=[TextContent(type="text", text="ok")])
FAILED = CallToolResult(content=[TextContent(type="text", text="no")], isError=True)


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"conn-rounds-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "rounds-password"})
    assert resp.status_code == 200
    return c, uuid.UUID(resp.json()["id"])


@pytest.fixture
def owner(client):
    """A fresh account with its own review-loop team: ``(client, owner id, team id, nodes)``."""
    c, owner_id = _fresh()
    tid = create_team_from_template("review_loop", "Indicator sprint team", owner_id)
    nodes = {n["role_name"]: n["id"] for n in c.get(f"/api/teams/{tid}/graph").json()["nodes"]}
    return c, owner_id, tid, nodes


def _connection(owner_id: uuid.UUID, name: str = "Supabase") -> ConnectorConnection:
    with session_scope() as s:
        row = ConnectorConnection(
            owner_id=owner_id,
            connector_key=name.lower(),
            name=name,
            slug=name.lower(),
            url=f"https://mcp.{name.lower()}.example/mcp",
            auth_kind="api_key",
            status="connected",
        )
        s.add(row)
        s.flush()
        return row


def _run(owner_id: uuid.UUID, tid: str, status: str = "running") -> tuple[str, dict]:
    """A run of the library team ``tid``: ``(run id, {role: clone node id})``."""
    clone_id = uuid.UUID(clone_team_graph(tid))
    run_id = uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=run_id,
                team_graph_id=clone_id,
                library_team_id=uuid.UUID(tid),
                owner_id=owner_id,
                idea="Add an RSI indicator",
                workflow_id=str(run_id),
                status=status,
            )
        )
        rows = s.execute(select(AgentNode).where(AgentNode.team_graph_id == clone_id)).scalars()
        return str(run_id), {n.role_name: n.id for n in rows}


def _round(run_id: str, node_id: uuid.UUID, iteration: int = 1) -> int:
    with session_scope() as s:
        inv = AgentInvocation(run_id=run_id, node_id=node_id, iteration=iteration, status="done")
        s.add(inv)
        s.flush()
        return inv.id


def _grant(run_id: str, node_id: uuid.UUID, row: ConnectorConnection) -> RunGrant:
    return RunGrant(run_id=run_id, node_id=str(node_id), connection_id=row.id, access="write")


def _use(run_id: str, *invocation_ids: int) -> dict:
    with session_scope() as s:
        return connector_use(s, run_id, list(invocation_ids))


# ---- connector_use: one round's ``connectors`` ----


def test_a_rounds_connectors_block(owner):
    _c, owner_id, tid, _nodes = owner
    run_id, clone = _run(owner_id, tid)
    supabase, linear = _connection(owner_id), _connection(owner_id, "Linear")
    inv = _round(run_id, clone["reviewer"])
    db, issues = (
        _grant(run_id, clone["reviewer"], supabase),
        _grant(run_id, clone["reviewer"], linear),
    )
    made = CallToolResult(
        content=[TextContent(type="text", text="Created https://linear.app/acme/issue/LIN-214")]
    )

    record_call(db, supabase, "execute_sql", write=False, arguments={"query": "SELECT 1"},
                duration_ms=312, result=OK)  # fmt: skip
    record_call(issues, linear, "create_issue", write=True, arguments={"title": "RSI"}, result=made)
    record_call(db, supabase, "list_tables", write=False, result=OK)
    record_call(issues, linear, "delete_issue", write=True, blocked=True)  # refused: read only
    record_call(db, supabase, "execute_sql", write=False, result=FAILED)  # the provider said no
    record_call(db, supabase, "get_logs", write=False)  # it didn't answer

    use = _use(run_id, inv)
    assert set(use) == {inv}
    block = use[inv]
    assert set(block) == {"used", "calls", "total_calls", "skipped"}
    # Ordered by first call; blocked and failed calls are not counted.
    assert block["used"] == [
        {"connection_id": str(supabase.id), "name": "Supabase", "slug": "supabase",
         "reads": 2, "writes": 0},
        {"connection_id": str(linear.id), "name": "Linear", "slug": "linear",
         "reads": 0, "writes": 1},
    ]  # fmt: skip
    assert block["total_calls"] == 6 and block["skipped"] == []
    # Writes first (a refused one too), then by time.
    assert [(c["name"], c["tool"], c["write"], c["ok"], c["blocked"]) for c in block["calls"]] == [
        ("Linear", "create_issue", True, True, False),
        ("Linear", "delete_issue", True, False, True),
        ("Supabase", "execute_sql", False, True, False),
        ("Supabase", "list_tables", False, True, False),
        ("Supabase", "execute_sql", False, False, False),
        ("Supabase", "get_logs", False, False, False),
    ]
    first_write, first_read = block["calls"][0], block["calls"][2]
    assert first_write == {
        "connection_id": str(linear.id),
        "name": "Linear",
        "tool": "create_issue",
        "write": True,
        "ok": True,
        "blocked": False,
        "arg": "RSI",
        "at": first_write["at"],
        "duration_ms": 0,
        "result_url": "https://linear.app/acme/issue/LIN-214",
    }
    assert datetime.fromisoformat(first_write["at"]).tzinfo is not None  # ISO 8601 with offset
    assert (first_read["arg"], first_read["duration_ms"], first_read["result_url"]) == (
        "SELECT 1",
        312,
        None,
    )


def test_calls_are_capped_at_50_and_total_calls_is_the_real_number(owner):
    _c, owner_id, tid, _nodes = owner
    run_id, clone = _run(owner_id, tid)
    row = _connection(owner_id)
    inv = _round(run_id, clone["reviewer"])
    grant = _grant(run_id, clone["reviewer"], row)
    for n in range(52):
        record_call(grant, row, f"read_{n}", write=False, result=OK)
    record_call(grant, row, "the_write", write=True, result=OK)

    block = _use(run_id, inv)[inv]
    assert block["total_calls"] == 53 and len(block["calls"]) == 50
    assert block["calls"][0]["tool"] == "the_write"  # the last call, listed first
    assert [c["tool"] for c in block["calls"][1:]] == [f"read_{n}" for n in range(49)]
    assert block["used"][0]["reads"] == 52 and block["used"][0]["writes"] == 1
    # Two calls in a row never share a ``seq``.
    with session_scope() as s:
        seqs = s.execute(select(RunEvent.seq).where(RunEvent.invocation_id == inv)).scalars().all()
    assert sorted(seqs) == [BAND + n for n in range(53)]


def test_a_round_with_no_calls_and_nothing_skipped_has_no_block(owner):
    _c, owner_id, tid, _nodes = owner
    run_id, clone = _run(owner_id, tid)
    row = _connection(owner_id)
    quiet = _round(run_id, clone["engineer"])
    busy = _round(run_id, clone["reviewer"])
    record_call(_grant(run_id, clone["reviewer"], row), row, "list_tables", write=False, result=OK)

    use = _use(run_id, quiet, busy)
    assert set(use) == {busy} and use.get(quiet) is None
    assert _use(run_id) == {}
    # Another run's rounds are not this run's, whatever ids are asked for.
    other_run, _ = _run(owner_id, tid)
    assert _use(other_run, busy) == {}


def test_a_round_that_only_skipped_a_connector(owner):
    _c, owner_id, tid, _nodes = owner
    run_id, clone = _run(owner_id, tid)
    notion = _connection(owner_id, "Notion")
    inv = _round(run_id, clone["reviewer"])
    node = str(clone["reviewer"])

    for _ in range(3):  # every failed listing of a round writes one: they collapse
        record_skip(run_id, node, notion.id, "Notion", "its sign-in expired")
    record_skip(run_id, node, notion.id, "Notion", "we couldn’t reach it")
    record_skip(run_id, node, None, "a connector", "it was disconnected")
    record_skip(run_id, node, None, "a connector", "it was disconnected")

    assert _use(run_id, inv)[inv] == {
        "used": [],
        "calls": [],
        "total_calls": 0,
        "skipped": [
            {"connection_id": str(notion.id), "name": "Notion", "reason": "its sign-in expired"},
            {"connection_id": str(notion.id), "name": "Notion", "reason": "we couldn’t reach it"},
            {"connection_id": None, "name": "a connector", "reason": "it was disconnected"},
        ],
    }


def test_each_round_gets_its_own_block(owner):
    _c, owner_id, tid, _nodes = owner
    run_id, clone = _run(owner_id, tid)
    row = _connection(owner_id)
    grant = _grant(run_id, clone["reviewer"], row)
    first = _round(run_id, clone["reviewer"], 1)
    record_call(grant, row, "list_tables", write=False, result=OK)
    second = _round(run_id, clone["reviewer"], 2)  # the round that is running gets what follows
    record_call(grant, row, "execute_sql", write=False, result=OK)
    record_skip(run_id, grant.node_id, row.id, "Supabase", "we couldn’t reach it")

    use = _use(run_id, first, second)
    assert [c["tool"] for c in use[first]["calls"]] == ["list_tables"]
    assert use[first]["skipped"] == []
    assert [c["tool"] for c in use[second]["calls"]] == ["execute_sql"]
    assert [s["reason"] for s in use[second]["skipped"]] == ["we couldn’t reach it"]


# ---- the two endpoints ----


def _seed_round_with_a_call(owner_id: uuid.UUID, tid: str) -> tuple[str, dict, int, int]:
    run_id, clone = _run(owner_id, tid)
    row = _connection(owner_id)
    quiet = _round(run_id, clone["engineer"])
    busy = _round(run_id, clone["reviewer"])
    grant = _grant(run_id, clone["reviewer"], row)
    record_call(grant, row, "execute_sql", write=False, arguments={"sql": "SELECT 1"}, result=OK)
    record_skip(run_id, grant.node_id, None, "a connector", "it was disconnected")
    return run_id, clone, quiet, busy


def test_the_agents_runs_carry_connectors_on_each_round(owner):
    c, owner_id, tid, nodes = owner
    run_id, _clone, _quiet, busy = _seed_round_with_a_call(owner_id, tid)

    body = c.get(f"/api/teams/{tid}/nodes/{nodes['reviewer']}/runs").json()
    (round_,) = body["run"]["rounds"]
    assert round_["invocation_id"] == busy
    assert round_["connectors"]["used"][0]["reads"] == 1
    assert [call["arg"] for call in round_["connectors"]["calls"]] == ["SELECT 1"]
    assert round_["connectors"]["total_calls"] == 1
    assert round_["connectors"]["skipped"] == [
        {"connection_id": None, "name": "a connector", "reason": "it was disconnected"}
    ]
    # The fields a round already had are all still there.
    assert {"iteration", "status", "outcome", "cost", "given", "produced"} <= set(round_)

    engineer = c.get(f"/api/teams/{tid}/nodes/{nodes['engineer']}/runs").json()
    (quiet_round,) = engineer["run"]["rounds"]
    assert quiet_round["connectors"] is None

    # Another account: the same 404 as ever, connector data or not.
    stranger, _ = _fresh()
    path = f"/api/teams/{tid}/nodes/{nodes['reviewer']}/runs"
    assert stranger.get(path).status_code == 404
    assert stranger.get(f"{path}?run_id={run_id}").status_code == 404


def test_the_run_graph_carries_connectors_on_each_invocation(owner):
    c, owner_id, tid, _nodes = owner
    run_id, clone, quiet, busy = _seed_round_with_a_call(owner_id, tid)

    graph = c.get(f"/api/runs/{run_id}/graph").json()
    by_id = {n["id"]: n for n in graph["nodes"]}
    (invocation,) = by_id[str(clone["reviewer"])]["invocations"]
    assert invocation["invocation_id"] == busy
    assert invocation["connectors"]["total_calls"] == 1
    assert invocation["connectors"]["used"] == [
        {
            "connection_id": invocation["connectors"]["used"][0]["connection_id"],
            "name": "Supabase",
            "slug": "supabase",
            "reads": 1,
            "writes": 0,
        }
    ]
    assert invocation["connectors"]["skipped"][0]["reason"] == "it was disconnected"
    assert {"iteration", "status", "outcome", "context_manifest", "cost"} <= set(invocation)
    (quiet_invocation,) = by_id[str(clone["engineer"])]["invocations"]
    assert quiet_invocation["invocation_id"] == quiet and quiet_invocation["connectors"] is None
    # The skip is a run warning too (shape unchanged).
    assert graph["resolution_warnings"] == [
        {"source_kind": "connector", "name": "a connector", "reason": "it was disconnected"}
    ]

    stranger, _ = _fresh()
    assert stranger.get(f"/api/runs/{run_id}/graph").status_code == 404
    assert stranger.get(f"/api/spike/run-events/{run_id}").status_code == 404


def test_the_run_events_endpoint_lists_the_new_kinds_after_the_engines_events(owner):
    c, owner_id, tid, _nodes = owner
    run_id, clone, _quiet, busy = _seed_round_with_a_call(owner_id, tid)
    with session_scope() as s:
        s.add(RunEvent(run_id=run_id, invocation_id=busy, seq=0, kind="action", payload={}))

    events = c.get(f"/api/spike/run-events/{run_id}").json()["events"]
    assert [(e["seq"], e["kind"]) for e in events] == [
        (0, "action"),
        (BAND, "connector_call"),
        (BAND + 1, "connector_skipped"),
    ]
    call = events[1]
    assert (call["invocation_id"], call["node_id"], call["iteration"]) == (
        busy,
        str(clone["reviewer"]),
        1,
    )
    assert set(call["payload"]) == {
        "connection_id", "connector", "slug", "tool", "write", "ok", "blocked", "arg",
        "duration_ms", "result_url",
    }  # fmt: skip
    assert events[2]["payload"] == {
        "connection_id": None,
        "connector": "a connector",
        "reason": "it was disconnected",
    }


# ---- recent_use: the connection page ----


def _recent(owner_id: uuid.UUID, row: ConnectorConnection) -> list:
    with session_scope() as s:
        return recent_use(s, owner_id, row.id)


def test_recent_use_is_one_row_per_run_and_agent_newest_first(owner):
    _c, owner_id, tid, _nodes = owner
    supabase, linear = _connection(owner_id), _connection(owner_id, "Linear")
    assert _recent(owner_id, supabase) == []

    first_run, clone = _run(owner_id, tid, "completed")
    _round(first_run, clone["reviewer"], 1)
    _round(first_run, clone["reviewer"], 2)  # two rounds of one agent are one row
    _round(first_run, clone["engineer"])
    reviewer = _grant(first_run, clone["reviewer"], supabase)
    engineer = _grant(first_run, clone["engineer"], supabase)
    record_call(reviewer, supabase, "execute_sql", write=False, result=OK)
    record_call(reviewer, supabase, "list_tables", write=False, result=OK)
    record_call(reviewer, supabase, "apply_migration", write=True, blocked=True)  # not counted
    record_call(engineer, supabase, "apply_migration", write=True, result=OK)
    # Another connection's calls in the same round are not this connection's.
    record_call(_grant(first_run, clone["reviewer"], linear), linear, "list_issues",
                write=False, result=OK)  # fmt: skip

    second_run, clone2 = _run(owner_id, tid)
    _round(second_run, clone2["reviewer"])
    record_call(_grant(second_run, clone2["reviewer"], supabase), supabase, "get_logs",
                write=False, result=OK)  # fmt: skip

    rows = _recent(owner_id, supabase)
    assert [(r["run_id"], r["run_number"], r["agent"], r["reads"], r["writes"]) for r in rows] == [
        (second_run, 2, "Reviewer", 1, 0),
        (first_run, 1, "Engineer", 0, 1),
        (first_run, 1, "Reviewer", 2, 0),
    ]
    assert all(set(r) == {"run_id", "run_number", "agent", "reads", "writes", "at"} for r in rows)
    stamps = [datetime.fromisoformat(r["at"]) for r in rows]
    assert stamps == sorted(stamps, reverse=True) and stamps[0].tzinfo is not None

    assert [(r["agent"], r["reads"]) for r in _recent(owner_id, linear)] == [("Reviewer", 1)]
    # Another account never sees this account's runs, even asking by the connection's id.
    _stranger, stranger_id = _fresh()
    assert _recent(stranger_id, supabase) == []


def test_recent_use_is_at_most_10_rows_from_the_owners_last_30_runs(owner):
    _c, owner_id, tid, _nodes = owner
    row = _connection(owner_id)
    runs = []
    for _ in range(32):
        run_id, clone = _run(owner_id, tid, "completed")
        _round(run_id, clone["reviewer"])
        record_call(_grant(run_id, clone["reviewer"], row), row, "list_tables",
                    write=False, result=OK)  # fmt: skip
        runs.append(run_id)
    # Spread the runs over time (they were all made in one instant), oldest first.
    start = datetime.now(UTC) - timedelta(days=1)
    with session_scope() as s:
        for n, run_id in enumerate(runs):
            at = start + timedelta(minutes=n)
            s.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(created_at=at))
            s.execute(update(RunEvent).where(RunEvent.run_id == run_id).values(created_at=at))

    rows = _recent(owner_id, row)
    assert [r["run_id"] for r in rows] == runs[:-11:-1]  # the ten newest
    assert [r["run_number"] for r in rows] == list(range(32, 22, -1))

    # Only the last 30 runs are read: use in the two oldest is out of sight.
    with session_scope() as s:
        s.execute(delete(RunEvent).where(RunEvent.run_id.in_(runs[2:])))
    assert _recent(owner_id, row) == []
    assert connector_proxy.RECENT_USE_RUNS == 30 and connector_proxy.RECENT_USE_ROWS == 10


def test_recent_use_asks_for_a_runs_number_once_not_once_per_call(owner):
    _c, owner_id, tid, _nodes = owner
    row = _connection(owner_id)
    run_id, clone = _run(owner_id, tid)
    _round(run_id, clone["reviewer"])
    grant = _grant(run_id, clone["reviewer"], row)
    for _ in range(40):
        record_call(grant, row, "list_tables", write=False, result=OK)

    statements: list[str] = []

    def count(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    with session_scope() as s:
        event.listen(s.get_bind(), "before_cursor_execute", count)
        try:
            rows = recent_use(s, owner_id, row.id)
        finally:
            event.remove(s.get_bind(), "before_cursor_execute", count)

    assert [(r["run_number"], r["reads"]) for r in rows] == [(1, 40)]
    assert len(statements) <= 4  # the runs, the events, one run's number: never one per call


@pytest.mark.parametrize("with_node", [True, False])
def test_calls_made_at_the_same_moment_are_all_recorded(owner, with_node):
    _c, owner_id, tid, _nodes = owner
    row = _connection(owner_id)
    run_id, clone = _run(owner_id, tid)
    inv = _round(run_id, clone["reviewer"])
    grant = _grant(run_id, clone["reviewer"], row)
    if not with_node:  # a token with no node: its events share one band for the run
        grant = RunGrant(run_id=run_id, node_id=None, connection_id=row.id, access="write")
    writers = 12
    together = threading.Barrier(writers)

    def call(n: int) -> None:
        together.wait()
        record_call(grant, row, f"tool_{n}", write=True, result=OK)

    threads = [threading.Thread(target=call, args=(n,)) for n in range(writers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    with session_scope() as s:
        rows = s.execute(
            select(RunEvent.invocation_id, RunEvent.seq, RunEvent.payload["tool"].astext).where(
                RunEvent.run_id == run_id
            )
        ).all()
    assert sorted(tool for _inv, _seq, tool in rows) == sorted(f"tool_{n}" for n in range(writers))
    assert sorted(seq for _inv, seq, _tool in rows) == [BAND + n for n in range(writers)]
    assert {invocation for invocation, _seq, _tool in rows} == {inv if with_node else None}
