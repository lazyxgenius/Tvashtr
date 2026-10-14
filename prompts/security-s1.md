# Brief — Security S1: agents never hold a login, sign-ins can't be borrowed, every route checks its owner

Architect: Tvashtr Sidechat-16, 2026-09-30. Read this whole file before doing anything.

## Why (audited on disk, `main` @ `f6f8b3f`, live as Fly v29 / `desktop-v0.13.0`)

1. **Domains hands agents the owner's full login.** `node_tools.build_mcp_config` puts
   `make_session_cookie_value(owner)` — the real `tv_session` login, valid 14 days, stateless (no
   session table, so it can't be revoked) — into the `tvashtr-domains` MCP headers of every agent
   with Domains ticked. `/mcp/domains` (`control_plane/domain_mcp.owner_id_from_headers`) accepts
   only that cookie, and takes the allowed-domain list from a header the caller sets. The Connectors
   proxy was built on the premise that anything in an agent's tool settings can reach the agent.
   Connectors now feed outside text to agents (Notion pages, Linear issues, Intercom messages,
   15,045 unreviewed registry servers), so a prompt-injected agent that leaks this cookie hands over
   the whole account for 14 days: runs on the owner's keys, PRs through their GitHub installation,
   every document. Pre-existing since 2026-09-15; the endpoint only started answering agents with
   the Connectors deploy (it was 405/421 before), so it is now fully live.
2. **An unreviewed connector can borrow a Featured provider's sign-in.** The sign-in checks in
   `control_plane/connector_oauth.py` (issuer match, every endpoint on the issuer's site, PKCE S256,
   RFC 9207 `iss` when sent) all pass when a registry or custom server's resource metadata simply
   names a real provider's authorization server (say Notion's). The user approves Notion on Notion's
   real page, and the proxy then sends that Notion token to the unreviewed server.
3. **The owner-scoping sweep never ran.** Three cross-account reads were found by accident (documents,
   costs, run events). Only `tests/test_documents_owner_scope.py` exists as a dedicated check, and
   Domains, Desktop and Connectors have added many routes since.
4. **The migration freeze hook still stops at `0041`.** `0042` and `0043` are shipped and unprotected.

## Work — branch `fix/security-s1` from `main` `f6f8b3f`

### A. Domains agents get a run token instead of the login cookie
- Reproduce first: a test that `build_mcp_config` for a Domains-ticked node yields no `tv_session`
  (and no `Cookie` header) anywhere in its output. Echo it failing on the unchanged code.
- A Domains run token built like `connector_proxy.sign_run_token`: its own salt; it names the run,
  the agent (node) and the domain ids that agent may search; the endpoint refuses it once the run has
  ended, or when the run's owner doesn't own the domain. It travels as `Authorization: Bearer`.
- `/mcp/domains` accepts only that token. The session cookie no longer works there. The allowed
  domains come from the token, never from a header. Keep today's meaning of "Domains ticked with no
  list" (read the code to see what it grants today; keep that exactly).
- Tests: an ended run's token → refused; a token for domain A can't search domain B; another
  account's run → refused; a session cookie → refused; a Connectors run token can't be used at
  `/mcp/domains` and a Domains token can't be used at `/mcp/connectors` (different salts).
- Extend the live run-time check (`5b96cbd`, plan T.2) to Domains: a real agent searches a domain
  through the token, and `tv_session` appears nowhere in that run's events or in the agent config the
  adapter persisted.

### B. A registry or custom connector can't borrow a Featured provider's sign-in
- Reproduce first with the fake OAuth MCP server: a registry or custom server whose resource
  metadata names a Featured provider's authorization server connects today. Echo it.
- For any connection that is not a Featured entry, refuse a sign-in whose authorization server is on
  the same site as a Featured entry's authorization server, with: "This server wants to use
  <Provider>'s sign-in. Connect <Provider> from its own card instead." Featured entries are unchanged.
- In the connect sheet, when the sign-in site is not the server's own site, say so before the window
  opens: "You'll sign in at <site>." (Skip if the sheet already shows it — then say where.)
- Re-shoot the Connectors connect-sheet boards (pages "Connectors" and "Connectors flows" in the
  design) and confirm 0 size/type drift, web and Desktop.

### C. The owner-scoping sweep, with a guard for new routes
- Enumerate every route in the FastAPI app (`app.routes`, including the MCP mounts and the Desktop
  runner routes). Classify each: takes an object id (path or body), lists rows, or public by design
  (health, website pages, OAuth callback and client metadata, confirm page — each with its reason).
- For every id-taking route, a generated test: account A creates the object; account B calls the
  route → 404 (never 200, never A's data); after B's write attempts, A's object is unchanged. For
  every list route: B sees none of A's rows.
- A guard test that fails when a route is added that isn't in the sweep's table, so a future route
  can't skip it.
- Every route that fails: fix test-first, one commit per fix. Echo the route table as you go
  (route · kind · result · fix commit).

### D. Freeze the shipped migrations
- `.claude/hooks/protect-migrations.sh`: freeze `0001`–`0043` (regex and message). Show the hook
  refusing an edit to `0043` and allowing a new `0044_*.py` path (don't create one).

## Invariants (show each with a command)
- No migration file added.
- `git diff main -- backend/tvashtr/control_plane/team_run.py` is empty (the token is minted in
  `node_tools`, which already receives `node_id`).
- APIs only add fields; no existing assertion weakened.
- Never touch Fly secrets or production data.

## Ship — through the Ship Protocol in `prompts/revamp-e2e.md` (steps 1–9) and its Hard rules
- Step 1 gates: `make test` on its own database (never one the e2e specs use); vitest, tsc, build;
  desktop tests; docker build; eslint/prettier/ruff on changed files; the Connectors sheet boards at
  0 drift; e2e: the Domains spec, the Connectors spec, `revamp-shell`, and every spec that drives a
  route the sweep changed; the live run-time check from A; an independent security review by a
  helper that didn't build this (every finding answered); `make demo-proof` C1–C12 with a real PR.
- Step 2/9: record the ship in a new `docs/superpowers/HANDOVER-2026-09-30-security-s1.md` (what
  shipped, the route table, what's left).
- Step 3: `desktop/package.json` → `0.14.0` (the frontend changed, and Desktop bundles it).
- Step 6: no migration and no `team_run.py` change, so no pause.
- **After the ship, end with NEEDS_HUMAN** asking the operator to rotate `TVASHTR_SESSION_SECRET`
  on Fly. Say why (it signed every login cookie handed to agents since 2026-09-15; they last 14 days
  and can't be revoked any other way), what it does (everyone is signed out once, web and Desktop;
  connector run tokens of runs in flight stop working; stored API keys are NOT affected — they use
  `TVASHTR_SECRET_KEY`), and when (with Home › Running now empty). Do not rotate it yourself.

## Report
Branch and commits; per file what and why; the route table; every command with its result; the
reproduce-first failures; e2e and demo-proof results with the PR URL; main sha, Fly release, DMG tag
and DMG check; deviations; what was not done; risks.
