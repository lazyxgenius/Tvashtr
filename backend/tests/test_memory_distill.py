"""M-memory S2 — run-END distillation + the 5 anti-backfire layers (mutation-real, offline).

The distiller LLM (``memory_distill.complete``) and the embedder (``memory_distill.embed``) are
monkeypatched so these run offline yet exercise the REAL gating + REAL code-authoritative
consolidation + the REAL DB (a real ``node_memories`` write, a real cost row). The trail is built
by the REAL ``run_explain`` over seeded rows — proving the read-only reuse.

The fake embedder is TOPIC-keyed via a shared registry: two facts sharing a leading ``topic:`` token
get the SAME one-hot vector (cosine 1.0 → dup / contradiction / corroboration), distinct topics get
ORTHOGONAL vectors (cosine 0.0 → new). Sequential index assignment ⇒ never a hash collision.
"""

import json
import uuid

import pytest
from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane import memory_distill, team_run
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.models import AgentInvocation, AgentNode, CostRecord, NodeMemory, Run

_DIM = 1536
_TOPIC_INDEX: dict[str, int] = {}  # topic -> one-hot index (sequential ⇒ injective, no collisions)


def _topic(text: str) -> str:
    return text.split(":", 1)[0].strip().lower() if ":" in text else text.strip().lower()


def _topic_vector(text: str) -> list[float]:
    t = _topic(text)
    idx = _TOPIC_INDEX.setdefault(t, len(_TOPIC_INDEX)) % _DIM
    v = [0.0] * _DIM
    v[idx] = 1.0
    return v


@pytest.fixture(autouse=True)
def _fake_embed(monkeypatch):
    """Offline, deterministic, topic-keyed 1536-dim embed for the distiller path."""

    def fake(request):
        return EmbeddingResult(
            vectors=[_topic_vector(t) for t in request.input],
            model=request.model,
            prompt_tokens=3,
            total_tokens=3,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=0.4,
        )

    monkeypatch.setattr(memory_distill, "embed", fake)


def _patch_distiller(monkeypatch, facts: list[dict]) -> None:
    """Make the distiller LLM return exactly ``facts`` (as a ``{"facts": [...]}`` JSON body)."""

    def fake(request):
        return CompletionResult(
            text=json.dumps({"facts": facts}),
            model_requested=request.model,
            model_used=request.model,
            prompt_tokens=10,
            completion_tokens=8,
            total_tokens=18,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=1.0,
        )

    monkeypatch.setattr(memory_distill, "complete", fake)


def _seed_run(
    *,
    status: str = "completed",
    repo_path: str | None = None,
    owner: uuid.UUID | None = None,
    outcome: str | None = "approved",
    detail: str | None = "shipped clean",
) -> tuple[str, str]:
    """Seed an owned run over a real review_loop team + one engineer invocation. Returns
    ``(run_id, engineer_node_id)``. ``run_id == str(id) == workflow_id`` (executor convention)."""
    owner = owner or auth_user_id()
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        nodes = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .all()
        )
        eng = {n.role_name: n for n in nodes}["engineer"]
        node_id = str(eng.id)
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner,
                idea="Add a bulk_discount(total, pct) to the pricing module.",
                workflow_id=run_id,
                status=status,
                repo_path=repo_path,
            )
        )
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=eng.id,
                iteration=1,
                status="done" if status == "completed" else "failed",
                outcome=outcome,
                outcome_detail=detail,
            )
        )
    return run_id, node_id


def _run_memories(run_id: str, owner: uuid.UUID | None = None) -> list[dict]:
    """Every ``node_memories`` row taught by ``run_id`` (any status), oldest first — raw rows so a
    test can assert status/polarity/tier/provenance/supersession directly."""
    owner = owner or auth_user_id()
    with session_scope() as session:
        rows = (
            session.execute(
                select(NodeMemory)
                .where(NodeMemory.owner_id == owner, NodeMemory.source_run_id == run_id)
                .order_by(NodeMemory.created_at, NodeMemory.id)
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "content": r.content,
                "polarity": r.polarity,
                "status": r.status,
                "repo_key": r.repo_key,
                "node_id": r.node_id,
                "confirmation_count": r.confirmation_count,
                "superseded_by": r.superseded_by,
                "invalid_at": r.invalid_at,
            }
            for r in rows
        ]


def _u() -> str:
    return uuid.uuid4().hex


# ----------------------------------------------------------------- layer 0: happy path ----


def test_success_run_writes_active_facts_metered_on_run(client, monkeypatch):
    repo = f"/repo/{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: use pytest fixtures for setup",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "clean",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    result = memory_distill.distill_run(run_id)

    assert result["outcome_class"] == "success"
    mems = _run_memories(run_id)
    assert len(mems) == 1
    assert mems[0]["status"] == "active"  # a success run's facts are active immediately
    assert mems[0]["polarity"] == "prefer"
    assert mems[0]["repo_key"] == repo  # repo_key derived from the run's repo_path

    # BOTH the distiller completion AND the fact embed are metered ON the run (workflow_id=run_id).
    with session_scope() as session:
        completion_cost = session.execute(
            select(CostRecord).where(
                CostRecord.workflow_id == run_id,
                CostRecord.idempotency_key == f"{run_id}:memory-distill",
            )
        ).scalar_one_or_none()
        embed_cost = (
            session.execute(
                select(CostRecord).where(
                    CostRecord.workflow_id == run_id,
                    CostRecord.idempotency_key.like(f"{run_id}:memory-distill-embed:%"),
                )
            )
            .scalars()
            .first()
        )
    assert completion_cost is not None  # the distiller completion, on-run
    assert embed_cost is not None  # the fact embed, on-run (NOT off-ledger)


# ----------------------------------------------------------------- layer 1: triage ----


def test_environmental_failure_writes_zero_negatives(client, monkeypatch):
    """Layer 1 — an environmental terminal drops every avoid/forbid EVEN IF the LLM proposes them; a
    neutral fact still lands."""
    repo = f"/repo/{_u()}"
    neutral = f"{_u()}: the repo builds with uv"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: never touch the network",
                "tier": "repo",
                "polarity": "forbid",
                "evidence": "the run errored",
                "rationale": "x",
            },
            {
                "op": "ADD",
                "content": neutral,
                "tier": "repo",
                "polarity": "context",
                "rationale": "y",
            },
        ],
    )
    run_id, _ = _seed_run(
        status="over_budget",
        repo_path=repo,
        outcome=None,
        detail="over_budget: proxy cut the agent off",
    )
    result = memory_distill.distill_run(run_id)

    assert result["outcome_class"] == "environmental"
    mems = _run_memories(run_id)
    assert all(m["polarity"] not in ("avoid", "forbid") for m in mems)  # negatives dropped
    assert any(m["content"] == neutral for m in mems)  # the neutral fact survived


def test_engine_error_failure_is_environmental(client, monkeypatch):
    repo = f"/repo/{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: avoid deep recursion",
                "tier": "repo",
                "polarity": "avoid",
                "evidence": "stacktrace",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(
        status="failed",
        repo_path=repo,
        outcome="failed",
        detail="engine error: connection reset by peer",
    )
    result = memory_distill.distill_run(run_id)
    assert result["outcome_class"] == "environmental"
    assert _run_memories(run_id) == []  # only a negative was proposed, and it was dropped


def test_human_gate_rejection_is_environmental_not_agent(client, monkeypatch):
    """Layer 1 triage — a run finalized ``rejected`` by a HUMAN gate (not the agent's fault) is
    environmental: the bare ``rejected`` status is NOT agent-attribution (only a reviewer verdict /
    test-build failure IN THE TRAIL is). So its proposed negatives are dropped."""
    repo = f"/repo/{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: avoid the chosen approach",
                "tier": "repo",
                "polarity": "avoid",
                "evidence": "the run was rejected",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        outcome=None,
        detail="the human operator closed the PRD gate before approval",
    )
    result = memory_distill.distill_run(run_id)
    assert (
        result["outcome_class"] == "environmental"
    )  # a human gate reject is NOT agent-attributable
    assert _run_memories(run_id) == []  # the avoid was dropped (layer 1)


# ----------------------------------------------------------------- layers 2 + 3: negatives ----


def test_agent_failure_writes_pending_negatives(client, monkeypatch):
    """Layer 3 — a negative from an agent-attributable failure is quarantined ``pending_review``."""
    repo = f"/repo/{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: add a test for the empty-list edge case",
                "tier": "repo",
                "polarity": "avoid",
                "evidence": "reviewer: missing edge-case test",
                "rationale": "recurring",
            }
        ],
    )
    run_id, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        outcome="changes_requested",
        detail="reviewer rejected: missing edge-case test",
    )
    result = memory_distill.distill_run(run_id)

    assert result["outcome_class"] == "agent"
    mems = _run_memories(run_id)
    assert len(mems) == 1
    assert mems[0]["polarity"] == "avoid"
    assert mems[0]["status"] == "pending_review"  # proposed, not imposed


def test_negative_without_evidence_is_dropped(client, monkeypatch):
    """Layer 2 — an avoid/forbid with no evidence is dropped; the paired positive is kept."""
    repo = f"/repo/{_u()}"
    dropped = f"{_u()}: avoid global mutable state"
    kept = f"{_u()}: prefer small pure functions"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": dropped,
                "tier": "repo",
                "polarity": "avoid",
                "rationale": "no evidence",
            },
            {"op": "ADD", "content": kept, "tier": "repo", "polarity": "prefer", "rationale": "ok"},
        ],
    )
    run_id, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        outcome="changes_requested",
        detail="reviewer rejected: nits",
    )
    memory_distill.distill_run(run_id)
    contents = {m["content"] for m in _run_memories(run_id)}
    assert dropped not in contents  # no evidence ⇒ dropped
    assert kept in contents  # positive kept, active


# ----------------------------------------------------------------- consolidation ----


def test_second_run_promotes_pending_to_active_and_bumps_count(client, monkeypatch):
    """Layer 3 corroboration — a 2nd run teaching the same negative promotes the quarantined fact to
    active and bumps its confirmation_count; no duplicate row is created."""
    repo = f"/repo/{_u()}"
    fact = {
        "op": "ADD",
        "content": f"tests-{_u()}: add a regression test before fixing a bug",
        "tier": "repo",
        "polarity": "avoid",
        "evidence": "reviewer: no regression test",
        "rationale": "x",
    }

    _patch_distiller(monkeypatch, [fact])
    r1, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        outcome="changes_requested",
        detail="reviewer rejected: no regression test",
    )
    memory_distill.distill_run(r1)
    m1 = _run_memories(r1)
    assert len(m1) == 1 and m1[0]["status"] == "pending_review" and m1[0]["confirmation_count"] == 1

    _patch_distiller(monkeypatch, [fact])  # a 2nd, different run corroborates the SAME lesson
    r2, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        outcome="changes_requested",
        detail="reviewer rejected: no regression test",
    )
    memory_distill.distill_run(r2)

    m1b = _run_memories(r1)
    assert len(m1b) == 1
    assert m1b[0]["status"] == "active"  # promoted on the 2nd occurrence
    assert m1b[0]["confirmation_count"] == 2  # and bumped
    assert _run_memories(r2) == []  # the 2nd run created NO new row (it confirmed the existing one)


def test_contradicting_success_supersedes_active_avoid(client, monkeypatch):
    """Layer 5 — a success contradicting an active avoid supersedes it + adds the new fact."""
    repo = f"/repo/{_u()}"
    topic = f"asyncio{_u()}"
    old_content = f"{topic}: avoid raw create_task"
    with session_scope() as session:
        old = NodeMemory(
            owner_id=auth_user_id(),
            repo_key=repo,
            content=old_content,
            embedding=_topic_vector(old_content),
            polarity="avoid",
            status="active",
            source_run_id="prior-run",
            confirmation_count=1,
        )
        session.add(old)
        session.flush()
        old_id = old.id

    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: prefer named create_task with error handling",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "it worked",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    memory_distill.distill_run(run_id)

    mems = _run_memories(run_id)
    assert len(mems) == 1 and mems[0]["polarity"] == "prefer" and mems[0]["status"] == "active"
    with session_scope() as session:
        old_row = session.get(NodeMemory, old_id)
        assert old_row.status == "superseded"
        assert old_row.invalid_at is not None
        assert str(old_row.superseded_by) == str(mems[0]["id"])  # points at the new fact


def test_contradicting_success_does_not_promote_a_pending_negative(client, monkeypatch):
    """Backfire guard — a success contradicting a PENDING negative must NOT activate it: the pending
    negative stays quarantined (status + count unchanged); the positive is added as its own fact."""
    repo = f"/repo/{_u()}"
    topic = f"caching{_u()}"
    neg_content = f"{topic}: avoid caching the result"
    with session_scope() as session:
        neg = NodeMemory(
            owner_id=auth_user_id(),
            repo_key=repo,
            content=neg_content,
            embedding=_topic_vector(neg_content),
            polarity="avoid",
            status="pending_review",
            source_run_id="prior-failed-run",
            confirmation_count=1,
        )
        session.add(neg)
        session.flush()
        neg_id = neg.id

    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: prefer caching the result",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "it worked",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    memory_distill.distill_run(run_id)

    with session_scope() as session:
        neg = session.get(NodeMemory, neg_id)
        assert neg.status == "pending_review"  # NOT promoted by a contradicting success
        assert neg.confirmation_count == 1  # NOT bumped
    mems = _run_memories(run_id)
    assert len(mems) == 1 and mems[0]["polarity"] == "prefer" and mems[0]["status"] == "active"


def test_neutral_candidate_does_not_promote_pending_negative(client, monkeypatch):
    """Backfire guard (adversarial review) — a NEUTRAL (context) fact on the same topic must
    NOT corroborate/promote a quarantined pending negative; only a SAME-sign candidate can.
    The neutral is added on its own; the pending negative stays pending, count unchanged."""
    repo = f"/repo/{_u()}"
    topic = f"payments{_u()}"
    neg_content = f"{topic}: avoid calling the API without an idempotency key"
    with session_scope() as session:
        neg = NodeMemory(
            owner_id=auth_user_id(),
            repo_key=repo,
            content=neg_content,
            embedding=_topic_vector(neg_content),
            polarity="avoid",
            status="pending_review",
            source_run_id="prior-failed-run",
            confirmation_count=1,
        )
        session.add(neg)
        session.flush()
        neg_id = neg.id

    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: the API supports request batching",
                "tier": "repo",
                "polarity": "context",
                "rationale": "neutral fact, same topic",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    memory_distill.distill_run(run_id)

    with session_scope() as session:
        neg = session.get(NodeMemory, neg_id)
        assert (
            neg.status == "pending_review"
        )  # a neutral fact must NOT activate a quarantined negative
        assert neg.confirmation_count == 1  # NOT bumped
    mems = _run_memories(run_id)
    assert len(mems) == 1 and mems[0]["polarity"] == "context" and mems[0]["status"] == "active"


def test_near_duplicate_is_noop_no_duplicate_row(client, monkeypatch):
    """Consolidation NOOP — a near-dup active fact is confirmed (count bumped), NOT duplicated."""
    repo = f"/repo/{_u()}"
    topic = f"ci{_u()}"
    existing_content = f"{topic}: run the full suite before ship"
    with session_scope() as session:
        existing = NodeMemory(
            owner_id=auth_user_id(),
            repo_key=repo,
            content=existing_content,
            embedding=_topic_vector(existing_content),
            polarity="prefer",
            status="active",
            source_run_id="prior-run",
            confirmation_count=1,
        )
        session.add(existing)
        session.flush()
        existing_id = existing.id

    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: run the whole test suite before shipping",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "dup",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    memory_distill.distill_run(run_id)

    assert _run_memories(run_id) == []  # the near-dup produced NO new row for this run
    with session_scope() as session:
        existing = session.get(NodeMemory, existing_id)
        assert existing.confirmation_count == 2  # it was confirmed
        active_on_repo = (
            session.execute(
                select(NodeMemory).where(NodeMemory.repo_key == repo, NodeMemory.status == "active")
            )
            .scalars()
            .all()
        )
    assert len(active_on_repo) == 1  # still exactly one active fact on this scope


# ----------------------------------------------------------------- layer 4: fact cap ----


def test_fact_cap_limits_writes_per_run(client, monkeypatch):
    repo = f"/repo/{_u()}"
    facts = [
        {
            "op": "ADD",
            "content": f"topic{i}-{_u()}: neutral lesson {i}",
            "tier": "repo",
            "polarity": "context",
            "rationale": "x",
        }
        for i in range(9)
    ]
    _patch_distiller(monkeypatch, facts)
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    memory_distill.distill_run(run_id)
    assert len(_run_memories(run_id)) == memory_distill.FACT_CAP  # 9 proposed → capped at 5


def test_same_run_negatives_do_not_self_promote(client, monkeypatch):
    """Safeguard #3 — two same-topic negatives from the SAME failed run confirm each other (count
    bumps) but must NOT self-promote to active: only a DIFFERENT run corroborates (the ``!= run_id``
    guard). Pins that guard."""
    repo = f"/repo/{_u()}"
    topic = f"secrets{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: never hardcode the token",
                "tier": "repo",
                "polarity": "forbid",
                "evidence": "reviewer: hardcoded token",
                "rationale": "x",
            },
            {
                "op": "ADD",
                "content": f"{topic}: do not commit the token",
                "tier": "repo",
                "polarity": "forbid",
                "evidence": "reviewer: hardcoded token",
                "rationale": "x",
            },
        ],
    )
    run_id, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        outcome="changes_requested",
        detail="reviewer rejected: hardcoded token",
    )
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id)
    assert len(mems) == 1  # the 2nd folded into the 1st (same topic) — no duplicate row
    assert mems[0]["status"] == "pending_review"  # NOT self-promoted within one run
    assert mems[0]["confirmation_count"] == 2  # but confirmed


def test_fact_cap_keeps_highest_force_directives(client, monkeypatch):
    """Layer 4 — over the cap the STRONGEST directives survive (require/forbid > prefer/avoid >
    context) and EXACTLY 5 are written. Context candidates are listed FIRST so a broken/removed
    force-sort would let them crowd out the directives (caught here); the assertion pins the literal
    cap of 5."""
    repo = f"/repo/{_u()}"
    facts = []
    facts += [
        {
            "op": "ADD",
            "content": f"ctx{i}-{_u()}: neutral {i}",
            "tier": "repo",
            "polarity": "context",
            "rationale": "x",
        }
        for i in range(4)
    ]
    facts += [
        {
            "op": "ADD",
            "content": f"pref{i}-{_u()}: should {i}",
            "tier": "repo",
            "polarity": "prefer",
            "rationale": "x",
        }
        for i in range(2)
    ]
    facts += [
        {
            "op": "ADD",
            "content": f"req{i}-{_u()}: must {i}",
            "tier": "repo",
            "polarity": "require",
            "rationale": "x",
        }
        for i in range(3)
    ]
    _patch_distiller(monkeypatch, facts)
    run_id, _ = _seed_run(status="completed", repo_path=repo)
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id)
    assert len(mems) == 5  # the literal cap
    # the 3 require + 2 prefer survive; NO neutral context makes the cut (they are the weakest)
    assert sorted(m["polarity"] for m in mems) == [
        "prefer",
        "prefer",
        "require",
        "require",
        "require",
    ]


def test_dup_threshold_brackets_consolidation(client, monkeypatch):
    """DUP_THRESHOLD (0.85) is the load-bearing consolidation constant — a pair just BELOW stays
    separate (ADD), a pair just ABOVE consolidates (confirm, no new row). Hand-crafted vectors
    bracket it (the topic fake only yields 1.0/0.0, so this is what pins the threshold value)."""
    base = [1.0, 0.0] + [0.0] * (_DIM - 2)  # the existing fact's direction

    def _fixed(vec):
        def fake(request):
            return EmbeddingResult(
                vectors=[list(vec) for _ in request.input],
                model=request.model,
                prompt_tokens=1,
                total_tokens=1,
                cost_usd=0.0,
                raw_provider="openai",
                latency_ms=0.1,
            )

        return fake

    # BELOW 0.85 (cosine 0.80): distinct ⇒ a new row is ADDed.
    repo_lo = f"/repo/{_u()}"
    with session_scope() as session:
        session.add(
            NodeMemory(
                owner_id=auth_user_id(),
                repo_key=repo_lo,
                content="lo-existing",
                embedding=base,
                polarity="prefer",
                status="active",
                source_run_id="prior",
            )
        )
    monkeypatch.setattr(memory_distill, "embed", _fixed([0.8, 0.6] + [0.0] * (_DIM - 2)))
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": "lo-cand",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "x",
            }
        ],
    )
    r_lo, _ = _seed_run(status="completed", repo_path=repo_lo)
    memory_distill.distill_run(r_lo)
    assert len(_run_memories(r_lo)) == 1  # 0.80 < 0.85 ⇒ ADDed as its own row

    # ABOVE 0.85 (cosine ~0.90): near-dup ⇒ consolidated, NO new row.
    repo_hi = f"/repo/{_u()}"
    with session_scope() as session:
        session.add(
            NodeMemory(
                owner_id=auth_user_id(),
                repo_key=repo_hi,
                content="hi-existing",
                embedding=base,
                polarity="prefer",
                status="active",
                source_run_id="prior",
            )
        )
    monkeypatch.setattr(memory_distill, "embed", _fixed([0.9, 0.4359] + [0.0] * (_DIM - 2)))
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": "hi-cand",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "x",
            }
        ],
    )
    r_hi, _ = _seed_run(status="completed", repo_path=repo_hi)
    memory_distill.distill_run(r_hi)
    assert _run_memories(r_hi) == []  # 0.90 >= 0.85 ⇒ consolidated (confirm), no new row


# ----------------------------------------------------------------- tiering / owner ----


def test_greenfield_downgrades_repo_candidate_to_account_tier(client, monkeypatch):
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: this user prefers verbose logging",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=None)  # greenfield: no repo identity
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id)
    assert len(mems) == 1
    assert mems[0]["repo_key"] is None and mems[0]["node_id"] is None  # account tier only


def test_node_tier_maps_to_the_authored_node(client, monkeypatch):
    repo = f"/repo/{_u()}"
    run_id, node_id = _seed_run(status="completed", repo_path=repo)
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: this node ships tight, tested diffs",
                "tier": "node",
                "node_role": "engineer",
                "polarity": "context",
                "rationale": "x",
            }
        ],
    )
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id)
    assert len(mems) == 1
    assert mems[0]["repo_key"] == repo
    assert str(mems[0]["node_id"]) == node_id  # the authored engineer node


def test_distillation_is_owner_scoped(client, monkeypatch):
    """A run owned by A only ever writes A's memory (owner_id = the run's owner)."""
    repo = f"/repo/{_u()}"
    content = f"{_u()}: owner-scoped fact"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": content,
                "tier": "repo",
                "polarity": "context",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=auth_user_id())
    memory_distill.distill_run(run_id)
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(NodeMemory.source_run_id == run_id)
        ).scalar_one()
        assert row.owner_id == auth_user_id()


# ----------------------------------------------------------------- best-effort ----


def test_distillation_is_best_effort_on_forced_raise(client, monkeypatch):
    """A distiller explosion must NOT change the run's terminal status or write anything — the DBOS
    step swallows it (best-effort)."""
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo)

    def boom(_run_id):
        raise RuntimeError("distiller exploded")

    monkeypatch.setattr(memory_distill, "distill_run", boom)
    team_run.distill_run_memory_step(run_id)  # must NOT raise

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
    assert run.status == "completed"  # terminal status untouched
    assert _run_memories(run_id) == []  # nothing partial-written
