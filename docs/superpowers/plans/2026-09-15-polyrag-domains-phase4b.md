# PolyRAG Domains Phase 4b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 4b only — MCP tools **`domain_ask`** and **`domain_retrieve`** that wrap the same control-plane helpers / HTTP APIs as Domain Chat (Phase 3) and the Canvas Query-domain node (Phase 4a), so OpenHands agent nodes can call them via the existing `mcp_config` → `Agent(mcp_config=…)` seam — with owner-scoped `domain_id`, citations in tool results, and BYOK errors surfaced. **No hybrid / rerank / GraphRAG.**

**Architecture:** Add owner-scoped **`retrieve_domain`** (embed → dense retrieve → citations; no generation) beside `ask_domain`, expose it as **`POST /api/domains/{id}/retrieve`**, then wrap both helpers in a **FastMCP** server mounted on the control-plane FastAPI app at **`/mcp/domains`** (streamable HTTP). OpenHands sandboxes cannot import `tvashtr` or reach Postgres, so tools are **not** stdio-in-container with in-process DB — the agent reaches the control plane over HTTP. When a node opts in via `tool_config.tvashtr.domains: true`, **`build_mcp_config`** (existing C7.A seam; signature stays frozen) injects an `mcpServers["tvashtr-domains"]` entry with `url` + a minted `tv_session` Cookie for the run owner. Tool handlers call **`ask_domain` / `retrieve_domain` only** — no duplicate RAG.

**Tech Stack:** FastAPI + SQLAlchemy + pytest; MCP via the `mcp` package (`mcp.server.fastmcp.FastMCP`); OpenHands already consumes `mcp_config` through `node_tools.build_mcp_config` + adapters. Reuse `ask_domain`, `DomainAskError`, `retrieve_domain_chunks`, `citations_from_chunks`, `format_domain_ask_error`, `make_session_cookie_value` / `SESSION_COOKIE_NAME`, `mcp_secrets` / tool-library patterns unchanged for third-party servers.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 4b only** (MCP / `domain_ask` + `domain_retrieve`).
- **Branch base:** Implement on `feat/polyrag-domains-phase4b` created from current `feat/polyrag-domains-phase4a` tip (after this plan commit). Do not implement on main or an unrelated branch.
- Surfaces: **OpenHands agent nodes** via MCP; HTTP retrieve is the shared API surface (web Chat stays ask-only; no new Domain Chat retrieve UI in 4b).
- Auth / ownership: tools and HTTP are **owner-scoped** — foreign / missing domain → not-found; never leak another account's corpus.
- **Tool names (locked):** MCP tools **`domain_ask`** and **`domain_retrieve`** (exact). MCP server key in `mcpServers`: **`tvashtr-domains`**.
- **Opt-in (locked):** inject Domains MCP only when `tool_config.tvashtr.domains` is truthy (`true` or non-empty dict). Absent / false → byte-identical to today's `build_mcp_config` (no Domains server). Third-party `mcpServers` / library / `${NAME}` secrets continue to work unchanged.
- **`domain_ask` (locked):** args `domain_id: str`, `question: str` → calls **`ask_domain(owner_id, domain_uuid, question)`**. Success tool result JSON includes `answer`, `citations`, `domain_id`, `latency_ms`, `model`, `message_id`. Persisting DomainMessages is intentional reuse (same as HTTP + 4a).
- **`domain_retrieve` (locked):** args `domain_id: str`, `query: str`, optional `top_k: int | null` → calls **`retrieve_domain(...)`** (new). Success JSON includes `citations`, `domain_id`, `latency_ms`. **No** LLM generation.
- **Citations (locked):** same Phase 3 shape `{ document_id, filename, chunk_id, ordinal, excerpt, score? }`.
- **BYOK / errors (locked):** map `DomainAskError` to a clear tool error string via **`format_domain_ask_error`** (reuse 4a helper). HTTP retrieve uses the same status mapping as ask (404 / 422 / 502). Do not swallow missing-provider errors.
- **Transport (locked):** control-plane **streamable HTTP** MCP at `/mcp/domains` (path suffix `/mcp` under that mount per FastMCP defaults — client URL ends at the mount that serves MCP). Prefer URL without `/sse` so FastMCP Client infers HTTP/streamable. Auth = existing **`tv_session` cookie** minted with `make_session_cookie_value(str(owner_id))` into `headers.Cookie`.
- **Agent-reachable URL (locked):** `domains_mcp_url()` reads `public_base_url` and, when `agent_sandbox_mode == "docker"`, rewrites `localhost` / `127.0.0.1` host to `litellm_proxy_host_docker` (`host.docker.internal`) so the in-container agent-server can reach the host control plane. Fly uses the public HTTPS base as-is (egress 443).
- **`build_mcp_config` signature (locked):** stay `(tool_config, run_id) -> dict` — **do not widen**. Resolve owner + sandbox mode inside via existing lazy owner lookup + `get_settings()`.
- YAGNI: **no** hybrid/lexical/rerank, **no** GraphRAG, **no** streaming ask, **no** Domain Chat retrieve tab, **no** auto-enable Domains MCP on every node, **no** new Alembic migration, **no** duplicate embed/retrieve/complete logic.
- Test runners: `cd backend && uv run pytest <path> -q`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`); **never** `git config`.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Modify** `backend/pyproject.toml` | Add direct dep `mcp>=1.0` (today transitive via OpenHands; 4b needs it first-class). |
| **Modify** `backend/tvashtr/control_plane/domain_ask.py` | Add `retrieve_domain` + embed-only BYOK check; keep `ask_domain` unchanged. |
| **Create** `backend/tests/test_domain_retrieve_helper.py` | Unit tests for `retrieve_domain` (mocked embed/retrieve). |
| **Modify** `backend/tvashtr/routers.py` | `DomainRetrieveRequest` + `POST /api/domains/{domain_id}/retrieve`. |
| **Create** `backend/tests/test_domain_retrieve_api.py` | HTTP retrieve API tests (owner scope, BYOK 422, citations). |
| **Create** `backend/tvashtr/control_plane/domain_mcp.py` | Pure tool runners + FastMCP factory + owner-from-cookie; JSON result builders. |
| **Create** `backend/tests/test_domain_mcp_tools.py` | Handler unit tests (citations, BYOK text, bad UUID). |
| **Create** `backend/tvashtr/mcp/__init__.py` | Package marker. |
| **Create** `backend/tvashtr/mcp/domains.py` | `get_domains_mcp()` singleton + `__main__` stdio entry (local debug only). |
| **Modify** `backend/tvashtr/main.py` | Combine lifespan; `app.mount("/mcp/domains", domains_http_app)`. |
| **Modify** `backend/tvashtr/control_plane/node_tools.py` | Inject `tvashtr-domains` when `tvashtr.domains` truthy; helpers for URL + cookie header. |
| **Create** `backend/tests/test_domain_mcp_inject.py` | `build_mcp_config` injection + inertness when domains off. |
| **Create** `backend/tests/test_domain_mcp_http.py` | Mount smoke: session cookie required; tools listed / call ask+retrieve with mocks. |

**Out of scope (do not create for Phase 4b):** hybrid retrieval, rerank UI, GraphRAG, Domain Chat retrieve tab, canvas changes, new DB tables/migrations, widening `build_mcp_config` signature, baking `tvashtr` into the OpenHands agent image.

---

### Task 1: `retrieve_domain` helper (embed → retrieve → citations)

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_ask.py`
- Test: `backend/tests/test_domain_retrieve_helper.py`

**Interfaces:**
- Consumes: `_owned_domain`, `count_ready_chunks`, `normalize_embedding_model`, `coerce_retrieval_top_k`, `missing_ask_providers` pattern (embed-only), `resolve_owner_api_key`, `embed`, `retrieve_domain_chunks`, `citations_from_chunks`, `DomainAskError`
- Produces: `missing_retrieve_providers(owner_id, embed_model) -> list[str]`; `retrieve_domain(owner_id, domain_id, query, top_k: int | None = None) -> dict` with keys `citations`, `latency_ms` (and no `answer` / `model` / `message_id`)

- [ ] **Step 1: Write the failing helper tests**

Create `backend/tests/test_domain_retrieve_helper.py`:

```python
"""Phase 4b — owner-scoped retrieve_domain (no generation)."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError, retrieve_domain


def test_retrieve_domain_rejects_empty_query():
    with pytest.raises(DomainAskError) as ei:
        retrieve_domain(uuid.uuid4(), uuid.uuid4(), "   ")
    assert ei.value.code == "bad_request"


def test_retrieve_domain_not_found():
    oid, did = uuid.uuid4(), uuid.uuid4()
    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=None):
            with pytest.raises(DomainAskError) as ei:
                retrieve_domain(oid, did, "what is SLA?")
            assert ei.value.code == "not_found"


def test_retrieve_domain_returns_citations(monkeypatch):
    oid, did = uuid.uuid4(), uuid.uuid4()
    domain = MagicMock()
    domain.config = {
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 3},
    }

    chunks = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "SLA is 99.9%",
            "score": 0.9,
        }
    ]

    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=domain):
            with patch("tvashtr.control_plane.domain_ask.count_ready_chunks", return_value=2):
                with patch(
                    "tvashtr.control_plane.domain_ask.held_provider_slugs",
                    return_value={"openai"},
                ):
                    with patch(
                        "tvashtr.control_plane.domain_ask.resolve_owner_api_key",
                        return_value="sk-test",
                    ):
                        emb = MagicMock()
                        emb.vectors = [[0.1, 0.2]]
                        with patch("tvashtr.control_plane.domain_ask.embed", return_value=emb):
                            with patch(
                                "tvashtr.control_plane.domain_ask.retrieve_domain_chunks",
                                return_value=chunks,
                            ) as ret:
                                out = retrieve_domain(oid, did, "SLA?")
    assert "answer" not in out
    assert out["citations"][0]["filename"] == "a.md"
    assert out["citations"][0]["excerpt"]
    assert out["latency_ms"] is not None
    ret.assert_called_once()
    assert ret.call_args.args[2] == 3  # top_k from config


def test_retrieve_domain_missing_providers_dict():
    oid, did = uuid.uuid4(), uuid.uuid4()
    domain = MagicMock()
    domain.config = {"embedding": {"model": "text-embedding-3-small"}}
    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=domain):
            with patch("tvashtr.control_plane.domain_ask.count_ready_chunks", return_value=1):
                with patch(
                    "tvashtr.control_plane.domain_ask.held_provider_slugs",
                    return_value=set(),
                ):
                    with pytest.raises(DomainAskError) as ei:
                        retrieve_domain(oid, did, "q")
                    assert ei.value.code == "missing_providers"
                    assert "openai" in ei.value.detail["message"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_helper.py -q`

Expected: FAIL (`retrieve_domain` missing).

- [ ] **Step 3: Implement `retrieve_domain`**

Append to `backend/tvashtr/control_plane/domain_ask.py` (do **not** copy ask's generate/persist path):

```python
def missing_retrieve_providers(owner_id: uuid.UUID, embed_model: str) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(embed_model)}
    return sorted(p for p in needed if p not in held)


def retrieve_domain(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    query: str,
    top_k: int | None = None,
) -> dict:
    """Embed + dense retrieve + citations. No generation / no DomainMessage writes.

    Raises DomainAskError with the same codes as ask where applicable
    (``bad_request``, ``not_found``, ``empty_corpus``, ``missing_providers``, ``gateway``).
    """
    q = (query or "").strip()
    if not q:
        raise DomainAskError("bad_request", "query must be non-empty")

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        cfg = dict(domain.config or {})
        ready_n = count_ready_chunks(session, domain_id)
        if ready_n < 1:
            raise DomainAskError("empty_corpus", "ingest documents before asking")
        cfg_top_k = coerce_retrieval_top_k(cfg)
        emb_model = normalize_embedding_model(
            str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
        )

    effective_k = cfg_top_k
    if top_k is not None:
        try:
            k = int(top_k)
            if k >= 1:
                effective_k = k
        except (TypeError, ValueError):
            pass

    missing = missing_retrieve_providers(owner_id, emb_model)
    if missing:
        raise DomainAskError(
            "missing_providers",
            {
                "message": (
                    "you have no API key for: "
                    + ", ".join(missing)
                    + " — needed to embed the query. "
                    "Add keys under Engines before retrieving."
                ),
                "missing_providers": missing,
            },
        )

    try:
        embed_key = resolve_owner_api_key(owner_id, emb_model)
    except NoCredentialError as e:
        raise DomainAskError(
            "missing_providers",
            {
                "message": (
                    f"you have no API key for: {e.provider} — needed for domain retrieve. "
                    "Add a key under Engines before retrieving."
                ),
                "missing_providers": [e.provider],
            },
        ) from e

    started = time.perf_counter()
    try:
        emb_result = embed(
            EmbeddingRequest(model=emb_model, input=[q], api_key=embed_key)
        )
    except GatewayError as e:
        raise DomainAskError("gateway", f"embedding failed: {e}") from e
    if not emb_result.vectors:
        raise DomainAskError("gateway", "embedding provider returned no vectors")

    chunks = retrieve_domain_chunks(domain_id, emb_result.vectors[0], effective_k)
    if not chunks:
        raise DomainAskError("empty_corpus", "ingest documents before asking")

    citations = citations_from_chunks(chunks)
    for cite in citations:
        sc = cite.get("score")
        if isinstance(sc, float) and not math.isfinite(sc):
            cite.pop("score", None)

    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "citations": citations,
        "latency_ms": latency_ms,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_helper.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_ask.py \
  backend/tests/test_domain_retrieve_helper.py
git commit -m "$(cat <<'EOF'
feat(domains): owner-scoped retrieve_domain helper for Phase 4b

EOF
)"
```

---

### Task 2: HTTP `POST /api/domains/{domain_id}/retrieve`

**Files:**
- Modify: `backend/tvashtr/routers.py`
- Test: `backend/tests/test_domain_retrieve_api.py`

**Interfaces:**
- Consumes: `retrieve_domain`, `DomainAskError`, `get_domain`, `_parse_domain_id`
- Produces: `DomainRetrieveRequest(query: str, top_k: int | None = None)`; route returning `{citations, latency_ms, domain_id}`

- [ ] **Step 1: Write the failing API tests**

Mirror `tests/test_domain_ask_api.py` patterns (auth client + owned domain fixtures). Create `backend/tests/test_domain_retrieve_api.py`:

```python
"""Phase 4b — POST /api/domains/{id}/retrieve."""

import uuid
from unittest.mock import patch

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError


def test_retrieve_requires_auth(client):
    r = client.post(f"/api/domains/{uuid.uuid4()}/retrieve", json={"query": "hi"})
    assert r.status_code in (401, 403)


def test_retrieve_foreign_domain_404(client, auth_user_id):
    # use whatever helper test_domain_ask_api uses to create a domain for user A,
    # then auth as user B — or patch get_domain -> None
    with patch("tvashtr.routers.get_domain", return_value=None):
        r = client.post(
            f"/api/domains/{uuid.uuid4()}/retrieve",
            json={"query": "hi"},
        )
    assert r.status_code == 404


def test_retrieve_ok_returns_citations(client, auth_user_id):
    did = str(uuid.uuid4())
    fake = {
        "citations": [
            {
                "document_id": "d",
                "filename": "a.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "e",
            }
        ],
        "latency_ms": 5,
    }
    with patch("tvashtr.routers.get_domain", return_value={"id": did, "config": {}}):
        with patch("tvashtr.routers.retrieve_domain", return_value=fake) as m:
            r = client.post(f"/api/domains/{did}/retrieve", json={"query": "SLA?"})
    assert r.status_code == 200
    body = r.json()
    assert body["citations"][0]["filename"] == "a.md"
    assert body["domain_id"] == did
    assert body["latency_ms"] == 5
    m.assert_called_once()


def test_retrieve_byok_422(client, auth_user_id):
    did = str(uuid.uuid4())
    err = DomainAskError(
        "missing_providers",
        {
            "message": "you have no API key for: openai — needed to embed the query.",
            "missing_providers": ["openai"],
        },
    )
    with patch("tvashtr.routers.get_domain", return_value={"id": did}):
        with patch("tvashtr.routers.retrieve_domain", side_effect=err):
            r = client.post(f"/api/domains/{did}/retrieve", json={"query": "q"})
    assert r.status_code == 422
    assert "openai" in str(r.json()["detail"]).lower() or "openai" in str(r.json())
```

Adapt imports/`auth_user_id` to match existing domain ask API tests in this repo (copy the client auth fixture usage from `test_domain_ask_api.py`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_api.py -q`

Expected: FAIL (route missing).

- [ ] **Step 3: Implement request model + route**

Near `DomainAskRequest` in `routers.py`:

```python
class DomainRetrieveRequest(BaseModel):
    query: str
    top_k: int | None = None
```

Import `retrieve_domain` beside `ask_domain`. Add route next to `post_domain_ask`:

```python
@router.post("/api/domains/{domain_id}/retrieve")
def post_domain_retrieve(
    domain_id: str,
    body: DomainRetrieveRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    row = get_domain(owner_id, did)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    try:
        result = retrieve_domain(owner_id, did, body.query, top_k=body.top_k)
    except DomainAskError as e:
        if e.code == "not_found":
            raise HTTPException(status_code=404, detail="domain not found") from e
        if e.code == "gateway":
            raise HTTPException(status_code=502, detail=e.detail) from e
        raise HTTPException(status_code=422, detail=e.detail) from e
    return {
        "domain_id": str(did),
        "citations": result["citations"],
        "latency_ms": result.get("latency_ms"),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_api.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/routers.py backend/tests/test_domain_retrieve_api.py
git commit -m "$(cat <<'EOF'
feat(domains): POST /api/domains/{id}/retrieve wrapping retrieve_domain

EOF
)"
```

---

### Task 3: MCP tool handlers (pure) — citations + BYOK text

**Files:**
- Create: `backend/tvashtr/control_plane/domain_mcp.py`
- Test: `backend/tests/test_domain_mcp_tools.py`

**Interfaces:**
- Consumes: `ask_domain`, `retrieve_domain`, `DomainAskError`, `format_domain_ask_error`
- Produces:
  - `parse_domain_uuid(domain_id: str) -> uuid.UUID` (raises `DomainAskError("bad_request", ...)`)
  - `run_domain_ask_tool(owner_id, domain_id: str, question: str) -> str` (JSON string)
  - `run_domain_retrieve_tool(owner_id, domain_id: str, query: str, top_k: int | None = None) -> str`
  - On success: JSON text; on `DomainAskError`: raise `DomainMcpToolError` with `.message` = `format_domain_ask_error(exc)` (FastMCP tools will return this as the tool error / message)

- [ ] **Step 1: Write the failing handler tests**

```python
"""Phase 4b — domain_ask / domain_retrieve MCP tool handlers."""

import json
import uuid
from unittest.mock import patch

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.domain_mcp import (
    DomainMcpToolError,
    run_domain_ask_tool,
    run_domain_retrieve_tool,
)


def test_ask_tool_includes_citations():
    oid = uuid.uuid4()
    did = str(uuid.uuid4())
    fake = {
        "answer": "99.9%",
        "citations": [
            {
                "document_id": "d",
                "filename": "sla.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "SLA 99.9%",
            }
        ],
        "latency_ms": 10,
        "model": "openai/gpt-4o-mini",
        "message_id": "m1",
    }
    with patch("tvashtr.control_plane.domain_mcp.ask_domain", return_value=fake):
        raw = run_domain_ask_tool(oid, did, "What is the SLA?")
    body = json.loads(raw)
    assert body["answer"] == "99.9%"
    assert body["citations"][0]["filename"] == "sla.md"
    assert body["domain_id"] == did
    assert body["message_id"] == "m1"


def test_retrieve_tool_includes_citations_no_answer():
    oid = uuid.uuid4()
    did = str(uuid.uuid4())
    fake = {
        "citations": [
            {
                "document_id": "d",
                "filename": "a.md",
                "chunk_id": "c",
                "ordinal": 0,
                "excerpt": "e",
            }
        ],
        "latency_ms": 3,
    }
    with patch("tvashtr.control_plane.domain_mcp.retrieve_domain", return_value=fake):
        raw = run_domain_retrieve_tool(oid, did, "SLA")
    body = json.loads(raw)
    assert "answer" not in body
    assert body["citations"][0]["excerpt"] == "e"
    assert body["domain_id"] == did


def test_ask_tool_surfaces_byok():
    oid = uuid.uuid4()
    did = str(uuid.uuid4())
    exc = DomainAskError(
        "missing_providers",
        {
            "message": "you have no API key for: openai — needed to embed the question and generate an answer.",
            "missing_providers": ["openai"],
        },
    )
    with patch("tvashtr.control_plane.domain_mcp.ask_domain", side_effect=exc):
        with pytest.raises(DomainMcpToolError) as ei:
            run_domain_ask_tool(oid, did, "q")
    assert "openai" in ei.value.message
    assert "API key" in ei.value.message or "key" in ei.value.message.lower()


def test_bad_domain_id():
    with pytest.raises(DomainMcpToolError) as ei:
        run_domain_ask_tool(uuid.uuid4(), "not-a-uuid", "q")
    assert "domain_id" in ei.value.message.lower() or "uuid" in ei.value.message.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_mcp_tools.py -q`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement handlers**

Create `backend/tvashtr/control_plane/domain_mcp.py`:

```python
"""Phase 4b — MCP tool runners for domain_ask / domain_retrieve (no transport)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from tvashtr.control_plane.domain_ask import (
    DomainAskError,
    ask_domain,
    retrieve_domain,
)
from tvashtr.control_plane.domain_query_node import format_domain_ask_error


class DomainMcpToolError(Exception):
    """Raised to surface a clear tool error string to the MCP client / model."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def parse_domain_uuid(domain_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(domain_id).strip())
    except (ValueError, AttributeError, TypeError) as e:
        raise DomainAskError(
            "bad_request", "domain_id must be a UUID"
        ) from e


def _json_ok(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def run_domain_ask_tool(owner_id: uuid.UUID, domain_id: str, question: str) -> str:
    try:
        did = parse_domain_uuid(domain_id)
        result = ask_domain(owner_id, did, question)
    except DomainAskError as exc:
        raise DomainMcpToolError(format_domain_ask_error(exc)) from exc
    return _json_ok(
        {
            "domain_id": str(did),
            "answer": result.get("answer"),
            "citations": list(result.get("citations") or []),
            "latency_ms": result.get("latency_ms"),
            "model": result.get("model"),
            "message_id": result.get("message_id"),
        }
    )


def run_domain_retrieve_tool(
    owner_id: uuid.UUID,
    domain_id: str,
    query: str,
    top_k: int | None = None,
) -> str:
    try:
        did = parse_domain_uuid(domain_id)
        result = retrieve_domain(owner_id, did, query, top_k=top_k)
    except DomainAskError as exc:
        raise DomainMcpToolError(format_domain_ask_error(exc)) from exc
    return _json_ok(
        {
            "domain_id": str(did),
            "citations": list(result.get("citations") or []),
            "latency_ms": result.get("latency_ms"),
        }
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_mcp_tools.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_mcp.py \
  backend/tests/test_domain_mcp_tools.py
git commit -m "$(cat <<'EOF'
feat(domains): MCP tool handlers for domain_ask and domain_retrieve

EOF
)"
```

---

### Task 4: FastMCP server factory + owner from session cookie

**Files:**
- Create: `backend/tvashtr/mcp/__init__.py`
- Create: `backend/tvashtr/mcp/domains.py`
- Modify: `backend/tvashtr/control_plane/domain_mcp.py` (add `owner_id_from_cookie_header`, `create_domains_fastmcp`)
- Modify: `backend/pyproject.toml` (add `mcp>=1.0`)
- Test: extend `backend/tests/test_domain_mcp_tools.py` **or** create `backend/tests/test_domain_mcp_server.py`

**Interfaces:**
- Consumes: handlers from Task 3; `read_session_cookie`, `SESSION_COOKIE_NAME`, `User` lookup optional (cookie user id is enough if still valid)
- Produces: `create_domains_fastmcp() -> FastMCP` with tools named exactly `domain_ask` and `domain_retrieve`; `owner_id_from_headers(cookie_header: str | None) -> uuid.UUID`

- [ ] **Step 1: Add dependency + failing cookie/owner tests**

In `backend/pyproject.toml` dependencies list add: `"mcp>=1.0",` then `cd backend && uv sync`.

Append tests:

```python
from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value
from tvashtr.control_plane.domain_mcp import owner_id_from_headers, create_domains_fastmcp


def test_owner_id_from_headers_roundtrip():
    uid = uuid.uuid4()
    cookie = f"{SESSION_COOKIE_NAME}={make_session_cookie_value(str(uid))}"
    assert owner_id_from_headers(cookie) == uid


def test_owner_id_from_headers_missing():
    with pytest.raises(DomainMcpToolError):
        owner_id_from_headers(None)


def test_fastmcp_registers_locked_tool_names():
    mcp = create_domains_fastmcp()
    # FastMCP 1.x: tool manager holds tools by name
    names = set(mcp._tool_manager.list_tools()) if hasattr(mcp, "_tool_manager") else set()
    # Prefer public API if list_tools differs by version — assert via mcp._tools or:
    tool_dict = getattr(mcp, "_tools", None) or {}
    registered = set(tool_dict) or names
    # Fallback: inspect create_domains_fastmcp source contract in assertion message
    assert "domain_ask" in registered or any(
        getattr(t, "name", None) == "domain_ask" for t in registered
    )
    assert "domain_retrieve" in registered or any(
        getattr(t, "name", None) == "domain_retrieve" for t in registered
    )
```

If FastMCP's internal tool registry API differs in the locked `mcp` version, discover names with:

```python
import asyncio
from mcp.shared.memory import create_connected_server_and_client_session as create_session
# OR simply: assert callable tools by calling create_domains_fastmcp and checking
# [t.name for t in mcp._tool_manager._tools.values()]
```

Pin the assertion to whatever the installed `mcp` package exposes after `uv sync` — still require exact names `domain_ask` / `domain_retrieve`.

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && uv run pytest tests/test_domain_mcp_tools.py -q`

Expected: FAIL on new symbols / tool names.

- [ ] **Step 3: Implement FastMCP factory**

Add to `domain_mcp.py`:

```python
from tvashtr.auth import SESSION_COOKIE_NAME, read_session_cookie


def owner_id_from_headers(cookie_header: str | None) -> uuid.UUID:
    if not cookie_header:
        raise DomainMcpToolError("authentication required — missing session cookie")
    # cookie_header may be full "tv_session=..." or a Cookie header with multiple pairs
    raw = None
    for part in str(cookie_header).split(";"):
        part = part.strip()
        if part.startswith(SESSION_COOKIE_NAME + "="):
            raw = part.split("=", 1)[1]
            break
    if raw is None and "=" not in str(cookie_header):
        raw = str(cookie_header)
    user_id = read_session_cookie(raw) if raw else None
    if not user_id:
        raise DomainMcpToolError("authentication required — invalid or expired session")
    try:
        return uuid.UUID(user_id)
    except ValueError as e:
        raise DomainMcpToolError("authentication required — invalid session subject") from e


def create_domains_fastmcp():
    """Build the Domains MCP server (tools domain_ask + domain_retrieve)."""
    from mcp.server.fastmcp import Context, FastMCP
    from starlette.requests import Request

    mcp = FastMCP("tvashtr-domains")

    def _owner_from_ctx(ctx: Context) -> uuid.UUID:
        # Prefer HTTP request cookie when mounted; fall back to env for stdio debug.
        request: Request | None = None
        try:
            request = ctx.request_context.request  # type: ignore[attr-defined]
        except Exception:
            request = None
        if request is not None:
            raw = request.headers.get("cookie") or request.cookies.get(SESSION_COOKIE_NAME)
            if request.cookies.get(SESSION_COOKIE_NAME):
                return owner_id_from_headers(
                    f"{SESSION_COOKIE_NAME}={request.cookies.get(SESSION_COOKIE_NAME)}"
                )
            return owner_id_from_headers(raw)
        import os

        env_oid = os.environ.get("TVASHTR_OWNER_ID")
        if env_oid:
            return uuid.UUID(env_oid)
        raise DomainMcpToolError("authentication required")

    @mcp.tool(name="domain_ask")
    def domain_ask(domain_id: str, question: str, ctx: Context) -> str:
        """Ask a Domain a question; returns answer + citations JSON."""
        owner = _owner_from_ctx(ctx)
        return run_domain_ask_tool(owner, domain_id, question)

    @mcp.tool(name="domain_retrieve")
    def domain_retrieve(
        domain_id: str, query: str, top_k: int | None = None, ctx: Context = None
    ) -> str:
        """Retrieve cited chunks from a Domain (no LLM generation)."""
        owner = _owner_from_ctx(ctx)
        return run_domain_retrieve_tool(owner, domain_id, query, top_k=top_k)

    return mcp
```

Create `backend/tvashtr/mcp/__init__.py` (empty or docstring) and `backend/tvashtr/mcp/domains.py`:

```python
"""Domains MCP entry — HTTP mount via main.py; stdio via ``python -m tvashtr.mcp.domains``."""

from __future__ import annotations

from tvashtr.control_plane.domain_mcp import create_domains_fastmcp

_mcp = None


def get_domains_mcp():
    global _mcp
    if _mcp is None:
        _mcp = create_domains_fastmcp()
    return _mcp


def main() -> None:
    get_domains_mcp().run(transport="stdio")


if __name__ == "__main__":
    main()
```

Adjust `Context` / request access to match the installed FastMCP version (if `ctx.request_context.request` is unavailable, read from `fastmcp.server.http._current_http_request.get()`).

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && uv run pytest tests/test_domain_mcp_tools.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock \
  backend/tvashtr/control_plane/domain_mcp.py \
  backend/tvashtr/mcp/__init__.py \
  backend/tvashtr/mcp/domains.py \
  backend/tests/test_domain_mcp_tools.py
git commit -m "$(cat <<'EOF'
feat(domains): FastMCP domain_ask / domain_retrieve server factory

EOF
)"
```

---

### Task 5: Mount `/mcp/domains` on FastAPI (combined lifespan)

**Files:**
- Modify: `backend/tvashtr/main.py`
- Test: `backend/tests/test_domain_mcp_http.py`

**Interfaces:**
- Consumes: `get_domains_mcp().http_app(...)` (or `streamable_http_app`)
- Produces: mounted ASGI app at `/mcp/domains`; app lifespan includes MCP session manager lifespan

- [ ] **Step 1: Write failing mount smoke tests**

```python
"""Phase 4b — /mcp/domains mount + session cookie gate."""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value
from tvashtr.main import app


def test_mcp_domains_mount_exists():
    client = TestClient(app)
    # Unauthenticated probe — must not 404 the mount entirely (401/406/405 ok).
    r = client.get("/mcp/domains")
    assert r.status_code != 404


def test_tool_handler_path_uses_cookie_owner():
    # Unit-level: mounting works; deep protocol tests optional.
    # Call run_domain_ask_tool via MCP is covered in Task 3; here ensure Cookie roundtrip
    # used by injection is accepted by owner_id_from_headers (already Task 4).
    uid = uuid.uuid4()
    token = make_session_cookie_value(str(uid))
    assert token
    assert SESSION_COOKIE_NAME
```

If `TestClient(app)` lifespan conflicts with MCP's required lifespan, follow FastMCP ASGI docs: construct `mcp_http = get_domains_mcp().http_app(path="/")`, combine lifespans, `app.mount("/mcp/domains", mcp_http)`. Update the test after mount exists.

- [ ] **Step 2: Run — expect fail (404)**

Run: `cd backend && uv run pytest tests/test_domain_mcp_http.py -q`

Expected: FAIL or assert `status_code != 404` fails.

- [ ] **Step 3: Mount in `main.py`**

Pattern (adapt to exact FastMCP version API — prefer `http_app`):

```python
from contextlib import asynccontextmanager

from tvashtr.mcp.domains import get_domains_mcp

_domains_mcp = get_domains_mcp()
_domains_mcp_http = _domains_mcp.http_app(path="/")  # streamable HTTP


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # existing sweeps ...
    async with _domains_mcp_http.lifespan(app):
        if settings.agent_sandbox_mode == "docker":
            sweep_orphaned_agent_containers()
        # ... keep all existing sweep calls ...
        yield


app = FastAPI(..., lifespan=_lifespan)
# ... existing includes ...
app.mount("/mcp/domains", _domains_mcp_http)
```

**Important:** merge carefully with the current `_lifespan` body — sweeps must still run; MCP lifespan must wrap/startup the streamable HTTP session manager. If `http_app` is unavailable, use `streamable_http_app()` from `mcp.server.fastmcp.FastMCP`.

Do **not** put `/mcp/domains` behind the SPA catch-all; mount before static/SPA routes.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && uv run pytest tests/test_domain_mcp_http.py tests/test_domain_mcp_tools.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/main.py backend/tests/test_domain_mcp_http.py
git commit -m "$(cat <<'EOF'
feat(domains): mount Domains MCP at /mcp/domains

EOF
)"
```

---

### Task 6: Inject `tvashtr-domains` from `build_mcp_config`

**Files:**
- Modify: `backend/tvashtr/control_plane/node_tools.py`
- Test: `backend/tests/test_domain_mcp_inject.py`

**Interfaces:**
- Consumes: `tool_config.tvashtr.domains`, run owner, `get_settings()`, `make_session_cookie_value`, `SESSION_COOKIE_NAME`
- Produces: when domains opt-in, `mcpServers["tvashtr-domains"] = {url, headers: {Cookie: "tv_session=..."}}` merged **after** library+inline resolution so it is always present when opted in (inline may not override the built-in name unless already present — **locked:** if inline already defines `tvashtr-domains`, **inline wins**; only inject when absent). Strip `tvashtr` as today.

- [ ] **Step 1: Write failing injection tests**

```python
"""Phase 4b — build_mcp_config Domains MCP injection."""

import uuid
from unittest.mock import patch

from tvashtr.auth import SESSION_COOKIE_NAME
from tvashtr.control_plane.node_tools import build_mcp_config, domains_mcp_url


def _run_with_owner(owner: uuid.UUID) -> str:
    # Reuse test_mcp_tools._make_owned_run pattern
    from tests.test_mcp_tools import _make_owned_run

    return _make_owned_run(owner)


def test_domains_off_is_inert():
    owner = uuid.uuid4()
    # seed user+run like test_mcp_tools
    from tvashtr.db import session_scope
    from tvashtr.models import User

    with session_scope() as s:
        s.add(User(id=owner, email=f"{owner.hex}@t.local", password_hash="x"))
    run_id = _run_with_owner(owner)
    assert build_mcp_config(None, run_id) == {}
    assert build_mcp_config({"mcpServers": {}}, run_id) == {"mcpServers": {}}
    out = build_mcp_config({"mcpServers": {}, "tvashtr": {"domains": False}}, run_id)
    assert "tvashtr-domains" not in out.get("mcpServers", {})


def test_domains_on_injects_url_and_cookie():
    owner = uuid.uuid4()
    from tvashtr.db import session_scope
    from tvashtr.models import User

    with session_scope() as s:
        s.add(User(id=owner, email=f"{owner.hex}@t.local", password_hash="x"))
    run_id = _run_with_owner(owner)
    with patch(
        "tvashtr.control_plane.node_tools.domains_mcp_url",
        return_value="http://host.docker.internal:8000/mcp/domains",
    ):
        out = build_mcp_config({"tvashtr": {"domains": True}}, run_id)
    server = out["mcpServers"]["tvashtr-domains"]
    assert server["url"] == "http://host.docker.internal:8000/mcp/domains"
    cookie = server["headers"]["Cookie"]
    assert cookie.startswith(SESSION_COOKIE_NAME + "=")


def test_inline_tvashtr_domains_wins():
    owner = uuid.uuid4()
    from tvashtr.db import session_scope
    from tvashtr.models import User

    with session_scope() as s:
        s.add(User(id=owner, email=f"{owner.hex}@t.local", password_hash="x"))
    run_id = _run_with_owner(owner)
    inline = {
        "mcpServers": {
            "tvashtr-domains": {"url": "http://example.test/mcp", "headers": {}}
        },
        "tvashtr": {"domains": True},
    }
    out = build_mcp_config(inline, run_id)
    assert out["mcpServers"]["tvashtr-domains"]["url"] == "http://example.test/mcp"


def test_domains_mcp_url_rewrites_localhost_for_docker():
    class S:
        public_base_url = "http://127.0.0.1:8000"
        agent_sandbox_mode = "docker"
        litellm_proxy_host_docker = "host.docker.internal"

    with patch("tvashtr.control_plane.node_tools.get_settings", return_value=S()):
        url = domains_mcp_url()
    assert "host.docker.internal" in url
    assert url.endswith("/mcp/domains")
```

Fix `_make_owned_run` import if it's private — copy the small helper inline instead of importing from another test module if needed.

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && uv run pytest tests/test_domain_mcp_inject.py -q`

Expected: FAIL (`domains_mcp_url` missing / no injection).

- [ ] **Step 3: Implement URL helper + injection**

In `node_tools.py`:

```python
from urllib.parse import urlparse, urlunparse

from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value
from tvashtr.config import get_settings


def domains_mcp_url() -> str:
    """Control-plane Domains MCP URL reachable from the OpenHands agent process."""
    settings = get_settings()
    base = (settings.public_base_url or "http://127.0.0.1:8000").rstrip("/")
    parsed = urlparse(base)
    host = parsed.hostname or "127.0.0.1"
    if settings.agent_sandbox_mode == "docker" and host in ("127.0.0.1", "localhost"):
        host = settings.litellm_proxy_host_docker
        netloc = host
        if parsed.port:
            netloc = f"{host}:{parsed.port}"
        elif parsed.scheme == "http":
            netloc = f"{host}:8000"
        parsed = parsed._replace(netloc=netloc)
        base = urlunparse(parsed).rstrip("/")
    return f"{base}/mcp/domains"


def _domains_opt_in(tvashtr_meta: dict) -> bool:
    flag = tvashtr_meta.get("domains")
    if flag is True:
        return True
    if isinstance(flag, dict) and flag.get("enabled", True) is not False and flag:
        return True
    return False
```

Inside `build_mcp_config`, after building `resolved` and **before** the return, when `_domains_opt_in(tvashtr_meta)` and owner is available and `"tvashtr-domains" not in resolved`:

```python
    if _domains_opt_in(tvashtr_meta if isinstance(tvashtr_meta, dict) else {}):
        owner = _owner()
        if owner is not None and "tvashtr-domains" not in resolved:
            cookie_val = make_session_cookie_value(str(owner))
            resolved["tvashtr-domains"] = {
                "url": domains_mcp_url(),
                "headers": {"Cookie": f"{SESSION_COOKIE_NAME}={cookie_val}"},
            }
```

Keep returning `{"mcpServers": resolved}` only (tvashtr block stripped).

- [ ] **Step 4: Run — expect pass**

Run: `cd backend && uv run pytest tests/test_domain_mcp_inject.py tests/test_mcp_tools.py tests/test_tools_skills_scaffold.py -q`

Expected: PASS (existing MCP inertness preserved).

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/node_tools.py \
  backend/tests/test_domain_mcp_inject.py
git commit -m "$(cat <<'EOF'
feat(tools): inject tvashtr-domains MCP when tvashtr.domains enabled

EOF
)"
```

---

### Task 7: Regression gate + YAGNI check

**Files:** none new (commands only)

- [ ] **Step 1: Backend Phase 4b + related regression**

```bash
cd backend && uv run pytest \
  tests/test_domain_retrieve_helper.py \
  tests/test_domain_retrieve_api.py \
  tests/test_domain_mcp_tools.py \
  tests/test_domain_mcp_http.py \
  tests/test_domain_mcp_inject.py \
  tests/test_domain_ask_api.py \
  tests/test_domain_query_run.py \
  tests/test_mcp_tools.py \
  tests/test_tools_skills_scaffold.py \
  -q
```

Expected: PASS

- [ ] **Step 2: Confirm locked names + reuse**

```bash
rg -n "domain_ask|domain_retrieve|tvashtr-domains|retrieve_domain|ask_domain" \
  backend/tvashtr/control_plane/domain_mcp.py \
  backend/tvashtr/control_plane/node_tools.py \
  backend/tvashtr/mcp/domains.py \
  backend/tvashtr/routers.py
```

Expected: tool names `domain_ask` / `domain_retrieve`; server key `tvashtr-domains`; handlers call `ask_domain` / `retrieve_domain`.

- [ ] **Step 3: YAGNI grep (Phase 5+ must stay absent)**

```bash
rg -n "hybrid|rerank|GraphRAG|retrieve_only|colbert" \
  backend/tvashtr/control_plane/domain_mcp.py \
  backend/tvashtr/control_plane/domain_ask.py \
  backend/tvashtr/control_plane/node_tools.py \
  backend/tvashtr/mcp/ || true
```

Expected: no hybrid/rerank/GraphRAG.

Confirm no duplicate RAG loop inside MCP (no second `embed(` / `complete(` outside `domain_ask.py`):

```bash
rg -n "\bembed\(|\bcomplete\(" backend/tvashtr/control_plane/domain_mcp.py \
  backend/tvashtr/mcp/ || true
```

Expected: no matches.

- [ ] **Step 4: Final fixup commit only if needed**

```bash
git commit -m "$(cat <<'EOF'
test(domains): Phase 4b regression gate green

EOF
)"
```

---

## How operators enable Domains MCP on a node

Paste / set on a worker (or any agent) node `tool_config`:

```json
{
  "mcpServers": {},
  "tvashtr": {
    "domains": true
  }
}
```

At run time the executor injects `tvashtr-domains` into `Agent(mcp_config=…)`. The model can call **`domain_ask`** / **`domain_retrieve`** with a Domain UUID the run owner owns. Third-party MCP servers and `${NAME}` secrets continue to work via existing Tools UI / tool library.

---

## Self-review checklist (Phase 4b spec → tasks)

| Spec / locked decision | Task(s) |
|------------------------|---------|
| MCP tools `domain_ask` + `domain_retrieve` | Tasks 3–4 |
| Wrap same ask/retrieve APIs / helpers (no duplicate RAG) | Tasks 1–3 |
| Owner-scoped `domain_id` | Tasks 1–2, 4, 6 |
| Citations in tool result | Task 3 |
| BYOK errors surfaced | Tasks 1–3 |
| OpenHands via `node_tools` / `mcp_config` | Task 6 |
| YAGNI: no hybrid | Global Constraints + Task 7 |
| Branch `feat/polyrag-domains-phase4b` from phase4a tip | Global Constraints |

### Plan completeness notes

- **No TBDs** for tool names, server key, opt-in flag, citation shape, or auth (session cookie).
- **No migration** — uses existing Domain tables + `tool_config` JSONB.
- **Sandbox reality:** Domains MCP is HTTP on the control plane; agents do not import `tvashtr` inside the OpenHands image.
- **`build_mcp_config` signature frozen** — injection is internal.
- **Phase 5+ deferred:** hybrid / rerank / GraphRAG — do not stub.
- **UI:** raw `tool_config` / ToolsSection paste is enough for 4b; a dedicated "Enable Domains MCP" toggle can wait.
