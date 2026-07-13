"""Agentic memory — tier derivation + owner-scoped CRUD service (M-memory S1).

The persistence + embedding seam behind ``/api/memories``. Kept openhands-free and out of the
executor (S1 does NOT touch run execution): the router stays thin (validate + map errors to HTTP)
and calls these owner-scoped functions, mirroring ``node_library`` for Tools/Skills.

Two pure, unit-tested pieces sit up front — ``memory_tier`` (which of ``repo_key`` / ``node_id`` are
set ⇒ account / repo / node) and its validity check — because the tier model is the one bit of real
logic here and the later slices (retrieval, distillation) depend on it being exactly right.

Embedding uses the gateway ``embed`` on the MANUAL/non-run path (``api_key=None`` ⇒ litellm's own
``.env`` ``OPENAI_API_KEY`` lookup) and meters the call OFF-LEDGER (``workflow_id=None``) — a manual
memory add is not part of any run's cost. A later slice's run-scoped distillation will thread the
run owner's BYOK key + attribute to the run.
"""

import uuid
from typing import Literal

from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingRequest, embed
from tvashtr.metering import record_embedding_cost
from tvashtr.models import NodeMemory

MemoryTier = Literal["account", "repo", "node"]


class InvalidTierError(ValueError):
    """A memory with ``node_id`` set but ``repo_key`` NULL — an invalid tier (a node-tier fact must
    name the repo it belongs to). The API rejects it 422."""


def is_valid_tier(repo_key: str | None, node_id: uuid.UUID | None) -> bool:
    """True unless the one invalid combination — ``node_id`` set with ``repo_key`` NULL."""
    return not (repo_key is None and node_id is not None)


def memory_tier(repo_key: str | None, node_id: uuid.UUID | None) -> MemoryTier:
    """Derive a memory row's tier from which scoping columns are set (pure).

    * ``repo_key`` NULL, ``node_id`` NULL → ``"account"`` (cross-repo prefs for the owner).
    * ``repo_key`` SET,  ``node_id`` NULL → ``"repo"`` (shared across every node on that repo).
    * ``repo_key`` SET,  ``node_id`` SET  → ``"node"`` (only that authored origin node).
    * ``repo_key`` NULL, ``node_id`` SET  → raises :class:`InvalidTierError`.
    """
    if repo_key is None and node_id is not None:
        raise InvalidTierError("node_id set without repo_key (a node-tier memory needs a repo_key)")
    if node_id is not None:
        return "node"
    if repo_key is not None:
        return "repo"
    return "account"


MemoryPolarity = Literal["require", "prefer", "allow", "context", "avoid", "forbid"]

# The 6 polarity values (M-memory S1b) — a fact's directive FORCE, RFC-2119-grounded:
#   require = MUST (hard positive)        prefer  = SHOULD (soft positive)
#   allow   = MAY (explicitly permitted)  context = neutral fact, no directive (the DEFAULT)
#   avoid   = SHOULD NOT (soft negative)  forbid  = MUST NOT (hard negative)
_POLARITIES: frozenset[str] = frozenset(MemoryPolarity.__args__)


class InvalidPolarityError(ValueError):
    """A memory ``polarity`` outside the 6-value taxonomy
    (``require``/``prefer``/``allow``/``context``/``avoid``/``forbid``). The API rejects it 422 —
    mirrors :class:`InvalidTierError`."""


def is_valid_polarity(value: str | None) -> bool:
    """True iff ``value`` is one of the 6 polarity literals (``None`` / anything else ⇒ False)."""
    return value in _POLARITIES


def _validate_polarity(value: str) -> None:
    """Raise :class:`InvalidPolarityError` unless ``value`` is a valid polarity. Called up front so
    an invalid polarity is rejected BEFORE any embedding spend — same ordering as the tier check."""
    if not is_valid_polarity(value):
        raise InvalidPolarityError(
            f"invalid polarity {value!r} (must be one of {sorted(_POLARITIES)})"
        )


def _parse_uuid(value: str | None) -> uuid.UUID | None:
    """Parse a uuid string, returning ``None`` on anything malformed/absent (the caller 404s)."""
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _embed_content(content: str) -> list[float] | None:
    """Embed one memory's content via the gateway (manual path → ``api_key=None`` → ``.env``) and
    meter the call OFF-LEDGER. Returns the 1536-float vector (or ``None`` if the provider returned
    no data). A gateway failure propagates (the router surfaces a clean 5xx)."""
    settings = get_settings()
    result = embed(EmbeddingRequest(model=settings.embedding_model, input=[content], api_key=None))
    record_embedding_cost(
        workflow_id=None,  # off-ledger: a manual memory embed is not part of any run's cost
        idempotency_key=f"memory-embed:{uuid.uuid4().hex}",
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        total_tokens=result.total_tokens,
        cost_usd=result.cost_usd,
    )
    return result.vectors[0] if result.vectors else None


def _to_dict(row: NodeMemory) -> dict:
    """A memory row as the API returns it — the derived ``tier`` + ``embedding_dim`` (the vector's
    length, NOT the 1536 raw floats — too heavy + not needed by any caller)."""
    embedding = row.embedding
    return {
        "id": str(row.id),
        "content": row.content,
        "polarity": row.polarity,
        "repo_key": row.repo_key,
        "node_id": str(row.node_id) if row.node_id is not None else None,
        "tier": memory_tier(row.repo_key, row.node_id),
        "pinned": row.pinned,
        "status": row.status,
        "confirmation_count": row.confirmation_count,
        "source_run_id": row.source_run_id,
        "source_invocation_id": row.source_invocation_id,
        "embedding_dim": (len(embedding) if embedding is not None else None),
        "valid_from": row.valid_from.isoformat() if row.valid_from else None,
        "invalid_at": row.invalid_at.isoformat() if row.invalid_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def create_memory(
    owner_id: uuid.UUID,
    *,
    content: str,
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
    pinned: bool = False,
    polarity: str = "context",
) -> dict:
    """Create one owner-scoped memory: validate the tier + polarity, embed the content, store the
    row (``status='active'``, ``confirmation_count=1``). Raises :class:`InvalidTierError` /
    :class:`InvalidPolarityError` — both BEFORE spending an embedding call."""
    memory_tier(repo_key, node_id)  # validate the tier up front (raises on the invalid combo)
    _validate_polarity(polarity)  # and the polarity — BEFORE any embedding spend
    vector = _embed_content(content)
    with session_scope() as session:
        row = NodeMemory(
            owner_id=owner_id,
            repo_key=repo_key,
            node_id=node_id,
            content=content,
            embedding=vector,
            pinned=pinned,
            status="active",
            polarity=polarity,
        )
        session.add(row)
        session.flush()
        session.refresh(row)
        return _to_dict(row)


def list_memories(
    owner_id: uuid.UUID,
    *,
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
    include_superseded: bool = False,
    status: str | None = None,
) -> list[dict]:
    """List the owner's memories, oldest first. Owner-scoped ALWAYS. Filters are plain column
    matches: ``repo_key`` ⇒ that repo's rows (repo- AND node-tier), ``node_id`` ⇒ that node's rows.

    M-memory S4: an explicit ``status`` (e.g. ``pending_review`` / ``rejected``)
    returns EXACTLY that
    status — the surface the review UI (S5) fetches the quarantined + tombstoned rows through. When
    ``status`` is omitted the pre-S4 default holds: active-only unless ``include_superseded``."""
    with session_scope() as session:
        stmt = select(NodeMemory).where(NodeMemory.owner_id == owner_id)
        if repo_key is not None:
            stmt = stmt.where(NodeMemory.repo_key == repo_key)
        if node_id is not None:
            stmt = stmt.where(NodeMemory.node_id == node_id)
        if status is not None:
            stmt = stmt.where(NodeMemory.status == status)  # explicit filter wins over the default
        elif not include_superseded:
            stmt = stmt.where(NodeMemory.status == "active")
        stmt = stmt.order_by(NodeMemory.created_at, NodeMemory.id)
        rows = session.execute(stmt).scalars().all()
        return [_to_dict(r) for r in rows]


def get_owned_memory(owner_id: uuid.UUID, memory_id: str) -> dict | None:
    """One of the owner's memories by id, or ``None`` (unknown id / malformed / not the owner's)."""
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == mid, NodeMemory.owner_id == owner_id)
        ).scalar_one_or_none()
        return _to_dict(row) if row is not None else None


def update_memory(
    owner_id: uuid.UUID,
    memory_id: str,
    *,
    content: str | None = None,
    pinned: bool | None = None,
    polarity: str | None = None,
) -> dict | None:
    """Edit the owner's memory: RE-embed when ``content`` actually changes; set ``pinned`` /
    ``polarity`` when given. A polarity-only (or pin-only) change NEVER re-embeds — only a real
    ``content`` change does. Owner-scoped — returns ``None`` (⇒ 404) unless it is the owner's row.
    Raises :class:`InvalidPolarityError` on an invalid polarity (validated up front)."""
    if polarity is not None:
        _validate_polarity(polarity)  # reject an invalid polarity BEFORE the lookup / any spend
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == mid, NodeMemory.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        if content is not None and content != row.content:
            row.content = content
            row.embedding = _embed_content(content)  # re-embed on a real content change
        if pinned is not None:
            row.pinned = pinned
        if polarity is not None:
            row.polarity = polarity  # a polarity-only change does NOT touch the embedding
        session.flush()
        session.refresh(row)
        return _to_dict(row)


def set_pinned(owner_id: uuid.UUID, memory_id: str, pinned: bool) -> dict | None:
    """Pin/unpin — a ``pinned``-only update (never re-embeds). Owner-scoped (``None`` ⇒ 404)."""
    return update_memory(owner_id, memory_id, pinned=pinned)


def delete_memory(owner_id: uuid.UUID, memory_id: str) -> bool:
    """Hard-delete the owner's memory (a user delete is a real delete — supersession via
    ``invalid_at`` is S2's, distinct). Owner-scoped + idempotent: returns True if a row was deleted,
    False if nothing of the OWNER's was deletable (so another owner's row is never touched)."""
    mid = _parse_uuid(memory_id)
    if mid is None:
        return False
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == mid, NodeMemory.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)
        return True
