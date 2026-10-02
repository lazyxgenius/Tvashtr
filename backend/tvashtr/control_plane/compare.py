"""M8 — Compare two versions (ruling R5; contract ``docs/superpowers/plans/api/compare.md``).

Two versions of a library team run one task at the same time. Each run is an ordinary run on a
snapshot built from its version's stored graph (:func:`versions.run_snapshot`) and recorded on that
version — never the working copy, never a new version. A compare run never ships and approves its
own gates unless the compare says otherwise: the executor reads that off the run's ``pair_id``
(``team_run.load_graph_step``, ``gates.gate_auto_resolution_step``), so nothing here is a DBOS step
or workflow and the DBOS application version is unchanged.

A compare starts both runs when the hosted caps have room for two (R12: compare runs count fully);
otherwise it waits with no run rows, and a plain daemon thread — never DBOS, like M7's replays —
starts both as soon as two slots are free. Waiters are re-armed at startup (:func:`rearm`).

M9 (contract ``docs/superpowers/plans/api/task-sets.md``): a compare on a task set runs both
versions on every task of the set, task by task as two run slots free (the same waiter keeps going
until every task is launched). Each task's A and B runs are inserted in ONE transaction and each
task in its own, so a task's two runs share ``created_at`` (Postgres ``now()`` is the
transaction's start): that is how the view pairs them, whatever later happens to the set.
Openhands-free."""

from __future__ import annotations

import logging
import math
import re
import threading
import time
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta

from dbos import DBOS, SetWorkflowID
from fastapi import HTTPException
from sqlalchemy import and_, delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError

from tvashtr.config import get_settings
from tvashtr.control_plane import (
    activity,
    agent_test_runner,
    checkpoints,
    github_app,
    resume,
    run_views,
    task_sets,
    versions,
)
from tvashtr.control_plane.graph_validity import graph_dicts, owner_domain_ids, validate_graph
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import cancel_run_core
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    AgentTest,
    AgentTestResult,
    AgentTestRun,
    Compare,
    GithubInstallation,
    HiddenCheckResult,
    Run,
    RunEvent,
    TaskSet,
    TaskSetItem,
    TeamGraph,
    TeamVersion,
)

logger = logging.getLogger(__name__)

POLL_S = 5.0
ACTIVE = ("waiting", "running")
LABELS = ("A", "B")
_IN_FLIGHT = ("pending", "running", "awaiting_human")
# A run's status as one lane of a compare.
_SIDE_STATUS = {
    "pending": "running",
    "running": "running",
    "awaiting_human": "needs_you",
    "completed": "finished",
    "failed": "failed",
}
# A run's status as one cell of a set compare (anything else that ended: stopped).
_CELL_STATUS = {**_SIDE_STATUS, "awaiting_human": "running"}
_ENDED = ("finished", "failed", "stopped")
_FILE = re.compile(rb"^diff --git a/(.+?) b/", re.MULTILINE)
_BUSY = "This team already has a compare running. Stop it first."


def _now() -> datetime:
    return datetime.now(UTC)


def _require_team(session, team_id: str, owner_id: uuid.UUID) -> TeamGraph:
    from tvashtr.routers import _require_library_team  # the router mounts after this module

    return _require_library_team(session, team_id, owner_id)


def _require(session, owner_id: uuid.UUID, compare_id: str, *, lock: bool = False) -> Compare:
    try:
        cid = uuid.UUID(compare_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="compare not found") from exc
    stmt = select(Compare).where(Compare.id == cid)
    found = session.execute(stmt.with_for_update() if lock else stmt).scalar_one_or_none()
    if found is None or found.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="compare not found")
    return found


def _runs(session, cmp: Compare) -> list[Run]:
    """Its runs in launch order (a task's A then B; see the module note)."""
    return list(
        session.execute(
            select(Run).where(Run.pair_id == cmp.id).order_by(Run.created_at, Run.pair_label)
        ).scalars()
    )


def _refresh(session, cmp: Compare) -> list[Run]:
    """Its runs; a running compare is ``finished`` once all its runs (two per task) are in and have
    ended (read time: nothing watches it)."""
    runs = _runs(session, cmp)
    if (
        cmp.status == "running"
        and len(runs) == 2 * (cmp.item_count or 1)
        and all(r.status in run_views.TERMINAL_STATUSES for r in runs)
    ):
        cmp.status, cmp.ended_at = "finished", max(r.updated_at for r in runs)
    return runs


def _groups(runs: list[Run]) -> list[dict[str, Run]]:
    """``{label: run}`` per task, in launch order: a task's two runs share ``created_at``."""
    out: dict = {}
    for run in runs:
        out.setdefault(run.created_at, {})[run.pair_label] = run
    return list(out.values())


def _pending(session, cmp: Compare, runs: list[Run] | None = None) -> list:
    """What is still to launch: a one-task compare's single task (``None``) until it has runs; a
    set compare's tasks after the ones launched, in order (none once its set is gone)."""
    runs = _runs(session, cmp) if runs is None else runs
    if cmp.item_count is None:
        return [] if runs else [None]
    items = (
        session.execute(
            select(TaskSetItem)
            .where(TaskSetItem.task_set_id == cmp.task_set_id)
            .order_by(TaskSetItem.position)
        )
        .scalars()
        .all()
        if cmp.task_set_id is not None
        else []
    )
    return list(items[len(runs) // 2 :])


# ------------------------------------------------------------------------------- the Compare tab


def _target(session, team: TeamGraph) -> dict | None:
    """The team's own repo, else the newest GitHub repo it ran on, else none (greenfield). Hosted
    only: ``POST /api/runs`` takes a GitHub target only there."""
    if not get_settings().hosted_mode:
        return None
    stmt = select(Run.github_repo, Run.base_ref).where(
        Run.library_team_id == team.id, Run.github_repo.is_not(None)
    )
    if team.repo:
        stmt = stmt.where(Run.github_repo == team.repo)
    row = session.execute(stmt.order_by(Run.created_at.desc()).limit(1)).first()
    if team.repo:
        return {"repo": team.repo, "base_ref": row.base_ref if row else None}
    return {"repo": row.github_repo, "base_ref": row.base_ref} if row else None


def _estimate(session, team: TeamGraph, numbers: list[int]) -> dict | None:
    """Both runs' cost (added) and time (the longer: they run together) from the finished runs of
    each version; a version with none is estimated by the other's. None when neither has one."""
    by: dict[int, list[tuple[float, float]]] = {}
    for number, cost, start, end in session.execute(
        select(Run.team_version_number, Run.cost_total_usd, Run.created_at, Run.updated_at).where(
            Run.library_team_id == team.id,
            Run.status == "completed",
            Run.team_version_number.in_(numbers),
        )
    ).all():
        by.setdefault(number, []).append((float(cost or 0), (end - start).total_seconds()))
    if not by:
        return None
    sides = [by.get(n) or next(iter(by.values())) for n in numbers]

    def avg(rows, k):
        return sum(r[k] for r in rows) / len(rows)

    return {
        "cost_usd": round(sum(avg(s, 0) for s in sides), 2),
        "minutes": math.ceil(max(avg(s, 1) for s in sides) / 60),
    }


def page(session, team: TeamGraph, viewer: uuid.UUID) -> dict:
    top = versions.ensure_first(session, team, viewer)
    rows = (
        session.execute(
            select(TeamVersion)
            .where(TeamVersion.team_graph_id == team.id)
            .order_by(TeamVersion.number.desc())
        )
        .scalars()
        .all()
    )
    runs = versions._runs_by_version(session, team)
    a = top.number - 1 if top.number > 1 else None
    changes = len(versions.diff(versions._version(session, team, a).graph, top.graph)) if a else 0
    latest = session.execute(
        select(Compare)
        .where(Compare.team_graph_id == team.id)
        .order_by(Compare.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest is not None:
        _refresh(session, latest)
    return {
        "team": {"id": str(team.id), "name": team.name},
        "versions": [
            {
                "number": v.number,
                "when": v.created_at.isoformat(),
                "runs": runs.get(v.number, 0),
                "summary": v.summary,
                "current": v.number == top.number,
            }
            for v in rows
        ],
        "defaults": {"a": a, "b": top.number},
        "changes": changes,
        "target": _target(session, team),
        "estimate": _estimate(session, team, [n for n in (a, top.number) if n is not None]),
        "latest": {"id": str(latest.id), "status": latest.status} if latest else None,
        # M9: the team's task sets (the Start panel's "A task set" choice).
        "task_sets": task_sets.summaries(session, team.id),
    }


def set_estimate(session, team: TeamGraph, numbers: list[int], tasks: int) -> dict | None:
    """A set compare's cost (both versions on every task) and time (tasks run two runs at a time
    as the owner's slots allow; self-hosted: all at once), from :func:`_estimate` per task."""
    one = _estimate(session, team, numbers)
    if one is None or not tasks:
        return None
    settings = get_settings()
    at_once = (
        max(1, settings.hosted_max_concurrent_runs_per_owner // 2)
        if settings.hosted_mode
        else tasks
    )
    return {
        "cost_usd": round(one["cost_usd"] * tasks, 2),
        "minutes": one["minutes"] * math.ceil(tasks / at_once),
    }


def changes(session, team: TeamGraph, a: int, b: int) -> dict:
    va, vb = versions._version(session, team, a), versions._version(session, team, b)
    if va is None or vb is None:
        raise HTTPException(status_code=404, detail="version not found")
    rows = versions.diff(va.graph, vb.graph)
    return {"a": a, "b": b, "rows": rows, "summary": versions.summary(rows)}


# ---------------------------------------------------------------------------------- launching


def _check_runnable(snapshot: uuid.UUID, owner_id: uuid.UUID) -> None:
    """The launch pre-flight of ``POST /api/runs`` on one side's snapshot (422s)."""
    from tvashtr.routers import _launch_preflight  # the router mounts after this module

    with session_scope() as session:
        nodes, edges = graph_dicts(session, snapshot)
        domain_ids = owner_domain_ids(session, owner_id)
    verdict = validate_graph(nodes, edges, domain_ids)
    if not verdict["runnable"]:
        raise HTTPException(
            status_code=422,
            detail={"message": "team graph is not runnable", "errors": verdict["errors"]},
        )
    _launch_preflight(owner_id, str(snapshot), False)


def _authorise(owner_id: uuid.UUID, target: dict | None) -> tuple[str | None, str | None]:
    """``(repo, base_ref)`` for the target, checked against the owner's GitHub installations as
    ``POST /api/runs`` checks one (a team file can name any repo)."""
    if target is None:
        return None, None
    with session_scope() as session:
        installs = list(
            session.execute(
                select(GithubInstallation.installation_id).where(
                    GithubInstallation.owner_id == owner_id
                )
            ).scalars()
        )
    try:
        match = github_app.find_repo_in_installations(installs, target["repo"])
    except github_app.GithubAppError as exc:
        raise HTTPException(
            status_code=502, detail="Couldn't reach GitHub. Try again in a moment."
        ) from exc
    if match is None:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "github_repo is not in your installations",
                "github_repo": target["repo"],
            },
        )
    return target["repo"], target["base_ref"] or match[1].get("default_branch") or "main"


def _drop(snapshots) -> None:
    with session_scope() as session:
        session.execute(delete(TeamGraph).where(TeamGraph.id.in_(list(snapshots))))


def _launch(
    session,
    cmp: Compare,
    snapshots: dict | None = None,
    *,
    waiter: bool = False,
    item: TaskSetItem | None = None,
) -> list[str] | None:
    """Insert both runs (in ``session``) when the hosted caps have room for two, else None (wait).
    Only the owner's own run slots make a new compare wait (Cmp-Queued); the daily and fleet caps
    refuse it with ``POST /api/runs``'s 429. A ``waiter`` waits on any cap. Under the owner's slot
    lock (M7's), so a compare and a replay never both take the last slot. The caller starts their
    workflows after the commit — ONE task per call and per transaction (the module note).

    M9: a set compare's ``item`` gives the runs their task (``idea``), the branch they start from
    (its ``starts_from``, else the target's) and ``task_set_item_id``. Never its hidden check."""
    from tvashtr.routers import _enforce_run_ceilings  # the router mounts after this module

    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"run-slots:{cmp.owner_id}"}
    )
    try:
        _enforce_run_ceilings(cmp.owner_id, launching=2)
    except HTTPException as exc:
        if exc.status_code != 429:
            raise
        if not waiter and exc.detail.get("code") != "owner_concurrency_limit":
            raise
        return None
    team = session.get(TeamGraph, cmp.team_graph_id)
    cap = team.budget_usd if team.budget_usd is not None else get_settings().default_run_budget_usd
    idea, base_ref = cmp.task, cmp.base_ref
    if item is not None:
        idea = item.task
        base_ref = (item.starts_from or cmp.base_ref) if cmp.repo else None
    ids = []
    for label, number in zip(LABELS, (cmp.version_a, cmp.version_b), strict=True):
        snapshot = (snapshots or {}).get(label) or versions.run_snapshot(
            session, team, versions._version(session, team, number).graph
        )
        run_id = uuid.uuid4()
        session.add(
            Run(
                id=run_id,
                team_graph_id=snapshot,
                owner_id=cmp.owner_id,
                idea=idea,
                workflow_id=str(run_id),
                status="running",
                budget_cap_usd=cap,
                github_repo=cmp.repo,
                base_ref=base_ref,
                library_team_id=team.id,
                team_version_number=number,
                pair_id=cmp.id,
                pair_label=label,
                task_set_item_id=item.id if item is not None else None,
            )
        )
        ids.append(str(run_id))
    if cmp.status == "waiting":
        cmp.status, cmp.started_at = "running", _now()
    session.flush()
    return ids


def _start(run_ids: list[str], task: str) -> None:
    for run_id in run_ids:
        with SetWorkflowID(run_id):
            DBOS.start_workflow(run_team, task)
    # A Stop that landed after the runs were committed and before this cancelled them while their
    # workflows didn't exist yet (``DBOS.cancel_workflow`` had nothing to cancel): cancel them now.
    with session_scope() as session:
        stopped = list(
            session.execute(
                select(Run.workflow_id).where(
                    Run.workflow_id.in_(run_ids), Run.status == "cancelled"
                )
            ).scalars()
        )
    for run_id in stopped:
        DBOS.cancel_workflow(run_id)


def _fits_today(owner_id: uuid.UUID, runs: int) -> None:
    """Hosted: a set whose runs can't all start within the owner's daily run limit is refused up
    front (422), rather than left waiting a day."""
    settings = get_settings()
    if not settings.hosted_mode:
        return
    limit = settings.hosted_max_runs_per_owner_per_day
    with session_scope() as session:
        today = session.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner_id, Run.created_at >= _now() - timedelta(hours=24))
        ).scalar_one()
    left = max(0, limit - today)
    if runs > left:
        raise HTTPException(
            status_code=422,
            detail=(
                f"This set needs {runs} runs and you can start {left} more today ({limit} a day). "
                "Try a smaller set, or try again later."
            ),
        )


def create(
    owner_id: uuid.UUID,
    team_id: str,
    *,
    a: int,
    b: int,
    task: str | None = None,
    task_set_id: str | None = None,
    auto_approve: bool,
) -> dict:
    task = (task or "").strip()
    with session_scope() as session:
        team = _require_team(session, team_id, owner_id)
        if a == b:
            raise HTTPException(status_code=422, detail="Pick two different versions to compare.")
        if task and task_set_id is not None:
            raise HTTPException(status_code=422, detail="Pick one task or a task set, not both.")
        tasks = None
        if task_set_id is not None:
            chosen = task_sets.team_set(session, team.id, task_set_id)
            set_uuid, task = chosen.id, chosen.name
            tasks = len(task_sets.items_of(session, chosen.id))
        elif not task:
            raise HTTPException(status_code=422, detail="Write the task both versions will run.")
        graphs = {}
        for label, number in zip(LABELS, (a, b), strict=True):
            version = versions._version(session, team, number)
            if version is None:
                raise HTTPException(status_code=422, detail=f"This team has no v{number}.")
            graphs[label] = version.graph
        active = session.execute(
            select(Compare).where(Compare.team_graph_id == team.id, Compare.status.in_(ACTIVE))
        ).scalar_one_or_none()
        if active is not None:
            _refresh(session, active)
            if active.status in ACTIVE:
                raise HTTPException(status_code=409, detail=_BUSY)
        team_uuid = team.id
        target = _target(session, team)
        if tasks is not None:
            _fits_today(owner_id, 2 * tasks)
        snapshots = {k: versions.run_snapshot(session, team, g) for k, g in graphs.items()}
    try:
        for snapshot in snapshots.values():
            _check_runnable(snapshot, owner_id)
        repo, base_ref = _authorise(owner_id, target)
        with session_scope() as session:
            if tasks is not None:
                # The set is locked from here to the commit (an edit waits, then sees this compare)
                # and its tasks counted again: an edit since the first read changed what runs.
                locked = session.execute(
                    select(TaskSet.id).where(TaskSet.id == set_uuid).with_for_update()
                ).scalar_one_or_none()
                if locked is None:
                    raise HTTPException(status_code=404, detail=task_sets.NOT_FOUND)
                tasks = len(task_sets.items_of(session, set_uuid))
            cmp = Compare(
                owner_id=owner_id,
                team_graph_id=team_uuid,
                version_a=a,
                version_b=b,
                task=task,
                auto_approve=auto_approve,
                repo=repo,
                base_ref=base_ref,
                status="waiting",
                task_set_id=set_uuid if tasks is not None else None,
                item_count=tasks,
            )
            session.add(cmp)
            session.flush()
            first = _pending(session, cmp, [])[0]
            started = _launch(session, cmp, snapshots, item=first)
            cid, status = cmp.id, cmp.status
            idea = first.task if first is not None else task
    except IntegrityError as exc:  # another compare of this team started meanwhile
        _drop(snapshots.values())
        raise HTTPException(status_code=409, detail=_BUSY) from exc
    except BaseException:
        _drop(snapshots.values())
        raise
    if started is None:
        _drop(snapshots.values())  # built again when two slots are free
        _spawn(cid)
    else:
        _start(started, idea)
        # A set's other tasks: as many as fit now, the rest by the waiter (which also retries a
        # task that failed to launch — the compare has started, so the POST still succeeds).
        if tasks is not None:
            try:
                rest = try_start(cid)
            except Exception:  # noqa: BLE001
                logger.exception("compare launch failed compare_id=%s", cid)
                rest = False
            if rest is False:
                _spawn(cid)
    return {
        "id": str(cid),
        "status": status,
        "runs": [
            {"label": label, "version": number, "run_id": started[k] if started else None}
            for k, (label, number) in enumerate(zip(LABELS, (a, b), strict=True))
        ],
    }


def try_start(compare_id: uuid.UUID) -> bool | None:
    """Start what a compare still has to launch, task by task while there is room: True all of it
    started, False still no room for the next task, None nothing to start (stopped, started
    elsewhere, or its team deleted) — checked under the compare's row lock, which a team delete's
    stop takes first. Each task is its own transaction (the module note)."""
    launched = False
    while True:
        with session_scope() as session:
            cmp = session.execute(
                select(Compare).where(Compare.id == compare_id).with_for_update()
            ).scalar_one_or_none()
            if (
                cmp is None
                or cmp.status not in ACTIVE
                or cmp.stop_requested
                or session.get(TeamGraph, cmp.team_graph_id) is None
            ):
                return True if launched else None
            pending = _pending(session, cmp)
            if not pending:
                return True if launched else None
            item = pending[0]
            started = _launch(session, cmp, waiter=True, item=item)
            idea = item.task if item is not None else cmp.task
        if started is None:
            return False
        _start(started, idea)
        launched = True


def _wait(compare_id: uuid.UUID) -> None:
    while True:
        time.sleep(POLL_S)
        try:
            if try_start(compare_id) is not False:
                return
        except Exception:  # noqa: BLE001 — keep waiting; the compare can still be stopped
            logger.exception("compare waiter failed compare_id=%s", compare_id)


def _spawn(compare_id: uuid.UUID) -> None:
    """A waiter for one waiting compare (tests patch this)."""
    threading.Thread(target=_wait, args=(compare_id,), daemon=True, name="compare-wait").start()


def rearm() -> None:
    """At startup: a waiter for every waiting compare and every running set compare with tasks
    still to launch. Hosted only (self-hosted never waits)."""
    if not get_settings().hosted_mode:
        return
    launched = select(func.count()).where(Run.pair_id == Compare.id).scalar_subquery()
    try:
        with session_scope() as session:
            ids = list(
                session.execute(
                    select(Compare.id).where(
                        or_(
                            Compare.status == "waiting",
                            and_(
                                Compare.status == "running",
                                Compare.item_count.is_not(None),
                                launched < 2 * Compare.item_count,
                            ),
                        )
                    )
                ).scalars()
            )
    except Exception:  # noqa: BLE001 — startup must not fail over a waiter
        logger.exception("compare waiters were not re-armed")
        return
    for cid in ids:
        _spawn(cid)


def stop(owner_id: uuid.UUID, compare_id: str) -> dict:
    """Both runs end Stopped (the run view's own Stop), the compare ``stopped``. Idempotent."""
    with session_scope() as session:
        cmp = _require(session, owner_id, compare_id, lock=True)
        runs = _refresh(session, cmp)
        stopping = []
        if cmp.status in ACTIVE:
            stopping = [r.workflow_id for r in runs]
            cmp.status, cmp.stop_requested, cmp.ended_at = "stopped", True, _now()
        status = cmp.status
    for run_id in stopping:
        cancel_run_core(run_id)
    return {"status": status}


# ---------------------------------------------------------------------------------- the view


def _slots(session, owner_id: uuid.UUID) -> dict:
    in_use = session.execute(
        select(func.count())
        .select_from(Run)
        .where(Run.owner_id == owner_id, Run.status.in_(_IN_FLIGHT))
    ).scalar_one()
    return {
        "in_use": in_use + agent_test_runner.replays_in_flight(session, owner_id),
        "limit": get_settings().hosted_max_concurrent_runs_per_owner,
    }


def _files(run: Run) -> int | None:
    """Files in the run's newest M3 checkpoint diff (None: no usable checkpoint)."""
    # ponytail: reads the diff (up to 20 MB) on each results poll; store the count if it shows up.
    cp = checkpoints.newest(run.workflow_id, with_diff=True)
    if cp is None or cp.diff is None:
        return None
    greenfield = run.repo_path is None and run.github_repo is None
    return sum(
        1
        for raw in _FILE.findall(cp.diff)
        if not resume._own_file(path := raw.decode("utf-8", "replace"))
        # The greenfield workspace's own .gitignore is the setup's, not the run's work.
        and not (greenfield and path == ".gitignore")
    )


def _lane(session, run: Run, extras: dict, live: dict) -> dict:
    """One run's lane and the facts its results row needs."""
    act = activity.run_activity(session, run, resume_info=False)
    lines, agents = act["lines"], act["agents"]
    status = _SIDE_STATUS.get(run.status, "stopped")
    done = next((ln for ln in reversed(lines) if ln["id"] == "run:done"), None)
    elapsed = done["refs"]["elapsed_s"] if done else int((_now() - run.created_at).total_seconds())
    steps = [a["iteration"] for a in agents if a["kind"] in ("agent", "completion")]
    rounds = max(steps, default=0)
    verdict = next((ln for ln in reversed(lines) if ln["kind"] == "verdict"), None)
    approved = verdict is not None and verdict["refs"]["verdict"] == "approved"
    tests = next((ln for ln in reversed(lines) if ln["kind"] == "tests"), None)
    host = dict(
        session.execute(
            select(RunEvent.kind, func.count())
            .where(RunEvent.run_id == run.workflow_id, RunEvent.kind.in_(("retry", "stalled")))
            .group_by(RunEvent.kind)
        ).all()
    )
    if status == "finished":
        word = "Approved" if approved else "Finished"
        result = f"{word} in round {rounds}"
    elif status == "failed":
        word = "Failed"
        result = f"Failed: {(extras['failure'] or {}).get('message') or 'the run failed'}"
    else:
        word = result = "Stopped"
    current = None
    if status in ("running", "needs_you"):
        current = _current(agents)
    elif status in ("finished", "failed", "stopped"):
        current = {"label": word, "text": f"in round {rounds}" if rounds else ""}
    pinned = act["pinned"]
    return {
        "run_id": str(run.id),
        "number": extras["number"],
        "status": status,
        "elapsed_s": elapsed,
        "cost_usd": round(run_views.spent_usd(run, live), 2),
        "strip": extras["progress"],
        "current": current,
        "lines": lines[-4:],
        "gate_task_id": pinned["task_id"] if pinned and pinned["kind"] == "gate" else None,
        "_facts": {
            "status": status,
            "result": result,
            "approved": approved,
            "rounds": rounds,
            "cost": run_views.spent_usd(run, live),
            "elapsed": elapsed,
            "tests": (tests["refs"]["passed"], tests["refs"]["passed"] + tests["refs"]["failed"])
            if tests
            else None,
            "retries": host.get("retry", 0),
            "stalls": host.get("stalled", 0),
            "files": _files(run) if status != "running" and status != "needs_you" else None,
        },
    }


def _current(agents: list[dict]) -> dict | None:
    """The step a running run is on: ``{"label": "Engineer", "text": "round 3"}``, a gate
    ``{"label": <gate>, "text": "waiting for you"}``, or None."""
    busy = next(
        (a for a in agents if a["live_state"] not in ("waiting", "done", "failed", "stopped")),
        None,
    )
    if busy is None:
        return None
    return {
        "label": busy["label"],
        "text": "waiting for you"
        if busy["kind"] == "gate"
        else f"round {max(busy['iteration'], 1)}",
    }


def _queued_strip(graph: dict) -> list[dict]:
    """A lane with no run yet (Cmp-Queued): its version's steps as Home's chips
    (``run_views._progress``'s shape and order), none started. Ids are the library node ids."""
    nodes = {n["id"]: n for n in graph.get("nodes") or []}
    order, loops = run_views.walk_order(list(nodes.values()), graph.get("edges") or [])
    return [
        {
            "node_id": nid,
            "origin_node_id": nid,
            "role_name": nodes[nid]["role_name"],
            "label": node_label(nodes[nid]["role_name"], nodes[nid]["kind"], nodes[nid]["config"]),
            "kind": nodes[nid]["kind"],
            "state": "idle",
            "loops_with": loops.get(nid),
            "carried": False,
        }
        for nid in order
    ]


def view(owner_id: uuid.UUID, compare_id: str) -> dict:
    with session_scope() as session:
        cmp = _require(session, owner_id, compare_id)
        listed = _refresh(session, cmp)
        if cmp.item_count is not None:
            return _set_view(session, cmp, listed)
        runs = {r.pair_label: r for r in listed}
        team = session.get(TeamGraph, cmp.team_graph_id)
        extras = run_views.run_extras(session, list(runs.values()), include_progress=True)
        live = run_views.live_costs(session, [r.workflow_id for r in runs.values()])
        sides, facts = [], {}
        for label, number in zip(LABELS, (cmp.version_a, cmp.version_b), strict=True):
            run = runs.get(label)
            if run is None:
                lane = {
                    "run_id": None,
                    "number": None,
                    "status": "waiting",
                    "elapsed_s": 0,
                    "cost_usd": 0.0,
                    "strip": _queued_strip(versions._version(session, team, number).graph),
                    "current": None,
                    "lines": [],
                    "gate_task_id": None,
                }
            else:
                lane = _lane(session, run, extras[run.id], live)
                facts[label] = lane.pop("_facts")
            sides.append({"label": label, "version": number, **lane})
        ended = cmp.status in ("finished", "stopped")
        results = None
        if ended:
            # M9: "One task is a small sample · Compare on <set>".
            results = {
                **_results(session, cmp, facts),
                "sample": task_sets.sample(session, team.id),
            }
        return {
            **_head(cmp, sum(f["cost"] for f in facts.values())),
            "waiting": _slots(session, cmp.owner_id) if cmp.status == "waiting" else None,
            "sides": sides,
            "results": results,
        }


def _head(cmp: Compare, cost: float) -> dict:
    return {
        "id": str(cmp.id),
        "team_id": str(cmp.team_graph_id),
        "task": cmp.task,
        "auto_approve": cmp.auto_approve,
        "status": cmp.status,
        "elapsed_s": int(
            ((cmp.ended_at or _now()) - (cmp.started_at or cmp.created_at)).total_seconds()
        ),
        "cost_usd": round(cost, 2),
        "created_at": cmp.created_at.isoformat(),
        "ended_at": cmp.ended_at.isoformat() if cmp.ended_at else None,
    }


# ------------------------------------------------------------------------- M9: a set compare


def _facts(session, runs: list[Run]) -> dict[uuid.UUID, dict]:
    """What a set compare shows of each run, in a few queries for all of them: its cell status,
    hidden check (True / False / None) and its output's last line, rounds (the highest round of
    an agent), cost, retries and stalls."""
    if not runs:
        return {}
    wids = [r.workflow_id for r in runs]
    rounds = dict(
        session.execute(
            select(AgentInvocation.run_id, func.max(AgentInvocation.iteration))
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id.in_(wids), AgentNode.kind.in_(("agent", "completion")))
            .group_by(AgentInvocation.run_id)
        ).all()
    )
    host = Counter()
    for wid, kind, n in session.execute(
        select(RunEvent.run_id, RunEvent.kind, func.count())
        .where(RunEvent.run_id.in_(wids), RunEvent.kind.in_(("retry", "stalled")))
        .group_by(RunEvent.run_id, RunEvent.kind)
    ).all():
        host[(wid, kind)] = n
    checks = {
        row.run_id: row
        for row in session.execute(
            select(HiddenCheckResult).where(HiddenCheckResult.run_id.in_([r.id for r in runs]))
        ).scalars()
    }
    live = run_views.live_costs(session, wids)
    out = {}
    for run in runs:
        check = checks.get(run.id)
        lines = check.output_tail.splitlines() if check is not None else []
        out[run.id] = {
            "status": _CELL_STATUS.get(run.status, "stopped"),
            "check": check.passed if check is not None else None,
            "last_line": lines[-1] if lines else None,
            "failure": run.failure_message,
            "rounds": int(rounds.get(run.workflow_id) or 0),
            "cost": run_views.spent_usd(run, live),
            "retries": host[(run.workflow_id, "retry")],
            "stalls": host[(run.workflow_id, "stalled")],
        }
    return out


_NO_CELL = {
    "run_id": None,
    "status": "waiting",
    "now": None,
    "check": None,
    "rounds": 0,
    "cost_usd": 0.0,
    "note": None,
}


def _cell(session, run: Run | None, f: dict | None) -> dict:
    """One side of one task; a task not launched yet (no run) is "waiting"."""
    if run is None:
        return dict(_NO_CELL)
    now = None
    if f["status"] == "running":
        current = _current(activity.run_activity(session, run, resume_info=False)["agents"])
        now = f"{current['label']} · {current['text']}" if current else None
    note = None
    if f["check"] is False:
        note = f["last_line"]
    elif f["status"] == "failed":
        note = f["failure"] or "The run failed."
    return {
        "run_id": str(run.id),
        "status": f["status"],
        "now": now,
        "check": {True: "passed", False: "failed"}.get(f["check"]),
        "rounds": f["rounds"],
        "cost_usd": round(f["cost"], 2),
        "note": note,
    }


def _badge(cmp: Compare, fa: dict | None, fb: dict | None) -> str | None:
    """One task's verdict once both sides ended: the hidden check first, then finishing, then
    fewer rounds ("v7 better"); a tie on all three is decided by cost ("v7 costs more") or
    "same"."""
    if fa is None or fb is None or fa["status"] not in _ENDED or fb["status"] not in _ENDED:
        return None

    def key(f):
        done = f["status"] == "finished"
        return (f["check"] is True, done, -f["rounds"] if done else 0)

    if key(fa) != key(fb):
        return f"v{cmp.version_b if key(fb) > key(fa) else cmp.version_a} better"
    a, b = round(fa["cost"], 2), round(fb["cost"], 2)
    if abs(b - a) > 0.004:
        return f"v{cmp.version_b if b > a else cmp.version_a} costs more"
    return "same"


def _sides_facts(groups: list[dict], facts: dict) -> dict[str, list[dict]]:
    return {label: [facts[g[label].id] for g in groups if label in g] for label in LABELS}


def _many(n: int, one: str, more: str) -> str:
    return one if n == 1 else more


def _tone(b_better: bool, b_worse: bool) -> str | None:
    return "good" if b_better else "warn" if b_worse else None


def _cards(cmp: Compare, by: dict[str, list[dict]]) -> tuple[list[dict], int | None]:
    """The set's result cards — bare values (the page adds "v6 " / "v7 "), a note and a tone for
    B against A — and the version that did better (None: about the same). The hidden checks
    decide first; else most of rounds, cost and steadiness."""
    total = cmp.item_count or 0
    passed = {k: sum(1 for f in fs if f["check"] is True) for k, fs in by.items()}
    rounds = {k: sum(f["rounds"] for f in fs) / len(fs) if fs else 0.0 for k, fs in by.items()}
    cost = {k: round(sum(f["cost"] for f in fs), 2) for k, fs in by.items()}
    shaky = {
        k: {"retries": sum(f["retries"] for f in fs), "stalls": sum(f["stalls"] for f in fs)}
        for k, fs in by.items()
    }
    d_pass = passed["B"] - passed["A"]
    n_rounds = math.floor(abs(rounds["B"] - rounds["A"]) + 0.5)  # half a round counts as one
    d_cost = cost["B"] - cost["A"]
    d_shaky = sum(shaky["B"].values()) - sum(shaky["A"].values())
    if d_pass:
        checks_note = f"{abs(d_pass)} {'more' if d_pass > 0 else 'fewer'} " + _many(
            abs(d_pass), "task really works", "tasks really work"
        )
    else:
        checks_note = "same"
    if n_rounds:
        word = "fewer" if rounds["B"] < rounds["A"] else "more"
        rounds_note = f"about {n_rounds} {word} " + _many(n_rounds, "round", "rounds")
    else:
        rounds_note = "about the same"
    if abs(d_cost) <= 0.004:
        cost_note = "same"
    else:
        cost_note = f"{_money(abs(d_cost))} {'less' if d_cost < 0 else 'more'} in all"
    shaky_note = "same" if not d_shaky else ("steadier runs" if d_shaky < 0 else "less steady runs")
    fewer_rounds = rounds["B"] < rounds["A"]
    cards = [
        {
            "key": "checks",
            "label": "Hidden checks passed",
            "a": f"{passed['A']} of {total}",
            "b": f"{passed['B']} of {total}",
            "note": checks_note,
            "tone": _tone(d_pass > 0, d_pass < 0),
        },
        {
            "key": "rounds",
            "label": "Rounds per task",
            "a": f"{rounds['A']:.1f}",
            "b": f"{rounds['B']:.1f}",
            "note": rounds_note,
            "tone": _tone(bool(n_rounds) and fewer_rounds, bool(n_rounds) and not fewer_rounds),
        },
        {
            "key": "cost",
            "label": "Cost",
            "a": _money(cost["A"]),
            "b": _money(cost["B"]),
            "note": cost_note,
            "tone": _tone(d_cost < -0.004, d_cost > 0.004),
        },
        {
            "key": "retries",
            "label": "Retries and stalls",
            "a": str(sum(shaky["A"].values())),
            "b": str(sum(shaky["B"].values())),
            "note": shaky_note,
            "tone": _tone(d_shaky < 0, d_shaky > 0),
        },
    ]
    if d_pass:
        return cards, cmp.version_b if d_pass > 0 else cmp.version_a
    votes = [
        (-1 if fewer_rounds else 1) if n_rounds else 0,
        -1 if d_cost < -0.004 else 1 if d_cost > 0.004 else 0,
        -1 if d_shaky < 0 else 1 if d_shaky > 0 else 0,
    ]
    score = sum(votes)  # below 0: B did better
    return cards, (cmp.version_b if score < 0 else cmp.version_a) if score else None


def _set_items(session, cmp: Compare, runs: list[Run]) -> tuple[list[dict], dict, list, list]:
    """The rows of a set compare's table, the facts of its runs, its runs by task and the tasks
    still to launch."""
    groups = _groups(runs)
    facts = _facts(session, runs)
    pending = _pending(session, cmp, runs) if cmp.status in ACTIVE else []
    items = []
    for g in groups:
        a, b = g.get("A"), g.get("B")
        fa, fb = (facts[r.id] if r is not None else None for r in (a, b))
        items.append(
            {
                "task": (a or b).idea,
                "a": _cell(session, a, fa),
                "b": _cell(session, b, fb),
                "badge": _badge(cmp, fa, fb),
            }
        )
    items += [
        {
            "task": it.task,
            "a": _cell(session, None, None),
            "b": _cell(session, None, None),
            "badge": None,
        }
        for it in pending
    ]
    return items, facts, groups, pending


def _set_view(session, cmp: Compare, runs: list[Run]) -> dict:
    team = session.get(TeamGraph, cmp.team_graph_id)
    items, facts, groups, pending = _set_items(session, cmp, runs)
    by = _sides_facts(groups, facts)
    head = _head(cmp, sum(f["cost"] for f in facts.values()))
    sides = []
    for label, number in zip(LABELS, (cmp.version_a, cmp.version_b), strict=True):
        mine = [g[label] for g in groups if label in g]
        live = any(r.status in _IN_FLIGHT for r in mine)
        sides.append(
            {
                "label": label,
                "version": number,
                "run_id": None,
                "number": None,
                "status": "running" if live else ("finished" if mine else "waiting"),
                "elapsed_s": head["elapsed_s"],
                "cost_usd": round(sum(f["cost"] for f in by[label]), 2),
                "strip": _queued_strip(versions._version(session, team, number).graph),
                "current": None,
                "lines": [],
                "gate_task_id": None,
            }
        )
    results = None
    if cmp.status in ("finished", "stopped"):
        current = versions.latest(session, team).number
        cards, winner = _cards(cmp, by) if groups else ([], None)
        if cmp.status == "stopped":
            headline, winner = "You stopped this compare", None
        elif winner is not None:
            headline = f"v{winner} did better on this set"
        else:
            headline = f"v{cmp.version_a} and v{cmp.version_b} did about the same"
        results = {
            "headline": headline,
            "rows": [],
            "cards": cards,
            "current_version": current,
            "restore": winner if winner is not None and winner != current else None,
        }
    return {
        **head,
        "set": {
            "id": str(cmp.task_set_id) if cmp.task_set_id else None,
            "name": cmp.task,
            "count": cmp.item_count,
        },
        # Runs started (of 2 x tasks) and runs still to start; M8's ``waiting`` stays the owner's
        # slots while nothing has started.
        "started": len(runs),
        "runs_waiting": 2 * len(pending),
        "waiting": _slots(session, cmp.owner_id) if cmp.status == "waiting" else None,
        "items": items,
        "sides": sides,
        "results": results,
    }


def last_used(session, set_id: uuid.UUID) -> dict | None:
    """The newest compare on a set, with a plain summary: "v7 better on 4 of 5"."""
    cmp = session.execute(
        select(Compare)
        .where(Compare.task_set_id == set_id)
        .order_by(Compare.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if cmp is None:
        return None
    runs = _refresh(session, cmp)
    if cmp.status in ACTIVE:
        summary = "Running now"
    elif cmp.status == "stopped":
        summary = "Stopped"
    else:
        facts = _facts(session, runs)
        wins = Counter(
            _badge(cmp, facts[g["A"].id], facts[g["B"].id])
            for g in _groups(runs)
            if "A" in g and "B" in g
        )
        a, b = wins[f"v{cmp.version_a} better"], wins[f"v{cmp.version_b} better"]
        n = cmp.item_count or 0
        if a == b:
            summary = f"About the same on {n} " + _many(n, "task", "tasks")
        else:
            summary = f"v{cmp.version_b if b > a else cmp.version_a} better on {max(a, b)} of {n}"
    return {
        "compare_id": str(cmp.id),
        "a": cmp.version_a,
        "b": cmp.version_b,
        "at": cmp.created_at.isoformat(),
        "summary": summary,
    }


def version_checks(session, team: TeamGraph) -> dict[int, dict]:
    """R6: each version's set check — the newest set compare (not stopped) that ran it as B
    against an earlier version — keyed by version number. Derived, never stored."""
    newest: dict[int, Compare] = {}
    for cmp in session.execute(
        select(Compare)
        .where(
            Compare.team_graph_id == team.id,
            Compare.item_count.is_not(None),
            Compare.status != "stopped",
            Compare.version_a < Compare.version_b,
        )
        .order_by(Compare.created_at.desc())
    ).scalars():
        newest.setdefault(cmp.version_b, cmp)
    out = {}
    for number, cmp in newest.items():
        runs = _refresh(session, cmp)
        by = _sides_facts(_groups(runs), _facts(session, runs))
        passed = {k: sum(1 for f in fs if f["check"] is True) for k, fs in by.items()}
        cost = {k: sum(f["cost"] for f in fs) for k, fs in by.items()}
        finished = cmp.status == "finished"
        out[number] = {
            "compare_id": str(cmp.id),
            "set": cmp.task,
            "passed": passed["B"],
            "total": cmp.item_count,
            "against": cmp.version_a,
            "against_passed": passed["A"],
            "cost_delta_usd": round(cost["B"] - cost["A"], 2),
            "status": "finished" if finished else "running",
            "worse": finished and passed["B"] < passed["A"],
            "ended_at": cmp.ended_at.isoformat() if finished and cmp.ended_at else None,
        }
    return out


# ------------------------------------------------------------------------------- the results


def _money(v: float) -> str:
    return f"${v:,.2f}"


def _signed(d: float, fmt) -> str:
    return ("−" if d < 0 else "+") + fmt(abs(d))


def _better(a: float | None, b: float | None, *, lower: bool, near: float = 0) -> str | None:
    """Which side's number is better; None when either is missing or they are within ``near``."""
    if a is None or b is None or abs(b - a) <= near:
        return None
    return "b" if (b < a) == lower else "a"


def _count(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _retries(f: dict) -> str:
    parts = []
    if f["retries"]:
        parts.append(f"{f['retries']} " + ("retry" if f["retries"] == 1 else "retries"))
    if f["stalls"]:
        parts.append(_count(f["stalls"], "stall"))
    return ", ".join(parts) or "none"


def _of(pair) -> str:
    return f"{pair[0]} of {pair[1]}" if pair else "—"


def _agent_tests(session, cmp: Compare) -> tuple[str, dict] | None:
    """The tested agent (the one with the most tests) and its newest finished test run's
    ``(passed, total)`` on each version, or None when no agent of the team has tests.

    ponytail: one agent's row; one row per tested agent if teams commonly test several."""
    tested = session.execute(
        select(AgentTest.node_id)
        .where(AgentTest.team_id == cmp.team_graph_id)
        .group_by(AgentTest.node_id)
        .order_by(func.count().desc(), AgentTest.node_id)
        .limit(1)
    ).scalar_one_or_none()
    if tested is None:
        return None
    node = session.get(AgentNode, tested)
    newest: dict[int, AgentTestRun] = {}
    for run in session.execute(
        select(AgentTestRun)
        .where(
            AgentTestRun.node_id == tested,
            AgentTestRun.status == "done",
            AgentTestRun.version_number.in_((cmp.version_a, cmp.version_b)),
        )
        .order_by(AgentTestRun.created_at.desc())
    ).scalars():
        newest.setdefault(run.version_number, run)
    passed = (
        dict(
            session.execute(
                select(AgentTestResult.test_run_id, func.count())
                .where(
                    AgentTestResult.test_run_id.in_([r.id for r in newest.values()]),
                    AgentTestResult.status == "passed",
                )
                .group_by(AgentTestResult.test_run_id)
            ).all()
        )
        if newest
        else {}
    )
    label = node_label(node.role_name, node.kind, node.config)
    return label, {n: (int(passed.get(r.id, 0)), r.total) for n, r in newest.items()}


def _row(key: str, label: str, a: str, b: str, better=None, difference: str = "") -> dict:
    return {
        "key": key,
        "label": label,
        "a": a,
        "b": b,
        "better": better,
        "difference": difference,
    }


def _rows(fa: dict, fb: dict, tested: tuple | None, cmp: Compare, both: bool) -> list[dict]:
    def mark(key, label, a, b, x, y, *, lower, near=0.0, diff=None):
        better = _better(x, y, lower=lower, near=near) if both else None
        difference = ""
        if both and diff is not None and x is not None and y is not None:
            difference = "same" if abs(y - x) <= near else diff(y - x)
        return _row(key, label, a, b, better, difference)

    if both and fa["approved"] != fb["approved"]:
        # Approval first: "Approved" beats "Finished" (never approved) whatever the rounds.
        better = "a" if fa["approved"] else "b"
        result = _row("result", "Result", fa["result"], fb["result"], better)
    else:
        result = mark(
            "result",
            "Result",
            fa["result"],
            fb["result"],
            fa["rounds"],
            fb["rounds"],
            lower=True,
            diff=lambda d: f"{_count(abs(d), 'fewer round' if d < 0 else 'more round')}",
        )
    rows = [
        result,
        mark(
            "cost",
            "Cost",
            _money(fa["cost"]),
            _money(fb["cost"]),
            round(fa["cost"], 2),
            round(fb["cost"], 2),
            lower=True,
            near=0.004,
            diff=lambda d: _signed(d, _money),
        ),
        mark(
            "time",
            "Time",
            activity._span(fa["elapsed"]),
            activity._span(fb["elapsed"]),
            fa["elapsed"],
            fb["elapsed"],
            lower=True,
            near=59,
            diff=lambda d: _signed(d, lambda s: f"{round(s / 60)}m"),
        ),
        mark(
            "repo_tests",
            "Repo tests passing",
            _of(fa["tests"]),
            _of(fb["tests"]),
            fa["tests"][0] if fa["tests"] else None,
            fb["tests"][0] if fb["tests"] else None,
            lower=False,
            diff=lambda d: _signed(d, lambda n: f"{n:g}"),
        ),
    ]
    if tested is not None:
        label, by_version = tested
        pa, pb = by_version.get(cmp.version_a), by_version.get(cmp.version_b)
        rows.append(
            mark(
                "agent_tests",
                f"{label}’s tests",
                _of(pa),
                _of(pb),
                pa[0] if pa else None,
                pb[0] if pb else None,
                lower=False,
                diff=lambda d: _signed(d, lambda n: f"{n:g}"),
            )
        )
    rows += [
        mark(
            "retries",
            "Retries and stalls",
            _retries(fa),
            _retries(fb),
            fa["retries"] + fa["stalls"],
            fb["retries"] + fb["stalls"],
            lower=True,
        ),
        _row(
            "files",
            "Files changed",
            str(fa["files"]) if fa["files"] is not None else "—",
            str(fb["files"]) if fb["files"] is not None else "—",
        ),
    ]
    return rows


def _results(session, cmp: Compare, facts: dict) -> dict:
    team = session.get(TeamGraph, cmp.team_graph_id)
    current = versions.latest(session, team).number
    va, vb = f"v{cmp.version_a}", f"v{cmp.version_b}"
    rows: list[dict] = []
    winner = None
    if len(facts) < 2:
        headline = "You stopped this compare"
    else:
        fa, fb = facts["A"], facts["B"]
        both = fa["status"] == fb["status"] == "finished"
        rows = _rows(fa, fb, _agent_tests(session, cmp), cmp, both)
        wins = Counter(r["better"] for r in rows)
        if cmp.status == "stopped":
            headline = "You stopped this compare"
        elif both and wins["a"] != wins["b"]:
            winner = cmp.version_a if wins["a"] > wins["b"] else cmp.version_b
            headline = f"v{winner} did better on this task"
        elif both:
            headline = f"{va} and {vb} did about the same"
        elif "finished" in (fa["status"], fb["status"]):
            ok, other = (va, fb) if fa["status"] == "finished" else (vb, fa)
            name = vb if ok == va else va
            ended = "failed" if other["status"] == "failed" else "stopped"
            headline = f"{ok} finished; {name} {ended} on this task"
            if ended == "failed":  # Cmp-SideFailed: Restore the version that finished
                winner = cmp.version_a if ok == va else cmp.version_b
        else:
            headline = "Neither version finished this task"
    return {
        "headline": headline,
        "rows": rows,
        "current_version": current,
        "restore": winner if winner is not None and winner != current else None,
    }
