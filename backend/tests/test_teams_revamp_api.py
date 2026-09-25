"""Revamp B-TEAMS — the Home team cards and the account endpoints.

Covers the richer team summary (G-1: counts, last activity, latest run idea/PR, origin, strip,
readiness, live spend), the run→team link through ``runs.library_team_id`` with the clone→origin
fallback, templates with strips and the design copy (G-5), create validation, Duplicate (G-4),
the history rows (G-7), delete removing Desktop jobs (G-14), account preferences (G-10) and the
display name on the auth endpoints (G-12/P13).

Every test registers its own account (a fresh client) so counts and readiness are exact; the
session ``client`` fixture is requested only to start the app (DBOS) once."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, update

from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.graph_validity import team_shape
from tvashtr.control_plane.teams import clone_team_graph, list_library_teams
from tvashtr.db import get_engine, session_scope
from tvashtr.main import app
from tvashtr.models import (
    AgentNode,
    CostRecord,
    DesktopNodeJob,
    Edge,
    EngineSubscriptionStatus,
    ProviderCredential,
    Run,
    TeamGraph,
    User,
)

_T0 = datetime(2026, 3, 1, tzinfo=UTC)
_ANTHROPIC = "anthropic/claude-sonnet-4-5"
_XAI = "xai/grok-4"


def _fresh(prefix: str = "teams") -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"{prefix}-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "teams-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _team(c: TestClient, template: str = "review_loop", name: str = "Squad") -> dict:
    resp = c.post("/api/teams", json={"template": template, "name": name})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _summary(c: TestClient, team_id: str) -> dict:
    return next(t for t in c.get("/api/teams").json()["teams"] if t["team_graph_id"] == team_id)


def _run(
    team_id: str,
    owner: uuid.UUID,
    *,
    status: str = "completed",
    cost: Decimal | None = None,
    created_at: datetime = _T0,
    idea: str = "an idea",
    pr_url: str | None = None,
    link: bool = False,
) -> str:
    """A launch-shaped run: clone the library team (nodes carry ``cloned_from_node_id``) and point
    a Run at the clone. ``link`` also sets ``runs.library_team_id`` (as launches do from now on)."""
    clone_id = clone_team_graph(team_id)
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(clone_id),
                owner_id=owner,
                idea=idea,
                workflow_id=str(run_id),
                status=status,
                cost_total_usd=cost,
                created_at=created_at,
                pr_url=pr_url,
                library_team_id=uuid.UUID(team_id) if link else None,
            )
        )
    return str(run_id)


def _cost(run_id: str, usd: str) -> None:
    with session_scope() as session:
        session.add(
            CostRecord(
                workflow_id=run_id,
                idempotency_key=f"test-{uuid.uuid4().hex}",
                model_requested="m",
                model_used="m",
                prompt_tokens=1,
                completion_tokens=1,
                total_tokens=2,
                cost_usd=Decimal(usd),
            )
        )


def _set_models(team_id: str, model: str) -> None:
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(team_id), AgentNode.model.is_not(None))
            .values(model=model)
        )


# ---- summary ----------------------------------------------------------------------------------


def test_never_run_team_summary_has_every_new_key(client):
    c, _owner = _fresh()
    team = _team(c, "review_loop", "  Payments squad  ")
    assert team["name"] == "Payments squad"  # trimmed
    assert team["run_count"] == 0
    assert team["active_run_count"] == 0 and team["awaiting_run_count"] == 0
    assert team["last_run"] is None and team["spend_usd"] == 0
    assert team["last_active_at"] == team["created_at"]
    assert team["template_key"] == "review_loop"
    assert team["template_name"] == "PM → Engineer ⇄ Reviewer"
    assert team["duplicated_from"] is None
    assert [n["label"] for n in team["shape"]["nodes"]] == [
        "PM",
        "Approval",
        "Engineer",
        "Reviewer",
        "Ship",
    ]
    assert team["shape"]["loops"] == [{"from": 3, "to": 2}]
    assert set(team["readiness"]) == {"website", "desktop", "subscriptions_connected"}
    # The list returns the same summary.
    assert _summary(c, team["team_graph_id"]) == team


def test_blank_team_records_its_starting_point(client):
    c, _owner = _fresh()
    team = _team(c, "blank", "Scratch")
    assert team["template_key"] == "blank" and team["template_name"] == "Blank"
    assert [n["role"] for n in team["shape"]["nodes"]] == ["thinker", "ship"]


def test_counts_last_run_and_last_active_at(client):
    c, owner = _fresh()
    tid = _team(c)["team_graph_id"]
    _run(tid, owner, status="completed", created_at=_T0)
    _run(tid, owner, status="running", created_at=_T0 + timedelta(hours=1))
    _run(tid, owner, status="pending", created_at=_T0 + timedelta(hours=2))
    latest = _run(
        tid,
        owner,
        status="awaiting_human",
        created_at=_T0 + timedelta(hours=3),
        idea="Add an RSI indicator",
        pr_url="https://github.com/o/r/pull/7",
    )
    s = _summary(c, tid)
    assert s["run_count"] == 4
    assert s["active_run_count"] == 2
    assert s["awaiting_run_count"] == 1
    assert s["last_run"]["run_id"] == latest
    assert s["last_run"]["status"] == "awaiting_human"
    assert s["last_run"]["idea"] == "Add an RSI indicator"
    assert s["last_run"]["pr_url"] == "https://github.com/o/r/pull/7"
    assert s["last_run"]["at"].startswith("2026-03-01T03:00")
    # updated_at: pin one run's activity later than every other and see it win.
    later = datetime(2030, 1, 1, tzinfo=UTC)
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(latest)).values(updated_at=later))
    s = _summary(c, tid)
    assert s["last_run"]["updated_at"].startswith("2030-01-01")
    assert s["last_active_at"].startswith("2030-01-01")


def test_spend_is_live_so_in_flight_failed_and_cancelled_runs_count(client):
    c, owner = _fresh()
    tid = _team(c)["team_graph_id"]
    running = _run(tid, owner, status="running")  # no cost_total_usd yet
    _cost(running, "1.21")
    failed = _run(tid, owner, status="failed")
    _cost(failed, "0.50")
    _cost(failed, "0.25")
    cancelled = _run(tid, owner, status="cancelled")
    _cost(cancelled, "2.00")
    # A run with no ledger rows falls back to its stored final cost.
    _run(tid, owner, status="completed", cost=Decimal("3.00"))
    assert _summary(c, tid)["spend_usd"] == pytest.approx(1.21 + 0.75 + 2.00 + 3.00)


def test_runs_link_through_library_team_id_and_the_clone_join_without_double_counting(client):
    c, owner = _fresh()
    tid = _team(c)["team_graph_id"]
    other = _team(c, "two_node", "Other")["team_graph_id"]
    legacy = _run(tid, owner, cost=Decimal("1.00"))  # library_team_id NULL → clone join
    linked = _run(tid, owner, cost=Decimal("2.00"), link=True)  # both links point at the team
    # A run whose library_team_id names the team even though its clone's origin nodes are gone
    # (every authored node it came from was deleted on the canvas) still counts.
    orphan = _run(other, owner, cost=Decimal("4.00"))
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(orphan)).values(library_team_id=tid))
    s = _summary(c, tid)
    assert s["run_count"] == 3
    assert s["spend_usd"] == 7.0
    runs = {r["run_id"] for r in c.get(f"/api/teams/{tid}/runs").json()["runs"]}
    assert runs == {legacy, linked, orphan}
    # The run re-pointed by library_team_id no longer counts for the team it was cloned from.
    assert _summary(c, other)["run_count"] == 0


def test_list_is_batched_not_one_query_per_team(client):
    c, owner = _fresh()
    for i in range(2):
        tid = _team(c, name=f"batch {i}")["team_graph_id"]
        _run(tid, owner)

    def count_queries() -> int:
        seen: list[str] = []

        def listener(conn, cursor, statement, *args):  # noqa: ARG001
            seen.append(statement)

        event.listen(get_engine(), "before_cursor_execute", listener)
        try:
            list_library_teams(owner)
        finally:
            event.remove(get_engine(), "before_cursor_execute", listener)
        return len(seen)

    two = count_queries()
    for i in range(4):
        tid = _team(c, name=f"more {i}")["team_graph_id"]
        _run(tid, owner)
    assert count_queries() == two  # six teams cost the same queries as two


# ---- readiness --------------------------------------------------------------------------------


def test_readiness_website_needs_keys_desktop_uses_fresh_subscriptions(client):
    c, owner = _fresh()
    tid = _team(c, "two_node")["team_graph_id"]
    _set_models(tid, _ANTHROPIC)
    r = _summary(c, tid)["readiness"]
    assert r["website"] == {
        "ready": False,
        "missing_providers": ["anthropic"],
        "missing_nodes": ["engineer", "pm"],
    }
    assert r["desktop"]["ready"] is False and r["desktop"]["routed_subscriptions"] == []
    assert r["subscriptions_connected"] == []

    # A connected Claude mirror is reported, but a Desktop launch needs the runner to be fresh.
    with session_scope() as session:
        session.add(
            EngineSubscriptionStatus(
                owner_id=owner, provider="claude", connected=True, state="connected"
            )
        )
    r = _summary(c, tid)["readiness"]
    assert r["subscriptions_connected"] == ["claude"]
    assert r["desktop"]["ready"] is False

    desktop_jobs.heartbeat(owner, ["claude"])
    r = _summary(c, tid)["readiness"]
    assert r["desktop"] == {
        "ready": True,
        "missing_providers": [],
        "missing_nodes": [],
        "routed_subscriptions": ["claude"],
    }
    assert r["website"]["ready"] is False  # the website never counts a subscription


def test_readiness_with_a_held_key_is_ready_everywhere(client):
    c, owner = _fresh()
    tid = _team(c, "two_node")["team_graph_id"]
    _set_models(tid, _XAI)
    with session_scope() as session:
        session.add(
            ProviderCredential(
                owner_id=owner, provider="xai", secret_encrypted="x", key_last4="0000"
            )
        )
    r = _summary(c, tid)["readiness"]
    assert r["website"]["ready"] is True and r["website"]["missing_providers"] == []
    assert r["desktop"]["ready"] is True


# ---- templates and create ---------------------------------------------------------------------


def test_templates_carry_strips_and_the_design_copy(client):
    c, _owner = _fresh()
    body = c.get("/api/templates").json()
    by_key = {t["template"]: t for t in body["templates"]}
    assert list(by_key) == ["two_node", "review_loop", "plan_review", "full_squad"]
    assert by_key["review_loop"]["name"] == "PM → Engineer ⇄ Reviewer"
    assert by_key["review_loop"]["description"] == (
        "Adds a Reviewer that runs the tests and loops back for fixes."
    )
    assert by_key["plan_review"]["name"] == "PM → Architect → Engineer ⇄ Reviewer"
    assert by_key["plan_review"]["description"] == (
        "Two thinkers plan it, then a build-and-review loop ships it."
    )
    assert by_key["full_squad"]["description"] == (
        "Plan, you approve, build and test in a loop, you approve the ship."
    )
    assert body["blank"] == {
        "template": "blank",
        "name": "Blank",
        "description": "An empty canvas: one thinker into Ship. Wire the rest yourself.",
        "shape": {
            "nodes": [
                {"id": None, "kind": "thinker", "role": "thinker", "label": "Thinker"},
                {"id": None, "kind": "terminal", "role": "ship", "label": "Ship"},
            ],
            "loops": [],
        },
    }


@pytest.mark.parametrize("template", ["two_node", "review_loop", "plan_review", "full_squad"])
def test_static_template_strip_matches_the_team_it_builds(client, template):
    c, _owner = _fresh()
    declared = next(
        t for t in c.get("/api/templates").json()["templates"] if t["template"] == template
    )["shape"]
    built = _team(c, template)["shape"]

    def strip(shape):
        return [(n["kind"], n["role"], n["label"]) for n in shape["nodes"]], shape["loops"]

    assert strip(declared) == strip(built)


def test_create_rejects_a_blank_name_and_an_unknown_template(client):
    c, _owner = _fresh()
    for name in ("", "   "):
        resp = c.post("/api/teams", json={"template": "two_node", "name": name})
        assert resp.status_code == 422
        assert resp.json()["detail"] == "A team name is required."
    assert c.post("/api/teams", json={"template": "nope", "name": "X"}).status_code == 400
    assert c.get("/api/teams").json() == {"teams": []}


# ---- duplicate --------------------------------------------------------------------------------


def _graph_fingerprint(team_id: str):
    with session_scope() as session:
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_id)))
            .scalars()
            .all()
        )
        by_id = {n.id: n.role_name for n in nodes}
        node_fp = sorted(
            (
                n.role_name,
                n.kind,
                n.model,
                n.prompt,
                str(n.position),
                str(n.config),
                n.edits_allowed,
                n.cloned_from_node_id,
            )
            for n in nodes
        )
        edges = session.execute(
            select(Edge).where(Edge.team_graph_id == uuid.UUID(team_id))
        ).scalars()
        edge_fp = sorted(
            (by_id[e.source_node_id], by_id[e.target_node_id], e.edge_type, str(e.conditions))
            for e in edges
        )
    return node_fp, edge_fp


def test_duplicate_copies_the_graph_but_not_the_runs(client):
    c, owner = _fresh()
    src = _team(c, "full_squad", "Indicator sprint team")
    sid = src["team_graph_id"]
    with session_scope() as session:  # a customised node must survive the copy
        session.execute(
            update(AgentNode)
            .where(AgentNode.team_graph_id == uuid.UUID(sid), AgentNode.role_name == "pm")
            .values(prompt="Custom PM brief", tool_config={"mcpServers": {}}, skills=[])
        )
    _run(sid, owner, cost=Decimal("1.00"))

    resp = c.post(f"/api/teams/{sid}/duplicate")
    assert resp.status_code == 201, resp.text
    dup = resp.json()
    assert dup["team_graph_id"] != sid
    assert dup["name"] == "Indicator sprint team (copy)"
    assert dup["duplicated_from"] == {"team_graph_id": sid, "name": "Indicator sprint team"}
    assert dup["template_key"] == "full_squad"
    assert dup["run_count"] == 0 and dup["last_run"] is None and dup["spend_usd"] == 0
    assert dup["node_count"] == src["node_count"]
    assert dup["shape"]["loops"] == src["shape"]["loops"]
    assert _graph_fingerprint(dup["team_graph_id"]) == _graph_fingerprint(sid)
    # The source is untouched and keeps its run.
    assert _summary(c, sid)["run_count"] == 1


def test_duplicate_takes_a_trimmed_name_and_rejects_a_blank_one(client):
    c, _owner = _fresh()
    sid = _team(c, "two_node", "Docs team")["team_graph_id"]
    resp = c.post(f"/api/teams/{sid}/duplicate", json={"name": "  Docs team B "})
    assert resp.status_code == 201 and resp.json()["name"] == "Docs team B"
    resp = c.post(f"/api/teams/{sid}/duplicate", json={"name": "  "})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "A team name is required."


def test_duplicate_is_owner_scoped(client):
    c, owner = _fresh()
    other, _ = _fresh("teams-other")
    sid = _team(c, "two_node")["team_graph_id"]
    resp = other.post(f"/api/teams/{sid}/duplicate")
    assert resp.status_code == 404 and resp.json()["detail"] == "library team not found"
    # A run snapshot clone is not a library team either.
    snapshot = clone_team_graph(sid)
    assert c.post(f"/api/teams/{snapshot}/duplicate").status_code == 404
    resp = c.post("/api/teams/not-a-uuid/duplicate")
    assert resp.status_code == 400 and resp.json()["detail"] == "invalid team id"
    assert other.get("/api/teams").json() == {"teams": []}


def test_duplicated_from_survives_deleting_the_source(client):
    c, _owner = _fresh()
    sid = _team(c, "two_node", "Original")["team_graph_id"]
    dup = c.post(f"/api/teams/{sid}/duplicate").json()
    assert c.delete(f"/api/teams/{sid}").status_code == 200
    assert _summary(c, dup["team_graph_id"])["duplicated_from"] == {
        "team_graph_id": sid,
        "name": None,
    }


# ---- history rows and delete --------------------------------------------------------------------


def test_team_run_rows_gain_pr_status_group_and_live_spend(client):
    c, owner = _fresh()
    tid = _team(c)["team_graph_id"]
    shipped = _run(
        tid,
        owner,
        status="completed",
        cost=Decimal("1.50"),
        pr_url="https://github.com/o/r/pull/39",
    )
    live = _run(tid, owner, status="awaiting_human", created_at=_T0 + timedelta(hours=1))
    _cost(live, "1.21")
    stopped = _run(tid, owner, status="over_budget", created_at=_T0 + timedelta(hours=2))
    rows = c.get(f"/api/teams/{tid}/runs").json()["runs"]
    assert [r["run_id"] for r in rows] == [stopped, live, shipped]  # newest first
    by_id = {r["run_id"]: r for r in rows}
    assert by_id[shipped]["pr_url"] == "https://github.com/o/r/pull/39"
    assert by_id[shipped]["pr_number"] == 39
    assert by_id[shipped]["status_group"] == "completed"
    assert by_id[shipped]["spent_usd"] == 1.5 and by_id[shipped]["cost_total_usd"] == 1.5
    assert by_id[live]["status_group"] == "needs_you"
    assert by_id[live]["spent_usd"] == 1.21
    assert by_id[live]["cost_total_usd"] == 0.0  # the stored final cost is unchanged
    assert by_id[live]["pr_url"] is None and by_id[live]["pr_number"] is None
    assert by_id[stopped]["status_group"] == "stopped"
    assert all(r["updated_at"] for r in rows)


def test_delete_team_removes_its_runs_desktop_jobs(client):
    c, owner = _fresh()
    tid = _team(c)["team_graph_id"]
    run_id = _run(tid, owner, status="completed")
    keep_run = _run(_team(c, "two_node", "Keeper")["team_graph_id"], owner, status="completed")
    with session_scope() as session:
        for rid in (run_id, keep_run):
            session.add(
                DesktopNodeJob(
                    owner_id=owner,
                    run_id=rid,
                    node_id=str(uuid.uuid4()),
                    attempt_key=f"{uuid.uuid4()}:1",
                    provider="claude",
                    model=_ANTHROPIC,
                    instruction="do it",
                    workspace_dir="/tmp/nowhere",
                )
            )
    assert c.delete(f"/api/teams/{tid}").status_code == 200
    with session_scope() as session:
        jobs = {j.run_id for j in session.execute(select(DesktopNodeJob)).scalars()}
        assert run_id not in jobs
        assert keep_run in jobs  # another team's job is untouched
        assert session.get(Run, uuid.UUID(run_id)) is None


def test_delete_removes_runs_linked_only_by_library_team_id(client):
    c, owner = _fresh()
    tid = _team(c)["team_graph_id"]
    other = _team(c, "two_node", "Other")["team_graph_id"]
    rid = _run(other, owner)
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(rid)).values(library_team_id=tid))
    assert c.delete(f"/api/teams/{tid}").status_code == 200
    with session_scope() as session:
        assert session.get(Run, uuid.UUID(rid)) is None
        assert session.get(TeamGraph, uuid.UUID(other)) is not None


# ---- preferences ------------------------------------------------------------------------------


def test_preferences_default_merge_and_owner_scope(client):
    c, owner = _fresh()
    other, _ = _fresh("teams-other")
    assert c.get("/api/account/preferences").json() == {"get_started_hidden": False}

    resp = c.patch("/api/account/preferences", json={"get_started_hidden": True})
    assert resp.status_code == 200 and resp.json() == {"get_started_hidden": True}
    assert c.get("/api/account/preferences").json() == {"get_started_hidden": True}
    # An empty patch changes nothing.
    assert c.patch("/api/account/preferences", json={}).json() == {"get_started_hidden": True}
    # Another account keeps its own default.
    assert other.get("/api/account/preferences").json() == {"get_started_hidden": False}
    with session_scope() as session:
        assert session.get(User, owner).preferences == {"get_started_hidden": True}


def test_preferences_reject_unknown_keys_and_wrong_types(client):
    c, _owner = _fresh()
    resp = c.patch("/api/account/preferences", json={"theme": "dark", "get_started_hidden": True})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Unknown preference: theme."
    resp = c.patch("/api/account/preferences", json={"get_started_hidden": "yes"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "get_started_hidden must be true or false."
    assert c.patch("/api/account/preferences", json=[1]).status_code == 422
    # Nothing was stored by the rejected patches.
    assert c.get("/api/account/preferences").json() == {"get_started_hidden": False}


def test_preferences_require_a_session(unauth_client):
    assert unauth_client.get("/api/account/preferences").status_code == 401
    assert unauth_client.patch("/api/account/preferences", json={}).status_code == 401


# ---- identity -----------------------------------------------------------------------------------


def test_auth_endpoints_return_github_login_and_display_name(client):
    c = TestClient(app)
    c.cookies.clear()
    email = f"lazyx-{uuid.uuid4().hex[:8]}@tvashtr.local"
    reg = c.post("/api/auth/register", json={"email": email, "password": "teams-password"}).json()
    local = email.split("@")[0]
    assert reg["github_login"] is None
    assert reg["display_name"] == "L" + local[1:]
    assert c.get("/api/auth/me").json()["display_name"] == "L" + local[1:]

    with session_scope() as session:
        session.execute(
            update(User).where(User.id == uuid.UUID(reg["id"])).values(github_login="lazyxgenius")
        )
    me = c.get("/api/auth/me").json()
    assert me["github_login"] == "lazyxgenius" and me["display_name"] == "lazyxgenius"
    login = c.post("/api/auth/login", json={"email": email, "password": "teams-password"}).json()
    assert login["github_login"] == "lazyxgenius" and login["display_name"] == "lazyxgenius"
    assert set(login) == {"id", "email", "github_login", "display_name"}


def test_team_shape_helper_matches_the_summary_strip(client):
    """The summary's strip is exactly ``team_shape`` over the stored graph."""
    c, owner = _fresh()
    tid = _team(c, "plan_review")["team_graph_id"]
    with session_scope() as session:
        nodes = [
            {"id": str(n.id), "kind": n.kind, "role_name": n.role_name, "config": n.config}
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(tid))
            ).scalars()
        ]
        edges = [
            {
                "id": str(e.id),
                "source_node_id": str(e.source_node_id),
                "target_node_id": str(e.target_node_id),
                "edge_type": e.edge_type,
                "conditions": e.conditions,
            }
            for e in session.execute(
                select(Edge).where(Edge.team_graph_id == uuid.UUID(tid))
            ).scalars()
        ]
    assert _summary(c, tid)["shape"] == team_shape(nodes, edges)
