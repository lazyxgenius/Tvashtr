"""Assemble a node's recorded TRAIL into a SYSTEM prompt — the substrate for Mode A ("Ask the
node").

Given a run + a node, this reads everything the system already recorded about what that node did —
its authored prompt, its per-round ``AgentInvocation`` outcome + outcome_detail + context manifest,
the invocation-scoped ``RunEvent``s, the run's idea + latest spec version, and (for a worker) the
diff the run shipped via :func:`run_diff.compute_run_diff` — and renders it, BOUNDED, into a single
system message that pins the answering model to that record (and to say so when the record is
silent). The gateway call itself lives in the endpoint (``routers.ask_node``); this module is a PURE
assembler.

Kept **openhands-free and litellm-free at import** (only ``json`` / ``sqlalchemy`` / ``tvashtr`` +
the stdlib-only ``run_diff``), mirroring ``run_diff.py`` / ``credentials.py`` / ``invocations.py`` —
so it never breaches the import boundary and is unit-testable directly.
"""

import json
import uuid

from sqlalchemy import select

from tvashtr.control_plane.run_diff import compute_run_diff
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, DocumentVersion, Run, RunEvent

# Bounds — keep the assembled record well within any model's context and cheap to send. The trail is
# a summary, not a transcript; the durable rows remain the source of truth.
_MAX_PROMPT_CHARS = 2000
_MAX_DETAIL_CHARS = 1500
_MAX_EVENT_CHARS = 400
_MAX_EVENTS_PER_ROUND = 40
_MAX_SPEC_CHARS = 4000
_MAX_PATCH_CHARS_PER_FILE = 1500
_MAX_DIFF_CHARS = 6000
_MAX_TOTAL_CHARS = 24000

_INSTRUCTION = (
    "You are a Tvashtr node assistant. A user is asking about what ONE node in an AI agent team "
    "did during a specific run. Answer ONLY from the RECORD below — the node's authored prompt, "
    "its recorded run outcome(s), the events it emitted, the run's idea and current spec, and (for "
    "a worker node) the code changes the run shipped. If the record does not contain the answer, "
    "say plainly that the record does not show it — never guess, never invent details that are not "
    "in the record. Be concise and specific, and quote from the record where it helps."
)


def _clip(text: str | None, limit: int) -> str:
    """Trim ``text`` to ``limit`` chars with an explicit elision marker (never mid-silently)."""
    if not text:
        return ""
    text = str(text)
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[truncated, {len(text) - limit} more chars]"


def _capability(kind: str, edits_allowed: bool | None) -> str:
    """Human label for the node's capability (post-M-unify: edits on ⇒ worker)."""
    if kind == "agent":
        return "worker (edits files)" if edits_allowed is not False else "worker (report-only)"
    if kind == "completion":
        return "thinker (reasons / writes the spec, no file edits)"
    return kind


def _event_text(payload: object) -> str:
    """Best-effort human text for one recorded event. Tries the common text-bearing keys, else a
    compact JSON dump — so an event ALWAYS renders something (never an empty line)."""
    if isinstance(payload, dict):
        for key in ("text", "content", "message", "thought", "observation", "command", "detail"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                return _clip(val, _MAX_EVENT_CHARS)
        try:
            return _clip(json.dumps(payload, ensure_ascii=False, default=str), _MAX_EVENT_CHARS)
        except (TypeError, ValueError):
            return _clip(str(payload), _MAX_EVENT_CHARS)
    return _clip(str(payload), _MAX_EVENT_CHARS)


def _manifest_summary(manifest: object) -> str:
    """One-line summary of a context manifest (which context parts + total tokens)."""
    if not isinstance(manifest, dict):
        return ""
    parts = manifest.get("parts")
    names = ""
    if isinstance(parts, list):
        names = ", ".join(
            str(p.get("name")) for p in parts if isinstance(p, dict) and p.get("name")
        )
    total = manifest.get("total_tokens")
    bits = []
    if names:
        bits.append(f"parts=[{names}]")
    if total is not None:
        bits.append(f"total_tokens={total}")
    return "; ".join(bits)


def _render_events(session, invocation_id: int) -> list[str]:
    """The invocation-scoped events, in emission order, bounded."""
    rows = (
        session.execute(
            select(RunEvent)
            .where(RunEvent.invocation_id == invocation_id)
            .order_by(RunEvent.seq)
            .limit(_MAX_EVENTS_PER_ROUND + 1)
        )
        .scalars()
        .all()
    )
    lines: list[str] = []
    for ev in rows[:_MAX_EVENTS_PER_ROUND]:
        lines.append(f"   - [{ev.kind}] {_event_text(ev.payload)}")
    if len(rows) > _MAX_EVENTS_PER_ROUND:
        lines.append("   - …[more events omitted]")
    return lines


def _render_diff(run: Run) -> str:
    """The bounded per-file summary of what the run shipped (worker nodes only)."""
    diff = compute_run_diff(
        run_id=run.workflow_id,
        repo_path=run.repo_path,
        base_ref=run.base_ref,
        ship_branch=run.ship_branch,
    )
    files = diff.get("files") or []
    if not files:
        return "No file changes are recorded for this run."
    lines: list[str] = []
    used = 0
    for f in files:
        header = f"- {f['path']} ({f['status']} +{f['additions']}/-{f['deletions']})"
        patch = _clip(f.get("patch"), _MAX_PATCH_CHARS_PER_FILE)
        block = header + (f"\n{patch}" if patch else "")
        if used + len(block) > _MAX_DIFF_CHARS:
            lines.append(f"…[{len(files) - len(lines)} more changed file(s) omitted]")
            break
        lines.append(block)
        used += len(block)
    return "\n".join(lines)


def build_system_prompt(*, run_id: str, node_id: str) -> str:
    """Assemble the node's recorded trail into a single bounded SYSTEM message.

    Reads its own session. Defensive: if the run/node can't be loaded it still returns the pinning
    instruction (never raises for a read) — but the endpoint validates existence first, so on the
    real path every section is populated.
    """
    sections: list[str] = [_INSTRUCTION]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        node = session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one_or_none()

        if node is not None:
            sections.append(
                "=== NODE ===\n"
                f"Role: {node.role_name}\n"
                f"Capability: {_capability(node.kind, node.edits_allowed)}\n"
                f"Model: {node.model}\n"
                "Prompt (its authored instructions):\n"
                f"{_clip(node.prompt, _MAX_PROMPT_CHARS) or '(no prompt recorded)'}"
            )

        if run is not None:
            spec = _latest_spec(session, run.pm_document_id)
            sections.append(
                "=== RUN ===\n"
                f"Idea: {run.idea}\n"
                "Current spec (latest version):\n"
                f"{_clip(spec, _MAX_SPEC_CHARS) or '(no spec recorded yet)'}"
            )

        if node is not None:
            invocations = (
                session.execute(
                    select(AgentInvocation)
                    .where(
                        AgentInvocation.run_id == run_id,
                        AgentInvocation.node_id == node.id,
                    )
                    .order_by(AgentInvocation.iteration)
                )
                .scalars()
                .all()
            )
            rounds: list[str] = [
                f"=== WHAT THIS NODE DID ({len(invocations)} recorded round(s)) ==="
            ]
            for inv in invocations:
                block = [f"Round {inv.iteration} — status={inv.status}, outcome={inv.outcome}"]
                detail = _clip(inv.outcome_detail, _MAX_DETAIL_CHARS)
                if detail:
                    block.append(f"  detail: {detail}")
                manifest = _manifest_summary(inv.context_manifest)
                if manifest:
                    block.append(f"  context: {manifest}")
                events = _render_events(session, inv.id)
                if events:
                    block.append("  events:")
                    block.extend(events)
                rounds.append("\n".join(block))
            sections.append("\n".join(rounds))

        # A worker (agent) node: show the code the run actually shipped.
        if node is not None and node.kind == "agent" and run is not None:
            sections.append("=== CODE CHANGES SHIPPED BY THIS RUN ===\n" + _render_diff(run))

    return _clip("\n\n".join(sections), _MAX_TOTAL_CHARS)


def _latest_spec(session, document_id) -> str | None:
    """The newest spec version's content for the run's PRD document (inlined so this module stays
    dependency-minimal / openhands-free — mirrors ``documents.service.get_latest_version``)."""
    if document_id is None:
        return None
    latest = (
        session.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version_no.desc())
        )
        .scalars()
        .first()
    )
    return latest.content if latest is not None else None
