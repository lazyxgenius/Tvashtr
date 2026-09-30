"""Connectors OAuth (stream B2): the sign-in routes. ``POST /api/connectors/{id}/oauth/start``,
the public callback and confirm pages, and the client metadata document, against the fake sign-in
server behind ``connector_net.client()``. Contract: ``docs/superpowers/plans/api/connectors.md``."""

import base64
import hashlib
import time
import uuid
from urllib.parse import parse_qsl, urlsplit

import httpx
from connector_oauth_helpers import CALLBACK, connection, load, paths, wire
from fake_connector_server import FakeConnectorServer
from pydantic import SecretStr
from toolkit_helpers import fresh_account

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog, connectors

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
