"""Agentic-memory RETRIEVAL for run-time injection (M-memory S3 — the READ half).

Given a node about to execute, gather the owner's remembered facts that apply to it — **HOT** (every
pinned in-scope row, always injected) + **COLD** (a pgvector cosine top-K over the non-pinned
in-scope rows, ranked by similarity to a compact task query) — bounded by a token budget (drop the
lowest-similarity COLD first, NEVER hot). The executor folds the result into the node's compiled
instruction via ``context_compiler.compile_context(memory=…)`` and records the injected ids in the
invocation's ``context_manifest``.

Kept a SEPARATE module from ``control_plane.memory`` (the S1 CRUD service) so that service stays
import-only for S3 — S3 READS ``NodeMemory`` + reuses the gateway ``embed`` + the metering seam, it
never modifies the write path.

**Best-effort**: :func:`retrieve_for_node` never raises — any failure (a bad embed, a DB hiccup)
returns ``[]`` so a retrieval problem NEVER crashes or changes a run. The embed is INJECTED
(``embed_query``) so (a) it is called ONLY when cold candidates exist — an empty in-scope
set needs no network, keeping the offline suite + every greenfield run byte-identical — and (b) the
run path can wrap it with the run owner's key + on-run metering while unit tests inject a fake.
"""

import logging
import uuid
from collections.abc import Callable

from sqlalchemy import and_, or_, select

from tvashtr.control_plane.context_compiler import estimate_tokens
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingRequest, embed
from tvashtr.metering import record_embedding_cost
from tvashtr.models import NodeMemory

logger = logging.getLogger(__name__)

# COLD retrieval fan-in: the pgvector cosine top-K over the non-pinned in-scope rows. 8 is a modest
# starting K — enough recall for a handful of relevant lessons without flooding the instruction; the
# token budget below trims further. A documented module constant (S3 uses constants, not a setting).
COLD_TOP_K = 8

# The injected-memory token ceiling — a MODEST slice of the ~110000-token per-node input budget
# (``settings.worker_context_token_budget``): remembered lessons are terse, so ~2000 tokens (≈ 8 KB)
# comfortably holds every pinned fact + a healthy cold set — a rounding error vs the input window.
# HOT (pinned) rows are NEVER trimmed by this — only COLD is bounded (lowest-similarity
# dropped first). Tokens use the same ``len//4`` heuristic the compiler budgets with.
MEMORY_TOKEN_BUDGET = 2000

# The embed seam a caller injects: query text -> its embedding vector (or None if the provider
# returned no data). Called at most once per retrieval, and ONLY when cold candidates exist.
EmbedQuery = Callable[[str], "list[float] | None"]


def memory_query(idea: str, node_prompt: str, prd_text: str | None) -> str:
    """A compact task representation to rank COLD memories against — the run idea + this node's
    prompt + the PRD's title (its first non-blank line, capped). Deliberately NOT the compiled
    context (that would be circular — the memory part IS part of the context) and deliberately small
    (it is only a similarity probe). Pure + unit-tested."""
    parts = [idea.strip(), node_prompt.strip()]
    if prd_text:
        for raw in prd_text.splitlines():
            line = raw.strip()
            if line:
                parts.append(line[:200])  # the PRD title (first non-blank line), capped
                break
    return "\n".join(p for p in parts if p)


def _scope_filter(repo_key: str | None, authored_node_id: uuid.UUID | None):
    """The tier scope for THIS node as a SQLAlchemy predicate over ``NodeMemory`` (owner/status
    applied by the caller): **account** (``repo_key`` NULL, ``node_id`` NULL) ∪ **repo** (this
    ``repo_key``, ``node_id`` NULL) ∪ **node** (this ``repo_key`` + this authored ``node_id``) ∪
    **node-only** (``repo_key`` NULL + this authored ``node_id`` — the agent's "Not repo-specific"
    notes, which apply on every repo and on greenfield runs). A GREENFIELD run (``repo_key`` NULL)
    has no repo, so the repo and repo-bound node tiers cannot apply."""
    account = and_(NodeMemory.repo_key.is_(None), NodeMemory.node_id.is_(None))
    conds = [account]
    if authored_node_id is not None:
        conds.append(and_(NodeMemory.repo_key.is_(None), NodeMemory.node_id == authored_node_id))
    if repo_key is not None:
        conds.append(and_(NodeMemory.repo_key == repo_key, NodeMemory.node_id.is_(None)))
        if authored_node_id is not None:
            conds.append(
                and_(NodeMemory.repo_key == repo_key, NodeMemory.node_id == authored_node_id)
            )
    return or_(*conds) if len(conds) > 1 else account


def _fact(row: NodeMemory) -> dict:
    """A retrieved fact as the compiler + manifest consume it — ``id`` as a str (JSON-safe
    for the DBOS step checkpoint + the ``context_manifest`` JSONB)."""
    return {"id": str(row.id), "polarity": row.polarity, "content": row.content}


def _apply_budget(hot: list[dict], cold: list[dict], token_budget: int) -> list[dict]:
    """HOT first (all kept — NEVER dropped), then COLD best-first until the token budget is reached;
    the lowest-similarity COLD tail is dropped. ``cold`` MUST already be similarity-ordered (most
    similar first). Tokens estimated on each fact's content (the same ``len//4`` heuristic)."""
    result = list(hot)
    used = sum(estimate_tokens(f["content"]) for f in hot)
    for fact in cold:  # best-first: the first over-budget fact drops it + all lower-similarity ones
        cost = estimate_tokens(fact["content"])
        if used + cost > token_budget:
            break
        result.append(fact)
        used += cost
    return result


def retrieve_for_node(
    owner_id: uuid.UUID,
    repo_key: str | None,
    authored_node_id: uuid.UUID | None,
    query: str,
    *,
    embed_query: EmbedQuery,
    k: int = COLD_TOP_K,
    token_budget: int = MEMORY_TOKEN_BUDGET,
) -> list[dict]:
    """Retrieve this node's remembered facts for injection — HOT (pinned in-scope, always) + COLD
    (pgvector cosine top-K of the non-pinned in-scope rows, ranked to ``query``), bounded by
    ``token_budget`` (drop lowest-similarity COLD first, never hot). Owner + ``active``-scoped,
    tier-scoped (:func:`_scope_filter`). Returns ``[{id, polarity, content}]`` (``id`` as str), HOT
    then COLD-by-similarity.

    **Best-effort**: never raises. A failing ``embed_query`` (a provider error, or an owner with no
    key) keeps every HOT fact and ranks COLD by confirmations then recency instead of similarity —
    pinned notes always reach the agent. Any other failure returns ``[]`` (a retrieval problem must
    never crash or change a run). ``embed_query`` is called at most once, ONLY when cold
    candidates exist, so an empty in-scope set (every greenfield run + the whole offline suite)
    needs no network and injects nothing (byte-identical to no-memory)."""
    try:
        scope = _scope_filter(repo_key, authored_node_id)
        # 1. HOT — every pinned in-scope row (materialised to plain dicts inside the session). Also
        #    probe whether any COLD candidate (non-pinned, embedded) exists — only then do we embed.
        with session_scope() as session:
            base = select(NodeMemory).where(
                NodeMemory.owner_id == owner_id,
                NodeMemory.status == "active",
                scope,
            )
            hot_rows = (
                session.execute(
                    base.where(NodeMemory.pinned.is_(True)).order_by(
                        NodeMemory.created_at, NodeMemory.id
                    )
                )
                .scalars()
                .all()
            )
            hot = [_fact(r) for r in hot_rows]
            has_cold = (
                session.execute(
                    base.where(
                        NodeMemory.pinned.is_(False), NodeMemory.embedding.isnot(None)
                    ).limit(1)
                ).first()
                is not None
            )
        # 2. COLD — embed the query (owner key + on-run metering live in the injected closure) and
        #    rank the non-pinned rows by cosine distance IN THE DB. Skipped when there are no
        #    candidates (no embed, no network) — what keeps the empty path inert + offline-safe.
        cold: list[dict] = []
        if has_cold:
            cold_filter = (
                NodeMemory.owner_id == owner_id,
                NodeMemory.status == "active",
                scope,
                NodeMemory.pinned.is_(False),
                NodeMemory.embedding.isnot(None),
            )
            try:
                qvec = embed_query(query)
            except Exception:  # noqa: BLE001 — a failed embed (e.g. no key) must not drop HOT
                logger.warning(
                    "memory retrieval query embed failed (owner=%s repo=%s): pinned facts kept, "
                    "cold ranked by recency",
                    owner_id,
                    repo_key,
                    exc_info=True,
                )
                with session_scope() as session:
                    recent = (
                        select(NodeMemory)
                        .where(*cold_filter)
                        .order_by(
                            NodeMemory.confirmation_count.desc(),
                            NodeMemory.created_at.desc(),
                            NodeMemory.id,
                        )
                        .limit(k)
                    )
                    cold = [_fact(r) for r in session.execute(recent).scalars().all()]
                return _apply_budget(hot, cold, token_budget)
            if qvec is not None:
                with session_scope() as session:
                    ranked = (
                        select(NodeMemory)
                        .where(*cold_filter)
                        .order_by(NodeMemory.embedding.cosine_distance(qvec))
                        .limit(k)
                    )
                    cold = [_fact(r) for r in session.execute(ranked).scalars().all()]
        return _apply_budget(hot, cold, token_budget)
    except Exception:  # noqa: BLE001 — best-effort: a retrieval failure must never crash a run
        logger.warning(
            "memory retrieval best-effort empty (owner=%s repo=%s): returning no facts",
            owner_id,
            repo_key,
            exc_info=True,
        )
        return []


def embed_query_metered(
    query: str, *, api_key: str | None, model: str, run_id: str, idempotency_key: str
) -> list[float] | None:
    """Embed ONE retrieval query through the gateway (with the run owner's ``api_key``) and record
    its cost ON the run (``workflow_id=run_id``) — the run-path ``embed_query`` closure. Unlike
    the S1 CRUD embed (off-ledger, ``.env`` key): a run-time retrieval embed is part of THAT run's
    cost. Idempotent on ``idempotency_key`` (a resumed step re-uses the recorded cost). Returns the
    query vector (or ``None`` if the provider returned no data)."""
    result = embed(EmbeddingRequest(model=model, input=[query], api_key=api_key))
    record_embedding_cost(
        workflow_id=run_id,
        idempotency_key=idempotency_key,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        total_tokens=result.total_tokens,
        cost_usd=result.cost_usd,
    )
    return result.vectors[0] if result.vectors else None
