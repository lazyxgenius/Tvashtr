"""B-TOOLKIT — Toolkit › Skills: usage/updated_at on every skill, create-only POST with name and
source rules (``?on_conflict=replace`` kept for presets), partial PATCH with 409 on a clash, DELETE
strips refs, duplicate, and turning a skill on for chosen agents."""

import uuid

from toolkit_helpers import fresh_account, make_node, make_team, node_row

from tvashtr.control_plane import node_library

INLINE = {"type": "inline", "name": "house-style", "content": "Use tabs.", "mode": "always"}


def _ref(sid, **extra) -> dict:
    return {"type": "library", "id": str(sid), **extra}


def test_list_and_detail_carry_usage_and_updated_at():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(owner, "house-style", INLINE)
    team = make_team(owner, "Indicator sprint team")
    rev = make_node(team, "Reviewer", kind="completion", skills=[_ref(sid)])
    make_node(team, "Engineer", x=5, skills=[_ref(sid, mode="agent")])
    make_node(make_team(None, "clone", library=False), "Reviewer", skills=[_ref(sid)])

    item = c.get("/api/skill-library").json()["skills"][0]
    assert item["usage"] == {"agents": 2, "teams": 1}
    assert item["updated_at"] and item["source"] == INLINE
    detail = c.get(f"/api/skill-library/{sid}").json()
    assert detail["used_by"][0] == {
        "node_id": str(rev),
        "role_name": "Reviewer",
        "title": None,
        "team_id": str(team),
        "team_name": "Indicator sprint team",
    }
    other_c, _ = fresh_account()
    assert other_c.get(f"/api/skill-library/{sid}").status_code == 404


def test_post_is_create_only_and_replace_is_opt_in():
    c, _ = fresh_account()
    resp = c.post("/api/skill-library", json={"name": "house-style", "source": INLINE})
    assert resp.status_code == 200, resp.text
    first = resp.json()
    assert first["usage"] == {"agents": 0, "teams": 0} and first["source"] == INLINE
    other = {**INLINE, "content": "Use spaces."}
    clash = c.post("/api/skill-library", json={"name": "house-style", "source": other})
    assert clash.status_code == 409
    assert clash.json()["detail"] == "You already have a skill called house-style."
    replaced = c.post(
        "/api/skill-library?on_conflict=replace", json={"name": "house-style", "source": other}
    )
    assert replaced.status_code == 200
    assert replaced.json()["id"] == first["id"]
    assert replaced.json()["source"]["content"] == "Use spaces."
    bad = c.post("/api/skill-library?on_conflict=merge", json={"name": "x", "source": INLINE})
    assert bad.status_code == 422


def test_post_validates_name_and_source():
    c, _ = fresh_account()
    rule = "Use lowercase letters, numbers and single hyphens, like house-style."
    cases = [
        ("House Style", INLINE, rule),
        ("house--style", INLINE, rule),
        ("a" * 65, INLINE, rule),
        ("", INLINE, "A skill name is required."),
        ("ok", {"type": "inline", "content": "  "}, "Add the SKILL.md content."),
        ("ok", {**INLINE, "mode": "sometimes"}, "Pick how the skill loads: always, trigger or agent."),  # noqa: E501
        ("ok", {**INLINE, "mode": "trigger", "triggers": [" ", ""]}, "Add at least one trigger word."),  # noqa: E501
        ("ok", {"type": "repo", "url": "https://gitlab.com/a/b"}, "Use a GitHub repo URL, like https://github.com/org/skills."),  # noqa: E501
        ("ok", {"type": "repo", "url": "a/b", "resolved_sha": "abc"}, "resolved_sha must be a full 40-character commit SHA."),  # noqa: E501
        ("ok", {"type": "library", "id": str(uuid.uuid4())}, "A skill source must be inline, repo, or project_rules."),  # noqa: E501
    ]  # fmt: skip
    for name, source, detail in cases:
        resp = c.post("/api/skill-library", json={"name": name, "source": source})
        assert resp.status_code == 422, (name, source)
        assert resp.json()["detail"] == detail, (name, source)


def test_post_normalises_sources():
    c, _ = fresh_account()
    inline = c.post(
        "/api/skill-library",
        json={
            "name": "api-conventions",
            "source": {"type": "inline", "content": "C", "mode": "trigger", "triggers": "a, b ,"},
        },
    ).json()["source"]
    assert inline == {
        "type": "inline",
        "content": "C",
        "name": "api-conventions",
        "mode": "trigger",
        "triggers": ["a", "b"],
    }
    assert (
        c.post(
            "/api/skill-library",
            json={"name": "plain", "source": {"type": "inline", "content": "C"}},
        ).json()["source"]["mode"]
        == "always"
    )
    repo = c.post(
        "/api/skill-library",
        json={
            "name": "bundle",
            "source": {
                "type": "repo",
                "url": "github.com/org/skills.git",
                "filter": "review-* ,pytest-*",
                "mode": "agent",
                "resolved_sha": "a" * 40,
            },
        },
    ).json()["source"]
    assert repo == {
        "type": "repo",
        "url": "https://github.com/org/skills",
        "ref": "main",
        "filter": "review-*, pytest-*",
        "mode": "agent",
        "resolved_sha": "a" * 40,
    }


def test_patch_partial_rename_and_clash():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(owner, "house-style", INLINE)
    node_library.create_owner_skill(owner, "yagni", {**INLINE, "name": "yagni"})
    clash = c.patch(f"/api/skill-library/{sid}", json={"name": "yagni"})
    assert clash.status_code == 409  # was an unhandled unique-key 500
    assert clash.json()["detail"] == "You already have a skill called yagni."
    renamed = c.patch(f"/api/skill-library/{sid}", json={"name": "house-style-py"}).json()
    assert renamed["name"] == "house-style-py"
    assert renamed["source"]["name"] == "house-style-py"  # the inline name follows the row
    edited = c.patch(
        f"/api/skill-library/{sid}",
        json={"source": {**INLINE, "name": "house-style-py", "mode": "agent"}},
    ).json()
    assert edited["name"] == "house-style-py" and edited["source"]["mode"] == "agent"
    assert c.patch(f"/api/skill-library/{sid}", json={"name": "Bad Name"}).status_code == 422
    other_c, _ = fresh_account()
    assert other_c.patch(f"/api/skill-library/{sid}", json={"name": "x"}).status_code == 404


def test_delete_strips_refs_from_every_agent():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(owner, "house-style", INLINE)
    keep = node_library.create_owner_skill(owner, "yagni", {**INLINE, "name": "yagni"})
    team = make_team(owner, "T")
    both = make_node(team, "Engineer", skills=[_ref(sid, mode="agent"), _ref(keep)])
    only = make_node(team, "Reviewer", skills=[_ref(sid)])
    clone = make_node(make_team(None, "clone", library=False), "E", skills=[_ref(sid)])
    resp = c.delete(f"/api/skill-library/{sid}")
    assert resp.status_code == 200 and resp.json() == {"removed_from_agents": 2}
    assert node_row(both).skills == [_ref(keep)]
    assert node_row(only).skills is None
    assert node_row(clone).skills == [_ref(sid)]  # run history is never rewritten
    assert c.delete(f"/api/skill-library/{sid}").json() == {"removed_from_agents": 0}


def test_duplicate_renames_the_copy_and_its_inline_name():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(owner, "house-style", INLINE)
    make_node(make_team(owner, "T"), "Engineer", skills=[_ref(sid)])
    first = c.post(f"/api/skill-library/{sid}/duplicate")
    assert first.status_code == 201, first.text
    assert first.json()["name"] == "house-style-copy"
    assert first.json()["source"]["name"] == "house-style-copy"
    assert first.json()["usage"] == {"agents": 0, "teams": 0}
    assert c.post(f"/api/skill-library/{sid}/duplicate").json()["name"] == "house-style-copy-2"


def test_agents_get_and_put():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(owner, "house-style", INLINE)
    t1, t2 = make_team(owner, "One"), make_team(owner, "Two")
    kept = make_node(t1, "Reviewer", skills=[_ref(sid, mode="trigger", triggers=["auth"])])
    dropped = make_node(t1, "Engineer", x=5, skills=[_ref(sid), INLINE])
    added = make_node(t2, "Writer")
    got = c.get(f"/api/skill-library/{sid}/agents").json()
    assert got == c.get(f"/api/agents?skill_id={sid}").json()
    resp = c.put(f"/api/skill-library/{sid}/agents", json={"node_ids": [str(kept), str(added)]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [a["role_name"] for a in body["agents"]] == ["Reviewer", "Writer"]
    assert body["agent_count"] == 2 and body["team_count"] == 2 and body["skipped"] == []
    assert node_row(kept).skills == [_ref(sid, mode="trigger", triggers=["auth"])]
    assert node_row(dropped).skills == [INLINE]
    assert node_row(added).skills == [_ref(sid)]
    theirs = make_node(make_team(fresh_account()[1], "Theirs"), "E")
    assert (
        c.put(f"/api/skill-library/{sid}/agents", json={"node_ids": [str(theirs)]}).status_code
        == 404
    )
