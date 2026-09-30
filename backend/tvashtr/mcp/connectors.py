"""Connectors MCP proxy entry — mounted at ``/mcp/connectors`` by ``main.py``.

The only thing an agent's sandbox talks to for a connector: a stateless streamable-HTTP MCP server
(JSON replies) that reads the run token off each request and hands ``tools/list`` and
``tools/call`` to ``control_plane/connector_proxy.py``, which applies the read-only rule and
forwards to the provider with the credential added server-side. The address agents are given is
``{public base}`` + ``PATH``, with no trailing slash. Contract:
``docs/superpowers/plans/api/connectors.md`` (Run time).
"""

import logging

import anyio
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolRequest, CallToolResult, ServerResult, TextContent, Tool
from starlette.applications import Starlette
from starlette.routing import Route

from tvashtr.control_plane import connector_proxy

logger = logging.getLogger(__name__)

PATH = "/mcp/connectors"

_mcp: FastMCP | None = None


class _ConnectorsMCP(FastMCP):
    """No tools of its own: what it lists and calls is the provider's, for the request's run
    token. Both overrides run on the server's event loop, so they only await: the token read (a
    database read) goes to a worker thread, and the rest is ``connector_proxy``'s."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # The SDK's own tools/call handler first looks the tool up in a cache it fills by calling
        # ``list_tools`` (one more provider round trip per miss, in one cache for every agent and
        # connector), and with input validation off nothing uses what it finds.
        self._mcp_server.request_handlers[CallToolRequest] = self._handle_call

    async def _handle_call(self, req: CallToolRequest) -> ServerResult:
        return ServerResult(await self.call_tool(req.params.name, req.params.arguments or {}))

    async def _grant(self) -> connector_proxy.RunGrant | None:
        """The grant of this request's ``Authorization: Bearer <run token>``, or ``None``."""
        try:
            request = self.get_context().request_context.request
        except (LookupError, ValueError):
            return None  # not inside a request
        scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            return None
        return await anyio.to_thread.run_sync(connector_proxy.read_run_token, token.strip())

    async def list_tools(self) -> list[Tool]:
        # Never an error: one failing server stops an agent from starting.
        try:
            grant = await self._grant()
            return await connector_proxy.proxy_list_tools(grant) if grant else []
        except Exception as exc:
            # The type only: an error's text can carry an address or a credential.
            logger.warning("connectors: tools/list failed (%s)", type(exc).__name__)
            return []

    async def call_tool(self, name: str, arguments: dict) -> CallToolResult:
        try:
            grant = await self._grant()
            if grant is not None:
                return await connector_proxy.proxy_call_tool(grant, name, arguments)
        except Exception as exc:
            logger.warning("connectors: tools/call failed (%s)", type(exc).__name__)
        return CallToolResult(
            content=[TextContent(type="text", text=connector_proxy.UNAVAILABLE)], isError=True
        )


def get_connectors_mcp() -> FastMCP:
    global _mcp
    if _mcp is None:
        _mcp = _ConnectorsMCP(
            "tvashtr-connectors",
            stateless_http=True,
            json_response=True,
            # The mount root is the MCP endpoint (the agent's address ends at /mcp/connectors).
            streamable_http_path="/",
            # FastMCP's default for a localhost-bound server only accepts a localhost ``Host``
            # header (421 otherwise). Agents reach this by the public host, or the docker host,
            # and every request is authorized by its run token, so that check is off.
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        )
    return _mcp


def mount_connectors_mcp(app: Starlette, http_app: Starlette) -> None:
    """Put the proxy (``get_connectors_mcp().streamable_http_app()``) on ``app`` at ``PATH``, both
    ways: the exact address agents are given, and a mount for anything under it.

    The mount alone isn't enough. It only matches ``/mcp/connectors/…``, so a POST to the address
    itself answers 307 locally and, once the SPA's GET catch-all is registered (the hosted image),
    **405**. Call it before ``mount_frontend``."""
    endpoint = next(route.endpoint for route in http_app.routes if isinstance(route, Route))
    app.add_route(PATH, endpoint, methods=None, include_in_schema=False)
    app.mount(PATH, http_app)
