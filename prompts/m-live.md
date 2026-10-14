# M-live — no run can start on a model its provider no longer serves

> Brief for the `/goal` of the same name. Architect: Tvashtr Sidechat-12.
> Branch off `feat/m-proof` @ `fd8a14a` (NOT off `main` — this milestone builds on the harness).
> Companion brief: `prompts/m-proof.md`. Its §2 (auth), §3 (C1–C12 selectors) and §7 (gotchas) still apply verbatim.

---

## 0. Why this exists

M-proof built the browser harness and it worked: it walked C1–C9 and immediately caught a real, production-breaking fact. `nvidia_nim/meta/llama-3.3-70b-instruct` — the slug M-thrift made the **first** provider default — has been retired by NVIDIA. The API now answers:

```
410 Gone — The model 'meta/llama-3.3-70b-instruct' has reached its end of life
on 2026-08-26T09:00:00Z and is no longer available.
```

So **every freshly created team is currently unrunnable.**

Swapping in a new slug would fix today and re-arm the trap for six months' time. This is not hypothetical: NIM retired `deepseek-ai/deepseek-r1` the same way in January 2026, with the same 410 shape. Model IDs die on a schedule, and nothing in Tvashtr checks.

**The structural gap:** `PROVIDER_CATALOGUE` hard-codes one `default_model` per provider, node models are free text, and the launch pre-flight asks only *"does the owner hold a key for this provider?"* — never *"does this provider still serve this model?"* A dead slug therefore sails through validation and dies forty seconds into a run, on stage, as a red run with an opaque error.

This milestone closes that gap and then proves the whole demo path to a real PR.

---

## 1. Deliverables

### D1 — A provider model-list resolver
A new module (`backend/tvashtr/control_plane/provider_models.py` or similar) exposing something like `servable_models(provider: str, api_key: str) -> frozenset[str] | None`.

- One small adapter per catalogued provider. Most are OpenAI-compatible `GET /v1/models`; NVIDIA NIM is (`https://integrate.api.nvidia.com/v1/models`). Gemini is not — use its own list endpoint. Do not guess an endpoint you have not confirmed against the provider's docs; if you cannot confirm one for a provider, that provider returns `None` (see fail-open below) and you say so in the report.
- **In-memory TTL cache**, keyed by provider, ~1 hour. Follow the posture of the existing installation-token cache. A launch must not pay a cold provider round-trip every time.
- **FAIL OPEN, always.** Unreachable endpoint, timeout, auth error, unparseable body, or a provider with no adapter ⇒ return `None`, log once, and **never refuse the launch.** A liveness check that blocks launches when the *check* is broken is worse than the bug it prevents. This is the single most important property of D1 — pin it with a test.
- Short timeout (a couple of seconds). A slow provider must not hang the launch endpoint.
- Never log or return an API key.

### D2 — The launch pre-flight refusal
`routers._missing_provider_credentials` / `_missing_credentials_detail` (around routers.py:625–660) are M-runnable's existing refusal: they collect the providers the owner has no key for **plus the role names of the offending nodes**, and 422 with `{message, missing_providers, missing_nodes}`.

Add a **sibling** check in the same pre-flight, running **after** the credential check (no key ⇒ we cannot even ask the provider what it serves, so ordering matters):

- For each distinct `(provider, model)` across the team's `AgentNode` rows where `model` is set, ask D1 whether the provider still serves it.
- `None` (fail-open) ⇒ that provider contributes nothing. Not an error, not a refusal.
- A definite "this provider does not serve this slug" ⇒ collect the model **and the role names of the nodes carrying it**.
- Refuse with 422, extending the same payload contract: keep `message` and `missing_nodes` populated the way the existing refusal does, and add a new `unservable_models` field. The human `message` must name **both** the dead slug and the node(s), e.g. *"nvidia_nim/meta/llama-3.3-70b-instruct is no longer served by nvidia_nim — used by Engineer, Product manager, Reviewer"*.
- Gate and terminal nodes carry no model and are skipped, exactly as the credential check already does.
- Apply it to the A/B launch path too (routers.py ~969 does the same pre-flight per side).

**Do not** invent a second refusal shape. Reuse the one contract so the frontend banner keeps working.

### D3 — The frontend consequence
**Read the FE first and report what is already true**, then close the gap:
- The launch banner already renders the 422 `message`, so it should surface the new refusal with little or no change — confirm that, don't assume it.
- `missing_nodes` is already in the payload. Determine whether the canvas currently **highlights** those node cards after a refused launch. If it does, make sure the new refusal feeds the same highlight. If it does not, add it: the offending node cards get a visible error state so the user's eye lands on the node they must fix.

The user-facing outcome that matters: **the user learns their model is dead before the run starts, on the node, by name — not forty seconds in.**

### D4 — Replace the dead default
Probe the live NIM catalogue with the operator's key and pick the current 70B-class instruct slug. Update `PROVIDER_CATALOGUE["nvidia_nim"]["default_model"]` in `backend/tvashtr/control_plane/teams.py`.

- **Probe, don't guess.** Paste the model-list output you chose from.
- **Prove it actually works before adopting it**: one real completion through the gateway, and one real agent step, not just presence in a list. A slug that lists but cannot tool-call is worse than a dead one — the project already parked `qwen3-next-80b-a3b` for a ~40% `TextContent is not JSON serializable` crash rate. Say which checks you ran.
- If no NIM slug passes, **stop with `NEEDS_HUMAN`** rather than reordering `_PROVIDER_DEFAULT_ORDER` or picking a different provider. That reorder is a separate decision and is out of scope.
- This is the one intentional exception to M-proof's "don't touch teams.py". Change **only** that one default_model value.

### D5 — Open question (c), answered explicitly
M-proof's run showed the per-node failover **firing** against the dead provider (`"failing over to the node's fallback model"`) and yet the entry node produced no `REPORT.md`, with `workflow_status=SUCCESS` while `run.status=failed` and zero gates reached.

That is potentially a real product defect hiding behind the outage: **a fallback that swaps the model but never lands the deliverable is a fallback that does not work.** Two candidate stories:
1. the fallback returned a completion and the deliverable-writing step did not consume it → product bug, fix it reproduce-first;
2. the fallback call itself failed downstream → benign, and the D4 fix makes it moot.

Do **not** treat this as resolved just because the run goes green after D4. Read the run's actual invocation trail and events, state which story is true with evidence, and if it is (1), fix it. Also state whether `workflow_status=SUCCESS` alongside `run.status=failed` is by design or a status-propagation bug — a one-line answer either way.

### D6 — The demo path, finally whole
`make demo-proof` green through **C1–C12 including the live half**: real gates approved through the UI, run `completed`, a **real non-empty `pr_url`**. Then deploy and prove prod.

---

## 2. Sequence — hard order

1. Branch off `feat/m-proof` @ `fd8a14a`.
2. D4 first (probe + prove the slug). Nothing downstream can be tested while every run 410s.
3. D1 + D2 + D3, each reproduce-first where it is a fix.
4. Re-run `make demo-proof` to full green with a real PR URL.
5. D5: read the trail, answer it, fix if it is story (1).
6. Full gate: `make test`, `make lint`, `make build-frontend`, `make test-frontend`. Floors: **1158** backend (M-proof's new floor), **421** vitest.
7. **Only now** `fly deploy`, then `make deploy-smoke`. Red ⇒ roll back to the previous release, then stop.
8. `make demo-proof-prod` green with a real prod PR URL. It needs the one-off `make demo-proof-login` — if the session file is missing, stop and ask; do not work around it.

---

## 3. Invariants

- **No short-term fixes.** D4 alone is a short-term fix; it ships only alongside D1–D2, which is what makes the next retirement a caught error instead of an outage.
- **Fail open.** No launch is ever refused because the liveness check itself could not run. Test it.
- **No new Alembic migration.** Nothing here is a schema change. Prove it: versions-directory file count stays at 31.
- Do **not** reorder `_PROVIDER_DEFAULT_ORDER`, change any other provider's `default_model`, or touch the caveman skill or the adapters' `max_output_tokens`.
- Do **not** backfill existing teams. §15 entry stays.
- Never force or stub the Reviewer verdict; gates are approved by Playwright clicking the real **Approve** button, never via the API.
- Never echo a key, token, password or session file.
- The harness must not be weakened to make the run pass. A check that fails is a finding.
- `prompts/*.md`, `PROJECTPLAN.md`, `HANDOVER.md` stay untracked from your side. Commit only your own paths. Never push.

---

## 4. Evidence the transcript must show

- The NIM model-list probe output, the slug chosen, and the completion + agent-step checks that proved it live.
- The fail-open test, RED then green.
- The new 422 refusal firing on a team with a dead slug: the exact payload, naming the model and the nodes.
- What the FE already did vs. what you added for D3, with a screenshot of the refusal.
- D5's answer with the evidence you read it from, and the fix + RED if story (1).
- `make demo-proof` full C1–C12 pass, the real PR URL, and whether the ship came via a genuine Reviewer approval or the escalation gate.
- `make test` / `lint` / `build-frontend` / vitest counts. Alembic count 31 before and after.
- `fly deploy` result, `make deploy-smoke` pass, `make demo-proof-prod` full pass + prod PR URL.
- Branch name and a final `READY_TO_MERGE`.

---

## 5. Stop conditions → write `NEEDS_HUMAN` to `STATE.md` and stop

- No NIM slug passes the D4 liveness+capability proof. List what you probed and what failed. Do **not** reorder providers or substitute another provider's default.
- A provider's model-list endpoint cannot be confirmed from its docs — note it, let that provider fail open, and carry on; only stop if this affects `nvidia_nim` itself.
- The prod session file is missing or `/api/auth/me` 401s — tell the operator to run `make demo-proof-login`.
- `make deploy-smoke` red after deploy — roll back **first**, then stop.
- D5 turns out to be story (1) **and** the fix needs a broad or unproven change. A code-proven, contained, regression-guarded fix may proceed.
- A second, unknown problem needing a broad or unproven change.
- Turn cap: **50**.
