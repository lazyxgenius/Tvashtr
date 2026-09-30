"""Connectors: the three settings (0.2) and the outbound address guard (0.3)."""

import tomllib
from pathlib import Path

from tvashtr.config import Settings

_BACKEND = Path(__file__).resolve().parents[1]


_ENV_NAMES = (
    "TVASHTR_GOOGLE_OAUTH_CLIENT_ID",
    "TVASHTR_GOOGLE_OAUTH_CLIENT_SECRET",
    "TVASHTR_CONNECTORS_ALLOW_LOCAL",
)


def test_connector_settings_default_to_off(monkeypatch):
    # ``_env_file=None`` skips the file, not the process environment, and ``make test`` exports
    # every ``.env`` line: an operator who sets these must not turn the gate red.
    for name in _ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    s = Settings(_env_file=None)
    assert s.google_oauth_client_id == ""
    assert s.google_oauth_client_secret.get_secret_value() == ""
    assert s.connectors_allow_local is False


def test_connector_settings_read_their_env_names(monkeypatch):
    monkeypatch.setenv("TVASHTR_GOOGLE_OAUTH_CLIENT_ID", "abc.apps.googleusercontent.com")
    monkeypatch.setenv("TVASHTR_GOOGLE_OAUTH_CLIENT_SECRET", "shh")
    monkeypatch.setenv("TVASHTR_CONNECTORS_ALLOW_LOCAL", "1")
    s = Settings(_env_file=None)
    assert s.google_oauth_client_id == "abc.apps.googleusercontent.com"
    assert s.google_oauth_client_secret.get_secret_value() == "shh"
    assert s.connectors_allow_local is True


def test_mcp_floor_has_the_client_pieces_connectors_need():
    """``mcp>=1.0`` allowed versions without ``streamable_http_client(http_client=…)`` and
    ``mcp.client.auth.utils``; the floor now names the first line that has both."""
    deps = tomllib.loads((_BACKEND / "pyproject.toml").read_text())["project"]["dependencies"]
    assert "mcp>=1.27" in deps

    import inspect

    import mcp.client.auth.utils  # noqa: F401
    from mcp.client.streamable_http import streamable_http_client

    assert "http_client" in inspect.signature(streamable_http_client).parameters


# ---- 0.3: the outbound address guard and the two HTTP clients ----

import asyncio  # noqa: E402
import gzip  # noqa: E402
import re  # noqa: E402
import socket  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from tvashtr.config import get_settings  # noqa: E402
from tvashtr.control_plane import connector_net  # noqa: E402
from tvashtr.control_plane.connector_net import (  # noqa: E402
    UnsafeResponse,
    UnsafeUrl,
    check_url,
    site,
)

PUBLIC = "93.184.216.34"


def _dns(monkeypatch, table: dict[str, list[str]]) -> list[str]:
    """Replace ``connector_net``'s lookup with a fixed table (``socket.getaddrinfo`` itself is left
    alone: it is the whole process's resolver). A list of lists answers one list per call (the last
    one repeats). A host that isn't in the table answers itself, as a literal IP does. Returns the
    list of hosts that were looked up."""
    calls: list[str] = []

    def fake(host, port, *args, **kwargs):  # noqa: ARG001
        calls.append(host)
        answers = table.get(host, [host])
        if answers and isinstance(answers[0], list):
            answers = answers[min(calls.count(host), len(answers)) - 1]
        return [
            (
                socket.AF_INET6 if ":" in a else socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (a, port or 443),
            )
            for a in answers
        ]

    monkeypatch.setattr(connector_net, "_getaddrinfo", fake)
    return calls


def test_the_dns_fake_leaves_the_process_resolver_alone(monkeypatch):
    """psycopg resolves the database host through ``socket.getaddrinfo``: a fake installed there
    would fail any Postgres connection another thread opens while one of these tests runs."""
    real = socket.getaddrinfo
    _dns(monkeypatch, {"mcp.example.com": [PUBLIC]})
    assert socket.getaddrinfo is real
    assert connector_net._resolve("mcp.example.com", None) == PUBLIC


@pytest.fixture
def strict(monkeypatch):
    """The production posture, whatever the developer's ``.env`` says."""
    monkeypatch.setattr(get_settings(), "connectors_allow_local", False)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)


@pytest.mark.parametrize(
    "url",
    [
        "http://mcp.example.com/mcp",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hi",
        "https:///mcp",
        "",
        # A browser reads ``\\`` as ``/``, so it opens phish.evil.example here while Python (and
        # the sign-in host Tvashtr shows) says mcp.example.com.
        "https://phish.evil.example\\@mcp.example.com/mcp",
        "https://mcp.example.com\\.evil.example/mcp",
        "https://mcp.example.com/mcp\\x",
        "https://user:pw@mcp.example.com/mcp",
        "https://user@mcp.example.com/mcp",
        "https://@mcp.example.com/mcp",
        " https://mcp.example.com/mcp",
        "https://mcp.example.com/m cp",
        "https://mcp.example.com/mcp\n",
        "https://mcp.example.com/\tmcp",
        "https://mcp.example.com/mcp\x7f",
        "https://mcp.example.com/mcp\x00",
    ],
)
def test_only_https_addresses_pass(strict, monkeypatch, url):
    _dns(monkeypatch, {"mcp.example.com": [PUBLIC]})
    with pytest.raises(UnsafeUrl):
        check_url(url)


def test_a_public_https_address_passes_and_is_returned(strict, monkeypatch):
    _dns(monkeypatch, {"mcp.example.com": [PUBLIC, "2606:2800:220:1:248:1893:25c8:1946"]})
    assert check_url("https://mcp.example.com/mcp") == "https://mcp.example.com/mcp"


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "169.254.169.254",
        "fdaa::1",
        "0.0.0.0",
        "::1",
        "::ffff:10.0.0.1",
        "100.64.0.1",
        "192.168.1.10",
        "fe80::1",
        # IPv6 forms that carry an IPv4 address, which ``is_global`` alone calls public.
        "64:ff9b::a9fe:a9fe",  # NAT64 of 169.254.169.254
        "64:ff9b::a00:1",  # NAT64 of 10.0.0.1
        "::a9fe:a9fe",  # IPv4-compatible
        "::ffff:0:a9fe:a9fe",  # IPv4-translated
        "2002:a9fe:a9fe::1",  # 6to4
        "fec0::1",  # site-local
        "ff02::1",  # multicast
        "224.0.0.1",
    ],
)
def test_a_host_resolving_to_a_non_public_address_is_refused(strict, monkeypatch, address):
    _dns(monkeypatch, {"sneaky.example.com": [address]})
    with pytest.raises(UnsafeUrl):
        check_url("https://sneaky.example.com/mcp")
    with pytest.raises(UnsafeUrl):
        check_url(f"https://[{address}]/mcp" if ":" in address else f"https://{address}/mcp")


def test_a_nat64_address_of_a_public_ipv4_passes(strict, monkeypatch):
    """An IPv6-only network with DNS64 answers an IPv4-only provider like this."""
    _dns(monkeypatch, {"v4only.example.com": ["64:ff9b::5db8:d822"]})  # 93.184.216.34
    assert check_url("https://v4only.example.com/mcp")


def test_one_private_address_among_public_ones_is_refused(strict, monkeypatch):
    _dns(monkeypatch, {"mixed.example.com": [PUBLIC, "10.0.0.5"]})
    with pytest.raises(UnsafeUrl):
        check_url("https://mixed.example.com/mcp")


def test_a_host_that_does_not_resolve_is_refused(strict, monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(connector_net, "_getaddrinfo", boom)
    with pytest.raises(UnsafeUrl):
        check_url("https://nowhere.example.com/mcp")


def test_a_host_name_the_resolver_cant_encode_is_refused(strict, monkeypatch):
    """A label over 63 characters makes ``getaddrinfo`` raise ``UnicodeError``, which is not an
    ``OSError``: callers are promised ``UnsafeUrl``."""

    def boom(*args, **kwargs):
        raise UnicodeError("encoding with 'idna' codec failed (label too long)")

    monkeypatch.setattr(connector_net, "_getaddrinfo", boom)
    with pytest.raises(UnsafeUrl):
        check_url("https://" + "a" * 64 + ".example.com/mcp")


@pytest.mark.parametrize("url", ["https://mcp.example.com/" + "a" * 70_000, "https://☃.-/oauth"])
def test_an_address_the_http_client_wont_build_is_refused(strict, monkeypatch, url):
    """``urlsplit`` reads both and both resolve; httpx refuses the first as too long and the
    second as a host name it can't encode, with ``InvalidURL``. The guard says so first, so no
    caller meets that error at the request."""
    _dns(monkeypatch, {"mcp.example.com": [PUBLIC], "☃.-": [PUBLIC]})
    with pytest.raises(UnsafeUrl):
        check_url(url)
    monkeypatch.setattr(get_settings(), "connectors_allow_local", True)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    with pytest.raises(UnsafeUrl):  # local development opens more addresses, not broken ones
        check_url(url)


def _recording_inner(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    return httpx.MockTransport(handle)


def test_client_connects_to_the_address_it_checked_even_when_dns_changes(strict, monkeypatch):
    """Rebinding: a public address for the check, a private one for the connection."""
    calls = _dns(monkeypatch, {"rebind.example.com": [[PUBLIC], ["10.0.0.5"]]})
    seen: list[httpx.Request] = []
    monkeypatch.setattr(connector_net, "_inner", lambda: _recording_inner(seen))

    with connector_net.client() as c:
        assert c.follow_redirects is False
        reply = c.get("https://rebind.example.com/mcp")
        c.post("https://rebind.example.com/token", data={"a": "b"})

    # The caller still sees the name: only the connection goes to the IP.
    assert str(reply.url) == str(reply.request.url) == "https://rebind.example.com/mcp"

    assert [r.url.host for r in seen] == [PUBLIC, PUBLIC]
    assert [r.headers["host"] for r in seen] == ["rebind.example.com"] * 2
    assert [r.extensions["sni_hostname"] for r in seen] == ["rebind.example.com"] * 2
    assert seen[0].url.path == "/mcp" and seen[0].url.scheme == "https"
    assert calls == ["rebind.example.com"]  # resolved once for the client's life


def test_async_client_connects_to_the_address_it_checked_even_when_dns_changes(strict, monkeypatch):
    calls = _dns(monkeypatch, {"rebind.example.com": [[PUBLIC], ["10.0.0.5"]]})
    seen: list[httpx.Request] = []
    monkeypatch.setattr(connector_net, "_async_inner", lambda: _recording_inner(seen))

    async def go():
        async with connector_net.async_client(headers={"Authorization": "Bearer t"}) as c:
            assert c.follow_redirects is False
            reply = await c.get("https://rebind.example.com/mcp")
            await c.get("https://rebind.example.com/mcp")
            return reply

    reply = asyncio.run(go())
    assert str(reply.url) == str(reply.request.url) == "https://rebind.example.com/mcp"

    assert [r.url.host for r in seen] == [PUBLIC, PUBLIC]
    assert [r.headers["host"] for r in seen] == ["rebind.example.com"] * 2
    assert [r.extensions["sni_hostname"] for r in seen] == ["rebind.example.com"] * 2
    assert seen[0].headers["authorization"] == "Bearer t"
    assert calls == ["rebind.example.com"]


def test_the_clients_refuse_what_check_url_refuses(strict, monkeypatch):
    """A caller that forgot ``check_url`` still can't reach a private address or plain http."""
    _dns(monkeypatch, {"sneaky.example.com": ["10.0.0.5"], "ok.example.com": [PUBLIC]})
    seen: list[httpx.Request] = []
    monkeypatch.setattr(connector_net, "_inner", lambda: _recording_inner(seen))
    monkeypatch.setattr(connector_net, "_async_inner", lambda: _recording_inner(seen))

    with connector_net.client() as c:
        with pytest.raises(UnsafeUrl):
            c.get("https://sneaky.example.com/mcp")
        with pytest.raises(UnsafeUrl):
            c.get("http://ok.example.com/mcp")

    async def go():
        async with connector_net.async_client() as c:
            with pytest.raises(UnsafeUrl):
                await c.get("https://sneaky.example.com/mcp")

    asyncio.run(go())
    assert seen == []


def test_a_redirect_is_returned_not_followed(strict, monkeypatch):
    _dns(monkeypatch, {"ok.example.com": [PUBLIC]})
    inner = httpx.MockTransport(
        lambda request: httpx.Response(302, headers={"location": "https://10.0.0.5/"})
    )
    monkeypatch.setattr(connector_net, "_inner", lambda: inner)
    with connector_net.client() as c:
        assert c.get("https://ok.example.com/mcp").status_code == 302


# ---- what a provider can send back: no compression, a size limit, one deadline for the lot ----


def _answering(monkeypatch, make_response, seen: list[httpx.Request] | None = None) -> None:
    """Both inner transports answer every request with ``make_response()``."""

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return make_response()

    _dns(monkeypatch, {"big.example.com": [PUBLIC]})
    monkeypatch.setattr(connector_net, "_inner", lambda: httpx.MockTransport(handle))
    monkeypatch.setattr(connector_net, "_async_inner", lambda: httpx.MockTransport(handle))


def _gzip_bomb() -> httpx.Response:
    # 64 MB of zeros is about 65 KB on the wire. ``stream=`` so building it decodes nothing.
    wire = gzip.compress(bytes(64 * 1024 * 1024), compresslevel=1)
    return httpx.Response(200, headers={"content-encoding": "gzip"}, stream=httpx.ByteStream(wire))


def _body(size: int) -> httpx.Response:
    return httpx.Response(200, stream=httpx.ByteStream(bytes(size)))


def test_both_clients_ask_for_an_uncompressed_answer_and_refuse_a_compressed_one(
    strict, monkeypatch
):
    """httpx decodes gzip on its own, so a 65 KB answer would become 64 MB in memory."""
    seen: list[httpx.Request] = []
    _answering(monkeypatch, _gzip_bomb, seen)

    with connector_net.client(headers={"Accept-Encoding": "gzip"}) as c:
        with pytest.raises(UnsafeResponse):
            c.get("https://big.example.com/.well-known/oauth-authorization-server")

    async def go():
        async with connector_net.async_client() as c:
            with pytest.raises(UnsafeResponse):
                await c.post("https://big.example.com/mcp", json={})

    asyncio.run(go())
    assert [r.headers["accept-encoding"] for r in seen] == ["identity", "identity"]


def test_the_sync_client_reads_at_most_one_megabyte(strict, monkeypatch):
    _answering(monkeypatch, lambda: _body(connector_net.BODY_LIMIT))
    with connector_net.client() as c:
        assert len(c.get("https://big.example.com/token").content) == 1024 * 1024

    _answering(monkeypatch, lambda: _body(connector_net.BODY_LIMIT + 1))
    with connector_net.client() as c:
        with pytest.raises(UnsafeResponse):
            c.get("https://big.example.com/token")


def test_the_async_client_stops_reading_at_its_limit(strict, monkeypatch):
    assert connector_net.MCP_BODY_LIMIT == 10 * 1024 * 1024
    monkeypatch.setattr(connector_net, "MCP_BODY_LIMIT", 4096)

    async def get(size: int) -> int:
        _answering(monkeypatch, lambda: _body(size))
        async with connector_net.async_client() as c:
            return len((await c.get("https://big.example.com/mcp")).content)

    assert asyncio.run(get(4096)) == 4096
    with pytest.raises(UnsafeResponse):
        asyncio.run(get(4097))

    async def streamed() -> int:
        """The SDK reads answers as a stream: the limit holds there too."""
        _answering(monkeypatch, lambda: _body(4097))
        read = 0
        async with connector_net.async_client() as c:
            async with c.stream("POST", "https://big.example.com/mcp") as reply:
                async for chunk in reply.aiter_bytes():
                    read += len(chunk)
        return read

    with pytest.raises(UnsafeResponse):
        asyncio.run(streamed())


def test_the_sync_client_gives_a_provider_one_deadline_for_the_whole_answer(strict, monkeypatch):
    """httpx's timeout is per read: a server that sends a byte every few seconds would otherwise
    hold the calling thread (a FastAPI worker) for as long as it liked."""
    release = threading.Event()

    def never_answers() -> httpx.Response:
        release.wait(30)
        return _body(1)

    def drips() -> httpx.Response:
        def body():
            while not release.is_set():
                time.sleep(0.02)
                yield b"."

        return httpx.Response(200, content=body())

    try:
        for slow in (never_answers, drips):
            _answering(monkeypatch, slow)
            started = time.monotonic()
            with connector_net.client(timeout=0.3) as c:
                with pytest.raises(httpx.TimeoutException):
                    c.get("https://big.example.com/token")
            assert time.monotonic() - started < 3
    finally:
        release.set()


def test_allow_local_lets_http_and_loopback_through_but_no_third_scheme(monkeypatch):
    monkeypatch.setattr(get_settings(), "connectors_allow_local", True)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    _dns(monkeypatch, {"localhost": ["127.0.0.1"]})

    assert check_url("http://127.0.0.1:9911/mcp") == "http://127.0.0.1:9911/mcp"
    assert check_url("http://localhost:9911/mcp") == "http://localhost:9911/mcp"
    for url in (
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hi",
        "http://evil.example\\@127.0.0.1:9911/authorize",
        "http://user@127.0.0.1:9911/mcp",
    ):
        with pytest.raises(UnsafeUrl):
            check_url(url)
    # The clients are plain: no pinning transport in the way of localhost.
    with connector_net.client() as c:
        assert not isinstance(c._transport, connector_net._PinningTransport)
        assert c.follow_redirects is False


def test_allow_local_lifts_nothing_in_hosted_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "connectors_allow_local", True)
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    _dns(monkeypatch, {"localhost": ["127.0.0.1"]})

    for url in ("http://127.0.0.1:9911/mcp", "https://127.0.0.1/mcp", "https://localhost/mcp"):
        with pytest.raises(UnsafeUrl):
            check_url(url)
    with connector_net.client() as c:
        assert isinstance(c._transport, connector_net._PinningTransport)


@pytest.mark.parametrize(
    ("a", "b", "same"),
    [
        ("api.supabase.com", "mcp.supabase.com", True),
        ("MCP.Supabase.com.", "supabase.com", True),
        ("a.vercel.app", "b.vercel.app", False),
        ("auth.acme.co.uk", "evil.co.uk", False),
        ("auth.acme.co.uk", "mcp.acme.co.uk", True),
        ("accounts.google.com", "oauth2.googleapis.com", False),
        ("x.s3.amazonaws.com", "y.s3.amazonaws.com", False),
        ("10.0.0.1", "93.184.0.1", False),
    ],
)
def test_site(a, b, same):
    assert (site(a) == site(b)) is same


def test_site_values():
    assert site("mcp.linear.app") == "linear.app"
    assert site("auth.acme.co.uk") == "acme.co.uk"
    assert site("team.vercel.app") == "team.vercel.app"


# ---- the guard on the guard: nothing else opens a connection for a connector ----

# Every way to make an HTTP call that isn't one of ``connector_net``'s two clients.
_BYPASS = re.compile(
    r"\bhttpx\.(?:get|post|put|patch|delete|head|options|request|stream)\b"
    r"|\bhttpx\.(?:Client|AsyncClient)\s*\("  # built, not named: an annotation is fine
    r"|from httpx import"
    r"|create_mcp_http_client"  # the SDK's own client: follows redirects, pins nothing
    r"|streamablehttp_client\("  # the SDK's older entry point, which builds that client
    r"|\burllib\.request\b|from urllib import request"
    r"|\burllib3\b|\baiohttp\b|import requests\b|\brequests\."
)
# The SDK's two transports build their own client unless they are handed one.
_NEEDS = {"streamable_http_client(": "http_client=", "sse_client(": "httpx_client_factory="}
_IMPORTS_A_CONNECTOR_MODULE = re.compile(r"^\s*(?:from|import)\s.*\bconnector", re.MULTILINE)


def _call_arguments(source: str, start: int) -> str:
    """The text between the parenthesis that opens at ``start - 1`` and the one that closes it."""
    depth, at = 1, start
    while depth and at < len(source):
        depth += {"(": 1, ")": -1}.get(source[at], 0)
        at += 1
    return source[start : at - 1]


def _bypasses(source: str) -> list[str]:
    """What in ``source`` makes (or lets the SDK make) an HTTP client of its own."""
    found = _BYPASS.findall(source)
    for call, keyword in _NEEDS.items():
        for match in re.finditer(rf"(?<![\w.]){re.escape(call)}", source):
            if keyword not in _call_arguments(source, match.end()):
                found.append(f"{call}…) without {keyword}")
    return found


@pytest.mark.parametrize(
    "source",
    [
        "httpx.Client()",
        "httpx.AsyncClient(timeout=3)",
        "httpx.post(token_endpoint, data=form)",
        "httpx.get(url)",
        'httpx.request("GET", url)',
        'with httpx.stream("GET", url) as reply:',
        "from httpx import AsyncClient",
        "from mcp.shared._httpx_utils import create_mcp_http_client",
        "async with streamablehttp_client(url) as streams:",
        "urllib.request.urlopen(url)",
        "from urllib.request import urlopen",
        "from urllib import request",
        "import requests",
        "requests.get(url)",
        "import aiohttp",
        "async with streamable_http_client(url) as streams:",
        "sse_client(url, headers=headers)",
        "sse_client(\n    url,\n    timeout=(5),\n)",
    ],
)
def test_the_guard_sees_each_way_around_connector_net(source):
    assert _bypasses(source)


def test_the_guard_passes_the_guarded_calls():
    source = """
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
reply = httpx.Response(200, request=httpx.Request("GET", url))
with connector_net.client() as http:
    http.post(token_endpoint, data=form)
streamable_http_client(url, http_client=client)
sse_client(
    url,
    httpx_client_factory=make(timeout=(5)),
)
pending_requests.append(request)
def token_request(http: httpx.Client) -> httpx.Response: ...
"""
    assert _bypasses(source) == []


def test_no_other_connector_module_builds_an_http_client():
    """Every module named ``connector*.py`` and every module that imports one, ``connector_net``
    excepted: the two guarded clients are the only way out."""
    offenders = {}
    for path in (_BACKEND / "tvashtr").rglob("*.py"):
        source = path.read_text()
        if path.name == "connector_net.py":
            continue
        if path.name.startswith("connector") or _IMPORTS_A_CONNECTOR_MODULE.search(source):
            if found := _bypasses(source):
                offenders[str(path.relative_to(_BACKEND))] = found
    assert offenders == {}


def test_the_guard_reads_the_modules_the_streams_will_touch():
    scanned = {
        path.name
        for path in (_BACKEND / "tvashtr").rglob("*.py")
        if path.name.startswith("connector") or _IMPORTS_A_CONNECTOR_MODULE.search(path.read_text())
    }
    assert scanned >= {
        "connector_catalog.py",
        "connector_oauth.py",
        "connector_proxy.py",
        "connector_upstream.py",
        "connectors.py",
        "connectors_oauth.py",
        "main.py",
    }
