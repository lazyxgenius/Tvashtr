# B-ENGINES — API contract

Slice B-ENGINES of the frontend revamp (plan `../2026-09-25-frontend-revamp.md`, analysis
`../../specs/2026-09-25-revamp-analysis/engines.md` §3 and `panel.md` PANEL-15/39–41).
All changes are additive: no existing response key was removed or renamed.

| Method | Path | Change |
|---|---|---|
| GET | `/api/engines/usage` | **new** |
| GET | `/api/config` | + `provider_directory`, `embedding_presets`, `default_run_budget_usd`; `provider_catalogue[]` + `label`, `model_labels`, `subscription`, `byok_probed`; + `anthropic` and `xai` entries |
| GET | `/api/engines/subscriptions` | + top-level `runner` |
| PUT | `/api/engines/subscriptions/{provider}` | `state` validated |
| GET | `/api/providers` | items + `updated_at` |
| POST | `/api/providers` | + `created_at`, `updated_at`, `replaced`; prefix validation |

Timestamps are ISO 8601 with a UTC offset (`2026-09-25T10:42:07.123456+00:00`).

---

## GET `/api/engines/usage`

Signed-in only (401 otherwise). No query params. Read-only and owner-scoped:

- `teams`: the caller's **library** teams only (never run-snapshot clones or another account's
  teams), ordered `(created_at, id)`. `nodes` lists every `agent` and `completion` node (gates and
  terminals carry no model and are left out), ordered `(created_at, id)`.
  - `model` is `null` when the node has no model yet (blank) — then `provider` is `null` too. Such a
    node uses no provider; show "Needs a model".
  - `provider` / `fallback_provider` use the canonical mapping (the leading slug segment, lower-cased
    — the same rule as the launch gate and `providerOf()` on the FE).
  - `title` is `config.title` (the agent's display name) or `null` when unset — fall back to
    `role_name`.
  - `fallback_model` is `config.fallback_model` or `null`.
- `domains`: the caller's domains, ordered `(created_at, id)`. `embedding_model` is normalized the
  way ingest does (the template default `text-embedding-3-small` → `openai/text-embedding-3-small`).
  `generation_model` is set only when the domain configures one; otherwise `null` (the account
  default is picked at ask time from the keys held then).
- `by_provider`: keys sorted. For each provider:
  - `teams` — teams whose nodes use it as their **primary** model. `roles` are distinct
    `role_name`s; `node_ids` every node. **Use this for verdicts, badges and "Used by".**
  - `fallback_teams` — same shape, for nodes that use it only as their **fallback** model (OQ-13:
    list as "(fallback)", exclude from verdicts). A provider can appear here with an empty `teams`.
  - `domains` — `{domain_id, name, use}`, `use` ∈ `"embedding"` | `"generation"`; a domain that uses
    one provider for both appears twice.

> **Differs from the plan:** the plan's `by_provider.<p>` had `{teams, domains}`. It also has
> `fallback_teams` so fallback use is never mixed into `teams` (which feed verdicts).

Response 200:

```json
{
  "teams": [
    {
      "team_id": "8c1d6a4e-6f3b-4a53-9a55-0d9a4c2f7e11",
      "name": "Indicator sprint team",
      "nodes": [
        {
          "node_id": "2f0a0b8e-4c55-4e0c-9d1f-1b5a0c6d7e21",
          "role_name": "pm",
          "title": "Product manager",
          "kind": "completion",
          "model": "xai/grok-4.7",
          "provider": "xai",
          "fallback_model": null,
          "fallback_provider": null
        },
        {
          "node_id": "5b7e9c1a-3d2f-4a6b-8c9d-0e1f2a3b4c5d",
          "role_name": "engineer",
          "title": null,
          "kind": "agent",
          "model": "anthropic/claude-sonnet-5",
          "provider": "anthropic",
          "fallback_model": "deepseek/deepseek-chat",
          "fallback_provider": "deepseek"
        },
        {
          "node_id": "9a8b7c6d-5e4f-4321-9abc-def012345678",
          "role_name": "writer",
          "title": "Writer",
          "kind": "agent",
          "model": null,
          "provider": null,
          "fallback_model": null,
          "fallback_provider": null
        }
      ]
    }
  ],
  "domains": [
    {
      "domain_id": "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9",
      "name": "Handbook",
      "embedding_model": "openai/text-embedding-3-small",
      "embedding_provider": "openai",
      "generation_model": null,
      "generation_provider": null
    },
    {
      "domain_id": "1c2d3e4f-5061-4728-93a4-b5c6d7e8f901",
      "name": "Research",
      "embedding_model": "huggingface/BAAI/bge-small-en-v1.5",
      "embedding_provider": "huggingface",
      "generation_model": "groq/openai/gpt-oss-120b",
      "generation_provider": "groq"
    }
  ],
  "by_provider": {
    "anthropic": {
      "teams": [
        {
          "team_id": "8c1d6a4e-6f3b-4a53-9a55-0d9a4c2f7e11",
          "name": "Indicator sprint team",
          "roles": ["engineer"],
          "node_ids": ["5b7e9c1a-3d2f-4a6b-8c9d-0e1f2a3b4c5d"]
        }
      ],
      "fallback_teams": [],
      "domains": []
    },
    "deepseek": {
      "teams": [],
      "fallback_teams": [
        {
          "team_id": "8c1d6a4e-6f3b-4a53-9a55-0d9a4c2f7e11",
          "name": "Indicator sprint team",
          "roles": ["engineer"],
          "node_ids": ["5b7e9c1a-3d2f-4a6b-8c9d-0e1f2a3b4c5d"]
        }
      ],
      "domains": []
    },
    "groq": {
      "teams": [],
      "fallback_teams": [],
      "domains": [
        {"domain_id": "1c2d3e4f-5061-4728-93a4-b5c6d7e8f901", "name": "Research", "use": "generation"}
      ]
    },
    "huggingface": {
      "teams": [],
      "fallback_teams": [],
      "domains": [
        {"domain_id": "1c2d3e4f-5061-4728-93a4-b5c6d7e8f901", "name": "Research", "use": "embedding"}
      ]
    },
    "openai": {
      "teams": [],
      "fallback_teams": [],
      "domains": [
        {"domain_id": "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9", "name": "Handbook", "use": "embedding"}
      ]
    },
    "xai": {
      "teams": [
        {
          "team_id": "8c1d6a4e-6f3b-4a53-9a55-0d9a4c2f7e11",
          "name": "Indicator sprint team",
          "roles": ["pm"],
          "node_ids": ["2f0a0b8e-4c55-4e0c-9d1f-1b5a0c6d7e21"]
        }
      ],
      "fallback_teams": [],
      "domains": []
    }
  }
}
```

A fresh account: `{"teams": [], "domains": [], "by_provider": {}}`.

Errors: `401 {"detail": "Not authenticated"}` without a session (the app-wide auth dependency).

Readiness ("Can your teams run?", "N to fix") is **not** computed here — derive it on the FE with
`missingProvidersForModels` over `teams[].nodes[].model` + `/api/providers` + subscription status
(spec §4.1 OQ-1/OQ-3).

---

## GET `/api/config` (public, no session)

New top-level keys (existing `hosted_mode`, `github_install_url`, `github_manage_url`,
`provider_catalogue` unchanged):

```json
{
  "hosted_mode": true,
  "github_install_url": "https://github.com/login/oauth/authorize?client_id=…",
  "github_manage_url": "https://github.com/apps/tvashtr/installations/new",
  "provider_catalogue": [
    {
      "provider": "nvidia_nim",
      "thinker_default": "nvidia_nim/openai/gpt-oss-20b",
      "worker_default": "nvidia_nim/minimaxai/minimax-m3",
      "thinker_presets": ["nvidia_nim/openai/gpt-oss-20b"],
      "worker_presets": ["nvidia_nim/minimaxai/minimax-m3", "nvidia_nim/openai/gpt-oss-20b"],
      "label": "NVIDIA NIM",
      "model_labels": {
        "nvidia_nim/openai/gpt-oss-20b": "gpt-oss-20b",
        "nvidia_nim/minimaxai/minimax-m3": "MiniMax M3"
      },
      "subscription": null,
      "byok_probed": true
    },
    {
      "provider": "anthropic",
      "thinker_default": "anthropic/claude-sonnet-5",
      "worker_default": "anthropic/claude-sonnet-5",
      "thinker_presets": ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"],
      "worker_presets": ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"],
      "label": "Anthropic",
      "model_labels": {
        "anthropic/claude-sonnet-5": "Claude Sonnet 5",
        "anthropic/claude-sonnet-4": "Claude Sonnet 4"
      },
      "subscription": "claude",
      "byok_probed": false
    },
    {
      "provider": "xai",
      "thinker_default": "xai/grok-4.7",
      "worker_default": "xai/grok-4.7",
      "thinker_presets": ["xai/grok-4.7"],
      "worker_presets": ["xai/grok-4.7"],
      "label": "xAI",
      "model_labels": {"xai/grok-4.7": "Grok 4.7"},
      "subscription": "grok",
      "byok_probed": false
    }
  ],
  "provider_directory": [
    {"provider": "anthropic", "monogram": "A", "name": "Anthropic", "label": "Claude models", "example_model": "anthropic/claude-sonnet-5", "subscription": "claude", "embeddings": false, "hint": null},
    {"provider": "xai", "monogram": "X", "name": "xAI", "label": "Grok models", "example_model": "xai/grok-4.7", "subscription": "grok", "embeddings": false, "hint": null},
    {"provider": "openai", "monogram": "O", "name": "OpenAI", "label": "GPT models", "example_model": "openai/gpt-4o-mini", "subscription": null, "embeddings": true, "hint": null},
    {"provider": "gemini", "monogram": "G", "name": "Gemini", "label": "Gemini models and Domains embeddings", "example_model": "gemini/gemini-2.5-flash", "subscription": null, "embeddings": true, "hint": null},
    {"provider": "groq", "monogram": "Q", "name": "Groq", "label": "Fast open models", "example_model": "groq/openai/gpt-oss-120b", "subscription": null, "embeddings": false, "hint": null},
    {"provider": "deepseek", "monogram": "D", "name": "DeepSeek", "label": "DeepSeek models", "example_model": "deepseek/deepseek-chat", "subscription": null, "embeddings": false, "hint": null},
    {"provider": "huggingface", "monogram": "H", "name": "Hugging Face", "label": "Domains BGE-small embeddings (free token)", "example_model": "huggingface/BAAI/bge-small-en-v1.5", "subscription": null, "embeddings": true, "hint": "Used by Domains ingest for BGE-small embeddings. A free token from huggingface.co works."},
    {"provider": "nvidia_nim", "monogram": "N", "name": "NVIDIA NIM", "label": "Open models on NVIDIA NIM", "example_model": "nvidia_nim/openai/gpt-oss-20b", "subscription": null, "embeddings": false, "hint": null},
    {"provider": "openrouter", "monogram": "R", "name": "OpenRouter", "label": "many models through one key", "example_model": "openrouter/openai/gpt-4o-mini", "subscription": null, "embeddings": true, "hint": null}
  ],
  "embedding_presets": [
    {"id": "openai-3-small", "label": "OpenAI text-embedding-3-small (default)", "slug": "openai/text-embedding-3-small", "provider": "openai", "dim": 1536, "notes": "Requires Engines key for provider openai."},
    {"id": "hf-bge-small-en-v1.5", "label": "Hugging Face BGE-small-en-v1.5 (384, free/rate-limited)", "slug": "huggingface/BAAI/bge-small-en-v1.5", "provider": "huggingface", "dim": 384, "notes": "Free HF Inference feature-extraction embed …"}
  ],
  "default_run_budget_usd": 5.0
}
```

(`provider_catalogue` and `embedding_presets` above are abridged; the endpoint serves every entry.)

### `provider_catalogue[]` — new fields (the panel's model picker, PANEL-15/39–41)

| Field | Type | Meaning |
|---|---|---|
| `label` | string | Vendor display name: "Uses your **xAI** API key", "Paste your **Anthropic** API key". |
| `model_labels` | `{slug: string}` | Friendly name for **every** slug the entry declares (defaults + presets), e.g. `"xai/grok-4.7": "Grok 4.7"`. A free-text model not in the map has no label — show the slug. |
| `subscription` | `"claude"` \| `"grok"` \| `null` | The Desktop subscription that can run this provider's models on the owner's computer. Equals the launch gate's mapping restricted to runnable engines (openai → Codex is **not** listed: Codex can't run nodes). |
| `byok_probed` | bool | `true` when the seat presets were proven with an API key by the seat probe (`nvidia_nim`, `openai`, `gemini`, `groq`, `deepseek`). `false` for `anthropic`, `xai` (offered because Tvashtr Desktop runs them via the Claude/Grok CLIs) and `openrouter` (seeded, never probed). Use it to keep the picker's note honest (panel Q17) — e.g. "Proven on your subscription" instead of "Only models proven to run a full build are listed." |

New entries: `anthropic` (`anthropic/claude-sonnet-5`, `anthropic/claude-sonnet-4`, both seats) and
`xai` (`xai/grok-4.7`, both seats). Order: `openrouter, nvidia_nim, openai, gemini, groq, deepseek,
anthropic, xai`.

**No default changes:** `anthropic` and `xai` are not in the server's default-model preference order,
so they are never stamped on a new node or as a `fallback_model`. An account holding only those keys
gets exactly the defaults it got before.

### `provider_directory[]` (Engines Add-key picker, ENG-11/63/66)

Every provider a key can usefully be added for: every catalogue provider plus every Domains
embedding provider (`huggingface` included). **The array order is the picker's directory order**
(put team-used providers first on the FE, then this order).

| Field | Type | Meaning |
|---|---|---|
| `provider` | string | Slug the key is saved under. |
| `monogram` | string (1 char) | Tile letter (A anthropic, X xai, O openai, G gemini, Q groq, D deepseek, H huggingface, N nvidia_nim, R openrouter). |
| `name` | string | Vendor display name (same as the catalogue `label` for catalogue providers; "Hugging Face"). *Not in the plan — added so both lists share one display name.* |
| `label` | string | The picker's description line (design copy). |
| `example_model` | string | For the hint "Covers models that start with `<provider>/`, like `<example_model>`." |
| `subscription` | `"claude"` \| `"grok"` \| `null` | As in the catalogue. |
| `embeddings` | bool | A Domains embedding model uses this provider (openai, gemini, openrouter, huggingface). |
| `hint` | string \| `null` | When set, **replaces** the generic "Covers models …" hint (huggingface only today). |

### `embedding_presets[]`

`{id, label, slug, provider, dim, notes}` — exactly `domain_embedding.EMBEDDING_PRESETS` (the list
`lib/domains.ts` mirrors today). Combine with `/api/engines/usage` `domains[].embedding_provider`
for the data-driven embeddings section (OQ-7).

### `default_run_budget_usd`

Number (e.g. `5.0`) or `null` when the operator configured no default cap.

---

## GET `/api/engines/subscriptions`

Adds `runner` — the owner's Tvashtr Desktop check-in, independent of any subscription:

```json
{
  "subscriptions": [
    {"provider": "claude", "connected": true, "state": "connected", "account_hint": "Claude Pro", "source": "harness", "checked_at": "2026-09-25T10:41:58.100000+00:00", "runner_fresh": true},
    {"provider": "grok", "connected": false, "state": "needs_login", "account_hint": null, "source": "harness", "checked_at": "2026-09-25T10:41:58.200000+00:00", "runner_fresh": false},
    {"provider": "codex", "connected": false, "state": "disconnected", "account_hint": null, "source": null, "checked_at": null, "runner_fresh": false}
  ],
  "runner": {
    "fresh": true,
    "last_seen_at": "2026-09-25T10:42:07.123456+00:00",
    "providers": ["claude", "grok"]
  }
}
```

- `runner.fresh`: the runner polled within the server's freshness window (120 s by default) — the
  same window that makes `runner_fresh` true on a subscription. Poll this every 3 s while the
  "Opening Tvashtr Desktop…" dialog is open.
- `runner.last_seen_at`: last poll, or `null` if Desktop never checked in.
- `runner.providers`: what the runner offered on its **last** poll (only `claude`/`grok`); kept when
  stale.
- Never checked in: `{"fresh": false, "last_seen_at": null, "providers": []}`.

## PUT `/api/engines/subscriptions/{provider}`

Body unchanged: `{connected: bool, state?: string, account_hint?: string, source?: "harness"|"oauth"}`.
`state` (when sent; otherwise it defaults from `connected` as before) must be one of
`disconnected`, `needs_install`, `needs_login`, `api_key`, `connected`, `error` — exact,
lower-case. (`checking` is UI-only and never stored.)

Errors:
- `422 {"detail": "state must be one of: api_key, connected, disconnected, error, needs_install, needs_login"}`
- unchanged: `404 {"detail": "unknown subscription provider"}`, `422 {"detail": "source must be harness or oauth"}`,
  `422` (validation) for a secret-bearing body.

---

## GET `/api/providers`

Items gain `updated_at` — when the **current** key was saved (a replace keeps `created_at`; show
`updated_at` as "Added", `created_at` in a tooltip — OQ-17). Order unchanged (oldest first; sort on
the FE).

```json
{
  "providers": [
    {"provider": "deepseek", "key_last4": "7d24", "created_at": "2026-09-12T08:01:10.000000+00:00", "updated_at": "2026-09-25T10:40:02.000000+00:00"},
    {"provider": "anthropic", "key_last4": "wQ3f", "created_at": "2026-09-25T10:41:00.000000+00:00", "updated_at": "2026-09-25T10:41:00.000000+00:00"}
  ]
}
```

## POST `/api/providers`

Body unchanged: `{"provider": "anthropic", "api_key": "sk-ant-…"}`. Still an upsert on
(owner, provider). The provider is canonicalized first (trimmed, lower-cased, cut at the first `/`,
so `Mistral` and `mistral/large` save as `mistral`), then must match `[a-z0-9][a-z0-9_.-]{0,63}`.

Response 200:

```json
{
  "provider": "anthropic",
  "key_last4": "wQ3f",
  "created_at": "2026-09-25T10:41:00.000000+00:00",
  "updated_at": "2026-09-25T10:41:00.000000+00:00",
  "replaced": false
}
```

`replaced: true` when a key for that provider already existed (its old ciphertext is gone;
`created_at` is the original, `updated_at` is now) — drives the "replaced" toast (OQ-5).

Errors (checked in this order; all `422` with a plain-string `detail`):
- `"A provider is required."` — blank provider
- `"Use just the model prefix — the part before the slash, like mistral."` — not a model prefix
  after canonicalizing (spaces, punctuation, a leading `_`, `.` or `-`, longer than 64)
- `"An API key is required."` — blank key

`DELETE /api/providers/{provider}` is unchanged (204, idempotent).
