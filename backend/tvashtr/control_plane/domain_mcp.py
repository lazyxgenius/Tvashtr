"""Phase 4b — MCP tool runners for domain_ask / domain_retrieve (no transport)."""

from __future__ import annotations

import json
import uuid
from typing import Any

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
