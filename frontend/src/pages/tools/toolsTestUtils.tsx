/**
 * Test helpers for Toolkit › Tools + Secrets: a fetch mock keyed by "METHOD /path" (":id" patterns
 * allowed) that records every call, the design's sample tools, and a render inside the providers
 * the pages need.
 */
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { ToolItem } from "../../lib/api/tools";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { resetToolsView } from "./toolsState";

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A JSON body, a `Response`, or a function of (url, body) returning either. */
type Reply = unknown;

export function mockApi(routes: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        "http://localhost",
      );
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      let reply = routes[`${method} ${url.pathname}`];
      if (reply === undefined) {
        for (const [k, v] of Object.entries(routes)) {
          const [m, p] = k.split(" ");
          if (m === method && new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`).test(url.pathname)) {
            reply = v;
            break;
          }
        }
      }
      if (reply === undefined)
        return new Response(JSON.stringify({ detail: "no fixture" }), { status: 404 });
      const out =
        typeof reply === "function"
          ? await (reply as (u: URL, b: unknown) => unknown)(url, body)
          : reply;
      return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
    }),
  );
  return calls;
}

export function tool(
  id: string,
  name: string,
  server_config: Record<string, unknown>,
  extra: Partial<ToolItem> = {},
): ToolItem {
  return {
    id,
    name,
    server_config,
    created_at: "2026-09-16T10:00:00+00:00",
    updated_at: "2026-09-16T10:00:00+00:00",
    secret_refs: [],
    missing_secrets: [],
    status: "ready",
    used_by: { agent_count: 0, team_count: 0 },
    ...extra,
  };
}

export const FETCH = tool(
  "t-fetch",
  "fetch",
  { command: "uvx", args: ["mcp-server-fetch"] },
  { used_by: { agent_count: 2, team_count: 1 } },
);
export const GITHUB = tool(
  "t-github",
  "github",
  {
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
  },
  { secret_refs: ["GITHUB_TOKEN"], used_by: { agent_count: 3, team_count: 2 } },
);
export const LINEAR = tool(
  "t-linear",
  "linear",
  { url: "https://mcp.linear.app/sse", headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } },
  {
    secret_refs: ["LINEAR_TOKEN"],
    missing_secrets: ["LINEAR_TOKEN"],
    status: "needs_attention",
    used_by: { agent_count: 1, team_count: 1 },
  },
);

/** Render inside the page's providers; `rerender` keeps them. */
export function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: ToastProvider });
}

/** Reset every module-level store the Toolkit pages touch. */
export function resetToolkitStores(): void {
  resetToolsView();
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  window.location.hash = "";
}
