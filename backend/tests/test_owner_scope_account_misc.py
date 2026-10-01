"""Security S1 item C — the owner-scoping sweep for the account / providers / engines / memories /
documents / github / misc routes.

Two fresh accounts per test (``fresh_account``: own cookie jar). For every route that takes an
object id, account A owns the object and account B calls the route with A's id and an otherwise
valid request: B must get a 404 that carries none of A's data, A's object must be unchanged, and the
same request by A must NOT 404 (so B's 404 comes from ownership, not a bad path or body). For every
list route, A's row shows in A's list and never in B's. Every external call (GitHub, the embedding
and completion gateway) is faked; nothing touches the network.
"""

import hashlib
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from dbos import DBOS
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, update
from toolkit_helpers import fresh_account, make_node, make_team

from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_jobs, doc_writer, github_app, memory
from tvashtr.control_plane import toolkit as toolkit_cp
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    create_document_with_initial_version,
    get_document_with_versions,
)
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.models import (
    AgentNode,
    CostRecord,
    EngineSubscriptionStatus,
    GithubInstallation,
    NodeMemory,
    ProviderCredential,
    Run,
    TeamGraph,
)

# The session ``client`` only launches the app lifespan (DBOS) once; it is never account A or B.
pytestmark = pytest.mark.usefixtures("client")


def _marker(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:10]}"


@pytest.fixture
def a():
    return fresh_account()


@pytest.fixture
def b():
    return fresh_account()


@pytest.fixture(autouse=True)
def _fake_embed(monkeypatch):
    """The memory service's embedding call — offline, deterministic, 1536-dim."""

    def fake(request):
        vectors = []
        for text in request.input:
            seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")
            vectors.append([((seed + i * 2654435761) % 1000) / 1000.0 for i in range(1536)])
        return EmbeddingResult(
            vectors=vectors,
            model=request.model,
            prompt_tokens=4,
            total_tokens=4,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=0.5,
        )

    monkeypatch.setattr(memory, "embed", fake)


def _snap(model, *where) -> list[dict]:
    """Every column (bar the embedding vector) of the rows matching ``where`` — the before/after
    proof that B's call left A's row alone."""
    with session_scope() as s:
        rows = s.execute(select(model).where(*where)).scalars().all()
        keys = [c.key for c in sa_inspect(model).column_attrs if c.key != "embedding"]
        return [{k: getattr(r, k) for k in keys} for r in rows]


def _verdict(rb, ra, *, before=None, after=None, leaks=()) -> None:
    """The four checks of an id route, all reported together so a failure shows every problem."""
    problems = []
    if after != before:
        problems.append(f"B's call changed A's object: {before} -> {after}")
    if rb.status_code != 404:
        problems.append(f"B got {rb.status_code} (want 404)")
    leaked = [leak for leak in leaks if leak in rb.text]
    if leaked:
        problems.append(f"B's response leaks A's {leaked}")
    if not ra.is_success:  # 2xx, not merely "not 404": A's identical request really works
        problems.append(f"positive control: A got {ra.status_code}: {ra.text[:300]}")
    assert not problems, "; ".join(problems) + f" | B's body: {rb.text[:600]}"


def _owned_run(owner_id: uuid.UUID, **fields) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner_id,
                idea="owner scope sweep",
                workflow_id=run_id,
                status="running",
                **fields,
            )
        )
    return run_id


# ------------------------------------------------------------------------------ documents


def _owned_document(owner_id: uuid.UUID) -> tuple[str, str]:
    """A spec document owned by A through A's run; returns ``(document_id, secret content)``."""
    run_id = _owned_run(owner_id)
    secret = _marker("a-spec")
    doc = create_document_with_initial_version(
        f"Spec {secret}",
        "prd",
        secret,
        "agent:entry",
        f"{run_id}:pm-prd-v1",
        run_id=uuid.UUID(run_id),
        name="spec",
    )
    with session_scope() as s:
        s.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=doc.id))
    return str(doc.id), secret


def _versions(doc_id: str) -> list[str]:
    return [v.content for v in get_document_with_versions(uuid.UUID(doc_id)).versions]


def test_document_read_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    doc_id, secret = _owned_document(a_id)
    rb = cb.get(f"/api/documents/{doc_id}")
    ra = ca.get(f"/api/documents/{doc_id}")
    _verdict(rb, ra, leaks=(secret,))
    assert secret in ra.text


def test_document_version_append_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    doc_id, secret = _owned_document(a_id)
    before = _versions(doc_id)
    rb = cb.post(f"/api/documents/{doc_id}/versions", json={"content": "B hijack", "note": "x"})
    after = _versions(doc_id)
    ra = ca.post(f"/api/documents/{doc_id}/versions", json={"content": "A's own edit"})
    _verdict(rb, ra, before=before, after=after, leaks=(secret,))
    assert ra.status_code == 200, ra.text
    assert _versions(doc_id) == [secret, "A's own edit"]


def test_documents_list_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    doc_id, secret = _owned_document(a_id)
    assert doc_id in {d["id"] for d in ca.get("/api/documents").json()["documents"]}
    rb = cb.get("/api/documents")
    assert rb.status_code == 200, rb.text
    assert doc_id not in rb.text and secret not in rb.text


# ------------------------------------------------------------------------------ spike workflow


def test_spike_generate_doc_status_is_owner_scoped_run_workflow(a, b):
    """``GET /api/spike/generate-doc/{workflow_id}`` with A's RUN workflow id (a run's workflow_id
    is its run id) returns that workflow's cost rows to whoever asks."""
    (ca, a_id), (cb, _) = a, b
    run_wf = _owned_run(a_id)
    secret_key, secret_model = f"{run_wf}:{_marker('a-cost')}", _marker("a-model")
    with session_scope() as s:
        s.add(
            CostRecord(
                workflow_id=run_wf,
                idempotency_key=secret_key,
                model_requested=secret_model,
                model_used=secret_model,
                prompt_tokens=11,
                completion_tokens=22,
                total_tokens=33,
                cost_usd=Decimal("0.123456"),
            )
        )
    rb = cb.get(f"/api/spike/generate-doc/{run_wf}")
    ra = ca.get(f"/api/spike/generate-doc/{run_wf}")
    _verdict(rb, ra, leaks=(secret_key, secret_model))


def test_spike_generate_doc_status_is_owner_scoped_started_workflow(a, b, monkeypatch):
    """A starts a generate-doc workflow (``POST``); B reads it back with A's workflow id."""
    (ca, _), (cb, _) = a, b
    model = _marker("a-doc-model")
    monkeypatch.setattr(
        doc_writer,
        "complete",
        lambda request: CompletionResult(
            text="A's private PRD.",
            model_requested=model,
            model_used=model,
            prompt_tokens=5,
            completion_tokens=5,
            total_tokens=10,
            cost_usd=0.0,
            raw_provider="openrouter",
            latency_ms=1.0,
        ),
    )
    started = ca.post("/api/spike/generate-doc", json={"topic": "A's secret product"})
    assert started.status_code == 200, started.text
    wf_id = started.json()["workflow_id"]
    document_id = DBOS.retrieve_workflow(wf_id).get_result()["document_id"]
    rb = cb.get(f"/api/spike/generate-doc/{wf_id}")
    ra = ca.get(f"/api/spike/generate-doc/{wf_id}")
    _verdict(rb, ra, leaks=(document_id, model))


# ------------------------------------------------------------------------------ providers


def test_providers_list_is_owner_scoped(a, b):
    (ca, _), (cb, _) = a, b
    a_key, b_key = _marker("sk-a"), _marker("sk-b")
    assert ca.post("/api/providers", json={"provider": "openrouter", "api_key": a_key}).is_success
    assert cb.post("/api/providers", json={"provider": "openrouter", "api_key": b_key}).is_success
    mine = ca.get("/api/providers").json()["providers"]
    assert [p["key_last4"] for p in mine] == [a_key[-4:]]
    rb = cb.get("/api/providers")
    assert rb.status_code == 200, rb.text
    assert [p["key_last4"] for p in rb.json()["providers"]] == [b_key[-4:]]
    assert a_key[-4:] not in rb.text


def test_provider_add_never_touches_another_accounts_key(a, b):
    """``POST /api/providers`` is create-or-replace of the CALLER's key: B saving the same provider
    slug creates B's own row and leaves A's untouched."""
    (ca, a_id), (cb, _) = a, b
    a_key = _marker("sk-a")
    assert ca.post("/api/providers", json={"provider": "openrouter", "api_key": a_key}).is_success
    before = _snap(ProviderCredential, ProviderCredential.owner_id == a_id)
    rb = cb.post("/api/providers", json={"provider": "openrouter", "api_key": _marker("sk-b")})
    assert _snap(ProviderCredential, ProviderCredential.owner_id == a_id) == before
    assert rb.status_code == 200, rb.text
    assert rb.json()["replaced"] is False and a_key[-4:] not in rb.text


def test_provider_delete_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    a_key = _marker("sk-a")
    assert ca.post("/api/providers", json={"provider": "openrouter", "api_key": a_key}).is_success
    where = (ProviderCredential.owner_id == a_id, ProviderCredential.provider == "openrouter")
    before = _snap(ProviderCredential, *where)
    rb = cb.delete("/api/providers/openrouter")
    after = _snap(ProviderCredential, *where)
    ra = ca.delete("/api/providers/openrouter")
    assert _snap(ProviderCredential, *where) == []  # A's own delete really removed it
    _verdict(rb, ra, before=before, after=after, leaks=(a_key[-4:],))


# ------------------------------------------------------------------------------ engines


def _subscribe(c, hint: str):
    resp = c.put(
        "/api/engines/subscriptions/claude",
        json={"connected": True, "state": "connected", "account_hint": hint, "source": "harness"},
    )
    assert resp.status_code == 200, resp.text
    return resp


def test_engine_subscriptions_list_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    hint = _marker("a-hint")
    _subscribe(ca, hint)
    desktop_jobs.heartbeat(a_id, ["claude"])  # A's Desktop runner checks in (the "runner" half)
    mine = ca.get("/api/engines/subscriptions")
    assert hint in mine.text and mine.json()["runner"]["fresh"] is True
    rb = cb.get("/api/engines/subscriptions")
    assert rb.status_code == 200, rb.text
    assert hint not in rb.text
    claude = next(s for s in rb.json()["subscriptions"] if s["provider"] == "claude")
    assert claude["connected"] is False and claude["account_hint"] is None
    assert claude["runner_fresh"] is False
    assert rb.json()["runner"] == {"fresh": False, "last_seen_at": None, "providers": []}


def test_engine_subscription_upsert_never_touches_another_account(a, b):
    """``PUT …/{provider}`` upserts the CALLER's status row (the provider is a fixed slug, not
    another account's row id): B's PUT makes B's own row and leaves A's untouched."""
    (ca, a_id), (cb, _) = a, b
    hint = _marker("a-hint")
    _subscribe(ca, hint)
    where = (EngineSubscriptionStatus.owner_id == a_id,)
    before = _snap(EngineSubscriptionStatus, *where)
    rb = _subscribe(cb, _marker("b-hint"))
    assert _snap(EngineSubscriptionStatus, *where) == before
    assert hint not in rb.text


def test_engine_subscription_delete_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    hint = _marker("a-hint")
    _subscribe(ca, hint)
    where = (EngineSubscriptionStatus.owner_id == a_id,)
    before = _snap(EngineSubscriptionStatus, *where)
    rb = cb.delete("/api/engines/subscriptions/claude")
    after = _snap(EngineSubscriptionStatus, *where)
    ra = ca.delete("/api/engines/subscriptions/claude")
    assert _snap(EngineSubscriptionStatus, *where) == []
    _verdict(rb, ra, before=before, after=after, leaks=(hint,))


# ------------------------------------------------------------------------------ memories


def _a_memory(ca, **body) -> tuple[str, str]:
    secret = _marker("a-memory")
    resp = ca.post("/api/memories", json={"content": secret, **body})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"], secret


# (route suffix, method, B's body, the state A's memory is put in so A's own call is valid)
_MEMORY_ID_ROUTES = {
    "patch": ("", "PATCH", {"content": "B overwrote", "pinned": True, "polarity": "forbid"}, {}),
    "delete": ("", "DELETE", None, {}),
    "pin": ("/pin", "POST", None, {}),
    "unpin": ("/unpin", "POST", None, {"pinned": True}),
    "promote": ("/promote", "POST", None, {"status": "rejected"}),
    "reject": ("/reject", "POST", None, {}),
    "requeue": ("/requeue", "POST", None, {}),
}


@pytest.mark.parametrize("action", list(_MEMORY_ID_ROUTES))
def test_memory_id_routes_are_owner_scoped(a, b, action):
    (ca, _), (cb, _) = a, b
    suffix, method, body, state = _MEMORY_ID_ROUTES[action]
    mid, secret = _a_memory(ca)
    if state:
        if state.get("status") == "rejected":
            state = {**state, "invalid_at": datetime.now(UTC)}
        with session_scope() as s:
            s.execute(update(NodeMemory).where(NodeMemory.id == uuid.UUID(mid)).values(**state))
    url = f"/api/memories/{mid}{suffix}"
    where = (NodeMemory.id == uuid.UUID(mid),)
    before = _snap(NodeMemory, *where)
    rb = cb.request(method, url, json=body)
    after = _snap(NodeMemory, *where)
    ra = ca.request(method, url, json=body)
    if action == "delete":
        assert _snap(NodeMemory, *where) == []  # A's own delete really removed it
    _verdict(rb, ra, before=before, after=after, leaks=(secret,))


def test_memory_create_refuses_another_accounts_node_id(a, b):
    """``node_id`` in the ``POST /api/memories`` body names an agent node; B naming A's node must
    be refused, and A's node and memories stay as they were."""
    (ca, a_id), (cb, _) = a, b
    team = make_team(a_id, _marker("A team"))
    node = make_node(team, _marker("a-role"))
    with session_scope() as s:
        role, team_name = s.get(AgentNode, node).role_name, s.get(TeamGraph, team).name
    a_node_before = _snap(AgentNode, AgentNode.id == node)
    a_memories_before = _snap(NodeMemory, NodeMemory.owner_id == a_id)
    rb = cb.post("/api/memories", json={"content": "B's note", "node_id": str(node)})
    after = (_snap(AgentNode, AgentNode.id == node), _snap(NodeMemory, NodeMemory.owner_id == a_id))
    ra = ca.post("/api/memories", json={"content": "A's note", "node_id": str(node)})
    _verdict(
        rb,
        ra,
        before=(a_node_before, a_memories_before),
        after=after,
        leaks=(role, team_name),
    )


def test_memories_list_is_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    team = make_team(a_id)
    node = make_node(team, "Engineer")
    mid, secret = _a_memory(ca, node_id=str(node))
    assert mid in {m["id"] for m in ca.get("/api/memories").json()["memories"]}
    for query in ("", f"?node_id={node}", "?include_superseded=true", "?status=active"):
        rb = cb.get(f"/api/memories{query}")
        assert rb.status_code == 200, rb.text
        assert mid not in rb.text and secret not in rb.text, query


def test_memory_counts_are_owner_scoped(a, b):
    (ca, _), (cb, _) = a, b
    _a_memory(ca)
    assert ca.get("/api/memories/counts").json()["active"] >= 1
    rb = cb.get("/api/memories/counts")
    assert rb.status_code == 200, rb.text
    assert rb.json() == {"inbox": 0, "active": 0, "archive": 0}


def test_memory_repos_are_owner_scoped(a, b):
    (ca, a_id), (cb, _) = a, b
    mem_repo, run_repo = _marker("a-org/mem-repo"), _marker("a-org/run-repo")
    _a_memory(ca, repo_key=mem_repo)
    _owned_run(a_id, github_repo=run_repo)
    mine = {r["repo_key"] for r in ca.get("/api/memory/repos").json()["repos"]}
    assert {mem_repo, run_repo} <= mine
    rb = cb.get("/api/memory/repos")
    assert rb.status_code == 200, rb.text
    assert mem_repo not in rb.text and run_repo not in rb.text


def test_memory_repos_include_github_is_owner_scoped(a, b, github):
    """``?include_github=true`` adds the repos the caller's own GitHub App installations reach."""
    (ca, _), (cb, _) = a, b
    a_repo, b_repo, _ = github
    mine = ca.get("/api/memory/repos?include_github=true").json()["repos"]
    assert a_repo in {r["repo_key"] for r in mine}
    rb = cb.get("/api/memory/repos?include_github=true")
    assert rb.status_code == 200, rb.text
    assert [r["repo_key"] for r in rb.json()["repos"]] == [b_repo]
    assert a_repo not in rb.text


def test_memory_review_mode_is_per_account(a, b):
    (ca, _), (cb, _) = a, b
    assert ca.patch("/api/memory/review-mode", json={"review_mode": True}).json() == {
        "review_mode": True
    }
    assert cb.get("/api/memory/review-mode").json() == {"review_mode": False}
    assert cb.patch("/api/memory/review-mode", json={"review_mode": False}).status_code == 200
    assert ca.get("/api/memory/review-mode").json() == {"review_mode": True}


# ------------------------------------------------------------------------------ account


def test_account_preferences_are_per_account(a, b):
    (ca, _), (cb, _) = a, b
    resp = ca.patch("/api/account/preferences", json={"get_started_hidden": True})
    assert resp.status_code == 200 and resp.json()["get_started_hidden"] is True
    assert cb.get("/api/account/preferences").json()["get_started_hidden"] is False
    assert cb.patch("/api/account/preferences", json={"get_started_hidden": False}).is_success
    assert ca.get("/api/account/preferences").json()["get_started_hidden"] is True


def test_repo_inspect_is_fenced_in_hosted_mode(b, monkeypatch, tmp_path):
    """``POST /api/repo/inspect`` takes a server path, not an account's row; hosted mode (the
    multi-account deployment) refuses it outright."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    resp = b[0].post("/api/repo/inspect", json={"path": str(tmp_path)})
    assert resp.status_code == 422, resp.text


# ------------------------------------------------------------------------------ github


@pytest.fixture
def github(a, b, monkeypatch):
    """Hosted mode with a fake GitHub: A and B each own one installation reaching one private repo.
    Branch and folder names carry the repo's own secret marker."""
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    a_iid, b_iid = (800_000_000 + uuid.uuid4().int % 100_000_000 for _ in range(2))
    a_repo, b_repo = _marker("acct-a") + "/" + _marker("a-secret"), _marker("acct-b") + "/repo"
    repos = {
        a_iid: [{"full_name": a_repo, "default_branch": "main", "private": True}],
        b_iid: [{"full_name": b_repo, "default_branch": "main", "private": True}],
    }
    with session_scope() as s:
        s.add(GithubInstallation(owner_id=a[1], installation_id=a_iid))
        s.add(GithubInstallation(owner_id=b[1], installation_id=b_iid))

    def reach(iid, full_name):
        assert any(r["full_name"] == full_name for r in repos.get(iid, [])), (iid, full_name)

    def list_branches(iid, full_name):
        reach(iid, full_name)
        return [{"name": "main", "sha": "a1"}, {"name": f"br-{full_name}", "sha": "b2"}], False

    def tree_subpaths(iid, full_name, sha):
        reach(iid, full_name)
        return [{"path": f"dir-{full_name}", "file_count": 2}], False

    monkeypatch.setattr(github_app, "list_app_installations", lambda: [])
    monkeypatch.setattr(github_app, "list_installation_repositories", lambda i: repos.get(i, []))
    monkeypatch.setattr(github_app, "list_branches", list_branches)
    monkeypatch.setattr(github_app, "tree_subpaths", tree_subpaths)
    monkeypatch.setattr(toolkit_cp, "count_installation_repositories", lambda i: len(repos[i]))
    return a_repo, b_repo, a_iid


@pytest.mark.parametrize("leaf", ["branches", "subpaths"])
def test_github_repo_routes_are_owner_scoped(a, b, github, leaf):
    (ca, _), (cb, _) = a, b
    a_repo, _, _ = github
    rb = cb.get(f"/api/github/repos/{a_repo}/{leaf}")
    ra = ca.get(f"/api/github/repos/{a_repo}/{leaf}")
    _verdict(rb, ra, leaks=(f"br-{a_repo}", f"dir-{a_repo}"))
    assert ra.status_code == 200, ra.text


def test_github_repos_list_is_owner_scoped(a, b, github):
    (ca, _), (cb, _) = a, b
    a_repo, b_repo, _ = github
    assert a_repo in {r["full_name"] for r in ca.get("/api/github/repos").json()["repos"]}
    rb = cb.get("/api/github/repos")
    assert rb.status_code == 200, rb.text
    assert [r["full_name"] for r in rb.json()["repos"]] == [b_repo]
    assert a_repo not in rb.text


def test_github_status_is_owner_scoped(a, b, github):
    (ca, _), (cb, b_id) = a, b
    expected = {"hosted": True, "installed": True, "installation_count": 1, "repo_count": 1}
    assert ca.get("/api/github/status").json() == expected
    assert cb.get("/api/github/status").json() == expected  # B's own one, never A's too
    with session_scope() as s:  # B loses its installation: A's must not stand in for it
        s.query(GithubInstallation).filter(GithubInstallation.owner_id == b_id).delete()
    rb = cb.get("/api/github/status")
    assert rb.status_code == 200, rb.text
    assert rb.json() == {
        "hosted": True,
        "installed": False,
        "installation_count": 0,
        "repo_count": 0,
    }
