"""Connectors: the MCP client to the provider.

``list_tools`` and ``call_tool`` open one MCP session to a provider's server, over streamable HTTP
or the older SSE transport, and close it again. The HTTP client always comes from
``connector_net.async_client`` (the address guard and IP pinning), and the address is checked with
``connector_net.check_url`` before anything is opened.

Errors, by what the provider's HTTP answer was:

* :class:`UpstreamUnauthorized`: **401 only**. The one status that means "sign in again".
* :class:`UpstreamRefused`: any other 4xx, 403 included. Not an expired sign-in.
* :class:`UpstreamUnreachable`: a network error, a timeout, a 5xx, or an address Tvashtr won't open.
  Also an answer ``connector_net`` refuses (compressed, or over ``MCP_BODY_LIMIT``) and a tool
  list that doesn't end.

A provider that answers 200 with a JSON-RPC error raises the SDK's ``McpError`` unchanged, and a
tool that fails comes back as a result with ``isError`` set: neither is an HTTP problem.
"""

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from typing import Any

import anyio
import httpx
from mcp import ClientSession, McpError
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, Tool

from tvashtr.control_plane import connector_net

MAX_TOOL_PAGES = 50


class UpstreamUnauthorized(Exception):
    """The provider answered 401: the sign-in (or key) is no longer accepted."""


class UpstreamRefused(Exception):
    """The provider answered another 4xx (403 included). ``status`` is the HTTP status."""

    def __init__(self, status: int) -> None:
        super().__init__(f"the provider answered {status}")
        self.status = status


class UpstreamUnreachable(Exception):
    """The provider didn't answer: a network error, a timeout, a 5xx or an unusable address."""


def _leaves(exc: BaseException):
    """The exceptions inside an exception group (the SDK's task groups wrap what they raise)."""
    if isinstance(exc, BaseExceptionGroup):
        for inner in exc.exceptions:
            yield from _leaves(inner)
    else:
        yield exc


async def _with_session[T](
    url: str,
    transport: str,
    headers: dict | None,
    timeout: float,
    use: Callable[[ClientSession], Awaitable[T]],
) -> T:
    # ponytail: one provider session per call (an extra initialize round trip); pool per run and
    # connection if latency shows up.
    # ponytail: an answer ``connector_net`` cuts off (too big) is unreachable only once ``timeout``
    # is up, because the SDK swallows the error a response stream raises. Cancel the session from
    # the stream if providers turn out to send answers that size.
    statuses: list[int] = []
    # Streamable HTTP also opens a GET stream that many servers answer 405; only POST answers say
    # how the provider took the request. SSE starts with a GET, so both count there.
    counted = ("GET", "POST") if transport == "sse" else ("POST",)

    async def note(response: httpx.Response) -> None:
        if response.status_code >= 400 and response.request.method in counted:
            statuses.append(response.status_code)

    def http(*_args: Any, **_kwargs: Any) -> httpx.AsyncClient:
        made = connector_net.async_client(timeout, headers)
        made.event_hooks["response"].append(note)
        return made

    try:
        # The check resolves the host (a blocking lookup), and callers may be on an event loop.
        await anyio.to_thread.run_sync(connector_net.check_url, url)
        with anyio.fail_after(timeout):
            async with AsyncExitStack() as stack:
                if transport == "sse":
                    read, write = await stack.enter_async_context(
                        sse_client(url, httpx_client_factory=http)
                    )
                else:
                    client = await stack.enter_async_context(http())
                    read, write, _ = await stack.enter_async_context(
                        streamable_http_client(url, http_client=client)
                    )
                session = await stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
                return await use(session)
    except Exception as exc:
        if statuses:
            status = statuses[0]
            if status == 401:
                raise UpstreamUnauthorized() from exc
            if status < 500:
                raise UpstreamRefused(status) from exc
            raise UpstreamUnreachable(f"the provider answered {status}") from exc
        leaves = list(_leaves(exc))
        # A JSON-RPC error, or a refusal raised in ``use`` (a tool list that doesn't end), as it is.
        for leaf in leaves:
            if isinstance(leaf, McpError | UpstreamUnreachable):
                raise leaf from None
        # Else the first thing that went wrong, not the task group that wrapped it.
        raise UpstreamUnreachable(str(leaves[0]) or type(leaves[0]).__name__) from exc


async def list_tools(
    url: str, transport: str, headers: dict | None, timeout: float = 10
) -> list[Tool]:
    """Every tool the provider's server lists (all pages), as the SDK's ``Tool`` objects. A list
    of more than ``MAX_TOOL_PAGES`` pages is :class:`UpstreamUnreachable`: a server can hand out a
    next cursor for ever."""

    async def use(session: ClientSession) -> list[Tool]:
        tools: list[Tool] = []
        cursor = None
        for _ in range(MAX_TOOL_PAGES):
            page = await session.list_tools(cursor)
            tools.extend(page.tools)
            cursor = page.nextCursor
            if not cursor:
                return tools
        raise UpstreamUnreachable(f"the provider's tool list has over {MAX_TOOL_PAGES} pages")

    return await _with_session(url, transport, headers, timeout, use)


async def call_tool(
    url: str,
    transport: str,
    headers: dict | None,
    name: str,
    arguments: dict | None,
    timeout: float = 120,
) -> CallToolResult:
    """Call one tool on the provider's server and return its result as-is."""
    return await _with_session(
        url, transport, headers, timeout, lambda session: session.call_tool(name, arguments)
    )


def list_tools_sync(
    url: str, transport: str, headers: dict | None, timeout: float = 10
) -> list[Tool]:
    """``list_tools`` for the sync routes (they run in FastAPI's worker threads, off any loop)."""
    return asyncio.run(list_tools(url, transport, headers, timeout))
