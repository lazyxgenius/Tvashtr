"""M-desk-routes — on the Desktop, Compare, task sets, agent tests and Ask run on the owner's Claude
and Grok subscriptions through the Desktop runner (brief ``prompts/m-desk-routes.md``, D1–D7).

A Desktop start sends ``desktop_target: true``; each model is routed exactly as a run's is
(``credential_gate.desktop_routed_subscriptions`` over the owner's FRESH subscriptions). The website
(no flag) keeps its API-key path. Offline: no workflow really starts, the "Desktop" is the real
runner routes driven by the test, and no LLM is called.
"""

import io
import tarfile
import time
import uuid
from datetime import UTC, datetime, timedelta

from home_fixtures import add_invocation, clone_node, fresh_account, library_team, make_run
from sqlalchemy import func, select, update
from test_agent_tests import _create, _run_with_rounds, _tests
from test_compare import _end, _graph, _node, _post, _runs_of
from test_desktop_subscription_launch import _connect_desktop
from test_task_sets import _make_set, _set_runs, _starts

from tvashtr import routers
from tvashtr.config import get_settings
from tvashtr.control_plane import activity, agent_test_runner, desktop_jobs
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    DesktopNodeJob,
    EngineSubscriptionStatus,
    Run,
    RunEvent,
)

CLAUDE = "anthropic/claude-sonnet-5"
GROK = "xai/grok-4.7"
WORK_LINE = (
    "On your Desktop, both versions share your subscription and take turns, so this counts "
    "working time only."
)


# ------------------------------------------------------------------------------------ helpers


def _desk_team(c, name: str = "Desk team") -> str:
    """A review-loop library team whose PM is on Grok and Engineer + Reviewer on Claude."""
    team = library_team(c, name=name)
    for n in _graph(c, team)["nodes"]:
        if n.get("model"):
            model = GROK if n["role_name"] == "pm" else CLAUDE
            resp = c.patch(f"/api/teams/{team}/nodes/{n['id']}", json={"model": model})
            assert resp.status_code == 200, resp.text
    return team


def _desk_versions(c, name: str = "Desk team") -> str:
    """``_desk_team`` with v1 (as made) and v2 (the Engineer's instructions changed)."""
    team = _desk_team(c, name)
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1
    eng = _node(c, team, "engineer")
    resp = c.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "v2: keep it tiny."})
    assert resp.status_code == 200, resp.text
    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v2
    return team


def _wait_for(fn, what: str, timeout: float = 20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for {what}")


def _jobs(**where) -> list[DesktopNodeJob]:
    with session_scope() as session:
        stmt = select(DesktopNodeJob)
        for key, value in where.items():
            stmt = stmt.where(getattr(DesktopNodeJob, key) == value)
        rows = session.execute(stmt.order_by(DesktopNodeJob.created_at)).scalars().all()
        for r in rows:
            session.expunge(r)
    return rows


def _events_of(run_id: str) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run_id)
        ).scalar_one()


def _asked_run(c, owner) -> tuple[str, str]:
    """A finished run whose Engineer (on Claude) ran once: ``(run_id, engineer node id)``."""
    team = _desk_team(c, name=f"Ask team {uuid.uuid4().hex[:6]}")
    run_id, clone = make_run(owner, team, status="completed", desktop_target=True)
    engineer = clone_node(clone, "engineer")
    add_invocation(run_id, engineer, "done", outcome_detail="Changed README.md: added one line")
    return run_id, engineer


QUESTION = {"messages": [{"role": "user", "content": "Why did you change README.md?"}]}


# --------------------------------------------------------- (a) Compare + task sets on the Desktop


def test_a_desktop_compare_for_a_keyless_account_launches_desktop_runs(client, monkeypatch):
    """(a) Today: 422 (no anthropic/xai key) — the flag isn't read and the pre-flight is the
    website's. On the Desktop each run carries ``desktop_target`` + the routed subscriptions."""
    c, _owner = fresh_account("desk-cmp")
    team = _desk_versions(c)
    _connect_desktop(c, "claude", "grok")
    assert c.get("/api/providers").json()["providers"] == []

    resp, started, waiters = _post(c, team, monkeypatch, desktop_target=True)
    assert resp.status_code == 201, resp.text
    runs = _runs_of(resp.json()["id"])
    try:
        assert [(r.pair_label, r.desktop_target, r.desktop_subscriptions) for r in runs] == [
            ("A", True, ["claude", "grok"]),
            ("B", True, ["claude", "grok"]),
        ]
        assert sorted(started) == sorted(str(r.id) for r in runs) and waiters == []
    finally:
        _end(runs)


def test_a_desktop_compare_that_waits_launches_its_runs_on_the_desktop_later(client, monkeypatch):
    """D2: the flag is stored on the compare, so the waiter's later launch is Desktop-routed too,
    with the routing computed at THAT launch."""
    from dbos import DBOS

    from tvashtr.control_plane import compare

    settings = get_settings()
    c, owner = fresh_account("desk-cmp-wait")
    team = _desk_versions(c)
    _connect_desktop(c, "claude", "grok")
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 2)
    busy = make_run(owner, None, status="running")[0]

    resp, started, waiters = _post(c, team, monkeypatch, desktop_target=True)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    try:
        assert resp.json()["status"] == "waiting" and started == [] and waiters == [cid]
        with session_scope() as session:
            session.execute(update(Run).where(Run.workflow_id == busy).values(status="completed"))
        _connect_desktop(c, "claude")  # only Claude is fresh now: Grok is no longer routed
        with session_scope() as session:
            session.execute(
                update(EngineSubscriptionStatus)
                .where(
                    EngineSubscriptionStatus.owner_id == owner,
                    EngineSubscriptionStatus.provider == "grok",
                )
                .values(connected=False)
            )
        with monkeypatch.context() as m:
            m.setattr(DBOS, "start_workflow", lambda *a, **k: None)
            assert compare.try_start(uuid.UUID(cid)) is True
        runs = _runs_of(cid)
        assert [(r.pair_label, r.desktop_target, r.desktop_subscriptions) for r in runs] == [
            ("A", True, ["claude"]),
            ("B", True, ["claude"]),
        ]
    finally:
        _end(_runs_of(cid))
        c.post(f"/api/compares/{cid}/stop")


def test_a_desktop_task_set_compare_runs_every_task_on_the_desktop(client, monkeypatch):
    c, _owner = fresh_account("desk-set")
    team = _desk_versions(c)
    ts = _make_set(c, team)
    _connect_desktop(c, "claude", "grok")
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # self-hosted: all tasks at once
    resp, calls, waiters = _starts(c, team, monkeypatch, task_set_id=ts["id"], desktop_target=True)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    try:
        runs = _set_runs(cid)
        assert len(runs) == 4 and waiters == []
        assert {(r.desktop_target, tuple(r.desktop_subscriptions)) for r in runs} == {
            (True, ("claude", "grok"))
        }
    finally:
        _end(_set_runs(cid))


# ------------------------------------------------------------- (b) agent tests on the Desktop


def _desk_tests_account(tmp_path):
    c, owner = fresh_account("desk-tests")
    team = library_team(c)
    for role in ("reviewer", "engineer"):
        node = _node(c, team, role)
        resp = c.patch(f"/api/teams/{team}/nodes/{node['id']}", json={"model": CLAUDE})
        assert resp.status_code == 200, resp.text
    made = _run_with_rounds(c, owner, team, tmp_path)
    return c, owner, team, made


def test_b_a_desktop_agent_test_queues_a_test_replay_job_and_resolves_no_key(tmp_path, monkeypatch):
    """(b) Today: the replay resolves the owner's key and fails "There’s no key for anthropic". On
    the Desktop the Engineer's replay is a ``test_replay`` job on its rebuilt workspace, its
    answer comes back through the runner routes, and no API key is resolved."""
    c, _owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "All done"})
    _connect_desktop(c, "claude")
    monkeypatch.setattr(get_settings(), "desktop_runner_poll_seconds", 0.05)
    monkeypatch.setattr(agent_test_runner, "_POLL_S", 0.05)
    keys: list = []
    real_key = agent_test_runner.resolve_owner_api_key
    monkeypatch.setattr(
        agent_test_runner,
        "resolve_owner_api_key",
        lambda owner, model: keys.append(model) or real_key(owner, model),
    )

    resp = c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/run", json={"desktop_target": True})
    assert resp.status_code == 202, resp.text
    result_id = resp.json()["run"]["results"][0]["id"]
    job = _wait_for(lambda: _jobs(run_id=result_id), "the replay's Desktop job")[0]
    assert (job.purpose, job.provider, job.model) == ("test_replay", "claude", CLAUDE)
    assert job.invocation_id is None

    claimed = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert claimed["id"] == str(job.id)
    snap = c.get(f"/api/desktop-runner/jobs/{job.id}/snapshot")
    assert snap.status_code == 200, snap.text
    with tarfile.open(fileobj=io.BytesIO(snap.content), mode="r:gz") as tar:
        assert "./core/rsi.py" in tar.getnames()  # the replay's rebuilt workspace
    events = [{"seq": 0, "kind": "message", "payload": {"source": "claude", "text": "working"}}]
    assert c.post(f"/api/desktop-runner/jobs/{job.id}/events", json={"events": events}).json() == {
        "ok": True,
        "cancelled": False,
    }
    done = c.post(
        f"/api/desktop-runner/jobs/{job.id}/result",
        json={"status": "completed", "final_text": "All done", "patch": ""},
    )
    assert done.status_code == 200, done.text

    run = _wait_for(
        lambda: (r := _tests(c, team, eng["id"])["run"])["status"] == "done" and r,
        "the test run to finish",
    )
    assert [(r["status"], r["answer"]) for r in run["results"]] == [("passed", "All done")]
    assert keys == []  # no API key was resolved for the Desktop replay
    assert _events_of(result_id) == 0  # a replay's runner events never become run_events rows


# ----------------------------------------------------------------------- (c)–(e) Ask on Desktop


def _ask(c, run_id, node_id):
    return c.post(
        f"/api/runs/{run_id}/nodes/{node_id}/ask", json={**QUESTION, "desktop_target": True}
    )


def test_c_a_desktop_ask_queues_an_ask_job_and_its_get_returns_the_answer(client):
    """(c) Today: 422 "no credential for provider 'anthropic'". On the Desktop: 202 + an ``ask``
    job; the runner answers it through the real runner routes and the GET returns the answer."""
    c, owner = fresh_account("desk-ask")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")

    resp = _ask(c, run_id, engineer)
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued" and set(body) == {"ask_id", "status"}
    ask_id = body["ask_id"]
    [job] = _jobs(id=uuid.UUID(ask_id))
    assert (job.purpose, job.provider, job.model, job.run_id, job.node_id) == (
        "ask",
        "claude",
        CLAUDE,
        run_id,
        engineer,
    )
    assert "Why did you change README.md?" in job.instruction
    assert "Changed README.md: added one line" in job.instruction  # the node's recorded trail
    assert "don't use any tools" in job.instruction.lower()
    url = f"/api/runs/{run_id}/nodes/{engineer}/asks/{ask_id}"
    assert c.get(url).json() == {
        "ask_id": ask_id,
        "status": "queued",
        "answer": None,
        "error": None,
    }

    claimed = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert claimed["id"] == ask_id
    assert c.get(url).json()["status"] == "running"
    snap = c.get(f"/api/desktop-runner/jobs/{ask_id}/snapshot")
    assert snap.status_code == 200, snap.text
    with tarfile.open(fileobj=io.BytesIO(snap.content), mode="r:gz") as tar:
        assert [m for m in tar.getmembers() if not m.isdir()] == []  # an empty workspace
    done = c.post(
        f"/api/desktop-runner/jobs/{ask_id}/result",
        json={
            "status": "completed",
            "final_text": "The task asked for a 'Built with Tvashtr' line.",
            "patch": "diff --git a/x b/x\n",
        },
    )
    assert done.status_code == 200, done.text
    assert c.get(url).json() == {
        "ask_id": ask_id,
        "status": "completed",
        "answer": "The task asked for a 'Built with Tvashtr' line.",
        "error": None,
    }
    [job] = _jobs(id=uuid.UUID(ask_id))
    assert job.patch is None  # an Ask's patch is never kept, let alone applied


def test_d_an_ask_jobs_events_write_no_run_events(client):
    c, owner = fresh_account("desk-ask-ev")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")
    ask_id = _ask(c, run_id, engineer).json()["ask_id"]
    before = _events_of(run_id)
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    events = [
        {"seq": i, "kind": "message", "payload": {"source": "claude", "text": f"thinking {i}"}}
        for i in range(3)
    ]
    resp = c.post(f"/api/desktop-runner/jobs/{ask_id}/events", json={"events": events})
    assert resp.json() == {"ok": True, "cancelled": False}
    assert _events_of(run_id) == before  # nothing written into the asked run
    with session_scope() as session:
        beat = session.get(DesktopNodeJob, uuid.UUID(ask_id)).heartbeat_at
    assert beat is not None  # the events post is still the job's heartbeat


def test_e_an_ask_job_is_claimable_for_a_run_that_has_ended(client):
    c, owner = fresh_account("desk-ask-ended")
    run_id, engineer = _asked_run(c, owner)
    with session_scope() as session:
        assert session.get(Run, uuid.UUID(run_id)).status == "completed"
    _connect_desktop(c, "claude")
    ask_id = _ask(c, run_id, engineer).json()["ask_id"]
    claimed = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert claimed is not None and claimed["id"] == ask_id
    [job] = _jobs(id=uuid.UUID(ask_id))
    assert job.status == "claimed"


# ------------------------------------------------------ (f) a Desktop compare counts work time


def test_f_a_desktop_compares_work_time_excludes_time_queued_for_the_desktop(client, monkeypatch):
    """(f) Both lanes' Engineers worked 10 minutes; A's waited 6 of them in the Desktop queue
    (B held the one Claude job). The results count working time only and say so (D3)."""
    c, owner = fresh_account("desk-work")
    team = _desk_versions(c)
    _connect_desktop(c, "claude", "grok")
    resp, _started, _waiters = _post(c, team, monkeypatch, desktop_target=True)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    runs = _runs_of(cid)
    start = datetime.now(UTC) - timedelta(minutes=12)
    for run, queued_s in zip(runs, (360, 0), strict=True):
        engineer = clone_node(str(run.team_graph_id), "engineer")
        with session_scope() as session:
            inv = AgentInvocation(
                run_id=run.workflow_id,
                node_id=uuid.UUID(engineer),
                iteration=1,
                status="done",
                started_at=start,
                ended_at=start + timedelta(minutes=10),
            )
            session.add(inv)
            session.flush()
            inv_id = inv.id
        job_id = desktop_jobs.enqueue_job(
            owner_id=owner,
            run_id=run.workflow_id,
            node_id=engineer,
            iteration=1,
            invocation_id=inv_id,
            provider="claude",
            model=CLAUDE,
            instruction="build it",
            workspace_dir="/nonexistent",
            sidecars=[],
        )
        with session_scope() as session:
            session.execute(
                update(DesktopNodeJob)
                .where(DesktopNodeJob.id == uuid.UUID(job_id))
                .values(
                    status="completed",
                    created_at=start,
                    claimed_at=start + timedelta(seconds=queued_s),
                    finished_at=start + timedelta(minutes=10),
                )
            )
            session.execute(
                update(Run)
                .where(Run.id == run.id)
                .values(status="completed", updated_at=start + timedelta(minutes=11))
            )
    view = c.get(f"/api/compares/{cid}").json()
    assert view["status"] == "finished"
    row = next(r for r in view["results"]["rows"] if r["key"] == "time")
    assert (row["label"], row["a"], row["b"]) == (
        "Work time",
        activity._span(240),
        activity._span(600),
    )
    assert row["better"] == "a" and row["difference"] == "+6m"
    assert view["results"]["note"] == WORK_LINE


# ------------------------------------------------------------ the website is unchanged (no flag)


def test_a_website_compare_keeps_the_key_path_even_with_a_fresh_desktop(client, monkeypatch):
    c, _owner = fresh_account("web-cmp")
    team = _desk_versions(c)
    _connect_desktop(c, "claude", "grok")
    resp, started, _ = _post(c, team, monkeypatch)  # no desktop_target: the website
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["missing_providers"] == ["anthropic", "xai"]
    assert started == []

    for provider in ("anthropic", "xai"):
        add = c.post("/api/providers", json={"provider": provider, "api_key": f"sk-{provider}"})
        assert add.status_code in (200, 201), add.text
    resp, _started, _ = _post(c, team, monkeypatch)
    assert resp.status_code == 201, resp.text
    runs = _runs_of(resp.json()["id"])
    try:
        assert [(r.desktop_target, r.desktop_subscriptions) for r in runs] == [
            (False, None),
            (False, None),
        ]
        view = c.get(f"/api/compares/{resp.json()['id']}").json()
        assert "note" not in (view["results"] or {})
    finally:
        _end(runs)


def test_a_website_agent_test_keeps_the_key_path_even_with_a_fresh_desktop(tmp_path, monkeypatch):
    c, _owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "x"})
    _connect_desktop(c, "claude")
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: target(*a))
    resp = c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/run")  # no body: the website
    assert resp.status_code == 202, resp.text
    result = _tests(c, team, eng["id"])["run"]["results"][0]
    assert result["status"] == "failed"
    assert result["error"].startswith("There’s no key for anthropic on your account.")
    assert _jobs(run_id=result["id"]) == []


def test_a_website_ask_keeps_the_key_path_even_with_a_fresh_desktop(client, monkeypatch):
    c, owner = fresh_account("web-ask")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")
    calls: list = []
    monkeypatch.setattr(routers, "complete", lambda request: calls.append(request))
    resp = c.post(f"/api/runs/{run_id}/nodes/{engineer}/ask", json=QUESTION)  # the website
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "no credential for provider 'anthropic'"
    assert calls == [] and _jobs(run_id=run_id) == []


# ------------------------------------------------------------------- D4 in detail: cap and line


def test_a_desktop_replays_cap_counts_from_when_the_desktop_starts_it(tmp_path, monkeypatch):
    """D4: queued past the cap it keeps waiting; once the Desktop claims it the 10 minutes (here
    0.3 s) run, then it is stopped and its job expired."""
    c, owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "x"})
    monkeypatch.setattr(agent_test_runner, "REPLAY_CAP_S", 0.3)
    monkeypatch.setattr(agent_test_runner, "_POLL_S", 0.05)

    def fake_replay(rid, cancel):
        desktop_jobs.enqueue_job(
            owner_id=owner,
            run_id=str(rid),
            node_id=eng["id"],
            iteration=1,
            invocation_id=None,
            provider="claude",
            model=CLAUDE,
            instruction="replay",
            workspace_dir=str(tmp_path),
            sidecars=[],
            purpose="test_replay",
        )
        cancel.wait(30)
        return {}

    monkeypatch.setattr(agent_test_runner, "replay", fake_replay)
    resp = c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/run", json={"desktop_target": True})
    assert resp.status_code == 202, resp.text
    result_id = resp.json()["run"]["results"][0]["id"]
    job = _wait_for(lambda: _jobs(run_id=result_id), "the replay's job")[0]
    time.sleep(1.0)  # over three caps in the queue
    assert _tests(c, team, eng["id"])["run"]["results"][0]["status"] == "running"
    assert _jobs(id=job.id)[0].status == "queued"
    with session_scope() as session:
        session.execute(
            update(DesktopNodeJob)
            .where(DesktopNodeJob.id == job.id)
            .values(status="claimed", claimed_at=datetime.now(UTC))
        )
    run = _wait_for(
        lambda: (r := _tests(c, team, eng["id"])["run"])["status"] != "running" and r,
        "the capped replay to end",
    )
    assert run["results"][0]["error"] == agent_test_runner.TOO_LONG
    assert (_jobs(id=job.id)[0].status, _jobs(id=job.id)[0].error) == (
        "expired",
        desktop_jobs.REPLAY_ENDED_ERROR,
    )


def test_a_desktop_replay_waiting_behind_another_job_shows_the_waiting_line(tmp_path, monkeypatch):
    c, owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "x"})
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)  # never starts
    run = c.post(
        f"/api/teams/{team}/nodes/{eng['id']}/tests/run", json={"desktop_target": True}
    ).json()["run"]
    result_id = run["results"][0]["id"]
    with session_scope() as session:
        session.execute(
            update(agent_test_runner.AgentTestResult)
            .where(agent_test_runner.AgentTestResult.id == uuid.UUID(result_id))
            .values(status="running")
        )

    def job(run_id, purpose, status):
        jid = desktop_jobs.enqueue_job(
            owner_id=owner,
            run_id=run_id,
            node_id="n",
            iteration=1,
            invocation_id=None,
            provider="claude",
            model=CLAUDE,
            instruction="x",
            workspace_dir=str(tmp_path),
            sidecars=[],
            purpose=purpose,
        )
        with session_scope() as session:
            session.execute(
                update(DesktopNodeJob)
                .where(DesktopNodeJob.id == uuid.UUID(jid))
                .values(status=status)
            )
        return jid

    job(result_id, "test_replay", "queued")
    other = job(str(uuid.uuid4()), "run_node", "claimed")  # a run's node holds the Claude job
    line = "Waiting for your Claude subscription — one job at a time."
    assert _tests(c, team, eng["id"])["run"]["results"][0]["waiting"] == line
    desktop_jobs.expire_job(other, "done")
    assert "waiting" not in _tests(c, team, eng["id"])["run"]["results"][0]
    c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/stop")


# ---------------------------------------------------------------------- D5 in detail: an Ask


def test_a_desktop_ask_no_desktop_picks_up_expires_with_the_offline_wording(client, monkeypatch):
    c, owner = fresh_account("desk-ask-off")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")
    ask_id = _ask(c, run_id, engineer).json()["ask_id"]
    monkeypatch.setattr(get_settings(), "desktop_runner_offline_seconds", 60.0)
    with session_scope() as session:
        session.execute(
            update(desktop_jobs.DesktopRunnerHeartbeat)
            .where(desktop_jobs.DesktopRunnerHeartbeat.owner_id == owner)
            .values(last_seen_at=datetime.now(UTC) - timedelta(minutes=5))
        )
        session.execute(
            update(DesktopNodeJob)
            .where(DesktopNodeJob.id == uuid.UUID(ask_id))
            .values(created_at=datetime.now(UTC) - timedelta(minutes=5))
        )
    view = c.get(f"/api/runs/{run_id}/nodes/{engineer}/asks/{ask_id}").json()
    assert view == {
        "ask_id": ask_id,
        "status": "failed",
        "answer": None,
        "error": "Tvashtr Desktop went offline — reopen it and retry.",
    }
    claimed = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert claimed is None  # an expired Ask is never handed out


def test_a_released_ask_ends_and_writes_nothing_into_the_asked_run(client):
    """Desktop quitting or restarting hands its jobs back; an Ask's only waiter is the chat that
    just closed with it, so a released Ask ends (offline wording) instead of being answered again
    for nobody — and its run gains no note."""
    c, owner = fresh_account("desk-ask-rel")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")
    ask_id = _ask(c, run_id, engineer).json()["ask_id"]
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    before = _events_of(run_id)
    resp = c.post(f"/api/desktop-runner/jobs/{ask_id}/release")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"job_id": ask_id, "status": "expired"}
    [job] = _jobs(id=uuid.UUID(ask_id))
    assert (job.status, job.error) == ("expired", desktop_jobs.OFFLINE_ERROR)
    assert _events_of(run_id) == before
    assert c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"] is None


def test_a_runner_never_gets_a_snapshot_of_a_job_without_a_workspace(client, tmp_path):
    """Security: an empty ``workspace_dir`` must never read as this server's own directory."""
    c, owner = fresh_account("desk-nows")
    run_id, _clone = make_run(owner, None, status="running", desktop_target=True)
    jid = desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=run_id,
        node_id="n",
        iteration=1,
        invocation_id=1,
        provider="claude",
        model=CLAUDE,
        instruction="x",
        workspace_dir="",
        sidecars=[],
    )
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    resp = c.get(f"/api/desktop-runner/jobs/{jid}/snapshot")
    assert resp.status_code == 409, resp.text


# -------------------------------------------------------------- D3 in detail: a waiting lane


def test_a_desktop_lane_waiting_for_the_desktop_shows_the_waiting_line(client, monkeypatch):
    from tvashtr.control_plane import compare

    c, _owner = fresh_account("desk-lane")
    team = _desk_versions(c)
    _connect_desktop(c, "claude", "grok")
    resp, _started, _waiters = _post(c, team, monkeypatch, desktop_target=True)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    runs = _runs_of(cid)
    line = "Waiting for your Claude subscription — one job at a time."
    try:
        engineer = clone_node(str(runs[0].team_graph_id), "engineer")
        with session_scope() as session:
            inv = AgentInvocation(
                run_id=runs[0].workflow_id,
                node_id=uuid.UUID(engineer),
                iteration=1,
                status="running",
            )
            session.add(inv)
            session.flush()
            session.add(
                RunEvent(
                    run_id=runs[0].workflow_id,
                    invocation_id=inv.id,
                    seq=1,
                    kind="message",
                    payload={"source": "tvashtr", "text": line},
                )
            )
        sides = c.get(f"/api/compares/{cid}").json()["sides"]
        assert sides[0]["current"]["text"] == line
        assert sides[0]["current"]["label"]
        # The website's lanes never show it: a waiting step is no current step there (unchanged).
        agent = {"label": "Engineer", "kind": "agent", "iteration": 1, "live_state": "waiting"}
        assert compare._current([{**agent, "activity": line}]) is None
        assert compare._current([{**agent, "activity": line}], desktop=True) == {
            "label": "Engineer",
            "text": line,
        }
    finally:
        _end(runs)


# ------------------------------------------------------------------------- the 0053 migration


def _migration():
    import importlib.util
    import pathlib

    path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0053_desktop_routes.py"
    )
    spec = importlib.util.spec_from_file_location("m0053", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_0053_is_additive_and_round_trips():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text

    from tvashtr.db import get_engine

    m = _migration()
    assert (m.revision, m.down_revision) == ("0053_desktop_routes", "0052_canvas_extras")
    probe = text(
        "SELECT (SELECT count(*) FROM information_schema.columns WHERE "
        "(table_name = 'desktop_node_jobs' AND column_name = 'purpose') OR "
        "(table_name = 'agent_test_runs' AND column_name = 'desktop_target')), "
        "to_regclass('public.compare_desktop_targets') IS NOT NULL"
    )
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            assert tuple(conn.execute(probe).one()) == (2, True)
            with Operations.context(MigrationContext.configure(conn)):
                m.downgrade()
                assert tuple(conn.execute(probe).one()) == (0, False)
                m.upgrade()
            assert tuple(conn.execute(probe).one()) == (2, True)
            default = conn.execute(
                text(
                    "SELECT column_default FROM information_schema.columns "
                    "WHERE table_name = 'desktop_node_jobs' AND column_name = 'purpose'"
                )
            ).scalar_one()
            assert "run_node" in default  # every existing job reads as a run's node
        finally:
            tx.rollback()


# ------------------------------------------------------- review fixes: no job without a waiter


def _age(job_id: str, **values) -> None:
    with session_scope() as session:
        session.execute(
            update(DesktopNodeJob).where(DesktopNodeJob.id == uuid.UUID(job_id)).values(**values)
        )


def test_a_claimed_ask_whose_desktop_died_never_wedges_that_plan(client, monkeypatch):
    """An Ask (or a replay whose server restarted) has no waiter: a claim gone quiet past the
    offline window is expired by the next poll, so the plan's next job is handed out."""
    c, owner = fresh_account("desk-wedge")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")
    ask_id = _ask(c, run_id, engineer).json()["ask_id"]
    assert c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    stale = datetime.now(UTC) - timedelta(minutes=10)
    _age(ask_id, heartbeat_at=stale, claimed_at=stale)  # its Desktop crashed mid-answer
    replay = desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=str(uuid.uuid4()),
        node_id="n",
        iteration=1,
        invocation_id=None,
        provider="grok",
        model=GROK,
        instruction="x",
        workspace_dir="/tmp",
        sidecars=[],
        purpose="test_replay",
    )
    _age(replay, status="claimed", heartbeat_at=stale, claimed_at=stale)
    run_node_run, _clone = make_run(owner, None, status="running", desktop_target=True)
    nxt = desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=run_node_run,
        node_id="eng",
        iteration=1,
        invocation_id=1,
        provider="claude",
        model=CLAUDE,
        instruction="build",
        workspace_dir="/tmp",
        sidecars=[],
    )
    got = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert got is not None and got["id"] == nxt
    for jid in (ask_id, replay):
        [job] = _jobs(id=uuid.UUID(jid))
        assert (job.status, job.error) == ("expired", desktop_jobs.OFFLINE_ERROR)


def test_an_ask_nobody_reads_is_never_handed_to_a_later_desktop(client):
    """The chat's 2 s poll is a queued Ask's waiter: one nobody has polled for the offline window
    expires instead of spending the subscription on an answer nobody reads."""
    c, owner = fresh_account("desk-unread")
    run_id, engineer = _asked_run(c, owner)
    _connect_desktop(c, "claude")
    old = datetime.now(UTC) - timedelta(minutes=10)
    unread = _ask(c, run_id, engineer).json()["ask_id"]
    _age(unread, created_at=old)
    read = _ask(c, run_id, engineer).json()["ask_id"]
    _age(read, created_at=old)
    desktop_jobs.heartbeat(owner, ["claude"])  # the Desktop is here, offering Claude
    assert c.get(f"/api/runs/{run_id}/nodes/{engineer}/asks/{read}").json()["status"] == "queued"
    got = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert got is not None and got["id"] == read  # the polled one waits its turn
    [job] = _jobs(id=uuid.UUID(unread))
    assert (job.status, job.error) == ("expired", desktop_jobs.OFFLINE_ERROR)


# ---------------------------------------------------------- review fixes: work time when ended


def test_a_stopped_desktop_lanes_work_time_stops_growing(client, monkeypatch):
    from tvashtr.control_plane import compare

    c, owner = fresh_account("desk-stopped")
    run_id, clone = make_run(owner, None, status="cancelled", desktop_target=True)
    engineer = clone_node(clone, "engineer")
    start = datetime.now(UTC) - timedelta(minutes=30)
    with session_scope() as session:
        inv = AgentInvocation(  # its close step was cancelled: never ended
            run_id=run_id,
            node_id=uuid.UUID(engineer),
            iteration=1,
            status="running",
            started_at=start,
        )
        session.add(inv)
        session.flush()
        inv_id = inv.id
    job = desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=run_id,
        node_id=engineer,
        iteration=1,
        invocation_id=inv_id,
        provider="claude",
        model=CLAUDE,
        instruction="x",
        workspace_dir="/tmp",
        sidecars=[],
    )
    _age(
        job,
        status="expired",
        created_at=start,
        claimed_at=start + timedelta(minutes=2),
        finished_at=start + timedelta(minutes=7),
    )
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(run_id))
        first = compare._work_seconds(session, run)
        monkeypatch.setattr(compare, "_now", lambda: datetime.now(UTC) + timedelta(hours=3))
        later = compare._work_seconds(session, run)
    assert first == later == 300  # claimed at +2m, ended (expired) at +7m


def test_a_desktop_compare_with_no_lane_on_the_desktop_keeps_time(client, monkeypatch):
    """D3's Work time is for lanes that share a subscription: a Desktop compare whose models route
    to no subscription (here: on held keys) keeps the Time row and adds no line."""
    c, _owner = fresh_account("desk-keys")
    team = _desk_versions(c)
    for provider in ("anthropic", "xai"):
        c.post("/api/providers", json={"provider": provider, "api_key": f"sk-{provider}"})
    resp, _started, _waiters = _post(c, team, monkeypatch, desktop_target=True)  # no Desktop
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    runs = _runs_of(cid)
    assert [(r.desktop_target, r.desktop_subscriptions) for r in runs] == [(True, []), (True, [])]
    with session_scope() as session:
        session.execute(update(Run).where(Run.pair_id == uuid.UUID(cid)).values(status="completed"))
    results = c.get(f"/api/compares/{cid}").json()["results"]
    assert next(r for r in results["rows"] if r["key"] == "time")["label"] == "Time"
    assert "note" not in results


def test_a_stopped_lanes_open_step_without_a_job_ends_at_its_last_line(client):
    """A step on a held key (no Desktop job) that a Stop left open counts up to its last line."""
    from tvashtr.control_plane import compare

    c, owner = fresh_account("desk-open")
    run_id, clone = make_run(owner, None, status="cancelled", desktop_target=True)
    engineer = clone_node(clone, "engineer")
    start = datetime.now(UTC) - timedelta(minutes=40)
    with session_scope() as session:
        inv = AgentInvocation(
            run_id=run_id,
            node_id=uuid.UUID(engineer),
            iteration=1,
            status="running",
            started_at=start,
        )
        session.add(inv)
        session.flush()
        session.add(
            RunEvent(
                run_id=run_id,
                invocation_id=inv.id,
                seq=3,
                kind="message",
                payload={"source": "agent", "text": "still editing"},
                created_at=start + timedelta(minutes=20),
            )
        )
    with session_scope() as session:
        assert compare._work_seconds(session, session.get(Run, uuid.UUID(run_id))) == 1200


def test_lanes_that_share_no_subscription_keep_the_time_row(client, monkeypatch):
    """D3's line is about lanes taking turns on ONE subscription: v1 on the Desktop, v2 on held keys
    (no subscription in common) keeps the website's Time row and adds no line."""
    c, _owner = fresh_account("desk-noshare")
    team = _desk_team(c)
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1: Claude + Grok
    c.post("/api/providers", json={"provider": "openai", "api_key": "sk-openai"})
    for n in _graph(c, team)["nodes"]:
        if n.get("model"):
            resp = c.patch(f"/api/teams/{team}/nodes/{n['id']}", json={"model": "openai/gpt-4.1"})
            assert resp.status_code == 200, resp.text
    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v2: OpenAI key
    _connect_desktop(c, "claude", "grok")
    resp, _started, _waiters = _post(c, team, monkeypatch, desktop_target=True)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    runs = _runs_of(cid)
    assert [r.desktop_subscriptions for r in runs] == [["claude", "grok"], []]
    with session_scope() as session:
        session.execute(update(Run).where(Run.pair_id == uuid.UUID(cid)).values(status="completed"))
    results = c.get(f"/api/compares/{cid}").json()["results"]
    assert next(r for r in results["rows"] if r["key"] == "time")["label"] == "Time"
    assert "note" not in results
