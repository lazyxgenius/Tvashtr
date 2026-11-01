# Brief — Google Cloud 1: run Tvashtr's models on a Google Cloud API key (so Google Cloud credits pay)

Architect: Tvashtr Sidechat-28, 2026-11-01. Path: `/Users/adimac/Desktop/Tvashtr/prompts/gcloud-1.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md` and `design/` belong to the architect: never edit, stage or commit them. `STATE.md`
is your log (git-ignored) — write to it after every step. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins.

## Why

The operator has a lot of free Google Cloud credits and wants Tvashtr's agents to spend them. Tvashtr already speaks to Google
through the `gemini` provider — a **Gemini API key from Google AI Studio**. Google Cloud credits don't pay for that: Google's
billing page says "the Google Cloud Welcome credit or free trial credit can't be used towards the Gemini API or AI Studio"
(https://ai.google.dev/gemini-api/docs/billing). They do pay for **Gemini on Vertex AI** (Google now calls it "Gemini Enterprise
Agent Platform"), which accepts a **Google Cloud API key** on its global address: `POST https://aiplatform.googleapis.com/v1/
publishers/google/models/MODEL_ID:generateContent` with the header `x-goog-api-key: <key>` — no project or region in the path
(https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview). This milestone adds that as
a new provider, **Google Cloud**, beside the existing ones. Every customer with Google Cloud credits gets the same door.

## What this session is — and isn't

- **One branch `feat/gcloud-1` from `main` = `52986900`.** No migration, no new DBOS workflow, no push, no deploy, no Desktop
  release. The operator merges after the architect's audit; it ships later.
- **Additive.** The existing `gemini` (AI Studio) provider keeps working exactly as today. Only the files listed below change.
- **In:** the `vertex_ai` provider on an API key, for both kinds of model call (one-shot "thinker" calls through the gateway,
  and agent loops through OpenHands, in every sandbox mode); its catalogue entry chosen by live evidence; Engines' Add-key list;
  `.env` import; a live end-to-end run on it.
- **Out (logged for later, don't build):** a service-account JSON key (Google's recommended production login; needed if the
  operator's credits turn out not to reach an API key), Claude and other partner models on Vertex AI (they need that login),
  Vertex embeddings for Domains (probe and report only), the LiteLLM-proxy mode (`litellm_proxy_enabled`) for this provider.
- **Claude Pro plan:** one session, Opus 5.5 at high effort, no ultracode or dynamic workflows, at most one subagent at a time.

## State on disk (checked by the architect, 2026-11-01)

- `main` = `52986900` (docs only on top of `8cf90334` = production: Fly v47, alembic `0053`). Push guard
  `remote.origin.pushurl` = `DISABLED-no-push-during-video-work`. No `feat/models-1` branch yet (that milestone runs after this
  one).
- Floors on this code (STATE.md, "SHIP LANDING-1"): `make test` on `tvashtr_gate` 3550 passed / 1 xfailed; vitest 271 files /
  2757 + the known unhandled error at `CompareView.tsx:96`; tsc 0; build ok; desktop 161; `make lint` stops at ruff's 38-error
  baseline. `team_run.py` blob `9a22d313d5c9`; `@DBOS.` count 75; DBOS app versions local `3011d7ac6e4e7c30d0ad38372dfc32a3` /
  fly `c7320dd5c7e4b8866eefbd9174226f71`.
- Facts the architect read in the code:
  - `backend/tvashtr/gateway/gateway.py` is the only module that imports `litellm`; `complete()` builds each call's kwargs
    (`model`, `messages`, `temperature`, `max_tokens`, `api_key`) and returns `CompletionResult(model_used=<the candidate slug>)`.
  - Agent loops get their model settings from **one** function, `config.agent_llm_routing(...)` (proxy-OFF branch: the bare
    slug + the owner's key, no `base_url`), splatted into OpenHands' `LLM(...)` by all three adapters
    (`engines/openhands_adapter.py:627`, `openhands_docker_adapter.py:367`, `openhands_fly_adapter.py:574`). OpenHands' `LLM`
    has `base_url` and `api_key` fields but no Vertex fields.
  - LiteLLM 1.89's own `vertex_ai/` route always logs in with a service account / application default credentials — it does
    not take an API key. Its `gemini/` route sends `x-goog-api-key` and, given an `api_base`, calls
    `{api_base}/models/{model}:{endpoint}` (`litellm/llms/vertex_ai/vertex_llm_base.py`, `_check_custom_proxy`). So
    `gemini/<model_id>` + `api_base = https://aiplatform.googleapis.com/v1/publishers/google` + the Google Cloud key reaches the
    exact Vertex address above. **This is the route to prove first.**
  - LiteLLM's price list (in the venv's `model_prices_and_context_window_backup.json`) has `gemini/gemini-3-flash-preview`,
    `gemini/gemini-3.1-pro-preview`, `gemini/gemini-3.5-flash`, `gemini/gemini-2.5-flash`, `gemini/gemini-2.5-pro`,
    `gemini/gemini-2.5-flash-lite`.
  - Keys: `provider_for_model(slug)` = the first path segment; `resolve_owner_api_key` finds the owner's key by it;
    `seed.py`'s `ENV_PROVIDER_MAP` imports `.env` keys for the operator; `POST /api/providers` saves any provider slug (no check
    call). The launch pre-flight (`provider_models.is_definitely_unservable`) allows a provider it has no adapter for.
  - `scripts/seat_probe.py` is the evidence tool for the catalogue: four worker gates (W1 live completion, W2 OpenHands'
    content-block shape, W3 a real agent step whose file lands inside the workspace, W4 no crash) and two thinker gates (T1, T2:
    a real deliverable under the product's own output ceiling).

## Decisions (settled — build these)

1. **Provider slug `vertex_ai`, shown as "Google Cloud".** Model slugs look like `vertex_ai/gemini-3-flash-preview` — the
   LiteLLM name a developer would type, so **Custom…** in any model picker works too.
2. **One translation, in one pure module** — new `backend/tvashtr/google_cloud.py` (imports nothing from `tvashtr` that pulls
   `litellm` or `openhands`, so `config.py` and `gateway.py` can both import it without a cycle). For a `vertex_ai/<id>` slug and
   a key it returns the call settings `{"model": "gemini/<id>", "api_base": "https://aiplatform.googleapis.com/v1/publishers/google",
   "api_key": <key>}`; for any other slug it returns nothing and nothing changes.
   - **Gateway:** `complete()` applies it to each candidate's kwargs just before the call (an additive line or two — the rest of
     `complete()` byte-identical). `CompletionResult.model_used` / `model_requested` stay the **Tvashtr slug** (`vertex_ai/…`),
     never the translated one. `_provider_of` reports `vertex_ai`. Cost comes from LiteLLM on the translated response, as for
     every other provider. `embed()` unchanged.
   - **Agents:** `agent_llm_routing`'s proxy-OFF branch returns `model = gemini/<id>` and `base_url = <the Vertex base>` for a
     `vertex_ai` slug (the retry envelope and timeout exactly as today). Prove the `base_url` reaches the `LLM(...)` in **all
     three** adapters (local, docker, fly) and survives OpenHands' serialization into the in-sandbox agent-server. The proxy-ON
     branch is unchanged.
   - **Nowhere else** may a `vertex_ai/` slug reach LiteLLM untranslated: prove it with a test that fails if any call site
     sends `vertex_ai/…` to `litellm` (e.g. a monkeypatched `litellm.completion` that raises on that prefix, over the gateway,
     the condenser LLM and each adapter's routing).
3. **The catalogue entry is chosen by evidence**, not by the architect: run `seat_probe.py` (extend its candidate list for
   `vertex_ai`; its key comes from `GOOGLE_CLOUD_API_KEY`) over `gemini-3-flash-preview`, `gemini-3.5-flash`,
   `gemini-3.1-pro-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, both seats. A model enters
   `PROVIDER_CATALOGUE["vertex_ai"]` only if it passes every gate of that seat **and** has a listed price (an unpriced model can't
   be held to a run's budget). Defaults = the cheapest passing model per seat; presets = every passing model. If no model passes
   the thinker gates, `thinker_default` is `None` with a comment quoting the evidence (the `gemini` entry is the precedent). Write
   the probe transcript into the entry's comment, dated. `label` "Google Cloud"; `model_labels` per model (e.g. "Gemini 3 Flash").
   `subscription` `None`; `byok_probed` `True`.
4. **Default order:** `vertex_ai` goes **first** in `_PROVIDER_DEFAULT_ORDER` — only accounts that hold a Google Cloud key are
   affected (none do today), and for them the credits are the cheapest money. Existing nodes are never rewritten.
5. **Keys:** `.env` name **`GOOGLE_CLOUD_API_KEY`** → `vertex_ai` in `seed.py`'s `ENV_PROVIDER_MAP` (not `GOOGLE_API_KEY`, which
   LiteLLM reads for AI Studio). Engines' Add-key list (`control_plane/provider_directory.py`): `vertex_ai` right after `gemini`,
   name **"Google Cloud"**, label "Gemini on your Google Cloud account (Vertex AI)", hint "Paste a Google Cloud API key. Calls are
   billed to that Google Cloud account, so its credits pay." and, where the directory carries a link, "Get a key" →
   `https://console.cloud.google.com/expressmode`. The existing `gemini` row's label becomes "Gemini models with a Google AI
   Studio key, and Domains embeddings" so the two Google rows can't be confused. Wherever the frontend maps a provider slug to a
   display name (there are several copies — find them all), `vertex_ai` reads "Google Cloud".
6. **Engines' model list / launch pre-flight:** probe whether `GET https://aiplatform.googleapis.com/v1beta1/publishers/google/models`
   answers an API key. If it does, add a `vertex_ai` adapter to `provider_models.py` (so a retired slug is caught before launch);
   if not, leave none (the pre-flight then allows the slug, as for any provider without an adapter) and say so.
7. **Leak scan:** report the shape of the operator's key **by prefix only** (`AIza…`, `AQ.…` or other — never the value). If
   `control_plane/guardrails.py`'s secret patterns don't already match that shape, add one pattern line for it; the DBOS app
   versions must stay unchanged (prove it).
8. **Embeddings:** with the same key, try one Vertex embedding call (`gemini-embedding-001`) through the same translation and
   report the decisive line. Don't add it to Domains in this milestone.

## The operator's turns (he adds keys when you tell him — say each one plainly, then wait)

- **YOUR TURN 1 — before the probe** (if `.env` has no `GOOGLE_CLOUD_API_KEY`; check presence only, never print a value). Post
  exactly this and wait for "added":
  > **Add your Google Cloud key to `.env`.**
  > 1. Open https://console.cloud.google.com/expressmode signed in with the Google account that has the credits.
  > 2. When it asks, link your existing billing account (the one holding the credits).
  > 3. Open https://console.cloud.google.com/agent-platform/studio/settings/api-keys and copy the API key (or **Create API key**).
  > 4. In `/Users/adimac/Desktop/Tvashtr/.env` add one line: `GOOGLE_CLOUD_API_KEY=<paste the key>` and save.
  > 5. Reply **added**.
- **YOUR TURN 2 — after the live run:** tell him what the run cost by LiteLLM's count, and to check in Google Cloud that the
  credits paid: Billing → Reports, filter the service to Vertex AI / Agent Platform, look for the credit lines (they can take up
  to a day to appear). This is the only way to prove the credits apply — say so.
- **YOUR TURN 3 — in the FINAL REPORT section 7:** the numbered click-by-click to add the key in the Tvashtr UI — once on the
  local stack if he wants to try it now, and on tvashtr.fly.dev after this branch ships: Engines → **Add a key** → **Google
  Cloud** → paste → **Save key** (use the real labels you see) → open a team, click a node, pick a **Google Cloud** model. PASS /
  FAIL criteria per step.

If the key is refused (e.g. a 400/403 saying API keys or express mode aren't allowed for this account, or "billing not enabled"),
don't work around it: quote the decisive line (never the key), write `NEEDS_HUMAN: Google refused the API key — <line>` and stop
after the offline work is committed. That answer decides whether the next milestone is the service-account login.

## Existing files you may touch (each change additive)

`backend/tvashtr/gateway/gateway.py` (the translation hook in `complete()` only), `backend/tvashtr/config.py`
(`agent_llm_routing` only), `backend/tvashtr/control_plane/teams.py` (the new catalogue entry + the order),
`backend/tvashtr/control_plane/provider_directory.py`, `backend/tvashtr/seed.py`, `backend/tvashtr/control_plane/provider_models.py`
(only if decision 6 says so), `backend/tvashtr/control_plane/guardrails.py` (one pattern line, only if decision 7 says so),
`scripts/seat_probe.py` (the `vertex_ai` candidates + key), `scripts/live_run_e2e.sh` (a `vertex_ai) KEY_VAR=GOOGLE_CLOUD_API_KEY`
case), `frontend/e2e/_keys.ts` (`vertex_ai: "GOOGLE_CLOUD_API_KEY"`), the frontend's provider-name maps, and tests whose expected
provider lists or orders legitimately change (re-pointed and listed, never weakened). New: `backend/tvashtr/google_cloud.py` and
new test files. Anything else existing that must change → stop and ask (NEEDS_HUMAN).

## Tests

- **Offline, red first:** the pure translation (`vertex_ai/<id>` → the three settings; every other slug untouched; an empty id
  refused), then `complete()` with a monkeypatched `litellm.completion` asserting the exact kwargs it received and that
  `model_used == "vertex_ai/<id>"`, then `agent_llm_routing` (proxy OFF: `gemini/<id>` + the base; proxy ON: unchanged; the retry
  envelope and timeout present), then the "never untranslated" guard over every call site, then the catalogue/directory/seed
  entries. Echo the failing run before the code (`TRANSLATE-RED`), then green.
- **Live probe** (`PROBE`): the full `seat_probe.py` matrix for `vertex_ai`, one line per model per gate, plus the model-list
  probe (decision 6) and the embedding probe (decision 8).
- **Live run** (`LIVE`): `make live-run-e2e TVASHTR_E2E_PROVIDER=vertex_ai TVASHTR_E2E_MODEL=vertex_ai/<the worker default>` —
  a real local run whose agents run on Google Cloud reaches Done. Then one more real run in the **docker** sandbox
  (`TVASHTR_AGENT_SANDBOX=docker`, any existing target that runs one — name it) to prove the `base_url` survives into the
  sandboxed agent-server. Echo each run id, its status and LiteLLM's cost.
- **UI self-sign-off** (Playwright, screenshots under `artifacts/gcloud-1/`, git-ignored): a fresh local account → Engines →
  Add a key shows **Google Cloud** with its hint (`G1`) → save the `.env` key through the sheet (`G2`, the row then reads
  "Google Cloud" with the last four characters) → a team's node model picker lists the Google Cloud models with their labels
  (`G3`) → the `gemini` row's new label (`G4`). Open each screenshot and say what it shows.

## Steps (echo each evidence line as it completes, and write it to STATE.md)

1. **PREFLIGHT:** `main` = `52986900`; push guard = the dummy; tracked tree clean; Docker up; :8000 and :5173 free;
   `GOOGLE_CLOUD_API_KEY` present or absent (never the value); `team_run.py` blob; `@DBOS.` 75; the two DBOS app versions.
   Create `feat/gcloud-1`.
2. **TRANSLATE-RED → TRANSLATE-GREEN**, the gateway hook, the agent routing, the untranslated-guard.
3. **YOUR TURN 1** if the key is absent — wait.
4. **PROBE** (decisions 3, 6, 7, 8) → the catalogue entry, order, directory, seed, name maps.
5. **LIVE** (local, then docker) → **YOUR TURN 2**.
6. **SIGNOFF G1–G4.**
7. **GATES on the final head:** `make test` on `tvashtr_gate` (0 failed, ≥ 3550 + yours; one line proving the database);
   `cd frontend && npx vitest run` (≥ 2757 + yours; the `CompareView.tsx:96` unhandled error may remain, no new one); `npx tsc
   --noEmit`; `npm run build`; `cd desktop && npm test` (161); `make lint` — **no new finding; the exit code may stay non-zero**
   (ruff baseline 38), the frontend part clean; e2e on one local stack with `TVASHTR_HOSTED_MODE=false`: `revamp-shell.spec.ts`
   and `model-picker.spec.ts` pass (and any spec whose provider list you re-pointed).
8. **INVARIANTS**, **NET** (`git diff --shortstat main`), then **READY_TO_MERGE feat/gcloud-1 <sha>** and the FINAL REPORT with
   **YOUR TURN 3** in section 7.

## Invariants (each with its proof in the report)

- `git diff main --stat` touches only the files listed above plus new files; no removed line in an existing file except
  re-pointed test expectations (listed).
- `gateway.py`: `complete()`'s diff is the translation hook only; `embed()` byte-identical; no module but `gateway.py` imports
  `litellm` (`git grep -n "import litellm"`); `google_cloud.py` imports neither `litellm` nor `openhands`.
- `team_run.py` blob `9a22d313d5c9`; alembic unchanged (head `0053`, no new file); `@DBOS.` count 75 and every file with
  `@DBOS.` on `main` byte-identical except `guardrails.py` if decision 7 applied (one added pattern line); DBOS app versions
  **unchanged** (local and fly posture, computed as in STATE.md's SHIP LANDING-1 entry) — so the ship needs no drain.
- The existing `gemini` provider's routing unchanged: a test proves `gemini/<id>` calls get the same kwargs as on `main`.
- No package or lock file change. No key in any log line, test output, screenshot or commit (grep the branch diff for the key's
  prefix shape and for `x-goog-api-key` values).
- Untracked files, `prompts/`, `design/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` never staged.

## Rules

Auto mode. Small single-purpose commits on `feat/gcloud-1`. No push, deploy, tag, force, `reset --hard`, stash, rebase or
amend; never change git config. `.env`: read only to check a name is present and to source it in scripts — never print, echo or
copy a value; never open the CLI credential files. Tests never on `tvashtr_film` or next to a live stack; one stack at a time;
`caffeinate -dimsu`. Live probes and runs spend the operator's Google credits: keep them to the steps above. Three-attempt rule;
time box 6 working hours (usage-limit pauses and waits for the operator don't count).

**Stop conditions** — write `NEEDS_HUMAN: <reason>` to STATE.md, echo the FINAL REPORT, leave a safe state: `main` isn't
`52986900`; the push guard isn't the dummy; tracked changes at start; a port held; Google refuses the key (above); the
`gemini/`-route-to-Vertex call fails for a reason that isn't the key and can't be fixed inside the translation (quote it — that
means the route needs another design); an existing file outside the list must change; a failing existing test this branch didn't
cause and can't be proven pre-existing; a safeguards notice.

**Final report:** the eight sections of `prompts/CLI-RULES.md` §4.7 — every evidence line with its decisive output quoted in
section 3; in section 7: YOUR TURN 2's reminder, YOUR TURN 3, the probe's table, the embedding probe's answer, and anything that
needs a ruling.
