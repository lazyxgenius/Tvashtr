# Filler-B — Tools library shelf: a guided add form (FE-only)

## Mission
The account **Tool library** shelf currently makes you hand-write the MCP server config in a raw JSON `<textarea>`. Add a GUIDED Local/Remote form — mirroring the friendly add-server form that already exists inside a node's Tools drawer — so a non-expert can add a reusable server by filling fields. Keep the raw JSON as an "Advanced" fallback for power users.

This is a self-contained FRONTEND-ONLY task. It touches NO backend, NO Python, NO migration, NO `.css` file, and ONLY the file `frontend/src/components/ToolsShelf.tsx` (+ its test). It runs fully offline (no NIM).

## Read these two files first
- **`frontend/src/components/ToolsShelf.tsx`** — the file you edit. Today: a name `<input>` + a raw config `<textarea>` (`configText` state) → `handleSave()` parses `configText` as a non-empty JSON object and calls `createToolLibraryItem(name, config)` / `updateToolLibraryItem(editingId, name, config)`. A library item is `{ id, name, server_config }` where **`server_config` is the INNER object directly** — `{command, args, env}` for stdio or `{url, headers, type}` for http/sse — NOT wrapped in `mcpServers` (the name is the separate `name` field). The top-of-file `transportOf(config)` already derives the badge from that inner object.
- **`frontend/src/panel/ToolsSection.tsx`** — the pattern to MIRROR (do NOT edit it). Its guided add-server form (search `tv-mcp-add`) is: a name input + a `<div className="tv-seg" role="group" aria-label="Transport">` with two `tv-seg__btn` buttons (**Local** / **Remote**, `is-active` on the selected) + a single target input whose label/placeholder flips (`Command` "command (e.g. uvx)" for local; `URL` "https://…/mcp" for remote) + an "Add server" button. Its `addServer()` builds `{ command, args: [] }` (local) or `{ url }` (remote). Reuse these EXACT class names (`tv-seg`, `tv-seg__btn`, `is-active`, `tv-launch__input`, `tv-btn`, `tv-btn--ghost`) so no new CSS is needed.

## Design — the guided form is a structured view over `server_config` (mirror ToolsSection's architecture)
Follow ToolsSection's model exactly: **`server_config` (the parsed contents of `configText`) is the single source of truth.** The guided controls READ their values by parsing `configText`, and WRITE by regenerating `configText` (via the existing `setConfigText`). The raw JSON textarea (relabeled "Advanced") edits the same `configText` directly. On Save, `handleSave()` is UNCHANGED — it still parses `configText` — so the guided form and the raw JSON can never disagree at save time (the JSON is authoritative). This keeps the risky save/validate path byte-identical.

### The controls to add (above the existing textarea)
1. A **transport segmented toggle** — `Local` / `Remote`, using `tv-seg`/`tv-seg__btn`/`is-active` exactly like ToolsSection. Its state derives from `transportOf(parsedConfig)` (`stdio` → Local; `http`/`sse` → Remote) so it reflects whatever's in the JSON; clicking it switches the shape.
2. **Local fields**: a `Command` input (→ `server_config.command`) and an optional `Args` input (space-separated → `server_config.args: string[]`; empty → `[]`).
3. **Remote field**: a `URL` input (→ `server_config.url`).
4. An optional, lightweight **env/headers editor** (this is the one place the library form should exceed ToolsSection's minimal form, because library servers commonly carry secret refs): add/remove `KEY` → `VALUE` rows that write to `server_config.env` (Local) or `server_config.headers` (Remote). Values may contain `${NAME}` secret references; show a static hint: "Secrets stay as `${NAME}` references, resolved at run time." Keep it simple — a list of rows with an "Add variable" button and a remove `×` per row. (Do NOT build a Secrets-shelf cross-check; that's out of scope.)
5. The existing raw config `<textarea>` stays, relabeled to an **"Advanced (raw JSON)"** disclosure (e.g. wrap it in a `<details>` with a summary, or a small "Advanced" toggle) so it's clearly the fallback, not the primary input. It still binds to `configText`.

### The binding contract (keep it simple + robust)
- A pure helper `buildServerConfig({ transport, command, args, url, env })` → the inner `server_config` object. Unit-test it.
- A pure helper to READ the guided-field values from the parsed `server_config` (transport, command, args-as-string, url, env-rows) so the controls populate correctly when editing an existing item (`startEdit` already fills `configText`).
- Editing any guided control regenerates `configText = JSON.stringify(built, null, 2)`. Editing the raw JSON updates `configText` directly (guided fields re-derive from it on the next render — best-effort; the raw JSON is authoritative). Do NOT add a second source of truth or a separate `onChange`.
- `name` stays exactly as today (the existing `nameInput`); `handleSave()` / `resetForm()` / `startEdit()` / the item list / remove all stay behavioral-identical (you may extend `startEdit`/`resetForm` only to also reset guided-field state if you keep any local state, but prefer deriving from `configText`).

## Hard invariants (checkable on disk)
1. **FE-only.** `git diff main -- backend/` is EMPTY. No Python, no migration.
2. **No `.css` file touched.** `git diff main -- '*.css'` is EMPTY (reuse the existing classes above; use inline `style` like the file already does if you truly need layout). This keeps the parallel Filler-A session collision-free.
3. **ONLY `frontend/src/components/ToolsShelf.tsx` (+ `ToolsShelf.test.tsx`) change.** Do NOT touch `ToolsSection.tsx`, `Dashboard.tsx`, `NewTeamDialog.tsx`, `DrawerShell.tsx`, `frontend/src/lib/api.ts`, or any stylesheet (the other parallel session owns the modal/a11y files). Use the EXISTING `createToolLibraryItem` / `updateToolLibraryItem` / `listToolLibrary` / `deleteToolLibraryItem` — do not change the API layer.
4. `handleSave()`'s parse+validate of `configText` and the create/update calls are behavior-identical to main (the guided form only WRITES `configText`).
5. Branch `feat/tools-shelf-guided-form` off CURRENT `main` (`adf1f32`, not `2c13d56` — main advanced one docs commit; verify with `git log -1`). Never push. Never merge to main.
6. Commit only your own changed files. Leave `prompts/`, `PROJECTPLAN.md`, `HANDOVER.md` alone.

## Acceptance / evidence (echo each into chat as it completes)
- `npm run build` (tsc + vite build) clean.
- `npm run test` (vitest) all green, count ≥ 252 + the new tests below, all mutation-real:
  1. **`buildServerConfig` unit test**: Local + command "uvx" + args "mcp-server-fetch --flag" → `{command:"uvx", args:["mcp-server-fetch","--flag"]}`; Local + one env row `TOKEN=${GH}` → `env:{TOKEN:"${GH}"}`; Remote + url → `{url:"https://…"}`; Remote + a header row → `headers:{…}`.
  2. **Guided → JSON sync**: rendering `ToolsShelf`, typing a name + choosing Local + filling command → the "Advanced" JSON reflects the built `server_config`; clicking "Add tool" calls `createToolLibraryItem` with `(name, builtConfig)` (mock the API module). Assert the exact object passed.
  3. **JSON → guided (edit path)**: `startEdit` of a stubbed Remote item populates the transport toggle to Remote and the URL field with the stored value.
  4. **Transport switch** flips Local↔Remote fields and reshapes the built config (command→url).
  5. Existing ToolsShelf tests still pass (the list, remove, name-required, invalid-JSON error path are unchanged).
- **Playwright self-sign-off** (bring up the stack on the ports/DB from the launch note — no NIM needed; screenshot per check): open the dashboard → the Tool library shelf shows the guided Local/Remote form (screenshot); fill name + Local + command, confirm the Advanced JSON populates (screenshot); switch to Remote and confirm the field flips to URL (screenshot). You MAY use Playwright API route mocks if bringing up the backend is heavy — but the screenshots are required.
- `STATE.md` maintained; final line `READY_TO_MERGE` + the branch tip sha.

## Stop conditions
- No external-service dependency. If the toolchain / `npm install` / a port is genuinely broken after reasonable retries → `NEEDS_HUMAN` in `STATE.md` with the exact failure; the offline suite must still be green first.
- Any change that would require touching the API layer, a backend file, a stylesheet, or another component → STOP and `NEEDS_HUMAN` (the plan was wrong; do not expand scope).
- Hard cap: 30 turns.
