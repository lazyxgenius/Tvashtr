# Subscription connect + dual-engine design

Date: 2026-09-15  
Status: draft for review  
Product: Tvashtr Desktop (Electron) + hosted control plane (`tvashtr.fly.dev`)

## Goal

Ship **full dual-engine** for Claude / Grok / Codex subscriptions:

1. **Connect UX** — subscribe engines on the user’s machine (October-style harness-first).
2. **Model picker** — understands subscription vs BYOK.
3. **Local-only subscription runs** — subscription work never depends on relaying consumer sessions to Fly.

Hosted Fly microVM runs that survive app quit remain **BYOK / API-key / OpenRouter** only.

## Non-goals (this slice)

- Mac `.dmg` / notarization / auto-update
- Relaying consumer cookies or subscription tokens to Fly
- Official “Pro on hosted API” provider products (separate spike)
- Full OpenHands local parity for every tool
- Replacing BYOK for users who only use hosted runs

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Slice scope | Full dual-engine (Connect + picker + local subscription runs) |
| Connect mechanism | **Hybrid:** supervise local harnesses for sure; in-app OAuth only where a provider documents a desktop-safe path |
| UI surfaces | **Same shelf on web and desktop**; web cards disabled with local-only / open-Desktop copy |
| Picker preference | Prefer subscription when connected for **local** runs; BYOK when not connected or for **hosted Fly** |
| Architecture | **Approach A** — Desktop harness supervisor + control-plane **status-only**; no secrets to Fly |
| Provider order (v1 deepen) | **Claude → Grok → Codex** (shared UX shell; adapters deepen in that order) |
| UX bar | Smooth, simple, good-looking; **full liberty to reshape** current Dashboard / provider / launch flow to get there |

## Design principles (UX)

- One calm “Engines” area — not a cluttered second form next to free-text BYOK.
- Subscription cards feel native and premium; BYOK feels like power-user fallback, not competing chrome.
- Desktop: Connect is one primary action. Secondary paths (install CLI, OAuth) appear only when needed.
- Web: never look broken — disabled cards with a clear, short reason and optional “Desktop” affordance.
- Honest continuity: subscription/local runs **stop when Desktop quits**; Fly BYOK runs can continue. Say this near Connect and at local launch.
- Prefer-subscription is automatic for local runs — don’t force a confusing dual toggle unless the user needs an escape hatch later.

Reshape allowed (examples, not requirements):

- Merge “Provider keys” + “Subscriptions” into a single **Engines** section with two tiers.
- Replace free-text BYOK inputs with catalogue-driven rows where it improves clarity.
- Move engine status into account menu / settings if Dashboard gets too dense — keep Discoverability of Connect high on Desktop.

## 1. Connect shelf

### Placement

Dashboard (and any settings surface we promote engines to) shows an **Engines** experience:

- **Subscriptions** — Claude, Grok, Codex (in that order).
- **API keys (BYOK)** — existing providers shelf, restyled to match.

### Card states

Per subscription provider: `disconnected` | `checking` | `needs_install` | `needs_login` | `connected` | `error`.

Connected may show a short account hint if the harness exposes one (email / org), never a secret.

### Actions

| Surface | Behavior |
|---------|----------|
| Desktop (`window.tvashtrDesktop`) | Connect, Disconnect, Refresh; install guidance when CLI missing |
| Web | Same cards; controls disabled; copy: subscription engines run on your machine — open Tvashtr Desktop to connect |

Subscriptions **never** write secrets into `POST /api/providers`.

## 2. Connect flows (desktop)

### Harness-first (default)

1. Connect → Electron detects provider CLI/harness on PATH (or known install locations).
2. Missing → `needs_install` + install link / instructions + “I’ve installed it — Refresh”.
3. Present → probe auth (`status` / `whoami` / documented check).
4. Not authenticated → start harness login (CLI login UX or provider URL in-window); poll until `connected` or timeout → `error` / `needs_login`.
5. Connected → persist **status** in OS-secure storage (`safeStorage`); optionally sync **status-only** to the control plane.

### OAuth add-on

Only if a provider documents a desktop-safe OAuth (or equivalent) API:

- Secondary “Sign in with …” on the card.
- Tokens in `safeStorage` / OS keychain; **never** uploaded to Fly.
- If unsupported, omit the button (no dead end).

### Disconnect

Clear local status (and revoke/delete any OAuth token we stored). Do not uninstall CLIs.

## 3. Model picker + run routing

### Data model (conceptual)

- Node keeps a model slug (`provider/model`) as today.
- Desktop exposes `subscriptionStatus[provider]` to the FE via preload IPC.
- Control plane may store **mirrored status** (`connected: bool`, `checked_at`, optional `account_hint`) with **no secrets** — for web shelf display only.

### Picker (`TeamNodePanel` and successors)

- If subscription connected for that provider → show “via subscription (local)” treatment.
- If BYOK exists → “via API key” treatment.
- Prefer-subscription: on **local** launch, connected subscription wins over BYOK for that provider.

### Preflight

| Launch target | Credential rule |
|---------------|-----------------|
| **Fly / hosted microVM** | BYOK required for every node provider (current behavior). If only subscription would satisfy → **block** with clear copy: hosted needs an API key, or run locally on Desktop. |
| **Local (Desktop)** | Subscription connected **or** BYOK; else missing-credential CTA (Connect or Add key). |

### Engine path

- Subscription-routed runs → **local** harness / local engine path only (not `openhands-fly`).
- Hosted Fly → OpenHands-on-Fly + LiteLLM/BYOK as today.

## 4. Local runner (desktop)

1. Launch that is subscription-routed (or explicit local-on-Desktop) goes through **IPC**, not “create Fly microVM”.
2. Electron supervisor starts/attaches the right harness per node provider; streams logs/events into the canvas/run UI (map to existing run events; degrade to a solid log pane if mapping is incomplete).
3. Control plane may record run metadata/status **without** provider secrets (ids, state, optional desktop-pushed log excerpts).
4. Quitting Desktop **stops** local/subscription runs. Copy on Connect + local launch must say so.

## 5. Control plane / API (status-only)

Additive, secret-free endpoints (names illustrative):

- `GET /api/engines/subscriptions` → list status for Claude / Grok / Codex for the current user.
- `PUT /api/engines/subscriptions/{provider}` → desktop pushes `{ connected, account_hint?, source: "harness"|"oauth" }` — **reject bodies that include tokens/cookies/api_key**.
- `DELETE /api/engines/subscriptions/{provider}` → clear mirrored status.

Web reads GET for disabled shelf. Desktop is source of truth for liveness; mirror can lag.

Existing `/api/providers` unchanged for BYOK.

## 6. Electron surface changes

Extend preload beyond the boolean flag:

- `tvashtrDesktop.engines.getStatus()`
- `tvashtrDesktop.engines.connect(provider)`
- `tvashtrDesktop.engines.disconnect(provider)`
- `tvashtrDesktop.engines.refresh(provider)`
- run APIs as needed for local launch / log subscribe

Main process: harness adapters (Claude first), `safeStorage`, no secret IPC to the renderer beyond status.

## 7. Errors (user-facing)

- Harness missing / not on PATH  
- Login timeout / not authenticated  
- Hosted launch blocked (subscription-only credential)  
- Local run stopped because Desktop quit  
- OAuth unsupported → no secondary button  

## 8. Testing

- FE: shelf states (incl. web disabled), picker prefer-subscription treatment  
- Desktop: harness detect/status IPC with mocks  
- API: status sync accepts no secrets; Fly preflight still requires BYOK  
- Manual: connect Claude on Desktop → local run path; Fly launch still refuses subscription-only nodes  

## 9. Rollout order

1. UX shell (Engines section) + status IPC + API mirror stubs  
2. **Claude** harness adapter + local run path  
3. **Grok** adapter  
4. **Codex** adapter  
5. OAuth secondary only where documented  

## 10. Success criteria

- User can Connect Claude on Desktop with a smooth, simple Engines UI.  
- Web shows the same cards, disabled, with clear local-only messaging.  
- Local run using Claude subscription does not send consumer credentials to Fly.  
- Hosted Fly run still requires BYOK and explains why subscription isn’t enough.  
- Prefer-subscription behavior is visible in the picker for local context.  
- Grok and Codex follow the same shell; depth lands in order Claude → Grok → Codex.

## Appendix — rejected alternatives

- **B — UX-only shell** — rejected; user required real local subscription runs.  
- **C — Subscription credentials on Fly** — rejected; violates dual-engine secret boundary.
