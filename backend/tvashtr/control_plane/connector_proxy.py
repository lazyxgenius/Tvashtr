"""Connectors: the run-time proxy's rules (run tokens, the read-only filter, call records).

Phase 0 skeleton. Stream B3 fills it (build plan B3.1, B3.3, B3.5); the MCP mount that calls it is
``tvashtr/mcp/connectors.py``. Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time,
What a run shows).
"""

import uuid

from sqlalchemy.orm import Session


def recent_use(session: Session, owner_id: uuid.UUID, connection_id: uuid.UUID) -> list:
    """Up to 10 rows, newest first, one per run and agent, read from the ``connector_call`` events
    of the owner's last 30 runs: ``{"run_id", "run_number", "agent", "reads", "writes", "at"}``.

    Phase 0 stub: nothing has been used yet. Stream B3.5 fills it."""
    return []
