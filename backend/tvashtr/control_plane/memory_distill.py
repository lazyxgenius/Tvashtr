"""Run-END memory distillation — the WRITE half of the agentic-memory loop (M-memory S2).

At the end of a run, :func:`distill_run` reads the run's OWN recorded trail (via ``run_explain``,
read-only) plus its terminal outcome and writes a few LABELED, durable memory facts (tier + polarity
+ provenance) into ``node_memories`` — learning from BOTH successes and failures. The whole point is
that a memory that BACKFIRES (a failed run poisoning future runs with bad "don't do X" lessons) is
worse than no memory, so FIVE anti-backfire safeguards gate every write:

1. **FAILURE-CAUSE TRIAGE** — an ENVIRONMENTAL terminal (over_budget / over_context / rate-limit /
   provider|infra|engine error / cancelled) writes ZERO negatives; only a genuinely
   agent-attributable failure (a reviewer rejection, a failing test/build visible in the trail) may.
   This kills the "a genuine error marks everything don't-do" failure mode.
2. **EVIDENCE-REQUIRED** — every ``avoid``/``forbid`` must cite a concrete failure signal or is
   dropped.
3. **FAILED RUNS PROPOSE, THEY DON'T IMPOSE** — a negative distilled from a non-success run is
   written ``status='pending_review'`` (quarantined from S3's active-only injection) until a 2nd run
   corroborates it (auto-promote) or the user confirms (S4/S5). Success/positive/neutral facts go
   ``active`` immediately.
4. **FACT CAP** — at most :data:`FACT_CAP` facts per run (a run teaches a few lessons, not fifty).
5. **SELF-CORRECTION** — consolidation supersedes a contradicted fact: a later success that
   contradicts an earlier ``avoid`` retires it.

**Extract → Consolidate.** The distiller LLM (a cheap non-reasoning model — a reasoning model
over-thinks a bounded extraction) EXTRACTS candidate facts; the CONSOLIDATION here is
CODE-authoritative — it matches each gated candidate against the owner's existing in-scope facts by
embedding cosine similarity → NOOP / confirm / supersede / add DETERMINISTICALLY (the LLM's
``op`` field is advisory). That keeps safeguards deterministic, robust to a mislabelling LLM, and
unit-testable offline.

Kept openhands-free at import; ``memory.py`` is NOT modified — S2 imports its pure helpers. The
distiller completion + the fact embeds are metered ON THE RUN (``workflow_id=run_id``) with the run
OWNER's key ("off-ledger" in ``memory.py`` = the MANUAL path; this run-scoped path attributes
to the run). BEST-EFFORT throughout — any failure is caught + logged, the run's terminal status is
never touched, and each fact write is independent (a partial write is fine).
"""

import hashlib
import json
import logging
import math
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import or_, select

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import resolve_owner_api_key
from tvashtr.control_plane.memory import _to_dict as _memory_to_dict
from tvashtr.control_plane.memory import is_valid_polarity
from tvashtr.control_plane.run_explain import build_system_prompt
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionRequest, EmbeddingRequest, complete, embed
from tvashtr.metering import record_cost, record_embedding_cost
from tvashtr.models import AgentInvocation, AgentNode, NodeMemory, Run

logger = logging.getLogger("tvashtr.control_plane.memory_distill")

# --- tunable constants (documented; the ONLY new setting is memory_distiller_model, in config) ---
FACT_CAP = 5  # layer 4: max facts written per run — a run teaches a few lessons, not fifty
# cosine >= this ⇒ "the same fact" (confirm/NOOP) or, opposite-sign, a contradiction (supersede).
# Tuned for openai/text-embedding-3-small (near-dup paraphrases ~0.85-0.95, distinct facts <~0.5).
DUP_THRESHOLD = 0.85
MAX_EXISTING_FACTS = (
    40  # cap the in-scope facts shown to the distiller / compared during consolidation
)
MAX_TRAIL_NODES = 6  # cap the nodes whose per-node run_explain trail we assemble
MAX_TRAIL_CHARS = 24000  # clip the assembled multi-node trail (matches run_explain's own bound)
MAX_OPS = 24  # cap the candidate ops parsed from the LLM before gating
DISTILLER_MAX_TOKENS = 1000

OutcomeClass = Literal["success", "environmental", "agent"]

_NEGATIVE = frozenset({"avoid", "forbid"})
_POSITIVE = frozenset({"require", "prefer", "allow"})
# force ordering for the fact cap — MUST-level first, neutral last (keep the strongest directives)
_FORCE_RANK = {"require": 0, "forbid": 0, "prefer": 1, "avoid": 1, "allow": 2, "context": 3}

# Terminal-cause markers scanned in the run's status + trail (layer 1). ENVIRONMENTAL = not the
# agent's fault (never a negative). AGENT = a genuine agent-attributable failure that MAY justify.
_ENV_MARKERS = (
    "over_budget",
    "over budget",
    "over_context",
    "over context",
    "context window",
    "rate limit",
    "rate_limit",
    "429",
    "quota",
    "timeout",
    "timed out",
    "connection",
    "unavailable",
    "provider error",
    "infra",
    "engine error",
    "engine_error",
    "cancel",
    "serializ",
    "no out-edge",
)
# NOTE: the bare run STATUS "rejected" is deliberately NOT an agent marker — a run finalizes
# ``rejected`` for a HUMAN-gate rejection too (not the agent's fault). A genuine agent rejection
# surfaces in the TRAIL as the reviewer's "changes_requested"/"review", so those catch it while
# a human gate reject (no such verdict) safely falls to ``environmental``.
_AGENT_MARKERS = (
    "changes_requested",
    "changes requested",
    "test failed",
    "tests failed",
    "failing test",
    "assertion",
    "build failed",
    "did not pass",
    "lint failed",
    "review",
)


# ------------------------------------------------------------------ pure helpers ----


def classify_terminal(status: str, reason: str) -> OutcomeClass:
    """Layer 1 — classify a run's terminal CAUSE. ``completed`` ⇒ success. Otherwise scan the reason
    blob (status + the trail's invocation outcomes/details/errors): an ENVIRONMENTAL marker ⇒
    ``environmental`` (no negatives written); an AGENT marker (reviewer rejection, failing
    test/build) ⇒ ``agent``; anything else (an unexplained failure, a plain budget cutoff) ⇒
    ``environmental`` — the SAFE default that never turns a not-the-agent's-fault failure into a
    "don't do X" lesson."""
    s = (status or "").strip().lower()
    blob = f"{s} {(reason or '').lower()}"
    if s == "completed":
        return "success"
    if any(m in blob for m in _ENV_MARKERS):
        return "environmental"
    if any(m in blob for m in _AGENT_MARKERS):
        return "agent"
    return "environmental"


def _polarity_sign(polarity: str) -> Literal["pos", "neg", "neu"]:
    """The directive SIGN of a polarity — positive / negative / neutral (``context``)."""
    if polarity in _NEGATIVE:
        return "neg"
    if polarity in _POSITIVE:
        return "pos"
    return "neu"


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two vectors (0.0 when either is empty/zero)."""
    if not a or not b:
        return 0.0
    dot = na = nb = 0.0
    for x, y in zip(a, b, strict=False):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / math.sqrt(na * nb)


def _as_list(embedding: object) -> list[float]:
    """Coerce a stored pgvector embedding (list/ndarray/None) to a plain ``list[float]``."""
    if embedding is None:
        return []
    return [float(x) for x in embedding]


def _status_for(sign: str, outcome_class: OutcomeClass) -> str:
    """Layer 3 — a negative that survived triage+evidence is ``pending_review`` unless the run
    SUCCEEDED; everything else (positives, neutral facts, a success run's negatives) is active."""
    if sign == "neg" and outcome_class != "success":
        return "pending_review"
    return "active"


# ------------------------------------------------------------------ candidate model ----


@dataclass
class _Candidate:
    content: str
    polarity: str
    sign: str
    evidence: str
    tier: str  # requested tier: account | repo | node
    node_role: str | None
    rationale: str


def _gate(ops: list[dict], outcome_class: OutcomeClass) -> list[_Candidate]:
    """Apply layers 1 (triage-drop negatives on an environmental terminal), 2 (evidence-required for
    negatives) and 4 (fact cap, highest force first) to the LLM's candidate ops."""
    cands: list[_Candidate] = []
    for op in ops:
        if not isinstance(op, dict):
            continue
        content = str(op.get("content") or "").strip()
        if not content:
            continue
        polarity = str(op.get("polarity") or "context").strip().lower()
        if not is_valid_polarity(polarity):
            polarity = "context"
        sign = _polarity_sign(polarity)
        evidence = str(op.get("evidence") or "").strip()
        if sign == "neg":
            if outcome_class == "environmental":  # layer 1: no negatives from a not-agent failure
                continue
            if not evidence:  # layer 2: an avoid/forbid MUST cite failure evidence
                continue
        tier = str(op.get("tier") or "repo").strip().lower()
        if tier not in ("account", "repo", "node"):
            tier = "repo"
        role = op.get("node_role")
        node_role = str(role).strip() if role else None
        cands.append(
            _Candidate(
                content=content[:400],
                polarity=polarity,
                sign=sign,
                evidence=evidence[:500],
                tier=tier,
                node_role=node_role,
                rationale=str(op.get("rationale") or "")[:300],
            )
        )
    cands.sort(
        key=lambda c: _FORCE_RANK.get(c.polarity, 3)
    )  # layer 4: keep the strongest directives
    return cands[:FACT_CAP]


# ------------------------------------------------------------------ trail / scope reads ----


def _failure_reason(run_id: str, status: str) -> str:
    """A bounded blob of the run's invocation outcomes/details — the raw material layer-1 triage
    scans for environmental vs agent-attributable markers (read-only)."""
    with session_scope() as session:
        rows = session.execute(
            select(
                AgentInvocation.status,
                AgentInvocation.outcome,
                AgentInvocation.outcome_detail,
            )
            .where(AgentInvocation.run_id == run_id)
            .order_by(AgentInvocation.id)
        ).all()
    bits = [status or ""]
    bits.extend(f"{st or ''} {oc or ''} {detail or ''}" for st, oc, detail in rows)
    return " | ".join(b for b in bits if b.strip())[:4000]


def _executed_node_ids(run_id: str) -> list[str]:
    """The distinct node ids that recorded an invocation in this run (read-only)."""
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentInvocation.node_id)
                .where(AgentInvocation.run_id == run_id)
                .group_by(AgentInvocation.node_id)
            )
            .scalars()
            .all()
        )
    return [str(n) for n in rows]


def _assemble_run_trail(run_id: str) -> str:
    """REUSE ``run_explain.build_system_prompt`` (read-only) per executed node → a bounded whole-run
    trail. ``run_explain`` is CALLED, never modified. Each node's trail is already clipped by
    run_explain; the concatenation is clipped again to :data:`MAX_TRAIL_CHARS`."""
    parts: list[str] = []
    for nid in _executed_node_ids(run_id)[:MAX_TRAIL_NODES]:
        try:
            parts.append(build_system_prompt(run_id=run_id, node_id=nid))
        except Exception:  # noqa: BLE001 — one node's trail failing must not sink distillation
            logger.debug("trail assembly skipped node %s run %s", nid, run_id, exc_info=True)
    return "\n\n========\n\n".join(parts)[:MAX_TRAIL_CHARS]


def _role_authored_ids(run_id: str) -> dict[str, uuid.UUID]:
    """``role_name`` → the AUTHORED origin node id (``cloned_from_node_id``, else the node's own id)
    for each node that ran. Node-tier facts attach to the authored id so they survive
    the node being deleted + re-added (mirrors why ``cloned_from_node_id`` is a plain uuid)."""
    out: dict[str, uuid.UUID] = {}
    with session_scope() as session:
        rows = session.execute(
            select(AgentNode.role_name, AgentNode.id, AgentNode.cloned_from_node_id)
            .join(AgentInvocation, AgentInvocation.node_id == AgentNode.id)
            .where(AgentInvocation.run_id == run_id)
            .distinct()
        ).all()
    for role, nid, cloned in rows:
        if role and role not in out:
            out[role] = cloned or nid
    return out


@dataclass
class _Fact:
    id: uuid.UUID
    content: str
    polarity: str
    status: str
    repo_key: str | None
    node_id: uuid.UUID | None


def _fetch_in_scope(owner_id: uuid.UUID, repo_key: str | None) -> list[_Fact]:
    """The owner's active + pending in-scope facts (account ∪ this-repo), capped — shown to the
    distiller as the existing store to reference for UPDATE/DELETE/NOOP (read-only)."""
    with session_scope() as session:
        stmt = select(NodeMemory).where(
            NodeMemory.owner_id == owner_id,
            NodeMemory.status.in_(("active", "pending_review")),
        )
        if repo_key is not None:
            stmt = stmt.where(or_(NodeMemory.repo_key.is_(None), NodeMemory.repo_key == repo_key))
        else:
            stmt = stmt.where(NodeMemory.repo_key.is_(None))  # greenfield ⇒ account-tier only
        rows = (
            session.execute(stmt.order_by(NodeMemory.created_at).limit(MAX_EXISTING_FACTS))
            .scalars()
            .all()
        )
        return [_Fact(r.id, r.content, r.polarity, r.status, r.repo_key, r.node_id) for r in rows]


# ------------------------------------------------------------------ distiller LLM ----


_SYSTEM = """You distil DURABLE, reusable lessons from ONE run of an AI agent team that took a
software idea toward a shipped change. You learn from BOTH successes and failures.

Return ONLY a JSON object of the form {"facts": [ ... ]}. Each fact object:
  "op": "ADD" | "UPDATE" | "DELETE" | "NOOP" (ADD a new lesson; UPDATE re-affirms one; DELETE when a
        new result contradicts an existing fact; NOOP if already captured)
  "content": a SHORT, self-contained imperative lesson (<=160 chars); no run ids or trivia.
  "tier": "account" (a cross-repo preference of THIS user) | "repo" (about THIS repository) |
          "node" (specific to one agent node)
  "node_role": REQUIRED only when tier="node" — the role_name of the node it applies to
  "polarity": the DIRECTIVE FORCE (RFC-2119):
      "require"=MUST do, "prefer"=SHOULD do, "allow"=MAY / explicitly permitted,
      "context"=neutral fact, no directive (DEFAULT), "avoid"=SHOULD NOT, "forbid"=MUST NOT
  "evidence": REQUIRED for every "avoid"/"forbid" — quote the concrete failure signal from the
      trail (a reviewer's reason, a failing test line, an error). Omit for positive/neutral facts.
  "rationale": one clause on why this lesson is durable.

Principles:
- Prefer OUTCOME-CONDITIONED DO/DON'T PAIRING: when the trail shows a mistake AND its fix, emit
  BOTH the negative (what failed) and the matching positive (what worked).
- Emit "avoid"/"forbid" ONLY for failures genuinely the AGENT's doing that you can cite evidence
  for. NEVER blame environmental failures (budget, context-window, rate-limit, provider or infra
  errors, cancellation).
- Emit at most 5 of the highest-signal, durable lessons. A run that SHIPPED always taught something
  worth remembering — always capture at least one durable fact (a neutral "context" fact about the
  task, repo, or approach if no stronger directive applies). Return {"facts": []} ONLY if the trail
  is genuinely empty."""


def _build_messages(
    *,
    idea: str,
    outcome_class: OutcomeClass,
    status: str,
    trail: str,
    existing: list[_Fact],
) -> list[dict[str, str]]:
    ex = (
        "\n".join(f"- [{f.id}] ({f.polarity}/{f.status}) {f.content}" for f in existing)
        if existing
        else "(none)"
    )
    user = (
        f"RUN OUTCOME: {outcome_class} (terminal status: {status})\n"
        f"IDEA: {idea}\n\n"
        f"EXISTING FACTS (owner+repo scope — reference for UPDATE/DELETE/NOOP):\n{ex}\n\n"
        f"RUN TRAIL (bounded, per-node record):\n{trail or '(no trail recorded)'}\n\n"
        "Return the JSON object now."
    )
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _loads_lenient(raw: str) -> object:
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):  # salvage the outermost object/array span
        i, j = raw.find(open_c), raw.rfind(close_c)
        if 0 <= i < j:
            try:
                return json.loads(raw[i : j + 1])
            except (ValueError, TypeError):
                continue
    return None


def _parse_ops(text: str) -> list[dict]:
    """Defensively extract the candidate ops from the distiller's text (fenced or bare JSON; a
    ``{"facts": [...]}`` object or a bare array). Any parse failure ⇒ ``[]`` (best-effort)."""
    if not text:
        return []
    raw = text.strip()
    m = _JSON_FENCE.search(raw)
    if m:
        raw = m.group(1).strip()
    obj = _loads_lenient(raw)
    facts = obj.get("facts") if isinstance(obj, dict) else obj
    if not isinstance(facts, list):
        return []
    return [f for f in facts if isinstance(f, dict)][:MAX_OPS]


def _run_distiller(
    *,
    idea: str,
    outcome_class: OutcomeClass,
    status: str,
    trail: str,
    existing: list[_Fact],
    run_id: str,
    owner_key: str | None,
    model: str,
) -> list[dict]:
    """Call the distiller LLM, meter it ON THE RUN, return the parsed candidate ops."""
    messages = _build_messages(
        idea=idea, outcome_class=outcome_class, status=status, trail=trail, existing=existing
    )
    result = complete(
        CompletionRequest(
            model=model,
            messages=messages,
            temperature=0.0,
            max_tokens=DISTILLER_MAX_TOKENS,
            api_key=owner_key,
        )
    )
    record_cost(result, workflow_id=run_id, idempotency_key=f"{run_id}:memory-distill")
    return _parse_ops(result.text)


def _embed_on_run(
    content: str, *, run_id: str, owner_key: str | None, model: str
) -> list[float] | None:
    """Embed one candidate's content with the RUN OWNER's key, metered ON THE RUN."""
    result = embed(EmbeddingRequest(model=model, input=[content], api_key=owner_key))
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    record_embedding_cost(
        workflow_id=run_id,
        idempotency_key=f"{run_id}:memory-distill-embed:{digest}",
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        total_tokens=result.total_tokens,
        cost_usd=result.cost_usd,
    )
    return result.vectors[0] if result.vectors else None


# ------------------------------------------------------------------ consolidation + write ----


def _resolve_scope(
    cand: _Candidate, run_repo_key: str | None, role_map: dict[str, uuid.UUID]
) -> tuple[str | None, uuid.UUID | None]:
    """Map a candidate's requested tier to concrete (repo_key, node_id). A greenfield run
    (repo_path NULL) has no repo identity ⇒ account-tier only; unknown node_role ⇒ repo-tier."""
    if cand.tier == "account" or run_repo_key is None:
        return None, None
    if cand.tier == "node":
        nid = role_map.get(cand.node_role or "")
        return (run_repo_key, nid) if nid is not None else (run_repo_key, None)
    return run_repo_key, None


def _same_scope(
    session, owner_id: uuid.UUID, repo_key: str | None, node_id: uuid.UUID | None
) -> list[NodeMemory]:
    """The owner's active + pending facts at the EXACT (repo_key, node_id) scope of a candidate — so
    a repo fact never supersedes an account fact."""
    stmt = select(NodeMemory).where(
        NodeMemory.owner_id == owner_id,
        NodeMemory.status.in_(("active", "pending_review")),
    )
    stmt = (
        stmt.where(NodeMemory.repo_key == repo_key)
        if repo_key is not None
        else stmt.where(NodeMemory.repo_key.is_(None))
    )
    stmt = (
        stmt.where(NodeMemory.node_id == node_id)
        if node_id is not None
        else stmt.where(NodeMemory.node_id.is_(None))
    )
    return list(session.execute(stmt).scalars().all())


def _insert(
    session,
    cand: _Candidate,
    *,
    repo_key: str | None,
    node_id: uuid.UUID | None,
    status: str,
    vector: list[float] | None,
    owner_id: uuid.UUID,
    run_id: str,
) -> NodeMemory:
    row = NodeMemory(
        owner_id=owner_id,
        repo_key=repo_key,
        node_id=node_id,
        content=cand.content,
        embedding=vector,
        polarity=cand.polarity,
        status=status,
        confirmation_count=1,
        source_run_id=run_id,
        pinned=False,
    )
    session.add(row)
    return row


def _apply_one(
    cand: _Candidate,
    *,
    repo_key: str | None,
    node_id: uuid.UUID | None,
    status: str,
    vector: list[float] | None,
    owner_id: uuid.UUID,
    run_id: str,
) -> dict | None:
    """Consolidate ONE gated candidate against the store + write it, in its own session (isolated).

    Code-authoritative consolidation by embedding cosine (>= :data:`DUP_THRESHOLD`):
    * SAME sign ⇒ CONFIRM: bump ``confirmation_count``; PROMOTE a corroborated pending fact
      (from a DIFFERENT run) to active (layer 3) — no dup row (NOOP). ONLY a same-sign candidate
      corroborates; a neutral or opposite one never promotes a quarantined negative (anti-backfire);
    * OPPOSITE sign ({pos, neg}) + the match is ``active`` ⇒ SUPERSEDE it (``invalid_at`` +
      ``superseded_by`` + ``status='superseded'``) and ADD the new fact (layer 5);
    * otherwise (neutral vs a directive, or a contradiction of a NON-active fact) ⇒ ADD.
    """
    now = datetime.now(UTC)
    with session_scope() as session:
        existing = _same_scope(session, owner_id, repo_key, node_id)
        best: NodeMemory | None = None
        best_sim = 0.0
        if vector is not None:
            for row in existing:
                sim = _cosine(vector, _as_list(row.embedding))
                if sim > best_sim:
                    best_sim, best = sim, row

        if best is not None and best_sim >= DUP_THRESHOLD:
            best_sign = _polarity_sign(best.polarity)
            if cand.sign == best_sign:
                # SAME sign ⇒ genuine corroboration (a real dup): bump confirmation_count; PROMOTE a
                # corroborated pending fact (from a DIFFERENT run) to active (layer 3). No new row
                # (NOOP). Only a SAME-sign candidate corroborates — never a neutral/opposite one.
                best.confirmation_count = (best.confirmation_count or 1) + 1
                promoted = False
                if best.status == "pending_review" and best.source_run_id != run_id:
                    best.status = "active"
                    promoted = True
                session.flush()
                session.refresh(best)
                return {**_memory_to_dict(best), "action": "promote" if promoted else "confirm"}

            if {cand.sign, best_sign} == {"pos", "neg"} and best.status == "active":
                # OPPOSITE directive vs an ACTIVE fact ⇒ layer 5: retire it + add the new one.
                new = _insert(
                    session,
                    cand,
                    repo_key=repo_key,
                    node_id=node_id,
                    status=status,
                    vector=vector,
                    owner_id=owner_id,
                    run_id=run_id,
                )
                session.flush()  # assign new.id before referencing it
                best.invalid_at = now
                best.superseded_by = new.id
                best.status = "superseded"
                session.flush()
                session.refresh(new)
                return {**_memory_to_dict(new), "action": "supersede", "superseded": str(best.id)}

            # Any other high-sim mismatch — neutral vs a directive, or contradiction of a NON-active
            # (pending) fact — is NEITHER corroboration NOR a supersedable contradiction. Add the
            # candidate as its own fact; NEVER confirm/promote a fact it does not corroborate (a
            # neutral promoting a quarantined 'avoid X' would be a backfire). Falls through ↓.

        new = _insert(
            session,
            cand,
            repo_key=repo_key,
            node_id=node_id,
            status=status,
            vector=vector,
            owner_id=owner_id,
            run_id=run_id,
        )
        session.flush()
        session.refresh(new)
        return {**_memory_to_dict(new), "action": "add"}


def _consolidate_and_write(
    candidates: list[_Candidate],
    *,
    run_id: str,
    owner_id: uuid.UUID,
    run_repo_key: str | None,
    outcome_class: OutcomeClass,
    role_map: dict[str, uuid.UUID],
    owner_key: str | None,
    embed_model: str,
) -> list[dict]:
    """Embed, consolidate + write each gated candidate — each independently (best-effort: one
    candidate failing never sinks the others, and never touches the run's terminal status)."""
    written: list[dict] = []
    for cand in candidates:
        try:
            repo_key, node_id = _resolve_scope(cand, run_repo_key, role_map)
            status = _status_for(cand.sign, outcome_class)
            vector: list[float] | None = None
            try:
                vector = _embed_on_run(
                    cand.content, run_id=run_id, owner_key=owner_key, model=embed_model
                )
            except Exception:  # noqa: BLE001 — an embed failure still writes the fact (vector NULL)
                logger.warning("distill embed failed run=%s", run_id, exc_info=True)
            result = _apply_one(
                cand,
                repo_key=repo_key,
                node_id=node_id,
                status=status,
                vector=vector,
                owner_id=owner_id,
                run_id=run_id,
            )
            if result is not None:
                written.append(result)
        except Exception:  # noqa: BLE001 — best-effort: independent per-fact writes
            logger.warning("distill fact write failed run=%s", run_id, exc_info=True)
    return written


# ------------------------------------------------------------------ orchestration ----


def distill_run(run_id: str) -> dict:
    """Distil + write memory for one finished run (the core; the DBOS step wraps this best-effort).

    Loads the run, classifies its terminal cause (layer 1), assembles the bounded trail (reusing
    ``run_explain`` read-only), fetches the existing in-scope facts, calls the distiller (metered on
    the run with the owner's key), applies the anti-backfire gates, then consolidates + writes.
    Returns a small summary dict (for logging/tests)."""
    settings = get_settings()
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one_or_none()
        if run is None:
            return {"written": 0, "skipped": "no-run"}
        owner_id = run.owner_id
        repo_key = run.repo_path
        status = run.status
        idea = run.idea
    if owner_id is None:  # a legacy/un-owned run cannot own owner-scoped memory
        return {"written": 0, "skipped": "no-owner"}

    reason = _failure_reason(run_id, status)
    outcome_class = classify_terminal(status, reason)
    trail = _assemble_run_trail(run_id)
    role_map = _role_authored_ids(run_id)
    existing = _fetch_in_scope(owner_id, repo_key)

    # Distiller model + embedding model are BOTH openai-provider, so one owner key serves both.
    try:
        owner_key = resolve_owner_api_key(owner_id, settings.memory_distiller_model)
    except Exception:  # noqa: BLE001 — a keyless owner can't be metered; skip (best-effort)
        logger.warning(
            "distill skipped: owner has no key for %s run=%s",
            settings.memory_distiller_model,
            run_id,
            exc_info=True,
        )
        return {"written": 0, "skipped": "no-key", "outcome_class": outcome_class}

    ops = _run_distiller(
        idea=idea,
        outcome_class=outcome_class,
        status=status,
        trail=trail,
        existing=existing,
        run_id=run_id,
        owner_key=owner_key,
        model=settings.memory_distiller_model,
    )
    candidates = _gate(ops, outcome_class)
    written = _consolidate_and_write(
        candidates,
        run_id=run_id,
        owner_id=owner_id,
        run_repo_key=repo_key,
        outcome_class=outcome_class,
        role_map=role_map,
        owner_key=owner_key,
        embed_model=settings.embedding_model,
    )
    logger.info(
        "distilled run=%s outcome=%s candidates=%d written=%d",
        run_id,
        outcome_class,
        len(candidates),
        len(written),
    )
    return {
        "outcome_class": outcome_class,
        "candidates": len(candidates),
        "written": len(written),
        "facts": written,
    }


def list_run_memories(owner_id: uuid.UUID, run_id: str) -> list[dict]:
    """This run's taught facts (``active`` + ``pending_review``), owner-scoped, oldest first. Backs
    ``GET /api/runs/{id}/memories``."""
    with session_scope() as session:
        rows = (
            session.execute(
                select(NodeMemory)
                .where(
                    NodeMemory.owner_id == owner_id,
                    NodeMemory.source_run_id == run_id,
                    NodeMemory.status.in_(("active", "pending_review")),
                )
                .order_by(NodeMemory.created_at, NodeMemory.id)
            )
            .scalars()
            .all()
        )
        return [_memory_to_dict(r) for r in rows]
