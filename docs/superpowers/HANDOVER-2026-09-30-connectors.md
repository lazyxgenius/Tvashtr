# Handover — Connectors (2026-09-30)

Toolkit › Connectors is built on `feat/connectors` and shipped to `main` (see the ship row at the
end). Docs: `docs/superpowers/plans/connectors-decisions.md` (decisions and the operator's answers),
`plans/api/connectors.md` (the contract), `plans/connectors-build-plan.md` (what each stream built,
"as built" notes, risks §11, open decisions §12). Design: the Claude Design canvas, pages
**Connectors** and **Connectors flows** (https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK).

## What it is

- **Toolkit › Connectors** (first item under Toolkit): tabs Connected and Browse. Browse has 14
  Featured cards and a bundled snapshot of the public MCP Registry (15,045 remote servers, searchable),
  plus Custom connector.
- **Connecting:** OAuth sign-in (MCP authorization: discovery, a client metadata document or dynamic
  registration, PKCE), or an API key when the registry entry declares one. Web opens a popup; Desktop
  opens the system browser and the app moves on by itself. A confirm page names the Tvashtr account
  when the browser that finishes holds no session.
- **Access:** two gates, both read-only by default: the connection's access and each agent's tick in
  its Skills & tools tab ("Connectors this agent can use").
- **Run time:** the agent never gets the provider's sign-in. It gets a signed Tvashtr run token and
  talks to `/mcp/connectors`, which adds the sign-in server-side, enforces read-only, and records
  every call. The agent's Runs tab shows "Connectors used", the calls (writes first) and anything
  skipped.
- **One migration:** `0043_connector_connections` (one table).
- **Also fixed here:** the Domains MCP endpoint answered 405 at `/mcp/domains` and 421 for the public
  host, so hosted agents couldn't reach Domains. Both MCP mounts now answer at their exact address
  and accept only the hosts agents use.

## Featured in v1

Available: Supabase, Neon, Notion, PostHog, Mixpanel, Amplitude, Intercom, Linear, Sentry, Atlassian.
"Coming soon": Google Drive, Google Docs, Google Sheets (until `TVASHTR_GOOGLE_OAUTH_CLIENT_ID` and
`TVASHTR_GOOGLE_OAUTH_CLIENT_SECRET` are set; the redirect address to register is
`https://tvashtr.fly.dev/api/connectors/oauth/callback`) and HubSpot (needs a registered app).

**No real provider sign-in has been completed.** Every Featured entry reaches its authorize address
in the discovery probe (`scripts/connector_probe.py`, no registration), and the whole path is tested
against a fake OAuth MCP server. Before announcing the feature, sign in once to each Featured
provider; switch any that fails to "Coming soon" in `connector_catalog.py`.

## Gates at ship (branch head 5b96cbd + this file)

| Gate | Result |
|---|---|
| Backend `make test` on an isolated database | 2715 passed, 1 xfailed |
| Frontend vitest / build / lint / format | 2244 passed / ok / ok / ok |
| Desktop tests | 143 passed |
| docker build | ok, the registry snapshot is in the image |
| Connectors e2e + proxy probe | 1 spec passed; probe 9 of 9 |
| The 19 `scripts/*_e2e.sh` and 5 plain specs | 24 of 24 passed |
| Run-time check with a live model (LOCAL and docker sandbox) | passed: read forwarded, write blocked, no provider token in the run's events |
| Reviews | per stream: 2 lenses each; whole feature: 4 lenses, 16 findings, 15 confirmed by independent verifiers, all fixed |

## Open decisions for the operator (plan §12)

1. HubSpot: register one Tvashtr app, or let users paste their own app's client id and secret.
2. Google: set the two environment variables when the Google Cloud client exists.
3. Google read-only: trust the read-only scopes alone, or keep the extra annotation filter (kept).
4. Custom and registry connectors that sign in are ON, with a warning in both sheets. Residual risk:
   a hostile server of that kind can name a real provider's sign-in page (OAuth mix-up); eight of the
   ten available Featured providers don't send `iss`, so it can't be closed on the backend.
5. Registry entries with only an optional secret header (852) show the key form.
6. Registry entries that mention x402 payments in their description (794) are still listed.

## Left over

- Connectors and Tools on agents that run on a Claude or Grok plan (Desktop): not in v1; the drawer
  says so.
- Google Analytics and CleverTap: no remote connector exists; they go through Tools.
- Domains' MCP server keeps sessions in one machine's memory; with more than one backend machine a
  follow-up request could miss. Not changed.
- An agent with Domains ticked still holds the owner's full session cookie for that server
  (pre-existing); moving Domains to the run token is a follow-up.
- `scripts/thinker_chain_e2e.sh` fails on `main` too (unknown template); whole-repo `make lint` has
  37 old errors in files this work doesn't touch.
- Refresh the registry snapshot with `make connectors-registry` (about 10 minutes); review the diff.
- The canvas is at 511 of 512 files.

## Ship table

| Area | main sha | Fly release | Desktop tag | DMG check |
|---|---|---|---|---|
| Connectors | (filled at ship) | (filled at ship) | desktop-v0.13.0 | (filled at ship) |
