"""M-desk-5 — what V1's live footage found (brief ``prompts/m-desk-5-v2.md``).

L1: a Desktop step writes a $0 usage row (``team_run`` meters any step with tokens; the Desktop
adapter returns the CLI's token counts at ``cost_usd=0.0``). That row is the subscription's usage
record, not key spend, so a run done only on subscriptions reads "on your Claude and Grok
subscriptions" — from launch (its routes) to Done. Key work that did not run as one of the run's
Desktop jobs still counts. Before a Desktop test or compare has its first job, it names the
subscription it is routed to. The rows here are written the way ``team_run`` and the Desktop
adapter write them: the step's invocation, its job claimed and completed through the runner API,
the adapter's result, and ``persist_agent_cost_step``.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from home_fixtures import clone_node, fresh_account, make_run
from sqlalchemy import select, update
from test_agent_tests import _create, _tests
from test_compare import _node, _seed_compare
from test_desk_routes import _desk_tests_account, _desk_versions
from test_desktop_subscription_launch import _connect_desktop
from test_task_sets import _make_set, _seed_set_compare

from tvashtr.control_plane import agent_test_runner, desktop_jobs
from tvashtr.control_plane.team_run import open_invocation_step, persist_agent_cost_step
from tvashtr.db import session_scope
from tvashtr.engines.desktop_runner_adapter import DesktopRunnerAdapter
from tvashtr.metering import record_embedding_cost
from tvashtr.models import CompareDesktopTarget, CostRecord, Run

CLAUDE_MODEL = "anthropic/claude-sonnet-5"
GROK_MODEL = "xai/grok-4.7"
MODELS = {"claude": CLAUDE_MODEL, "grok": GROK_MODEL}
BOTH = {"subscriptions": ["claude", "grok"], "all": True}
NONE = {"subscriptions": [], "all": False}


# ------------------------------------------------------------------------------------ helpers


def _desk_run(owner, team: str, plans: list[str], status: str = "running") -> tuple[str, str]:
    now = datetime.now(UTC)
    return make_run(
        owner,
        team,
        status=status,
        team_version_number=1,
        desktop_target=True,
        desktop_subscriptions=plans,
        created_at=now - timedelta(minutes=30),
        updated_at=now,
    )


def _usage(prompt: int, completion: int, cost: float) -> dict:
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "cost_usd": cost,
    }


def _desktop_step(c, owner, run_id: str, clone: str, role: str, provider: str) -> int:
    """One step done on the Desktop, as a real run writes it: ``team_run`` opens the invocation,
    the adapter queues its job, the runner claims it and posts the CLI's result, the adapter
    returns the CLI's token counts at $0, and ``team_run`` meters that usage."""
    node = clone_node(clone, role)
    inv = open_invocation_step(run_id, node, 1)
    job = desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=run_id,
        node_id=node,
        iteration=1,
        invocation_id=inv,
        provider=provider,
        model=MODELS[provider],
        instruction="build it",
        workspace_dir="/nonexistent",
        sidecars=[],
    )
    claimed = c.post("/api/desktop-runner/claim", json={"providers": [provider]}).json()["job"]
    assert claimed["id"] == job
    done = c.post(
        f"/api/desktop-runner/jobs/{job}/result",
        json={
            "status": "completed",
            "final_text": "ok",
            "patch": "",
            "usage": {"prompt_tokens": 1200, "completion_tokens": 300, "total_tokens": 1500},
        },
    )
    assert done.status_code == 200, done.text
    task = SimpleNamespace(workspace_dir="/nonexistent", pull_paths=None)
    result = DesktopRunnerAdapter._completed(desktop_jobs.get_job(job), task)
    assert (result.total_tokens, result.cost_usd) == (1500, 0.0)
    if result.total_tokens or result.cost_usd:  # team_run's metering rule
        usage = _usage(result.prompt_tokens, result.completion_tokens, result.cost_usd)
        persist_agent_cost_step(run_id, node, MODELS[provider], usage, 1, inv)
    return inv


def _keyed_step(run_id: str, clone: str, role: str, cost: float) -> None:
    """A step that ran on a key (e.g. the DeepSeek Fixer): an invocation, metered, no job."""
    node = clone_node(clone, role)
    inv = open_invocation_step(run_id, node, 1)
    persist_agent_cost_step(run_id, node, "deepseek/deepseek-chat", _usage(900, 100, cost), 1, inv)


def _finish(run_id: str) -> None:
    """The run ends as ``team_run`` ends it: its total is the sum of its cost rows."""
    with session_scope() as session:
        total = sum(
            float(r)
            for r in session.execute(
                select(CostRecord.cost_usd).where(CostRecord.workflow_id == run_id)
            ).scalars()
        )
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(status="completed", cost_total_usd=total)
        )


def _done_line(c, run_id: str, desktop: bool = True) -> str:
    q = "?desktop_target=1" if desktop else ""
    lines = c.get(f"/api/runs/{run_id}/activity{q}").json()["lines"]
    return next(ln for ln in lines if ln["id"] == "run:done")["text"]


# ------------------------------------------------------------------------------------- L1


def test_l1_a_run_done_only_on_subscriptions_reads_on_them_despite_its_usage_rows(client):
    c, owner = fresh_account("desk5-l1-subs")
    team = _desk_versions(c)
    run_id, clone = _desk_run(owner, team, ["claude", "grok"])
    _desktop_step(c, owner, run_id, clone, "engineer", "claude")
    _desktop_step(c, owner, run_id, clone, "reviewer", "grok")
    with session_scope() as session:  # V1's shape: a $0 usage row per Desktop step
        rows = session.execute(
            select(CostRecord.cost_usd, CostRecord.invocation_id).where(
                CostRecord.workflow_id == run_id
            )
        ).all()
    assert len(rows) == 2 and all(float(cost) == 0 and inv for cost, inv in rows)
    assert c.get(f"/api/runs/{run_id}?desktop_target=1").json()["run"]["ran_on"] == BOTH
    _finish(run_id)
    assert c.get(f"/api/runs/{run_id}?desktop_target=1").json()["run"]["ran_on"] == BOTH
    line = _done_line(c, run_id)
    assert line.startswith("Done in ") and line.endswith(
        " · on your Claude and Grok subscriptions"
    ), line
    # The website: unchanged.
    assert "ran_on" not in c.get(f"/api/runs/{run_id}").json()["run"]
    assert _done_line(c, run_id, desktop=False).endswith(" · $0.00")


def test_l1_key_work_that_did_not_run_as_a_desktop_job_still_counts(client):
    c, owner = fresh_account("desk5-l1-keyed")
    team = _desk_versions(c)
    # The Engineer on the Claude plan; the Fixer on a DeepSeek key ($0.03).
    fixer, clone = _desk_run(owner, team, ["claude"])
    _desktop_step(c, owner, fixer, clone, "engineer", "claude")
    _keyed_step(fixer, clone, "reviewer", 0.03)
    _finish(fixer)
    assert c.get(f"/api/runs/{fixer}?desktop_target=1").json()["run"]["ran_on"] == {
        "subscriptions": ["claude"],
        "all": False,
    }
    assert _done_line(c, fixer).endswith(" · $0.03 + your Claude subscription")
    # Run-level key work (an embedding: no invocation) counts too.
    embedded, clone = _desk_run(owner, team, ["claude"])
    _desktop_step(c, owner, embedded, clone, "engineer", "claude")
    record_embedding_cost(
        workflow_id=embedded,
        idempotency_key=f"{embedded}:embed",
        model="openai/text-embedding-3-small",
        prompt_tokens=40,
        total_tokens=40,
        cost_usd=0.0001,
    )
    _finish(embedded)
    ran = c.get(f"/api/runs/{embedded}?desktop_target=1").json()["run"]["ran_on"]
    assert ran == {"subscriptions": ["claude"], "all": False}


def test_l1_a_live_desktop_run_names_its_routed_plans_before_its_first_job(client):
    c, owner = fresh_account("desk5-l1-launch")
    team = _desk_versions(c)
    run_id, _ = _desk_run(owner, team, ["claude", "grok"])
    assert c.get(f"/api/runs/{run_id}?desktop_target=1").json()["run"]["ran_on"] == BOTH
    # Once it has ended, only what really ran counts: nothing did.
    _finish(run_id)
    assert c.get(f"/api/runs/{run_id}?desktop_target=1").json()["run"]["ran_on"] == NONE
    # A website run has no routes.
    web, _ = make_run(owner, team, status="running")
    assert c.get(f"/api/runs/{web}?desktop_target=1").json()["run"]["ran_on"] == NONE


def test_l1_a_desktop_test_names_its_subscription_before_its_first_job(tmp_path, monkeypatch):
    c, owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "x"})
    _connect_desktop(c, "claude")
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)  # no job yet
    claude = {"subscriptions": ["claude"], "all": True}
    try:
        started = c.post(
            f"/api/teams/{team}/nodes/{eng['id']}/tests/run", json={"desktop_target": True}
        ).json()["run"]
        assert started["ran_on"] == claude
        url = f"/api/teams/{team}/nodes/{eng['id']}/tests"
        assert c.get(f"{url}?desktop_target=1").json()["run"]["ran_on"] == claude
        assert "ran_on" not in _tests(c, team, eng["id"])["run"]  # the website's read
    finally:
        c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/stop")


def test_l1_a_desktop_compare_waiting_for_a_slot_names_its_routed_plans(client):
    c, owner = fresh_account("desk5-l1-cmp")
    team = _desk_versions(c)  # PM on Grok, Engineer + Reviewer on Claude
    _connect_desktop(c, "claude", "grok")
    cid = _seed_compare(team, owner, status="waiting")
    with session_scope() as session:
        session.add(CompareDesktopTarget(compare_id=uuid.UUID(cid)))
    desk = c.get(f"/api/compares/{cid}?desktop_target=1").json()
    assert desk["ran_on"] == BOTH
    assert [s["ran_on"] for s in desk["sides"]] == [BOTH, BOTH]
    web = c.get(f"/api/compares/{cid}").json()
    assert "ran_on" not in web and all("ran_on" not in s for s in web["sides"])


def test_l1_a_desktop_set_compare_before_its_first_run_names_its_routed_plans(client):
    c, owner = fresh_account("desk5-l1-set")
    team = _desk_versions(c)
    _connect_desktop(c, "claude", "grok")
    cid = _seed_set_compare(team, owner, _make_set(c, team), status="waiting")
    with session_scope() as session:
        session.add(CompareDesktopTarget(compare_id=uuid.UUID(cid)))
    desk = c.get(f"/api/compares/{cid}?desktop_target=1").json()
    assert desk["ran_on"] == BOTH
    assert [s["ran_on"] for s in desk["sides"]] == [BOTH, BOTH]
    assert "ran_on" not in c.get(f"/api/compares/{cid}").json()
