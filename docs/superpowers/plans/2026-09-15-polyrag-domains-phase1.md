# PolyRAG Domains Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 only — Domain CRUD (model + migration + authenticated API), Domains nav on web+Desktop via shared React AppShell (`Home | Domains | Engines | Tools`), list + create-from-template, and detail Overview + Config (JSON/form) — with no ingest, ask, chat, or agent node.

**Architecture:** Approach A native control-plane Domains: one owner-scoped `domains` table (JSONB `config`, stub `status`), helpers in `control_plane/domains.py`, HTTP on `/api/domains` mirroring `/api/teams` auth. Shared React Dashboard extends AppShell; Domains page owns list ↔ detail state. Desktop gets parity for free (same bundle + same-origin Fly proxy). No Document/Chunk/DomainMessage tables, no pgvector column on Domain, no ingest/ask routes.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pytest (backend); React 19 + Vitest + Testing Library + lucide-react (frontend shared by web + Electron Desktop).

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 1 only**.
- **Coding base:** When implementation starts, work on (or merge from) the mainline that already has AppShell — currently `feat/dashboard-split-nav` (commit `eaacdf7`) and branches that contain it (including `docs/polyrag-tvashtr-design`). Do **not** implement Domains nav against a pre-AppShell Dashboard.
- Surfaces: **Web and Desktop parity via shared React** — no Desktop-only Domain backend; Desktop continues same-origin `/api` proxy to Fly.
- Auth / ownership: same pattern as teams — `get_current_user` + `owner_id == current_user.id`; foreign ids → 404 (not probeable).
- Templates (exact keys): `financial` | `legal` | `scientific` | `support` | `blank`.
- Config v1 subset keys only: `chunking`, `embedding`, `retrieval`, `generation` (see Task 2 defaults). No hybrid/rerank/graph keys yet.
- Nav order (locked): **Home | Domains | Engines | Tools**.
- Detail tabs in Phase 1: **Overview** + **Config** only. Do **not** ship Documents / Chat tabs, ingest UI, ask UI, or canvas “Query domain” node.
- YAGNI: **no** Document / Chunk / DomainMessage tables; **no** pgvector column on Domain (pgvector already exists for `node_memories` — leave it alone); `doc_count` may be hard-coded `0` in API responses until Phase 2.
- Status: stub string; default `"empty"` (no docs yet). Do not invent ingest state machines beyond this.
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Do not implement Phase 2+ APIs (`/documents`, `/ingest`, `/ask`, `/messages`) even as stubs that pretend to work.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Create** `backend/tvashtr/control_plane/domains.py` | Template catalog, default configs, Domain CRUD helpers (list/create/get/update/delete), serialization. |
| **Create** `backend/tests/test_domains_helpers.py` | Unit tests for templates + default config seeding + name trim rules. |
| **Create** `backend/tests/test_domains_api.py` | Authenticated HTTP CRUD tests (owner scope, 400/404/422). |
| **Modify** `backend/tvashtr/models.py` | Add `Domain` ORM model (no Vector column). |
| **Create** `backend/alembic/versions/0033_domains.py` | Additive `domains` table migration (`down_revision` = `0032_engine_sub_statuses`). |
| **Modify** `backend/tvashtr/routers.py` | Pydantic request models + `GET/POST /api/domains` + `GET/PATCH/DELETE /api/domains/{id}` + `GET /api/domain-templates`. |
| **Modify** `frontend/src/lib/api.ts` | `DomainSummary` / `DomainDetail` types + list/create/get/update/delete clients. |
| **Create** `frontend/src/lib/domains.ts` | FE template order + labels + config parse helpers. |
| **Create** `frontend/src/lib/domains.test.ts` | Template key order + helper unit tests. |
| **Modify** `frontend/src/components/AppShell.tsx` | Extend `DashView` + `NAV` with `domains` (Home \| Domains \| Engines \| Tools). |
| **Create** `frontend/src/components/AppShell.test.tsx` | Nav order + Domains navigate callback. |
| **Create** `frontend/src/components/NewDomainDialog.tsx` | Template picker + name → `createDomain` (mirror `NewTeamDialog`). |
| **Create** `frontend/src/components/NewDomainDialog.test.tsx` | Create / validation / cancel. |
| **Create** `frontend/src/components/DomainsPage.tsx` | List + detail (Overview / Config tabs). |
| **Create** `frontend/src/components/DomainsPage.test.tsx` | List empty/populated, open detail. |
| **Create** `frontend/src/components/DomainConfigForm.tsx` | Form fields for v1 config keys + raw JSON toggle. |
| **Create** `frontend/src/components/DomainConfigForm.test.tsx` | Form ↔ JSON validation/save. |
| **Modify** `frontend/src/components/Dashboard.tsx` | `view === "domains"` → `<DomainsPage />`. |
| **Modify** `frontend/src/components/Dashboard.test.tsx` | Domains page smoke (mock). |
| **Modify** `frontend/src/index.css` | `.tv-domains*` styles reusing `.tv-dash*` / `.tv-shell*` tokens. |

**Out of scope (do not create for Phase 1):** Document/Chunk/DomainMessage models, DBOS ingest, ask/retrieve handlers, canvas node types, MCP tools, Desktop Electron harness changes.

---


### Task 1: Domain ORM model + Alembic migration

**Files:**
- Modify: `backend/tvashtr/models.py` (append near `EngineSubscriptionStatus`)
- Create: `backend/alembic/versions/0033_domains.py`
- Test: `backend/tests/test_domains_helpers.py`

**Interfaces:**
- Consumes: existing `Base`, `Uuid`, `JSONB`, `ForeignKey("users.id")` patterns
- Produces: `class Domain` with columns `id`, `owner_id`, `name`, `template`, `config`, `status`, `created_at`, `updated_at`; table name `domains`

- [ ] **Step 1: Write the failing helper smoke that imports Domain**

Create `backend/tests/test_domains_helpers.py`:

```python
"""Phase 1 Domains — template defaults + CRUD helpers (no ingest)."""

import uuid

from tvashtr.control_plane import domains as domains_cp
from tvashtr.models import Domain


def test_domain_model_importable():
    assert Domain.__tablename__ == "domains"


def test_default_config_has_v1_keys():
    cfg = domains_cp.default_config_for_template("support")
    assert set(cfg) >= {"chunking", "embedding", "retrieval", "generation"}
    assert cfg["chunking"]["strategy"] == "fixed"
    assert cfg["retrieval"]["mode"] == "dense"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py::test_domain_model_importable -q`

Expected: FAIL (`Domain` missing and/or `domains` module missing).

- [ ] **Step 3: Add the Domain model**

In `backend/tvashtr/models.py`, after `EngineSubscriptionStatus`, add:

```python
class Domain(Base):
    """Owner-scoped PolyRAG knowledge corpus config (Phase 1).

    Documents / chunks / messages arrive in later phases. ``config`` is domain.yaml-as-JSONB.
    ``status`` is a stub (``empty`` until Phase 2 ingest). NEVER store provider secrets here.
    """

    __tablename__ = "domains"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # financial | legal | scientific | support | blank
    template: Mapped[str] = mapped_column(Text, nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Phase 1 stub: empty (no documents). Later phases may set ready / indexing / error.
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="empty", default="empty")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

Do **not** add a Vector/pgvector column on Domain.

- [ ] **Step 4: Add migration `0033_domains.py`**

Create `backend/alembic/versions/0033_domains.py`:

```python
"""domains — PolyRAG Domain CRUD (Phase 1)

Revision ID: 0033_domains
Revises: 0032_engine_sub_statuses
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0033_domains"
down_revision: str | None = "0032_engine_sub_statuses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "domains",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default="empty"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_domains_owner_id", "domains", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_domains_owner_id", table_name="domains")
    op.drop_table("domains")
```

- [ ] **Step 5: Stub `control_plane/domains.py` just enough for import**

Create `backend/tvashtr/control_plane/domains.py`:

```python
"""PolyRAG Domains — Phase 1 config + CRUD helpers (no ingest/ask)."""

from __future__ import annotations

from copy import deepcopy

DOMAIN_TEMPLATE_KEYS: tuple[str, ...] = (
    "financial",
    "legal",
    "scientific",
    "support",
    "blank",
)


def default_config_for_template(template: str) -> dict:
    base = {
        "chunking": {"strategy": "fixed", "size": 800, "overlap": 100},
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 8, "mode": "dense"},
        "generation": {"model": None},
    }
    if template == "legal":
        base["chunking"] = {"strategy": "fixed", "size": 500, "overlap": 80}
    elif template == "scientific":
        base["chunking"] = {"strategy": "fixed", "size": 1000, "overlap": 150}
    elif template == "financial":
        base["chunking"] = {"strategy": "fixed", "size": 700, "overlap": 100}
    elif template == "support":
        base["chunking"] = {"strategy": "fixed", "size": 600, "overlap": 100}
    return deepcopy(base)
```

- [ ] **Step 6: Run migration locally and re-run the two tests**

```bash
cd backend && uv run alembic upgrade head
cd backend && uv run pytest tests/test_domains_helpers.py::test_domain_model_importable tests/test_domains_helpers.py::test_default_config_has_v1_keys -q
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/tvashtr/models.py backend/alembic/versions/0033_domains.py backend/tvashtr/control_plane/domains.py backend/tests/test_domains_helpers.py
git commit -m "$(cat <<'EOF'
feat(domains): add Domain model and Phase 1 migration

EOF
)"
```

---

### Task 2: Domain templates + CRUD helpers

**Files:**
- Modify: `backend/tvashtr/control_plane/domains.py`
- Modify: `backend/tests/test_domains_helpers.py`

**Interfaces:**
- Consumes: `Domain` model, `session_scope`
- Produces:
  - `list_domain_templates() -> list[dict]` with `{template, name, description}`
  - `default_config_for_template(template: str) -> dict`
  - `domain_to_dict(domain: Domain) -> dict` including `doc_count: 0`
  - `list_domains(owner_id) -> list[dict]`
  - `create_domain(owner_id, name, template) -> dict` (KeyError unknown template; ValueError blank name)
  - `get_domain(owner_id, domain_id) -> dict | None`
  - `update_domain(owner_id, domain_id, *, name=None, config=None) -> dict | None`
  - `delete_domain(owner_id, domain_id) -> bool`

- [ ] **Step 1: Extend failing tests for catalog + create**

Append to `backend/tests/test_domains_helpers.py`:

```python
def test_list_domain_templates_order_and_keys():
    keys = [t["template"] for t in domains_cp.list_domain_templates()]
    assert keys == ["financial", "legal", "scientific", "support", "blank"]
    for t in domains_cp.list_domain_templates():
        assert t["name"] and t["description"]


def test_create_domain_seeds_template_config(auth_user_id):
    summary = domains_cp.create_domain(auth_user_id, "Support docs", "support")
    assert summary["name"] == "Support docs"
    assert summary["template"] == "support"
    assert summary["status"] == "empty"
    assert summary["doc_count"] == 0
    assert summary["config"]["chunking"]["size"] == 600
    assert summary["domain_id"]


def test_create_domain_unknown_template_raises(auth_user_id):
    try:
        domains_cp.create_domain(auth_user_id, "X", "nope")
        raise AssertionError("expected KeyError")
    except KeyError:
        pass


def test_create_domain_blank_name_raises(auth_user_id):
    try:
        domains_cp.create_domain(auth_user_id, "   ", "blank")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_list_get_update_delete_owner_scoped(auth_user_id):
    other = uuid.uuid4()
    a = domains_cp.create_domain(auth_user_id, "A", "blank")
    # other owner needs a real users row if FK is enforced — prefer creating via a second
    # registered user in API tests; for helpers, only assert auth_user_id isolation:
    listed = domains_cp.list_domains(auth_user_id)
    assert any(d["domain_id"] == a["domain_id"] for d in listed)
    assert domains_cp.get_domain(other, uuid.UUID(a["domain_id"])) is None
    updated = domains_cp.update_domain(
        auth_user_id,
        uuid.UUID(a["domain_id"]),
        name="A2",
        config={
            "chunking": {"strategy": "fixed", "size": 100, "overlap": 10},
            "embedding": {"model": "text-embedding-3-small"},
            "retrieval": {"top_k": 3, "mode": "dense"},
            "generation": {"model": None},
        },
    )
    assert updated["name"] == "A2"
    assert updated["config"]["retrieval"]["top_k"] == 3
    assert domains_cp.delete_domain(auth_user_id, uuid.UUID(a["domain_id"])) is True
    assert domains_cp.get_domain(auth_user_id, uuid.UUID(a["domain_id"])) is None
```

Confirm fixture: `cd backend && rg -n "def auth_user_id" tests/conftest.py` — same fixture `test_team_library.py` uses.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py -q`

Expected: FAIL on missing functions.

- [ ] **Step 3: Implement full `domains.py`**

Replace `backend/tvashtr/control_plane/domains.py` with:

```python
"""PolyRAG Domains — Phase 1 config + CRUD helpers (no ingest/ask)."""

from __future__ import annotations

import uuid
from copy import deepcopy

from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.models import Domain

DOMAIN_TEMPLATE_KEYS: tuple[str, ...] = (
    "financial",
    "legal",
    "scientific",
    "support",
    "blank",
)

_TEMPLATE_META: dict[str, dict[str, str]] = {
    "financial": {
        "name": "Financial",
        "description": "Filings, metrics, and investor docs — mid-size chunks.",
    },
    "legal": {
        "name": "Legal",
        "description": "Contracts and policies — smaller chunks for precise cites.",
    },
    "scientific": {
        "name": "Scientific",
        "description": "Papers and methods — larger chunks for continuity.",
    },
    "support": {
        "name": "Support",
        "description": "Help center and product docs — concise retrieval chunks.",
    },
    "blank": {
        "name": "Blank",
        "description": "Start from default config and tune everything yourself.",
    },
}


def default_config_for_template(template: str) -> dict:
    base = {
        "chunking": {"strategy": "fixed", "size": 800, "overlap": 100},
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 8, "mode": "dense"},
        "generation": {"model": None},
    }
    if template == "legal":
        base["chunking"] = {"strategy": "fixed", "size": 500, "overlap": 80}
    elif template == "scientific":
        base["chunking"] = {"strategy": "fixed", "size": 1000, "overlap": 150}
    elif template == "financial":
        base["chunking"] = {"strategy": "fixed", "size": 700, "overlap": 100}
    elif template == "support":
        base["chunking"] = {"strategy": "fixed", "size": 600, "overlap": 100}
    elif template == "blank":
        pass
    else:
        raise KeyError(template)
    return deepcopy(base)


def list_domain_templates() -> list[dict]:
    return [
        {
            "template": key,
            "name": _TEMPLATE_META[key]["name"],
            "description": _TEMPLATE_META[key]["description"],
        }
        for key in DOMAIN_TEMPLATE_KEYS
    ]


def domain_to_dict(domain: Domain) -> dict:
    return {
        "domain_id": str(domain.id),
        "name": domain.name,
        "template": domain.template,
        "config": domain.config or {},
        "status": domain.status,
        "doc_count": 0,  # Phase 2 wires real counts
        "created_at": domain.created_at.isoformat(),
        "updated_at": domain.updated_at.isoformat(),
    }


def list_domains(owner_id: uuid.UUID) -> list[dict]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(Domain)
                .where(Domain.owner_id == owner_id)
                .order_by(Domain.created_at, Domain.id)
            )
            .scalars()
            .all()
        )
        return [domain_to_dict(r) for r in rows]


def create_domain(owner_id: uuid.UUID, name: str, template: str) -> dict:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("a domain name is required")
    if template not in DOMAIN_TEMPLATE_KEYS:
        raise KeyError(template)
    cfg = default_config_for_template(template)
    with session_scope() as session:
        row = Domain(
            owner_id=owner_id,
            name=cleaned,
            template=template,
            config=cfg,
            status="empty",
        )
        session.add(row)
        session.flush()
        return domain_to_dict(row)


def get_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        return None if row is None else domain_to_dict(row)


def update_domain(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    name: str | None = None,
    config: dict | None = None,
) -> dict | None:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        if name is not None:
            cleaned = name.strip()
            if not cleaned:
                raise ValueError("a domain name is required")
            row.name = cleaned
        if config is not None:
            # Fresh dict so JSONB dirty-tracking works (same pattern as gate config patches).
            row.config = dict(config)
        session.flush()
        return domain_to_dict(row)


def delete_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)
        session.flush()
        return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domains.py backend/tests/test_domains_helpers.py
git commit -m "$(cat <<'EOF'
feat(domains): templates and owner-scoped CRUD helpers

EOF
)"
```

---

### Task 3: `/api/domains` HTTP surface

**Files:**
- Modify: `backend/tvashtr/routers.py` (imports + request models + endpoints; place near teams block ~L2340)
- Create: `backend/tests/test_domains_api.py`

**Interfaces:**
- Consumes: helpers from Task 2; `get_current_user`
- Produces:
  - `GET /api/domains` → `{ domains: [...] }`
  - `POST /api/domains` body `{ template, name }` → Domain dict (400 unknown template; 422 blank name)
  - `GET /api/domains/{id}` → Domain dict (400 bad uuid; 404 foreign/missing)
  - `PATCH /api/domains/{id}` body `{ name?, config? }` → Domain dict
  - `DELETE /api/domains/{id}` → `{ domain_id, deleted: true }`
  - `GET /api/domain-templates` → `{ templates: [...] }`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_domains_api.py`:

```python
"""Phase 1 Domains HTTP CRUD — owner-scoped like /api/teams."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domains-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "domains-password"},
        ).status_code
        == 200
    )
    return c


def test_templates_endpoint():
    c = _fresh()
    body = c.get("/api/domain-templates").json()
    assert [t["template"] for t in body["templates"]] == [
        "financial",
        "legal",
        "scientific",
        "support",
        "blank",
    ]


def test_list_empty_then_create_and_get():
    c = _fresh()
    assert c.get("/api/domains").json() == {"domains": []}
    resp = c.post("/api/domains", json={"template": "support", "name": "Support docs"})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["name"] == "Support docs"
    assert row["template"] == "support"
    assert row["status"] == "empty"
    assert row["doc_count"] == 0
    assert row["config"]["embedding"]["model"] == "text-embedding-3-small"
    listed = c.get("/api/domains").json()["domains"]
    assert len(listed) == 1
    got = c.get(f"/api/domains/{row['domain_id']}").json()
    assert got["domain_id"] == row["domain_id"]


def test_create_unknown_template_400():
    c = _fresh()
    assert c.post("/api/domains", json={"template": "nope", "name": "X"}).status_code == 400


def test_create_blank_name_422():
    c = _fresh()
    assert c.post("/api/domains", json={"template": "blank", "name": "  "}).status_code == 422


def test_patch_config_and_delete():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "Tmp"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {"top_k": 4, "mode": "dense"}
    patched = c.patch(f"/api/domains/{row['domain_id']}", json={"name": "Tmp2", "config": cfg})
    assert patched.status_code == 200
    assert patched.json()["name"] == "Tmp2"
    assert patched.json()["config"]["retrieval"]["top_k"] == 4
    assert c.delete(f"/api/domains/{row['domain_id']}").json() == {
        "domain_id": row["domain_id"],
        "deleted": True,
    }
    assert c.get(f"/api/domains/{row['domain_id']}").status_code == 404


def test_foreign_domain_404():
    a = _fresh()
    b = _fresh()
    row = a.post("/api/domains", json={"template": "legal", "name": "Secret"}).json()
    assert b.get(f"/api/domains/{row['domain_id']}").status_code == 404
    assert b.patch(f"/api/domains/{row['domain_id']}", json={"name": "Hack"}).status_code == 404
    assert b.delete(f"/api/domains/{row['domain_id']}").status_code == 404


def test_invalid_id_400():
    c = _fresh()
    assert c.get("/api/domains/not-a-uuid").status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_domains_api.py -q`

Expected: FAIL (404 on routes).

- [ ] **Step 3: Wire routers**

In `backend/tvashtr/routers.py`:

1. Add import:

```python
from tvashtr.control_plane.domains import (
    create_domain,
    delete_domain,
    get_domain,
    list_domain_templates,
    list_domains,
    update_domain,
)
```

2. Add request models near `CreateTeamRequest`:

```python
class CreateDomainRequest(BaseModel):
    template: str
    name: str


class UpdateDomainRequest(BaseModel):
    name: str | None = None
    config: dict | None = None
```

3. Add endpoints (near the teams block):

```python
@router.get("/api/domain-templates")
def get_domain_templates(
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    return {"templates": list_domain_templates()}


@router.get("/api/domains")
def get_domains(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    return {"domains": list_domains(uuid.UUID(current_user.id))}


@router.post("/api/domains")
def post_domain(
    body: CreateDomainRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    try:
        return create_domain(owner_id, body.name, body.template)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="unknown template") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _parse_domain_id(domain_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(domain_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid domain id") from exc


@router.get("/api/domains/{domain_id}")
def get_domain_endpoint(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    row = get_domain(uuid.UUID(current_user.id), _parse_domain_id(domain_id))
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return row


@router.patch("/api/domains/{domain_id}")
def patch_domain(
    domain_id: str,
    body: UpdateDomainRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    try:
        row = update_domain(
            uuid.UUID(current_user.id),
            _parse_domain_id(domain_id),
            name=body.name,
            config=body.config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return row


@router.delete("/api/domains/{domain_id}")
def delete_domain_endpoint(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    did = _parse_domain_id(domain_id)
    ok = delete_domain(uuid.UUID(current_user.id), did)
    if not ok:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"domain_id": str(did), "deleted": True}
```

- [ ] **Step 4: Run API tests**

Run: `cd backend && uv run pytest tests/test_domains_api.py tests/test_domains_helpers.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/routers.py backend/tests/test_domains_api.py
git commit -m "$(cat <<'EOF'
feat(domains): add authenticated /api/domains CRUD

EOF
)"
```

---

### Task 4: Frontend API client + domain template helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/domains.ts`
- Create: `frontend/src/lib/domains.test.ts`

**Interfaces:**
- Consumes: `getJSON` / `fetch` / `apiUrl` in `api.ts`
- Produces: `DomainSummary`, `listDomains`, `getDomainTemplates`, `createDomain`, `getDomain`, `updateDomain`, `deleteDomain`; `DOMAIN_TEMPLATE_ORDER`, `labelForDomainTemplate`, `parseDomainConfig`

- [ ] **Step 1: Write failing FE unit test**

Create `frontend/src/lib/domains.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { DOMAIN_TEMPLATE_ORDER, labelForDomainTemplate } from "./domains";

describe("domains helpers", () => {
  it("orders templates financial → legal → scientific → support → blank", () => {
    expect(DOMAIN_TEMPLATE_ORDER).toEqual([
      "financial",
      "legal",
      "scientific",
      "support",
      "blank",
    ]);
  });

  it("labels known templates", () => {
    expect(labelForDomainTemplate("legal")).toBe("Legal");
    expect(labelForDomainTemplate("support")).toBe("Support");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/domains.test.ts`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `domains.ts` + API client**

Create `frontend/src/lib/domains.ts`:

```typescript
export type DomainTemplateKey =
  | "financial"
  | "legal"
  | "scientific"
  | "support"
  | "blank";

export const DOMAIN_TEMPLATE_ORDER: DomainTemplateKey[] = [
  "financial",
  "legal",
  "scientific",
  "support",
  "blank",
];

const LABELS: Record<DomainTemplateKey, string> = {
  financial: "Financial",
  legal: "Legal",
  scientific: "Scientific",
  support: "Support",
  blank: "Blank",
};

export function labelForDomainTemplate(template: string): string {
  return (LABELS as Record<string, string>)[template] ?? template;
}

/** Phase 1 v1 config shape (matches backend defaults). */
export interface DomainConfig {
  chunking: { strategy: string; size: number; overlap: number };
  embedding: { model: string };
  retrieval: { top_k: number; mode: string };
  generation: { model: string | null };
}

export function parseDomainConfig(raw: unknown): DomainConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as DomainConfig;
  if (!c.chunking || !c.embedding || !c.retrieval || !c.generation) return null;
  return c;
}
```

Append to `frontend/src/lib/api.ts` (near the teams client block):

```typescript
export interface DomainSummary {
  domain_id: string;
  name: string;
  template: string;
  config: Record<string, unknown>;
  status: string;
  doc_count: number;
  created_at: string;
  updated_at: string;
}

export type DomainDetail = DomainSummary;

export interface DomainTemplate {
  template: string;
  name: string;
  description: string;
}

export async function listDomains(): Promise<DomainSummary[]> {
  const data = await getJSON<{ domains: DomainSummary[] }>("/api/domains");
  return data.domains;
}

export async function getDomainTemplates(): Promise<DomainTemplate[]> {
  const data = await getJSON<{ templates: DomainTemplate[] }>("/api/domain-templates");
  return data.templates;
}

export async function createDomain(template: string, name: string): Promise<DomainSummary> {
  const res = await fetch(apiUrl("/api/domains"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template, name }),
  });
  if (!res.ok) throw new Error(`POST /api/domains -> ${res.status}`);
  return (await res.json()) as DomainSummary;
}

export async function getDomain(domainId: string): Promise<DomainDetail> {
  return getJSON<DomainDetail>(`/api/domains/${domainId}`);
}

export async function updateDomain(
  domainId: string,
  body: { name?: string; config?: Record<string, unknown> },
): Promise<DomainDetail> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /api/domains/${domainId} -> ${res.status}`);
  return (await res.json()) as DomainDetail;
}

export async function deleteDomain(domainId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}`), { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/domains/${domainId} -> ${res.status}`);
}
```

- [ ] **Step 4: Run unit tests**

Run: `cd frontend && npm test -- src/lib/domains.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/domains.ts frontend/src/lib/domains.test.ts frontend/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(frontend): Domain API client and template helpers

EOF
)"
```

---

### Task 5: AppShell nav — add Domains

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Create: `frontend/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: lucide-react icons
- Produces: `DashView = "home" | "domains" | "engines" | "tools"`; NAV order Home → Domains → Engines → Tools

- [ ] **Step 1: Write failing AppShell test**

Create `frontend/src/components/AppShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders Home | Domains | Engines | Tools in order", () => {
    render(
      <AppShell view="home" onNavigate={vi.fn()} brand={<span>Tvashtr</span>}>
        <div>main</div>
      </AppShell>,
    );
    const labels = ["Home", "Domains", "Engines", "Tools"];
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => labels.includes(b.textContent ?? ""));
    expect(buttons.map((b) => b.textContent)).toEqual(labels);
  });

  it("notifies onNavigate when Domains is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <AppShell view="home" onNavigate={onNavigate} brand={<span>Tvashtr</span>}>
        <div>main</div>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Domains" }));
    expect(onNavigate).toHaveBeenCalledWith("domains");
  });
});
```

If `@testing-library/user-event` is not used elsewhere, mirror `Dashboard.test.tsx` click helpers (`fireEvent`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/AppShell.test.tsx`

Expected: FAIL (Domains missing).

- [ ] **Step 3: Update AppShell**

Replace contents of `frontend/src/components/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { BookOpen, Home, KeyRound, Wrench } from "lucide-react";

export type DashView = "home" | "domains" | "engines" | "tools";

const NAV: { id: DashView; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "domains", label: "Domains", icon: BookOpen },
  { id: "engines", label: "Engines", icon: KeyRound },
  { id: "tools", label: "Tools", icon: Wrench },
];

/**
 * Dashboard app shell — sticky left nav (Home / Domains / Engines / Tools) + main content column.
 * Account chip stays in the top bar (passed as `barRight`); optional `navFooter` for a chip in the rail.
 */
export function AppShell({
  view,
  onNavigate,
  brand,
  barRight,
  navFooter,
  children,
}: {
  view: DashView;
  onNavigate: (v: DashView) => void;
  brand: ReactNode;
  barRight?: ReactNode;
  navFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tv-dash tv-shell">
      <header className="tv-dash__bar">
        <div className="tv-dash__brand">{brand}</div>
        {barRight && <div className="tv-dash__bar-right">{barRight}</div>}
      </header>
      <div className="tv-shell__body">
        <nav className="tv-shell__nav" aria-label="Dashboard">
          <ul className="tv-shell__nav-list">
            {NAV.map(({ id, label, icon: Icon }) => {
              const active = view === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`tv-shell__nav-btn${active ? " tv-shell__nav-btn--active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={16} strokeWidth={1.8} aria-hidden />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
          {navFooter && <div className="tv-shell__nav-foot">{navFooter}</div>}
        </nav>
        <div className="tv-shell__main">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run AppShell tests**

Run: `cd frontend && npm test -- src/components/AppShell.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/AppShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add Domains to AppShell nav

EOF
)"
```

---

### Task 6: New domain dialog + Domains list + detail shell

**Files:**
- Create: `frontend/src/components/NewDomainDialog.tsx`
- Create: `frontend/src/components/NewDomainDialog.test.tsx`
- Create: `frontend/src/components/DomainsPage.tsx`
- Create: `frontend/src/components/DomainsPage.test.tsx`
- Create: `frontend/src/components/DomainConfigForm.tsx` (stub OK; Task 7 replaces)
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `createDomain`, `getDomainTemplates`, `listDomains`, `getDomain`, `deleteDomain`, `updateDomain`
- Produces: list UI + New domain dialog + detail with Overview/Config tabs (Config body filled in Task 7)

- [ ] **Step 1: Write failing NewDomainDialog test**

Create `frontend/src/components/NewDomainDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "../lib/api";
import { NewDomainDialog } from "./NewDomainDialog";

vi.mock("../lib/api", () => ({
  createDomain: vi.fn(),
  getDomainTemplates: vi.fn(),
}));

const m = api as unknown as { createDomain: Mock; getDomainTemplates: Mock };

describe("NewDomainDialog", () => {
  beforeEach(() => {
    m.getDomainTemplates.mockResolvedValue([
      { template: "support", name: "Support", description: "Help docs" },
    ]);
    m.createDomain.mockResolvedValue({
      domain_id: "d1",
      name: "Support docs",
      template: "support",
      config: {},
      status: "empty",
      doc_count: 0,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    });
  });

  it("creates with selected template and name", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewDomainDialog onCreated={onCreated} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/domain name/i), "Support docs");
    await user.click(await screen.findByRole("button", { name: /Support/i }));
    await user.click(screen.getByRole("button", { name: /Create domain/i }));
    await waitFor(() => expect(m.createDomain).toHaveBeenCalledWith("support", "Support docs"));
    expect(onCreated).toHaveBeenCalledWith("d1");
  });

  it("requires a name", async () => {
    const user = userEvent.setup();
    render(<NewDomainDialog onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Create domain/i }));
    expect(m.createDomain).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/NewDomainDialog.test.tsx`

Expected: FAIL

- [ ] **Step 3: Implement NewDomainDialog**

Create `frontend/src/components/NewDomainDialog.tsx` (mirror `NewTeamDialog.tsx`):

```tsx
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { createDomain, getDomainTemplates, type DomainTemplate } from "../lib/api";
import { useModalDialog } from "../lib/useModalDialog";

export function NewDomainDialog({
  onCreated,
  onClose,
}: {
  onCreated: (domainId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<DomainTemplate[]>([]);
  const [selected, setSelected] = useState<string>("blank");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalDialog<HTMLDivElement>(true, onClose);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDomainTemplates()
      .then((t) => {
        if (!cancelled) {
          setTemplates(t);
          if (t.length) setSelected(t[0].template);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load domain templates — is the backend running?");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give this domain a name so you can tell it apart.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createDomain(selected, trimmed);
      onCreated(created.domain_id);
    } catch {
      if (mountedRef.current) {
        setError("Couldn't create the domain — is the backend running?");
        setCreating(false);
      }
    }
  };

  return (
    <>
      <div className="tv-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="tv-dash__dialog tv-card"
        role="dialog"
        aria-modal="true"
        aria-label="New domain"
        ref={dialogRef}
      >
        <header className="tv-dash__dialog-head">
          <h2 className="tv-dash__dialog-title">New domain</h2>
          <button type="button" className="tv-panel__close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.7} />
          </button>
        </header>
        <div className="tv-dash__dialog-body">
          <label className="tv-field">
            <span className="tv-field__label">Name</span>
            <input
              className="tv-launch__input"
              value={name}
              aria-label="Domain name"
              placeholder="e.g. Support docs"
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
            />
          </label>
          <div className="tv-field">
            <span className="tv-field__label">Template</span>
            <ul className="tv-dash__templates">
              {templates.map((c) => (
                <li key={c.template}>
                  <button
                    type="button"
                    className={`tv-dash__template${
                      selected === c.template ? " tv-dash__template--active" : ""
                    }`}
                    aria-pressed={selected === c.template}
                    onClick={() => setSelected(c.template)}
                  >
                    <span className="tv-dash__template-name">{c.name}</span>
                    <span className="tv-dash__template-desc">{c.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {error && (
            <div className="tv-dash__error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="tv-dash__dialog-foot">
          <button type="button" className="tv-btn" onClick={() => void create()} disabled={creating}>
            {creating ? "Creating…" : "Create domain"}
          </button>
          <button type="button" className="tv-btn tv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Stub DomainConfigForm + implement DomainsPage**

Create stub `frontend/src/components/DomainConfigForm.tsx` (replaced in Task 7):

```tsx
export function DomainConfigForm(_props: {
  initial: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => Promise<void>;
}) {
  return <p>Config form loading…</p>;
}
```

Create `frontend/src/components/DomainsPage.tsx` with list + detail shell (Overview fully implemented; Config hosts stub until Task 7). Use the structure below — keep Overview/Config tabs, delete on Overview, and call `updateDomain` from Config once Task 7 lands.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import {
  deleteDomain,
  getDomain,
  listDomains,
  updateDomain,
  type DomainDetail,
  type DomainSummary,
} from "../lib/api";
import { labelForDomainTemplate } from "../lib/domains";
import { DomainConfigForm } from "./DomainConfigForm";
import { NewDomainDialog } from "./NewDomainDialog";

type DetailTab = "overview" | "config";

export function DomainsPage() {
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DomainDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await listDomains();
      if (mountedRef.current) {
        setDomains(rows);
        setError(null);
      }
    } catch {
      if (mountedRef.current) setError("Couldn't load domains — is the backend running?");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getDomain(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load domain.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (selectedId && detail) {
    return (
      <div className="tv-domains">
        <header className="tv-dash__page-head tv-domains__detail-head">
          <button
            type="button"
            className="tv-btn tv-btn--ghost"
            onClick={() => {
              setSelectedId(null);
              setTab("overview");
            }}
          >
            ← Domains
          </button>
          <h1 className="tv-dash__page-title">{detail.name}</h1>
          <p className="tv-dash__page-lede">
            {labelForDomainTemplate(detail.template)} · {detail.status}
          </p>
        </header>
        <div className="tv-domains__tabs" role="tablist" aria-label="Domain sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "overview"}
            className={`tv-domains__tab${tab === "overview" ? " tv-domains__tab--active" : ""}`}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "config"}
            className={`tv-domains__tab${tab === "config" ? " tv-domains__tab--active" : ""}`}
            onClick={() => setTab("config")}
          >
            Config
          </button>
        </div>
        {tab === "overview" && (
          <section className="tv-domains__panel" aria-label="Overview">
            <dl className="tv-domains__meta">
              <div>
                <dt>Template</dt>
                <dd>{labelForDomainTemplate(detail.template)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{detail.status}</dd>
              </div>
              <div>
                <dt>Documents</dt>
                <dd>{detail.doc_count} (ingest arrives in a later phase)</dd>
              </div>
              <div>
                <dt>Embedding model</dt>
                <dd>
                  {String(
                    (detail.config as { embedding?: { model?: string } })?.embedding?.model ?? "—",
                  )}
                </dd>
              </div>
            </dl>
            <p className="tv-domains__hint">
              Upload, chat, and agent query land in later phases. Configure chunking and retrieval
              under Config; set provider keys under Engines before ingest.
            </p>
            <button
              type="button"
              className="tv-btn tv-btn--danger"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    await deleteDomain(detail.domain_id);
                    setSelectedId(null);
                    await refresh();
                  } finally {
                    if (mountedRef.current) setBusy(false);
                  }
                })();
              }}
            >
              Delete domain
            </button>
          </section>
        )}
        {tab === "config" && (
          <section className="tv-domains__panel" aria-label="Config">
            <DomainConfigForm
              initial={detail.config}
              onSave={async (config) => {
                const updated = await updateDomain(detail.domain_id, { config });
                setDetail(updated);
                await refresh();
              }}
            />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="tv-domains">
      <header className="tv-dash__page-head">
        <div className="tv-domains__list-head">
          <div>
            <h1 className="tv-dash__page-title">Domains</h1>
            <p className="tv-dash__page-lede">
              Config-driven knowledge corpora — create a domain, tune retrieval config, then ingest
              in a later phase.
            </p>
          </div>
          <button type="button" className="tv-btn" onClick={() => setPicking(true)}>
            <Plus size={15} strokeWidth={2} />
            New domain
          </button>
        </div>
      </header>
      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}
      {domains.length === 0 ? (
        <p className="tv-domains__empty">No domains yet. Create one from a template to get started.</p>
      ) : (
        <ul className="tv-domains__list">
          {domains.map((d) => (
            <li key={d.domain_id}>
              <button
                type="button"
                className="tv-domains__card"
                onClick={() => setSelectedId(d.domain_id)}
              >
                <span className="tv-domains__card-name">{d.name}</span>
                <span className="tv-domains__card-meta">
                  {labelForDomainTemplate(d.template)} · {d.doc_count} docs · {d.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <NewDomainDialog
          onCreated={(id) => {
            setPicking(false);
            setSelectedId(id);
            void refresh();
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
```

Create `frontend/src/components/DomainsPage.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "../lib/api";
import { DomainsPage } from "./DomainsPage";

vi.mock("../lib/api", () => ({
  listDomains: vi.fn(),
  getDomainTemplates: vi.fn(),
  createDomain: vi.fn(),
  getDomain: vi.fn(),
  updateDomain: vi.fn(),
  deleteDomain: vi.fn(),
}));

const m = api as unknown as {
  listDomains: Mock;
  getDomainTemplates: Mock;
  getDomain: Mock;
};

describe("DomainsPage list", () => {
  beforeEach(() => {
    m.listDomains.mockResolvedValue([]);
    m.getDomainTemplates.mockResolvedValue([
      { template: "blank", name: "Blank", description: "Default config" },
    ]);
  });

  it("shows empty state and opens new-domain dialog", async () => {
    const user = userEvent.setup();
    render(<DomainsPage />);
    expect(await screen.findByText(/No domains yet/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /New domain/i }));
    expect(screen.getByRole("dialog", { name: /New domain/i })).toBeTruthy();
  });

  it("lists domains and opens detail on click", async () => {
    const user = userEvent.setup();
    m.listDomains.mockResolvedValue([
      {
        domain_id: "d1",
        name: "Support docs",
        template: "support",
        config: { embedding: { model: "text-embedding-3-small" } },
        status: "empty",
        doc_count: 0,
        created_at: "2026-09-15T00:00:00Z",
        updated_at: "2026-09-15T00:00:00Z",
      },
    ]);
    m.getDomain.mockResolvedValue({
      domain_id: "d1",
      name: "Support docs",
      template: "support",
      config: {
        chunking: { strategy: "fixed", size: 600, overlap: 100 },
        embedding: { model: "text-embedding-3-small" },
        retrieval: { top_k: 8, mode: "dense" },
        generation: { model: null },
      },
      status: "empty",
      doc_count: 0,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    });
    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    await waitFor(() => expect(m.getDomain).toHaveBeenCalledWith("d1"));
    expect(await screen.findByRole("tab", { name: /Overview/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Config/i })).toBeTruthy();
  });
});
```

Append CSS to `frontend/src/index.css`:

```css
/* ---- Domains (Phase 1) ---- */
.tv-domains__list-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.tv-domains__empty {
  opacity: 0.75;
  margin-top: 1.5rem;
}
.tv-domains__list {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0 0;
  display: grid;
  gap: 0.75rem;
}
.tv-domains__card {
  width: 100%;
  text-align: left;
  border: 1px solid var(--tv-border, rgba(255, 255, 255, 0.08));
  background: var(--tv-card, rgba(255, 255, 255, 0.03));
  border-radius: 12px;
  padding: 1rem 1.1rem;
  cursor: pointer;
}
.tv-domains__card:hover {
  border-color: rgba(255, 255, 255, 0.18);
}
.tv-domains__card-name {
  display: block;
  font-weight: 600;
}
.tv-domains__card-meta {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.875rem;
  opacity: 0.7;
}
.tv-domains__tabs {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.tv-domains__tab {
  border: none;
  background: transparent;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  opacity: 0.7;
}
.tv-domains__tab--active {
  background: rgba(255, 255, 255, 0.08);
  opacity: 1;
  font-weight: 600;
}
.tv-domains__panel {
  margin-top: 0.5rem;
}
.tv-domains__meta {
  display: grid;
  gap: 0.75rem;
}
.tv-domains__meta dt {
  font-size: 0.75rem;
  opacity: 0.6;
}
.tv-domains__meta dd {
  margin: 0.15rem 0 0;
}
.tv-domains__hint {
  margin: 1rem 0;
  opacity: 0.75;
  max-width: 40rem;
}
```

- [ ] **Step 5: Run FE tests**

```bash
cd frontend && npm test -- src/components/NewDomainDialog.test.tsx src/components/DomainsPage.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/NewDomainDialog.tsx frontend/src/components/NewDomainDialog.test.tsx frontend/src/components/DomainsPage.tsx frontend/src/components/DomainsPage.test.tsx frontend/src/components/DomainConfigForm.tsx frontend/src/index.css
git commit -m "$(cat <<'EOF'
feat(frontend): Domains list, dialog, and detail shell

EOF
)"
```

---

### Task 7: Domain Config form (JSON + structured fields)

**Files:**
- Modify: `frontend/src/components/DomainConfigForm.tsx` (replace stub)
- Create: `frontend/src/components/DomainConfigForm.test.tsx`
- Modify: `frontend/src/index.css` (config form styles)

**Interfaces:**
- Consumes: `DomainConfig` / `parseDomainConfig` from `domains.ts`
- Produces: form editing chunk size/overlap, embedding model, top_k, mode, generation model + raw JSON toggle; Save → `onSave`

- [ ] **Step 1: Write failing Config form test**

Create `frontend/src/components/DomainConfigForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DomainConfigForm } from "./DomainConfigForm";

const sample = {
  chunking: { strategy: "fixed", size: 800, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: { top_k: 8, mode: "dense" },
  generation: { model: null },
};

describe("DomainConfigForm", () => {
  it("edits top_k via form and saves", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const topK = screen.getByLabelText(/top k/i);
    await user.clear(topK);
    await user.type(topK, "5");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.retrieval.top_k).toBe(5);
  });

  it("rejects invalid JSON in raw mode", async () => {
    const user = userEvent.setup();
    render(<DomainConfigForm initial={sample} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Raw JSON/i }));
    const area = screen.getByLabelText(/config json/i);
    await user.clear(area);
    await user.type(area, "{not-json");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/DomainConfigForm.test.tsx`

Expected: FAIL (stub has no form controls).

- [ ] **Step 3: Implement DomainConfigForm**

Replace `frontend/src/components/DomainConfigForm.tsx`:

```tsx
import { useMemo, useState } from "react";

import { parseDomainConfig, type DomainConfig } from "../lib/domains";

function asConfig(initial: Record<string, unknown>): DomainConfig {
  return (
    parseDomainConfig(initial) ?? {
      chunking: { strategy: "fixed", size: 800, overlap: 100 },
      embedding: { model: "text-embedding-3-small" },
      retrieval: { top_k: 8, mode: "dense" },
      generation: { model: null },
    }
  );
}

export function DomainConfigForm({
  initial,
  onSave,
}: {
  initial: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => Promise<void>;
}) {
  const seed = useMemo(() => asConfig(initial), [initial]);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [cfg, setCfg] = useState<DomainConfig>(seed);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(seed, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    let next: DomainConfig = cfg;
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        const ok = parseDomainConfig(parsed);
        if (!ok) {
          setError("JSON must include chunking, embedding, retrieval, and generation objects.");
          return;
        }
        next = ok;
      } catch {
        setError("Invalid JSON.");
        return;
      }
    }
    setSaving(true);
    try {
      await onSave(next as unknown as Record<string, unknown>);
      setCfg(next);
      setJsonText(JSON.stringify(next, null, 2));
    } catch {
      setError("Couldn't save config.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tv-domains__config">
      <div className="tv-domains__config-modes">
        <button
          type="button"
          className={`tv-btn tv-btn--ghost${mode === "form" ? " tv-domains__tab--active" : ""}`}
          onClick={() => {
            setMode("form");
            try {
              setCfg(asConfig(JSON.parse(jsonText)));
            } catch {
              /* keep current cfg if JSON invalid while switching */
            }
          }}
        >
          Form
        </button>
        <button
          type="button"
          className={`tv-btn tv-btn--ghost${mode === "json" ? " tv-domains__tab--active" : ""}`}
          onClick={() => {
            setJsonText(JSON.stringify(cfg, null, 2));
            setMode("json");
          }}
        >
          Raw JSON
        </button>
      </div>

      {mode === "form" ? (
        <div className="tv-domains__config-grid">
          <label className="tv-field">
            <span className="tv-field__label">Chunk size</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Chunk size"
              value={cfg.chunking.size}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  chunking: { ...cfg.chunking, size: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Chunk overlap</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Chunk overlap"
              value={cfg.chunking.overlap}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  chunking: { ...cfg.chunking, overlap: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Embedding model</span>
            <input
              className="tv-launch__input"
              aria-label="Embedding model"
              value={cfg.embedding.model}
              onChange={(e) =>
                setCfg({ ...cfg, embedding: { ...cfg.embedding, model: e.target.value } })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Top K</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Top K"
              value={cfg.retrieval.top_k}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: { ...cfg.retrieval, top_k: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Retrieval mode</span>
            <input
              className="tv-launch__input"
              aria-label="Retrieval mode"
              value={cfg.retrieval.mode}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: { ...cfg.retrieval, mode: e.target.value },
                })
              }
            />
            <span className="tv-field__hint">Phase 1: dense only. Hybrid arrives later.</span>
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Generation model</span>
            <input
              className="tv-launch__input"
              aria-label="Generation model"
              value={cfg.generation.model ?? ""}
              placeholder="null = account default later"
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  generation: { model: e.target.value.trim() ? e.target.value : null },
                })
              }
            />
          </label>
        </div>
      ) : (
        <label className="tv-field">
          <span className="tv-field__label">Config JSON</span>
          <textarea
            className="tv-launch__input tv-domains__json"
            aria-label="Config JSON"
            rows={16}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
        </label>
      )}

      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}

      <button type="button" className="tv-btn" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save config"}
      </button>
    </div>
  );
}
```

Append CSS:

```css
.tv-domains__config-modes {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.tv-domains__config-grid {
  display: grid;
  gap: 0.85rem;
  max-width: 28rem;
  margin-bottom: 1rem;
}
.tv-domains__json {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  min-height: 16rem;
}
```

- [ ] **Step 4: Run Config + DomainsPage tests**

```bash
cd frontend && npm test -- src/components/DomainConfigForm.test.tsx src/components/DomainsPage.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DomainConfigForm.tsx frontend/src/components/DomainConfigForm.test.tsx frontend/src/index.css
git commit -m "$(cat <<'EOF'
feat(frontend): Domain config form and raw JSON editor

EOF
)"
```

---

### Task 8: Wire Domains into Dashboard

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`
- Modify: `frontend/src/components/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `DomainsPage`, updated `DashView`
- Produces: `view === "domains"` renders `<DomainsPage />`

- [ ] **Step 1: Extend Dashboard test**

In `frontend/src/components/Dashboard.test.tsx`, add mock near other component mocks:

```typescript
vi.mock("./DomainsPage", () => ({
  DomainsPage: () => <div>Domains page mock</div>,
}));
```

Add a test mirroring the existing `initialView=engines` case (~L160):

```tsx
it("initialView=domains lands on the Domains page", async () => {
  // use the same render helper / props pattern as the engines initialView test
  render(
    <Dashboard
      user={{ id: "u1", email: "a@b.co" } as never}
      onLogout={vi.fn()}
      onOpenTeam={vi.fn()}
      onOpenRun={vi.fn()}
      initialView="domains"
    />,
  );
  expect(await screen.findByText(/Domains page mock/i)).toBeTruthy();
});
```

Adjust props to match whatever `Dashboard.test.tsx` already passes for the engines deep-link test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/Dashboard.test.tsx -t domains`

Expected: FAIL until wired.

- [ ] **Step 3: Wire Dashboard**

In `frontend/src/components/Dashboard.tsx`:

1. `import { DomainsPage } from "./DomainsPage";`
2. After the `home` block (before `engines`), add:

```tsx
{view === "domains" && (
  <div className="tv-dash__stack">
    <DomainsPage />
  </div>
)}
```

- [ ] **Step 4: Run frontend suite slices**

```bash
cd frontend && npm test -- src/components/AppShell.test.tsx src/components/DomainsPage.test.tsx src/components/NewDomainDialog.test.tsx src/components/DomainConfigForm.test.tsx src/components/Dashboard.test.tsx src/lib/domains.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Dashboard.tsx frontend/src/components/Dashboard.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): wire Domains page into Dashboard shell

EOF
)"
```

---

### Task 9: Regression gate + manual checklist

**Files:** none new — verification only

- [ ] **Step 1: Backend regression**

```bash
cd backend && uv run pytest tests/test_domains_helpers.py tests/test_domains_api.py tests/test_engines_subscriptions_api.py -q
```

Expected: PASS

- [ ] **Step 2: Confirm migration head**

Run: `cd backend && uv run alembic heads`

Expected: includes `0033_domains`

- [ ] **Step 3: Manual UI checklist (web or Desktop)**

1. Log in → left nav shows **Home | Domains | Engines | Tools**
2. Domains → New domain → Support template → name “Support docs” → create
3. Overview shows template / status / `0` docs
4. Config → change Top K → Save → reopen → value persists
5. Delete domain → back to empty/list
6. Desktop: same flows (shared React; no Desktop-specific Domain code)

- [ ] **Step 4: Final commit only if checklist fixes were needed**; otherwise done.

---

## Self-review (Phase 1 spec coverage)

| Spec Phase 1 item | Plan task |
|-------------------|-----------|
| Domain CRUD API | Tasks 2–3 (`/api/domains` + `/api/domain-templates`) |
| Domain model + migration | Task 1 (`domains` table; no chunk/pgvector) |
| Domains nav web+Desktop | Tasks 5 + 8 (shared AppShell; Desktop inherits) |
| Templates | Tasks 2–3 + 6 (`financial`…`blank`) |
| Config JSON | Tasks 2–3 + 7 (form + raw JSON) |
| List + create | Task 6 |
| Detail Overview + Config | Tasks 6–7 |
| **Excluded:** ingest / ask / chat / agent node / Documents tab | Global Constraints + file map |

**Placeholder scan:** No TBD/TODO steps; commands and code inlined.

**Type consistency:** `domain_id`, `doc_count`, `status: "empty"`, template keys, and config v1 keys match across helpers, API, and FE.

**YAGNI check:** No Document/Chunk/DomainMessage tables; no `/documents`/`/ingest`/`/ask`; no pgvector on Domain; `doc_count` hard-coded `0`.

**Base branch note:** Implement against AppShell mainline (`feat/dashboard-split-nav` / any branch containing `eaacdf7`). This plan branch is docs-only until coding starts.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-15-polyrag-domains-phase1.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task via superpowers:subagent-driven-development  
**2. Inline Execution** — superpowers:executing-plans with checkpoints
