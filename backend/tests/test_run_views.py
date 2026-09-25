"""Revamp P3 / G-6 — ``GET /api/runs`` (filters, search, paging, team, target, PR, live spend,
budget, awaiting, failure, progress) and the run-level fields on ``GET /api/runs/{id}``."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from home_fixtures import (
    add_cost,
    add_invocation,
    clone_node,
    fresh_account,
    library_team,
    make_run,
    open_gate,
)

from tvashtr.control_plane import run_views

_OLD_KEYS = {"run_id", "idea", "status", "created_at", "repo_path"}


# ---------------------------------------------------------------- pure helpers


def test_walk_order_follows_the_forward_path_and_marks_the_loop():
    nodes = [
        {"id": "pm", "kind": "completion", "position": {"x": 0}},
        {"id": "gate", "kind": "gate", "position": {"x": 260}},
        {"id": "eng", "kind": "agent", "position": {"x": 520}},
        {"id": "rev", "kind": "agent", "position": {"x": 780}},
        {"id": "esc", "kind": "gate", "position": {"x": 520, "y": 180}},
        {"id": "ship", "kind": "terminal", "config": {"terminal_kind": "ship"}, "position": {}},
        {"id": "stop", "kind": "terminal", "config": {"terminal_kind": "stop"}, "position": {}},
    ]

    def e(s, t, edge_type="work", conditions=None):
        return {"source": s, "target": t, "edge_type": edge_type, "conditions": conditions}

    edges = [
        e("pm", "gate"),
        e("gate", "eng", conditions={"when": "approved"}),
        e("gate", "stop", conditions={"when": "rejected"}),
        e("eng", "rev", "review"),
        e("rev", "eng", "review", {"loop_limit": 3}),
        e("rev", "ship", "review", {"when": "approved"}),
        e("eng", "esc", "escalation"),
        e("esc", "ship", conditions={"when": "approved"}),
        e("esc", "stop", conditions={"when": "rejected"}),
    ]
    order, loops = run_views.walk_order(nodes, edges)
    assert order == ["pm", "gate", "eng", "rev", "ship"]
    assert loops == {"rev": "eng"}


def test_pr_number_status_group_and_budget_rules():
    assert run_views.pr_number("https://github.com/o/r/pull/42") == 42
    assert run_views.pr_number("https://github.com/o/r") is None
    assert run_views.status_group("awaiting_human") == "needs_you"
    assert run_views.status_group("over_budget") == "stopped"
    assert run_views.budget_problem(Decimal("0")) == "budget must be above $0"
    assert run_views.budget_problem(Decimal("-1")) == "budget must be above $0"
    assert run_views.budget_problem(Decimal("500.01")) == "budget can't be more than $500"
    assert run_views.budget_problem(Decimal("500")) is None
    assert run_views.budget_problem(None) is None


# ---------------------------------------------------------------- the list


def test_rows_carry_team_target_pr_spend_budget_awaiting_and_progress(client):
    c, owner = fresh_account()
    team = library_team(c)
    run_id, clone = make_run(
        owner,
        team,
        status="awaiting_human",
        budget_cap_usd=Decimal("5"),
        github_repo="lazyxgenius/trade_mcp",
        base_ref="main",
    )
    add_cost(run_id, "0.71")
    add_cost(run_id, "0.50")
    pm, gate = clone_node(clone, "pm"), clone_node(clone, "prd_gate")
    add_invocation(run_id, pm, "done")
    add_invocation(run_id, gate, "running")
    task_id = open_gate(run_id, gate)

    body = c.get("/api/runs?include=progress").json()
    assert body["next_cursor"] is None
    (row,) = body["runs"]
    assert set(row) >= _OLD_KEYS
    assert row["run_id"] == run_id
    assert row["team"] == {"id": team, "name": "Indicator sprint team"}
    assert row["library_team_id"] == team
    assert row["status_group"] == "needs_you"
    assert row["target"] == {
        "kind": "github",
        "label": "lazyxgenius/trade_mcp",
        "base_ref": "main",
        "subpath": None,
    }
    assert row["spent_usd"] == 1.21
    assert row["budget_cap_usd"] == 5.0
    assert row["desktop_target"] is False
    assert row["failure"] is None
    assert row["awaiting"]["task_id"] == task_id
    assert row["awaiting"]["gate_node_id"] == gate
    assert row["awaiting"]["gate_role"] == "Approval"
    assert row["awaiting"]["next_role"] == "Engineer"
    chips = row["progress"]
    assert [ch["label"] for ch in chips] == ["PM", "Approval", "Engineer", "Reviewer", "Ship"]
    assert [ch["state"] for ch in chips] == ["done", "waiting", "idle", "idle", "idle"]
    reviewer = next(ch for ch in chips if ch["label"] == "Reviewer")
    assert reviewer["loops_with"] == clone_node(clone, "engineer")
    assert chips[0]["origin_node_id"] is not None

    # Without include=progress the chips are not computed.
    assert "progress" not in c.get("/api/runs").json()["runs"][0]


def test_status_team_and_search_filters(client):
    c, owner = fresh_account()
    alpha = library_team(c, name="Alpha squad")
    beta = library_team(c, name="Beta crew")
    done, _ = make_run(owner, alpha, status="completed", idea="ship the docs")
    live, _ = make_run(owner, beta, status="running", idea="fix the flaky login test")
    stopped, _ = make_run(owner, beta, status="cancelled", idea="write the API reference")

    def ids(query: str) -> set[str]:
        resp = c.get(f"/api/runs{query}")
        assert resp.status_code == 200, resp.text
        return {r["run_id"] for r in resp.json()["runs"]}

    assert ids("") == {done, live, stopped}
    assert ids("?status=active") == {live}
    assert ids("?status=running") == {live}
    assert ids("?status=completed") == {done}
    assert ids("?status=stopped") == {stopped}
    assert ids(f"?team_id={beta}") == {live, stopped}
    assert ids("?q=flaky") == {live}
    assert ids("?q=alpha") == {done}  # matches the team name too
    assert ids("?q=100%25") == set()  # a literal % is escaped, not a wildcard

    assert c.get("/api/runs?status=bogus").status_code == 422
    assert c.get("/api/runs?team_id=nope").status_code == 422
    assert c.get("/api/runs?include=everything").status_code == 422
    assert c.get("/api/runs?limit=0").status_code == 422
    assert c.get("/api/runs?limit=101").status_code == 422
    assert c.get("/api/runs?cursor=%%%").status_code == 422


def test_paging_with_a_cursor(client):
    c, owner = fresh_account()
    team = library_team(c)
    base = datetime.now(UTC) - timedelta(hours=1)
    made = [
        make_run(owner, team, status="completed", created_at=base + timedelta(minutes=i))[0]
        for i in range(5)
    ]
    newest_first = list(reversed(made))

    seen: list[str] = []
    cursor = None
    for _ in range(3):
        url = "/api/runs?limit=2" + (f"&cursor={cursor}" if cursor else "")
        body = c.get(url).json()
        seen += [r["run_id"] for r in body["runs"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert seen == newest_first
    assert cursor is None


def test_the_list_is_owner_scoped(client):
    c1, owner1 = fresh_account()
    c2, _ = fresh_account()
    team = library_team(c1)
    make_run(owner1, team)
    assert c2.get("/api/runs").json()["runs"] == []
    assert c2.get(f"/api/runs?team_id={team}").json()["runs"] == []


def test_failed_runs_carry_a_failure_stored_or_derived(client):
    c, owner = fresh_account()
    team = library_team(c)
    stored, clone = make_run(
        owner,
        team,
        status="failed",
        failure_code="missing_credential",
        failure_message="Engineer has no xai key on the website",
    )
    old, old_clone = make_run(owner, team, status="failed")
    engineer = clone_node(old_clone, "engineer")
    add_invocation(
        old,
        engineer,
        "failed",
        outcome_detail=f"owner {uuid.uuid4()} has no credential for provider 'xai'",
    )
    bare, _ = make_run(owner, team, status="failed")

    rows = {r["run_id"]: r for r in c.get("/api/runs?status=failed").json()["runs"]}
    assert rows[stored]["failure"]["code"] == "missing_credential"
    assert rows[stored]["failure"]["message"] == "Engineer has no xai key on the website"
    assert rows[old]["failure"]["message"] == "Engineer has no xai key on the website"
    assert rows[old]["failure"]["node_id"] == engineer
    assert rows[old]["failure"]["provider"] == "xai"
    assert rows[bare]["failure"]["message"] == "The run stopped with an error."
    assert rows[bare]["status_group"] == "failed"


def test_spent_usd_prefers_the_ledger_and_falls_back_to_the_stored_total(client):
    c, owner = fresh_account()
    team = library_team(c)
    ledger, _ = make_run(owner, team, status="cancelled", cost_total_usd=Decimal("0.10"))
    add_cost(ledger, "0.40")
    stored_only, _ = make_run(owner, team, status="completed", cost_total_usd=Decimal("2.5"))
    nothing, _ = make_run(owner, team, status="running")
    rows = {r["run_id"]: r for r in c.get("/api/runs").json()["runs"]}
    assert rows[ledger]["spent_usd"] == 0.4
    assert rows[stored_only]["spent_usd"] == 2.5
    assert rows[nothing]["spent_usd"] == 0.0


def test_runs_without_a_library_team_are_listed_with_team_null(client):
    c, owner = fresh_account()
    run_id, _ = make_run(owner, None, status="completed")
    (row,) = c.get("/api/runs").json()["runs"]
    assert row["run_id"] == run_id and row["team"] is None and row["library_team_id"] is None


# ---------------------------------------------------------------- GET /api/runs/{id}


def test_get_run_carries_the_new_run_level_fields(client):
    c, owner = fresh_account()
    team = library_team(c)
    retried, _ = make_run(owner, team, status="failed")
    run_id, clone = make_run(
        owner,
        team,
        status="completed",
        budget_cap_usd=Decimal("5"),
        pr_url="https://github.com/o/r/pull/7",
        retry_of_run_id=uuid.UUID(retried),
    )
    add_cost(run_id, "3.25")
    body = c.get(f"/api/runs/{run_id}").json()["run"]
    assert body["id"] == run_id  # an existing key, unchanged
    assert body["team"] == {"id": team, "name": "Indicator sprint team"}
    assert body["library_team_id"] == team
    assert body["retry_of_run_id"] == retried
    assert body["pr_number"] == 7
    assert body["budget_cap_usd"] == 5.0
    assert body["spent_usd"] == 3.25
    assert body["status_group"] == "completed"
    assert body["awaiting"] is None and body["failure"] is None
    assert body["target"]["kind"] == "none"
