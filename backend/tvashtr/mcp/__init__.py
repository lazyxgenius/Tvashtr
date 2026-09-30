"""MCP transports for Tvashtr: the servers agents reach over streamable HTTP (``domains``,
``connectors``), and what the two mounts share."""

from starlette.applications import Starlette
from starlette.routing import Route


def mount_streamable(app: Starlette, path: str, http_app: Starlette) -> None:
    """Put a FastMCP ``streamable_http_app()`` (built with ``streamable_http_path="/"``) on
    ``app`` at ``path``, both ways: the exact address agents are given, and a mount for anything
    under it.

    The mount alone isn't enough. It only matches ``<path>/…``, so a POST to the address itself
    answers 307 locally and, once the SPA's GET catch-all is registered (the hosted image),
    **405**. Call it before ``mount_frontend``."""
    endpoint = next(route.endpoint for route in http_app.routes if isinstance(route, Route))
    app.add_route(path, endpoint, methods=None, include_in_schema=False)
    app.mount(path, http_app)
