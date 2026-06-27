# Brief — M-brownfield, Slice 2: the launch-panel UI

> Architect: Tvashtr-32. Authoritative spec for Slice 2; SUPERSEDES `CLI-RULES.md §7`'s milestone
> section for this run. Read `CLI-RULES.md` (the operating contract) fully first, then this. Every
> DESIGN decision (D5 + the D4 model hint) is settled — implement THIS design; don't redesign it.
> **This is a FRONTEND-ONLY slice. Do NOT touch the backend** — Slice 1 (the brownfield backend run
> mode) is merged and complete; the endpoints + payloads this FE drives already exist (verified).

---

## 0. Outcome

Clicking **"Run this team"** opens a **launch panel** where the user (a) types a **feature request**
(the idea), and (b) optionally points the run at a **real local repo** (typed path + base branch),
with a contextual **large-repo model hint** that names the team's worker node(s). The **run banner**
then reports the brownfield branch. **Greenfield (no repo) still works** — empty idea + toggle off
posts exactly what `runTeam` posts today (the server default idea), so the existing API smokes are
untouched. This is the FE that drives the Slice-1 backend (`POST /api/repo/inspect` + the
`repo_path`/`base_ref` params on `POST /api/runs`).

---

## 1. Context — the FE surface on disk (verified by the architect)

**The launch trigger (`frontend/src/App.tsx`).** In the toolbar (shown when `authoring && mode ===
"single"`), the button:
```tsx
<button className="tv-btn" onClick={() => void handleRunTeam()}
  disabled={starting || currentTeamId === null || !teamRunnable}
  title={teamRunnable ? undefined : "Fix the team before running (see the issues)."}>
  {starting ? "Starting…" : "Run this team"}
</button>
```
`handleRunTeam` (App.tsx ~291) → `const id = await runTeam(currentTeamId); const g = await getGraph(id); setGraph(g); setRunId(id);`. **`teamGraph`** (App.tsx state, the current library team's graph) holds the nodes the model hint reads. `RunBanner` is rendered in the toolbar's non-authoring branch.

**`frontend/src/lib/api.ts`.**
- `runTeam(teamGraphId: string): Promise<string>` posts **`{ team_graph_id }` only** → `{ run_id }`. **Extend it.**
- `TeamGraphNode { id; role_name; kind; model; engine; prompt; position; config; last_run? }` where `kind` is `"completion" | "agent" | "gate" | "terminal"`. **Worker nodes = `kind === "agent"`**; their visible label is **`role_name`**.
- `MODEL_PRESETS` — the datalist quick-picks (free-text model field).
- `RunRow` (the run-status shape the FE polls) — **does NOT yet carry** `ship_branch`/`repo_path`/`base_ref`; **add them** (the backend payload already returns them — see below).

**`frontend/src/panel/TeamNodePanel.tsx`** — the node's **model field** (free text + `MODEL_PRESETS` datalist) lives here; `capabilityOf(node) = node.kind === "completion" ? "thinker" : "worker"`. (The hint points the user here to change a worker's model.)

**`frontend/src/components/RunBanner.tsx`** — a quiet hairline card: pill + `run` + `cost` + (when `run.ship_tag`) a `ship` Item. **Add a brownfield `branch` Item.**

**Backend (Slice 1 — merged; do NOT modify; verified on disk):**
- `POST /api/repo/inspect` body `{ path }` → `200 { is_git: true, current_branch, branches, tracked_file_count }` **or** `200 { is_git: false, error }` (a discriminated result, never an exception).
- `POST /api/runs` accepts `{ team_graph_id, idea?, repo_path?, base_ref? }` — `422` on a non-git `repo_path` or an unknown `base_ref`; `base_ref` defaults to the repo's `current_branch` when omitted; `repo_path` omitted ⇒ greenfield (byte-for-byte today).
- `GET /api/runs/{id}` → `{ run: { … repo_path, base_ref, ship_branch … } }` (confirmed in `_run_to_dict`). So the FE polling already receives the three fields once `RunRow` declares them.

---

## 2. The settled design (D5 + the D4 hint) — implement exactly this

**D5 — one unified launch panel; brownfield is a run-target choice, not a separate mode.** Clicking
"Run this team" OPENS the panel (does not fire the run). The panel:
- **Feature request** `<textarea>` (the idea). Optional — empty ⇒ greenfield server default (back-compat).
- **"Work on a local repo"** toggle. OFF ⇒ greenfield. ON ⇒ reveals the repo fields.
- **Repo path** `<input type="text">` (absolute path; typed, not a native picker — a browser can't hand the server a real path). On blur / debounced change ⇒ `inspectRepo(path)`. `is_git: false` ⇒ inline error + the Run-into-repo path stays disabled. `is_git: true` ⇒ populate the branch dropdown (default `current_branch`) + drive the size hint.
- **Base branch** `<select>` from `branches`, defaulted to `current_branch`.
- **Model hint (D4 — recommend, don't enforce).** When `tracked_file_count > LARGE_REPO_FILE_THRESHOLD` (a named const ≈ 300), show a dismissible advisory line naming the worker nodes — `teamGraph.nodes.filter(n => n.kind === "agent").map(n => n.role_name)`: e.g. *"Large repo (~N files). Working on existing code this size is harder — consider a stronger model on your worker node(s): {names}. Edit a node to change its model."* Non-blocking; NEVER auto-changes a model. If there are no `agent` nodes, omit the names (keep the size note).
- **Run** button ⇒ `runTeam(currentTeamId, { idea, repo_path, base_ref })`, including `repo_path`/`base_ref` ONLY when the toggle is on AND the repo validated. Then the existing run view takes over (set graph + runId, exactly as `handleRunTeam` does today). Greenfield (toggle off): call with `{ idea }` (or no opts if idea empty) so the POST body is `{ team_graph_id }` — byte-for-byte today.

*UX result:* quick greenfield run = click Run → (optionally type a feature) → Run. Brownfield = click Run → flip "work on a local repo" → paste path → pick branch → (if big) the model nudge → Run; the banner then shows `branch tvashtr/<run>`; their working tree never moved.

---

## 3. Tasks (ordered; self-decompose)

1. **`api.ts`:** extend `runTeam(teamGraphId, opts?: { idea?: string; repo_path?: string; base_ref?: string })` — include each field in the POST body ONLY when set; a no-opts call posts `{ team_graph_id }` byte-for-byte (back-compat). Add `inspectRepo(path: string): Promise<RepoInspect>` (`POST /api/repo/inspect`) + a `RepoInspect` discriminated type. Add `repo_path?`/`base_ref?`/`ship_branch?` to `RunRow`.
2. **The launch panel** (new `components/LaunchPanel.tsx`): the popover/inline panel + all fields + the inspect wiring + the model hint, per §2. Wire into App.tsx: "Run this team" opens it; the panel's Run calls the extended `runTeam` + drives the same `getGraph`/`setRunId` takeover. Keep the disabled/validity semantics (don't open for an unrunnable team — reuse `teamRunnable`).
3. **`RunBanner.tsx`:** when `run.ship_branch` is set (brownfield), render a `branch` Item (`run.ship_branch`); keep the greenfield `ship`(tag) Item when there's no branch.
4. **Tests (vitest + RTL, co-located `*.test.tsx`):** the panel opens on click; **greenfield Run posts `{ team_graph_id }` with no extra fields** (assert the fetch body); the toggle reveals the repo fields; inspect validation (mock `is_git:false` ⇒ inline error; `is_git:true` ⇒ branch dropdown populates + defaults to `current_branch`); the **model hint renders above threshold and names the worker `role_name`s** (mock a large `tracked_file_count` + a team with an `agent` node); brownfield Run posts `{ team_graph_id, idea, repo_path, base_ref }`; `RunBanner` shows the branch when `ship_branch` is set. **Use `fireEvent`, not user-event** (vitest fake-timers gotcha, HANDOVER §4); the React Flow shims come from `frontend/src/test/setup.ts`.
5. **Playwright e2e** (`frontend/e2e/` + a `make launch-panel-e2e` target): bring up backend + frontend; open the app; click "Run this team" ⇒ assert the panel opened (targeted `browser_evaluate` on the panel selector + a screenshot — **NOT** a whole-tree a11y snapshot, it hangs on the canvas, HANDOVER §4); flip "work on a local repo"; type a **real tiny fixture git repo** path the test creates ⇒ assert the branch dropdown populates from the real `inspect` round-trip (screenshot); assert that with the toggle OFF the panel's Run still launches a greenfield run. Capture a screenshot per check; record the paths in `STATE.md`. **Do NOT drive a full agent run from the browser** — the backend `brownfield-check` + the greenfield smokes already prove runs; this gate is the panel + the inspect wiring.

---

## 4. Do-NOT-touch / invariants

- **FRONTEND ONLY. Do NOT modify the backend.** The endpoints/payloads exist (verified). If you believe something backend-side is missing, STOP and write `NEEDS_HUMAN` rather than editing it in an FE slice.
- **Greenfield launch stays byte-for-byte:** empty idea + toggle off ⇒ `runTeam` posts `{ team_graph_id }` ⇒ the server default idea. The existing API smokes (which hit the backend directly) are unaffected; the existing `make test` backend count must not change (no backend edits).
- **Design system:** use the existing `tv-*` classes (`tv-btn`, `tv-seg`, `tv-field`, `tv-card`, `tv-panel`, `tv-pill`, `tv-validity`) + the design tokens (`var(--…)`); read the `frontend-design` skill. Match the quiet, hairline aesthetic — the canvas stays the star. No new heavy modal chrome.
- **No browser storage** (no localStorage/sessionStorage). **No new migration.** Don't touch `build_two_node_team`, the canvas topology code, or files unrelated to the launch flow.
- Don't regress the vitest floor (≥114) or the backend floor.

---

## 5. Acceptance (echo each decisive line — CLI-RULES §4.3a)

- `make test` — backend suite **unchanged** (no backend edits; same count, never regresses). Echo the `=== N passed ===` line.
- `make test-frontend` — vitest **≥114 + the new panel/banner tests**, green. Echo the summary line.
- `make build-frontend` — tsc-strict + vite build green. Echo the result.
- `make lint` — clean (FE under the gate). Echo the result.
- `make launch-panel-e2e` — the Playwright panel + inspect-round-trip proof green, **screenshots captured**. Echo its final status + the screenshot paths.
- `STATE.md` updated (sha, branch, FE test count, screenshots, any §15 deviations) + a final `READY_TO_MERGE: branch=feat/brownfield-launch-panel, sha=<sha>, …`. Echo that line.

---

## 6. Stop conditions (CLI-RULES §5)

- Self-heal all FE-level failures (tsc/vitest/build/Playwright timing). ≥3 distinct strategies before escalating a single cause.
- `NEEDS_HUMAN` to `STATE.md` + STOP for: a backend gap (do NOT fix it here), a Playwright/browser bring-up blocker that can't be scripted, a confirmed outage, or a second/unknown problem needing a broad/unproven change. A contained, regression-guarded FE fix to a single identified cause may proceed.
- Do NOT weaken the e2e to force green; do NOT delete/skip a failing assertion.

---

## 7. Report-back (final message + `STATE.md`)

Files changed (one-line why each), commands run WITH decisive output (`make test`, `test-frontend`,
`build-frontend`, `lint`, `launch-panel-e2e`), the screenshot paths, any deviation + rationale, §15
items, open questions, and the `READY_TO_MERGE` line. Branch: `feat/brownfield-launch-panel`.
