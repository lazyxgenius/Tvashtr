"""Security S1-C — the owner-scoping sweep: runs, tasks, A/B runs, costs, spend and the inbox.

Two fresh accounts per test: A owns everything (a library team, runs with events, costs, documents,
memories, a diff snapshot, gate + nudge tasks, an A/B pair, a Desktop folder snapshot, a GitHub
installation); B is a separate signed-in account. For every route that takes one of A's ids, B gets
a 404 whose body carries none of A's data, the same request by A is NOT a 404 (so B's 404 comes from
ownership, not a bad path or body), and a write leaves A's rows unchanged. The accepted S1-C
exceptions (marked at their assertion) answer B instead exactly as they answer an id that doesn't
exist. Every list route shows A its rows and B none of them. No workflow, LLM or GitHub call is
real: ``DBOS.start_workflow`` / ``DBOS.send`` / ``DBOS.cancel_workflow``, the gateway ``complete``
and the GitHub App are stubbed.
"""

import uuid
from types import SimpleNamespace

import pytest
from conftest import _seed_dummy_credentials
from home_fixtures import add_cost, add_invocation, clone_node, fresh_account, make_run
from sqlalchemy import func, select

from tvashtr import routers
from tvashtr.config import get_settings
from tvashtr.control_plane import github_app, live_state
from tvashtr.db import session_scope
from tvashtr.documents.service import create_document_with_initial_version
from tvashtr.gateway import CompletionResult
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    GithubInstallation,
    HumanTask,
    InboxDismissal,
    NodeMemory,
    RepoSnapshot,
    Run,
    RunArtifact,
    RunEvent,
    TeamGraph,
)

_REPO = "acct-a/private-repo"


# ---------------------------------------------------------------------------- seeding


def _task(run_id: str, title: str, *, blocking: bool, topic: str | None) -> int:
    with session_scope() as session:
        task = HumanTask(
            run_id=run_id,
            kind="prd_approval" if blocking else "budget_threshold",
            priority="high_blocker" if blocking else "low_nudge",
            blocking=blocking,
            topic=topic,
            title=title,
            description="d",
            status="pending",
        )
        session.add(task)
        session.flush()
        return task.id


def _installation(owner_id: uuid.UUID) -> int:
    inst = uuid.uuid4().int % 2_000_000_000
    with session_scope() as session:
        session.add(GithubInstallation(owner_id=owner_id, installation_id=inst))
    return inst


@pytest.fixture
def w(client):
    """A's world + B. ``client`` only launches the app lifespan (DBOS); it is never A or B."""
    a, a_id = fresh_account("scope-a")
    b, b_id = fresh_account("scope-b")
    # Both accounts can launch offline, so a refused B launch is refused for ownership alone.
    _seed_dummy_credentials(str(a_id))
    _seed_dummy_credentials(str(b_id))
    secret = f"SECRET-A-{uuid.uuid4().hex}"

    resp = a.post("/api/teams", json={"template": "review_loop", "name": f"Team {secret}"})
    assert resp.status_code in (200, 201), resp.text
    team = resp.json()["team_graph_id"]

    run_id, clone = make_run(a_id, team, status="awaiting_human", idea=f"Idea {secret}")
    engineer = clone_node(clone, "engineer")
    add_invocation(run_id, engineer, "done", outcome_detail=f"detail {secret}")
    with session_scope() as session:
        session.add(
            RunEvent(run_id=run_id, seq=0, kind="message", payload={"text": f"event {secret}"})
        )
        session.add(
            NodeMemory(
                owner_id=a_id,
                content=f"memory {secret}",
                status="pending_review",
                source_run_id=run_id,
            )
        )
        session.add(
            RunArtifact(
                run_id=uuid.UUID(run_id),
                files={
                    "run_id": run_id,
                    "base_ref": None,
                    "ship_branch": None,
                    "files": [
                        {
                            "path": f"{secret}.py",
                            "status": "added",
                            "additions": 1,
                            "deletions": 0,
                            "patch": "+x\n",
                        }
                    ],
                    "total": 1,
                },
            )
        )
    add_cost(run_id, "1.25")
    create_document_with_initial_version(
        f"Spec {secret}",
        "prd",
        f"content {secret}",
        "agent:entry",
        f"{run_id}:pm-prd-v1",
        run_id=uuid.UUID(run_id),
        name="spec",
    )
    gate = _task(
        run_id,
        f"gate {secret}",
        blocking=True,
        topic=f"gate:{run_id}:{clone_node(clone, 'prd_gate')}",
    )
    nudge = _task(run_id, f"nudge {secret}", blocking=False, topic=None)

    failed, _ = make_run(a_id, team, status="failed", idea=f"Failed {secret}")
    pair = uuid.uuid4()
    pair_run, _ = make_run(a_id, None, idea=f"Pair {secret}", pair_id=pair, pair_label="A")

    snapshot = uuid.uuid4()
    with session_scope() as session:
        session.add(
            RepoSnapshot(
                id=snapshot,
                owner_id=a_id,
                kind="source",
                label=f"~/code/{secret}",
                base_ref="main",
                size_bytes=1,
                data=b"x",
            )
        )
    a_inst = _installation(a_id)
    b_inst = _installation(b_id)

    # B's own objects, for the mixed requests (B's run in the path, A's child id beside it). B's
    # own run also has an askable node, a gate and a nudge: B's own child ids are the positive
    # control proving a mixed 404 comes from A's child id, not from B's run.
    b_run, b_clone = make_run(b_id, None, idea="B's own run")
    b_engineer = clone_node(b_clone, "engineer")
    add_invocation(b_run, b_engineer, "done")
    b_gate = _task(
        b_run, "B gate", blocking=True, topic=f"gate:{b_run}:{clone_node(b_clone, 'prd_gate')}"
    )
    b_nudge = _task(b_run, "B nudge", blocking=False, topic=None)

    return SimpleNamespace(
        a=a,
        a_id=a_id,
        b=b,
        b_id=b_id,
        secret=secret,
        team=team,
        run=run_id,
        engineer=engineer,
        gate=gate,
        nudge=nudge,
        failed=failed,
        pair=str(pair),
        pair_run=pair_run,
        snapshot=str(snapshot),
        a_inst=a_inst,
        b_inst=b_inst,
        b_run=b_run,
        b_engineer=b_engineer,
        b_gate=b_gate,
        b_nudge=b_nudge,
    )


def _a_ids(w) -> list[str]:
    return [w.secret, w.run, w.team, w.failed, w.pair, w.pair_run, w.snapshot]


def _assert_refused(resp, w) -> None:
    """B's answer: a 404 that carries none of A's data."""
    assert resp.status_code == 404, f"B got {resp.status_code}: {resp.text}"
    for leaked in _a_ids(w):
        assert leaked not in resp.text, f"B's 404 leaks {leaked!r}: {resp.text}"


def _assert_same_as_unknown(theirs, unknown, a_key: str, unknown_key: str, w) -> None:
    """No existence oracle: B's answer for A's id equals B's answer for an id that doesn't exist
    (same status, same body once each id is normalised to ``<id>``) and carries none of A's data."""
    assert theirs.status_code == unknown.status_code, (theirs.text, unknown.text)
    assert theirs.text.replace(a_key, "<id>") == unknown.text.replace(unknown_key, "<id>")
    for leaked in _a_ids(w):
        assert leaked not in theirs.text, f"B's answer leaks {leaked!r}: {theirs.text}"


def _assert_no_leak(resp, w) -> None:
    assert resp.status_code == 200, resp.text
    for leaked in _a_ids(w):
        assert leaked not in resp.text, f"B's list leaks {leaked!r}: {resp.text}"


def _task_row(task_id: int) -> tuple:
    with session_scope() as session:
        t = session.get(HumanTask, task_id)
        return (t.status, t.resolution, t.resolved_at)


def _run_status(run_id: str) -> str:
    with session_scope() as session:
        return session.execute(select(Run.status).where(Run.workflow_id == run_id)).scalar_one()


# ---------------------------------------------------------------------------- id reads


_READS = {
    "run_events": "/api/spike/run-events/{run}",
    "run": "/api/runs/{run}",
    "documents": "/api/runs/{run}/documents",
    "trajectory": "/api/runs/{run}/trajectory",
    "diff": "/api/runs/{run}/diff",
    "memories": "/api/runs/{run}/memories",
    "graph": "/api/runs/{run}/graph",
    "activity": "/api/runs/{run}/activity",
    "tasks": "/api/runs/{run}/tasks",
    "ab_pair": "/api/ab-runs/{pair}",
}


@pytest.mark.parametrize("name", list(_READS))
def test_b_cannot_read_a_run(w, name):
    url = _READS[name].format(run=w.run, pair=w.pair)
    _assert_refused(w.b.get(url), w)
    # Positive control: A's own read of the same url is served, with A's data in it.
    mine = w.a.get(url)
    assert mine.status_code == 200, mine.text
    assert w.secret in mine.text, mine.text


# ---------------------------------------------------------------------------- ask the node


def _canned(_request) -> CompletionResult:
    model = "openrouter/x"
    return CompletionResult(
        text="the answer",
        model_requested=model,
        model_used=model,
        prompt_tokens=1,
        completion_tokens=1,
        total_tokens=2,
        cost_usd=0.0,
        raw_provider="openrouter",
        latency_ms=1.0,
    )


def _ask_costs(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key.like(f"node-ask:{run_id}:%"))
        ).scalar_one()


def test_b_cannot_ask_a_node_of_a_run(w, monkeypatch):
    calls: list = []

    def _complete(request):
        calls.append(request)
        return _canned(request)

    monkeypatch.setattr(routers, "complete", _complete)
    body = {"messages": [{"role": "user", "content": "what did you do?"}]}
    # A's run + A's node, and B's own run + A's node.
    _assert_refused(w.b.post(f"/api/runs/{w.run}/nodes/{w.engineer}/ask", json=body), w)
    _assert_refused(w.b.post(f"/api/runs/{w.b_run}/nodes/{w.engineer}/ask", json=body), w)
    assert calls == [] and _ask_costs(w.run) == 0 and _ask_costs(w.b_run) == 0

    mine = w.a.post(f"/api/runs/{w.run}/nodes/{w.engineer}/ask", json=body)
    assert mine.status_code == 200, mine.text
    assert len(calls) == 1
    # B's own run with B's own node is served: the mixed 404 above is A's node, not B's run.
    own = w.b.post(f"/api/runs/{w.b_run}/nodes/{w.b_engineer}/ask", json=body)
    assert own.status_code == 200, own.text


# ---------------------------------------------------------------------------- switch to backup


def test_b_cannot_switch_a_node_to_its_backup(w):
    """M2: the Retrying callout's switch. A's engineer is mid-retry with its call in this process;
    B (on A's run, or on B's own run with A's node) gets a 404 and A's signal stays unset."""
    add_invocation(w.run, w.engineer, "running", iteration=2)
    with session_scope() as session:
        inv_id = session.execute(
            select(AgentInvocation.id).where(
                AgentInvocation.run_id == w.run, AgentInvocation.iteration == 2
            )
        ).scalar_one()
    live_state.record_host_event(
        w.run, inv_id, "retry", {"attempt": 1, "of": 3, "backup_model": "openai/gpt-4.1-mini"}
    )
    signal = live_state.switch_signal(w.run, inv_id)
    try:
        _assert_refused(w.b.post(f"/api/runs/{w.run}/nodes/{w.engineer}/switch-backup"), w)
        _assert_refused(w.b.post(f"/api/runs/{w.b_run}/nodes/{w.engineer}/switch-backup"), w)
        assert not signal.is_set()
        mine = w.a.post(f"/api/runs/{w.run}/nodes/{w.engineer}/switch-backup")
        assert mine.status_code == 200, mine.text
        assert signal.is_set()
    finally:
        live_state.clear_switch(w.run, inv_id)


# ---------------------------------------------------------------------------- tasks


def test_b_cannot_resolve_a_gate_task(w, monkeypatch):
    sent: list = []
    monkeypatch.setattr(routers.DBOS, "send", lambda *a, **k: sent.append((a, k)))
    before = _task_row(w.gate)
    body = {"decision": "approve", "note": "ok"}
    _assert_refused(w.b.post(f"/api/runs/{w.run}/tasks/{w.gate}/resolve", json=body), w)
    _assert_refused(w.b.post(f"/api/runs/{w.b_run}/tasks/{w.gate}/resolve", json=body), w)
    assert sent == [] and _task_row(w.gate) == before

    mine = w.a.post(f"/api/runs/{w.run}/tasks/{w.gate}/resolve", json=body)
    assert mine.status_code == 200, mine.text
    assert len(sent) == 1 and sent[0][0][0] == w.run
    # B's own run with B's own gate is served: the mixed 404 above is A's task, not B's run.
    own = w.b.post(f"/api/runs/{w.b_run}/tasks/{w.b_gate}/resolve", json=body)
    assert own.status_code == 200, own.text


def test_b_cannot_acknowledge_a_nudge(w):
    before = _task_row(w.nudge)
    _assert_refused(w.b.post(f"/api/runs/{w.run}/tasks/{w.nudge}/acknowledge"), w)
    _assert_refused(w.b.post(f"/api/runs/{w.b_run}/tasks/{w.nudge}/acknowledge"), w)
    assert _task_row(w.nudge) == before

    mine = w.a.post(f"/api/runs/{w.run}/tasks/{w.nudge}/acknowledge")
    assert mine.status_code == 200, mine.text
    assert _task_row(w.nudge)[0] == "resolved"
    # B's own run with B's own nudge is served: the mixed 404 above is A's task, not B's run.
    own = w.b.post(f"/api/runs/{w.b_run}/tasks/{w.b_nudge}/acknowledge")
    assert own.status_code == 200, own.text


# ---------------------------------------------------------------------------- cancel


def test_b_cannot_cancel_a_run(w, monkeypatch):
    cancelled: list = []
    monkeypatch.setattr(routers.DBOS, "cancel_workflow", lambda wid: cancelled.append(wid))
    gate_before = _task_row(w.gate)
    _assert_refused(w.b.post(f"/api/runs/{w.run}/cancel"), w)
    assert cancelled == []
    assert _run_status(w.run) == "awaiting_human" and _task_row(w.gate) == gate_before

    mine = w.a.post(f"/api/runs/{w.run}/cancel")
    assert mine.status_code == 200, mine.text
    assert cancelled == [w.run] and _run_status(w.run) == "cancelled"


# ---------------------------------------------------------------------------- inbox dismissals


def _inbox_keys(c) -> set[str]:
    resp = c.get("/api/inbox")
    assert resp.status_code == 200, resp.text
    return {i["key"] for i in resp.json()["items"]}


def _dismissals(key: str) -> list[tuple]:
    with session_scope() as session:
        return [
            (r.owner_id, r.action)
            for r in session.execute(
                select(InboxDismissal).where(InboxDismissal.item_key == key)
            ).scalars()
        ]


@pytest.mark.parametrize("item", ["run_failed", "nudge", "gate"])
def test_b_cannot_dismiss_an_item_of_a(w, item):
    key, body = {
        "run_failed": (f"run_failed:{w.failed}", {"action": "dismiss"}),
        "nudge": (f"nudge:{w.nudge}", {"action": "dismiss"}),
        # An approval can only be snoozed.
        "gate": (f"gate:{w.gate}", {"action": "snooze", "until": "2999-01-01T00:00:00+00:00"}),
    }[item]
    body = {"key": key, **body}
    assert key in _inbox_keys(w.a)
    resp = w.b.post("/api/inbox/dismissals", json=body)
    _assert_refused(resp, w)
    assert _dismissals(key) == [] and key in _inbox_keys(w.a)

    mine = w.a.post("/api/inbox/dismissals", json=body)
    assert mine.status_code == 200, mine.text
    assert key not in _inbox_keys(w.a)


def test_b_cannot_undo_a_dismissal_of_a(w):
    """The key names A's run and A's dismissal row: B's undo of it is answered exactly as an
    unknown key is and A's dismissal stays. A's own undo is served and brings the item back."""
    key = f"run_failed:{w.failed}"
    mine = w.a.post("/api/inbox/dismissals", json={"key": key, "action": "dismiss"})
    assert mine.status_code == 200, mine.text
    assert key not in _inbox_keys(w.a)
    before = _dismissals(key)
    assert before == [(w.a_id, "dismissed")]

    theirs = w.b.delete(f"/api/inbox/dismissals/{key}")
    assert _dismissals(key) == before and key not in _inbox_keys(w.a)
    unknown_key = f"run_failed:{uuid.uuid4()}"
    unknown = w.b.delete(f"/api/inbox/dismissals/{unknown_key}")

    # Positive control (last: it deletes).
    undo = w.a.delete(f"/api/inbox/dismissals/{key}")
    assert undo.status_code == 204, undo.text
    assert _dismissals(key) == [] and key in _inbox_keys(w.a)
    # S1-C exception: an idempotent owner-filtered undo answers 204 for any key, A's or unknown.
    _assert_same_as_unknown(theirs, unknown, key, unknown_key, w)


# ---------------------------------------------------------------------------- launch with A's ids


def _runs_owned_by(owner_id: uuid.UUID) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count()).select_from(Run).where(Run.owner_id == owner_id)
        ).scalar_one()


def _team_state(team: str) -> tuple:
    with session_scope() as session:
        t = session.get(TeamGraph, uuid.UUID(team))
        nodes = session.execute(
            select(func.count()).select_from(AgentNode).where(AgentNode.team_graph_id == t.id)
        ).scalar_one()
        return (t.name, t.owner_id, t.is_library, nodes)


def _retries_of(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count()).select_from(Run).where(Run.retry_of_run_id == uuid.UUID(run_id))
        ).scalar_one()


def _snapshot_state(sid: str) -> tuple:
    with session_scope() as session:
        s = session.get(RepoSnapshot, uuid.UUID(sid))
        return (s.owner_id, s.run_id, s.consumed_at)


def _launch_body(w, field: str) -> dict:
    if field == "team_graph_id":
        return {"idea": "x", "team_graph_id": w.team}
    if field == "retry_of_run_id":
        return {"idea": "x", "retry_of_run_id": w.failed}
    if field == "local_repo.snapshot_id":
        return {"idea": "x", "desktop_target": True, "local_repo": {"snapshot_id": w.snapshot}}
    return {"idea": "x", "github_repo": _REPO}


# The launch fields whose refusal is the 422 an unknown value gets (an existing API contract), with
# a fresh value that names nothing.
_UNKNOWN = {
    "retry_of_run_id": lambda: str(uuid.uuid4()),
    "github_repo": lambda: f"acct-a/no-such-repo-{uuid.uuid4().hex}",
}


def _installations(owner_id: uuid.UUID) -> list[int]:
    with session_scope() as session:
        return list(
            session.execute(
                select(GithubInstallation.installation_id).where(
                    GithubInstallation.owner_id == owner_id
                )
            ).scalars()
        )


def _a_state(w, field: str):
    if field == "team_graph_id":
        return _team_state(w.team)
    if field == "retry_of_run_id":
        return _retries_of(w.failed)
    if field == "local_repo.snapshot_id":
        return _snapshot_state(w.snapshot)
    return _installations(w.a_id)


@pytest.mark.parametrize(
    "field", ["team_graph_id", "retry_of_run_id", "local_repo.snapshot_id", "github_repo"]
)
def test_b_cannot_launch_on_a_object(w, monkeypatch, field):
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    # A's installation reaches the repo; B's own installation reaches nothing.
    monkeypatch.setattr(
        github_app,
        "list_installation_repositories",
        lambda inst: (
            [{"full_name": _REPO, "default_branch": "main", "private": True}]
            if inst == w.a_inst
            else []
        ),
    )
    body = _launch_body(w, field)
    before, b_runs = _a_state(w, field), _runs_owned_by(w.b_id)

    theirs = w.b.post("/api/runs", json=body)
    assert _a_state(w, field) == before
    assert _runs_owned_by(w.b_id) == b_runs  # nothing launched for B
    if field in _UNKNOWN:
        a_value, unknown_value = body[field], _UNKNOWN[field]()
        unknown = w.b.post("/api/runs", json={**body, field: unknown_value})

    # Positive control first (it is the last write), so a failing B status below is proven to be
    # the ownership answer and not a malformed body.
    mine = w.a.post("/api/runs", json=body)
    assert mine.status_code == 200, mine.text
    if field in _UNKNOWN:
        # S1-C exception: A's retry id / repo get B the same 422 as an unknown one (API contract).
        _assert_same_as_unknown(theirs, unknown, a_value, unknown_value, w)
    else:
        _assert_refused(theirs, w)


# ---------------------------------------------------------------------------- lists


def test_run_list_is_owner_scoped(w):
    mine = w.a.get("/api/runs?limit=100")
    assert mine.status_code == 200, mine.text
    assert w.run in mine.text and w.secret in mine.text
    for url in (
        "/api/runs?limit=100",
        "/api/runs?limit=100&include=progress",
        f"/api/runs?team_id={w.team}",
        f"/api/runs?q={w.secret}",
        "/api/runs?status=needs_you",
        "/api/runs?status=failed",
    ):
        _assert_no_leak(w.b.get(url), w)


def test_costs_are_owner_scoped(w):
    mine = w.a.get("/api/costs")
    assert mine.status_code == 200 and w.run in mine.text, mine.text
    _assert_no_leak(w.b.get("/api/costs"), w)
    theirs = w.b.get(f"/api/costs?workflow_id={w.run}")
    _assert_no_leak(theirs, w)
    assert theirs.json() == {"costs": []}


def test_spend_is_owner_scoped(w):
    mine = w.a.get("/api/spend?tz=UTC")
    assert mine.status_code == 200, mine.text
    assert mine.json()["month"]["total_usd"] > 0 and w.team in mine.text
    theirs = w.b.get("/api/spend?tz=UTC")
    _assert_no_leak(theirs, w)
    assert theirs.json()["month"]["total_usd"] == 0 and theirs.json()["by_team"] == []


def test_inbox_is_owner_scoped(w):
    assert {f"run_failed:{w.failed}", f"nudge:{w.nudge}", f"gate:{w.gate}"} <= _inbox_keys(w.a)
    _assert_no_leak(w.b.get("/api/inbox?surface=desktop"), w)
    theirs = w.b.get("/api/inbox")
    _assert_no_leak(theirs, w)
    keys = {i["key"] for i in theirs.json()["items"]}
    assert not keys & {f"run_failed:{w.failed}", f"nudge:{w.nudge}", f"gate:{w.gate}"}
    assert not any(w.team in k for k in keys)


def test_engine_usage_is_owner_scoped(w):
    r = w.a.post("/api/domains", json={"template": "support", "name": f"Domain {w.secret}"})
    assert r.status_code == 200, r.text
    domain = r.json()["domain_id"]
    mine = w.a.get("/api/engines/usage")
    assert mine.status_code == 200 and w.team in mine.text and domain in mine.text, mine.text
    theirs = w.b.get("/api/engines/usage")
    _assert_no_leak(theirs, w)
    assert domain not in theirs.text


# ---------------------------------------------------------------------------- own: A/B launch


def test_ab_launch_is_own_scoped(w, monkeypatch):
    """``POST /api/ab-runs`` takes no id (only idea + budget cap): it builds fresh teams and both
    runs are owned by the caller. B's launch touches none of A's runs and echoes none of A's
    data."""
    monkeypatch.setattr(routers.DBOS, "start_workflow", lambda *a, **k: None)
    a_runs = _runs_owned_by(w.a_id)
    resp = w.b.post("/api/ab-runs", json={"idea": "B's own A/B"})
    _assert_no_leak(resp, w)
    ids = [uuid.UUID(r["run_id"]) for r in resp.json()["runs"]]
    with session_scope() as session:
        owners = set(session.execute(select(Run.owner_id).where(Run.id.in_(ids))).scalars())
    assert len(ids) == 2 and owners == {w.b_id}
    assert _runs_owned_by(w.a_id) == a_runs
