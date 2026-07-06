"""The run-scoped resolution-warning recorder (M-tools C7.A; SHARED CONTRACT S1).

A tool/skill source that FAILED to resolve at run time (a missing secret, an unreachable repo, MCP
connect failure) is SKIPPED — the run CONTINUES — and recorded here, then surfaced in the run
inspector via ``GET /api/runs/{run_id}/graph``'s top-level ``resolution_warnings`` array.

C7.A owns this recorder + the ``run_warnings`` table (migration ``0022``) + the ``/graph`` wire;
C7.B (Skills) EMITS through the SAME ``record_resolution_warning`` signature (its own lazy shim).

Openhands-free + litellm-free at import (only ``uuid`` + sqlalchemy + the app's own modules), so the
executor + both seams can import it without breaching the import boundary.
"""

import uuid

from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.models import RunWarning


def record_resolution_warning(run_id: str, source_kind: str, name: str, reason: str) -> None:
    """Record a run-scoped resolution warning: a tool/skill source that FAILED to resolve at run
    time and was SKIPPED (run continued). ``source_kind`` is "tool" | "skill"; ``name`` is the MCP
    server name or the skill-source label; ``reason`` is the human cause (e.g. "missing secret
    GITHUB_TOKEN", "repo unreachable"). Writes one ``run_warnings`` row; de-dupes on
    (run_id, source_kind, name, reason). Openhands-free + litellm-free at import."""
    rid = uuid.UUID(run_id)
    with session_scope() as session:
        existing = session.execute(
            select(RunWarning.id).where(
                RunWarning.run_id == rid,
                RunWarning.source_kind == source_kind,
                RunWarning.name == name,
                RunWarning.reason == reason,
            )
        ).first()
        if existing is not None:
            return  # dedupe — the same source can fail on multiple iterations of the same run
        session.add(RunWarning(run_id=rid, source_kind=source_kind, name=name, reason=reason))
