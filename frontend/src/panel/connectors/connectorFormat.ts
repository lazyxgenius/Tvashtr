/**
 * Words and addresses for connectors in the agent drawer: the checklist's access line, and where
 * Toolkit › Connectors lives.
 */
import type { Connection } from "../../lib/api/connectors";

/** One connection's page, or the Connectors list when there is no id (`lib/nav.ts`, F1.1). */
export const connectorsHref = (id?: string | null): string =>
  id ? `#/toolkit/connectors/${encodeURIComponent(id)}` : "#/toolkit/connectors";

/** "Read only · project trade-mcp-prod", "Read & write allowed", or that it needs attention. */
export function accessLine(c: Connection): string {
  if (c.status === "needs_signin") return "Needs attention · runs go on without it";
  const access = c.access === "write" ? "Read & write allowed" : "Read only";
  if (!c.scope) return access;
  return `${access} · ${(c.scope_picker?.label ?? "Project").toLowerCase()} ${c.scope.label}`;
}
