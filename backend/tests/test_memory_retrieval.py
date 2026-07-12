"""M-memory S3 — unit tests for ``retrieve_for_node`` (offline: seeded rows + fake embed).

These drive the retrieval core against the REAL DB + the REAL pgvector ``vector(1536)`` cosine
operator, but with the query-embed DEPENDENCY-INJECTED (so no network) and controlled embedding
vectors seeded directly, so the cosine RANKING is deterministic. Each test uses a FRESH owner so
another test's account memories never leak in. Proves: tier scope (account ∪ repo ∪ node)
+ owner-isolation; greenfield ⇒ account-only; HOT (pinned) always present (with NO embed when there
are no cold candidates — the offline-safe path); COLD ranked by similarity + capped at K; the budget
drops lowest-similarity COLD but NEVER hot; empty scope ⇒ empty; a forced embed error ⇒ best-effort
empty (no raise). The end-to-end injection (through ``compile_context`` + the manifest) is proven in
``test_memory_injection_executor.py``; the live embed in ``scripts/memory_injection_check.py``.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane.memory_retrieval import (
    memory_query,
    retrieve_for_node,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import NodeMemory

_DIM = 1536


def _emb(*head: float) -> list[float]:
    """A 1536-float vector with the given leading components (rest zero) — distinct DIRECTIONS give
    distinct cosine distances so COLD ranking is deterministic. The probe query embeds to ``e0`` =
    ``_emb(1.0)``; a candidate's cosine distance falls as its dim-0 share of magnitude rises."""
    vec = [0.0] * _DIM
    for i, x in enumerate(head):
        vec[i] = float(x)
    return vec


_QUERY_VEC = _emb(1.0)  # the fake query embedding every ranking test probes with


def _fresh_owner() -> uuid.UUID:
    """Register a brand-new account and return its id — a fresh owner per test so no other test's
    account-tier memories leak into this owner's scope."""
    plain = TestClient(app)
    plain.cookies.clear()
    resp = plain.post(
        "/api/auth/register",
        json={"email": f"s3-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert resp.status_code == 200, resp.text
    return uuid.UUID(resp.json()["id"])


@pytest.fixture
def owner(client) -> uuid.UUID:
    """A fresh owner (the session ``client`` fixture launches the app/DBOS + login enforcement)."""
    return _fresh_owner()


def _seed(
    owner_id: uuid.UUID,
    *,
    content: str,
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
    pinned: bool = False,
    polarity: str = "context",
    embedding: list[float] | None = None,
    status: str = "active",
) -> str:
    """Insert one ``NodeMemory`` row directly (bypassing the API + its real embed) and return its id
    as a str — full control over the scoping columns, pin, embedding, and status."""
    with session_scope() as session:
        row = NodeMemory(
            owner_id=owner_id,
            repo_key=repo_key,
            node_id=node_id,
            content=content,
            pinned=pinned,
            polarity=polarity,
            embedding=embedding,
            status=status,
        )
        session.add(row)
        session.flush()
        session.refresh(row)
        return str(row.id)


# ---------------------------------------------------------------- scope / tiering / isolation ----


def test_scope_is_account_repo_node_union_and_owner_isolated(owner):
    repo = "/repos/alpha"
    authored = uuid.uuid4()
    # In scope for (owner, repo, authored): account ∪ repo(repo) ∪ node(repo, authored). Pinned so
    # they are HOT (no embed) — this isolates the SCOPE logic from ranking/budget.
    m_acct = _seed(owner, content="account fact", pinned=True)
    m_repo = _seed(owner, content="repo fact", repo_key=repo, pinned=True)
    m_node = _seed(owner, content="node fact", repo_key=repo, node_id=authored, pinned=True)
    # OUT of scope:
    _seed(
        owner, content="other node", repo_key=repo, node_id=uuid.uuid4(), pinned=True
    )  # node(other)
    _seed(owner, content="other repo", repo_key="/repos/beta", pinned=True)  # repo(other)
    _seed(_fresh_owner(), content="owner B account", pinned=True)  # a DIFFERENT owner

    got = retrieve_for_node(owner, repo, authored, "q", embed_query=lambda _q: _QUERY_VEC)
    assert {f["id"] for f in got} == {m_acct, m_repo, m_node}


def test_greenfield_scope_is_account_only(owner):
    repo = "/repos/x"
    authored = uuid.uuid4()
    m_acct = _seed(owner, content="account", pinned=True)
    _seed(owner, content="repo", repo_key=repo, pinned=True)  # repo tier — excluded greenfield
    _seed(
        owner, content="node", repo_key=repo, node_id=authored, pinned=True
    )  # node tier — excluded
    # repo_key=None ⇒ a greenfield run ⇒ account tier ONLY.
    got = retrieve_for_node(owner, None, authored, "q", embed_query=lambda _q: _QUERY_VEC)
    assert {f["id"] for f in got} == {m_acct}


# ------------------------------------------------------------------------------- HOT (pinned) ----


def test_hot_pinned_always_returned_and_no_embed_when_no_cold(owner):
    p1 = _seed(owner, content="pinned a", pinned=True)
    p2 = _seed(owner, content="pinned b", pinned=True, polarity="require")
    calls: list[str] = []

    def record(q: str) -> list[float]:
        calls.append(q)
        return _QUERY_VEC

    got = retrieve_for_node(owner, None, None, "q", embed_query=record)
    assert {f["id"] for f in got} == {p1, p2}
    # No non-pinned candidate ⇒ the query embed is NEVER called (offline-safe / no needless spend).
    assert calls == []


# ------------------------------------------------------------------------- COLD (cosine top-K) ----


def test_cold_ranked_by_similarity_and_capped_at_k(owner):
    # Five non-pinned candidates, DISTINCT distances to the probe e0 (near→farthest). id order must
    # come back nearest-first, and K caps the tail off.
    near = _seed(owner, content="near", embedding=_emb(1.0))  # distance 0.0
    mid = _seed(owner, content="mid", embedding=_emb(1.0, 1.0))  # ~0.29
    far = _seed(owner, content="far", embedding=_emb(1.0, 3.0))  # ~0.68
    _seed(owner, content="farther", embedding=_emb(1.0, 6.0))  # ~0.84 — dropped by K=3
    _seed(owner, content="farthest", embedding=_emb(0.0, 1.0))  # 1.0 — dropped by K=3

    got = retrieve_for_node(
        owner, None, None, "q", embed_query=lambda _q: _QUERY_VEC, k=3, token_budget=10_000
    )
    assert [f["id"] for f in got] == [near, mid, far]  # exactly K, nearest-first


def test_null_query_vector_yields_no_cold(owner):
    # A pinned HOT row + a cold candidate, but the embed returns None (provider gave no data) ⇒ HOT
    # still returned, COLD skipped (no vector to rank against) — NOT a crash.
    p = _seed(owner, content="pinned", pinned=True)
    _seed(owner, content="cold", embedding=_emb(1.0))
    got = retrieve_for_node(owner, None, None, "q", embed_query=lambda _q: None)
    assert {f["id"] for f in got} == {p}


# ------------------------------------------------------------------------------------ budget ----


def test_budget_drops_lowest_similarity_cold_but_never_hot(owner):
    pin = _seed(owner, content="P" * 400, pinned=True)  # HOT ~100 tok — always kept
    near = _seed(owner, content="N" * 40, embedding=_emb(1.0))  # ~10 tok
    mid = _seed(owner, content="M" * 40, embedding=_emb(1.0, 1.0))  # ~10 tok
    far = _seed(owner, content="F" * 4000, embedding=_emb(1.0, 3.0))  # ~1000 tok — too big to fit

    # budget 130: HOT 100 + near 10 + mid 10 = 120 ≤ 130; far (1000) breaks → dropped.
    got = retrieve_for_node(
        owner, None, None, "q", embed_query=lambda _q: _QUERY_VEC, k=8, token_budget=130
    )
    ids = [f["id"] for f in got]
    assert ids[0] == pin  # HOT first, always present
    assert near in ids and mid in ids  # the cold that fits
    assert far not in ids  # the lowest-similarity cold dropped by the budget


def test_hot_kept_even_when_it_alone_exceeds_budget(owner):
    pin = _seed(owner, content="P" * 4000, pinned=True)  # ~1000 tok — over a tiny budget
    _seed(
        owner, content="cold", embedding=_emb(1.0)
    )  # a cold candidate exists (embed is attempted)
    got = retrieve_for_node(
        owner, None, None, "q", embed_query=lambda _q: _QUERY_VEC, token_budget=50
    )
    # HOT is NEVER dropped by the budget; no COLD room remains.
    assert [f["id"] for f in got] == [pin]


# ----------------------------------------------------------------------- empty / best-effort ----


def test_empty_scope_returns_empty_without_embedding(owner):
    # Only an OUT-of-scope (repo-tier) row exists → the greenfield/account scope is empty.
    _seed(owner, content="repo only", repo_key="/repos/z", embedding=_emb(1.0))
    calls: list[str] = []
    got = retrieve_for_node(
        owner,
        None,
        None,
        "q",
        embed_query=lambda q: calls.append(q) or _QUERY_VEC,
    )
    assert got == []
    assert calls == []  # nothing in scope ⇒ no cold candidate ⇒ no embed


def test_forced_embed_error_is_best_effort_empty(owner):
    # A cold candidate exists (so the embed IS attempted) + a pinned one; the embed raises →
    # the whole retrieval is best-effort empty (NO raise) so the node runs with no memory part.
    _seed(owner, content="pinned", pinned=True)
    _seed(owner, content="cold", embedding=_emb(1.0))

    def boom(_q: str) -> list[float]:
        raise RuntimeError("embedding provider down")

    assert retrieve_for_node(owner, None, None, "q", embed_query=boom) == []


def test_active_only_superseded_rows_excluded(owner):
    # A superseded (non-active) pinned row is NOT retrieved (active-only).
    _seed(owner, content="retired", pinned=True, status="superseded")
    live = _seed(owner, content="live", pinned=True, status="active")
    got = retrieve_for_node(owner, None, None, "q", embed_query=lambda _q: _QUERY_VEC)
    assert {f["id"] for f in got} == {live}


# ------------------------------------------------------------------------------- memory_query ----


def test_memory_query_is_compact_idea_prompt_and_prd_title_only():
    q = memory_query("Add a DEMA indicator.", "You are the Engineer.", "DEMA Spec\n\nDetails: EMA…")
    assert "Add a DEMA indicator." in q and "You are the Engineer." in q
    assert "DEMA Spec" in q  # the PRD TITLE (first non-blank line)…
    assert "Details:" not in q  # …not the body (compact, not the whole context)
    # No PRD (entry's first invocation) ⇒ just idea + prompt.
    assert memory_query("idea", "prompt", None) == "idea\nprompt"
    # A blank-only PRD contributes no title.
    assert memory_query("idea", "prompt", "   \n\n  ") == "idea\nprompt"


# ---- test-quality hardening (adversarial review): mutation-real budget + COLD-path isolation ----


def test_budget_keeps_similarity_prefix_not_a_smaller_lower_similarity_fact(owner):
    """The budget trim keeps a similarity PREFIX — drop the first over-budget COLD fact AND every
    lower-similarity one — so a smaller LOWER-similarity fact must NOT sneak past a dropped bigger
    HIGHER-similarity one. Kills the ``break``→``continue`` mutation of ``_apply_budget`` (the other
    budget test can't: there the over-budget item is already last, so break ≡ continue)."""
    near = _seed(owner, content="N" * 20, embedding=_emb(1.0))  # ~5 tok, most similar
    big = _seed(owner, content="B" * 4000, embedding=_emb(1.0, 1.0))  # ~1000 tok, mid similar
    tiny = _seed(owner, content="T" * 20, embedding=_emb(1.0, 3.0))  # ~5 tok, LEAST similar
    got = retrieve_for_node(
        owner, None, None, "q", embed_query=lambda _q: _QUERY_VEC, k=8, token_budget=50
    )
    ids = [f["id"] for f in got]
    assert ids == [near]  # only the highest-similarity prefix that fits…
    assert big not in ids and tiny not in ids  # …NOT the smaller-but-lower-similarity `tiny`


def test_cold_select_excludes_foreign_owner_out_of_scope_and_superseded(owner):
    """Owner-isolation + tier-scoping + active-only ON THE COLD pgvector path (the scope test above
    is HOT-only, so the COLD select's OWN where-clause is otherwise unexercised). A real COLD
    candidate forces the select to run; the foreign-owner / out-of-repo / superseded cold rows must
    all be excluded — kills dropping owner_id / scope / status / pinned from the COLD select."""
    other = _fresh_owner()
    repo = "/repos/alpha"
    authored = uuid.uuid4()
    mine = _seed(owner, content="mine repo cold", repo_key=repo, embedding=_emb(1.0))
    _seed(other, content="foreign owner cold", repo_key=repo, embedding=_emb(1.0))  # foreign owner
    _seed(
        owner, content="other repo cold", repo_key="/repos/beta", embedding=_emb(1.0)
    )  # off-scope
    _seed(
        owner, content="superseded cold", repo_key=repo, embedding=_emb(1.0), status="superseded"
    )  # inactive
    got = retrieve_for_node(owner, repo, authored, "q", embed_query=lambda _q: _QUERY_VEC)
    assert {f["id"] for f in got} == {mine}  # only my active, in-scope, non-pinned COLD row


def test_no_embed_for_in_scope_nonpinned_but_unembedded_row(owner):
    """The 'no needless embed' gate is ``pinned IS FALSE AND embedding IS NOT NULL`` — an in-scope
    non-pinned row not yet embedded is NOT a cold candidate, so the query embed must NOT fire
    (kills dropping the ``embedding.isnot(None)`` clause from the has_cold probe: a real run-path
    embed = a needless gateway call + an on-run cost row)."""
    _seed(owner, content="not embedded yet", embedding=None)  # non-pinned, NULL embedding, in scope
    calls: list[str] = []
    got = retrieve_for_node(
        owner, None, None, "q", embed_query=lambda q: calls.append(q) or _QUERY_VEC
    )
    assert got == []  # nothing injectable (no HOT, no embedded COLD)
    assert calls == []  # and NO needless embed / spend
