# Free Tools & Skills Catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Ted’s GO’d MVP — a static built-in **Tool catalog** (free `fetch` + shelf access badges) and **Skill presets** (caveman + ≤2 short vendored inline), one-click attach via existing `tvashtr.library` / skill-library paths, and a ToolsSection Domains MCP toggle (`tvashtr.domains`). NULL configs stay inert.

**Architecture:** Mirror `PROVIDER_CATALOGUE` / `public_provider_catalogue`: a static module const + public serializer + thin GET APIs. Attach is FE-driven through existing `/api/tool-library` + `/api/skill-library` upserts, then node refs (`tool_config.tvashtr.library` / `{type:"library",id}`). Do **not** widen `build_mcp_config` / `build_skills` signatures. Domains inject already lives in `build_mcp_config` when `tvashtr.domains` is truthy — FE only flips the flag.

**Tech Stack:** FastAPI + pytest (unit, no Postgres preferred); React 19 + Vitest + Testing Library.

## Global Constraints

- **Branch:** `feat/free-tools-skills-catalog` from `feat/polyrag-domains-phase7` @ **`c3f1ad5`**. Do not push. Never `git config`. Author via `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env only.
- **Frozen seams:** do not change `build_mcp_config(tool_config, run_id)` or `build_skills(...)` signatures.
- **Inert-until-set:** `build_mcp_config(None)` / `build_skills(None)` stay `{}` / `[]`. Catalog + presets are opt-in only. Do **not** silently inject fetch/caveman globally; do **not** change builder caveman stamp (pre-existing M-thrift).
- **Free MCP:** only proven no-login stdio: `{"command":"uvx","args":["mcp-server-fetch"]}`. At most one additional free stdio if truly no-login — default to **just fetch**.
- **Out of scope:** Slack/Gmail/Notion OAuth, Brave/search, silent global inject, seed-on-signup, project_rules quick-add (unless it falls out naturally — it should not).
- **Tests:** prefer unit/FE without Postgres. If DB tests needed and docker missing → note blocker; still land unit tests.
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.

---

## Locked product slice

| Ships | Does not ship |
|-------|----------------|
| Static `TOOL_CATALOGUE` with free `fetch` + access badges | OAuth MCP (Slack/Gmail/Notion), Brave |
| One-click attach fetch → library upsert + `tvashtr.library` ref | Silent global MCP inject |
| ToolsSection Domains toggle (`tvashtr.domains`) | Widening `build_mcp_config` |
| Skill presets: caveman + ≤2 short vendored inline → skill_library attach | Auto-seed library on signup |
| Shelf copy: **Free** / **Needs `${SECRET}`** / **Needs GitHub App** | project_rules quick-add |
| Public catalogue APIs (provider-catalogue pattern) | New alembic / schema |

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Create** `backend/tvashtr/control_plane/tool_skill_catalog.py` | `TOOL_CATALOGUE`, `SKILL_PRESETS`, `public_tool_catalogue()`, `public_skill_presets()`, access helpers, caveman content load from vendored `skills/caveman/SKILL.md`. |
| **Create** `backend/tests/test_tool_skill_catalog.py` | Unit tests: catalogue shape, free fetch config exact, presets include caveman, access labels, public serializers strip nothing sensitive (static only). |
| **Modify** `backend/tvashtr/routers.py` | `GET /api/tool-catalog`, `GET /api/skill-presets` (public or session — static content; prefer **auth-optional/public** like `/api/config` catalogue; use existing router + `get_current_user` only if sibling library routes require it — **choose public** to mirror provider catalogue discoverability). |
| **Create** `backend/tests/test_tool_skill_catalog_api.py` | API smoke: 200 + fetch entry + caveman preset (TestClient; skip/mark if DB fixture required — prefer no DB). |
| **Modify** `frontend/src/lib/api.ts` | Types + `listToolCatalog()` / `listSkillPresets()` fetchers. |
| **Modify** `frontend/src/components/ToolsShelf.tsx` (+ test) | Catalog strip: badge Free / Needs `${…}` / Needs GitHub App; “Add to library” for attachable entries via `createToolLibraryItem`. |
| **Modify** `frontend/src/components/SkillsShelf.tsx` (+ test) | Preset strip: Free badges; “Add to library” via `createSkillLibraryItem`. |
| **Modify** `frontend/src/panel/ToolsSection.tsx` (+ test) | Domains MCP checkbox (`tvashtr.domains`); one-click **Attach fetch** (upsert library + append id to `tvashtr.library`). |
| **Modify** `frontend/src/panel/SkillsSection.tsx` (+ test) | Optional “Add preset” picker from skill presets (library attach) — thin; shelf is primary. |
| **Create** `backend/tvashtr/skills/tdd/SKILL.md` + `yagni/SKILL.md` (or similarly short names) + tiny PROVENANCE | ≤2 short vendored inline skills (original Tvashtr text, MIT-ish note). |

**Do not create:** Alembic, OAuth clients, changes to `team_run.py`, seed-on-signup.

---

### Catalogue shape (locked)

```python
# access: "free" | "needs_secret" | "needs_github_app"
TOOL_CATALOGUE: dict[str, dict] = {
    "fetch": {
        "key": "fetch",
        "name": "fetch",  # mcpServers key / library name
        "title": "Web fetch",
        "description": "Fetch HTTP URLs (stdio via uvx mcp-server-fetch). No login.",
        "access": "free",
        "secret_names": [],
        "attachable": True,
        "server_config": {"command": "uvx", "args": ["mcp-server-fetch"]},
    },
    # Shelf-copy examples (templates; not OAuth):
    "github": {
        "key": "github",
        "name": "github",
        "title": "GitHub (PAT)",
        "description": "GitHub MCP via personal access token secret.",
        "access": "needs_secret",
        "secret_names": ["GITHUB_TOKEN"],
        "attachable": True,
        "server_config": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"},
        },
    },
    "github-app": {
        "key": "github-app",
        "name": "github-app",
        "title": "GitHub App repos",
        "description": "Hosted runs use your Tvashtr GitHub App installation — install the App, then launch against an App repo.",
        "access": "needs_github_app",
        "secret_names": [],
        "attachable": False,
        "server_config": {},
    },
}

SKILL_PRESETS: dict[str, dict] = {
    "caveman": {
        "key": "caveman",
        "name": "caveman",
        "title": "Caveman (terse)",
        "description": "Vendored ultra-compressed output style.",
        "access": "free",
        "attachable": True,
        "source": {"type": "inline", "name": "caveman", "content": "<SKILL.md>", "mode": "always"},
    },
    # + up to 2 short original inline presets (tdd, yagni)
}
```

Badge copy (exact FE strings):
- `free` → `Free`
- `needs_secret` → `Needs ${NAME}` (join secret_names; if empty fall back to `Needs ${SECRET}`)
- `needs_github_app` → `Needs GitHub App`

---

### Task 1: Static catalog module + unit tests

**Files:**
- Create: `backend/tvashtr/control_plane/tool_skill_catalog.py`
- Create: `backend/tests/test_tool_skill_catalog.py`
- Create: short skill markdown under `backend/tvashtr/skills/{tdd,yagni}/SKILL.md` (+ one-line PROVENANCE)

- [ ] **Step 1: Write failing unit tests** for `public_tool_catalogue` / `public_skill_presets`: fetch config exact; only one free attachable tool is fetch (or fetch+one); github access/secret_names; github-app not attachable; presets include caveman + 2 shorts; caveman content non-empty and contains “caveman”.

- [ ] **Step 2: Implement catalog module** + vendored short skills.

- [ ] **Step 3: Run** `uv run pytest backend/tests/test_tool_skill_catalog.py -q` → green.

- [ ] **Step 4: Commit**
```
feat(catalog): static free tool + skill preset catalogues
```

---

### Task 2: Public catalogue HTTP endpoints

**Files:**
- Modify: `backend/tvashtr/routers.py` (or `main.py` if co-located with `/api/config` — prefer **routers** next to library routes for cohesion, public/no-auth)
- Create: `backend/tests/test_tool_skill_catalog_api.py`

Prefer endpoints that need **no DB** (plain function returning JSON). If router always depends on DB session middleware, use TestClient patterns that already work in unit suite without docker; otherwise skip API test and keep unit coverage.

- [ ] **Step 1: Failing API test** `GET /api/tool-catalog` → `{tools: [...]}` includes fetch; `GET /api/skill-presets` → `{skills: [...]}` includes caveman.

- [ ] **Step 2: Wire routes.**

- [ ] **Step 3: pytest green; commit**
```
feat(catalog): GET /api/tool-catalog and /api/skill-presets
```

---

### Task 3: FE api.ts + ToolsShelf catalog strip

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/ToolsShelf.tsx`
- Modify: `frontend/src/components/ToolsShelf.test.tsx`

- [ ] **Step 1: Types + fetchers**; failing shelf test: renders Free badge for fetch; Add to library calls `createToolLibraryItem("fetch", {command:"uvx", args:["mcp-server-fetch"]})`; Needs `${GITHUB_TOKEN}` / Needs GitHub App strings present.

- [ ] **Step 2: Implement catalog strip** above the existing library list (do not break guided form).

- [ ] **Step 3: npm test ToolsShelf; commit**
```
feat(catalog): ToolsShelf free / secret / GitHub App catalog strip
```

---

### Task 4: SkillsShelf preset strip

**Files:**
- Modify: `frontend/src/components/SkillsShelf.tsx` (+ test)

- [ ] **Step 1: Failing test** — caveman Free + Add to library posts inline source.

- [ ] **Step 2: Implement; green; commit**
```
feat(catalog): SkillsShelf skill preset strip
```

---

### Task 5: ToolsSection — Domains toggle + one-click Attach fetch

**Files:**
- Modify: `frontend/src/panel/ToolsSection.tsx` (+ test)

- [ ] **Step 1: Failing tests**
  - Domains checkbox sets `tvashtr.domains: true` (from null → `{tvashtr:{domains:true}}`); uncheck clears domains and collapses to `null` when nothing else remains.
  - Attach fetch: given empty library mock, calls `createToolLibraryItem` then `onChange` with `tvashtr.library` containing returned id. If library already has `fetch`, only appends that id (no duplicate create) — mock `listToolLibrary` accordingly.

- [ ] **Step 2: Implement** (import createToolLibraryItem; keep library picker).

- [ ] **Step 3: green; commit**
```
feat(tools): Domains toggle + one-click attach fetch via library
```

---

### Task 6: SkillsSection — Add from presets (thin)

**Files:**
- Modify: `frontend/src/panel/SkillsSection.tsx` (+ test)

- [ ] **Step 1: Failing test** — “Add from presets” lists caveman; choosing it creates skill library item (mock) and appends `{type:"library", id}`.

- [ ] **Step 2: Implement; green; commit**
```
feat(skills): opt-in skill presets via library attach
```

---

### Task 7: Final verification

- [ ] Run focused backend + frontend suites; note docker/Postgres blockers if any.
- [ ] `git status -sb` + `git log --oneline c3f1ad5..HEAD`
- [ ] Report SHAs, tests, deviations.

---

## Success criteria

1. Branch `feat/free-tools-skills-catalog` based on `c3f1ad5`.
2. Free fetch attachable one-click without secrets; domains toggle only sets metadata; presets opt-in via library.
3. Shelf badges: Free / Needs `${…}` / Needs GitHub App.
4. No push; no `git config`; inert NULL configs preserved.
