"""Connectors: MCP authorization (discovery, client registration, tokens).

Tvashtr's backend is the OAuth client. Contract: ``docs/superpowers/plans/api/connectors.md``
(OAuth, Tokens). All HTTP here goes through ``connector_net.client()``, and every address is
passed through ``connector_net.check_url`` first. Metadata is read as plain dicts: the ``issuer``
comparisons are on the raw strings (a URL type adds a trailing slash).
"""

import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from mcp.client.auth.utils import (
    build_oauth_authorization_server_metadata_discovery_urls,
    build_protected_resource_metadata_discovery_urls,
    extract_resource_metadata_from_www_auth,
    extract_scope_from_www_auth,
)
from mcp.shared.auth_utils import check_resource_allowed

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_net
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection


class CannotRegister(Exception):
    """A sign-in was found but Tvashtr can't use it: no pre-registered client, no client metadata
    document support and no dynamic registration; PKCE S256 isn't advertised; or a sign-in
    endpoint is on another site than its issuer (mix-up). The routes answer 422
    ``cannot_register``."""


class SignInRefused(Exception):
    """The stored sign-in no longer works: the refresh was refused (``invalid_grant``,
    ``invalid_client``), there is no refresh token and the access token expired, or the row is
    gone. The row (when there is one) is ``needs_signin`` by the time this is raised."""


class Unreachable(Exception):
    """A sign-in endpoint didn't answer (network error, timeout, 5xx). Nothing was changed."""


@dataclass(frozen=True)
class Discovery:
    """What MCP authorization discovery found for one address. Every endpoint has passed the
    contract's checks (https, issuer match, S256, resource covers the address, mix-up)."""

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    resource: str  # the protected-resource metadata's value, sent verbatim as ``resource``
    registration_endpoint: str | None = None
    revocation_endpoint: str | None = None  # None when absent or on another site
    scope: str | None = None  # the 401's ``scope``, else ``scopes_supported`` joined, else None
    iss_supported: bool = False  # ``authorization_response_iss_parameter_supported``
    cimd_supported: bool = False  # ``client_id_metadata_document_supported``
    token_auth_methods: tuple[str, ...] = ()  # ``token_endpoint_auth_methods_supported``

    @property
    def signin_host(self) -> str:
        """The host the browser is sent to."""
        return urlsplit(self.authorization_endpoint).hostname or ""


def _pins(entry: dict | None, url: str) -> dict:
    """``entry`` when it may pin sign-in details (``oauth_hosts``, ``scope``, ``client``): a
    Featured entry, and only for its own address. A registry or custom entry never can, so a
    custom server that names Google's sign-in is never treated like Google's own."""
    if entry and entry.get("featured") is True and entry.get("url") == url:
        return entry
    return {}


def _document_of(response: httpx.Response | None, statuses: tuple[int, ...] = (200,)) -> dict:
    """The JSON object of an answer with one of ``statuses``, else ``{}``."""
    if response is None or response.status_code not in statuses:
        return {}
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _scopes(document: dict) -> str | None:
    listed = document.get("scopes_supported")
    if isinstance(listed, list) and listed and all(isinstance(s, str) for s in listed):
        return " ".join(listed)
    return None


def discover(url: str, entry: dict | None = None) -> Discovery | None:
    """Run MCP authorization discovery on ``url``. ``None`` when the server offers no sign-in.
    ``entry`` is the catalog entry (a Featured one may pin ``oauth_hosts``). Raises
    :class:`CannotRegister` when a sign-in is there but fails a check, :class:`Unreachable` when
    the server doesn't answer or ``url`` isn't an address Tvashtr opens."""
    pins = _pins(entry, url)
    try:
        connector_net.check_url(url)
    except connector_net.UnsafeUrl as exc:
        raise Unreachable(str(exc)) from exc
    answered = False

    with connector_net.client(headers={"Accept": "application/json, text/event-stream"}) as http:

        def get(address: str) -> httpx.Response | None:
            """``None`` for an address Tvashtr won't open and for one that doesn't answer."""
            nonlocal answered
            try:
                response = http.get(connector_net.check_url(address))
            except (connector_net.UnsafeUrl, httpx.HTTPError):
                return None
            answered = answered or response.status_code < 500
            return response

        # 1. Protected-resource metadata: where the 401's header says, then the well-known
        # addresses. They are tried whatever the first request answers (several servers answer a
        # GET 405 or 404).
        try:
            first = http.get(url)
            answered = first.status_code < 500
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise Unreachable(f"{urlsplit(url).hostname} can't be connected to") from exc
        except (connector_net.UnsafeUrl, httpx.HTTPError):
            first = None  # e.g. a stream that stays open: the well-known addresses still say
        challenged = first is not None and first.status_code == 401
        named = extract_resource_metadata_from_www_auth(first) if challenged else None
        scope = extract_scope_from_www_auth(first) if challenged else None
        resource: dict = {}
        # (``dict.fromkeys``: the header usually names the well-known address itself.)
        candidates = build_protected_resource_metadata_discovery_urls(named, url)
        for address in dict.fromkeys(candidates):
            found = _document_of(get(address))
            servers = found.get("authorization_servers")
            if isinstance(found.get("resource"), str) and isinstance(servers, list) and servers:
                resource = found
                break
        if resource and not check_resource_allowed(url, resource["resource"]):
            raise CannotRegister("the resource metadata is for another address")

        # 2. Authorization-server metadata, in the spec's order. With no resource metadata: the
        # MCP origin's own (Intercom).
        parts = urlsplit(url)
        issuer = resource["authorization_servers"][0] if resource else None
        if issuer is not None and not isinstance(issuer, str):
            raise CannotRegister("the resource metadata names no sign-in server")
        server: dict = {}
        for address in build_oauth_authorization_server_metadata_discovery_urls(issuer, url):
            server = _document_of(get(address))
            if server:
                break

    if not server:
        if resource:
            raise CannotRegister("the sign-in server's metadata can't be read")
        if not answered:
            raise Unreachable(f"{parts.hostname} didn't answer")
        return None

    # 3. The metadata must be the issuer's own, and offer PKCE S256.
    issuer = issuer or f"{parts.scheme}://{parts.netloc}"
    if server.get("issuer") != issuer:
        raise CannotRegister("the sign-in server's metadata names another issuer")
    if "S256" not in (server.get("code_challenge_methods_supported") or ()):
        raise CannotRegister("the sign-in server doesn't advertise PKCE S256")

    # 4. Mix-up: every endpoint is an address Tvashtr opens, on the issuer's site (or on a host
    # a Featured entry pins).
    home = connector_net.site(urlsplit(issuer).hostname or "")
    pinned = pins.get("oauth_hosts") or ()

    def endpoint(name: str) -> str | None:
        """The endpoint when it is usable, ``None`` when it is absent, else ``CannotRegister``."""
        value = server.get(name)
        if value is None:
            return None
        try:
            host = urlsplit(connector_net.check_url(value)).hostname or ""
        except (connector_net.UnsafeUrl, TypeError, AttributeError) as exc:
            raise CannotRegister(f"{name} isn't an address Tvashtr opens") from exc
        if connector_net.site(host) != home and host not in pinned:
            raise CannotRegister(f"{name} is on another site than its issuer")
        return value

    authorization, token = endpoint("authorization_endpoint"), endpoint("token_endpoint")
    if not authorization or not token:
        raise CannotRegister("the sign-in server's metadata is missing an endpoint")
    try:
        revocation = endpoint("revocation_endpoint")
    except CannotRegister:
        revocation = None  # revoking is best effort: an unusable address is just not used
    methods = server.get("token_endpoint_auth_methods_supported")
    return Discovery(
        issuer=issuer,
        authorization_endpoint=authorization,
        token_endpoint=token,
        resource=resource["resource"] if resource else url,
        registration_endpoint=endpoint("registration_endpoint"),
        revocation_endpoint=revocation,
        scope=scope or _scopes(resource) or _scopes(server),
        iss_supported=server.get("authorization_response_iss_parameter_supported") is True,
        cimd_supported=server.get("client_id_metadata_document_supported") is True,
        token_auth_methods=tuple(m for m in methods if isinstance(m, str))
        if isinstance(methods, list)
        else (),
    )


# ---- the client Tvashtr signs in as ----

CALLBACK_PATH = "/api/connectors/oauth/callback"
CLIENT_METADATA_PATH = "/oauth/client-metadata.json"


def _base_url() -> str:
    return get_settings().public_base_url.rstrip("/")


def redirect_uri() -> str:
    """The one redirect address for every connector. Built from ``TVASHTR_PUBLIC_BASE_URL``,
    never from the request (on Desktop the frontend's origin is ``127.0.0.1``)."""
    return _base_url() + CALLBACK_PATH


def client_metadata() -> dict | None:
    """Tvashtr's client ID metadata document, or ``None`` when the public base URL isn't
    ``https://`` (a sign-in server couldn't fetch it; local development registers instead)."""
    base = _base_url()
    if not base.startswith("https://"):
        return None
    return {
        "client_id": base + CLIENT_METADATA_PATH,
        "client_name": "Tvashtr",
        "client_uri": base,
        "redirect_uris": [redirect_uri()],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }


def _google_secret() -> str:
    return get_settings().google_oauth_client_secret.get_secret_value()


def client_kind(found: Discovery, entry: dict | None, url: str) -> str:
    """How Tvashtr gets a client for this sign-in, first match: ``preregistered`` (a Featured
    entry that names one, on its pinned address only), ``cimd`` (a client ID metadata document),
    ``dcr`` (dynamic registration). :class:`CannotRegister` when there is no way."""
    if _pins(entry, url).get("client") == "google":
        if get_settings().google_oauth_client_id and _google_secret():
            return "preregistered"
    if found.cimd_supported and client_metadata() is not None:
        return "cimd"
    if found.registration_endpoint:
        return "dcr"
    raise CannotRegister("no pre-registered client, no client metadata document, no registration")


def _post(url: str, **request: object) -> httpx.Response:
    """POST to a sign-in endpoint. :class:`Unreachable` when it doesn't answer: an address
    Tvashtr won't open, a network error, a timeout, a 5xx or a 429."""
    try:
        with connector_net.client() as http:
            response = http.post(connector_net.check_url(url), **request)
    except (connector_net.UnsafeUrl, httpx.HTTPError) as exc:
        raise Unreachable(f"{urlsplit(url).hostname} didn't answer") from exc
    if response.status_code >= 500 or response.status_code == 429:
        raise Unreachable(f"{urlsplit(url).hostname} answered {response.status_code}")
    return response


def _register(found: Discovery) -> dict:
    """Dynamic client registration (RFC 7591). A public client where the server takes one, else
    one with a secret (Supabase, Vercel)."""
    methods = found.token_auth_methods
    method = next(
        (m for m in ("none", "client_secret_post") if m in methods), "client_secret_basic"
    )
    body = {
        "client_name": "Tvashtr",
        "client_uri": _base_url(),
        "redirect_uris": [redirect_uri()],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "application_type": "web",
        "token_endpoint_auth_method": method,
    }
    if found.scope:
        body["scope"] = found.scope
    reply = _document_of(_post(found.registration_endpoint, json=body), (200, 201))
    if not isinstance(reply.get("client_id"), str):
        raise CannotRegister("the sign-in server refused the registration")
    client = {
        "client_id": reply["client_id"],
        "auth_method": reply.get("token_endpoint_auth_method") or method,
        "kind": "dcr",
        "redirect_uri": redirect_uri(),
    }
    if reply.get("client_secret"):
        client["client_secret"] = reply["client_secret"]
        if reply.get("client_secret_expires_at"):  # 0 means it never expires
            client["secret_expires_at"] = reply["client_secret_expires_at"]
    return client


def _reusable(known: dict | None, issuer: str) -> dict | None:
    """The registration stored in the sign-in ``known``, when it is still good for ``issuer``:
    credentials are bound to the issuer they were registered with, and to the redirect address."""
    client = (known or {}).get("client") or {}
    expires = client.get("secret_expires_at")
    if (
        (known or {}).get("issuer") == issuer
        and client.get("kind") == "dcr"
        and client.get("client_id")
        and client.get("redirect_uri") == redirect_uri()
        and not (expires and expires < time.time() + 60)
    ):
        return client
    return None


def choose_client(
    found: Discovery, entry: dict | None, url: str, known: Iterable[dict | None] = ()
) -> dict:
    """The client for this sign-in, as stored under ``client``: ``{"client_id", "auth_method",
    "kind", …}``. ``known`` are the row's sign-ins (the one in flight, the stored one): a
    registration made with the same issuer is reused. Registers when it has to. Raises
    :class:`CannotRegister` or :class:`Unreachable`."""
    kind = client_kind(found, entry, url)
    if kind == "preregistered":
        # The secret is not copied here: ``_client_auth`` reads it from the settings.
        return {
            "client_id": get_settings().google_oauth_client_id,
            "auth_method": "client_secret_post",
            "kind": kind,
        }
    if kind == "cimd":
        return {"client_id": client_metadata()["client_id"], "auth_method": "none", "kind": kind}
    for sign_in in known:
        if client := _reusable(sign_in, found.issuer):
            return client
    return _register(found)


def ensure_access_token(connection_id: uuid.UUID, *, rejected: str | None = None) -> str:
    """A provider access token that should work now. Returns the stored one while it has more
    than five minutes left and isn't ``rejected`` (the token a provider just answered 401 to);
    otherwise refreshes under the row lock. Opens its own session and takes ``FOR UPDATE`` on the
    row, so never call it while holding that row's lock in another session. Raises
    :class:`SignInRefused` or :class:`Unreachable`.

    Phase 0 stub: returns the stored access token and never refreshes. Stream B2.5 fills it."""
    from tvashtr.control_plane import connectors

    with session_scope() as session:
        row = session.get(ConnectorConnection, connection_id)
        token = (connectors.read_secret(row) or {}).get("access_token") if row else None
    if not token:
        raise SignInRefused("no stored sign-in")
    return token


def revoke(connection_id: uuid.UUID) -> bool:
    """Best-effort RFC 7009 revoke of the stored sign-in at the provider. ``True`` when the
    provider answered 2xx. Never raises.

    Phase 0 stub: revokes nothing. Stream B2.5 fills it."""
    return False
