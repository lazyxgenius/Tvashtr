"""Run list views for Home (revamp P3 / G-6) and the launch options ``POST /api/runs`` checks.

``GET /api/runs`` used to return ``{run_id, idea, status, created_at, repo_path}`` for every run.
Home needs, per run: its library team, its target, the PR, live spend against its budget, whether it
waits for the user (and at which gate), a readable failure, and — for "Running now" — one progress
chip per node. Everything here is batched over a page of runs (a fixed number of queries, never one
per run), read-only, and owner-scoped by the caller.

Openhands-free, like the rest of ``control_plane``.
"""

import base64
import binascii
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, or_, select, tuple_

from tvashtr.control_plane import live_state
from tvashtr.control_plane.run_failure import describe_run_failure, node_label
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    Compare,
    CostRecord,
    Edge,
    HumanTask,
    Run,
    RunCheckpoint,
    TeamGraph,
)

TERMINAL_STATUSES = ("completed", "failed", "rejected", "cancelled", "over_budget")

# ``status_group`` of a run (the Recent-runs filter and the badge family).
_GROUP_OF = {
    "pending": "running",
    "running": "running",
    "awaiting_human": "needs_you",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "stopped",
    "rejected": "stopped",
    "over_budget": "stopped",
}

# ``GET /api/runs?status=`` — a group name, ``active`` (everything in flight, awaiting included), or
# ``all``.
STATUS_FILTERS: dict[str, tuple[str, ...] | None] = {
    "all": None,
    "active": ("pending", "running", "awaiting_human"),
    "running": ("pending", "running"),
    "needs_you": ("awaiting_human",),
    "completed": ("completed",),
    "failed": ("failed",),
    "stopped": ("cancelled", "rejected", "over_budget"),
}

DEFAULT_LIMIT = 50
MAX_LIMIT = 100

# The largest per-run budget a launch may ask for (the operator's ceiling on one run's spend).
MAX_RUN_BUDGET_USD = Decimal("500")


# ---------------------------------------------------------------------------------- pure fields


def status_group(status: str) -> str:
    return _GROUP_OF.get(status, "running")


def pr_number(pr_url: str | None) -> int | None:
    """``42`` from ``https://github.com/o/r/pull/42`` (``None`` when absent or not a PR url)."""
    if not pr_url or "/pull/" not in pr_url:
        return None
    tail = pr_url.rstrip("/").rsplit("/pull/", 1)[1].split("/", 1)[0]
    return int(tail) if tail.isdigit() else None


def run_target(run: Run) -> dict:
    """What the run works on: a GitHub repo, a Desktop folder, a server-local path, or nothing."""
    if run.github_repo:
        kind, label = "github", run.github_repo
    elif run.local_repo_label:
        kind, label = "desktop_folder", run.local_repo_label
    elif run.repo_path:
        kind, label = "local", run.repo_path
    else:
        kind, label = "none", None
    return {"kind": kind, "label": label, "base_ref": run.base_ref, "subpath": run.subpath}


def _money(value) -> float | None:
    return float(value) if value is not None else None


def run_fields(run: Run) -> dict:
    """The run-level fields that come straight off the row (no extra query)."""
    return {
        "status_group": status_group(run.status),
        "updated_at": run.updated_at.isoformat(),
        "github_repo": run.github_repo,
        "base_ref": run.base_ref,
        "subpath": run.subpath,
        "target": run_target(run),
        "pr_url": run.pr_url,
        "pr_number": pr_number(run.pr_url),
        "ship_branch": run.ship_branch,
        "budget_cap_usd": _money(run.budget_cap_usd),
        "desktop_target": bool(run.desktop_target),
        "library_team_id": str(run.library_team_id) if run.library_team_id else None,
        "retry_of_run_id": str(run.retry_of_run_id) if run.retry_of_run_id else None,
        # M5: the version of its library team the run started on (None before M5 / ephemeral).
        "team_version_number": run.team_version_number,
    }


def _is_loop_edge(edge: dict) -> bool:
    cond = edge.get("conditions")
    return isinstance(cond, dict) and (
        "loop_limit" in cond or cond.get("when") == "changes_requested"
    )


def walk_order(nodes: list[dict], edges: list[dict]) -> tuple[list[str], dict[str, str]]:
    """The order a team's nodes are shown in (the progress strip), plus its loop-backs.

    Starts at the root (no incoming edge — the executor's rule), follows forward edges (not
    ``escalation``, not a loop-back), and orders the nodes it reaches topologically, breaking ties
    by canvas position. ``stop`` terminals and nodes reachable only through an escalation are left
    out. Returns ``(node_ids, loops)`` where ``loops`` maps a loop-back edge's source to its target
    (the Reviewer → the Engineer), so a strip can draw "Engineer ⇄ Reviewer"."""
    by_id = {n["id"]: n for n in nodes}
    if not by_id:
        return [], {}

    def key(nid: str) -> tuple:
        pos = by_id[nid].get("position") or {}
        return (pos.get("x", 0), pos.get("y", 0), nid)

    edges = [e for e in edges if e["source"] in by_id and e["target"] in by_id]
    targeted = {e["target"] for e in edges}
    roots = sorted(nid for nid in by_id if nid not in targeted)
    root = roots[0] if roots else min(by_id, key=key)
    forward = [e for e in edges if e.get("edge_type") != "escalation" and not _is_loop_edge(e)]
    adjacency: dict[str, list[str]] = {}
    for e in forward:
        adjacency.setdefault(e["source"], []).append(e["target"])

    reached, frontier = {root}, [root]
    while frontier:
        for nxt in adjacency.get(frontier.pop(), []):
            if nxt not in reached:
                reached.add(nxt)
                frontier.append(nxt)

    def is_stop(nid: str) -> bool:
        node = by_id[nid]
        cfg = node.get("config") or {}
        return node.get("kind") == "terminal" and cfg.get("terminal_kind") == "stop"

    keep = {nid for nid in reached if not is_stop(nid)}
    indegree = {nid: 0 for nid in keep}
    for e in forward:
        if e["source"] in keep and e["target"] in keep:
            indegree[e["target"]] += 1
    order: list[str] = []
    remaining = set(keep)
    while remaining:
        ready = [nid for nid in remaining if indegree[nid] == 0]
        # A cycle without a loop_limit would stall the sort — take the left-most node instead.
        nxt = min(ready or remaining, key=key)
        order.append(nxt)
        remaining.discard(nxt)
        for tgt in adjacency.get(nxt, []):
            if tgt in remaining:
                indegree[tgt] -= 1
    loops = {
        e["source"]: e["target"]
        for e in edges
        if _is_loop_edge(e) and e["source"] in keep and e["target"] in keep
    }
    return order, loops


def _topic_node(topic: str | None) -> tuple[str | None, str | None]:
    """``("gate", node_id)`` for ``gate:<run>:<node>``, ``("budget", node_id)`` for
    ``budget:<run>:<node>:<iteration>``, else ``(None, None)``."""
    parts = (topic or "").split(":")
    if len(parts) >= 3 and parts[0] in ("gate", "budget"):
        return parts[0], parts[2]
    return None, None


# ---------------------------------------------------------------------------------- batched reads


def live_costs(session, workflow_ids: list[str]) -> dict[str, Decimal]:
    """Each run's metered spend so far, keyed by ``workflow_id`` (absent when it has no rows)."""
    if not workflow_ids:
        return {}
    rows = session.execute(
        select(CostRecord.workflow_id, func.sum(CostRecord.cost_usd))
        .where(CostRecord.workflow_id.in_(workflow_ids))
        .group_by(CostRecord.workflow_id)
    ).all()
    return {wid: Decimal(total) for wid, total in rows}


def spent_usd(run: Run, live: dict[str, Decimal]) -> float:
    """Live spend: the cost ledger is the source of truth (in flight and after the end, when a
    cancel may have raced a last cost row); ``cost_total_usd`` covers a run with no ledger rows."""
    if run.workflow_id in live:
        return float(live[run.workflow_id])
    return float(run.cost_total_usd) if run.cost_total_usd is not None else 0.0


def _graph_nodes(session, graph_ids: set) -> dict:
    if not graph_ids:
        return {}
    return {
        str(n.id): n
        for n in session.execute(select(AgentNode).where(AgentNode.team_graph_id.in_(graph_ids)))
        .scalars()
        .all()
    }


def _graph_edges(session, graph_ids: set) -> dict:
    by_graph: dict = {}
    if not graph_ids:
        return by_graph
    for e in session.execute(select(Edge).where(Edge.team_graph_id.in_(graph_ids))).scalars():
        by_graph.setdefault(e.team_graph_id, []).append(
            {
                "source": str(e.source_node_id),
                "target": str(e.target_node_id),
                "edge_type": e.edge_type,
                "conditions": e.conditions,
            }
        )
    return by_graph


def _label(node: AgentNode | None) -> str | None:
    return node_label(node.role_name, node.kind, node.config) if node is not None else None


def _next_role(gate_id: str, edges: list[dict], nodes: dict) -> str | None:
    """The role the gate hands over to on approve: its ``when: approved`` out-edge, else its
    unconditional one."""
    outs = [e for e in edges if e["source"] == gate_id]
    for want_approved in (True, False):
        for e in outs:
            cond = e.get("conditions") or {}
            when = cond.get("when") if isinstance(cond, dict) else None
            if (want_approved and when == "approved") or (not want_approved and when is None):
                return _label(nodes.get(e["target"]))
    return None


_STEP_FIELDS = ("live_state", "activity", "last_event_at", "activity_started_at")


def run_extras(session, runs: list[Run], *, include_progress: bool = False) -> dict:
    """The computed fields for each run, keyed by ``run.id``: ``team``, ``spent_usd``,
    ``awaiting``, ``failure``, ``live_state``, ``live`` (the worst running step, or ``None``) and
    (when asked) ``progress``. A fixed number of queries per page."""
    if not runs:
        return {}
    run_keys = [str(r.id) for r in runs]

    team_ids = {r.library_team_id for r in runs if r.library_team_id}
    team_names = (
        dict(
            session.execute(
                select(TeamGraph.id, TeamGraph.name).where(TeamGraph.id.in_(team_ids))
            ).all()
        )
        if team_ids
        else {}
    )
    live = live_costs(session, [r.workflow_id for r in runs])

    pending: dict[str, list[HumanTask]] = {}
    for task in session.execute(
        select(HumanTask)
        .where(HumanTask.run_id.in_(run_keys), HumanTask.status == "pending")
        .order_by(HumanTask.created_at, HumanTask.id)
    ).scalars():
        pending.setdefault(task.run_id, []).append(task)

    failed = [r for r in runs if r.status == "failed"]
    need_graph = {
        r.team_graph_id
        for r in runs
        if include_progress or r.status == "failed" or pending.get(str(r.id))
    }
    nodes = _graph_nodes(session, need_graph)
    edges_by_graph = _graph_edges(session, need_graph)

    invs_by_run: dict[str, list[AgentInvocation]] = {}
    inv_run_ids = run_keys if include_progress else [str(r.id) for r in failed]
    if inv_run_ids:
        for inv in session.execute(
            select(AgentInvocation).where(AgentInvocation.run_id.in_(inv_run_ids))
        ).scalars():
            invs_by_run.setdefault(inv.run_id, []).append(inv)

    node_info = {
        nid: {
            "label": _label(n),
            "origin_node_id": str(n.cloned_from_node_id) if n.cloned_from_node_id else None,
        }
        for nid, n in nodes.items()
    }

    # M1 stall guard: each in-flight run's running steps give it one live state (its worst). M2: the
    # worst step itself (its label and live block) is the run's ``live`` (Home's Running now card).
    step_states: dict[str, list[str]] = {}
    worst_step: dict[str, dict] = {}
    in_flight = [str(r.id) for r in runs if r.status not in TERMINAL_STATUSES]
    if in_flight:
        running = session.execute(
            select(AgentInvocation, AgentNode)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id.in_(in_flight), AgentInvocation.status == "running")
        ).all()
        live_by_inv = live_state.invocation_live(
            session, [inv for inv, node in running if node.kind in live_state.STEP_KINDS]
        )
        for inv, node in running:
            step = live_state.node_live(node.kind, inv, live_by_inv)
            step_states.setdefault(inv.run_id, []).append(step["live_state"])
            held = worst_step.get(inv.run_id, {}).get("live_state")
            if held is None or live_state.worst([step["live_state"], held]) != held:
                worst_step[inv.run_id] = {
                    "label": _label(node),
                    **{k: step[k] for k in _STEP_FIELDS},
                }

    # M3: "run #12" for every run of a library team (one windowed count: the runs of its team and
    # owner created up to it, as ``node_history._run_number`` counts), and a resumed run's link +
    # carried nodes (its seed checkpoint).
    numbers: dict = {}
    if team_ids:
        counted = (
            select(
                Run.id.label("id"),
                func.count()
                .over(partition_by=(Run.library_team_id, Run.owner_id), order_by=Run.created_at)
                .label("n"),
            )
            .where(Run.library_team_id.in_(team_ids))
            .subquery()
        )
        numbers = dict(
            session.execute(
                select(counted.c.id, counted.c.n).where(counted.c.id.in_([r.id for r in runs]))
            ).all()
        )
    seeds: dict = {}
    resumed_ids = [r.id for r in runs if r.resumed_from_run_id is not None]
    if resumed_ids:
        seeds = dict(
            session.execute(
                select(RunCheckpoint.run_id, RunCheckpoint.state).where(
                    RunCheckpoint.run_id.in_(resumed_ids), RunCheckpoint.invocation_id.is_(None)
                )
            ).all()
        )

    # M8: a run of a compare (its pair is a ``compares`` row — an A/B pair's is not).
    pair_ids = {r.pair_id for r in runs if r.pair_id}
    compares = (
        set(session.execute(select(Compare.id).where(Compare.id.in_(pair_ids))).scalars())
        if pair_ids
        else set()
    )

    out: dict = {}
    for run in runs:
        rid = str(run.id)
        tasks = pending.get(rid, [])
        edges = edges_by_graph.get(run.team_graph_id, [])
        awaiting = None
        blocking = [t for t in tasks if t.blocking]
        if blocking:
            task = blocking[0]
            kind, node_id = _topic_node(task.topic)
            gate = nodes.get(node_id) if kind == "gate" else None
            awaiting = {
                "task_id": task.id,
                "kind": task.kind,
                "title": task.title,
                "gate_node_id": node_id if kind == "gate" else None,
                "gate_role": _label(gate) if gate else ("Budget" if kind == "budget" else None),
                "next_role": _next_role(node_id, edges, nodes) if gate else None,
                "since": task.created_at.isoformat(),
            }

        failure = None
        if run.status == "failed":
            latest_failed = max(
                (i for i in invs_by_run.get(rid, []) if i.status == "failed"),
                key=lambda i: (i.ended_at or i.started_at, i.id),
                default=None,
            )
            failure = describe_run_failure(
                status=run.status,
                failure_code=run.failure_code,
                failure_message=run.failure_message,
                failed_node_id=str(run.failed_node_id) if run.failed_node_id else None,
                desktop_target=bool(run.desktop_target),
                fallback_reason=latest_failed.outcome_detail if latest_failed else None,
                fallback_node_id=str(latest_failed.node_id) if latest_failed else None,
                node_info=node_info,
            )

        extras = {
            "team": (
                {"id": str(run.library_team_id), "name": team_names.get(run.library_team_id)}
                if run.library_team_id
                else None
            ),
            "spent_usd": spent_usd(run, live),
            "awaiting": awaiting,
            "failure": failure,
            "live_state": live_state.run_live_state(run.status, step_states.get(rid, [])),
            "live": worst_step.get(rid),
            "number": numbers.get(run.id),
            "resumed_from": (seeds.get(run.id) or {}).get("from_run"),
            "compare": {
                "id": str(run.pair_id),
                "label": run.pair_label,
                "version": run.team_version_number,
            }
            if run.pair_id in compares
            else None,
        }
        if include_progress:
            carried_nodes = {row["node_id"] for row in (seeds.get(run.id) or {}).get("carried", [])}
            extras["progress"] = _progress(
                run, nodes, edges, invs_by_run.get(rid, []), tasks, carried_nodes
            )
        out[run.id] = extras
    return out


def _progress(
    run: Run,
    nodes: dict,
    edges: list[dict],
    invocations: list,
    tasks: list[HumanTask],
    carried_nodes: set | None = None,
) -> list[dict]:
    carried_nodes = carried_nodes or set()
    graph_nodes = [
        {"id": nid, "kind": n.kind, "config": n.config, "position": n.position}
        for nid, n in nodes.items()
        if n.team_graph_id == run.team_graph_id
    ]
    order, loops = walk_order(graph_nodes, edges)
    latest: dict[str, AgentInvocation] = {}
    for inv in invocations:
        key = str(inv.node_id)
        if key not in latest or inv.iteration > latest[key].iteration:
            latest[key] = inv
    waiting = {_topic_node(t.topic)[1] for t in tasks if _topic_node(t.topic)[0] == "gate"}
    ended = run.status in TERMINAL_STATUSES
    failed_node = str(run.failed_node_id) if run.failed_node_id else None
    chips = []
    for nid in order:
        node = nodes[nid]
        inv = latest.get(nid)
        carried = inv is None and nid in carried_nodes  # M3: done in the run it resumed from
        if nid in waiting:
            state = "waiting"
        elif carried:
            state = "done"
        elif inv is None:
            state = "idle"
        elif inv.status == "running":
            if not ended:
                state = "active"
            elif run.status == "failed" and (failed_node is None or failed_node == nid):
                state = "failed"
            else:
                state = "stopped"
        else:
            state = {"done": "done", "failed": "failed", "stopped": "stopped"}.get(
                inv.status, "done"
            )
        chips.append(
            {
                "node_id": nid,
                "origin_node_id": str(node.cloned_from_node_id)
                if node.cloned_from_node_id
                else None,
                "role_name": node.role_name,
                "label": _label(node),
                "kind": node.kind,
                "state": state,
                "loops_with": loops.get(nid),
                "carried": carried,
            }
        )
    return chips


# ---------------------------------------------------------------------------------- the list


def encode_cursor(created_at: datetime, run_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{run_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Inverse of :func:`encode_cursor`; raises ``ValueError`` on anything malformed."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        created, rid = raw.split("|", 1)
        return datetime.fromisoformat(created), uuid.UUID(rid)
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise ValueError("invalid cursor") from exc


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def list_owner_runs(
    owner_id: uuid.UUID,
    *,
    status: str = "all",
    team_id: uuid.UUID | None = None,
    q: str | None = None,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    include_progress: bool = False,
) -> dict:
    """One page of the owner's runs, newest first: ``{"runs": [...], "next_cursor": str | None}``.

    Every row keeps the old summary keys (``run_id, idea, status, created_at, repo_path``) and adds
    :func:`run_fields` + :func:`run_extras`. ``status`` must be a key of :data:`STATUS_FILTERS`
    and ``cursor`` a value this function returned (``ValueError`` otherwise)."""
    if status not in STATUS_FILTERS:
        raise ValueError(f"unknown status filter: {status}")
    statuses = STATUS_FILTERS[status]
    after = decode_cursor(cursor) if cursor else None
    with session_scope() as session:
        stmt = (
            select(Run)
            .outerjoin(TeamGraph, TeamGraph.id == Run.library_team_id)
            .where(Run.owner_id == owner_id)
        )
        if statuses is not None:
            stmt = stmt.where(Run.status.in_(statuses))
        if team_id is not None:
            stmt = stmt.where(Run.library_team_id == team_id)
        if q and q.strip():
            pattern = _like(q.strip())
            stmt = stmt.where(
                or_(
                    Run.idea.ilike(pattern, escape="\\"), TeamGraph.name.ilike(pattern, escape="\\")
                )
            )
        if after is not None:
            stmt = stmt.where(tuple_(Run.created_at, Run.id) < tuple_(after[0], after[1]))
        rows = (
            session.execute(stmt.order_by(Run.created_at.desc(), Run.id.desc()).limit(limit + 1))
            .scalars()
            .all()
        )
        page, more = rows[:limit], len(rows) > limit
        extras = run_extras(session, page, include_progress=include_progress)
        runs = [
            {
                "run_id": str(r.id),
                "idea": r.idea,
                "status": r.status,
                "created_at": r.created_at.isoformat(),
                "repo_path": r.repo_path,
                **run_fields(r),
                **extras[r.id],
            }
            for r in page
        ]
        next_cursor = encode_cursor(page[-1].created_at, page[-1].id) if more and page else None
    return {"runs": runs, "next_cursor": next_cursor}


# ---------------------------------------------------------------------------------- launch options


def budget_problem(cap: Decimal | None) -> str | None:
    """The 422 ``detail`` for a per-run budget the launch must refuse, else ``None``."""
    if cap is None:
        return None
    if cap <= 0:
        return "budget must be above $0"
    if cap > MAX_RUN_BUDGET_USD:
        return f"budget can't be more than ${MAX_RUN_BUDGET_USD:.0f}"
    return None


def retry_problem(owner_id: uuid.UUID, retry_of_run_id: str) -> tuple[uuid.UUID | None, str | None]:
    """``(run_uuid, None)`` when ``retry_of_run_id`` names one of the owner's finished runs, else
    ``(None, <422 detail>)``."""
    try:
        rid = uuid.UUID(retry_of_run_id)
    except ValueError:
        return None, "retry_of_run_id is not one of your runs"
    with session_scope() as session:
        row = session.execute(select(Run.owner_id, Run.status).where(Run.id == rid)).one_or_none()
    if row is None or row.owner_id != owner_id:
        return None, "retry_of_run_id is not one of your runs"
    if row.status not in TERMINAL_STATUSES:
        return None, "retry_of_run_id must be a run that has finished"
    return rid, None
