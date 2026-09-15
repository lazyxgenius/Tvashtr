"""Phase 4a — create/patch domain_query canvas nodes."""

import uuid


def _team(client) -> str:
    resp = client.post(
        "/api/teams",
        json={"template": "blank", "name": f"dq-{uuid.uuid4().hex[:8]}"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["team_graph_id"]


def _make_domain(client, *, name: str = "Support docs", template: str = "support") -> str:
    r = client.post("/api/domains", json={"name": name, "template": template})
    assert r.status_code == 200, r.text
    return r.json()["domain_id"]


def test_create_domain_query_node(client):
    tid = _team(client)
    did = _make_domain(client, name="Support", template="support")
    resp = client.post(
        f"/api/teams/{tid}/nodes",
        json={
            "node_kind": "domain_query",
            "domain_id": did,
            "prompt": "Answer using the corpus: {idea}",
            "position": {"x": 100, "y": 40},
        },
    )
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["kind"] == "domain_query"
    assert node["role_name"] == "domain_query"
    assert node["model"] is None
    assert node["engine"] is None
    assert node["edits_allowed"] is False
    assert node["prompt"] == "Answer using the corpus: {idea}"
    assert node["config"]["domain_id"] == did


def test_create_domain_query_defaults_prompt_and_null_domain(client):
    tid = _team(client)
    resp = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"})
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["kind"] == "domain_query"
    assert node["prompt"] == "{idea}"
    assert node["config"]["domain_id"] is None


def test_patch_domain_query_domain_and_prompt(client):
    tid = _team(client)
    did = _make_domain(client, name="Legal", template="legal")
    created = client.post(
        f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}
    ).json()
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{created['id']}",
        json={"domain_id": did, "prompt": "Cite sources for: {idea}"},
    )
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["config"]["domain_id"] == did
    assert node["prompt"] == "Cite sources for: {idea}"


def test_create_rejects_unknown_node_kind(client):
    tid = _team(client)
    resp = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "mcp_tool"})
    assert resp.status_code == 422
