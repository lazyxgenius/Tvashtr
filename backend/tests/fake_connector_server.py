"""A fake OAuth MCP server for the Connectors tests and e2e.

Two ways to use it:

* ``FakeConnectorServer(base_url).handle`` is an ``httpx.MockTransport`` handler covering the
  sign-in side: protected-resource metadata, authorization-server metadata, ``/register``,
  ``/authorize`` (a page with one Allow button), ``/token`` (code and refresh grants), ``/revoke``,
  and the 401 an unauthenticated ``/mcp`` request gets. It records every request in ``requests``.
* ``FakeConnectorServer(base_url).app()`` is the same behind a real HTTP server, plus a real MCP
  endpoint at ``/mcp`` (streamable HTTP) and at ``/sse`` (the older SSE transport), bearer
  required on both. ``python backend/tests/fake_connector_server.py --port
  9911`` serves it; the ``fake_connector_url`` fixture runs that as a subprocess. Never mount it on
  the shared test app (``test_domain_mcp_http.py``: probing a streamable-HTTP mount through the
  shared TestClient tears down the DBOS lifespan).

``/mcp`` accepts the tokens this server issued and the fixed bearer ``fake-static-token``, and
answers 403 to the bearer ``forbidden`` (a refusal that is not an expired sign-in).

Knobs (constructor keywords; also plain attributes a test may flip mid-way):
``dcr`` (dynamic registration offered), ``cimd`` (client metadata documents advertised), ``iss``
(the ``iss`` response parameter advertised and sent), ``confidential`` (no ``none`` auth method:
clients get a secret and must send it), ``expires_in``, ``rotate_refresh`` (a refresh returns a new
refresh token), ``fail_refresh`` (``"invalid_grant"`` | ``"invalid_client"`` | an HTTP status),
``path_issuer`` (the issuer is ``<base>/oauth``), ``no_resource_metadata`` (no protected-resource
metadata, as Intercom), ``no_pkce`` (S256 not advertised), ``mixup`` (the metadata names another
site's endpoint: ``True`` for the authorize endpoint, or an endpoint's metadata key).
"""

import argparse
import base64
import hashlib
import html
import json
import secrets
from urllib.parse import parse_qs, urlencode

import httpx

STATIC_TOKEN = "fake-static-token"
FORBIDDEN_TOKEN = "forbidden"
OTHER_SITE = "https://login.other-site.test"

_ENDPOINTS = {
    "authorization_endpoint": "/authorize",
    "token_endpoint": "/token",
    "revocation_endpoint": "/revoke",
    "registration_endpoint": "/register",
}


_MCP_PATHS = ("/mcp", "/sse", "/messages")


def _json(status: int, body: dict) -> httpx.Response:
    return httpx.Response(status, json=body)


def _oauth_error(status: int, code: str) -> httpx.Response:
    return _json(status, {"error": code})


class FakeConnectorServer:
    def __init__(
        self,
        base_url: str = "https://mcp.fake.test",
        *,
        dcr: bool = True,
        cimd: bool = False,
        iss: bool = False,
        confidential: bool = False,
        expires_in: int | None = 3600,
        rotate_refresh: bool = True,
        fail_refresh: str | int | None = None,
        path_issuer: bool = False,
        no_resource_metadata: bool = False,
        no_pkce: bool = False,
        mixup: bool | str = False,
    ) -> None:
        self.base = base_url.rstrip("/")
        self.dcr, self.cimd, self.iss, self.confidential = dcr, cimd, iss, confidential
        self.expires_in, self.rotate_refresh, self.fail_refresh = (
            expires_in,
            rotate_refresh,
            fail_refresh,
        )
        self.path_issuer, self.no_resource_metadata = path_issuer, no_resource_metadata
        self.no_pkce, self.mixup = no_pkce, mixup
        self.requests: list[httpx.Request] = []
        self.clients: dict[str, dict] = {}
        self.codes: dict[str, dict] = {}
        self.access_tokens: set[str] = set()
        self.refresh_tokens: dict[str, str] = {}  # refresh token -> client_id

    # ---- what it advertises ----

    @property
    def issuer(self) -> str:
        return f"{self.base}/oauth" if self.path_issuer else self.base

    @property
    def mcp_url(self) -> str:
        return f"{self.base}/mcp"

    def _resource_metadata(self) -> dict:
        return {
            "resource": self.mcp_url,
            "authorization_servers": [self.issuer],
            "scopes_supported": ["read", "write"],
        }

    def _server_metadata(self) -> dict:
        meta = {"issuer": self.issuer}
        mixed = "authorization_endpoint" if self.mixup is True else self.mixup
        for key, path in _ENDPOINTS.items():
            if key == "registration_endpoint" and not self.dcr:
                continue
            meta[key] = (OTHER_SITE if key == mixed else self.base) + path
        meta["response_types_supported"] = ["code"]
        meta["grant_types_supported"] = ["authorization_code", "refresh_token"]
        if not self.no_pkce:
            meta["code_challenge_methods_supported"] = ["S256"]
        meta["token_endpoint_auth_methods_supported"] = (
            ["client_secret_basic", "client_secret_post"]
            if self.confidential
            else ["none", "client_secret_post", "client_secret_basic"]
        )
        if self.cimd:
            meta["client_id_metadata_document_supported"] = True
        if self.iss:
            meta["authorization_response_iss_parameter_supported"] = True
        return meta

    def mcp_refusal(self, authorization: str | None) -> httpx.Response | None:
        """What ``/mcp`` answers instead of serving: 403 to ``forbidden``, 401 to anything that
        isn't a token this server knows, ``None`` for a good bearer."""
        token = (authorization or "").removeprefix("Bearer ").strip()
        if token == FORBIDDEN_TOKEN:
            return _json(403, {"error": "forbidden"})
        if token == STATIC_TOKEN or token in self.access_tokens:
            return None
        challenge = "Bearer"
        if not self.no_resource_metadata:
            metadata = f"{self.base}/.well-known/oauth-protected-resource/mcp"
            challenge = f'Bearer resource_metadata="{metadata}", scope="read"'
        return httpx.Response(
            401, json={"error": "unauthorized"}, headers={"WWW-Authenticate": challenge}
        )

    # ---- the MockTransport handler ----

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if f"{request.url.scheme}://{request.url.netloc.decode()}" != self.base:
            return httpx.Response(404)
        path, method = request.url.path, request.method
        server_path = "/.well-known/oauth-authorization-server" + (
            "/oauth" if self.path_issuer else ""
        )
        if path in (
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-protected-resource",
        ):
            if self.no_resource_metadata:
                return httpx.Response(404)
            return _json(200, self._resource_metadata())
        if path == server_path:
            return _json(200, self._server_metadata())
        if path == "/mcp":
            # handle() doesn't speak MCP; app() does.
            return self.mcp_refusal(request.headers.get("authorization")) or httpx.Response(405)
        if path == "/register" and method == "POST" and self.dcr:
            return self._register(json.loads(request.content or b"{}"))
        if path == "/authorize" and method in ("GET", "POST"):
            return self._authorize(request)
        if path == "/token" and method == "POST":
            return self._token(request)
        if path == "/revoke" and method == "POST":
            token = parse_qs(request.content.decode()).get("token", [""])[0]
            self.access_tokens.discard(token)
            self.refresh_tokens.pop(token, None)
            return httpx.Response(200)
        return httpx.Response(404)

    def _register(self, body: dict) -> httpx.Response:
        method = body.get("token_endpoint_auth_method", "client_secret_basic")
        if self.confidential and method == "none":
            return _oauth_error(400, "invalid_client_metadata")
        client = {**body, "client_id": f"client-{len(self.clients) + 1}"}
        if method != "none":
            client |= {"client_secret": secrets.token_urlsafe(16), "client_secret_expires_at": 0}
        self.clients[client["client_id"]] = client
        return _json(201, client)

    def _authorize(self, request: httpx.Request) -> httpx.Response:
        q = dict(request.url.params)
        known = q.get("client_id") in self.clients or (
            self.cimd and q.get("client_id", "").startswith("https://")
        )
        if not known or q.get("response_type") != "code" or not q.get("redirect_uri"):
            return _oauth_error(400, "invalid_request")
        if not q.get("code_challenge") or q.get("code_challenge_method") != "S256":
            return _oauth_error(400, "invalid_request")
        if request.method == "GET":
            page = (
                "<!doctype html><title>Fake connector</title>"
                f"<p>Allow {html.escape(q['client_id'])} to use the fake connector?</p>"
                '<form method="post"><button type="submit">Allow</button></form>'
            )
            return httpx.Response(200, html=page)
        code = secrets.token_urlsafe(16)
        self.codes[code] = q
        back = {"code": code, "state": q.get("state", "")}
        if self.iss:
            back["iss"] = self.issuer
        sep = "&" if "?" in q["redirect_uri"] else "?"
        return httpx.Response(302, headers={"Location": q["redirect_uri"] + sep + urlencode(back)})

    def _client_ok(self, request: httpx.Request, form: dict) -> bool:
        """Client authentication: a registered secret must come back, in the form or as Basic."""
        client_id, secret = form.get("client_id", ""), form.get("client_secret")
        basic = request.headers.get("authorization", "")
        if basic.startswith("Basic "):
            client_id, _, secret = base64.b64decode(basic[6:]).decode().partition(":")
        expected = self.clients.get(client_id, {}).get("client_secret")
        return expected is None or secret == expected

    def _token(self, request: httpx.Request) -> httpx.Response:
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        if not self._client_ok(request, form):
            return _oauth_error(401, "invalid_client")
        grant = form.get("grant_type")
        if grant == "authorization_code":
            pending = self.codes.get(form.get("code", ""))
            verifier = form.get("code_verifier", "")
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            if (
                pending is None
                or pending["redirect_uri"] != form.get("redirect_uri")
                or pending["client_id"] != form.get("client_id", pending["client_id"])
                or challenge.rstrip(b"=").decode() != pending["code_challenge"]
            ):
                return _oauth_error(400, "invalid_grant")
            del self.codes[form["code"]]  # a code works once
            return self._issue(pending["client_id"], pending.get("scope"), new_refresh=True)
        if grant == "refresh_token":
            if isinstance(self.fail_refresh, int):
                return httpx.Response(self.fail_refresh)
            if self.fail_refresh:
                status = 401 if self.fail_refresh == "invalid_client" else 400
                return _oauth_error(status, self.fail_refresh)
            old = form.get("refresh_token", "")
            if old not in self.refresh_tokens:
                return _oauth_error(400, "invalid_grant")
            client_id = self.refresh_tokens[old]
            if self.rotate_refresh:
                del self.refresh_tokens[old]
            return self._issue(client_id, form.get("scope"), new_refresh=self.rotate_refresh)
        return _oauth_error(400, "unsupported_grant_type")

    def _issue(self, client_id: str, scope: str | None, *, new_refresh: bool) -> httpx.Response:
        reply = {"access_token": secrets.token_urlsafe(16), "token_type": "Bearer"}
        self.access_tokens.add(reply["access_token"])
        if self.expires_in is not None:
            reply["expires_in"] = self.expires_in
        if new_refresh:
            reply["refresh_token"] = secrets.token_urlsafe(16)
            self.refresh_tokens[reply["refresh_token"]] = client_id
        if scope:
            reply["scope"] = scope
        return _json(200, reply)

    # ---- the real server ----

    def app(self):
        """A Starlette app: ``/mcp`` and ``/sse`` are a real MCP server (mcp SDK ``FastMCP``,
        bearer required), every other path goes to :meth:`handle`."""
        from mcp.server.fastmcp import FastMCP
        from mcp.server.transport_security import TransportSecuritySettings
        from mcp.types import ToolAnnotations
        from starlette.datastructures import Headers
        from starlette.requests import Request
        from starlette.responses import Response
        from starlette.routing import Route

        mcp = FastMCP(
            "fake-connector",
            stateless_http=True,
            json_response=True,
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        )
        things = {"t1": "First thing", "t2": "Second thing"}
        read_only = ToolAnnotations(readOnlyHint=True)

        @mcp.tool(annotations=read_only)
        def list_things() -> str:
            """List the things."""
            return json.dumps([{"id": k, "name": v} for k, v in things.items()])

        @mcp.tool(annotations=read_only)
        def get_thing(id: str) -> str:
            """Read one thing."""
            return json.dumps({"id": id, "name": things[id]})

        @mcp.tool()
        def create_thing(name: str) -> str:
            """Create a thing (a write: it carries no read-only annotation)."""
            things[key := f"t{len(things) + 1}"] = name
            return json.dumps(
                {"id": key, "name": name, "url": f"https://fake.example/things/{key}"}
            )

        @mcp.tool(annotations=read_only)
        def list_projects() -> str:
            """List the projects a connection can be scoped to."""
            return json.dumps(
                [
                    {"id": "abcd1234", "name": "trade-mcp-prod", "region": "ap-southeast-1"},
                    {"id": "efgh5678", "name": "trade-mcp-dev", "region": "us-east-1"},
                ]
            )

        def _reply(reply: httpx.Response) -> Response:
            headers = {
                k: v for k, v in reply.headers.items() if k.lower() not in ("content-length",)
            }
            return Response(reply.content, reply.status_code, headers=headers)

        async def sign_in(request: Request) -> Response:
            return _reply(
                self.handle(
                    httpx.Request(
                        request.method,
                        str(request.url),
                        headers=request.headers.raw,
                        content=await request.body(),
                    )
                )
            )

        fake = self

        class BearerGate:
            def __init__(self, inner) -> None:
                self.inner = inner

            async def __call__(self, scope, receive, send) -> None:
                if scope["type"] == "http" and scope["path"].startswith(_MCP_PATHS):
                    refusal = fake.mcp_refusal(Headers(scope=scope).get("authorization"))
                    if refusal is not None:
                        return await _reply(refusal)(scope, receive, send)
                await self.inner(scope, receive, send)

        app = mcp.streamable_http_app()  # has the /mcp route and the session manager's lifespan
        app.router.routes.extend(mcp.sse_app().routes)  # /sse and /messages/
        app.router.routes.append(Route("/{path:path}", sign_in, methods=["GET", "POST"]))
        app.add_middleware(BearerGate)
        return app


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=9911)
    port = parser.parse_args().port
    uvicorn.run(
        FakeConnectorServer(f"http://127.0.0.1:{port}").app(),
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
