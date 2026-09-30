# CONNECTORS API contract (Toolkit › Connectors)

Source of truth for the Connectors backend and frontend streams. Decisions and operator answers:
`docs/superpowers/plans/connectors-decisions.md` (§3, §6). Build order:
`docs/superpowers/plans/connectors-build-plan.md`.

All `/api/connectors…` routes need a session (401 otherwise) and are owner-scoped: another
account's connection or agent answers exactly like an absent one (**404**), with a test per route.
Three routes are public because the browser that finishes a sign-in may hold no Tvashtr session
(Desktop opens the system browser): the OAuth callback, its confirm step, and the client metadata
document. Timestamps are ISO 8601 with offset. `detail` is a user-facing string unless shown as a
`{code, message, …}` object. Every change to an existing endpoint only **adds** fields.

Code: `backend/tvashtr/routes/connectors.py` (catalog, connections, agents),
`routes/connectors_oauth.py` (`router` for start, `public_router` for the three public routes),
`control_plane/connectors.py` (rules, grants), `connector_catalog.py` (Featured + registry
snapshot), `connector_oauth.py` (discovery, registration, tokens), `connector_net.py` (outbound
address guard and the only two HTTP clients), `connector_upstream.py` (MCP client to the
provider), `connector_proxy.py` + `tvashtr/mcp/connectors.py` (the run-time proxy), `node_tools.py`
(run config).

## Words

- **Catalog entry**: something you can connect. Featured (curated by Tvashtr) or from the bundled
  snapshot of the public MCP Registry, or a custom address. Identified by `key`.
- **Connection**: one account's sign-in to one catalog entry. One per `(owner, key)` in v1.
- **Grant**: a connection switched on for one agent, in `tool_config.tvashtr.connectors`.
- **Run token**: the only credential an agent's sandbox gets. It is signed by Tvashtr, names one
  run, one agent and one connection, and stops working when the run ends. The provider sign-in
  (refresh token, access token or key) never leaves the server.

## Data model: migration `0043_connector_connections` (one table)

`down_revision = "0042_domain_message_meta"`. Template: `0023_tool_skill_library.py`. Model
`ConnectorConnection` in `models.py`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `default=uuid.uuid4` |
| `owner_id` | uuid, not null | FK `users.id` (`fk_connector_connections_owner_id_users`), index `ix_connector_connections_owner_id` |
| `connector_key` | text, not null | catalog key; unique `(owner_id, connector_key)` → `uq_connector_connections_owner_key` |
| `name` | text, not null | display name |
| `slug` | text, not null | MCP server name in the agent's config, so also the tool-name prefix. `^[a-z0-9][a-z0-9-]{0,39}$`; unique `(owner_id, slug)` → `uq_connector_connections_owner_slug`. Fixed at creation |
| `url` | text, not null | the provider's MCP address, without Tvashtr-added query parameters |
| `transport` | text, not null, default `streamable-http` | check `ck_connector_connections_transport`: `streamable-http` \| `sse` |
| `auth_kind` | text, not null | check: `oauth` \| `api_key` \| `none` |
| `access` | text, not null, default `read` | check: `read` \| `write` (gate 1) |
| `scope` | JSONB, null | `{"value": "abcd1234", "label": "trade-mcp-prod · ap-southeast-1"}`; null = whole account |
| `status` | text, not null | check: `pending` \| `connected` \| `needs_signin` |
| `secret_encrypted` | text, null | Fernet (`credentials.encrypt_secret`) of the sign-in JSON below |
| `pending_encrypted` | text, null | Fernet of the in-flight sign-in (PKCE verifier and so on) |
| `state_hash` | text, null | `sha256(state)` hex of the in-flight sign-in; unique `uq_connector_connections_state_hash` |
| `tools` | JSONB, null | last tool list seen: `[{"name","title","read_only"}]` |
| `last_error` | text, null | user-facing reason for `needs_signin`, or why the last sign-in failed |
| `connected_at` | timestamptz, null | last successful sign-in or key check |
| `created_at`, `updated_at` | timestamptz | `server_default now()`, `onupdate now()` |

Encrypted JSON (never returned by any endpoint, never logged):
- `secret_encrypted`, `oauth`: `{"issuer", "client": {"client_id", "client_secret"?, "auth_method",
  "kind": "preregistered"|"cimd"|"dcr", "secret_expires_at"?}, "authorization_endpoint",
  "token_endpoint", "revocation_endpoint"?, "resource", "scope"?, "access_token",
  "refresh_token"?, "expires_at"?}`.
- `secret_encrypted`, `api_key`: `{"headers": {"Authorization": "Bearer …"}}` (final header values).
- `pending_encrypted`: `{"code_verifier", "issuer", "iss_supported", "authorization_endpoint",
  "token_endpoint", "revocation_endpoint"?, "resource", "scope"?, "client": {…}, "redirect_uri",
  "started_at"}`.
- `POST /api/connectors` already writes what discovery found into `pending_encrypted` (`issuer`,
  `iss_supported`, the endpoints, `resource`, `scope`; no `code_verifier`, no `client`, no
  `started_at`, and `state_hash` stays null), so the sign-in host is known before `oauth/start`.
  `oauth/start` repeats discovery and replaces it.
- `started_at`, `expires_at` and `secret_expires_at` are Unix seconds (numbers).

Why one table is enough:
- **Pending sign-in** lives on the row (`pending_encrypted` + `state_hash`). A signed cookie can't
  hold it: itsdangerous signs but doesn't encrypt, the verifier and a registered `client_secret`
  must stay secret, and on Desktop the browser that finishes isn't the one that started. Keeping it
  apart from `secret_encrypted` means "Sign in again" never clobbers a working sign-in until the
  new one succeeds.
- **Client registrations** are stored per connection inside the encrypted JSON, keyed by `issuer`
  (the spec requires credentials to be bound to the issuer). Reused on "Sign in again" when the
  issuer is unchanged. A shared per-issuer cache would be a second table; add it only if a provider
  rate-limits registration.
- **Calls** are `run_events` rows of a new `kind` (below). `run_events.payload` is JSONB, so no
  schema change.
- **Warnings** are `run_warnings` rows with `source_kind = "connector"` (free text since 0022).

## Shapes

**Catalog entry**
```json
{"key": "supabase", "name": "Supabase", "publisher": "Supabase", "featured": true,
 "reviewed": true, "category": "databases",
 "description": "Read tables, run read-only SQL and check logs in one project.",
 "website": "https://supabase.com", "host": "mcp.supabase.com",
 "auth": "oauth", "key_fields": [],
 "access_modes": ["read", "write"], "read_only_by": "provider",
 "scope_picker": {"param": "project_ref", "label": "Project"},
 "available": true, "unavailable_reason": null,
 "connection_id": null, "connection_status": null}
```
- `key`: a Featured id (`supabase`), a registry server name (`com.apify/apify-mcp-server`), or
  `custom:<host><path>` for a custom address. Keys travel in bodies and query strings, never in a
  path.
- `category`: `databases` | `docs` | `analytics` | `crm` | `work` for Featured; `null` for registry.
- `reviewed`: `true` only for Featured. The UI labels the rest "From the MCP Registry · not reviewed
  by Tvashtr".
- `auth`: `oauth` | `api_key` | `none` | `unknown`. Registry entries are `api_key` when the registry
  declares a secret or required header, else `unknown` (decided by discovery when you connect).
- `key_fields` (`api_key` only): `[{"id": "Authorization", "label": "API key", "hint": "Apify API
  token", "secret": true}]`. `id` is the header name. `hint` is the registry's description.
- `read_only_by`: what keeps a read-only connection read only, which is also what the UI says
  about it. `provider` (the provider's own URL flag, trusted on its own: Supabase) | `scopes`
  (the sign-in asks for read-only OAuth scopes, so the provider refuses a write itself: Google) |
  `annotations` (only tools the server marks `readOnlyHint: true`; Neon is here and gets its URL
  flag as well). Only `provider` changes which tools Tvashtr counts as reads: a `scopes` entry
  follows the annotation rule like an `annotations` one (see "Read or write").
- `website`: `null` unless it is an `https://` address.
- `access_modes`: `["read"]` when the connector can only read (Google in v1).
- `available: false` + `unavailable_reason: "coming_soon"` → the card shows "Coming soon" and can't
  be connected. Google Drive, Docs and Sheets are unavailable until both
  `TVASHTR_GOOGLE_OAUTH_CLIENT_ID` and `TVASHTR_GOOGLE_OAUTH_CLIENT_SECRET` are set; HubSpot is
  unavailable in v1.
- `connection_id` / `connection_status`: this account's connection to it, if any (`pending` rows
  are reported as `null`).

**Connection** (every connection endpoint)
```json
{"id": "7c1e…", "connector_key": "supabase", "name": "Supabase", "slug": "supabase",
 "publisher": "Supabase", "featured": true, "reviewed": true, "category": "databases",
 "host": "mcp.supabase.com", "auth_kind": "oauth",
 "signin_host": "api.supabase.com", "signin_host_differs": false,
 "access": "read", "access_modes": ["read", "write"], "read_only_by": "provider",
 "scope": {"value": "abcd1234", "label": "trade-mcp-prod · ap-southeast-1"},
 "scope_picker": {"param": "project_ref", "label": "Project"},
 "status": "connected", "signin_pending": false, "last_error": null,
 "tools": [{"name": "list_tables", "title": null, "write": false, "on": true},
           {"name": "execute_sql", "title": null, "write": false, "on": true}],
 "used_by": {"agent_count": 2, "team_count": 1},
 "connected_at": "2026-09-28T10:02:11.482+00:00",
 "created_at": "…", "updated_at": "…"}
```
- `status`: `connected` (UI "Ready"), `needs_signin` (UI "Needs attention"; `last_error` says why),
  `pending` (created, first sign-in not finished; only `GET /api/connectors/{id}` and the OAuth
  routes ever return it).
- `signin_pending`: a sign-in was started and hasn't finished or timed out (10 minutes), that is
  `state_hash` is set and `pending_encrypted.started_at` is under 10 minutes old. The
  frontend polls `GET /api/connectors/{id}` until it turns `false`, then reads `status` and
  `last_error`.
- `signin_host`: where the browser is sent to sign in (`null` for `api_key`/`none`): the host of
  `authorization_endpoint` in the sign-in in flight (`pending_encrypted`), else in the stored
  sign-in, else the issuer's host.
  `signin_host_differs` is `true` when it is not on the same site as `host` (`connector_net.site`,
  see Outbound address rules); the UI then shows the sign-in host prominently before continuing.
- `tools`: `null` until the first successful tool listing. `write` = Tvashtr counts the tool as a
  write (below). `on` = agents can call it at this connection's `access`.
- `used_by`: counted over the owner's **library** teams only, `agent`/`completion` nodes, like
  tools.
- `used_by_agents` (usage rows): always on `GET /api/connectors/{id}`. On the rows of
  `GET /api/connectors` it is filled only when `status` is `needs_signin` (the "sign-in expired"
  banner names the agents that lost it) and `null` otherwise.

**Usage row** (`used_by_agents`, PUT agents): `{"node_id", "role_name", "title", "team_id",
"team_name", "access"}`; `access` is the agent's effective access (`read` | `write`).

**Read or write** (one rule, `connector_catalog.is_write(entry, tool, access)`, used for
`tools[].write`, the run-time filter and the counts; `access` is the effective access):
- `read_only_by: "provider"` (Supabase) and access `read`: every tool the provider lists under its
  read-only flag is a read (the provider enforces it).
- Otherwise a tool is a read only when its MCP annotation has `readOnlyHint: true`. A missing
  annotation is a write. That includes `read_only_by: "scopes"` (Google): the read-only scopes
  stop a write at Google, and Tvashtr still offers an agent only the tools Google annotates as
  reads, so what the connection's page shows as "Off · write" is never offered.
- The provider's read-only parameter goes on the address whenever the entry has one and the access
  is `read`, whatever `read_only_by` says. **Neon gets both the flag and the annotation filter**:
  under `readonly=true` Neon hides its write tools but `run_sql` can still write (decisions §1),
  so in read mode an agent is offered only the Neon tools annotated read-only.

## Catalog

### `GET /api/connectors/catalog?q=&category=&offset=&limit=`
```json
{"items": [entry…], "total": 15036, "next_offset": 48,
 "categories": ["databases", "docs", "analytics", "crm", "work"]}
```
- Order: Featured first (catalog order), then registry entries by name. No network call: Featured
  is a module constant and the registry is a JSON Lines snapshot bundled in the repo.
- `q`: case-insensitive substring over name, publisher, description and host. `category`: one of
  `categories` (Featured only) or absent for everything.
- `limit` default 48, max 100. `offset` default 0. `next_offset` is `null` on the last page.
- A registry entry whose host is a Featured host is left out (the Featured card wins).
- Errors: 422 `limit must be between 1 and 100.`

Featured in v1 (availability as probed on 2026-09-30):

| Key | Category | Address | Read-only by | Scope picker | Available |
|---|---|---|---|---|---|
| `supabase` | databases | `https://mcp.supabase.com/mcp` | provider: `read_only=true` | `project_ref` | yes |
| `neon` | databases | `https://mcp.neon.tech/mcp` | annotations, plus provider: `readonly=true` | `projectId` | yes |
| `notion` | docs | `https://mcp.notion.com/mcp` | annotations | — | yes |
| `google-drive` | docs | `https://drivemcp.googleapis.com/mcp/v1` | scopes (`drive.readonly`) | — | needs the Google client |
| `google-docs` | docs | `https://docsmcp.googleapis.com/mcp/v1` | scopes (`documents.readonly`) | — | needs the Google client |
| `google-sheets` | docs | `https://sheetsmcp.googleapis.com/mcp/v1` | scopes (`spreadsheets.readonly`) | — | needs the Google client |
| `posthog` | analytics | `https://mcp.posthog.com/mcp` | annotations | — | yes |
| `mixpanel` | analytics | `https://mcp.mixpanel.com/mcp` | annotations | — | yes |
| `amplitude` | analytics | `https://mcp.amplitude.com/mcp` | annotations | — | yes |
| `hubspot` | crm | `https://mcp.hubspot.com/` | annotations | — | no (Coming soon) |
| `intercom` | crm | `https://mcp.intercom.com/mcp` | annotations | — | yes |
| `linear` | work | `https://mcp.linear.app/mcp` | annotations | — | yes |
| `sentry` | work | `https://mcp.sentry.dev/mcp` | annotations | — | yes |
| `atlassian` | work | `https://mcp.atlassian.com/v2/mcp` | annotations | — | yes |

## Connections

| Method + path | Body | Response | Errors |
|---|---|---|---|
| `GET /api/connectors` | — | `{"connections": [connection…]}` oldest first, `pending` rows left out; `needs_signin` rows carry `used_by_agents` | — |
| `POST /api/connectors` | below | 201, connection | below |
| `GET /api/connectors/{id}` | — | connection + `used_by_agents`, `recent_use`, `revoke_hint` | 404 `Connector not found.` |
| `PATCH /api/connectors/{id}` | `{"access"?, "scope"?, "name"?, "credentials"?}` | connection | 404; 409 and 422 below |
| `DELETE /api/connectors/{id}` | — | `{"removed_from_agents": 2, "revoked": true}` | 404 |
| `POST /api/connectors/{id}/check` | — | connection (fresh `tools`, `status`) | 404; 502 `unreachable` or `refused` |
| `GET /api/connectors/{id}/scope-options` | — | below | 404; 409 `no_scope`; 502 `unreachable` |

An unparseable, absent or foreign `{id}` is always 404 `Connector not found.` (same rule as
`toolkit.get_owner_tool_row`).

### `POST /api/connectors`
Body, one of:
- `{"key": "supabase", "access": "read"}` (a catalog entry)
- `{"key": "com.apify/apify-mcp-server", "access": "read", "credentials": {"Authorization": "apify_api_…"}}`
- `{"url": "https://mcp.acme.dev/mcp", "name": "Acme", "access": "read"}` (custom)

`access` defaults to `read`. What happens:
1. The entry is resolved. A `pending` row for the same key is reused; any other existing row is a
   409.
2. `auth: "api_key"` entries: `credentials` is required. Only ids declared in the entry's
   `key_fields` are accepted, and a value may not contain a carriage return or a line feed (it
   becomes a header). Each value is turned into its header (the registry's `value` template such
   as `Bearer {api_key}` when there is one; a bare value for an `Authorization` header with no
   template gets `Bearer ` in front). Tvashtr lists the server's tools with those headers. Success
   → `connected`, `tools` filled.
3. Everything else: Tvashtr runs MCP authorization discovery on the address (see OAuth).
   - Sign-in found → the row is created `pending` with `auth_kind: "oauth"` and `signin_host` set.
     Nothing is registered yet. Call `oauth/start` next.
   - No sign-in, and the server lists its tools without credentials → catalog entries become
     `connected` with `auth_kind: "none"`; a **custom** address is refused (`no_signin`).
   - No sign-in and the server wants credentials → `no_signin`.

Errors:
- 404 `{"code": "unknown_connector", "message": "We couldn’t find that connector."}`
- 409 `{"code": "already_connected", "message": "Supabase is already connected.", "connection_id": "…"}`
- 409 `{"code": "coming_soon", "message": "Google Drive isn’t available yet."}`
- 422 `{"code": "invalid_url", "message": "Use an https:// address, like https://mcp.example.com/mcp."}`
  (also: any scheme other than `https`, and an address that resolves to anything but a public
  address; see Outbound address rules)
- 422 `{"code": "invalid_access", "message": "Google Drive can only be connected read only."}`
- 422 `{"code": "key_required", "message": "Apify needs a key.", "fields": [key field…]}`
- 422 `{"code": "key_rejected", "message": "Apify didn’t accept the key."}` (the server answered
  401 or 403; nothing stored)
- 422 `{"code": "invalid_key", "message": "That isn’t a key Apify takes. Check it and try again."}`
  (an id that isn't one of `key_fields`, or a value with a line break; nothing stored)
- 422 `{"code": "no_signin", "message": "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the key as a secret."}`
- 422 `{"code": "cannot_register", "message": "Acme needs an app registered with it before Tvashtr can sign in."}`
  (sign-in found, but no pre-registered client, no client metadata document support, no dynamic
  registration; or the server doesn't advertise PKCE S256)
- 502 `{"code": "unreachable", "message": "We couldn’t reach mcp.acme.dev. Try again."}`

### `GET /api/connectors/{id}` extras
```json
{"used_by_agents": [usage row…],
 "recent_use": [{"run_id": "…", "run_number": 42, "agent": "Reviewer", "reads": 6, "writes": 0,
                 "at": "2026-09-30T10:04:12+00:00"}],
 "revoke_hint": "To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings."}
```
`recent_use`: up to 10 rows, newest first, one per run and agent, read from `connector_call` events
of the owner's last 30 runs.

### `PATCH /api/connectors/{id}`
- `access`: `read` | `write`. 422 `invalid_access` when the mode isn't in `access_modes`. Narrowing
  to `read` applies at once, also to a run that is going.
- `scope`: `{"value", "label"}` or `null`. 409 `{"code": "no_scope", …}` when the connector has no
  `scope_picker`. `value` must match `^[A-Za-z0-9_.-]{1,80}$`, else 422
  `{"code": "invalid_scope", "message": "That doesn’t look like a project id."}` (it becomes a query
  parameter of the provider address). `label` is display text (≤ 120 characters).
- `name`: 1–60 characters. The `slug` never changes, so tool names stay stable.
- `credentials` (`api_key` only): replaces the key after the same rules and the same check as POST
  (`invalid_key`, `key_rejected`); a rejected key stores nothing and leaves the status alone. 409
  `{"code": "not_api_key", …}` otherwise. The write takes the row lock (see Tokens).

### `DELETE /api/connectors/{id}`
In one transaction, holding the row lock (see Tokens): removes the grant from every library-team
agent (`removed_from_agents` = agents that had it), then deletes the row. Before that, a
best-effort RFC 7009 revoke at the provider's `revocation_endpoint` (`revoked` says whether it
answered 2xx; a failure never blocks the delete).

Run snapshots are never edited, so their grants stay and now point at nothing. A run that is going
gets tool errors from that connector from then on and finishes without it; a later round of that
run, or a saved node that still names the id, skips it with the warning `it was disconnected`.

### `POST /api/connectors/{id}/check`
Makes sure the sign-in still works (refreshing the token if needed) and re-lists the tools.
- Success → `connected`, fresh `tools`, `last_error: null`.
- The provider answers **401**, or the refresh is refused → 200 with `status: "needs_signin"` and
  `last_error`.
- The provider answers 403 (or another 4xx). That is not an expired sign-in: status unchanged, 502
  `{"code": "refused", "message": "Supabase refused the request."}`.
- The provider not answering (network error, timeout, 5xx) → 502 `unreachable`, status unchanged.

### `GET /api/connectors/{id}/scope-options`
```json
{"param": "project_ref", "label": "Project", "manual": false,
 "options": [{"value": "abcd1234", "label": "trade-mcp-prod", "detail": "ap-southeast-1"}]}
```
Calls the provider's own project-listing tool (`list_projects` for Supabase and Neon) on the
unscoped address and reads `id`/`name`/`region` from its JSON answer. When that answer can't be
read: `{"manual": true, "options": []}` and the UI asks for the id in a text field.

## OAuth (MCP authorization, spec revision 2026-07-28)

Tvashtr's backend is the OAuth client. One redirect address for every connector:
`{TVASHTR_PUBLIC_BASE_URL}/api/connectors/oauth/callback`. Never `request.base_url` and never the
frontend origin (on Desktop that is `127.0.0.1`).

**Discovery** (at `POST /api/connectors`, repeated at `oauth/start`):
1. Protected-resource metadata: the `resource_metadata` address from an unauthenticated request's
   `WWW-Authenticate` header, else `/.well-known/oauth-protected-resource<path>`, else the root
   `/.well-known/oauth-protected-resource`. Several servers answer 405 or 404 to a GET, so the
   well-known addresses are tried whatever the first request returns. The first request is a
   `GET` with no credentials. Only a failure to connect on it is `unreachable` at once; any other
   outcome (a 405, a 5xx, a stream that stays open until the deadline) moves on. A metadata
   address that isn't one Tvashtr opens, or a document that isn't a JSON object with a `resource`
   and at least one `authorization_servers` entry, is skipped.
2. Authorization-server metadata for `authorization_servers[0]`, in the spec's order (path-style
   issuers included). When step 1 found nothing: the MCP origin's own
   `/.well-known/oauth-authorization-server` (Intercom).
   What discovery answers: a sign-in, or "no sign-in" when neither document was found, or
   `cannot_register` when resource metadata names a sign-in server whose metadata can't be read,
   or `unreachable` when nothing answered at all (or the MCP address itself isn't one Tvashtr
   opens).
3. Checks: the metadata's `issuer` equals the issuer the address was built from (compared as raw
   strings, never through a URL type; **one trailing slash is not a difference**, because Google's
   resource metadata names `https://accounts.google.com/` and its server metadata says
   `https://accounts.google.com`. The server's own spelling is the issuer that is stored and that
   the callback's `iss` is compared with); `code_challenge_methods_supported` is a list that
   contains `S256`; the
   resource metadata's `resource` covers the MCP address (`check_resource_allowed`); every endpoint
   passes `connector_net.check_url` (`https://`, a public address, no user name or backslash).
   Everything in either document is untrusted: a value of the wrong type, or one that can't be
   read as an address, is `cannot_register` (never a 500), and a document nested too deep to
   parse is skipped like one that isn't JSON.
   `scope` is the 401's `scope`, else the resource metadata's `scopes_supported`, else the
   sign-in server's, else nothing.
4. Mix-up check: `authorization_endpoint`, `token_endpoint` and `registration_endpoint` must be on
   the issuer's site (its registrable domain, `connector_net.site`), else 422 `cannot_register`. A
   `revocation_endpoint` somewhere else is ignored. Without this rule a custom server could name a
   real provider's authorize page next to its own token endpoint and be sent the code and the PKCE
   verifier. A Featured entry can pin extra endpoint hosts (`oauth_hosts`; Google's token endpoint
   is on `oauth2.googleapis.com`). A registry or custom entry never can.

**Client** (at `oauth/start`, first match):
1. Pre-registered: only Featured entries that name one (`google`), only on their pinned address.
   Never offered to a registry or custom address. Its secret is read from the settings whenever
   it is sent and is not stored on the connection (`client` then has no `client_secret`).
2. Client ID metadata document, when the server advertises
   `client_id_metadata_document_supported` and `TVASHTR_PUBLIC_BASE_URL` is `https://`.
3. Dynamic registration (`registration_endpoint`): `client_name`, `redirect_uris`, `grant_types`,
   `response_types`, `scope` (when discovery found one), `application_type: "web"` (`"native"`
   when the redirect address isn't `https://`, that is local development: a server that holds
   web clients to https redirects would refuse it),
   `token_endpoint_auth_method` `none` when the server lists it, else `client_secret_post`, else
   `client_secret_basic` (Supabase, Vercel). A stored registration is reused when it was made
   with the same `issuer` **and for the same redirect address** (the stored `client` of a
   registration also carries `redirect_uri`) and its secret hasn't expired; it is looked for in
   the sign-in in flight and in the stored sign-in. A refused registration (any 4xx, or an
   answer without a `client_id`) is `cannot_register`. From the reply, `client_secret` and
   `token_endpoint_auth_method` are kept only when they are strings and
   `client_secret_expires_at` only when it is a number.
4. None of these → 422 `cannot_register`.

### `POST /api/connectors/{id}/oauth/start`
No body. Works on a `pending`, `needs_signin` or `connected` row ("Sign in again").
```json
{"authorize_url": "https://api.supabase.com/v1/oauth/authorize?response_type=code&client_id=…",
 "signin_host": "api.supabase.com", "expires_in": 600}
```
Stores `pending_encrypted` and `state_hash` under the row lock (see Tokens); `status` is not
changed. The authorize address carries
`response_type=code`, `client_id`, `redirect_uri`, `state` (`secrets.token_urlsafe(32)`),
`code_challenge` + `code_challenge_method=S256`, `resource` (the metadata's value, verbatim) and
`scope` (the 401's `scope`, else `scopes_supported`, else left out; Featured entries may pin it, as
Google's read-only scopes do). A Featured entry on its pinned address may also name extra
parameters for its provider's authorize page (`authorize_params`; Google hands out a refresh
token only with `access_type=offline`).
`authorize_url` is always an `https://` address (`http://` only under
`TVASHTR_CONNECTORS_ALLOW_LOCAL`). The web app and Desktop check that again before they open it.
`signin_host` is the host of `authorize_url`, and the client holds the server to it: it reads the
host out of `authorize_url` the way a browser does (`new URL`), and refuses the answer when that
host isn't `signin_host` or when the address carries a user name or password. So the host that is
shown is always the host the window opens.
Errors: 404; 409 `{"code": "not_oauth", "message": "This connector doesn’t sign in."}` (the row
isn't `oauth`, or its server no longer offers a sign-in); 422 `cannot_register`; 502
`unreachable`. Nothing is stored on any of them.

### `GET /api/connectors/oauth/callback?state=&code=&iss=&error=` (public)
Always answers an HTML page (200), never JSON and never a redirect into the app. The owner comes
from the row found by `sha256(state)`, not from a cookie. Every page from this route and from the
confirm route is sent with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
`X-Frame-Options: DENY` (the address carries `code` and `state`).

1. No row for `state`, or `started_at` older than 10 minutes → page "This sign-in link has expired.
   Go back to Tvashtr and try again." Finding the row does not use the `state` up; only steps 3
   and 4 and Complete do.
2. `iss`: when present it must equal the stored issuer exactly; when absent the sign-in is refused
   only if the server advertised `authorization_response_iss_parameter_supported`. On a mismatch
   nothing else in the request is acted on (not `error` either) and nothing is written: the page
   says "Supabase didn’t finish the sign-in. Try again." and the row is left as it was.
3. `error` present (for example `access_denied`) → the in-flight sign-in is cleared, `last_error`
   = "You didn’t allow access on Supabase.", page says the same. A callback with neither `error`
   nor `code` is cleared the same way, with the "didn’t finish the sign-in" line.
4. A `tv_session` cookie is present (a cookie that doesn't read as a session counts as none):
   - it is the row's owner → complete (below);
   - it is another account → in-flight sign-in cleared, `last_error` = "That browser is signed in
     to Tvashtr as a different account. Nothing was connected." (so the app's poll has a reason
     to show), page "This browser is signed in to Tvashtr
     as a different account. Nothing was connected. Log out of Tvashtr in this browser, then start
     the sign-in again." (After logging out, the retry takes step 5. Without this line a Desktop
     user whose browser holds another account has no way through.)

   "Cleared" (steps 3 and 4) is one transaction: `UPDATE connector_connections SET state_hash =
   NULL WHERE state_hash = :h RETURNING id`, then `last_error`, and `pending_encrypted` loses its
   `code_verifier` and `started_at`. What discovery found and the `client` stay there, so
   `signin_host` still reads right on a row that was never connected and the next `oauth/start`
   reuses the registration.
5. No `tv_session` cookie (Desktop's browser) → a confirm page: "Connect Supabase to the Tvashtr
   account asha@example.com?" with one button that posts `state`, `code` and `iss` to the confirm
   route. The page shows the owner's **full** email: a masked one (`a•••@example.com`) is matched
   by any account an attacker registers. Showing the page does not use the `state` up. This stops
   someone sending you their own sign-in link to capture your data in their account.

### `POST /api/connectors/oauth/confirm` (public, form-encoded `state`, `code`, `iss`)
Repeats steps 1–2, then completes. Answers the same HTML pages.

**Complete** (both routes): the `state` is used up first, in one statement:
`UPDATE connector_connections SET state_hash = :claim WHERE state_hash = :h RETURNING id`. No row
back → the "expired" page and nothing else happens, so a `state` works once and two callbacks that
arrive together make one code exchange. `:claim` is the hash of a fresh random value that nobody
is ever given, not `NULL`: `signin_pending` is read from `state_hash`, and the app polls it and
reads the outcome the moment it turns false. With `NULL` the row would say "not pending, not
connected, no error" for as long as the code exchange and the tool listing take. Then the code is
exchanged
(`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`, `resource`,
plus client authentication for a registered secret), and on success the tools are listed with the
new token. Whatever goes wrong in the exchange (no answer, an answer that can't be read, anything
unexpected) is a failure, never a 500: the write below always runs, so the claim is always
cleared. An `expires_in` that isn't a usable number (`1e999`) is no expiry. Then, under the row lock (see Tokens), everything is written at once. Success →
`secret_encrypted` written, `status: "connected"`, `connected_at` now, `last_error` null, `tools`
set (a failed listing leaves `tools` as it was, `null` on a first sign-in, and doesn't fail the
sign-in), `pending_encrypted` and `state_hash` cleared. Page: "Supabase is
connected. You can close this window." and a `window.close()` (closes the web popup; a normal
browser tab stays open with the message). Failure → `last_error` = "Supabase didn’t finish the
sign-in. Try again.", status and the stored sign-in unchanged, the in-flight sign-in cleared as in
steps 3 and 4, page says the same. When the token endpoint refused the client itself (a 401, or
the `error` `invalid_client` or `unauthorized_client`), the cleared sign-in also records the
client's id as `refused_client`, so the next `oauth/start` registers again instead of reusing it
(from the cleared sign-in or from the stored one, which is still left as it was). When `state_hash` is no longer the claim at that write (a newer
`oauth/start` ran while the code was exchanged), the newer sign-in's `state_hash` and
`pending_encrypted` are left alone. A connection disconnected meanwhile gets the failure page.

### `GET /oauth/client-metadata.json` (public)
```json
{"client_id": "https://tvashtr.fly.dev/oauth/client-metadata.json", "client_name": "Tvashtr",
 "client_uri": "https://tvashtr.fly.dev",
 "redirect_uris": ["https://tvashtr.fly.dev/api/connectors/oauth/callback"],
 "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
 "token_endpoint_auth_method": "none"}
```
Built from `TVASHTR_PUBLIC_BASE_URL`. 404 when that isn't `https://` (local development then uses
dynamic registration).

### Tokens
- `ensure_access_token(connection_id, *, rejected=None) -> str`: returns the stored access token
  when it has more than 5 minutes left (or no expiry) and it is not `rejected` (the token a
  provider just answered 401 to). Otherwise refreshes (`grant_type=refresh_token`, `refresh_token`,
  `client_id`, `resource`, client authentication) **under `SELECT … FOR UPDATE` on the row** and
  commits the rotated refresh token before anyone uses the new access token. A reply without a new
  refresh token keeps the old one. When `rejected` is given and the stored token is already a
  different one (someone else refreshed), that one is returned without a network call (unless it
  is itself within five minutes of expiring, which is an ordinary refresh).
- **One lock for every writer of the sign-in.** Refresh, Complete, `oauth/start`, `PATCH`
  credentials and `DELETE` all take `SELECT … FOR UPDATE` on the row, and read the stored sign-in
  only after they hold it. Otherwise a refresh that started earlier commits the old sign-in over a
  new one. A refresh that finds the row gone raises `SignInRefused` and writes nothing.
- A refusal is the token endpoint's own: a 4xx answer whose JSON body names the OAuth `error`.
  `invalid_grant`, or no refresh token and an expired (or `rejected`) access token → tokens
  cleared, `status: "needs_signin"`, `last_error` = "Its sign-in expired." Raises `SignInRefused`.
  What stays in `secret_encrypted` is the issuer, the endpoints and the registration, so the
  sign-in host still shows and "Sign in again" reuses the client.
- `invalid_client` or `unauthorized_client` → the same, and the stored registration is dropped so
  the next sign-in registers again. A sign-in in flight (or the last one cleared) may hold that
  same registration in `pending_encrypted`: it gets `refused_client` (the client's id), and
  `oauth/start` never reuses a registration whose id either of the row's sign-ins names there.
- Every other answer → `Unreachable`: the connector is left out of what asked for it, and the
  status and the stored sign-in are unchanged. That is a 5xx, a 429, a network error, a 200 that
  carries no token, a redirect (never followed), a 2xx other than 200, and a 4xx that isn't one
  of the refusals above (a gateway's 403 page, a 404, a 408, a 400 or 401 with no OAuth `error`,
  any other `error` code). A working refresh token is only given up when the provider says it is
  dead: a passing fault in front of the token endpoint must not make everyone sign in again.
- A row with no stored sign-in at all (never signed in, or already cleared) raises `SignInRefused`
  and is not touched: a `pending` row stays `pending`.
- `revoke(connection_id)` posts the refresh token (the access token when there is none) to the
  `revocation_endpoint` with the client's authentication. It reads the row without locking it and
  writes nothing, so a disconnect may call it before or while it holds the row lock.

### Outbound address rules (`connector_net`)
Every address the backend fetches for a connector comes from outside: the MCP address, metadata
addresses, registration, token and revocation endpoints, and every proxied call. All of it goes
through `connector_net.client()` (sync) or `connector_net.async_client()` (the MCP client to the
provider). No other code builds an HTTP client for connector traffic.
- No space, control character, backslash or user name (`user@host`) anywhere in the address. Those
  are where Python and a browser read a different host out of one string
  (`https://evil.example\@accounts.google.com/` is `accounts.google.com` to Python and
  `evil.example` to a browser).
- `https://` only. The host is resolved once and every address it resolves to must be public:
  `ipaddress.ip_address(a).is_global` and not multicast. An IPv4-mapped (`::ffff:a.b.c.d`) or
  NAT64 (`64:ff9b::/96`) IPv6 address is judged by the IPv4 address inside it; any other IPv6
  address must be global unicast (`2000::/3`), because `is_global` alone passes the
  IPv4-compatible, IPv4-translated, site-local and multicast forms. That refuses loopback,
  private, link-local and unique-local ranges (which covers Fly's `fdaa::/16`), carrier-grade NAT
  (`100.64.0.0/10`) and `0.0.0.0`.
- **The address that was checked is the address connected to.** The client sends the request to the
  validated IP, keeps the `Host` header and sets the TLS server name (`sni_hostname`) to the
  original host, so the certificate is still checked against the name. The name is never resolved
  a second time. That closes DNS rebinding (a host that answers a public address for the check and
  a private one for the connection).
- No redirects followed. 10 s for a sign-in call and for listing tools, 120 s for a proxied tool
  call. Each is a deadline for the whole exchange, not httpx's per-read timeout (a server that
  sends a byte every few seconds would otherwise hold a worker for as long as it liked).
- What a provider sends back is bounded. Both clients send `Accept-Encoding: identity` and refuse
  an answer that carries a `Content-Encoding` (httpx would inflate it in memory: 65 KB of gzip is
  64 MB). `client()` reads at most 1 MB of an answer; `async_client()` cuts a body off at 10 MB;
  `list_tools` follows at most 50 pages. Each of these is "didn’t answer" to the caller
  (`UnsafeResponse`, an `httpx.TransportError`; `UpstreamUnreachable` from the MCP client).
- `TVASHTR_CONNECTORS_ALLOW_LOCAL=1` also allows `http://` and non-public addresses, for local
  development and the e2e fake server. It never allows a third scheme (`javascript:`, `file:`,
  `data:`), and it is ignored when `hosted_mode` is on.
- **Same site** (`connector_net.site(host)`, used by the mix-up check and `signin_host_differs`):
  the last two host labels; three when the last label has two letters and the one before it is
  `co`, `com`, `org`, `net`, `ac`, `gov` or `edu` (`acme.co.uk`); the whole host under a
  shared-hosting suffix (`vercel.app`, `netlify.app`, `pages.dev`, `workers.dev`, `fly.dev`,
  `github.io`, `herokuapp.com`, `onrender.com`, `web.app`, `run.app`, `azurewebsites.net`,
  `amazonaws.com`, `cloudfront.net`); the whole host for an IP address.
- The two clients take no proxy or credentials from the environment (`trust_env` off).

## Agents (grants)

**On the node** (saved through the existing node PATCH, like Domains):
```json
{"tool_config": {"tvashtr": {"connectors": [{"id": "7c1e…", "access": "read"}]}}}
```
`access` absent = `read`. The agent's effective access is `write` only when the connection's
`access` **and** the grant's `access` are both `write`. An empty list is removed by the frontend's
`tidy()`. An id that is not the owner's connection is skipped at run time with a warning.

### `GET /api/connectors/{id}/agents`
```json
{"teams": [{"team_id": "…", "team_name": "Indicator sprint team", "agents": [
  {"node_id": "…", "role_name": "Reviewer", "title": "Reviewer", "kind": "agent",
   "edits_allowed": false, "enabled": true, "access": "read", "subscription": null}]}]}
```
Library teams oldest first, agents left to right, `agent`/`completion` nodes only. `enabled` = has
the grant. `access` = the grant's access (`null` when not enabled). `subscription` = `claude` |
`grok` when the agent runs on a connected Desktop plan (connectors don't reach it yet), else
`null`. 404 `Connector not found.`

### `PUT /api/connectors/{id}/agents`
Body `{"node_ids": ["…"]}`: the full set of agents that should have it afterwards. A listed agent
without the grant gets `{"id", "access": "read"}`; a listed agent keeps the access it has; an
unlisted agent loses the grant.
```json
{"agents": [usage row…], "agent_count": 2, "team_count": 1}
```
Errors: 404 `Connector not found.`; 404 `Agent not found.` (any id that isn't the owner's
library-team agent; nothing is written); 409 `{"code": "not_connected", "message": "Finish
connecting Supabase first."}` for a `pending` row.

## Toolkit summary (additive)

### `GET /api/toolkit/summary`
```json
{"tools": 3, "tools_needing_attention": 1, "skills": 3,
 "memory": {"inbox": 2, "active": 14, "archive": 5}, "secrets_missing": 1,
 "connectors": 4, "connectors_needing_attention": 1}
```
`connectors` = rows that are `connected` or `needs_signin`. `connectors_needing_attention` =
`needs_signin` rows. The nav shows the first as the Connectors count and the second as "N to fix".

## Run time

### What `build_mcp_config` emits
Signature gains one optional keyword: `build_mcp_config(tool_config, run_id, *, node_id=None)`.
`team_run.agent_run_step` passes `node_id`. Without `tvashtr.connectors` the output is byte-for-byte
what it is today. It runs inside the `agent_run_step` DBOS step; nothing it produces is
checkpointed.

For each grant, in order, after the inline and library servers and before Domains:
1. Load the owner's row. Gone, another account's, or `pending` → warning, skip.
2. `needs_signin` → warning, skip.
3. `oauth`: `ensure_access_token`. Refused → the row becomes `needs_signin`, warning, skip. Not
   reachable → warning, skip, status unchanged.
4. Emit one server:
```json
{"mcpServers": {"supabase": {"url": "https://tvashtr.fly.dev/mcp/connectors",
   "headers": {"Authorization": "Bearer <run token>"}}}}
```
Every skip in steps 1–3 writes its warning and a `connector_skipped` event (below).

The server name is the row's `slug`; when an inline or library server already has that name the
connector takes `conn-<slug>`. The address comes from the same helper as Domains (in docker mode a
localhost base is rewritten to the docker host).

**Run token**: `URLSafeTimedSerializer(session_secret, salt="tvashtr.connector-run")` over
`{"r": run_id, "n": node_id, "c": connection_id, "a": "read"|"write"}`. It is accepted when the
signature is good, it is under 14 days old, the run exists, belongs to the connection's owner and
is not in `run_views.TERMINAL_STATUSES`, and the connection exists and isn't `pending`. `a` is the
grant's access; the proxy applies the lower of `a` and the row's current `access` on every request.
A warm sandbox that keeps its first-round config across rounds keeps working, because the token
does not expire with the provider's token.

### The proxy: `POST {public base}/mcp/connectors`
A streamable-HTTP MCP server inside the backend (stateless, JSON replies), mounted next to
`/mcp/domains`. The agent's sandbox talks only to it. The MCP SDK's localhost-only `Host` check is
off for this mount (agents call it by the public or docker host; the run token authorizes every
request). The address has no trailing slash and is answered as written: the path has its own
route next to the mount (`mount_connectors_mcp`), because a mount alone only matches
`/mcp/connectors/…` and the app's page catch-all would answer the bare path 405.
- **`tools/list`**: the provider's tools that are reads for this token's effective access (all of
  them when it is `write`). Descriptions are capped at 2,000 characters; `outputSchema` is dropped.
  The provider gets 10 s to answer. A bad token, an unreachable provider or a provider that is too
  slow answers an empty list, never an error (one failing server must not stop the agent from
  starting); the unreachable and too-slow cases also write a warning.
- **`tools/call`**: a tool that isn't allowed returns a tool error "Linear is read only for this
  agent. create_issue can change data, so it’s off." Otherwise the call is forwarded with the
  provider credential added server-side, and its result returned as-is.
- **Provider address**: the row's `url`, plus the scope parameter when `scope` is set, plus the
  provider's read-only parameter when the effective access is `read` and the entry has one. It is
  built with `urllib.parse.urlencode`; a parameter of the same name already in the address is
  replaced, and the read-only parameter goes last. The agent can't change either.
- **Only a provider `401` means the sign-in expired**: one `ensure_access_token(rejected=<that
  token>)` and one retry; still 401 → `needs_signin`, a warning, and a tool error "Supabase needs
  you to sign in again." A `403` (or any other error status) goes back to the agent as a tool
  error and changes nothing: no refresh, no `needs_signin`.
- Every `tools/call` (allowed, refused or failed) writes one `connector_call` event.
- The proxy's database and token work runs in worker threads, never on the server's event loop, so
  one slow token refresh can't stall other agents' calls.

### Warnings
`run_warnings` rows with `source_kind: "connector"`, shown by `GET /api/runs/{id}/graph` in
`resolution_warnings` (shape unchanged: `{source_kind, name, reason}`). `name` is the connection's
name. The UI renders "Ran without `<name>`: `<reason>`." with an "Open Connectors" button. The same
line is shown on the round it happened in, from `skipped` (see Rounds), with a "Sign in" button.

| `reason` | When |
|---|---|
| `its sign-in expired` | `needs_signin` at run start, a refused refresh, or a 401 that a refresh didn't fix |
| `its key stopped working` | the same for an `api_key` connection |
| `it was disconnected` | the grant names a row that is gone (`name` = `a connector`) |
| `we couldn’t reach it` | the token endpoint or the provider didn't answer |

**Desktop plan agents** (Claude or Grok plan): unchanged behaviour, `mcp_config = {}`. The existing
`("tools", …)` warning's name list gains `N connector(s)`.

## What a run shows

### `connector_call` events (`GET /api/spike/run-events/{run_id}`, additive `kind`)
```json
{"seq": 1000000003, "kind": "connector_call", "created_at": "2026-09-30T10:03:41+00:00",
 "invocation_id": 9123, "node_id": "…", "iteration": 2,
 "payload": {"connection_id": "7c1e…", "connector": "Supabase", "slug": "supabase",
             "tool": "execute_sql", "write": false, "ok": true, "blocked": false,
             "arg": "SELECT count(*) FROM indicator_values WHERE name = 'rsi_14'",
             "duration_ms": 312, "result_url": null}}
```
- Written by the proxy, so the connector, the tool and read/write are authoritative (they don't
  depend on how the engine prefixes tool names).
- `invocation_id` = the latest `agent_invocations` row for the token's run and node (the round
  that is running); `null` when the token has no node.
- `seq` = `1_000_000_000 + n`, its own band per invocation (the same trick as the Desktop runner's
  band), so it never collides with the engine's own events.
- `arg`: the first string argument, preferring `query`, `sql`, `q`, `title`, `name`; ≤ 200
  characters. Full arguments and results are not stored here.
- `result_url`: for a write, the first `https://` address in the result text, else `null`.
- `blocked: true` = refused by the read-only rule (`ok` is then `false`).
- The engine's own `action`/`observation` events for the same call are unchanged. The Activity feed
  skips `connector_call` and `connector_skipped` rows so a call isn't shown twice.
- The endpoint orders by `seq`, so these rows come after all of the engine's events.

### `connector_skipped` events (same endpoint, additive `kind`)
```json
{"seq": 1000000000, "kind": "connector_skipped", "invocation_id": 9123, "node_id": "…",
 "iteration": 2,
 "payload": {"connection_id": "9d2a…", "connector": "Notion", "reason": "its sign-in expired"}}
```
Written together with every connector warning (one helper writes both), so a round knows which
connectors it ran without: by `build_mcp_config` when it skips a grant, and by the proxy when a
401 survives a refresh or the provider can't be reached. Same `invocation_id` rule and same `seq`
band as `connector_call`. `connection_id` is `null` when the row is gone (`connector` is then
`a connector`). `reason` is one of the Warnings table's values.

### Rounds (additive `connectors` on each round)
Added to each round of `GET /api/teams/{team_id}/nodes/{node_id}/runs` (the Team drawer's Runs tab)
and to each invocation of `GET /api/runs/{id}/graph` (the run drawer):
```json
{"connectors": {
  "used": [{"connection_id": "7c1e…", "name": "Supabase", "slug": "supabase", "reads": 6, "writes": 0}],
  "calls": [{"connection_id": "7c1e…", "name": "Supabase", "tool": "execute_sql", "write": false,
             "ok": true, "blocked": false, "arg": "SELECT …", "at": "2026-09-30T10:03:41+00:00",
             "duration_ms": 312, "result_url": null}],
  "total_calls": 7,
  "skipped": [{"connection_id": "9d2a…", "name": "Notion", "reason": "its sign-in expired"}]}}
```
`connectors` is `null` only for a round with no calls and nothing skipped; a round that only
skipped a connector has `used: []`, `calls: []`, `total_calls: 0` and `skipped` filled. `used` is
ordered by first call. `calls` lists writes first, then by time, capped at 50 (`total_calls` is the
real number). Blocked calls are in `calls` but not in the `reads`/`writes` counts. `skipped` comes
from the round's `connector_skipped` events, one entry per connection and reason; the UI renders
"Ran without Notion: its sign-in expired." with a "Sign in" button that opens that connection
("Open Connectors" when `connection_id` is `null`).

## Settings (`config.py`, all optional)

| Env | Field | Default | Meaning |
|---|---|---|---|
| `TVASHTR_GOOGLE_OAUTH_CLIENT_ID` | `google_oauth_client_id: str` | `""` | with the secret, turns the three Google cards on |
| `TVASHTR_GOOGLE_OAUTH_CLIENT_SECRET` | `google_oauth_client_secret: SecretStr` | `""` | |
| `TVASHTR_CONNECTORS_ALLOW_LOCAL` | `connectors_allow_local: bool` | `false` | development and e2e only; ignored in hosted mode |

Existing settings used: `public_base_url` (redirect address, client metadata document, proxy
address), `session_secret` (run tokens), `secret_key` (Fernet), `hosted_mode`.

## Not in v1
- Google Analytics by key file and a Tvashtr-hosted CleverTap server (decisions §6 C): a tool with
  no remote server goes through Tools.
- One Google sign-in for Drive, Docs and Sheets together (each connects on its own).
- Narrowing OAuth scopes for read-only on providers other than Google; a second account of the same
  connector; per-call approval of writes; connectors on Claude or Grok plan agents.
- Three things the canvas draws and no field carries: the provider account's name on a connected row
  ("Organization lazyx"; MCP sign-in doesn't return one, the scope `label` stands in), a Neon
  branch picker (only `projectId` is scoped), and the connect sheet's capability bullets (the sheet
  shows the entry's `description`).
