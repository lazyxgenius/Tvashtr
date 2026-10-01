"""Connectors: MCP authorization (discovery, client registration, tokens).

Tvashtr's backend is the OAuth client. Contract: ``docs/superpowers/plans/api/connectors.md``
(OAuth, Tokens). All HTTP here goes through ``connector_net.client()``, and every address is
passed through ``connector_net.check_url`` first. Metadata is read as plain dicts: the ``issuer``
comparisons are on the raw strings (a URL type adds a trailing slash).
"""

import base64
import hashlib
import hmac
import secrets
import threading
import time
import uuid
import weakref
from collections.abc import Iterable, Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlencode, urlsplit

import httpx
from mcp.client.auth import PKCEParameters
from mcp.client.auth.utils import (
    build_oauth_authorization_server_metadata_discovery_urls,
    build_protected_resource_metadata_discovery_urls,
    extract_resource_metadata_from_www_auth,
    extract_scope_from_www_auth,
)
from mcp.shared.auth_utils import check_resource_allowed
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tvashtr.config import get_settings

# ``connectors`` imports this module too: neither may use the other while it is being imported.
from tvashtr.control_plane import connector_catalog, connector_net, connector_upstream, connectors
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection, User


class CannotRegister(Exception):
    """A sign-in was found but Tvashtr can't use it: no pre-registered client, no client metadata
    document support and no dynamic registration; PKCE S256 isn't advertised; or a sign-in
    endpoint is on another site than its issuer (mix-up). The routes answer 422
    ``cannot_register``."""


class BorrowedSignIn(CannotRegister):
    """A registry or custom server (or a Featured entry on another address than its own) whose
    sign-in is on a Featured provider's sign-in site: the user would approve ``provider`` on its
    real page, and its token would go to a server nobody reviewed. The routes answer 422
    ``borrowed_signin``."""

    def __init__(self, provider: str):
        self.provider = provider
        self.message = (
            f"This server wants to use {provider}’s sign-in. "
            f"Connect {provider} from its own card instead."
        )
        super().__init__(self.message)


def _featured_signin_sites() -> dict[str, str]:
    """The site of each Featured entry's sign-in → its publisher: the site of its address, and of
    each host it pins (``oauth_hosts``)."""
    # ponytail: a Featured provider's sign-in is taken to be on its address's site (or a pinned
    # host). One that signs in on another site needs that host in its ``oauth_hosts``.
    sites: dict[str, str] = {}
    for entry in connector_catalog.FEATURED.values():
        hosts = [urlsplit(entry["url"]).hostname or "", *entry.get("oauth_hosts", ())]
        for host in hosts:
            sites.setdefault(connector_net.site(host), entry["publisher"])
    return sites


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


# What opening an address that came from outside raises when the address can't be opened:
# ``UnsafeUrl`` (a ``ValueError``; so is a host name the resolver can't encode), httpx's network
# errors, and ``InvalidURL`` for an address httpx itself won't build (too long, a bad host name).
_NOT_OPENED = (ValueError, httpx.HTTPError, httpx.InvalidURL)


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
    except (ValueError, RecursionError):  # not JSON, or nested too deep to parse
        return {}
    return body if isinstance(body, dict) else {}


def _scopes(document: dict) -> str | None:
    listed = document.get("scopes_supported")
    if isinstance(listed, list) and listed and all(isinstance(s, str) for s in listed):
        return " ".join(listed)
    return None


DISCOVERY_SECONDS = 20.0  # for all of one discovery's requests together
_now = time.monotonic  # the clock discovery's deadline is read from, as a name tests replace


def discover(url: str, entry: dict | None = None) -> Discovery | None:
    """Run MCP authorization discovery on ``url``. ``None`` when the server offers no sign-in.
    ``entry`` is the catalog entry (a Featured one may pin ``oauth_hosts``). Raises
    :class:`CannotRegister` when a sign-in is there but fails a check, :class:`Unreachable` when
    the server doesn't answer (or not within ``DISCOVERY_SECONDS``, all requests together) or
    ``url`` isn't an address Tvashtr opens."""
    try:
        return _discover(url, _pins(entry, url))
    except (ValueError, TypeError, AttributeError) as exc:
        # Everything a server's metadata says is untrusted. A value of the wrong type, or one
        # that can't be read as an address, is a sign-in Tvashtr can't use, never a crash.
        raise CannotRegister("the sign-in metadata can't be read") from exc


def _discover(url: str, pins: dict) -> Discovery | None:
    try:
        connector_net.check_url(url)
        httpx.URL(url)
    except (ValueError, httpx.InvalidURL) as exc:
        raise Unreachable(str(exc)) from exc
    answered = False
    # One deadline for every request below. Each has its own ten seconds, and there can be seven
    # of them one after the other.
    deadline = _now() + DISCOVERY_SECONDS

    with connector_net.client(headers={"Accept": "application/json, text/event-stream"}) as http:

        def get(address: str) -> httpx.Response | None:
            """``None`` for an address Tvashtr won't open and for one that doesn't answer."""
            nonlocal answered
            left = deadline - _now()
            if left <= 0:
                raise Unreachable(f"{urlsplit(url).hostname} took too long to answer")
            try:
                response = http.get(connector_net.check_url(address), timeout=min(10.0, left))
            except _NOT_OPENED:
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

    # 3. The metadata must be the issuer's own, and offer PKCE S256. The two are compared as raw
    # strings, but for one trailing slash: Google's resource metadata names
    # ``https://accounts.google.com/`` and its server metadata ``https://accounts.google.com``,
    # and a trailing slash can't name another server or tenant. The server's own spelling is the
    # one kept, because that is what it sends as ``iss``.
    asked = issuer or f"{parts.scheme}://{parts.netloc}"
    issuer = server.get("issuer")
    if not isinstance(issuer, str) or issuer.removesuffix("/") != asked.removesuffix("/"):
        raise CannotRegister("the sign-in server's metadata names another issuer")
    # A sign-in on a Featured provider's site is for that provider's own card only.
    if not pins:
        provider = _featured_signin_sites().get(connector_net.site(urlsplit(issuer).hostname or ""))
        if provider:
            raise BorrowedSignIn(provider)
    pkce = server.get("code_challenge_methods_supported")
    # A list: ``in`` on a string is a substring test, and on a number a crash.
    if not isinstance(pkce, list) or "S256" not in pkce:
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
            httpx.URL(value)  # and one the HTTP client will build
        except (ValueError, TypeError, AttributeError, httpx.InvalidURL) as exc:
            raise CannotRegister(f"{name} isn't an address Tvashtr opens") from exc
        if connector_net.site(host) != home and host not in pinned:
            raise CannotRegister(f"{name} is on {host}, another site than its issuer {issuer}")
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
GO_PATH = "/api/connectors/oauth/go"
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
    except _NOT_OPENED as exc:
        raise Unreachable(f"{_host(url)} didn't answer") from exc
    if response.status_code >= 500 or response.status_code == 429:
        raise Unreachable(f"{_host(url)} answered {response.status_code}")
    return response


def _host(url: str) -> str:
    """The host of a sign-in endpoint, for a message. The address may be one that can't be read."""
    try:
        return urlsplit(url).hostname or "the sign-in endpoint"
    except ValueError:
        return "the sign-in endpoint"


def _register(found: Discovery) -> dict:
    """Dynamic client registration (RFC 7591). A public client where the server takes one, else
    one with a secret (Supabase, Vercel)."""
    methods = found.token_auth_methods
    method = next(
        (m for m in ("none", "client_secret_post") if m in methods), "client_secret_basic"
    )
    redirect = redirect_uri()
    body = {
        "client_name": "Tvashtr",
        "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        # "web" everywhere it matters. A redirect to http://localhost (local development) is a
        # "native" client's: servers that hold "web" clients to https would refuse it.
        "application_type": "web" if redirect.startswith("https://") else "native",
        "token_endpoint_auth_method": method,
    }
    if found.scope:
        body["scope"] = found.scope
    reply = _document_of(_post(found.registration_endpoint, json=body), (200, 201))
    if not isinstance(reply.get("client_id"), str):
        raise CannotRegister("the sign-in server refused the registration")
    # The reply is the server's to write: each value is kept only when it is the type it should be.
    answered, secret = reply.get("token_endpoint_auth_method"), reply.get("client_secret")
    client = {
        "client_id": reply["client_id"],
        "auth_method": answered if answered and isinstance(answered, str) else method,
        "kind": "dcr",
        "redirect_uri": redirect,
    }
    if secret and isinstance(secret, str):
        client["client_secret"] = secret
        if _a_number(expires := reply.get("client_secret_expires_at")) and expires:
            client["secret_expires_at"] = expires  # 0 means it never expires
    return client


def _a_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


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
        and not (_a_number(expires) and expires and expires < time.time() + 60)
    ):
        return client
    return None


def choose_client(
    found: Discovery, entry: dict | None, url: str, known: Iterable[dict | None] = ()
) -> dict:
    """The client for this sign-in, as stored under ``client``: ``{"client_id", "auth_method",
    "kind", …}``. ``known`` are the row's sign-ins (the one in flight, the stored one): a
    registration made with the same issuer is reused, unless one of them records that the
    provider refused it (``refused_client``). Registers when it has to. Raises
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
    known = [sign_in for sign_in in known if sign_in]
    refused = {sign_in.get("refused_client") for sign_in in known}
    for sign_in in known:
        client = _reusable(sign_in, found.issuer)
        if client and client["client_id"] not in refused:
            return client
    return _register(found)


# ---- one call to a provider per connection at a time ----

_TURN_SECONDS = 15.0  # how long a caller waits for its turn before it gives up
_turns: weakref.WeakValueDictionary[str, threading.Lock] = weakref.WeakValueDictionary()
_turns_guard = threading.Lock()


@contextmanager
def _one_at_a_time(connection_id: object) -> Iterator[None]:
    """One caller per connection at a time, in this process, around the calls that ask a
    provider (a refresh, the start of a sign-in). Whoever waits here holds no database
    connection. Waiting for the row lock instead held one each for as long as the provider
    took, so one slow token endpoint could empty the pool for the whole backend. The row lock
    is still taken: it is what orders the writers of a sign-in across processes. A caller that
    doesn't get its turn within ``_TURN_SECONDS`` raises :class:`Unreachable`."""
    with _turns_guard:
        turn = _turns.setdefault(str(connection_id), threading.Lock())
    if not turn.acquire(timeout=_TURN_SECONDS):
        raise Unreachable("the provider is still answering an earlier call")
    try:
        yield
    finally:
        turn.release()


# ---- starting a sign-in ----

SIGNIN_TTL_SECONDS = 600  # how long a started sign-in can be finished


def state_hash(state: str) -> str:
    """What is stored of a ``state``: its SHA-256, never the value."""
    return hashlib.sha256(state.encode()).hexdigest()


def _refusal(exc: Exception, name: str, url: str) -> "connectors.ConnectorError":
    """The route's answer to a sign-in that can't be started."""
    if isinstance(exc, BorrowedSignIn):
        return connectors.ConnectorError(422, {"code": "borrowed_signin", "message": exc.message})
    if isinstance(exc, CannotRegister):
        message = f"{name} needs an app registered with it before Tvashtr can sign in."
        return connectors.ConnectorError(422, {"code": "cannot_register", "message": message})
    message = f"We couldn’t reach {urlsplit(url).hostname}. Try again."
    return connectors.ConnectorError(502, {"code": "unreachable", "message": message})


def start(owner_id: uuid.UUID, connection_id: object) -> dict:
    """``POST /api/connectors/{id}/oauth/start``: repeat discovery, pick the client, store the
    sign-in in flight under the row lock, and answer where to send the browser. The row's
    ``status`` and its stored sign-in are not touched. Raises ``connectors.ConnectorError``."""
    not_oauth = connectors.ConnectorError(
        409, {"code": "not_oauth", "message": "This connector doesn’t sign in."}
    )
    with session_scope() as session:
        row = connectors.get_owned(session, owner_id, connection_id)
        if row.auth_kind != "oauth":
            raise not_oauth
        row_id, url, name = row.id, row.url, row.name
        entry = connector_catalog.resolve(row.connector_key)
    pins = _pins(entry, url)
    try:
        # The provider is asked (discovery, a registration) with no database connection held and
        # the row not locked: only the write at the end takes the lock. It can take twenty
        # seconds of a worker thread, so it holds one of the places for such requests (a 429
        # ``busy`` when there is none).
        with connectors.provider_slot(owner_id), _one_at_a_time(row_id):
            found = discover(url, entry)
            if found is None:
                raise not_oauth
            with session_scope() as session:
                row = connectors.get_owned(session, owner_id, connection_id)
                # (A sign-in that can't be decrypted counts as none, here and below.)
                known = [
                    connectors.secret_or_none(row, pending=True),
                    connectors.secret_or_none(row),
                ]
            client = choose_client(found, entry, url, known)
            state = secrets.token_urlsafe(32)
            pending = {
                "code_verifier": PKCEParameters.generate().code_verifier,
                "issuer": found.issuer,
                "iss_supported": found.iss_supported,
                "authorization_endpoint": found.authorization_endpoint,
                "token_endpoint": found.token_endpoint,
                "revocation_endpoint": found.revocation_endpoint,
                "resource": found.resource,
                "scope": pins.get("scope") or found.scope,  # a Featured entry may pin it
                "client": client,
                "redirect_uri": redirect_uri(),
                "started_at": time.time(),
            }
            with session_scope() as session:
                row = connectors.get_owned(session, owner_id, connection_id, for_update=True)
                # The registration was read before the lock was held. In this process nothing
                # could change it since (the turn above); another process's refresh may have
                # been told the client is gone. Then nothing is stored, and the next start
                # registers again.
                in_flight = connectors.secret_or_none(row, pending=True) or {}
                if in_flight.get("refused_client") == client["client_id"]:
                    raise Unreachable("the registration was refused while the sign-in started")
                connectors.write_secret(row, pending, pending=True)
                row.state_hash = state_hash(state)
    except (CannotRegister, Unreachable) as exc:
        raise _refusal(exc, name, url) from exc

    return {
        "authorize_url": _authorize_url(entry, url, pending, state),
        # What the app opens. It marks the browser, then sends it on to ``authorize_url``.
        "open_url": f"{_base_url()}{GO_PATH}?{urlencode({'state': state})}",
        "signin_host": found.signin_host,
        "expires_in": SIGNIN_TTL_SECONDS,
    }


def _authorize_url(entry: dict | None, url: str, pending: dict, state: str) -> str:
    """The provider's authorize address for the sign-in in flight. Built from what is stored, so
    the address the hop sends a browser to is the one ``start`` answered."""
    challenge = hashlib.sha256(pending["code_verifier"].encode()).digest()
    params = {
        "response_type": "code",
        "client_id": pending["client"]["client_id"],
        "redirect_uri": pending["redirect_uri"],
        "state": state,
        "code_challenge": base64.urlsafe_b64encode(challenge).rstrip(b"=").decode(),
        "code_challenge_method": "S256",
        "resource": pending["resource"],  # the metadata's value, verbatim
    }
    if pending["scope"]:
        params["scope"] = pending["scope"]
    # What one provider's authorize page needs on top (Google: a refresh token is only handed out
    # with ``access_type=offline``). Only a Featured entry on its own address can say so.
    params |= _pins(entry, url).get("authorize_params") or {}
    endpoint = pending["authorization_endpoint"]
    return endpoint + ("&" if urlsplit(endpoint).query else "?") + urlencode(params)


def _in_time(pending: dict) -> bool:
    started = pending.get("started_at")
    return isinstance(started, int | float) and time.time() - started < SIGNIN_TTL_SECONDS


# ---- the browser a sign-in is opened in ----
#
# The ``state`` is handed to the connector's own sign-in server, so whoever holds it is not
# thereby the person who started the sign-in. The app opens the sign-in through ``GO_PATH``,
# which leaves a cookie in that browser (its hash is kept with the sign-in in flight) before it
# sends the browser on. The callback and the confirm step act only for that browser, or for one
# that holds the owner's Tvashtr session.


def browser_cookie(state: str) -> str:
    """The cookie's name: one per sign-in, so two sign-ins open at once don't take each other's."""
    return f"tv_signin_{state_hash(state)[:16]}"


def _is_browser(pending: dict, held: str | None) -> bool:
    marked = pending.get("browser")
    return bool(held) and isinstance(marked, str) and hmac.compare_digest(state_hash(held), marked)


def go(state: str, held: str | None) -> tuple[str, str | None] | None:
    """``GET /api/connectors/oauth/go``: ``(the provider's authorize address, the cookie value to
    set)`` for the browser that opens a sign-in. The first browser to open it is the one it is
    finished in; the value is ``None`` when that browser opens it again. ``None`` for an unknown
    or timed-out ``state`` and for any other browser. ``held`` is the cookie the request came
    with."""
    if not state:
        return None
    with session_scope() as session:
        row = session.execute(
            select(ConnectorConnection)
            .where(ConnectorConnection.state_hash == state_hash(state))
            .with_for_update()  # the lock every writer of the sign-in takes
        ).scalar_one_or_none()
        pending = (connectors.secret_or_none(row, pending=True) if row else None) or {}
        if not _in_time(pending):
            return None
        value = None
        if "browser" not in pending:
            value = secrets.token_urlsafe(32)
            connectors.write_secret(row, pending | {"browser": state_hash(value)}, pending=True)
        elif not _is_browser(pending, held):
            return None
        entry = connector_catalog.resolve(row.connector_key)
        return _authorize_url(entry, row.url, pending, state), value


# ---- finishing a sign-in: the callback and its confirm step ----

OTHER_ACCOUNT_ERROR = (
    "That browser is signed in to Tvashtr as a different account. Nothing was connected."
)


@dataclass(frozen=True)
class Outcome:
    """How a callback ended. The route turns it into a page. ``kind`` is one of ``connected``,
    ``confirm`` (ask first: the browser holds no Tvashtr session), ``expired``, ``failed``,
    ``denied``, ``other_account`` and ``busy`` (no place to wait on the provider: nothing was used
    up, the same ``state`` and ``code`` finish it on the next try)."""

    kind: str
    name: str = ""  # the connection's name
    email: str = ""  # the owner's, for the confirm page
    owner: str = ""  # the owner's id


def _not_finished(name: str) -> str:
    return f"{name} didn’t finish the sign-in. Try again."


def _client_auth(client: dict) -> tuple[dict, tuple[str, str] | None]:
    """How ``client`` authenticates at the token endpoint: the form fields to add, and the
    Basic credentials when that is its method."""
    secret = _google_secret() if client.get("kind") == "preregistered" else None
    secret = secret or client.get("client_secret")
    form = {"client_id": client["client_id"]}
    if secret and client.get("auth_method") == "client_secret_basic":
        return form, (client["client_id"], secret)
    if secret and client.get("auth_method") != "none":
        form["client_secret"] = secret
    return form, None


def _token_request(sign_in: dict, grant: dict) -> httpx.Response:
    """POST ``grant`` to the sign-in's token endpoint, as its client and for its resource."""
    form, auth = _client_auth(sign_in["client"])
    data = {**grant, **form, "resource": sign_in["resource"]}
    return _post(sign_in["token_endpoint"], data=data, auth=auth)


def _tokens(reply: dict) -> dict | None:
    """The tokens of a token endpoint's answer, as they are stored. ``None`` without an access
    token."""
    if not isinstance(reply.get("access_token"), str) or not reply["access_token"]:
        return None
    tokens = {"access_token": reply["access_token"]}
    if isinstance(reply.get("refresh_token"), str) and reply["refresh_token"]:
        tokens["refresh_token"] = reply["refresh_token"]
    try:
        tokens["expires_at"] = time.time() + int(reply["expires_in"])
    except (KeyError, TypeError, ValueError, OverflowError):
        # No expiry named, or none that is a usable number (``1e999``): the token is used until
        # the provider refuses it.
        pass
    return tokens


def _use_up(
    session: Session, hashed: str, replacement: str | None = None
) -> ConnectorConnection | None:
    """Use a ``state`` up, in one statement, and return its row (locked until the session
    commits). ``None`` when no sign-in in flight has that state any more, so a state works once
    and of two callbacks that arrive together exactly one goes on."""
    used = session.execute(
        update(ConnectorConnection)
        .where(ConnectorConnection.state_hash == hashed)
        .values(state_hash=replacement)
        .returning(ConnectorConnection.id)
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    if used is None:
        return None
    return session.get(ConnectorConnection, used, populate_existing=True)


def _discovered(pending: dict, *, client_refused: bool = False) -> dict:
    """A sign-in in flight that is over: what discovery found stays (the sign-in host is still
    known and a registration can be reused), the PKCE verifier goes. ``client_refused``: the token
    endpoint refused the client itself, so its id is recorded as ``refused_client`` and no later
    sign-in reuses that registration (from here or from the stored sign-in)."""
    over = ("code_verifier", "started_at", "browser")
    kept = {k: v for k, v in pending.items() if k not in over}
    if client_refused:
        kept["refused_client"] = pending["client"]["client_id"]
    return kept


def _clear(state: str, last_error: str, kind: str, name: str) -> Outcome:
    """Clear the sign-in in flight and say why on the row."""
    with session_scope() as session:
        row = _use_up(session, state_hash(state))
        if row is None:
            return Outcome("expired")
        pending = connectors.read_secret(row, pending=True)
        connectors.write_secret(row, _discovered(pending) if pending else None, pending=True)
        row.last_error = last_error
    return Outcome(kind, name)


def _arrive(state: str, iss: str | None, session_user: str | None, browser: str | None) -> Outcome:
    """Callback steps 1 and 2. ``confirm`` (with the row's name and its owner) when ``state``
    belongs to a sign-in started under ten minutes ago, the request comes from the browser it
    was opened in (``browser``, its cookie) or one with the owner's session (``session_user``),
    and the answer is from its issuer. Nothing is used up and nothing is written."""
    if not state:
        return Outcome("expired")
    with session_scope() as session:
        row = session.execute(
            select(ConnectorConnection).where(ConnectorConnection.state_hash == state_hash(state))
        ).scalar_one_or_none()
        pending = (connectors.secret_or_none(row, pending=True) if row else None) or {}
        if not _in_time(pending):
            return Outcome("expired")
        # Anyone else holding the state (the sign-in server was sent it) is told nothing about
        # the sign-in, and can neither finish nor cancel it.
        if session_user != str(row.owner_id) and not _is_browser(pending, browser):
            return Outcome("expired")
        # RFC 9207. A sent ``iss`` must be the issuer the sign-in was started with, exactly; a
        # missing one is refused only when the server said it sends one. On a mismatch nothing
        # else in the request is acted on.
        from_another = iss != pending.get("issuer") if iss else bool(pending.get("iss_supported"))
        if from_another:
            return Outcome("failed", row.name)
        owner = session.get(User, row.owner_id)
        return Outcome("confirm", row.name, owner.email, str(owner.id))


def _list_tools(url: str, transport: str, access_token: str) -> list[dict] | None:
    """The provider's tools right after a sign-in. ``None`` when they can't be listed: that
    never fails the sign-in."""
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        return connectors.stored_tools(connector_upstream.list_tools_sync(url, transport, headers))
    except Exception:  # whatever went wrong here, the sign-in itself worked
        return None


def _complete(state: str, code: str) -> Outcome:
    """Exchange ``code`` and store the sign-in. The state is used up first, so this runs once
    per sign-in. It is swapped for a value nobody knows instead of being cleared, so the row
    reads ``signin_pending`` until the outcome is written (the app polls that field, and would
    otherwise see a finished sign-in with nothing to show for it while the code is exchanged)."""
    claim = state_hash(secrets.token_urlsafe(32))
    with session_scope() as session:
        row = _use_up(session, state_hash(state), claim)
        if row is None:
            return Outcome("expired")
        pending = connectors.read_secret(row, pending=True)
        owner_id, connection_id, name = row.owner_id, row.id, row.name
        url, transport = connectors.upstream_target(row, row.access)
    failed = Outcome("failed", name)

    grant = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": pending["redirect_uri"],
        "code_verifier": pending["code_verifier"],
    }
    client_refused = False
    try:
        reply = _token_request(pending, grant)
        tokens = _tokens(_document_of(reply))
        client_refused = reply.status_code == 401 or _refused(reply) == "invalid_client"
    except Exception:  # whatever went wrong, the write below must end the sign-in and say so
        tokens = None
    tools = _list_tools(url, transport, tokens["access_token"]) if tokens else None

    try:
        with session_scope() as session:
            # The one lock every writer of the sign-in takes before it reads or writes it.
            row = connectors.get_owned(session, owner_id, connection_id, for_update=True)
            if row.state_hash == claim:  # else a newer sign-in was started meanwhile: leave it
                row.state_hash = None
                over = None if tokens else _discovered(pending, client_refused=client_refused)
                connectors.write_secret(row, over, pending=True)
            if tokens is None:
                row.last_error = _not_finished(name)  # a working stored sign-in stays as it is
                return failed
            kept = (
                "issuer",
                "client",
                "authorization_endpoint",
                "token_endpoint",
                "revocation_endpoint",
                "resource",
                "scope",
            )
            connectors.write_secret(row, {key: pending.get(key) for key in kept} | tokens)
            row.status, row.last_error = "connected", None
            row.connected_at = datetime.now(UTC)
            if tools is not None:
                row.tools = tools
    except connectors.ConnectorError:
        return failed  # disconnected while the code was exchanged
    return Outcome("connected", name)


def _finish(arrived: Outcome, state: str, code: str) -> Outcome:
    """Complete, holding one of the places for requests that wait on a provider (the exchange
    and the tool listing keep a worker thread for up to twenty seconds, and these routes are
    public). The place is taken before the ``state`` is used up."""
    with ExitStack() as held:
        try:
            held.enter_context(connectors.provider_slot(uuid.UUID(arrived.owner)))
        except connectors.ConnectorError:
            return Outcome("busy", arrived.name)
        return _complete(state, code)


def callback(
    state: str,
    code: str,
    iss: str | None,
    error: str | None,
    session_user: str | None,
    browser: str | None = None,
) -> Outcome:
    """``GET /api/connectors/oauth/callback``. ``session_user`` is the user id of the browser's
    Tvashtr session, ``None`` without one (Desktop's browser); ``browser`` is its
    :func:`browser_cookie`. The owner comes from the row the ``state`` finds, never from the
    session."""
    arrived = _arrive(state, iss, session_user, browser)
    if arrived.kind != "confirm":
        return arrived
    name = arrived.name
    if error:
        return _clear(state, f"You didn’t allow access on {name}.", "denied", name)
    if not code:
        return _clear(state, _not_finished(name), "failed", name)
    if session_user is None:
        return arrived  # ask first; showing the page uses nothing up
    if session_user != arrived.owner:
        return _clear(state, OTHER_ACCOUNT_ERROR, "other_account", name)
    return _finish(arrived, state, code)


def confirm(
    state: str,
    code: str,
    iss: str | None,
    session_user: str | None = None,
    browser: str | None = None,
) -> Outcome:
    """``POST /api/connectors/oauth/confirm``: the confirm page's button. Repeats steps 1 and 2,
    then completes."""
    arrived = _arrive(state, iss, session_user, browser)
    if arrived.kind != "confirm":
        return arrived
    if not code:
        return _clear(state, _not_finished(arrived.name), "failed", arrived.name)
    return _finish(arrived, state, code)


# ---- tokens ----

REFRESH_MARGIN_SECONDS = 300  # a token with less than this left is refreshed before it is used
_TOKEN_KEYS = ("access_token", "refresh_token", "expires_at")


def _refused(reply: httpx.Response) -> str | None:
    """How a token endpoint's answer refuses, read from the OAuth ``error`` of a 4xx:
    ``"invalid_client"`` (the client itself is refused: ``invalid_client``,
    ``unauthorized_client``) or ``"invalid_grant"``. ``None`` when the answer isn't the
    endpoint's own refusal: a redirect, a gateway's 403 page, a 404, a 408, any other error."""
    if not 400 <= reply.status_code < 500:
        return None
    error = _document_of(reply, (reply.status_code,)).get("error")
    if error in ("invalid_client", "unauthorized_client"):
        return "invalid_client"
    return "invalid_grant" if error == "invalid_grant" else None


def refresh(stored: dict) -> dict | str:
    """One refresh of the stored sign-in. The new tokens (as :func:`_tokens` gives them), or how
    the provider refused: ``"invalid_client"`` (its registration is gone too) or
    ``"invalid_grant"`` (also a sign-in with nothing to refresh with). Raises
    :class:`Unreachable` for every other answer: the token endpoint didn't answer, answered 200
    with something that isn't a token, or answered something that isn't its own refusal (see
    :func:`_refused`). A refresh token is only given up when the provider says it is dead."""
    if not (stored.get("refresh_token") and stored.get("client") and stored.get("token_endpoint")):
        return "invalid_grant"
    grant = {"grant_type": "refresh_token", "refresh_token": stored["refresh_token"]}
    reply = _token_request(stored, grant)
    if reply.status_code == 200:
        tokens = _tokens(_document_of(reply))
        if tokens is None:
            raise Unreachable("the token endpoint's answer can't be read")
        return tokens
    refused = _refused(reply)
    if refused is None:
        raise Unreachable(f"the token endpoint answered {reply.status_code}")
    return refused


def ensure_access_token(connection_id: uuid.UUID, *, rejected: str | None = None) -> str:
    """A provider access token that should work now. Returns the stored one while it has more
    than five minutes left (or no expiry) and isn't ``rejected`` (the token a provider just
    answered 401 to); otherwise refreshes. Opens its own session and takes ``FOR UPDATE`` on the
    row, so never call it while holding that row's lock in another session. Raises
    :class:`SignInRefused` (the row is ``needs_signin`` by then, or gone, or has no sign-in that
    can be read and is left as it is) or :class:`Unreachable` (nothing was changed)."""
    # ponytail: the refresh call runs while the row is locked (10 s timeout), so each connection
    # being refreshed holds one pooled database connection for that long (callers waiting behind
    # it hold none). Callers on an event loop run this in a worker thread. Move to a version
    # column and a lock-free refresh if many connections refresh against slow providers at once.
    with _one_at_a_time(connection_id), session_scope() as session:
        row = session.execute(
            select(ConnectorConnection)
            .where(ConnectorConnection.id == connection_id)
            .with_for_update()
        ).scalar_one_or_none()
        # Read only now that the lock is held: a refresh or a new sign-in that was in flight has
        # committed, so this is the sign-in as it is, and what is written below is on top of it.
        stored = (connectors.secret_or_none(row) if row is not None else None) or {}
        token = stored.get("access_token")
        if not token and not stored.get("refresh_token"):
            # Gone, never signed in, already cleared, or one that can't be decrypted.
            raise SignInRefused("no stored sign-in")
        provider = _borrowed_from(row, stored)
        if provider is not None:
            # Security S1: a Featured provider's sign-in held by a connection that isn't that
            # provider's own card (made before discovery refused it) is never used again.
            connectors.write_secret(row, {k: v for k, v in stored.items() if k not in _TOKEN_KEYS})
            row.status, row.last_error = "needs_signin", BorrowedSignIn(provider).message
            refreshed = "borrowed_signin"
        else:
            expires = stored.get("expires_at")
            fresh = expires is None or expires - time.time() > REFRESH_MARGIN_SECONDS
            if token and token != rejected and fresh:
                return token
            refreshed = refresh(stored)
            if isinstance(refreshed, dict):
                # A reply without a new refresh token keeps the old one. The rotated one is
                # committed (leaving this block) before the caller gets the access token.
                kept = {k: v for k, v in stored.items() if k != "expires_at"}
                connectors.write_secret(row, kept | refreshed)
                return refreshed["access_token"]
            dropped = _TOKEN_KEYS + (("client",) if refreshed == "invalid_client" else ())
            connectors.write_secret(row, {k: v for k, v in stored.items() if k not in dropped})
            in_flight = connectors.secret_or_none(row, pending=True)
            if refreshed == "invalid_client" and in_flight:
                # A sign-in in flight (or the last one cleared) may hold the same registration:
                # say so there too, or the next ``oauth/start`` would reuse the client that is gone.
                refused = {"refused_client": stored["client"]["client_id"]}
                connectors.write_secret(row, in_flight | refused, pending=True)
            row.status, row.last_error = "needs_signin", "Its sign-in expired."
    raise SignInRefused(refreshed)


def _borrowed_from(row: ConnectorConnection, stored: dict) -> str | None:
    """The Featured provider whose sign-in ``row`` holds without being that provider's own card on
    its own address, else ``None`` (the check discovery makes, applied to a stored sign-in)."""
    if _pins(connector_catalog.resolve(row.connector_key), row.url):
        return None
    issuer = stored.get("issuer")
    host = urlsplit(issuer).hostname if isinstance(issuer, str) else None
    return _featured_signin_sites().get(connector_net.site(host)) if host else None


def revoke(connection_id: uuid.UUID) -> bool:
    """Best-effort RFC 7009 revoke of the stored sign-in at the provider. ``True`` when the
    provider answered 2xx. Never raises. It only reads the row and takes no lock, so a disconnect
    may call it before or while it holds the row's lock."""
    try:
        with session_scope() as session:
            row = session.get(ConnectorConnection, connection_id)
            stored = (connectors.read_secret(row) if row is not None else None) or {}
        endpoint, client = stored.get("revocation_endpoint"), stored.get("client")
        hint = "refresh_token" if stored.get("refresh_token") else "access_token"
        if not (endpoint and client and stored.get(hint)):
            return False
        form, auth = _client_auth(client)
        data = {"token": stored[hint], "token_type_hint": hint, **form}
        return _post(endpoint, data=data, auth=auth).is_success
    except Exception:  # best effort: a failure never blocks the disconnect
        return False
