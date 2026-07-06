"""Per-account MCP ``${NAME}`` secret store (M-tools C7.A) — Fernet-encrypted at rest, resolved
server-side at run time.

Mirrors :mod:`tvashtr.control_plane.credentials`'s posture (the SAME ``TVASHTR_SECRET_KEY`` via the
reused ``encrypt_secret``/``decrypt_secret`` — the crypto is not re-implemented): the plaintext is
decrypted ONLY here, at run time; it is never stored, logged, or returned by any endpoint. A node's
inline ``tool_config`` holds only a ``${NAME}`` reference; the value lives in ``mcp_secrets``.

Openhands-free + litellm-free at import (only ``uuid`` + sqlalchemy + the app's own modules), so
``node_tools`` (and thus ``team_run``) can import it without breaching the boundary.
"""

import uuid

from sqlalchemy import delete, select

from tvashtr.control_plane.credentials import decrypt_secret, encrypt_secret
from tvashtr.db import session_scope
from tvashtr.models import McpSecret


def resolve_owner_mcp_secret(owner_id: uuid.UUID, name: str) -> str | None:
    """The plaintext value of ``owner_id``'s ``${name}`` MCP secret, or ``None`` when there is no
    such row.

    Returns ``None`` (not an exception) for a missing secret, so callers can SKIP + WARN
    a server whose secret is missing instead of failing the whole run. The plaintext is decrypted
    here for immediate substitution; never stored."""
    with session_scope() as session:
        row = session.execute(
            select(McpSecret).where(McpSecret.owner_id == owner_id, McpSecret.name == name)
        ).scalar_one_or_none()
    if row is None:
        return None
    return decrypt_secret(row.secret_encrypted)


def set_owner_mcp_secret(owner_id: uuid.UUID, name: str, value: str) -> None:
    """Create or REPLACE ``owner_id``'s ``${name}`` secret (upsert on ``(owner_id, name)`` unique
    key — adding the same name again replaces the stored value). The plaintext is encrypted (Fernet)
    before persist and is never stored/returned in the clear."""
    secret = encrypt_secret(value)
    with session_scope() as session:
        existing = session.execute(
            select(McpSecret).where(McpSecret.owner_id == owner_id, McpSecret.name == name)
        ).scalar_one_or_none()
        if existing is not None:
            existing.secret_encrypted = secret
        else:
            session.add(McpSecret(owner_id=owner_id, name=name, secret_encrypted=secret))


def list_owner_mcp_secret_names(owner_id: uuid.UUID) -> list[str]:
    """The NAMES of ``owner_id``'s MCP secrets (never the values), oldest first — feeds the account
    Secrets shelf and ToolsSection's pre-launch missing-secret check."""
    with session_scope() as session:
        return list(
            session.execute(
                select(McpSecret.name)
                .where(McpSecret.owner_id == owner_id)
                .order_by(McpSecret.created_at, McpSecret.name)
            ).scalars()
        )


def delete_owner_mcp_secret(owner_id: uuid.UUID, name: str) -> None:
    """Remove ``owner_id``'s ``${name}`` secret (idempotent — an absent name is a no-op)."""
    with session_scope() as session:
        session.execute(
            delete(McpSecret).where(McpSecret.owner_id == owner_id, McpSecret.name == name)
        )
