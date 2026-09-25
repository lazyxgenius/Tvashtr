"""Account spend by period for Home's Spend panel and greeting (revamp P4 / G-8).

Computed live from the cost ledger (``cost_records``) joined to the owner's runs on
``workflow_id`` — so in-flight, failed and cancelled runs count, not only finalized ones. Ledger
rows with no run (memory / domain embeddings, the doc-writer spike) have no owner and are left
out. The month is the calendar month and the week starts Monday 00:00, both in the caller's time
zone.
"""

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import CostRecord, Run, TeamGraph


class UnknownTimeZoneError(ValueError):
    pass


def resolve_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo((name or "UTC").strip() or "UTC")
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise UnknownTimeZoneError(f"Unknown time zone: {name}") from exc


def period_starts(now_local: datetime) -> tuple[datetime, datetime]:
    """``(month_start, week_start)`` — local midnight on the 1st, and on this week's Monday."""
    # zoneinfo computes the offset from the wall time, so a DST change between the start and now
    # still gives the start its own offset.
    midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.replace(day=1), midnight - timedelta(days=midnight.weekday())


def owner_spend(owner_id: uuid.UUID, tz_name: str | None = None, *, now=None) -> dict:
    """The owner's spend this month and this week, and this month per library team."""
    tz = resolve_tz(tz_name)
    now_local = (now or datetime.now(tz)).astimezone(tz)
    month_start, week_start = period_starts(now_local)
    since = min(month_start, week_start)
    in_month = CostRecord.created_at >= month_start
    in_week = CostRecord.created_at >= week_start

    with session_scope() as session:
        month_total, week_total = session.execute(
            select(
                func.coalesce(func.sum(CostRecord.cost_usd).filter(in_month), 0),
                func.coalesce(func.sum(CostRecord.cost_usd).filter(in_week), 0),
            )
            .select_from(CostRecord)
            .join(Run, Run.workflow_id == CostRecord.workflow_id)
            .where(Run.owner_id == owner_id, CostRecord.created_at >= since)
        ).one()
        per_team = session.execute(
            select(Run.library_team_id, TeamGraph.name, func.sum(CostRecord.cost_usd))
            .select_from(CostRecord)
            .join(Run, Run.workflow_id == CostRecord.workflow_id)
            .outerjoin(TeamGraph, TeamGraph.id == Run.library_team_id)
            .where(Run.owner_id == owner_id, in_month)
            .group_by(Run.library_team_id, TeamGraph.name)
        ).all()

    by_team = sorted(
        (
            {"team_id": str(team_id), "name": name, "total_usd": float(total)}
            for team_id, name, total in per_team
            if team_id is not None and total
        ),
        key=lambda row: (-row["total_usd"], row["name"] or ""),
    )
    other = sum(float(total) for team_id, _n, total in per_team if team_id is None and total)
    default_budget = get_settings().default_run_budget_usd
    return {
        "tz": str(tz.key),
        "month": {
            "label": month_start.strftime("%B"),
            "start": month_start.isoformat(),
            "total_usd": float(month_total),
        },
        "week": {"start": week_start.isoformat(), "total_usd": float(week_total)},
        "by_team": by_team,
        "other_usd": other,
        "default_run_budget_usd": float(default_budget) if default_budget is not None else None,
    }
