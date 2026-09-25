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

import re
import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import exists, func, or_, select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingRequest, embed
from tvashtr.metering import record_embedding_cost
from tvashtr.models import AgentInvocation, AgentNode, NodeMemory, Run, TeamGraph

MemoryTier = Literal["account", "repo", "node"]


class InvalidTierError(ValueError):
    """A memory scope that cannot be resolved — e.g. a scope change to Repo on a memory with no
    repo, or to Agent on a memory with no agent. The API rejects it 422 with the message as-is."""


class InvalidScopeError(InvalidTierError):
    """An unknown ``scope`` value, or a ``repo_key`` sent without a ``scope`` (422)."""


def is_valid_tier(repo_key: str | None, node_id: uuid.UUID | None) -> bool:
    """Every combination of ``repo_key`` / ``node_id`` is a valid tier. The node-only tier
    (``node_id`` set, ``repo_key`` NULL — an agent's "Not repo-specific" note) is allowed since the
    revamp; kept for callers that still ask."""
    memory_tier(repo_key, node_id)
    return True


def memory_tier(repo_key: str | None, node_id: uuid.UUID | None) -> MemoryTier:
    """Derive a memory row's tier from which scoping columns are set (pure).

    * ``repo_key`` NULL, ``node_id`` NULL → ``"account"`` (cross-repo prefs for the owner).
    * ``repo_key`` SET,  ``node_id`` NULL → ``"repo"`` (shared across every node on that repo).
    * ``node_id`` SET → ``"node"`` (only that authored origin node) — on that repo when
      ``repo_key`` is set, or on every repo when it is NULL (the node-only, "Not repo-specific"
      tier).
    """
    if node_id is not None:
        return "node"
    if repo_key is not None:
        return "repo"
    return "account"


# A hosted run works in a per-run clone ``<repo>/.tvashtr_clones/<run_id>``; a key that still
# carries this marker (a legacy row) is labelled by the repo directory in front of it.
_CLONES_MARKER = "/.tvashtr_clones/"
_WINDOWS_PATH = re.compile(r"^[A-Za-z]:/")


def repo_key_for_run(github_repo: str | None, repo_path: str | None) -> str | None:
    """The memory ``repo_key`` for a run: the GitHub ``owner/name`` for a hosted run, else the local
    ``repo_path`` (``None`` for a greenfield run). Hosted runs work in a per-run clone directory, so
    keying by ``repo_path`` gave every run a unique key and repo memories never carried over. Every
    memory write site (distillation, agent-remember) and run-time retrieval use this one rule."""
    return github_repo or repo_path or None


def repo_label(repo_key: str | None) -> str | None:
    """A readable label for a ``repo_key``: a GitHub ``owner/name`` as-is; a filesystem path by its
    last directory (the repo directory in front of a ``/.tvashtr_clones/<run>`` suffix)."""
    if not repo_key:
        return None
    key = repo_key.replace("\\", "/")
    if _CLONES_MARKER in key:
        key = key.split(_CLONES_MARKER, 1)[0]
    if key.startswith(("/", "~", "./")) or _WINDOWS_PATH.match(key):
        base = key.rstrip("/").rsplit("/", 1)[-1]
        return base or repo_key
    return repo_key


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


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _to_dict(row: NodeMemory) -> dict:
    """A memory row as the API returns it — the derived ``tier`` + ``embedding_dim`` (the vector's
    length, NOT the 1536 raw floats — too heavy + not needed by any caller). Plain columns only;
    :func:`_enrich` adds the joined ``agent`` / ``source`` / ``source_iteration`` for API reads."""
    embedding = row.embedding
    return {
        "id": str(row.id),
        "content": row.content,
        "polarity": row.polarity,
        "repo_key": row.repo_key,
        "repo_label": repo_label(row.repo_key),
        "node_id": str(row.node_id) if row.node_id is not None else None,
        "tier": memory_tier(row.repo_key, row.node_id),
        "pinned": row.pinned,
        "status": row.status,
        "confirmation_count": row.confirmation_count,
        "source_run_id": row.source_run_id,
        "source_invocation_id": row.source_invocation_id,
        "source_node_id": str(row.source_node_id) if row.source_node_id is not None else None,
        "superseded_by": str(row.superseded_by) if row.superseded_by is not None else None,
        "embedding_dim": (len(embedding) if embedding is not None else None),
        "valid_from": _iso(row.valid_from),
        "invalid_at": _iso(row.invalid_at),
        "edited_at": _iso(row.edited_at),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


# The run title shown in provenance ("From run “…”") is the run idea, capped.
_RUN_TITLE_CHARS = 120


def _manual_source() -> dict:
    return {
        "kind": "manual",
        "run_id": None,
        "run_title": None,
        "run_status": None,
        "run_succeeded": None,
        "round": None,
        "agent_role": None,
        "team_name": None,
        "node_id": None,
    }


def _enrich(session, owner_id: uuid.UUID, items: list[dict]) -> list[dict]:
    """Add the joined provenance to serialized memories, in at most THREE batched queries whatever
    the list length (no N+1):

    * ``agent`` — the agent a node-tier memory is scoped to (``node_id``):
      ``{node_id, role_name, title, team_id, team_name}``; ``None`` for account/repo memories. A
      dangling or foreign ``node_id`` keeps ``node_id`` with every other field ``None``.
    * ``source`` — ``{kind: "run"|"manual", run_id, run_title, run_status, run_succeeded, round,
      agent_role, team_name, node_id}``: the run that taught it (owner-scoped), the round (the
      teaching invocation's iteration) and the agent that learned it (``source_node_id``).
    * ``source_iteration`` — the same round, top-level (``None`` when unknown).

    Nodes resolve only inside teams the owner owns, or run snapshots of the owner's runs, so a
    memory can never reveal another account's agent or team names."""
    run_ids: set[uuid.UUID] = set()
    inv_ids: set[int] = set()
    for it in items:
        rid = _parse_uuid(it.get("source_run_id"))
        if rid is not None:
            run_ids.add(rid)
        if it.get("source_invocation_id") is not None:
            inv_ids.add(int(it["source_invocation_id"]))

    runs: dict[str, dict] = {}
    if run_ids:
        team = TeamGraph.__table__.alias("run_team")
        rows = session.execute(
            select(Run.id, Run.idea, Run.status, team.c.name)
            .outerjoin(team, team.c.id == func.coalesce(Run.library_team_id, Run.team_graph_id))
            .where(Run.id.in_(run_ids), Run.owner_id == owner_id)
        ).all()
        for rid, idea, status, team_name in rows:
            runs[str(rid)] = {"idea": idea, "status": status, "team_name": team_name}

    invocations: dict[int, tuple[str, int, uuid.UUID]] = {}
    if inv_ids:
        rows = session.execute(
            select(
                AgentInvocation.id,
                AgentInvocation.run_id,
                AgentInvocation.iteration,
                AgentInvocation.node_id,
            ).where(AgentInvocation.id.in_(inv_ids))
        ).all()
        for iid, run_id, iteration, node_id in rows:
            if run_id in runs:  # only invocations of the owner's runs
                invocations[iid] = (run_id, iteration, node_id)

    node_ids: set[uuid.UUID] = {inv[2] for inv in invocations.values()}
    for it in items:
        for key in ("node_id", "source_node_id"):
            nid = _parse_uuid(it.get(key))
            if nid is not None:
                node_ids.add(nid)
    nodes: dict[uuid.UUID, dict] = {}
    if node_ids:
        owners_run_on_team = exists().where(
            Run.team_graph_id == TeamGraph.id, Run.owner_id == owner_id
        )
        rows = session.execute(
            select(
                AgentNode.id, AgentNode.role_name, AgentNode.config, TeamGraph.id, TeamGraph.name
            )
            .join(TeamGraph, TeamGraph.id == AgentNode.team_graph_id)
            .where(
                AgentNode.id.in_(node_ids),
                or_(TeamGraph.owner_id == owner_id, owners_run_on_team),
            )
        ).all()
        for nid, role, config, team_id, team_name in rows:
            title = config.get("title") if isinstance(config, dict) else None
            nodes[nid] = {
                "role_name": role,
                "title": title if isinstance(title, str) and title.strip() else None,
                "team_id": str(team_id),
                "team_name": team_name,
            }

    out: list[dict] = []
    for it in items:
        agent = None
        scoped = _parse_uuid(it.get("node_id"))
        if scoped is not None:
            info = nodes.get(scoped, {})
            agent = {
                "node_id": str(scoped),
                "role_name": info.get("role_name"),
                "title": info.get("title"),
                "team_id": info.get("team_id"),
                "team_name": info.get("team_name"),
            }

        round_no: int | None = None
        run_uuid = _parse_uuid(it.get("source_run_id"))
        if it.get("source_run_id"):
            run = runs.get(str(run_uuid)) if run_uuid is not None else None
            learner = _parse_uuid(it.get("source_node_id"))
            inv = invocations.get(it.get("source_invocation_id") or -1)
            if inv is not None and inv[0] == str(run_uuid):
                round_no = inv[1]
                if learner is None:
                    learner = inv[2]
            learner_info = nodes.get(learner, {}) if learner is not None else {}
            source = {
                "kind": "run",
                "run_id": it.get("source_run_id"),
                "run_title": ((run["idea"] or "")[:_RUN_TITLE_CHARS] or None) if run else None,
                "run_status": run["status"] if run else None,
                "run_succeeded": (run["status"] == "completed") if run else None,
                "round": round_no,
                "agent_role": learner_info.get("role_name"),
                "team_name": run["team_name"] if run else None,
                "node_id": it.get("source_node_id"),
            }
        else:
            source = _manual_source()
        out.append({**it, "agent": agent, "source": source, "source_iteration": round_no})
    return out


def enrich_memories(owner_id: uuid.UUID, items: list[dict]) -> list[dict]:
    """:func:`_enrich` in its own session — for callers that already closed theirs."""
    if not items:
        return []
    with session_scope() as session:
        return _enrich(session, owner_id, items)


def create_memory(
    owner_id: uuid.UUID,
    *,
    content: str,
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
    pinned: bool = False,
    polarity: str = "context",
) -> dict:
    """Create one owner-scoped memory: validate the polarity, embed the content, store the row
    (``status='active'``, ``confirmation_count=1``). Every tier is valid, including the node-only
    one (``node_id`` without ``repo_key``). Raises :class:`InvalidPolarityError` BEFORE spending an
    embedding call."""
    memory_tier(repo_key, node_id)
    _validate_polarity(polarity)  # BEFORE any embedding spend
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
        return _enrich(session, owner_id, [_to_dict(row)])[0]


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
        return _enrich(session, owner_id, [_to_dict(r) for r in rows])


def get_owned_memory(owner_id: uuid.UUID, memory_id: str) -> dict | None:
    """One of the owner's memories by id, or ``None`` (unknown id / malformed / not the owner's)."""
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == mid, NodeMemory.owner_id == owner_id)
        ).scalar_one_or_none()
        return _enrich(session, owner_id, [_to_dict(row)])[0] if row is not None else None


_SCOPES = ("account", "repo", "agent")
# The tier each scope must resolve to (checked through :func:`memory_tier`).
_SCOPE_TIER: dict[str, MemoryTier] = {"account": "account", "repo": "repo", "agent": "node"}
NO_REPO_MESSAGE = "This memory has no repo to scope to."
NO_AGENT_MESSAGE = "This memory has no agent to scope to."
BAD_SCOPE_MESSAGE = "scope must be one of account, repo, agent"
REPO_KEY_NEEDS_SCOPE_MESSAGE = "Send a scope with repo_key."
UNSET: object = object()  # "repo_key was not sent" (distinct from an explicit null)


def _source_run_repo_key(session, owner_id: uuid.UUID, row: NodeMemory) -> str | None:
    """The repo of the owner's run that taught ``row`` (``None`` for a manual memory)."""
    rid = _parse_uuid(row.source_run_id)
    if rid is None:
        return None
    run = session.execute(
        select(Run.github_repo, Run.repo_path).where(Run.id == rid, Run.owner_id == owner_id)
    ).one_or_none()
    return repo_key_for_run(run[0], run[1]) if run is not None else None


def _resolve_scope(
    session, owner_id: uuid.UUID, row: NodeMemory, scope: str, repo_key: object
) -> tuple[str | None, uuid.UUID | None]:
    """Map a requested ``scope`` to concrete ``(repo_key, node_id)`` for ``row``:

    * ``account`` → ``(NULL, NULL)``.
    * ``repo`` → the sent ``repo_key``, else the row's, else its source run's repo; no agent.
      :data:`NO_REPO_MESSAGE` when none is known.
    * ``agent`` → the row's agent (``node_id``, else the agent that learned it); the repo stays the
      row's own unless ``repo_key`` is sent (an explicit ``null`` makes it "Not repo-specific").
      :data:`NO_AGENT_MESSAGE` when no agent is known.

    The result is validated through :func:`memory_tier` (it must be the scope's tier)."""
    sent = None if repo_key is UNSET or repo_key is None else (str(repo_key).strip() or None)
    if scope == "account":
        new_repo, new_node = None, None
    elif scope == "repo":
        new_repo = sent or row.repo_key or _source_run_repo_key(session, owner_id, row)
        if new_repo is None:
            raise InvalidTierError(NO_REPO_MESSAGE)
        new_node = None
    else:  # agent
        new_node = row.node_id or row.source_node_id
        if new_node is None:
            raise InvalidTierError(NO_AGENT_MESSAGE)
        new_repo = row.repo_key if repo_key is UNSET else sent
    if memory_tier(new_repo, new_node) != _SCOPE_TIER[scope]:  # defensive: never mis-scope
        raise InvalidTierError(NO_REPO_MESSAGE if scope == "repo" else NO_AGENT_MESSAGE)
    return new_repo, new_node


def update_memory(
    owner_id: uuid.UUID,
    memory_id: str,
    *,
    content: str | None = None,
    pinned: bool | None = None,
    polarity: str | None = None,
    scope: str | None = None,
    repo_key: object = UNSET,
) -> dict | None:
    """Edit the owner's memory: RE-embed when ``content`` actually changes; set ``pinned`` /
    ``polarity`` when given; move it to another ``scope`` (``account`` / ``repo`` / ``agent``, see
    :func:`_resolve_scope`; ``repo_key`` only travels with a ``scope``). ``edited_at`` is stamped
    when the content, force or scope really changes — never on a pin. A polarity-only (or pin-only)
    change NEVER re-embeds. Owner-scoped — returns ``None`` (⇒ 404) unless it is the owner's row.
    Raises :class:`InvalidPolarityError` / :class:`InvalidScopeError` up front and
    :class:`InvalidTierError` when the scope cannot be resolved — all BEFORE any embedding spend."""
    if polarity is not None:
        _validate_polarity(polarity)  # reject an invalid polarity BEFORE the lookup / any spend
    if scope is not None and scope not in _SCOPES:
        raise InvalidScopeError(BAD_SCOPE_MESSAGE)
    if scope is None and repo_key is not UNSET:
        raise InvalidScopeError(REPO_KEY_NEEDS_SCOPE_MESSAGE)
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.id == mid, NodeMemory.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        edited = False
        if scope is not None:
            new_repo, new_node = _resolve_scope(session, owner_id, row, scope, repo_key)
            if (new_repo, new_node) != (row.repo_key, row.node_id):
                row.repo_key, row.node_id = new_repo, new_node
                edited = True
        if content is not None and content != row.content:
            row.content = content
            row.embedding = _embed_content(content)  # re-embed on a real content change
            edited = True
        if pinned is not None:
            row.pinned = pinned
        if polarity is not None and polarity != row.polarity:
            row.polarity = polarity  # a polarity-only change does NOT touch the embedding
            edited = True
        if edited:
            row.edited_at = datetime.now(UTC)
        session.flush()
        session.refresh(row)
        return _enrich(session, owner_id, [_to_dict(row)])[0]


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
