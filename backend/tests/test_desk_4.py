"""M-desk-4 — money and time that tell the truth on the Desktop (brief ``prompts/m-desk-4.md``).
Builds on M-desk-routes, -2 and -3 (``test_desk_routes.py``, ``test_desk_2.py``, ``test_desk_3``).

(n) H4: in a Desktop task-set compare, a cell whose run waits for the other lane's job shows the
waiting line, as a one-task lane does. (o) H5: on the Desktop, versions sharing a plan take turns,
so the minutes add up that work; versions sharing none keep today's figure. (p) H1/H2: read from
the Desktop (``?desktop_target=1``), the run view, its Resume steps and a compare say where each
run's work really ran (its Desktop jobs; any metered spend), and the end line and the Cost row
name the subscriptions. The website's reads are unchanged. Offline: no workflow, no LLM.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from home_fixtures import add_cost, clone_node, fresh_account, make_run
from sqlalchemy import delete, select
from test_compare import _graph, _seed_compare, _side
from test_desk_routes import CLAUDE, _desk_versions
from test_desktop_subscription_launch import _connect_desktop
from test_task_sets import _T0, _cell, _make_set, _seed_set_compare, _set_runs

from tvashtr.config import get_settings
from tvashtr.control_plane import compare, desktop_jobs, resume
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, CompareDesktopTarget, CostRecord, RunEvent

LINE = "Waiting for your Claude subscription — one job at a time."
NONE = {"subscriptions": [], "all": False}
BOTH = {"subscriptions": ["claude", "grok"], "all": True}


# ------------------------------------------------------------------------------------ helpers


def _invocations(run_id: str) -> list[AgentInvocation]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentInvocation)
                .where(AgentInvocation.run_id == run_id)
                .order_by(AgentInvocation.id)
            )
            .scalars()
            .all()
        )
        for r in rows:
            session.expunge(r)
    return rows


def _on_desktop(owner, inv: AgentInvocation, provider: str = "claude") -> None:
    """The step ran as a Desktop job on ``provider``'s plan."""
    desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=inv.run_id,
        node_id=str(inv.node_id),
        iteration=inv.iteration,
        invocation_id=inv.id,
        provider=provider,
        model=CLAUDE,
        instruction="build it",
        workspace_dir="/nonexistent",
        sidecars=[],
    )


def _no_key_spend(run_id: str) -> None:
    with session_scope() as session:
        session.execute(delete(CostRecord).where(CostRecord.workflow_id == run_id))


def _run(owner, team: str, plans: dict[str, str], *, cost=None, status="completed") -> tuple:
    """A finished run whose ``plans`` roles ({"engineer": "claude"}) ran on the Desktop; ``cost``
    is metered key spend. Returns ``(run_id, {role: invocation id})``."""
    now = datetime.now(UTC)
    run_id, clone = make_run(
        owner,
        team,
        status=status,
        team_version_number=1,
        created_at=now - timedelta(minutes=22),
        updated_at=now,
    )
    invs = {}
    with session_scope() as session:
        for role in ("engineer", "reviewer"):
            inv = AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(clone_node(clone, role)),
                iteration=1,
                status="done",
                started_at=now - timedelta(minutes=20),
                ended_at=now - timedelta(minutes=1),
            )
            session.add(inv)
            session.flush()
            invs[role] = inv.id
    for inv in _invocations(run_id):
        role = next(r for r, i in invs.items() if i == inv.id)
        if role in plans:
            _on_desktop(owner, inv, plans[role])
    if cost is not None:
        add_cost(run_id, cost)
    return run_id, invs


# ------------------------------------------------------- (n) H4: the queued set cell waits


def test_n_a_desktop_set_cell_waiting_for_the_other_lane_shows_the_waiting_line(client):
    c, owner = fresh_account("desk4-n")
    team = _desk_versions(c)
    ts = _make_set(c, team)
    cid = _seed_set_compare(team, owner, ts, status="running")
    with session_scope() as session:
        session.add(CompareDesktopTarget(compare_id=uuid.UUID(cid)))
    item = ts["items"][0]["id"]
    a = _cell(owner, team, cid, item, "A", 1, at=_T0, status="running", rounds=1)
    _cell(owner, team, cid, item, "B", 2, at=_T0, status="running", rounds=1)
    # A's Engineer waits behind B's job on the one Claude plan (the Desktop runner's note).
    waiting = _invocations(a)[0]
    with session_scope() as session:
        session.add(
            RunEvent(
                run_id=a,
                invocation_id=waiting.id,
                seq=1,
                kind="message",
                payload={"source": "tvashtr", "text": LINE},
            )
        )
    try:
        desk = c.get(f"/api/compares/{cid}?desktop_target=1").json()["items"][0]
        assert desk["a"]["now"] == f"Engineer · {LINE}"
        assert desk["a"]["queued"] is True
        assert desk["b"]["now"] == "Engineer · round 1" and desk["b"]["queued"] is False
        # A Desktop compare's cell says so on any read, as its lanes do; only the Desktop's read
        # gains the new fields.
        web = c.get(f"/api/compares/{cid}").json()["items"][0]
        assert web["a"]["now"] == f"Engineer · {LINE}"
        assert "queued" not in web["a"] and "ran_on" not in web["a"]
    finally:
        from test_compare import _end

        _end(_set_runs(cid))
        c.post(f"/api/compares/{cid}/stop")


def test_n_a_website_set_cell_keeps_saying_what_it_is_doing(client):
    """No Desktop compare: a waiting note never turns a cell into the waiting line (a waiting
    step is no current step there, as before)."""
    c, owner = fresh_account("desk4-n-web")
    team = _desk_versions(c)
    ts = _make_set(c, team)
    cid = _seed_set_compare(team, owner, ts, status="running")
    a = _cell(owner, team, cid, ts["items"][0]["id"], "A", 1, at=_T0, status="running")
    with session_scope() as session:
        session.add(
            RunEvent(
                run_id=a,
                invocation_id=_invocations(a)[0].id,
                seq=1,
                kind="message",
                payload={"source": "tvashtr", "text": LINE},
            )
        )
    try:
        cell = c.get(f"/api/compares/{cid}?desktop_target=1").json()["items"][0]["a"]
        assert cell["now"] is None and cell["queued"] is False
    finally:
        from test_compare import _end

        _end(_set_runs(cid))
        c.post(f"/api/compares/{cid}/stop")


# ------------------------------------------------------- (o) H5: the minutes count the turns


def test_o_turns_add_up_the_work_on_a_shared_plan():
    assert compare._turns([600.0, 600.0], [["claude"], ["claude"]], 1) == 1200
    assert compare._turns([600.0, 300.0], [["claude"], ["grok"]], 1) == 600
    assert compare._turns([600.0, 600.0], None, 5) == 0
    assert compare._turns([600.0, 300.0], [["claude", "grok"], ["claude"]], 3) == 2700


def _finished(owner, team: str, version: int, minutes: int = 10) -> None:
    now = datetime.now(UTC)
    make_run(
        owner,
        team,
        status="completed",
        team_version_number=version,
        created_at=now - timedelta(minutes=minutes),
        updated_at=now,
    )


def test_o_desktop_minutes_add_up_when_the_versions_share_a_plan(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # every task at once
    c, owner = fresh_account("desk4-o")
    team = _desk_versions(c)  # v1, v2: PM on Grok, Engineer + Reviewer on Claude
    for version in (1, 2):
        _finished(owner, team, version)
    _make_set(c, team)  # 2 tasks
    _connect_desktop(c, "claude", "grok")

    page = f"/api/teams/{team}/compare"
    web, desk = c.get(page).json()["estimate"], c.get(f"{page}?desktop_target=1").json()["estimate"]
    assert web["minutes"] == 10  # the website: both versions at once
    assert desk == {**web, "minutes": 20}  # the Desktop: they take turns on Claude and Grok

    sets = f"/api/teams/{team}/task-sets"
    web_set, desk_set = c.get(sets).json()["sets"][0], c.get(f"{sets}?desktop_target=1").json()
    desk_set = desk_set["sets"][0]
    assert web_set["estimate"]["minutes"] == 10 and "desktop" not in web_set
    assert desk_set["estimate"] == {**web_set["estimate"], "minutes": 40}  # 2 tasks x 2 x 10
    assert desk_set["desktop"] == BOTH

    offer = f"/api/teams/{team}/versions"
    assert c.get(offer).json()["check_sets"][0]["estimate"]["minutes"] == 10
    assert c.get(f"{offer}?desktop_target=1").json()["check_sets"][0]["estimate"]["minutes"] == 40


def test_o_versions_that_share_no_plan_keep_todays_minutes(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    c, owner = fresh_account("desk4-o-none")
    team = _desk_versions(c)  # v2 on Claude and Grok
    c.post("/api/providers", json={"provider": "openai", "api_key": "sk-openai"})
    for n in _graph(c, team)["nodes"]:
        if n.get("model"):
            c.patch(f"/api/teams/{team}/nodes/{n['id']}", json={"model": "openai/gpt-4.1"})
    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v3 on a key
    for version in (2, 3):
        _finished(owner, team, version)
    _connect_desktop(c, "claude", "grok")
    page = f"/api/teams/{team}/compare"
    web, desk = c.get(page).json()["estimate"], c.get(f"{page}?desktop_target=1").json()["estimate"]
    assert web == desk and desk["minutes"] == 10  # v2 on the plans, v3 on a key: no turns


# --------------------------------------------- (p) H1/H2: where each run's work really ran


def test_p_the_run_view_says_where_the_work_ran(client):
    """A run wholly on subscriptions, a mixed one and a website one: the run read and its
    Activity say so, and the Desktop's end line names the plans instead of a price."""
    c, owner = fresh_account("desk4-p-run")
    team = _desk_versions(c)
    subs, _ = _run(owner, team, {"engineer": "claude", "reviewer": "grok"})
    failed, _ = _run(owner, team, {"engineer": "claude"}, status="failed")
    mixed, _ = _run(owner, team, {"engineer": "claude"}, cost="0.12")
    website, _ = _run(owner, team, {}, cost="0.50")
    expect = {
        subs: (BOTH, "Done in ", "on your Claude and Grok subscriptions"),
        failed: (
            {"subscriptions": ["claude"], "all": True},
            "Failed after ",
            "on your Claude subscription",
        ),
        mixed: (
            {"subscriptions": ["claude"], "all": False},
            "Done in ",
            "$0.12 + your Claude subscription",
        ),
        website: (NONE, "Done in ", "$0.50"),
    }
    for rid, (ran, lead, words) in expect.items():
        assert c.get(f"/api/runs/{rid}?desktop_target=1").json()["run"]["ran_on"] == ran
        act = c.get(f"/api/runs/{rid}/activity?desktop_target=1").json()
        assert act["ran_on"] == ran
        done = next(ln for ln in act["lines"] if ln["id"] == "run:done")
        assert done["text"].startswith(lead) and done["text"].endswith(f" · {words}"), done
        # The website's reads: no new field and today's words.
        assert "ran_on" not in c.get(f"/api/runs/{rid}").json()["run"]
        web = c.get(f"/api/runs/{rid}/activity").json()
        assert "ran_on" not in web
        line = next(ln for ln in web["lines"] if ln["id"] == "run:done")["text"]
        assert re.fullmatch(rf"{lead}.+ · \$\d+\.\d\d", line), line


def test_p_resume_steps_say_the_plan_each_step_ran_on(client):
    c, owner = fresh_account("desk4-p-resume")
    team = _desk_versions(c)
    rid, invs = _run(owner, team, {"engineer": "claude"}, status="failed")
    desk = {
        p["invocation_id"]: p
        for p in c.get(f"/api/runs/{rid}/resume?desktop_target=1").json()["points"]
    }
    assert desk[invs["engineer"]]["plan"] == "claude"
    assert desk[invs["reviewer"]]["plan"] is None  # it ran on a key
    web = c.get(f"/api/runs/{rid}/resume").json()["points"]
    assert web and all("plan" not in p for p in web)
    # The confirm's words come from where the skipped and the re-run steps ran.
    assert resume._ran_on([{"plan": "grok"}, {"plan": "claude"}]) == BOTH
    assert resume._ran_on([{"plan": "claude"}, {"plan": None}]) == {
        "subscriptions": ["claude"],
        "all": False,
    }
    assert resume._ran_on([]) == NONE


def test_p6_the_resume_confirm_names_a_check_and_every_plan_that_runs_again(client):
    """M-desk-8 P6: a check on the way to Ship is never "when you approve" (a Tests check:
    "Tests pass — Tvashtr runs the tests"), and the subscription line names every plan the steps
    that run again use — the Grok Reviewer that never ran in the stopped run too."""
    from test_desk_6 import _tests_team
    from test_desk_routes import GROK

    from tvashtr.models import AgentNode, Run

    _c, owner = fresh_account("desk8-p6")
    team = _tests_team()["team"]  # PM -> spec gate -> Engineer -> Tests pass -> Reviewer -> Ship
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    with session_scope() as session:
        nodes = {
            n.role_name: n
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team))
            ).scalars()
        }
        nodes["engineer"].model, nodes["reviewer"].model = CLAUDE, GROK
        session.add(Run(id=run_id, team_graph_id=uuid.UUID(team), owner_id=owner, idea="Add RSI",
                        workflow_id=str(run_id), status="cancelled", desktop_target=True,
                        desktop_subscriptions=["claude", "grok"]))  # fmt: skip
        session.flush()
        session.add(
            AgentInvocation(run_id=str(run_id), node_id=nodes["engineer"].id, iteration=1,
                            status="failed", started_at=now - timedelta(minutes=9), ended_at=now)
        )  # fmt: skip
    (eng,) = _invocations(str(run_id))
    _on_desktop(owner, eng, "claude")  # stopped on Claude; the Grok Reviewer never ran
    with session_scope() as session:
        reply = resume.points(session, session.get(Run, run_id), desktop=True)
    confirm = next(p for p in reply["points"] if p["invocation_id"] == eng.id)["confirm"]
    assert "Tests pass — Tvashtr runs the tests" in confirm["runs_again"]
    assert not any("when you approve" in t for t in confirm["runs_again"])
    assert confirm["again_ran_on"] == BOTH


def test_p_a_compares_lanes_and_cost_row_say_where_the_work_ran(client):
    c, owner = fresh_account("desk4-p-cmp")
    team = _desk_versions(c)
    cid = _seed_compare(team, owner, status="finished")
    a = _side(owner, team, cid, "A", 1)
    b = _side(owner, team, cid, "B", 2)  # $1.00 on a key, and Claude
    _no_key_spend(a)  # A: wholly on Claude
    for rid in (a, b):
        _on_desktop(owner, _invocations(rid)[0])
    desk = c.get(f"/api/compares/{cid}?desktop_target=1").json()
    claude = {"subscriptions": ["claude"], "all": True}
    assert [s["ran_on"] for s in desk["sides"]] == [claude, {**claude, "all": False}]
    assert desk["ran_on"] == {**claude, "all": False}
    cost = next(r for r in desk["results"]["rows"] if r["key"] == "cost")
    assert (cost["a"], cost["b"]) == (
        "on your Claude subscription",
        "$1.00 + your Claude subscription",
    )
    web = c.get(f"/api/compares/{cid}").json()
    assert "ran_on" not in web and all("ran_on" not in s for s in web["sides"])
    cost = next(r for r in web["results"]["rows"] if r["key"] == "cost")
    assert (cost["a"], cost["b"]) == ("$0.00", "$1.00")


@pytest.mark.parametrize("desktop", [True, False])
def test_p_history_runs_say_where_the_work_ran_only_on_the_desktop(client, desktop):
    c, owner = fresh_account(f"desk4-p-hist-{desktop}")
    team = _desk_versions(c)
    rid, _ = _run(owner, team, {"engineer": "claude"})
    url = f"/api/teams/{team}/runs" + ("?desktop_target=1" if desktop else "")
    row = next(r for r in c.get(url).json()["runs"] if r["run_id"] == rid)
    if desktop:
        assert row["ran_on"] == {"subscriptions": ["claude"], "all": True}
    else:
        assert "ran_on" not in row
