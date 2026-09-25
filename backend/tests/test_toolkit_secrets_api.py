"""B-TOOLKIT — Toolkit › Secrets: the list with usage and a separate ``missing`` list, create-only
POST with the name rule, PUT to replace a value. A value is never returned."""

import datetime as dt

from sqlalchemy import select
from toolkit_helpers import fresh_account

from tvashtr.control_plane import node_library
from tvashtr.control_plane.mcp_secrets import resolve_owner_mcp_secret, set_owner_mcp_secret
from tvashtr.db import session_scope
from tvashtr.models import McpSecret


def _tool(owner, name, *refs):
    headers = {f"H{i}": f"Bearer ${{{r}}}" for i, r in enumerate(refs)}
    return node_library.create_owner_tool(owner, name, {"url": "https://x", "headers": headers})


def test_list_returns_usage_and_missing_names_without_values():
    c, owner = fresh_account()
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", "ghp_value_never_returned")
    set_owner_mcp_secret(owner, "SENTRY_TOKEN", "sentry_value_never_returned")
    gh = _tool(owner, "github", "GITHUB_TOKEN")
    lin = _tool(owner, "linear", "LINEAR_TOKEN")
    jira = _tool(owner, "jira", "LINEAR_TOKEN", "GITHUB_TOKEN")
    node_library.create_owner_tool(owner, "sqlite", {"command": "x", "args": ["${NOT_A_REF}"]})

    resp = c.get("/api/secrets")
    assert resp.status_code == 200, resp.text
    assert "never_returned" not in resp.text
    body = resp.json()
    secrets = {s["name"]: s for s in body["secrets"]}
    assert set(secrets) == {"GITHUB_TOKEN", "SENTRY_TOKEN"}
    assert set(secrets["GITHUB_TOKEN"]) == {"name", "created_at", "updated_at", "used_by_tools"}
    assert secrets["GITHUB_TOKEN"]["used_by_tools"] == [
        {"id": str(gh), "name": "github"},
        {"id": str(jira), "name": "jira"},
    ]
    assert secrets["SENTRY_TOKEN"]["used_by_tools"] == []
    # args are never substituted at run time, so ${NOT_A_REF} is not a secret reference
    assert body["missing"] == [
        {
            "name": "LINEAR_TOKEN",
            "used_by_tools": [
                {"id": str(jira), "name": "jira"},
                {"id": str(lin), "name": "linear"},
            ],
        }
    ]


def test_a_deleted_secret_still_in_use_reappears_as_missing():
    c, owner = fresh_account()
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", "v")
    _tool(owner, "github", "GITHUB_TOKEN")
    assert c.delete("/api/secrets/GITHUB_TOKEN").status_code == 204
    body = c.get("/api/secrets").json()
    assert body["secrets"] == []
    assert [m["name"] for m in body["missing"]] == ["GITHUB_TOKEN"]


def test_post_is_create_only_with_the_name_rule():
    c, owner = fresh_account()
    resp = c.post("/api/secrets", json={"name": "NOTION_TOKEN", "value": "secret-v"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"name", "created_at", "updated_at"}
    assert body["name"] == "NOTION_TOKEN"
    assert "secret-v" not in resp.text

    taken = c.post("/api/secrets", json={"name": "NOTION_TOKEN", "value": "other"})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "NOTION_TOKEN already exists. Use Replace value on it instead."
    assert resolve_owner_mcp_secret(owner, "NOTION_TOKEN") == "secret-v"  # not overwritten

    for name, detail in (
        ("notion-token", "Use capital letters, numbers and _, like NOTION_TOKEN."),
        ("my token!", "Use capital letters, numbers and _, like MY_TOKEN."),
        ("9LIVES", "Use capital letters, numbers and _, like NOTION_TOKEN."),
        ("A" * 129, f"Use capital letters, numbers and _, like {'A' * 128}."),
        ("", "A secret name is required."),
    ):
        resp = c.post("/api/secrets", json={"name": name, "value": "v"})
        assert resp.status_code == 422, name
        assert resp.json()["detail"] == detail, name
    empty = c.post("/api/secrets", json={"name": "OK_NAME", "value": "  "})
    assert empty.status_code == 422 and empty.json()["detail"] == "A secret value is required."
    assert c.post("/api/secrets", json={"name": "_X9", "value": "v"}).status_code == 200


def test_put_replaces_an_existing_value_and_bumps_updated_at():
    c, owner = fresh_account()
    set_owner_mcp_secret(owner, "GITHUB_TOKEN", "old")
    old = dt.datetime(2026, 9, 1, tzinfo=dt.UTC)
    with session_scope() as session:
        row = session.execute(select(McpSecret).where(McpSecret.owner_id == owner)).scalar_one()
        row.created_at = old
    with session_scope() as session:  # a separate UPDATE so onupdate can't bump it back
        session.execute(
            McpSecret.__table__.update().where(McpSecret.owner_id == owner).values(updated_at=old)
        )

    resp = c.put("/api/secrets/GITHUB_TOKEN", json={"value": "new-value"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "GITHUB_TOKEN" and "new-value" not in resp.text
    assert dt.datetime.fromisoformat(body["updated_at"]) > old
    assert dt.datetime.fromisoformat(body["created_at"]) == old
    assert resolve_owner_mcp_secret(owner, "GITHUB_TOKEN") == "new-value"

    missing = c.put("/api/secrets/NOPE", json={"value": "x"})
    assert missing.status_code == 404 and missing.json()["detail"] == "No secret named NOPE."
    assert c.put("/api/secrets/GITHUB_TOKEN", json={"value": ""}).status_code == 422
    other_c, _ = fresh_account()
    assert other_c.put("/api/secrets/GITHUB_TOKEN", json={"value": "x"}).status_code == 404
    assert resolve_owner_mcp_secret(owner, "GITHUB_TOKEN") == "new-value"


def test_legacy_names_still_list_replace_and_delete():
    c, owner = fresh_account()
    set_owner_mcp_secret(owner, "legacy-name", "v")  # stored before the name rule existed
    assert [s["name"] for s in c.get("/api/secrets").json()["secrets"]] == ["legacy-name"]
    assert c.put("/api/secrets/legacy-name", json={"value": "v2"}).status_code == 200
    assert c.delete("/api/secrets/legacy-name").status_code == 204
