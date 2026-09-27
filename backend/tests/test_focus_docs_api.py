"""F6 Focus view + Documents: the additive API keys the focus view reads."""

from conftest import auth_user_id

from tvashtr.control_plane.node_templates import NODE_TEMPLATES
from tvashtr.control_plane.teams import create_team_from_template


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
