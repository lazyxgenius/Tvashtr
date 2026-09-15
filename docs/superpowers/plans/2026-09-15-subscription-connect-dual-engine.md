# Subscription connect + dual-engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Approach A dual-engine: Desktop harness Connect for Claude → Grok → Codex, status-only control-plane mirror (no secrets to Fly), Engines Dashboard UX (Subscriptions + BYOK), prefer-subscription for local runs, BYOK-only Fly preflight, and a local-run IPC skeleton.

**Architecture:** Electron main-process harness adapters own detect/login/status and persist status in `safeStorage`; the renderer talks only via preload IPC (`window.tvashtrDesktop.engines.*`). FastAPI stores a secret-free mirror (`connected`, `account_hint`, `source`, `checked_at`) for web shelf display. Hosted Fly launches keep requiring BYOK; subscription-routed work stays local to Desktop and stops when the app quits.

**Tech Stack:** React 19 + Vitest (frontend), FastAPI + SQLAlchemy + Alembic + pytest (backend), Electron 35 CommonJS preload/main (desktop), status-only mirror rows (no subscription secrets on Fly).

## Global Constraints

- Approach A only: desktop harness supervisor + status-only sync to Fly; never upload tokens/cookies/api keys for subscriptions.
- Provider deepen order: Claude → Grok → Codex (shared UX shell; Claude deep first; Grok/Codex thin adapters).
- Prefer-subscription for **local** Desktop runs; BYOK required for **hosted Fly** microVM runs.
- Subscriptions never write secrets into `POST /api/providers`.
- UX: reshape Dashboard into one calm **Engines** area (Subscriptions tier + restyled BYOK); web cards same shelf but disabled with local-only / open-Desktop copy; smooth / simple / good-looking.
- Honest continuity copy: subscription/local runs stop when Desktop quits — near Connect and at local launch.
- YAGNI: no Mac dmg/notarization, no OAuth secondary unless a provider documents a desktop-safe path (omit button otherwise), no full OpenHands local parity in this slice.
- Subscription engine ids (API + IPC): `claude` | `grok` | `codex`. Model-slug mapping for picker/preflight: `claude`↔`anthropic`, `grok`↔`xai` (also accept leading slug `grok`), `codex`↔`openai`.
- Keep `window.tvashtrDesktop` truthy for existing FE checks; replace boolean `true` with an object that exposes `engines` (update any `=== true` tests).
- Test runners: `cd frontend && npm test -- <path>`; `cd backend && uv run pytest <path> -q`; desktop node asserts: `node desktop/scripts/<name>.test.cjs`.
- Do not relay consumer sessions to Fly; mirror may lag; Desktop is source of truth for liveness.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Create** `frontend/src/lib/engines.ts` | Shared FE types + helpers: subscription provider ids, status union, `subscriptionProviderForModel`, `modelProvidersForSubscription`, prefer-subscription label helpers. |
| **Modify** `frontend/src/lib/api.ts` | Add `SubscriptionStatus`, `listSubscriptionStatuses`, `putSubscriptionStatus`, `deleteSubscriptionStatus` (status-only client). |
| **Modify** `frontend/src/vite-env.d.ts` | Type `window.tvashtrDesktop` as DesktopBridge object (engines IPC + truthy). |
| **Modify** `frontend/src/lib/api.test.ts` | Keep desktop rewrite tests working with object bridge. |
| **Create** `frontend/src/lib/engines.test.ts` | Mapping + treatment unit tests. |
| **Modify** `backend/tvashtr/models.py` | `EngineSubscriptionStatus` model — secret-free mirror row. |
| **Create** `backend/alembic/versions/0032_engine_subscription_statuses.py` | Additive table `engine_subscription_statuses`. |
| **Modify** `backend/tvashtr/routers.py` | `GET/PUT/DELETE /api/engines/subscriptions[/{provider}]`; reject secret-bearing PUT bodies; Fly preflight subscription-only messaging. |
| **Create** `backend/tests/test_engines_subscriptions_api.py` | Status sync + secret rejection + list/delete. |
| **Create** `backend/tests/test_launch_subscription_preflight.py` | Hosted launch refuses subscription-only with clear copy. |
| **Create** `frontend/src/components/EnginesShelf.tsx` | Engines UI: Subscriptions cards + restyled BYOK; desktop IPC + mirror GET; web disabled. |
| **Create** `frontend/src/components/EnginesShelf.test.tsx` | Shelf states incl. web disabled. |
| **Modify** `frontend/src/components/Dashboard.tsx` | Replace Provider keys section with `<EnginesShelf />`. |
| **Modify** `frontend/src/components/Dashboard.test.tsx` | Mock engines APIs; assert Engines heading / BYOK still works. |
| **Modify** `frontend/src/index.css` | `.tv-engines*` premium card styles; restyle BYOK under Engines. |
| **Modify** `desktop/electron/preload.cjs` | Expose `tvashtrDesktop` object with `engines.*` (+ keep truthy / info). |
| **Modify** `desktop/electron/main.cjs` | Register IPC handlers; wire harness registry + safeStorage status store; quit stops local runs. |
| **Create** `desktop/electron/harness/types.cjs` | Shared harness interface + status shape. |
| **Create** `desktop/electron/harness/statusStore.cjs` | safeStorage-backed status read/write (no secrets to renderer beyond status). |
| **Create** `desktop/electron/harness/claude.cjs` | Claude detect/status/connect (shell real CLI checks). |
| **Create** `desktop/electron/harness/grok.cjs` | Thin Grok adapter (same interface). |
| **Create** `desktop/electron/harness/codex.cjs` | Thin Codex adapter (same interface). |
| **Create** `desktop/electron/harness/registry.cjs` | `claude` → `grok` → `codex` registry. |
| **Create** `desktop/electron/harness/localRuns.cjs` | Local run IPC skeleton (start/stop/subscribe logs). |
| **Create** `desktop/scripts/harness-claude.test.cjs` | Node assert tests with mocked `execFile`. |
| **Create** `desktop/scripts/harness-grok.test.cjs` | Grok adapter parity tests. |
| **Create** `desktop/scripts/harness-codex.test.cjs` | Codex adapter parity tests. |
| **Create** `desktop/scripts/engines-ipc.contract.test.cjs` | Contract tests for status shape / secret stripping. |
| **Create** `desktop/scripts/status-store.test.cjs` | safeStorage status persistence tests. |
| **Create** `desktop/scripts/local-runs.test.cjs` | Local run supervisor quit/stopAll tests. |
| **Modify** `frontend/src/panel/TeamNodePanel.tsx` | Prefer-subscription / via API key treatment in model picker. |
| **Modify** `frontend/src/panel/TeamNodePanel.test.tsx` | Picker treatment tests. |
| **Modify** `frontend/src/components/LaunchPanel.tsx` | Local-launch quit-stops-runs copy when Desktop. |
| **Modify** `docs/desktop-v1.md` | Replace dual-engine stub with Approach A reality. |

**Note:** `backend/tvashtr/engines/` is the OpenHands coding-agent adapter boundary — do **not** put subscription harnesses there. Subscription harnesses live under `desktop/electron/harness/`.

---


### Task 1: FE types + API client for subscription status (mirror)

**Files:**
- Create: `frontend/src/lib/engines.ts`
- Modify: `frontend/src/lib/api.ts` (after Provider credentials block ~L362)
- Modify: `frontend/src/vite-env.d.ts`
- Test: `frontend/src/lib/engines.test.ts`
- Test: `frontend/src/lib/api.test.ts` (extend)

**Interfaces:**
- Consumes: existing `getJSON` / `ApiError` / `fetch` patterns in `api.ts`
- Produces:
  - `export type SubscriptionProviderId = "claude" | "grok" | "codex"`
  - `export type SubscriptionCardState = "disconnected" | "checking" | "needs_install" | "needs_login" | "connected" | "error"`
  - `export interface SubscriptionStatus { provider; connected; state; account_hint; source; checked_at }`
  - `export const SUBSCRIPTION_PROVIDERS = ["claude", "grok", "codex"]`
  - `subscriptionProviderForModel(model: string): SubscriptionProviderId | null`
  - `modelProvidersForSubscription(provider): string[]`
  - `credentialTreatment({ model, subscriptionConnected, byokConfigured, launchTarget })`
  - `listSubscriptionStatuses()` / `putSubscriptionStatus()` / `deleteSubscriptionStatus()`
  - `TvashtrDesktopBridge` with `engines.getStatus/connect/disconnect/refresh` and optional `runs.*`

- [ ] **Step 1: Write the failing unit test for model↔subscription mapping**

Create `frontend/src/lib/engines.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_PROVIDERS,
  subscriptionProviderForModel,
  modelProvidersForSubscription,
  credentialTreatment,
} from "./engines";

describe("engines mapping", () => {
  it("orders Claude → Grok → Codex", () => {
    expect(SUBSCRIPTION_PROVIDERS).toEqual(["claude", "grok", "codex"]);
  });

  it("maps model leading slugs to subscription providers", () => {
    expect(subscriptionProviderForModel("anthropic/claude-sonnet-4")).toBe("claude");
    expect(subscriptionProviderForModel("xai/grok-2")).toBe("grok");
    expect(subscriptionProviderForModel("grok/grok-2")).toBe("grok");
    expect(subscriptionProviderForModel("openai/gpt-4.1")).toBe("codex");
    expect(subscriptionProviderForModel("openrouter/openai/gpt-4o")).toBe(null);
  });

  it("lists BYOK slugs covered by a subscription provider", () => {
    expect(modelProvidersForSubscription("claude")).toEqual(["anthropic"]);
    expect(modelProvidersForSubscription("grok")).toEqual(["xai", "grok"]);
    expect(modelProvidersForSubscription("codex")).toEqual(["openai"]);
  });

  it("prefers subscription for local when connected", () => {
    expect(
      credentialTreatment({
        model: "anthropic/claude-sonnet-4",
        subscriptionConnected: true,
        byokConfigured: true,
        launchTarget: "local",
      }),
    ).toBe("subscription");
  });

  it("prefers BYOK for hosted even when subscription connected", () => {
    expect(
      credentialTreatment({
        model: "anthropic/claude-sonnet-4",
        subscriptionConnected: true,
        byokConfigured: true,
        launchTarget: "hosted",
      }),
    ).toBe("byok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/Tvashtr/frontend && npm test -- src/lib/engines.test.ts`
Expected: FAIL (cannot find module `./engines` or exports missing)

- [ ] **Step 3: Implement `engines.ts`**

```typescript
export type SubscriptionProviderId = "claude" | "grok" | "codex";

export type SubscriptionCardState =
  | "disconnected"
  | "checking"
  | "needs_install"
  | "needs_login"
  | "connected"
  | "error";

export type SubscriptionSource = "harness" | "oauth";

export interface SubscriptionStatus {
  provider: SubscriptionProviderId;
  connected: boolean;
  state: SubscriptionCardState;
  account_hint: string | null;
  source: SubscriptionSource | null;
  checked_at: string | null;
}

export const SUBSCRIPTION_PROVIDERS: readonly SubscriptionProviderId[] = [
  "claude",
  "grok",
  "codex",
] as const;

const MODEL_TO_SUB: Record<string, SubscriptionProviderId> = {
  anthropic: "claude",
  xai: "grok",
  grok: "grok",
  openai: "codex",
};

const SUB_TO_MODELS: Record<SubscriptionProviderId, string[]> = {
  claude: ["anthropic"],
  grok: ["xai", "grok"],
  codex: ["openai"],
};

export function subscriptionProviderForModel(model: string): SubscriptionProviderId | null {
  const slug = model.split("/", 1)[0]?.trim().toLowerCase() ?? "";
  return MODEL_TO_SUB[slug] ?? null;
}

export function modelProvidersForSubscription(provider: SubscriptionProviderId): string[] {
  return [...SUB_TO_MODELS[provider]];
}

export function displayNameForSubscription(provider: SubscriptionProviderId): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "grok":
      return "Grok";
    case "codex":
      return "Codex";
  }
}

/** Prefer-subscription wins when Desktop local context + connected. */
export function credentialTreatment(opts: {
  model: string;
  subscriptionConnected: boolean;
  byokConfigured: boolean;
  launchTarget: "local" | "hosted";
}): "subscription" | "byok" | "none" {
  const sub = subscriptionProviderForModel(opts.model);
  if (!sub) {
    return opts.byokConfigured ? "byok" : "none";
  }
  if (opts.launchTarget === "local" && opts.subscriptionConnected) return "subscription";
  if (opts.byokConfigured) return "byok";
  if (opts.subscriptionConnected) return "subscription";
  return "none";
}
```

- [ ] **Step 4: Add API client functions + Desktop bridge types**

In `frontend/src/lib/api.ts`, after the providers block (~L397), add (keep imports at top of file in real edit):

```typescript
import type {
  SubscriptionProviderId,
  SubscriptionSource,
  SubscriptionStatus,
} from "./engines";

export type { SubscriptionProviderId, SubscriptionStatus } from "./engines";

export async function listSubscriptionStatuses(): Promise<SubscriptionStatus[]> {
  const data = await getJSON<{ subscriptions: SubscriptionStatus[] }>(
    "/api/engines/subscriptions",
  );
  return data.subscriptions;
}

export async function putSubscriptionStatus(
  provider: SubscriptionProviderId,
  body: {
    connected: boolean;
    state?: SubscriptionStatus["state"];
    account_hint?: string | null;
    source?: SubscriptionSource | null;
  },
): Promise<SubscriptionStatus> {
  const res = await fetch(`/api/engines/subscriptions/${encodeURIComponent(provider)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `PUT /api/engines/subscriptions/${provider} -> ${res.status}`);
  }
  return (await res.json()) as SubscriptionStatus;
}

export async function deleteSubscriptionStatus(provider: SubscriptionProviderId): Promise<void> {
  const res = await fetch(`/api/engines/subscriptions/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new ApiError(res.status, `DELETE /api/engines/subscriptions/${provider} -> ${res.status}`);
  }
}
```

Replace `frontend/src/vite-env.d.ts` `Window` interface with:

```typescript
interface Window {
  /**
   * Set by Electron preload when running inside Tvashtr Desktop.
   * Truthy object (v2+) or legacy boolean `true` (v1). Prefer truthiness checks.
   */
  tvashtrDesktop?: boolean | TvashtrDesktopBridge;
  tvashtrDesktopInfo?: { shell: string; version: number };
}

interface TvashtrDesktopBridge {
  engines: {
    getStatus: () => Promise<import("./lib/engines").SubscriptionStatus[]>;
    connect: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
    disconnect: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
    refresh: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
  };
  runs?: {
    startLocal: (payload: {
      teamGraphId: string;
      idea: string;
    }) => Promise<{ localRunId: string }>;
    stopLocal: (localRunId: string) => Promise<void>;
    subscribeLogs: (localRunId: string, cb: (line: string) => void) => () => void;
  };
}
```

Keep `rewriteGithubInstallUrlForDesktop` on truthiness (`!window.tvashtrDesktop`). In `api.test.ts`, set `window.tvashtrDesktop` to a bridge object (not boolean `true`) wherever desktop rewrite is tested.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /workspace/Tvashtr/frontend && npm test -- src/lib/engines.test.ts src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /workspace/Tvashtr
git add frontend/src/lib/engines.ts frontend/src/lib/engines.test.ts frontend/src/lib/api.ts frontend/src/vite-env.d.ts frontend/src/lib/api.test.ts
git commit -m "$(cat <<'EOF'
feat(engines): add subscription status types and status-only API client

EOF
)"
```

---


### Task 2: Backend status-only subscription endpoints + tests (reject secrets)

**Files:**
- Modify: `backend/tvashtr/models.py` (after `ProviderCredential`)
- Create: `backend/alembic/versions/0032_engine_subscription_statuses.py`
- Modify: `backend/tvashtr/routers.py` (new section after `/api/providers`)
- Test: `backend/tests/test_engines_subscriptions_api.py`

**Interfaces:**
- Consumes: `get_current_user`, `db.session_scope`, `UserOut`, existing auth cookie client fixture
- Produces:
  - Model `EngineSubscriptionStatus(owner_id, provider, connected, state, account_hint, source, checked_at)`
  - `GET /api/engines/subscriptions` → `{ subscriptions: [...] }` (always includes claude/grok/codex; missing rows → disconnected)
  - `PUT /api/engines/subscriptions/{provider}` body `{ connected, account_hint?, source?, state? }` — **422 if body contains top-level keys `token`/`cookies`/`api_key`/`secret`/`authorization`**
  - `DELETE /api/engines/subscriptions/{provider}` → 204 clear mirror

- [ ] **Step 1: Write the failing API tests**

Create `backend/tests/test_engines_subscriptions_api.py`:

```python
"""Status-only engine subscription mirror — no secrets on Fly."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"engines-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "engines-password"}).status_code
        == 200
    )
    return c


def test_list_defaults_to_three_disconnected():
    c = _fresh()
    body = c.get("/api/engines/subscriptions").json()
    assert [s["provider"] for s in body["subscriptions"]] == ["claude", "grok", "codex"]
    for s in body["subscriptions"]:
        assert s["connected"] is False
        assert s["state"] == "disconnected"
        assert s["account_hint"] is None
        assert "api_key" not in s and "token" not in s and "secret" not in s


def test_put_status_round_trip_no_secrets_in_response():
    c = _fresh()
    resp = c.put(
        "/api/engines/subscriptions/claude",
        json={
            "connected": True,
            "state": "connected",
            "account_hint": "ada@example.com",
            "source": "harness",
        },
    )
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["provider"] == "claude"
    assert row["connected"] is True
    assert row["account_hint"] == "ada@example.com"
    assert row["source"] == "harness"
    assert row["checked_at"]
    listed = c.get("/api/engines/subscriptions").json()["subscriptions"]
    claude = next(s for s in listed if s["provider"] == "claude")
    assert claude["connected"] is True


def test_put_rejects_secret_bearing_bodies():
    c = _fresh()
    for poison in (
        {"connected": True, "api_key": "sk-leak"},
        {"connected": True, "token": "t"},
        {"connected": True, "cookies": "session=1"},
        {"connected": True, "secret": "x"},
        {"connected": True, "authorization": "Bearer x"},
    ):
        resp = c.put("/api/engines/subscriptions/claude", json=poison)
        assert resp.status_code == 422, poison


def test_delete_clears_mirror():
    c = _fresh()
    c.put(
        "/api/engines/subscriptions/grok",
        json={"connected": True, "state": "connected", "source": "harness"},
    )
    assert c.delete("/api/engines/subscriptions/grok").status_code == 204
    grok = next(
        s
        for s in c.get("/api/engines/subscriptions").json()["subscriptions"]
        if s["provider"] == "grok"
    )
    assert grok["connected"] is False and grok["state"] == "disconnected"


def test_unknown_provider_404():
    c = _fresh()
    assert c.put("/api/engines/subscriptions/nope", json={"connected": True}).status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /workspace/Tvashtr/backend && uv run pytest tests/test_engines_subscriptions_api.py -q`
Expected: FAIL (404 on `/api/engines/subscriptions` or table missing)

- [ ] **Step 3: Add model + migration**

Append to `backend/tvashtr/models.py` (after `ProviderCredential`; `Boolean`/`false` already imported):

```python
class EngineSubscriptionStatus(Base):
    """Secret-free mirror of a Desktop subscription engine connection (Approach A).

    Desktop is source of truth; this row is for web shelf display only. NEVER store
    tokens, cookies, or API keys here — PUT handlers must reject secret-bearing bodies.
    """

    __tablename__ = "engine_subscription_statuses"
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "provider", name="uq_engine_subscription_statuses_owner_provider"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)  # claude | grok | codex
    connected: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    state: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="disconnected", default="disconnected"
    )
    account_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)  # harness | oauth
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

Create `backend/alembic/versions/0032_engine_subscription_statuses.py`:

```python
"""engine_subscription_statuses — secret-free Desktop subscription mirror

Revision ID: 0032_engine_subscription_statuses
Revises: 0031_run_artifacts
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0032_engine_subscription_statuses"
down_revision: str | None = "0031_run_artifacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "engine_subscription_statuses",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("connected", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("state", sa.Text(), server_default="disconnected", nullable=False),
        sa.Column("account_hint", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "owner_id", "provider", name="uq_engine_subscription_statuses_owner_provider"
        ),
    )
    op.create_index(
        "ix_engine_subscription_statuses_owner_id",
        "engine_subscription_statuses",
        ["owner_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_engine_subscription_statuses_owner_id", table_name="engine_subscription_statuses"
    )
    op.drop_table("engine_subscription_statuses")
```

Migrate: `cd /workspace/Tvashtr/backend && uv run alembic upgrade head` (or `make migrate`).

- [ ] **Step 4: Implement router endpoints**

In `backend/tvashtr/routers.py`, import `EngineSubscriptionStatus` and add after the providers section. Also import `model_validator` from pydantic, `datetime`/`timezone`, and `Any` as needed:

```python
_SUBSCRIPTION_PROVIDERS = ("claude", "grok", "codex")
_SECRET_KEYS = frozenset(
    {"api_key", "token", "cookies", "cookie", "secret", "authorization", "password"}
)


class UpsertSubscriptionRequest(BaseModel):
    connected: bool
    state: str | None = None
    account_hint: str | None = None
    source: str | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_secrets(cls, data: Any) -> Any:
        if isinstance(data, dict):
            bad = _SECRET_KEYS.intersection({str(k).lower() for k in data})
            if bad:
                raise ValueError(f"subscription status must not include secrets: {sorted(bad)}")
        return data


def _subscription_to_dict(provider: str, row: EngineSubscriptionStatus | None) -> dict:
    if row is None:
        return {
            "provider": provider,
            "connected": False,
            "state": "disconnected",
            "account_hint": None,
            "source": None,
            "checked_at": None,
        }
    return {
        "provider": row.provider,
        "connected": bool(row.connected),
        "state": row.state,
        "account_hint": row.account_hint,
        "source": row.source,
        "checked_at": row.checked_at.isoformat() if row.checked_at else None,
    }


@router.get("/api/engines/subscriptions")
def list_engine_subscriptions(
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    with db.session_scope() as session:
        rows = {
            r.provider: r
            for r in session.execute(
                select(EngineSubscriptionStatus).where(
                    EngineSubscriptionStatus.owner_id == owner_id
                )
            )
            .scalars()
            .all()
        }
        return {
            "subscriptions": [
                _subscription_to_dict(p, rows.get(p)) for p in _SUBSCRIPTION_PROVIDERS
            ]
        }


@router.put("/api/engines/subscriptions/{provider}")
def upsert_engine_subscription(
    provider: str,
    body: UpsertSubscriptionRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    canonical = provider.strip().lower()
    if canonical not in _SUBSCRIPTION_PROVIDERS:
        raise HTTPException(status_code=404, detail="unknown subscription provider")
    state = (body.state or ("connected" if body.connected else "disconnected")).strip()
    if body.source is not None and body.source not in ("harness", "oauth"):
        raise HTTPException(status_code=422, detail="source must be harness or oauth")
    owner_id = uuid.UUID(current_user.id)
    now = datetime.now(timezone.utc)
    with db.session_scope() as session:
        row = session.execute(
            select(EngineSubscriptionStatus).where(
                EngineSubscriptionStatus.owner_id == owner_id,
                EngineSubscriptionStatus.provider == canonical,
            )
        ).scalar_one_or_none()
        if row is None:
            row = EngineSubscriptionStatus(owner_id=owner_id, provider=canonical)
            session.add(row)
        row.connected = body.connected
        row.state = state
        row.account_hint = body.account_hint
        row.source = body.source
        row.checked_at = now
        session.flush()
        return _subscription_to_dict(canonical, row)


@router.delete("/api/engines/subscriptions/{provider}", status_code=204)
def delete_engine_subscription(
    provider: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    canonical = provider.strip().lower()
    if canonical not in _SUBSCRIPTION_PROVIDERS:
        raise HTTPException(status_code=404, detail="unknown subscription provider")
    with db.session_scope() as session:
        row = session.execute(
            select(EngineSubscriptionStatus).where(
                EngineSubscriptionStatus.owner_id == uuid.UUID(current_user.id),
                EngineSubscriptionStatus.provider == canonical,
            )
        ).scalar_one_or_none()
        if row is not None:
            session.delete(row)
    return Response(status_code=204)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /workspace/Tvashtr/backend && uv run alembic upgrade head && uv run pytest tests/test_engines_subscriptions_api.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /workspace/Tvashtr
git add backend/tvashtr/models.py backend/alembic/versions/0032_engine_subscription_statuses.py backend/tvashtr/routers.py backend/tests/test_engines_subscriptions_api.py
git commit -m "$(cat <<'EOF'
feat(engines): status-only subscription mirror API (reject secrets)

EOF
)"
```

---


### Task 3: Engines Dashboard UI (subscriptions + restyled BYOK) + web disabled

**Files:**
- Create: `frontend/src/components/EnginesShelf.tsx`
- Create: `frontend/src/components/EnginesShelf.test.tsx`
- Modify: `frontend/src/components/Dashboard.tsx` — remove provider state/handlers (~L87–L182, L553–L629); render `<EnginesShelf />` in that place (self-contained like `SecretsShelf`)
- Modify: `frontend/src/components/Dashboard.test.tsx` — mock `listSubscriptionStatuses`; update empty-state assertion
- Modify: `frontend/src/index.css` — add `.tv-engines*` after `.tv-dash__prov` block (~L1600)

**Interfaces:**
- Consumes: `listProviders`/`addProvider`/`removeProvider`/`providerSuggestions`, `listSubscriptionStatuses`/`putSubscriptionStatus`/`deleteSubscriptionStatus`, `window.tvashtrDesktop`, `SUBSCRIPTION_PROVIDERS`, `displayNameForSubscription`
- Produces: Engines shelf UI with Subscriptions cards (Connect/Disconnect/Refresh on Desktop; disabled on web) + BYOK tier

- [ ] **Step 1: Write failing EnginesShelf tests**

Create `frontend/src/components/EnginesShelf.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../lib/api";
import { EnginesShelf } from "./EnginesShelf";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listProviders: vi.fn(),
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    listSubscriptionStatuses: vi.fn(),
    putSubscriptionStatus: vi.fn(),
    deleteSubscriptionStatus: vi.fn(),
    providerSuggestions: vi.fn(() => ["openrouter", "openai", "anthropic"]),
  };
});

const disconnected = (provider: "claude" | "grok" | "codex") => ({
  provider,
  connected: false,
  state: "disconnected" as const,
  account_hint: null,
  source: null,
  checked_at: null,
});

afterEach(() => {
  vi.clearAllMocks();
  delete (window as Window & { tvashtrDesktop?: unknown }).tvashtrDesktop;
});

describe("EnginesShelf", () => {
  it("renders subscription cards disabled on web with local-only copy", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([
      disconnected("claude"),
      disconnected("grok"),
      disconnected("codex"),
    ]);
    render(<EnginesShelf />);
    expect(await screen.findByRole("region", { name: /Engines/i })).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    screen.getAllByRole("button", { name: /Connect/i }).forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByText(/open Tvashtr Desktop to connect/i)).toBeInTheDocument();
  });

  it("enables Connect on Desktop and calls engines.connect", async () => {
    const connect = vi.fn().mockResolvedValue({
      provider: "claude",
      connected: true,
      state: "connected",
      account_hint: "ada@ex.com",
      source: "harness",
      checked_at: "2026-09-15T00:00:00Z",
    });
    window.tvashtrDesktop = {
      engines: {
        getStatus: vi.fn().mockResolvedValue([]),
        connect,
        disconnect: vi.fn(),
        refresh: vi.fn(),
      },
    };
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([
      disconnected("claude"),
      disconnected("grok"),
      disconnected("codex"),
    ]);
    render(<EnginesShelf />);
    const btn = await screen.findByRole("button", { name: /Connect Claude/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(connect).toHaveBeenCalledWith("claude"));
  });

  it("keeps BYOK add-key working under Engines", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listSubscriptionStatuses).mockResolvedValue([]);
    vi.mocked(api.addProvider).mockResolvedValue({ provider: "openrouter", key_last4: "1234" });
    vi.mocked(api.listProviders)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { provider: "openrouter", key_last4: "1234", created_at: "2026-09-15T00:00:00Z" },
      ]);
    render(<EnginesShelf />);
    fireEvent.change(await screen.findByLabelText(/^Provider$/i), {
      target: { value: "openrouter" },
    });
    fireEvent.change(screen.getByLabelText(/^API key$/i), { target: { value: "sk-test-1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Add key/i }));
    await waitFor(() => expect(api.addProvider).toHaveBeenCalledWith("openrouter", "sk-test-1234"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/Tvashtr/frontend && npm test -- src/components/EnginesShelf.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement EnginesShelf + CSS + wire Dashboard**

`EnginesShelf.tsx` must:
1. On mount: `listProviders()` + `listSubscriptionStatuses()`. If `window.tvashtrDesktop` is an object with `engines.getStatus`, call it and prefer live Desktop statuses; after Connect/Refresh/Disconnect, fire-and-forget `putSubscriptionStatus` / `deleteSubscriptionStatus` to mirror (ignore mirror failures).
2. Outer `<section className="tv-dash__panel tv-engines" aria-label="Engines">` with title **Engines** and subtitle: subscriptions run on your machine; API keys power hosted Fly runs.
3. **Subscriptions** tier: cards Claude → Grok → Codex. States from status. Desktop: Connect / Disconnect / Refresh; `needs_install` shows install link + “I’ve installed it — Refresh”. Footnote: `Subscription runs stop when Desktop quits.` Web: buttons `disabled`; copy: `Subscription engines run on your machine — open Tvashtr Desktop to connect.`
4. **API keys (BYOK)** tier: port existing Dashboard provider form/chips (same `addProvider`/`removeProvider` behavior). Visually secondary to subscription cards.
5. Never call `addProvider` from subscription Connect.

Helper for desktop detect:

```typescript
function desktopEngines(): TvashtrDesktopBridge["engines"] | null {
  const d = window.tvashtrDesktop;
  if (d && typeof d === "object" && d.engines) return d.engines;
  return null;
}
```

Append CSS to `frontend/src/index.css`:

```css
.tv-engines {
  padding: 20px var(--space-6);
}
.tv-engines__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tv-engines__title-row h2 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 19px;
}
.tv-engines__sub {
  margin: 6px 0 16px;
  font-size: 12.5px;
  color: var(--text-tertiary);
  max-width: 520px;
}
.tv-engines__tier-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin: 12px 0 8px;
}
.tv-engines__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}
@media (max-width: 900px) {
  .tv-engines__cards {
    grid-template-columns: 1fr;
  }
}
.tv-engines__card {
  border: 1px solid var(--line-300);
  background: var(--cream-50, var(--cream-100));
  border-radius: 12px;
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 132px;
}
.tv-engines__card--connected {
  border-color: var(--sage-500);
}
.tv-engines__card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.tv-engines__card-name {
  font-family: var(--font-display);
  font-size: 16px;
}
.tv-engines__pill {
  font-size: 11px;
  color: var(--ink-600);
}
.tv-engines__hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.tv-engines__actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  flex-wrap: wrap;
}
.tv-engines__footnote {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tv-engines__byok {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line-200);
}
```

In `Dashboard.tsx`: delete provider-related state, handlers, and the Provider keys `<section>`; insert `<EnginesShelf />` before `<SecretsShelf />`. Remove unused `KeyRound`/`addProvider`/`listProviders` imports if unused.

In `Dashboard.test.tsx` mock: add `listSubscriptionStatuses: vi.fn().mockResolvedValue([])`. Change empty-state assertion from `/Add your provider API keys/i` to `/API keys/i` or `/Engines/i` matching EnginesShelf copy. Keep team/open tests unchanged.

- [ ] **Step 4: Run tests**

Run: `cd /workspace/Tvashtr/frontend && npm test -- src/components/EnginesShelf.test.tsx src/components/Dashboard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/Tvashtr
git add frontend/src/components/EnginesShelf.tsx frontend/src/components/EnginesShelf.test.tsx frontend/src/components/Dashboard.tsx frontend/src/components/Dashboard.test.tsx frontend/src/index.css
git commit -m "$(cat <<'EOF'
feat(engines): Engines shelf with subscription cards and restyled BYOK

EOF
)"
```

---


### Task 4: Electron preload IPC surface for engines

**Files:**
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/electron/main.cjs` (stub `ipcMain` handlers returning disconnected statuses — real harness in Tasks 5–6)
- Create: `desktop/scripts/engines-ipc.contract.test.cjs`
- Modify: `frontend/src/lib/api.test.ts` if still using boolean `true`

**Interfaces:**
- Consumes: `contextBridge`, `ipcRenderer`
- Produces:
  - `window.tvashtrDesktop = { engines: { getStatus, connect, disconnect, refresh } }` (truthy)
  - IPC channels: `tvashtr:engines:getStatus`, `tvashtr:engines:connect`, `tvashtr:engines:disconnect`, `tvashtr:engines:refresh`
  - Keep `window.tvashtrDesktopInfo = { shell: "electron", version: 2 }`

- [ ] **Step 1: Write contract test (node assert)**

Create `desktop/scripts/engines-ipc.contract.test.cjs`:

```js
/**
 * Run: node desktop/scripts/engines-ipc.contract.test.cjs
 */
const assert = require("assert");

const ALLOWED_STATUS_KEYS = new Set([
  "provider",
  "connected",
  "state",
  "account_hint",
  "source",
  "checked_at",
]);
const FORBIDDEN = ["api_key", "token", "cookies", "secret", "authorization"];

function assertStatusShape(row) {
  assert.ok(row && typeof row === "object");
  for (const k of Object.keys(row)) assert.ok(ALLOWED_STATUS_KEYS.has(k), `unexpected key ${k}`);
  for (const f of FORBIDDEN) assert.ok(!(f in row));
  assert.ok(["claude", "grok", "codex"].includes(row.provider));
}

assertStatusShape({
  provider: "claude",
  connected: false,
  state: "disconnected",
  account_hint: null,
  source: null,
  checked_at: null,
});
console.log("engines-ipc.contract.test.cjs OK");
```

- [ ] **Step 2: Run contract test**

Run: `cd /workspace/Tvashtr && node desktop/scripts/engines-ipc.contract.test.cjs`
Expected: `engines-ipc.contract.test.cjs OK`

- [ ] **Step 3: Implement preload + stub main handlers**

Replace `desktop/electron/preload.cjs`:

```js
const { contextBridge, ipcRenderer } = require("electron");

const engines = {
  getStatus: () => ipcRenderer.invoke("tvashtr:engines:getStatus"),
  connect: (provider) => ipcRenderer.invoke("tvashtr:engines:connect", provider),
  disconnect: (provider) => ipcRenderer.invoke("tvashtr:engines:disconnect", provider),
  refresh: (provider) => ipcRenderer.invoke("tvashtr:engines:refresh", provider),
};

contextBridge.exposeInMainWorld("tvashtrDesktop", { engines });
contextBridge.exposeInMainWorld("tvashtrDesktopInfo", {
  shell: "electron",
  version: 2,
});
```

In `desktop/electron/main.cjs`, change the electron import to include `ipcMain`:

```js
const { app, BrowserWindow, shell, ipcMain } = require("electron");
```

Add near top (after constants):

```js
const PROVIDERS = ["claude", "grok", "codex"];

function emptyStatus(provider) {
  return {
    provider,
    connected: false,
    state: "disconnected",
    account_hint: null,
    source: null,
    checked_at: null,
  };
}

function registerEngineIpc() {
  ipcMain.handle("tvashtr:engines:getStatus", async () => PROVIDERS.map(emptyStatus));
  ipcMain.handle("tvashtr:engines:connect", async (_e, provider) => emptyStatus(provider));
  ipcMain.handle("tvashtr:engines:disconnect", async (_e, provider) => emptyStatus(provider));
  ipcMain.handle("tvashtr:engines:refresh", async (_e, provider) => emptyStatus(provider));
}
```

Call `registerEngineIpc()` at the start of the `app.whenReady()` callback (before `boot()`). Keep `sandbox: true` / `contextIsolation: true` / `nodeIntegration: false`.

- [ ] **Step 4: Commit**

```bash
cd /workspace/Tvashtr
git add desktop/electron/preload.cjs desktop/electron/main.cjs desktop/scripts/engines-ipc.contract.test.cjs frontend/src/lib/api.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): expose tvashtrDesktop.engines IPC surface

EOF
)"
```

---

### Task 5: Claude harness adapter (detect/status/connect stub that shells real checks)

**Files:**
- Create: `desktop/electron/harness/types.cjs`
- Create: `desktop/electron/harness/claude.cjs`
- Create: `desktop/electron/harness/registry.cjs`
- Create: `desktop/scripts/harness-claude.test.cjs`

**Interfaces:**
- Consumes: injectable `execFile` (default `util.promisify(child_process.execFile)`)
- Produces harness `{ id, detect, probeAuth, startLogin, toStatus, connect }`:
  - Binary: Anthropic Claude Code CLI named `claude` on PATH (`which` / `where`)
  - Auth probe: try `claude auth status` then `claude whoami`; parse email hint from stdout
  - Connect: detect → `needs_install` if missing → else probe → if not authed run `claude auth login` then re-probe → `connected` / `needs_login` / `error`
  - Install URL (FE may hardcode): `https://docs.anthropic.com/en/docs/claude-code/overview`

- [ ] **Step 1: Write failing harness unit test with mocked execFile**

Create `desktop/scripts/harness-claude.test.cjs`:

```js
/**
 * Run: node desktop/scripts/harness-claude.test.cjs
 */
const assert = require("assert");
const { createClaudeHarness } = require("../electron/harness/claude.cjs");

async function run() {
  const execFile = async (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (key === "which claude") return { stdout: "/usr/local/bin/claude\n", code: 0 };
    if (args[0] === "auth" && args[1] === "status") {
      return { stdout: "Logged in as ada@example.com\n", code: 0 };
    }
    const err = new Error("unexpected " + key);
    err.code = 1;
    throw err;
  };

  const h = createClaudeHarness({ execFile });
  const det = await h.detect();
  assert.strictEqual(det.installed, true);
  const st = await h.toStatus();
  assert.strictEqual(st.provider, "claude");
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.state, "connected");
  assert.strictEqual(st.account_hint, "ada@example.com");
  assert.strictEqual(st.source, "harness");

  const execMissing = async (cmd, args) => {
    if (cmd === "which" && args[0] === "claude") {
      const e = new Error("not found");
      e.code = 1;
      throw e;
    }
    throw new Error("no");
  };
  const st2 = await createClaudeHarness({ execFile: execMissing }).toStatus();
  assert.strictEqual(st2.state, "needs_install");
  assert.strictEqual(st2.connected, false);

  console.log("harness-claude.test.cjs OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /workspace/Tvashtr && node desktop/scripts/harness-claude.test.cjs`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement types + claude + registry**

`desktop/electron/harness/types.cjs`:

```js
/** @typedef {"claude"|"grok"|"codex"} SubscriptionProviderId */
/** @typedef {"disconnected"|"checking"|"needs_install"|"needs_login"|"connected"|"error"} SubscriptionCardState */

/**
 * @typedef {object} EngineStatus
 * @property {SubscriptionProviderId} provider
 * @property {boolean} connected
 * @property {SubscriptionCardState} state
 * @property {string|null} account_hint
 * @property {"harness"|"oauth"|null} source
 * @property {string|null} checked_at
 */

module.exports = {};
```

`desktop/electron/harness/claude.cjs`:

```js
const { promisify } = require("util");
const childProcess = require("child_process");
const defaultExecFile = promisify(childProcess.execFile);

const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/overview";

function createClaudeHarness({ execFile = defaultExecFile } = {}) {
  async function run(cmd, args) {
    try {
      const { stdout, stderr } = await execFile(cmd, args, {
        timeout: 15000,
        encoding: "utf8",
      });
      return { stdout: String(stdout || ""), stderr: String(stderr || ""), code: 0 };
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err && (err.stdout !== undefined || err.stderr !== undefined || err.code !== undefined)) {
        return {
          stdout: String(err.stdout || ""),
          stderr: String(err.stderr || ""),
          code: typeof err.code === "number" ? err.code : 1,
        };
      }
      throw e;
    }
  }

  async function detect() {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const res = await run(whichCmd, ["claude"]);
    if (res.code !== 0) return { installed: false, binaryPath: null };
    const binaryPath =
      res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || null;
    return { installed: Boolean(binaryPath), binaryPath };
  }

  function parseHint(text) {
    const m =
      text.match(/Logged in as\s+(\S+)/i) ||
      text.match(/account:\s*(\S+)/i) ||
      text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    return m ? m[1] : null;
  }

  async function probeAuth(binaryPath) {
    const bin = binaryPath || "claude";
    for (const args of [["auth", "status"], ["whoami"]]) {
      const res = await run(bin, args);
      if (res.code === 0) {
        return {
          authenticated: true,
          accountHint: parseHint(res.stdout + "\n" + res.stderr),
        };
      }
    }
    return { authenticated: false, accountHint: null };
  }

  async function startLogin(binaryPath) {
    const bin = binaryPath || "claude";
    await run(bin, ["auth", "login"]);
  }

  async function toStatus() {
    const checked_at = new Date().toISOString();
    const det = await detect();
    if (!det.installed) {
      return {
        provider: "claude",
        connected: false,
        state: "needs_install",
        account_hint: null,
        source: null,
        checked_at,
      };
    }
    const auth = await probeAuth(det.binaryPath);
    if (!auth.authenticated) {
      return {
        provider: "claude",
        connected: false,
        state: "needs_login",
        account_hint: null,
        source: "harness",
        checked_at,
      };
    }
    return {
      provider: "claude",
      connected: true,
      state: "connected",
      account_hint: auth.accountHint,
      source: "harness",
      checked_at,
    };
  }

  async function connect() {
    const det = await detect();
    if (!det.installed) return toStatus();
    const auth = await probeAuth(det.binaryPath);
    if (!auth.authenticated) {
      try {
        await startLogin(det.binaryPath);
      } catch {
        /* re-probe below */
      }
    }
    return toStatus();
  }

  return { id: "claude", detect, probeAuth, startLogin, toStatus, connect, INSTALL_URL };
}

module.exports = { createClaudeHarness };
```

`desktop/electron/harness/registry.cjs`:

```js
const { createClaudeHarness } = require("./claude.cjs");

function createRegistry(deps = {}) {
  const claude = createClaudeHarness(deps);
  return {
    get(provider) {
      if (provider === "claude") return claude;
      return null;
    },
    list() {
      return ["claude"];
    },
  };
}

module.exports = { createRegistry };
```

Hardcode Claude install URL in EnginesShelf when `state === "needs_install"` (do not leak extra keys over IPC).

- [ ] **Step 4: Run harness test**

Run: `cd /workspace/Tvashtr && node desktop/scripts/harness-claude.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/Tvashtr
git add desktop/electron/harness desktop/scripts/harness-claude.test.cjs
git commit -m "$(cat <<'EOF'
feat(desktop): Claude harness adapter with detect/status/connect

EOF
)"
```

---

### Task 6: Wire desktop Connect to Claude adapter + safeStorage status

**Files:**
- Create: `desktop/electron/harness/statusStore.cjs`
- Modify: `desktop/electron/main.cjs` (replace stubs with registry + store; strip non-status keys)
- Create: `desktop/scripts/status-store.test.cjs`
- Modify: `frontend/src/components/EnginesShelf.tsx` if needed so connect → `putSubscriptionStatus` mirror sync

**Interfaces:**
- Consumes: `createRegistry`, Electron `safeStorage` (fallback: encrypted buffer file under `app.getPath("userData")` when encryption unavailable)
- Produces: persistent status map; IPC connect/refresh/disconnect wired to Claude harness

- [ ] **Step 1: Write status store test**

Create `desktop/scripts/status-store.test.cjs`:

```js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStatusStore } = require("../electron/harness/statusStore.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-eng-"));
const store = createStatusStore({
  userDataDir: dir,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => Buffer.from(b).toString("utf8").replace(/^enc:/, ""),
  },
});

const row = {
  provider: "claude",
  connected: true,
  state: "connected",
  account_hint: "ada@example.com",
  source: "harness",
  checked_at: "2026-09-15T00:00:00.000Z",
};
store.write("claude", row);
assert.deepStrictEqual(store.read("claude"), row);
store.clear("claude");
assert.strictEqual(store.read("claude"), null);
console.log("status-store.test.cjs OK");
```

- [ ] **Step 2: Run — expect fail**

Run: `cd /workspace/Tvashtr && node desktop/scripts/status-store.test.cjs`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement statusStore + wire main**

`statusStore.cjs`: persist JSON map `{ claude?: EngineStatus, ... }` via `safeStorage.encryptString` into `userData/engine-subscriptions.bin`. API: `readAll()`, `read(provider)`, `write(provider, status)`, `clear(provider)`. Only allow status fields listed in the contract test.

`main.cjs` handlers (replace stubs):
- `getStatus`: for each of `claude/grok/codex`, if harness exists call `toStatus()` and `store.write`; else return stored or disconnected
- `connect(provider)`: harness required; `connect()` → write → return status
- `disconnect(provider)`: `store.clear` → return disconnected (do not uninstall CLI)
- `refresh(provider)`: `toStatus` → write → return

Strip any unexpected keys before returning to renderer. On `before-quit`, call localRuns `stopAll` no-op stub until Task 9.

- [ ] **Step 4: Run tests**

Run: `cd /workspace/Tvashtr && node desktop/scripts/status-store.test.cjs && node desktop/scripts/harness-claude.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/Tvashtr
git add desktop/electron/harness/statusStore.cjs desktop/electron/main.cjs desktop/scripts/status-store.test.cjs
git commit -m "$(cat <<'EOF'
feat(desktop): persist Claude engine status via safeStorage and wire IPC

EOF
)"
```

---


### Task 7: Model picker prefer-subscription treatment

**Files:**
- Modify: `frontend/src/panel/TeamNodePanel.tsx` (model picker ~L407–1005)
- Modify: `frontend/src/panel/TeamNodePanel.test.tsx`
- Optional create: `frontend/src/lib/useSubscriptionStatuses.ts`

**Interfaces:**
- Consumes: Desktop `engines.getStatus` or `listSubscriptionStatuses`; `credentialTreatment`; `providerOf` / `subscriptionProviderForModel`
- Produces: pills under model row — `via subscription (local)` / `via API key`; soften local model-validity warning when subscription connected even without BYOK

- [ ] **Step 1: Write failing picker tests**

Add to `TeamNodePanel.test.tsx` (reuse existing `node()` + fetch mock patterns):

```typescript
it("shows via subscription (local) when Desktop + Claude connected for anthropic model", async () => {
  document.documentElement.dataset.tvashtrDesktop = "true";
  window.tvashtrDesktop = {
    engines: {
      getStatus: async () => [
        {
          provider: "claude",
          connected: true,
          state: "connected",
          account_hint: "a@b.c",
          source: "harness",
          checked_at: "x",
        },
      ],
      connect: async () => ({}) as never,
      disconnect: async () => ({}) as never,
      refresh: async () => ({}) as never,
    },
  };
  // stub fetch: GET /api/providers → []; render TeamNodePanel with
  // node({ model: "anthropic/claude-3-5-sonnet", kind: "agent", ... })
  expect(await screen.findByText(/via subscription \(local\)/i)).toBeInTheDocument();
});

it("shows via API key when BYOK configured without prefer-sub local win", async () => {
  delete document.documentElement.dataset.tvashtrDesktop;
  delete (window as Window & { tvashtrDesktop?: unknown }).tvashtrDesktop;
  // stub GET /api/providers → [{ provider: "anthropic", key_last4: "1234", created_at: "x" }]
  // node model anthropic/...
  expect(await screen.findByText(/via API key/i)).toBeInTheDocument();
});
```

Clean up `dataset.tvashtrDesktop` in `afterEach`.

- [ ] **Step 2: Run fail**

Run: `cd /workspace/Tvashtr/frontend && npm test -- src/panel/TeamNodePanel.test.tsx -t "via subscription"`
Expected: FAIL (text not found)

- [ ] **Step 3: Implement treatment UI**

In `TeamNodePanel`, after computing `currentProvider` / `providerConfigured`:
1. On mount (agent/completion only), load subscription map: if desktop engines exist use `getStatus()`, else `listSubscriptionStatuses()`.
2. `const subId = subscriptionProviderForModel(model)`.
3. `const subConnected = subId ? map[subId]?.connected === true : false`.
4. `const launchTarget = document.documentElement.dataset.tvashtrDesktop === "true" ? "local" : "hosted"`.
5. `const treatment = credentialTreatment({ model, subscriptionConnected: subConnected, byokConfigured: providerConfigured, launchTarget })`.
6. Under `.tv-modelrow`, render:
   - subscription → `<span className="tv-engines-pill">via subscription (local)</span>`
   - byok → `<span className="tv-engines-pill">via API key</span>`
7. Soften `modelWarning`: if `subConnected && launchTarget === "local"`, do not warn solely for missing BYOK.

- [ ] **Step 4: Run pass + commit**

```bash
cd /workspace/Tvashtr/frontend && npm test -- src/panel/TeamNodePanel.test.tsx
cd /workspace/Tvashtr
git add frontend/src/panel/TeamNodePanel.tsx frontend/src/panel/TeamNodePanel.test.tsx frontend/src/lib/useSubscriptionStatuses.ts
git commit -m "$(cat <<'EOF'
feat(engines): prefer-subscription treatment in model picker

EOF
)"
```

---

### Task 8: Fly preflight messaging when subscription-only

**Files:**
- Modify: `backend/tvashtr/routers.py` (`_missing_credentials_detail` + `POST /api/runs` preflight ~L946; mirror in `POST /api/ab-runs` if it calls the same helper ~L1048)
- Test: `backend/tests/test_launch_subscription_preflight.py`

**Interfaces:**
- Consumes: `EngineSubscriptionStatus` rows with `connected=True`; mapping `anthropic→claude`, `xai|grok→grok`, `openai→codex`
- Produces: when every missing BYOK provider is coverable by a mirrored subscription, 422 detail includes `subscription_only: true` and message:
  `Hosted runs need an API key for: {providers}. Your subscription covers local Desktop runs — add a key or run locally on Desktop.`
  Keep `missing_providers` + `missing_nodes`.

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_launch_subscription_preflight.py`. Follow patterns from `test_providers_api.py` + `test_launch_unservable_model.py`: register fresh account, build/clone a team whose node model leading slug is `anthropic`, PUT Claude subscription connected, ensure no anthropic BYOK, `POST /api/runs` with that `team_graph_id`.

```python
def test_hosted_launch_subscription_only_message():
    # arrange: team with anthropic/... node; claude mirror connected; no BYOK
    resp = c.post("/api/runs", json={"team_graph_id": team_id, "idea": "hi"})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail.get("subscription_only") is True
    assert "Hosted runs need an API key" in detail["message"]
    assert "Desktop" in detail["message"]
    assert "anthropic" in detail["missing_providers"]
```

Also assert the ordinary missing-key message when no subscription mirror exists (regression).

- [ ] **Step 2: Run fail**

Run: `cd /workspace/Tvashtr/backend && uv run pytest tests/test_launch_subscription_preflight.py -q`
Expected: FAIL (`subscription_only` absent)

- [ ] **Step 3: Implement**

```python
_MODEL_PROVIDER_TO_SUB = {
    "anthropic": "claude",
    "xai": "grok",
    "grok": "grok",
    "openai": "codex",
}


def _connected_subscription_ids(owner_id: uuid.UUID) -> set[str]:
    with db.session_scope() as session:
        rows = session.execute(
            select(EngineSubscriptionStatus.provider).where(
                EngineSubscriptionStatus.owner_id == owner_id,
                EngineSubscriptionStatus.connected.is_(True),
            )
        ).all()
        return {r[0] for r in rows}


def _missing_credentials_detail(
    providers: list[str], nodes: list[str], *, subscription_only: bool = False
) -> dict:
    if subscription_only:
        msg = (
            "Hosted runs need an API key for: "
            + ", ".join(providers)
            + (" — needed by " + ", ".join(nodes) if nodes else "")
            + ". Your subscription covers local Desktop runs — add a key or run locally on Desktop."
        )
    else:
        msg = "you have no API key for: " + ", ".join(providers) + (
            " — needed by " + ", ".join(nodes) if nodes else ""
        )
    return {
        "message": msg,
        "missing_providers": providers,
        "missing_nodes": nodes,
        "subscription_only": subscription_only,
    }
```

At create_run / ab-runs refusal site:

```python
missing, missing_nodes = _missing_provider_credentials(...)
if missing:
    subs = _connected_subscription_ids(uuid.UUID(current_user.id))
    subscription_only = all(_MODEL_PROVIDER_TO_SUB.get(p) in subs for p in missing)
    raise HTTPException(
        status_code=422,
        detail=_missing_credentials_detail(
            missing, missing_nodes, subscription_only=subscription_only
        ),
    )
```

FE already surfaces `detail.message` via `ApiError` — no FE change required.

- [ ] **Step 4: Pass + commit**

```bash
cd /workspace/Tvashtr/backend && uv run pytest tests/test_launch_subscription_preflight.py tests/test_engines_subscriptions_api.py -q
git add backend/tvashtr/routers.py backend/tests/test_launch_subscription_preflight.py
git commit -m "$(cat <<'EOF'
feat(engines): clarify Fly preflight when only subscription would satisfy

EOF
)"
```

---

### Task 9: Local run IPC skeleton + quit-stops-runs copy

**Files:**
- Create: `desktop/electron/harness/localRuns.cjs`
- Modify: `desktop/electron/preload.cjs` — add `runs.startLocal` / `stopLocal` / `subscribeLogs`
- Modify: `desktop/electron/main.cjs` — handlers + `before-quit` → `stopAll`
- Modify: `frontend/src/components/EnginesShelf.tsx` — ensure footnote present
- Modify: `frontend/src/components/LaunchPanel.tsx` — Desktop note when `dataset.tvashtrDesktop`
- Create: `desktop/scripts/local-runs.test.cjs`

**Interfaces:**
- Consumes: injectable spawn; harness registry (claude first)
- Produces:
  - `startLocal({ teamGraphId, idea, provider? }) → { localRunId }` — skeleton worker (log-only), track pid
  - `stopLocal(localRunId)` / `stopAll()`
  - log subscribe via `ipcRenderer.on("tvashtr:runs:log", …)` + main `webContents.send`
- YAGNI: no full agent loop; no secrets to Fly; optional control-plane metadata POST deferred

- [ ] **Step 1: Failing test for stopAll**

```js
const assert = require("assert");
const { createLocalRunSupervisor } = require("../electron/harness/localRuns.cjs");

async function main() {
  const sup = createLocalRunSupervisor({
    spawn: () => {
      let killed = false;
      return {
        pid: 4242,
        kill() {
          killed = true;
        },
        on() {},
        get killed() {
          return killed;
        },
      };
    },
    sendLog() {},
  });
  const { localRunId } = await sup.startLocal({
    teamGraphId: "t",
    idea: "x",
    provider: "claude",
  });
  assert.ok(localRunId);
  await sup.stopAll();
  assert.strictEqual(sup.list().length, 0);
  console.log("local-runs.test.cjs OK");
}
main();
```

- [ ] **Step 2: Run fail** — `node desktop/scripts/local-runs.test.cjs`

- [ ] **Step 3: Implement supervisor + wire quit + FE copy**

Exact copy strings:
- Engines footnote: `Subscription runs stop when Desktop quits.`
- LaunchPanel note (when `document.documentElement.dataset.tvashtrDesktop === "true"`): `Local subscription runs stop when you quit Desktop. Hosted BYOK runs can continue on Fly.`

Preload:

```js
const runs = {
  startLocal: (payload) => ipcRenderer.invoke("tvashtr:runs:startLocal", payload),
  stopLocal: (localRunId) => ipcRenderer.invoke("tvashtr:runs:stopLocal", localRunId),
  subscribeLogs: (localRunId, cb) => {
    const handler = (_e, payload) => {
      if (payload?.localRunId === localRunId) cb(String(payload.line ?? ""));
    };
    ipcRenderer.on("tvashtr:runs:log", handler);
    return () => ipcRenderer.removeListener("tvashtr:runs:log", handler);
  },
};
contextBridge.exposeInMainWorld("tvashtrDesktop", { engines, runs });
```

In `before-quit`, call `localRunSupervisor.stopAll()` before closing the local server.

- [ ] **Step 4: Pass + commit**

```bash
cd /workspace/Tvashtr && node desktop/scripts/local-runs.test.cjs
git add desktop/electron/harness/localRuns.cjs desktop/electron/preload.cjs desktop/electron/main.cjs desktop/scripts/local-runs.test.cjs frontend/src/components/LaunchPanel.tsx frontend/src/components/EnginesShelf.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): local run IPC skeleton and quit-stops-runs copy

EOF
)"
```

---

### Task 10: Grok adapter shell (parity with Claude detect/status)

**Files:**
- Create: `desktop/electron/harness/grok.cjs`
- Modify: `desktop/electron/harness/registry.cjs`
- Create: `desktop/scripts/harness-grok.test.cjs`

**Interfaces:** Same harness shape as Claude (`detect` / `probeAuth` / `toStatus` / `connect`). Binary: `grok` on PATH. Install URL placeholder: `https://docs.x.ai/`. Prefer a thin duplicate of `claude.cjs` with id/binary/url swapped (YAGNI — extract `cliHarness.cjs` only if both stay readable).

- [ ] **Step 1: Write failing test** — copy `harness-claude.test.cjs`, swap module/`provider`/`which grok` / account hint assertions for `grok`
- [ ] **Step 2: Run fail** — `node desktop/scripts/harness-grok.test.cjs`
- [ ] **Step 3: Implement `createGrokHarness` + register `get("grok")`; `list()` → `["claude","grok"]` (codex still Task 11)**
- [ ] **Step 4: Pass + commit**

```bash
git add desktop/electron/harness/grok.cjs desktop/electron/harness/registry.cjs desktop/scripts/harness-grok.test.cjs
git commit -m "$(cat <<'EOF'
feat(desktop): Grok harness adapter shell (detect/status/connect)

EOF
)"
```

---

### Task 11: Codex adapter shell

**Files:**
- Create: `desktop/electron/harness/codex.cjs`
- Modify: `desktop/electron/harness/registry.cjs`
- Create: `desktop/scripts/harness-codex.test.cjs`

**Interfaces:** Same harness interface. Binary: `codex` on PATH. Install docs URL for OpenAI Codex CLI. Registry `list()` → `["claude","grok","codex"]`. Main `getStatus` must return all three providers.

- [ ] **Step 1: Write failing test** (parity with Claude/Grok)
- [ ] **Step 2: Run fail**
- [ ] **Step 3: Implement + register; ensure EnginesShelf already iterates `SUBSCRIPTION_PROVIDERS` so Codex card works**
- [ ] **Step 4: Pass + commit**

```bash
git add desktop/electron/harness/codex.cjs desktop/electron/harness/registry.cjs desktop/scripts/harness-codex.test.cjs
git commit -m "$(cat <<'EOF'
feat(desktop): Codex harness adapter shell (detect/status/connect)

EOF
)"
```

---

### Task 12: Docs update `desktop-v1.md`

**Files:**
- Modify: `docs/desktop-v1.md` (sections Dual-engine credentials, Desktop detection, Explicitly not done)

**Interfaces:**
- Consumes: shipped Approach A behavior from Tasks 1–11
- Produces: accurate operator/dev docs

- [ ] **Step 1: Replace stub dual-engine + detection sections**

```markdown
## Dual-engine credentials (Approach A)

| Engine path | Behavior |
|-------------|----------|
| Hosted Fly microVM | BYOK / API keys via `/api/providers` only. Subscription status never satisfies hosted preflight. |
| Local Desktop subscription | Claude → Grok → Codex harness adapters in `desktop/electron/harness/`. Status in OS `safeStorage`. Status-only mirror: `GET/PUT/DELETE /api/engines/subscriptions`. **No tokens/cookies to Fly.** |
| Prefer-subscription | Automatic for local Desktop runs when connected; BYOK for hosted. |
| Continuity | Quitting Desktop stops local/subscription runs. Fly BYOK runs can continue. |

### Desktop IPC

`window.tvashtrDesktop` is a truthy object:

- `engines.getStatus()` / `connect(provider)` / `disconnect(provider)` / `refresh(provider)`
- `runs.startLocal` / `stopLocal` / `subscribeLogs` (skeleton)

`window.tvashtrDesktopInfo.version` ≥ 2.

FE detection: prefer truthiness (`if (window.tvashtrDesktop)`), not `=== true`.
```

Update “Explicitly not done”: keep Mac `.dmg` / notarization / auto-update; note OAuth secondary still only where a provider documents a desktop-safe path; remove blanket “Subscription OAuth / harness login” as unimplemented.

- [ ] **Step 2: Commit**

```bash
git add docs/desktop-v1.md
git commit -m "$(cat <<'EOF'
docs(desktop): document Approach A dual-engine subscription connect

EOF
)"
```

---

## Self-review (spec coverage)

| Spec requirement | Task(s) |
|------------------|---------|
| Connect UX harness-first Claude→Grok→Codex | 3–6, 10, 11 |
| Model picker subscription vs BYOK + prefer-subscription local | 7 |
| Local-only subscription runs; quit stops | 9 |
| Approach A status-only API; reject secrets | 2 |
| Same shelf web+desktop; web disabled | 3 |
| Fly BYOK required + clear subscription-only copy | 8 |
| Electron preload engines IPC + safeStorage | 4, 6 |
| Errors: missing CLI, login, hosted block, quit | 5–6, 8–9 |
| Testing FE/Desktop/API | per-task tests |
| Docs desktop-v1 | 12 |
| Non-goals (no dmg, no secrets to Fly, no full OH local) | Global Constraints + Task 9 YAGNI |
| UX reshape Engines / premium cards / BYOK secondary | 3 |

### Manual checklist (after Task 9+)

1. Desktop: Connect Claude (CLI installed) → card `connected` → mirror GET shows connected on web (disabled cards).
2. Local launch IPC skeleton starts; quitting Desktop stops it.
3. `POST /api/runs` with anthropic node + Claude subscription only → 422 `subscription_only` message.
4. BYOK openrouter hosted launch still works unchanged.

### Placeholder / consistency scan

- No TBD/TODO/“similar to Task N” — Grok/Codex have their own files and tests.
- Provider ids: `claude` \| `grok` \| `codex` everywhere (API, IPC, FE).
- Status fields: `provider`, `connected`, `state`, `account_hint`, `source`, `checked_at`.
- IPC channel prefix: `tvashtr:engines:*` / `tvashtr:runs:*`.
