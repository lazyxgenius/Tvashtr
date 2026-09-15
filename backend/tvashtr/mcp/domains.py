"""Domains MCP entry — HTTP mount via main.py; stdio via ``python -m tvashtr.mcp.domains``."""

from __future__ import annotations

from tvashtr.control_plane.domain_mcp import create_domains_fastmcp

_mcp = None


def get_domains_mcp():
    global _mcp
    if _mcp is None:
        _mcp = create_domains_fastmcp()
    return _mcp


def main() -> None:
    get_domains_mcp().run(transport="stdio")


if __name__ == "__main__":
    main()
