"""Revamp Domains ⋯ menu (DM-13…DM-17, DM-86): Rename under the name rule, Duplicate settings, and
Delete that tidies the steps and agents that used the domain. Every route is owner-scoped."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentNode, DomainDocument, TeamGraph


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-menu-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _domain(c: TestClient, name: str, template: str = "support") -> str:
    resp = c.post("/api/domains", json={"name": name, "template": template})
    assert resp.status_code == 200, resp.text
    return resp.json()["domain_id"]


def _team(owner: uuid.UUID, *, library: bool = True) -> uuid.UUID:
    with session_scope() as s:
        t = TeamGraph(name="Docs team", is_library=library, owner_id=owner)
        s.add(t)
        s.flush()
        return t.id


def _node(team: uuid.UUID, kind: str, *, config=None, tool_config=None) -> uuid.UUID:
    with session_scope() as s:
        n = AgentNode(
            team_graph_id=team,
            role_name=kind,
            kind=kind,
            config=config,
            tool_config=tool_config,
            position={},
        )
        s.add(n)
        s.flush()
        return n.id


def _node_row(node_id: uuid.UUID) -> tuple[dict | None, dict | None]:
    with session_scope() as s:
        n = s.get(AgentNode, node_id)
        assert n is not None
        return n.config, n.tool_config


# ---- Rename (DM-14) ----


def test_rename_trims_and_saves():
    c, _ = _fresh()
    did = _domain(c, "Q3 filings", "financial")
    resp = c.patch(f"/api/domains/{did}", json={"name": "  Q3 2026 filings  "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Q3 2026 filings"
    assert c.get(f"/api/domains/{did}").json()["name"] == "Q3 2026 filings"


def test_rename_to_another_domains_name_is_409_ignoring_case():
    c, _ = _fresh()
    _domain(c, "Support docs")
    did = _domain(c, "Vendor contracts", "legal")
    resp = c.patch(f"/api/domains/{did}", json={"name": "support DOCS"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "You already have a domain named “support DOCS”."
    assert c.get(f"/api/domains/{did}").json()["name"] == "Vendor contracts"


def test_rename_to_its_own_name_in_another_case_is_fine():
    c, _ = _fresh()
    did = _domain(c, "Support docs")
    resp = c.patch(f"/api/domains/{did}", json={"name": "Support Docs"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Support Docs"


def test_rename_empty_or_long_is_422_with_the_copy():
    c, _ = _fresh()
    did = _domain(c, "Support docs")
    empty = c.patch(f"/api/domains/{did}", json={"name": "   "})
    assert empty.status_code == 422
    assert empty.json()["detail"] == "Give this domain a name."
    long = c.patch(f"/api/domains/{did}", json={"name": "x" * 121})
    assert long.status_code == 422
    assert long.json()["detail"] == "Use 120 characters or fewer."


def test_rename_is_owner_scoped():
    a, _ = _fresh()
    b, _ = _fresh()
    did = _domain(a, "Support docs")
    assert b.patch(f"/api/domains/{did}", json={"name": "Mine"}).status_code == 404
    # The other account's names never clash with yours.
    _domain(b, "Vendor contracts")
    assert a.patch(f"/api/domains/{did}", json={"name": "Vendor contracts"}).status_code == 200


# ---- Duplicate settings (DM-16) ----


def test_duplicate_copies_template_and_settings_but_no_files():
    c, _ = _fresh()
    did = _domain(c, "Support docs")
    cfg = c.get(f"/api/domains/{did}").json()["config"]
    cfg["retrieval"] = {**cfg["retrieval"], "top_k": 9}
    assert c.patch(f"/api/domains/{did}", json={"config": cfg}).status_code == 200
    with session_scope() as s:
        s.add(
            DomainDocument(
                domain_id=uuid.UUID(did),
                filename="refund-policy.md",
                content_type="text/markdown",
                storage_path=f"x/{uuid.uuid4().hex}",
                byte_size=100,
                ingest_status="ready",
            )
        )

    resp = c.post(f"/api/domains/{did}/duplicate")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Support docs copy"
    assert body["domain_id"] != did
    assert body["template"] == "support"
    assert body["config"]["retrieval"]["top_k"] == 9
    assert body["config"] == c.get(f"/api/domains/{did}").json()["config"]
    assert body["files"]["total"] == 0
    assert body["state"] == "empty"
    assert body["doc_count"] == 0


def test_duplicate_numbers_the_copies():
    c, _ = _fresh()
    did = _domain(c, "Support docs")
    names = [c.post(f"/api/domains/{did}/duplicate").json()["name"] for _ in range(3)]
    assert names == ["Support docs copy", "Support docs copy 2", "Support docs copy 3"]


def test_duplicate_keeps_a_long_name_within_the_limit():
    c, _ = _fresh()
    did = _domain(c, "n" * 120)
    first = c.post(f"/api/domains/{did}/duplicate").json()["name"]
    second = c.post(f"/api/domains/{did}/duplicate").json()["name"]
    assert first == "n" * 115 + " copy"
    assert second == "n" * 113 + " copy 2"


def test_duplicate_with_a_name_follows_the_name_rule():
    c, _ = _fresh()
    did = _domain(c, "Support docs")
    _domain(c, "Vendor contracts", "legal")
    ok = c.post(f"/api/domains/{did}/duplicate", json={"name": "  Help centre  "})
    assert ok.status_code == 201
    assert ok.json()["name"] == "Help centre"
    clash = c.post(f"/api/domains/{did}/duplicate", json={"name": "vendor contracts"})
    assert clash.status_code == 409
    assert clash.json()["detail"] == "You already have a domain named “vendor contracts”."
    empty = c.post(f"/api/domains/{did}/duplicate", json={"name": " "})
    assert empty.status_code == 422
    assert empty.json()["detail"] == "Give this domain a name."


def test_duplicate_is_owner_scoped():
    a, _ = _fresh()
    b, _ = _fresh()
    did = _domain(a, "Support docs")
    resp = b.post(f"/api/domains/{did}/duplicate")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "domain not found"
    assert b.get("/api/domains").json()["domains"] == []
    assert a.post("/api/domains/not-a-uuid/duplicate").status_code == 400


# ---- Delete tidies references (DM-15, OQ-14) ----


def test_delete_clears_steps_and_agent_lists_that_used_it():
    c, owner = _fresh()
    vendor = _domain(c, "Vendor contracts", "legal")
    support = _domain(c, "Support docs")
    team = _team(owner)
    step = _node(team, "domain_query", config={"domain_id": vendor, "prompt": "Which clause?"})
    other_step = _node(team, "domain_query", config={"domain_id": support, "prompt": "Refunds?"})
    listed = _node(team, "agent", tool_config={"tvashtr": {"domains": [vendor, support]}})
    only = _node(team, "completion", tool_config={"tvashtr": {"domains": [vendor]}})
    legacy = _node(team, "agent", tool_config={"tvashtr": {"domains": True}})

    resp = c.delete(f"/api/domains/{vendor}")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "domain_id": vendor,
        "deleted": True,
        "steps_cleared": 1,
        "agents_cleared": 2,
    }
    assert _node_row(step)[0] == {"domain_id": None, "prompt": "Which clause?"}
    assert _node_row(other_step)[0] == {"domain_id": support, "prompt": "Refunds?"}
    assert _node_row(listed)[1] == {"tvashtr": {"domains": [support]}}
    assert _node_row(only)[1] == {"tvashtr": {"domains": []}}
    # The legacy "all domains" switch is untouched: those agents simply lose this one.
    assert _node_row(legacy)[1] == {"tvashtr": {"domains": True}}


def test_delete_leaves_run_snapshots_and_other_accounts_alone():
    c, owner = _fresh()
    other, other_owner = _fresh()
    vendor = _domain(c, "Vendor contracts", "legal")
    snapshot = _node(_team(owner, library=False), "domain_query", config={"domain_id": vendor})
    foreign = _node(_team(other_owner), "domain_query", config={"domain_id": vendor})

    resp = other.delete(f"/api/domains/{vendor}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "domain not found"
    assert _node_row(foreign)[0] == {"domain_id": vendor}

    body = c.delete(f"/api/domains/{vendor}").json()
    assert body["steps_cleared"] == 0 and body["agents_cleared"] == 0
    # A past run's snapshot keeps what it ran with.
    assert _node_row(snapshot)[0] == {"domain_id": vendor}
    assert _node_row(foreign)[0] == {"domain_id": vendor}
