"""B-MEMORY (frontend revamp) — repo identity, provenance, scope edits, requeue, counts, repos.

Offline: the gateway ``embed`` / ``complete`` are monkeypatched everywhere a memory module calls
them (never a real provider). Every test registers a FRESH account so counts, repos and scopes are
pristine and owner isolation is real.
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from tvashtr.control_plane import (
    github_app,
    memory,
    memory_distill,
    memory_review,
    team_run,
)
from tvashtr.control_plane.credentials import encrypt_secret
from tvashtr.control_plane.memory import repo_key_for_run, repo_label
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import get_engine, session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.main import app
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    GithubInstallation,
    NodeMemory,
    ProviderCredential,
    Run,
    TeamGraph,
)

_DIM = 1536
_TOPICS: dict[str, int] = {}


def _topic_vector(text: str) -> list[float]:
    """Same leading ``topic:`` ⇒ the same one-hot vector (cosine 1.0); other topics orthogonal."""
    topic = text.split(":", 1)[0].strip().lower()
    v = [0.0] * _DIM
    v[_TOPICS.setdefault(topic, len(_TOPICS)) % _DIM] = 1.0
    return v


def _embedding_result(request) -> EmbeddingResult:
    return EmbeddingResult(
        vectors=[_topic_vector(t) for t in request.input],
        model=request.model,
        prompt_tokens=3,
        total_tokens=3,
        cost_usd=0.0,
        raw_provider="openai",
        latency_ms=0.3,
    )


@pytest.fixture(autouse=True)
def _offline_embed(monkeypatch):
    """Every memory module's embed is fake; records the ``api_key`` each call used."""
    calls: list[str | None] = []

    def fake(request):
        calls.append(request.api_key)
        return _embedding_result(request)

    monkeypatch.setattr(memory, "embed", fake)
    monkeypatch.setattr(memory_distill, "embed", fake)
    return calls


class _Account:
    def __init__(self) -> None:
        self.client = TestClient(app)
        self.client.cookies.clear()
        resp = self.client.post(
            "/api/auth/register",
            json={"email": f"mem-rev-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
        )
        assert resp.status_code == 200, resp.text
        self.id = uuid.UUID(resp.json()["id"])

    def give_openai_key(self) -> None:
        with session_scope() as session:
            session.add(
                ProviderCredential(
                    owner_id=self.id,
                    provider="openai",
                    secret_encrypted=encrypt_secret("sk-owner-openai-0000"),
                    key_last4="0000",
                )
            )


@pytest.fixture
def acct(client) -> _Account:  # ``client`` launches the app + DBOS once for the session
    return _Account()


def _library_team(owner: uuid.UUID, name: str = "Indicator sprint team") -> dict[str, uuid.UUID]:
    """A review-loop team made the owner's library team; returns ``{"team": id, role: node id}``.
    The engineer gets a config title so ``agent.title`` is exercised."""
    team_id = uuid.UUID(build_review_loop_team())
    with session_scope() as session:
        graph = session.get(TeamGraph, team_id)
        graph.name, graph.is_library, graph.owner_id = name, True, owner
        nodes = session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == team_id)
        ).scalars()
        out: dict[str, uuid.UUID] = {"team": team_id}
        for n in nodes:
            out[n.role_name] = n.id
            if n.role_name == "engineer":
                n.config = {**(n.config or {}), "title": "Builder"}
    return out


def _seed_run(
    owner: uuid.UUID,
    team: dict[str, uuid.UUID],
    *,
    status: str = "completed",
    github_repo: str | None = None,
    repo_path: str | None = None,
    idea: str = "Add an RSI indicator",
) -> str:
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=team["team"],
                library_team_id=team["team"],
                owner_id=owner,
                idea=idea,
                workflow_id=str(run_id),
                status=status,
                github_repo=github_repo,
                repo_path=repo_path,
            )
        )
    return str(run_id)


def _invoke(run_id: str, node_id: uuid.UUID, iteration: int, status: str = "done") -> int:
    with session_scope() as session:
        inv = AgentInvocation(
            run_id=run_id, node_id=node_id, iteration=iteration, status=status, outcome="approved"
        )
        session.add(inv)
        session.flush()
        return inv.id


def _seed_memory(owner: uuid.UUID, content: str, **cols) -> str:
    with session_scope() as session:
        row = NodeMemory(owner_id=owner, content=content, embedding=_topic_vector(content), **cols)
        session.add(row)
        session.flush()
        return str(row.id)


def _row(memory_id: str) -> NodeMemory:
    with session_scope() as session:
        row = session.get(NodeMemory, uuid.UUID(memory_id))
        session.expunge(row)
        return row


def _patch_distiller(monkeypatch, facts: list[dict], seen_keys: list) -> None:
    def fake(request):
        seen_keys.append(request.api_key)
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


# ------------------------------------------------------------------ repo identity (pure) ----


def test_repo_key_for_run_prefers_the_github_repo():
    clone = "/srv/repos/trade_mcp/.tvashtr_clones/abc"
    assert repo_key_for_run("octo/trade_mcp", clone) == "octo/trade_mcp"
    assert repo_key_for_run(None, "/Users/me/code/app") == "/Users/me/code/app"
    assert repo_key_for_run(None, None) is None
    # A Desktop folder run clones into a new server directory every time; its memories key on the
    # folder's label on the user's computer, which stays the same run to run.
    assert repo_key_for_run(None, "/data/local/run-1", "~/code/trade_mcp") == "~/code/trade_mcp"
    assert repo_label("~/code/trade_mcp") == "trade_mcp"


def test_repo_label_rules():
    assert repo_label("lazyxgenius/trade_mcp") == "lazyxgenius/trade_mcp"
    assert repo_label("/Users/me/code/app/") == "app"
    assert repo_label("/srv/repos/trade_mcp/.tvashtr_clones/1234") == "trade_mcp"
    assert repo_label("C:\\code\\app") == "app"
    assert repo_label(None) is None


# ---------------------------------------------------- write/read sites use owner/name ----


def test_distill_keys_a_hosted_run_by_github_repo_and_records_provenance(acct, monkeypatch):
    acct.give_openai_key()
    team = _library_team(acct.id)
    repo = f"octo/{uuid.uuid4().hex[:8]}"
    run_id = _seed_run(
        acct.id, team, github_repo=repo, repo_path=f"/srv/r/.tvashtr_clones/{uuid.uuid4()}"
    )
    _invoke(run_id, team["engineer"], 1)
    last = _invoke(run_id, team["engineer"], 3)
    _invoke(run_id, team["reviewer"], 1)
    keys: list = []
    _patch_distiller(
        monkeypatch,
        [
            {
                "op": "ADD",
                "content": f"{uuid.uuid4().hex}: run the linter before shipping",
                "tier": "repo",
                "node_role": "engineer",
                "polarity": "prefer",
            }
        ],
        keys,
    )
    result = memory_distill.distill_run(run_id)
    assert result["written"] == 1 and result["key"] == "owner"
    assert keys == ["sk-owner-openai-0000"]  # the owner's own key, unchanged behaviour

    [mem] = acct.client.get(f"/api/memories?repo_key={repo}").json()["memories"]
    assert mem["repo_key"] == repo and mem["repo_label"] == repo
    assert mem["source_invocation_id"] == last
    assert mem["source_node_id"] == str(team["engineer"])
    assert mem["source_iteration"] == 3
    assert mem["agent"] is None  # repo-tier: not scoped to an agent
    assert mem["source"] == {
        "kind": "run",
        "run_id": run_id,
        "run_title": "Add an RSI indicator",
        "run_status": "completed",
        "run_succeeded": True,
        "round": 3,
        "agent_role": "engineer",
        "team_name": "Indicator sprint team",
        "node_id": str(team["engineer"]),
    }


def test_distill_falls_back_to_the_operator_key_off_ledger(acct, monkeypatch, _offline_embed):
    # A fresh account holds NO OpenAI key (Desktop subscription users): distillation still runs,
    # with api_key=None (litellm's operator .env key), and its cost is NOT put on the run.
    team = _library_team(acct.id)
    run_id = _seed_run(acct.id, team, github_repo="octo/keyless")
    _invoke(run_id, team["engineer"], 1)
    keys: list = []
    _patch_distiller(
        monkeypatch,
        [{"op": "ADD", "content": f"{uuid.uuid4().hex}: tests live in tests/", "tier": "repo"}],
        keys,
    )
    result = memory_distill.distill_run(run_id)
    assert result["key"] == "operator" and result["written"] == 1
    assert keys == [None] and _offline_embed == [None]
    with session_scope() as session:
        on_run = session.execute(select(CostRecord).where(CostRecord.workflow_id == run_id)).all()
        off = session.execute(
            select(CostRecord).where(
                CostRecord.idempotency_key == f"{run_id}:memory-distill",
                CostRecord.workflow_id.is_(None),
            )
        ).all()
    assert on_run == [] and len(off) == 1
    [mem] = acct.client.get("/api/memories?repo_key=octo/keyless").json()["memories"]
    assert mem["source"]["agent_role"] == "engineer"  # the only role that ran taught it


def test_agent_remember_ingest_keys_by_github_repo_and_works_keyless(acct, tmp_path):
    team = _library_team(acct.id)
    run_id = _seed_run(
        acct.id, team, github_repo="octo/remember", repo_path=str(tmp_path / ".tvashtr_clones/x")
    )
    (tmp_path / "TVASHTR_REMEMBER.jsonl").write_text(
        json.dumps({"content": f"{uuid.uuid4().hex}: prices are Decimal", "polarity": "require"})
    )
    out = memory_review.ingest_run_remembers(run_id, str(tmp_path))
    assert out["written"] == 1
    [mem] = acct.client.get("/api/memories?repo_key=octo/remember").json()["memories"]
    assert mem["polarity"] == "require" and mem["source"]["run_id"] == run_id


def test_retrieval_step_reads_the_github_repo_key(acct):
    team = _library_team(acct.id)
    run_id = _seed_run(
        acct.id, team, github_repo="octo/carry", repo_path=f"/x/.tvashtr_clones/{uuid.uuid4()}"
    )
    pinned = _seed_memory(acct.id, "carry: uses uv", repo_key="octo/carry", pinned=True)
    got = team_run.retrieve_memory_step(run_id, str(team["engineer"]), 1, "q")
    assert [f["id"] for f in got] == [pinned]


def test_retrieval_step_keeps_pinned_facts_for_a_keyless_owner(acct):
    # The run path resolves the owner's key lazily inside the embed; a keyless owner raises there.
    # Pinned facts must still be injected (they used to be dropped with everything else).
    team = _library_team(acct.id)
    run_id = _seed_run(acct.id, team, github_repo="octo/nokey")
    pinned = _seed_memory(acct.id, "nokey: MUST keep docs", repo_key="octo/nokey", pinned=True)
    cold = _seed_memory(acct.id, "nokeycold: a cold fact", repo_key="octo/nokey")
    got = [f["id"] for f in team_run.retrieve_memory_step(run_id, str(team["engineer"]), 1, "q")]
    assert got[0] == pinned and set(got) == {pinned, cold}


# ------------------------------------------------------------------ enrichment ----


def test_agent_is_resolved_owner_scoped_and_dangling_is_blank(acct):
    team = _library_team(acct.id)
    mine = _seed_memory(acct.id, "a: strict", repo_key="octo/a", node_id=team["engineer"])
    dangling_node = uuid.uuid4()
    dangling = _seed_memory(acct.id, "b: gone", node_id=dangling_node)
    other = _Account()
    theirs = _library_team(other.id, name="Secret team")
    foreign = _seed_memory(acct.id, "c: foreign", node_id=theirs["engineer"])

    by_id = {m["id"]: m for m in acct.client.get("/api/memories").json()["memories"]}
    assert by_id[mine]["agent"] == {
        "node_id": str(team["engineer"]),
        "role_name": "engineer",
        "title": "Builder",
        "team_id": str(team["team"]),
        "team_name": "Indicator sprint team",
    }
    assert by_id[dangling]["agent"]["role_name"] is None
    assert by_id[dangling]["tier"] == "node" and by_id[dangling]["repo_key"] is None
    # Another account's agent never leaks its role or team name.
    assert by_id[foreign]["agent"] == {
        "node_id": str(theirs["engineer"]),
        "role_name": None,
        "title": None,
        "team_id": None,
        "team_name": None,
    }
    assert by_id[mine]["source"]["kind"] == "manual"


def test_listing_enrichment_is_batched_not_n_plus_one(acct):
    team = _library_team(acct.id)

    def count_selects(n: int) -> int:
        owner = _Account()
        for i in range(n):
            run_id = _seed_run(owner.id, team)
            inv = _invoke(run_id, team["engineer"], i + 1)
            _seed_memory(
                owner.id,
                f"n{i}: fact",
                node_id=team["reviewer"],
                source_run_id=run_id,
                source_invocation_id=inv,
                source_node_id=team["engineer"],
            )
        statements: list[str] = []

        def on_exec(conn, cursor, statement, *args):  # noqa: ARG001
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", on_exec)
        try:
            rows = memory.list_memories(owner.id)
        finally:
            event.remove(engine, "before_cursor_execute", on_exec)
        assert len(rows) == n and all(r["source"]["round"] is not None for r in rows)
        return len(statements)

    assert count_selects(2) == count_selects(6)


def test_superseded_by_and_edited_at_are_serialized(acct):
    newer = _seed_memory(acct.id, "s: newer")
    older = _seed_memory(acct.id, "s: older", status="superseded", superseded_by=uuid.UUID(newer))
    [row] = acct.client.get("/api/memories?status=superseded").json()["memories"]
    assert row["id"] == older and row["superseded_by"] == newer
    assert row["edited_at"] is None


# ------------------------------------------------------------------ Archive: superseded_reason ----


def _archived(client, memory_id: str) -> dict:
    rows = client.get("/api/memories?status=superseded").json()["memories"]
    return next(r for r in rows if r["id"] == memory_id)


def test_superseded_reason_merged_when_a_restore_folds_into_a_same_force_fact(acct):
    topic = uuid.uuid4().hex
    _seed_memory(acct.id, f"{topic}: pin numpy", polarity="require")
    discarded = _seed_memory(
        acct.id, f"{topic}: pin numpy please", polarity="prefer", status="rejected"
    )
    restored = acct.client.post(f"/api/memories/{discarded}/promote").json()
    assert restored["action"] == "promote_merged"
    assert _archived(acct.client, discarded)["superseded_reason"] == "merged"


def test_superseded_reason_replaced_when_the_newer_fact_says_the_opposite(acct):
    newer = _seed_memory(acct.id, "r: never pin numpy", polarity="forbid")
    older = _seed_memory(
        acct.id,
        "r: pin numpy",
        polarity="require",
        status="superseded",
        superseded_by=uuid.UUID(newer),
    )
    assert _archived(acct.client, older)["superseded_reason"] == "replaced"


def test_superseded_reason_is_null_once_a_force_is_edited_after_the_retirement(acct):
    """The reason is read from the two facts' forces; an edit after the retirement can change a
    force, so how it was retired can't be told any more and the reason is null (not flipped)."""
    topic = uuid.uuid4().hex
    kept = _seed_memory(acct.id, f"{topic}: pin numpy", polarity="require")
    discarded = _seed_memory(
        acct.id, f"{topic}: pin numpy please", polarity="prefer", status="rejected"
    )
    assert acct.client.post(f"/api/memories/{discarded}/promote").json()["action"] == (
        "promote_merged"
    )
    assert _archived(acct.client, discarded)["superseded_reason"] == "merged"
    r = acct.client.patch(f"/api/memories/{kept}", json={"polarity": "forbid"})
    assert r.status_code == 200, r.text
    assert _archived(acct.client, discarded)["superseded_reason"] is None


def test_superseded_reason_is_null_off_archive_and_for_a_gone_or_foreign_fact(acct):
    live = _seed_memory(acct.id, "n: a live fact")
    [row] = [r for r in acct.client.get("/api/memories").json()["memories"] if r["id"] == live]
    assert row["superseded_reason"] is None

    gone = _seed_memory(
        acct.id, "n: its fact was deleted", status="superseded", superseded_by=uuid.uuid4()
    )
    assert _archived(acct.client, gone)["superseded_reason"] is None

    # Another account's memory never leaks its force into this account's Archive.
    theirs = _seed_memory(_Account().id, "n: someone else's fact", polarity="context")
    foreign = _seed_memory(
        acct.id,
        "n: points at another account",
        polarity="context",
        status="superseded",
        superseded_by=uuid.UUID(theirs),
    )
    assert _archived(acct.client, foreign)["superseded_reason"] is None


# ------------------------------------------------------------------ PATCH scope + edited_at ----


def test_patch_scope_account_repo_agent_and_node_only(acct):
    team = _library_team(acct.id)
    run_id = _seed_run(acct.id, team, github_repo="octo/scoped")
    mid = _seed_memory(
        acct.id, "scope: a fact", source_run_id=run_id, source_node_id=team["reviewer"]
    )
    c = acct.client

    # account → repo: falls back to the source run's repo.
    r = c.patch(f"/api/memories/{mid}", json={"scope": "repo"}).json()
    assert (r["tier"], r["repo_key"], r["node_id"]) == ("repo", "octo/scoped", None)
    assert r["edited_at"] is not None

    # repo → agent: the learner becomes the agent; the repo stays.
    r = c.patch(f"/api/memories/{mid}", json={"scope": "agent"}).json()
    assert (r["tier"], r["repo_key"], r["node_id"]) == (
        "node",
        "octo/scoped",
        str(team["reviewer"]),
    )
    assert r["agent"]["role_name"] == "reviewer"

    # agent + explicit null repo → node-only ("Not repo-specific").
    r = c.patch(f"/api/memories/{mid}", json={"scope": "agent", "repo_key": None}).json()
    assert (r["tier"], r["repo_key"]) == ("node", None)

    # repo with an explicit repo_key.
    r = c.patch(f"/api/memories/{mid}", json={"scope": "repo", "repo_key": "octo/other"}).json()
    assert (r["tier"], r["repo_key"], r["node_id"]) == ("repo", "octo/other", None)

    # → account.
    r = c.patch(f"/api/memories/{mid}", json={"scope": "account"}).json()
    assert (r["tier"], r["repo_key"], r["node_id"]) == ("account", None, None)


def test_patch_scope_errors(acct):
    c = acct.client
    manual = c.post("/api/memories", json={"content": "err: manual"}).json()["id"]
    resp = c.patch(f"/api/memories/{manual}", json={"scope": "repo"})
    assert (
        resp.status_code == 422 and resp.json()["detail"] == "This memory has no repo to scope to."
    )
    resp = c.patch(f"/api/memories/{manual}", json={"scope": "agent"})
    assert (
        resp.status_code == 422 and resp.json()["detail"] == "This memory has no agent to scope to."
    )
    resp = c.patch(f"/api/memories/{manual}", json={"scope": "team"})
    assert resp.json()["detail"] == "scope must be one of account, repo, agent"
    resp = c.patch(f"/api/memories/{manual}", json={"repo_key": "octo/x"})
    assert resp.status_code == 422 and resp.json()["detail"] == "Send a scope with repo_key."
    assert _row(manual).edited_at is None  # a refused edit changes nothing
    # Another account's memory → 404.
    assert (
        _Account().client.patch(f"/api/memories/{manual}", json={"scope": "account"}).status_code
        == 404
    )


def test_edited_at_moves_on_content_force_scope_not_on_pin(acct):
    c = acct.client
    mid = c.post("/api/memories", json={"content": "edit: original"}).json()["id"]
    assert c.post(f"/api/memories/{mid}/pin").json()["edited_at"] is None
    same = c.patch(
        f"/api/memories/{mid}", json={"content": "edit: original", "polarity": "context"}
    )
    assert same.json()["edited_at"] is None  # nothing really changed
    first = c.patch(f"/api/memories/{mid}", json={"polarity": "forbid"}).json()["edited_at"]
    assert first is not None
    second = c.patch(f"/api/memories/{mid}", json={"content": "edit: rewritten"}).json()
    assert second["edited_at"] > first and second["content"] == "edit: rewritten"


# ------------------------------------------------------------------ requeue ----


def test_requeue_undoes_a_plain_promote(acct):
    c = acct.client
    mid = _seed_memory(acct.id, f"{uuid.uuid4().hex}: pending", status="pending_review")
    assert c.post(f"/api/memories/{mid}/promote").json()["action"] == "promote"
    r = c.post(f"/api/memories/{mid}/requeue").json()
    assert r["status"] == "pending_review" and r["action"] == "requeue"
    assert r["restored"] == [] and r["unmerged_from"] is None
    again = c.post(f"/api/memories/{mid}/requeue").json()
    assert again["action"] == "already_pending" and again["status"] == "pending_review"


def test_requeue_undoes_promote_supersede(acct):
    topic = uuid.uuid4().hex
    old = _seed_memory(acct.id, f"{topic}: use sqlite", polarity="prefer", repo_key="octo/s")
    new = _seed_memory(
        acct.id,
        f"{topic}: avoid sqlite",
        polarity="avoid",
        repo_key="octo/s",
        status="pending_review",
    )
    kept = acct.client.post(f"/api/memories/{new}/promote").json()
    assert kept["action"] == "promote_supersede" and kept["superseded"] == old
    assert _row(old).status == "superseded"

    r = acct.client.post(f"/api/memories/{new}/requeue").json()
    assert r["status"] == "pending_review" and r["restored"] == [old]
    restored = _row(old)
    assert (restored.status, restored.invalid_at, restored.superseded_by) == ("active", None, None)


def test_requeue_undoes_promote_merged(acct):
    topic = uuid.uuid4().hex
    dup = _seed_memory(acct.id, f"{topic}: pin numpy", polarity="require", confirmation_count=2)
    pending = _seed_memory(
        acct.id, f"{topic}: pin numpy please", polarity="require", status="pending_review"
    )
    merged = acct.client.post(f"/api/memories/{pending}/promote").json()
    assert merged["action"] == "promote_merged" and merged["id"] == dup
    assert merged["merged_id"] == pending and merged["confirmation_count"] == 3

    r = acct.client.post(f"/api/memories/{merged['merged_id']}/requeue").json()
    assert r["id"] == pending and r["status"] == "pending_review"
    assert r["unmerged_from"] == dup and r["superseded_by"] is None and r["invalid_at"] is None
    assert _row(dup).confirmation_count == 2 and _row(dup).status == "active"


def test_requeue_undoes_reject(acct):
    mid = _seed_memory(acct.id, f"{uuid.uuid4().hex}: wrong", status="pending_review")
    assert acct.client.post(f"/api/memories/{mid}/reject").json()["status"] == "rejected"
    r = acct.client.post(f"/api/memories/{mid}/requeue").json()
    assert r["status"] == "pending_review" and r["invalid_at"] is None


def test_requeue_is_owner_scoped(acct):
    mid = _seed_memory(acct.id, f"{uuid.uuid4().hex}: mine")
    assert _Account().client.post(f"/api/memories/{mid}/requeue").status_code == 404
    assert acct.client.post(f"/api/memories/{uuid.uuid4()}/requeue").status_code == 404
    assert acct.client.post("/api/memories/not-a-uuid/requeue").status_code == 404
    assert _row(mid).status == "active"


# ------------------------------------------------------------------ counts + repos ----


def test_counts(acct):
    for status in ("pending_review", "pending_review", "active", "superseded", "rejected"):
        _seed_memory(acct.id, f"{uuid.uuid4().hex}: x", status=status)
    assert acct.client.get("/api/memories/counts").json() == {
        "inbox": 2,
        "active": 1,
        "archive": 2,
    }
    assert _Account().client.get("/api/memories/counts").json() == {
        "inbox": 0,
        "active": 0,
        "archive": 0,
    }


def test_memory_repos_merges_memories_and_runs(acct):
    team = _library_team(acct.id)
    _seed_memory(acct.id, "r1: a", repo_key="octo/zeta")
    _seed_memory(acct.id, "r2: b", repo_key="octo/zeta", status="pending_review")
    _seed_memory(acct.id, "r3: c", repo_key="octo/zeta", status="rejected")  # not counted
    _seed_memory(acct.id, "r4: d", repo_key="/Users/me/code/Alpha")
    _seed_run(acct.id, team, github_repo="octo/beta", repo_path="/s/.tvashtr_clones/1")
    _seed_run(acct.id, team, repo_path="/Users/me/code/Alpha")
    _seed_memory(_Account().id, "r5: e", repo_key="octo/other-account")

    repos = acct.client.get("/api/memory/repos").json()["repos"]
    assert [r["repo_key"] for r in repos] == ["/Users/me/code/Alpha", "octo/beta", "octo/zeta"]
    by_key = {r["repo_key"]: r for r in repos}
    assert by_key["/Users/me/code/Alpha"]["label"] == "Alpha"
    assert by_key["octo/zeta"] == {
        "repo_key": "octo/zeta",
        "label": "octo/zeta",
        "memory_count": 1,
        "pending_count": 1,
        "last_run_at": None,
    }
    assert by_key["octo/beta"]["memory_count"] == 0
    assert by_key["octo/beta"]["last_run_at"] is not None


def test_memory_repos_include_github_is_opt_in_and_best_effort(acct, monkeypatch):
    install_id = int(uuid.uuid4().int % 1_000_000_000)
    with session_scope() as session:
        session.add(GithubInstallation(installation_id=install_id, owner_id=acct.id))
    calls: list[int] = []

    def fake_list(installation_id: int) -> list[dict]:
        calls.append(installation_id)
        return [{"full_name": "octo/from-app", "name": "from-app"}]

    monkeypatch.setattr(github_app, "list_installation_repositories", fake_list)
    assert acct.client.get("/api/memory/repos").json()["repos"] == []
    assert calls == []  # default read never touches GitHub
    repos = acct.client.get("/api/memory/repos?include_github=true").json()["repos"]
    assert [r["repo_key"] for r in repos] == ["octo/from-app"] and calls == [install_id]

    def broken(_installation_id: int) -> list[dict]:
        raise github_app.GithubAppError("down")

    monkeypatch.setattr(github_app, "list_installation_repositories", broken)
    assert acct.client.get("/api/memory/repos?include_github=true").json()["repos"] == []


def test_new_endpoints_require_login(unauth_client):
    assert unauth_client.get("/api/memories/counts").status_code == 401
    assert unauth_client.get("/api/memory/repos").status_code == 401
    assert unauth_client.post(f"/api/memories/{uuid.uuid4()}/requeue").status_code == 401
