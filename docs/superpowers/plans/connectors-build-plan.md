# Connectors: build plan

Contract: `docs/superpowers/plans/api/connectors.md`. Decisions: `connectors-decisions.md` (§3, §6).
Visual spec: the Claude Design canvas pages **Connectors** (`Cn-Screens`) and **Connectors flows**
(`CnF-Connect`, `CnF-Agents`, `CnF-Changes`). Base: `main` @ 389ab84.

Rules for every task: tests first, then code; APIs only add fields; every new read or write is
owner-scoped (another account gets 404) with a test; migration 0043 is the only migration and
0001–0042 are never edited; no new dependency (httpx, mcp, itsdangerous and cryptography are
already installed).

## 1. The decisions this plan rests on

1. **The agent never gets the provider's token. It gets a Tvashtr run token and talks to a Tvashtr
   proxy** (`/mcp/connectors`), which adds the provider credential server-side. This replaces "put a
   short-lived provider token in the MCP config" from decision 7, and keeps its intent (the stored
   sign-in never leaves the server) more strictly. It is the one design that fixes all five
   problems the runtime map found:
   - read-only is enforced for real (the agent has a shell; holding the provider token it could
     call write tools directly or drop Supabase's `read_only=true`);
   - a warm sandbox keeps its round-1 MCP config for later rounds, so a one-hour provider token
     would die mid-node; the proxy refreshes on its own;
   - a single failing MCP server stops an agent from starting; the proxy always answers;
   - calls are recorded with the right connector, tool and read/write, with no guessing from
     tool-name prefixes (which change with the number of servers);
   - nothing depends on the agent-server image, and the Fly egress fence only needs the backend.
2. **Read-only mechanism:** the provider's own URL flag where there is one (Supabase `read_only`,
   Neon `readonly`), applied by the proxy so the agent can't remove it; otherwise the proxy lists
   and allows only tools annotated `readOnlyHint: true` (missing = write). Google uses read-only
   scopes and is read-only-only. No scope narrowing for other providers in v1.
3. **Token work happens inside the `agent_run_step` DBOS step**, in `build_mcp_config`: check or
   refresh the provider token under a row lock, then sign the run token. Nothing secret is
   checkpointed (the step returns usage and outcome only). A re-executed step just finds a fresh
   token. The proxy uses the same `ensure_access_token` when a call meets an expired token.
4. **One table.** Pending sign-in and the client registration live on the connection row; calls are
   `run_events` rows; warnings are `run_warnings` rows.
5. **Catalog = 14 Featured cards + a bundled registry snapshot + Custom.** The snapshot is JSON
   Lines in the repo (one server per line, sorted), so a refresh is a readable diff.
6. **One sign-in path for web and Desktop:** the app opens the provider page (popup on the web,
   system browser on Desktop) and polls the connection until the sign-in finishes. The callback page
   is served by the backend and never redirects into the app.
7. **Cut from the canvas** (superseded by §6 C of the decisions): the CleverTap key flow as a
   Tvashtr-built server, the Google Analytics key-file flow, and "three Google connectors in one
   sign-in". The API-key screens are still built, for registry servers that declare a secret header.

## 2. Streams, order and file ownership

Phase 0 (Foundation) is serial, in one worktree, and lands on branch `feat/connectors`. Streams
B1, B2, B3, F1, F2 and D then run in parallel worktrees branched from it. Merge order:
B1 → B2 → B3 → F1 → F2 → D. Stream T (e2e and gates) runs on the merged branch.

| Stream | Owns (nobody else edits these) |
|---|---|
| 0 | `alembic/versions/0043_connector_connections.py`, `models.py`, `config.py`, `main.py`, `control_plane/connector_net.py`, `control_plane/connector_upstream.py`, `tests/fake_connector_server.py`, `tests/conftest.py` (one fixture), `frontend/src/lib/api/connectors.ts` |
| B1 | `control_plane/connector_catalog.py`, `control_plane/data/connector_registry.jsonl`, `scripts/refresh_connector_registry.py`, `control_plane/connectors.py`, `routes/connectors.py`, `control_plane/toolkit.py` (`summary` only) |
| B2 | `control_plane/connector_oauth.py`, `routes/connectors_oauth.py`, `scripts/connector_probe.py` |
| B3 | `control_plane/node_tools.py`, `control_plane/team_run.py` (two edits), `control_plane/connector_proxy.py`, `tvashtr/mcp/connectors.py`, `control_plane/node_history.py`, `routers.py` (run graph invocations only) |
| F1 | `frontend/src/pages/connectors/**`, `lib/nav.ts`, `pages/Workspace.tsx`, `pages/shell/Shell.tsx`, `lib/workspaceStatus.ts`, `pages/badgeLoaders.ts`, `lib/api/tools.ts` (summary fields) |
| F2 | `panel/tools/**`, `panel/connectors/**`, `panel/nodeCounts.ts`, `panel/skills/nodeSkills.ts`, `panel/runs/RunsTab.tsx`, `panel/run/RunNodeDrawer.tsx`, `components/RunWarnings.tsx`, `lib/api/nodes.ts`, `lib/api.ts`, `lib/events.ts` |
| D | `desktop/electron/main.cjs`, `navigationGuard.cjs`, `deepLink.cjs`, `desktop/scripts/*.test.cjs`, `desktop/package.json` |
| T | `frontend/e2e/connectors.spec.ts`, `scripts/connectors_e2e.sh`, `scripts/connectors_run_check.py` |

Two cross-stream calls, both stubbed in Phase 0 so streams don't wait on each other:
`connector_oauth.discover(url)` (B1 calls it, B2 writes it) and
`connector_proxy.recent_use(session, owner_id, connection_id)` (B1 calls it, B3 writes it).
One cross-stream component: F2.5 uses F1.4's `ConnectSheet`.

Worktrees: reuse the stale `.claude/worktrees/connectors` (it points at 389ab84) for Phase 0. Each
backend stream uses its own database (`createdb tvashtr_conn_<stream>`), passed as a command-line
variable: `make migrate DATABASE_URL=…`, `make test DATABASE_URL=…` (the Makefile's `include .env`
beats an exported variable; prove the database by row counts).

## 3. Phase 0: Foundation

**0.1 Migration and model.**
- Create `backend/alembic/versions/0043_connector_connections.py` from the 0023 template
  (`0023_tool_skill_library.py:40-62`); columns, checks and constraint names exactly as the contract.
- Add `ConnectorConnection` to `backend/tvashtr/models.py` after `ToolLibraryItem` (:985-1009); the
  docstring names the migration and says the two encrypted columns are never returned.
- Test first: `backend/tests/test_connector_connections_schema.py` (copy
  `tests/test_domain_message_meta_schema.py`): `revision`/`down_revision`, every column, the three
  unique constraints, the four checks, the owner index, and a downgrade/upgrade round trip.
- Accept: `make migrate` applies cleanly; the test passes.

**0.2 Settings.** `backend/tvashtr/config.py` (by `public_base_url`, :539): the contract's three
fields. Covered by 0.3's test.

**0.3 Outbound address guard.** Create `control_plane/connector_net.py`: `check_url(url) -> str`
(raises `UnsafeUrl`), and `client(timeout=10.0) -> httpx.Client` with `follow_redirects=False`.
`client` is the one seam tests replace (`monkeypatch.setattr(connector_net, "client", …)` returning
`httpx.Client(transport=httpx.MockTransport(fake.handle))`).
- Test first: `tests/test_connector_net.py`: `http://` refused; hosts resolving to `127.0.0.1`,
  `10.0.0.5`, `169.254.169.254`, `fdaa::1` refused (patch `socket.getaddrinfo`); a public address
  passes; `connectors_allow_local` lifts both rules; with `hosted_mode` on it lifts nothing.
- `# ponytail:` the check resolves once and httpx resolves again (DNS rebinding window); pin the
  resolved address in a custom transport if this ever matters.

**0.4 Fake OAuth MCP server.** Create `backend/tests/fake_connector_server.py`:
- `FakeConnectorServer(base_url, **knobs)` with `handle(httpx.Request) -> httpx.Response` covering
  protected-resource metadata, authorization-server metadata, `/register`, `/authorize`, `/token`
  (code and refresh grants) and `/revoke`. Knobs: `dcr`, `cimd`, `iss`, `confidential`,
  `expires_in`, `rotate_refresh`, `fail_refresh`, `path_issuer`, `no_resource_metadata`,
  `no_pkce`. It records every request for assertions.
- `app()`: a Starlette app with the same routes, an `/authorize` page with one "Allow" button, and
  `/mcp` (mcp SDK `FastMCP`, bearer required) with tools `list_things` and `get_thing`
  (`readOnlyHint: true`), `create_thing` (no annotation) and `list_projects`.
- `python backend/tests/fake_connector_server.py --port 9911` serves it with uvicorn.
- `tests/conftest.py`: one session fixture `fake_connector_url` that starts it as a **subprocess**
  on a free port. Never mount it on the shared app (`test_domain_mcp_http.py:8-10`: probing a
  streamable-HTTP mount through the shared TestClient tears down the DBOS lifespan).
- Test first: `tests/test_fake_connector_server.py`: `handle()` serves both metadata documents; the
  subprocess lists four tools with a bearer and answers 401 without.

**0.5 Provider MCP client.** Create `control_plane/connector_upstream.py`: async
`list_tools(url, transport, headers)` and `call_tool(url, transport, headers, name, arguments,
timeout=120)`, using `mcp.client.streamable_http.streamable_http_client(url, http_client=…)` (an
`httpx.AsyncClient` with no redirects) or `mcp.client.sse.sse_client`, plus `ClientSession`. Errors:
`UpstreamUnauthorized` (401/403), `UpstreamUnreachable`. `list_tools_sync` wraps with `asyncio.run`
for the sync routes. Every open calls `connector_net.check_url`.
- Test first: `tests/test_connector_upstream.py` against `fake_connector_url`: list and call with a
  bearer; no bearer → `UpstreamUnauthorized`; a closed port → `UpstreamUnreachable`.
- `# ponytail:` one provider session per call (an extra initialize round trip); pool per run and
  connection if latency shows up.

**0.6 Skeletons and registration.**
- Create `routes/connectors.py` (`router`), `routes/connectors_oauth.py` (`router`,
  `public_router`), `control_plane/connectors.py` (`ConnectorError(status_code, detail)`,
  `get_owned(session, owner_id, connection_id)` using `node_library._as_uuid`, `read_secret`,
  `write_secret`, `serialize`), `control_plane/connector_oauth.py` (`discover` stub),
  `control_plane/connector_proxy.py` (`recent_use` stub returning `[]`),
  `tvashtr/mcp/connectors.py` (`get_connectors_mcp()`: mcp SDK `FastMCP("tvashtr-connectors",
  stateless_http=True, json_response=True)`, no tools yet).
- `main.py`: import both route modules (:43-53); add both `router`s to the authenticated tuple
  (:130-141); include `connectors_oauth.public_router` bare next to the other public routers
  (:122-124); build the proxy app like Domains (:59-61), enter its lifespan inside `_lifespan`
  (:81) and mount `/mcp/connectors` beside `/mcp/domains` (:379-380).
- Test first: `tests/test_connectors_api.py::test_list_is_empty_and_needs_a_session`
  (`{"connections": []}`; 401 with `unauth_client`).

**0.7 Frontend API client.** Create `frontend/src/lib/api/connectors.ts` in the shape of
`lib/api/tools.ts` (validators :16-41, `apiRequest` from `lib/api/runs.ts:44-77`): types
`CatalogEntry`, `Connection`, `ConnectorTool`, `ConnectorAgentsByTeam`, `RoundConnectors`, and one
function per contract route. Create `pages/connectors/connectorsTestUtils.ts` with `entry()` and
`connection()` fixtures.
- Test first: `lib/api/connectors.test.ts` with `mockApi` (`pages/tools/toolsTestUtils.tsx:26-58`):
  each call hits the right method and path and a malformed answer throws.

Accept Phase 0: backend suite, `npm run test`, `npm run build`, `npm run lint` green on
`feat/connectors`; `GET /api/connectors` answers.

## 4. Stream B1: catalog, connections, grants, summary

**B1.1 Catalog module.** `control_plane/connector_catalog.py` (pattern:
`tool_skill_catalog.py:20-139`):
- `FEATURED`: the 14 entries in the contract's table, each with `key`, `name`, `publisher`,
  `category`, `description`, `url`, `read_only_by`, optional `read_only_params`
  (`{"read_only": "true"}`, `{"readonly": "true"}`), optional `scope_picker`
  (`{"param", "label", "tool": "list_projects"}`), optional `client` (`"google"`), optional `scope`
  (Google's `.readonly` scope), `access_modes`, `revoke_hint`. `available(entry)` is false for
  `client: "google"` without both Google settings, and for `hubspot`.
- `slim_registry_entry(server_json) -> dict | None`: the snapshot filter. Keep a server only when
  it is `active`, has a remote with a fixed `https://` address (no `{template}`), declares no
  `Payment-Signature` header, is not `ai.smithery/*`. Pick the first `streamable-http` remote, else
  the first `sse`. Output `{key, title, description (≤ 200 chars), website, url, transport,
  headers: [{name, secret, required, template, hint}]}`. No icons (the UI uses letter tiles; no
  third-party image loads).
- `registry()` (`lru_cache`, reads the JSON Lines file on first use, not at import), `search(q,
  category, offset, limit)`, `resolve(key)`, `custom_entry(url, name)`.
- Tests first: `tests/test_connector_catalog.py`: the filter keeps and drops the right fixtures
  (payment header, template-only address, Smithery, deprecated, SSE-only, secret-header template);
  Google cards flip to available when both settings are set (`monkeypatch.setattr(get_settings(),
  …)`); HubSpot is "coming soon"; search and paging; a registry entry on a Featured host is hidden.

**B1.2 Snapshot generator and first snapshot.**
- `scripts/refresh_connector_registry.py`: pages
  `https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&limit=100` by
  `metadata.nextCursor` (about 380 pages, 10 minutes) with stdlib `urllib`; applies
  `slim_registry_entry`; drops any namespace with more than 20 kept servers (link farms); writes
  `backend/tvashtr/control_plane/data/connector_registry.jsonl` sorted by key; prints added,
  removed and changed keys against the previous file.
- **Size cap: 6 MB and 20,000 entries; the script exits non-zero above either.** Expected: about
  15,000 entries, 4–5 MB. The Dockerfile already copies `backend/tvashtr` whole (line 54).
- Test: the filter is covered in B1.1; `tests/test_connector_catalog.py::test_snapshot_loads` reads
  the committed file and checks every line has `key` and an `https://` `url`, and the caps hold.
- Accept: the snapshot is committed; a second run prints an empty diff summary.

**B1.3 Read routes.** `GET /api/connectors/catalog`, `GET /api/connectors`,
`GET /api/connectors/{id}` in `routes/connectors.py` (idiom: `routes/toolkit.py:47-55`).
- Tests first (`tests/test_connectors_api.py`, helpers from `tests/toolkit_helpers.py`): list hides
  `pending`; the catalog marks this account's connections and not another account's; **another
  account's id and a random uuid are 404 on GET** (`fresh_account()`, as
  `test_toolkit_tools_api.py:53-73`); no response ever contains `secret_encrypted`,
  `pending_encrypted`, `state_hash` or a token.

**B1.4 Connect.** `POST /api/connectors`: the key path (header building from the registry
template, check through `connector_upstream.list_tools_sync`), the no-sign-in path, the custom
path, and the hand-off to `connector_oauth.discover`. Slug from the name, de-duplicated per owner
(`-2`, `-3`).
- Tests first: key accepted → `connected` with tools; key rejected → 422 `key_rejected`, no row;
  `key_required`; `already_connected` with the id; `coming_soon`; `invalid_url` (private address);
  custom address without sign-in → `no_signin`; discovery found (patched `discover`) → `pending`
  with `signin_host`; a `pending` row is reused.

**B1.5 Change, check, scope, disconnect.** `PATCH`, `POST …/check`, `GET …/scope-options`,
`DELETE`. `upstream_target(row, access) -> (url, transport)` adds `read_only_params` and the scope
parameter; B3 uses the same function.
- Tests first: `invalid_access` for Google; narrowing and widening; scope set and cleared and
  reflected in `upstream_target`; key replace keeps the old key on rejection; check turns a 401
  into `needs_signin`; scope options parsed from the fake's `list_projects` and `manual: true` on
  junk; delete returns the agent count and strips grants; **404 for another account on each of
  PATCH, check, scope-options and DELETE, with the row untouched**.

**B1.6 Grants.** `GET` and `PUT /api/connectors/{id}/agents`, in `control_plane/connectors.py`,
built on `tool_usage.owner_agent_nodes` (:49) and `tool_usage._select_nodes` (:327); template
`domain_usage.set_domain_agents` (:428-470) and `_with_domains` (fresh dicts so JSONB sees the
change). `subscription` from `domain_usage._connected_subscriptions`.
- Tests first (`tests/test_connector_agents_api.py`): full-set semantics; a kept agent keeps its
  `write`; a new one gets `read`; a foreign agent → 404 `Agent not found.` and nothing written
  (as `test_toolkit_tools_api.py:315-323`); a foreign connection → 404; run-snapshot clones are
  never touched; `used_by` counts.

**B1.7 Summary.** `toolkit.summary` (`control_plane/toolkit.py:734`) gains `connectors` and
`connectors_needing_attention`. Update the two exact-equality assertions in
`tests/test_toolkit_api.py` (:19, :62) first.

## 5. Stream B2: OAuth

All HTTP goes through `connector_net.client()`; metadata is read as plain dicts (pydantic URL types
add a trailing slash and break the issuer comparison). Reuse the pure helpers in
`mcp.client.auth.utils` (`extract_resource_metadata_from_www_auth`, `extract_scope_from_www_auth`,
the two `build_*_discovery_urls`), `mcp.shared.auth_utils.check_resource_allowed` and
`mcp.client.auth.PKCEParameters.generate()`. Do not use `OAuthClientProvider` (it needs in-process
callbacks and skips the `iss` and issuer checks).

**B2.1 Discovery.** `discover(url) -> Discovery | None` per the contract.
- Tests first (`tests/test_connector_oauth.py`, fake via `MockTransport`): header-led discovery;
  well-known fallback when the first request answers 405; root metadata fallback
  (`no_resource_metadata`); path-style issuer order; issuer mismatch rejected; missing S256 →
  `CannotRegister`; resource that doesn't cover the address rejected; a non-https
  `authorization_endpoint` rejected; every fetched address passes through `check_url`.

**B2.2 Client choice and registration.** Pre-registered (Featured + pinned address only) → client
metadata document → dynamic registration (`application_type: "web"`; auth method `none`, else
`client_secret_post`, else `client_secret_basic`) → `CannotRegister`. Reuse a stored registration
when the issuer matches.
- Tests first: each branch; a custom address never gets the Google client even when its metadata
  names `accounts.google.com`; confidential-only server gets a secret; re-registration when the
  issuer changed.

**B2.3 Start.** `POST /api/connectors/{id}/oauth/start` in `routes/connectors_oauth.py`.
- Tests first (`tests/test_connector_oauth_routes.py`): the authorize address has every parameter
  in the contract, `resource` verbatim from the metadata; only `sha256(state)` is stored; status is
  unchanged on a `connected` row; `not_oauth`; **another account → 404**.

**B2.4 Callback, confirm, pages.** The two public routes and three small HTML pages (pattern:
`desktop_auth.return_page()`). Page text is escaped; no provider-supplied text is rendered raw.
- Tests first (`unauth_client` and `client`, as `tests/test_desktop_auth.py`): happy path with the
  owner's session → `connected`, tokens encrypted, tools listed; no session → confirm page, and the
  confirm POST completes; another account's session → nothing stored; unknown, reused and expired
  `state`; `iss` mismatch and missing-but-required `iss`; `error=access_denied` sets `last_error`;
  a failed exchange leaves a working `secret_encrypted` intact on "Sign in again".

**B2.5 Tokens.** `ensure_access_token(connection_id)`, `refresh`, `revoke` (used by B1's delete).
- Tests first: more than 5 minutes left → no network call; refresh rotates and commits the new
  refresh token; a reply without one keeps the old; `invalid_grant` → `needs_signin` and tokens
  cleared; `invalid_client` also drops the registration; 5xx → `Unreachable`, status unchanged; two
  threads calling at once make exactly one refresh request (the row lock).
- `# ponytail:` the refresh call runs while the row is locked (10 s timeout).

**B2.6 Client metadata document.** `GET /oauth/client-metadata.json`; 404 unless
`public_base_url` is https. Test both cases.

**B2.7 Live probe (operator-run, not in `make test`).** `scripts/connector_probe.py`: for every
available Featured entry, run `discover` and the client choice against the real server and print
issuer, client kind and the authorize host; `--register` also performs the registration. Accept:
every available Featured entry reaches an authorize address. An entry that fails is switched to
"Coming soon" before release.

## 6. Stream B3: run time

**B3.1 Run token.** In `connector_proxy.py`: `sign_run_token(run_id, node_id, connection_id,
access)` and `read_run_token(value) -> RunGrant | None` (signature, age, run owner, run not in
`run_views.TERMINAL_STATUSES`, row exists and isn't `pending`).
- Tests first (`tests/test_connector_runtime.py`): round trip; tampered and expired tokens; a
  terminal run; **a token whose run belongs to another account than the connection is refused**; a
  deleted connection.

**B3.2 Run config.** `control_plane/node_tools.py`:
- `build_mcp_config(tool_config, run_id, *, node_id=None)`: the connectors block goes between the
  resolve loop (:185) and the Domains block (:186), following the contract's four steps, with
  `record_resolution_warning(run_id, "connector", name, reason)`.
- Split the base-address part of `domains_mcp_url()` (:84-99) into a shared helper and add
  `connectors_mcp_url()`.
- `control_plane/team_run.py`: pass `node_id=node_id` at :1522; add `N connector(s)` to
  `_tool_names` (:266-279).
- Tests first: no `connectors` key → output identical to today (the existing
  `tests/test_domain_mcp_inject.py` stays green); one grant → one server with the proxy address and
  a token that reads back to the right run, node, connection and access; slug collision →
  `conn-<slug>`; each warning reason; a refused refresh marks the row `needs_signin`; a grant
  pointing at another account's connection is skipped with `it was disconnected`; the Desktop-route
  warning lists connectors.

**B3.3 Proxy core.** `proxy_list_tools(grant)` and `proxy_call_tool(grant, name, arguments)` as
plain async functions taking an injectable upstream (default `connector_upstream`), so they are
tested without HTTP.
- Tests first (`tests/test_connector_proxy.py`, in-memory fake upstream): read access lists only
  annotated reads; write access lists all; a `provider` entry in read mode lists everything and
  calls the read-only address; the row's `access` narrowed mid-run wins over the token; a blocked
  write returns the contract's error and is recorded `blocked`; 401 → one refresh and one retry,
  then `needs_signin` plus a warning; unreachable on list → `[]` plus a warning; descriptions
  capped; `outputSchema` dropped.

**B3.4 Mount.** `tvashtr/mcp/connectors.py`: a `FastMCP` subclass overriding `list_tools` and
`call_tool` (the same override point `_DomainsMCP` uses, `domain_mcp.py:178-195`), reading the
bearer from `self.get_context().request_context.request`. A bad token lists no tools and fails
calls with "This connector isn’t available for this run."
- Test first: the subclass methods called directly with a stub request context (good token, bad
  token, no header). The HTTP path can't be probed on the shared test app (see 0.4); T.2 proves it.

**B3.5 Call events and rounds.**
- `record_call(grant, …)` writes the `connector_call` row: `invocation_id` = latest
  `agent_invocations` row for the run and node; `seq` = next in the `1_000_000_000` band, retried
  on `IntegrityError` (pattern: `run_event_sink.py:26-73`).
- `connector_use(session, run_id, invocation_ids) -> {invocation_id: connectors}` feeds both
  `node_history._run_detail` (:157-235, next to `given`/`produced`) and the invocation dicts of
  `GET /api/runs/{id}/graph` (`routers.py:1865`).
- `recent_use(session, owner_id, connection_id)` replaces the Phase 0 stub.
- Tests first (`tests/test_connector_rounds.py`): counts, writes-first order, the 50 cap with
  `total_calls`, blocked calls left out of counts, `null` for a round without calls, `result_url`
  extraction, two calls in a row get distinct `seq`; **another account's run is 404 on both
  endpoints** (existing `_require_owned_run`, asserted again with connector data present).
- `# ponytail:` the band shares the int `seq` column with the Desktop runner's band; they never
  meet (plan agents get no connectors).

## 7. Stream F1: pages, nav, badges

Reuse the Tools page classes (`tk-head`, `tk-bar`, `tk-cat`, `tk-card`, `tk-crumbs`, `tk-dhead` in
`pages/tools/tools.css`); new rules go in `pages/connectors/connectors.css` with a `cn-` prefix,
tokens only. Helpers live in `.ts` files (eslint `react-refresh/only-export-components` with
`--max-warnings 0`). Tests use `fireEvent`, `mockApi`, `renderWithProviders`.

**F1.1 Routes.** `lib/nav.ts`: `{page: "connectors", view: "connected" | "browse"}` and
`{page: "connector", connectorId}`; `#/toolkit/connectors`, `#/toolkit/connectors/browse`,
`#/toolkit/connectors/<id>`; a bare `#/toolkit` now lands on Connectors (:179-180, :197);
`routeToHash` (:248). Tests first in `lib/nav.test.ts`.

**F1.2 Nav and badges.** `pages/shell/Shell.tsx`: a Connectors leaf first in `toolkitChildren`
(:140-170) with the count and `warn(badges.connectorsToFix, "to fix")`; the Toolkit item links to
Connectors (:277). `lib/workspaceStatus.ts` `NavBadges` (:19-38): `connectors?`,
`connectorsToFix?`. `pages/badgeLoaders.ts` (:28-36) and `lib/api/tools.ts` (:341-366): map the two
new summary fields. Tests first: `pages/shell/Shell.test.tsx`, `lib/api/tools.test.ts`.

**F1.3 Connectors page.** `pages/connectors/ConnectorsPage.tsx` (model: `pages/tools/ToolsPage.tsx`
:257-294): pill tabs Connected and Browse; Connected = table (Connector, Access, Status, Used by,
⋯ menu: Open, Change project, Disconnect), the amber "sign-in expired" banner with "Sign in to
`<name>`", the footer note; Browse = category chips, search box, Featured grid
(`pages/tools/CatalogCard.tsx` pattern), then "From the MCP Registry" with "Show more" paging, the
"not reviewed" label, "Coming soon" cards, the Custom card; a first visit with no connections lands
on Browse. Calls `refreshBadges()` after every mutation.
- Tests first: `ConnectorsPage.test.tsx` (tabs and counts, first-time lands on Browse, banner for
  `needs_signin`, "Coming soon" has no Connect button, search hits `q=`, Show more uses
  `next_offset`).

**F1.4 Connect sheet and sign-in.**
- `pages/connectors/connectSignIn.ts`: the helper from the Desktop map. Web: open the popup
  synchronously (`window.open("", "tv-connect", "popup,width=520,height=720")`), then set its
  location once `authorize_url` arrives. Desktop (`isDesktopApp()`, `lib/desktopRepos.ts:42`):
  no blank popup; `window.open(authorize_url, "tv-external", "noopener")`, which Electron sends to
  the system browser.
- `useConnectSignIn.ts`: poll `GET /api/connectors/{id}` every 2 s until `signin_pending` is false
  (10 minute cap, Cancel, refetch on `focus`/`visibilitychange` like
  `pages/tools/useGithubStatus.ts:69-74`). Never use `popup.closed` as a cancel signal.
- `ConnectSheet.tsx` (DS `Sheet`, steps like `pages/tools/AddToolSheet.tsx`): choose access → wait
  ("Open the window again" / "Open the browser again") → pick a project when there is a
  `scope_picker` (options, or a text field when `manual`) → done toast "Supabase is connected. No
  agent can use it until you turn it on." Key variant: `key_fields` form, "Check and connect",
  inline `key_rejected`. `CustomConnectorSheet.tsx`: address → "Check the server" → the sign-in
  host line (flagged when `signin_host_differs`) → Continue, or the `no_signin` panel with "Add it
  in Tools".
- Tests first: `connectSignIn.test.ts` (web and Desktop branches), `ConnectSheet.test.tsx` (each
  step, each error code, polling ends on `connected` and on `last_error`).

**F1.5 Detail page.** `ConnectorDetailPage.tsx` (model: `pages/tools/ToolDetailPage.tsx` :122-415):
Connection card (project and Change, access and Change, connected date, "Sign in again"), "What
agents can call" (Read / Off · write; a warning when no tool is a read: "This server doesn’t mark
any tool as read-only. Agents can’t call anything until access is Read & write."), Used by with
"Give an agent access", Recent use. Test first: `ConnectorDetailPage.test.tsx`, including the 404
state.

**F1.6 Dialogs.** `GiveAccessDialog.tsx` (copy `pages/tools/TurnOnForAgentsDialog.tsx`: team
picker, ticks, the plan note per `subscription`) on `GET`/`PUT …/agents`; `DisconnectDialog.tsx`
naming the agents from `used_by_agents` and showing `revoke_hint`. Tests first for both.

**F1.7 Mounting.** `pages/Workspace.tsx` (:17-31 imports, :184-222 switch,
`key={route.connectorId}`). Accept F1: every `Cn-Screens` web screen and the `CnF-Connect` and
`CnF-Changes` flows (minus the cut ones) can be walked against a local backend and the fake server.

## 8. Stream F2: drawer, runs, warnings

**F2.1 Config helpers.** `panel/tools/nodeTools.ts`: `connectorsOf(cfg)` and
`setConnectors(cfg, [{id, access}])` beside `setDomains` (:68-73); empty list deletes the key and
`tidy()` (:56-65) still drops an empty `tvashtr`. Tests first in `nodeTools.test.ts`.

**F2.2 Checklist.** `panel/connectors/ConnectorsChecklist.tsx` (copy
`pages/domains/DomainsChecklist.tsx:22-90`): loads `listConnections()`, DS `Checkbox` rows, an
Access `Select` only on rows whose connection is `write`, a `needs_signin` row shows "Sign in
again" linking to Connectors, the plan note when the agent runs on a Claude or Grok plan. Mount it
in `panel/tools/ToolsPanel.tsx` beside `DomainsChecklist` (:110-113). `panel/nodeCounts.ts` (:3-15)
counts grants. `panel/skills/nodeSkills.ts` `desktopSubscriptionNote` (:244-253) mentions
connectors. Saving is the existing `tool_config` patch (`panel/agentDraft.ts`), no new save path.
- Tests first: `ConnectorsChecklist.test.tsx`, `panel/skills/SkillsToolsTab.test.tsx`.

**F2.3 Runs block.** `panel/connectors/ConnectorsUsed.tsx`: chips ("Supabase · 6 reads",
"Linear · 1 write") and the call list (writes first and marked, tool, `arg`, time and duration,
`result_url` as a link, "Show all N calls"). Compose it into the `more` slot in
`panel/runs/RunsTab.tsx` (:118-186) and beside `RoundLedger` in `panel/run/RunNodeDrawer.tsx`
(:326-329). Types: `connectors` on `NodeRound` (`lib/api/nodes.ts:60-81`) and on `NodeInvocation`
(`lib/api.ts:126`). `lib/events.ts`: the Activity feed skips `kind === "connector_call"`.
- Tests first: `ConnectorsUsed.test.tsx`, `panel/runs/RunsTab.test.tsx`, the events test.

**F2.4 Run warning.** `components/RunWarnings.tsx` (:4): a `connector` kind renders "Ran without
`<name>`: `<reason>`." with "Open Connectors". Test first.

**F2.5 Connect from the drawer** (after F1.4). "Connect an app" in the checklist header opens a
dialog with the Featured cards and "Open Connectors"; picking one opens `ConnectSheet`; on success
the new connection is ticked in the draft and the drawer toast says "Neon is connected and ticked
for Reviewer. Save to keep it." Test first.

## 9. Stream D: Desktop

The shipped build already opens the system browser for any non-GitHub address. Two small fixes,
and a release because Desktop bundles the frontend.

**D.1** Move the window-open decision into `desktop/electron/navigationGuard.cjs` as a pure
function and make `main.cjs` (:535-543) use it: a `window.open` with frame name `tv-external`
always goes to `shell.openExternal`, even for a GitHub sign-in address (a connector that signs in
with GitHub would otherwise take over the app window and its callback would be bounced). Test
first: one case in `desktop/scripts/navigation-guard.test.cjs`.

**D.2** `desktop/electron/deepLink.cjs` (:32-37): add `connectors: "/toolkit/connectors"` to
`TOOLKIT`. Test first in `desktop/scripts/deep-link.test.cjs`.

**D.3** Version 0.13.0 in `desktop/package.json`, `npm test`, `npm run build`. Shipping is the
operator's step.

## 10. Stream T: e2e and gates

**T.1 Browser e2e.** `scripts/connectors_e2e.sh` (copy `scripts/secret_gate_e2e.sh`: isolated
ports, its own database, `TVASHTR_AGENT_SANDBOX=local`) starts the fake server on :9911 and the
backend with `TVASHTR_CONNECTORS_ALLOW_LOCAL=1` and `TVASHTR_PUBLIC_BASE_URL=http://localhost:<port>`
(the app itself is opened on `127.0.0.1`, so the callback sees no session cookie and the confirm
page is exercised), then runs `frontend/e2e/connectors.spec.ts`:
`registerFresh` → Toolkit → Connectors lands on Browse → Custom connector → paste
`http://127.0.0.1:9911/mcp` → Check → Continue → in the popup click Allow on the fake page, then
Connect on Tvashtr's confirm page → the sheet moves on by itself → Connected tab shows it Ready,
read only → detail shows `create_thing` as "Off · write" → Give an agent access → the agent's
drawer shows it ticked → Disconnect names the agent. Targeted selectors only (a full snapshot
wedges on the canvas).

**T.2 Run-time check (operator-run, needs one provider key).** `scripts/connectors_run_check.py`
(after `make seed`; LOCAL sandbox): connect the fake server through the API, grant it to a
one-agent team, run with an instruction to call `list_things` and then `create_thing`, poll to the
DBOS workflow terminal, and assert: a `connector_call` for `list_things` (`ok`), one for
`create_thing` (`blocked`), `connectors.used` on the round, and no provider token anywhere in
`run_events`. Repeat on docker mode once to prove the sandbox reaches `/mcp/connectors`.

**T.3 Final gates** (all on the merged `feat/connectors`):
1. `make lint`.
2. Backend: `createdb tvashtr_conn_gate`; `make migrate DATABASE_URL=…`;
   `make test DATABASE_URL=…` as a command-line variable, with no other process importing the app
   on that database; confirm by row counts that the gate database was the one used.
3. Frontend: `npm run test`, `npm run build` (tsc + vite), `npm run lint`.
4. Desktop: `cd desktop && npm test`.
5. `scripts/connectors_e2e.sh`.
6. `scripts/connector_probe.py` against the real providers (network).
7. Parity: not applicable in this round. The Connectors canvas pages are the visual spec for
   F1/F2 and are compared by eye in review; add them to the parity harness when it is next run.
8. `make test` leaves hundreds of fixture runs and wipes provider keys: run `make seed` and clear
   the residue before T.2 or any live gate on a shared database.

## 11. Risks

- **Unreviewed registry servers.** Their tool descriptions enter the agent's context (prompt
  injection) and their annotations are self-declared. Mitigations in v1: "not reviewed" label,
  read-only by default, per-agent opt-in, the proxy filter, the description cap, the outbound
  address guard, the sign-in host shown before continuing. Not a full defence.
- **Annotations missing.** A server that marks nothing read-only exposes no tools in read mode. The
  detail page says so; the user must choose Read & write.
- **Featured entries are verified by metadata only.** Nobody has completed a real sign-in yet.
  B2.7 plus one manual sign-in per provider must happen before release; failures become "Coming
  soon".
- **Supabase and Vercel need a confidential registered client**; the secret can expire
  (`client_secret_expires_at`). That surfaces as `needs_signin` and a fresh registration.
- **Login CSRF.** The session match and the confirm page cover it; on Desktop the confirm page is
  the only protection.
- **Proxy latency.** Each call opens a provider session, and the engine's own MCP timeout can cut
  a slow provider tool before the proxy's 120 s.
- **Snapshot size in git.** 4–5 MB of JSON Lines, growing a little per refresh.
- **`session_secret` rotation** fails the connector calls of runs in flight (the runs continue).
- **Desktop** shows Connectors only after a 0.13.0 release; the 0.12.0 build has no such pages.
- **`build_mcp_config`'s docstring says its signature is frozen.** The change is one optional
  keyword; every existing caller and test is unchanged. Update the docstring.
- **The migration guard hook** (`.claude/hooks/protect-migrations.sh`) only blocks 0001–0041;
  0042 is protected by this plan's rule, not by the hook.

## 12. Needs an operator decision

1. **The proxy** (decision 1 above) changes the wording of decision 7. Build proceeds on it unless
   you object.
2. **HubSpot** has no self-registration. Choose: register one Tvashtr HubSpot app, or let each user
   paste their own app's client id and secret. Until then the card says "Coming soon".
3. **Google** stays "Coming soon" until you set the two environment variables. When you do, the
   redirect address to register is `{TVASHTR_PUBLIC_BASE_URL}/api/connectors/oauth/callback`.
4. **Google Analytics and CleverTap** are not connectors in v1 (they go through Tools). The three
   canvas flows for them and the one-sign-in Google flow are not built.
5. **Production deploy and the Desktop 0.13.0 release** are yours to trigger; `/oauth/client-metadata.json`
   must be reachable on the production origin before Notion, Linear, Sentry, PostHog and Atlassian
   use it (otherwise they fall back to dynamic registration, which also works).
