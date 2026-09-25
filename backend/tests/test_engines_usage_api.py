"""Revamp (Engines): ``GET /api/engines/usage`` — which teams, agents and domains use each provider.

Rows are inserted directly (not through the team/node endpoints) so the test pins ONLY this
endpoint's scoping and mapping, whatever the create paths do.
"""

import uuid

from fastapi.testclient import TestClient

from tvashtr.control_plane.domains import default_config_for_template
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentNode, Domain, TeamGraph


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"engines-usage-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "engines-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _team(owner_id: uuid.UUID | None, name: str, nodes: list[dict], *, library=True) -> dict:
    """Insert a team + its nodes; returns ``{"id", "nodes": {role_or_key: node_id}}``."""
    ids: dict[str, str] = {}
    with session_scope() as session:
        graph = TeamGraph(name=name, is_library=library, owner_id=owner_id)
        session.add(graph)
        session.flush()
        for spec in nodes:
            node = AgentNode(
                team_graph_id=graph.id,
                role_name=spec["role"],
                kind=spec.get("kind", "agent"),
                model=spec.get("model"),
                config=spec.get("config"),
                prompt="p",
                position={},
            )
            session.add(node)
            session.flush()
            ids[spec.get("key", spec["role"])] = str(node.id)
        return {"id": str(graph.id), "nodes": ids}


def _domain(owner_id: uuid.UUID, name: str, *, embedding=None, generation=None) -> str:
    config = default_config_for_template("blank")
    if embedding is not None:
        config["embedding"]["model"] = embedding
    if generation is not None:
        config["generation"]["model"] = generation
    with session_scope() as session:
        row = Domain(owner_id=owner_id, name=name, template="blank", config=config)
        session.add(row)
        session.flush()
        return str(row.id)


def test_a_fresh_account_uses_nothing():
    c, _ = _fresh()
    resp = c.get("/api/engines/usage")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"teams": [], "domains": [], "by_provider": {}}


def test_usage_requires_a_session(unauth_client):
    assert unauth_client.get("/api/engines/usage").status_code == 401


def test_usage_is_owner_scoped_to_library_teams_and_own_domains():
    c, me = _fresh()
    _, other = _fresh()
    mine = _team(me, "Mine", [{"role": "engineer", "model": "anthropic/claude-sonnet-5"}])
    _team(other, "Theirs", [{"role": "engineer", "model": "xai/grok-4.7"}])
    _team(
        me, "Snapshot", [{"role": "engineer", "model": "groq/openai/gpt-oss-120b"}], library=False
    )
    _team(None, "Clone", [{"role": "engineer", "model": "deepseek/deepseek-chat"}], library=False)
    _domain(other, "Their docs", embedding="gemini/gemini-embedding-001")
    body = c.get("/api/engines/usage").json()
    assert [t["team_id"] for t in body["teams"]] == [mine["id"]]
    assert body["domains"] == []
    assert set(body["by_provider"]) == {"anthropic"}


def test_nodes_carry_model_provider_fallback_and_title():
    c, me = _fresh()
    team = _team(
        me,
        "Indicator sprint team",
        [
            {
                "role": "pm",
                "kind": "completion",
                "model": "xai/grok-4.7",
                "config": {"title": "Product manager"},
            },
            {"role": "prd_gate", "kind": "gate", "config": {"gate_kind": "prd"}},
            {
                "role": "engineer",
                "model": "anthropic/claude-sonnet-5",
                "config": {"fallback_model": "deepseek/deepseek-chat"},
            },
            {"role": "ship", "kind": "terminal", "config": {"terminal_kind": "ship"}},
            {"role": "writer", "kind": "agent", "model": "  "},  # blank: needs a model
        ],
    )
    (listed,) = c.get("/api/engines/usage").json()["teams"]
    assert listed["team_id"] == team["id"] and listed["name"] == "Indicator sprint team"
    by_role = {n["role_name"]: n for n in listed["nodes"]}
    assert set(by_role) == {"pm", "engineer", "writer"}  # gate + terminal carry no model
    assert by_role["pm"] == {
        "node_id": team["nodes"]["pm"],
        "role_name": "pm",
        "title": "Product manager",
        "kind": "completion",
        "model": "xai/grok-4.7",
        "provider": "xai",
        "fallback_model": None,
        "fallback_provider": None,
    }
    assert by_role["engineer"]["provider"] == "anthropic"
    assert by_role["engineer"]["title"] is None
    assert by_role["engineer"]["fallback_model"] == "deepseek/deepseek-chat"
    assert by_role["engineer"]["fallback_provider"] == "deepseek"
    assert by_role["writer"]["model"] is None and by_role["writer"]["provider"] is None


def test_by_provider_groups_roles_and_keeps_fallbacks_apart():
    c, me = _fresh()
    team = _team(
        me,
        "Docs team",
        [
            {"role": "engineer", "key": "e1", "model": "anthropic/claude-sonnet-5"},
            {"role": "engineer", "key": "e2", "model": "Anthropic/claude-sonnet-4"},
            {
                "role": "reviewer",
                "kind": "completion",
                "model": "nvidia_nim/openai/gpt-oss-20b",
                "config": {"fallback_model": "deepseek/deepseek-chat"},
            },
        ],
    )
    other = _team(me, "Second team", [{"role": "writer", "model": "deepseek/deepseek-chat"}])
    by = c.get("/api/engines/usage").json()["by_provider"]
    assert list(by) == sorted(by)
    (anthropic,) = by["anthropic"]["teams"]
    assert anthropic["team_id"] == team["id"] and anthropic["name"] == "Docs team"
    assert anthropic["roles"] == ["engineer"]  # distinct
    assert sorted(anthropic["node_ids"]) == sorted([team["nodes"]["e1"], team["nodes"]["e2"]])
    assert by["anthropic"]["fallback_teams"] == [] and by["anthropic"]["domains"] == []
    # nvidia_nim's model is primary for the reviewer — not "nvidia" or the vendor namespace.
    assert by["nvidia_nim"]["teams"][0]["roles"] == ["reviewer"]
    # deepseek: primary in the second team, fallback-only in the first — never mixed.
    assert by["deepseek"]["teams"] == [
        {
            "team_id": other["id"],
            "name": "Second team",
            "roles": ["writer"],
            "node_ids": [other["nodes"]["writer"]],
        }
    ]
    assert by["deepseek"]["fallback_teams"] == [
        {
            "team_id": team["id"],
            "name": "Docs team",
            "roles": ["reviewer"],
            "node_ids": [team["nodes"]["reviewer"]],
        }
    ]


def test_a_fallback_only_provider_has_no_primary_teams():
    c, me = _fresh()
    _team(
        me,
        "Solo",
        [
            {
                "role": "engineer",
                "model": "openai/gpt-4.1-mini",
                "config": {"fallback_model": "groq/x"},
            }
        ],
    )
    by = c.get("/api/engines/usage").json()["by_provider"]
    assert by["groq"]["teams"] == [] and len(by["groq"]["fallback_teams"]) == 1


def test_domains_report_embedding_and_configured_generation():
    c, me = _fresh()
    default = _domain(me, "Handbook")  # template default: bare text-embedding-3-small, no gen model
    tuned = _domain(
        me,
        "Research",
        embedding="gemini/gemini-embedding-001",
        generation="groq/openai/gpt-oss-120b",
    )
    same = _domain(
        me, "Support", embedding="openai/text-embedding-3-small", generation="openai/gpt-4o-mini"
    )
    body = c.get("/api/engines/usage").json()
    domains = {d["domain_id"]: d for d in body["domains"]}
    assert [d["domain_id"] for d in body["domains"]] == [default, tuned, same]
    assert domains[default] == {
        "domain_id": default,
        "name": "Handbook",
        "embedding_model": "openai/text-embedding-3-small",  # normalized exactly as ingest does
        "embedding_provider": "openai",
        "generation_model": None,  # resolved at ask time from the keys held then
        "generation_provider": None,
    }
    assert domains[tuned]["embedding_provider"] == "gemini"
    assert domains[tuned]["generation_provider"] == "groq"
    by = body["by_provider"]
    assert by["gemini"]["domains"] == [{"domain_id": tuned, "name": "Research", "use": "embedding"}]
    assert by["groq"]["domains"] == [{"domain_id": tuned, "name": "Research", "use": "generation"}]
    assert by["openai"]["domains"] == [
        {"domain_id": default, "name": "Handbook", "use": "embedding"},
        {"domain_id": same, "name": "Support", "use": "embedding"},
        {"domain_id": same, "name": "Support", "use": "generation"},
    ]
    assert by["openai"]["teams"] == [] and by["openai"]["fallback_teams"] == []
