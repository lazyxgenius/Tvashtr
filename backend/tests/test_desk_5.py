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

import dataclasses
import io
import shutil
import subprocess
import tarfile
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from home_fixtures import clone_node, fresh_account, make_run
from sqlalchemy import delete, select, update
from test_agent_tests import _create, _tests
from test_compare import _node, _seed_compare
from test_desk_routes import _desk_tests_account, _desk_versions
from test_desktop_subscription_launch import _connect_desktop
from test_task_sets import _make_set, _seed_set_compare

from tvashtr.config import get_settings
from tvashtr.control_plane import agent_test_runner, desktop_jobs
from tvashtr.control_plane.team_run import open_invocation_step, persist_agent_cost_step
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentTask, DesktopJobSpec
from tvashtr.engines.desktop_runner_adapter import SIDECARS, DesktopRunnerAdapter
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


def _replay_rows(c, team, eng, made, n: int) -> tuple[dict, list[uuid.UUID]]:
    """A Desktop test run of ``n`` tests started (no replay worker): its view and result ids."""
    for i in range(n):
        _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": f"x{i}"})
    run = c.post(
        f"/api/teams/{team}/nodes/{eng['id']}/tests/run", json={"desktop_target": True}
    ).json()["run"]
    return run, [uuid.UUID(r["id"]) for r in run["results"]]


def _result(rid: uuid.UUID, **values) -> None:
    from tvashtr.models import AgentTestResult

    with session_scope() as session:
        session.execute(update(AgentTestResult).where(AgentTestResult.id == rid).values(**values))


def _replay_job(owner, rid: uuid.UUID, tmp_path) -> None:
    desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=str(rid),
        node_id="n",
        iteration=1,
        invocation_id=None,
        provider="claude",
        model=CLAUDE_MODEL,
        instruction="x",
        workspace_dir=str(tmp_path),
        sidecars=[],
        purpose=desktop_jobs.TEST_REPLAY,
    )


def test_l1_a_desktop_tests_line_counts_only_replays_that_did_work(tmp_path, monkeypatch):
    """Review: replay 1 ran on the Claude plan; replay 2 is set up but has no job yet, then is
    stopped — neither is key work, so the line stays "on your Claude subscription"."""
    c, owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _connect_desktop(c, "claude")
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    claude = {"subscriptions": ["claude"], "all": True}
    url = f"/api/teams/{team}/nodes/{eng['id']}/tests"
    _, (first, second) = _replay_rows(c, team, eng, made, 2)
    try:
        _replay_job(owner, first, tmp_path)
        _result(first, status="passed")
        _result(second, status="running")  # its job isn't there yet (setting up)
        assert c.get(f"{url}?desktop_target=1").json()["run"]["ran_on"] == claude
        stopped = c.post(f"{url}/stop").json()["run"]
        assert stopped["ran_on"] == claude
    finally:
        c.post(f"{url}/stop")


def test_l1_a_desktop_tests_key_spend_is_never_hidden_by_the_routes(tmp_path, monkeypatch):
    """Review: replay 1 ran on a key ($0.14, no job) before the runner was fresh; the routes now
    say Claude, but the line still shows the key spend."""
    c, owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _connect_desktop(c, "claude")
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    url = f"/api/teams/{team}/nodes/{eng['id']}/tests"
    _, (first, _second) = _replay_rows(c, team, eng, made, 2)
    try:
        _result(first, status="passed", cost_usd=0.14)
        assert c.get(f"{url}?desktop_target=1").json()["run"]["ran_on"] == NONE
    finally:
        c.post(f"{url}/stop")


def test_l1_a_compare_lane_that_did_no_work_is_not_key_work(client):
    from test_compare import _side

    c, owner = fresh_account("desk5-l1-cmp-nowork")
    team = _desk_versions(c)
    cid = _seed_compare(team, owner, status="finished")
    with session_scope() as session:
        session.add(CompareDesktopTarget(compare_id=uuid.UUID(cid)))
    a = _side(owner, team, cid, "A", 1)  # ran wholly on Claude
    b = _side(owner, team, cid, "B", 2, status="failed", rounds=0)  # ended before any step
    with session_scope() as session:  # neither spent on a key
        session.execute(delete(CostRecord).where(CostRecord.workflow_id.in_([a, b])))
    desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=a,
        node_id="n",
        iteration=1,
        invocation_id=None,
        provider="claude",
        model=CLAUDE_MODEL,
        instruction="x",
        workspace_dir="/nonexistent",
        sidecars=[],
    )
    desk = c.get(f"/api/compares/{cid}?desktop_target=1").json()
    assert desk["ran_on"] == {"subscriptions": ["claude"], "all": True}


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


# ------------------------------------------------------------------------------------- L2

OWN = {"REPORT.md", "REVIEW_VERDICT.json", "SPEC.md", "TVASHTR_REMEMBER.jsonl"}
VERDICT_ONLY = ("REVIEW_VERDICT.json",)
_GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]


@pytest.fixture
def _fast_runner(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "desktop_runner_poll_seconds", 0.05)
    monkeypatch.setattr(s, "desktop_runner_offline_seconds", 5.0)


def _clone_like(tmp_path: Path) -> Path:
    """A GitHub run's clone: the user's repo, with no Tvashtr .gitignore."""
    ws = tmp_path / "clone"
    (ws / "core").mkdir(parents=True)
    (ws / "README.md").write_text("# trade_mcp\n")
    (ws / "core" / "indicators.py").write_text("def sma(): ...\n")
    subprocess.run([*_GIT, "init", "-q"], cwd=ws, check=True)
    subprocess.run([*_GIT, "add", "-A"], cwd=ws, check=True)
    subprocess.run([*_GIT, "commit", "-q", "-m", "base"], cwd=ws, check=True)
    return ws


def _snapshot(c, job_id: str, into: Path) -> set[str]:
    resp = c.get(f"/api/desktop-runner/jobs/{job_id}/snapshot")
    assert resp.status_code == 200, resp.text
    into.mkdir()
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        tar.extractall(into, filter="data")
    return {str(p.relative_to(into)) for p in into.rglob("*") if p.is_file()}


def _desktop_job(c, job: dict, copy: Path, edits: dict[str, str]) -> str:
    """What the Desktop runner does with a claimed job (``workspace.cjs``): its own copy of the
    snapshot committed as the base (sidecars force-added), the CLI's edits, then the change as
    ``git diff --binary`` against that base. Returns the patch it posts home."""
    names = _snapshot(c, job["id"], copy)

    def stage():
        subprocess.run([*_GIT, "add", "-A"], cwd=copy, check=True)
        present = [s for s in job["sidecars"] if (copy / s).exists()]
        if present:
            subprocess.run([*_GIT, "add", "-f", "--", *present], cwd=copy, check=True)

    subprocess.run([*_GIT, "init", "-q"], cwd=copy, check=True)
    stage()
    subprocess.run([*_GIT, "commit", "-q", "--allow-empty", "-m", "base"], cwd=copy, check=True)
    for name, text in edits.items():
        (copy / name).write_text(text)
    stage()
    diff = subprocess.run(
        [*_GIT, "diff", "--cached", "--binary", "HEAD"],
        cwd=copy,
        check=True,
        capture_output=True,
        text=True,
    )
    assert names  # the copy holds the repo
    return diff.stdout


def _desktop_node(c, owner, run_id, ws, *, node, iteration, provider, pull_paths, edits, copy):
    """One node done on the Desktop through the real adapter: it queues the job, the runner claims
    it, works on its copy and posts the patch; the adapter applies it to the run workspace."""
    task = AgentTask(
        instruction="do the step",
        workspace_dir=str(ws),
        model=MODELS[provider],
        pull_paths=pull_paths,
        desktop=DesktopJobSpec(
            run_id=run_id,
            node_id=node,
            iteration=iteration,
            invocation_id=None,
            owner_id=str(owner),
            provider=provider,
        ),
    )
    box: dict = {}
    t = threading.Thread(target=lambda: box.update(r=DesktopRunnerAdapter().run(task)))
    t.start()
    deadline = time.time() + 10
    job = None
    while job is None and time.time() < deadline:
        job = c.post("/api/desktop-runner/claim", json={"providers": [provider]}).json()["job"]
        time.sleep(0.05)
    assert job is not None, "no job was queued"
    names = _snapshot(c, job["id"], copy.with_name(copy.name + "-seen"))
    patch = _desktop_job(c, job, copy, edits)
    resp = c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={"status": "completed", "final_text": "done", "patch": patch},
    )
    assert resp.status_code == 200, resp.text
    t.join(10)
    assert box["r"].status == "completed", box["r"].error
    return job, names, box["r"]


def test_l2_the_reviewers_desktop_job_is_not_given_tvashtrs_own_files(tmp_path, _fast_runner):
    """V1's shape: the PM's REPORT.md and the Engineer's remember line sit in the clone; the Grok
    Reviewer's job is given the user's change only — yet both files stay for the harvests, and the
    Engineer's next round still sees and carries home its remember file."""
    c, owner = fresh_account("desk5-l2")
    run_id, _ = make_run(
        owner, None, status="running", desktop_target=True, desktop_subscriptions=["claude"]
    )
    ws = _clone_like(tmp_path)
    remembered = '{"fact": "indicators live in core/indicators.py"}\n'
    readme = "# trade_mcp\nIndicators live in core/indicators.py.\n"
    _desktop_node(
        c,
        owner,
        run_id,
        ws,
        node="pm",
        iteration=1,
        provider="claude",
        pull_paths=("REPORT.md", "REVIEW_VERDICT.json"),
        edits={"REPORT.md": "# PRD\nAdd one line.\n"},
        copy=tmp_path / "pm",
    )
    _desktop_node(
        c,
        owner,
        run_id,
        ws,
        node="eng",
        iteration=1,
        provider="claude",
        pull_paths=None,
        edits={"README.md": readme, "TVASHTR_REMEMBER.jsonl": remembered},
        copy=tmp_path / "eng1",
    )
    assert {"REPORT.md", "TVASHTR_REMEMBER.jsonl"} <= {p.name for p in ws.iterdir()}

    job, seen, result = _desktop_node(
        c,
        owner,
        run_id,
        ws,
        node="rev",
        iteration=1,
        provider="claude",
        pull_paths=VERDICT_ONLY,
        edits={"REVIEW_VERDICT.json": '{"verdict": "approved"}\n', "REPORT.md": "stray\n"},
        copy=tmp_path / "rev",
    )
    assert {"README.md", "core/indicators.py"} <= seen
    assert not seen & OWN, f"the Reviewer was given Tvashtr's own files: {sorted(seen & OWN)}"
    assert job["sidecars"] == list(VERDICT_ONLY)
    assert result.files_changed == ["REVIEW_VERDICT.json"]
    # The harvests still find what earlier steps left; the Reviewer's stray report never lands.
    assert (ws / "REPORT.md").read_text() == "# PRD\nAdd one line.\n"
    assert (ws / "TVASHTR_REMEMBER.jsonl").read_text() == remembered

    (ws / "REVIEW_VERDICT.json").unlink()  # team_run harvests + removes the verdict
    job, seen, _ = _desktop_node(
        c,
        owner,
        run_id,
        ws,
        node="eng",
        iteration=2,
        provider="claude",
        pull_paths=None,
        edits={"TVASHTR_REMEMBER.jsonl": remembered + '{"fact": "keep it to one line"}\n'},
        copy=tmp_path / "eng2",
    )
    assert sorted(job["sidecars"]) == sorted(SIDECARS)
    assert {"REPORT.md", "TVASHTR_REMEMBER.jsonl"} <= seen
    assert len((ws / "TVASHTR_REMEMBER.jsonl").read_text().splitlines()) == 2


def test_l2_hidden_own_files_follow_what_the_job_carries_home(tmp_path):
    from tvashtr.control_plane.shipping import hidden_own_files

    ws = _clone_like(tmp_path)
    for name in ("REPORT.md", "TVASHTR_REMEMBER.jsonl", "SPEC.md"):
        (ws / name).write_text("x\n")
    assert hidden_own_files(str(ws), None) == set()  # a worker carries everything
    assert hidden_own_files(str(ws), VERDICT_ONLY) == {"REPORT.md", "TVASHTR_REMEMBER.jsonl"}
    assert hidden_own_files(str(ws), ("REPORT.md", "REVIEW_VERDICT.json")) == {
        "TVASHTR_REMEMBER.jsonl"
    }
    # A REPORT.md the user's repo tracks is the user's own file.
    subprocess.run([*_GIT, "add", "REPORT.md"], cwd=ws, check=True)
    subprocess.run([*_GIT, "commit", "-q", "-m", "user report"], cwd=ws, check=True)
    assert hidden_own_files(str(ws), VERDICT_ONLY) == {"TVASHTR_REMEMBER.jsonl"}


@pytest.mark.parametrize("mode", ["brownfield", "greenfield"])
def test_l2_the_websites_reviewer_container_is_not_seeded_with_tvashtrs_own_files(tmp_path, mode):
    from tvashtr.engines import openhands_docker_adapter as docker

    ws = _clone_like(tmp_path)
    if mode == "greenfield":
        shutil.rmtree(ws / ".git")
    (ws / "REPORT.md").write_text("# PRD\n")
    (ws / "TVASHTR_REMEMBER.jsonl").write_text("{}\n")

    def pushed(pull_paths):
        box = MagicMock(working_dir="/workspace")
        box.file_upload.return_value = MagicMock(success=True)
        return set(docker._push_workspace(box, str(ws), mode, pull_paths=pull_paths))

    reviewer = pushed(VERDICT_ONLY)
    assert {"README.md", "core/indicators.py"} <= reviewer and not reviewer & OWN
    assert {"REPORT.md", "TVASHTR_REMEMBER.jsonl"} <= pushed(None)  # the Engineer's view


def test_l2_the_docker_and_fly_adapters_seed_with_the_nodes_pull_scope(tmp_path):
    from test_fly_adapter import _Ctx

    from tvashtr.engines import openhands_docker_adapter as docker
    from tvashtr.engines import openhands_fly_adapter as fly
    from tvashtr.engines import sandbox_cache

    (tmp_path / "REPORT.md").write_text("# PRD\n")
    (tmp_path / "app.py").write_text("x = 1\n")
    task = AgentTask(
        instruction="review",
        workspace_dir=str(tmp_path),
        model="m",
        llm_api_key="byok",
        pull_paths=VERDICT_ONLY,
    )
    box = MagicMock(working_dir="/workspace", host_port=1, _container_id="a" * 64)
    box.execute_command.return_value = MagicMock(stdout="", exit_code=0)
    with (
        patch.object(docker, "reap_agent_containers"),
        patch.object(docker, "DockerWorkspace", return_value=box),
        patch.object(docker, "Conversation"),
        patch.object(docker, "LLM"),
        patch.object(docker, "Agent"),
        patch.object(docker, "LLMSummarizingCondenser"),
        patch.object(docker, "Tool"),
        patch.object(docker, "TerminalTool"),
        patch.object(docker, "FileEditorTool"),
        patch.object(docker, "_push_workspace", return_value=[]) as push,
    ):
        docker.OpenHandsDockerAdapter().run(task)
    assert push.call_args.kwargs["pull_paths"] == VERDICT_ONLY
    try:
        with _Ctx() as ctx:
            fly.OpenHandsFlyAdapter().run(dataclasses.replace(task, session_key="run-l2::rev"))
        uploaded = {Path(c.args[1]).name for c in ctx.workspaces[0].file_upload.call_args_list}
        assert "app.py" in uploaded and "REPORT.md" not in uploaded
    finally:
        fly._RUNS.clear()
        sandbox_cache.clear()


# ------------------------------------------------------------------------------------- L3


def _shipped_github_run(client, monkeypatch, tmp_path) -> tuple[str, dict]:
    """A GitHub run's row exactly as ``team_run`` writes it: the clone step sets ``repo_path`` (a
    clone under ``.tvashtr_clones``), the run's worktree ships its branch, the delivery step records
    the PR; the run completes and M-clonegc deletes its clone. Returns ``(run id, the Changes read
    while the clone was there)``."""
    from conftest import auth_user_id
    from test_hosted_github_run import _REPO, _make_hosted_run, _mock_repos, _seed_installation

    from tvashtr.control_plane import clone_reaper, github_app
    from tvashtr.control_plane.shipping import idempotent_ship
    from tvashtr.control_plane.team_run import clone_github_repo_step, push_and_open_pr_step
    from tvashtr.control_plane.worktree import add_worktree, resolve_start_point

    _seed_installation(auth_user_id(), uuid.uuid4().int % 2_000_000_000)
    _mock_repos(monkeypatch, [{"full_name": _REPO, "default_branch": "main"}])
    upstream = _clone_like(tmp_path)
    subprocess.run([*_GIT, "branch", "-M", "main"], cwd=upstream, check=True)
    monkeypatch.setattr(
        github_app,
        "clone_repo",
        lambda inst, full, dest: subprocess.run(
            ["git", "clone", "-q", str(upstream), dest], check=True
        ),
    )
    monkeypatch.setattr(github_app, "push_branch", lambda *a, **k: None)
    monkeypatch.setattr(
        github_app,
        "open_pull_request_idempotent",
        lambda *a, **k: "https://github.com/lazyxgenius/trade_mcp/pull/5",
    )
    rid = str(_make_hosted_run(base_ref="main"))
    clone_github_repo_step(rid)
    with session_scope() as session:
        repo_path = session.get(Run, uuid.UUID(rid)).repo_path
    assert repo_path == clone_reaper.clone_dir_for_run(rid)
    ws = tmp_path / "ws"
    branch = add_worktree(repo_path, str(ws), rid, resolve_start_point(repo_path, "main"))
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(rid)).values(ship_branch=branch))
    (ws / "README.md").write_text("# trade_mcp\nIndicators live in core/indicators.py.\n")
    idempotent_ship(str(ws), rid)
    push_and_open_pr_step(rid, str(ws), branch)
    before = client.get(f"/api/runs/{rid}/diff").json()
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(rid)).values(status="completed"))
    subprocess.run(["git", "-C", repo_path, "worktree", "remove", "--force", str(ws)], check=True)
    assert clone_reaper.delete_run_clone(rid) is True
    return rid, before


def _github_files(before: dict) -> list[dict]:
    """GitHub's file entries for the run's change (a PR's Files changed, or a compare's files)."""
    return [
        {
            "filename": f["path"],
            "status": f["status"],
            "additions": f["additions"],
            "deletions": f["deletions"],
            "changes": f["additions"] + f["deletions"],
            "patch": f["patch"][f["patch"].index("@@") :].rstrip("\n"),
        }
        for f in before["files"]
    ]


@pytest.mark.parametrize("pr", [True, False])
def test_l3_a_finished_github_runs_changes_come_from_github(client, monkeypatch, tmp_path, pr):
    """With a pull request: its Files changed (right after a merge-commit merge too, where the
    branch comparison is empty); without one: the comparison of its base and ship branch."""
    from tvashtr.control_plane import github_app

    rid, before = _shipped_github_run(client, monkeypatch, tmp_path)
    assert [f["path"] for f in before["files"]] == ["README.md"]  # today's read, clone there
    if not pr:
        with session_scope() as session:
            session.execute(update(Run).where(Run.id == uuid.UUID(rid)).values(pr_url=None))
    asked = []

    def fake_http(method, url, *, token=None, body=None, accept=None):
        asked.append((method, url, token))
        files = _github_files(before)
        return files if "/pulls/" in url else {"status": "ahead", "files": files}

    monkeypatch.setattr(github_app, "get_installation_token", lambda inst: "TOK")
    monkeypatch.setattr(github_app, "_http", fake_http)
    after = client.get(f"/api/runs/{rid}/diff").json()
    repo = "https://api.github.com/repos/lazyxgenius/trade_mcp"
    want = (
        f"{repo}/pulls/5/files?per_page=100&page=1"
        if pr
        else f"{repo}/compare/main...tvashtr/{rid}"
    )
    assert asked == [("GET", want, "TOK")]
    assert set(after) == {"run_id", "base_ref", "ship_branch", "files", "total"}
    assert after["total"] == 1
    got, had = after["files"][0], before["files"][0]
    for key in ("path", "status", "additions", "deletions"):
        assert got[key] == had[key]
    assert (
        got["patch"].startswith("@@") and "+Indicators live in core/indicators.py." in got["patch"]
    )


@pytest.mark.parametrize("failure", ["not_found", "no_installation", "offline", "cut_off"])
def test_l3_when_github_cant_answer_the_changes_say_so(client, monkeypatch, tmp_path, failure):
    import http.client
    import urllib.error

    from tvashtr.control_plane import github_app

    rid, _ = _shipped_github_run(client, monkeypatch, tmp_path)
    monkeypatch.setattr(github_app, "get_installation_token", lambda inst: "TOK")
    if failure == "not_found":

        def gone(*a, **k):
            raise github_app.GithubAppError("Not Found", status=404)

        monkeypatch.setattr(github_app, "_http", gone)
    elif failure == "no_installation":
        monkeypatch.setattr(github_app, "list_installation_repositories", lambda inst: [])
    elif failure == "offline":

        def down(*a, **k):
            raise urllib.error.URLError("no route to host")

        monkeypatch.setattr(github_app.urllib.request, "urlopen", down)
    else:

        def cut(*a, **k):
            raise http.client.IncompleteRead(b"[{", 4096)

        monkeypatch.setattr(github_app, "_http", cut)
    after = client.get(f"/api/runs/{rid}/diff")
    assert after.status_code == 200
    assert after.json()["files"] == [] and after.json()["github_error"] is True
    assert after.json()["pr_url"] == "https://github.com/lazyxgenius/trade_mcp/pull/5"


def test_l3_github_is_not_asked_for_a_live_run_or_a_non_github_run(client, monkeypatch):
    from test_hosted_github_run import _make_hosted_run

    from tvashtr.control_plane import github_app

    def never(*a, **k):
        raise AssertionError("GitHub was asked")

    monkeypatch.setattr(github_app, "_http", never)
    live = _make_hosted_run()  # running, its clone not made yet
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == live).values(repo_path="/gone/clone"))
    assert client.get(f"/api/runs/{live}/diff").json()["files"] == []
    local = _make_hosted_run(github_repo=None)  # a local-folder run whose clone is gone
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == local).values(repo_path="/gone/clone", status="completed")
        )
    body = client.get(f"/api/runs/{local}/diff").json()
    assert body["files"] == [] and "github_error" not in body
