"""Home's "Needs you" — one owner-scoped feed across every run and team (revamp P1 / P2).

Items, oldest first:

* ``approval`` — a pending BLOCKING human task on a live run (a spec / ship / escalation gate, or a
  ``budget_approval``). Key ``gate:<task id>``. Can be snoozed, never dismissed.
* ``nudge`` — a pending non-blocking task (the 80%-of-budget note). Key ``nudge:<task id>``.
* ``run_failed`` — a run that failed in the last 14 days and has not been retried (no run points at
  it through ``retry_of_run_id``). Key ``run_failed:<run id>``.
* ``setup_gap`` — a library team that can't run on the website (or, on Desktop, on this computer)
  for want of API keys. Key ``setup:<team id>:<website|desktop>``. Only teams active in the last 30
  days get their own row; the rest fold into one ``setup_gaps_folded`` item (key ``setup:more``).
* ``memories`` — facts waiting in the memory inbox. Key ``memories``.

Dismissals and snoozes live in ``inbox_dismissals``. A ``fingerprint`` taken at dismiss time (the
missing providers of a gap, the newest pending memory, the folded team ids) brings an item back when
it changes. Read-only apart from :func:`dismiss` / :func:`undo`.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from tvashtr.control_plane import desktop_jobs, run_views
from tvashtr.control_plane.credential_gate import (
    MODEL_PROVIDER_TO_SUB,
    RUNNER_SUBSCRIPTIONS,
    missing_providers_for_launch,
)
from tvashtr.control_plane.credentials import held_provider_slugs, provider_for_model
from tvashtr.control_plane.run_failure import node_label
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    EngineSubscriptionStatus,
    HumanTask,
    InboxDismissal,
    NodeMemory,
    Run,
    TeamGraph,
)

RUN_FAILED_WINDOW = timedelta(days=14)
SETUP_ACTIVE_WINDOW = timedelta(days=30)
SURFACES = ("website", "desktop")


class InboxError(Exception):
    """A refused dismissal: ``status`` is the HTTP status, ``detail`` the message."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _approval_items(session, owner_id: uuid.UUID) -> list[dict]:
    rows = session.execute(
        select(HumanTask, Run)
        .join(Run, Run.workflow_id == HumanTask.run_id)
        .where(
            Run.owner_id == owner_id,
            HumanTask.status == "pending",
            Run.status.notin_(run_views.TERMINAL_STATUSES),
        )
        .order_by(HumanTask.created_at, HumanTask.id)
    ).all()
    if not rows:
        return []
    runs = list({run.id: run for _task, run in rows}.values())
    extras = run_views.run_extras(session, runs)
    items = []
    for task, run in rows:
        ex = extras[run.id]
        run_dict = {
            "id": str(run.id),
            "idea": run.idea,
            "status": run.status,
            "spent_usd": ex["spent_usd"],
            "budget_cap_usd": float(run.budget_cap_usd) if run.budget_cap_usd is not None else None,
        }
        if not task.blocking:
            items.append(
                {
                    "key": f"nudge:{task.id}",
                    "kind": "nudge",
                    "_since": task.created_at,
                    "_fingerprint": None,
                    "team": ex["team"],
                    "run": run_dict,
                    "task": {"id": task.id, "kind": task.kind, "title": task.title},
                }
            )
            continue
        awaiting = ex["awaiting"] if ex["awaiting"] and ex["awaiting"]["task_id"] == task.id else {}
        items.append(
            {
                "key": f"gate:{task.id}",
                "kind": "approval",
                "_since": task.created_at,
                "_fingerprint": None,
                "team": ex["team"],
                "run": run_dict,
                "task": {
                    "id": task.id,
                    "kind": task.kind,
                    "title": task.title,
                    "blocking": True,
                    "gate_node_id": awaiting.get("gate_node_id"),
                    "gate_role": awaiting.get("gate_role"),
                    "next_role": awaiting.get("next_role"),
                },
                "document_id": str(run.pm_document_id) if run.pm_document_id else None,
            }
        )
    return items


def _failed_run_items(session, owner_id: uuid.UUID, now: datetime) -> list[dict]:
    retried = select(Run.retry_of_run_id).where(Run.retry_of_run_id.isnot(None))
    runs = (
        session.execute(
            select(Run).where(
                Run.owner_id == owner_id,
                Run.status == "failed",
                Run.updated_at >= now - RUN_FAILED_WINDOW,
                Run.id.notin_(retried),
            )
        )
        .scalars()
        .all()
    )
    if not runs:
        return []
    extras = run_views.run_extras(session, runs)
    return [
        {
            "key": f"run_failed:{run.id}",
            "kind": "run_failed",
            "_since": run.updated_at,
            "_fingerprint": None,
            "team": extras[run.id]["team"],
            "run": {
                "id": str(run.id),
                "idea": run.idea,
                "status": run.status,
                "created_at": run.created_at.isoformat(),
                "ended_at": run.updated_at.isoformat(),
                "target": run_views.run_target(run),
                "github_repo": run.github_repo,
                "base_ref": run.base_ref,
                "subpath": run.subpath,
                "budget_cap_usd": float(run.budget_cap_usd)
                if run.budget_cap_usd is not None
                else None,
                "desktop_target": bool(run.desktop_target),
                "library_team_id": str(run.library_team_id) if run.library_team_id else None,
            },
            "failure": extras[run.id]["failure"],
        }
        for run in runs
    ]


def _setup_gap_items(session, owner_id: uuid.UUID, surface: str, now: datetime) -> list[dict]:
    teams = (
        session.execute(
            select(TeamGraph).where(TeamGraph.is_library.is_(True), TeamGraph.owner_id == owner_id)
        )
        .scalars()
        .all()
    )
    if not teams:
        return []
    team_ids = [t.id for t in teams]
    nodes_by_team: dict = {}
    for node in session.execute(
        select(AgentNode).where(AgentNode.team_graph_id.in_(team_ids))
    ).scalars():
        nodes_by_team.setdefault(node.team_graph_id, []).append(node)
    last_active = dict(
        session.execute(
            select(Run.library_team_id, func.max(Run.updated_at))
            .where(Run.library_team_id.in_(team_ids))
            .group_by(Run.library_team_id)
        ).all()
    )
    connected = set(
        session.execute(
            select(EngineSubscriptionStatus.provider).where(
                EngineSubscriptionStatus.owner_id == owner_id,
                EngineSubscriptionStatus.connected.is_(True),
            )
        ).scalars()
    )
    held = held_provider_slugs(owner_id)
    fresh = desktop_jobs.fresh_subscription_ids(owner_id) if surface == "desktop" else set()

    items: list[dict] = []
    folded: list[dict] = []
    for team in teams:
        nodes = nodes_by_team.get(team.id, [])
        models = [n.model for n in nodes if n.model]
        target, missing = (
            "website",
            missing_providers_for_launch(
                models, byok=held, fresh_subscriptions=set(), desktop_target=False
            ),
        )
        if surface == "desktop":
            desktop_missing = missing_providers_for_launch(
                models, byok=held, fresh_subscriptions=fresh, desktop_target=True
            )
            if desktop_missing:
                target, missing = "desktop", desktop_missing
        if not missing:
            continue
        missing_nodes = sorted(
            {
                node_label(n.role_name, n.kind, n.config)
                for n in nodes
                if n.model and provider_for_model(n.model) in missing
            }
        )
        covers = sorted(
            {
                MODEL_PROVIDER_TO_SUB[p]
                for p in missing
                if MODEL_PROVIDER_TO_SUB.get(p) in RUNNER_SUBSCRIPTIONS
                and MODEL_PROVIDER_TO_SUB[p] in connected
            }
        )
        active_at = last_active.get(team.id) or team.created_at
        entry = {
            "key": f"setup:{team.id}:{target}",
            "kind": "setup_gap",
            "_since": team.created_at,
            "_fingerprint": ",".join(missing),
            "team": {"id": str(team.id), "name": team.name},
            "target": target,
            "missing_providers": missing,
            "missing_nodes": missing_nodes,
            "desktop_covers": covers if target == "website" else [],
        }
        if active_at >= now - SETUP_ACTIVE_WINDOW:
            items.append(entry)
        else:
            folded.append(entry)
    if folded:
        items.append(
            {
                "key": "setup:more",
                "kind": "setup_gaps_folded",
                "_since": min(e["_since"] for e in folded),
                "_fingerprint": ",".join(sorted(e["team"]["id"] for e in folded)),
                "count": len(folded),
                "teams": [
                    {
                        "id": e["team"]["id"],
                        "name": e["team"]["name"],
                        "target": e["target"],
                        "missing_providers": e["missing_providers"],
                    }
                    for e in sorted(folded, key=lambda e: e["team"]["name"])
                ],
            }
        )
    return items


def _memories_item(session, owner_id: uuid.UUID) -> list[dict]:
    rows = session.execute(
        select(
            NodeMemory.created_at,
            NodeMemory.repo_key,
            NodeMemory.source_run_id,
            NodeMemory.source_node_id,
            NodeMemory.source_invocation_id,
        ).where(NodeMemory.owner_id == owner_id, NodeMemory.status == "pending_review")
    ).all()
    if not rows:
        return []
    node_ids = {r.source_node_id for r in rows if r.source_node_id}
    inv_ids = {
        r.source_invocation_id for r in rows if r.source_invocation_id and not r.source_node_id
    }
    if inv_ids:
        node_ids |= set(
            session.execute(
                select(AgentInvocation.node_id).where(AgentInvocation.id.in_(inv_ids))
            ).scalars()
        )
    learned_by = (
        sorted(
            {
                node_label(role, kind, config)
                for role, kind, config in session.execute(
                    select(AgentNode.role_name, AgentNode.kind, AgentNode.config).where(
                        AgentNode.id.in_(node_ids)
                    )
                ).all()
            }
        )
        if node_ids
        else []
    )
    run_ids = set()
    for r in rows:
        try:
            if r.source_run_id:
                run_ids.add(uuid.UUID(r.source_run_id))
        except ValueError:
            continue
    repo_of_run = (
        {
            str(rid): repo
            for rid, repo in session.execute(
                select(Run.id, Run.github_repo).where(
                    Run.id.in_(run_ids), Run.github_repo.isnot(None)
                )
            ).all()
        }
        if run_ids
        else {}
    )
    repos = sorted(
        {
            repo_of_run.get(r.source_run_id or "") or r.repo_key
            for r in rows
            if repo_of_run.get(r.source_run_id or "") or r.repo_key
        }
    )
    newest = max(r.created_at for r in rows)
    return [
        {
            "key": "memories",
            "kind": "memories",
            "_since": min(r.created_at for r in rows),
            "_fingerprint": newest.isoformat(),
            "count": len(rows),
            "learned_by": learned_by,
            "repos": repos,
        }
    ]


def _raw_items(owner_id: uuid.UUID, surface: str, now: datetime) -> list[dict]:
    with session_scope() as session:
        items = (
            _approval_items(session, owner_id)
            + _failed_run_items(session, owner_id, now)
            + _setup_gap_items(session, owner_id, surface, now)
            + _memories_item(session, owner_id)
        )
    return items


def _hidden(item: dict, dismissal: InboxDismissal | None, now: datetime) -> bool:
    if dismissal is None:
        return False
    same = dismissal.fingerprint is None or dismissal.fingerprint == item["_fingerprint"]
    if dismissal.action == "snoozed":
        return same and dismissal.snooze_until is not None and dismissal.snooze_until > now
    return same


def _public(item: dict) -> dict:
    out = {k: v for k, v in item.items() if not k.startswith("_")}
    out["since"] = item["_since"].isoformat()
    return out


def _check_surface(surface: str) -> str:
    if surface not in SURFACES:
        raise InboxError(422, "surface must be website or desktop")
    return surface


def get_inbox(
    owner_id: uuid.UUID, *, surface: str = "website", now: datetime | None = None
) -> dict:
    """``{"count", "items"}`` — every current item the owner hasn't dismissed or snoozed."""
    _check_surface(surface)
    now = now or datetime.now(UTC)
    items = _raw_items(owner_id, surface, now)
    with session_scope() as session:
        dismissals = {
            d.item_key: d
            for d in session.execute(
                select(InboxDismissal).where(InboxDismissal.owner_id == owner_id)
            ).scalars()
        }
        visible = [i for i in items if not _hidden(i, dismissals.get(i["key"]), now)]
    visible.sort(key=lambda i: (i["_since"], i["key"]))
    return {"count": len(visible), "items": [_public(i) for i in visible]}


def dismiss(
    owner_id: uuid.UUID,
    key: str,
    action: str,
    until: datetime | None,
    *,
    surface: str = "website",
    now: datetime | None = None,
) -> dict:
    """Dismiss (``action="dismiss"``) or snooze (``"snooze"`` until ``until``) one current item.
    Raises :class:`InboxError`: 404 for a key that isn't a current item, 422 for dismissing an
    approval or a snooze without a future ``until``."""
    _check_surface(surface)
    now = now or datetime.now(UTC)
    item = next((i for i in _raw_items(owner_id, surface, now) if i["key"] == key), None)
    if item is None:
        raise InboxError(404, "inbox item not found")
    if action == "dismiss" and item["kind"] == "approval":
        raise InboxError(422, "An approval can't be dismissed. Snooze it instead.")
    if action == "snooze":
        if until is None:
            raise InboxError(422, "Snoozing needs an until time.")
        if until.tzinfo is None:
            until = until.replace(tzinfo=UTC)
        if until <= now:
            raise InboxError(422, "The snooze time must be in the future.")
    else:
        until = None
    stored = "snoozed" if action == "snooze" else "dismissed"
    with session_scope() as session:
        stmt = pg_insert(InboxDismissal).values(
            owner_id=owner_id,
            item_key=key,
            action=stored,
            snooze_until=until,
            fingerprint=item["_fingerprint"],
        )
        session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_inbox_dismissals_owner_key",
                set_={
                    "action": stmt.excluded.action,
                    "snooze_until": stmt.excluded.snooze_until,
                    "fingerprint": stmt.excluded.fingerprint,
                    "created_at": func.now(),
                },
            )
        )
    return {"key": key, "action": action, "until": until.isoformat() if until else None}


def undo(owner_id: uuid.UUID, key: str) -> None:
    """Forget a dismissal or snooze (Undo); a no-op when there is none."""
    with session_scope() as session:
        session.execute(
            delete(InboxDismissal).where(
                InboxDismissal.owner_id == owner_id, InboxDismissal.item_key == key
            )
        )
