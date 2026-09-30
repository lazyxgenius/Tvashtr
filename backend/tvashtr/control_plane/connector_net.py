"""Connectors: the outbound address guard and the only two HTTP clients for connector traffic.

Every address the backend fetches for a connector comes from outside (the MCP address, metadata
addresses, registration, token and revocation endpoints, every proxied call), so all of it goes
through :func:`client` (sync) or :func:`async_client` (the MCP client to the provider). No other
module builds an httpx client for connector traffic (``tests/test_connector_net.py`` checks).

The rules (contract: ``docs/superpowers/plans/api/connectors.md``, Outbound address rules):

* ``https://`` only, and every address the host resolves to must be public
  (``ipaddress.is_global`` and not multicast; an IPv4-mapped or NAT64 IPv6 address is judged by
  the IPv4 address inside it, and any other IPv6 address must be global unicast, ``2000::/3``).
* The address that was checked is the address connected to. The clients run on a pinning
  transport: it resolves a host once for the client's life, checks it, and sends the request to
  that IP with the ``Host`` header kept and the TLS server name set to the host, so the
  certificate is still checked against the name. That closes DNS rebinding.
* No redirects are followed.
* ``TVASHTR_CONNECTORS_ALLOW_LOCAL`` also allows ``http://`` and non-public addresses (local
  development and the e2e fake server). It never allows a third scheme, and it is ignored when
  ``hosted_mode`` is on.
"""

import ipaddress
import socket
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


class UnsafeUrl(ValueError):
    """The address isn't one Tvashtr will open: not ``https://``, or not a public address."""


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
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError as exc:
        raise UnsafeUrl("not an address") from exc
    if parts.scheme != "https" and not (allow_local and parts.scheme == "http"):
        raise UnsafeUrl("only https:// addresses are allowed")
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


class _PinningTransport(httpx.BaseTransport):
    """Resolves each host once, checks it, and connects to that address. One inner transport per
    host, so a pooled connection is never reused for another name that shares the IP."""

    def __init__(self) -> None:
        self._pins: dict[str, tuple[str, httpx.BaseTransport]] = {}

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = _require_https(request)
        if host not in self._pins:
            self._pins[host] = (_resolve(host, request.url.port), _inner())
        ip, inner = self._pins[host]
        return inner.handle_request(_pin(request, ip))

    def close(self) -> None:
        for _, inner in self._pins.values():
            inner.close()


class _AsyncPinningTransport(httpx.AsyncBaseTransport):
    """The async twin. The lookup runs in a worker thread (``getaddrinfo`` blocks)."""

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
        return await inner.handle_async_request(_pin(request, ip))

    async def aclose(self) -> None:
        for _, inner in self._pins.values():
            await inner.aclose()


def client(timeout: float = 10.0, headers: dict | None = None) -> httpx.Client:
    """The sync HTTP client for connector traffic (sign-in calls). Tests replace this function."""
    return httpx.Client(
        transport=None if _allow_local() else _PinningTransport(),
        timeout=timeout,
        headers=headers,
        follow_redirects=False,
        trust_env=False,
    )


def async_client(timeout: float = 10.0, headers: dict | None = None) -> httpx.AsyncClient:
    """The async HTTP client for connector traffic (the MCP client to the provider)."""
    return httpx.AsyncClient(
        transport=None if _allow_local() else _AsyncPinningTransport(),
        timeout=timeout,
        headers=headers,
        follow_redirects=False,
        trust_env=False,
    )
