"""Revamp P1 / P2 — ``GET /api/inbox`` (approvals, nudges, failed runs, setup gaps, memories) and
``POST/DELETE /api/inbox/dismissals`` (dismiss, snooze, undo, fingerprints)."""

import uuid
from datetime import UTC, datetime, timedelta

from home_fixtures import (
    add_invocation,
    clone_node,
    fresh_account,
    library_team,
    make_run,
    open_gate,
)
from sqlalchemy import update

from tvashtr.db import session_scope
from tvashtr.models import AgentNode, HumanTask, InboxDismissal, NodeMemory, TeamGraph


def _items(c, surface: str | None = None) -> dict:
    url = "/api/inbox" + (f"?surface={surface}" if surface else "")
    resp = c.get(url)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == len(body["items"])
    return {i["key"]: i for i in body["items"]}


def _cover_every_provider(c, team: str) -> None:
    """Give the account a key for every provider the team's nodes use (no setup gap)."""
    gap = _items(c).get(f"setup:{team}:website")
    for provider in gap["missing_providers"] if gap else []:
        resp = c.post("/api/providers", json={"provider": provider, "api_key": "sk-test-1234"})
        assert resp.status_code == 200, resp.text


def _add_memory(owner, *, source_node_id=None, source_run_id=None, repo_key=None, created_at=None):
    with session_scope() as session:
        row = NodeMemory(
            owner_id=owner,
            content="Use pytest fixtures for the RSI tests",
            status="pending_review",
            source_node_id=source_node_id,
            source_run_id=source_run_id,
            repo_key=repo_key,
        )
        if created_at is not None:
            row.created_at = created_at
        session.add(row)


def _authored_node(team: str, role: str) -> uuid.UUID:
    from sqlalchemy import select

    with session_scope() as session:
        return session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == uuid.UUID(team), AgentNode.role_name == role
            )
        ).scalar_one()


# ---------------------------------------------------------------- the feed


def test_an_approval_item_names_the_gate_and_the_next_role(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    run_id, clone = make_run(owner, team, status="awaiting_human")
    gate = clone_node(clone, "prd_gate")
    add_invocation(run_id, gate, "running")
    task_id = open_gate(run_id, gate)

    items = _items(c)
    assert list(items) == [f"gate:{task_id}"]
    item = items[f"gate:{task_id}"]
    assert item["kind"] == "approval"
    assert item["team"] == {"id": team, "name": "Indicator sprint team"}
    assert item["run"]["id"] == run_id and item["run"]["idea"] == "Add an RSI indicator with tests"
    assert item["task"]["id"] == task_id
    assert item["task"]["kind"] == "prd_approval"
    assert item["task"]["gate_node_id"] == gate
    assert item["task"]["gate_role"] == "Approval"
    assert item["task"]["next_role"] == "Engineer"
    assert item["document_id"] is None
    assert item["since"]


def test_nudges_are_listed_and_finished_runs_drop_their_tasks(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    live, _ = make_run(owner, team, status="running")
    ended, clone = make_run(owner, team, status="cancelled")
    open_gate(ended, clone_node(clone, "prd_gate"))  # a leftover pending task on a finished run
    with session_scope() as session:
        nudge = HumanTask(
            run_id=live,
            kind="budget_threshold",
            priority="low_nudge",
            blocking=False,
            topic=None,
            title="80% of the budget used",
            description="d",
            status="pending",
        )
        session.add(nudge)
        session.flush()
        nudge_id = nudge.id
    items = _items(c)
    assert list(items) == [f"nudge:{nudge_id}"]
    assert items[f"nudge:{nudge_id}"]["kind"] == "nudge"
    assert items[f"nudge:{nudge_id}"]["task"]["kind"] == "budget_threshold"


def test_failed_runs_are_listed_until_retried_or_old(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    failed, _ = make_run(
        owner,
        team,
        status="failed",
        failure_code="missing_credential",
        failure_message="Engineer has no xai key on the website",
        github_repo="o/r",
        base_ref="dev",
    )
    retried, _ = make_run(owner, team, status="failed")
    make_run(owner, team, status="running", retry_of_run_id=uuid.UUID(retried))
    make_run(owner, team, status="failed", updated_at=datetime.now(UTC) - timedelta(days=20))

    items = _items(c)
    assert list(items) == [f"run_failed:{failed}"]
    item = items[f"run_failed:{failed}"]
    assert item["kind"] == "run_failed"
    assert item["failure"]["message"] == "Engineer has no xai key on the website"
    assert item["run"]["target"] == {
        "kind": "github",
        "label": "o/r",
        "base_ref": "dev",
        "subpath": None,
    }
    assert item["run"]["library_team_id"] == team


def test_setup_gaps_are_per_team_and_old_teams_fold(client):
    c, _ = fresh_account()
    recent = library_team(c, name="Recent team")
    old = library_team(c, name="Old team")
    with session_scope() as session:
        session.execute(
            update(TeamGraph)
            .where(TeamGraph.id == uuid.UUID(old))
            .values(created_at=datetime.now(UTC) - timedelta(days=45))
        )
    items = _items(c)
    gap = items[f"setup:{recent}:website"]
    assert gap["kind"] == "setup_gap"
    assert gap["target"] == "website"
    assert gap["missing_providers"]  # a fresh account holds no keys
    assert gap["missing_nodes"]
    assert gap["desktop_covers"] == []
    assert f"setup:{old}:website" not in items
    folded = items["setup:more"]
    assert folded["kind"] == "setup_gaps_folded"
    assert folded["count"] == 1
    assert folded["teams"][0]["id"] == old

    # Keys for every provider clear the gap.
    _cover_every_provider(c, recent)
    items = _items(c)
    assert f"setup:{recent}:website" not in items and "setup:more" not in items


def test_setup_gap_says_which_subscriptions_cover_desktop_and_reports_desktop(client):
    c, _ = fresh_account()
    team = library_team(c)
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(team), AgentNode.model.isnot(None))
            .values(model="xai/grok-4")
        )
    assert (
        c.put(
            "/api/engines/subscriptions/grok",
            json={"connected": True, "state": "connected", "source": "harness"},
        ).status_code
        == 200
    )
    gap = _items(c)[f"setup:{team}:website"]
    assert gap["missing_providers"] == ["xai"]
    assert gap["desktop_covers"] == ["grok"]
    # On Desktop, with no runner checked in, the team can't run on this computer either.
    desk = _items(c, "desktop")[f"setup:{team}:desktop"]
    assert desk["target"] == "desktop" and desk["missing_providers"] == ["xai"]
    assert c.get("/api/inbox?surface=phone").status_code == 422


def test_memories_item_counts_roles_and_repos(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    github_run, _ = make_run(owner, team, status="completed", github_repo="lazyxgenius/trade_mcp")
    reviewer = _authored_node(team, "reviewer")
    _add_memory(owner, source_node_id=reviewer, source_run_id=github_run, repo_key="/x/clone")
    _add_memory(owner, source_node_id=reviewer)
    item = _items(c)["memories"]
    assert item["count"] == 2
    assert item["learned_by"] == ["Reviewer"]
    assert item["repos"] == ["lazyxgenius/trade_mcp"]


def test_items_are_oldest_first_and_owner_scoped(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    _add_memory(owner, created_at=datetime.now(UTC) - timedelta(days=3))
    failed, _ = make_run(owner, team, status="failed")
    keys = list(_items(c))
    assert keys == ["memories", f"run_failed:{failed}"]

    other, _ = fresh_account()
    assert "memories" not in _items(other)
    resp = other.post("/api/inbox/dismissals", json={"key": "memories", "action": "dismiss"})
    assert resp.status_code == 404


# ---------------------------------------------------------------- dismiss / snooze / undo


def test_dismiss_undo_and_a_new_memory_brings_the_item_back(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    _add_memory(owner, created_at=datetime.now(UTC) - timedelta(hours=2))
    resp = c.post("/api/inbox/dismissals", json={"key": "memories", "action": "dismiss"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"key": "memories", "action": "dismiss", "until": None}
    assert "memories" not in _items(c)

    assert c.delete("/api/inbox/dismissals/memories").status_code == 204
    assert "memories" in _items(c)
    assert c.delete("/api/inbox/dismissals/memories").status_code == 204  # idempotent

    c.post("/api/inbox/dismissals", json={"key": "memories", "action": "dismiss"})
    assert "memories" not in _items(c)
    _add_memory(owner)  # new information: the fingerprint changes
    assert _items(c)["memories"]["count"] == 2


def test_a_setup_gap_comes_back_when_the_missing_providers_change(client):
    c, _ = fresh_account()
    team = library_team(c)
    key = f"setup:{team}:website"
    assert (
        c.post("/api/inbox/dismissals", json={"key": key, "action": "dismiss"}).status_code == 200
    )
    assert key not in _items(c)
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(team), AgentNode.role_name == "pm")
            .values(model="mistral/mistral-large-latest")
        )
    assert "mistral" in _items(c)[key]["missing_providers"]


def test_approvals_can_only_be_snoozed_and_snoozes_expire(client):
    c, owner = fresh_account()
    team = library_team(c)
    _cover_every_provider(c, team)
    run_id, clone = make_run(owner, team, status="awaiting_human")
    key = f"gate:{open_gate(run_id, clone_node(clone, 'prd_gate'))}"

    resp = c.post("/api/inbox/dismissals", json={"key": key, "action": "dismiss"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "An approval can't be dismissed. Snooze it instead."
    resp = c.post("/api/inbox/dismissals", json={"key": key, "action": "snooze"})
    assert resp.status_code == 422 and resp.json()["detail"] == "Snoozing needs an until time."
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    resp = c.post("/api/inbox/dismissals", json={"key": key, "action": "snooze", "until": past})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "The snooze time must be in the future."

    until = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    resp = c.post("/api/inbox/dismissals", json={"key": key, "action": "snooze", "until": until})
    assert resp.status_code == 200, resp.text
    assert resp.json()["action"] == "snooze" and resp.json()["until"]
    assert key not in _items(c)

    with session_scope() as session:  # the hour passes
        session.execute(
            update(InboxDismissal)
            .where(InboxDismissal.owner_id == owner, InboxDismissal.item_key == key)
            .values(snooze_until=datetime.now(UTC) - timedelta(seconds=1))
        )
    assert key in _items(c)


def test_unknown_keys_404(client):
    c, _ = fresh_account()
    resp = c.post("/api/inbox/dismissals", json={"key": "run_failed:nope", "action": "dismiss"})
    assert resp.status_code == 404 and resp.json()["detail"] == "inbox item not found"
