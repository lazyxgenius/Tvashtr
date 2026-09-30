"""MCP transports for Tvashtr: the servers agents reach over streamable HTTP (``domains``,
``connectors``), and what the two mounts share."""

from urllib.parse import urlparse

from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.routing import Route

from tvashtr.config import get_settings


def agent_transport_security() -> TransportSecuritySettings:
    """The ``Host`` headers the agent-facing servers answer, as the SDK's allow-list: the public
    base address's host (a Fly sandbox and a hosted agent come in by it), the docker host (a
    docker sandbox's name for this machine) and localhost, each with or without a port. Every
    other ``Host`` gets 421.

    FastMCP's own default for a localhost-bound server lists localhost alone, which answers 421 to
    every agent that isn't on this machine. No ``Origin`` is listed: agents send none, so a
    request that carries one is a browser page, and it gets 403.

    Both come from ``node_tools._agent_base_url``'s inputs, so the address an agent is handed is
    always one this accepts."""
    settings = get_settings()
    hosts = ["localhost", "127.0.0.1", "[::1]", settings.litellm_proxy_host_docker]
    public = urlparse(settings.public_base_url).hostname
    if public:
        hosts.append(f"[{public}]" if ":" in public else public)
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        # ``host:*`` is the SDK's spelling for "this host, any port".
        allowed_hosts=[h for host in dict.fromkeys(hosts) for h in (host, f"{host}:*")],
    )


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
