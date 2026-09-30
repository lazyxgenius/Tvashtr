"""Connectors: change, check, scope options and disconnect (B1.5): ``PATCH`` and ``DELETE
/api/connectors/{id}``, ``POST …/check``, ``GET …/scope-options`` and ``upstream_target``."""

import json
import uuid
from contextlib import ExitStack

import pytest
from connector_helpers import (
    add_connection,
    connection_row,
    connections_of,
    grant,
    header,
    snapshot_line,
)
from mcp import McpError
from mcp.types import CallToolResult, ErrorData, TextContent, Tool, ToolAnnotations
from toolkit_helpers import fresh_account, make_node, make_team, node_row

from tvashtr.control_plane import connector_oauth, connector_upstream, connectors
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection

pytest_plugins = ["connector_fixtures"]

NOT_FOUND = {"detail": "Connector not found."}
TOOLS = [
    Tool(name="list_things", inputSchema={}, annotations=ToolAnnotations(readOnlyHint=True)),
    Tool(name="create_thing", inputSchema={}),
]
STORED = [{"name": "old_tool", "title": None, "read_only": True}]
KEY_SECRET = {"headers": {"Authorization": "Bearer OLD-KEY"}}
OAUTH_SECRET = {
    "issuer": "https://api.supabase.com",
    "authorization_endpoint": "https://api.supabase.com/v1/oauth/authorize",
    "access_token": "ACCESS-1",
    "refresh_token": "REFRESH-1",
}


def grant_of(tool_config: dict, connection_id: str) -> str | None:
    return connectors.grant_access(tool_config, uuid.UUID(connection_id))


def _refused(resp, status: int, code: str) -> dict:
    assert resp.status_code == status, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == code, detail
    assert isinstance(detail["message"], str) and detail["message"]
    return detail


def _snapshot(connection_id: str) -> dict:
    """Every stored column of the row, to show a refused request left it alone."""
    row = connection_row(connection_id)
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@pytest.fixture
def upstream(monkeypatch):
    """Replace the provider. ``lists`` / ``calls`` record what was asked; ``tools`` / ``result``
    are the answer, or the exception to raise (a list of answers is used one per request)."""

    class Upstream:
        lists: list[tuple] = []
        calls: list[tuple] = []
        tools: object = TOOLS
        result: object = None

    def answer(value):
        if isinstance(value, list) and value and isinstance(value[0], Exception | list):
            value = value.pop(0) if len(value) > 1 else value[0]
        if isinstance(value, Exception):
            raise value
        return value

    def list_tools_sync(url, transport, headers, timeout=10):
        Upstream.lists.append((url, transport, headers))
        return answer(Upstream.tools)

    async def call_tool(url, transport, headers, name, arguments, timeout=120):
        Upstream.calls.append((url, transport, headers, name, arguments))
        return answer(Upstream.result)

    Upstream.lists, Upstream.calls = [], []
    monkeypatch.setattr(connector_upstream, "list_tools_sync", list_tools_sync)
    monkeypatch.setattr(connector_upstream, "call_tool", call_tool)
    return Upstream


@pytest.fixture
def tokens(monkeypatch):
    """Replace ``ensure_access_token``. ``asked`` records ``rejected``; ``answer`` is the token,
    or the exception to raise (a list is used one per call)."""

    class Tokens:
        asked: list = []
        answer: object = "ACCESS-1"

    def ensure_access_token(connection_id, *, rejected=None):
        Tokens.asked.append(rejected)
        value = Tokens.answer
        if isinstance(value, list):
            value = value.pop(0) if len(value) > 1 else value[0]
        if isinstance(value, Exception):
            raise value
        return value

    Tokens.asked = []
    monkeypatch.setattr(connector_oauth, "ensure_access_token", ensure_access_token)
    return Tokens


def _text_result(payload: object, *, error: bool = False) -> CallToolResult:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return CallToolResult(content=[TextContent(type="text", text=text)], isError=error)


# ---- upstream_target ----


def _target(access: str, key: str = "supabase", **over) -> str:
    url, transport = connectors.upstream_target(
        connection_row(add_connection(uuid_owner(), key, **over)), access
    )
    assert transport == over.get("transport", "streamable-http")
    return url


def uuid_owner() -> uuid.UUID:
    return fresh_account()[1]


def test_upstream_target_is_the_rows_address_when_the_entry_adds_nothing():
    assert _target("read", "linear") == "https://mcp.linear.app/mcp"
    assert _target("write", "linear") == "https://mcp.linear.app/mcp"
    sse = {"url": "https://mcp.acme.dev/sse?team=7&x=a%20b", "transport": "sse"}
    # A custom address keeps its own query untouched, and a scope on the row means nothing
    # without a scope picker.
    custom = {"scope": {"value": "abcd1234", "label": "x"}, **sse}
    assert _target("read", "custom:mcp.acme.dev/sse", **custom) == sse["url"]
    assert _target("write", "custom:mcp.acme.dev/sse", **custom) == sse["url"]
    # A connection whose key no longer resolves.
    assert (
        _target("read", "dev.gone/mcp", url="https://gone.dev/mcp?a=1")
        == "https://gone.dev/mcp?a=1"
    )


def test_upstream_target_adds_the_read_only_parameter_in_read_mode_and_the_scope_always():
    base = "https://mcp.supabase.com/mcp"
    scope = {"value": "abcd1234", "label": "trade-mcp-prod"}
    assert _target("read") == f"{base}?read_only=true"
    assert _target("write") == base
    assert _target("read", scope=scope) == f"{base}?project_ref=abcd1234&read_only=true"
    assert _target("write", scope=scope) == f"{base}?project_ref=abcd1234"
    # Neon gets its flag too (its read-only mode is the flag AND the annotation rule).
    neon = "https://mcp.neon.tech/mcp"
    assert _target("read", "neon") == f"{neon}?readonly=true"
    assert _target("read", "neon", scope={"value": "p-1", "label": "p"}) == (
        f"{neon}?projectId=p-1&readonly=true"
    )
    assert _target("write", "neon", scope={"value": "p-1", "label": "p"}) == f"{neon}?projectId=p-1"


def test_upstream_target_replaces_a_same_named_parameter_and_puts_read_only_last_once():
    url = "https://mcp.supabase.com/mcp?read_only=false&features=docs&project_ref=zzz&read_only=0"
    scope = {"value": "abcd1234", "label": "x"}
    assert _target("read", url=url, scope=scope) == (
        "https://mcp.supabase.com/mcp?features=docs&project_ref=abcd1234&read_only=true"
    )
    assert _target("read", url=url) == (
        "https://mcp.supabase.com/mcp?features=docs&project_ref=zzz&read_only=true"
    )
    # In write mode nothing is added, and the address keeps what it came with.
    assert _target("write", url=url) == url


@pytest.mark.parametrize("access", ["Read", "readonly", "", None, "WRITE", 1])
def test_upstream_target_is_read_only_unless_the_access_is_exactly_write(access):
    """The run-time stream passes an access read from a run token: a value that isn't ``write``
    must never build the write address."""
    scope = {"value": "abcd", "label": "x"}
    assert _target(access, scope=scope) == (
        "https://mcp.supabase.com/mcp?project_ref=abcd&read_only=true"
    )
    assert _target(access, "neon") == "https://mcp.neon.tech/mcp?readonly=true"


def test_upstream_target_encodes_a_scope_value_so_it_cant_add_a_parameter():
    hostile = {"value": "x&read_only=false#frag", "label": "x"}  # never stored by PATCH (see below)
    assert _target("read", scope=hostile) == (
        "https://mcp.supabase.com/mcp?project_ref=x%26read_only%3Dfalse%23frag&read_only=true"
    )


# ---- PATCH: access ----


def test_patch_access_narrows_and_widens(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(
        owner,
        "linear",
        tools=[
            {"name": "list_issues", "title": None, "read_only": True},
            {"name": "create_issue", "title": None, "read_only": False},
        ],
    )
    wide = c.patch(f"/api/connectors/{cid}", json={"access": "write"})
    assert wide.status_code == 200, wide.text
    assert wide.json()["access"] == "write"
    assert [(t["write"], t["on"]) for t in wide.json()["tools"]] == [(False, True), (True, True)]
    assert connection_row(cid).access == "write"

    narrow = c.patch(f"/api/connectors/{cid}", json={"access": "read"}).json()
    assert narrow["access"] == "read"
    assert [(t["write"], t["on"]) for t in narrow["tools"]] == [(False, True), (True, False)]
    assert upstream.lists == [] and tokens.asked == []  # no provider call for an access change


def test_narrowing_a_connection_takes_read_and_write_back_from_every_agent():
    """A grant left at ``write`` under a read-only connection shows nowhere, and widening the
    connection later would hand that agent write again with nobody choosing it. Narrowing makes
    every library agent's grant ``read``, so "each agent stays read only until you choose Read &
    write for it" is true."""
    c, owner = fresh_account()
    cid = add_connection(owner, "linear", access="write")
    keep = add_connection(owner, "supabase", access="write")
    team = make_team(owner, "Team")
    clone = make_team(owner, "Run snapshot", library=False)
    both = {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {
            "connectors": [{"id": keep, "access": "write"}, {"id": cid, "access": "write"}]
        },
    }
    engineer = make_node(team, "Engineer", tool_config=both)
    reviewer = make_node(team, "Reviewer", x=1, tool_config=grant(cid))
    snapshot = make_node(clone, "Engineer", tool_config=grant(cid, "write"))

    def users(body: dict) -> dict:
        return {a["role_name"]: a["access"] for a in body["used_by_agents"]}

    before = c.get(f"/api/connectors/{cid}").json()
    assert users(before) == {"Engineer": "write", "Reviewer": "read"}

    narrow = c.patch(f"/api/connectors/{cid}", json={"access": "read"})
    assert narrow.status_code == 200, narrow.text
    assert node_row(engineer).tool_config == {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {"connectors": [{"id": keep, "access": "write"}, {"id": cid, "access": "read"}]},
    }
    assert node_row(reviewer).tool_config == grant(cid)  # untouched: it named no access
    assert node_row(snapshot).tool_config == grant(cid, "write")  # run history stays as it ran

    wide = c.patch(f"/api/connectors/{cid}", json={"access": "write"})
    assert wide.status_code == 200, wide.text
    after = c.get(f"/api/connectors/{cid}").json()
    assert users(after) == {"Engineer": "read", "Reviewer": "read"}
    # Widening, renaming and a PATCH that names no access change no grant.
    assert c.patch(f"/api/connectors/{keep}", json={"name": "Db"}).status_code == 200
    assert grant_of(node_row(engineer).tool_config, keep) == "write"


def test_patch_access_a_connector_doesnt_have_is_invalid():
    c, owner = fresh_account()
    drive = add_connection(owner, "google-drive")
    before = _snapshot(drive)
    detail = _refused(
        c.patch(f"/api/connectors/{drive}", json={"access": "write"}), 422, "invalid_access"
    )
    assert detail["message"] == "Google Drive can only be connected read only."
    linear = add_connection(owner, "linear")
    for access in ("admin", "", None, 1):
        _refused(
            c.patch(f"/api/connectors/{linear}", json={"access": access}), 422, "invalid_access"
        )
    assert _snapshot(drive) == before
    assert c.patch(f"/api/connectors/{drive}", json={"access": "read"}).status_code == 200


def test_patch_reports_who_uses_the_connection():
    c, owner = fresh_account()
    cid = add_connection(owner, "linear")
    team = make_team(owner, "Team")
    make_node(team, "PM", tool_config=grant(cid, "write"))
    body = c.patch(f"/api/connectors/{cid}", json={}).json()
    assert body["used_by"] == {"agent_count": 1, "team_count": 1} and body["access"] == "read"


# ---- PATCH: scope ----


def test_patch_scope_is_set_cleared_and_reaches_the_provider_address():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    scope = {"value": "abcd1234", "label": "trade-mcp-prod · ap-southeast-1"}
    body = c.patch(f"/api/connectors/{cid}", json={"scope": scope})
    assert body.status_code == 200, body.text
    assert body.json()["scope"] == scope
    assert connectors.upstream_target(connection_row(cid), "read")[0] == (
        "https://mcp.supabase.com/mcp?project_ref=abcd1234&read_only=true"
    )

    # A label is display text: missing, it is the value; too long, it is cut.
    body = c.patch(f"/api/connectors/{cid}", json={"scope": {"value": "p.q-r_1"}}).json()
    assert body["scope"] == {"value": "p.q-r_1", "label": "p.q-r_1"}
    body = c.patch(f"/api/connectors/{cid}", json={"scope": {"value": "v", "label": "L" * 300}})
    assert body.json()["scope"] == {"value": "v", "label": "L" * 120}

    # Other fields leave it alone; null clears it.
    assert (
        c.patch(f"/api/connectors/{cid}", json={"access": "write"}).json()["scope"]["value"] == "v"
    )
    cleared = c.patch(f"/api/connectors/{cid}", json={"scope": None}).json()
    assert cleared["scope"] is None and connection_row(cid).scope is None
    assert (
        connectors.upstream_target(connection_row(cid), "write")[0]
        == "https://mcp.supabase.com/mcp"
    )


@pytest.mark.parametrize(
    "scope",
    [
        {"value": "x&read_only=false", "label": "x"},
        {"value": "a b"},
        {"value": ""},
        {"value": "x" * 81},
        {"value": "ünïcode"},
        {"value": 7},
        {"label": "no value"},
        "abcd1234",
        ["abcd1234"],
    ],
)
def test_patch_a_scope_that_isnt_a_project_id_is_invalid(scope):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", scope={"value": "kept", "label": "kept"})
    detail = _refused(
        c.patch(f"/api/connectors/{cid}", json={"scope": scope}), 422, "invalid_scope"
    )
    assert detail["message"] == "That doesn’t look like a project id."
    assert connection_row(cid).scope == {"value": "kept", "label": "kept"}


def test_patch_scope_on_a_connector_without_a_scope_picker():
    c, owner = fresh_account()
    cid = add_connection(owner, "linear")
    for scope in ({"value": "abcd1234", "label": "x"}, None):
        _refused(c.patch(f"/api/connectors/{cid}", json={"scope": scope}), 409, "no_scope")
    assert connection_row(cid).scope is None


# ---- PATCH: name ----


def test_patch_name_renames_and_never_changes_the_slug():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    body = c.patch(f"/api/connectors/{cid}", json={"name": "  Production database  "}).json()
    assert (body["name"], body["slug"]) == ("Production database", "supabase")
    assert c.patch(f"/api/connectors/{cid}", json={"name": "n" * 60}).json()["name"] == "n" * 60
    for name in ("", "   ", "n" * 61, 7, None):
        detail = _refused(
            c.patch(f"/api/connectors/{cid}", json={"name": name}), 422, "invalid_name"
        )
        assert detail["message"] == "A name is 1 to 60 characters."
    assert connection_row(cid).name == "n" * 60 and connection_row(cid).slug == "supabase"


@pytest.mark.parametrize(
    ("given", "stored"),
    [
        ("a\x00b", "a b"),  # PostgreSQL can't store a NUL
        ("ok\nline\r\n", "ok line"),
        ("\u202e<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"),  # a bidi override
        ("Acme\u200b\u2028Prod", "Acme  Prod"),
        (
            "Datenbank für Zürich 日本語",
            "Datenbank für Zürich 日本語",
        ),  # letters of any script stay
    ],
)
def test_patch_name_keeps_only_printable_characters(given, stored):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    resp = c.patch(f"/api/connectors/{cid}", json={"name": given})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == stored and connection_row(cid).name == stored


def test_patch_a_name_or_a_scope_label_of_hidden_characters_only():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    _refused(c.patch(f"/api/connectors/{cid}", json={"name": "\x00\u202e\n"}), 422, "invalid_name")
    assert connection_row(cid).name == "Supabase"
    # A lone surrogate (JSON can spell one) can't be stored either.
    resp = c.patch(
        f"/api/connectors/{cid}",
        content=b'{"name": "Acme\\ud800Prod"}',
        headers={"Content-Type": "application/json"},
    )
    assert (resp.status_code, resp.json()["name"]) == (200, "Acme Prod")

    # A scope label is display text too: the same characters go, and nothing left is the value.
    for label, stored in (("l\x00l\u202e", "l l"), ("\x00\u2028", "abc")):
        resp = c.patch(f"/api/connectors/{cid}", json={"scope": {"value": "abc", "label": label}})
        assert resp.status_code == 200, resp.text
        assert resp.json()["scope"] == {"value": "abc", "label": stored}
        assert connection_row(cid).scope == {"value": "abc", "label": stored}


def test_patch_refuses_the_whole_request_when_one_field_is_wrong():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    before = _snapshot(cid)
    body = {"name": "Renamed", "access": "write", "scope": {"value": "not ok"}}
    _refused(c.patch(f"/api/connectors/{cid}", json=body), 422, "invalid_scope")
    assert _snapshot(cid) == before


# ---- PATCH: credentials ----


def _key_connection(owner, registry_file, **over) -> str:
    registry_file(
        snapshot_line("dev.keyed/mcp", "https://mcp.keyed.dev/mcp", header(), title="Keyed")
    )
    fields = {"auth_kind": "api_key", "secret": KEY_SECRET, "tools": STORED} | over
    return add_connection(owner, "dev.keyed/mcp", name="Keyed", **fields)


def test_a_key_connection_says_which_key_fields_it_takes(registry_file):
    """ "Replace key" asks for these. The app used to look them up by searching the catalog for
    the connection's host, and a connector past the first page of that search could never have
    its key replaced."""
    c, owner = fresh_account()
    cid = _key_connection(owner, registry_file)
    listed = {
        "id": "Authorization",
        "label": "API key",
        "hint": "",
        "secret": True,
        "required": True,
    }
    assert c.get(f"/api/connectors/{cid}").json()["key_fields"] == [listed]
    [row] = c.get("/api/connectors").json()["connections"]
    assert row["key_fields"] == [listed]

    # The catalog no longer lists it: the header names the connection stores.
    gone = add_connection(
        owner,
        "com.gone/server",
        name="Gone",
        url="https://mcp.gone.dev/mcp",
        auth_kind="api_key",
        secret={"headers": {"Authorization": "Bearer OLD", "X-Team": "7"}},
    )
    assert c.get(f"/api/connectors/{gone}").json()["key_fields"] == [
        {"id": "Authorization", "label": "API key", "hint": "", "secret": True, "required": True},
        {"id": "X-Team", "label": "X-Team", "hint": "", "secret": True, "required": True},
    ]
    # A connection that signs in takes none.
    signs_in = add_connection(owner, "supabase")
    assert c.get(f"/api/connectors/{signs_in}").json()["key_fields"] == []


def test_patch_credentials_replaces_the_key_after_checking_it(registry_file, upstream):
    c, owner = fresh_account()
    cid = _key_connection(
        owner, registry_file, status="needs_signin", last_error="Its key stopped working."
    )
    resp = c.patch(f"/api/connectors/{cid}", json={"credentials": {"Authorization": "NEW-KEY"}})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["status"], body["last_error"]) == ("connected", None)
    assert [t["name"] for t in body["tools"]] == ["list_things", "create_thing"]
    assert body["connected_at"] is not None and "NEW-KEY" not in resp.text
    assert upstream.lists == [
        ("https://mcp.keyed.dev/mcp", "streamable-http", {"Authorization": "Bearer NEW-KEY"})
    ]
    assert connectors.read_secret(connection_row(cid)) == {
        "headers": {"Authorization": "Bearer NEW-KEY"}
    }


def test_patch_a_rejected_key_keeps_the_old_key_and_the_status(registry_file, upstream):
    c, owner = fresh_account()
    cid = _key_connection(owner, registry_file)
    before = _snapshot(cid)
    for answer in (
        connector_upstream.UpstreamUnauthorized(),
        connector_upstream.UpstreamRefused(403),
    ):
        upstream.tools = answer
        detail = _refused(
            c.patch(f"/api/connectors/{cid}", json={"credentials": {"Authorization": "BAD"}}),
            422,
            "key_rejected",
        )
        assert detail["message"] == "Keyed didn’t accept the key."
    upstream.tools = connector_upstream.UpstreamUnreachable("down")
    _refused(
        c.patch(f"/api/connectors/{cid}", json={"credentials": {"Authorization": "k"}}),
        502,
        "unreachable",
    )
    # The same rules as connecting: an undeclared id, a line break, no key at all.
    for credentials in ({"X-Other": "k"}, {"Authorization": "a\r\nX-Evil: 1"}):
        _refused(
            c.patch(f"/api/connectors/{cid}", json={"credentials": credentials}), 422, "invalid_key"
        )
    _refused(c.patch(f"/api/connectors/{cid}", json={"credentials": {}}), 422, "key_required")
    assert _snapshot(cid) == before
    assert connectors.read_secret(connection_row(cid)) == KEY_SECRET


def test_patch_credentials_when_the_catalog_no_longer_lists_the_key(registry_file, upstream):
    """A refresh of the snapshot can drop a server, or its key header. The connection still
    stores which headers it sends, so its key can still be replaced."""
    c, owner = fresh_account()
    registry_file()  # an empty registry: the connection's key no longer resolves
    cid = add_connection(
        owner,
        "com.gone/server",
        name="Gone",
        url="https://mcp.gone.dev/mcp",
        auth_kind="api_key",
        secret={"headers": {"Authorization": "Bearer OLD", "X-Team": "7"}},
        status="needs_signin",
        last_error="Its key stopped working.",
    )
    path = f"/api/connectors/{cid}"

    # Only the headers it stores are taken, and all of them.
    detail = _refused(c.patch(path, json={"credentials": {"X-Other": "k"}}), 422, "invalid_key")
    assert detail["message"] == "That isn’t a key Gone takes. Check it and try again."
    detail = _refused(
        c.patch(path, json={"credentials": {"Authorization": "k"}}), 422, "key_required"
    )
    assert detail["fields"] == [
        {"id": "Authorization", "label": "API key", "hint": "", "secret": True, "required": True},
        {"id": "X-Team", "label": "X-Team", "hint": "", "secret": True, "required": True},
    ]
    assert upstream.lists == [] and connection_row(cid).status == "needs_signin"

    resp = c.patch(path, json={"credentials": {"Authorization": "NEW", "X-Team": "8"}})
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == ("connected", None)
    sent = {"Authorization": "Bearer NEW", "X-Team": "8"}
    assert upstream.lists == [("https://mcp.gone.dev/mcp", "streamable-http", sent)]
    assert connectors.read_secret(connection_row(cid)) == {"headers": sent}

    # Still listed, but it no longer declares a key header: the same.
    registry_file(snapshot_line("com.gone/server", "https://mcp.gone.dev/mcp", title="Gone"))
    resp = c.patch(path, json={"credentials": {"Authorization": "Bearer NEWER", "X-Team": "9"}})
    assert resp.status_code == 200, resp.text
    assert connectors.read_secret(connection_row(cid)) == {
        "headers": {"Authorization": "Bearer NEWER", "X-Team": "9"}
    }


def test_patch_credentials_on_a_connection_that_signs_in(upstream):
    c, owner = fresh_account()
    cid = add_connection(owner, "linear", secret=OAUTH_SECRET)
    before = _snapshot(cid)
    detail = _refused(
        c.patch(f"/api/connectors/{cid}", json={"credentials": {"Authorization": "k"}}),
        409,
        "not_api_key",
    )
    assert detail["message"] == "Linear doesn’t take a key."
    assert _snapshot(cid) == before and upstream.lists == []


# ---- check ----


def test_check_lists_the_tools_again_with_the_stored_sign_in(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(
        owner,
        "supabase",
        secret=OAUTH_SECRET,
        status="needs_signin",
        last_error="Its sign-in expired.",
        tools=STORED,
        scope={"value": "abcd1234", "label": "x"},
    )
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["status"], body["last_error"]) == ("connected", None)
    assert [t["name"] for t in body["tools"]] == ["list_things", "create_thing"]
    # The scoped, read-only address, with a token from ensure_access_token.
    assert upstream.lists == [
        (
            "https://mcp.supabase.com/mcp?project_ref=abcd1234&read_only=true",
            "streamable-http",
            {"Authorization": "Bearer ACCESS-1"},
        )
    ]
    assert tokens.asked == [None] and "ACCESS-1" not in resp.text


def test_check_a_401_refreshes_once_then_needs_a_sign_in(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(owner, "linear", secret=OAUTH_SECRET, tools=STORED)
    unauthorized = connector_upstream.UpstreamUnauthorized

    # The provider refuses the stored token, takes the refreshed one.
    upstream.tools = [unauthorized(), TOOLS]
    tokens.answer = ["ACCESS-1", "ACCESS-2"]
    body = c.post(f"/api/connectors/{cid}/check").json()
    assert (body["status"], len(body["tools"])) == ("connected", 2)
    assert tokens.asked == [None, "ACCESS-1"]  # the refused token is named, so it is replaced
    assert [h["Authorization"] for _, _, h in upstream.lists] == [
        "Bearer ACCESS-1",
        "Bearer ACCESS-2",
    ]

    # Refused again with the fresh token: the sign-in is gone. 200, not an error.
    upstream.tools = unauthorized()
    tokens.answer = "ACCESS-3"
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == (
        "needs_signin",
        "Its sign-in expired.",
    )
    row = connection_row(cid)
    assert (row.status, row.last_error) == ("needs_signin", "Its sign-in expired.")
    assert len(row.tools) == 2  # the last list seen is kept


def test_check_a_refused_refresh_needs_a_sign_in(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(owner, "linear", secret=OAUTH_SECRET)
    tokens.answer = connector_oauth.SignInRefused("invalid_grant")
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == (
        "needs_signin",
        "Its sign-in expired.",
    )
    assert upstream.lists == []


def test_check_a_403_or_a_provider_that_doesnt_answer_leaves_the_status_alone(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", secret=OAUTH_SECRET, tools=STORED)
    before = _snapshot(cid)

    for status in (403, 404, 429):
        upstream.tools = connector_upstream.UpstreamRefused(status)
        detail = _refused(c.post(f"/api/connectors/{cid}/check"), 502, "refused")
        assert detail["message"] == "Supabase refused the request."
    assert tokens.asked == [None] * 3  # a 403 is not an expired sign-in: no refresh

    for answer in (
        connector_upstream.UpstreamUnreachable("timeout"),
        McpError(ErrorData(code=-32603, message="boom")),
    ):
        upstream.tools = answer
        detail = _refused(c.post(f"/api/connectors/{cid}/check"), 502, "unreachable")
        assert detail["message"] == "We couldn’t reach mcp.supabase.com. Try again."
    tokens.answer = connector_oauth.Unreachable("token endpoint down")
    _refused(c.post(f"/api/connectors/{cid}/check"), 502, "unreachable")
    assert _snapshot(cid) == before


def test_check_a_key_connection_against_the_fake_server(
    registry_file, local_addresses, fake_connector_url
):
    registry_file(
        snapshot_line("test.fake/things", fake_connector_url, header(), title="Fake Things")
    )
    c, owner = fresh_account()

    def keyed(key: str) -> str:
        account = fresh_account()
        cid = add_connection(
            account[1],
            "test.fake/things",
            name="Fake Things",
            url=fake_connector_url,
            auth_kind="api_key",
            secret={"headers": {"Authorization": f"Bearer {key}"}},
        )
        return account[0], cid

    client, good = keyed("fake-static-token")
    body = client.post(f"/api/connectors/{good}/check").json()
    assert body["status"] == "connected" and body["connected_at"] is not None
    assert [(t["name"], t["write"]) for t in body["tools"]] == [
        ("list_things", False),
        ("get_thing", False),
        ("create_thing", True),
        ("list_projects", False),
    ]

    client, stale = keyed("a-key-that-stopped-working")
    resp = client.post(f"/api/connectors/{stale}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == (
        "needs_signin",
        "Its key stopped working.",
    )

    client, forbidden = keyed("forbidden")
    _refused(client.post(f"/api/connectors/{forbidden}/check"), 502, "refused")
    assert connection_row(forbidden).status == "connected"


def test_check_a_key_that_cant_be_decrypted_stopped_working_and_can_be_replaced(
    registry_file, upstream
):
    c, owner = fresh_account()
    cid = _key_connection(owner, registry_file, secret=None, secret_encrypted="not-a-fernet-token")
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == (
        "needs_signin",
        "Its key stopped working.",
    )
    assert upstream.lists == []  # there was no key to try

    resp = c.patch(f"/api/connectors/{cid}", json={"credentials": {"Authorization": "NEW-KEY"}})
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == ("connected", None)
    assert connectors.read_secret(connection_row(cid)) == {
        "headers": {"Authorization": "Bearer NEW-KEY"}
    }


def _replace_sign_in(connection_id: str, secret: dict) -> None:
    """What a finished "Sign in again", or a key replaced by PATCH, writes."""
    with session_scope() as s:
        row = s.get(ConnectorConnection, uuid.UUID(connection_id))
        connectors.write_secret(row, secret)
        row.status, row.last_error = "connected", None


@pytest.mark.parametrize(
    ("auth_kind", "old", "new"),
    [
        ("oauth", OAUTH_SECRET, OAUTH_SECRET | {"access_token": "ACCESS-NEW"}),
        ("api_key", KEY_SECRET, {"headers": {"Authorization": "Bearer NEW-KEY"}}),
    ],
)
def test_check_leaves_a_sign_in_alone_that_was_replaced_while_the_provider_answered(
    monkeypatch, tokens, auth_kind, old, new
):
    """The provider's 401 is about the credential that was sent. One stored since then hasn't
    been refused by anyone, so the check must not mark it as gone."""
    c, owner = fresh_account()
    cid = add_connection(owner, "linear", auth_kind=auth_kind, secret=old, tools=STORED)

    def list_tools_sync(url, transport, headers, timeout=10):
        _replace_sign_in(cid, new)  # …while the provider is refusing the old one
        raise connector_upstream.UpstreamUnauthorized()

    monkeypatch.setattr(connector_upstream, "list_tools_sync", list_tools_sync)
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == ("connected", None)
    row = connection_row(cid)
    assert (row.status, row.last_error, row.tools) == ("connected", None, STORED)
    assert connectors.read_secret(row) == new


def test_check_needs_a_sign_in_when_the_token_its_own_refresh_stored_is_refused_too(
    monkeypatch, upstream
):
    """The refresh the check itself asked for rewrites the stored sign-in. That is not someone
    else's new sign-in: refused as well, the connection needs one."""
    c, owner = fresh_account()
    cid = add_connection(owner, "linear", secret=OAUTH_SECRET, tools=STORED)

    def ensure_access_token(connection_id, *, rejected=None):
        if rejected is None:
            return "ACCESS-1"
        with session_scope() as s:  # what a real refresh does: the rotated tokens are stored
            row = s.get(ConnectorConnection, uuid.UUID(cid))
            connectors.write_secret(row, OAUTH_SECRET | {"access_token": "ACCESS-2"})
        return "ACCESS-2"

    monkeypatch.setattr(connector_oauth, "ensure_access_token", ensure_access_token)
    upstream.tools = connector_upstream.UpstreamUnauthorized()
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == (
        "needs_signin",
        "Its sign-in expired.",
    )
    assert [h["Authorization"] for _, _, h in upstream.lists] == [
        "Bearer ACCESS-1",
        "Bearer ACCESS-2",
    ]


def test_check_a_server_with_no_sign_in_that_now_asks_for_one(upstream, tokens):
    """It has no sign-in to renew and no key to replace, so the reason says what does work."""
    c, owner = fresh_account()
    cid = add_connection(
        owner, "dev.open/mcp", name="Open Data", url="https://mcp.open.dev/mcp", auth_kind="none"
    )
    upstream.tools = connector_upstream.UpstreamUnauthorized()
    resp = c.post(f"/api/connectors/{cid}/check")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["last_error"]) == (
        "needs_signin",
        "It now asks for a sign-in. Disconnect it and connect it again.",
    )
    assert upstream.lists == [("https://mcp.open.dev/mcp", "streamable-http", {})]
    assert tokens.asked == []  # asked once, with nothing: there is no token to refresh


def test_check_a_pending_connection_has_nothing_to_check(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", status="pending")
    detail = _refused(c.post(f"/api/connectors/{cid}/check"), 409, "not_connected")
    assert detail["message"] == "Finish connecting Supabase first."
    assert connection_row(cid).status == "pending" and tokens.asked == [] and upstream.lists == []


# ---- scope options ----

PROJECTS = [
    {"id": "abcd1234", "name": "trade-mcp-prod", "region": "ap-southeast-1"},
    {"id": "efgh5678", "name": "trade-mcp-dev", "region": "us-east-1"},
]


def test_scope_options_come_from_the_providers_project_list(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(
        owner, "supabase", secret=OAUTH_SECRET, scope={"value": "abcd1234", "label": "x"}
    )
    upstream.result = _text_result(PROJECTS)
    resp = c.get(f"/api/connectors/{cid}/scope-options")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "param": "project_ref",
        "label": "Project",
        "manual": False,
        "options": [
            {"value": "abcd1234", "label": "trade-mcp-prod", "detail": "ap-southeast-1"},
            {"value": "efgh5678", "label": "trade-mcp-dev", "detail": "us-east-1"},
        ],
    }
    # Asked on the UNSCOPED address (every project, not the one already picked), read only.
    assert upstream.calls == [
        (
            "https://mcp.supabase.com/mcp?read_only=true",
            "streamable-http",
            {"Authorization": "Bearer ACCESS-1"},
            "list_projects",
            {},
        )
    ]


@pytest.mark.parametrize(
    ("payload", "options"),
    [
        # Neon's shape: a wrapper object, `region_id`, no name on one project.
        (
            {
                "projects": [
                    {"id": "p-1", "name": "app", "region_id": "aws-us-east-2"},
                    {"id": "p-2"},
                ]
            },
            [
                {"value": "p-1", "label": "app", "detail": "aws-us-east-2"},
                {"value": "p-2", "label": "p-2", "detail": None},
            ],
        ),
        # Ids that couldn't be a scope value, and things that aren't projects, are left out.
        (
            [{"id": "ok_1", "name": "Ok"}, {"id": "bad id"}, {"name": "no id"}, "text", {"id": 12}],
            [
                {"value": "ok_1", "label": "Ok", "detail": None},
                {"value": "12", "label": "12", "detail": None},
            ],
        ),
    ],
)
def test_scope_options_read_the_shapes_providers_answer_in(upstream, tokens, payload, options):
    c, owner = fresh_account()
    cid = add_connection(owner, "neon", secret=OAUTH_SECRET, access="write")
    upstream.result = _text_result(payload)
    body = c.get(f"/api/connectors/{cid}/scope-options").json()
    assert body == {"param": "projectId", "label": "Project", "manual": False, "options": options}
    assert upstream.calls[0][0] == "https://mcp.neon.tech/mcp"  # write access: no read-only flag


@pytest.mark.parametrize(
    "result",
    [
        _text_result("Here are your projects: trade-mcp-prod, trade-mcp-dev"),
        _text_result([]),
        _text_result({"projects": "none"}),
        _text_result("[" * 200_000),  # nested deeper than the JSON reader goes
        _text_result(PROJECTS, error=True),
        CallToolResult(content=[]),
        connector_upstream.UpstreamUnauthorized(),
        connector_upstream.UpstreamRefused(403),
        McpError(ErrorData(code=-32601, message="Unknown tool: list_projects")),
    ],
)
def test_scope_options_ask_for_the_id_by_hand_when_the_list_cant_be_read(upstream, tokens, result):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    before = _snapshot(cid)
    upstream.result = result
    resp = c.get(f"/api/connectors/{cid}/scope-options")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "param": "project_ref",
        "label": "Project",
        "manual": True,
        "options": [],
    }
    assert _snapshot(cid) == before


def test_scope_options_cut_a_projects_name_and_region(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    upstream.result = _text_result(
        [{"id": "abcd1234", "name": "n" * 40_000, "region": "r" * 40_000}] * 300
    )
    resp = c.get(f"/api/connectors/{cid}/scope-options")
    assert resp.status_code == 200, resp.text
    assert (
        resp.json()["options"]
        == [{"value": "abcd1234", "label": "n" * 120, "detail": "r" * 120}] * 200
    )
    assert len(resp.content) < 100_000


def test_scope_options_refusals(upstream, tokens):
    c, owner = fresh_account()
    linear = add_connection(owner, "linear", secret=OAUTH_SECRET)
    _refused(c.get(f"/api/connectors/{linear}/scope-options"), 409, "no_scope")
    pending = add_connection(owner, "neon", status="pending")
    _refused(c.get(f"/api/connectors/{pending}/scope-options"), 409, "not_connected")
    assert upstream.calls == [] and tokens.asked == []

    supabase = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    upstream.result = connector_upstream.UpstreamUnreachable("timeout")
    detail = _refused(c.get(f"/api/connectors/{supabase}/scope-options"), 502, "unreachable")
    assert detail["message"] == "We couldn’t reach mcp.supabase.com. Try again."
    tokens.answer = connector_oauth.Unreachable("token endpoint down")
    _refused(c.get(f"/api/connectors/{supabase}/scope-options"), 502, "unreachable")


def test_scope_options_from_the_fake_servers_list_projects(local_addresses, fake_connector_url):
    c, owner = fresh_account()
    cid = add_connection(
        owner,
        "supabase",
        url=fake_connector_url,
        auth_kind="api_key",
        secret={"headers": {"Authorization": "Bearer fake-static-token"}},
    )
    body = c.get(f"/api/connectors/{cid}/scope-options").json()
    assert body == {
        "param": "project_ref",
        "label": "Project",
        "manual": False,
        "options": [
            {"value": "abcd1234", "label": "trade-mcp-prod", "detail": "ap-southeast-1"},
            {"value": "efgh5678", "label": "trade-mcp-dev", "detail": "us-east-1"},
        ],
    }


# ---- disconnect ----


def test_delete_strips_the_grant_from_every_agent_and_revokes(monkeypatch):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    keep = add_connection(owner, "linear")
    team = make_team(owner, "Team")
    clone = make_team(owner, "Run snapshot", library=False)
    both = {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {
            "library": ["11111111-1111-1111-1111-111111111111"],
            "connectors": [{"id": keep, "access": "write"}, {"id": cid}],
        },
    }
    pm = make_node(team, "PM", tool_config=grant(cid))
    engineer = make_node(team, "Engineer", x=1, tool_config=both)
    reviewer = make_node(team, "Reviewer", x=2, tool_config=grant(keep))
    snapshot = make_node(clone, "PM", tool_config=grant(cid))
    revoked: list = []

    def revoke(connection_id):
        assert connection_row(connection_id) is not None  # asked before the row goes
        revoked.append(str(connection_id))
        return True

    monkeypatch.setattr(connector_oauth, "revoke", revoke)

    resp = c.delete(f"/api/connectors/{cid}")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"removed_from_agents": 2, "revoked": True}
    assert revoked == [cid] and connection_row(cid) is None
    assert c.get(f"/api/connectors/{cid}").status_code == 404

    assert node_row(pm).tool_config is None  # nothing else was in it
    assert node_row(engineer).tool_config == {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {
            "library": ["11111111-1111-1111-1111-111111111111"],
            "connectors": [{"id": keep, "access": "write"}],
        },
    }
    assert node_row(reviewer).tool_config == grant(keep)
    # Run snapshots are run history: their grant stays and now points at nothing.
    assert node_row(snapshot).tool_config == grant(cid)
    assert [r["id"] for r in c.get("/api/connectors").json()["connections"]] == [keep]


def test_delete_goes_through_when_the_revoke_fails_and_asks_only_for_a_sign_in(monkeypatch):
    c, owner = fresh_account()
    asked: list = []

    def revoke(connection_id):
        asked.append(str(connection_id))
        raise RuntimeError("the provider is down")

    monkeypatch.setattr(connector_oauth, "revoke", revoke)
    oauth = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    assert c.delete(f"/api/connectors/{oauth}").json() == {
        "removed_from_agents": 0,
        "revoked": False,
    }
    assert connection_row(oauth) is None

    key = add_connection(owner, "dev.keyed/mcp", auth_kind="api_key", secret=KEY_SECRET)
    pending = add_connection(owner, "linear", status="pending")
    for cid in (key, pending):
        assert c.delete(f"/api/connectors/{cid}").json() == {
            "removed_from_agents": 0,
            "revoked": False,
        }
        assert connection_row(cid) is None
    assert asked == [oauth]  # a key has no sign-in to revoke; a pending row has no sign-in yet

    # The Phase 0 / real revoke answering False is reported as it is.
    monkeypatch.setattr(connector_oauth, "revoke", lambda connection_id: False)
    again = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    assert c.delete(f"/api/connectors/{again}").json()["revoked"] is False


def test_the_connector_can_be_connected_again_after_a_delete():
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase")
    assert c.delete(f"/api/connectors/{cid}").status_code == 200
    add_connection(owner, "supabase")  # the (owner, key) and (owner, slug) pairs are free again


# ---- requests that wait on a provider are capped ----

BUSY = "Too many connector requests at once. Try again in a moment."


def test_requests_that_wait_on_a_provider_are_capped_per_account(
    monkeypatch, registry_file, upstream, tokens
):
    """Each one keeps a worker thread for the provider's whole deadline. Past the cap they are
    refused at once: nothing is asked, nothing is written, and nobody else is held up."""
    c, owner = fresh_account()
    other_c, other = fresh_account()
    key = _key_connection(owner, registry_file)
    supabase = add_connection(owner, "supabase", secret=OAUTH_SECRET, tools=STORED)
    theirs = add_connection(other, "supabase", secret=OAUTH_SECRET)
    monkeypatch.setattr(connector_oauth, "discover", lambda url, entry=None: pytest.fail("asked"))
    monkeypatch.setattr(connector_oauth, "revoke", lambda connection_id: pytest.fail("asked"))
    before = (_snapshot(key), _snapshot(supabase))
    waiting = [
        lambda: c.post(f"/api/connectors/{supabase}/check"),
        lambda: c.get(f"/api/connectors/{supabase}/scope-options"),
        lambda: c.patch(f"/api/connectors/{key}", json={"credentials": {"Authorization": "NEW"}}),
        lambda: c.post("/api/connectors", json={"key": "linear"}),
    ]
    with ExitStack() as held:
        for _ in range(connectors.OWNER_PROVIDER_CALLS):
            held.enter_context(connectors.provider_slot(owner))
        for send in waiting:
            assert _refused(send(), 429, "busy")["message"] == BUSY
        assert upstream.lists == [] and upstream.calls == [] and tokens.asked == []
        assert (_snapshot(key), _snapshot(supabase)) == before
        assert [r.connector_key for r in connections_of(owner)] == ["dev.keyed/mcp", "supabase"]

        # A request is refused for what is wrong with it before it is refused for the crowd.
        _refused(c.post("/api/connectors", json={"key": "supabase"}), 409, "already_connected")
        _refused(c.patch(f"/api/connectors/{key}", json={"credentials": {}}), 422, "key_required")
        # Another account isn't held up, and neither is a route that asks no provider.
        assert other_c.post(f"/api/connectors/{theirs}/check").status_code == 200
        assert c.patch(f"/api/connectors/{supabase}", json={"access": "write"}).status_code == 200
        assert c.get("/api/connectors").status_code == 200
        # A disconnect always goes through: it skips the best-effort revoke instead.
        assert c.delete(f"/api/connectors/{supabase}").json() == {
            "removed_from_agents": 0,
            "revoked": False,
        }

    # A place is given back when its request ends, also when the provider failed it.
    upstream.tools = connector_upstream.UpstreamUnreachable("down")
    for _ in range(connectors.OWNER_PROVIDER_CALLS + 1):
        _refused(c.post(f"/api/connectors/{key}/check"), 502, "unreachable")
    upstream.tools = TOOLS
    assert c.post(f"/api/connectors/{key}/check").status_code == 200


def test_requests_that_wait_on_a_provider_are_capped_across_accounts(upstream, tokens):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", secret=OAUTH_SECRET)
    assert connectors.OWNER_PROVIDER_CALLS < connectors.PROVIDER_CALLS <= 16  # of ~40 threads
    with ExitStack() as held:
        for _ in range(connectors.PROVIDER_CALLS):
            held.enter_context(connectors.provider_slot(uuid.uuid4()))  # one each: other accounts
        assert _refused(c.post(f"/api/connectors/{cid}/check"), 429, "busy")["message"] == BUSY
        assert upstream.lists == [] and tokens.asked == []
    assert c.post(f"/api/connectors/{cid}/check").status_code == 200


# ---- another account is a 404 on every one of these routes, and the row is untouched ----


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("patch", "", {"access": "write", "name": "Mine now", "scope": None}),
        ("patch", "", {"credentials": {"Authorization": "STOLEN"}}),
        ("post", "/check", None),
        ("get", "/scope-options", None),
        ("delete", "", None),
    ],
)
def test_another_account_gets_404_and_the_row_is_untouched(
    monkeypatch, upstream, tokens, unauth_client, method, path, body
):
    monkeypatch.setattr(connector_oauth, "revoke", lambda connection_id: pytest.fail("revoked"))
    _, owner = fresh_account()
    other_c, other = fresh_account()
    cid = add_connection(owner, "supabase", secret=OAUTH_SECRET, tools=STORED)
    team = make_team(owner, "Team")
    node = make_node(team, "PM", tool_config=grant(cid))
    before = _snapshot(cid)

    def send(client, connection_id):
        kwargs = {"json": body} if body is not None else {}
        return getattr(client, method)(f"/api/connectors/{connection_id}{path}", **kwargs)

    resp = send(other_c, cid)
    assert (resp.status_code, resp.json()) == (404, NOT_FOUND)
    for missing in (uuid.uuid4(), "not-a-uuid"):
        resp = send(other_c, missing)
        assert (resp.status_code, resp.json()) == (404, NOT_FOUND)
    assert send(unauth_client, cid).status_code == 401

    assert _snapshot(cid) == before
    assert node_row(node).tool_config == grant(cid)
    assert upstream.lists == [] and upstream.calls == [] and tokens.asked == []
