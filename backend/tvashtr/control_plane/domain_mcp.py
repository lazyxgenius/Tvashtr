"""Phase 4b — MCP tool runners for domain_ask / domain_retrieve (+ FastMCP factory)."""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

from mcp.server.fastmcp import Context, FastMCP
from starlette.requests import Request

from tvashtr.auth import SESSION_COOKIE_NAME, read_session_cookie
from tvashtr.control_plane.domain_ask import (
    DomainAskError,
    ask_domain,
    retrieve_domain,
)
from tvashtr.control_plane.domain_query_node import format_domain_ask_error


class DomainMcpToolError(Exception):
    """Raised to surface a clear tool error string to the MCP client / model."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def parse_domain_uuid(domain_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(domain_id).strip())
    except (ValueError, AttributeError, TypeError) as e:
        raise DomainAskError(
            "bad_request", "domain_id must be a UUID"
        ) from e


def _json_ok(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def run_domain_ask_tool(owner_id: uuid.UUID, domain_id: str, question: str) -> str:
    try:
        did = parse_domain_uuid(domain_id)
        result = ask_domain(owner_id, did, question)
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


def owner_id_from_headers(cookie_header: str | None) -> uuid.UUID:
    if not cookie_header:
        raise DomainMcpToolError("authentication required — missing session cookie")
    # cookie_header may be full "tv_session=..." or a Cookie header with multiple pairs
    raw = None
    for part in str(cookie_header).split(";"):
        part = part.strip()
        if part.startswith(SESSION_COOKIE_NAME + "="):
            raw = part.split("=", 1)[1]
            break
    if raw is None and "=" not in str(cookie_header):
        raw = str(cookie_header)
    user_id = read_session_cookie(raw) if raw else None
    if not user_id:
        raise DomainMcpToolError("authentication required — invalid or expired session")
    try:
        return uuid.UUID(user_id)
    except ValueError as e:
        raise DomainMcpToolError("authentication required — invalid session subject") from e


def create_domains_fastmcp() -> FastMCP:
    """Build the Domains MCP server (tools domain_ask + domain_retrieve)."""
    mcp = FastMCP("tvashtr-domains")

    def _owner_from_ctx(ctx: Context) -> uuid.UUID:
        # Prefer HTTP request cookie when mounted; fall back to env for stdio debug.
        request: Request | None = None
        try:
            request = ctx.request_context.request  # type: ignore[attr-defined]
        except Exception:
            request = None
        if request is not None:
            raw = request.headers.get("cookie") or request.cookies.get(SESSION_COOKIE_NAME)
            if request.cookies.get(SESSION_COOKIE_NAME):
                return owner_id_from_headers(
                    f"{SESSION_COOKIE_NAME}={request.cookies.get(SESSION_COOKIE_NAME)}"
                )
            return owner_id_from_headers(raw)

        env_oid = os.environ.get("TVASHTR_OWNER_ID")
        if env_oid:
            return uuid.UUID(env_oid)
        raise DomainMcpToolError("authentication required")

    @mcp.tool(name="domain_ask")
    def domain_ask(domain_id: str, question: str, ctx: Context) -> str:
        """Ask a Domain a question; returns answer + citations JSON."""
        owner = _owner_from_ctx(ctx)
        return run_domain_ask_tool(owner, domain_id, question)

    @mcp.tool(name="domain_retrieve")
    def domain_retrieve(
        domain_id: str, query: str, top_k: int | None = None, ctx: Context = None
    ) -> str:
        """Retrieve cited chunks from a Domain (no LLM generation)."""
        owner = _owner_from_ctx(ctx)
        return run_domain_retrieve_tool(owner, domain_id, query, top_k=top_k)

    return mcp
