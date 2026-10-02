"""M8 — Compare two versions (ruling R5; contract ``docs/superpowers/plans/api/compare.md``).

Two versions of a library team run one task at the same time, each run launched from its version's
stored graph (never the working copy, never a new version). Compare runs never ship and approve
their gates themselves unless the compare says otherwise — with no new DBOS step or workflow: the
flag rides ``load_graph_step``'s recorded dict and ``gate_auto_resolution_step``'s body. They queue
when the hosted caps are full. The walk tests drive the REAL ``run_team`` with a fake adapter at
``resolve_adapter`` (no LLM, no openhands)."""

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from conftest import _seed_dummy_credentials, auth_user_id, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from home_fixtures import (
    add_cost,
    add_invocation,
    clone_node,
    fresh_account,
    library_team,
    make_run,
)
from sqlalchemy import select, text, update

from tvashtr.config import get_settings
from tvashtr.control_plane import compare, gates, live_state, team_run, versions
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    AgentTest,
    AgentTestResult,
    AgentTestRun,
    Compare,
    HumanTask,
    Run,
    RunCheckpoint,
    TeamGraph,
    TeamVersion,
)

TASK = "Add an RSI indicator"
V2_PROMPT = "v2 engineer: always add tests for every indicator."
V2_MODEL = "deepseek/deepseek-chat"


# ------------------------------------------------------------------------------------ helpers


def _graph(c, team: str) -> dict:
    resp = c.get(f"/api/teams/{team}/graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _node(c, team: str, role: str) -> dict:
    return next(n for n in _graph(c, team)["nodes"] if n["role_name"] == role)


def _two_versions(c, name: str = "Indicator sprint team") -> str:
    """A library team with v1 (as made) and v2 (the Engineer's instructions and model changed)."""
    team = library_team(c, name=name)
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1
    eng = _node(c, team, "engineer")
    resp = c.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": V2_PROMPT})
    assert resp.status_code == 200, resp.text
    resp = c.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"model": V2_MODEL})
    assert resp.status_code == 200, resp.text
    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v2
    return team


def _post(c, team: str, monkeypatch, **body) -> tuple:
    """POST a compare with ``DBOS.start_workflow`` recorded (no workflow really starts) and no
    waiter thread; returns ``(response, started workflow ids, waiters spawned)``."""
    from dbos._context import get_local_dbos_context

    ids: list[str] = []
    waiters: list[str] = []

    def _start(fn, *args, **kwargs):  # noqa: ARG001
        ctx = get_local_dbos_context()
        ids.append(ctx.id_assigned_for_next_workflow if ctx else None)

    with monkeypatch.context() as m:
        m.setattr(DBOS, "start_workflow", _start)
        m.setattr(compare, "_spawn", lambda cid: waiters.append(str(cid)))
        payload = {"a": 1, "b": 2, "task": TASK, "auto_approve": True, **body}
        resp = c.post(f"/api/teams/{team}/compare", json=payload)
    return resp, ids, waiters


def _runs_of(compare_id: str) -> list[Run]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(Run).where(Run.pair_id == uuid.UUID(compare_id)).order_by(Run.pair_label)
            )
            .scalars()
            .all()
        )
        for r in rows:
            session.expunge(r)
    return rows


def _nodes_by_origin(graph_id) -> dict[str, AgentNode]:
    with session_scope() as session:
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph_id))
            .scalars()
            .all()
        )
        for n in nodes:
            session.expunge(n)
    return {str(n.cloned_from_node_id): n for n in nodes}


def _version_graph(team: str, number: int) -> dict:
    with session_scope() as session:
        return session.execute(
            select(TeamVersion.graph).where(
                TeamVersion.team_graph_id == uuid.UUID(team), TeamVersion.number == number
            )
        ).scalar_one()


def _version_count(team: str) -> int:
    with session_scope() as session:
        return len(
            session.execute(
                select(TeamVersion.id).where(TeamVersion.team_graph_id == uuid.UUID(team))
            ).all()
        )


def _snapshots(team_name: str) -> int:
    with session_scope() as session:
        return len(
            session.execute(
                select(TeamGraph.id).where(TeamGraph.name == f"{team_name} (run snapshot)")
            ).all()
        )


def _seed_compare(team: str, owner, *, a=1, b=2, status="running", auto_approve=True) -> str:
    cid = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Compare(
                id=cid,
                owner_id=owner,
                team_graph_id=uuid.UUID(team),
                version_a=a,
                version_b=b,
                task=TASK,
                auto_approve=auto_approve,
                status=status,
                started_at=datetime.now(UTC) - timedelta(minutes=40),
            )
        )
    return str(cid)


# ------------------------------------------------------------------------------------ the model


def test_migration_0049_adds_the_compares_table(client):
    with session_scope() as session:
        cols = set(
            session.execute(
                text(
                    "select column_name from information_schema.columns "
                    "where table_name = 'compares'"
                )
            ).scalars()
        )
    assert {
        "id",
        "owner_id",
        "team_graph_id",
        "version_a",
        "version_b",
        "task",
        "auto_approve",
        "repo",
        "base_ref",
        "status",
        "stop_requested",
        "created_at",
        "started_at",
        "ended_at",
    } == cols


# ------------------------------------------------------------------------------- the Compare tab


def test_the_compare_tab_offers_previous_vs_current_and_what_changed(client):
    team = _two_versions(client)
    page = client.get(f"/api/teams/{team}/compare")
    assert page.status_code == 200, page.text
    got = page.json()
    assert got["team"]["id"] == team and got["team"]["name"] == "Indicator sprint team"
    assert [v["number"] for v in got["versions"]] == [2, 1]
    assert [v["current"] for v in got["versions"]] == [True, False]
    assert got["versions"][1]["summary"] == "First version" and got["versions"][0]["runs"] == 0
    assert got["defaults"] == {"a": 1, "b": 2}
    assert got["changes"] == 2  # instructions + model
    assert got["estimate"] is None and got["latest"] is None and got["target"] is None

    changes = client.get(f"/api/teams/{team}/compare/changes", params={"a": 1, "b": 2}).json()
    assert changes["a"] == 1 and changes["b"] == 2
    assert [r["field"] for r in changes["rows"]] == ["Instructions", "Model"]
    assert changes["summary"] == "Engineer: instructions and model changed"
    assert (
        client.get(f"/api/teams/{team}/compare/changes", params={"a": 1, "b": 9}).status_code == 404
    )


def test_one_version_has_no_previous(client):
    team = library_team(client)
    got = client.get(f"/api/teams/{team}/compare").json()
    assert got["defaults"] == {"a": None, "b": 1} and got["changes"] == 0


# ------------------------------------------------------------------------------------ launching


def test_two_runs_launch_from_two_different_version_snapshots(client, monkeypatch):
    team = _two_versions(client)
    # A change since v2 that a plain run would save as v3: a compare never saves a version.
    eng = _node(client, team, "engineer")
    client.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "working copy only"})

    resp, started, _waiters = _post(client, team, monkeypatch)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "running"
    runs = _runs_of(body["id"])
    assert [(r["label"], r["version"]) for r in body["runs"]] == [("A", 1), ("B", 2)]
    assert [r["run_id"] for r in body["runs"]] == [str(r.id) for r in runs]
    assert sorted(started) == sorted(str(r.id) for r in runs)

    a, b = runs
    assert (a.pair_label, a.team_version_number, b.pair_label, b.team_version_number) == (
        "A",
        1,
        "B",
        2,
    )
    for run in runs:
        assert run.idea == TASK and run.library_team_id == uuid.UUID(team)
        assert run.status == "running" and run.owner_id == auth_user_id()
    assert a.budget_cap_usd == b.budget_cap_usd
    assert a.team_graph_id != b.team_graph_id
    assert _version_count(team) == 2  # no version was saved by the launch

    for run, number in ((a, 1), (b, 2)):
        stored = {n["id"]: n for n in _version_graph(team, number)["nodes"]}
        nodes = _nodes_by_origin(run.team_graph_id)
        assert set(nodes) == set(stored)
        for origin, node in nodes.items():
            assert (node.prompt, node.model, node.kind) == (
                stored[origin]["prompt"],
                stored[origin]["model"],
                stored[origin]["kind"],
            )
    eng_a = _nodes_by_origin(a.team_graph_id)[eng["id"]]
    eng_b = _nodes_by_origin(b.team_graph_id)[eng["id"]]
    assert eng_b.prompt == V2_PROMPT and eng_b.model == V2_MODEL
    assert eng_a.prompt != eng_b.prompt and eng_a.model != eng_b.model

    # The run payloads say which compare (and side) a run belongs to.
    one = client.get(f"/api/runs/{a.id}").json()["run"]
    assert one["compare"] == {"id": body["id"], "label": "A", "version": 1}
    listed = client.get("/api/runs", params={"team_id": team}).json()["runs"]
    assert {r["run_id"]: r["compare"] for r in listed}[str(b.id)] == {
        "id": body["id"],
        "label": "B",
        "version": 2,
    }
    # The page opens the newest compare; a second one is refused while it runs.
    assert client.get(f"/api/teams/{team}/compare").json()["latest"] == {
        "id": body["id"],
        "status": "running",
    }
    again, _, _ = _post(client, team, monkeypatch)
    assert again.status_code == 409, again.text
    _end(runs)


def _end(runs) -> None:
    """Leave no run of a test in flight (their workflows never started)."""
    ids = [r.id if isinstance(r, Run) else uuid.UUID(r) for r in runs]
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.id.in_(ids), Run.status.in_(("running", "awaiting_human")))
            .values(status="cancelled")
        )


def test_validation_422s(client, monkeypatch):
    team = _two_versions(client)
    for body in ({"a": 2, "b": 2}, {"a": 1, "b": 9}, {"task": "   "}):
        resp, started, _ = _post(client, team, monkeypatch, **body)
        assert resp.status_code == 422, (body, resp.text)
        assert started == []
    # The launch pre-flight on each side: a version whose model this account holds no key for.
    eng = _node(client, team, "engineer")
    client.patch(
        f"/api/teams/{team}/nodes/{eng['id']}", json={"model": "anthropic/claude-sonnet-4"}
    )
    assert client.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v3
    resp, started, _ = _post(client, team, monkeypatch, a=2, b=3)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["missing_providers"] == ["anthropic"]
    assert started == []
    with session_scope() as session:
        assert (
            session.execute(
                select(Compare.id).where(Compare.team_graph_id == uuid.UUID(team))
            ).all()
            == []
        )


# ----------------------------------------------------------------------- the walk (real run_team)


class _Adapter:
    """Thinkers write their report; the Engineer writes a file. The Reviewer is forced (approves
    round 1) by ``TVASHTR_FORCE_REVISIONS=0`` before any adapter is asked."""

    name = "openhands"

    def run(self, task, on_event=None):  # noqa: ARG002
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        Path(task.workspace_dir).joinpath("rsi.py").write_text("def rsi(): ...\n")
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=["rsi.py"])


def _walk_fakes(monkeypatch, tmp_path) -> list[str]:
    monkeypatch.delenv("TVASHTR_AUTO_APPROVE_GATES", raising=False)
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "0")

    def _setup(run_id):
        ws = tmp_path / run_id
        if not ws.exists():
            ws.mkdir()
            init_workspace_repo(str(ws))
            team_run._write_workspace_gitignore(str(ws))
        return str(ws)

    monkeypatch.setattr(team_run, "engineer_setup_step", _setup)
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _Adapter())
    shipped: list[str] = []
    for name in ("ship_step", "push_and_open_pr_step", "store_ship_bundle_step"):
        monkeypatch.setattr(team_run, name, lambda *a, _n=name, **k: shipped.append(_n))
    return shipped


def _drive(run_id) -> dict:
    with SetWorkflowID(str(run_id)):
        return DBOS.start_workflow(team_run.run_team, TASK).get_result()


def test_a_compare_run_skips_ship_and_approves_its_gate(client, monkeypatch, tmp_path):
    team = _two_versions(client)
    resp, _, _ = _post(client, team, monkeypatch)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    shipped = _walk_fakes(monkeypatch, tmp_path)

    for run in _runs_of(cid):
        result = _drive(run.id)
        assert result["status"] == "completed", result
        assert result["pr_url"] is None
    assert shipped == []  # no ship, push or bundle step was called

    for run in _runs_of(cid):
        assert (run.status, run.pr_url, run.ship_commit_sha) == ("completed", None, None)
        with session_scope() as session:
            gate = session.execute(
                select(HumanTask).where(HumanTask.run_id == str(run.id))
            ).scalar_one()
            assert (gate.resolution, gate.resolution_note) == ("approved", "auto-approved")
            ship = session.execute(
                select(AgentInvocation)
                .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
                .where(AgentInvocation.run_id == str(run.id), AgentNode.role_name == "ship")
            ).scalar_one()
            assert (ship.status, ship.outcome) == ("done", "compare")
        act = client.get(f"/api/runs/{run.id}/activity").json()
        assert act["lines"][-1]["text"] == "Finished · no pull request in a compare"
        assert act["lines"][-1]["kind"] == "done"

    view = client.get(f"/api/compares/{cid}").json()
    assert view["status"] == "finished" and view["ended_at"] is not None
    assert [s["status"] for s in view["sides"]] == ["finished", "finished"]
    rows = {r["key"]: r for r in view["results"]["rows"]}
    assert rows["result"]["a"] == rows["result"]["b"] == "Approved in round 1"
    # Only the agent's rsi.py: the greenfield workspace's own .gitignore (in the checkpoint's diff)
    # is Tvashtr's setup, not the run's work.
    assert rows["files"]["a"] == rows["files"]["b"] == "1"
    assert view["results"]["headline"] == "v1 and v2 did about the same"


def test_a_pre_m8_recorded_graph_still_ships(client, monkeypatch, tmp_path):
    """Replay safety: a workflow recorded before M8 replays a ``load_graph_step`` dict with no
    ``compare`` key — its walk is the one it recorded, Ship included."""
    team = _two_versions(client)
    resp, _, _ = _post(client, team, monkeypatch)
    run = _runs_of(resp.json()["id"])[0]
    shipped = _walk_fakes(monkeypatch, tmp_path)
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    recorded = team_run.load_graph_step

    def _pre_m8(run_id):
        graph = recorded(run_id)
        assert graph["compare"] == {"auto_approve": True}
        return {k: v for k, v in graph.items() if k != "compare"}

    monkeypatch.setattr(team_run, "load_graph_step", _pre_m8)

    def _ship(*args, **kwargs):  # noqa: ARG001
        shipped.append("ship_step")
        return {"sha": "s", "tag": "t"}

    monkeypatch.setattr(team_run, "ship_step", _ship)
    result = _drive(run.id)
    assert result["status"] == "completed", result
    assert shipped[0] == "ship_step"
    _end(_runs_of(resp.json()["id"]))


def test_a_hosted_compare_runs_summary_names_no_branch(client):
    """A hosted compare run has a ship branch from its setup, never pushed: its finished summary
    names no branch (and no pull request)."""
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner, status="finished")
    run_id, clone = make_run(
        owner,
        team,
        status="completed",
        pair_id=uuid.UUID(cid),
        pair_label="A",
        github_repo="lazyxgenius/trade_mcp",
        base_ref="main",
        ship_branch="tvashtr/compare-side",
    )
    now = datetime.now(UTC)
    with session_scope() as session:
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(clone_node(clone, "ship")),
                iteration=1,
                status="done",
                outcome="compare",
                started_at=now,
                ended_at=now,
            )
        )
    act = client.get(f"/api/runs/{run_id}/activity").json()
    assert act["lines"][-1]["text"] == "Finished · no pull request in a compare"
    summary = act["summary"]
    assert (summary["branch"], summary["pr_url"], summary["pr_number"]) == (None, None, None)
    assert summary["base_ref"] == "main"


def test_only_a_compare_with_auto_approve_answers_its_gates(client, monkeypatch):
    monkeypatch.delenv("TVASHTR_AUTO_APPROVE_GATES", raising=False)
    owner = auth_user_id()
    team = library_team(client)
    on = _seed_compare(team, owner, status="finished", auto_approve=True)
    off = _seed_compare(team, owner, status="finished", auto_approve=False)
    run_on = make_run(owner, team, pair_id=uuid.UUID(on), pair_label="A")[0]
    run_off = make_run(owner, team, pair_id=uuid.UUID(off), pair_label="A")[0]
    plain = make_run(owner, team)[0]
    ab = make_run(owner, None, pair_id=uuid.uuid4(), pair_label="A")[0]  # an A/B pair: no compare

    assert gates.gate_auto_resolution_step(run_on, f"gate:{run_on}:n") == "approved"
    assert gates.gate_auto_resolution_step(run_on, f"budget:{run_on}:n:1") is None
    for run in (run_off, plain, ab):
        assert gates.gate_auto_resolution_step(run, f"gate:{run}:n") is None

    assert team_run.load_graph_step(run_on)["compare"] == {"auto_approve": True}
    assert team_run.load_graph_step(run_off)["compare"] == {"auto_approve": False}
    assert team_run.load_graph_step(plain)["compare"] is None
    assert team_run.load_graph_step(ab)["compare"] is None
    _end([run_on, run_off, plain, ab])


def test_a_compare_run_cannot_be_resumed(client):
    """A resumed compare run would be an ordinary run (it would ship, wait on gates and distil
    memory): Resume is refused for a failed side and a stopped one; their callouts offer none."""
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner, status="finished")
    reason = "A compare run can’t be picked up again. Start a new compare instead."
    for label, status, step, pinned_kind in (
        ("A", "failed", "failed", "failed"),
        ("B", "cancelled", "running", "stopped"),
    ):
        run_id, clone = make_run(
            owner, team, status=status, pair_id=uuid.UUID(cid), pair_label=label
        )
        add_invocation(run_id, clone_node(clone, "pm"), step)  # the first step: a fresh start
        with session_scope() as session:
            inv = session.execute(
                select(AgentInvocation.id).where(AgentInvocation.run_id == run_id)
            ).scalar_one()
        reply = client.get(f"/api/runs/{run_id}/resume").json()
        assert (reply["available"], reply["reason"]) == (False, reason), reply
        resp = client.post(f"/api/runs/{run_id}/resume", json={"invocation_id": inv})
        assert (resp.status_code, resp.json()["detail"]) == (409, reason)
        pinned = client.get(f"/api/runs/{run_id}/activity").json()["pinned"]
        assert (pinned["kind"], pinned["resume"]) == (pinned_kind, None)


# ------------------------------------------------------------------------------------ the queue


def test_a_compare_waits_for_two_free_slots(client, monkeypatch):
    settings = get_settings()
    c, owner = fresh_account("cmp-queue")
    _seed_dummy_credentials(str(owner))
    name = f"Queue {uuid.uuid4().hex[:8]}"
    team = _two_versions(c, name)
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 2)
    busy = make_run(owner, None, status="running")[0]

    resp, started, waiters = _post(c, team, monkeypatch)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    try:
        assert resp.json()["status"] == "waiting"
        assert [r["run_id"] for r in resp.json()["runs"]] == [None, None]
        assert started == [] and waiters == [cid] and _runs_of(cid) == []
        view = c.get(f"/api/compares/{cid}").json()
        assert view["status"] == "waiting"
        assert view["waiting"] == {"in_use": 1, "limit": 2}
        assert [s["status"] for s in view["sides"]] == ["waiting", "waiting"]
        assert view["results"] is None
        assert _snapshots(name) == 0  # the pre-flight's snapshots don't linger while it waits

        assert compare.try_start(uuid.UUID(cid)) is False  # still full
        with session_scope() as session:
            session.execute(update(Run).where(Run.workflow_id == busy).values(status="completed"))
        recorded: list = []
        with monkeypatch.context() as m:
            m.setattr(DBOS, "start_workflow", lambda *a, **k: recorded.append(a))
            assert compare.try_start(uuid.UUID(cid)) is True
        runs = _runs_of(cid)
        assert [(r.pair_label, r.team_version_number) for r in runs] == [("A", 1), ("B", 2)]
        assert len(recorded) == 2 and _snapshots(name) == 2
        assert compare.try_start(uuid.UUID(cid)) is None  # no longer waiting
        assert c.get(f"/api/compares/{cid}").json()["status"] == "running"
    finally:
        _end(_runs_of(cid))
        c.post(f"/api/compares/{cid}/stop")


def test_stop_while_waiting_and_waiters_re_arm_at_startup(client, monkeypatch):
    settings = get_settings()
    c, owner = fresh_account("cmp-stop")
    _seed_dummy_credentials(str(owner))
    team = _two_versions(c)
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 1)
    resp, _, _ = _post(c, team, monkeypatch)
    cid = resp.json()["id"]
    assert resp.json()["status"] == "waiting"

    armed: list = []
    monkeypatch.setattr(compare, "_spawn", armed.append)
    compare.rearm()
    assert uuid.UUID(cid) in [uuid.UUID(str(x)) for x in armed]

    assert c.post(f"/api/compares/{cid}/stop").json() == {"status": "stopped"}
    assert c.post(f"/api/compares/{cid}/stop").json() == {"status": "stopped"}  # idempotent
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 10)
    assert compare.try_start(uuid.UUID(cid)) is None and _runs_of(cid) == []
    view = c.get(f"/api/compares/{cid}").json()
    assert view["status"] == "stopped" and view["results"]["headline"] == "You stopped this compare"
    armed.clear()
    compare.rearm()
    assert uuid.UUID(cid) not in [uuid.UUID(str(x)) for x in armed]


def test_deleting_the_team_stops_its_waiting_compare_first(client, monkeypatch):
    """The delete cancels the team's runs (freeing slots) before it deletes the team: a waiter
    waking in between must start nothing — the compare is stopped before any run is cancelled."""
    from tvashtr.control_plane import teams

    settings = get_settings()
    c, owner = fresh_account("cmp-del")
    _seed_dummy_credentials(str(owner))
    team = _two_versions(c, f"Delete {uuid.uuid4().hex[:8]}")
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 2)
    make_run(owner, team, status="running")  # the team's own run holds a slot
    resp, _, _ = _post(c, team, monkeypatch)
    cid = resp.json()["id"]
    assert resp.json()["status"] == "waiting"

    real_cancel, woke = teams.cancel_run_core, []

    def _cancel(run_id):
        real_cancel(run_id)
        woke.append(compare.try_start(uuid.UUID(cid)))  # the waiter wakes to a free slot

    monkeypatch.setattr(teams, "cancel_run_core", _cancel)
    monkeypatch.setattr(teams.DBOS, "cancel_workflow", lambda wid: None)
    monkeypatch.setattr(DBOS, "start_workflow", lambda *a, **k: None)
    try:
        assert c.delete(f"/api/teams/{team}").status_code == 200
        assert woke == [None] and _runs_of(cid) == []
    finally:
        _end(_runs_of(cid))


def test_stop_while_running_stops_both_runs(client, monkeypatch):
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    runs = [
        make_run(owner, team, pair_id=uuid.UUID(cid), pair_label=label, team_version_number=n)[0]
        for label, n in (("A", 1), ("B", 2))
    ]
    cancelled: list[str] = []
    from tvashtr.control_plane import teams

    monkeypatch.setattr(teams.DBOS, "cancel_workflow", cancelled.append)
    assert client.post(f"/api/compares/{cid}/stop").json() == {"status": "stopped"}
    assert sorted(cancelled) == sorted(runs)
    with session_scope() as session:
        statuses = session.execute(select(Run.status).where(Run.workflow_id.in_(runs))).scalars()
        assert set(statuses) == {"cancelled"}
    view = client.get(f"/api/compares/{cid}").json()
    assert view["status"] == "stopped"
    assert [s["status"] for s in view["sides"]] == ["stopped", "stopped"]
    assert view["results"]["headline"] == "You stopped this compare"
    rows = {r["key"]: r for r in view["results"]["rows"]}
    assert rows["result"]["a"] == rows["result"]["b"] == "Stopped"
    assert all(r["better"] is None for r in view["results"]["rows"])


# ---------------------------------------------------------------------------------- the results


def _side(
    owner,
    team: str,
    cid: str,
    label: str,
    version: int,
    *,
    status="completed",
    rounds=1,
    approved=True,
    cost="1.00",
    seconds=1800,
    retries=0,
    stalls=0,
    files=1,
    failure=None,
) -> str:
    now = datetime.now(UTC)
    run_id, clone = make_run(
        owner,
        team,
        status=status,
        pair_id=uuid.UUID(cid),
        pair_label=label,
        team_version_number=version,
        created_at=now - timedelta(seconds=seconds),
        failure_message=failure,
        failure_code="engine_error" if failure else None,
    )
    eng, rev = clone_node(clone, "engineer"), clone_node(clone, "reviewer")
    with session_scope() as session:
        last = None
        for n in range(1, rounds + 1):
            for node, outcome in (
                (eng, None),
                (rev, "approved" if approved and n == rounds else "changes_requested"),
            ):
                inv = AgentInvocation(
                    run_id=run_id,
                    node_id=uuid.UUID(node),
                    iteration=n,
                    status="done",
                    outcome=outcome,
                    started_at=now - timedelta(seconds=10),
                    ended_at=now,
                )
                session.add(inv)
                session.flush()
                last = last or inv.id
        if files:
            diff = "".join(f"diff --git a/f{k}.py b/f{k}.py\n+x\n" for k in range(files))
            session.add(
                RunCheckpoint(
                    run_id=uuid.UUID(run_id),
                    invocation_id=last,
                    node_id=uuid.UUID(eng),
                    iteration=1,
                    base_sha="b" * 40,
                    diff=diff.encode(),
                )
            )
    add_cost(run_id, cost)
    for kind, count in (("retry", retries), ("stalled", stalls)):
        for _ in range(count):
            live_state.record_host_event(
                run_id, last, kind, {"attempt": 1, "of": 3, "reason": "busy", "wait_s": 8}
            )
    return run_id


def _agent_tests(owner, team: str, results: dict[int, tuple[int, int]]) -> None:
    """The Reviewer has tests; ``results`` maps a version to (passed, total) of its newest run."""
    with session_scope() as session:
        reviewer = session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == uuid.UUID(team), AgentNode.role_name == "reviewer"
            )
        ).scalar_one()
        test = AgentTest(
            owner_id=owner,
            team_id=uuid.UUID(team),
            node_id=reviewer,
            name="t",
            source="file",
            inputs={},
            checks=[],
        )
        session.add(test)
        for number, (passed, total) in results.items():
            run = AgentTestRun(
                owner_id=owner,
                team_id=uuid.UUID(team),
                node_id=reviewer,
                version_number=number,
                status="done",
                total=total,
            )
            session.add(run)
            session.flush()
            for k in range(total):
                session.add(
                    AgentTestResult(
                        test_run_id=run.id,
                        position=k,
                        name=f"t{k}",
                        status="passed" if k < passed else "failed",
                    )
                )


def _results(c, cid: str) -> dict:
    view = c.get(f"/api/compares/{cid}")
    assert view.status_code == 200, view.text
    return view.json()


def test_results_mark_the_better_values_and_say_which_did_better(client):
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    _side(owner, team, cid, "A", 1, rounds=4, cost="1.48", seconds=1872, retries=2, files=2)
    _side(owner, team, cid, "B", 2, rounds=2, cost="0.92", seconds=962, files=2)
    _agent_tests(owner, team, {1: (4, 6), 2: (5, 6)})

    view = _results(client, cid)
    assert view["status"] == "finished"
    assert view["cost_usd"] == pytest.approx(2.40)
    res = view["results"]
    rows = {r["key"]: r for r in res["rows"]}
    assert [r["key"] for r in res["rows"]] == [
        "result",
        "cost",
        "time",
        "repo_tests",
        "agent_tests",
        "retries",
        "files",
    ]
    assert rows["result"] | {} == {
        "key": "result",
        "label": "Result",
        "a": "Approved in round 4",
        "b": "Approved in round 2",
        "better": "b",
        "difference": "2 fewer rounds",
    }
    assert (rows["cost"]["a"], rows["cost"]["b"], rows["cost"]["better"]) == (
        "$1.48",
        "$0.92",
        "b",
    )
    assert rows["cost"]["difference"] == "−$0.56"
    assert (rows["time"]["a"], rows["time"]["b"]) == ("31m 12s", "16m 02s")
    assert (rows["time"]["better"], rows["time"]["difference"]) == ("b", "−15m")
    assert rows["repo_tests"] | {} == {
        "key": "repo_tests",
        "label": "Repo tests passing",
        "a": "—",
        "b": "—",
        "better": None,
        "difference": "",
    }
    assert rows["agent_tests"]["label"] == "Reviewer’s tests"
    assert (rows["agent_tests"]["a"], rows["agent_tests"]["b"]) == ("4 of 6", "5 of 6")
    assert (rows["agent_tests"]["better"], rows["agent_tests"]["difference"]) == ("b", "+1")
    assert (rows["retries"]["a"], rows["retries"]["b"], rows["retries"]["better"]) == (
        "2 retries",
        "none",
        "b",
    )
    assert (rows["files"]["a"], rows["files"]["b"], rows["files"]["better"]) == ("2", "2", None)
    assert res["headline"] == "v2 did better on this task"
    assert res["current_version"] == 2 and res["restore"] is None
    assert [s["current"] for s in view["sides"]] == [
        {"label": "Approved", "text": "in round 4"},
        {"label": "Approved", "text": "in round 2"},
    ]
    assert all(len(s["lines"]) <= 4 and s["strip"] for s in view["sides"])


def test_the_older_version_doing_better_offers_restore_and_ties_say_so(client):
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    _side(owner, team, cid, "A", 1, rounds=1, cost="0.50", seconds=600, files=1)
    _side(owner, team, cid, "B", 2, rounds=3, cost="0.90", seconds=1500, stalls=1, files=1)
    res = _results(client, cid)["results"]
    assert res["headline"] == "v1 did better on this task" and res["restore"] == 1
    rows = {r["key"]: r for r in res["rows"]}
    assert rows["result"]["difference"] == "2 more rounds"
    assert rows["retries"]["b"] == "1 stall" and rows["retries"]["better"] == "a"
    assert "agent_tests" not in rows  # no agent of this team has tests

    team2 = _two_versions(client)
    tie = _seed_compare(team2, owner)
    for label, version in (("A", 1), ("B", 2)):
        _side(owner, team2, tie, label, version, rounds=2, cost="1.00", seconds=1200)
    tied = _results(client, tie)["results"]
    assert tied["headline"] == "v1 and v2 did about the same" and tied["restore"] is None
    assert {r["key"]: r["difference"] for r in tied["rows"]}["cost"] == "same"


@pytest.mark.parametrize("approved_side", ["A", "B"])
def test_an_approved_side_beats_an_unapproved_one_whatever_the_rounds(client, approved_side):
    """Approval first: "Approved in round 4" beats "Finished in round 2" (a reviewer that never
    approved); rounds count only between two sides in the same state."""
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    for label, version in (("A", 1), ("B", 2)):
        ok = label == approved_side
        _side(owner, team, cid, label, version, rounds=4 if ok else 2, approved=ok)
    row = {r["key"]: r for r in _results(client, cid)["results"]["rows"]}["result"]
    words = {"A": row["a"], "B": row["b"]}
    other = "B" if approved_side == "A" else "A"
    assert (words[approved_side], words[other]) == ("Approved in round 4", "Finished in round 2")
    assert (row["better"], row["difference"]) == (approved_side.lower(), "")


def test_one_side_failed(client):
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    _side(owner, team, cid, "A", 1, rounds=2, cost="1.10", seconds=900)
    _side(
        owner,
        team,
        cid,
        "B",
        2,
        status="failed",
        rounds=1,
        approved=False,
        cost="0.40",
        seconds=300,
        failure="The Engineer stopped responding: no update for 20 minutes",
    )
    view = _results(client, cid)
    assert [s["status"] for s in view["sides"]] == ["finished", "failed"]
    res = view["results"]
    assert res["headline"] == "v1 finished; v2 failed on this task"
    rows = {r["key"]: r for r in res["rows"]}
    assert rows["result"]["b"] == (
        "Failed: The Engineer stopped responding: no update for 20 minutes"
    )
    assert all(r["better"] is None for r in res["rows"]) and res["restore"] is None


def test_a_running_compare_shows_each_lane(client):
    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    a = _side(owner, team, cid, "A", 1, status="running", rounds=1, approved=False)
    _side(owner, team, cid, "B", 2, status="awaiting_human", rounds=1, approved=False)
    view = _results(client, cid)
    assert view["status"] == "running" and view["results"] is None and view["waiting"] is None
    assert [s["status"] for s in view["sides"]] == ["running", "needs_you"]
    assert view["sides"][0]["run_id"] == a and view["sides"][0]["number"] >= 1
    assert view["elapsed_s"] >= 2399
    _end(_runs_of(cid))


# --------------------------------------------------------------------------------- owner scope


def test_compare_routes_are_owner_scoped(client, monkeypatch):
    team = _two_versions(client)
    cid = _seed_compare(team, auth_user_id(), status="finished")
    b, _ = fresh_account("cmp-b")
    for method, path in (
        ("get", f"/api/teams/{team}/compare"),
        ("get", f"/api/teams/{team}/compare/changes?a=1&b=2"),
        ("post", f"/api/teams/{team}/compare"),
        ("get", f"/api/compares/{cid}"),
        ("post", f"/api/compares/{cid}/stop"),
        ("get", f"/api/compares/{uuid.uuid4()}"),
        ("get", "/api/compares/not-a-uuid"),
    ):
        resp = (
            b.post(path, json={"a": 1, "b": 2, "task": TASK}) if method == "post" else b.get(path)
        )
        assert resp.status_code == 404, (path, resp.status_code, resp.text)
    with session_scope() as session:
        assert session.get(Compare, uuid.UUID(cid)).status == "finished"  # B changed nothing
        assert versions.latest(session, session.get(TeamGraph, uuid.UUID(team))).number == 2
