"""M2 — the examples server's HTTP mount (``main.py``). The address agents are given is
``{public base}`` + ``PATH``, with no trailing slash (``node_tools.examples_mcp_url``)."""

from __future__ import annotations

from starlette.applications import Starlette

from tvashtr.control_plane.examples_mcp import create_examples_fastmcp
from tvashtr.mcp import agent_transport_security, mount_streamable

PATH = "/mcp/examples"

_mcp = None


def get_examples_mcp():
    global _mcp
    if _mcp is None:
        _mcp = create_examples_fastmcp()
        _mcp.settings.streamable_http_path = "/"
        _mcp.settings.transport_security = agent_transport_security()
    return _mcp


def mount_examples_mcp(app: Starlette, http_app: Starlette) -> None:
    mount_streamable(app, PATH, http_app)
