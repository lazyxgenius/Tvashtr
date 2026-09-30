"""Connectors OAuth (stream B2): the sign-in routes. ``POST /api/connectors/{id}/oauth/start``,
the public callback and confirm pages, and the client metadata document, against the fake sign-in
server behind ``connector_net.client()``. Contract: ``docs/superpowers/plans/api/connectors.md``."""

import base64
import hashlib
import threading
import time
import uuid
from urllib.parse import parse_qs, parse_qsl, urlsplit

import httpx
import pytest
from connector_oauth_helpers import CALLBACK, connection, load, paths, wire
from fake_connector_server import FakeConnectorServer
from fastapi.testclient import TestClient
from mcp.types import Tool, ToolAnnotations
from pydantic import SecretStr
from toolkit_helpers import fresh_account

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog, connector_upstream, connectors
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import ConnectorConnection

BASE = "https://mcp.fake.test"
MCP = f"{BASE}/mcp"
PENDING_KEYS = {
    "code_verifier", "issuer", "iss_supported", "authorization_endpoint", "token_endpoint",
    "revocation_endpoint", "resource", "scope", "client", "redirect_uri", "started_at",
}  # fmt: skip


def _start(client, connection_id) -> httpx.Response:
    return client.post(f"/api/connectors/{connection_id}/oauth/start")


def _query(authorize_url: str) -> dict:
    return dict(parse_qsl(urlsplit(authorize_url).query))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ---- B2.3: start ----


def test_start_answers_the_authorize_address_with_every_parameter(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)

    resp = _start(c, cid)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"authorize_url", "signin_host", "expires_in"}
    assert (body["signin_host"], body["expires_in"]) == ("mcp.fake.test", 600)
    assert body["authorize_url"].startswith(f"{BASE}/authorize?")
    query = _query(body["authorize_url"])
    assert query.keys() == {
        "response_type", "client_id", "redirect_uri", "state", "code_challenge",
        "code_challenge_method", "resource", "scope",
    }  # fmt: skip
    assert query | {"state": "", "code_challenge": ""} == {
        "response_type": "code",
        "client_id": "client-1",  # registered just now
        "redirect_uri": CALLBACK,
        "state": "",
        "code_challenge": "",
        "code_challenge_method": "S256",
        "resource": MCP,
        "scope": "read",
    }
    assert len(query["state"]) >= 43  # secrets.token_urlsafe(32)

    row = load(cid)
    # Only the state's hash is stored, and the row is still what it was.
    assert row.state_hash == _sha256(query["state"])
    assert (row.status, row.secret_encrypted, row.last_error) == ("pending", None, None)
    pending = connectors.read_secret(row, pending=True)
    assert set(pending) == PENDING_KEYS
    assert query["state"] not in repr(pending)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(pending["code_verifier"].encode()).digest())
    assert challenge.rstrip(b"=").decode() == query["code_challenge"]
    assert pending | {"code_verifier": "", "started_at": 0} == {
        "code_verifier": "",
        "issuer": BASE,
        "iss_supported": False,
        "authorization_endpoint": f"{BASE}/authorize",
        "token_endpoint": f"{BASE}/token",
        "revocation_endpoint": f"{BASE}/revoke",
        "resource": MCP,
        "scope": "read",
        "client": {
            "client_id": "client-1",
            "auth_method": "none",
            "kind": "dcr",
            "redirect_uri": CALLBACK,
        },
        "redirect_uri": CALLBACK,
        "started_at": 0,
    }
    assert abs(pending["started_at"] - time.time()) < 30
    serialized = connectors.serialize(row)
    assert (serialized["signin_pending"], serialized["signin_host"]) == (True, "mcp.fake.test")
    assert pending["code_verifier"] not in resp.text and "client_secret" not in resp.text


def test_start_sends_the_metadatas_resource_verbatim_and_keeps_an_endpoints_own_query(monkeypatch):
    fake = FakeConnectorServer(BASE)

    def handle(request: httpx.Request) -> httpx.Response:
        reply = fake.handle(request)
        if "oauth-protected-resource" in request.url.path:
            return httpx.Response(200, json=reply.json() | {"resource": f"{BASE}/"})
        if "oauth-authorization-server" in request.url.path:
            endpoint = {"authorization_endpoint": f"{BASE}/authorize?tenant=acme"}
            return httpx.Response(200, json=reply.json() | endpoint)
        return reply

    wire(monkeypatch, handle)
    c, owner = fresh_account()
    body = _start(c, connection(owner, fake)).json()
    assert body["authorize_url"].startswith(f"{BASE}/authorize?tenant=acme&response_type=code&")
    assert _query(body["authorize_url"])["resource"] == f"{BASE}/"  # not the MCP address


def test_a_second_start_replaces_the_first(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)

    first = _query(_start(c, cid).json()["authorize_url"])
    second = _query(_start(c, cid).json()["authorize_url"])
    assert first["state"] != second["state"]
    assert first["code_challenge"] != second["code_challenge"]
    assert load(cid).state_hash == _sha256(second["state"])
    # The registration made for the first is reused by the second.
    assert first["client_id"] == second["client_id"] == "client-1"
    assert paths(fake).count("/register") == 1


def test_start_on_a_connected_row_changes_neither_its_status_nor_its_sign_in(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    registered = {
        "client_id": "client-7",
        "auth_method": "none",
        "kind": "dcr",
        "redirect_uri": CALLBACK,
    }
    working = {"issuer": BASE, "client": registered, "access_token": "WORKING-TOKEN"}
    cid = connection(owner, fake, status="connected", secret=working)

    resp = _start(c, cid)
    assert resp.status_code == 200, resp.text
    assert _query(resp.json()["authorize_url"])["client_id"] == "client-7"  # reused, same issuer
    assert "/register" not in paths(fake)
    row = load(cid)
    assert row.status == "connected" and connectors.read_secret(row) == working
    assert row.state_hash is not None


def test_start_refuses_a_connection_that_doesnt_sign_in(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    not_oauth = {"code": "not_oauth", "message": "This connector doesn’t sign in."}

    for kind in ("api_key", "none"):
        cid = connection(owner, fake, auth_kind=kind, status="connected")
        resp = _start(c, cid)
        assert (resp.status_code, resp.json()["detail"]) == (409, not_oauth)
    assert fake.requests == []  # refused before anything is fetched

    # An OAuth row whose server no longer offers a sign-in.
    wire(monkeypatch, lambda request: httpx.Response(404))
    cid = connection(owner, fake)
    resp = _start(c, cid)
    assert (resp.status_code, resp.json()["detail"]) == (409, not_oauth)
    assert load(cid).state_hash is None


def test_start_is_a_404_for_another_account_and_needs_a_session(monkeypatch, unauth_client):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    _, owner = fresh_account()
    other, _ = fresh_account()
    cid = connection(owner, fake)

    for connection_id in (cid, uuid.uuid4(), "nope"):
        resp = _start(other, connection_id)
        assert (resp.status_code, resp.json()["detail"]) == (404, "Connector not found.")
    assert _start(unauth_client, cid).status_code == 401
    row = load(cid)
    assert (row.state_hash, row.pending_encrypted) == (None, None)
    assert fake.requests == []


def test_start_says_cannot_register_and_unreachable_and_stores_nothing(monkeypatch):
    fake = FakeConnectorServer(BASE, dcr=False)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake, name="Acme")

    resp = _start(c, cid)
    assert (resp.status_code, resp.json()["detail"]) == (
        422,
        {
            "code": "cannot_register",
            "message": "Acme needs an app registered with it before Tvashtr can sign in.",
        },
    )

    # A mix-up is the same refusal.
    wire(monkeypatch, FakeConnectorServer(BASE, mixup=True).handle)
    assert _start(c, cid).json()["detail"]["code"] == "cannot_register"

    wire(monkeypatch, lambda request: httpx.Response(503))
    resp = _start(c, cid)
    assert (resp.status_code, resp.json()["detail"]) == (
        502,
        {"code": "unreachable", "message": "We couldn’t reach mcp.fake.test. Try again."},
    )
    row = load(cid)
    assert (row.state_hash, row.pending_encrypted, row.status) == (None, None, "pending")


def test_a_featured_entry_pins_its_client_its_scope_and_extra_authorize_parameters(monkeypatch):
    entry = connector_catalog.FEATURED["google-drive"]
    google = "https://accounts.google.com"
    server = {
        "issuer": google,
        "authorization_endpoint": f"{google}/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["openid", "email", "https://www.googleapis.com/auth/drive"],
    }

    def handle(request: httpx.Request) -> httpx.Response:
        if "oauth-protected-resource" in request.url.path:
            resource = {"resource": entry["url"], "authorization_servers": [google]}
            return httpx.Response(200, json=resource)
        if request.url.host == "accounts.google.com":
            return httpx.Response(200, json=server)
        return httpx.Response(405)

    wire(monkeypatch, handle)
    monkeypatch.setattr(get_settings(), "google_oauth_client_id", "tvashtr.apps.example")
    monkeypatch.setattr(get_settings(), "google_oauth_client_secret", SecretStr("G-SECRET"))
    offline = {"access_type": "offline", "prompt": "consent"}
    monkeypatch.setitem(entry, "authorize_params", offline)
    c, owner = fresh_account()
    fake = FakeConnectorServer("https://drivemcp.googleapis.com")
    cid = connection(owner, fake, connector_key="google-drive", url=entry["url"])

    resp = _start(c, cid)
    assert resp.status_code == 200, resp.text
    assert resp.json()["signin_host"] == "accounts.google.com"
    query = _query(resp.json()["authorize_url"])
    assert query["client_id"] == "tvashtr.apps.example"
    assert query["scope"] == "https://www.googleapis.com/auth/drive.readonly"  # not the full list
    assert query | offline == query
    pending = connectors.read_secret(load(cid), pending=True)
    assert pending["scope"] == query["scope"]
    assert pending["client"]["kind"] == "preregistered" and "G-SECRET" not in repr(pending)

    # The same entry's key on another address pins nothing: no Google client, so no sign-in.
    c2, owner2 = fresh_account()
    elsewhere = connection(
        owner2, fake, connector_key="google-drive", url="https://mcp.evil.test/mcp/v1"
    )
    other = _start(c2, elsewhere)
    assert (other.status_code, other.json()["detail"]["code"]) == (422, "cannot_register")


# ---- B2.4: the callback, the confirm step and their pages ----

CALLBACK_PATH = "/api/connectors/oauth/callback"
CONFIRM_PATH = "/api/connectors/oauth/confirm"
EXPIRED = "This sign-in link has expired. Go back to Tvashtr and try again."
CONNECTED = "Fake is connected. You can close this window."
NOT_FINISHED = "Fake didn’t finish the sign-in. Try again."
WORKING = {
    "issuer": BASE,
    "client": {"client_id": "client-7", "auth_method": "none", "kind": "dcr"},
    "authorization_endpoint": f"{BASE}/authorize",
    "token_endpoint": f"{BASE}/token",
    "resource": MCP,
    "access_token": "WORKING-TOKEN",
    "refresh_token": "WORKING-REFRESH",
}


@pytest.fixture
def listed(monkeypatch) -> list[tuple]:
    """The provider's tool list after a sign-in (the ``MockTransport`` fake doesn't speak MCP).
    Records what ``connector_upstream.list_tools_sync`` was asked."""
    asked: list[tuple] = []
    schema = {"type": "object"}
    tools = [
        Tool(
            name="list_things", inputSchema=schema, annotations=ToolAnnotations(readOnlyHint=True)
        ),
        Tool(name="create_thing", inputSchema=schema),
    ]

    def list_tools_sync(url, transport, headers, timeout=10):
        asked.append((url, transport, headers))
        return tools

    monkeypatch.setattr(connector_upstream, "list_tools_sync", list_tools_sync)
    return asked


def _allow(fake: FakeConnectorServer, client, connection_id) -> dict:
    """Start a sign-in and press Allow on the provider's page: the query the provider sends the
    browser back to the callback with."""
    started = _start(client, connection_id)
    assert started.status_code == 200, started.text
    allowed = fake.handle(httpx.Request("POST", started.json()["authorize_url"]))
    assert allowed.status_code == 302, allowed.text
    back = urlsplit(allowed.headers["location"])
    assert f"{back.scheme}://{back.netloc}{back.path}" == CALLBACK
    return dict(parse_qsl(back.query))


def _page(resp: httpx.Response) -> str:
    """Every page: a 200 HTML answer that is never cached, framed or named in a Referer."""
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/html")
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["x-frame-options"] == "DENY"
    return resp.text


def _token_requests(fake: FakeConnectorServer) -> list[dict]:
    return [
        {key: value[0] for key, value in parse_qs(request.content.decode()).items()}
        for request in fake.requests
        if request.url.path == "/token"
    ]


def _email(client) -> str:
    return client.get("/api/auth/me").json()["email"]


def test_the_callback_with_the_owners_session_connects(monkeypatch, listed):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)
    verifier = connectors.read_secret(load(cid), pending=True)["code_verifier"]

    page = _page(c.get(CALLBACK_PATH, params=back))
    assert CONNECTED in page and "window.close()" in page

    row = load(cid)
    assert (row.status, row.last_error, row.state_hash, row.pending_encrypted) == (
        "connected",
        None,
        None,
        None,
    )
    assert row.connected_at is not None
    [exchange] = _token_requests(fake)
    assert exchange == {
        "grant_type": "authorization_code",
        "code": back["code"],
        "redirect_uri": CALLBACK,
        "client_id": "client-1",
        "code_verifier": verifier,
        "resource": MCP,
    }
    secret = connectors.read_secret(row)
    assert set(secret) == {
        "issuer", "client", "authorization_endpoint", "token_endpoint", "revocation_endpoint",
        "resource", "scope", "access_token", "refresh_token", "expires_at",
    }  # fmt: skip
    assert secret["access_token"] in fake.access_tokens
    assert secret["refresh_token"] in fake.refresh_tokens
    assert abs(secret["expires_at"] - (time.time() + 3600)) < 30
    assert (secret["issuer"], secret["client"]["client_id"]) == (BASE, "client-1")
    # Encrypted at rest, and never on the page.
    for token in (secret["access_token"], secret["refresh_token"]):
        assert token not in row.secret_encrypted and token not in page
    # The tools were listed with the new token, at the address every stream uses.
    assert listed == [
        (MCP, "streamable-http", {"Authorization": f"Bearer {secret['access_token']}"})
    ]
    assert row.tools == [
        {"name": "list_things", "title": None, "read_only": True},
        {"name": "create_thing", "title": None, "read_only": False},
    ]
    # The sign-in host still reads right once the sign-in in flight is cleared.
    serialized = connectors.serialize(row)
    assert (serialized["signin_host"], serialized["signin_pending"]) == ("mcp.fake.test", False)


def test_without_a_session_the_callback_asks_first_and_the_confirm_step_connects(
    monkeypatch, listed, unauth_client
):
    """Desktop's browser holds no Tvashtr session. Someone could also send you their own sign-in
    link to get your data into their account: the page says whose account it is, in full."""
    fake = FakeConnectorServer(BASE, iss=True)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)
    assert back["iss"] == BASE

    page = _page(unauth_client.get(CALLBACK_PATH, params=back))
    assert f"Connect Fake to the Tvashtr account {_email(c)}?" in page
    assert f'<form method="post" action="{CONFIRM_PATH}">' in page
    for name in ("state", "code", "iss"):
        assert f'<input type="hidden" name="{name}" value="{back[name]}">' in page
    assert ">Connect</button>" in page
    # Showing the page used nothing up and asked the provider nothing.
    row = load(cid)
    assert row.state_hash == _sha256(back["state"]) and row.status == "pending"
    assert _token_requests(fake) == []
    assert _page(unauth_client.get(CALLBACK_PATH, params=back)) == page  # it can be shown again

    done = _page(unauth_client.post(CONFIRM_PATH, data=back))
    assert CONNECTED in done
    row = load(cid)
    assert (row.status, row.state_hash) == ("connected", None)
    assert len(_token_requests(fake)) == 1 and len(listed) == 1


def test_another_accounts_session_connects_nothing_and_says_how_to_go_on(monkeypatch, listed):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    other, _ = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)

    page = _page(other.get(CALLBACK_PATH, params=back))
    assert "This browser is signed in to Tvashtr as a different account." in page
    assert "Nothing was connected." in page
    assert "Log out of Tvashtr in this browser, then start the sign-in again." in page
    assert _email(c) not in page  # the other account isn't told whose sign-in it was

    row = load(cid)
    assert (row.status, row.secret_encrypted, row.state_hash) == ("pending", None, None)
    assert "code_verifier" not in connectors.read_secret(row, pending=True)
    assert connectors.serialize(row)["signin_pending"] is False
    assert row.last_error and "different account" in row.last_error
    assert _token_requests(fake) == [] and listed == []
    # The link is used up, for the owner too.
    assert EXPIRED in _page(c.get(CALLBACK_PATH, params=back))


def test_an_unknown_a_reused_and_an_expired_state_are_the_expired_page(
    monkeypatch, listed, unauth_client
):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)

    for query in ({}, {"code": "x"}, {"state": "never-issued", "code": "x"}):
        assert EXPIRED in _page(c.get(CALLBACK_PATH, params=query))
        assert EXPIRED in _page(unauth_client.post(CONFIRM_PATH, data=query))

    back = _allow(fake, c, cid)
    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=back))
    assert EXPIRED in _page(c.get(CALLBACK_PATH, params=back))  # a state works once
    assert EXPIRED in _page(unauth_client.post(CONFIRM_PATH, data=back))
    assert len(_token_requests(fake)) == 1

    # Started more than ten minutes ago.
    back = _allow(fake, c, cid)
    with session_scope() as session:
        row = session.get(ConnectorConnection, cid)
        pending = connectors.read_secret(row, pending=True)
        connectors.write_secret(row, pending | {"started_at": time.time() - 601}, pending=True)
    assert EXPIRED in _page(c.get(CALLBACK_PATH, params=back))
    assert EXPIRED in _page(unauth_client.post(CONFIRM_PATH, data=back))
    assert len(_token_requests(fake)) == 1


def test_an_answer_from_another_issuer_is_not_acted_on(monkeypatch, listed, unauth_client):
    fake = FakeConnectorServer(BASE, iss=True)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)
    good_iss = back.pop("iss")
    started = load(cid)

    def untouched() -> bool:
        row = load(cid)
        return (row.state_hash, row.pending_encrypted, row.last_error, row.status) == (
            started.state_hash,
            started.pending_encrypted,
            None,
            "pending",
        )

    wrong = [
        back | {"iss": "https://login.other-site.test"},
        back | {"iss": good_iss + "/"},  # compared exactly
        back,  # missing, and the server said it would send one
        {"state": back["state"], "error": "access_denied", "iss": "https://evil.test"},
    ]
    for query in wrong:
        assert NOT_FINISHED in _page(c.get(CALLBACK_PATH, params=query))
        assert NOT_FINISHED in _page(unauth_client.get(CALLBACK_PATH, params=query))
        assert NOT_FINISHED in _page(unauth_client.post(CONFIRM_PATH, data=query))
        assert untouched() and _token_requests(fake) == []

    # The right issuer still finishes it.
    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=back | {"iss": good_iss}))


def test_an_issuer_is_checked_when_sent_even_if_the_server_never_promised_one(monkeypatch, listed):
    fake = FakeConnectorServer(BASE)  # no ``iss`` advertised: a missing one is fine
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)
    assert "iss" not in back

    assert NOT_FINISHED in _page(c.get(CALLBACK_PATH, params=back | {"iss": "https://evil.test"}))
    assert _token_requests(fake) == []
    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=back))


def test_access_denied_clears_the_sign_in_and_says_why(monkeypatch, listed, unauth_client):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)
    denied = {"state": back["state"], "error": "access_denied"}

    # No session is needed to be told no.
    page = _page(unauth_client.get(CALLBACK_PATH, params=denied))
    assert "You didn’t allow access on Fake." in page
    row = load(cid)
    assert (row.status, row.state_hash, row.secret_encrypted) == ("pending", None, None)
    assert row.last_error == "You didn’t allow access on Fake."
    pending = connectors.read_secret(row, pending=True)
    # What discovery found stays (the sign-in host is still known, the registration is reused).
    assert "code_verifier" not in pending and "started_at" not in pending
    assert pending["client"]["client_id"] == "client-1"
    serialized = connectors.serialize(row)
    assert (serialized["signin_pending"], serialized["signin_host"]) == (False, "mcp.fake.test")
    assert _token_requests(fake) == []
    assert EXPIRED in _page(c.get(CALLBACK_PATH, params=back))  # the code can't be used after all

    # A callback with neither a code nor an error didn't finish anything.
    back = _allow(fake, c, cid)
    assert NOT_FINISHED in _page(c.get(CALLBACK_PATH, params={"state": back["state"]}))
    row = load(cid)
    assert (row.state_hash, row.last_error) == (None, NOT_FINISHED)


def test_a_failed_exchange_leaves_a_working_sign_in_intact(monkeypatch, listed):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    cid = connection(owner, fake, status="connected", secret=WORKING)
    back = _allow(fake, c, cid)  # "Sign in again"

    page = _page(c.get(CALLBACK_PATH, params=back | {"code": "not-the-code"}))
    assert NOT_FINISHED in page and "window.close()" not in page
    row = load(cid)
    assert (row.status, row.last_error, row.state_hash) == ("connected", NOT_FINISHED, None)
    assert connectors.read_secret(row) == WORKING
    assert len(_token_requests(fake)) == 1 and listed == []

    # So does a token endpoint that doesn't answer.
    back = _allow(fake, c, cid)
    fake.requests.clear()

    def down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503) if request.url.path == "/token" else fake.handle(request)

    wire(monkeypatch, down)
    assert NOT_FINISHED in _page(c.get(CALLBACK_PATH, params=back))
    row = load(cid)
    assert row.status == "connected" and connectors.read_secret(row) == WORKING


def test_sign_in_again_replaces_the_sign_in_and_keeps_the_tools_when_listing_fails(monkeypatch):
    fake = FakeConnectorServer(BASE, confidential=True, expires_in=None)
    wire(monkeypatch, fake.handle)

    def unreachable(url, transport, headers, timeout=10):
        raise connector_upstream.UpstreamUnreachable("down")

    monkeypatch.setattr(connector_upstream, "list_tools_sync", unreachable)
    c, owner = fresh_account()
    seen = [{"name": "old_tool", "title": None, "read_only": True}]
    cid = connection(
        owner,
        fake,
        status="needs_signin",
        secret=WORKING,
        tools=seen,
        last_error="Its sign-in expired.",
    )
    back = _allow(fake, c, cid)

    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=back))  # a failed listing isn't a failure
    row = load(cid)
    assert (row.status, row.last_error, row.tools) == ("connected", None, seen)
    secret = connectors.read_secret(row)
    assert secret["access_token"] in fake.access_tokens
    assert "expires_at" not in secret  # the provider named no expiry
    # The confidential server's client secret was sent with the code, and is kept for refreshes.
    [exchange] = _token_requests(fake)
    assert exchange["client_secret"] == secret["client"]["client_secret"]
    # …and it is a new registration: the stored one was made for another redirect address.
    assert secret["client"]["client_id"] != "client-7"

    # A first sign-in whose listing fails has no tools yet.
    first = connection(owner, fake)
    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=_allow(fake, c, first)))
    assert load(first).tools is None and load(first).status == "connected"


def test_two_callbacks_at_once_with_one_state_make_one_token_request(monkeypatch, listed):
    fake = FakeConnectorServer(BASE)
    together = threading.Barrier(2)

    def slow_token(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            time.sleep(0.3)  # the other callback arrives while this exchange is in flight
        return fake.handle(request)

    wire(monkeypatch, slow_token)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    back = _allow(fake, c, cid)
    pages: list[str] = []

    def arrive() -> None:
        browser = TestClient(app)
        browser.cookies.clear()
        together.wait(timeout=10)
        pages.append(_page(browser.post(CONFIRM_PATH, data=back)))

    threads = [threading.Thread(target=arrive) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert len(_token_requests(fake)) == 1
    assert sorted(CONNECTED in page for page in pages) == [False, True]
    assert sorted(EXPIRED in page for page in pages) == [False, True]
    assert load(cid).status == "connected"


def test_the_row_reads_pending_until_the_outcome_is_written(monkeypatch):
    """The app polls ``signin_pending`` and reads the outcome when it turns false. While the code
    is exchanged and the tools are listed the state is already used up, and the row must not look
    like a sign-in that ended with nothing."""
    fake = FakeConnectorServer(BASE)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    seen: list[tuple] = []

    def look() -> None:
        row = load(cid)
        seen.append((connectors.serialize(row)["signin_pending"], row.status))

    def watching(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            look()
        return fake.handle(request)

    def list_tools_sync(url, transport, headers, timeout=10):
        look()
        return []

    monkeypatch.setattr(connector_upstream, "list_tools_sync", list_tools_sync)
    wire(monkeypatch, fake.handle)
    back = _allow(fake, c, cid)
    wire(monkeypatch, watching)

    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=back))
    assert seen == [(True, "pending"), (True, "pending")]
    row = load(cid)
    assert (connectors.serialize(row)["signin_pending"], row.status, row.tools) == (
        False,
        "connected",
        [],
    )
    # The state was used up all the same: it is not what is stored any more.
    assert EXPIRED in _page(c.get(CALLBACK_PATH, params=back))


def test_a_sign_in_started_during_the_exchange_is_left_in_flight(monkeypatch, listed):
    fake = FakeConnectorServer(BASE)
    c, owner = fresh_account()
    cid = connection(owner, fake)
    newer: list[str] = []

    def starts_again(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token" and not newer:
            newer.append(_query(_start(c, cid).json()["authorize_url"])["state"])
        return fake.handle(request)

    wire(monkeypatch, fake.handle)
    back = _allow(fake, c, cid)
    wire(monkeypatch, starts_again)

    assert CONNECTED in _page(c.get(CALLBACK_PATH, params=back))
    row = load(cid)
    assert row.status == "connected" and connectors.read_secret(row)["access_token"]
    # The newer sign-in is still there to be finished.
    assert row.state_hash == _sha256(newer[0])
    assert "code_verifier" in connectors.read_secret(row, pending=True)


def test_a_connection_removed_during_the_exchange_is_a_failure_page_not_a_crash(
    monkeypatch, listed
):
    fake = FakeConnectorServer(BASE)
    c, owner = fresh_account()
    cid = connection(owner, fake)

    def disconnects(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            with session_scope() as session:
                session.delete(session.get(ConnectorConnection, cid))
        return fake.handle(request)

    wire(monkeypatch, fake.handle)
    back = _allow(fake, c, cid)
    wire(monkeypatch, disconnects)
    assert NOT_FINISHED in _page(c.get(CALLBACK_PATH, params=back))
    assert load(cid) is None


def test_no_text_from_outside_is_rendered_raw(monkeypatch, listed, unauth_client):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    c, owner = fresh_account()
    hostile = '<script>alert("name")</script>'
    cid = connection(owner, fake, name=hostile)
    back = _allow(fake, c, cid)
    breakout = '"><script>alert(1)</script>'

    confirm = _page(unauth_client.get(CALLBACK_PATH, params=back | {"code": breakout}))
    assert "<script>alert" not in confirm
    assert "&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;" in confirm
    assert 'value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"' in confirm

    denied = {"state": back["state"], "error": breakout}
    page = _page(c.get(CALLBACK_PATH, params=denied))
    assert "<script>alert" not in page and breakout not in page
    assert load(cid).last_error == f"You didn’t allow access on {hostile}."  # text, escaped on use
