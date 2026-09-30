"""The fake OAuth MCP server the Connectors tests run against: ``handle()`` as an
``httpx.MockTransport`` handler (sign-in endpoints) and the subprocess (the same plus ``/mcp``)."""

import asyncio
import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import httpx
from fake_connector_server import STATIC_TOKEN, FakeConnectorServer
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

BASE = "https://mcp.fake.test"
CALLBACK = "https://tvashtr.test/api/connectors/oauth/callback"


def _client(fake: FakeConnectorServer) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(fake.handle))


def _metadata(fake: FakeConnectorServer, path: str = "/.well-known/oauth-authorization-server"):
    with _client(fake) as c:
        return c.get(BASE + path)


def test_handle_serves_both_metadata_documents():
    fake = FakeConnectorServer(BASE)
    with _client(fake) as c:
        resource = c.get(f"{BASE}/.well-known/oauth-protected-resource/mcp")
        root = c.get(f"{BASE}/.well-known/oauth-protected-resource")
        server = c.get(f"{BASE}/.well-known/oauth-authorization-server")

    assert resource.status_code == 200 and root.json() == resource.json()
    assert resource.json() == {
        "resource": f"{BASE}/mcp",
        "authorization_servers": [BASE],
        "scopes_supported": ["read", "write"],
    }
    assert server.json() == {
        "issuer": BASE,
        "authorization_endpoint": f"{BASE}/authorize",
        "token_endpoint": f"{BASE}/token",
        "revocation_endpoint": f"{BASE}/revoke",
        "registration_endpoint": f"{BASE}/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": [
            "none",
            "client_secret_post",
            "client_secret_basic",
        ],
    }
    # It records every request, for assertions.
    assert [r.url.path for r in fake.requests] == [
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
    ]


def test_mcp_without_a_bearer_is_a_401_that_names_the_resource_metadata():
    fake = FakeConnectorServer(BASE)
    with _client(fake) as c:
        reply = c.post(f"{BASE}/mcp", json={})
        forbidden = c.post(f"{BASE}/mcp", json={}, headers={"Authorization": "Bearer forbidden"})
    assert reply.status_code == 401
    assert reply.headers["www-authenticate"] == (
        f'Bearer resource_metadata="{BASE}/.well-known/oauth-protected-resource/mcp", scope="read"'
    )
    assert forbidden.status_code == 403


def test_each_knob_changes_what_the_server_advertises():
    meta = _metadata(FakeConnectorServer(BASE, dcr=False)).json()
    assert "registration_endpoint" not in meta

    meta = _metadata(FakeConnectorServer(BASE, cimd=True, iss=True, no_pkce=True)).json()
    assert meta["client_id_metadata_document_supported"] is True
    assert meta["authorization_response_iss_parameter_supported"] is True
    assert "code_challenge_methods_supported" not in meta

    meta = _metadata(FakeConnectorServer(BASE, confidential=True)).json()
    assert meta["token_endpoint_auth_methods_supported"] == [
        "client_secret_basic",
        "client_secret_post",
    ]

    # A path-style issuer: its metadata is at the path-suffixed address only.
    fake = FakeConnectorServer(BASE, path_issuer=True)
    assert _metadata(fake).status_code == 404
    meta = _metadata(fake, "/.well-known/oauth-authorization-server/oauth").json()
    assert meta["issuer"] == f"{BASE}/oauth"
    with _client(fake) as c:
        resource = c.get(f"{BASE}/.well-known/oauth-protected-resource/mcp").json()
    assert resource["authorization_servers"] == [f"{BASE}/oauth"]

    # No protected-resource metadata at all (Intercom): only the origin's own server metadata.
    fake = FakeConnectorServer(BASE, no_resource_metadata=True)
    with _client(fake) as c:
        assert c.get(f"{BASE}/.well-known/oauth-protected-resource/mcp").status_code == 404
        assert c.get(f"{BASE}/.well-known/oauth-protected-resource").status_code == 404
        assert c.post(f"{BASE}/mcp", json={}).headers["www-authenticate"] == "Bearer"
    assert _metadata(fake).json()["issuer"] == BASE

    # Mix-up: the metadata names another site's endpoint (the authorize endpoint by default).
    other = "https://login.other-site.test"
    assert (
        _metadata(FakeConnectorServer(BASE, mixup=True)).json()["authorization_endpoint"]
        == f"{other}/authorize"
    )
    meta = _metadata(FakeConnectorServer(BASE, mixup="token_endpoint")).json()
    assert meta["token_endpoint"] == f"{other}/token"
    assert meta["authorization_endpoint"] == f"{BASE}/authorize"


def _sign_in(fake: FakeConnectorServer, c: httpx.Client, method: str = "none") -> tuple[dict, dict]:
    """Register, open the authorize page, press Allow, exchange the code. Returns the
    registration and the token reply."""
    registration = c.post(
        f"{BASE}/register",
        json={
            "client_name": "Tvashtr",
            "redirect_uris": [CALLBACK],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "application_type": "web",
            "token_endpoint_auth_method": method,
        },
    )
    assert registration.status_code == 201
    client = registration.json()

    verifier = "v" * 64
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    params = {
        "response_type": "code",
        "client_id": client["client_id"],
        "redirect_uri": CALLBACK,
        "state": "state-123",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": f"{BASE}/mcp",
        "scope": "read",
    }
    page = c.get(f"{BASE}/authorize", params=params)
    assert page.status_code == 200 and "<button" in page.text and "Allow" in page.text
    allowed = c.post(str(page.url))  # the page's one form posts back to its own address
    assert allowed.status_code == 302
    back = urlsplit(allowed.headers["location"])
    assert f"{back.scheme}://{back.netloc}{back.path}" == CALLBACK
    query = parse_qs(back.query)
    assert query["state"] == ["state-123"]
    if fake.iss:
        assert query["iss"] == [fake.issuer]

    form = {
        "grant_type": "authorization_code",
        "code": query["code"][0],
        "redirect_uri": CALLBACK,
        "client_id": client["client_id"],
        "code_verifier": verifier,
        "resource": f"{BASE}/mcp",
    }
    if "client_secret" in client:
        form["client_secret"] = client["client_secret"]
    # A wrong verifier is refused and doesn't use the code up... a used code is refused.
    wrong = c.post(f"{BASE}/token", data={**form, "code_verifier": "w" * 64})
    assert wrong.status_code == 400 and wrong.json() == {"error": "invalid_grant"}
    token = c.post(f"{BASE}/token", data=form)
    assert token.status_code == 200, token.text
    assert c.post(f"{BASE}/token", data=form).json() == {"error": "invalid_grant"}
    return client, token.json()


def test_a_whole_sign_in_refresh_and_revoke_through_handle():
    fake = FakeConnectorServer(BASE, iss=True, expires_in=120)
    with _client(fake) as c:
        client, token = _sign_in(fake, c)
        assert "client_secret" not in client
        assert token["token_type"] == "Bearer" and token["expires_in"] == 120
        assert token["scope"] == "read"
        assert token["access_token"] in fake.access_tokens

        refresh = {
            "grant_type": "refresh_token",
            "refresh_token": token["refresh_token"],
            "client_id": client["client_id"],
            "resource": f"{BASE}/mcp",
        }
        second = c.post(f"{BASE}/token", data=refresh).json()
        assert second["access_token"] != token["access_token"]
        assert second["refresh_token"] != token["refresh_token"]  # rotated
        # The spent refresh token is refused.
        assert c.post(f"{BASE}/token", data=refresh).json() == {"error": "invalid_grant"}

        revoked = c.post(f"{BASE}/revoke", data={"token": second["refresh_token"]})
        assert revoked.status_code == 200
        spent = {**refresh, "refresh_token": second["refresh_token"]}
        assert c.post(f"{BASE}/token", data=spent).json() == {"error": "invalid_grant"}
    assert [r.url.path for r in fake.requests].count("/token") == 6


def test_a_confidential_server_hands_out_a_secret_and_wants_it_back():
    fake = FakeConnectorServer(BASE, confidential=True)
    with _client(fake) as c:
        refused = c.post(f"{BASE}/register", json={"token_endpoint_auth_method": "none"})
        assert refused.status_code == 400
        client, token = _sign_in(fake, c, method="client_secret_post")
        assert client["client_secret"]

        refresh = {
            "grant_type": "refresh_token",
            "refresh_token": token["refresh_token"],
            "client_id": client["client_id"],
        }
        no_secret = c.post(f"{BASE}/token", data=refresh)
        assert no_secret.status_code == 401 and no_secret.json() == {"error": "invalid_client"}
        basic = c.post(
            f"{BASE}/token", data=refresh, auth=(client["client_id"], client["client_secret"])
        )
        assert basic.status_code == 200


def test_the_refresh_knobs():
    fake = FakeConnectorServer(BASE, rotate_refresh=False)
    with _client(fake) as c:
        client, token = _sign_in(fake, c)
        refresh = {
            "grant_type": "refresh_token",
            "refresh_token": token["refresh_token"],
            "client_id": client["client_id"],
        }
        kept = c.post(f"{BASE}/token", data=refresh).json()
        assert "refresh_token" not in kept  # no new one: the old one stays good
        assert c.post(f"{BASE}/token", data=refresh).status_code == 200

        fake.fail_refresh = "invalid_grant"
        reply = c.post(f"{BASE}/token", data=refresh)
        assert (reply.status_code, reply.json()) == (400, {"error": "invalid_grant"})
        fake.fail_refresh = "invalid_client"
        reply = c.post(f"{BASE}/token", data=refresh)
        assert (reply.status_code, reply.json()) == (401, {"error": "invalid_client"})
        fake.fail_refresh = 503
        assert c.post(f"{BASE}/token", data=refresh).status_code == 503


# ---- the subprocess: the same routes plus /mcp ----


async def _tools(url: str, token: str):
    async with (
        httpx.AsyncClient(headers={"Authorization": f"Bearer {token}"}) as http,
        streamable_http_client(url, http_client=http) as (read, write, _),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        listed = (await session.list_tools()).tools
        made = await session.call_tool("create_thing", {"name": "Third"})
        return listed, made


def test_the_subprocess_lists_four_tools_with_a_bearer(fake_connector_url):
    listed, made = asyncio.run(_tools(fake_connector_url, STATIC_TOKEN))
    read_only = {t.name: bool(t.annotations and t.annotations.readOnlyHint) for t in listed}
    assert read_only == {
        "list_things": True,
        "get_thing": True,
        "create_thing": False,
        "list_projects": True,
    }
    assert next(t for t in listed if t.name == "create_thing").annotations is None
    assert made.isError is False and "https://" in made.content[0].text


def test_the_subprocess_answers_401_without_a_bearer_and_403_to_forbidden(fake_connector_url):
    base = fake_connector_url.removesuffix("/mcp")
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    assert httpx.post(fake_connector_url, json=body).status_code == 401
    wrong = httpx.post(fake_connector_url, json=body, headers={"Authorization": "Bearer nope"})
    assert wrong.status_code == 401
    assert 'resource_metadata="' + base in wrong.headers["www-authenticate"]
    forbidden = httpx.post(
        fake_connector_url, json=body, headers={"Authorization": "Bearer forbidden"}
    )
    assert forbidden.status_code == 403
    # The sign-in routes are served by the same process, with an Allow page.
    assert httpx.get(f"{base}/.well-known/oauth-authorization-server").json()["issuer"] == base
