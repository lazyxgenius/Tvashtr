# Connectors — research and product decisions (v1)

Status: **approved 2026-09-30 with the operator's answers in §6 — build in progress.** The flow is on the Claude Design canvas
(https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK), pages **Connectors** and **Connectors flows**
(version 1790744560-a034): 8 screens + 12 flows / 37 screens.

## 1. Research — the operator's targets

Source: the MCP registry that Claude's connector directory is built from (`search_mcp_registry`), plus vendor docs.

| Target | Official MCP server | Where it runs | Sign-in | Read-only control |
|---|---|---|---|---|
| Supabase | Yes — `https://mcp.supabase.com/mcp` (in Claude's directory) | Remote | OAuth with dynamic client registration (PAT also works) | `read_only=true` (SQL runs as a read-only Postgres user), `project_ref=` scopes to one project |
| Neon | Yes — `https://mcp.neon.tech/mcp` (in Claude's directory) | Remote | OAuth (untick "Full access" → read-only) or API key as `Authorization: Bearer` | `readonly=true`, `projectId=`. Read-only hides write tools; `run_sql` can still write → a read-only DB role is the strict answer |
| Google Drive / Docs / Sheets | Yes — `drivemcp` / `docsmcp` / `sheetsmcp.googleapis.com/mcp/v1` (in Claude's directory) | Remote | Google OAuth, **no dynamic client registration** → needs Tvashtr's own Google Cloud OAuth client | OAuth scopes (read-only scopes) |
| Google Analytics | Yes — `googleanalytics/google-analytics-mcp` (Google, experimental) — **not** in Claude's directory | **Local only** (pipx/uvx) | Google credentials: a service-account JSON key works (ADC) | Read-only by design (reports only) |
| CleverTap | **No official server.** Community ones (`ralphcorleone/clevertap-mcp`, …) or aggregators (Pipedream, Zapier) | — | Account ID + passcode + region | — |

Also in Claude's directory, same shape (remote + OAuth) and in the v1 catalog: Notion, HubSpot, Linear,
Sentry, PostHog, Mixpanel. (Also there, not in v1: Slack, Stripe, Salesforce, Atlassian, Amplitude,
PlanetScale, Microsoft 365 — they can come in later, or by the custom-connector path.)

## 2. What Tvashtr has today (main 389ab84)

- Toolkit › Tools = `tool_library` rows (one MCP server each; static headers with `${SECRET}`), granted per
  agent through `tool_config.tvashtr.library`. At run time, `build_mcp_config` merges them into the OpenHands
  `mcp_config` and fills `${SECRET}` from Fernet-encrypted `mcp_secrets`. A missing secret drops that server
  and writes a `run_warnings` row.
- There is **no OAuth for MCP servers** yet, no connector concept, and no dedicated "tool was called" event.
  MCP calls show in the feed as `tool_name`.
- Agents on a Desktop subscription (Claude/Grok plan) get `mcp_config = {}` today, so no tools reach them.
- Domains access is a per-agent checklist (`tool_config.tvashtr.domains`), which is the pattern reused here.

## 3. Decisions (and why)

1. **Where it lives: Toolkit › Connectors, first child of Toolkit.** Tabs: **Connected** and **Browse**,
   the same pattern as Tools' Installed/Browse. *Why:* the Toolkit footer already says "what any team's
   agents can use; switch it on per agent", which is exactly the connector model. It keeps the nav at four
   top-level items. Tools stays the power-user page for any MCP server (command/URL/header secrets).
   Connectors is the friendly, managed front door for "sign in to my app".
2. **A curated catalog of 13 in v1**, grouped Databases · Docs & files · Analytics · CRM & engagement ·
   Work tracking, plus a **Custom connector** card. *Why:* each entry needs vetted metadata (sign-in kind,
   read-only switch, project picker, which tools are writes). A live registry browser would put
   unvetted servers one click from agents that hold repo write access.
3. **Three ways to connect, picked per connector:**
   - **Sign in (OAuth)**: Supabase, Neon, Notion, HubSpot, Linear, Sentry, PostHog, Mixpanel, Google
     Drive/Docs/Sheets. Tvashtr is the OAuth client. It uses dynamic client registration where offered;
     Google needs a registered client (open question A). On the web a popup opens; on Desktop the system
     browser opens and the app moves on by itself.
   - **API key**: CleverTap (account ID + passcode + region). The key is stored encrypted **with the
     connector**, not in Secrets. *Why:* one place to manage one thing; Secrets stays for custom Tools.
   - **Key file**: Google Analytics (service-account JSON; the user adds its email as a GA Viewer). *Why:*
     Google's GA server is local-only and reads Google credentials, and this avoids a Tvashtr Google OAuth
     client for GA.
4. **Access is two gates, both default read-only.** Gate 1 is the connection's access: Read only or Read &
   write. Gate 2 is each agent, which starts unticked; a Read & write connection can be narrowed per agent.
   Read-only is enforced where it's strongest:
   - the provider's own flag (Supabase `read_only`, Neon `readonly`, Google read scopes);
   - otherwise Tvashtr only exposes tools whose MCP annotation says `readOnlyHint: true`;
   - an unmarked tool counts as a write.
   *Why:* agents run unattended with repo write access, so a write must be chosen twice.
5. **Scope pickers where the provider has them:** a Supabase or Neon project, a GA property. *Why:* least
   privilege, and the agent doesn't have to guess which project.
6. **Per-agent grant = the Domains checklist pattern.** In the agent's Skills & tools tab there's a
   "Connectors this agent can use" list, with an "Access" select only on read-and-write rows. It is also
   reachable:
   - from the connector's page ("Give an agent access": team → agents);
   - from the drawer's "Connect an app" (connecting there ticks it for that agent, then Save).
7. **Tokens:** the stored sign-in (refresh token or key) never leaves the server. At run start Tvashtr
   mints a short-lived access token and puts it in the run's MCP config as a header, like `${SECRET}` today.
8. **What a run shows:** the agent's Runs tab gets "Connectors used this round" (chips with read/write
   counts) and a call list (connector, tool, short argument, time). **Writes are listed first and marked**,
   with a link to what they made (e.g. LIN-214).
9. **Failures don't block runs.** An expired sign-in or bad key drops that connector for the run and
   records a warning. This matches missing-secret behaviour today. The warning shows:
   - on Connectors: an amber banner, a "Sign in again" row, and a "1 to fix" nav badge;
   - in the run: "Ran without Notion: its sign-in expired", with a Sign in button.
10. **Web and Desktop are the same:**
    - connections are per account on the server, so the list is identical on both;
    - hosted runs and Desktop API-key runs both get connectors.
    - **Agents on a Claude/Grok plan don't get them in v1.** The drawer says so plainly, because tools
      don't reach plan runs today either (see follow-ups).
11. **Disconnect:**
    - the confirmation names the agents that lose access;
    - a run already going finishes without the connector;
    - Tvashtr deletes its copy of the sign-in and tells the user how to revoke Tvashtr on the provider's
      side.
12. **Custom connector:**
    - any remote MCP server that signs in with OAuth goes through the same flow; its read-only mode means
      only tools annotated read-only are exposed;
    - a server that takes a header key or runs as a local command is sent to Tools.

**Out of scope for v1:**
- shared team or org connections;
- per-call approval of writes;
- triggers (a connector event starting a run);
- live registry browsing;
- syncing a Drive folder into a Domain;
- several accounts of the same connector;
- usage metering;
- connectors on Claude/Grok plan agents.

## 4. Open questions for the operator (block the build, not the design)

- **A. Google OAuth client:** Drive, Docs and Sheets need a Tvashtr Google Cloud OAuth client and consent
  screen. Public use of Drive scopes needs Google's verification. If you won't set that up now, v1 ships
  without the three Google Workspace connectors (GA is unaffected).
- **B. Migration 0043:** a `connector_connections` table (owner, connector id, auth kind, encrypted sign-in,
  scope such as project/property, access, status, timestamps). This is the one new table. It needs your
  explicit yes.
- **C. CleverTap:** Tvashtr builds and hosts a small read-only CleverTap MCP server (events, profiles,
  campaign stats over CleverTap's REST API), or CleverTap waits for an official server. Recommendation: build
  it, read-only.
- **D. Plan agents:** passing connectors to the Claude Code runner (`--mcp-config`) would lift the limit for
  Claude-plan agents. Put it in v1, or keep it as a follow-up? Recommendation: follow-up, together with
  Tools.

## 5. Build sketch (after approval)

- **API (additive):**
  - `GET /api/connectors/catalog`;
  - `GET/POST/PATCH/DELETE /api/connectors` (connections);
  - `POST /api/connectors/{id}/oauth/start` + `GET /api/connectors/oauth/callback`;
  - `POST /api/connectors/{id}/check` (key or key file);
  - `PUT /api/connectors/{id}/agents`.
  - Every read and write is owner-scoped (another account gets 404), with tests.
- **Node:** `tool_config.tvashtr.connectors = [{id, access}]`. `build_mcp_config` adds each granted
  connector with a freshly minted token, filters tools by access, or drops the connector and writes a
  `run_warnings` row.
- **UI:**
  - `pages/connectors/` (Connected, Browse, detail, sheets);
  - a Connectors checklist in `ToolsPanel`;
  - a "Connectors used" block in the Runs tab;
  - a Shell nav child.
- **Tests:**
  - backend unit tests for the OAuth state/PKCE, token refresh, the read-only filter and owner scoping;
  - vitest for the pages and checklist;
  - an e2e using a fake OAuth MCP server.

## 6. Operator answers (2026-09-30) and what changed

- **A. Google OAuth client — "I will set that up later."** Build the Google Workspace connectors behind
  configuration: until `TVASHTR_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` are set, their cards show "Coming soon"
  and can't be connected.
- **B. Migration 0043 — approved.**
- **C. CleverTap was an example — "users should be able to link most if not all tools… like Claude
  provides so many connectors."** This supersedes decision 2 (13 curated) and the CleverTap question:
  - **Catalog = Featured + everything remote in the public MCP Registry.** Featured is a curated overlay
    with a category, a read-only URL flag and a scope picker where the provider has one. Everything else
    is a snapshot of the official MCP Registry's remote servers, bundled in the repo, refreshed by a script
    and reviewed as a diff. Browse searches all of it.
  - **Generic sign-in handling:** OAuth via MCP authorization discovery (protected-resource metadata →
    authorization-server metadata → dynamic client registration or a client ID metadata document, PKCE);
    an API key when the registry entry declares secret headers; or none.
  - **Read-only for non-featured connectors** exposes only tools annotated `readOnlyHint: true`.
  - **No Tvashtr-built CleverTap server.** A tool with no remote connector is linked through Tools (local
    command) or a custom connector.
- **D. Plan agents — recommendation accepted:** a follow-up, together with Tools.
