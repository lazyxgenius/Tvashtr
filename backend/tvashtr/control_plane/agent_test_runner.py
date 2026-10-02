"""M7 — running an agent's tests: each test replays ONLY that agent, once, on its saved input with
the agent's current saved setup, and its checks are run on the answer.

Plain threads, never DBOS (a new step or workflow would change the application version and strand
in-flight runs at deploy). So a replay can't survive a restart: a test run whose worker hasn't been
heard from for :data:`STALE_AFTER_S` reads as failed (:func:`end_if_stale`). Each replay:

* gets a fresh workspace OUTSIDE ``.tvashtr_workspaces`` (the workspace reaper never sees it),
  rebuilt from the test's base and change (M3 checkpoint diff), removed afterwards;
* runs under its own id (the result row's), which keys its sandbox (``tv-run-<id>`` on Fly — the Fly
  reaper spares it while it runs, :func:`live_replay_ids`) and counts toward the owner's concurrent
  runs only (R12, :func:`replays_in_flight`); while all slots are taken it waits;
* is stopped after :data:`REPLAY_CAP_S` (its sandbox closed);
* runs on the owner's key for the agent's model (its backup model when it has no key for that).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select, text, update

from tvashtr.config import get_settings
from tvashtr.control_plane import agent_tests, checkpoints, github_app, versions
from tvashtr.control_plane.context_compiler import (
    compile_context,
    resolve_context_budget,
    resolve_fallback_model,
    resolve_reads_from,
)
from tvashtr.control_plane.credentials import NoCredentialError, resolve_owner_api_key
from tvashtr.control_plane.node_skills import build_skills
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.worktree import build_repo_grounding, is_work_tree
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentTask
from tvashtr.engines.registry import resolve_adapter
from tvashtr.engines.sandbox_cache import close_run_sandboxes, session_key_for
from tvashtr.models import AgentNode, AgentTest, AgentTestResult, AgentTestRun, Run, TeamGraph

logger = logging.getLogger(__name__)

REPLAY_CAP_S = 600
STALE_AFTER_S = 720
GIVE_UP_S = 120  # after a stop / the cap: how long its sandbox keeps being closed while it ends
SWEEP_AFTER_S = 3600  # a replay workspace older than this is left over from a crash
SLOT_WAIT_S = 3600
_POLL_S = 5.0
_IN_FLIGHT = ("pending", "running", "awaiting_human")
RESTARTED = "Tvashtr restarted while the tests ran. Run them again."
TOO_LONG = "It took more than 10 minutes, so it was stopped."
NO_SLOT = "Your runs kept every slot busy for an hour, so the tests didn’t start. Run them again."
NO_VERDICT = "It gave no verdict, so its checks didn’t run."
_WORKSPACE_PREFIX = "tvashtr-test-"


class ReplayError(Exception):
    """A replay that couldn't run; its message is what the person reads."""


class ReplayStopped(Exception):
    """A stop (or the cap) reached the replay before its agent started."""


def _spawn(target, *args) -> None:
    """Start a worker thread (tests patch this to run it inline)."""
    threading.Thread(target=target, args=args, daemon=True, name="agent-tests").start()


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------- start / stop


def start(
    owner_id: uuid.UUID,
    team_id: str,
    node_id: str,
    *,
    trigger: str = "manual",
    version: int | None = None,
) -> dict:
    """Start "Run all N" for one library agent; returns the run view. 409 when its tests are already
    running, 422 when it has none."""
    with session_scope() as session:
        node = agent_tests._require_node(session, owner_id, team_id, node_id)
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"agent-tests:{node.id}"}
        )
        running = session.execute(
            select(AgentTestRun).where(
                AgentTestRun.node_id == node.id, AgentTestRun.status == "running"
            )
        ).scalar_one_or_none()
        if running is not None and not end_if_stale(session, running):
            raise agent_tests.TestsError(409, "The tests are already running")
        tests = (
            session.execute(
                select(AgentTest)
                .where(AgentTest.node_id == node.id)
                .order_by(AgentTest.created_at, AgentTest.source_row.nulls_first(), AgentTest.id)
            )
            .scalars()
            .all()
        )
        if not tests:
            raise agent_tests.TestsError(422, "Add a test first")
        if version is None:
            # "On v7" only when the agent is as v7 has it: with unsaved changes to it, the run is
            # on no version (History and "since vN" never credit a setup no version holds).
            team = session.get(TeamGraph, node.team_graph_id)
            top, rows = versions.pending(session, team, owner_id)
            changed = any(row.get("node_id") == str(node.id) for row in rows)
            version = None if changed else top.number
        run = AgentTestRun(
            owner_id=owner_id,
            team_id=node.team_graph_id,
            node_id=node.id,
            version_number=version,
            status="running",
            trigger=trigger,
            total=len(tests),
        )
        session.add(run)
        session.flush()
        for i, test in enumerate(tests):
            session.add(
                AgentTestResult(
                    test_run_id=run.id,
                    test_id=test.id,
                    position=i,
                    name=test.name,
                    status="waiting",
                )
            )
        run_id = run.id
    sweep_workspaces()
    _spawn(_work, run_id)
    with session_scope() as session:
        return agent_tests._run_view(session, session.get(AgentTestRun, run_id))


def sweep_workspaces() -> None:
    """Remove replay workspaces a crash left behind (a replay lives minutes, these hours)."""
    root = tempfile.gettempdir()
    cutoff = time.time() - SWEEP_AFTER_S
    try:
        entries = list(os.scandir(root))
    except OSError:
        return
    for entry in entries:
        try:
            if (
                entry.name.startswith(_WORKSPACE_PREFIX)
                and entry.is_dir(follow_symlinks=False)
                and entry.stat(follow_symlinks=False).st_mtime < cutoff
            ):
                shutil.rmtree(entry.path, ignore_errors=True)
        except OSError:
            continue


def stop(owner_id: uuid.UUID, team_id: str, node_id: str) -> dict:
    with session_scope() as session:
        node = agent_tests._require_node(session, owner_id, team_id, node_id)
        run = session.execute(
            select(AgentTestRun)
            .where(AgentTestRun.node_id == node.id)
            .order_by(AgentTestRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if run is None:
            raise agent_tests.TestsError(404, "No tests have run")
        if run.status == "running":
            run.stop_requested = True
            # The worker may be on another machine or gone: what hasn't started stops now.
            session.execute(
                update(AgentTestResult)
                .where(AgentTestResult.test_run_id == run.id, AgentTestResult.status == "waiting")
                .values(status="stopped")
            )
            running = session.execute(
                select(AgentTestResult.id).where(
                    AgentTestResult.test_run_id == run.id, AgentTestResult.status == "running"
                )
            ).scalar_one_or_none()
            if running is None:
                run.status, run.ended_at = "stopped", _now()
        session.flush()
        return agent_tests._run_view(session, run)


def end_if_stale(session, run: AgentTestRun) -> bool:
    """A running test run whose worker went quiet past the cap (a restart, a deploy) ends as failed.
    Returns whether it was ended."""
    if run.status != "running" or run.heartbeat_at > _now() - timedelta(seconds=STALE_AFTER_S):
        return False
    run.status, run.error, run.ended_at = "failed", RESTARTED, _now()
    session.execute(
        update(AgentTestResult)
        .where(
            AgentTestResult.test_run_id == run.id,
            AgentTestResult.status.in_(("waiting", "running")),
        )
        .values(status="stopped")
    )
    return True


# -------------------------------------------------------------------------- R12: the caps


def replays_in_flight(session, owner_id: uuid.UUID) -> int:
    fresh = _now() - timedelta(seconds=STALE_AFTER_S)
    return session.execute(
        select(func.count())
        .select_from(AgentTestResult)
        .join(AgentTestRun, AgentTestRun.id == AgentTestResult.test_run_id)
        .where(
            AgentTestRun.owner_id == owner_id,
            AgentTestRun.status == "running",
            AgentTestRun.heartbeat_at > fresh,
            AgentTestResult.status == "running",
        )
    ).scalar_one()


def live_replay_owner(session, replay_id: uuid.UUID) -> uuid.UUID | None:
    """The owner of a replay that is running now (its tool tokens are honoured), else None."""
    fresh = _now() - timedelta(seconds=STALE_AFTER_S)
    return session.execute(
        select(AgentTestRun.owner_id)
        .join(AgentTestResult, AgentTestResult.test_run_id == AgentTestRun.id)
        .where(
            AgentTestResult.id == replay_id,
            AgentTestResult.status == "running",
            AgentTestRun.status == "running",
            AgentTestRun.heartbeat_at > fresh,
        )
    ).scalar_one_or_none()


def live_replay_ids(ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Which of these ids are replays still running (the Fly reaper spares their sandboxes)."""
    if not ids:
        return set()
    fresh = _now() - timedelta(seconds=STALE_AFTER_S)
    with session_scope() as session:
        return set(
            session.execute(
                select(AgentTestResult.id)
                .join(AgentTestRun, AgentTestRun.id == AgentTestResult.test_run_id)
                .where(
                    AgentTestResult.id.in_(ids),
                    AgentTestResult.status == "running",
                    AgentTestRun.heartbeat_at > fresh,
                )
            ).scalars()
        )


def _take_slot(run_id: uuid.UUID, result_id: uuid.UUID) -> bool | None:
    """Mark the replay running when the owner has a free slot (hosted only); one transaction under
    the owner's lock, so two workers can't both take the last slot. ``False`` ⇒ wait; ``None`` ⇒
    it no longer waits (stopped, or its run ended) — skip it.

    ponytail: the launch path (``_enforce_run_ceilings``) counts without this lock, so a launch and
    a replay landing together can both take the last slot — the same race two launches already
    have; hold one lock over the count and the insert if it ever matters."""
    settings = get_settings()
    with session_scope() as session:
        run = session.get(AgentTestRun, run_id)
        if run is None or run.status != "running" or run.stop_requested:
            return None
        if settings.hosted_mode:
            session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                {"k": f"run-slots:{run.owner_id}"},
            )
            runs = session.execute(
                select(func.count())
                .select_from(Run)
                .where(Run.owner_id == run.owner_id, Run.status.in_(_IN_FLIGHT))
            ).scalar_one()
            if runs + replays_in_flight(session, run.owner_id) >= (
                settings.hosted_max_concurrent_runs_per_owner
            ):
                run.waiting_for_slot, run.heartbeat_at = True, _now()
                return False
        taken = session.execute(
            update(AgentTestResult)
            .where(AgentTestResult.id == result_id, AgentTestResult.status == "waiting")
            .values(status="running", started_at=_now())
        ).rowcount
        if not taken:
            return None
        run.waiting_for_slot, run.heartbeat_at = False, _now()
        return True


# ------------------------------------------------------------------------------- the worker


def _stop_asked(run_id: uuid.UUID) -> bool:
    with session_scope() as session:
        asked = session.execute(
            select(AgentTestRun.stop_requested).where(AgentTestRun.id == run_id)
        ).scalar_one_or_none()
    return asked is None or bool(asked)  # a run that's gone is stopped


def _beat(run_id: uuid.UUID) -> None:
    with session_scope() as session:
        session.execute(
            update(AgentTestRun).where(AgentTestRun.id == run_id).values(heartbeat_at=_now())
        )


def _work(run_id: uuid.UUID) -> None:
    try:
        _run_all(run_id)
    except Exception:  # noqa: BLE001 — a crashed worker must end its run readably
        logger.exception("agent tests failed run_id=%s", run_id)
        with session_scope() as session:
            run = session.get(AgentTestRun, run_id)
            if run is not None and run.status == "running":
                run.status, run.ended_at = "failed", _now()
                run.error = "Something went wrong running the tests. Run them again."
                session.execute(
                    update(AgentTestResult)
                    .where(
                        AgentTestResult.test_run_id == run_id,
                        AgentTestResult.status.in_(("waiting", "running")),
                    )
                    .values(status="stopped")
                )


def _run_all(run_id: uuid.UUID) -> None:
    with session_scope() as session:
        ids = list(
            session.execute(
                select(AgentTestResult.id)
                .where(AgentTestResult.test_run_id == run_id)
                .order_by(AgentTestResult.position)
            ).scalars()
        )
    for result_id in ids:
        waited = 0.0
        taken = _take_slot(run_id, result_id)
        while taken is False:
            if waited >= SLOT_WAIT_S:
                _end(run_id, "failed", NO_SLOT)
                return
            time.sleep(_POLL_S)
            waited += _POLL_S
            taken = _take_slot(run_id, result_id)
        if taken is None:
            if _stop_asked(run_id):
                break
            continue  # stopped from another machine
        outcome = _replay_with_cap(run_id, result_id)
        _finish_result(run_id, result_id, outcome)
    _end(run_id, "stopped" if _stop_asked(run_id) else "done", None)


def _end(run_id: uuid.UUID, status: str, error: str | None) -> None:
    with session_scope() as session:
        run = session.get(AgentTestRun, run_id)
        if run is None or run.status != "running":
            return
        session.execute(
            update(AgentTestResult)
            .where(
                AgentTestResult.test_run_id == run_id,
                AgentTestResult.status.in_(("waiting", "running")),
            )
            .values(status="stopped")
        )
        run.status, run.error, run.ended_at, run.waiting_for_slot = status, error, _now(), False


def _over_cap(began: float) -> bool:
    return time.monotonic() - began > REPLAY_CAP_S


def _replay_with_cap(run_id: uuid.UUID, result_id: uuid.UUID) -> dict:
    """Run :func:`replay` on its own thread, beating the heart, for at most REPLAY_CAP_S. A stop or
    the cap tells the replay (it won't start its agent) and keeps closing its sandbox until it ends,
    so its slot stays counted while it can still spend (R12)."""
    box: dict = {}
    cancel = threading.Event()

    def target() -> None:
        try:
            box["out"] = replay(result_id, cancel)
        except ReplayStopped:
            box["out"] = {"stopped": True}
        except ReplayError as exc:
            box["out"] = {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            logger.exception("replay failed result_id=%s", result_id)
            box["out"] = {"error": f"It didn’t finish: {exc}"}

    worker = threading.Thread(target=target, daemon=True, name="agent-test-replay")
    worker.start()
    began = time.monotonic()
    while worker.is_alive():
        worker.join(timeout=_POLL_S)
        if not worker.is_alive():
            break
        _beat(run_id)
        stopped = _stop_asked(run_id)
        if stopped or _over_cap(began):
            cancel.set()
            # ponytail: a LOCAL-mode agent can't be interrupted from here; past GIVE_UP_S it runs
            # out its own iteration cap in the background. Docker/Fly sandboxes close at once.
            deadline = time.monotonic() + GIVE_UP_S
            while worker.is_alive() and time.monotonic() < deadline:
                close_run_sandboxes(str(result_id))
                worker.join(timeout=_POLL_S)
                _beat(run_id)
            return {"stopped": True} if stopped else {"error": TOO_LONG}
    return box.get("out") or {"error": "It didn’t finish."}


def _finish_result(run_id: uuid.UUID, result_id: uuid.UUID, outcome: dict) -> None:
    with session_scope() as session:
        result = session.get(AgentTestResult, result_id)
        run = session.get(AgentTestRun, run_id)
        result.ended_at = _now()  # its cost was added by the replay itself (_add_cost)
        if outcome.get("stopped"):
            result.status = "stopped"
            return
        result.answer = outcome.get("answer")
        result.files = outcome.get("files") or []
        result.error = outcome.get("error")
        if result.error:
            result.status, result.checks = "failed", []
            return
        test = session.get(AgentTest, result.test_id) if result.test_id else None
        checks = list(test.checks) if test is not None else []
        owner = run.owner_id
    evaluated = agent_tests.evaluate(
        checks,
        outcome.get("answer") or "",
        outcome.get("files") or [],
        lambda value, answer: agent_tests.ai_check(owner, value, answer),
    )
    with session_scope() as session:
        result = session.get(AgentTestResult, result_id)
        result.checks = evaluated
        result.status = "passed" if agent_tests.passed(evaluated) else "failed"


# ------------------------------------------------------------------------------- one replay


def _model_and_key(owner_id: uuid.UUID, model: str, fallback: str | None) -> tuple[str, str]:
    try:
        return model, resolve_owner_api_key(owner_id, model)
    except NoCredentialError as exc:
        if fallback and fallback != model:
            try:
                return fallback, resolve_owner_api_key(owner_id, fallback)
            except NoCredentialError:
                pass
        raise ReplayError(
            f"There’s no key for {exc.provider} on your account. Add one in Settings, or pick "
            "another model."
        ) from exc


def _git(ws: str, *args: str) -> None:
    try:
        subprocess.run(
            ["git", "-C", ws, *args], check=True, capture_output=True, text=True, timeout=300
        )
    except (subprocess.SubprocessError, OSError) as exc:
        detail = getattr(exc, "stderr", "") or str(exc)
        raise ReplayError(f"Couldn’t rebuild its workspace: {str(detail).strip()[:300]}") from exc


def _rebuild(ws: str, base: dict, diff: bytes | None, owner_id: uuid.UUID, marker: str) -> None:
    """The workspace exactly as the agent got it: its base, then the change it saw."""
    from tvashtr.control_plane.team_run import _owner_installation_ids, _write_workspace_gitignore

    if base.get("kind") == "repo":
        sha = base.get("sha")
        repo = base.get("github_repo")
        if repo:
            match = github_app.find_repo_in_installations(_owner_installation_ids(owner_id), repo)
            if match is None:
                raise ReplayError(f"Tvashtr can’t reach {repo} on GitHub any more.")
            github_app.clone_repo(match[0], repo, ws)
            if sha and not checkpoints.has_commit(ws, sha):
                github_app.fetch_commit(match[0], repo, ws, sha)
        else:
            src = base.get("repo_path") or ""
            if not is_work_tree(src):
                raise ReplayError("Its repo folder isn’t on this machine any more.")
            _git(os.path.dirname(ws), "clone", "--quiet", "--no-hardlinks", src, ws)
        if not sha or not checkpoints.has_commit(ws, sha):
            raise ReplayError("The commit it started from is gone from the repo.")
        _git(ws, "checkout", "--quiet", "--detach", sha)
    else:
        os.makedirs(ws, exist_ok=True)
        init_workspace_repo(ws)
        _write_workspace_gitignore(ws)
    if diff:
        try:
            checkpoints.apply(ws, diff, marker=marker)
        except checkpoints.CheckpointError as exc:
            raise ReplayError(f"Couldn’t put back the change it saw: {exc}") from exc
    _drop_escaping_links(ws)


def _inside(ws: str, path: str) -> bool:
    root = os.path.realpath(ws)
    target = os.path.realpath(path)
    return target == root or target.startswith(root + os.sep)


def _drop_escaping_links(ws: str) -> None:
    """A repo's symlink out of the workspace (``REPORT.md -> /proc/self/environ``) would have the
    control plane read its own files for the agent: such links are removed before the replay."""
    for dirpath, dirnames, filenames in os.walk(ws):
        if ".git" in dirnames:
            dirnames.remove(".git")
        for name in dirnames + filenames:
            path = os.path.join(dirpath, name)
            if os.path.islink(path) and not _inside(ws, path):
                os.unlink(path)


def _snapshot(ws: str, index: str) -> str | None:
    """The workspace's tree as git sees it (``.gitignore`` honoured), through a private index so
    the real one — and so ``git diff`` for the agent — is left as it is."""
    env = {**os.environ, "GIT_INDEX_FILE": index}
    try:
        if not os.path.exists(index):
            subprocess.run(
                ["git", "-C", ws, "read-tree", "HEAD"], env=env, check=True, capture_output=True
            )
        subprocess.run(
            ["git", "-C", ws, "add", "-A", "--", "."], env=env, check=True, capture_output=True
        )
        return subprocess.run(
            ["git", "-C", ws, "write-tree"], env=env, check=True, capture_output=True, text=True
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        logger.warning("snapshotting a replay workspace failed", exc_info=True)
        return None


def _changed(ws: str, before: str | None, index: str) -> list[str]:
    """The files the replay changed, worked out here — an adapter's pull lists every file it
    brought back, changed or not."""
    after = _snapshot(ws, index)
    if not before or not after:
        return []
    out = subprocess.run(
        ["git", "-C", ws, "diff", "--name-only", "--no-renames", before, after],
        capture_output=True,
        text=True,
    ).stdout
    return [f for f in out.splitlines() if f and f.rsplit("/", 1)[-1] not in agent_tests._OWN_FILES]


def _verdict_given(ws: str) -> bool:
    path = Path(ws) / "REVIEW_VERDICT.json"
    if path.is_symlink() or not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except ValueError:
        return False
    verdict = str(data.get("verdict", "") if isinstance(data, dict) else "")
    return verdict.strip().lower().replace(" ", "_") in ("approved", "changes_requested")


def _add_cost(run_id: uuid.UUID, result_id: uuid.UUID, cost: float) -> None:
    """Added the moment the agent returns — a stopped or capped replay's spend counts too."""
    if not cost:
        return
    with session_scope() as session:
        session.execute(
            update(AgentTestResult)
            .where(AgentTestResult.id == result_id)
            .values(cost_usd=AgentTestResult.cost_usd + cost)
        )
        session.execute(
            update(AgentTestRun)
            .where(AgentTestRun.id == run_id)
            .values(cost_usd=AgentTestRun.cost_usd + cost)
        )


def _answer(emits: bool, ws: str, result, report_name: str) -> str:
    from tvashtr.control_plane.team_run import _closing_text, _harvest_verdict

    if emits:
        if not _verdict_given(ws):
            raise ReplayError(NO_VERDICT)  # the run's safe default isn't an answer to test
        verdict = _harvest_verdict(ws)
        if verdict["outcome"] == "approved":
            return "Approved"
        reasons = (verdict.get("reasons") or "").strip()
        return f"Changes requested: {reasons}" if reasons else "Changes requested"
    report = Path(ws) / report_name
    if report.is_file() and not report.is_symlink() and _inside(ws, str(report)):
        body = report.read_text(encoding="utf-8", errors="replace").strip()
        if body:
            return body
    for event in reversed(list(result.events or [])):
        found = _closing_text(event.kind, event.payload)
        if found is not None:
            return found.strip()
    return ""


def replay(result_id: uuid.UUID, cancel: threading.Event | None = None) -> dict:
    """Replay one test: exactly ONE agent run. → ``{answer, files, cost_usd}`` (or raises
    :class:`ReplayError` with the words the person reads, or :class:`ReplayStopped` when a stop or
    the cap came before its agent started)."""
    from tvashtr.control_plane.team_run import (
        REPORT_FILENAME,
        _engine_for_sandbox_mode,
        _remove_spec_handle,
        _resolve_pull_paths,
        _write_spec_handle,
        node_emits_outcome,
    )

    settings = get_settings()
    with session_scope() as session:
        result = session.get(AgentTestResult, result_id)
        run = session.get(AgentTestRun, result.test_run_id)
        test = session.get(AgentTest, result.test_id) if result.test_id else None
        node = session.get(AgentNode, run.node_id)
        if test is None or node is None:
            raise ReplayError("This test was deleted.")
        diff = session.execute(select(AgentTest.diff).where(AgentTest.id == test.id)).scalar()
        inputs = dict(test.inputs)
        edges = agent_tests._edges(session, node.team_graph_id)
        setup = {
            "id": str(node.id),
            "prompt": node.prompt or "",
            "model": node.model or settings.default_model,
            "config": dict(node.config or {}),
            "tool_config": node.tool_config,
            "skills": node.skills,
            "edits_allowed": bool(node.edits_allowed),
        }
        owner_id, test_run_id = run.owner_id, run.id
    replay_id = str(result_id)
    emits = node_emits_outcome(edges, setup["id"])
    base = inputs.get("base") or {"kind": "empty"}
    parent = tempfile.mkdtemp(prefix=_WORKSPACE_PREFIX)
    ws = os.path.join(parent, "ws")
    index = os.path.join(parent, "snapshot-index")
    try:
        _rebuild(ws, base, diff, owner_id, marker=f"test:{test.id}")
        grounding = None
        subpath = base.get("subpath") if base.get("kind") == "repo" else None
        if base.get("kind") == "repo":
            name = (base.get("github_repo") or base.get("repo_path") or "repo").rstrip("/")
            grounding = build_repo_grounding(ws, os.path.basename(name), subpath)
        documents = inputs.get("documents") or []
        spec, read_documents = None, None
        if resolve_reads_from(setup["config"]):
            read_documents = [{"name": d["name"], "content": d["content"]} for d in documents]
        elif documents:
            shared = next((d for d in documents if d.get("is_shared_spec")), documents[0])
            spec = shared["content"]
        compiled = compile_context(
            node_prompt=setup["prompt"],
            idea=inputs.get("task") or "",
            spec=spec,
            iteration=int(inputs.get("iteration") or 1),
            reviewer_feedback=inputs.get("feedback"),
            grounding=grounding,
            emits_outcome=emits,
            subpath=subpath,
            budget=resolve_context_budget(settings, setup["config"]),
            edits_allowed=setup["edits_allowed"],
            memory=None,
            remember_enabled=False,
            read_documents=read_documents or None,
        )
        if compiled.over_budget:
            fat = compiled.fattest
            raise ReplayError(
                f"What it gets is too long for its context budget (the {fat.name} part is "
                f"{fat.tokens} tokens)."
            )
        if compiled.handle_used:
            _write_spec_handle(ws, compiled.spec_doc)
        model, key = _model_and_key(
            owner_id, setup["model"], resolve_fallback_model(setup["config"])
        )
        task = AgentTask(
            instruction=compiled.instruction,
            workspace_dir=ws,
            model=model,
            llm_api_key=key,
            workspace_mode="brownfield" if grounding is not None else "greenfield",
            pull_paths=_resolve_pull_paths(
                edits_allowed=setup["edits_allowed"], emits_outcome=emits
            ),
            mcp_config=build_mcp_config(setup["tool_config"], replay_id, node_id=setup["id"]),
            skills=build_skills(setup["skills"], ws, replay_id),
            session_key=session_key_for(replay_id, setup["id"]),
        )
        adapter = resolve_adapter(_engine_for_sandbox_mode(settings.agent_sandbox_mode))
        before = _snapshot(ws, index)
        if (cancel is not None and cancel.is_set()) or _stop_asked(test_run_id):
            raise ReplayStopped()
        outcome = adapter.run(task)
        cost = float(outcome.cost_usd or 0)
        _add_cost(test_run_id, result_id, cost)
        _record_cost(run_id=test_run_id, result_id=result_id, model=model, outcome=outcome)
        if compiled.handle_used:
            _remove_spec_handle(ws)
        if outcome.status != "completed":
            return {"error": f"It didn’t finish: {outcome.error or outcome.status}"}
        _drop_escaping_links(ws)
        return {
            "answer": _answer(emits, ws, outcome, REPORT_FILENAME),
            "files": _changed(ws, before, index),
        }
    finally:
        close_run_sandboxes(replay_id)
        shutil.rmtree(parent, ignore_errors=True)


def _record_cost(*, run_id, result_id, model: str, outcome) -> None:
    from tvashtr.metering import record_agent_cost

    try:
        record_agent_cost(
            workflow_id=f"agent-test:{run_id}",
            idempotency_key=f"agent-test:{result_id}",
            model=model,
            prompt_tokens=int(outcome.prompt_tokens or 0),
            completion_tokens=int(outcome.completion_tokens or 0),
            total_tokens=int(outcome.total_tokens or 0),
            cost_usd=float(outcome.cost_usd or 0),
        )
    except Exception:  # noqa: BLE001 — the cost is also on the result row
        logger.warning("recording a replay's cost failed result_id=%s", result_id, exc_info=True)
