"""B-TOOLKIT — Toolkit › Tools: status/usage on every tool, create-only POST with name rules,
partial PATCH (rename carries each agent's switch), DELETE strips refs, duplicate, bulk import,
and turning a tool on for chosen agents across teams."""

import uuid

from toolkit_helpers import fresh_account, make_node, make_team, node_row

from tvashtr.control_plane import node_library
from tvashtr.control_plane.mcp_secrets import set_owner_mcp_secret

LINEAR = {
    "url": "https://mcp.linear.app/sse",
    "headers": {"Authorization": "Bearer ${LINEAR_TOKEN}"},
}
FETCH = {"command": "uvx", "args": ["mcp-server-fetch"]}


def _lib(tool_id, **servers) -> dict:
    meta: dict = {"library": [str(tool_id)]}
    if servers:
        meta["servers"] = servers
    return {"tvashtr": meta}


# ---------------------------------------------------------------- list + detail


def test_list_items_carry_status_secret_refs_and_usage():
    c, owner = fresh_account()
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", "v")
    gh = node_library.create_owner_tool(
        owner, "github", {"url": "https://x", "headers": {"A": "Bearer ${GITHUB_TOKEN}"}}
    )
    node_library.create_owner_tool(owner, "linear", LINEAR)
    t1, t2 = make_team(owner, "One"), make_team(owner, "Two")
    make_node(t1, "Engineer", tool_config=_lib(gh))
    make_node(t1, "Reviewer", kind="completion", tool_config=_lib(gh))
    make_node(t2, "Writer", tool_config=_lib(gh, github={"enabled": False}))  # switched off
    make_node(make_team(None, "clone", library=False), "Engineer", tool_config=_lib(gh))

    tools = {t["name"]: t for t in c.get("/api/tool-library").json()["tools"]}
    github, linear = tools["github"], tools["linear"]
    assert set(github) >= {"id", "name", "server_config", "created_at", "updated_at"}
    assert github["status"] == "ready"
    assert github["secret_refs"] == ["GITHUB_TOKEN"] and github["missing_secrets"] == []
    assert github["used_by"] == {"agent_count": 2, "team_count": 1}
    assert linear["status"] == "needs_attention"
    assert linear["missing_secrets"] == ["LINEAR_TOKEN"]
    assert linear["used_by"] == {"agent_count": 0, "team_count": 0}


def test_get_tool_returns_the_agents_that_use_it_and_is_owner_scoped():
    c, owner = fresh_account()
    gh = node_library.create_owner_tool(owner, "github", {"url": "https://x"})
    team = make_team(owner, "Indicator sprint team")
    eng = make_node(team, "Engineer", tool_config=_lib(gh), config={"title": "Builder"})
    resp = c.get(f"/api/tool-library/{gh}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "github" and body["used_by"] == {"agent_count": 1, "team_count": 1}
    assert body["used_by_agents"] == [
        {
            "node_id": str(eng),
            "role_name": "Engineer",
            "title": "Builder",
            "team_id": str(team),
            "team_name": "Indicator sprint team",
        }
    ]
    other_c, _ = fresh_account()
    assert other_c.get(f"/api/tool-library/{gh}").status_code == 404
    assert c.get(f"/api/tool-library/{uuid.uuid4()}").status_code == 404


# ---------------------------------------------------------------- create-only POST


def test_post_is_create_only_and_returns_the_full_item():
    c, _ = fresh_account()
    resp = c.post("/api/tool-library", json={"name": "linear", "server_config": LINEAR})
    assert resp.status_code == 200, resp.text
    item = resp.json()
    assert item["name"] == "linear" and item["server_config"] == LINEAR
    assert item["status"] == "needs_attention" and item["missing_secrets"] == ["LINEAR_TOKEN"]
    assert item["used_by"] == {"agent_count": 0, "team_count": 0}
    assert item["updated_at"]
    again = c.post("/api/tool-library", json={"name": "linear", "server_config": FETCH})
    assert again.status_code == 409
    assert again.json()["detail"] == "You already have a tool named linear."
    listed = c.get("/api/tool-library").json()["tools"]
    assert [t["server_config"] for t in listed] == [LINEAR]  # the clash overwrote nothing


def test_post_enforces_the_name_rule_and_the_connection_shape():
    c, _ = fresh_account()
    cases = [
        ("My Server", FETCH, "Use lowercase letters, numbers, - and _, like my-server."),
        ("-lead", FETCH, "Use lowercase letters, numbers, - and _, like my-server."),
        ("a" * 65, FETCH, "Use lowercase letters, numbers, - and _, like my-server."),
        ("  ", FETCH, "A tool name is required."),
        ("ok", {}, "Add a command or a URL."),
        ("ok", {"args": ["x"]}, "Add a command or a URL."),
        ("ok", {"command": "uvx", "url": "https://x"}, "Use a command or a URL, not both."),
        ("ok", {"url": "ftp://x"}, "Use an http:// or https:// URL."),
        ("ok", {"command": "uvx", "args": "a b"}, "Arguments must be a list of strings."),
        (
            "ok",
            {"url": "https://x", "headers": ["x"]},
            "Headers must be an object of names and values.",
        ),
    ]
    for name, config, detail in cases:
        resp = c.post("/api/tool-library", json={"name": name, "server_config": config})
        assert resp.status_code == 422, (name, config)
        assert resp.json()["detail"] == detail, (name, config)
    ok = c.post("/api/tool-library", json={"name": "my_server-2", "server_config": FETCH})
    assert ok.status_code == 200


# ---------------------------------------------------------------- PATCH


def test_patch_accepts_a_partial_body_and_returns_the_full_item():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "github", {"url": "https://a"})
    make_node(make_team(owner, "T"), "Engineer", tool_config=_lib(tid))
    resp = c.patch(f"/api/tool-library/{tid}", json={"server_config": {"url": "https://b"}})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "github" and body["server_config"] == {"url": "https://b"}
    assert body["used_by"]["agent_count"] == 1
    resp = c.patch(f"/api/tool-library/{tid}", json={"name": "gh"})
    assert resp.json()["name"] == "gh" and resp.json()["server_config"] == {"url": "https://b"}
    assert c.patch(f"/api/tool-library/{tid}", json={}).json()["name"] == "gh"


def test_patch_rename_carries_each_agents_switch_and_409s_on_a_clash():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "github", {"url": "https://a"})
    node_library.create_owner_tool(owner, "linear", {"url": "https://l"})
    team = make_team(owner, "T")
    off = make_node(team, "Writer", tool_config=_lib(tid, github={"enabled": False}))
    on = make_node(team, "Engineer", tool_config=_lib(tid))

    clash = c.patch(f"/api/tool-library/{tid}", json={"name": "linear"})
    assert clash.status_code == 409
    assert clash.json()["detail"] == "You already have a tool named linear."

    resp = c.patch(f"/api/tool-library/{tid}", json={"name": "github-v2"})
    assert resp.status_code == 200, resp.text
    assert node_row(off).tool_config["tvashtr"]["servers"] == {"github-v2": {"enabled": False}}
    assert node_row(on).tool_config == _lib(tid)
    assert resp.json()["used_by"]["agent_count"] == 1  # the switched-off agent stays off


def test_patch_allows_an_unchanged_legacy_name_but_validates_a_new_one():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "GitHub", {"url": "https://a"})  # pre-rule name
    ok = c.patch(f"/api/tool-library/{tid}", json={"name": "GitHub", "server_config": FETCH})
    assert ok.status_code == 200
    bad = c.patch(f"/api/tool-library/{tid}", json={"name": "Git Hub"})
    assert bad.status_code == 422
    bad_config = c.patch(f"/api/tool-library/{tid}", json={"server_config": {}})
    assert bad_config.status_code == 422
    other_c, _ = fresh_account()
    assert other_c.patch(f"/api/tool-library/{tid}", json={"name": "x"}).status_code == 404


# ---------------------------------------------------------------- DELETE


def test_delete_strips_refs_and_switches_from_every_agent():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "github", {"url": "https://a"})
    keep = node_library.create_owner_tool(owner, "fetch", FETCH)
    team = make_team(owner, "T")
    both = make_node(
        team,
        "Engineer",
        tool_config={
            "mcpServers": {"own": {"command": "x"}},
            "tvashtr": {"library": [str(tid), str(keep)], "domains": True},
        },
    )
    only = make_node(team, "Reviewer", tool_config=_lib(tid))
    off = make_node(team, "Writer", tool_config=_lib(tid, github={"enabled": False}))
    clone = make_node(make_team(None, "clone", library=False), "E", tool_config=_lib(tid))

    resp = c.delete(f"/api/tool-library/{tid}")
    assert resp.status_code == 200
    assert resp.json() == {"removed_from_agents": 2}  # the switched-off Writer wasn't using it
    assert node_row(both).tool_config == {
        "mcpServers": {"own": {"command": "x"}},
        "tvashtr": {"library": [str(keep)], "domains": True},
    }
    assert node_row(only).tool_config is None
    assert node_row(off).tool_config is None
    assert node_row(clone).tool_config == _lib(tid)  # run history is never rewritten
    assert c.delete(f"/api/tool-library/{tid}").json() == {"removed_from_agents": 0}


# ---------------------------------------------------------------- duplicate


def test_duplicate_picks_the_first_free_copy_name():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "github", {"url": "https://a"})
    make_node(make_team(owner, "T"), "Engineer", tool_config=_lib(tid))
    first = c.post(f"/api/tool-library/{tid}/duplicate")
    assert first.status_code == 201, first.text
    assert first.json()["name"] == "github-copy"
    assert first.json()["server_config"] == {"url": "https://a"}
    assert first.json()["used_by"] == {"agent_count": 0, "team_count": 0}
    assert c.post(f"/api/tool-library/{tid}/duplicate").json()["name"] == "github-copy-2"
    other_c, _ = fresh_account()
    assert other_c.post(f"/api/tool-library/{tid}/duplicate").status_code == 404


# ---------------------------------------------------------------- import


def test_import_adds_every_server_in_one_go():
    c, _ = fresh_account()
    resp = c.post(
        "/api/tool-library/import",
        json={"servers": {"linear": LINEAR, "sqlite": {"command": "uvx", "args": ["s"]}}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["conflicts"] == []
    assert [t["name"] for t in body["added"]] == ["linear", "sqlite"]
    assert body["added"][0]["missing_secrets"] == ["LINEAR_TOKEN"]
    assert len(c.get("/api/tool-library").json()["tools"]) == 2


def test_import_conflicts_error_replace_and_rename():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "linear", {"url": "https://old"})
    payload = {"linear": LINEAR, "sqlite": FETCH}

    err = c.post("/api/tool-library/import", json={"servers": payload})
    assert err.status_code == 409
    assert err.json()["detail"] == {
        "code": "name_taken",
        "message": "You already have a tool named linear.",
        "conflicts": ["linear"],
    }
    assert [t["name"] for t in c.get("/api/tool-library").json()["tools"]] == ["linear"]

    rep = c.post("/api/tool-library/import", json={"servers": payload, "on_conflict": "replace"})
    assert rep.status_code == 200, rep.text
    assert rep.json()["conflicts"] == ["linear"]
    replaced = next(t for t in rep.json()["added"] if t["name"] == "linear")
    assert replaced["id"] == str(tid) and replaced["server_config"] == LINEAR

    ren = c.post(
        "/api/tool-library/import", json={"servers": {"linear": FETCH}, "on_conflict": "rename"}
    )
    assert [t["name"] for t in ren.json()["added"]] == ["linear-2"]


def test_import_validates_every_server_before_writing():
    c, _ = fresh_account()
    bad_name = c.post("/api/tool-library/import", json={"servers": {"ok": FETCH, "Bad": FETCH}})
    assert bad_name.status_code == 422
    assert bad_name.json()["detail"]["code"] == "invalid_name"
    assert bad_name.json()["detail"]["server"] == "Bad"
    bad_cfg = c.post("/api/tool-library/import", json={"servers": {"ok": FETCH, "x": {}}})
    assert bad_cfg.json()["detail"] == {
        "code": "invalid_server",
        "server": "x",
        "message": "Add a command or a URL.",
    }
    assert c.get("/api/tool-library").json()["tools"] == []  # nothing written
    empty = c.post("/api/tool-library/import", json={"servers": {}})
    assert empty.status_code == 422 and empty.json()["detail"] == "Paste at least one server."
    mode = c.post("/api/tool-library/import", json={"servers": {"a": FETCH}, "on_conflict": "x"})
    assert mode.status_code == 422


# ---------------------------------------------------------------- PUT agents


def test_put_agents_turns_the_tool_on_and_off_across_teams():
    c, owner = fresh_account()
    tid = node_library.create_owner_tool(owner, "linear", LINEAR)
    t1, t2 = make_team(owner, "Indicator sprint team"), make_team(owner, "Docs team")
    reviewer = make_node(t1, "Reviewer", kind="completion")
    engineer = make_node(t1, "Engineer", tool_config=_lib(tid))  # on now, not in the new set
    writer = make_node(t2, "Writer", tool_config=_lib(tid, linear={"enabled": False}))
    inline = make_node(t2, "Editor", tool_config={"mcpServers": {"linear": {"command": "mine"}}})

    resp = c.put(
        f"/api/tool-library/{tid}/agents",
        json={"node_ids": [str(reviewer), str(writer), str(inline)]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [a["role_name"] for a in body["agents"]] == ["Reviewer", "Writer"]
    assert body["agent_count"] == 2 and body["team_count"] == 2
    assert body["skipped"] == [
        {"node_id": str(inline), "reason": "an inline server named linear overrides it"}
    ]
    assert node_row(reviewer).tool_config == _lib(tid)
    assert node_row(writer).tool_config == _lib(tid)  # its off switch was removed
    assert node_row(engineer).tool_config is None  # unchecking removes the ref
    assert node_row(inline).tool_config == {"mcpServers": {"linear": {"command": "mine"}}}
    assert c.get(f"/api/tool-library/{tid}").json()["used_by"]["agent_count"] == 2

    cleared = c.put(f"/api/tool-library/{tid}/agents", json={"node_ids": []}).json()
    assert cleared["agents"] == [] and node_row(reviewer).tool_config is None


def test_put_agents_is_owner_scoped():
    c, owner = fresh_account()
    other_c, other = fresh_account()
    tid = node_library.create_owner_tool(owner, "linear", LINEAR)
    theirs = make_node(make_team(other, "Theirs"), "Engineer")
    resp = c.put(f"/api/tool-library/{tid}/agents", json={"node_ids": [str(theirs)]})
    assert resp.status_code == 404 and resp.json()["detail"] == "Agent not found."
    assert node_row(theirs).tool_config is None
    assert other_c.put(f"/api/tool-library/{tid}/agents", json={"node_ids": []}).status_code == 404
