"""M10 — Start a new run from this one (ruling R9; contract
``docs/superpowers/plans/api/start-from-run.md``).

A finished run on a GitHub repo starts the next one: the person picks what comes along (the final
spec, their decisions, the confirmed memories, a short summary from each agent — never the agents'
conversations) and where it starts (the run's pull request branch while it is open, else the repo's
default branch). The new run is created through ``POST /api/runs``'s own path, on the team as it is
now, with a snapshot of what came along (``runs.carry``) that enters every agent's compiled context
as named parts. The run log downloads with every secret masked.

The walk tests drive the REAL ``run_team`` with a fake adapter that captures every task handed to
an agent (no LLM, no openhands); GitHub is faked at the ``github_app`` seam."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from conftest import auth_user_id, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from home_fixtures import clone_node, fresh_account, library_team, make_run
from sqlalchemy import select, text, update
from test_compare import _end, _walk_fakes

from tvashtr import routers
from tvashtr.config import get_settings
from tvashtr.control_plane import context_compiler, github_app, resume, team_run
from tvashtr.control_plane.context_compiler import compile_context
from tvashtr.control_plane.credentials import encrypt_secret
from tvashtr.db import session_scope
from tvashtr.documents.service import add_version, create_document_with_initial_version
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    GithubInstallation,
    HumanTask,
    NodeMemory,
    ProviderCredential,
    Run,
    RunEvent,
    TeamGraph,
)

REPO = "acme/indicators"
TASK = "Add a MACD indicator next to RSI"
NOTE = "Keep the RSI period at 14"
_T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


# ------------------------------------------------------------------------------------ helpers


def _at(minutes: float) -> datetime:
    return _T0 + timedelta(minutes=minutes)


def _hosted(monkeypatch, *, merged: bool | None = False, default: str = "main") -> None:
    """Hosted mode with the shared account's GitHub installation holding ``REPO``; GitHub says
    whether the pull request was merged (``None``: GitHub can't be reached)."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    with session_scope() as session:
        session.add(
            GithubInstallation(
                owner_id=auth_user_id(), installation_id=uuid.uuid4().int % 2_000_000_000
            )
        )
    repos = [{"full_name": REPO, "default_branch": default, "private": True}]
    monkeypatch.setattr(github_app, "list_installation_repositories", lambda _inst: repos)

    def _merged(_inst, full_name, number):
        assert (full_name, number) == (REPO, 42)
        if merged is None:
            raise github_app.GithubAppError("GitHub GET /repos -> HTTP 502", status=502)
        return merged

    monkeypatch.setattr(github_app, "pull_request_merged", _merged)
    branches = [{"name": default, "sha": "a1"}, {"name": "tvashtr/run-12", "sha": "b2"}]
    monkeypatch.setattr(github_app, "list_branches", lambda _i, _r: (branches, False))


def _old_run(client, *, status: str = "completed", **extra) -> tuple[str, str, str]:
    """A finished hosted run of a library team with everything that can come along, and the
    agents' conversations (events) that must never come along. ``(run_id, team, clone)``."""
    team = library_team(client)
    assert client.get(f"/api/teams/{team}/versions").status_code == 200  # v1
    values = dict(
        github_repo=REPO,
        base_ref="main",
        pr_url=f"https://github.com/{REPO}/pull/42",
        ship_branch="tvashtr/run-12",
        created_at=_at(0),
    )
    values.update(extra)
    run_id, clone = make_run(auth_user_id(), team, status=status, idea="Add RSI", **values)
    doc = create_document_with_initial_version(
        "Mini-PRD", "prd", "SPEC v1", "agent:entry", f"{run_id}:spec:1", run_id=uuid.UUID(run_id)
    )
    add_version(doc.id, "SPEC v2", "agent:entry", f"{run_id}:spec:2")
    add_version(doc.id, "FINAL SPEC: RSI in core/indicators.py", "human", f"{run_id}:spec:3")
    pm, gate = clone_node(clone, "pm"), clone_node(clone, "prd_gate")
    eng, rev = clone_node(clone, "engineer"), clone_node(clone, "reviewer")
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=doc.id)
        )
        for k, (node, iteration, detail, outcome) in enumerate(
            (
                (pm, 1, "Drafted the spec from the idea.", "prd_written"),
                (eng, 1, "Built the feature — changed 1 file(s): core/indicators.py", "built"),
                (rev, 1, "['Add a test for the period']", "changes_requested"),
                (
                    eng,
                    2,
                    "Built the feature — changed 2 file(s): core/indicators.py, t.py",
                    "built",
                ),
                (rev, 2, None, "approved"),
            )
        ):
            session.add(
                AgentInvocation(
                    run_id=run_id,
                    node_id=uuid.UUID(node),
                    iteration=iteration,
                    status="done",
                    outcome=outcome,
                    outcome_detail=detail,
                    started_at=_at(1 + k),
                    ended_at=_at(1.5 + k),
                )
            )
        for k, (kind, resolution, note) in enumerate(
            (
                ("prd_approval", "approved", NOTE),  # a person approved, with a note
                ("ship_approval", "approved", "auto-approved"),  # automatic: never carried
                ("review_escalation", "cancelled", None),  # the run was stopped under it
            )
        ):
            session.add(
                HumanTask(
                    run_id=run_id,
                    kind=kind,
                    priority="high_blocker",
                    blocking=True,
                    topic=f"gate:{run_id}:{gate}:{k}",
                    title="t",
                    description="d",
                    status="resolved",
                    resolution=resolution,
                    resolution_note=note,
                    created_at=_at(2 + k),
                    resolved_at=_at(2.2 + k),
                )
            )
        repo_key = f"m10-test-{uuid.uuid4().hex}"  # matches no run: never injected as memory
        for k, (content, status, source) in enumerate(
            (
                ("Register every indicator on INDICATORS", "active", run_id),
                ("Indicators return a pandas Series", "active", run_id),
                ("Never touch core/legacy.py", "active", run_id),
                ("A lesson still waiting for review", "pending_review", run_id),
                ("A lesson from another run", "active", str(uuid.uuid4())),
            )
        ):
            session.add(
                NodeMemory(
                    owner_id=auth_user_id(),
                    repo_key=repo_key,
                    content=content,
                    polarity="require",
                    status=status,
                    source_run_id=source,
                    created_at=_at(10 + k),
                )
            )
    return run_id, team, clone


_CONVO = {
    "message": f"AGENT-SAID-{uuid.uuid4().hex}",
    "observation": f"TOOL-OUTPUT-{uuid.uuid4().hex}",
    "thought": f"MODEL-THOUGHT-{uuid.uuid4().hex}",
}


def _converse(run_id: str) -> None:
    """The old run's conversation: an agent message, a tool's output, a model thought."""
    with session_scope() as session:
        inv = session.execute(
            select(AgentInvocation.id).where(AgentInvocation.run_id == run_id).limit(1)
        ).scalar_one()
        for seq, (kind, payload) in enumerate(
            (
                ("message", {"source": "agent", "text": _CONVO["message"]}),
                (
                    "action",
                    {
                        "tool_name": "terminal",
                        "thought": _CONVO["thought"],
                        "action": f"command='cat notes' x='{_CONVO['thought']}'",
                    },
                ),
                ("observation", {"tool_name": "terminal", "observation": _CONVO["observation"]}),
            )
        ):
            session.add(
                RunEvent(
                    run_id=run_id,
                    invocation_id=inv,
                    seq=seq,
                    kind=kind,
                    payload=payload,
                    created_at=_at(1.1 + seq / 100),
                )
            )


def _post(client, run_id: str, monkeypatch, **body) -> tuple:
    """POST /next with ``DBOS.start_workflow`` recorded (no workflow really starts)."""
    started: list[str] = []
    from dbos._context import get_local_dbos_context

    def _start(fn, *args, **kwargs):  # noqa: ARG001
        ctx = get_local_dbos_context()
        started.append(ctx.id_assigned_for_next_workflow if ctx else None)

    payload = {
        "task": TASK,
        "carry": {"spec": True, "decisions": True, "memories": True, "summaries": True},
        "start_from": "pr",
        **body,
    }
    with monkeypatch.context() as m:
        m.setattr(routers.DBOS, "start_workflow", _start)
        resp = client.post(f"/api/runs/{run_id}/next", json=payload)
    return resp, started


def _run(run_id: str) -> Run:
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(run_id))
        session.expunge(run)
    return run


def _number(run_id: str) -> int | None:
    with session_scope() as session:
        return resume.number(session, session.get(Run, uuid.UUID(run_id)))


def _children(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(text("count(*)"))
            .select_from(Run)
            .where(Run.started_from_run_id == uuid.UUID(run_id))
        ).scalar_one()


# ----------------------------------------------------------------------------------- migration


def test_migration_0051_adds_started_from_run_id_and_carry(client):
    with session_scope() as session:
        cols = dict(
            session.execute(
                text(
                    "select column_name, data_type from information_schema.columns "
                    "where table_name = 'runs' and column_name in ('started_from_run_id', 'carry')"
                )
            ).all()
        )
        rule = session.execute(
            text(
                "select rc.delete_rule from information_schema.referential_constraints rc "
                "join information_schema.key_column_usage k "
                "on k.constraint_name = rc.constraint_name "
                "where k.table_name = 'runs' and k.column_name = 'started_from_run_id'"
            )
        ).scalar_one()
        indexed = session.execute(
            text(
                "select count(*) from pg_indexes where tablename = 'runs' "
                "and indexdef like '%(started_from_run_id)%'"
            )
        ).scalar_one()
    assert cols == {"started_from_run_id": "uuid", "carry": "jsonb"}
    assert rule == "SET NULL" and indexed == 1


# ------------------------------------------------------------------------------- the dialog


def test_the_dialog_offers_what_can_come_along_and_where_to_start(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, team, _clone = _old_run(client)
    _converse(run_id)
    body = client.get(f"/api/runs/{run_id}/next").json()
    number = body["run"]["number"]
    assert body["available"] is True and body["reason"] is None
    assert body["run"] == {"id": run_id, "number": number, "idea": "Add RSI"}
    assert isinstance(number, int) and number >= 1
    assert body["spec"] == {"version": 3}
    # Only a person's decision (never an automatic approval, never a stopped gate), with the note.
    assert body["decisions"] == [{"title": "Spec approved", "text": NOTE}]
    assert [m["content"] for m in body["memories"]] == [
        "Register every indicator on INDICATORS",
        "Indicators return a pandas Series",
        "Never touch core/legacy.py",
    ]
    assert all(set(m) == {"id", "content"} for m in body["memories"])
    assert body["pending_memories"] == 1
    # Each agent's newest brief, in the run's step order.
    assert [s["text"] for s in body["summaries"]] == [
        "Drafted the spec from the idea.",
        "Built the feature — changed 2 file(s): core/indicators.py, t.py",
        "Approved",
    ]
    assert body["pr"] == {"number": 42, "branch": "tvashtr/run-12", "merged": False}
    assert body["start_from"] == [
        {"value": "pr", "label": "tvashtr/run-12 (pull request #42)"},
        {"value": "main", "label": "main"},
    ]
    assert body["default_start"] == "pr"
    assert body["team"] == {"id": team, "version": 1}
    # Never the agents' conversations.
    for words in _CONVO.values():
        assert words not in json.dumps(body)


def test_a_merged_or_unknown_pull_request_offers_only_the_default_branch(client, monkeypatch):
    for merged in (True, None):  # merged, or GitHub can't say (unknown ⇒ not merged)
        _hosted(monkeypatch, merged=merged, default="trunk")
        run_id, _team, _clone = _old_run(client)
        body = client.get(f"/api/runs/{run_id}/next").json()
        assert body["pr"] == {"number": 42, "branch": "tvashtr/run-12", "merged": merged is True}
        if merged:
            assert body["start_from"] == [{"value": "main", "label": "trunk"}]
            assert body["default_start"] == "main"
            resp, started = _post(client, run_id, monkeypatch, start_from="pr")
            assert resp.status_code == 422, resp.text
            assert started == [] and _children(run_id) == 0
        else:
            assert body["default_start"] == "pr"


def test_who_can_start_one(client, monkeypatch):
    _hosted(monkeypatch)
    failed, _, _ = _old_run(client, status="failed")
    no_repo, _, _ = _old_run(client, github_repo=None)
    compared, _, _ = _old_run(client)
    gone, _, _ = _old_run(client)
    with session_scope() as session:
        # A compare (or A/B) run has a pair; a deleted team leaves library_team_id NULL.
        session.execute(
            update(Run).where(Run.id == uuid.UUID(compared)).values(pair_id=uuid.uuid4())
        )
        session.execute(update(Run).where(Run.id == uuid.UUID(gone)).values(library_team_id=None))
    for run_id in (failed, no_repo, compared, gone):
        body = client.get(f"/api/runs/{run_id}/next").json()
        assert body["available"] is False and body["reason"], (run_id, body)
        assert body["start_from"] == [] and body["team"] is None
        resp, started = _post(client, run_id, monkeypatch)
        assert resp.status_code == 422, resp.text
        assert started == [] and _children(run_id) == 0


# ------------------------------------------------------------------------------- starting it


def test_the_next_run_starts_on_the_pr_branch_with_the_carry_snapshot(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, team, _clone = _old_run(client)
    _converse(run_id)
    # A change since v1: the run uses the team as it is now, saved as v2 first (R3).
    eng = next(
        n
        for n in client.get(f"/api/teams/{team}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )
    assert (
        client.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "NOW"}).status_code
        == 200
    )
    assert client.get(f"/api/runs/{run_id}/next").json()["team"]["version"] == 2

    resp, started = _post(
        client,
        run_id,
        monkeypatch,
        carry={"spec": True, "decisions": False, "memories": True, "summaries": True},
    )
    assert resp.status_code == 201, resp.text
    new_id = resp.json()["run_id"]
    assert started == [new_id]
    new = _run(new_id)
    old = _run(run_id)
    assert resp.json()["number"] == _number(new_id)
    assert (new.idea, new.github_repo, new.base_ref) == (TASK, REPO, "tvashtr/run-12")
    assert new.library_team_id == uuid.UUID(team) and new.team_version_number == 2
    assert new.started_from_run_id == old.id and new.status == "running"
    with session_scope() as session:
        prompt = session.execute(
            select(AgentNode.prompt).where(
                AgentNode.team_graph_id == new.team_graph_id, AgentNode.role_name == "engineer"
            )
        ).scalar_one()
    assert prompt == "NOW"
    carry = new.carry
    number = carry["from"]["number"]
    assert carry["from"] == {"run_id": run_id, "number": number}
    assert carry["spec"] == {"version": 3, "text": "FINAL SPEC: RSI in core/indicators.py"}
    assert carry["decisions"] == []  # unticked
    assert [m["content"] for m in carry["memories"]] == [
        "Register every indicator on INDICATORS",
        "Indicators return a pandas Series",
        "Never touch core/legacy.py",
    ]
    assert all(m["polarity"] == "require" for m in carry["memories"])
    assert [s["text"] for s in carry["summaries"]][0] == "Drafted the spec from the idea."
    assert carry["start_from"] == {"kind": "pr", "branch": "tvashtr/run-12", "pr_number": 42}
    for words in (*_CONVO.values(), "A lesson still waiting for review", "another run"):
        assert words not in json.dumps(carry)

    # The snapshot never changes when the old run does.
    with session_scope() as session:
        session.execute(
            update(NodeMemory)
            .where(NodeMemory.source_run_id == run_id)
            .values(content="EDITED LATER")
        )
    assert _run(new_id).carry == carry

    # "main": the repo's default branch.
    resp, _ = _post(client, run_id, monkeypatch, start_from="main")
    assert resp.status_code == 201, resp.text
    other = _run(resp.json()["run_id"])
    assert other.base_ref == "main"
    assert other.carry["start_from"] == {"kind": "main", "branch": "main", "pr_number": None}
    _end([new_id, str(other.id)])


def test_refusals_follow_post_api_runs(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, team, _clone = _old_run(client)
    for body in ({"task": "   "}, {"start_from": "elsewhere"}):
        resp, started = _post(client, run_id, monkeypatch, **body)
        assert resp.status_code == 422, (body, resp.text)
        assert started == []
    # The hosted ceilings: the same 429 body as POST /api/runs.
    monkeypatch.setattr(get_settings(), "hosted_max_concurrent_runs_per_owner", 0)
    resp, started = _post(client, run_id, monkeypatch)
    plain = client.post("/api/runs", json={"idea": TASK, "team_graph_id": team})
    assert resp.status_code == plain.status_code == 429, resp.text
    assert resp.json() == plain.json()
    monkeypatch.setattr(get_settings(), "hosted_max_concurrent_runs_per_owner", 10_000)
    # The launch pre-flight: a model this account holds no key for.
    eng = next(
        n
        for n in client.get(f"/api/teams/{team}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )
    client.patch(
        f"/api/teams/{team}/nodes/{eng['id']}", json={"model": "anthropic/claude-sonnet-4"}
    )
    resp, started = _post(client, run_id, monkeypatch)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["missing_providers"] == ["anthropic"]
    # The repo left the installation.
    client.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"model": eng["model"]})
    monkeypatch.setattr(github_app, "list_installation_repositories", lambda _inst: [])
    resp, started = _post(client, run_id, monkeypatch, start_from="main")
    assert resp.status_code == 422, resp.text
    assert started == [] and _children(run_id) == 0


# --------------------------------------------------------------------- what came along, after


def test_the_new_run_says_where_it_started_from(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, _team, _clone = _old_run(client)
    resp, _ = _post(client, run_id, monkeypatch)
    new_id = resp.json()["run_id"]
    number = _run(new_id).carry["from"]["number"]
    summary = "brought spec v3, 1 decision, 3 memories and 3 summaries"
    expected = {"run_id": run_id, "number": number, "summary": summary}
    assert client.get(f"/api/runs/{new_id}").json()["run"]["started_from"] == expected
    listed = {r["run_id"]: r for r in client.get("/api/runs").json()["runs"]}
    assert listed[new_id]["started_from"] == expected
    assert listed[run_id]["started_from"] is None

    came = client.get(f"/api/runs/{new_id}/carry").json()
    assert came["from"] == {"run_id": run_id, "number": number}
    assert came["spec"] == {"version": 3}
    assert came["decisions"] == [{"title": "Spec approved", "text": NOTE}]
    assert [set(m) for m in came["memories"]] == [{"id", "content"}] * 3
    assert [s["agent"] for s in came["summaries"]] == [
        s["agent"] for s in _run(new_id).carry["summaries"]
    ]
    assert set(came) == {"from", "spec", "decisions", "memories", "summaries"}
    assert client.get(f"/api/runs/{run_id}/carry").status_code == 404  # didn't start from one

    # Activity: the first line says where it started; the canvas card of the entry agent reads
    # the carried spec until the run writes its own.
    act = client.get(f"/api/runs/{new_id}/activity").json()
    first = act["lines"][0]
    assert first["kind"] == "started" and first["came_along"] is True
    assert first["text"] == f"Started from run #{number} · {summary}"
    assert act["lines"][1]["kind"] == "started" and "came_along" not in act["lines"][1]
    graph = client.get(f"/api/runs/{new_id}/graph").json()
    pm = next(n for n in graph["nodes"] if n["role_name"] == "pm")
    assert pm["carried"] == {
        "from_run_id": run_id,
        "number": number,
        "text": f"From spec v3 of run #{number}",
    }
    assert all(n["carried"] is None for n in graph["nodes"] if n["role_name"] != "pm")
    _end([new_id])


def test_the_entry_agents_first_step_reads_the_spec_and_memories_in_activity(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, _team, _clone = _old_run(client)
    resp, _ = _post(client, run_id, monkeypatch)
    new_id = resp.json()["run_id"]
    new = _run(new_id)
    number = new.carry["from"]["number"]
    with session_scope() as session:
        pm = session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == new.team_graph_id, AgentNode.role_name == "pm"
            )
        ).scalar_one()
        session.add(
            AgentInvocation(
                run_id=new_id,
                node_id=pm,
                iteration=1,
                status="running",
                started_at=datetime.now(UTC),
            )
        )
    lines = client.get(f"/api/runs/{new_id}/activity").json()["lines"]
    texts = [ln["text"] for ln in lines if ln["node_id"] == str(pm)]
    assert texts[:3] == [
        "Started",
        f"Read the spec from run #{number} (v3)",
        "Read 3 memories, including “Register every indicator on INDICATORS”",
    ]
    _end([new_id])


# ------------------------------------------------------------- the compiled context (the walk)


class _CapturingAdapter:
    """Every task handed to an agent is kept. Thinkers write their report; the Engineer a file;
    the Reviewer is forced to approve round 1."""

    name = "openhands"

    def __init__(self, seen: list) -> None:
        self.seen = seen

    def run(self, task, on_event=None):  # noqa: ARG002
        self.seen.append(task)
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        Path(task.workspace_dir).joinpath("macd.py").write_text("def macd(): ...\n")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["macd.py"]
        )


def _walk(monkeypatch, tmp_path, new_id: str, *, drop_carry: bool = False) -> tuple[list, list]:
    """Drive the new run's REAL walk; ``(tasks handed to agents, its invocation rows)``."""
    with session_scope() as session:  # the walk is greenfield here: no clone of a real repo
        session.execute(
            update(Run).where(Run.id == uuid.UUID(new_id)).values(github_repo=None, base_ref=None)
        )
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    monkeypatch.setattr(get_settings(), "agent_sandbox_mode", "local")
    _walk_fakes(monkeypatch, tmp_path)
    monkeypatch.setattr(team_run, "ship_step", lambda *a, **k: {"sha": "s", "tag": "t"})
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    seen: list = []
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _CapturingAdapter(seen))
    if drop_carry:
        recorded = team_run.load_graph_step

        def _pre_m10(run_id):
            graph = recorded(run_id)
            assert graph["carry"] is not None
            return {k: v for k, v in graph.items() if k != "carry"}

        monkeypatch.setattr(team_run, "load_graph_step", _pre_m10)
    with SetWorkflowID(new_id):
        result = DBOS.start_workflow(team_run.run_team, TASK).get_result()
    assert result["status"] == "completed", result
    with session_scope() as session:
        invs = session.execute(
            select(AgentInvocation, AgentNode.role_name)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id == new_id)
            .order_by(AgentInvocation.id)
        ).all()
        rows = [(inv.iteration, role, inv.context_manifest) for inv, role in invs]
    return seen, rows


def _parts(manifest: dict | None) -> list[str]:
    return [p["name"] for p in (manifest or {}).get("parts", [])]


def test_carried_items_reach_the_compiled_context_and_conversations_do_not(
    client, monkeypatch, tmp_path
):
    _hosted(monkeypatch)
    run_id, _team, _clone = _old_run(client)
    _converse(run_id)
    resp, _ = _post(client, run_id, monkeypatch)
    assert resp.status_code == 201, resp.text
    new_id = resp.json()["run_id"]
    number = _run(new_id).carry["from"]["number"]

    seen, rows = _walk(monkeypatch, tmp_path, new_id)
    assert len(seen) >= 2  # the PM, then the Engineer (the Reviewer is forced)
    entry, *rest = seen
    spec_header = f"--- STARTING SPEC (spec v3 of run #{number}; update it for the new task) ---"
    assert spec_header in entry.instruction
    assert "FINAL SPEC: RSI in core/indicators.py" in entry.instruction
    for task in seen:
        assert f"--- FROM RUN #{number}: THE PERSON'S DECISIONS ---" in task.instruction
        assert f"- Spec approved: {NOTE}" in task.instruction
        assert "- Register every indicator on INDICATORS" in task.instruction
        assert "Drafted the spec from the idea." in task.instruction
    for task in rest:
        assert "STARTING SPEC" not in task.instruction
    # Conversations never: no agent message, tool output or thought of the old run in ANY task.
    for task in seen:
        for words in _CONVO.values():
            assert words not in repr(task)

    agent_rows = [(it, role, m) for it, role, m in rows if m is not None]
    pm_rows = [(it, m) for it, role, m in agent_rows if role == "pm"]
    assert pm_rows and pm_rows[0][0] == 1
    own = [n for n in _parts(pm_rows[0][1]) if n != "memory"]  # the account's own lessons
    assert own[:6] == [
        "node_prompt",
        "idea",
        "carried_spec",
        "carried_decisions",
        "carried_memories",
        "carried_summaries",
    ]
    for _it, role, manifest in agent_rows:
        names = _parts(manifest)
        assert {"carried_decisions", "carried_memories", "carried_summaries"} <= set(names), role
        if role != "pm":
            assert "carried_spec" not in names
    _end([new_id])


def test_a_pre_m10_recorded_graph_replays_without_carried_parts(client, monkeypatch, tmp_path):
    _hosted(monkeypatch)
    run_id, _team, _clone = _old_run(client)
    resp, _ = _post(client, run_id, monkeypatch)
    new_id = resp.json()["run_id"]
    seen, rows = _walk(monkeypatch, tmp_path, new_id, drop_carry=True)
    assert seen
    for task in seen:
        assert "STARTING SPEC" not in task.instruction and "FROM RUN #" not in task.instruction
    for _it, _role, manifest in rows:
        assert not [n for n in _parts(manifest) if n.startswith("carried_")]
    _end([new_id])


def test_compile_context_carry_none_is_byte_identical_and_parts_render():
    base = dict(
        node_prompt="You are the PM.",
        idea="Add MACD",
        spec=None,
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=100_000,
    )
    plain = compile_context(**base)
    assert compile_context(**base, carry=None).instruction == plain.instruction
    assert compile_context(**base, carry=None).manifest() == plain.manifest()
    carry = {
        "from": {"run_id": "r", "number": 12},
        "spec": {"version": 3, "text": "THE SPEC"},
        "decisions": [{"title": "Spec approved", "text": None}],
        "memories": [{"id": "m", "content": "Use INDICATORS", "polarity": "require"}],
        "summaries": [{"agent": "Engineer", "text": "Added RSI."}],
    }
    full = compile_context(**base, carry=carry)
    assert [p.name for p in full.parts] == [
        "node_prompt",
        "idea",
        "carried_spec",
        "carried_decisions",
        "carried_memories",
        "carried_summaries",
    ]
    assert full.instruction.startswith(plain.instruction)
    assert full.instruction[len(plain.instruction) :] == (
        "\n\n--- STARTING SPEC (spec v3 of run #12; update it for the new task) ---\nTHE SPEC"
        "\n\n--- FROM RUN #12: THE PERSON'S DECISIONS ---\n- Spec approved"
        "\n\n--- FROM RUN #12: WHAT THE AGENTS LEARNED ---\n- Use INDICATORS"
        "\n\n--- FROM RUN #12: WHAT EACH AGENT DID ---\n- Engineer: Added RSI."
    )
    # Empty kinds add no part; a spec of its own sits after the carried parts.
    some = compile_context(
        **{**base, "spec": "OWN SPEC"},
        carry={**carry, "spec": None, "decisions": [], "summaries": []},
    )
    assert [p.name for p in some.parts] == ["node_prompt", "idea", "carried_memories", "spec"]
    # The large-spec handle path keeps every carried part (static-first never drops one).
    big = compile_context(**{**base, "spec": "x" * 40_000}, carry={**carry, "spec": None})
    assert big.handle_used
    assert "--- FROM RUN #12: WHAT THE AGENTS LEARNED ---" in big.instruction
    assert set(context_compiler._STATIC_FIRST_NAMES) >= {
        "carried_spec",
        "carried_decisions",
        "carried_memories",
        "carried_summaries",
    }


# ----------------------------------------------------------------------------------- the log


def test_a_known_secret_never_appears_in_either_log_format(client, monkeypatch):
    _hosted(monkeypatch)
    owner = auth_user_id()
    provider_key = f"pk{uuid.uuid4().hex}{uuid.uuid4().hex[:6]}"  # no secret shape: known only
    gh_token = f"v1.{uuid.uuid4().hex}"  # an installation token, cached in this process
    sk = "sk-" + uuid.uuid4().hex + "ABCDEFGH"
    with session_scope() as session:
        session.execute(
            update(ProviderCredential)
            .where(ProviderCredential.owner_id == owner, ProviderCredential.provider == "groq")
            .values(secret_encrypted=encrypt_secret(provider_key))
        )
        inst = (
            session.execute(
                select(GithubInstallation.installation_id).where(
                    GithubInstallation.owner_id == owner
                )
            )
            .scalars()
            .first()
        )
    monkeypatch.setitem(github_app._installation_token_cache, inst, (gh_token, time.time() + 3600))
    try:
        run_id, _team, _clone = _old_run(client)
        with session_scope() as session:
            inv = session.execute(
                select(AgentInvocation.id).where(AgentInvocation.run_id == run_id).limit(1)
            ).scalar_one()
            leak = f"{provider_key} {gh_token} {sk}"
            for seq, (kind, payload) in enumerate(
                (
                    (
                        "action",
                        {"tool_name": "terminal", "action": f"command='echo {leak}' kind='T'"},
                    ),
                    ("observation", {"tool_name": "terminal", "observation": f"out {leak}\n"}),
                    ("error", {"error": f"boom {leak}"}),
                )
            ):
                session.add(
                    RunEvent(
                        run_id=run_id,
                        invocation_id=inv,
                        seq=seq,
                        kind=kind,
                        payload=payload,
                        created_at=_at(1.2 + seq / 100),
                    )
                )
        for fmt in ("text", "jsonl"):
            resp = client.get(f"/api/runs/{run_id}/log", params={"format": fmt})
            assert resp.status_code == 200, resp.text
            body = resp.text
            assert "••••" in body, fmt
            for secret in (provider_key, gh_token, sk):
                assert secret not in body, (fmt, secret[:6])
    finally:
        with session_scope() as session:
            session.execute(
                update(ProviderCredential)
                .where(ProviderCredential.owner_id == owner, ProviderCredential.provider == "groq")
                .values(secret_encrypted=encrypt_secret("dummy-offline-test-key-0000"))
            )


def test_the_log_downloads_as_text_or_json_lines_in_order(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, team, _clone = _old_run(client, team_version_number=1)
    number = _number(run_id)
    with session_scope() as session:
        team_name = session.get(TeamGraph, uuid.UUID(team)).name
        inv = session.execute(
            select(AgentInvocation.id)
            .where(AgentInvocation.run_id == run_id)
            .order_by(AgentInvocation.id)
            .offset(1)
            .limit(1)
        ).scalar_one()
        for seq, (kind, payload) in enumerate(
            (
                (
                    "action",
                    {
                        "tool_name": "terminal",
                        "action": "command='pytest -q' kind='TerminalAction'",
                    },
                ),
                ("observation", {"tool_name": "terminal", "observation": "3 passed in 0.1s\n"}),
            )
        ):
            session.add(
                RunEvent(
                    run_id=run_id,
                    invocation_id=inv,
                    seq=seq,
                    kind=kind,
                    payload=payload,
                    created_at=_at(2.1 + seq / 100),
                )
            )
    text_resp = client.get(f"/api/runs/{run_id}/log", params={"format": "text"})
    assert text_resp.status_code == 200
    assert text_resp.headers["content-disposition"] == f'attachment; filename="run-{number}.txt"'
    lines = text_resp.text.splitlines()
    assert lines[0] == f"run #{number} · {team_name} · Add RSI · team setup v1"
    assert lines[1].startswith("09:00:00  ") and lines[1].endswith(
        "Started on acme/indicators, branch main"
    )
    tests = next(k for k, ln in enumerate(lines) if ln.endswith("Ran the tests: all 3 passed"))
    assert lines[tests][:8] == "09:02:06"
    assert lines[tests + 1].strip() == "$ pytest -q" and lines[tests + 1].startswith("  ")
    assert lines[tests + 2].strip() == "3 passed in 0.1s"

    jsonl = client.get(f"/api/runs/{run_id}/log", params={"format": "jsonl"})
    assert jsonl.status_code == 200
    assert jsonl.headers["content-disposition"] == f'attachment; filename="run-{number}.jsonl"'
    rows = [json.loads(ln) for ln in jsonl.text.splitlines()]
    assert all(set(r) == {"at", "agent", "round", "kind", "text", "detail"} for r in rows)
    assert [r["at"] for r in rows] == sorted(r["at"] for r in rows)
    tests_row = next(r for r in rows if r["kind"] == "tests")
    assert (tests_row["agent"], tests_row["round"]) == ("Engineer", 1)
    assert tests_row["detail"] == "$ pytest -q\n3 passed in 0.1s"
    assert client.get(f"/api/runs/{run_id}/log", params={"format": "pdf"}).status_code == 422


# ------------------------------------------------------------------------------- owner scope


def test_start_from_routes_are_owner_scoped(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, _team, _clone = _old_run(client)
    resp, _ = _post(client, run_id, monkeypatch)
    new_id = resp.json()["run_id"]
    b, _b_id = fresh_account("m10-b")
    for target in (run_id, new_id, str(uuid.uuid4())):
        for method, path, body in (
            ("get", f"/api/runs/{target}/next", None),
            ("post", f"/api/runs/{target}/next", {"task": TASK, "start_from": "main"}),
            ("get", f"/api/runs/{target}/carry", None),
            ("get", f"/api/runs/{target}/log?format=text", None),
            ("get", f"/api/runs/{target}/log?format=jsonl", None),
        ):
            with monkeypatch.context() as m:
                m.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
                got = b.post(path, json=body) if method == "post" else b.get(path)
            assert got.status_code == 404, (path, got.status_code, got.text)
            assert TASK not in got.text and "FINAL SPEC" not in got.text
    assert _children(run_id) == 1  # B started nothing
    _end([new_id])


def test_resume_of_a_started_from_run_keeps_what_came_along(client, monkeypatch):
    _hosted(monkeypatch)
    run_id, _team, _clone = _old_run(client)
    resp, _ = _post(client, run_id, monkeypatch)
    new_id = resp.json()["run_id"]
    new = _run(new_id)
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == new.id).values(status="failed"))
        pm = session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == new.team_graph_id, AgentNode.role_name == "pm"
            )
        ).scalar_one()
        inv = AgentInvocation(run_id=new_id, node_id=pm, iteration=1, status="failed")
        session.add(inv)
        session.flush()
        run = session.get(Run, new.id)
        again = resume.create(session, run, inv.id, owner_id=run.owner_id, desktop_routed=None)
        assert again.carry == new.carry
        session.rollback()
