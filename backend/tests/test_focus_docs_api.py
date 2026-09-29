"""F6 Focus view + Documents: the additive API keys the focus view reads."""

import uuid

from conftest import auth_user_id
from sqlalchemy import update
from test_nodes_history_preview import _fresh, _seed_run

from tvashtr.control_plane.node_templates import NODE_TEMPLATES
from tvashtr.control_plane.teams import create_team_from_template
from tvashtr.db import session_scope
from tvashtr.models import Run


def test_node_templates_carry_a_one_sentence_summary(client):
    """B1: the Templates dialog lists a sentence per template; `description` stays the tagline."""
    rows = {t["key"]: t for t in client.get("/api/node-templates").json()["templates"]}
    assert rows["pm"]["summary"] == "Turns your idea into a spec the team can build from."
    assert rows["reviewer"]["summary"] == "Checks the build against the spec and gives a verdict."
    assert rows["reviewer"]["description"] == "Checks against the spec"
    # The Architect writes no document of its own (writes_to is null): it refines the shared spec.
    assert rows["architect"]["writes_to"] is None
    assert "spec" in rows["architect"]["summary"]
    assert "design document" not in rows["architect"]["summary"]
    for row in rows.values():
        assert row["summary"].endswith(".") and row["summary"] != row["description"]


def test_node_template_summary_is_not_seeded_into_a_new_node(client):
    """The summary is list copy only: a preset node's config keeps just title + description."""
    tid = create_team_from_template("two_node", "Summary seed", auth_user_id())
    resp = client.post(
        f"/api/teams/{tid}/nodes", json={"node_kind": "worker", "preset": "reviewer"}
    )
    assert resp.status_code == 200, resp.text
    assert "summary" not in (resp.json().get("config") or {})
    assert all("summary" in t for t in NODE_TEMPLATES)


def test_node_history_runs_carry_the_memory_repo_key(client):
    """B2: Focus-Memory's "This repo" needs the run's memory repo_key (memory.repo_key_for_run)."""
    c, owner_id = _fresh()
    tid = create_team_from_template("review_loop", "Repo key", owner_id)
    nodes = {n["role_name"]: n for n in c.get(f"/api/teams/{tid}/graph").json()["nodes"]}
    url = f"/api/teams/{tid}/nodes/{nodes['reviewer']['id']}/runs"
    _seed_run(owner_id, tid, idea="Greenfield")
    hosted = _seed_run(owner_id, tid, idea="Hosted")
    folder = _seed_run(owner_id, tid, idea="Folder")
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(hosted["run_id"]))
            .values(github_repo="lazyxgenius/trade_mcp", repo_path="/tmp/clones/x")
        )
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(folder["run_id"]))
            .values(local_repo_label="~/code/trade_mcp", repo_path="/tmp/work/y")
        )
    runs = {r["idea"]: r for r in c.get(url).json()["runs"]}
    assert (runs["Hosted"]["repo_key"], runs["Hosted"]["repo_label"]) == (
        "lazyxgenius/trade_mcp",
        "lazyxgenius/trade_mcp",
    )
    assert (runs["Folder"]["repo_key"], runs["Folder"]["repo_label"]) == (
        "~/code/trade_mcp",
        "trade_mcp",
    )
    assert (runs["Greenfield"]["repo_key"], runs["Greenfield"]["repo_label"]) == (None, None)
    # The selected run carries them too, and the route stays owner-scoped.
    run = c.get(url, params={"run_id": hosted["run_id"]}).json()["run"]
    assert run["repo_key"] == "lazyxgenius/trade_mcp"
    other, _other_id = _fresh()
    assert other.get(url).status_code == 404
