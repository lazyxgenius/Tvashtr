# PolyRAG Domains Phase 4a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 4a only — a Canvas **Query domain** node (`domain_query`) that selects a Domain, runs a prompt template against `ask_domain` (same control-plane helper as `POST /api/domains/{id}/ask`), and surfaces the answer + citations on the invocation / run log — shared React for web + Desktop. **No MCP / 4b.**

**Architecture:** Add a fifth canvas primitive beside thinker/worker/gate/terminal. Palette `node_kind` and stored `AgentNode.kind` are both **`domain_query`** (same pattern as `gate` / `terminal`, not the thinker→completion remapping). Node config holds `domain_id`; `AgentNode.prompt` holds the question template (default `{idea}`). At run time a new `@DBOS.step` `domain_query_step` resolves the run owner, renders the template, calls **`ask_domain`** (reuse — do not reimplement retrieve/complete), then closes the invocation with answer text + citations JSON in `context_manifest`. BYOK / empty-corpus / missing-domain failures close the invocation as **`failed`** with a clear `outcome_detail` and finalize the run `failed`, matching other LLM node hard failures. Validity treats `domain_query` like a thinker for routing (needs a forward exit; cannot be the graph root).

**Tech Stack:** FastAPI + SQLAlchemy + DBOS + pytest (backend); React 19 + Vitest + Testing Library (frontend shared by web + Electron Desktop). Reuse `tvashtr.control_plane.domain_ask.ask_domain` / `DomainAskError`, `owner_for_run`, existing invocation open/close, canvas palette + `TeamNodePanel` drawer patterns.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 4a only** (Agent integration: Query domain node).
- **Branch base:** Implement on new branch `feat/polyrag-domains-phase4a` created from current `feat/polyrag-domains-phase3` tip (after this plan commit). Do not implement on main or an unrelated branch.
- Surfaces: **Web and Desktop parity via shared React** — Desktop continues same-origin `/api` proxy to Fly; no Desktop-only Domain backend.
- Auth / ownership: run owner must own the selected Domain; foreign / missing domain → clear node failure (not a silent skip). HTTP create/patch remain owner-scoped library-team edits.
- **Node kind vocabulary (locked):**
  - Palette / `CreateNodeRequest.node_kind`: **`domain_query`**
  - Stored `AgentNode.kind`: **`domain_query`** (do **not** invent a parallel rename)
  - `role_name`: `"domain_query"`
  - `model` / `engine`: **`None`** (generation model comes from Domain config / `ask_domain`)
  - `edits_allowed`: **`False`**
  - `config`: `{ "domain_id": "<uuid-str>" | null }` — `domain_id` may be null until the drawer sets it
  - `prompt`: question template string; default **`"{idea}"`**
- **Prompt render (locked):** replace `{idea}` with `Run.idea` (literal substring replace, not `str.format`, so braces in the idea cannot crash). Strip; if empty after render → fail with `"domain query prompt is empty"`.
- **Execution (locked):** call **`ask_domain(owner_id, domain_id, question)`** — same helper as HTTP. Persisting DomainMessages into the Domain chat history is intentional reuse (audit trail); do not fork a no-persist path in 4a.
- **Invocation / run log JSON (locked):** on success:
  - `status="done"`, `outcome="answered"`
  - `outcome_detail` = answer text (truncate to **4000** chars if needed; full answer still in DomainMessage via `ask_domain`)
  - `context_manifest` = `{ "citations": <list>, "domain_id": "<uuid>", "latency_ms": <int|null>, "model": <str|null>, "message_id": <str|null> }`
  - Citations shape unchanged from Phase 3: `{ document_id, filename, chunk_id, ordinal, excerpt, score? }`
- **Failures (locked):** map `DomainAskError` (+ missing `domain_id` / bad UUID) → `close_invocation_step(..., "failed", None, outcome_detail=<clear message>)` then `mark_run_failed_step` — same pattern as agent engine failures. Prefer human-readable `detail["message"]` when `detail` is a dict (`missing_providers`).
- **Validity (locked):** `domain_query` requires a forward exit like `completion`; **cannot be the graph root** (root must stay a thinker / `completion`). Optional warning when reachable `domain_query` has null/blank `domain_id` — or block with error code `domain_query_no_domain` when reachable (prefer **block** so Run stays greyed out).
- **UI (locked):** palette chip "Query domain"; card glyph (BookOpen / Library); drawer: Domain `<select>` (from `listDomains`) + prompt textarea; run view LastRun shows answer + citation list when `context_manifest.citations` present.
- YAGNI: **no** MCP / `domain_ask` tool (4b), **no** retrieve-only mode UI, **no** hybrid/rerank, **no** streaming, **no** new Alembic migration (config JSONB + existing columns suffice).
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` from `git log -1`); **never** `git config`.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Modify** `backend/tvashtr/routers.py` | Extend `CreateNodeRequest` / `_build_node` / `UpdateTeamNodeRequest` / `update_team_node` for `domain_query`. |
| **Modify** `backend/tvashtr/control_plane/graph_validity.py` | Route + root + missing-`domain_id` rules for `domain_query`. |
| **Modify** `backend/tvashtr/control_plane/team_run.py` | Add `domain_query_step`; dispatch `kind == "domain_query"` in `run_graph`. |
| **Create** `backend/tvashtr/control_plane/domain_query_node.py` | Pure helpers: render prompt template; format `DomainAskError` → outcome_detail string; build context_manifest. |
| **Create** `backend/tests/test_domain_query_node_helpers.py` | Unit tests for render + error formatting + manifest. |
| **Create** `backend/tests/test_domain_query_create.py` | Create/patch API for `domain_query` nodes. |
| **Create** `backend/tests/test_domain_query_validity.py` | Validity: exit edge, not root, missing domain_id. |
| **Create** `backend/tests/test_domain_query_run.py` | Executor step + run_graph branch (mocked `ask_domain`). |
| **Modify** `frontend/src/lib/api.ts` | `NodeKind`, `CreateNodeBody`, `DomainQueryConfig`, `updateDomainQueryNode`, ContextManifest citations optional. |
| **Modify** `frontend/src/canvas/paletteItems.ts` | Palette primitive "Query domain". |
| **Modify** `frontend/src/canvas/AgentNodeCard.tsx` | `DomainQueryCard` (or AgentCard branch). |
| **Modify** `frontend/src/panel/nodeGlyph.ts` | Glyph for `domain_query`. |
| **Modify** `frontend/src/panel/TeamNodePanel.tsx` | Drawer editor: domain select + prompt. |
| **Modify** `frontend/src/components/LastRun.tsx` | Show citations from `context_manifest.citations`. |
| **Create** `frontend/src/canvas/paletteItems.domainQuery.test.ts` | Palette chip smoke. |
| **Create** / **Modify** panel + LastRun tests for domain query UI. |
| **Modify** `frontend/src/index.css` / `canvas.css` | Minimal card/citation styles under existing `.rf-` / `.tv-` prefixes. |

**Out of scope (do not create for Phase 4a):** MCP tools, retrieve-only mode, hybrid/lexical retrieval, streaming, GraphRAG, new DB tables/migrations.

---

### Task 1: Pure helpers — prompt render, error text, citation manifest

**Files:**
- Create: `backend/tvashtr/control_plane/domain_query_node.py`
- Test: `backend/tests/test_domain_query_node_helpers.py`

**Interfaces:**
- Consumes: `DomainAskError` shape (`code`, `detail: str | dict`)
- Produces: `render_domain_query_prompt(template, idea) -> str`; `format_domain_ask_error(exc) -> str`; `domain_query_manifest(result, domain_id) -> dict`

- [ ] **Step 1: Write the failing helper tests**

Create `backend/tests/test_domain_query_node_helpers.py`:

```python
"""Phase 4a — domain_query node pure helpers."""

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.domain_query_node import (
    domain_query_manifest,
    format_domain_ask_error,
    render_domain_query_prompt,
    truncate_outcome_detail,
)


def test_render_replaces_idea_token():
    assert render_domain_query_prompt("Q: {idea}", "bulk discount") == "Q: bulk discount"


def test_render_leaves_other_braces_alone():
    # Must NOT use str.format — idea may contain braces.
    out = render_domain_query_prompt("look at {idea} and {not_a_field}", "x")
    assert out == "look at x and {not_a_field}"


def test_render_strips_and_rejects_empty():
    with pytest.raises(ValueError, match="empty"):
        render_domain_query_prompt("   ", "idea")
    with pytest.raises(ValueError, match="empty"):
        render_domain_query_prompt("{idea}", "   ")


def test_format_missing_providers_dict():
    exc = DomainAskError(
        "missing_providers",
        {
            "message": "you have no API key for: openai — needed to embed…",
            "missing_providers": ["openai"],
        },
    )
    text = format_domain_ask_error(exc)
    assert "openai" in text
    assert "API key" in text or "key" in text.lower()


def test_format_string_detail():
    assert "ingest" in format_domain_ask_error(
        DomainAskError("empty_corpus", "ingest documents before asking")
    )


def test_manifest_carries_citations():
    result = {
        "answer": "hi",
        "citations": [{"document_id": "d", "filename": "a.md", "chunk_id": "c", "ordinal": 0, "excerpt": "e"}],
        "latency_ms": 12,
        "model": "openai/gpt-4o-mini",
        "message_id": "m1",
    }
    m = domain_query_manifest(result, "dom-1")
    assert m["domain_id"] == "dom-1"
    assert m["citations"][0]["filename"] == "a.md"
    assert m["latency_ms"] == 12
    assert m["model"] == "openai/gpt-4o-mini"
    assert m["message_id"] == "m1"


def test_truncate_outcome_detail():
    long = "x" * 5000
    assert len(truncate_outcome_detail(long)) == 4000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_query_node_helpers.py -q`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement helpers**

Create `backend/tvashtr/control_plane/domain_query_node.py`:

```python
"""Phase 4a — Canvas Query-domain node helpers (pure; no DBOS)."""

from __future__ import annotations

from typing import Any

from tvashtr.control_plane.domain_ask import DomainAskError

_OUTCOME_DETAIL_MAX = 4000
_IDEA_TOKEN = "{idea}"


def render_domain_query_prompt(template: str | None, idea: str | None) -> str:
    """Substitute ``{idea}`` via literal replace (safe if idea contains braces)."""
    raw = (template if template is not None else _IDEA_TOKEN)
    text = str(raw).replace(_IDEA_TOKEN, idea or "")
    text = text.strip()
    if not text:
        raise ValueError("domain query prompt is empty")
    return text


def format_domain_ask_error(exc: DomainAskError) -> str:
    """Human-readable invocation ``outcome_detail`` for a DomainAskError."""
    detail = exc.detail
    if isinstance(detail, dict):
        msg = detail.get("message")
        if msg:
            return str(msg)
        missing = detail.get("missing_providers")
        if missing:
            return (
                "you have no API key for: "
                + ", ".join(str(p) for p in missing)
                + " — add keys under Engines before running this Query domain node."
            )
        return str(detail)
    return str(detail)


def truncate_outcome_detail(text: str, limit: int = _OUTCOME_DETAIL_MAX) -> str:
    if len(text) <= limit:
        return text
    return text[:limit]


def domain_query_manifest(result: dict[str, Any], domain_id: str) -> dict[str, Any]:
    """Invocation ``context_manifest`` for a successful domain query (citations live here)."""
    return {
        "citations": list(result.get("citations") or []),
        "domain_id": str(domain_id),
        "latency_ms": result.get("latency_ms"),
        "model": result.get("model"),
        "message_id": result.get("message_id"),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_domain_query_node_helpers.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_query_node.py \
  backend/tests/test_domain_query_node_helpers.py
git commit -m "$(cat <<'EOF'
feat(domains): Phase 4a domain_query prompt + error helpers

EOF
)"
```

---

### Task 2: Create + patch `domain_query` nodes (API)

**Files:**
- Modify: `backend/tvashtr/routers.py` (`CreateNodeRequest`, `_build_node`, `UpdateTeamNodeRequest`, `update_team_node`)
- Test: `backend/tests/test_domain_query_create.py`

**Interfaces:**
- Consumes: existing `create_team_node` / `update_team_node` endpoints
- Produces: `AgentNode` with `kind="domain_query"`, `config={"domain_id": ...}`, `prompt` template

- [ ] **Step 1: Write the failing create/patch tests**

Create `backend/tests/test_domain_query_create.py`:

```python
"""Phase 4a — create/patch domain_query canvas nodes."""

import uuid

from conftest import auth_user_id
from tvashtr.control_plane.domains import create_domain
from tvashtr.control_plane.teams import build_two_node_team


def _team(client):
    # Prefer library team create used elsewhere; fall back to seeded builder + list.
    tid = build_two_node_team()
    return tid


def test_create_domain_query_node(client):
    tid = _team(client)
    owner = auth_user_id()
    domain = create_domain(owner, name="Support", template="support")
    did = str(domain["id"])
    resp = client.post(
        f"/api/teams/{tid}/nodes",
        json={
            "node_kind": "domain_query",
            "domain_id": did,
            "prompt": "Answer using the corpus: {idea}",
            "position": {"x": 100, "y": 40},
        },
    )
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["kind"] == "domain_query"
    assert node["role_name"] == "domain_query"
    assert node["model"] is None
    assert node["engine"] is None
    assert node["edits_allowed"] is False
    assert node["prompt"] == "Answer using the corpus: {idea}"
    assert node["config"]["domain_id"] == did


def test_create_domain_query_defaults_prompt_and_null_domain(client):
    tid = _team(client)
    resp = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"})
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["kind"] == "domain_query"
    assert node["prompt"] == "{idea}"
    assert node["config"]["domain_id"] is None


def test_patch_domain_query_domain_and_prompt(client):
    tid = _team(client)
    owner = auth_user_id()
    domain = create_domain(owner, name="Legal", template="legal")
    did = str(domain["id"])
    created = client.post(
        f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}
    ).json()
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{created['id']}",
        json={"domain_id": did, "prompt": "Cite sources for: {idea}"},
    )
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["config"]["domain_id"] == did
    assert node["prompt"] == "Cite sources for: {idea}"


def test_create_rejects_unknown_node_kind(client):
    tid = _team(client)
    resp = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "mcp_tool"})
    assert resp.status_code == 422
```

Adjust `create_domain` / `build_two_node_team` imports to match Phase 1–3 helpers actually exported (if `create_domain` returns an ORM row, use `str(row.id)`; if tests already use `client.post("/api/domains", ...)`, prefer that for consistency):

```python
def _make_domain(client) -> str:
    r = client.post("/api/domains", json={"name": "Support docs", "template": "support"})
    assert r.status_code == 200, r.text
    return r.json()["id"]
```

Use `_make_domain` in the tests above if `create_domain` signature differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_query_create.py -q`

Expected: FAIL (`node_kind` Literal rejects `domain_query` or `_build_node` incomplete).

- [ ] **Step 3: Extend CreateNodeRequest + _build_node**

In `backend/tvashtr/routers.py`:

1. Change:

```python
node_kind: Literal["thinker", "worker", "gate", "terminal", "domain_query"]
```

2. Add optional field on `CreateNodeRequest`:

```python
domain_id: str | None = None  # domain_query only
```

3. In `_build_node`, **before** the terminal branch (after gate), add:

```python
    if body.node_kind == "domain_query":
        domain_id = body.domain_id
        if domain_id is not None:
            try:
                uuid.UUID(str(domain_id))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid domain_id") from exc
        return AgentNode(
            team_graph_id=graph_id,
            role_name="domain_query",
            kind="domain_query",
            model=None,
            engine=None,
            prompt=body.prompt if body.prompt is not None else "{idea}",
            position=position,
            edits_allowed=False,
            config={"domain_id": str(domain_id) if domain_id else None},
        )
```

4. Extend `UpdateTeamNodeRequest` with:

```python
    domain_id: str | None = None  # domain_query — model_fields_set clear/set
```

5. In `update_team_node`, **before** the agent/completion branch (after gate), add:

```python
        if node.kind == "domain_query":
            cfg = dict(node.config or {})
            if "domain_id" in body.model_fields_set:
                if body.domain_id is None or body.domain_id == "":
                    cfg["domain_id"] = None
                else:
                    try:
                        uuid.UUID(str(body.domain_id))
                    except ValueError as exc:
                        raise HTTPException(status_code=400, detail="invalid domain_id") from exc
                    cfg["domain_id"] = str(body.domain_id)
                node.config = cfg
            if "prompt" in body.model_fields_set and body.prompt is not None:
                node.prompt = body.prompt
            session.flush()
            return _node_base_dict(node)
```

Update the `CreateNodeRequest` / `UpdateTeamNodeRequest` docstrings to mention `domain_query`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_domain_query_create.py tests/test_topology_crud.py -q`

Expected: PASS (topology still accepts old kinds).

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/routers.py backend/tests/test_domain_query_create.py
git commit -m "$(cat <<'EOF'
feat(api): create/patch domain_query canvas nodes

EOF
)"
```

---

### Task 3: Graph validity for `domain_query`

**Files:**
- Modify: `backend/tvashtr/control_plane/graph_validity.py`
- Modify: `backend/tvashtr/control_plane/graph_validity.py` loader if config needed — `graph_dicts` today only passes `id`/`kind`; **extend** node dicts to include `config` so missing-`domain_id` can be checked.
- Test: `backend/tests/test_domain_query_validity.py`

**Interfaces:**
- Consumes: serialized nodes with `kind` (+ `config` for domain_id check)
- Produces: errors `no_exit`, `root_not_thinker` (unchanged for non-completion roots), `domain_query_no_domain`

- [ ] **Step 1: Write the failing validity tests**

Create `backend/tests/test_domain_query_validity.py`:

```python
"""Phase 4a — validate_graph rules for domain_query."""

from tvashtr.control_plane.graph_validity import validate_graph


def _fwd(src, tgt, eid="e1"):
    return {
        "id": eid,
        "source_node_id": src,
        "target_node_id": tgt,
        "edge_type": "work",
        "conditions": None,
    }


def test_domain_query_as_root_is_blocked():
    nodes = [
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": "11111111-1111-1111-1111-111111111111"}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("dq", "ship")]
    v = validate_graph(nodes, edges)
    assert v["runnable"] is False
    assert any(e["code"] == "root_not_thinker" for e in v["errors"])


def test_domain_query_needs_exit():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": "11111111-1111-1111-1111-111111111111"}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("pm", "dq", "e0")]  # dq has no exit
    v = validate_graph(nodes, edges)
    assert v["runnable"] is False
    assert any(e["code"] == "no_exit" and e["node_id"] == "dq" for e in v["errors"])


def test_domain_query_missing_domain_id_blocked_when_reachable():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": None}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("pm", "dq", "e0"), _fwd("dq", "ship", "e1")]
    v = validate_graph(nodes, edges)
    assert v["runnable"] is False
    assert any(e["code"] == "domain_query_no_domain" for e in v["errors"])


def test_happy_path_runnable():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {
            "id": "dq",
            "kind": "domain_query",
            "config": {"domain_id": "11111111-1111-1111-1111-111111111111"},
        },
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("pm", "dq", "e0"), _fwd("dq", "ship", "e1")]
    v = validate_graph(nodes, edges)
    assert v["runnable"] is True, v
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_query_validity.py -q`

Expected: FAIL (`domain_query` falls through route checks / no `domain_query_no_domain`).

- [ ] **Step 3: Update validate_graph + graph_dicts**

In `validate_graph` route-existence loop, after the `agent` branch:

```python
        elif kind == "domain_query":
            if next_node(redges, nid, None) is None:
                err(
                    "no_exit",
                    "This Query domain node has no outgoing connection — add a 'Then →' edge.",
                    node_id=nid,
                )
```

After route-existence (or inside the reachable loop), add:

```python
    for nid in sorted(reachable):
        n = nodes_by_id[nid]
        if n.get("kind") != "domain_query":
            continue
        cfg = n.get("config") or {}
        did = cfg.get("domain_id") if isinstance(cfg, dict) else None
        if not did:
            err(
                "domain_query_no_domain",
                "Select a Domain on this Query domain node before running.",
                node_id=nid,
            )
```

Root check already requires `kind == "completion"` — `domain_query` as root remains blocked via `root_not_thinker`. Leave that message as-is (or soften message to "The first node must be a thinker…" if tests assert substring — do **not** special-case domain_query roots beyond the existing check).

In `graph_dicts`, change node serialization to include config:

```python
    node_dicts = [{"id": str(n.id), "kind": n.kind, "config": n.config} for n in nodes]
```

Confirm existing validity tests still pass (extra `config` key is ignored by other checks).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_domain_query_validity.py tests/test_graph_validity.py -q`

Expected: PASS (adjust filename if the existing suite is named differently — `rg -l validate_graph backend/tests`).

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/graph_validity.py \
  backend/tests/test_domain_query_validity.py
git commit -m "$(cat <<'EOF'
feat(teams): validate domain_query canvas nodes

EOF
)"
```

---

### Task 4: `domain_query_step` + `run_graph` dispatch

**Files:**
- Modify: `backend/tvashtr/control_plane/team_run.py`
- Test: `backend/tests/test_domain_query_run.py`

**Interfaces:**
- Consumes: `ask_domain`, `owner_for_run`, helpers from Task 1, `open_invocation_step` / `close_invocation_step`
- Produces: checkpointed step returning `{status, answer?, citations?, error?}`; walk continues on success, fails run on error

- [ ] **Step 1: Write the failing run tests**

Create `backend/tests/test_domain_query_run.py`:

```python
"""Phase 4a — domain_query_step + run_graph branch (ask_domain mocked)."""

import uuid
from unittest.mock import MagicMock

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane import team_run
from tvashtr.control_plane.domain_query_node import domain_query_manifest


def test_domain_query_step_success(monkeypatch):
    owner = uuid.uuid4()
    domain_id = uuid.uuid4()
    run_id = str(uuid.uuid4())

    monkeypatch.setattr(
        team_run, "owner_for_run", lambda rid: owner
    )
    # Import path used inside the step — patch where resolved.
    import tvashtr.control_plane.domain_ask as domain_ask

    def _ask(oid, did, q):
        assert oid == owner
        assert did == domain_id
        assert q == "What is the refund policy?"
        return {
            "answer": "30 days",
            "citations": [
                {
                    "document_id": "d1",
                    "filename": "policy.md",
                    "chunk_id": "c1",
                    "ordinal": 0,
                    "excerpt": "Refunds within 30 days.",
                }
            ],
            "latency_ms": 9,
            "model": "openai/gpt-4o-mini",
            "message_id": "m1",
        }

    monkeypatch.setattr(domain_ask, "ask_domain", _ask)

    # Call the step function directly (DBOS step is still a plain callable in tests).
    from tvashtr.control_plane.team_run import domain_query_step

    out = domain_query_step(
        run_id,
        domain_id=str(domain_id),
        question="What is the refund policy?",
    )
    assert out["status"] == "completed"
    assert out["answer"] == "30 days"
    assert out["citations"][0]["filename"] == "policy.md"


def test_domain_query_step_byok_failure(monkeypatch):
    monkeypatch.setattr(team_run, "owner_for_run", lambda rid: uuid.uuid4())
    import tvashtr.control_plane.domain_ask as domain_ask

    def _ask(*_a, **_k):
        raise DomainAskError(
            "missing_providers",
            {
                "message": "you have no API key for: openai — needed to embed the question…",
                "missing_providers": ["openai"],
            },
        )

    monkeypatch.setattr(domain_ask, "ask_domain", _ask)
    from tvashtr.control_plane.team_run import domain_query_step

    out = domain_query_step(
        "run-1",
        domain_id=str(uuid.uuid4()),
        question="hi",
    )
    assert out["status"] == "failed"
    assert "API key" in out["error"] or "openai" in out["error"]


def test_run_graph_domain_query_branch_closes_invocation(monkeypatch):
    """Minimal walk: completion is skipped by starting at domain_query via crafted graph.

    Prefer testing the branch in isolation by invoking the same close pattern the walk uses:
    open → domain_query_step → close with manifest. Full DBOS workflow optional if harness heavy —
    at minimum assert domain_query_step + helper wiring; if an existing run_graph unit harness
    exists (see test_next_node / team_run tests), extend it.
    """
    citations = [{"document_id": "d", "filename": "a.md", "chunk_id": "c", "ordinal": 0, "excerpt": "e"}]
    manifest = domain_query_manifest(
        {"answer": "A", "citations": citations, "latency_ms": 1, "model": "m", "message_id": "mid"},
        "dom",
    )
    assert "citations" in manifest
```

If the repo has a lightweight `run_graph` harness, add one test that walks `completion → domain_query → terminal` with `ask_domain` + invocation DB mocked/real-sqlite. Prefer **mutation-real** sessions like `test_node_ask.py` when cheap: seed a library team, add a `domain_query` node, patch `ask_domain`, run the step close path. Do **not** require a live LLM.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_query_run.py -q`

Expected: FAIL (`domain_query_step` missing).

- [ ] **Step 3: Implement `domain_query_step`**

Near other steps in `team_run.py` (after imports, add):

```python
from tvashtr.control_plane.domain_ask import DomainAskError, ask_domain
from tvashtr.control_plane.domain_query_node import (
    domain_query_manifest,
    format_domain_ask_error,
    render_domain_query_prompt,
    truncate_outcome_detail,
)
from tvashtr.control_plane.node_library import owner_for_run
```

(Only add imports not already present; `owner_for_run` may need importing from `node_library`.)

```python
@DBOS.step()
def domain_query_step(run_id: str, domain_id: str, question: str) -> dict:
    """Sync cited Domain ask for a canvas Query-domain node. Reuses ``ask_domain``.

    Returns ``{status: completed|failed, answer?, citations?, error?, manifest?}``.
    """
    owner_id = owner_for_run(run_id)
    if owner_id is None:
        return {"status": "failed", "error": "run has no owner — cannot query a domain"}
    try:
        did = uuid.UUID(str(domain_id))
    except (ValueError, TypeError):
        return {"status": "failed", "error": "Query domain node has an invalid domain_id"}
    try:
        result = ask_domain(owner_id, did, question)
    except DomainAskError as exc:
        return {"status": "failed", "error": format_domain_ask_error(exc)}
    except Exception as exc:  # noqa: BLE001 — surface unexpected failures like other nodes
        return {"status": "failed", "error": f"domain query failed: {exc}"}
    return {
        "status": "completed",
        "answer": result.get("answer") or "",
        "citations": result.get("citations") or [],
        "manifest": domain_query_manifest(result, str(did)),
    }
```

- [ ] **Step 4: Dispatch in `run_graph`**

Inside `while current is not None:`, after the `completion`/`agent` block and **before** `elif kind == "gate":`, insert:

```python
        elif kind == "domain_query":
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            open_invocation_step(run_id, current, n)
            cfg = node.get("config") or {}
            domain_id = cfg.get("domain_id") if isinstance(cfg, dict) else None
            if not domain_id:
                reason = "Select a Domain on this Query domain node before running."
                close_invocation_step(run_id, current, n, "failed", None, outcome_detail=reason)
                mark_run_failed_step(run_id)
                return {
                    "run_id": run_id,
                    "status": "failed",
                    "document_id": pm_document_id,
                    "error": reason,
                }
            try:
                question = render_domain_query_prompt(node.get("prompt"), idea)
            except ValueError as exc:
                reason = str(exc)
                close_invocation_step(run_id, current, n, "failed", None, outcome_detail=reason)
                mark_run_failed_step(run_id)
                return {
                    "run_id": run_id,
                    "status": "failed",
                    "document_id": pm_document_id,
                    "error": reason,
                }
            result = domain_query_step(run_id, str(domain_id), question)
            if result.get("status") != "completed":
                reason = result.get("error") or "domain query failed"
                close_invocation_step(
                    run_id, current, n, "failed", None, outcome_detail=reason
                )
                mark_run_failed_step(run_id)
                DBOS.logger.error(f"run_team domain_query failed run_id={run_id}: {reason}")
                return {
                    "run_id": run_id,
                    "status": "failed",
                    "document_id": pm_document_id,
                    "error": reason,
                }
            close_invocation_step(
                run_id,
                current,
                n,
                "done",
                "answered",
                outcome_detail=truncate_outcome_detail(result.get("answer") or ""),
                context_manifest=result.get("manifest"),
            )
            current = next_node(edges, current, None)
            continue
```

Ensure unknown kinds still fail loudly (existing fallthrough) — do not swallow `domain_query` into the agent path.

- [ ] **Step 5: Run tests**

Run: `cd backend && uv run pytest tests/test_domain_query_run.py tests/test_domain_query_node_helpers.py -q`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/tvashtr/control_plane/team_run.py backend/tests/test_domain_query_run.py
git commit -m "$(cat <<'EOF'
feat(runtime): execute domain_query nodes via ask_domain

EOF
)"
```

---

### Task 5: Frontend types + palette + card glyph

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/canvas/paletteItems.ts`
- Modify: `frontend/src/canvas/AgentNodeCard.tsx`
- Modify: `frontend/src/panel/nodeGlyph.ts`
- Modify: `frontend/src/canvas.css` and/or `frontend/src/index.css` (minimal)
- Test: `frontend/src/canvas/paletteItems.domainQuery.test.ts`

- [ ] **Step 1: Write the failing palette test**

Create `frontend/src/canvas/paletteItems.domainQuery.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PALETTE_PRIMITIVES } from "./paletteItems";

describe("palette domain_query", () => {
  it("offers a Query domain primitive", () => {
    const chip = PALETTE_PRIMITIVES.find((c) => c.body.node_kind === "domain_query");
    expect(chip).toBeTruthy();
    expect(chip!.label.toLowerCase()).toMatch(/query domain|domain/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/canvas/paletteItems.domainQuery.test.ts`

Expected: FAIL.

- [ ] **Step 3: Extend API types + client**

In `frontend/src/lib/api.ts`:

```typescript
export type NodeKind = "thinker" | "worker" | "gate" | "terminal" | "domain_query";

export interface DomainQueryConfig {
  domain_id: string | null;
}

export type NodeConfig = GateConfig | TerminalConfig | DomainQueryConfig | Record<string, unknown>;

export interface CreateNodeBody {
  node_kind: NodeKind;
  preset?: RolePreset;
  prompt?: string;
  model?: string;
  position?: NodePosition;
  title?: string;
  description?: string;
  terminal_kind?: "ship" | "stop";
  domain_id?: string | null;
}

// Additive on ContextManifest — domain_query citations (absent for other nodes).
export interface ContextManifest {
  parts: { name: string; tokens: number }[];
  total_tokens: number;
  budget: number;
  handle_used: boolean;
  memory?: { id: string; polarity: string }[];
  // Phase 4a: present on domain_query invocation closes (parts may be empty / omitted by backend).
  citations?: DomainCitation[];
  domain_id?: string;
  latency_ms?: number | null;
  model?: string | null;
  message_id?: string | null;
}
```

Make `parts` / `total_tokens` / `budget` / `handle_used` **optional** if the domain_query manifest omits them — **preferred locked approach:** keep ContextManifest required fields for workers, and teach LastRun to read `citations` off a widened type:

```typescript
context_manifest?: (ContextManifest & {
  citations?: DomainCitation[];
  domain_id?: string;
  latency_ms?: number | null;
  model?: string | null;
  message_id?: string | null;
}) | null;
```

on `NodeInvocation` / `LastRunRound` instead of breaking worker manifests. Prefer widening `LastRunRound` + `NodeInvocation` over making worker fields optional.

Add:

```typescript
export async function updateDomainQueryNode(
  teamId: string,
  nodeId: string,
  body: { domain_id?: string | null; prompt?: string },
): Promise<TeamGraphNode> {
  const res = await fetch(`/api/teams/${teamId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`PATCH domain_query /api/teams/${teamId}/nodes/${nodeId} -> ${res.status}`);
  return (await res.json()) as TeamGraphNode;
}
```

- [ ] **Step 4: Palette + glyph + card**

`paletteItems.ts` — add to `PALETTE_PRIMITIVES` (import `BookOpen` from lucide-react):

```typescript
  {
    label: "Query domain",
    title: "Ask a Domain with citations (PolyRAG)",
    body: { node_kind: "domain_query", prompt: "{idea}" },
    Icon: BookOpen,
  },
```

`nodeGlyph.ts`:

```typescript
  if (kind === "domain_query") return BookOpen;
```

(`BookOpen` import from lucide-react.)

`AgentNodeCard.tsx` — add a compact card (reuse AgentCard shell or a dedicated `DomainQueryCard`):

```tsx
function DomainQueryCard({ nodeId, data: d }: { nodeId: string; data: AgentNodeData }) {
  const cfg = (d.config || {}) as { domain_id?: string | null };
  return (
    <div className={`rf-node rf-node--domain-query${flagClasses(d)}`} title={d.errorMessage}>
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
      <div className="rf-node__eyebrow">Query domain</div>
      <div className="rf-node__title">Domain ask</div>
      <div className="rf-node__blurb">
        {cfg.domain_id ? "Domain selected" : "Select a Domain"}
      </div>
      <StatusPill status={d.status} />
    </div>
  );
}
```

Dispatch:

```tsx
  if (d.kind === "domain_query") return <DomainQueryCard nodeId={id} data={d} />;
```

Add minimal CSS (border accent) under `.rf-node--domain-query` in `canvas.css`.

- [ ] **Step 5: Run tests**

Run: `cd frontend && npm test -- src/canvas/paletteItems.domainQuery.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/canvas/paletteItems.ts \
  frontend/src/canvas/paletteItems.domainQuery.test.ts \
  frontend/src/canvas/AgentNodeCard.tsx frontend/src/panel/nodeGlyph.ts \
  frontend/src/canvas.css
git commit -m "$(cat <<'EOF'
feat(frontend): Query domain palette chip and card

EOF
)"
```

---

### Task 6: TeamNodePanel — Domain select + prompt editor

**Files:**
- Modify: `frontend/src/panel/TeamNodePanel.tsx`
- Test: `frontend/src/panel/TeamNodePanel.domainQuery.test.tsx` (new) or extend `TeamNodePanel.test.tsx`

- [ ] **Step 1: Write the failing panel test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamNodePanel } from "./TeamNodePanel";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listDomains: vi.fn(async () => [
      { id: "dom-1", name: "Support", template: "support", status: "ready", doc_count: 2 },
    ]),
    updateDomainQueryNode: vi.fn(async (_t, _n, body) => ({
      id: "n-dq",
      role_name: "domain_query",
      kind: "domain_query",
      model: null,
      engine: null,
      prompt: body.prompt ?? "{idea}",
      position: { x: 0, y: 0 },
      config: { domain_id: body.domain_id ?? null },
    })),
  };
});

const { updateDomainQueryNode } = await import("../lib/api");

describe("TeamNodePanel domain_query", () => {
  it("saves domain_id + prompt", async () => {
    const user = userEvent.setup();
    const node = {
      id: "n-dq",
      role_name: "domain_query",
      kind: "domain_query",
      model: null,
      engine: null,
      prompt: "{idea}",
      position: { x: 0, y: 0 },
      config: { domain_id: null },
    };
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node as any}
        edges={[]}
        isStartNode={false}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await screen.findByLabelText(/domain/i);
    await user.selectOptions(screen.getByLabelText(/domain/i), "dom-1");
    const prompt = screen.getByLabelText(/prompt/i);
    await user.clear(prompt);
    await user.type(prompt, "Explain {idea}");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(updateDomainQueryNode).toHaveBeenCalledWith(
        "team-1",
        "n-dq",
        expect.objectContaining({ domain_id: "dom-1", prompt: "Explain {idea}" }),
      ),
    );
  });
});
```

Adjust props to match the real `TeamNodePanel` signature (panelMode, etc.) by copying from `TeamNodePanel.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/panel/TeamNodePanel.domainQuery.test.tsx`

Expected: FAIL (falls through to "isn't editable" or agent branch).

- [ ] **Step 3: Implement drawer branch**

In `TeamNodePanel.tsx`, before the gate branch (or after terminal), handle `node.kind === "domain_query"`:

- `useEffect` → `listDomains()` into local state
- Local state: `domainId`, `prompt`, dirty flag
- UI: `<select aria-label="Domain">` with domain names; `<textarea aria-label="Prompt template">` helper text: "Use `{idea}` for the run idea."
- Save → `updateDomainQueryNode(teamId, node.id, { domain_id: domainId || null, prompt })` then `onSaved`
- Header glyph via `glyphForNode("domain_query", node.role_name)`; subtitle "Cited ask against a Domain"

Do **not** require `model` (agent branch 422 path).

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- src/panel/TeamNodePanel.domainQuery.test.tsx src/panel/TeamNodePanel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panel/TeamNodePanel.tsx \
  frontend/src/panel/TeamNodePanel.domainQuery.test.tsx \
  frontend/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(frontend): Query domain node drawer editor

EOF
)"
```

---

### Task 7: Run log — citations under LastRun

**Files:**
- Modify: `frontend/src/components/LastRun.tsx`
- Modify: `frontend/src/lib/api.ts` (`LastRunRound` / invocation typing) if needed
- Test: `frontend/src/components/LastRun.domainQuery.test.tsx`

- [ ] **Step 1: Write the failing LastRun test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LastRun } from "./LastRun";

describe("LastRun domain_query citations", () => {
  it("renders citation filenames from context_manifest", () => {
    render(
      <LastRun
        rounds={[
          {
            iteration: 1,
            outcome: "answered",
            outcome_detail: "Refunds within 30 days.",
            status: "done",
            context_manifest: {
              citations: [
                {
                  document_id: "d1",
                  filename: "policy.md",
                  chunk_id: "c1",
                  ordinal: 0,
                  excerpt: "Refunds within 30 days.",
                },
              ],
              domain_id: "dom-1",
            } as any,
          },
        ]}
      />,
    );
    expect(screen.getByText(/answered|Refunds within 30 days/i)).toBeTruthy();
    expect(screen.getByText(/policy\.md/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/LastRun.domainQuery.test.tsx`

Expected: FAIL (no citation UI).

- [ ] **Step 3: Implement citation list**

In `LastRun.tsx`, under `outcome_detail`:

```tsx
              {Array.isArray((r.context_manifest as any)?.citations) &&
                (r.context_manifest as any).citations.length > 0 && (
                  <ul className="tv-verdict__citations">
                    {(r.context_manifest as any).citations.map((c: any, i: number) => (
                      <li key={c.chunk_id ?? i}>
                        <span className="tv-verdict__cite-file">{c.filename ?? "source"}</span>
                        {c.excerpt ? (
                          <span className="tv-verdict__cite-excerpt">{c.excerpt}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
```

Prefer typing via optional `citations?: DomainCitation[]` on a widened manifest type instead of `as any`.

Add `answered: "Answered"` to `OUTCOME_LABELS`.

Add CSS `.tv-verdict__citations` in `index.css` (compact list).

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- src/components/LastRun.domainQuery.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LastRun.tsx \
  frontend/src/components/LastRun.domainQuery.test.tsx \
  frontend/src/index.css frontend/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(frontend): show domain_query citations in Last run

EOF
)"
```

---

### Task 8: Regression gate + YAGNI check

**Files:** none new (commands only)

- [ ] **Step 1: Backend regression**

```bash
cd backend && uv run pytest \
  tests/test_domain_query_node_helpers.py \
  tests/test_domain_query_create.py \
  tests/test_domain_query_validity.py \
  tests/test_domain_query_run.py \
  tests/test_domain_ask_api.py \
  tests/test_topology_crud.py \
  -q
```

Expected: PASS

- [ ] **Step 2: Frontend regression**

```bash
cd frontend && npm test -- \
  src/canvas/paletteItems.domainQuery.test.ts \
  src/panel/TeamNodePanel.domainQuery.test.tsx \
  src/components/LastRun.domainQuery.test.tsx \
  src/canvas/TeamCanvas.test.tsx \
  src/panel/TeamNodePanel.test.tsx
```

Expected: PASS

- [ ] **Step 3: YAGNI grep (Phase 4b / 5 must stay absent)**

```bash
rg -n "domain_retrieve|domain_ask_tool|mcp.*domain|retrieve_only|hybrid|rerank" \
  backend/tvashtr/control_plane/domain_query_node.py \
  backend/tvashtr/control_plane/team_run.py \
  frontend/src/panel/TeamNodePanel.tsx \
  frontend/src/canvas/paletteItems.ts || true
```

Expected: no MCP tool wiring, no retrieve-only mode, no hybrid/rerank.

Confirm Phase 4a surfaces **are** present:

```bash
rg -n "domain_query|ask_domain|Query domain" \
  backend/tvashtr/routers.py \
  backend/tvashtr/control_plane/team_run.py \
  frontend/src/canvas/paletteItems.ts \
  frontend/src/lib/api.ts
```

Expected: matches for `domain_query` + `ask_domain` reuse + palette label.

- [ ] **Step 4: Final fixup commit only if needed**

```bash
git commit -m "$(cat <<'EOF'
test(domains): Phase 4a regression gate green

EOF
)"
```

---

## Self-review checklist (Phase 4a spec → tasks)

| Spec / locked decision | Task(s) |
|------------------------|---------|
| Canvas **Query domain** node | Tasks 2, 5, 6 |
| Kind `domain_query` (palette + stored) | Tasks 2, 5 |
| Config `domain_id` + prompt template | Tasks 1–2, 6 |
| Calls same `ask_domain` helper (no duplicate RAG) | Task 4 |
| Citations in invocation / run log JSON | Tasks 1, 4, 7 |
| BYOK → clear node error like other LLM nodes | Tasks 1, 4 |
| Web + Desktop shared React | Tasks 5–7 |
| Validity: not root; needs exit; domain selected | Task 3 |
| YAGNI: no MCP / 4b, no retrieve-only, no hybrid | Global Constraints + Task 8 |
| Branch `feat/polyrag-domains-phase4a` from phase3 tip | Global Constraints |

### Plan completeness notes

- **No TBDs** for node kind name, config shape, prompt token, invocation JSON, or failure semantics.
- **No migration** — `AgentNode.config` JSONB + `prompt` column already exist.
- **`ask_domain` persistence** into Domain chat is accepted reuse for 4a (same audit trail as HTTP Chat).
- **Phase 4b deferred:** MCP / `domain_ask` tool wrapping the same API — do not stub tool registration now.
- **Retrieve-only** deferred (design mentioned it as optional); 4a is ask-only via `ask_domain`.
