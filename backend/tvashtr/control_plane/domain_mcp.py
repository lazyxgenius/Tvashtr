"""Phase 4b — MCP tool runners for domain_ask / domain_retrieve (+ FastMCP factory)."""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

from mcp.server.fastmcp import Context, FastMCP
from mcp.types import Tool as MCPTool
from sqlalchemy import select
from starlette.requests import Request

from tvashtr.control_plane.domain_ask import (
    DomainAskError,
    ask_domain,
    retrieve_domain,
)
from tvashtr.control_plane.domain_query_node import format_domain_ask_error
from tvashtr.control_plane.node_tools import read_domains_token
from tvashtr.db import session_scope
from tvashtr.models import Domain


class DomainMcpToolError(Exception):
    """Raised to surface a clear tool error string to the MCP client / model."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def parse_domain_uuid(domain_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(domain_id).strip())
    except (ValueError, AttributeError, TypeError) as e:
        raise DomainAskError("bad_request", "domain_id must be a UUID") from e


def _usable(owner_id: uuid.UUID, allowed: set[str] | None) -> list[tuple[str, str]]:
    """``(id, name)`` of the owner's domains this agent may search, oldest first."""
    with session_scope() as session:
        rows = session.execute(
            select(Domain.id, Domain.name)
            .where(Domain.owner_id == owner_id)
            .order_by(Domain.created_at, Domain.id)
        ).all()
    return [(str(i), n) for i, n in rows if allowed is None or str(i) in allowed]


def searchable_line(owner_id: uuid.UUID, allowed: set[str] | None) -> str:
    """ "Domains you can search: Support docs, Vendor contracts." (DM-96)."""
    names = [name for _, name in _usable(owner_id, allowed)]
    if not names:
        return "You can’t search any domains."
    return "Domains you can search: " + ", ".join(names) + "."


def resolve_domain_ref(owner_id: uuid.UUID, ref: str, allowed: set[str] | None) -> str:
    """The id of the domain ``ref`` names — a name (any case) or an id — among the owner's domains
    this agent may search. The only one when ``ref`` is empty and there is just one. Anything else
    is a tool error listing the names it can use ("Domains you can search: Support docs, Vendor
    contracts.")."""
    usable = _usable(owner_id, allowed)
    want = (ref or "").strip()
    if not want and len(usable) == 1:
        return usable[0][0]
    for did, name in usable:
        if want.lower() in (did, name.strip().lower()):
            return did
    raise DomainMcpToolError(searchable_line(owner_id, allowed))


def _json_ok(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def run_domain_ask_tool(owner_id: uuid.UUID, domain_id: str, question: str) -> str:
    try:
        did = parse_domain_uuid(domain_id)
        # Agent asks stay out of the user's chat (finding 8).
        # M1: an agent's tool call gives up long before the run path's retries would end.
        result = ask_domain(owner_id, did, question, persist=False, retries=0)
    except DomainAskError as exc:
        raise DomainMcpToolError(format_domain_ask_error(exc)) from exc
    return _json_ok(
        {
            "domain_id": str(did),
            "answer": result.get("answer"),
            "citations": list(result.get("citations") or []),
            "latency_ms": result.get("latency_ms"),
            "model": result.get("model"),
            "message_id": result.get("message_id"),
        }
    )


def run_domain_retrieve_tool(
    owner_id: uuid.UUID,
    domain_id: str,
    query: str,
    top_k: int | None = None,
) -> str:
    try:
        did = parse_domain_uuid(domain_id)
        result = retrieve_domain(owner_id, did, query, top_k=top_k)
    except DomainAskError as exc:
        raise DomainMcpToolError(format_domain_ask_error(exc)) from exc
    return _json_ok(
        {
            "domain_id": str(did),
            "citations": list(result.get("citations") or []),
            "latency_ms": result.get("latency_ms"),
        }
    )


def _grant_from_ctx(ctx: Context) -> tuple[uuid.UUID, set[str] | None]:
    """The run owner and the domain ids this agent may search (``None`` = all), from the request's
    ``Authorization: Bearer <Domains run token>`` — never a login cookie, never a header list.
    Without a request (a stdio debug run): ``TVASHTR_OWNER_ID``, every domain."""
    request: Request | None = None
    try:
        request = ctx.request_context.request  # type: ignore[attr-defined]
    except Exception:
        request = None
    if request is not None:
        scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
        grant = read_domains_token(token.strip()) if scheme.lower() == "bearer" else None
        if grant is None:
            raise DomainMcpToolError("authentication required — no valid run token")
        return grant

    env_oid = os.environ.get("TVASHTR_OWNER_ID")
    if env_oid:
        return uuid.UUID(env_oid), None
    raise DomainMcpToolError("authentication required")


class _DomainsMCP(FastMCP):
    async def list_tools(self) -> list[MCPTool]:
        """The tools, each description ending with the domains this agent can search by name
        (DM-96) — the agent picks one without a failed call first."""
        tools = await super().list_tools()
        ctx = self.get_context()
        try:
            line = searchable_line(*_grant_from_ctx(ctx))
        except DomainMcpToolError:
            return tools  # no run token: the plain descriptions
        for tool in tools:
            tool.description = f"{tool.description or ''}\n\n{line}"
        return tools


def create_domains_fastmcp() -> FastMCP:
    """Build the Domains MCP server (tools domain_ask + domain_retrieve)."""
    mcp = _DomainsMCP("tvashtr-domains")

    @mcp.tool(name="domain_ask")
    def domain_ask(question: str, ctx: Context, domain: str = "", domain_id: str = "") -> str:
        """Ask one of your domains (a library of the user's files) a question; returns the answer
        and its sources as JSON. ``domain`` is the domain's name, e.g. "Support docs"."""
        owner, allowed = _grant_from_ctx(ctx)
        did = resolve_domain_ref(owner, domain or domain_id, allowed)
        return run_domain_ask_tool(owner, did, question)

    @mcp.tool(name="domain_retrieve")
    def domain_retrieve(
        query: str, ctx: Context, domain: str = "", domain_id: str = "", top_k: int | None = None
    ) -> str:
        """Find the passages in one of your domains that match ``query`` (no answer is written);
        returns them with their sources as JSON. ``domain`` is the domain's name."""
        owner, allowed = _grant_from_ctx(ctx)
        did = resolve_domain_ref(owner, domain or domain_id, allowed)
        return run_domain_retrieve_tool(owner, did, query, top_k=top_k)

    return mcp
