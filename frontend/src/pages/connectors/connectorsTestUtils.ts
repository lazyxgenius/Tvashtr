/**
 * Test fixtures for Toolkit › Connectors: one catalog entry and one connection in the contract's
 * shape (`docs/superpowers/plans/api/connectors.md`), each overridable field by field. The fetch
 * mock is `mockApi` from `pages/tools/toolsTestUtils`.
 */
import type { CatalogEntry, Connection } from "../../lib/api/connectors";

/** A Featured catalog entry (Supabase, not connected). */
export function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    key: "supabase",
    name: "Supabase",
    publisher: "Supabase",
    featured: true,
    reviewed: true,
    category: "databases",
    description: "Read tables, run read-only SQL and check logs in one project.",
    website: "https://supabase.com",
    host: "mcp.supabase.com",
    auth: "oauth",
    key_fields: [],
    access_modes: ["read", "write"],
    read_only_by: "provider",
    scope_picker: { param: "project_ref", label: "Project" },
    available: true,
    unavailable_reason: null,
    connection_id: null,
    connection_status: null,
    ...over,
  };
}

/** A connected, read-only Supabase connection scoped to one project. */
export function connection(over: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    connector_key: "supabase",
    name: "Supabase",
    slug: "supabase",
    publisher: "Supabase",
    featured: true,
    reviewed: true,
    category: "databases",
    host: "mcp.supabase.com",
    auth_kind: "oauth",
    key_fields: [],
    signin_host: "api.supabase.com",
    signin_host_differs: false,
    access: "read",
    access_modes: ["read", "write"],
    read_only_by: "provider",
    scope: { value: "abcd1234", label: "trade-mcp-prod · ap-southeast-1" },
    scope_picker: { param: "project_ref", label: "Project" },
    status: "connected",
    signin_pending: false,
    last_error: null,
    tools: [
      { name: "list_tables", title: null, write: false, on: true },
      { name: "execute_sql", title: null, write: false, on: true },
    ],
    used_by: { agent_count: 2, team_count: 1 },
    used_by_agents: null,
    connected_at: "2026-09-28T10:02:11.482+00:00",
    created_at: "2026-09-28T10:01:40+00:00",
    updated_at: "2026-09-28T10:02:11.482+00:00",
    ...over,
  };
}
