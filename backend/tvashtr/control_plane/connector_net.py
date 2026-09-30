"""Connectors: the outbound address guard and the only two HTTP clients for connector traffic.

Every address the backend fetches for a connector comes from outside (the MCP address, metadata
addresses, registration, token and revocation endpoints, every proxied call), so all of it goes
through :func:`client` (sync) or :func:`async_client` (the MCP client to the provider). No other
module builds an httpx client for connector traffic (``tests/test_connector_net.py`` checks).

The rules (contract: ``docs/superpowers/plans/api/connectors.md``, Outbound address rules):

* No space, control character, backslash or user name (``user@host``) in the address: those are
  where Python and a browser read a different host out of the same string.
* ``https://`` only, and every address the host resolves to must be public
  (``ipaddress.is_global`` and not multicast; an IPv4-mapped or NAT64 IPv6 address is judged by
  the IPv4 address inside it, and any other IPv6 address must be global unicast, ``2000::/3``).
* The address that was checked is the address connected to. The clients run on a pinning
  transport: it resolves a host once for the client's life, checks it, and sends the request to
  that IP with the ``Host`` header kept and the TLS server name set to the host, so the
  certificate is still checked against the name. That closes DNS rebinding.
* No redirects are followed.
* What a provider sends back is bounded. Both clients ask for an uncompressed answer and refuse a
  compressed one (httpx would inflate it in memory). :func:`client` reads at most
  ``BODY_LIMIT`` (1 MB) and gives the whole exchange one deadline, its ``timeout`` (httpx's own
  timeout is per read). :func:`async_client` stops a body at ``MCP_BODY_LIMIT``; its callers set
  the deadline (``anyio.fail_after`` in ``connector_upstream``).
* ``TVASHTR_CONNECTORS_ALLOW_LOCAL`` also allows ``http://`` and non-public addresses (local
  development and the e2e fake server). The clients are then plain httpx clients: no pinning, no
  size limit. It never allows a third scheme, and it is ignored when ``hosted_mode`` is on.
"""

import ipaddress
import socket
import threading
from collections.abc import AsyncIterator, Callable
from urllib.parse import urlsplit

import anyio
import httpx

from tvashtr.config import get_settings

# Hosts under these suffixes belong to whoever registered the label in front, so each full host is
# its own site.
# ponytail: a short built-in rule, not the Public Suffix List. Swap in a PSL library when an
# unlisted shared suffix turns up.
_SHARED_SUFFIXES = (
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "fly.dev",
    "github.io",
    "herokuapp.com",
    "onrender.com",
    "web.app",
    "run.app",
    "azurewebsites.net",
    "amazonaws.com",
    "cloudfront.net",
)
_SECOND_LEVEL = frozenset({"co", "com", "org", "net", "ac", "gov", "edu"})


BODY_LIMIT = 1024 * 1024  # an answer to ``client()``: sign-in metadata, registration, tokens
MCP_BODY_LIMIT = 10 * BODY_LIMIT  # an answer to ``async_client()``: a tool list, a tool's result


class UnsafeUrl(ValueError):
    """The address isn't one Tvashtr will open: not ``https://``, or not a public address."""


class UnsafeResponse(httpx.TransportError):
    """The provider's answer isn't one Tvashtr will read: compressed, or over the size limit."""


def _allow_local() -> bool:
    settings = get_settings()
    return settings.connectors_allow_local and not settings.hosted_mode


_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_GLOBAL_UNICAST_V6 = ipaddress.ip_network("2000::/3")


def _is_public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])  # drop an IPv6 zone id
    except ValueError:
        return False
    if ip.version == 6:
        # ``is_global`` alone calls several IPv6 forms that carry an IPv4 address public
        # (NAT64, IPv4-compatible, IPv4-translated), and site-local and multicast too. So: an
        # IPv4-mapped or NAT64 address is judged by the IPv4 address inside it, and anything else
        # must be global unicast.
        if ip.ipv4_mapped or ip in _NAT64:
            ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        elif ip not in _GLOBAL_UNICAST_V6:
            return False
    return ip.is_global and not ip.is_multicast


# The lookup, as a name tests replace. They must not patch ``socket.getaddrinfo`` itself: that is
# the whole process's resolver (psycopg resolves the database host through it).
_getaddrinfo = socket.getaddrinfo


def _resolve(host: str, port: int | None) -> str:
    """Resolve ``host`` and return the address to connect to. Every address it resolves to must be
    public, else :class:`UnsafeUrl`."""
    try:
        infos = _getaddrinfo(host, port or 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise UnsafeUrl(f"{host} doesn't resolve") from exc
    addresses = [info[4][0] for info in infos]
    if not addresses or not all(_is_public(a) for a in addresses):
        raise UnsafeUrl(f"{host} isn't a public address")
    # ponytail: the first address (the resolver's preferred one) and no fallback to the others.
    # Try the next checked address on a connect error if a provider's first one proves unreachable.
    return addresses[0]


def check_url(url: str) -> str:
    """Return ``url`` when Tvashtr may open it, else raise :class:`UnsafeUrl`."""
    allow_local = _allow_local()
    # Python and browsers must agree on the host, because the host Tvashtr checks (and shows as
    # the sign-in host) is Python's and the one a sign-in window opens is the browser's. They
    # differ on a backslash (a browser reads it as ``/``), and ``urlsplit`` quietly drops tabs,
    # newlines and leading spaces. None of these belongs in an address, so none is accepted.
    if any(c <= " " or c in "\\\x7f" for c in url):
        raise UnsafeUrl("the address has a space, a control character or a backslash in it")
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError as exc:
        raise UnsafeUrl("not an address") from exc
    if parts.scheme != "https" and not (allow_local and parts.scheme == "http"):
        raise UnsafeUrl("only https:// addresses are allowed")
    if "@" in parts.netloc:
        raise UnsafeUrl("the address has a user name in it")
    if not host:
        raise UnsafeUrl("the address has no host")
    if not allow_local:
        _resolve(host, port)
    return url


def site(host: str) -> str:
    """The "same site" key of a host (its registrable domain, roughly): the last two labels;
    three when the last has two letters and the one before it is ``co``, ``com``, ``org``, ``net``,
    ``ac``, ``gov`` or ``edu`` (``acme.co.uk``); the whole host under a shared-hosting suffix and
    for an IP address."""
    host = host.lower().rstrip(".")
    try:
        ipaddress.ip_address(host.strip("[]"))
        return host
    except ValueError:
        pass
    if any(host == suffix or host.endswith("." + suffix) for suffix in _SHARED_SUFFIXES):
        return host
    labels = host.split(".")
    keep = 3 if len(labels[-1]) == 2 and len(labels) >= 3 and labels[-2] in _SECOND_LEVEL else 2
    return ".".join(labels[-keep:])


def _inner() -> httpx.BaseTransport:
    """The real transport under the pinning one. Tests replace it with a ``MockTransport``."""
    return httpx.HTTPTransport()


def _async_inner() -> httpx.AsyncBaseTransport:
    return httpx.AsyncHTTPTransport()


def _require_https(request: httpx.Request) -> str:
    if request.url.scheme != "https":
        raise UnsafeUrl("only https:// addresses are allowed")
    return request.url.host


def _pin(request: httpx.Request, ip: str) -> httpx.Request:
    """A copy of ``request`` addressed to the validated ``ip``. The ``Host`` header (set when the
    request was built) keeps the name, and ``sni_hostname`` makes httpcore use the name for TLS, so
    the certificate is checked against the name and not the IP. The caller's request is left as it
    was, so ``response.url`` still shows the name."""
    return httpx.Request(
        request.method,
        request.url.copy_with(host=ip),
        headers=request.headers,
        stream=request.stream,
        extensions={**request.extensions, "sni_hostname": request.url.host},
    )


def _compressed(response: httpx.Response) -> bool:
    return response.headers.get("content-encoding", "identity").strip().lower() != "identity"


def _read_capped(response: httpx.Response) -> httpx.Response:
    """The whole answer, read now and held in memory: at most ``BODY_LIMIT`` bytes, and not
    compressed. Else :class:`UnsafeResponse`."""
    try:
        if _compressed(response):
            raise UnsafeResponse("the provider sent a compressed answer")
        body = bytearray()
        for chunk in response.stream:
            body += chunk
            if len(body) > BODY_LIMIT:
                raise UnsafeResponse("the provider's answer is over the size limit")
    finally:
        response.stream.close()
    return httpx.Response(
        response.status_code,
        headers=response.headers,
        content=bytes(body),
        extensions=response.extensions,
    )


def _within[T](seconds: float, work: Callable[[], T], abort: Callable[[], None]) -> T:
    """``work()``, given ``seconds`` for all of it. httpx's timeout is per read, so a server that
    sends one byte every few seconds would hold the calling thread (a FastAPI worker) for as long
    as it liked. The work runs on a helper thread; past the deadline the caller gets a
    ``ReadTimeout`` and ``abort()`` closes the connection under the helper, which ends it.

    ponytail: a connection still in its TLS handshake isn't closed by ``abort()``, so that helper
    (not the caller) lives until the handshake ends. A deadline-aware network backend would close
    that too, if slow-handshake servers ever show up."""
    outcome: list[tuple[T | None, BaseException | None]] = []
    done = threading.Event()

    def run() -> None:
        try:
            outcome.append((work(), None))
        except BaseException as exc:  # handed to the caller below
            outcome.append((None, exc))
        finally:
            done.set()

    threading.Thread(target=run, daemon=True, name="connector-http").start()
    if not done.wait(seconds):
        abort()
        raise httpx.ReadTimeout("the provider took too long to answer")
    result, error = outcome[0]
    if error is not None:
        raise error
    return result


class _PinningTransport(httpx.BaseTransport):
    """Resolves each host once, checks it, and connects to that address. One inner transport per
    host, so a pooled connection is never reused for another name that shares the IP. The answer
    comes back read in full, within the size limit and the deadline."""

    def __init__(self) -> None:
        self._pins: dict[str, tuple[str, httpx.BaseTransport]] = {}

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = _require_https(request)
        if host not in self._pins:
            self._pins[host] = (_resolve(host, request.url.port), _inner())
        ip, inner = self._pins[host]
        seconds = (request.extensions.get("timeout") or {}).get("read") or 10.0
        pinned = _pin(request, ip)
        return _within(seconds, lambda: _read_capped(inner.handle_request(pinned)), inner.close)

    def close(self) -> None:
        for _, inner in self._pins.values():
            inner.close()


class _CappedStream(httpx.AsyncByteStream):
    """A response body that raises :class:`UnsafeResponse` past ``limit`` bytes."""

    def __init__(self, stream: httpx.AsyncByteStream, limit: int) -> None:
        self._stream = stream
        self._limit = limit

    async def __aiter__(self) -> AsyncIterator[bytes]:
        read = 0
        async for chunk in self._stream:
            read += len(chunk)
            if read > self._limit:
                raise UnsafeResponse("the provider's answer is over the size limit")
            yield chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


class _AsyncPinningTransport(httpx.AsyncBaseTransport):
    """The async twin. The lookup runs in a worker thread (``getaddrinfo`` blocks). The answer is
    still a stream (the MCP client reads server-sent events), cut off at ``MCP_BODY_LIMIT``."""

    def __init__(self) -> None:
        self._pins: dict[str, tuple[str, httpx.AsyncBaseTransport]] = {}

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        host = _require_https(request)
        if host not in self._pins:
            ip = await anyio.to_thread.run_sync(_resolve, host, request.url.port)
            # Two first requests at once each resolve and check; the first to finish is kept.
            if host not in self._pins:
                self._pins[host] = (ip, _async_inner())
        ip, inner = self._pins[host]
        response = await inner.handle_async_request(_pin(request, ip))
        if _compressed(response):
            await response.stream.aclose()
            raise UnsafeResponse("the provider sent a compressed answer")
        response.stream = _CappedStream(response.stream, MCP_BODY_LIMIT)
        return response

    async def aclose(self) -> None:
        for _, inner in self._pins.values():
            await inner.aclose()


def _headers(headers: dict | None) -> httpx.Headers:
    """The caller's headers, asking for an uncompressed answer whatever they say."""
    merged = httpx.Headers(headers)
    merged["Accept-Encoding"] = "identity"
    return merged


def client(timeout: float = 10.0, headers: dict | None = None) -> httpx.Client:
    """The sync HTTP client for connector traffic (sign-in calls). ``timeout`` is the deadline for
    one whole request and its answer. Tests replace this function."""
    return httpx.Client(
        transport=None if _allow_local() else _PinningTransport(),
        timeout=timeout,
        headers=_headers(headers),
        follow_redirects=False,
        trust_env=False,
    )


def async_client(timeout: float = 10.0, headers: dict | None = None) -> httpx.AsyncClient:
    """The async HTTP client for connector traffic (the MCP client to the provider)."""
    return httpx.AsyncClient(
        transport=None if _allow_local() else _AsyncPinningTransport(),
        timeout=timeout,
        headers=_headers(headers),
        follow_redirects=False,
        trust_env=False,
    )
