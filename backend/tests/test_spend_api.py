"""Revamp P4 / G-8 — ``GET /api/spend`` (month / week / per team, live, owner-scoped, in the
caller's time zone) and the owner-scoped ``GET /api/costs``."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from home_fixtures import add_cost, fresh_account, library_team, make_run

from tvashtr.control_plane import spend


def test_period_starts_month_and_monday_in_the_zone():
    berlin = ZoneInfo("Europe/Berlin")
    # Thursday 2026-10-01 01:30 in Berlin — the month just began, the week began Monday 28 Sep.
    month, week = spend.period_starts(datetime(2026, 10, 1, 1, 30, tzinfo=berlin))
    assert month.isoformat() == "2026-10-01T00:00:00+02:00"
    assert week.isoformat() == "2026-09-28T00:00:00+02:00"
    # Across the DST change the start keeps its own offset (Monday 26 Oct is CET, +01:00).
    _, week = spend.period_starts(datetime(2026, 10, 28, 12, 0, tzinfo=berlin))
    assert week.isoformat() == "2026-10-26T00:00:00+01:00"


def test_spend_totals_by_period_and_team(client):
    c, owner = fresh_account()
    big = library_team(c, name="Full feature squad")
    small = library_team(c, name="Docs team")
    now = datetime.now(UTC)
    month_start, week_start = spend.period_starts(now)

    a, _ = make_run(owner, big, status="running")  # in flight — still counts
    b, _ = make_run(owner, small, status="failed")
    orphan, _ = make_run(owner, None, status="completed")
    add_cost(a, "4.00")
    add_cost(a, "5.10")
    add_cost(b, "1.00")
    add_cost(orphan, "0.25")
    # Spend from 8 days before the month began is in neither period (a week starts at most 6 days
    # before the month does).
    add_cost(b, "7.00", created_at=month_start - timedelta(days=8))

    body = c.get("/api/spend?tz=UTC").json()
    assert body["tz"] == "UTC"
    assert body["month"]["label"] == month_start.strftime("%B")
    assert body["month"]["start"] == month_start.isoformat()
    assert abs(body["month"]["total_usd"] - 10.35) < 1e-9
    assert body["week"]["start"] == week_start.isoformat()
    assert abs(body["week"]["total_usd"] - 10.35) < 1e-9  # every row above is from today
    assert body["by_team"] == [
        {"team_id": big, "name": "Full feature squad", "total_usd": 9.1},
        {"team_id": small, "name": "Docs team", "total_usd": 1.0},
    ]
    assert body["other_usd"] == 0.25
    assert body["default_run_budget_usd"] == 5.0


def test_spend_is_owner_scoped_and_empty_for_a_new_account(client):
    c1, owner1 = fresh_account()
    run_id, _ = make_run(owner1, library_team(c1))
    add_cost(run_id, "3.00")
    c2, _ = fresh_account()
    body = c2.get("/api/spend").json()
    assert body["month"]["total_usd"] == 0.0
    assert body["week"]["total_usd"] == 0.0
    assert body["by_team"] == [] and body["other_usd"] == 0.0


def test_spend_rejects_an_unknown_time_zone(client):
    c, _ = fresh_account()
    resp = c.get("/api/spend?tz=Mars/Olympus")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Unknown time zone: Mars/Olympus"


def test_costs_are_owner_scoped(client):
    c1, owner1 = fresh_account()
    run_id, _ = make_run(owner1, library_team(c1))
    add_cost(run_id, "0.42")
    c2, _ = fresh_account()
    assert [r["cost_usd"] for r in c1.get(f"/api/costs?workflow_id={run_id}").json()["costs"]] == [
        0.42
    ]
    assert c2.get(f"/api/costs?workflow_id={run_id}").json()["costs"] == []
    assert all(r["workflow_id"] != run_id for r in c2.get("/api/costs").json()["costs"])
