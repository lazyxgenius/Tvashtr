"""M-desk-2 — the last Desktop key paths, and copy that tells the truth on the Desktop (brief
``prompts/m-desk-2.md``, E1 E2). Builds on M-desk-routes (``test_desk_routes.py``).

E1: a Desktop save (``desktop_target: true``) runs the changed agents' tests and the set check on
the owner's subscriptions. E2: the estimate reads say where an action would run when the Desktop
asks (``?desktop_target=1``): the subscriptions it routes to and whether EVERY model is on one. The
website (no flag) is unchanged. Offline: no workflow really starts, no LLM is called.
"""

import uuid

import pytest
from home_fixtures import fresh_account
from sqlalchemy import select, update
from test_agent_tests import _create, _tests
from test_compare import _end, _graph, _node, _post, _runs_of
from test_desk_routes import (
    CLAUDE,
    _desk_team,
    _desk_tests_account,
    _desk_versions,
    _events_of,
    _jobs,
    _wait_for,
)
from test_desktop_subscription_launch import _connect_desktop
from test_task_sets import _make_set, _set_runs

from tvashtr.config import get_settings
from tvashtr.control_plane import agent_test_runner
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentTestRun,
    Compare,
    CompareDesktopTarget,
    EngineSubscriptionStatus,
    Run,
)

ALL = {"subscriptions": ["claude", "grok"], "all": True}


def _changed_engineer_with_a_test(tmp_path):
    """A keyless account whose team (Engineer + Reviewer on Claude) has v1, a test on the Engineer
    and the Engineer's instructions changed since: Save as v2 offers to run its test."""
    c, owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "All done"})
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1
    resp = c.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "v2: keep it tiny."})
    assert resp.status_code == 200, resp.text
    assert c.get("/api/providers").json()["providers"] == []
    return c, owner, team, eng, made


def _test_runs(node_id: str) -> list[AgentTestRun]:
    with session_scope() as session:
        rows = (
            session.execute(select(AgentTestRun).where(AgentTestRun.node_id == uuid.UUID(node_id)))
            .scalars()
            .all()
        )
        for r in rows:
            session.expunge(r)
    return rows


def _save_check_team(c) -> tuple[str, dict]:
    """``_desk_team`` (PM on Grok, Engineer + Reviewer on Claude) with v1, a two-task set and the
    Engineer's instructions changed since."""
    team = _desk_team(c, name=f"Save check {uuid.uuid4().hex[:6]}")
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1
    ts = _make_set(c, team)
    eng = _node(c, team, "engineer")
    assert c.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "check me"}).status_code
    return team, ts


# ------------------------------------------------------------------ E1 (g) save with Run tests


def test_g_a_desktop_save_with_run_tests_starts_a_desktop_test_run(tmp_path, monkeypatch):
    """(g) Today the flag is dropped: the save's test run is the website's and its replay fails
    "There’s no key for anthropic". From the Desktop the run is desktop-targeted, its replay is a
    ``test_replay`` job that comes back through the runner routes, and no API key is resolved."""
    c, _owner, team, eng, _made = _changed_engineer_with_a_test(tmp_path)
    _connect_desktop(c, "claude")
    monkeypatch.setattr(get_settings(), "desktop_runner_poll_seconds", 0.05)
    monkeypatch.setattr(agent_test_runner, "_POLL_S", 0.05)
    keys: list = []
    real_key = agent_test_runner.resolve_owner_api_key
    monkeypatch.setattr(
        agent_test_runner,
        "resolve_owner_api_key",
        lambda owner, model: keys.append(model) or real_key(owner, model),
    )

    saved = c.post(f"/api/teams/{team}/versions", json={"run_tests": True, "desktop_target": True})
    assert saved.status_code == 201, saved.text
    assert saved.json()["number"] == 2
    assert [s["node_id"] for s in saved.json()["tests_started"]] == [eng["id"]]
    [run] = _test_runs(eng["id"])
    assert (run.trigger, run.version_number, run.desktop_target) == ("save", 2, True)

    result_id = _tests(c, team, eng["id"])["run"]["results"][0]["id"]
    job = _wait_for(lambda: _jobs(run_id=result_id), "the replay's Desktop job")[0]
    assert (job.purpose, job.provider, job.model) == ("test_replay", "claude", CLAUDE)
    claimed = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert claimed["id"] == str(job.id)
    done = c.post(
        f"/api/desktop-runner/jobs/{job.id}/result",
        json={"status": "completed", "final_text": "All done", "patch": ""},
    )
    assert done.status_code == 200, done.text
    finished = _wait_for(
        lambda: (r := _tests(c, team, eng["id"])["run"])["status"] == "done" and r,
        "the save's test run to finish",
    )
    assert [(r["status"], r["answer"]) for r in finished["results"]] == [("passed", "All done")]
    assert keys == []  # no API key was resolved for the Desktop replay
    assert _events_of(result_id) == 0


# ---------------------------------------------------------------- E1 (h) Save and check


def test_h_a_desktop_save_and_check_creates_a_desktop_compare(client, monkeypatch):
    """(h) Today the flag is dropped: the set check is the website's, refused for a keyless account
    ("check_error"). From the Desktop the compare is stored as a Desktop compare (its
    ``compare_desktop_targets`` row) and each run carries ``desktop_target`` + its subscriptions."""
    from dbos import DBOS

    c, _owner = fresh_account("desk2-check")
    team, ts = _save_check_team(c)
    _connect_desktop(c, "claude", "grok")
    assert c.get("/api/providers").json()["providers"] == []
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # self-hosted: every task at once
    monkeypatch.setattr(DBOS, "start_workflow", lambda *a, **k: None)

    resp = c.post(
        f"/api/teams/{team}/versions", json={"check_set": ts["id"], "desktop_target": True}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["number"] == 2 and body["check_error"] is None, body
    cid = body["check_started"]["compare_id"]
    try:
        with session_scope() as session:
            cmp = session.get(Compare, uuid.UUID(cid))
            assert (cmp.version_a, cmp.version_b, cmp.task_set_id) == (1, 2, uuid.UUID(ts["id"]))
            assert session.get(CompareDesktopTarget, cmp.id) is not None
        runs = _set_runs(cid)
        assert len(runs) == 4
        assert {(r.desktop_target, tuple(r.desktop_subscriptions)) for r in runs} == {
            (True, ("claude", "grok"))
        }
    finally:
        _end(_set_runs(cid))
        c.post(f"/api/compares/{cid}/stop")


# ---------------------------------------------------- E1 (i) the website's saves are unchanged


def test_i_a_website_save_with_run_tests_keeps_the_key_path(tmp_path, monkeypatch):
    c, _owner, team, eng, _made = _changed_engineer_with_a_test(tmp_path)
    _connect_desktop(c, "claude")  # a fresh Desktop changes nothing for a website save
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: target(*a))
    saved = c.post(f"/api/teams/{team}/versions", json={"run_tests": True})  # no flag: website
    assert saved.status_code == 201, saved.text
    [run] = _test_runs(eng["id"])
    assert run.desktop_target is None
    result = _tests(c, team, eng["id"])["run"]["results"][0]
    assert result["status"] == "failed"
    assert result["error"].startswith("There’s no key for anthropic on your account.")
    assert _jobs(run_id=result["id"]) == []


def test_i_a_website_save_and_check_keeps_the_key_path(client, monkeypatch):
    from dbos import DBOS

    c, _owner = fresh_account("web2-check")
    team, ts = _save_check_team(c)
    _connect_desktop(c, "claude", "grok")
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    started: list = []
    monkeypatch.setattr(DBOS, "start_workflow", lambda *a, **k: started.append(a))
    resp = c.post(f"/api/teams/{team}/versions", json={"check_set": ts["id"]})  # no flag: website
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["number"] == 2 and body["check_started"] is None
    assert body["check_error"] == (  # today's website refusal, word for word
        "Hosted runs need an API key for: anthropic, xai — needed by engineer, pm, reviewer. Your "
        "subscription covers local Desktop runs — add a key or run locally on Desktop."
    )
    assert started == []
    with session_scope() as session:
        assert (
            session.execute(select(Compare).where(Compare.team_graph_id == uuid.UUID(team))).first()
            is None
        )


# ------------------------------------------- E2 (j) the estimate reads say where it would run


def test_j_the_tests_tab_says_where_a_desktop_replay_runs(tmp_path):
    c, _owner, team, made = _desk_tests_account(tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_say", "value": "x"})
    base = f"/api/teams/{team}/nodes/{eng['id']}/tests"
    round_ = f"{base}/from-round?invocation_id={made['ids']['eng2']}"

    website = c.get(base).json()
    assert "desktop" not in website  # the website's read is unchanged
    assert "desktop" not in c.get(round_).json()
    # The Desktop asks, but no Desktop is fresh: the replay would need a key.
    assert c.get(f"{base}?desktop_target=1").json()["desktop"] == {
        "subscriptions": [],
        "all": False,
    }
    _connect_desktop(c, "claude")
    desk = c.get(f"{base}?desktop_target=1").json()
    assert desk["desktop"] == {"subscriptions": ["claude"], "all": True}
    assert {k: v for k, v in desk.items() if k != "desktop"} == {
        k: v for k, v in c.get(base).json().items()
    }
    assert c.get(f"{round_}&desktop_target=1").json()["desktop"] == {
        "subscriptions": ["claude"],
        "all": True,
    }


def test_j_the_save_offer_says_where_the_changed_agents_tests_run(tmp_path):
    c, _owner, team, eng, _made = _changed_engineer_with_a_test(tmp_path)
    url = f"/api/teams/{team}/versions"
    assert "desktop" not in c.get(url).json()["tests"]  # website: unchanged
    _connect_desktop(c, "claude")
    offer = c.get(f"{url}?desktop_target=1").json()["tests"]
    assert offer["agents"] == [{"node_id": eng["id"], "name": "Engineer", "count": 1}]
    assert offer["desktop"] == {"subscriptions": ["claude"], "all": True}
    # Another changed agent with a test on a model no subscription covers: mixed, so not "all".
    rev = _node(c, team, "reviewer")
    patch = {"model": "openai/gpt-4.1", "prompt": "stricter"}
    assert c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json=patch).status_code == 200
    _create(c, team, rev["id"], _made["ids"]["rev2"], {"kind": "must_say", "value": "Approved"})
    mixed = c.get(f"{url}?desktop_target=1").json()["tests"]
    assert {a["name"] for a in mixed["agents"]} == {"Engineer", "Reviewer"}
    assert mixed["desktop"] == {"subscriptions": ["claude"], "all": False}


def test_j_the_compare_tab_says_where_each_version_runs(client):
    c, _owner = fresh_account("desk2-start")
    team = _desk_versions(c)
    url = f"/api/teams/{team}/compare"
    assert all("desktop" not in v for v in c.get(url).json()["versions"])  # website: unchanged
    _connect_desktop(c, "claude", "grok")
    versions = c.get(f"{url}?desktop_target=1").json()["versions"]
    assert [(v["number"], v["desktop"]) for v in versions] == [(2, ALL), (1, ALL)]
    # Only Claude fresh: the PM (Grok) would need a key, so neither version is all on one.
    _connect_desktop(c, "claude")
    with session_scope() as session:
        session.execute(
            update(EngineSubscriptionStatus)
            .where(
                EngineSubscriptionStatus.owner_id == _owner,
                EngineSubscriptionStatus.provider == "grok",
            )
            .values(connected=False)
        )
    versions = c.get(f"{url}?desktop_target=1").json()["versions"]
    assert {v["number"]: v["desktop"] for v in versions} == {
        1: {"subscriptions": ["claude"], "all": False},
        2: {"subscriptions": ["claude"], "all": False},
    }


@pytest.mark.parametrize("desktop", [True, False])
def test_j_compare_results_say_when_the_lanes_took_turns(client, monkeypatch, desktop):
    """A finished Desktop compare whose lanes share a subscription says so (``shared``); a website
    compare's results are unchanged (no such key)."""
    c, _owner = fresh_account(f"desk2-shared-{desktop}")
    team = _desk_versions(c)
    if desktop:
        _connect_desktop(c, "claude", "grok")
    else:
        for provider in ("anthropic", "xai"):
            c.post("/api/providers", json={"provider": provider, "api_key": f"sk-{provider}"})
    body = {"desktop_target": True} if desktop else {}
    resp, _started, _waiters = _post(c, team, monkeypatch, **body)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    with session_scope() as session:
        session.execute(update(Run).where(Run.pair_id == uuid.UUID(cid)).values(status="completed"))
    results = c.get(f"/api/compares/{cid}").json()["results"]
    if desktop:
        assert results["shared"] is True
    else:
        assert "shared" not in results
    _end(_runs_of(cid))


def test_j_a_desktop_compare_whose_lanes_share_no_subscription_is_not_shared(client, monkeypatch):
    c, _owner = fresh_account("desk2-noshare")
    team = _desk_team(c)
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1: Claude + Grok
    c.post("/api/providers", json={"provider": "openai", "api_key": "sk-openai"})
    for n in _graph(c, team)["nodes"]:
        if n.get("model"):
            c.patch(f"/api/teams/{team}/nodes/{n['id']}", json={"model": "openai/gpt-4.1"})
    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v2: OpenAI key
    _connect_desktop(c, "claude", "grok")
    resp, _started, _waiters = _post(c, team, monkeypatch, desktop_target=True)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    with session_scope() as session:
        session.execute(update(Run).where(Run.pair_id == uuid.UUID(cid)).values(status="completed"))
    assert "shared" not in c.get(f"/api/compares/{cid}").json()["results"]
    versions = c.get(f"/api/teams/{team}/compare?desktop_target=1").json()["versions"]
    assert {v["number"]: v["desktop"] for v in versions} == {
        1: ALL,
        2: {"subscriptions": [], "all": False},
    }
    _end(_runs_of(cid))
