# Connectors: build plan

Contract: `docs/superpowers/plans/api/connectors.md`. Decisions: `connectors-decisions.md` (§3, §6).
Visual spec: the Claude Design canvas pages **Connectors** (`Cn-Screens`) and **Connectors flows**
(`CnF-Connect`, `CnF-Agents`, `CnF-Changes`). Base: `main` @ 389ab84.

Rules for every task: tests first, then code; APIs only add fields; every new read or write is
owner-scoped (another account gets 404) with a test; migration 0043 is the only migration and
0001–0042 are never edited; no new dependency (httpx, mcp, anyio, itsdangerous and cryptography
are already installed; Phase 0 only raises the `mcp` floor, task 0.2).

## 1. The decisions this plan rests on

1. **The agent never gets the provider's token. It gets a Tvashtr run token and talks to a Tvashtr
   proxy** (`/mcp/connectors`), which adds the provider credential server-side. Decision 7 now says
   this (it first said "put a short-lived provider token in the MCP config"): the stored sign-in
   never leaves the server. It is the one design that fixes all five problems the runtime map
   found:
   - read-only is enforced for real (the agent has a shell; holding the provider token it could
     call write tools directly or drop Supabase's `read_only=true`);
   - a warm sandbox keeps its round-1 MCP config for later rounds, so a one-hour provider token
     would die mid-node; the proxy refreshes on its own;
   - a single failing MCP server stops an agent from starting; the proxy always answers;
   - calls are recorded with the right connector, tool and read/write, with no guessing from
     tool-name prefixes (which change with the number of servers);
   - nothing depends on the agent-server image, and the Fly egress fence only needs the backend.
2. **Read-only mechanism:** the provider's own URL flag where there is one (Supabase `read_only`,
   Neon `readonly`), applied by the proxy so the agent can't remove it. Supabase's flag is trusted
   on its own. **Neon's is not**: under it `run_sql` can still write (decisions §1), so Neon gets
   the flag **and** the annotation filter. Everyone else: the proxy lists and allows only tools
   annotated `readOnlyHint: true` (missing = write). Google uses read-only scopes and is
   read-only-only; it gets the annotation filter as well (`is_write` treats `scopes` like
   `annotations`, see §11 and §12.6). No scope narrowing for other providers in v1.
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
   Also cut, because no contract field carries them: the provider account's name on a connected
   row ("Organization lazyx"; MCP sign-in returns no account name, the scope label stands in), a
   Neon branch picker (only `projectId` is scoped), and the connect sheet's capability bullets
   (the sheet shows the entry's `description`).
8. **Security rules that every stream follows** (contract: OAuth, Tokens, Outbound address rules):
   endpoints of a sign-in must be on the issuer's site (mix-up); the address that was checked is
   the address connected to (IP pinning); only `http(s)` addresses are ever opened or fetched;
   one row lock for every writer of a sign-in; a `state` is used up atomically; only a 401 means
   "sign in again".

## 2. Streams, order and file ownership

Phase 0 (Foundation) is serial, in one worktree, and lands on branch `feat/connectors`. Streams
B1, B2, B3, F1, F2 and D then run in parallel worktrees branched from it. Merge order:
B1 → B2 → B3 → F1 → F2 → D. One task is not parallel: **F2.5 is built after F1 has merged** (it
renders F1.4's `ConnectSheet`, which doesn't exist in F2's worktree until then); F2's worktree
merges `feat/connectors` first, then builds F2.5. Stream T (e2e and gates) runs on the merged
branch.

**As merged (2026-09-30).** B1, B2, B3, F1, F2 and D are merged into `feat/connectors` in that
order, each with `--no-ff`. The one conflict was `backend/tests/test_connector_stubs.py` (B2's
and B3's deletions against B1's): every stub-test deletion in the table below applies. From the
merge on, the contract and this plan have one owner, and the file ownership below is history.
What the merge changed on top of each stream is in that stream's "At the merge" note (§4 to §9).
F2.5 and the wiring listed in §8 are built. Still to build: Stream T (§10).

| Stream | Owns (nobody else edits these) |
|---|---|
| 0 | `alembic/versions/0043_connector_connections.py`, `models.py`, `config.py`, `main.py`, `backend/pyproject.toml`, `backend/uv.lock`, `control_plane/connector_net.py`, `control_plane/connector_upstream.py`, `tests/fake_connector_server.py`, `tests/conftest.py` (one fixture), `frontend/src/lib/api/connectors.ts`. It also writes the first version of the B1–B3 modules listed in 0.6; once Phase 0 lands, each of those belongs to its stream |
| B1 | `control_plane/connector_catalog.py`, `control_plane/data/connector_registry.jsonl`, `scripts/refresh_connector_registry.py`, `control_plane/connectors.py`, `routes/connectors.py`, `control_plane/toolkit.py` (`summary` only) |
| B2 | `control_plane/connector_oauth.py`, `routes/connectors_oauth.py`, `scripts/connector_probe.py` |
| B3 | `control_plane/node_tools.py`, `control_plane/team_run.py` (two edits), `control_plane/connector_proxy.py`, `tvashtr/mcp/connectors.py`, `control_plane/node_history.py`, `routers.py` (run graph invocations only) |
| F1 | `frontend/src/pages/connectors/**`, `lib/nav.ts`, `pages/Workspace.tsx`, `pages/shell/Shell.tsx`, `lib/workspaceStatus.ts`, `pages/badgeLoaders.ts`, `lib/api/tools.ts` (summary fields) |
| F2 | `panel/tools/**`, `panel/connectors/**`, `panel/nodeCounts.ts`, `panel/skills/nodeSkills.ts`, `panel/runs/RunsTab.tsx`, `panel/run/RunNodeDrawer.tsx`, `components/RunWarnings.tsx`, `lib/api/nodes.ts`, `lib/api.ts`, `lib/events.ts` |
| D | `desktop/electron/main.cjs`, `navigationGuard.cjs`, `deepLink.cjs`, `desktop/scripts/*.test.cjs`, `desktop/package.json` |
| T | `frontend/e2e/connectors.spec.ts`, `scripts/connectors_e2e.sh`, `scripts/connectors_proxy_probe.py`, `scripts/connectors_run_check.py` |

No stream but 0 edits `pyproject.toml` or `uv.lock`.

**Cross-stream calls.** Every function one stream calls in another stream's module exists after
Phase 0 (task 0.6) with its final signature and a stub that works, so a stream builds and tests
against the stub and never waits for the stream that fills it. A test that needs the real
behaviour of another stream's function patches it (`monkeypatch.setattr`).

| Signature | After Phase 0 | Filled by | Called by |
|---|---|---|---|
| `connector_catalog.FEATURED`, `available(entry)`, `resolve(key) -> dict \| None` | final for Featured keys | B1.1 adds registry and `custom:` keys to `resolve` | B1, B2.2–B2.4, B3.3 |
| `connector_catalog.is_write(entry, tool, access) -> bool` | final | — | `connectors.serialize`, B3.3, B3.5 |
| `connector_net.check_url`, `client()`, `async_client()`, `site(host)` | final | — | all backend streams |
| `connector_upstream.list_tools`, `call_tool`, `list_tools_sync`, `UpstreamUnauthorized`, `UpstreamRefused`, `UpstreamUnreachable` | final | — | B1.4, B1.5, B2.4, B3.3 |
| `connector_oauth.CannotRegister`, `SignInRefused`, `Unreachable`, `Discovery` (fields: `issuer`, `authorization_endpoint`, `token_endpoint`, `resource`, `registration_endpoint`, `revocation_endpoint`, `scope`, `iss_supported`, `cimd_supported`, `token_auth_methods`; property `signin_host`) | final | — | B1.4, B1.5, B3.2, B3.3 |
| `connector_oauth.discover(url, entry=None) -> Discovery \| None` | returns `None` | B2.1 | B1.4 |
| `connector_oauth.ensure_access_token(connection_id, *, rejected=None) -> str` | returns the stored token, never refreshes (`SignInRefused` when the row or the token is gone) | B2.5 | `connectors.upstream_headers` (B1.5 check and scope-options, B2.4, B3.3), B3.2 |
| `connector_oauth.revoke(connection_id) -> bool` | returns `False` | B2.5 | B1.5 DELETE |
| `connectors.get_owned`, `read_secret(row, *, pending=False)`, `write_secret(row, value, *, pending=False)` (`pending=True` is `pending_encrypted`), `serialize(row, users=None)` (`users` = the usage rows behind `used_by`), `upstream_headers(row, *, rejected=None) -> dict` | final | — | B1, B2, B3 |
| `connectors.stored_tools(tools) -> list[dict]` (the SDK's `Tool` list → the stored `{"name","title","read_only"}`) | final | — | B1.4, B1.5, B2.4, B3.3 |
| `connectors.list_connections(owner_id) -> list[dict]` | lists with empty usage | B1.3 adds `used_by` and `used_by_agents` | `routes/connectors.py` |
| `connectors.upstream_target(row, access) -> (url, transport)` | returns the row's `url` and `transport` | B1.5 | B1.5, B2.4, B3.3 |
| `connector_proxy.recent_use(session, owner_id, connection_id) -> list` | returns `[]` | B3.5 | B1.3 |

Three helpers joined the shared list after Phase 0, all in `connectors.py`:
`provider_slot(owner_id)` (the cap on requests that wait on a provider; B1's review),
`secret_or_none(row, *, pending=False)` (`read_secret` that reads a column it can't decrypt as
empty; public since the merge) and `SIGN_IN_GONE` (`last_error` by `auth_kind`; the proxy uses it
since the merge).

**A stub's test goes with the stub.** Phase 0 asserts what each stub answers, so the stream that
fills a stub turns that test red. "Never weaken an existing assertion" doesn't cover these seven:
the task that fills the stub **deletes (or, where noted, rewrites) its stub test in the same
commit** as its own tests, which replace it. Every other Phase 0 test stays as it is. Each stub
test carries a comment naming its owner.

| Phase 0 test | Task that removes it | Replaced by |
|---|---|---|
| `test_connector_catalog.py::test_resolve_finds_featured_keys_only_for_now` | B1.1 | rewritten there: Featured keys still resolve, `""`, `None` and `7` still don't; a registry name and a `custom:` key now do |
| `test_connector_stubs.py::test_upstream_target_is_the_rows_own_address` | B1.5 | B1.5's `upstream_target` tests (scope and read-only parameters) |
| `test_connector_stubs.py::test_discover_finds_nothing_yet` | B2.1 | `tests/test_connector_oauth.py` (discovery) |
| `test_connector_stubs.py::test_ensure_access_token_returns_the_stored_token_and_never_refreshes` | B2.5 | B2.5's token tests (it keeps `…refuses_a_row_that_is_gone_or_has_no_token`, which stays true) |
| `test_connector_stubs.py::test_revoke_says_nothing_was_revoked` | B2.5 | B2.5's revoke tests |
| `test_connector_stubs.py::test_the_proxy_server_is_stateless_has_no_tools_yet_and_accepts_any_host` | B3.4 | only its last line (`list_tools() == []`) goes; the settings assertions stay, and B3.4's subclass tests cover listing |
| `test_connector_stubs.py::test_recent_use_is_empty` | B3.5 | `tests/test_connector_rounds.py` (`recent_use`) |

One cross-stream component: F2.5 uses F1.4's `ConnectSheet`, which is why F2.5 waits for the F1
merge.

Worktrees: reuse the stale `.claude/worktrees/connectors` (it points at 389ab84) for Phase 0. Each
backend stream uses its own database (`createdb tvashtr_conn_<stream>`), passed as a command-line
variable: `make migrate DATABASE_URL=…`, `make test DATABASE_URL=…` (the Makefile's `include .env`
beats an exported variable; prove the database by row counts). A fresh worktree's venv has no
test tools: run `cd backend && uv sync --extra dev` once (a bare `uv run pytest` otherwise picks up
a system pytest and fails on `import sqlalchemy`). A targeted run is
`cd backend && DATABASE_URL=… uv run pytest tests/<file>` (an environment variable beats `.env`
there; proven by row counts in Phase 0).

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

**0.2 Settings and the dependency floor.**
- `backend/tvashtr/config.py` (by `public_base_url`, :539): the contract's three fields. Covered by
  0.3's test.
- `backend/pyproject.toml` (:24) says `mcp>=1.0`, but this plan needs
  `streamable_http_client(http_client=…)` and `mcp.client.auth.utils`, which the locked 1.27.2 has
  and 1.0 doesn't. Set `mcp>=1.27` and run `uv lock`; the lock's diff must move no version.
  Phase 0 is the only stream that edits `pyproject.toml` or `uv.lock`.

**0.3 Outbound address guard and the two HTTP clients.** Create `control_plane/connector_net.py`:
- `check_url(url) -> str` (raises `UnsafeUrl`): the contract's scheme and address rules. The
  address test is `ipaddress.ip_address(a).is_global` (and not multicast) on every resolved
  address; an IPv4-mapped or NAT64 (`64:ff9b::/96`) IPv6 address is judged by the IPv4 address
  inside it, and any other IPv6 address must be in `2000::/3`. An address with a space, a control
  character, a backslash or a user name in it is refused before it is parsed (Python and a
  browser read a different host out of `https://a\@b/`).
- `client(timeout=10.0, headers=None) -> httpx.Client` and
  `async_client(timeout=10.0, headers=None) -> httpx.AsyncClient`, both `follow_redirects=False`
  and both on a **pinning transport**: it resolves the request's host once (kept for the client's
  life), applies the same address test, then sends the request to the validated IP with the `Host`
  header kept and `request.extensions["sni_hostname"]` set to the name (httpcore uses it for the
  TLS server name, so the certificate is checked against the name). The async one resolves in a
  thread. The transport wraps an inner transport per host (a pooled connection is never reused
  for another name on the same IP), built by `connector_net._inner()` / `_async_inner()`
  (default `httpx.HTTPTransport` / `httpx.AsyncHTTPTransport`): a test replaces those two with a
  `MockTransport` and reads what arrives. The pinning transport itself refuses a non-`https`
  request and a non-public address, so a caller that forgot `check_url` is still safe. It sends
  a copy of the request, so `response.url` still shows the host name. Under
  `connectors_allow_local` the clients use the plain transport, so `localhost` keeps working.
  Both clients set `trust_env=False` (no proxy or `.netrc` from the environment).
- `site(host) -> str`: the contract's "same site" rule. An IP address is its own site (the whole
  host), so two addresses that share their last two numbers never match.
- `client` and `async_client` are the seams tests replace (`monkeypatch.setattr(connector_net,
  "client", …)` returning `httpx.Client(transport=httpx.MockTransport(fake.handle))`, and the same
  for `async_client`). No other module builds an httpx client for connector traffic.
- **What comes back is bounded** (added by the Phase 0 review). Both clients send
  `Accept-Encoding: identity`, and the pinning transports raise `UnsafeResponse` (an
  `httpx.TransportError`, so B2 treats it like any other "didn't answer") for an answer that
  carries a `Content-Encoding`. The sync transport reads the whole answer on a helper thread: at
  most `BODY_LIMIT` (1 MB), and within one deadline for the whole exchange (the client's
  `timeout`; httpx's own is per read), so `client()` answers are never streams. The async
  transport keeps the stream (server-sent events) and cuts it off at `MCP_BODY_LIMIT` (10 MB).
  A `MockTransport` client put in through the `client` / `async_client` seam has none of this;
  tests of the limits replace `_inner` / `_async_inner` instead.
- Test first: `tests/test_connector_net.py` (patch `connector_net._getaddrinfo`, never
  `socket.getaddrinfo`: that one is the whole process's resolver and psycopg uses it):
  - `http://`, `javascript:` and `file:` refused; a public address passes;
  - hosts resolving to `127.0.0.1`, `10.0.0.5`, `169.254.169.254`, `fdaa::1`, `0.0.0.0`, `::1`,
    `::ffff:10.0.0.1` and `100.64.0.1` refused; a host with one public and one private address
    refused;
  - **rebinding**: `getaddrinfo` answers a public address on the first call and `10.0.0.5` on the
    second. A request through `client()` and one through `async_client()` each reach the inner
    transport addressed to the public IP, with `Host` and `sni_hostname` equal to the name, and
    `getaddrinfo` ran once per client;
  - `connectors_allow_local` allows `http://` and `127.0.0.1` and still refuses `javascript:`;
    with `hosted_mode` on it lifts nothing;
  - `site()`: `api.supabase.com` and `mcp.supabase.com` match; `a.vercel.app` and `b.vercel.app`
    don't; `auth.acme.co.uk` and `evil.co.uk` don't;
  - no other `connector*.py` under `tvashtr/` contains `httpx.Client(` or `httpx.AsyncClient(`.
- `# ponytail:` `site()` is a short built-in rule, not the Public Suffix List. Swap in a PSL
  library when an unlisted shared suffix turns up.

**0.4 Fake OAuth MCP server.** Create `backend/tests/fake_connector_server.py`:
- `FakeConnectorServer(base_url, **knobs)` with `handle(httpx.Request) -> httpx.Response` covering
  protected-resource metadata, authorization-server metadata, `/register`, `/authorize`, `/token`
  (code and refresh grants) and `/revoke`. Knobs: `dcr`, `cimd`, `iss`, `confidential`,
  `expires_in`, `rotate_refresh`, `fail_refresh`, `path_issuer`, `no_resource_metadata`,
  `no_pkce`, `mixup` (the metadata names another site's authorize endpoint). It records every
  request for assertions.
- `app()`: a Starlette app with the same routes, an `/authorize` page with one "Allow" button, and
  `/mcp` (mcp SDK `FastMCP`, bearer required; the same server is also on `/sse` for the SSE
  transport) with tools `list_things`, `get_thing` and `list_projects` (`readOnlyHint: true`) and
  `create_thing` (no annotation). `handle()` answers `/mcp` with the 401 challenge (or 403 to
  `forbidden`) and doesn't speak MCP; use the subprocess for that. Besides the tokens
  it issued, `/mcp` accepts the fixed bearer `fake-static-token` (the key path and the T.1
  probe) and answers 403 to the bearer `forbidden`.
- `python backend/tests/fake_connector_server.py --port 9911` serves it with uvicorn.
- `tests/conftest.py`: one session fixture `fake_connector_url` that starts it as a **subprocess**
  on a free port and yields its MCP address (`http://127.0.0.1:<port>/mcp`; the sign-in routes are
  on the same origin). A test that reaches it through `connector_net` turns
  `connectors_allow_local` on and `hosted_mode` off first (the repo `.env` sets hosted mode). Never mount it on the shared app (`test_domain_mcp_http.py:8-10`: probing a
  streamable-HTTP mount through the shared TestClient tears down the DBOS lifespan).
- Test first: `tests/test_fake_connector_server.py`: `handle()` serves both metadata documents; the
  subprocess lists four tools with a bearer and answers 401 without.

**0.5 Provider MCP client.** Create `control_plane/connector_upstream.py`: async
`list_tools(url, transport, headers, timeout=10)` and `call_tool(url, transport, headers, name,
arguments, timeout=120)`, on `ClientSession`. The HTTP client always comes from
`connector_net.async_client(timeout, headers)`: passed as `http_client=` to
`mcp.client.streamable_http.streamable_http_client`, and through `httpx_client_factory=` to
`mcp.client.sse.sse_client` (whose default factory would go around the guard). Every open also
calls `connector_net.check_url` (in a worker thread: it resolves the host, and the proxy calls
this module on the server's event loop), so a bad address fails before any connection. `list_tools_sync`
wraps with `asyncio.run` for the sync routes.
- Errors: `UpstreamUnauthorized` (**401 only**, the one status that means "sign in again"),
  `UpstreamRefused(status)` (any other 4xx, 403 included), `UpstreamUnreachable` (network error,
  timeout, 5xx, and an address `check_url` refuses). The status is read from the HTTP answer
  itself (a response hook on the client), not from how the SDK wraps it. A provider that answers
  200 with a JSON-RPC error raises the SDK's `McpError` unchanged, and a failing tool is a result
  with `isError`. Each call is bounded by its `timeout` as a whole (`anyio.fail_after`).
  `list_tools` follows `nextCursor` and returns the SDK's `Tool` objects; `connectors.stored_tools`
  turns them into the stored shape.
- Test first: `tests/test_connector_upstream.py` against `fake_connector_url`: list and call with a
  bearer; no bearer → `UpstreamUnauthorized`; the bearer `forbidden` → `UpstreamRefused`, not
  `UpstreamUnauthorized`; a closed port → `UpstreamUnreachable`; both transports get their client
  from `connector_net.async_client` (patched to count).
- `# ponytail:` one provider session per call (an extra initialize round trip); pool per run and
  connection if latency shows up.

**0.6 Skeletons, shared signatures and registration.** After this task every name in §2's
cross-stream table can be imported with its final signature.
- `control_plane/connector_catalog.py`, final for Featured (pattern: `tool_skill_catalog.py:20-139`):
  - `FEATURED`: the 14 entries in the contract's table, each with `key`, `name`, `publisher`,
    `category`, `description`, `url`, `read_only_by`, optional `read_only_params`
    (`{"read_only": "true"}` for Supabase, `{"readonly": "true"}` for Neon, whose `read_only_by`
    is still `annotations`), optional `scope_picker` (`{"param", "label", "tool":
    "list_projects"}`), optional `client` (`"google"`), optional `scope` (Google's `.readonly`
    scope), optional `oauth_hosts` (extra endpoint hosts for the mix-up check; Google:
    `accounts.google.com`, `oauth2.googleapis.com`), `access_modes`, `revoke_hint`, and
    `featured: True`.
  - `available(entry)`: false for `client: "google"` without both Google settings, and for an
    entry marked `coming_soon: True` (HubSpot; B2.7 marks any entry that fails the probe). Each
    entry also carries `website`, `transport`, `auth: "oauth"` and `key_fields: []`, and
    `CATEGORIES` lists the five categories in order.
  - `resolve(key) -> dict | None`: Featured keys here; B1.1 adds registry and `custom:` keys.
  - `is_write(entry, tool, access) -> bool`: the contract's "Read or write" rule. `tool` is a
    stored `{"name", "title", "read_only"}`.
  - Tests first: `tests/test_connector_catalog.py`: the 14 keys, addresses and categories match
    the contract's table; Google cards flip to available when both settings are set
    (`monkeypatch.setattr(get_settings(), …)`); HubSpot is "coming soon"; `is_write`: Supabase in
    read mode counts every tool as a read; **Neon in read mode counts an unannotated `run_sql` as
    a write**; an `annotations` entry counts a missing annotation as a write; access `write`
    follows the annotation everywhere.
- `control_plane/connectors.py`: `ConnectorError(status_code, detail)`,
  `get_owned(session, owner_id, connection_id, *, for_update=False)` using `node_library._as_uuid`
  (`for_update` is the contract's one row lock), `read_secret`, `write_secret` (both take
  `pending=True` for the sign-in in flight), `stored_tools`, `serialize(row, users=None)`
  (`signin_host` and `signin_pending` are read from the two encrypted blobs, see the contract),
  `list_connections(owner_id)`,
  `upstream_headers(row, *, rejected=None) -> dict` (final: the key's stored headers, or
  `Authorization: Bearer` + `connector_oauth.ensure_access_token`, or `{}`), and
  `upstream_target(row, access) -> (url, transport)` (stub: the row's own `url` and `transport`;
  B1.5 adds the parameters).
- `control_plane/connector_oauth.py`: `CannotRegister`, `SignInRefused`, `Unreachable` and the
  `Discovery` dataclass (final); stubs `discover(url, entry=None) -> Discovery | None` (returns
  `None`), `ensure_access_token(connection_id, *, rejected=None) -> str` (returns the stored access
  token, never refreshes) and `revoke(connection_id) -> bool` (returns `False`).
- `control_plane/connector_proxy.py`: `recent_use(session, owner_id, connection_id) -> list` stub
  returning `[]`.
- `routes/connectors.py` (`router`), `routes/connectors_oauth.py` (`router`, `public_router`),
  `tvashtr/mcp/connectors.py` (`get_connectors_mcp()`: mcp SDK `FastMCP("tvashtr-connectors",
  stateless_http=True, json_response=True, streamable_http_path="/")`, no tools yet). FastMCP's
  default for a localhost-bound server answers **421** to any `Host` that isn't localhost, and
  agents reach the proxy by the public host or the docker host. Phase 0 switched the check off
  (`enable_dns_rebinding_protection=False`); since the Domains fix it is on with an explicit
  list, `tvashtr.mcp.agent_transport_security()`: the host of `public_base_url`, the docker host
  (`litellm_proxy_host_docker`) and localhost, each with or without a port, and no `Origin` (a
  request that carries one gets 403). Both mounts use it.
- `main.py`: import both route modules (:43-53); add both `router`s to the authenticated tuple
  (:130-141); include `connectors_oauth.public_router` bare next to the other public routers
  (:122-124); build the proxy app like Domains (:59-61), enter its lifespan inside `_lifespan`
  (:81) and mount `/mcp/connectors` beside `/mcp/domains` (:379-380) with
  `mount_connectors_mcp(app, http_app)` (`tvashtr/mcp/connectors.py`), which adds a route for the
  exact path as well as the mount. A mount alone only matches `/mcp/connectors/…`: the address
  agents are given has no trailing slash, and it answered 307 locally and **405** behind the SPA
  catch-all (the hosted image), so every connector would have failed in production with every
  local gate green. `tests/test_connectors_api.py` probes both forms in a subprocess, behind a
  catch-all and with a public `Host`, and checks that `_lifespan` starts the session manager.
- Tests first: `tests/test_connectors_api.py::test_list_is_empty_and_needs_a_session`
  (`{"connections": []}`; 401 with `unauth_client`); `tests/test_connector_stubs.py`: every name in
  §2's table imports, and each stub answers what the table says.

**0.7 Frontend API client.** Create `frontend/src/lib/api/connectors.ts` in the shape of
`lib/api/tools.ts` (validators :16-41, `apiRequest` from `lib/api/runs.ts:44-77`): types
`CatalogEntry`, `Connection`, `ConnectorTool`, `ConnectorAgentsByTeam`, `RoundConnectors` (with
`skipped`), and one
function per contract route. Create `pages/connectors/connectorsTestUtils.ts` with `entry()` and
`connection()` fixtures. Also exported for the streams: `connectorRefusal(e)` (the `{code,
message, connection_id, fields}` of a refusal), `parseRoundConnectors(raw)` (F2 calls it from
`lib/api/nodes.ts` and `lib/api.ts`), `parseConnection` and `parseCatalogEntry`.
**`parseRoundConnectors`, `RoundConnectors` and `ConnectorCall` live in
`lib/api/roundConnectors.ts`, a module that imports nothing, and `lib/api.ts` must import them
from there, never from `lib/api/connectors.ts`**: `connectors.ts` imports `./runs`, whose
`ApiDetailError` extends `ApiError` from `lib/api.ts` at load, so that value import is a cycle
that throws "Class extends value undefined" for any entry that loads `lib/api.ts` first (tsc and
`vite build` don't catch it; `lib/api/roundConnectors.test.ts` does). `connectors.ts` re-exports
the three for everyone else. Two rules live in the client so no page has to remember them:
`startSignIn` throws on an `authorize_url` that isn't `http(s)`, that carries a user name, or
whose host (read with `new URL`, as the browser reads it) isn't the server's `signin_host` (F1.4
still checks before it opens the window), and the app's own 502 (`unreachable`, `refused`) is not reported to the header as "can't reach the backend"
(`apiRequest` marks every 502 that way; the client calls `reportFetchOk()` when the 502 carries a
`code`). A `website` or `result_url` that isn't `https://` is read as `null`.
- Test first: `lib/api/connectors.test.ts` with `mockApi` (`pages/tools/toolsTestUtils.tsx:26-58`):
  each call hits the right method and path and a malformed answer throws.

Accept Phase 0: backend suite, `npm run test`, `npm run build`, `npm run lint` green on
`feat/connectors`; `GET /api/connectors` answers.

## 4. Stream B1: catalog, connections, grants, summary

**B1.1 Catalog module: registry, search, custom.** `control_plane/connector_catalog.py` already
holds `FEATURED`, `available`, `resolve` and `is_write` from Phase 0 (0.6). B1 adds:
- `slim_registry_entry(server_json) -> dict | None`: the snapshot filter. Keep a server only when
  it is `active`, has a remote with a fixed `https://` address (no `{template}`), declares no
  `Payment-Signature` header, is not `ai.smithery/*`. Pick the first `streamable-http` remote, else
  the first `sse`. Output `{key, title, description (≤ 200 chars), website, url, transport,
  headers: [{name, secret, required, template, hint}]}`.
  - `website` is kept only when it is an `https://` address, else `null` (it becomes a link).
  - A header declaration named `Host`, `Cookie`, `Content-Length` or `Transfer-Encoding` (any case)
    is dropped: a registry entry must not set those on Tvashtr's requests. As built, so are
    `Accept`, `Accept-Encoding`, `Content-Type` and `Connection` (they would break the MCP client
    or the response limits of `connector_net`), and a name that isn't an HTTP token.
  - `template` is kept only when the registry's `value` has exactly one `{placeholder}`
    (`Bearer {api_key}`). A fixed value (`Bearer ak_YOUR_KEY`) is the publisher's example, and a
    two-part one (`{public}:{private}`, one server) can't be filled from one field: both are
    `null`, and the user types the whole header value.
  - `secret` is true when the header or one of its `variables` is `isSecret`.
  - A server name that doesn't match the registry's own `namespace/name` rule is dropped, so a
    registry key can never look like a Featured key or a `custom:` key.
  - No icons (the UI uses letter tiles; no third-party image loads).
- `registry()` (`lru_cache`, reads the JSON Lines file on first use, not at import), `search(q,
  category, offset, limit)`, `custom_entry(url, name)`, and `resolve(key)` extended to registry and
  `custom:` keys (`featured: False`).
  - As built: a registry entry with no `title` is named after its server name without the MCP
    boilerplate (`com.apify/apify-mcp-server` → "Apify"), and its `publisher` is its verified
    namespace read as a domain (`apify.com`, `github.com/getsentry`).
  - As built: `card(entry)` (the catalog route's shape) and `header_value(declaration, value)`
    (a key as the header it is sent as) live here too.
- Tests first: `tests/test_connector_catalog.py` (added to the Phase 0 file): the filter keeps and
  drops the right fixtures (payment header, template-only address, Smithery, deprecated, SSE-only,
  secret-header template, a `javascript:` website → `null`, a `Host` header declaration dropped);
  search and paging; a registry entry on a Featured host is hidden; `resolve` finds a registry key
  and a custom key and marks neither `featured`.

**B1.2 Snapshot generator and first snapshot.**
- `scripts/refresh_connector_registry.py` (run as
  `cd backend && uv run python ../scripts/refresh_connector_registry.py`): pages
  `https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&limit=100` by
  `metadata.nextCursor` (about 380 pages, 10 minutes) with stdlib `urllib`; applies
  `slim_registry_entry`; drops any namespace with more than 20 kept servers (link farms); writes
  `backend/tvashtr/control_plane/data/connector_registry.jsonl` sorted by key; prints added,
  removed and changed keys against the previous file.
- **Size cap: 6 MB and 20,000 entries; the script exits non-zero above either.** Expected: about
  15,000 entries, 4–5 MB. The Dockerfile already copies `backend/tvashtr` whole (line 54).
- Test: the filter is covered in B1.1; `test_snapshot_loads` reads the committed file and checks
  every line has `key` and an `https://` `url`, and the caps hold. As built it is in
  `tests/test_connector_registry_refresh.py`, next to the tests of the script's own rules (the
  crawl is replaced by a list of pages, no network).
- Accept: the snapshot is committed; a second run prints an empty diff summary.
- **As found on 2026-09-30:** the registry is slower than the probe said. About one request in
  ten never answers, a page can stay that way for a minute or two, and a small `limit` with
  `version=latest` times out every time. The script waits 15 s for a page and tries it 8 times
  with a growing pause, so a crawl is 376 pages and about 20 minutes, not 10. The first snapshot:
  37,625 servers read, 15,058 kept, 4.91 MB. A crawl that gives up writes nothing. A second
  run 35 minutes later printed `added 9, removed 1, changed 6` (the registry's own edits in
  between; 22 changed lines of 15,058), so "an empty diff summary" holds only for an unchanged
  registry, which `test_summary_names_added_removed_and_changed_keys…` checks without a network.

**B1.3 Read routes.** `GET /api/connectors/catalog`, `GET /api/connectors`,
`GET /api/connectors/{id}` in `routes/connectors.py` (idiom: `routes/toolkit.py:47-55`).
- As built: `tests/connector_helpers.py` holds the shared helpers, and
  `tests/connector_fixtures.py` two fixtures (`registry_file`: a snapshot made of given registry
  items; `local_addresses`: lets `connector_net` open the fake server). A test module that uses
  them says `pytest_plugins = ["connector_fixtures"]` (`tests/conftest.py` is not B1's to edit).
- Tests first (`tests/test_connectors_api.py`, helpers from `tests/toolkit_helpers.py`): list hides
  `pending`; the catalog marks this account's connections and not another account's; **another
  account's id and a random uuid are 404 on GET** (`fresh_account()`, as
  `test_toolkit_tools_api.py:53-73`); no response ever contains `secret_encrypted`,
  `pending_encrypted`, `state_hash` or a token; a `needs_signin` list row carries
  `used_by_agents`, a `connected` one has `null`.

**B1.4 Connect.** `POST /api/connectors`: the key path (header building from the registry
template, check through `connector_upstream.list_tools_sync`), the no-sign-in path, the custom
path, and the hand-off to `connector_oauth.discover`. Slug from the name, de-duplicated per owner
(`-2`, `-3`). When discovery finds a sign-in, its fields are written to `pending_encrypted`
(`connectors.write_secret(row, {…}, pending=True)`, no `started_at`, `state_hash` left null):
that is where `serialize` reads `signin_host` from before `oauth/start` has run.
- As built: tests are in `tests/test_connectors_connect.py`. A provider answer that is neither a
  tool list nor a 401/403 (another 4xx, a JSON-RPC error) is `unreachable`. A custom address
  with no sign-in is refused without asking it for its tools. A key value must be printable
  ASCII of at most 4,096 characters (`invalid_key` otherwise); that covers the line-break rule.
- Tests first: key accepted → `connected` with tools; key rejected → 422 `key_rejected`, no row;
  `key_required`; `already_connected` with the id; `coming_soon`; `invalid_url` (private address);
  custom address without sign-in → `no_signin`; discovery found (patched `discover`) → `pending`
  with `signin_host`; a `pending` row is reused; a `credentials` id that isn't one of the
  entry's `key_fields` → 422 `invalid_key`; a value with `\r` or `\n` → `invalid_key`; the fake
  answering 403 to the key → `key_rejected`; nothing stored in all three.

**B1.5 Change, check, scope, disconnect.** `PATCH`, `POST …/check`, `GET …/scope-options`,
`DELETE`.
- `upstream_target(row, access) -> (url, transport)` replaces the Phase 0 stub: the row's `url`,
  plus the scope parameter, plus the entry's `read_only_params` when `access` is `read` (every
  entry that has them, Neon included). Built with `urllib.parse.urlencode`; a same-named parameter
  already in the address is replaced; the read-only parameter goes last. B2.4 and B3.3 call the
  same function.
- `scope.value` must match `^[A-Za-z0-9_.-]{1,80}$` (422 `invalid_scope`). `credentials` follow
  B1.4's rules.
- `PATCH` credentials and `DELETE` load the row with `get_owned(…, for_update=True)` (the
  contract's one-lock rule). `DELETE` calls `connector_oauth.revoke` first, best effort.
- check and scope-options take their headers from `connectors.upstream_headers(row)`.
  `UpstreamUnauthorized` (401) or `SignInRefused` → `needs_signin`; `UpstreamRefused` (403) → 502
  `refused`, status unchanged.
- As built (tests in `tests/test_connectors_change.py`):
  - check gives an OAuth connection one refresh and one retry on a 401
    (`upstream_headers(row, rejected=<the refused token>)`), as the proxy does, before it says
    `needs_signin`. A key connection's `last_error` is "Its key stopped working."
  - check and scope-options on a `pending` row are 409 `not_connected` (there is no sign-in to
    use, and B2's `ensure_access_token` would mark the row `needs_signin`).
  - scope-options answers `manual: true` for a 401, a 403 or a JSON-RPC error from the project
    tool as well as for an answer it can't read; only a provider that doesn't answer is 502.
  - `PATCH` checks every field before it writes anything. A bad `name` is 422 `invalid_name`.
    It does not list the tools again: after an access or scope change the stored `tools` are
    the ones last listed, until the next check.
- Tests first: `invalid_access` for Google; narrowing and widening; scope set and cleared and
  reflected in `upstream_target`; a scope value of `x&read_only=false` → 422 `invalid_scope`; in
  `upstream_target` the read-only parameter is last and appears once, also when the row's `url`
  already has one; a Neon row in read mode gets `readonly=true`; key replace keeps the old key on
  rejection; check turns a 401 into `needs_signin` and leaves the status alone on a 403; scope
  options parsed from the fake's `list_projects` and `manual: true` on junk; delete returns the
  agent count and strips grants; **404 for another account on each of PATCH, check, scope-options
  and DELETE, with the row untouched**.

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

**B1 after review** (each is in the contract's Catalog and Connections sections):
- The snapshot's lines end at a line feed only (a U+2028 in a description can't break one), a
  malformed registry item is dropped instead of raising, and a server that declares a payment,
  wallet or private-key header on any remote is left out (13 entries left the first snapshot:
  15,045 lines, catalog total 15,051).
- A registry address must be ASCII with no trailing dot on the host, and a registry entry with
  a Featured connector's name is shown as `Name (publisher)`.
- `connectors.provider_slot(owner_id)`: connect, a new key, check and scope-options wait on a
  provider in a worker thread, so at most 4 of one account's and 12 of everyone's do at once; the
  next is a 429 `busy`. Disconnect is never refused (it skips the revoke).
- A key can be replaced after the catalog stops listing its connector (the stored header names
  stand in for `key_fields`).
- A connection with no sign-in that gets a 401 says "It now asks for a sign-in. Disconnect it and
  connect it again."
- A sign-in or key that can't be decrypted no longer breaks the list; check reads it as gone.
- check doesn't mark a sign-in that was replaced while the provider answered.
- `PUT …/agents` and `DELETE` lock the agent nodes (in id order) and `PUT …/agents` takes the
  connection's row lock, so neither writes back what the other removed.
- A slug taken by a connect at the same moment gets the next one, not `already_connected`.
- Names and scope labels keep only printable characters; `tools` is at most 500 items with names
  and titles cut at 200; scope options are cut at 120 characters and survive a deeply nested
  answer; the provider address is read only unless the access is exactly `write`.

**B1 at the merge:**
- The three Google entries carry `authorize_params` (`access_type=offline`, `prompt=consent`),
  which B2.3 reads.
- Until a connection is connected its slug follows its name: `POST` on a `pending` row takes the
  name given now, and `PATCH name` on one takes a new slug (F1's custom sheet names a connector
  after the check, and now sends the name before the sign-in).
- `upstream_headers` raises `SignInRefused` for a key that can't be decrypted, so check and the
  proxy both read it as a key that stopped working.
- B2 asked for `check_url` before `discover` (discovery reports a refused address as
  `unreachable`). B1.4 already did that for a custom address, spelled either way
  (`test_invalid_url`, `test_a_custom_key_is_checked_like_a_custom_address`). A catalog entry's
  own address that Tvashtr won't open stays `unreachable`: nobody typed it.
- F1's two assumptions hold and are pinned: a registry entry's `name` is a display name and its
  `key` the registry name, and every Featured entry is on the catalog's first page
  (`test_every_featured_entry_fits_on_the_first_page`).
- `make connectors-registry` runs the snapshot script.

## 5. Stream B2: OAuth

All HTTP goes through `connector_net.client()`; metadata is read as plain dicts (pydantic URL types
add a trailing slash and break the issuer comparison). Reuse the pure helpers in
`mcp.client.auth.utils` (`extract_resource_metadata_from_www_auth`, `extract_scope_from_www_auth`,
the two `build_*_discovery_urls`), `mcp.shared.auth_utils.check_resource_allowed` and
`mcp.client.auth.PKCEParameters.generate()`. Do not use `OAuthClientProvider` (it needs in-process
callbacks and skips the `iss` and issuer checks).

**B2.1 Discovery.** `discover(url, entry=None) -> Discovery | None` per the contract, mix-up check
included (`entry` carries a Featured entry's `oauth_hosts`).
- Tests first (`tests/test_connector_oauth.py`, fake via `MockTransport`): header-led discovery;
  well-known fallback when the first request answers 405; root metadata fallback
  (`no_resource_metadata`); path-style issuer order; issuer mismatch rejected; missing S256 →
  `CannotRegister`; resource that doesn't cover the address rejected; a non-https
  `authorization_endpoint` rejected; every fetched address passes through `check_url`;
  **mix-up**: metadata whose `authorization_endpoint`, `token_endpoint` or
  `registration_endpoint` is on another site than the issuer → `CannotRegister` (the fake's
  `mixup` knob, one case per endpoint); a `revocation_endpoint` on another site is dropped, not
  fatal; a Featured entry passes for exactly its `oauth_hosts`; a custom address whose metadata
  copies Google's endpoints does not.

**B2.2 Client choice and registration.** Pre-registered (Featured + pinned address only) → client
metadata document → dynamic registration (`application_type: "web"`; auth method `none`, else
`client_secret_post`, else `client_secret_basic`) → `CannotRegister`. Reuse a stored registration
when the issuer matches. The pinned client, the pinned `scope` and `oauth_hosts` come from
`connector_catalog.resolve(row.connector_key)`, and only from an entry with `featured: True`.
- As built: `client_kind(found, entry, url)` names the choice without registering (the probe uses
  it) and `choose_client(found, entry, url, known)` makes it. A registration is reused only for
  the same issuer and the same redirect address. `application_type` is `native` when the
  redirect isn't `https://`. The Google secret is never copied onto a connection.
- Tests first: each branch; a custom address never gets the Google client even when its metadata
  names `accounts.google.com`; confidential-only server gets a secret; re-registration when the
  issuer changed.

**B2.3 Start.** `POST /api/connectors/{id}/oauth/start` in `routes/connectors_oauth.py`.
- Tests first (`tests/test_connector_oauth_routes.py`): the authorize address has every parameter
  in the contract, `resource` verbatim from the metadata; only `sha256(state)` is stored; status is
  unchanged on a `connected` row; `not_oauth`; **another account → 404**.
- As built: discovery, the read of the row's registrations and the client choice (it may
  register) all run before the row is locked and with no database connection held; only the
  write takes the lock, and it re-checks that the chosen client wasn't marked `refused_client`
  meanwhile. One `oauth/start` per connection runs at a time in a process (the same in-process
  turn a refresh takes; see B2.5). A Featured entry on its own
  address may carry `authorize_params` (extra authorize parameters). The three Google entries do
  since the merge: `{"access_type": "offline", "prompt": "consent"}`, without which Google hands
  out no refresh token.

**B2.4 Callback, confirm, pages.** The two public routes and the small HTML pages (pattern:
`desktop_auth.return_page()`). Page text is escaped; no provider-supplied text is rendered raw.
- Every page is sent with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
  `X-Frame-Options: DENY`.
- The `state` is used up with one statement (`UPDATE … SET state_hash = … WHERE state_hash = :h
  RETURNING id`) at the start of Complete and when a sign-in is cleared (callback steps 3 and 4).
  The callback GET that shows the confirm page does not use it up. A cleared sign-in sets `NULL`.
  **Complete sets the hash of a random value instead of `NULL`** and clears it in its final
  write: the plan first said `NULL` there too, but `signin_pending` is read from `state_hash` and
  the app stops polling when it turns false, so for the length of the code exchange a poll would
  have found a sign-in that ended with no `connected` and no `last_error`.
- The tools are listed before the final write, so the row changes once: `connected`, the sign-in,
  the tools and `signin_pending: false` together.
- The write after the exchange takes the row lock (`get_owned(…, for_update=True)`) before it
  reads or writes the stored sign-in. The stored sign-in keeps `authorization_endpoint` (the
  contract's `secret_encrypted` shape), so `signin_host` still reads right once
  `pending_encrypted` is cleared.
- The confirm page shows the owner's full email. The "another account" page tells the user to log
  out of Tvashtr in that browser and start again.
- Tools after sign-in: `connector_upstream.list_tools_sync` on
  `connectors.upstream_target(row, row.access)`.
- Tests first (`unauth_client` and `client`, as `tests/test_desktop_auth.py`): happy path with the
  owner's session → `connected`, tokens encrypted, tools listed; no session → confirm page with the
  full email, `state_hash` still set, and the confirm POST completes; another account's session →
  nothing stored and the page has the log-out line; unknown, reused and expired `state`; `iss`
  mismatch and missing-but-required `iss`; `error=access_denied` sets `last_error`; a failed
  exchange leaves a working `secret_encrypted` intact on "Sign in again"; **two callbacks at once
  with the same `state` make exactly one token request** (two threads, the fake counts); every
  page carries the three headers.

**B2.5 Tokens.** `ensure_access_token(connection_id, *, rejected=None)`, `refresh` and `revoke`
(used by B1's delete) replace the Phase 0 stubs. Sync: it opens its own session, takes `FOR UPDATE`
on the row and reads the stored sign-in only after it holds the lock.
- Tests first: more than 5 minutes left → no network call; that same token passed as `rejected` →
  a refresh; `rejected` given but the stored token is already a different one → no network call;
  refresh rotates and commits the new refresh token; a reply without one keeps the old;
  `invalid_grant` → `SignInRefused`, `needs_signin` and tokens cleared; `invalid_client` also drops
  the registration; 5xx → `Unreachable`, status unchanged; two threads calling at once make exactly
  one refresh request (the row lock); **a new sign-in that completes while a refresh is in flight
  is what is stored at the end**; a row deleted while a refresh waits for the lock →
  `SignInRefused`, nothing written.
- `# ponytail:` the refresh call runs while the row is locked (10 s timeout). Callers on an event
  loop run it in a worker thread (B3.3). Move to a version column and a lock-free refresh if lock
  waits show up.
- As built after review: callers first take an in-process turn per connection
  (`_one_at_a_time`, 15 s wait, then `Unreachable`) and only the caller whose turn it is opens a
  session, so callers waiting behind a slow token endpoint hold no pooled database connection.
  What is left of the ponytail note: each connection being refreshed still holds one pooled
  connection for up to 10 s.

**B2.6 Client metadata document.** `GET /oauth/client-metadata.json`; 404 unless
`public_base_url` is https. Test both cases.

**B2.7 Live probe (operator-run, not in `make test`).** `scripts/connector_probe.py`: for every
available Featured entry, run `discover` and the client choice against the real server and print
issuer, client kind, the authorize host and the host of every sign-in endpoint (so a Featured
entry that needs `oauth_hosts` for the mix-up check is found here); `--register` also performs the
registration. Accept:
every available Featured entry reaches an authorize address. An entry that fails is switched to
"Coming soon" before release.
- Run: `cd backend && uv run python ../scripts/connector_probe.py --base-url
  https://tvashtr.fly.dev` (`--all` adds the entries that can't be connected yet; `key …` limits
  the run). Its plumbing is tested against the fake in `tests/test_connector_probe.py`.
- Result on 2026-09-30, discovery only (no `--register`), base `https://tvashtr.fly.dev`: all ten
  available entries reach an authorize address and **none needs `oauth_hosts`** (every endpoint is
  on its issuer's site). Client: a metadata document for Notion, PostHog, Linear, Sentry and
  Atlassian; dynamic registration for Supabase, Neon, Mixpanel, Amplitude and Intercom. The
  sign-in host is not the MCP host for Supabase (`api.supabase.com`), PostHog
  (`oauth.posthog.com`), Mixpanel (`mixpanel.com`) and Atlassian (`auth.atlassian.com`); all four
  are on the MCP host's site.
- The same run with `--all` found the one defect: Google's three cards were refused, because
  Google names its issuer with a trailing slash in the resource metadata and without one in the
  server metadata. Fixed (B2.1's issuer check now ignores one trailing slash). Their endpoints
  are on `accounts.google.com` and `oauth2.googleapis.com`, which is what `oauth_hosts` pins.
  HubSpot offers neither registration nor metadata documents, as expected.
- The probe also prints `iss`: whether the server sends the `iss` answer parameter. Same date:
  yes for Linear, Sentry and Google; no for Supabase, Neon, Notion, PostHog, Mixpanel, Amplitude,
  Intercom, Atlassian and HubSpot. A provider that doesn't can be the target of a **mix-up by
  redirect** from a custom or registry connector's sign-in server, which the backend cannot
  close (contract, Discovery step 4). The app warns before such a sign-in since the merge (§7).
  Open: the operator's decision on shipping custom and registry OAuth connectors with that
  residual (§12.7).
- Not covered by a discovery-only run: whether each provider accepts the registration and the
  authorize request as sent (Intercom gets no `scope`, PostHog gets all 155 it lists), and the
  tool annotations (Neon's `run_sql`, Google's). Those need `--register` and one real sign-in
  per provider.

**B2 at the merge:**
- `oauth/start` holds one of B1's places for requests that wait on a provider while it runs
  discovery and a registration (429 `busy` when there is none).
- A sign-in, or one in flight, that can't be decrypted counts as none: `ensure_access_token`
  raises `SignInRefused` and leaves the row to its caller, "Sign in again" starts (and registers
  afresh) instead of answering 500, and a callback for the old sign-in is the expired page.
- `connector_net.check_url` refuses a host name the resolver can't encode and an address httpx
  won't build, so B1 and B3 callers get `UnsafeUrl` too (B2's own guards for those stay).
- B1 asked for the connection's name to be escaped on the callback pages. It already was (every
  page's message goes through `html.escape`); the connected and the failed page now have a test
  for it as well.
- F1 asked two things of the callback: it clears `last_error` when a sign-in connects, and the
  "different account" page sets one. Both were already so.

## 6. Stream B3: run time

**B3.1 Run token.** In `connector_proxy.py`: `sign_run_token(run_id, node_id, connection_id,
access)` and `read_run_token(value) -> RunGrant | None` (signature, age, run owner, run not in
`run_views.TERMINAL_STATUSES`, row exists and isn't `pending`).
- Tests first (`tests/test_connector_runtime.py`): round trip; tampered and expired tokens; a
  terminal run; **a token whose run belongs to another account than the connection is refused**; a
  deleted connection.

**B3.2 Run config.** `control_plane/node_tools.py`:
- `build_mcp_config(tool_config, run_id, *, node_id=None)`: the connectors block goes between the
  resolve loop (:185) and the Domains block (:186), following the contract's four steps. Every
  skip goes through
  `connector_proxy.record_skip(run_id, node_id, connection_id, name, reason)` (B3.5), which
  writes the warning (`record_resolution_warning(run_id, "connector", name, reason)`) and the
  `connector_skipped` event.
- Split the base-address part of `domains_mcp_url()` (:84-99) into a shared helper and add
  `connectors_mcp_url()`. It returns `{base}/mcp/connectors`, with no trailing slash (the form
  Phase 0 tests behind the catch-all; assert the exact string).
- `control_plane/team_run.py`: pass `node_id=node_id` at :1522; add `N connector(s)` to
  `_tool_names` (:266-279).
- Tests first: no `connectors` key → output identical to today (the existing
  `tests/test_domain_mcp_inject.py` stays green); one grant → one server with the proxy address and
  a token that reads back to the right run, node, connection and access; slug collision →
  `conn-<slug>`; each warning reason, each with its `connector_skipped` event; a refused refresh
  marks the row `needs_signin`; a grant
  pointing at another account's connection is skipped with `it was disconnected`; the Desktop-route
  warning lists connectors.

**B3.3 Proxy core.** `proxy_list_tools(grant)` and `proxy_call_tool(grant, name, arguments)` as
plain async functions taking an injectable upstream (default `connector_upstream`), so they are
tested without HTTP. The address comes from `connectors.upstream_target`, the headers from
`connectors.upstream_headers`, the filter from `connector_catalog.is_write`.
- **Nothing sync runs on the event loop.** FastMCP awaits its handlers on the server's loop
  (`mcp/server/fastmcp/utilities/func_metadata.py:96`), and these pieces are sync database or HTTP
  work: `read_run_token`, the row load, `upstream_headers` / `ensure_access_token` (a row lock held
  across a 10 s HTTP call), `record_call`, `record_skip`. Each is called through
  `anyio.to_thread.run_sync`. One slow refresh must not stall every other agent's calls.
- Upstream `tools/list` is capped at 10 s (`anyio.fail_after`). Past it the answer is `[]` plus the
  `we couldn’t reach it` skip. `tools/call` keeps 120 s.
- **Only `UpstreamUnauthorized` (401)** leads to `ensure_access_token(rejected=token)` and one
  retry, then `needs_signin` plus a skip. `UpstreamRefused` (403 and the rest) goes back to the
  agent as a tool error: no refresh, no status change.
- Tests first (`tests/test_connector_proxy.py`, in-memory fake upstream): read access lists only
  annotated reads; write access lists all; a `provider` entry (Supabase) in read mode lists
  everything and calls the read-only address; **a Neon-shaped entry in read mode calls the
  `readonly=true` address and still hides and blocks an unannotated `run_sql`**; the row's `access`
  narrowed mid-run wins over the token; a blocked write returns the contract's error and is
  recorded `blocked`; 401 → one refresh and one retry, then `needs_signin` plus a skip; **403 → a
  tool error, `ensure_access_token` not called, status still `connected`**; unreachable on list →
  `[]` plus a skip; **a list that never answers returns `[]` within the cap** (cap patched to
  0.05 s); **the patched `ensure_access_token` and `record_call` run on a thread that isn't the
  loop's**; descriptions capped; `outputSchema` dropped.

**B3.4 Mount.** `tvashtr/mcp/connectors.py`: a `FastMCP` subclass overriding `list_tools` and
`call_tool` (the same override point `_DomainsMCP` uses, `domain_mcp.py:178-195`), reading the
bearer from `self.get_context().request_context.request`. Both overrides are coroutines on the
loop, so they only await B3.3's functions. A bad token lists no tools and fails calls with "This
connector isn’t available for this run."
- Test first: the subclass methods called directly with a stub request context (good token, bad
  token, no header). The HTTP path can't be probed on the shared test app (see 0.4); T.1's proxy
  probe proves it without an LLM, T.2 with one.

**B3.5 Call events, skips and rounds.**
- `record_call(grant, …)` writes the `connector_call` row: `invocation_id` = latest
  `agent_invocations` row for the run and node; `seq` = next in the `1_000_000_000` band, retried
  on `IntegrityError` (pattern: the sink in `engines/run_event_sink.py:26-73`).
- `record_skip(run_id, node_id, connection_id, name, reason)` writes the warning and a
  `connector_skipped` row, same band, same `invocation_id` rule.
- `connector_use(session, run_id, invocation_ids) -> {invocation_id: connectors}` builds `used`,
  `calls`, `total_calls` and `skipped` (one entry per connection and reason) and feeds both
  `node_history._run_detail` (:157-235, next to `given`/`produced`) and the invocation dicts of
  `GET /api/runs/{id}/graph` (`routers.py:1865`). `skipped` is what lets the agent drawer's Runs
  tab say "Ran without Notion": `node_history.py` carries no warnings, and `RunWarnings` is mounted
  only in `frontend/src/App.tsx:825`.
- `recent_use(session, owner_id, connection_id)` replaces the Phase 0 stub.
- Tests first (`tests/test_connector_rounds.py`): counts, writes-first order, the 50 cap with
  `total_calls`, blocked calls left out of counts, `null` for a round with no calls and no skips,
  **a round with a skip and no calls has `skipped` filled and `used: []`**, repeated skips collapse
  to one, `result_url` extraction (an `https://` address only), two calls in a row get distinct
  `seq`; **another account's run is 404 on both endpoints** (existing `_require_owned_run`,
  asserted again with connector data present).
- `# ponytail:` the band shares the int `seq` column with the Desktop runner's band, which starts
  at `RUNNER_SEQ_OFFSET = 100` (`control_plane/desktop_jobs.py:57`) and stays far below
  1,000,000,000. The two never share an invocation either (plan agents get no connectors).

**B3 as built** (where it differs from the tasks above):
- **`record_skip` landed with B3.2 and `record_call` with B3.3**, not B3.5: those tasks call them
  and their tests read the rows they write. B3.5 is `connector_use`, `recent_use` and the two
  endpoint fields. Both writers go through one `_write_event` (the band, the `invocation_id` rule,
  the retry on `IntegrityError`).
- **`sign_in_expired(run_id, node_id, row)`** is the one place a row becomes `needs_signin` at run
  time (under the row lock; a row that already is keeps its `last_error`) and always writes the
  skip. `build_mcp_config` and the proxy both call it, so a refused refresh marks the row whether
  or not `ensure_access_token` already did.
- **Read or write on `tools/call`** needs the tool's annotation, and a call carries only a name.
  The proxy keeps the last listing's `{tool: readOnlyHint}` per process, per connection **and
  effective access**, for 60 s (`# ponytail:` in the code); each listing replaces it, and it
  goes with the connection. A call with no recent listing lists first. With write access a
  listing that fails doesn't fail the call (it is recorded as a write).
  The row's stored `tools` isn't used: it was listed at the row's access, not the agent's.
- **The mount replaces the SDK's `tools/call` handler.** The SDK's own looks the tool up in a
  cache it fills by calling `list_tools`, one cache for every agent and connector, so with two
  connectors almost every call would list the provider again first. With input validation off
  nothing reads what it finds. The handler is four lines in `tvashtr/mcp/connectors.py`.
- **The HTTP path is tested here as well**, not only by T.1:
  `tests/test_connector_proxy.py::test_the_proxy_over_http_lists_and_calls_the_provider_for_a_run_token`
  runs the mounted proxy in a subprocess (never `tvashtr.main`) against the fake provider with
  the SDK's own client. T.1's probe still covers the running backend and the delete.
- **`reads` counts the reads that worked; `writes` counts the writes the provider took.** A
  `connector_call` carries `forwarded` (sent, and not turned away with a 4xx). A write that was
  sent and then timed out or came back as an error may have changed data, so it counts and its
  tool error says it may have gone through. A call that failed before it was sent (or before
  the proxy could learn the tool's annotation) counts as nothing. The contract's Rounds
  paragraph says so now.
- **A refused list writes the `we couldn’t reach it` skip** (contract, `tools/list`), so a
  provider that answers 403 to the listing doesn't leave an agent silently without its tools.
- **After review** (the contract's Run time and What a run shows carry each of these):
  - `_write_event` takes `pg_advisory_xact_lock` on `(run, invocation)` before it reads the next
    `seq`, so calls made at the same moment are all recorded (the retry on `IntegrityError` alone
    gave up after five collisions, and the no-round band, where the unique constraint sees only
    NULLs, could get one `seq` twice).
  - What an event stores is made storable and short: `tool` ≤ 200, a `result_url` over 2,000 is
    `null`, and a NUL or half a surrogate pair no longer makes the insert fail.
  - `tools/list` offers a closed set of fields, each with a ceiling, and at most 200 tools.
  - The proxy has 8 worker threads of its own (`PROXY_THREADS`, an `anyio.CapacityLimiter` per
    event loop) and one token request at a time per connection. The token read in the mount
    stays on the default limiter: a short read that must not queue behind a refresh.
  - A key connection's 401 looks once at whether the key was replaced while the call was out.
  - `build_mcp_config` adds `conn-` until the name is free, and skips a connector whose token
    check fails in any way (not only `SignInRefused` and `Unreachable`).
  - `recent_use` asks for a run's number once per run and agent, not once per call.
- **`tests/test_graph_endpoint.py`** asserts the exact key set of a graph invocation; it gained
  `connectors`, like the additive fields before it.
- **`routers.py` imports `connector_proxy`, so the Phase 0 guard now reads it**
  (`test_connector_net.py::test_no_other_connector_module_builds_an_http_client` scans every
  module that imports a connector module). It builds no HTTP client, but a comment at :159 ended
  in the word "requests." and the guard's pattern took it for the library. The comment was
  reworded; the guard is untouched.

**B3 at the merge:**
- The proxy tests run against the real `connectors.upstream_target` (the double is gone; they
  passed unchanged), and one more covers a scoped connection.
- `tests/test_connectors_whole_path.py` takes one connection through all three streams with
  nothing patched but the settings: connect a custom address, sign in at the fake server, check,
  grant, `build_mcp_config`, list and call through the proxy core, recent use, disconnect.
- A key that can't be decrypted is handled like a 401 for it (`needs_signin`, `its key stopped
  working`) instead of answering "This connector isn’t available for this run." with nothing
  recorded; an OAuth sign-in that can't be decrypted is `its sign-in expired`, no longer
  `we couldn’t reach it` on every round.
- A connection with no sign-in that gets a 401 has its own reason, `it now asks for a sign-in`,
  and B1's `last_error` for it.
- The proxy reads each tool's read-only mark on its own (`_read_only`). It used to pair its list
  with `connectors.stored_tools` by position, which holds only while that list's ceilings are
  the larger ones.
- A round's `calls[]` items carry `forwarded`, so the UI can tell a write the provider took from
  a call that simply failed (§8).

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
`<name>`" that names the agents using it (the row's `used_by_agents`), the footer note; Browse =
category chips, search box, Featured grid
(`pages/tools/CatalogCard.tsx` pattern), then "From the MCP Registry" with "Show more" paging, the
"not reviewed" label, "Coming soon" cards, the Custom card; a first visit with no connections lands
on Browse. Calls `refreshBadges()` after every mutation.
- Tests first: `ConnectorsPage.test.tsx` (tabs and counts, first-time lands on Browse, banner for
  `needs_signin` naming its agents, "Coming soon" has no Connect button, search hits `q=`, Show more uses
  `next_offset`).
- As built (F1, after review): the Connected table shows the newest first (the API answers oldest
  first). A connection Tvashtr hasn't reviewed has a "Not reviewed" badge and its host under the
  name (`CnF-Key-4`); one with a project picker and no project says "The whole account". Browse
  says "Loading the catalog…" while it loads and "Couldn’t load more. Try again." when Show more
  fails.

**F1.4 Connect sheet and sign-in.**
- `pages/connectors/connectSignIn.ts`: the helper from the Desktop map. Web: open the popup
  synchronously (`window.open("", "tv-connect", "popup,width=520,height=720")`), then set its
  location once `authorize_url` arrives. Desktop (`isDesktopApp()`, `lib/desktopRepos.ts:42`):
  no blank popup; `window.open(authorize_url, "tv-external", "noopener")`, which Electron sends to
  the system browser.
  **Check the protocol before either**: `new URL(authorize_url).protocol` must be `https:` or
  `http:`. The web popup is a same-origin blank window, so a `javascript:` address assigned to it
  would run in Tvashtr's origin. Anything else closes the popup and shows the "couldn’t open" line
  below. (Since the review the address opened is the answer's `open_url`, Tvashtr's own hop to
  `authorize_url`; `authorize_url` is still read and checked, and opened only when there is no
  `open_url`.)
- `useConnectSignIn.ts`: poll `GET /api/connectors/{id}` every 2 s until `signin_pending` is false
  (10 minute cap, Cancel, refetch on `focus`/`visibilitychange` like
  `pages/tools/useGithubStatus.ts:69-74`). Never use `popup.closed` as a cancel signal.
- `ConnectSheet.tsx` (DS `Sheet`, steps like `pages/tools/AddToolSheet.tsx`): choose access → wait
  ("Open the window again" / "Open the browser again") → pick a project when there is a
  `scope_picker` (options, or a text field when `manual`) → done toast "Supabase is connected. No
  agent can use it until you turn it on." Key variant: `key_fields` form, "Check and connect",
  inline `key_rejected` and `invalid_key`. `CustomConnectorSheet.tsx`: address → "Check the
  server" → the sign-in host line (flagged when `signin_host_differs`) → Continue, or the
  `no_signin` panel with "Add it in Tools".
- Copy for the states the canvas doesn't draw (two of the five are drawn after all, and the
  canvas's copy is what was built: popup blocked is `CnF-Prob-1`, and `cannot_register` for a
  custom address is `CnF-Prob-3`):
  - popup blocked (`window.open` returned `null`): as `CnF-Prob-1`, "Your browser blocked the
    sign-in window" / "Allow pop-ups for Tvashtr, or open the window yourself. This sheet moves on
    when you finish there." with "Open the window again";
  - Cancel pressed: polling stops, the sheet goes back to the access step and says "Sign-in
    cancelled. Nothing was connected.";
  - the 10 minute cap: "The sign-in wasn’t finished in time. Try again.";
  - `cannot_register` (from POST or `oauth/start`) on a catalog entry: a panel titled "Tvashtr
    can’t sign in to `<name>` yet" with the API's `message` and "Close" (`no_signin` gets the same
    panel plus "Add it in Tools"). On a custom address it is `CnF-Prob-3`: the amber note under
    the two fields, with "Add it in Tools";
  - a refused `authorize_url`: "Tvashtr couldn’t open the sign-in page. Try again."
- Tests first: `connectSignIn.test.ts` (web and Desktop branches; a `javascript:` and a `data:`
  address are never assigned to the popup or opened), `ConnectSheet.test.tsx` (each step, each
  error code, popup blocked, Cancel, the time cap, polling ends on `connected` and on
  `last_error`).
- As built (F1):
  - `ConnectSheet` also serves a connection that exists: "Sign in again" opens on the wait step
    (the click that opens the sheet also opens the popup, `prepareSignInWindow()`), a key
    connection gets "Replace key" (`PATCH credentials`; the fields are the connection's own
    `key_fields`), and "Change project" opens on the project step.
  - A sign-in that ends not connected, with a `last_error`, is a failure when the words are new
    or when it ended more than ten seconds before the ten-minute cap (`oauth/start` leaves
    `last_error` alone, so the same words can be a second failure). Otherwise it is the time cap.
    A `needs_signin` row carries "Its sign-in expired." the whole time it waits. A 404 while
    polling ends the wait ("… was disconnected before the sign-in finished.").
  - A sheet doesn't close (Escape, scrim, ✕) while a request of its own is going. One that is
    unmounted opens no window and calls no `onDone` (`useAlive`).
  - A new connection's sheet closed on the project step calls `onDone(conn, "connected")`: the
    sign-in went through, so it is connected to the whole account.
  - After a scope or access `PATCH` the sheet and `ChangeAccessDialog` call `POST …/check`
    (best effort) and report its answer: B1's PATCH keeps the stored tool list.
  - "Replace key" asks for the connection's `key_fields` at once, with no lookup; the
    `Authorization` default is only for a connection that names no field. (It first searched
    the catalog by host and read one page, which dead-ended for the 42 key connectors on
    `mcp.apify.com` past the first 48. Fixed after review.)
  - A custom connector is made read only (the check comes before the choice); Read & write is a
    `PATCH access` once the sign-in is through, and a failed one is said in a toast. A name
    changed after the check is a `PATCH name` sent before the sign-in starts, while the row is
    still `pending` and its slug follows the name (since the merge; one that can't be saved
    then is sent again after the sign-in).
    The custom sheet is one `<form>` in every state; its fields are disabled during the check.
  - The DS `Sheet` has no icon slot, so the sheet header has the title and subtitle without the
    letter tile. The account name ("Signed in to Supabase as organization lazyx") is cut (§1.7):
    step 3 says "Signed in to Supabase."
  - A registry entry whose sign-in is on another site shows the `CnF-Custom-2` warning on the
    access step and asks for a second click ("Continue to `<signin_host>`") before it opens.

**F1.5 Detail page.** `ConnectorDetailPage.tsx` (model: `pages/tools/ToolDetailPage.tsx` :122-415):
Connection card (project and Change, access and Change, connected date, "Sign in again"), "What
agents can call" (Read / Off · write; a warning when no tool is a read: "This server doesn’t mark
any tool as read-only. Agents can’t call anything until access is Read & write."), Used by with
"Give an agent access", Recent use. Test first: `ConnectorDetailPage.test.tsx`, including the 404
state.
- As built (F1): "Change access" is a small dialog (`ChangeAccessDialog.tsx`, `PATCH access`); a
  key connection has "Replace key" in place of "Sign in again"; a connection whose tools were
  never listed (`tools: null`) offers "Check again" (`POST …/check`); each Used-by row's ✕ removes
  that agent (`PUT …/agents` with the rest, read from `GET …/agents` at the click, not from the
  page's snapshot). A `custom:` connection's badge says "Custom · not reviewed by Tvashtr".
  "Signed in as" is cut (§1.7).

**F1.6 Dialogs.** `GiveAccessDialog.tsx` (copy `pages/tools/TurnOnForAgentsDialog.tsx`: team
picker, ticks, the plan note per `subscription`) on `GET`/`PUT …/agents`; `DisconnectDialog.tsx`
naming the agents from `used_by_agents` and showing `revoke_hint`. Tests first for both.

**F1.7 Mounting.** `pages/Workspace.tsx` (:17-31 imports, :184-222 switch,
`key={route.connectorId}`). Accept F1: every `Cn-Screens` web screen and the `CnF-Connect` and
`CnF-Changes` flows (minus the cut ones) can be walked against a local backend and the fake server.

**F1 at the merge:**
- Before the first sign-in to a registry or custom connector both sheets say "The sign-in page
  that opens should be `<name>`’s own. If it asks for access to a different service, close it."
  (`OwnSignInNote`; B2's review, the mix-up by redirect).
- A `needs_signin` connection with no sign-in (`auth_kind: "none"`) shows its `last_error` and
  offers Disconnect, in the banner, the table row and on its page. "Sign in" there would only
  get `not_oauth`.
- 429 `busy`, 409 `not_connected` and 422 `invalid_name` needed no code: every call site already
  shows the server's words and leaves its button to try again. Tests pin that for connect,
  `oauth/start`, the custom check, check on the page and a refused name.
- The command palette's "Open Toolkit" lands on Connectors.
- `agentsByTeam` is exported from `pages/tools/toolFormat.ts` and the copy is gone.
- Desktop: `connectSignIn.ts` opens `window.open(address, "tv-external", "noopener")`, the frame
  name `navigationGuard.cjs` sends to the system browser. Tests on both sides pin the name.

## 8. Stream F2: drawer, runs, warnings

F2.1–F2.4 run in the parallel phase. F2.5 waits for the F1 merge (§2).

**F2.1 Config helpers.** `panel/tools/nodeTools.ts`: `connectorsOf(cfg)` and
`setConnectors(cfg, [{id, access}])` beside `setDomains` (:68-73); empty list deletes the key and
`tidy()` (:56-65) still drops an empty `tvashtr`. Tests first in `nodeTools.test.ts`.

**F2.2 Checklist.** `panel/connectors/ConnectorsChecklist.tsx` (copy
`pages/domains/DomainsChecklist.tsx:22-90`): loads `listConnections()`, DS `Checkbox` rows, an
Access `Select` only on rows whose connection is `write`, a `needs_signin` row shows "Sign in
again" linking to Connectors, the plan note when the agent runs on a Claude or Grok plan.
`panel/tools/ToolsPanel.tsx` renders it as its own "Connectors" section above Tools (where the
canvas draws it), not inside the Tools section beside `DomainsChecklist`. `panel/nodeCounts.ts`
(:3-15) counts grants. `panel/skills/nodeSkills.ts` `desktopSubscriptionNote` (:244-253) mentions
connectors. Saving is the existing `tool_config` patch (`panel/agentDraft.ts`), no new save path.
- Grants that point at nothing: once `listConnections()` has loaded, every list the checklist
  writes keeps only ids that are in it, so the grant of a disconnected connector drops out on the
  next save. While the list is loading or failed to load the checklist writes nothing (a failed
  fetch must not wipe grants). A draft saved without touching the checklist keeps the id; the
  run then skips it with `it was disconnected`.
- The plan note, the agent's name in the Access select and the leave guard on the checklist's
  links needed files no stream owned; they landed with F2.5 (below).
- Tests first: `ConnectorsChecklist.test.tsx` (including: a draft holding an unknown id and a
  known one saves only the known one; a failed load leaves the draft as it was),
  `panel/skills/SkillsToolsTab.test.tsx`.

**F2.3 Runs block.** `panel/connectors/ConnectorsUsed.tsx`: chips ("Supabase · 6 reads",
"Linear · 1 write") and the call list (writes first and marked, tool, `arg`, time and duration,
`result_url` as a link only when it starts with `https://`, "Show all N calls"), and one line
per `skipped` entry: "Ran without Notion: its sign-in expired." with "Sign in", which opens that
connection's page ("Open Connectors" when `connection_id` is `null`). `RoundsList` in
`panel/runs/RunsTab.tsx` (:118-186) renders it from `round.connectors`, so both drawers show it
with no `more` slot of their own: the skipped lines inside the Last run card, the chips and calls
after the card, all of it inside an opened earlier round. `panel/run/RunNodeDrawer.tsx` only
passes `connectors` through `roundsOf`. Types: `connectors` on `NodeRound`
(`lib/api/nodes.ts:60-81`) and on `NodeInvocation` (`lib/api.ts:126`). In `lib/api.ts` the parser
and the type come from `./api/roundConnectors` (the leaf module), not from `./api/connectors`:
that import is a load-time cycle (0.7).
`lib/events.ts`: `isFeedEvent(kind)` is false for the kinds `connector_call` and
`connector_skipped`. `getRunEvents` (`lib/api.ts`, the feed's only loader) applies it, because
the feed itself (`panel/EventFeed.tsx`) is not an F2 file. `result_url` has no label in the
contract, so the link reads "Open result".
- Tests first: `ConnectorsUsed.test.tsx` (including: a round with only `skipped`; a
  `javascript:` `result_url` is not a link), `panel/runs/RunsTab.test.tsx`, the events test.

**F2.4 Run warning.** `components/RunWarnings.tsx` (:4): a `connector` kind renders "Ran without
`<name>`: `<reason>`." with "Open Connectors". Test first. The run view shows the banner in a
row of its own under the toolbar (`.cv-warnings` in `App.tsx`), not inside the toolbar's one 56px
line, where a banner of two lines hid "Open Connectors" under the canvas (fixed after review).

**F2 after review** (F2.1 to F2.4):
- The checklist says "Loading your connectors…" while it loads, its "Try again" works inside the
  run drawer's disabled fieldset, and a grant whose connection is gone shows "1 connector this
  agent had is no longer connected." with Remove. The plan note is amber, as the canvas draws it.
- The Skills & tools count reads grants the way the checklist does (`connectorsOf`).
- The calls list has one toggle that keeps focus ("Show all N calls" / "Show fewer calls"; "Show
  the first 50 calls" when the server capped the list).
- Props that let the drawer take part, all optional: `onOpen` on the checklist and on
  `ConnectorsSkipped`, `onOpenConnector` on `RunsTab` and `RoundsList`, `saved` on the checklist
  and `savedConfig` on `ToolsPanel` (the "starts on read only" note goes once the saved grants
  include the tick).

**F2 at the merge:**
- `ToolsPanel` passes the checklist `onOpen` from its `onOpenToolkit`, with F1.1's routes. The
  Team drawer's `onOpenToolkit` is `guardLeave(() => navigate(route))` (`App.tsx`), so the
  checklist's links now ask "Save your changes?" first.
- The checklist's link on a connection that needs attention names the fix: "Sign in again",
  "Replace key" or "Connect it again" (no sign-in).
- A round's tiles use F1's `tileLetters` (by slug): "Sb" for Supabase in the Runs tab too.
- A call that isn't `ok` reads "May have gone through" when it is a write the provider took
  (`forwarded`), else "Failed".

**F2.5 Connect from the drawer, and the drawer's wiring** (built after the F1 merge):
- `panel/connectors/ConnectAppDialog.tsx`: "Connect an app" in the checklist head opens
  "Connect an app for Reviewer": the Featured entries of the catalog's first page that are
  available and not connected, each with its tile, "Sign in" or "API key" and Connect; a search
  box that narrows them by name; "Open Connectors" (Browse, through `onOpenToolkit`, so the leave
  guard asks first). Picking one opens F1's `ConnectSheet`. When it connects, the checklist puts
  the connection first with a "New" badge, ticks it read only in the draft, and its callout reads
  "Neon is connected and ticked for Reviewer. Save to keep it." (green, `role="status"`) until the
  saved grants include it. The canvas draws that line as the section's callout, so it is not a
  toast. The button is off while the list loads, for an agent on a plan, and in the run view.
  A sign-in finished after its sheet was closed shows the next time the tab opens.
- `panel/skills/SkillsToolsTab.tsx` takes `agentName`, `plan`, `savedToolConfig` and hands them to
  `ToolsPanel`; `panel/NodeEditor.tsx` fills them (`name`, `desktopSubscriptionName(…)`,
  `api.baseline.toolConfig`). A plan agent's rows and "Connect an app" are disabled and the amber
  note shows; focus mode gets the same through `FocusSkillsTab`.
- `panel/NodeEditor.tsx`: `RunsTab` and `FocusRunsTab` get `onOpenConnector`
  (`connectorsRoute(id)` through `onOpenToolkit`), so "Sign in" on a skipped line asks "Save your
  changes?" first. `App.test.tsx` proves the guard on a checklist link with a dirty draft.
- The save toast of `CnF-Grant-4` (`savedGrantsToast`): after a save that changed
  `tool_config.tvashtr.connectors`, "Reviewer can use Supabase, Notion and Linear. All read
  only." The last part only when no grant can write (a grant's `write` on a read-only connection
  can't); one connector reads "Read only."; a save that leaves none, or whose connections can't
  be read, shows no toast.
- Focus mode's Runs tab (`panel/focus/FocusRunsTab.tsx`, `RoundDetail`): a "Connectors" card with
  `<ConnectorsSkipped>` and `<ConnectorsUsed key={round.invocation_id}>`, only on a round that
  used or skipped one.
- Not done (optional): moving the feed filter from `getRunEvents` into `panel/EventFeed.tsx`.

## 9. Stream D: Desktop

The shipped build already opens the system browser for any non-GitHub address. Two small fixes,
and a release because Desktop bundles the frontend.

**D.1** Move the window-open decision into `desktop/electron/navigationGuard.cjs` as a pure
function and make `main.cjs` (:535-543) use it:
- a `window.open` with frame name `tv-external` always goes to `shell.openExternal`, even for a
  GitHub sign-in address (a connector that signs in with GitHub would otherwise take over the app
  window and its callback would be bounced);
- **only `http:` and `https:` addresses ever reach `shell.openExternal`**. Today `main.cjs:541`
  hands it any address, and the OS would open `file:`, `smb:` or a custom-scheme handler. Anything
  else is denied and nothing opens. (No link in the app uses another scheme today.)

Test first, in `desktop/scripts/navigation-guard.test.cjs`: `tv-external` with a GitHub address →
external; `javascript:`, `file:` and `ms-msdt:` → denied; an `https:` docs link → external, as
today.

**D.2** `desktop/electron/deepLink.cjs` (:32-37): add `connectors: "/toolkit/connectors"` to
`TOOLKIT`. Test first in `desktop/scripts/deep-link.test.cjs`.

**D.3** Version 0.13.0 in `desktop/package.json`, `npm test`, `npm run build`. Shipping is the
operator's step.

As built: the decision is `windowOpenAction(url, frameName)` in `navigationGuard.cjs`
(`"external" | "in-window" | "deny"`), and `isGithubAuthUrl` moved there with it. At the merge:
F1's Desktop branch opens the frame name `tv-external`, as D.1 expects.

## 10. Stream T: e2e and gates

**T.1 Browser e2e and the proxy probe.** `scripts/connectors_e2e.sh` (copy
`scripts/secret_gate_e2e.sh`: isolated ports, its own database, `TVASHTR_AGENT_SANDBOX=local`)
starts the fake server on :9911 and the backend with `TVASHTR_CONNECTORS_ALLOW_LOCAL=1`,
**`TVASHTR_HOSTED_MODE=false`** and
`TVASHTR_PUBLIC_BASE_URL=http://localhost:<port>` (the app itself is opened on `127.0.0.1`, so the
callback sees no session cookie and the confirm page is exercised), then runs two things.
The hosted-mode override is not optional: settings read the repo `.env`, which sets
`TVASHTR_HOSTED_MODE=true`, the copied script doesn't touch it, and `connector_net` (rightly)
ignores allow-local in hosted mode. Without it the first step (Check on
`http://127.0.0.1:9911/mcp`) is refused with 422 `invalid_url` and the proxy can't reach the
fake. The script asserts the posture before it starts anything else
(`connector_net.check_url("http://127.0.0.1:9911/mcp")` must pass).

1. `frontend/e2e/connectors.spec.ts`:
   `registerFresh` → Toolkit → Connectors lands on Browse → Custom connector → paste
   `http://127.0.0.1:9911/mcp` → Check → Continue → in the popup click Allow on the fake page, then
   Connect on Tvashtr's confirm page → the sheet moves on by itself → Connected tab shows it Ready,
   read only → detail shows `create_thing` as "Off · write" → Give an agent access → the agent's
   drawer shows it ticked → Disconnect names the agent. Targeted selectors only (a full snapshot
   wedges on the canvas).
2. `scripts/connectors_proxy_probe.py` (no LLM, no provider key): the proxy's real HTTP path, which
   the unit tests can't reach (B3.4). It imports `tvashtr.db`, the models, `tvashtr.auth` and
   `connector_proxy`, and never `tvashtr.main` (a second process that imports the app starts DBOS
   recovery on the same database). It inserts a user, a `connected` connection to the fake
   (`api_key`, access `read`, bearer `fake-static-token`) and a `running` `Run` owned by that user,
   calls `sign_run_token(run_id, None, connection_id, "write")`, then uses the mcp client
   (`streamable_http_client`) against `http://localhost:<port>/mcp/connectors` and asserts:
   - `tools/list` has `list_things` and `get_thing` and not `create_thing` (the row's `read` beats
     the token's `write`);
   - calling `list_things` works; calling `create_thing` returns the read-only tool error;
   - exactly two `connector_call` rows exist for the run, one `ok` and one `blocked`;
   - after `DELETE /api/connectors/{id}` (over HTTP, cookie from `make_session_cookie_value`)
     `tools/list` is empty.

What the streams left for T.1:
- Two existing specs break on the new landing page. `frontend/e2e/revamp-shell.spec.ts:47-48`:
  after clicking Toolkit, expect `/#\/toolkit\/connectors(\/browse)?$/` or wait for the
  "Connectors" heading (a fresh account is sent on to `…/browse` once its list loads, so the
  bare address is a race). `frontend/e2e/tools-c7c.spec.ts:34-36`: click the "Tools" nav child
  after Toolkit, then assert the Tools address and heading.
- The confirm page's button is "Connect" (it posts to `/api/connectors/oauth/confirm`); the
  success page reads "`<name>` is connected. You can close this window."
- The custom sheet sends `PATCH name` before `oauth/start` when the name was changed after the
  check, and both sheets show the "should be `<name>`’s own" note before the window opens.
- The proxy offers a tool with `name`, `title`, `description`, `inputSchema` and the four hints
  only. A write that times out answers "… didn’t answer. `<tool>` may have gone through, so check
  before you retry."; a deleted connection lists nothing and fails calls with "This connector
  isn’t available for this run."
- `tests/test_connectors_whole_path.py` already walks connect → sign in → grant → proxy →
  disconnect in the backend; the probe still has to prove the mounted HTTP path on a running
  backend.

**T.1 as built:**
- `scripts/connectors_e2e.sh`: backend :8043, Vite :5243, the fake on :9911 (`PORT`, `VITE_PORT`,
  `FAKE_PORT`), database `tvashtr_conn_e2e` (`TVASHTR_CONNECTORS_E2E_DATABASE_URL`; created when
  missing, migrated to head). It sets its posture after it reads `.env`, asserts it, runs the
  spec, then the probe, and exits non-zero if either failed. Spec paths given as arguments run
  instead of the default, on the same stack: `./scripts/connectors_e2e.sh e2e/connectors.spec.ts
  e2e/revamp-shell.spec.ts e2e/tools-c7c.spec.ts`.
- `TVASHTR_CONNECTORS_SHOTS_DIR` makes the spec save a screenshot of each key screen (Browse on a
  first visit, the custom sheet before and after the check, the confirm page, the Connected tab,
  the connector's page, the agent's drawer, the Disconnect dialog).
- The spec makes its team through the API (`two_node`), as it makes its account. It checks the
  server as "Fake server" and renames it "Fake" before the sign-in, then asserts the name and the
  slug `fake`. The sheet names the sign-in site by host without a port (`127.0.0.1`). The design
  system's checkbox keeps its input out of sight, so the spec clicks the label.
- Both spec changes above are made. `revamp-shell` asserts the final address (`…/browse`, which
  the assertion waits for), the heading and the nav's current item.
- `scripts/tools_c7c_e2e.sh` and the other `:8000` scripts migrate the database `.env` names.
  From this branch, before it is merged, that would put 0043 on the shared database, so the two
  older specs were run through `connectors_e2e.sh` instead. `revamp-shell` has no script of its
  own and needs `TVASHTR_HOSTED_MODE=false`, which that stack has.
- Not covered in the browser: a callback window that does hold the owner's session (the web's
  usual case; `tests/test_connector_oauth_routes.py` covers it), Featured connectors, and Desktop.

**T.2 Run-time check (operator-run, needs one provider key).** `scripts/connectors_run_check.py`
(after `make seed`; LOCAL sandbox; the backend started with `TVASHTR_CONNECTORS_ALLOW_LOCAL=1`
and `TVASHTR_HOSTED_MODE=false`, for the reason in T.1): connect the fake server through the API, grant it to a
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
5. `scripts/connectors_e2e.sh` (the browser spec and the proxy probe).
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
  the only protection. Since the review, the callback and the confirm step also act only for the
  browser the sign-in was opened in (a cookie set by `GET /api/connectors/oauth/go`, which the
  app opens instead of the provider's address) or one with the owner's session. Before that,
  whoever held the `state` (the connector's own sign-in server is sent it) could read the
  account's email off the confirm page and finish or cancel the sign-in from its own backend.
- **Proxy latency.** Each call opens a provider session, and the engine's own MCP timeout can cut
  a slow provider tool before the proxy's 120 s.
- **Snapshot size in git.** 4–5 MB of JSON Lines, growing a little per refresh.
- **`session_secret` rotation** fails the connector calls of runs in flight (the runs continue).
- **`TVASHTR_SECRET_KEY` rotation** makes every stored sign-in and key unreadable. Each reads as
  none: the connection is listed, a check or a run marks it `needs_signin`, and the user signs in
  again or gives a new key. A wrong key set by mistake marks the connections that are used while
  it is set, and they stay marked after it is put right (a check clears each one).
- **Mix-up by redirect** (found in B2's review; contract, Discovery step 4). A registry or custom
  server's own authorize page can send the browser on to a real provider's, and the provider's
  code then reaches that server. Only a provider that sends `iss` is safe from it (Linear,
  Sentry and Google on 2026-09-30; eight of the ten available Featured providers are not). The
  backend can't close it. The app warns before such a sign-in, and the user has to press Allow
  on the real provider's page for a connector they added from somewhere else. See §12.7.
- **The request cap is per process** (`provider_slot`: 4 per account, 12 in all). It protects
  one backend's worker threads; several processes each have their own count.
- **Registry entries that take money by another route.** Servers that declare a payment, wallet
  or private-key header are left out of the snapshot, from the picked remote's headers; a fresh
  crawl also drops one that declares such a header on another remote. The 794 entries that only
  mention x402 in their description are still listed (§12.9).
- **Desktop** shows Connectors only after a 0.13.0 release; the 0.12.0 build has no such pages.
- **`build_mcp_config`'s docstring says its signature is frozen.** The change is one optional
  keyword; every existing caller and test is unchanged. Update the docstring.
- **The migration guard hook** (`.claude/hooks/protect-migrations.sh`) only blocks 0001–0041;
  0042 is protected by this plan's rule, not by the hook.

- **An agent with Domains holds the owner's full session.** `build_mcp_config` puts a `tv_session`
  cookie in the Domains server's headers (`control_plane/node_tools.py:191`). An agent that has
  Domains and a connector can call `PATCH /api/connectors/{id}` or patch a node's grants with it,
  and so widen a connection for the rest of its run (when its grant is `write`) or for later runs.
  It predates this work, and it is the one hole in "read-only is enforced for real". Follow-up:
  move Domains to the run token.
- **Desktop 0.12.0 shows connector rows as unknown events.** `get_run_events` orders by `seq` only
  (`routers.py:663`), so `connector_call` and `connector_skipped` rows (seq ≥ 1,000,000,000) come
  after every engine event, and a frontend that doesn't know the kinds lists them at the end of
  the Activity feed. The 0.13.0 release skips them (F2.3).
- **The callback address carries `code` and `state`**, so both land in access logs (Fly and any
  proxy in front). Both work once, and the `code` is useless without the PKCE verifier that stays
  on the server. The pages send `Referrer-Policy: no-referrer`.
- **Neon's read mode rests on Neon's annotations.** If Neon marks no tool read-only, read mode
  offers nothing (the detail page says so). If the B2.7 probe shows it marks `run_sql` read-only,
  add a per-entry blocklist to `is_write` before release.
- **Google's read mode rests on Google's annotations too.** `is_write` trusts only a `provider`
  entry's flag; a `scopes` entry (the three Google cards) follows the annotation rule, as the
  contract's "Read or write" says and `tests/test_connector_catalog.py` pins. The read-only
  scopes already stop a write at Google, so the filter costs nothing in safety, but if Google's
  servers leave tools unannotated a connected Google card offers few or none of them. It can't
  be seen before the operator sets the Google client. At the manual sign-in (B2.7), read the
  tool list on each Google connection's page; if reads show as "Off · write", change the first
  branch of `is_write` to `entry.get("read_only_by") in ("provider", "scopes")`, flip the Google
  case in that test and add `scopes` to the contract's first "Read or write" bullet (§12.6).
- **`site()` is a short rule, not the Public Suffix List** (0.3). An unlisted shared suffix would
  let a mix-up through for providers hosted under it.
- **The mix-up rule can refuse an honest server** whose sign-in endpoints are on another domain
  than its issuer. A Featured entry gets `oauth_hosts`; B2.7 prints every endpoint host so the
  pins are known before release. A registry or custom server gets `cannot_register`.

- **Fixed: the Domains proxy answered 421 to any non-local `Host`, and 405 at its own address
  behind the SPA catch-all** (found in Phase 0, live on production). `/mcp/domains` was built
  with FastMCP's defaults (the SDK's localhost-only `Host` check) and mounted with a Starlette
  mount alone, which only matches `/mcp/domains/…`. It is now mounted like `/mcp/connectors`
  (`tvashtr.mcp.mount_streamable`: a route for the exact address plus the mount) and both use
  one `Host` allow-list (`agent_transport_security()`, see 0.6). Proved by a subprocess probe in
  `tests/test_domain_mcp_http.py` (public host, docker host, localhost, both spellings of the
  path, a real MCP client listing the two tools, and 421 / 403 for another `Host` / a browser
  `Origin`). What remains a risk: a deploy reached by a host that is not the one in
  `TVASHTR_PUBLIC_BASE_URL` answers 421 on both mounts, so that setting must name the public
  host (fly.toml does). Not changed here: the Domains server keeps each session in the memory
  of the machine that started it (the Connectors proxy is stateless), so with more than one
  backend machine a follow-up request can reach another machine and get 404 "Session not found".
- **`make lint` is not clean on the base commit** (389ab84): over `backend` and `scripts`,
  `ruff check` reports 37 errors and `ruff format --check` 21 files (Domains tests, the
  subscription pre-flight tests, `scripts/design-parity`), none of them connector files. Every
  file this work touches passes both.
  §10 step 1 needs that cleaned up first, or a lint scoped to the files this work touches.
- **`npm run test` exited 1 with every test passing** on the base commit:
  `panel/docs/DocumentViewer.test.tsx` leaves a tiptap focus timer that calls
  `Range.getClientRects`, which jsdom doesn't have, and vitest counts the uncaught error. Phase 0
  added a two-method `Range` shim to `frontend/src/test/setup.ts` (no test changed), because a red
  gate would have blocked every later stream.
- **`tests/test_workspace_gc.py` re-drives the app lifespan** and stubs each run-once MCP session
  manager it enters. Phase 0 added the Connectors one to that list; a third mount would need the
  same line.

## 12. Needs an operator decision

1. **The proxy** (decision 1 above): decision 7 in `connectors-decisions.md` now describes it (the
   agent gets a Tvashtr run token, the provider sign-in stays on the server). Build proceeds on it
   unless you object.
2. **HubSpot** has no self-registration. Choose: register one Tvashtr HubSpot app, or let each user
   paste their own app's client id and secret. Until then the card says "Coming soon".
3. **Google** stays "Coming soon" until you set the two environment variables. When you do, the
   redirect address to register is `{TVASHTR_PUBLIC_BASE_URL}/api/connectors/oauth/callback`.
4. **Google Analytics and CleverTap** are not connectors in v1 (they go through Tools). The three
   canvas flows for them and the one-sign-in Google flow are not built.
5. **Production deploy and the Desktop 0.13.0 release** are yours to trigger; `/oauth/client-metadata.json`
   must be reachable on the production origin before Notion, Linear, Sentry, PostHog and Atlassian
   use it (otherwise they fall back to dynamic registration, which also works).
6. **Google read-only: scopes alone, or scopes and annotations?** Decisions §4 lists "Google read
   scopes" as a provider-side flag; the contract's rule and the code also apply the annotation
   filter to Google (fail closed). Build proceeds on the filter. Say so if you want Google's
   scopes trusted on their own, like Supabase's flag (one line in `is_write`, §11).
7. **Do custom and registry connectors that sign in ship in v1?** They carry the mix-up by
   redirect residual (§11): a hostile server of that kind can end up with a real provider's code
   when the user allows it on the real provider's page. Featured entries are not the hostile
   party, but eight of the ten available ones can be the target. Build proceeds with them on and
   the warning in both sheets. The alternative is Featured and key connectors only until the
   providers send `iss`.
8. **A registry entry with only an optional secret header** (852 of the 2,692 that declare a
   header) is `auth: "api_key"`, as the contract says, so its card shows the key form even when
   the server also offers OAuth. Say if those should be `unknown` (decided by discovery) instead.
9. **Registry entries that mention x402 in their description** (794) are still listed; only a
   declared payment, wallet or private-key header drops a server. Say if they should go too.
10. **Two payment services' merchant keys** (`TgPayCrypto-API-Token`, `x-wavepay-service-key`)
    are kept as key fields: they are API keys, not wallets.
