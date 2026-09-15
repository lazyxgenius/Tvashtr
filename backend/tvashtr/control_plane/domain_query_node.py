"""Phase 4a — Canvas Query-domain node helpers (pure; no DBOS)."""

from __future__ import annotations

from typing import Any

from tvashtr.control_plane.domain_ask import DomainAskError

_OUTCOME_DETAIL_MAX = 4000
_IDEA_TOKEN = "{idea}"


def render_domain_query_prompt(template: str | None, idea: str | None) -> str:
    """Substitute ``{idea}`` via literal replace (safe if idea contains braces)."""
    raw = (template if template is not None else _IDEA_TOKEN)
    text = str(raw).replace(_IDEA_TOKEN, idea or "")
    text = text.strip()
    if not text:
        raise ValueError("domain query prompt is empty")
    return text


def format_domain_ask_error(exc: DomainAskError) -> str:
    """Human-readable invocation ``outcome_detail`` for a DomainAskError."""
    detail = exc.detail
    if isinstance(detail, dict):
        msg = detail.get("message")
        if msg:
            return str(msg)
        missing = detail.get("missing_providers")
        if missing:
            return (
                "you have no API key for: "
                + ", ".join(str(p) for p in missing)
                + " — add keys under Engines before running this Query domain node."
            )
        return str(detail)
    return str(detail)


def truncate_outcome_detail(text: str, limit: int = _OUTCOME_DETAIL_MAX) -> str:
    if len(text) <= limit:
        return text
    return text[:limit]


def domain_query_manifest(result: dict[str, Any], domain_id: str) -> dict[str, Any]:
    """Invocation ``context_manifest`` for a successful domain query (citations live here)."""
    return {
        "citations": list(result.get("citations") or []),
        "domain_id": str(domain_id),
        "latency_ms": result.get("latency_ms"),
        "model": result.get("model"),
        "message_id": result.get("message_id"),
    }
