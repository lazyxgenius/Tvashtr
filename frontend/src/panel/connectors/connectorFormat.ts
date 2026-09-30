/**
 * Words and addresses for connectors in the agent drawer: the checklist's access line, a round's
 * chips and calls, and where Toolkit › Connectors lives.
 */
import type { Connection } from "../../lib/api/connectors";
import type { ConnectorCall, RoundConnectors } from "../../lib/api/roundConnectors";
import type { Route } from "../../lib/nav";

/** One connection's page, or the Connectors list when there is no id (`lib/nav.ts`, F1.1). */
export const connectorsHref = (id?: string | null): string =>
  id ? `#/toolkit/connectors/${encodeURIComponent(id)}` : "#/toolkit/connectors";

/** The same place as a route: what the Team drawer hands the page, which asks about an unsaved
 *  draft before it leaves. */
export const connectorsRoute = (id: string | null): Route =>
  id ? { page: "connector", connectorId: id } : { page: "connectors", view: "connected" };

/** "Read only · project trade-mcp-prod", "Read & write allowed", or that it needs attention. */
export function accessLine(c: Connection): string {
  if (c.status === "needs_signin") return "Needs attention · runs go on without it";
  const access = c.access === "write" ? "Read & write allowed" : "Read only";
  if (!c.scope) return access;
  return `${access} · ${(c.scope_picker?.label ?? "Project").toLowerCase()} ${c.scope.label}`;
}

/** The link on a connection that needs attention: what fixes it, on its page. */
export function fixLabel(c: Pick<Connection, "auth_kind">): string {
  if (c.auth_kind === "api_key") return "Replace key";
  // It never signed in, so there is nothing to renew: it is disconnected and connected again.
  return c.auth_kind === "none" ? "Connect it again" : "Sign in again";
}

/** Open one connection's page, or the Connectors list (`null`). */
export type OpenConnector = (connectionId: string | null) => void;

/**
 * The click for a link to Connectors. The Team drawer gives `onOpen` so leaving goes through its
 * "Save your changes?" question; without it the link follows its own address.
 */
export const opening = (onOpen: OpenConnector | undefined, id: string | null) =>
  onOpen &&
  ((e: { preventDefault: () => void }) => {
    e.preventDefault();
    onOpen(id);
  });

// ---- What a round called (the Runs tab) ----

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A chip's words: "Supabase · 6 reads", "Linear · 1 write", writes first when it did both. */
export function usedLabel(u: RoundConnectors["used"][number]): string {
  const counts = [
    ...(u.writes > 0 ? [plural(u.writes, "write")] : []),
    ...(u.reads > 0 || u.writes === 0 ? [plural(u.reads, "read")] : []),
  ];
  return `${u.name} · ${counts.join(" · ")}`;
}

/** A write the provider took may have changed data even though no good answer came back (the
 *  round's chips count it as a write). Anything else that isn't `ok` simply failed. */
const notOk = (call: ConnectorCall) =>
  call.write && call.forwarded ? "May have gone through" : "Failed";

/** Under a call: when, how long, and what became of it when it didn't go through ("10:04 · 0.3 s"). */
export function callMeta(call: ConnectorCall): string {
  const at = call.at ? new Date(call.at) : null;
  return [
    at && !Number.isNaN(at.getTime())
      ? at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      : null,
    call.duration_ms !== null ? `${(call.duration_ms / 1000).toFixed(1)} s` : null,
    call.blocked ? "Not run: read only for this agent" : call.ok ? null : notOk(call),
  ]
    .filter(Boolean)
    .join(" · ");
}
