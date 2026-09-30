"""Domains MCP entry — HTTP mount via main.py; stdio via ``python -m tvashtr.mcp.domains``.

The address agents are given is ``{public base}`` + ``PATH``, with no trailing slash
(``node_tools.domains_mcp_url``)."""

from __future__ import annotations

from starlette.applications import Starlette

from tvashtr.control_plane.domain_mcp import create_domains_fastmcp
from tvashtr.mcp import agent_transport_security, mount_streamable

PATH = "/mcp/domains"

_mcp = None


def get_domains_mcp():
    global _mcp
    if _mcp is None:
        _mcp = create_domains_fastmcp()
        # The mount root is the MCP endpoint (the agent's address ends at /mcp/domains).
        _mcp.settings.streamable_http_path = "/"
        # FastMCP's default only answers a localhost ``Host`` (421 otherwise), and agents come in
        # by the public host or the docker host.
        _mcp.settings.transport_security = agent_transport_security()
    return _mcp


def mount_domains_mcp(app: Starlette, http_app: Starlette) -> None:
    """Put the Domains server (``get_domains_mcp().streamable_http_app()``) on ``app`` at ``PATH``:
    the exact address agents are given, and a mount for anything under it (``mount_streamable``:
    behind the SPA catch-all a mount alone answers 405 to ``POST /mcp/domains``)."""
    mount_streamable(app, PATH, http_app)


def main() -> None:
    get_domains_mcp().run(transport="stdio")


if __name__ == "__main__":
    main()
