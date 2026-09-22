# Domains guided path — E2E slice #2 + #3 + #6

**Date:** 2026-09-22  
**Branch:** `feat/domains-guided-path` (from `feat/domains-groq-embed` @ `35a1f9a`)  
**Approach:** YAGNI — reuse Domains + Engines + New team. Lightweight panel/steps on existing pages; no new architecture.

## Locked scope

| # | Item | In |
|---|------|----|
| **#2** | Guided Idea→Domains→Team happy path | Collapsible step panel on Domains list + detail; CTAs into New domain / Config / Documents / Engines / New team. Point at existing Domains MCP + Attach fetch on team node Tools. |
| **#3** | Generation model presets | `GENERATION_PRESETS` in FE `domains.ts`; Domain Config select (mirror embed presets). At least `groq/openai/gpt-oss-120b` + OpenAI/OpenRouter chat equivalents. Custom still available. |
| **#6** | Stronger re-ingest warning | When embed **provider or dim** differs from saved config, show alert + confirm on Save that embeddings will clear / re-ingest is required. |

## Out of scope

#4 #5 #7 #8; deep regression; TestFlight; backend catalogue changes; new routes/wizard architecture.

## Implementation sketch

1. **Lib** — `GENERATION_PRESETS` + `embeddingSwitchNeedsReingest(from, to)` (+ tests).
2. **DomainConfigForm** — generation `<select>` + custom; re-ingest `role="alert"` + Save confirm (#6).
3. **DomainGuidedPath** — 5 steps; optional `onOpenEngines` / `onCreateTeam` / `onNewDomain` / tab jump props.
4. **DomainsPage** / **Dashboard** — wire callbacks (`setView("engines")`, `setPicking(true)` for New team).

## Demo happy path

1. Dashboard → **Domains** → open Guided path → **New domain**.
2. Config → pick embed + gen presets (Engines keys if needed via guided CTA).
3. Documents → Upload → Ingest.
4. Guided step → **New team** → open a worker/thinker → Tools → Enable **Domains MCP** (and/or **Attach fetch**).
5. Run with idea that needs the domain.

## Tests

- `domains.test.ts` — generation presets + re-ingest helper.
- `DomainConfigForm.test.tsx` — gen preset save; re-ingest warn + confirm cancel.
- `DomainGuidedPath.test.tsx` — steps render; CTA callbacks.
- Existing DomainsPage / Config form suites stay green.
