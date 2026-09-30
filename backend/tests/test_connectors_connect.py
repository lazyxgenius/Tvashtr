"""Connectors: ``POST /api/connectors`` (B1.4): a key, no sign-in, a custom address, and the
hand-off to sign-in discovery."""

import re

import pytest
from connector_helpers import (
    add_connection,
    connection_row,
    connections_of,
    header,
    key_server,
    server,
    snapshot_line,
)
from mcp.types import Tool, ToolAnnotations
from toolkit_helpers import fresh_account

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_net, connector_oauth, connector_upstream, connectors
from tvashtr.control_plane.connector_catalog import FEATURED

pytest_plugins = ["connector_helpers"]

FAKE_KEY = "test.fake/things"
PUBLIC_IP = "93.184.216.34"
TOOLS = [
    Tool(name="list_things", inputSchema={}, annotations=ToolAnnotations(readOnlyHint=True)),
    Tool(name="create_thing", inputSchema={}),
]
DISCOVERY = connector_oauth.Discovery(
    issuer="https://api.supabase.com",
    authorization_endpoint="https://api.supabase.com/v1/oauth/authorize",
    token_endpoint="https://api.supabase.com/v1/oauth/token",
    resource="https://mcp.supabase.com/mcp",
    registration_endpoint="https://api.supabase.com/v1/oauth/register",
    revocation_endpoint="https://api.supabase.com/v1/oauth/revoke",
    scope="projects:read",
    iss_supported=True,
    token_auth_methods=("client_secret_basic",),
)


def _refused(resp, status: int, code: str) -> dict:
    assert resp.status_code == status, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == code, detail
    assert isinstance(detail["message"], str) and detail["message"]
    return detail


@pytest.fixture
def upstream(monkeypatch):
    """Replace the provider's tool listing. ``calls`` records ``(url, transport, headers)``;
    ``answer`` is the tool list to return or the exception to raise."""

    class Upstream:
        calls: list[tuple] = []
        answer: object = TOOLS

    def list_tools_sync(url, transport, headers, timeout=10):
        Upstream.calls.append((url, transport, headers))
        if isinstance(Upstream.answer, Exception):
            raise Upstream.answer
        return Upstream.answer

    Upstream.calls = []
    monkeypatch.setattr(connector_upstream, "list_tools_sync", list_tools_sync)
    return Upstream


@pytest.fixture
def discovery(monkeypatch):
    """Replace sign-in discovery. ``answer`` is a ``Discovery``, ``None`` or an exception."""

    class Found:
        calls: list[tuple] = []
        answer: object = None

    def discover(url, entry=None):
        Found.calls.append((url, entry))
        if isinstance(Found.answer, Exception):
            raise Found.answer
        return Found.answer

    Found.calls = []
    monkeypatch.setattr(connector_oauth, "discover", discover)
    return Found


# ---- a key ----


def test_a_key_the_server_accepts_connects_with_its_tools(
    registry_file, local_addresses, fake_connector_url
):
    """End to end against the fake server: it accepts the bearer ``fake-static-token``."""
    registry_file(snapshot_line(FAKE_KEY, fake_connector_url, header(), title="Fake Things"))
    c, owner = fresh_account()

    resp = c.post(
        "/api/connectors",
        json={"key": FAKE_KEY, "credentials": {"Authorization": "fake-static-token"}},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["connector_key"], body["name"], body["slug"]) == (
        FAKE_KEY,
        "Fake Things",
        "fake-things",
    )
    assert (body["status"], body["auth_kind"], body["access"]) == ("connected", "api_key", "read")
    assert (body["signin_host"], body["signin_pending"], body["last_error"]) == (None, False, None)
    assert body["connected_at"] is not None
    assert body["tools"] == [
        {"name": "list_things", "title": None, "write": False, "on": True},
        {"name": "get_thing", "title": None, "write": False, "on": True},
        {"name": "create_thing", "title": None, "write": True, "on": False},
        {"name": "list_projects", "title": None, "write": False, "on": True},
    ]
    assert "fake-static-token" not in resp.text

    row = connection_row(body["id"])
    assert "fake-static-token" not in row.secret_encrypted
    # A bare value for an Authorization header with no template gets "Bearer " in front.
    assert connectors.read_secret(row) == {"headers": {"Authorization": "Bearer fake-static-token"}}
    assert row.pending_encrypted is None and row.state_hash is None
    assert [r["id"] for r in c.get("/api/connectors").json()["connections"]] == [body["id"]]


@pytest.mark.parametrize("key", ["some-wrong-key", "forbidden"])
def test_a_key_the_server_answers_401_or_403_to_is_rejected_and_nothing_is_stored(
    registry_file, local_addresses, fake_connector_url, key
):
    registry_file(snapshot_line(FAKE_KEY, fake_connector_url, header(), title="Fake Things"))
    c, owner = fresh_account()
    resp = c.post("/api/connectors", json={"key": FAKE_KEY, "credentials": {"Authorization": key}})
    detail = _refused(resp, 422, "key_rejected")
    assert detail["message"] == "Fake Things didn’t accept the key."
    assert connections_of(owner) == []


def test_a_key_connector_needs_its_key(registry_file, upstream):
    registry_file(
        snapshot_line(
            "dev.two/keys",
            "https://mcp.two.dev/mcp",
            header("X-App-Id", secret=False, hint="Your app id"),
            header("X-Token", required=False),
            header("X-Trace", secret=False, required=False),
            title="Two",
        )
    )
    c, owner = fresh_account()
    fields = [
        {"id": "X-App-Id", "label": "X-App-Id", "hint": "Your app id", "secret": False},
        {"id": "X-Token", "label": "X-Token", "hint": "", "secret": True},
    ]
    for body in (
        {"key": "dev.two/keys"},
        {"key": "dev.two/keys", "credentials": {}},
        {"key": "dev.two/keys", "credentials": {"X-Token": "t"}},  # the required one is missing
        {"key": "dev.two/keys", "credentials": {"X-App-Id": "  "}},
    ):
        detail = _refused(c.post("/api/connectors", json=body), 422, "key_required")
        assert detail == {"code": "key_required", "message": "Two needs a key.", "fields": fields}
    assert upstream.calls == [] and connections_of(owner) == []

    # The required field alone is enough; the optional one is sent only when given.
    resp = c.post(
        "/api/connectors", json={"key": "dev.two/keys", "credentials": {"X-App-Id": "app"}}
    )
    assert resp.status_code == 201, resp.text
    assert upstream.calls == [("https://mcp.two.dev/mcp", "streamable-http", {"X-App-Id": "app"})]


@pytest.mark.parametrize(
    "credentials",
    [
        {"Authorization": "k", "X-Other": "v"},  # an id the entry doesn't declare
        {"authorization": "k"},  # ids are the declared header names, exactly
        {"Authorization": "line\nbreak"},
        {"Authorization": "carriage\rreturn"},
        {"Authorization": "nul\x00"},
        {"Authorization": "snow☃man"},  # a header value is ASCII
        {"Authorization": 7},
        {"Authorization": "k" * 5000},
    ],
)
def test_a_key_tvashtr_cant_send_is_invalid_and_nothing_is_stored(
    registry_file, upstream, credentials
):
    registry_file(key_server())
    c, owner = fresh_account()
    body = {"key": "com.apify/apify-mcp-server", "credentials": credentials}
    detail = _refused(c.post("/api/connectors", json=body), 422, "invalid_key")
    assert detail["message"] == "That isn’t a key Apify takes. Check it and try again."
    assert upstream.calls == [] and connections_of(owner) == []


@pytest.mark.parametrize(
    ("declared", "given", "sent"),
    [
        (header(template="Bearer {api_key}"), "abc", "Bearer abc"),
        (header(template="Token token={key}"), " abc ", "Token token=abc"),
        (header(), "abc", "Bearer abc"),
        (header(), "Bearer abc", "Bearer abc"),  # already a scheme and a token
        (header(), "Basic dXNlcjpwYXNz", "Basic dXNlcjpwYXNz"),
        (header("X-API-Key"), "abc", "abc"),
        (header("X-API-Key", template="{key}"), "abc", "abc"),
    ],
)
def test_a_key_becomes_its_header(registry_file, upstream, declared, given, sent):
    registry_file(snapshot_line("dev.keyed/mcp", "https://mcp.keyed.dev/mcp", declared))
    c, _ = fresh_account()
    body = {"key": "dev.keyed/mcp", "credentials": {declared["name"]: given}}
    resp = c.post("/api/connectors", json=body)
    assert resp.status_code == 201, resp.text
    assert upstream.calls == [
        ("https://mcp.keyed.dev/mcp", "streamable-http", {declared["name"]: sent})
    ]
    assert connectors.read_secret(connection_row(resp.json()["id"])) == {
        "headers": {declared["name"]: sent}
    }


def test_a_key_server_that_doesnt_answer_is_unreachable_and_nothing_is_stored(
    registry_file, upstream
):
    registry_file(key_server())
    c, owner = fresh_account()
    body = {"key": "com.apify/apify-mcp-server", "credentials": {"Authorization": "k"}}
    for answer in (
        connector_upstream.UpstreamUnreachable("timeout"),
        connector_upstream.UpstreamRefused(404),
    ):
        upstream.answer = answer
        detail = _refused(c.post("/api/connectors", json=body), 502, "unreachable")
        assert detail["message"] == "We couldn’t reach mcp.apify.com. Try again."
    assert connections_of(owner) == []


# ---- the refusals before anything is fetched ----


def test_unknown_connector(upstream, discovery):
    c, owner = fresh_account()
    for body in ({"key": "dev.nobody/nothing"}, {"key": ""}, {}, {"access": "read"}):
        detail = _refused(c.post("/api/connectors", json=body), 404, "unknown_connector")
        assert detail["message"] == "We couldn’t find that connector."
    assert upstream.calls == [] and discovery.calls == [] and connections_of(owner) == []


def test_already_connected_names_the_connection(upstream, discovery):
    c, owner = fresh_account()
    for status in ("connected", "needs_signin"):
        key = "supabase" if status == "connected" else "notion"
        cid = add_connection(owner, key, status=status)
        detail = _refused(c.post("/api/connectors", json={"key": key}), 409, "already_connected")
        assert detail == {
            "code": "already_connected",
            "message": f"{FEATURED[key]['name']} is already connected.",
            "connection_id": cid,
        }
    assert upstream.calls == [] and discovery.calls == []
    assert len(connections_of(owner)) == 2


def test_another_accounts_connection_doesnt_stop_yours(upstream, discovery, unauth_client):
    c, owner = fresh_account()
    _, other = fresh_account()
    theirs = add_connection(other, "linear")
    resp = c.post("/api/connectors", json={"key": "linear"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["id"] != theirs
    assert [r.owner_id for r in connections_of(owner)] == [owner]
    assert len(connections_of(other)) == 1

    assert unauth_client.post("/api/connectors", json={"key": "linear"}).status_code == 401


def test_coming_soon(monkeypatch, upstream, discovery):
    from pydantic import SecretStr

    monkeypatch.setattr(get_settings(), "google_oauth_client_id", "")
    monkeypatch.setattr(get_settings(), "google_oauth_client_secret", SecretStr(""))
    c, owner = fresh_account()
    for key, name in (("hubspot", "HubSpot"), ("google-drive", "Google Drive")):
        detail = _refused(c.post("/api/connectors", json={"key": key}), 409, "coming_soon")
        assert detail["message"] == f"{name} isn’t available yet."
    assert discovery.calls == [] and connections_of(owner) == []


def test_invalid_access(monkeypatch, upstream, discovery):
    from pydantic import SecretStr

    monkeypatch.setattr(get_settings(), "google_oauth_client_id", "id.apps.googleusercontent.com")
    monkeypatch.setattr(get_settings(), "google_oauth_client_secret", SecretStr("shh"))
    c, owner = fresh_account()
    detail = _refused(
        c.post("/api/connectors", json={"key": "google-drive", "access": "write"}),
        422,
        "invalid_access",
    )
    assert detail["message"] == "Google Drive can only be connected read only."
    for access in ("admin", "", None, 3):
        _refused(
            c.post("/api/connectors", json={"key": "linear", "access": access}),
            422,
            "invalid_access",
        )
    assert discovery.calls == [] and connections_of(owner) == []


@pytest.mark.parametrize(
    "url",
    [
        "http://mcp.acme.dev/mcp",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "mcp.acme.dev/mcp",
        "https://user@mcp.acme.dev/mcp",
        "https://mcp.acme.dev\\@evil.example/mcp",
        "https://private.acme.dev/mcp",  # resolves to 10.0.0.5 below
        "https://" + "a" * 2100 + ".dev/mcp",
        "",
        7,
    ],
)
def test_invalid_url(monkeypatch, upstream, discovery, url):
    settings = get_settings()
    monkeypatch.setattr(settings, "connectors_allow_local", False)

    def getaddrinfo(host, port, **_):
        address = "10.0.0.5" if host.startswith("private.") else "93.184.216.34"
        return [(2, 1, 6, "", (address, port))]

    monkeypatch.setattr(connector_net, "_getaddrinfo", getaddrinfo)
    c, owner = fresh_account()
    detail = _refused(
        c.post("/api/connectors", json={"url": url, "name": "Acme"}), 422, "invalid_url"
    )
    assert detail["message"] == "Use an https:// address, like https://mcp.example.com/mcp."
    assert upstream.calls == [] and discovery.calls == [] and connections_of(owner) == []


def test_a_custom_key_is_checked_like_a_custom_address(monkeypatch, upstream, discovery):
    """``{"key": "custom:<host><path>"}`` names the same thing as ``{"url": …}``: the address
    guard isn't skipped by spelling it as a key."""
    monkeypatch.setattr(get_settings(), "connectors_allow_local", False)

    def getaddrinfo(host, port, **_):
        literal = host[0].isdigit() or ":" in host  # an IP address resolves to itself
        address = host if literal else "10.0.0.5" if host.startswith("private.") else PUBLIC_IP
        return [(2, 1, 6, "", (address, port))]

    monkeypatch.setattr(connector_net, "_getaddrinfo", getaddrinfo)
    c, owner = fresh_account()
    for key in ("custom:private.acme.dev/mcp", "custom:127.0.0.1/mcp", "custom:[::1]:8443/mcp"):
        _refused(c.post("/api/connectors", json={"key": key}), 422, "invalid_url")
    assert upstream.calls == [] and discovery.calls == [] and connections_of(owner) == []

    discovery.answer = DISCOVERY
    resp = c.post("/api/connectors", json={"key": "custom:mcp.acme.dev/mcp", "name": "Acme"})
    assert resp.status_code == 201, resp.text
    assert (resp.json()["connector_key"], resp.json()["name"]) == (
        "custom:mcp.acme.dev/mcp",
        "Acme",
    )
    assert discovery.calls[0][0] == "https://mcp.acme.dev/mcp"


# ---- no key: sign-in discovery, or no sign-in at all ----


@pytest.fixture
def public_dns(monkeypatch):
    monkeypatch.setattr(get_settings(), "connectors_allow_local", False)
    monkeypatch.setattr(
        connector_net,
        "_getaddrinfo",
        lambda host, port, **_: [(2, 1, 6, "", ("93.184.216.34", port))],
    )


def test_a_sign_in_found_makes_a_pending_connection_that_knows_its_sign_in_host(
    discovery, upstream
):
    discovery.answer = DISCOVERY
    c, owner = fresh_account()
    resp = c.post("/api/connectors", json={"key": "supabase"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["status"], body["auth_kind"], body["access"]) == ("pending", "oauth", "read")
    assert (body["signin_host"], body["signin_host_differs"]) == ("api.supabase.com", False)
    assert (body["signin_pending"], body["tools"], body["connected_at"]) == (False, None, None)
    assert (body["name"], body["slug"], body["host"]) == (
        "Supabase",
        "supabase",
        "mcp.supabase.com",
    )

    assert discovery.calls == [("https://mcp.supabase.com/mcp", FEATURED["supabase"])]
    assert upstream.calls == []  # nothing is listed, and nothing is registered, before the sign-in
    row = connection_row(body["id"])
    # What discovery found, and nothing of a started sign-in.
    assert connectors.read_secret(row, pending=True) == {
        "issuer": "https://api.supabase.com",
        "iss_supported": True,
        "authorization_endpoint": "https://api.supabase.com/v1/oauth/authorize",
        "token_endpoint": "https://api.supabase.com/v1/oauth/token",
        "revocation_endpoint": "https://api.supabase.com/v1/oauth/revoke",
        "resource": "https://mcp.supabase.com/mcp",
        "scope": "projects:read",
    }
    assert row.state_hash is None and row.secret_encrypted is None
    assert (row.url, row.transport) == ("https://mcp.supabase.com/mcp", "streamable-http")

    # Pending rows are not listed, not marked in the catalog, and can be read by id.
    assert c.get("/api/connectors").json() == {"connections": []}
    assert c.get("/api/connectors/catalog?q=supabase").json()["items"][0]["connection_id"] is None
    assert c.get(f"/api/connectors/{body['id']}").json()["status"] == "pending"


def test_discovery_without_the_optional_fields_stores_only_what_it_found(discovery):
    discovery.answer = connector_oauth.Discovery(
        issuer="https://mcp.linear.app",
        authorization_endpoint="https://mcp.linear.app/authorize",
        token_endpoint="https://mcp.linear.app/token",
        resource="https://mcp.linear.app/mcp",
    )
    c, _ = fresh_account()
    body = c.post("/api/connectors", json={"key": "linear", "access": "write"}).json()
    assert body["access"] == "write"
    assert connectors.read_secret(connection_row(body["id"]), pending=True) == {
        "issuer": "https://mcp.linear.app",
        "iss_supported": False,
        "authorization_endpoint": "https://mcp.linear.app/authorize",
        "token_endpoint": "https://mcp.linear.app/token",
        "resource": "https://mcp.linear.app/mcp",
    }


def test_a_pending_connection_is_reused(discovery):
    discovery.answer = DISCOVERY
    c, owner = fresh_account()
    first = c.post("/api/connectors", json={"key": "supabase"}).json()
    # A sign-in was started and abandoned; connecting again starts over on the same row.
    add_state = connection_row(first["id"])
    assert add_state.state_hash is None
    from tvashtr.db import session_scope
    from tvashtr.models import ConnectorConnection

    with session_scope() as s:
        row = s.get(ConnectorConnection, add_state.id)
        row.state_hash = "abandoned-" + owner.hex
        connectors.write_secret(row, {"code_verifier": "OLD", "started_at": 1}, pending=True)

    again = c.post("/api/connectors", json={"key": "supabase", "access": "write"})
    assert again.status_code == 201, again.text
    assert (again.json()["id"], again.json()["access"], again.json()["slug"]) == (
        first["id"],
        "write",
        first["slug"],
    )
    rows = connections_of(owner)
    assert len(rows) == 1 and rows[0].state_hash is None
    assert "code_verifier" not in connectors.read_secret(rows[0], pending=True)


def test_a_sign_in_tvashtr_cant_use_and_a_server_that_doesnt_answer(discovery, upstream):
    c, owner = fresh_account()
    discovery.answer = connector_oauth.CannotRegister("no registration")
    detail = _refused(c.post("/api/connectors", json={"key": "linear"}), 422, "cannot_register")
    assert detail["message"] == (
        "Linear needs an app registered with it before Tvashtr can sign in."
    )
    discovery.answer = connector_oauth.Unreachable("timeout")
    detail = _refused(c.post("/api/connectors", json={"key": "linear"}), 502, "unreachable")
    assert detail["message"] == "We couldn’t reach mcp.linear.app. Try again."
    assert upstream.calls == [] and connections_of(owner) == []


def test_a_catalog_server_with_no_sign_in_that_lists_its_tools_connects_without_one(
    registry_file, discovery, upstream
):
    registry_file(server("dev.open/mcp", title="Open Data"))
    c, owner = fresh_account()
    resp = c.post("/api/connectors", json={"key": "dev.open/mcp"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["status"], body["auth_kind"], body["signin_host"]) == ("connected", "none", None)
    assert [t["name"] for t in body["tools"]] == ["list_things", "create_thing"]
    assert body["connected_at"] is not None
    assert upstream.calls == [("https://mcp.acme.dev/mcp", "streamable-http", {})]
    row = connection_row(body["id"])
    assert row.secret_encrypted is None and row.pending_encrypted is None


def test_no_sign_in_and_the_server_wants_credentials(registry_file, discovery, upstream):
    registry_file(server("dev.closed/mcp", title="Closed"))
    c, owner = fresh_account()
    for answer in (
        connector_upstream.UpstreamUnauthorized(),
        connector_upstream.UpstreamRefused(403),
    ):
        upstream.answer = answer
        detail = _refused(
            c.post("/api/connectors", json={"key": "dev.closed/mcp"}), 422, "no_signin"
        )
        assert detail["message"] == (
            "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and "
            "keep the key as a secret."
        )
    upstream.answer = connector_upstream.UpstreamUnreachable("down")
    _refused(c.post("/api/connectors", json={"key": "dev.closed/mcp"}), 502, "unreachable")
    assert connections_of(owner) == []


# ---- a custom address ----


def test_a_custom_address_with_a_sign_in(discovery, upstream, public_dns):
    discovery.answer = connector_oauth.Discovery(
        issuer="https://auth.acme.dev",
        authorization_endpoint="https://login.elsewhere.io/authorize",
        token_endpoint="https://auth.acme.dev/token",
        resource="https://mcp.acme.dev/mcp",
    )
    c, owner = fresh_account()
    resp = c.post(
        "/api/connectors", json={"url": "https://MCP.acme.dev/mcp?team=7", "name": " Acme "}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["connector_key"], body["name"], body["slug"]) == (
        "custom:mcp.acme.dev/mcp",
        "Acme",
        "acme",
    )
    assert (body["featured"], body["reviewed"], body["read_only_by"]) == (
        False,
        False,
        "annotations",
    )
    assert (body["status"], body["host"]) == ("pending", "mcp.acme.dev")
    # The sign-in page is on another site than the server: the UI shows it before continuing.
    assert (body["signin_host"], body["signin_host_differs"]) == ("login.elsewhere.io", True)
    assert connection_row(body["id"]).url == "https://MCP.acme.dev/mcp?team=7"
    [(url, entry)] = discovery.calls
    assert url == "https://MCP.acme.dev/mcp?team=7"
    assert (entry["key"], entry["featured"]) == ("custom:mcp.acme.dev/mcp", False)
    assert "oauth_hosts" not in entry and "client" not in entry

    # No name given: the host stands in.
    other = c.post("/api/connectors", json={"url": "https://mcp.other.dev/x"}).json()
    assert (other["name"], other["slug"]) == ("mcp.other.dev", "mcp-other-dev")


def test_a_custom_address_without_a_sign_in_is_refused_even_when_it_lists_tools(
    discovery, upstream, public_dns
):
    c, owner = fresh_account()
    detail = _refused(
        c.post("/api/connectors", json={"url": "https://mcp.acme.dev/mcp", "name": "Acme"}),
        422,
        "no_signin",
    )
    assert "didn’t offer an OAuth sign-in" in detail["message"]
    assert upstream.calls == []  # an open custom server is never connected, so it isn't asked
    assert connections_of(owner) == []


# ---- the slug ----


def test_the_slug_comes_from_the_name_and_is_unique_per_account(discovery, public_dns):
    discovery.answer = DISCOVERY
    c, owner = fresh_account()
    other_c, _ = fresh_account()

    def connect(client, url: str, name: str) -> str:
        resp = client.post("/api/connectors", json={"url": url, "name": name})
        assert resp.status_code == 201, resp.text
        assert re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", resp.json()["slug"])
        return resp.json()["slug"]

    assert connect(c, "https://one.acme.dev/mcp", "Acme") == "acme"
    assert connect(c, "https://two.acme.dev/mcp", "ACME!") == "acme-2"
    assert connect(c, "https://three.acme.dev/mcp", "acme") == "acme-3"
    assert connect(other_c, "https://one.acme.dev/mcp", "Acme") == "acme"  # per account
    assert (
        connect(c, "https://four.acme.dev/mcp", "  Über-fancy  MCP_server!! ")
        == "ber-fancy-mcp-server"
    )
    assert connect(c, "https://five.acme.dev/mcp", "日本語") == "connector"
    long = connect(c, "https://six.acme.dev/mcp", "x" * 60)
    assert long == "x" * 40
    assert connect(c, "https://seven.acme.dev/mcp", "x" * 60) == "x" * 38 + "-2"
    # A name is cut at 60 characters.
    resp = c.post("/api/connectors", json={"url": "https://eight.acme.dev/mcp", "name": "n" * 90})
    assert resp.json()["name"] == "n" * 60
