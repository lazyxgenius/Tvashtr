"""M-memory S4 — the write-control surface (mutation-real, offline).

Exercises the REAL code-authoritative consolidation + the REAL DB for the three S4 capabilities,
all reusing S2's Consolidate:
  1. promote / reject of memory rows (reject = a TOMBSTONE that suppresses re-proposal);
  2. the per-owner review-before-persist mode (``users.memory_review_mode``);
  3. the deliberate agent-remember capture.

Same fake-embed contract as ``test_memory_distill``: the embedder is monkeypatched with a
TOPIC-keyed one-hot registry — two facts sharing a leading ``topic:`` token get the SAME vector
(cosine 1.0 → dup / contradiction / tombstone-match), distinct topics get ORTHOGONAL vectors
(cosine 0.0 → new). The distiller LLM is patched to return exact ops. Nothing here needs a live LLM.
"""

import json
import uuid

import pytest
from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane import memory, memory_distill, memory_review
from tvashtr.control_plane.credentials import encrypt_secret
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.models import AgentInvocation, AgentNode, NodeMemory, ProviderCredential, Run, User

_DIM = 1536
_TOPIC_INDEX: dict[str, int] = {}


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


def _u() -> str:
    return uuid.uuid4().hex


def _make_owner(*, review_mode: bool = False) -> uuid.UUID:
    """A fresh owner (so a review-mode toggle never leaks onto the shared conftest user) with an
    ``openai`` credential (the distiller + embed provider) so ``distill_run`` can resolve a key."""
    oid = uuid.uuid4()
    with session_scope() as session:
        session.add(
            User(
                id=oid,
                email=f"s4-{oid.hex}@tvashtr.local",
                password_hash="x",
                memory_review_mode=review_mode,
            )
        )
        session.flush()  # insert the user before the FK-referencing credential
        session.add(
            ProviderCredential(
                owner_id=oid,
                provider="openai",
                secret_encrypted=encrypt_secret("dummy-key"),
                key_last4="0000",
            )
        )
    return oid


def _seed_run(
    *,
    status: str = "completed",
    repo_path: str | None = None,
    owner: uuid.UUID | None = None,
    outcome: str | None = "approved",
    detail: str | None = "shipped clean",
) -> tuple[str, str]:
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


def _seed_memory(
    *,
    owner: uuid.UUID,
    content: str,
    polarity: str,
    status: str = "active",
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
    source_run_id: str = "prior-run",
) -> uuid.UUID:
    with session_scope() as session:
        row = NodeMemory(
            owner_id=owner,
            repo_key=repo_key,
            node_id=node_id,
            content=content,
            embedding=_topic_vector(content),
            polarity=polarity,
            status=status,
            source_run_id=source_run_id,
            confirmation_count=1,
        )
        session.add(row)
        session.flush()
        return row.id


def _row(memory_id: uuid.UUID) -> NodeMemory | None:
    with session_scope() as session:
        return session.get(NodeMemory, memory_id)


def _run_memories(run_id: str, owner: uuid.UUID | None = None) -> list[dict]:
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


# =============================================================== Part 1: reject (tombstone) ====


def test_reject_pending_is_tombstoned(client):
    owner = auth_user_id()
    mid = _seed_memory(
        owner=owner, content=f"{_u()}: avoid X", polarity="avoid", status="pending_review"
    )
    out = memory_review.reject(owner, str(mid))
    assert out is not None and out["status"] == "rejected"
    row = _row(mid)
    assert row.status == "rejected"
    assert row.invalid_at is not None  # a tombstone carries invalid_at


def test_reject_active_is_tombstoned(client):
    owner = auth_user_id()
    mid = _seed_memory(owner=owner, content=f"{_u()}: prefer Y", polarity="prefer", status="active")
    out = memory_review.reject(owner, str(mid))
    assert out["status"] == "rejected"
    assert _row(mid).status == "rejected"


def test_reject_is_owner_scoped_and_404s(client):
    owner = auth_user_id()
    other = _make_owner()
    mid = _seed_memory(owner=other, content=f"{_u()}: not yours", polarity="context")
    assert memory_review.reject(owner, str(mid)) is None  # another owner's row: 404
    assert _row(mid).status == "active"  # untouched
    assert memory_review.reject(owner, str(uuid.uuid4())) is None  # unknown id
    assert memory_review.reject(owner, "not-a-uuid") is None  # malformed


def test_rejected_fact_suppresses_redistill_of_same_signed_fact(client, monkeypatch):
    """The load-bearing tombstone behaviour — after a fact is rejected, a later run distilling the
    SAME same-sign fact is DROPPED (no re-proposal), instead of being re-added/confirmed."""
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    topic = f"tomb{_u()}"
    rejected_content = f"{topic}: avoid the flaky retry loop"
    # A prior run taught it; the human rejected it (a tombstone;
    # the drop keys on status='rejected').
    _seed_memory(
        owner=owner, content=rejected_content, polarity="avoid", status="rejected", repo_key=repo
    )
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: avoid the flaky retry loop entirely",
                "tier": "repo",
                "polarity": "avoid",
                "evidence": "reviewer: flaky",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        owner=owner,
        outcome="changes_requested",
        detail="reviewer rejected: flaky",
    )
    memory_distill.distill_run(run_id)
    assert _run_memories(run_id, owner) == []  # dropped by the tombstone — NOT re-proposed


def test_rejected_tombstone_does_not_block_opposite_sign_fact(client, monkeypatch):
    """A rejected NEGATIVE must not suppress a new POSITIVE on the same topic — only SAME-sign
    candidates are dropped."""
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    topic = f"opp{_u()}"
    _seed_memory(
        owner=owner,
        content=f"{topic}: avoid caching",
        polarity="avoid",
        status="rejected",
        repo_key=repo,
    )
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: prefer caching",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "worked",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1 and mems[0]["polarity"] == "prefer" and mems[0]["status"] == "active"


def test_tombstone_drop_not_masked_by_nearer_opposite_sign_tombstone(client, monkeypatch):
    """A same-sign rejected tombstone must drop a re-proposal EVEN IF a NEARER opposite-sign
    rejected tombstone exists at the same scope — the masking edge case the adversarial review
    flagged (the same-sign filter must run BEFORE the nearest-match, not after)."""
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    v = [1.0, 0.0] + [0.0] * (_DIM - 2)  # the candidate's embedding direction
    same_sign_vec = [0.9, 0.4359] + [0.0] * (_DIM - 2)  # cos ~0.90 to v (avoid, SAME sign)
    opp_vec = [0.95, 0.3122] + [0.0] * (_DIM - 2)  # cos ~0.95 to v (prefer, opposite, NEARER)
    with session_scope() as session:
        session.add(
            NodeMemory(
                owner_id=owner,
                repo_key=repo,
                content="tomb-avoid",
                embedding=same_sign_vec,
                polarity="avoid",
                status="rejected",
                source_run_id="prior",
            )
        )
        session.add(
            NodeMemory(
                owner_id=owner,
                repo_key=repo,
                content="tomb-prefer",
                embedding=opp_vec,
                polarity="prefer",
                status="rejected",
                source_run_id="prior",
            )
        )
    monkeypatch.setattr(
        memory_distill,
        "embed",
        lambda req: EmbeddingResult(
            vectors=[list(v) for _ in req.input],
            model=req.model,
            prompt_tokens=1,
            total_tokens=1,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=0.1,
        ),
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    written = memory_distill.remember_facts(
        run_id,
        [{"content": "re-propose the avoided thing", "polarity": "avoid"}],
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert written == []  # dropped by the SAME-sign tombstone despite the nearer opposite-sign one


# =============================================================== Part 1: promote (consolidate) ==


def test_promote_plain_activates_a_pending_fact(client):
    owner = auth_user_id()
    repo = f"/repo/{_u()}"
    mid = _seed_memory(
        owner=owner,
        content=f"{_u()}: a lonely pending fact",
        polarity="prefer",
        status="pending_review",
        repo_key=repo,
    )
    out = memory_review.promote(owner, str(mid))
    assert out is not None and out["status"] == "active"
    row = _row(mid)
    assert row.status == "active" and row.invalid_at is None


def test_promote_a_rejected_fact_reactivates_it(client):
    owner = auth_user_id()
    repo = f"/repo/{_u()}"
    mid = _seed_memory(
        owner=owner,
        content=f"{_u()}: reconsidered lesson",
        polarity="prefer",
        status="rejected",
        repo_key=repo,
    )
    out = memory_review.promote(owner, str(mid))
    assert out["status"] == "active"
    assert _row(mid).status == "active"


def test_promote_dedups_into_an_active_duplicate_no_new_active(client):
    """Same-sign duplicate already active → confirm the existing one (bump count), retire the
    promoted row as merged; do NOT leave two active dups."""
    owner = auth_user_id()
    repo = f"/repo/{_u()}"
    topic = f"dup{_u()}"
    active_id = _seed_memory(
        owner=owner,
        content=f"{topic}: run the suite",
        polarity="prefer",
        status="active",
        repo_key=repo,
    )
    pending_id = _seed_memory(
        owner=owner,
        content=f"{topic}: run the whole suite",
        polarity="prefer",
        status="pending_review",
        repo_key=repo,
    )
    out = memory_review.promote(owner, str(pending_id))
    assert out["action"] in ("promote_merged", "confirm")
    active = _row(active_id)
    assert active.status == "active" and active.confirmation_count == 2  # confirmed
    merged = _row(pending_id)
    assert merged.status != "active"  # the promoted dup did NOT become a second active row
    with session_scope() as session:
        actives = (
            session.execute(
                select(NodeMemory).where(NodeMemory.repo_key == repo, NodeMemory.status == "active")
            )
            .scalars()
            .all()
        )
    assert len(actives) == 1  # exactly one active fact on the scope


def test_promote_supersedes_a_contradicted_active_fact(client):
    """Opposite sign vs an active fact → supersede that active fact and activate the promoted one
    (retires the OLD active fact — the mutation-real supersede)."""
    owner = auth_user_id()
    repo = f"/repo/{_u()}"
    topic = f"contra{_u()}"
    old_active = _seed_memory(
        owner=owner,
        content=f"{topic}: avoid create_task",
        polarity="avoid",
        status="active",
        repo_key=repo,
    )
    pending = _seed_memory(
        owner=owner,
        content=f"{topic}: prefer create_task",
        polarity="prefer",
        status="pending_review",
        repo_key=repo,
    )
    out = memory_review.promote(owner, str(pending))
    assert out["status"] == "active"
    assert _row(pending).status == "active"
    old = _row(old_active)
    assert old.status == "superseded"  # the contradicted active fact is retired
    assert old.invalid_at is not None
    assert str(old.superseded_by) == str(pending)  # points at the promoted row


def test_promote_is_owner_scoped_and_404s(client):
    owner = auth_user_id()
    other = _make_owner()
    mid = _seed_memory(
        owner=other, content=f"{_u()}: theirs", polarity="context", status="pending_review"
    )
    assert memory_review.promote(owner, str(mid)) is None
    assert _row(mid).status == "pending_review"  # untouched
    assert memory_review.promote(owner, str(uuid.uuid4())) is None
    active_id = _seed_memory(owner=owner, content=f"{_u()}: already active", polarity="context")
    assert memory_review.promote(owner, str(active_id)) is None  # not pending/rejected → 404


# =============================================================== Part 2: review-before-persist ==


def test_review_mode_off_writes_active(client, monkeypatch):
    owner = _make_owner(review_mode=False)
    repo = f"/repo/{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: prefer fixtures",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1 and mems[0]["status"] == "active"  # OFF = unchanged S2 behaviour


def test_review_mode_on_routes_active_write_to_pending(client, monkeypatch):
    owner = _make_owner(review_mode=True)
    repo = f"/repo/{_u()}"
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{_u()}: prefer fixtures",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1
    assert mems[0]["status"] == "pending_review"  # ON = otherwise-active fact quarantined


def test_review_mode_on_defers_the_supersede(client, monkeypatch):
    """Review ON: a contradicting fact lands pending_review and the OLD active fact stays ACTIVE
    (the supersede is deferred until the human promotes)."""
    owner = _make_owner(review_mode=True)
    repo = f"/repo/{_u()}"
    topic = f"defer{_u()}"
    old_active = _seed_memory(
        owner=owner,
        content=f"{topic}: avoid raw sql",
        polarity="avoid",
        status="active",
        repo_key=repo,
    )
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: prefer raw sql",
                "tier": "repo",
                "polarity": "prefer",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.distill_run(run_id)
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1 and mems[0]["status"] == "pending_review"
    assert _row(old_active).status == "active"  # NOT superseded — deferred


def test_review_mode_on_suppresses_corroboration_auto_promote(client, monkeypatch):
    """Review ON: a 2nd run corroborating a quarantined negative must NOT auto-promote it — it stays
    pending_review (only an explicit human promote activates it)."""
    owner = _make_owner(review_mode=True)
    repo = f"/repo/{_u()}"
    topic = f"corro{_u()}"
    pending_id = _seed_memory(
        owner=owner,
        content=f"{topic}: avoid the shortcut",
        polarity="avoid",
        status="pending_review",
        repo_key=repo,
        source_run_id="prior-failed-run",
    )
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{topic}: avoid the shortcut",
                "tier": "repo",
                "polarity": "avoid",
                "evidence": "reviewer: shortcut",
                "rationale": "x",
            }
        ],
    )
    run_id, _ = _seed_run(
        status="rejected",
        repo_path=repo,
        owner=owner,
        outcome="changes_requested",
        detail="reviewer: shortcut",
    )
    memory_distill.distill_run(run_id)
    assert _row(pending_id).status == "pending_review"  # NOT auto-promoted under review mode


# =============================================================== Part 3: agent-remember =========


def test_agent_remember_lands_active_repo_tier(client):
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    written = memory_distill.remember_facts(
        run_id,
        [{"content": f"{_u()}: the build uses uv", "polarity": "context"}],
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert len(written) == 1
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1
    assert mems[0]["status"] == "active"
    assert mems[0]["repo_key"] == repo and mems[0]["node_id"] is None  # repo tier
    assert mems[0]["polarity"] == "context"


def test_agent_remember_honours_supplied_polarity(client):
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.remember_facts(
        run_id,
        [{"content": f"{_u()}: always pin versions", "polarity": "require"}],
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert _run_memories(run_id, owner)[0]["polarity"] == "require"


def test_agent_remember_negative_bypasses_quarantine(client):
    """A DELIBERATE negative capture lands ACTIVE (it bypasses the failed-run triage + quarantine —
    a deliberate capture is trusted), unlike a distilled negative."""
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.remember_facts(
        run_id,
        [{"content": f"{_u()}: never touch prod creds", "polarity": "forbid"}],
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1 and mems[0]["polarity"] == "forbid" and mems[0]["status"] == "active"


def test_agent_remember_defaults_polarity_context(client):
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.remember_facts(
        run_id,
        [{"content": f"{_u()}: the api paginates at 100"}],  # no polarity
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert _run_memories(run_id, owner)[0]["polarity"] == "context"


def test_agent_remember_under_review_mode_is_pending(client):
    owner = _make_owner(review_mode=True)
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    memory_distill.remember_facts(
        run_id,
        [{"content": f"{_u()}: prefer black", "polarity": "prefer"}],
        owner_id=owner,
        repo_key=repo,
        review_mode=True,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert _run_memories(run_id, owner)[0]["status"] == "pending_review"


def test_agent_remember_respects_rejected_tombstone(client):
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    topic = f"artomb{_u()}"
    _seed_memory(
        owner=owner,
        content=f"{topic}: avoid the deprecated api",
        polarity="avoid",
        status="rejected",
        repo_key=repo,
    )
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    written = memory_distill.remember_facts(
        run_id,
        [{"content": f"{topic}: avoid the deprecated api", "polarity": "avoid"}],
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert written == []  # dropped by the tombstone
    assert _run_memories(run_id, owner) == []


def test_agent_remember_caps_per_run(client):
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    captures = [
        {"content": f"topic{i}-{_u()}: lesson {i}", "polarity": "context"} for i in range(9)
    ]
    memory_distill.remember_facts(
        run_id,
        captures,
        owner_id=owner,
        repo_key=repo,
        review_mode=False,
        owner_key=None,
        embed_model="openai/text-embedding-3-small",
    )
    assert len(_run_memories(run_id, owner)) == memory_distill.FACT_CAP  # capped at 5


# =============================================================== list filter (for the S5 FE) =====


def test_list_memories_status_filter_fetches_pending_and_rejected(client):
    owner = auth_user_id()
    repo = f"/repo/{_u()}"
    _seed_memory(
        owner=owner,
        content=f"{_u()}: active one",
        polarity="context",
        status="active",
        repo_key=repo,
    )
    _seed_memory(
        owner=owner,
        content=f"{_u()}: pending one",
        polarity="avoid",
        status="pending_review",
        repo_key=repo,
    )
    _seed_memory(
        owner=owner,
        content=f"{_u()}: rejected one",
        polarity="avoid",
        status="rejected",
        repo_key=repo,
    )

    pending = memory.list_memories(owner, repo_key=repo, status="pending_review")
    assert len(pending) == 1 and pending[0]["status"] == "pending_review"
    rejected = memory.list_memories(owner, repo_key=repo, status="rejected")
    assert len(rejected) == 1 and rejected[0]["status"] == "rejected"
    # default (no status) stays active-only — backward compatible
    default = memory.list_memories(owner, repo_key=repo)
    assert [m["status"] for m in default] == ["active"]


# =============================================================== Part 4: HTTP endpoints =========


def test_reject_endpoint_tombstones(client):
    owner = auth_user_id()
    mid = _seed_memory(
        owner=owner, content=f"{_u()}: reject me", polarity="avoid", status="pending_review"
    )
    resp = client.post(f"/api/memories/{mid}/reject")
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    assert _row(mid).status == "rejected"


def test_reject_endpoint_404s_on_unknown(client):
    assert client.post(f"/api/memories/{uuid.uuid4()}/reject").status_code == 404


def test_promote_endpoint_activates(client):
    owner = auth_user_id()
    mid = _seed_memory(
        owner=owner, content=f"{_u()}: promote me", polarity="prefer", status="pending_review"
    )
    resp = client.post(f"/api/memories/{mid}/promote")
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"
    assert _row(mid).status == "active"


def test_promote_endpoint_404s_on_unknown(client):
    assert client.post(f"/api/memories/{uuid.uuid4()}/promote").status_code == 404


def test_list_endpoint_status_filter(client):
    owner = auth_user_id()
    repo = f"/repo/{_u()}"
    _seed_memory(
        owner=owner, content=f"{_u()}: act", polarity="context", status="active", repo_key=repo
    )
    pid = _seed_memory(
        owner=owner,
        content=f"{_u()}: pend",
        polarity="avoid",
        status="pending_review",
        repo_key=repo,
    )
    resp = client.get(f"/api/memories?repo_key={repo}&status=pending_review")
    assert resp.status_code == 200
    rows = resp.json()["memories"]
    assert len(rows) == 1 and rows[0]["id"] == str(pid) and rows[0]["status"] == "pending_review"


# =============================================================== Part 3: agent-remember ingest ===


def test_ingest_run_remembers_reads_file_and_writes(client, tmp_path):
    owner = _make_owner()
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    ws = tmp_path / "ws"
    ws.mkdir(parents=True)
    (ws / "TVASHTR_REMEMBER.jsonl").write_text(
        json.dumps({"content": f"{_u()}: the build uses uv", "polarity": "prefer"})
        + "\nthis is not json\n"  # malformed → skipped
        + json.dumps({"content": f"{_u()}: pin deps", "polarity": "require"})
        + "\n"
        + json.dumps({"content": "   "})  # blank content → skipped
        + "\n",
        encoding="utf-8",
    )
    out = memory_review.ingest_run_remembers(run_id, str(ws))
    assert out["written"] == 2  # two valid captures; the malformed + blank lines skipped
    mems = _run_memories(run_id, owner)
    assert len(mems) == 2
    assert all(m["status"] == "active" and m["repo_key"] == repo for m in mems)
    assert sorted(m["polarity"] for m in mems) == ["prefer", "require"]


def test_ingest_run_remembers_missing_file_is_noop(client, tmp_path):
    owner = _make_owner()
    run_id, _ = _seed_run(status="completed", repo_path=f"/repo/{_u()}", owner=owner)
    out = memory_review.ingest_run_remembers(run_id, str(tmp_path))  # no TVASHTR_REMEMBER.jsonl
    assert out["written"] == 0
    assert _run_memories(run_id, owner) == []


def test_ingest_run_remembers_under_review_mode_is_pending(client, tmp_path):
    owner = _make_owner(review_mode=True)
    repo = f"/repo/{_u()}"
    run_id, _ = _seed_run(status="completed", repo_path=repo, owner=owner)
    (tmp_path / "TVASHTR_REMEMBER.jsonl").write_text(
        json.dumps({"content": f"{_u()}: prefer ruff", "polarity": "prefer"}) + "\n",
        encoding="utf-8",
    )
    memory_review.ingest_run_remembers(run_id, str(tmp_path))
    mems = _run_memories(run_id, owner)
    assert len(mems) == 1 and mems[0]["status"] == "pending_review"


def test_ingest_step_is_best_effort_on_raise(client, monkeypatch, tmp_path):
    """The run-end ingest DBOS step must NOT raise or touch the finalized run when the ingest
    explodes (best-effort, mirrors the distill step)."""
    from tvashtr.control_plane import memory_review as mr
    from tvashtr.control_plane import team_run

    owner = _make_owner()
    run_id, _ = _seed_run(status="completed", repo_path=f"/repo/{_u()}", owner=owner)

    def boom(_rid, _ws):
        raise RuntimeError("ingest exploded")

    monkeypatch.setattr(mr, "ingest_run_remembers", boom)
    team_run.ingest_agent_remembers_step(run_id, str(tmp_path))  # must NOT raise

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
    assert run.status == "completed"  # terminal status untouched
    assert _run_memories(run_id, owner) == []  # nothing partial-written


# ---- M-memory S5a: the review-mode toggle ENDPOINT (GET / PATCH /api/memory/review-mode) --------
# The ONE backend addition of the S5a slice — the Memory shelf's review-mode switch drives it. It
# reads/writes the already-existing ``users.memory_review_mode`` column (migration 0027) for the
# current owner, on a DISTINCT singular path so it never collides with ``/api/memories/{id}``.


def test_review_mode_endpoint_reflects_and_flips_the_column(client):
    """GET reports the owner's flag; PATCH flips the REAL column (both directions) and GET reflects
    it. Mutation-real: each step reads the ``users`` row back from the DB. Restores OFF (the shared
    conftest owner's default) so it never leaks onto another test."""
    owner = auth_user_id()

    # A fresh (untoggled) owner reads OFF — the pre-S4 default.
    resp = client.get("/api/memory/review-mode")
    assert resp.status_code == 200
    assert resp.json() == {"review_mode": False}

    # Turn it ON — the response AND the persisted column both flip.
    resp = client.patch("/api/memory/review-mode", json={"review_mode": True})
    assert resp.status_code == 200
    assert resp.json() == {"review_mode": True}
    with session_scope() as session:
        assert session.get(User, owner).memory_review_mode is True

    # A subsequent GET reflects the persisted ON value.
    assert client.get("/api/memory/review-mode").json() == {"review_mode": True}

    # Turn it back OFF — the column returns to False (leaving the shared owner clean).
    resp = client.patch("/api/memory/review-mode", json={"review_mode": False})
    assert resp.status_code == 200
    assert resp.json() == {"review_mode": False}
    with session_scope() as session:
        assert session.get(User, owner).memory_review_mode is False
    assert client.get("/api/memory/review-mode").json() == {"review_mode": False}


def test_review_mode_patch_requires_the_review_mode_field(client):
    """PATCH with no ``review_mode`` is a 422 (required field); the column is untouched."""
    owner = auth_user_id()
    resp = client.patch("/api/memory/review-mode", json={})
    assert resp.status_code == 422
    with session_scope() as session:
        assert session.get(User, owner).memory_review_mode is False
