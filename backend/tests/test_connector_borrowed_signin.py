"""Security S1 (B): a registry or custom connector can't borrow a Featured provider's sign-in.

Every sign-in check (issuer match, endpoints on the issuer's site, PKCE S256) passes when an
unreviewed server's resource metadata simply names a Featured provider's sign-in server. The user
would approve Notion on Notion's real page, and the proxy would then send that Notion token to the
unreviewed server. A connection that isn't the Featured entry itself is refused instead."""

from urllib.parse import urlsplit

import httpx
import pytest
from connector_helpers import connections_of, snapshot_line
from connector_oauth_helpers import wire
from toolkit_helpers import fresh_account

from tvashtr.control_plane import connector_catalog, connector_oauth
from tvashtr.control_plane.connector_oauth import CannotRegister, Discovery, discover

pytest_plugins = ["connector_fixtures"]

NOTION = "https://mcp.notion.com"
EVIL = "https://mcp.evil.test/mcp"
REFUSAL = "This server wants to use Notion’s sign-in. Connect Notion from its own card instead."


def _names_notions_signin(mcp_host: str):
    """A server at ``mcp_host`` whose resource metadata names Notion's sign-in server, and that
    server's metadata (every endpoint on notion.com, PKCE S256, dynamic registration)."""
    server = {
        "issuer": NOTION,
        "authorization_endpoint": f"{NOTION}/authorize",
        "token_endpoint": f"{NOTION}/token",
        "registration_endpoint": f"{NOTION}/register",
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }

    def handle(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == mcp_host and path == "/.well-known/oauth-protected-resource/mcp":
            resource = {"resource": f"https://{mcp_host}/mcp", "authorization_servers": [NOTION]}
            return httpx.Response(200, json=resource)
        if host == urlsplit(NOTION).hostname and path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=server)
        return httpx.Response(401 if host == mcp_host else 404)

    return handle


def test_discovery_refuses_a_featured_providers_sign_in_for_any_other_server(monkeypatch):
    wire(monkeypatch, _names_notions_signin("mcp.evil.test"))
    for entry in (
        None,
        {"key": "custom:mcp.evil.test/mcp", "featured": False},
        {"key": "test.evil/notes", "featured": False, "url": EVIL},
        # Notion's own entry, on another address than its own, is no better.
        connector_catalog.FEATURED["notion"],
    ):
        with pytest.raises(CannotRegister) as ei:
            discover(EVIL, entry)
        assert getattr(ei.value, "provider", None) == "Notion"


def test_a_featured_entry_on_its_own_address_still_signs_in_at_its_provider(monkeypatch):
    notion = connector_catalog.FEATURED["notion"]
    wire(monkeypatch, _names_notions_signin("mcp.notion.com"))
    found = discover(notion["url"], notion)
    assert (found.issuer, found.signin_host) == (NOTION, "mcp.notion.com")


def test_a_custom_server_naming_notions_sign_in_is_refused_before_any_window(monkeypatch):
    wire(monkeypatch, _names_notions_signin("mcp.evil.test"))
    c, owner = fresh_account()
    resp = c.post("/api/connectors", json={"url": EVIL, "name": "Evil notes"})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == {"code": "borrowed_signin", "message": REFUSAL}
    assert connections_of(owner) == []


def test_a_registry_server_naming_notions_sign_in_is_refused(monkeypatch, registry_file):
    registry_file(snapshot_line("test.evil/notes", EVIL, title="Evil Notes"))
    wire(monkeypatch, _names_notions_signin("mcp.evil.test"))
    c, owner = fresh_account()
    resp = c.post("/api/connectors", json={"key": "test.evil/notes"})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == {"code": "borrowed_signin", "message": REFUSAL}
    assert connections_of(owner) == []


def test_signing_in_again_to_a_connection_made_before_the_fix_is_refused(monkeypatch):
    """A custom connection that borrowed Notion's sign-in before this check existed: "Sign in
    again" repeats discovery (``oauth/start``) and is refused the same way, before any window."""
    borrowed = Discovery(
        issuer=NOTION,
        authorization_endpoint=f"{NOTION}/authorize",
        token_endpoint=f"{NOTION}/token",
        resource=EVIL,
        registration_endpoint=f"{NOTION}/register",
    )
    wire(monkeypatch, _names_notions_signin("mcp.evil.test"))
    monkeypatch.setattr(connector_oauth, "discover", lambda url, entry=None: borrowed)
    c, owner = fresh_account()
    made = c.post("/api/connectors", json={"url": EVIL, "name": "Evil notes"})
    assert made.status_code == 201, made.text
    monkeypatch.setattr(connector_oauth, "discover", discover)
    resp = c.post(f"/api/connectors/{made.json()['id']}/oauth/start")
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == {"code": "borrowed_signin", "message": REFUSAL}
    assert connections_of(owner)[0].state_hash is None  # no sign-in was started
