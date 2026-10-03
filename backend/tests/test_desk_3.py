"""M-desk-3 — the last Desktop strings on the save-and-check and task-set screens (brief
``prompts/m-desk-3.md``, G1 G2). Builds on M-desk-2 (``test_desk_2.py``).

G1: asked from the Desktop (``?desktop_target=1``), each set the Save-as dialog offers says where
its check would run — routed over the models of BOTH versions the check compares (the current
version and the new one, the team's graph now), as a Desktop compare's launch routes them. G2: a
Desktop set compare whose lanes shared a subscription says so on its results (``shared``). The
website (no flag) is unchanged. Offline: no workflow really starts, no LLM is called.
"""

import uuid

import pytest
from home_fixtures import fresh_account
from sqlalchemy import update
from test_compare import _end, _graph, _node
from test_desk_2 import ALL, _save_check_team
from test_desk_routes import CLAUDE, _desk_team, _desk_versions
from test_desktop_subscription_launch import _connect_desktop
from test_task_sets import _make_set, _set_runs, _starts

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import EngineSubscriptionStatus, Run

NONE = {"subscriptions": [], "all": False}
MIXED = {"subscriptions": ["claude", "grok"], "all": False}


def _offered(c, team: str, desktop: bool = True) -> list[dict]:
    url = f"/api/teams/{team}/versions" + ("?desktop_target=1" if desktop else "")
    resp = c.get(url)
    assert resp.status_code == 200, resp.text
    return resp.json()["check_sets"]


# ------------------------------------------- G1 (k) the save offer says where each check runs


def test_k_each_offered_set_says_where_its_check_runs(client):
    c, owner = fresh_account("desk3-offer")
    team, _ts = _save_check_team(c)  # v1 (PM on Grok, Engineer + Reviewer on Claude), a set
    _make_set(c, team, name="Bugfixes")
    website = _offered(c, team, desktop=False)
    assert [s["name"] for s in website] == ["Bugfixes", "Indicators"]
    assert all("desktop" not in s for s in website)  # the website's read is unchanged

    # The Desktop asks, but no Desktop is fresh: both checks would need keys.
    assert [s["desktop"] for s in _offered(c, team)] == [NONE, NONE]
    _connect_desktop(c, "claude", "grok")
    desk = _offered(c, team)
    assert [s["desktop"] for s in desk] == [ALL, ALL]
    assert [{k: v for k, v in s.items() if k != "desktop"} for s in desk] == website

    # Only Claude fresh: the PM (Grok) would need a key, so the check is not all on one.
    with session_scope() as session:
        session.execute(
            update(EngineSubscriptionStatus)
            .where(
                EngineSubscriptionStatus.owner_id == owner,
                EngineSubscriptionStatus.provider == "grok",
            )
            .values(connected=False)
        )
    assert [s["desktop"] for s in _offered(c, team)] == [
        {"subscriptions": ["claude"], "all": False}
    ] * 2


def test_k_the_check_is_routed_over_both_versions_models(client):
    """The new version (the graph now) and the current one both count: a model on a key in
    either makes the check mixed."""
    c, _owner = fresh_account("desk3-both")
    team, _ts = _save_check_team(c)
    _connect_desktop(c, "claude", "grok")
    assert [s["desktop"] for s in _offered(c, team)] == [ALL]
    rev = _node(c, team, "reviewer")
    assert c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"model": "openai/gpt-4.1"})
    assert [s["desktop"] for s in _offered(c, team)] == [MIXED]  # the new version: a key

    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v2 keeps it
    resp = c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"model": CLAUDE})
    assert resp.status_code == 200, resp.text
    assert [s["desktop"] for s in _offered(c, team)] == [MIXED]  # the current version: a key
    assert all("desktop" not in s for s in _offered(c, team, desktop=False))


# ---------------------------------------- G2 (l) set results say when the lanes took turns


def _finished_set_compare(c, team: str, monkeypatch, **body) -> tuple[str, dict]:
    ts = _make_set(c, team)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # self-hosted: every task at once
    resp, _calls, _waiters = _starts(c, team, monkeypatch, task_set_id=ts["id"], **body)
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    with session_scope() as session:
        session.execute(update(Run).where(Run.pair_id == uuid.UUID(cid)).values(status="completed"))
    view = c.get(f"/api/compares/{cid}").json()
    assert view["status"] == "finished" and view["set"]["count"] == 2, view
    return cid, view["results"]


@pytest.mark.parametrize("desktop", [True, False])
def test_l_set_results_say_when_the_lanes_took_turns(client, monkeypatch, desktop):
    """A finished Desktop set compare whose lanes share a subscription says so (``shared``); a
    website one's results are unchanged (no such key)."""
    c, _owner = fresh_account(f"desk3-set-{desktop}")
    team = _desk_versions(c)
    if desktop:
        _connect_desktop(c, "claude", "grok")
    else:
        for provider in ("anthropic", "xai"):
            c.post("/api/providers", json={"provider": provider, "api_key": f"sk-{provider}"})
    body = {"desktop_target": True} if desktop else {}
    cid, results = _finished_set_compare(c, team, monkeypatch, **body)
    try:
        assert {(r.desktop_target, bool(r.desktop_subscriptions)) for r in _set_runs(cid)} == {
            (desktop, desktop)
        }
        if desktop:
            assert results["shared"] is True
        else:
            assert "shared" not in results
        assert results["cards"] and results["headline"]  # the rest of the results as before
    finally:
        _end(_set_runs(cid))


def test_l_a_desktop_set_compare_whose_lanes_share_no_subscription_is_not_shared(
    client, monkeypatch
):
    c, _owner = fresh_account("desk3-set-noshare")
    team = _desk_team(c)
    assert c.get(f"/api/teams/{team}/versions").status_code == 200  # v1: Claude + Grok
    c.post("/api/providers", json={"provider": "openai", "api_key": "sk-openai"})
    for n in _graph(c, team)["nodes"]:
        if n.get("model"):
            c.patch(f"/api/teams/{team}/nodes/{n['id']}", json={"model": "openai/gpt-4.1"})
    assert c.post(f"/api/teams/{team}/versions", json={}).status_code == 201  # v2: OpenAI key
    _connect_desktop(c, "claude", "grok")
    cid, results = _finished_set_compare(c, team, monkeypatch, desktop_target=True)
    try:
        assert "shared" not in results
    finally:
        _end(_set_runs(cid))
