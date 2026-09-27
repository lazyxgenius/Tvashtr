"""Phase 4a — Canvas Query-domain node helpers (pure; no DBOS)."""

from __future__ import annotations

from typing import Any

from tvashtr.control_plane.domain_ask import DomainAskError

_OUTCOME_DETAIL_MAX = 4000
_IDEA_TOKEN = "{idea}"


def render_domain_query_prompt(template: str | None, idea: str | None) -> str:
    """Substitute ``{idea}`` via literal replace (safe if idea contains braces)."""
    raw = template if template is not None else _IDEA_TOKEN
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


# ---- Revamp Domains G12: the node's pass-to-spec / no-answer run side (DM-98–104) ---------------

SPEC_SECTION = "What the docs say"
ON_NO_ANSWER = ("continue", "stop")
DEFAULT_TITLE = "Query domain"


def uses_v2(config: dict | None) -> bool:
    """A node authored with the pass/no-answer settings (palette, Add step, a drawer save) runs the
    v2 steps; a node from before them keeps today's lookup (OQ-21)."""
    return isinstance(config, dict) and "pass_to_spec" in config


def node_title(config: dict | None) -> str:
    title = (config or {}).get("title") if isinstance(config, dict) else None
    return title.strip() if isinstance(title, str) and title.strip() else DEFAULT_TITLE


def _source_line(source: dict[str, Any]) -> str:
    piece = f"piece {source.get('piece_number')}"
    if source.get("pieces_in_file"):
        piece += f" of {source['pieces_in_file']}"
    page = f"page {source['page']} · " if source.get("page") else ""
    return f"{source.get('number')}. {source.get('filename')} · {page}{piece}"


def spec_section_md(domain_name: str, question: str, result: dict[str, Any]) -> str:
    """The section a node adds to the spec (DM-104): the question, the answer and its numbered
    sources, or — not covered — that the domain had no answer."""
    if result.get("covered") is False:
        body = f"{domain_name} had no answer for: “{question}”"
    else:
        answer = str(result.get("answer_text") or result.get("answer") or "").strip()
        lines = [f"**Asked {domain_name}:** {question}", "", answer]
        sources = [s for s in result.get("sources") or [] if isinstance(s, dict)]
        if sources:
            lines += ["", "Sources:", *(_source_line(s) for s in sources)]
        body = "\n".join(lines)
    return f"## {SPEC_SECTION}\n\n{body}\n"


def no_answer_message(title: str, domain_name: str, question: str) -> str:
    return f"{title} stopped the run: {domain_name} has no answer for “{question}”."


def rereading_message(domain_name: str) -> str:
    return f"{domain_name} was still re-reading its files."


def domain_query_manifest_v2(
    result: dict[str, Any], domain_id: str, question: str, spec_section: str | None
) -> dict[str, Any]:
    """The v2 round's ``context_manifest``: the v1 keys plus what the drawer's Last run shows."""
    return {
        **domain_query_manifest(result, domain_id),
        "question": question,
        "covered": result.get("covered") is not False,
        "answer_text": result.get("answer_text") or result.get("answer") or "",
        "sources": list(result.get("sources") or []),
        "cost_usd": result.get("cost_usd"),
        "spec_section": spec_section,
    }
