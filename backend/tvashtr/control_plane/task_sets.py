"""M9 — task sets (contract ``docs/superpowers/plans/api/task-sets.md``).

A task set is a library team's named list of 1–20 tasks, each with the branch it starts from and a
hidden check command. R11: the command is shown to the set's owner here and read by the check
runner (``hidden_checks``) — nothing else, and never anything an agent sees. A set in a compare
that is still waiting or running can't be edited or deleted (its tasks are being launched and
checked); deleting one keeps its compares and runs. Openhands-free."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from tvashtr.control_plane import versions
from tvashtr.models import Compare, TaskSet, TaskSetItem, TeamGraph

NAME_MAX = 80
TEXT_MAX = 2000
ITEMS_MAX = 20
_BUSY = "This set is in a compare that is still running. Stop it first, or wait for it to finish."
_NOT_FOUND = "task set not found"


def _uuid(set_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(set_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=_NOT_FOUND) from exc


def require(session, owner_id: uuid.UUID, set_id: str) -> TaskSet:
    """The owner's set, locked for a change; another account's (or none) is a 404."""
    found = session.execute(
        select(TaskSet).where(TaskSet.id == _uuid(set_id)).with_for_update()
    ).scalar_one_or_none()
    if found is None or found.owner_id != owner_id:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return found


def team_set(session, team_id: uuid.UUID, set_id: str) -> TaskSet:
    """A set of this (already owner-checked) team; any other set is a 404."""
    found = session.get(TaskSet, _uuid(set_id))
    if found is None or found.team_graph_id != team_id:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return found


def items_of(session, set_id: uuid.UUID) -> list[TaskSetItem]:
    return list(
        session.execute(
            select(TaskSetItem)
            .where(TaskSetItem.task_set_id == set_id)
            .order_by(TaskSetItem.position)
        ).scalars()
    )


def _counts(session, team_id: uuid.UUID) -> list[tuple[TaskSet, int]]:
    return list(
        session.execute(
            select(TaskSet, func.count(TaskSetItem.id))
            .outerjoin(TaskSetItem, TaskSetItem.task_set_id == TaskSet.id)
            .where(TaskSet.team_graph_id == team_id)
            .group_by(TaskSet.id)
            .order_by(func.lower(TaskSet.name))
        ).all()
    )


def summaries(session, team_id: uuid.UUID) -> list[dict]:
    """``[{"id", "name", "count"}]`` — the team's sets, by name."""
    return [{"id": str(ts.id), "name": ts.name, "count": n} for ts, n in _counts(session, team_id)]


def sample(session, team_id: uuid.UUID) -> dict | None:
    """The team's set a one-task compare offers ("Compare on <set>"): the newest edited one."""
    row = session.execute(
        select(TaskSet, func.count(TaskSetItem.id))
        .outerjoin(TaskSetItem, TaskSetItem.task_set_id == TaskSet.id)
        .where(TaskSet.team_graph_id == team_id)
        .group_by(TaskSet.id)
        .order_by(TaskSet.updated_at.desc())
        .limit(1)
    ).first()
    return {"set_id": str(row[0].id), "name": row[0].name, "count": row[1]} if row else None


def check_sets(session, team: TeamGraph, current: int) -> list[dict]:
    """The Save-as dialog's choices: each set with what comparing the new version with the
    current one on it would cost."""
    from tvashtr.control_plane import compare  # compare imports this module

    return [
        {
            "id": str(ts.id),
            "name": ts.name,
            "count": n,
            "estimate": compare.set_estimate(session, team, [current, current + 1], n),
        }
        for ts, n in _counts(session, team.id)
    ]


def _view(session, ts: TaskSet, team: TeamGraph) -> dict:
    from tvashtr.control_plane import compare  # compare imports this module

    items = items_of(session, ts.id)
    top = versions.latest(session, team)
    numbers = [max(top.number - 1, 1), top.number] if top is not None else []
    return {
        "id": str(ts.id),
        "name": ts.name,
        "items": [
            {
                "id": str(i.id),
                "position": i.position,
                "task": i.task,
                "starts_from": i.starts_from,
                "hidden_check": i.hidden_check,
            }
            for i in items
        ],
        "last_used": compare.last_used(session, ts.id),
        "estimate": compare.set_estimate(session, team, numbers, len(items)) if numbers else None,
    }


def listing(session, team: TeamGraph) -> dict:
    return {"sets": [_view(session, ts, team) for ts, _ in _counts(session, team.id)]}


def _clean(name: str, items: list[dict]) -> tuple[str, list[tuple[str, str | None, str]]]:
    """The name and tasks trimmed, or a 422 in plain words."""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Give the set a name.")
    if len(name) > NAME_MAX:
        raise HTTPException(status_code=422, detail=f"Keep the name to {NAME_MAX} characters.")
    if not items:
        raise HTTPException(status_code=422, detail="Add at least one task.")
    if len(items) > ITEMS_MAX:
        raise HTTPException(status_code=422, detail=f"A set holds at most {ITEMS_MAX} tasks.")
    out = []
    for item in items:
        task = (item.get("task") or "").strip()
        check = (item.get("hidden_check") or "").strip()
        if not task:
            raise HTTPException(status_code=422, detail="Every task needs its text.")
        if not check:
            raise HTTPException(status_code=422, detail="Every task needs a hidden check.")
        if len(task) > TEXT_MAX or len(check) > TEXT_MAX:
            raise HTTPException(
                status_code=422, detail=f"Keep each task and check to {TEXT_MAX} characters."
            )
        out.append((task, (item.get("starts_from") or "").strip() or None, check))
    return name, out


def _taken(session, team_id: uuid.UUID, name: str, own: uuid.UUID | None = None) -> None:
    stmt = select(TaskSet.id).where(
        TaskSet.team_graph_id == team_id, func.lower(TaskSet.name) == name.lower()
    )
    if own is not None:
        stmt = stmt.where(TaskSet.id != own)
    if session.execute(stmt).first() is not None:
        raise HTTPException(status_code=409, detail=f"This team already has a set called {name}.")


def _write(session, ts: TaskSet, items: list[tuple]) -> None:
    session.execute(delete(TaskSetItem).where(TaskSetItem.task_set_id == ts.id))
    for position, (task, starts_from, check) in enumerate(items, start=1):
        session.add(
            TaskSetItem(
                task_set_id=ts.id,
                position=position,
                task=task,
                starts_from=starts_from,
                hidden_check=check,
            )
        )
    try:
        session.flush()
    except IntegrityError as exc:  # the same name, saved at the same moment
        raise HTTPException(
            status_code=409, detail=f"This team already has a set called {ts.name}."
        ) from exc


def create(session, team: TeamGraph, owner_id: uuid.UUID, name: str, items: list[dict]) -> dict:
    name, cleaned = _clean(name, items)
    _taken(session, team.id, name)
    ts = TaskSet(owner_id=owner_id, team_graph_id=team.id, name=name)
    session.add(ts)
    session.flush()
    _write(session, ts, cleaned)
    return _view(session, ts, team)


def _busy(session, ts: TaskSet) -> None:
    from tvashtr.control_plane import compare  # compare imports this module

    for cmp in session.execute(
        select(Compare).where(Compare.task_set_id == ts.id, Compare.status.in_(compare.ACTIVE))
    ).scalars():
        compare._refresh(session, cmp)
        if cmp.status in compare.ACTIVE:
            raise HTTPException(status_code=409, detail=_BUSY)


def update(session, owner_id: uuid.UUID, set_id: str, name: str, items: list[dict]) -> dict:
    ts = require(session, owner_id, set_id)
    name, cleaned = _clean(name, items)
    _busy(session, ts)
    _taken(session, ts.team_graph_id, name, own=ts.id)
    ts.name, ts.updated_at = name, func.now()
    _write(session, ts, cleaned)
    return _view(session, ts, session.get(TeamGraph, ts.team_graph_id))


def remove(session, owner_id: uuid.UUID, set_id: str) -> None:
    """Its compares and runs stay (their links to it become empty; History keeps the results)."""
    ts = require(session, owner_id, set_id)
    _busy(session, ts)
    session.delete(ts)
