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
Openhands-free."""

from __future__ import annotations

import logging
import math
import re
import threading
import time
import uuid
from collections import Counter
from datetime import UTC, datetime

from dbos import DBOS, SetWorkflowID
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError

from tvashtr.config import get_settings
from tvashtr.control_plane import (
    activity,
    agent_test_runner,
    checkpoints,
    github_app,
    resume,
    run_views,
    versions,
)
from tvashtr.control_plane.graph_validity import graph_dicts, owner_domain_ids, validate_graph
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import cancel_run_core
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentNode,
    AgentTest,
    AgentTestResult,
    AgentTestRun,
    Compare,
    GithubInstallation,
    Run,
    RunEvent,
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


def _runs(session, cmp: Compare) -> dict[str, Run]:
    rows = session.execute(select(Run).where(Run.pair_id == cmp.id)).scalars().all()
    return {r.pair_label: r for r in rows}


def _refresh(session, cmp: Compare) -> dict[str, Run]:
    """Its runs by label; a running compare is ``finished`` once both have ended (read time:
    nothing watches it)."""
    runs = _runs(session, cmp)
    if (
        cmp.status == "running"
        and len(runs) == 2
        and all(r.status in run_views.TERMINAL_STATUSES for r in runs.values())
    ):
        cmp.status, cmp.ended_at = "finished", max(r.updated_at for r in runs.values())
    return runs


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
    session, cmp: Compare, snapshots: dict | None = None, *, waiter: bool = False
) -> list[str] | None:
    """Insert both runs (in ``session``) when the hosted caps have room for two, else None (wait).
    Only the owner's own run slots make a new compare wait (Cmp-Queued); the daily and fleet caps
    refuse it with ``POST /api/runs``'s 429. A ``waiter`` waits on any cap. Under the owner's slot
    lock (M7's), so a compare and a replay never both take the last slot. The caller starts their
    workflows after the commit."""
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
                idea=cmp.task,
                workflow_id=str(run_id),
                status="running",
                budget_cap_usd=cap,
                github_repo=cmp.repo,
                base_ref=cmp.base_ref,
                library_team_id=team.id,
                team_version_number=number,
                pair_id=cmp.id,
                pair_label=label,
            )
        )
        ids.append(str(run_id))
    cmp.status, cmp.started_at = "running", _now()
    session.flush()
    return ids


def _start(run_ids: list[str], task: str) -> None:
    for run_id in run_ids:
        with SetWorkflowID(run_id):
            DBOS.start_workflow(run_team, task)


def create(
    owner_id: uuid.UUID, team_id: str, *, a: int, b: int, task: str, auto_approve: bool
) -> dict:
    task = task.strip()
    with session_scope() as session:
        team = _require_team(session, team_id, owner_id)
        if a == b:
            raise HTTPException(status_code=422, detail="Pick two different versions to compare.")
        if not task:
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
        snapshots = {k: versions.run_snapshot(session, team, g) for k, g in graphs.items()}
    try:
        for snapshot in snapshots.values():
            _check_runnable(snapshot, owner_id)
        repo, base_ref = _authorise(owner_id, target)
        with session_scope() as session:
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
            )
            session.add(cmp)
            session.flush()
            started = _launch(session, cmp, snapshots)
            cid, status = cmp.id, cmp.status
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
        _start(started, task)
    return {
        "id": str(cid),
        "status": status,
        "runs": [
            {"label": label, "version": number, "run_id": started[k] if started else None}
            for k, (label, number) in enumerate(zip(LABELS, (a, b), strict=True))
        ],
    }


def try_start(compare_id: uuid.UUID) -> bool | None:
    """Start a waiting compare's two runs if there is room: True started, False still no room,
    None no longer waiting (stopped, started elsewhere, or its team deleted) — checked under the
    compare's row lock, which a team delete's stop takes first."""
    with session_scope() as session:
        cmp = session.execute(
            select(Compare).where(Compare.id == compare_id).with_for_update()
        ).scalar_one_or_none()
        if (
            cmp is None
            or cmp.status != "waiting"
            or cmp.stop_requested
            or session.get(TeamGraph, cmp.team_graph_id) is None
        ):
            return None
        started = _launch(session, cmp, waiter=True)
        task = cmp.task
    if started is None:
        return False
    _start(started, task)
    return True


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
    """At startup: a waiter for every waiting compare. Hosted only (self-hosted never waits)."""
    if not get_settings().hosted_mode:
        return
    try:
        with session_scope() as session:
            ids = list(
                session.execute(select(Compare.id).where(Compare.status == "waiting")).scalars()
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
            stopping = [r.workflow_id for r in runs.values()]
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
        busy = next(
            (a for a in agents if a["live_state"] not in ("waiting", "done", "failed", "stopped")),
            None,
        )
        if busy is not None:
            current = {
                "label": busy["label"],
                "text": "waiting for you"
                if busy["kind"] == "gate"
                else f"round {max(busy['iteration'], 1)}",
            }
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
        runs = _refresh(session, cmp)
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
        return {
            "id": str(cmp.id),
            "team_id": str(cmp.team_graph_id),
            "task": cmp.task,
            "auto_approve": cmp.auto_approve,
            "status": cmp.status,
            "elapsed_s": int(
                ((cmp.ended_at or _now()) - (cmp.started_at or cmp.created_at)).total_seconds()
            ),
            "cost_usd": round(sum(f["cost"] for f in facts.values()), 2),
            "created_at": cmp.created_at.isoformat(),
            "ended_at": cmp.ended_at.isoformat() if cmp.ended_at else None,
            "waiting": _slots(session, cmp.owner_id) if cmp.status == "waiting" else None,
            "sides": sides,
            "results": _results(session, cmp, facts) if ended else None,
        }


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
