"""Connectors MCP proxy entry — mounted at ``/mcp/connectors`` by ``main.py``.

The only thing an agent's sandbox talks to for a connector: a stateless streamable-HTTP MCP server
(JSON replies) that reads the run token, applies the read-only rule and forwards to the provider
with the credential added server-side. Phase 0 mounts it with no tools; stream B3.4 adds the
``list_tools`` / ``call_tool`` overrides. Contract: ``docs/superpowers/plans/api/connectors.md``
(Run time).
"""

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

_mcp: FastMCP | None = None


def get_connectors_mcp() -> FastMCP:
    global _mcp
    if _mcp is None:
        _mcp = FastMCP(
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
