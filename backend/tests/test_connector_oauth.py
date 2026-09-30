"""Connectors OAuth (stream B2): discovery, the client choice and registration, and tokens, all
against the fake sign-in server behind ``connector_net.client()``.
Contract: ``docs/superpowers/plans/api/connectors.md`` (OAuth, Tokens)."""

import base64
import contextlib
import json
import threading
import time
from dataclasses import replace
from urllib.parse import parse_qs

import httpx
import pytest
from connector_oauth_helpers import (
    CALLBACK,
    PRIVATE_HOST,
    TVASHTR,
    connection,
    load,
    paths,
    signed_in,
    user,
    wire,
)
from fake_connector_server import OTHER_SITE, FakeConnectorServer
from pydantic import SecretStr
from sqlalchemy import text

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog, connector_oauth, connectors
from tvashtr.control_plane.connector_oauth import (
    CannotRegister,
    Discovery,
    SignInRefused,
    Unreachable,
    choose_client,
    client_kind,
    discover,
    ensure_access_token,
    revoke,
)
from tvashtr.db import get_engine, session_scope
from tvashtr.models import ConnectorConnection

BASE = "https://mcp.fake.test"
MCP = f"{BASE}/mcp"
RESOURCE_PATH = "/.well-known/oauth-protected-resource/mcp"
SERVER_PATH = "/.well-known/oauth-authorization-server"


def _rewrite(fake: FakeConnectorServer, path: str, change):
    """The fake's handler, with the JSON document at ``path`` passed through ``change``."""

    def handle(request: httpx.Request) -> httpx.Response:
        reply = fake.handle(request)
        if request.url.path == path and reply.status_code == 200:
            return httpx.Response(200, json=change(reply.json()))
        return reply

    return handle


# ---- B2.1: discovery ----


def test_discovery_is_led_by_the_401s_header(monkeypatch):
    """The header names where the resource metadata is; here that is not a well-known address, and
    the well-known ones answer 404, so only the header can have led there."""
    fake = FakeConnectorServer(BASE)

    def handle(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/mcp":
            fake.requests.append(request)
            challenge = f'Bearer resource_metadata="{BASE}/meta/resource", scope="read"'
            return httpx.Response(401, headers={"WWW-Authenticate": challenge})
        if path == "/meta/resource":
            path = RESOURCE_PATH
        elif "oauth-protected-resource" in path:
            fake.requests.append(request)
            return httpx.Response(404)
        return fake.handle(httpx.Request(request.method, BASE + path))

    wire(monkeypatch, handle)
    assert discover(MCP) == Discovery(
        issuer=BASE,
        authorization_endpoint=f"{BASE}/authorize",
        token_endpoint=f"{BASE}/token",
        resource=MCP,
        registration_endpoint=f"{BASE}/register",
        revocation_endpoint=f"{BASE}/revoke",
        scope="read",  # the 401's scope wins over the metadata's scopes_supported
        iss_supported=False,
        cimd_supported=False,
        token_auth_methods=("none", "client_secret_post", "client_secret_basic"),
    )
    # One unauthenticated request, the resource metadata, the server metadata. Nothing else.
    assert paths(fake) == ["/mcp", RESOURCE_PATH, SERVER_PATH]
    assert fake.requests[0].method == "GET" and "authorization" not in fake.requests[0].headers


def test_the_well_known_address_is_tried_when_the_first_request_answers_405(monkeypatch):
    fake = FakeConnectorServer(BASE, cimd=True, iss=True)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/mcp":
            fake.requests.append(request)
            return httpx.Response(405)
        return fake.handle(request)

    wire(monkeypatch, handle)
    found = discover(MCP)
    assert found.issuer == BASE and found.resource == MCP
    assert found.scope == "read write"  # no 401, so the resource metadata's scopes_supported
    assert (found.iss_supported, found.cimd_supported) == (True, True)
    assert paths(fake) == ["/mcp", RESOURCE_PATH, SERVER_PATH]


def test_no_resource_metadata_falls_back_to_the_origins_own_server_metadata(monkeypatch):
    fake = FakeConnectorServer(BASE, no_resource_metadata=True)  # as Intercom
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    assert found.issuer == BASE and found.authorization_endpoint == f"{BASE}/authorize"
    assert found.resource == MCP  # no metadata names one: the address itself
    assert found.scope is None
    assert paths(fake) == [
        "/mcp",
        RESOURCE_PATH,
        "/.well-known/oauth-protected-resource",
        SERVER_PATH,
    ]


def test_a_path_style_issuer_is_looked_up_in_the_specs_order(monkeypatch):
    fake = FakeConnectorServer(BASE, path_issuer=True)
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    assert found.issuer == f"{BASE}/oauth"
    assert paths(fake)[-1] == f"{SERVER_PATH}/oauth"

    # The same server, answering only at the last of the three addresses.
    fake = FakeConnectorServer(BASE, path_issuer=True)
    last = "/oauth/.well-known/openid-configuration"

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"{SERVER_PATH}/oauth":
            fake.requests.append(request)
            return httpx.Response(404)
        if request.url.path == last:
            fake.requests.append(request)
            return httpx.Response(200, json=fake._server_metadata())
        return fake.handle(request)

    wire(monkeypatch, handle)
    assert discover(MCP).issuer == f"{BASE}/oauth"
    assert paths(fake)[2:] == [
        f"{SERVER_PATH}/oauth",
        "/.well-known/openid-configuration/oauth",
        last,
    ]


@pytest.mark.parametrize(
    "issuer",
    ["https://login.other-site.test", f"{BASE}/tenant", f"{BASE}//", BASE.upper(), None, 7],
)
def test_an_issuer_that_isnt_the_one_asked_for_is_rejected(monkeypatch, issuer):
    """Compared as raw strings, never through a URL type."""
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta: meta | {"issuer": issuer}))
    with pytest.raises(CannotRegister):
        discover(MCP)


def test_one_trailing_slash_is_the_same_issuer_and_the_servers_own_spelling_is_kept(monkeypatch):
    """Found by the live probe: Google's resource metadata names ``https://accounts.google.com/``
    and its server metadata says ``https://accounts.google.com``. One trailing slash can't name
    another server or another tenant. The spelling kept is the server's own: it is what the
    callback's ``iss`` is compared with."""
    fake = FakeConnectorServer(BASE)
    slashed = {"authorization_servers": [f"{BASE}/"]}
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | slashed))
    assert discover(MCP).issuer == BASE

    # The other way round, and with a path-style issuer.
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta: meta | {"issuer": f"{BASE}/"}))
    assert discover(MCP).issuer == f"{BASE}/"
    fake = FakeConnectorServer(BASE, path_issuer=True)
    slashed = {"authorization_servers": [f"{BASE}/oauth/"]}
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | slashed))
    assert discover(MCP).issuer == f"{BASE}/oauth"


def test_a_server_without_pkce_s256_is_rejected(monkeypatch):
    fake = FakeConnectorServer(BASE, no_pkce=True)
    wire(monkeypatch, fake.handle)
    with pytest.raises(CannotRegister):
        discover(MCP)

    # A list that names S256, nothing else: a string would pass by substring, a number would crash.
    for methods in (["plain"], "S256-not-a-list", 5, True, {"S256": True}):
        listed = {"code_challenge_methods_supported": methods}
        wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta, listed=listed: meta | listed))
        with pytest.raises(CannotRegister):
            discover(MCP)


def test_a_resource_that_doesnt_cover_the_address_is_rejected(monkeypatch):
    fake = FakeConnectorServer(BASE)
    elsewhere = {"resource": f"{BASE}/another"}
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | elsewhere))
    with pytest.raises(CannotRegister):
        discover(MCP)
    assert SERVER_PATH not in paths(fake)  # refused before the sign-in server is even asked

    # A resource that is the address's parent covers it, and is what gets sent verbatim.
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | {"resource": f"{BASE}/"}))
    assert discover(MCP).resource == f"{BASE}/"


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://mcp.fake.test/authorize",
        "javascript:alert(1)",
        "https://mcp.fake.test\\@evil.test/authorize",
        f"https://{PRIVATE_HOST}/authorize",
        7,
        None,
    ],
)
def test_an_authorize_endpoint_tvashtr_wont_open_is_rejected(monkeypatch, endpoint):
    fake = FakeConnectorServer(BASE)
    bad = {"authorization_endpoint": endpoint}
    wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta: meta | bad))
    with pytest.raises(CannotRegister):
        discover(MCP)


def test_every_fetched_address_passes_through_check_url(monkeypatch):
    fake = FakeConnectorServer(BASE, path_issuer=True)
    checked = wire(monkeypatch, fake.handle)
    found = discover(MCP)
    fetched = [str(request.url) for request in fake.requests]
    assert fetched and set(fetched) <= set(checked)
    # …and so does every endpoint a later step posts to or opens.
    assert {
        found.authorization_endpoint,
        found.token_endpoint,
        found.registration_endpoint,
        found.revocation_endpoint,
    } <= set(checked)


def test_a_metadata_address_that_isnt_public_is_never_fetched(monkeypatch):
    fake = FakeConnectorServer(BASE)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == PRIVATE_HOST:
            raise AssertionError("fetched a private address")
        if request.url.path == "/mcp":
            fake.requests.append(request)
            challenge = f'Bearer resource_metadata="https://{PRIVATE_HOST}/resource"'
            return httpx.Response(401, headers={"WWW-Authenticate": challenge})
        return fake.handle(request)

    wire(monkeypatch, handle)
    assert discover(MCP).issuer == BASE  # the well-known address still answers
    assert paths(fake) == ["/mcp", RESOURCE_PATH, SERVER_PATH]

    # A sign-in server on a private address: a sign-in is there, and Tvashtr can't use it.
    private = {"authorization_servers": [f"https://{PRIVATE_HOST}"]}
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | private))
    with pytest.raises(CannotRegister):
        discover(MCP)


def test_an_address_tvashtr_wont_open_is_unreachable(monkeypatch):
    wire(monkeypatch, FakeConnectorServer(BASE).handle)
    for url in (f"https://{PRIVATE_HOST}/mcp", "http://mcp.fake.test/mcp", "javascript:alert(1)"):
        with pytest.raises(Unreachable):
            discover(url)


def test_a_server_that_offers_no_sign_in_is_none(monkeypatch):
    seen: list[str] = []

    def open_server(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200 if request.url.path == "/mcp" else 404, json={})

    wire(monkeypatch, open_server)
    assert discover(MCP) is None
    assert seen == ["/mcp", RESOURCE_PATH, "/.well-known/oauth-protected-resource", SERVER_PATH]


def test_a_server_that_doesnt_answer_is_unreachable(monkeypatch):
    calls: list[str] = []

    def down(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        raise httpx.ConnectError("connection refused")

    wire(monkeypatch, down)
    with pytest.raises(Unreachable):
        discover(MCP)
    assert calls == ["/mcp"]  # no point asking a host that can't be connected to three more times

    wire(monkeypatch, lambda request: httpx.Response(503))
    with pytest.raises(Unreachable):
        discover(MCP)

    # A first request that never finishes (an open stream) isn't the end: the well-known
    # addresses still say whether there is a sign-in.
    fake = FakeConnectorServer(BASE)

    def hangs_on_mcp(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/mcp":
            raise httpx.ReadTimeout("the provider took too long to answer")
        return fake.handle(request)

    wire(monkeypatch, hangs_on_mcp)
    assert discover(MCP).issuer == BASE


def test_discovery_has_one_deadline_for_all_its_requests(monkeypatch):
    """Found in review: up to seven requests one after the other, each with its own ten seconds,
    so one ``oauth/start`` could hold a worker for over a minute."""
    fake = FakeConnectorServer(BASE, path_issuer=True)
    clock = [1000.0]
    monkeypatch.setattr(connector_oauth, "_now", lambda: clock[0])
    allowed: list[float] = []

    def slow(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/mcp":
            return fake.handle(request)
        allowed.append(request.extensions["timeout"]["read"])
        clock[0] += 8  # every metadata address takes eight seconds to answer
        if "oauth-protected-resource" in request.url.path:
            return fake.handle(request)
        return httpx.Response(404)  # a path-style issuer has three addresses to try

    wire(monkeypatch, slow)
    with pytest.raises(Unreachable):
        discover(MCP)
    # Twenty seconds in all: each request is given what is left, and none is sent once it is up.
    assert allowed == [10, 10, 4]


def test_metadata_that_isnt_a_json_object_is_skipped(monkeypatch):
    fake = FakeConnectorServer(BASE)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == RESOURCE_PATH:
            fake.requests.append(request)
            return httpx.Response(200, text="<html>not json</html>")
        return fake.handle(request)

    wire(monkeypatch, handle)
    assert discover(MCP).issuer == BASE  # the root resource metadata was read instead
    assert paths(fake)[1:3] == [RESOURCE_PATH, "/.well-known/oauth-protected-resource"]

    # Resource metadata that names a sign-in server whose metadata can't be read.
    fake = FakeConnectorServer(BASE)

    def no_server_metadata(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/.well-known/o") and "protected" not in request.url.path:
            return httpx.Response(200, content=json.dumps(["not", "an", "object"]))
        return fake.handle(request)

    wire(monkeypatch, no_server_metadata)
    with pytest.raises(CannotRegister):
        discover(MCP)


@pytest.mark.parametrize(
    "bad",
    [
        {"authorization_servers": ["https://[bad"]},
        {"authorization_servers": [7]},
        {"resource": "https://[bad"},
    ],
)
def test_resource_metadata_that_doesnt_name_addresses_is_cannot_register(monkeypatch, bad):
    """Found in review: what a server's metadata says is untrusted, and a value that can't be
    read as an address crashed discovery (a 500 from ``oauth/start``)."""
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | bad))
    with pytest.raises(CannotRegister):
        discover(MCP)


@pytest.mark.parametrize("address", [f"{BASE}/" + "a" * 70_000, "https://☃.-/oauth"])
def test_an_address_the_http_client_cant_build_is_never_a_crash(monkeypatch, address):
    """``urlsplit`` reads both; httpx refuses the first as too long and the second as a host
    name that can't be encoded, with an error that is neither ``UnsafeUrl`` nor an HTTP error."""
    fake = FakeConnectorServer(BASE)
    named = {"authorization_servers": [address]}
    wire(monkeypatch, _rewrite(fake, RESOURCE_PATH, lambda meta: meta | named))
    with pytest.raises(CannotRegister):
        discover(MCP)

    for name in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
        bad = {name: address}
        wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta, bad=bad: meta | bad))
        with pytest.raises(CannotRegister):
            discover(MCP)

    # A stored endpoint like that (from before this check) doesn't crash a refresh either.
    wire(monkeypatch, fake.handle)
    cid = connection(user(), fake, status="connected", secret=signed_in(fake, expires_in=10))
    with session_scope() as session:
        row = session.get(ConnectorConnection, cid)
        connectors.write_secret(row, connectors.read_secret(row) | {"token_endpoint": address})
    with pytest.raises(Unreachable):
        ensure_access_token(cid)


def test_metadata_nested_too_deep_to_parse_is_skipped(monkeypatch):
    fake = FakeConnectorServer(BASE)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == RESOURCE_PATH:
            return httpx.Response(200, text="[" * 200_000)
        return fake.handle(request)

    wire(monkeypatch, handle)
    assert discover(MCP).issuer == BASE  # the root resource metadata was read instead


# ---- B2.1: the mix-up check ----


@pytest.mark.parametrize(
    "endpoint", ["authorization_endpoint", "token_endpoint", "registration_endpoint"]
)
def test_a_sign_in_endpoint_on_another_site_than_the_issuer_is_rejected(monkeypatch, endpoint):
    fake = FakeConnectorServer(BASE, mixup=endpoint)
    wire(monkeypatch, fake.handle)
    with pytest.raises(CannotRegister):
        discover(MCP)


def test_a_revocation_endpoint_on_another_site_is_dropped_not_fatal(monkeypatch):
    fake = FakeConnectorServer(BASE, mixup="revocation_endpoint")
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    assert found.revocation_endpoint is None
    assert found.token_endpoint == f"{BASE}/token"


def test_endpoints_on_the_issuers_site_pass_whatever_the_host(monkeypatch):
    fake = FakeConnectorServer(BASE)
    sibling = {"token_endpoint": "https://api.fake.test/token"}  # Supabase's shape
    wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta: meta | sibling))
    assert discover(MCP).token_endpoint == "https://api.fake.test/token"


def test_a_featured_entry_passes_for_exactly_its_oauth_hosts(monkeypatch):
    fake = FakeConnectorServer(BASE, mixup="token_endpoint")
    wire(monkeypatch, fake.handle)
    other_host = OTHER_SITE.removeprefix("https://")
    entry = {"featured": True, "url": MCP, "oauth_hosts": [other_host]}

    assert discover(MCP, entry).token_endpoint == f"{OTHER_SITE}/token"

    refused = [
        None,
        {**entry, "oauth_hosts": ["other-site.test"]},  # the site isn't the host
        {**entry, "oauth_hosts": ["api.other-site.test"]},  # nor is a sibling
        {**entry, "featured": False},  # a registry or custom entry can't pin anything
        {key: value for key, value in entry.items() if key != "featured"},
        {**entry, "url": f"{BASE}/another"},  # pinned to another address than this one
    ]
    for other in refused:
        with pytest.raises(CannotRegister):
            discover(MCP, other)


def _google_like(mcp_host: str):
    """A server at ``mcp_host`` whose metadata is shaped like Google's: the issuer and the
    authorize page on ``accounts.google.com``, the token endpoint on ``oauth2.googleapis.com``."""
    google = "https://accounts.google.com"
    server = {
        "issuer": google,
        "authorization_endpoint": f"{google}/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "revocation_endpoint": "https://oauth2.googleapis.com/revoke",
        "code_challenge_methods_supported": ["plain", "S256"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
        "authorization_response_iss_parameter_supported": True,
    }

    def handle(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == mcp_host and path == "/.well-known/oauth-protected-resource/mcp/v1":
            # As Google serves it (probed 2026-09-30): the issuer is named with a trailing slash.
            resource = {
                "resource": f"https://{mcp_host}/mcp/v1",
                "authorization_servers": [f"{google}/"],
                "scopes_supported": ["https://www.googleapis.com/auth/drive"],
            }
            return httpx.Response(200, json=resource)
        if host == "accounts.google.com" and path == SERVER_PATH:
            return httpx.Response(200, json=server)
        return httpx.Response(405 if host == mcp_host else 404)

    return handle


def test_googles_own_cards_pass_the_mix_up_check_and_a_copy_of_them_doesnt(monkeypatch):
    entry = connector_catalog.FEATURED["google-drive"]
    wire(monkeypatch, _google_like("drivemcp.googleapis.com"))
    found = discover(entry["url"], entry)
    assert found.issuer == "https://accounts.google.com" and found.iss_supported is True
    assert found.signin_host == "accounts.google.com"
    assert found.token_endpoint == "https://oauth2.googleapis.com/token"
    assert found.revocation_endpoint == "https://oauth2.googleapis.com/revoke"

    # A custom address that copies Google's metadata: nothing pins the token endpoint's host.
    wire(monkeypatch, _google_like("mcp.evil.test"))
    custom = {"key": "custom:mcp.evil.test/mcp/v1", "featured": False}
    for other in (None, custom, entry):  # not even Google's own entry, on another address
        with pytest.raises(CannotRegister):
            discover("https://mcp.evil.test/mcp/v1", other)


# ---- B2.2: which client Tvashtr signs in as ----

GOOGLE = Discovery(
    issuer="https://accounts.google.com",
    authorization_endpoint="https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint="https://oauth2.googleapis.com/token",
    resource="https://drivemcp.googleapis.com/mcp/v1",
)


def _google_client(monkeypatch, client_id="tvashtr.apps.googleusercontent.com", secret="G-SECRET"):
    monkeypatch.setattr(get_settings(), "google_oauth_client_id", client_id)
    monkeypatch.setattr(get_settings(), "google_oauth_client_secret", SecretStr(secret))


def _no_network(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"unexpected request to {request.url}")


def test_a_featured_entry_on_its_own_address_gets_the_pre_registered_client(monkeypatch):
    wire(monkeypatch, _no_network)
    _google_client(monkeypatch)
    entry = connector_catalog.FEATURED["google-drive"]

    assert client_kind(GOOGLE, entry, entry["url"]) == "preregistered"
    client = choose_client(GOOGLE, entry, entry["url"])
    # The operator's secret stays in the settings: it is read when it is sent, never copied
    # onto a connection.
    assert client == {
        "client_id": "tvashtr.apps.googleusercontent.com",
        "auth_method": "client_secret_post",
        "kind": "preregistered",
    }

    # Until both settings are there, Google can't be signed in to at all.
    _google_client(monkeypatch, secret="")
    with pytest.raises(CannotRegister):
        choose_client(GOOGLE, entry, entry["url"])


def test_a_custom_address_never_gets_the_google_client(monkeypatch):
    """Even when its metadata names ``accounts.google.com``: Google's tokens aren't bound to an
    audience, so the user's Drive token would go to that server."""
    fake = FakeConnectorServer("https://accounts.google.com")
    wire(monkeypatch, fake.handle)
    _google_client(monkeypatch)
    google_entry = connector_catalog.FEATURED["google-drive"]
    custom = {"key": "custom:mcp.evil.test/mcp", "client": "google", "featured": False}
    url = "https://mcp.evil.test/mcp"

    for entry in (None, custom, google_entry):
        with pytest.raises(CannotRegister):
            choose_client(GOOGLE, entry, url)
    # Offered dynamic registration, it registers like anyone else, and still isn't the Google one.
    registering = replace(GOOGLE, registration_endpoint="https://accounts.google.com/register")
    client = choose_client(registering, custom, url)
    assert client["kind"] == "dcr" and client["client_id"] == "client-1"


def test_a_client_metadata_document_is_used_when_offered_and_tvashtr_is_on_https(monkeypatch):
    fake = FakeConnectorServer(BASE, cimd=True)
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    fake.requests.clear()

    assert client_kind(found, None, MCP) == "cimd"
    assert choose_client(found, None, MCP) == {
        "client_id": f"{TVASHTR}/oauth/client-metadata.json",
        "auth_method": "none",
        "kind": "cimd",
    }
    assert fake.requests == []  # nothing to register
    # It beats a stored registration: first match in the contract's order.
    stored = {"issuer": BASE, "client": {"client_id": "client-9", "kind": "dcr"}}
    assert choose_client(found, None, MCP, [stored])["kind"] == "cimd"

    # Local development (an http:// base): the document can't be fetched, so register instead.
    monkeypatch.setattr(get_settings(), "public_base_url", "http://localhost:8000")
    assert client_kind(found, None, MCP) == "dcr"


def test_dynamic_registration_asks_for_a_public_web_client(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    fake.requests.clear()

    client = choose_client(found, None, MCP)
    assert client == {
        "client_id": "client-1",
        "auth_method": "none",
        "kind": "dcr",
        "redirect_uri": CALLBACK,
    }
    [request] = fake.requests
    assert (request.method, request.url.path) == ("POST", "/register")
    assert json.loads(request.content) == {
        "client_name": "Tvashtr",
        "redirect_uris": [CALLBACK],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "application_type": "web",
        "token_endpoint_auth_method": "none",
        "scope": "read",
    }

    # Local development: a redirect to http://localhost is what a "native" client has. A sign-in
    # server that holds "web" clients to https redirects would refuse the registration otherwise.
    monkeypatch.setattr(get_settings(), "public_base_url", "http://localhost:8000")
    fake.requests.clear()
    local = choose_client(found, None, MCP)
    body = json.loads(fake.requests[0].content)
    assert body["application_type"] == "native"
    assert body["redirect_uris"] == ["http://localhost:8000/api/connectors/oauth/callback"]
    assert local["redirect_uri"] == body["redirect_uris"][0]


def test_a_confidential_only_server_gets_a_secret(monkeypatch):
    fake = FakeConnectorServer(BASE, confidential=True)  # as Supabase and Vercel
    wire(monkeypatch, fake.handle)
    client = choose_client(discover(MCP), None, MCP)
    assert client["auth_method"] == "client_secret_post" and client["kind"] == "dcr"
    assert client["client_secret"] == fake.clients["client-1"]["client_secret"]
    assert "secret_expires_at" not in client  # the fake's 0 means "never"

    # A server that lists only Basic, and one that lists nothing (the RFC's default is Basic).
    for methods in (("client_secret_basic",), ()):
        found = replace(discover(MCP), token_auth_methods=methods)
        assert choose_client(found, None, MCP)["auth_method"] == "client_secret_basic"


def test_a_registration_reply_is_kept_only_where_it_is_the_right_type(monkeypatch):
    """Found in review: a secret expiry that isn't a number was stored, and every later
    ``oauth/start`` on that row crashed comparing it with the clock."""
    fake = FakeConnectorServer(BASE, confidential=True)
    found = None

    def handle(request: httpx.Request) -> httpx.Response:
        reply = fake.handle(request)
        if request.url.path == "/register":
            odd = {"client_secret_expires_at": "2030-01-01", "token_endpoint_auth_method": 7}
            return httpx.Response(201, json=reply.json() | odd)
        return reply

    wire(monkeypatch, handle)
    found = discover(MCP)
    client = choose_client(found, None, MCP)
    assert "secret_expires_at" not in client
    assert client["auth_method"] == "client_secret_post"  # the one asked for
    assert isinstance(client["client_secret"], str)

    # A secret that isn't a string isn't a secret.
    def no_secret(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/register":
            return httpx.Response(201, json={"client_id": "c", "client_secret": ["s"]})
        return fake.handle(request)

    wire(monkeypatch, no_secret)
    assert "client_secret" not in choose_client(found, None, MCP)

    # A row that already holds such an expiry starts a sign-in all the same.
    wire(monkeypatch, _no_network)
    held = client | {"secret_expires_at": "never"}
    assert choose_client(found, None, MCP, [{"issuer": BASE, "client": held}]) == held


def test_a_stored_registration_is_reused_only_for_the_same_issuer(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    first = choose_client(found, None, MCP)
    stored = {"issuer": BASE, "client": first}
    fake.requests.clear()

    # "Sign in again": the sign-in in flight has none, the stored one does.
    assert choose_client(found, None, MCP, [None, {"issuer": BASE}, stored]) == first
    assert fake.requests == []

    def registers_again(known: dict) -> bool:
        fake.requests.clear()
        client = choose_client(found, None, MCP, [known])
        return paths(fake) == ["/register"] and client["client_id"] != first["client_id"]

    assert registers_again({"issuer": "https://login.elsewhere.test", "client": first})
    expired = first | {"client_secret": "s", "secret_expires_at": time.time() - 1}
    assert registers_again({"issuer": BASE, "client": expired})
    # Registered for another redirect address (the public base URL changed since).
    moved = first | {"redirect_uri": "https://old.tvashtr.test/api/connectors/oauth/callback"}
    assert registers_again({"issuer": BASE, "client": moved})
    # A client metadata document isn't a registration to reuse where documents aren't offered.
    assert registers_again({"issuer": BASE, "client": {"client_id": "https://x", "kind": "cimd"}})


def test_no_way_to_get_a_client_is_cannot_register(monkeypatch):
    fake = FakeConnectorServer(BASE, dcr=False)  # as HubSpot, Slack, Box
    wire(monkeypatch, fake.handle)
    found = discover(MCP)
    with pytest.raises(CannotRegister):
        client_kind(found, None, MCP)
    with pytest.raises(CannotRegister):
        choose_client(found, None, MCP)


def test_a_refused_registration_is_cannot_register_and_a_5xx_is_unreachable(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    found = discover(MCP)

    def answering(reply: httpx.Response):
        def handle(request: httpx.Request) -> httpx.Response:
            return reply if request.url.path == "/register" else fake.handle(request)

        return handle

    for refusal in (
        httpx.Response(403, json={"error": "access_denied"}),  # Figma's allowlist
        httpx.Response(201, json={"no": "client id"}),
        httpx.Response(201, text="<html>"),
    ):
        wire(monkeypatch, answering(refusal))
        with pytest.raises(CannotRegister):
            choose_client(found, None, MCP)

    wire(monkeypatch, answering(httpx.Response(503)))
    with pytest.raises(Unreachable):
        choose_client(found, None, MCP)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    wire(monkeypatch, down)
    with pytest.raises(Unreachable):
        choose_client(found, None, MCP)


# ---- B2.5: tokens ----


def _forms(fake: FakeConnectorServer, path: str = "/token") -> list[dict]:
    return [
        {key: value[0] for key, value in parse_qs(request.content.decode()).items()}
        for request in fake.requests
        if request.url.path == path
    ]


def _connected(fake: FakeConnectorServer, **sign_in) -> tuple:
    """A connected row with a stored sign-in to the fake. Returns ``(id, the stored sign-in)``."""
    stored = signed_in(fake, **sign_in)
    return connection(user(), fake, status="connected", secret=stored), stored


def _in_threads(*calls) -> list:
    """Run the calls at once. Each result, or the exception it raised, in the calls' order."""
    results: list = [None] * len(calls)

    def run(index: int, call) -> None:
        try:
            results[index] = call()
        except Exception as exc:  # handed to the test
            results[index] = exc

    threads = [threading.Thread(target=run, args=item) for item in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return results


def test_a_token_with_more_than_five_minutes_left_is_returned_without_a_network_call(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _no_network)
    cid, stored = _connected(fake, expires_in=301 + 30)
    assert ensure_access_token(cid) == stored["access_token"]

    # No expiry named: good until the provider says otherwise.
    forever = signed_in(fake)
    del forever["expires_at"]
    cid = connection(user(), fake, status="connected", secret=forever)
    assert ensure_access_token(cid) == forever["access_token"]
    # The token a provider just refused, when someone else has refreshed since: the stored one
    # is already a different token, so that one is returned.
    assert ensure_access_token(cid, rejected="the-old-token") == forever["access_token"]


def test_a_token_about_to_expire_is_refreshed_and_the_rotated_refresh_token_is_stored(monkeypatch):
    fake = FakeConnectorServer(BASE, expires_in=7200)
    wire(monkeypatch, fake.handle)
    cid, stored = _connected(fake, expires_in=299)

    token = ensure_access_token(cid)
    assert token != stored["access_token"] and token in fake.access_tokens
    assert _forms(fake) == [
        {
            "grant_type": "refresh_token",
            "refresh_token": stored["refresh_token"],
            "client_id": stored["client"]["client_id"],
            "resource": MCP,
        }
    ]
    row = load(cid)
    now = connectors.read_secret(row)
    assert now["access_token"] == token
    assert now["refresh_token"] != stored["refresh_token"]
    assert now["refresh_token"] in fake.refresh_tokens  # the new one is what was committed
    assert abs(now["expires_at"] - (time.time() + 7200)) < 30
    rest = ("issuer", "client", "token_endpoint", "revocation_endpoint", "resource", "scope")
    assert {key: now[key] for key in rest} == {key: stored[key] for key in rest}
    assert (row.status, row.last_error) == ("connected", None)
    # It is fresh now: the next call asks nobody.
    assert ensure_access_token(cid) == token and len(_forms(fake)) == 1


def test_a_rejected_token_is_refreshed_even_when_it_looks_fresh(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    cid, stored = _connected(fake)

    assert ensure_access_token(cid, rejected="some-other-token") == stored["access_token"]
    assert _forms(fake) == []
    token = ensure_access_token(cid, rejected=stored["access_token"])
    assert token != stored["access_token"] and len(_forms(fake)) == 1
    # A second caller that was refused the same old token gets the new one without a request.
    assert ensure_access_token(cid, rejected=stored["access_token"]) == token
    assert len(_forms(fake)) == 1


def test_a_reply_without_a_refresh_token_keeps_the_old_one(monkeypatch):
    fake = FakeConnectorServer(BASE, rotate_refresh=False, expires_in=None)
    wire(monkeypatch, fake.handle)
    cid, stored = _connected(fake, expires_in=-5)

    token = ensure_access_token(cid)
    now = connectors.read_secret(load(cid))
    assert now["access_token"] == token != stored["access_token"]
    assert now["refresh_token"] == stored["refresh_token"]
    assert "expires_at" not in now  # the reply named none, so the old expiry doesn't linger


@pytest.mark.parametrize("error", ["invalid_grant", "invalid_client"])
def test_a_refused_refresh_clears_the_tokens_and_asks_for_a_new_sign_in(monkeypatch, error):
    fake = FakeConnectorServer(BASE, fail_refresh=error)
    wire(monkeypatch, fake.handle)
    cid, stored = _connected(fake, expires_in=10)

    with pytest.raises(SignInRefused):
        ensure_access_token(cid)
    row = load(cid)
    assert (row.status, row.last_error) == ("needs_signin", "Its sign-in expired.")
    now = connectors.read_secret(row)
    assert not {"access_token", "refresh_token", "expires_at"} & set(now)
    # ``invalid_client`` also drops the registration, so the next sign-in registers again.
    assert ("client" in now) == (error == "invalid_grant")
    assert now["issuer"] == BASE and now["authorization_endpoint"] == f"{BASE}/authorize"
    assert connectors.serialize(row)["signin_host"] == "mcp.fake.test"

    # Nothing left to try with: refused again, without a request.
    fake.requests.clear()
    with pytest.raises(SignInRefused):
        ensure_access_token(cid)
    assert fake.requests == []


def test_no_refresh_token_and_a_token_that_is_expired_or_rejected_needs_a_new_sign_in(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _no_network)
    for expires_in, rejected in ((-5, False), (3600, True)):
        stored = signed_in(fake, expires_in=expires_in)
        del stored["refresh_token"]
        cid = connection(user(), fake, status="connected", secret=stored)
        with pytest.raises(SignInRefused):
            ensure_access_token(cid, rejected=stored["access_token"] if rejected else None)
        row = load(cid)
        assert (row.status, row.last_error) == ("needs_signin", "Its sign-in expired.")
        assert "access_token" not in connectors.read_secret(row)


def test_a_row_that_never_signed_in_is_refused_and_left_as_it_is(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _no_network)
    cid = connection(user(), fake, pending_secret={"issuer": BASE})
    with pytest.raises(SignInRefused):
        ensure_access_token(cid)
    row = load(cid)
    assert (row.status, row.last_error, row.secret_encrypted) == ("pending", None, None)


def test_a_sign_in_that_cant_be_decrypted_is_refused_not_a_crash(monkeypatch):
    """After ``TVASHTR_SECRET_KEY`` is rotated (or a column is corrupt) the row reads as having no
    sign-in, as everywhere else: ``SignInRefused``, which every caller handles, and the row is
    left for the caller to mark."""
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _no_network)
    broken = {"secret_encrypted": "not-a-fernet-token", "pending_encrypted": "nor-is-this"}
    cid = connection(user(), fake, status="connected", **broken)
    with pytest.raises(SignInRefused):
        ensure_access_token(cid)
    row = load(cid)
    assert (row.status, row.secret_encrypted) == ("connected", "not-a-fernet-token")
    assert revoke(cid) is False


def test_a_token_endpoint_that_doesnt_answer_is_unreachable_and_changes_nothing(monkeypatch):
    fake = FakeConnectorServer(BASE, fail_refresh=503)
    wire(monkeypatch, fake.handle)
    cid, stored = _connected(fake, expires_in=10)

    def unchanged() -> bool:
        row = load(cid)
        return row.status == "connected" and connectors.read_secret(row) == stored

    with pytest.raises(Unreachable):
        ensure_access_token(cid)
    assert unchanged()

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("the provider took too long to answer")

    unreadable = httpx.Response(200, text="<html>a login page</html>")
    for network in (down, lambda request: httpx.Response(429), lambda request: unreadable):
        wire(monkeypatch, network)
        with pytest.raises(Unreachable):
            ensure_access_token(cid)
        assert unchanged()


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (204, None),
        (302, None),
        (307, None),
        (403, "<html>blocked by the gateway</html>"),
        (404, None),
        (408, None),
        (421, None),
        (400, None),
        (401, None),
        (400, {"error": "temporarily_unavailable"}),
        (400, {"error": ["invalid_grant"]}),
    ],
)
def test_only_the_providers_own_refusal_ends_a_sign_in(monkeypatch, status, body):
    """Found in review: a redirect (they aren't followed), a gateway's 403 page or a 408 says
    nothing about the refresh token, and wiping it would make everyone sign in again over a
    passing fault. Only the token endpoint's own OAuth refusal ends the sign-in."""
    fake = FakeConnectorServer(BASE)

    def answer(request: httpx.Request) -> httpx.Response:
        if isinstance(body, dict):
            return httpx.Response(status, json=body)
        return httpx.Response(status, text=body or "")

    wire(monkeypatch, answer)
    cid, stored = _connected(fake, expires_in=10)

    with pytest.raises(Unreachable):
        ensure_access_token(cid)
    row = load(cid)
    assert (row.status, row.last_error) == ("connected", None)
    assert connectors.read_secret(row) == stored


@pytest.mark.parametrize(
    ("status", "error", "registration_kept"),
    [(403, "invalid_grant", True), (400, "unauthorized_client", False)],
)
def test_a_refusal_is_read_from_the_answers_error(monkeypatch, status, error, registration_kept):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, lambda request: httpx.Response(status, json={"error": error}))
    cid, _ = _connected(fake, expires_in=10)

    with pytest.raises(SignInRefused):
        ensure_access_token(cid)
    row = load(cid)
    assert (row.status, row.last_error) == ("needs_signin", "Its sign-in expired.")
    now = connectors.read_secret(row)
    assert "refresh_token" not in now and ("client" in now) == registration_kept


@pytest.mark.parametrize("expires_in", ["1e999", "Infinity", "9" * 400, '"soon"', "[3600]"])
def test_an_expiry_that_isnt_a_usable_number_is_no_expiry(monkeypatch, expires_in):
    """Found in review: ``1e999`` raised OverflowError out of ``ensure_access_token`` after the
    provider had already rotated the refresh token, so the row kept a spent one."""
    fake = FakeConnectorServer(BASE)

    def handle(request: httpx.Request) -> httpx.Response:
        reply = fake.handle(request)
        if request.url.path == "/token" and reply.status_code == 200:
            body = json.dumps(reply.json() | {"expires_in": 0}).replace(
                '"expires_in": 0', f'"expires_in": {expires_in}'
            )
            return httpx.Response(200, content=body, headers={"content-type": "application/json"})
        return reply

    wire(monkeypatch, handle)
    cid, stored = _connected(fake, expires_in=10)

    token = ensure_access_token(cid)
    now = connectors.read_secret(load(cid))
    assert now["access_token"] == token and "expires_at" not in now
    assert now["refresh_token"] in fake.refresh_tokens  # the rotated one was committed


def test_a_token_answer_nested_too_deep_to_parse_is_unreachable(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, lambda request: httpx.Response(200, text="[" * 200_000))
    cid, stored = _connected(fake, expires_in=10)
    with pytest.raises(Unreachable):
        ensure_access_token(cid)
    assert connectors.read_secret(load(cid)) == stored


def test_a_registered_secret_is_sent_the_way_the_client_was_registered(monkeypatch):
    fake = FakeConnectorServer(BASE, confidential=True)
    wire(monkeypatch, fake.handle)

    cid, stored = _connected(fake, expires_in=10, method="client_secret_post")
    assert ensure_access_token(cid) in fake.access_tokens
    [form] = _forms(fake)
    assert form["client_secret"] == stored["client"]["client_secret"]
    assert "authorization" not in fake.requests[-1].headers

    fake.requests.clear()
    cid, stored = _connected(fake, expires_in=10, method="client_secret_basic")
    assert ensure_access_token(cid) in fake.access_tokens
    [form] = _forms(fake)
    assert "client_secret" not in form
    client = stored["client"]
    basic = base64.b64encode(f"{client['client_id']}:{client['client_secret']}".encode())
    assert fake.requests[-1].headers["authorization"] == f"Basic {basic.decode()}"


def test_the_pre_registered_clients_secret_comes_from_the_settings(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    _google_client(monkeypatch, secret="ROTATED-SINCE")
    stored = signed_in(fake, expires_in=10)
    stored["client"] = {
        "client_id": stored["client"]["client_id"],
        "auth_method": "client_secret_post",
        "kind": "preregistered",
    }
    cid = connection(user(), fake, status="connected", secret=stored)
    assert ensure_access_token(cid) in fake.access_tokens
    assert _forms(fake)[0]["client_secret"] == "ROTATED-SINCE"


def test_two_callers_at_once_make_one_refresh_request(monkeypatch):
    fake = FakeConnectorServer(BASE)

    def slow(request: httpx.Request) -> httpx.Response:
        time.sleep(0.3)  # the second caller arrives while this refresh holds the row
        return fake.handle(request)

    wire(monkeypatch, slow)
    cid, stored = _connected(fake, expires_in=10)

    first, second = _in_threads(lambda: ensure_access_token(cid), lambda: ensure_access_token(cid))
    assert first == second and first in fake.access_tokens  # no spent refresh token was sent
    assert len(_forms(fake)) == 1
    assert connectors.read_secret(load(cid))["access_token"] == first


def test_the_row_lock_alone_makes_one_refresh_request(monkeypatch):
    """Two backend processes share no in-process turn. The row lock is what orders them."""
    monkeypatch.setattr(connector_oauth, "_one_at_a_time", contextlib.nullcontext)
    fake = FakeConnectorServer(BASE)

    def slow(request: httpx.Request) -> httpx.Response:
        time.sleep(0.3)
        return fake.handle(request)

    wire(monkeypatch, slow)
    cid, _ = _connected(fake, expires_in=10)
    first, second = _in_threads(lambda: ensure_access_token(cid), lambda: ensure_access_token(cid))
    assert first == second and first in fake.access_tokens
    assert len(_forms(fake)) == 1


def test_callers_waiting_for_a_refresh_hold_no_database_connection(monkeypatch):
    """Found in review: every caller waited for the row lock on its own pooled connection while
    the one in front waited for the provider, so one slow token endpoint emptied the pool for
    the whole backend. Waiting callers now hold none."""
    fake = FakeConnectorServer(BASE)
    pool = get_engine().pool
    held: list[int] = []

    def slow(request: httpx.Request) -> httpx.Response:
        time.sleep(0.3)  # the other callers arrive and wait
        held.append(pool.checkedout())
        return httpx.Response(503)

    wire(monkeypatch, slow)
    cid, stored = _connected(fake, expires_in=10)
    before = pool.checkedout()

    results = _in_threads(*[lambda: ensure_access_token(cid)] * 4)
    assert all(isinstance(result, Unreachable) for result in results)
    assert len(held) == 4 and max(held) - before == 1  # the one refreshing, none of the waiting
    assert connectors.read_secret(load(cid)) == stored


def test_a_caller_doesnt_wait_for_its_turn_for_ever(monkeypatch):
    """Behind a provider that keeps timing out, each waiting caller would otherwise wait for
    all the ones in front of it (ten seconds each)."""
    monkeypatch.setattr(connector_oauth, "_TURN_SECONDS", 0.2)
    fake = FakeConnectorServer(BASE)
    asked: list[str] = []

    def slow(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        time.sleep(0.8)
        return fake.handle(request)

    wire(monkeypatch, slow)
    cid, _ = _connected(fake, expires_in=10)
    results = _in_threads(*[lambda: ensure_access_token(cid)] * 3)
    assert sorted(type(result).__name__ for result in results) == ["Unreachable"] * 2 + ["str"]
    assert asked == ["/token"]


def test_a_row_deleted_while_a_refresh_waits_for_the_lock_is_refused(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    cid, _ = _connected(fake, expires_in=10)
    outcome: list = []

    with get_engine().connect() as holder:
        locked = text("SELECT 1 FROM connector_connections WHERE id = :id FOR UPDATE")
        holder.execute(locked, {"id": cid})
        waiting = threading.Thread(
            target=lambda: outcome.extend(_in_threads(lambda: ensure_access_token(cid)))
        )
        waiting.start()
        time.sleep(0.3)
        assert waiting.is_alive() and outcome == []  # it waits for the row, it didn't read it
        holder.execute(text("DELETE FROM connector_connections WHERE id = :id"), {"id": cid})
        holder.commit()
    waiting.join(timeout=30)

    assert isinstance(outcome[0], SignInRefused)
    assert fake.requests == [] and load(cid) is None


# ---- B2.5: revoke ----


def test_revoke_tells_the_provider_to_forget_the_sign_in(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    cid, stored = _connected(fake)

    assert revoke(cid) is True
    assert _forms(fake, "/revoke") == [
        {
            "token": stored["refresh_token"],
            "token_type_hint": "refresh_token",
            "client_id": stored["client"]["client_id"],
        }
    ]
    assert stored["refresh_token"] not in fake.refresh_tokens
    # It reads, it doesn't write: the row is the caller's to delete.
    assert connectors.read_secret(load(cid)) == stored


def test_revoke_is_best_effort_and_never_raises(monkeypatch):
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)

    no_endpoint = signed_in(fake) | {"revocation_endpoint": None}
    assert revoke(connection(user(), fake, status="connected", secret=no_endpoint)) is False
    assert revoke(connection(user(), fake)) is False  # never signed in
    assert revoke(connection(user(), fake, auth_kind="api_key", status="connected")) is False
    assert fake.requests == []
    assert revoke(load(connection(user(), fake)).owner_id) is False  # not a connection's id

    cid, _ = _connected(fake)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    for network in (down, lambda request: httpx.Response(503), lambda request: httpx.Response(400)):
        wire(monkeypatch, network)
        assert revoke(cid) is False


def test_revoke_doesnt_wait_for_the_row_lock(monkeypatch):
    """The disconnect that calls it may already hold the lock, in its own session."""
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    cid, _ = _connected(fake)
    outcome: list = []

    with get_engine().connect() as holder:
        locked = text("SELECT 1 FROM connector_connections WHERE id = :id FOR UPDATE")
        holder.execute(locked, {"id": cid})
        revoking = threading.Thread(target=lambda: outcome.append(revoke(cid)))
        revoking.start()
        revoking.join(timeout=10)
        assert outcome == [True]
        holder.rollback()
