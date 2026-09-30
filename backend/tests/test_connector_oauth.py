"""Connectors OAuth (stream B2): discovery, the client choice and registration, and tokens, all
against the fake sign-in server behind ``connector_net.client()``.
Contract: ``docs/superpowers/plans/api/connectors.md`` (OAuth, Tokens)."""

import json

import httpx
import pytest
from connector_oauth_helpers import PRIVATE_HOST, paths, wire
from fake_connector_server import OTHER_SITE, FakeConnectorServer

from tvashtr.control_plane import connector_catalog
from tvashtr.control_plane.connector_oauth import CannotRegister, Discovery, Unreachable, discover

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


@pytest.mark.parametrize("issuer", ["https://login.other-site.test", f"{BASE}/"])
def test_an_issuer_that_isnt_the_one_asked_for_is_rejected(monkeypatch, issuer):
    """Compared as raw strings: a trailing slash is a different issuer."""
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta: meta | {"issuer": issuer}))
    with pytest.raises(CannotRegister):
        discover(MCP)


def test_a_server_without_pkce_s256_is_rejected(monkeypatch):
    fake = FakeConnectorServer(BASE, no_pkce=True)
    wire(monkeypatch, fake.handle)
    with pytest.raises(CannotRegister):
        discover(MCP)

    plain_only = {"code_challenge_methods_supported": ["plain"]}
    wire(monkeypatch, _rewrite(fake, SERVER_PATH, lambda meta: meta | plain_only))
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
    }

    def handle(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == mcp_host and "oauth-protected-resource" in path:
            resource = {"resource": f"https://{mcp_host}/mcp/v1", "authorization_servers": [google]}
            return httpx.Response(200, json=resource)
        if host == "accounts.google.com" and path == SERVER_PATH:
            return httpx.Response(200, json=server)
        return httpx.Response(405 if host == mcp_host else 404)

    return handle


def test_googles_own_cards_pass_the_mix_up_check_and_a_copy_of_them_doesnt(monkeypatch):
    entry = connector_catalog.FEATURED["google-drive"]
    wire(monkeypatch, _google_like("drivemcp.googleapis.com"))
    found = discover(entry["url"], entry)
    assert found.signin_host == "accounts.google.com"
    assert found.token_endpoint == "https://oauth2.googleapis.com/token"
    assert found.revocation_endpoint == "https://oauth2.googleapis.com/revoke"

    # A custom address that copies Google's metadata: nothing pins the token endpoint's host.
    wire(monkeypatch, _google_like("mcp.evil.test"))
    custom = {"key": "custom:mcp.evil.test/mcp/v1", "featured": False}
    for other in (None, custom, entry):  # not even Google's own entry, on another address
        with pytest.raises(CannotRegister):
            discover("https://mcp.evil.test/mcp/v1", other)
