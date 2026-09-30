"""Connectors: the MCP client to the provider (``connector_upstream``), against the fake OAuth MCP
server running as a subprocess."""

import asyncio
import json
import socket
import threading

import httpx
import pytest
from fake_connector_server import STATIC_TOKEN

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_net, connector_upstream
from tvashtr.control_plane.connector_upstream import (
    UpstreamRefused,
    UpstreamUnauthorized,
    UpstreamUnreachable,
    call_tool,
    list_tools,
    list_tools_sync,
)

BEARER = {"Authorization": f"Bearer {STATIC_TOKEN}"}
HTTP = "streamable-http"


@pytest.fixture(autouse=True)
def local(monkeypatch):
    """The fake is on ``http://127.0.0.1``: reachable only with the development switch on."""
    monkeypatch.setattr(get_settings(), "connectors_allow_local", True)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)


@pytest.fixture
def counted(monkeypatch) -> list[tuple]:
    """Count the clients taken from ``connector_net.async_client`` (the one seam)."""
    taken: list[tuple] = []
    real = connector_net.async_client

    def counting(timeout=10.0, headers=None):
        taken.append((timeout, headers))
        return real(timeout, headers)

    monkeypatch.setattr(connector_net, "async_client", counting)
    return taken


def test_lists_the_tools_with_a_bearer(fake_connector_url, counted):
    tools = asyncio.run(list_tools(fake_connector_url, HTTP, BEARER))
    assert [t.name for t in tools] == ["list_things", "get_thing", "create_thing", "list_projects"]
    assert tools[0].annotations.readOnlyHint is True
    assert tools[2].annotations is None
    assert tools[1].inputSchema["properties"].keys() == {"id"}
    assert counted == [(10, BEARER)]


def test_calls_a_tool_with_a_bearer(fake_connector_url, counted):
    result = asyncio.run(call_tool(fake_connector_url, HTTP, BEARER, "get_thing", {"id": "t1"}))
    assert result.isError is False
    assert "First thing" in result.content[0].text
    assert counted == [(120, BEARER)]


def test_a_failing_tool_is_a_result_not_an_exception(fake_connector_url):
    result = asyncio.run(call_tool(fake_connector_url, HTTP, BEARER, "get_thing", {"id": "nope"}))
    assert result.isError is True


def test_no_bearer_is_unauthorized(fake_connector_url):
    with pytest.raises(UpstreamUnauthorized):
        asyncio.run(list_tools(fake_connector_url, HTTP, {}))
    with pytest.raises(UpstreamUnauthorized):
        asyncio.run(call_tool(fake_connector_url, HTTP, {}, "get_thing", {"id": "t1"}))


def test_a_403_is_refused_not_unauthorized(fake_connector_url):
    """Only a 401 means "sign in again"."""
    with pytest.raises(UpstreamRefused) as refused:
        asyncio.run(list_tools(fake_connector_url, HTTP, {"Authorization": "Bearer forbidden"}))
    assert refused.value.status == 403
    assert not isinstance(refused.value, UpstreamUnauthorized)


def test_another_4xx_is_refused_with_its_status(fake_connector_url):
    wrong_path = fake_connector_url.removesuffix("/mcp") + "/nothing-here"
    with pytest.raises(UpstreamRefused) as refused:
        asyncio.run(list_tools(wrong_path, HTTP, BEARER))
    assert refused.value.status == 404


def test_a_closed_port_is_unreachable():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    with pytest.raises(UpstreamUnreachable):
        asyncio.run(list_tools(f"http://127.0.0.1:{port}/mcp", HTTP, BEARER))


def test_a_server_that_never_answers_is_unreachable_within_the_timeout():
    with socket.socket() as silent:  # accepts the connection (backlog) and never replies
        silent.bind(("127.0.0.1", 0))
        silent.listen(1)
        url = f"http://127.0.0.1:{silent.getsockname()[1]}/mcp"
        with pytest.raises(UpstreamUnreachable):
            asyncio.run(list_tools(url, HTTP, BEARER, timeout=0.3))


def test_sse_lists_and_calls_through_the_same_seam(fake_connector_url, counted):
    url = fake_connector_url.removesuffix("/mcp") + "/sse"
    tools = asyncio.run(list_tools(url, "sse", BEARER))
    assert len(tools) == 4
    result = asyncio.run(call_tool(url, "sse", BEARER, "get_thing", {"id": "t2"}))
    assert "Second thing" in result.content[0].text
    assert counted == [(10, BEARER), (120, BEARER)]
    with pytest.raises(UpstreamUnauthorized):
        asyncio.run(list_tools(url, "sse", {}))


def test_a_bad_address_fails_before_any_connection(monkeypatch, counted):
    monkeypatch.setattr(get_settings(), "connectors_allow_local", False)
    for url in ("https://127.0.0.1/mcp", "http://mcp.example.com/mcp", "javascript:alert(1)"):
        with pytest.raises(UpstreamUnreachable):
            asyncio.run(list_tools(url, HTTP, BEARER))
        with pytest.raises(UpstreamUnreachable):
            asyncio.run(list_tools(url, "sse", BEARER))
    assert counted == []


def test_the_address_check_runs_off_the_event_loop(fake_connector_url, monkeypatch):
    """``check_url`` resolves the host (a blocking lookup). The proxy calls this module on the
    server's event loop, so the check must run in a worker thread."""
    threads: dict[str, int] = {}
    real = connector_net.check_url

    def checking(url: str) -> str:
        threads["check"] = threading.get_ident()
        return real(url)

    monkeypatch.setattr(connector_net, "check_url", checking)

    async def go():
        threads["loop"] = threading.get_ident()
        await list_tools(fake_connector_url, HTTP, BEARER)

    asyncio.run(go())
    assert threads["check"] != threads["loop"]


# ---- answers the fake server doesn't give: a minimal MCP server as a MockTransport ----


def _mcp_server(tools_list, *, initialize_status: int = 200, seen: list | None = None):
    """A MockTransport handler speaking just enough MCP (JSON replies). ``tools_list(cursor)``
    returns the ``result`` (or an ``{"error": …}``) of one ``tools/list`` request."""

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method != "POST":
            return httpx.Response(405)
        message = json.loads(request.content)
        method, rid = message.get("method"), message.get("id")
        if seen is not None:
            seen.append(method)

        def reply(**body) -> httpx.Response:
            wire = json.dumps({"jsonrpc": "2.0", "id": rid, **body}).encode()
            # A stream, as a real answer is: the client has to read it to have it.
            return httpx.Response(
                200, headers={"content-type": "application/json"}, stream=httpx.ByteStream(wire)
            )

        if method == "initialize":
            if initialize_status != 200:
                return httpx.Response(initialize_status)
            return reply(
                result={
                    "protocolVersion": message["params"]["protocolVersion"],
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "mock", "version": "1"},
                }
            )
        if rid is None:  # a notification
            return httpx.Response(202)
        answer = tools_list((message.get("params") or {}).get("cursor"))
        return reply(**(answer if "error" in answer else {"result": answer}))

    return handle


def _tool(name: str, description: str = "") -> dict:
    return {"name": name, "description": description, "inputSchema": {"type": "object"}}


def _serve(monkeypatch, handle) -> None:
    """``connector_net.async_client`` hands out a client that talks to ``handle``."""
    monkeypatch.setattr(
        connector_net,
        "async_client",
        lambda timeout=10.0, headers=None: httpx.AsyncClient(
            transport=httpx.MockTransport(handle), timeout=timeout, headers=headers
        ),
    )


MOCK = "http://127.0.0.1:1/mcp"


def test_a_tool_list_that_never_ends_is_cut_off(monkeypatch):
    """A server can hand out a next cursor for ever: the page count is capped."""
    seen: list[str] = []
    endless = _mcp_server(
        lambda cursor: {"tools": [_tool("again")], "nextCursor": "more"}, seen=seen
    )
    _serve(monkeypatch, endless)
    with pytest.raises(UpstreamUnreachable, match="pages"):
        asyncio.run(list_tools(MOCK, HTTP, BEARER, timeout=30))
    assert seen.count("tools/list") == connector_upstream.MAX_TOOL_PAGES == 50


def test_an_answer_over_the_size_limit_is_unreachable(monkeypatch):
    monkeypatch.setattr(get_settings(), "connectors_allow_local", False)
    monkeypatch.setattr(connector_net, "_resolve", lambda host, port: "93.184.216.34")
    monkeypatch.setattr(connector_net, "MCP_BODY_LIMIT", 4096)
    huge = _mcp_server(lambda cursor: {"tools": [_tool("a", description="x" * 8000)]})
    monkeypatch.setattr(connector_net, "_async_inner", lambda: httpx.MockTransport(huge))
    with pytest.raises(UpstreamUnreachable):
        asyncio.run(list_tools("https://big.example.test/mcp", HTTP, BEARER, timeout=0.5))

    monkeypatch.setattr(connector_net, "MCP_BODY_LIMIT", 64 * 1024)
    tools = asyncio.run(list_tools("https://big.example.test/mcp", HTTP, BEARER))
    assert len(tools[0].description) == 8000


def test_list_tools_sync_wraps_the_async_one(fake_connector_url):
    assert len(list_tools_sync(fake_connector_url, HTTP, BEARER)) == 4
    with pytest.raises(UpstreamUnauthorized):
        list_tools_sync(fake_connector_url, HTTP, {})


def test_the_module_builds_no_http_client_of_its_own():
    source = open(connector_upstream.__file__).read()
    assert "httpx.AsyncClient(" not in source and "httpx.Client(" not in source
    assert "create_mcp_http_client" not in source
