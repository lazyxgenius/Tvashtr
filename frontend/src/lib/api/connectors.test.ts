import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connection, entry } from "../../pages/connectors/connectorsTestUtils";
import { mockApi } from "../../pages/tools/toolsTestUtils";
import { __resetBackendStatusForTests, useBackendStatus } from "../backendStatus";
import {
  checkConnection,
  connectorRefusal,
  createConnection,
  deleteConnection,
  getConnection,
  getScopeOptions,
  listCatalog,
  listConnections,
  listConnectorAgents,
  parseRoundConnectors,
  setConnectorAgents,
  startSignIn,
  updateConnection,
} from "./connectors";
import { ApiDetailError } from "./runs";

beforeEach(() => __resetBackendStatusForTests());
afterEach(() => vi.unstubAllGlobals());

const refusal = (status: number, detail: unknown) =>
  new Response(JSON.stringify({ detail }), { status });

describe("connectors API — each call hits its route", () => {
  it("lists the catalog with its query, and leaves absent filters out", async () => {
    const calls = mockApi({
      "GET /api/connectors/catalog": {
        items: [entry(), entry({ key: "neon", name: "Neon" }), { name: "no key" }, "junk"],
        total: 15036,
        next_offset: 48,
        categories: ["databases", "docs", 7],
      },
    });
    const page = await listCatalog({
      q: "data base",
      category: "databases",
      offset: 48,
      limit: 24,
    });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/api/connectors/catalog?q=data+base&category=databases&offset=48&limit=24",
    });
    expect(page.items.map((e) => e.key)).toEqual(["supabase", "neon"]);
    expect(page.items[0]).toEqual(entry());
    expect(page).toMatchObject({
      total: 15036,
      next_offset: 48,
      categories: ["databases", "docs"],
    });

    await listCatalog();
    expect(calls[1].path).toBe("/api/connectors/catalog");
  });

  it("reads the last catalog page and fills safe defaults on a thin entry", async () => {
    mockApi({
      "GET /api/connectors/catalog": {
        items: [{ key: "com.apify/apify-mcp-server", name: "Apify", website: "javascript:x" }],
        total: 1,
        next_offset: null,
      },
    });
    const page = await listCatalog();
    expect(page.next_offset).toBeNull();
    expect(page.categories).toEqual([]);
    expect(page.items[0]).toEqual({
      key: "com.apify/apify-mcp-server",
      name: "Apify",
      publisher: null,
      featured: false,
      reviewed: false,
      category: null,
      description: "",
      website: null,
      host: "",
      auth: "unknown",
      key_fields: [],
      access_modes: ["read", "write"],
      read_only_by: "annotations",
      scope_picker: null,
      available: true,
      unavailable_reason: null,
      connection_id: null,
      connection_status: null,
    });
  });

  it("lists connections, dropping the ones it can't read", async () => {
    const needs = connection({
      id: "c2",
      status: "needs_signin",
      last_error: "Its sign-in expired.",
      used_by_agents: [
        {
          node_id: "n1",
          role_name: "Reviewer",
          title: null,
          team_id: "t1",
          team_name: "Indicator sprint team",
          access: "read",
        },
      ],
    });
    const calls = mockApi({
      "GET /api/connectors": {
        connections: [connection(), needs, { id: "c3", status: "exploded" }, { name: "no id" }],
      },
    });
    const rows = await listConnections();
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/connectors" });
    expect(rows).toEqual([connection(), needs]);
    expect(rows[0].used_by_agents).toBeNull();
  });

  it("connects a catalog entry, a key and a custom address", async () => {
    const calls = mockApi({ "POST /api/connectors": connection({ status: "pending" }) });
    const made = await createConnection({ key: "supabase", access: "read" });
    expect(made.status).toBe("pending");
    await createConnection({
      key: "com.apify/apify-mcp-server",
      credentials: { Authorization: "apify_api_x" },
    });
    await createConnection({ url: "https://mcp.acme.dev/mcp", name: "Acme", access: "write" });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", "/api/connectors", { key: "supabase", access: "read" }],
      [
        "POST",
        "/api/connectors",
        { key: "com.apify/apify-mcp-server", credentials: { Authorization: "apify_api_x" } },
      ],
      [
        "POST",
        "/api/connectors",
        { url: "https://mcp.acme.dev/mcp", name: "Acme", access: "write" },
      ],
    ]);
  });

  it("reads one connection with who uses it, recent use and the revoke hint", async () => {
    const calls = mockApi({
      "GET /api/connectors/:id": {
        ...connection(),
        used_by_agents: [
          {
            node_id: "n1",
            role_name: "Reviewer",
            team_id: "t1",
            team_name: "Team",
            access: "write",
          },
          { role_name: "no id" },
        ],
        recent_use: [
          {
            run_id: "r1",
            run_number: 42,
            agent: "Reviewer",
            reads: 6,
            writes: 0,
            at: "2026-09-30",
          },
          { run_number: 1 },
        ],
        revoke_hint: "To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings.",
      },
    });
    const detail = await getConnection("c/1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/connectors/c%2F1" });
    expect(detail.used_by_agents).toEqual([
      {
        node_id: "n1",
        role_name: "Reviewer",
        title: null,
        team_id: "t1",
        team_name: "Team",
        access: "write",
      },
    ]);
    expect(detail.recent_use).toEqual([
      { run_id: "r1", run_number: 42, agent: "Reviewer", reads: 6, writes: 0, at: "2026-09-30" },
    ]);
    expect(detail.revoke_hint).toContain("Supabase’s settings");
  });

  it("changes, checks and disconnects a connection", async () => {
    const calls = mockApi({
      "PATCH /api/connectors/:id": connection({ access: "write" }),
      "POST /api/connectors/:id/check": connection({ status: "needs_signin" }),
      "DELETE /api/connectors/:id": { removed_from_agents: 2, revoked: true },
    });
    const scope = { value: "abcd1234", label: "trade-mcp-prod · ap-southeast-1" };
    expect((await updateConnection("c1", { access: "write", scope })).access).toBe("write");
    await updateConnection("c1", { scope: null });
    expect((await checkConnection("c1")).status).toBe("needs_signin");
    expect(await deleteConnection("c1")).toEqual({ removed_from_agents: 2, revoked: true });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["PATCH", "/api/connectors/c1", { access: "write", scope }],
      ["PATCH", "/api/connectors/c1", { scope: null }],
      ["POST", "/api/connectors/c1/check", undefined],
      ["DELETE", "/api/connectors/c1", undefined],
    ]);
  });

  it("reads the scope options, and the manual fallback", async () => {
    const calls = mockApi({
      "GET /api/connectors/:id/scope-options": {
        param: "project_ref",
        label: "Project",
        manual: false,
        options: [
          { value: "abcd1234", label: "trade-mcp-prod", detail: "ap-southeast-1" },
          { value: "efgh5678" },
          { label: "no value" },
        ],
      },
    });
    expect(await getScopeOptions("c1")).toEqual({
      param: "project_ref",
      label: "Project",
      manual: false,
      options: [
        { value: "abcd1234", label: "trade-mcp-prod", detail: "ap-southeast-1" },
        { value: "efgh5678", label: "efgh5678", detail: null },
      ],
    });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/connectors/c1/scope-options" });

    mockApi({ "GET /api/connectors/:id/scope-options": { manual: true, options: [] } });
    expect(await getScopeOptions("c1")).toMatchObject({ manual: true, options: [] });
  });

  it("starts a sign-in", async () => {
    const calls = mockApi({
      "POST /api/connectors/:id/oauth/start": {
        authorize_url: "https://api.supabase.com/v1/oauth/authorize?response_type=code",
        signin_host: "api.supabase.com",
        expires_in: 600,
      },
    });
    expect(await startSignIn("c1")).toEqual({
      authorize_url: "https://api.supabase.com/v1/oauth/authorize?response_type=code",
      signin_host: "api.supabase.com",
      expires_in: 600,
    });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/connectors/c1/oauth/start" });
    expect(calls[0].body).toBeUndefined();
  });

  it("lists and sets the agents that have a connection", async () => {
    const usage = {
      node_id: "n1",
      role_name: "Reviewer",
      title: "Reviewer",
      team_id: "t1",
      team_name: "Indicator sprint team",
      access: "read",
    };
    const calls = mockApi({
      "GET /api/connectors/:id/agents": {
        teams: [
          {
            team_id: "t1",
            team_name: "Indicator sprint team",
            agents: [
              {
                node_id: "n1",
                role_name: "Reviewer",
                title: "Reviewer",
                kind: "agent",
                edits_allowed: false,
                enabled: true,
                access: "read",
                subscription: null,
              },
              { node_id: "n2", role_name: "Engineer", subscription: "claude", access: "admin" },
              { role_name: "no id" },
            ],
          },
          { team_name: "no id" },
        ],
      },
      "PUT /api/connectors/:id/agents": { agents: [usage], agent_count: 1, team_count: 1 },
    });
    const teams = await listConnectorAgents("c1");
    expect(teams).toEqual([
      {
        team_id: "t1",
        team_name: "Indicator sprint team",
        agents: [
          {
            node_id: "n1",
            role_name: "Reviewer",
            title: "Reviewer",
            kind: "agent",
            edits_allowed: false,
            enabled: true,
            access: "read",
            subscription: null,
          },
          {
            node_id: "n2",
            role_name: "Engineer",
            title: null,
            kind: "agent",
            edits_allowed: false,
            enabled: false,
            access: null,
            subscription: "claude",
          },
        ],
      },
    ]);
    expect(await setConnectorAgents("c1", ["n1"])).toEqual({
      agents: [usage],
      agent_count: 1,
      team_count: 1,
    });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["GET", "/api/connectors/c1/agents", undefined],
      ["PUT", "/api/connectors/c1/agents", { node_ids: ["n1"] }],
    ]);
  });
});

describe("connectors API — a malformed answer throws", () => {
  it("refuses a connection it can't read, on every call that returns one", async () => {
    mockApi({
      "POST /api/connectors": { name: "no id" },
      "GET /api/connectors/:id": "nope",
      "PATCH /api/connectors/:id": { id: "c1", status: "exploded" },
      "POST /api/connectors/:id/check": null,
    });
    const message = "The server sent a connector we couldn’t read.";
    await expect(createConnection({ key: "supabase" })).rejects.toThrow(message);
    await expect(getConnection("c1")).rejects.toThrow(message);
    await expect(updateConnection("c1", { name: "x" })).rejects.toThrow(message);
    await expect(checkConnection("c1")).rejects.toThrow(message);
  });

  it("refuses a sign-in address that isn't http(s)", async () => {
    for (const authorize_url of ["javascript:alert(1)", "data:text/html,x", "", 7, "not a url"]) {
      mockApi({ "POST /api/connectors/:id/oauth/start": { authorize_url, signin_host: "x" } });
      await expect(startSignIn("c1")).rejects.toThrow("The server sent a sign-in address");
    }
  });

  it("names the address to open when the server gives one, and refuses one that isn't http(s)", async () => {
    const start = {
      authorize_url: "https://api.supabase.com/v1/oauth/authorize?response_type=code",
      signin_host: "api.supabase.com",
      expires_in: 600,
    };
    // Tvashtr's own address: it marks the browser, then sends it on to `authorize_url`.
    const open_url = "https://tvashtr.test/api/connectors/oauth/go?state=s1";
    mockApi({ "POST /api/connectors/:id/oauth/start": { ...start, open_url } });
    expect(await startSignIn("c1")).toEqual({ ...start, open_url });
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "",
      7,
      "/api/connectors/oauth/go",
    ]) {
      mockApi({ "POST /api/connectors/:id/oauth/start": { ...start, open_url: bad } });
      await expect(startSignIn("c1")).rejects.toThrow("The server sent a sign-in address");
    }
  });

  it("refuses a sign-in address whose host isn't the sign-in host the server named", async () => {
    // A browser reads `\\` as `/`: the window would open phish.evil.example while the page says
    // accounts.google.com.
    for (const authorize_url of [
      "https://phish.evil.example\\@accounts.google.com/o/oauth2/v2/auth",
      "https://user:pw@accounts.google.com/o/oauth2/v2/auth",
      "https://user@accounts.google.com/o/oauth2/v2/auth",
      "https://evil.example/o/oauth2/v2/auth",
      "https://[bad/o/oauth2/v2/auth",
    ]) {
      mockApi({
        "POST /api/connectors/:id/oauth/start": {
          authorize_url,
          signin_host: "accounts.google.com",
        },
      });
      await expect(startSignIn("c1")).rejects.toThrow("The server sent a sign-in address");
    }
  });

  it("reads the sign-in host off the address when the server names none", async () => {
    mockApi({
      "POST /api/connectors/:id/oauth/start": { authorize_url: "http://[::1]:9911/authorize" },
    });
    expect((await startSignIn("c1")).signin_host).toBe("::1");
    mockApi({
      "POST /api/connectors/:id/oauth/start": {
        authorize_url: "https://Accounts.Google.com/auth",
        signin_host: "accounts.google.com",
      },
    });
    expect((await startSignIn("c1")).signin_host).toBe("accounts.google.com");
  });

  it("refuses scope options and a disconnect answer it can't read", async () => {
    mockApi({
      "GET /api/connectors/:id/scope-options": "nope",
      "DELETE /api/connectors/:id": [],
      "PUT /api/connectors/:id/agents": null,
      "GET /api/connectors/catalog": "nope",
    });
    await expect(getScopeOptions("c1")).rejects.toThrow("couldn’t read");
    await expect(deleteConnection("c1")).rejects.toThrow("couldn’t read");
    await expect(setConnectorAgents("c1", [])).rejects.toThrow("couldn’t read");
    await expect(listCatalog()).rejects.toThrow("couldn’t read");
  });
});

describe("connectors API — refusals", () => {
  it("keeps the server's copy and the structured detail", async () => {
    const fields = [
      { id: "Authorization", label: "API key", hint: "Apify API token", secret: true },
    ];
    mockApi({
      "POST /api/connectors": (_u: URL, body: unknown) =>
        (body as { key: string }).key === "supabase"
          ? refusal(409, {
              code: "already_connected",
              message: "Supabase is already connected.",
              connection_id: "c1",
            })
          : refusal(422, { code: "key_required", message: "Apify needs a key.", fields }),
      "GET /api/connectors/:id": refusal(404, "Connector not found."),
    });
    const taken = await createConnection({ key: "supabase" }).catch((e: unknown) => e);
    expect(taken).toBeInstanceOf(ApiDetailError);
    expect((taken as ApiDetailError).message).toBe("Supabase is already connected.");
    expect(connectorRefusal(taken)).toEqual({
      code: "already_connected",
      message: "Supabase is already connected.",
      connection_id: "c1",
      fields: [],
    });

    const needsKey = await createConnection({ key: "apify" }).catch((e: unknown) => e);
    expect(connectorRefusal(needsKey)).toEqual({
      code: "key_required",
      message: "Apify needs a key.",
      connection_id: null,
      fields,
    });

    const missing = await getConnection("nope").catch((e: unknown) => e);
    expect((missing as ApiDetailError).message).toBe("Connector not found.");
    expect(connectorRefusal(missing)).toBeNull();
    expect(connectorRefusal(new Error("boom"))).toBeNull();
  });

  it("doesn't call the backend unreachable when it was the provider that didn't answer", async () => {
    mockApi({
      "POST /api/connectors/:id/check": refusal(502, {
        code: "unreachable",
        message: "We couldn’t reach mcp.acme.dev. Try again.",
      }),
      "GET /api/connectors": new Response("Bad gateway", { status: 502 }),
      "GET /health": new Response("down", { status: 500 }),
    });
    // The header's own check fails first, so only this call's report can say "connected".
    const { result } = renderHook(() => useBackendStatus());
    await waitFor(() => expect(result.current.state).toBe("offline"));
    await act(async () => {
      await expect(checkConnection("c1")).rejects.toThrow("We couldn’t reach mcp.acme.dev.");
    });
    expect(result.current.state).toBe("connected");
    // A bare gateway error (no app answer behind it) still counts as unreachable.
    await act(async () => {
      await expect(listConnections()).rejects.toBeInstanceOf(ApiDetailError);
    });
    expect(result.current.state).toBe("offline");
  });
});

describe("parseRoundConnectors — what a round shows", () => {
  it("reads whether the provider took a call; a round from before the field says it did when it worked", () => {
    const call = { connection_id: "c1", name: "Linear", tool: "create_issue", write: true };
    const calls = [
      { ...call, ok: false, forwarded: true },
      { ...call, ok: false, forwarded: false },
      { ...call, ok: true },
      { ...call, ok: false },
      { ...call, ok: false, forwarded: "yes" },
    ];
    expect(parseRoundConnectors({ calls })?.calls.map((c) => c.forwarded)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("is null for a round with no connector activity", () => {
    expect(parseRoundConnectors(null)).toBeNull();
    expect(parseRoundConnectors(undefined)).toBeNull();
    expect(parseRoundConnectors("nope")).toBeNull();
  });

  it("reads used, calls and skipped, dropping entries it can't read", () => {
    const call = {
      connection_id: "c1",
      name: "Supabase",
      tool: "execute_sql",
      write: false,
      ok: true,
      blocked: false,
      forwarded: true,
      arg: "SELECT 1",
      at: "2026-09-30T10:03:41+00:00",
      duration_ms: 312,
      result_url: null,
    };
    expect(
      parseRoundConnectors({
        used: [
          { connection_id: "c1", name: "Supabase", slug: "supabase", reads: 6, writes: 0 },
          { name: "no id" },
        ],
        calls: [
          call,
          { ...call, tool: "create_issue", write: true, result_url: "javascript:alert(1)" },
          {
            ...call,
            tool: "create_issue",
            write: true,
            result_url: "https://linear.app/x/LIN-214",
          },
          { name: "no tool" },
        ],
        total_calls: 7,
        skipped: [
          { connection_id: "c2", name: "Notion", reason: "its sign-in expired" },
          { connection_id: null, name: "a connector", reason: "it was disconnected" },
          { reason: 3 },
        ],
      }),
    ).toEqual({
      used: [{ connection_id: "c1", name: "Supabase", slug: "supabase", reads: 6, writes: 0 }],
      calls: [
        call,
        { ...call, tool: "create_issue", write: true, result_url: null },
        { ...call, tool: "create_issue", write: true, result_url: "https://linear.app/x/LIN-214" },
      ],
      total_calls: 7,
      skipped: [
        { connection_id: "c2", name: "Notion", reason: "its sign-in expired" },
        { connection_id: null, name: "a connector", reason: "it was disconnected" },
      ],
    });
  });

  it("reads a round that only skipped a connector", () => {
    expect(
      parseRoundConnectors({
        skipped: [{ connection_id: "c2", name: "Notion", reason: "its sign-in expired" }],
      }),
    ).toEqual({
      used: [],
      calls: [],
      total_calls: 0,
      skipped: [{ connection_id: "c2", name: "Notion", reason: "its sign-in expired" }],
    });
  });
});
