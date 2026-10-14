# M-runnable — the team you're given is a team you can run

Verified on disk at main `c675517`. Read this whole file before writing code.

## The bug

Four independent sources of truth decide a node's model, and they disagree:

1. `config.py:96` `default_model = "openrouter/meta-llama/llama-3.1-8b-instruct"` — thinker nodes.
2. `teams.py:132` `engineer_model()` = `os.environ.get("TVASHTR_AGENT_MODEL", DEFAULT_ENGINEER_MODEL)`
   where `DEFAULT_ENGINEER_MODEL = "openrouter/openai/gpt-4o-mini"` (`teams.py:39`) — worker nodes.
3. `teams.py:150` `PROVIDER_DEFAULT_MODEL` + `teams.py:163` `account_default_model(held_providers)` —
   the account-aware chooser.
4. `frontend/src/lib/api.ts:780` `MODEL_PRESETS`, kept in sync with #3 by a code comment.

**#3 is dead code at the team-building path.** Every builder and template hardcodes #1/#2 —
`teams.py` lines 191, 209, 293, 311, 487, 496, 514, 612, 621, 639, 800, 809, 827, 1296. Nothing
consults the owner's held providers when creating a team.

Consequences, all observed in production on 2026-07-23:

- A deployed account holding a deepseek key gets a team on openrouter and is refused at launch with
  `422 "you have no API key for: openrouter"` (`routers.py:868`). The product built a team it
  already knew that account could not run.
- Localhost behaves differently ONLY because `.env` sets `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`
  and `fly.toml`'s `[env]` does not. Same code, different env, opposite outcome.
- `deepseek` is absent from `MODEL_PRESETS`, so `presetsForProvider("deepseek")` returns `[]`: the
  model picker offers nothing, and `TeamNodePanel.tsx:475` false-positives
  *"deepseek/deepseek-chat isn't a known deepseek model"* — on the product's own default agent model.

Patching the three lists fixes today's instance and leaves the structure that produced it.

---

## 1. ONE provider catalogue, backend-owned

Grow `PROVIDER_DEFAULT_MODEL` into a single registry — provider slug →
`{default_model: str, presets: list[str]}` — as the ONLY place a provider or model slug is declared.
Keep it a static, dependency-free module-level constant (no DB, no network); `account_default_model`
must stay pure and unit-testable.

Seed it from the union of today's `PROVIDER_DEFAULT_MODEL` and the FE's `MODEL_PRESETS`, so no
provider or slug currently offered is lost, **plus a `deepseek` entry** with `deepseek/deepseek-chat`
as its default and the deepseek slugs you can justify as presets (at minimum `deepseek/deepseek-chat`
and `deepseek/deepseek-reasoner`).

Serve it read-only to the frontend. Prefer extending the existing `GET /api/config` payload over a
new endpoint — the SPA already fetches it on boot, so this adds no round trip. It is public,
non-secret data: provider slugs and model slugs only, never keys.

## 2. The frontend DERIVES, never declares

Delete the hardcoded `MODEL_PRESETS` array in `lib/api.ts` and the hardcoded
`PROVIDER_SUGGESTIONS` array in `Dashboard.tsx:42`. Both now come from the served catalogue.
`presetsForProvider` reads it. `providerOf` stays as-is — it is the canonicalization rule and is
already parity-tested against the backend; do not touch it.

Delete the "keep these two in sync" comments. After this change there is nothing to keep in sync,
and a stale comment inviting hand-sync is how this bug returns.

Consequence to verify: selecting `deepseek` in the node panel's provider dropdown offers real
quick-picks, and `deepseek/deepseek-chat` no longer triggers the unknown-model warning.

## 3. `account_default_model` becomes LOAD-BEARING

Every team builder and template must default a node's model from the OWNER's held providers:

- resolve the owner's held provider slugs (the same set `_missing_provider_credentials` already
  computes — reuse it, do not write a second rule);
- `account_default_model(held)` wins when it returns a slug;
- the existing `settings.default_model` / `engineer_model()` values become the LAST-RESORT fallback,
  used only when the account holds no catalogued provider.

Preserve the thinker/worker distinction exactly as it is today — a thinker node's fallback stays
`settings.default_model`, a worker's stays `engineer_model()`. This milestone changes WHICH SOURCE
is consulted first, not the thinker/worker split (that is M-unify's job).

**Ordering:** append `deepseek` to `_PROVIDER_DEFAULT_ORDER`; do NOT reorder the existing entries.
A single-key account gets its own provider regardless of order, so order only breaks ties for
multi-key accounts — and silently changing those accounts' defaults is not this milestone's business.

**Existing teams are untouched.** This changes team/node CREATION only. Prove it: a test that an
already-persisted node's model is not rewritten by anything here.

## 4. The refusal names the NODES

`routers.py:868` (and the sibling at ~953) returns
`{"message": "you have no API key for: <providers>", "missing_providers": [...]}`. Add the offending
node names, so the user learns WHICH nodes to fix rather than only which provider is missing. Render
them in the frontend banner that already surfaces `detail.message` (M-legible wired that path).

Keep `missing_providers` in the payload — it is existing contract.

## 5. Stop dev and prod diverging

Set `TVASHTR_AGENT_MODEL` in `fly.toml`'s `[env]` block to the same value the local `.env` uses, so
the last-resort fallback is identical in both environments. It is a non-secret posture flag and
belongs there with the others. Do NOT read or modify `.env` itself.

---

## Invariants

- **No migration.** Alembic head stays `0031`.
- **`backend/tvashtr/engines/` and `control_plane/team_run.py` byte-identical to main** — M-fail
  landed there; prove with an empty diff.
- **No secret in the catalogue or the config payload** — provider and model slugs only. Add a test
  asserting no key material appears in `GET /api/config`.
- **`providerOf` parity** with the backend rule stays green (its existing test must not be weakened).
- **Existing persisted node models unchanged.**
