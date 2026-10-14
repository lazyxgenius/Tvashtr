# Brief — Connectors (queued by the operator 2026-09-30; start in a fresh, compacted context)

## The ask (operator, verbatim intent)
A user should be able to connect their CRM and analytics tools (CleverTap, Google Analytics), their
databases (Supabase, Neon, …), Google Docs and Drive, and any other plugin or connector. Get the list
of plugins and connectors that Claude Desktop offers, for reference. Decide, as a good product
manager, where connectors are listed, how they are connected, and how a user then uses them. **Design
the flow first, in the Claude Design artifact https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK
("Tvashtr Agent Panel Redesign"), before writing any code.**

## Where Tvashtr stands (main 389ab84, deployed as Fly v28, Desktop 0.12.0)
- Tvashtr builds teams of AI agents on a canvas (PM → Engineer ⇄ Reviewer …) that run against a
  repo and open a PR. An agent's drawer has Setup · Skills & tools · Memory · Runs · Docs.
- **Tools today = MCP servers.** Toolkit › Tools (`frontend/src/pages/tools/`, backend
  `backend/tvashtr/routes/toolkit.py`, contract `docs/superpowers/plans/api/toolkit.md`) keeps a
  library of tool servers (local `command`/`args` or remote URL, `${SECRET}` references); an agent's
  Skills & tools tab picks from the library or adds its own (`frontend/src/panel/tools/nodeTools.ts`:
  a node's `tool_config` = `mcpServers` + `tvashtr` meta). Toolkit › Secrets
  (`frontend/src/pages/secrets/`) stores per-account secrets the servers reference.
- **Domains** (`frontend/src/pages/domains/`, `docs/superpowers/plans/api/domains.md`) are the
  account's own documents with cited search; an agent gets per-domain access through the "Domains
  this agent can search" checklist (OQ-2) — a pattern connectors can reuse.
- **Engines** = model providers and the user's Claude/Grok/Codex plans (Tvashtr Desktop).
- Rules that still hold: APIs only add fields; every new read/write owner-scoped (another account
  gets 404) with a test; migrations only by explicit decision (next free number 0043); bugs
  test-first; commit own paths by name; never commit `design/`, `HANDOVER.md`, `PROJECTPLAN.md`,
  `prompts/`.

## Steps
1. **Research (no code):** the connectors/plugins Claude Desktop offers (the claude.ai connectors
   directory and the MCP registry — the `mcp-registry` tools `list_connectors` /
   `search_mcp_registry` are available in this environment); for each target in the ask (CleverTap,
   GA, Supabase, Neon, Google Docs/Drive) find whether an official remote MCP server exists, its auth
   (OAuth vs API key), and what it can read/write.
2. **Product decisions (write them down with the reasoning):** where connectors live (e.g. a
   Toolkit › Connectors page vs. inside Tools), connect flow (OAuth where offered, API key into
   Secrets otherwise), per-account vs. per-agent grants (reuse the Domains checklist pattern),
   read-only defaults, what a run shows when a connector is used, what happens on Tvashtr Desktop
   vs. the web, and what's out of scope for v1.
3. **Design the flow in the Claude Design artifact above** (read it first; add the Connectors
   screens and flows in its existing style — the revamp design system). Stop and show the operator
   the flow before any code.
4. Only after the operator approves: plan the build (API contract, UI, tests) and build it.
</content>
</invoke>
