/**
 * API calls only Tvashtr Desktop's screens make (desktop-app.md §5). Every answer is shape-checked
 * here, so one odd answer never blanks a launch screen.
 */
import { apiUrl, type Config, getConfig } from "../api";
import { apiRequest, listRunsPage } from "./runs";

/**
 * `getConfig` for the launch gate, or null when `/api/config` didn't answer. `getConfig` answers
 * "self-hosted" then, which on Desktop would hide the browser sign-in from a hosted account; the
 * sign-in screens treat null as hosted. Only a self-hosted answer is asked again, to tell the two
 * apart.
 */
export async function getDesktopConfig(): Promise<Config | null> {
  const config = await getConfig();
  if (config.hosted_mode) return config;
  try {
    return (await fetch("/api/config")).ok ? config : null;
  } catch {
    return null;
  }
}

/**
 * DT-44 / OQ-7: how many of the account's runs are going on this Desktop — status group `running`
 * with `desktop_target: true` (awaiting-approval runs do no work; hosted runs aren't affected by a
 * restart). Null when the count couldn't be read.
 */
export async function countDesktopRunsGoing(): Promise<number | null> {
  try {
    const page = await listRunsPage({ status: "running", limit: 100 });
    if (!Array.isArray(page.runs)) return null;
    return page.runs.filter((r) => r?.desktop_target === true && r.status_group === "running")
      .length;
  } catch {
    return null;
  }
}

// ---- API keys on the setup's Engines step (DT-26) ----

/** One provider the setup's Add-key sheet can list (`/api/config.provider_directory`). */
export interface ProviderDirectoryEntry {
  provider: string;
  name: string;
  label: string;
  example_model: string | null;
  hint: string | null;
  /** False when no model Tvashtr can run comes from it (NVIDIA NIM today): listed, can't be picked. */
  serves_models: boolean;
}

/** The directory's copy for a provider that serves nothing (the server says the same). */
export const NIM_HINT = "NVIDIA NIM serves no model Tvashtr can run right now.";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function directoryEntry(raw: unknown): ProviderDirectoryEntry | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const provider = str(r.provider);
  if (!provider) return null;
  // NIM never runs an agent here, even on a server that predates `serves_models`.
  const serves = provider !== "nvidia_nim" && r.serves_models !== false;
  return {
    provider,
    name: str(r.name) ?? provider,
    label: str(r.label) ?? "",
    example_model: str(r.example_model),
    hint: serves ? str(r.hint) : (str(r.hint) ?? NIM_HINT),
    serves_models: serves,
  };
}

/**
 * The providers the Add-key sheet lists, in the server's picker order. `/api/config` is public, so
 * this never trips the sign-in seam; any failure or odd answer gives an empty list.
 */
export async function getProviderDirectory(): Promise<ProviderDirectoryEntry[]> {
  try {
    const res = await fetch(apiUrl("/api/config"));
    if (!res.ok) return [];
    const body = (await res.json()) as { provider_directory?: unknown };
    if (!Array.isArray(body?.provider_directory)) return [];
    return body.provider_directory
      .map(directoryEntry)
      .filter((e): e is ProviderDirectoryEntry => e !== null);
  } catch {
    return [];
  }
}

let directoryOnce: Promise<ProviderDirectoryEntry[]> | null = null;

/** The directory, read once per app session (static server copy); an empty answer is re-asked. */
export function getProviderDirectoryOnce(): Promise<ProviderDirectoryEntry[]> {
  directoryOnce ??= getProviderDirectory().then((list) => {
    if (list.length === 0) directoryOnce = null;
    return list;
  });
  return directoryOnce;
}

/** Tests: forget the cached directory. */
export function resetProviderDirectoryCache() {
  directoryOnce = null;
}

/** A saved key as the account's list shows it: never the secret, only its last 4 characters. */
export interface SavedKey {
  provider: string;
  key_last4: string;
}

function savedKey(raw: unknown): SavedKey | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const provider = str(r.provider);
  if (!provider) return null;
  return { provider, key_last4: typeof r.key_last4 === "string" ? r.key_last4 : "" };
}

/** The account's saved API keys (`GET /api/providers`), oldest first. Throws when unreadable. */
export async function listSavedKeys(): Promise<SavedKey[]> {
  const body = await apiRequest<{ providers?: unknown }>("GET", "/api/providers");
  if (!Array.isArray(body?.providers)) return [];
  return body.providers.map(savedKey).filter((k): k is SavedKey => k !== null);
}

/**
 * Save (or replace) the account's key for a provider (`POST /api/providers`). Throws
 * `ApiDetailError` (422 = the server's own words, ENG-73) or the fetch's TypeError when nothing
 * answered; a 401 also hands the session to the sign-in seam.
 */
export async function saveProviderKey(provider: string, apiKey: string): Promise<SavedKey> {
  const body = await apiRequest<unknown>("POST", "/api/providers", { provider, api_key: apiKey });
  return savedKey(body) ?? { provider, key_last4: apiKey.trim().slice(-4) };
}

// ---- Setup's First team step (DT-34..DT-37) ----

/** Where a template node will run for this account: a plan in use, a saved key, or neither. */
export type RunsOn = "claude" | "grok" | "api_key";

export interface DesktopTemplateNode {
  role: string;
  kind: string;
  label: string;
  /** Null for gates and terminals. */
  model: string | null;
  /** Null for a model node nothing covers yet ("Needs setup"), and for gates and terminals. */
  runs_on: RunsOn | null;
}

export interface DesktopTemplate {
  template: string;
  name: string;
  description: string;
  nodes: DesktopTemplateNode[];
}

function templateNode(raw: unknown): DesktopTemplateNode | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const role = str(r.role);
  if (!role) return null;
  const runsOn = r.runs_on;
  return {
    role,
    kind: typeof r.kind === "string" ? r.kind : "",
    label: typeof r.label === "string" ? r.label : role,
    model: str(r.model),
    runs_on: runsOn === "claude" || runsOn === "grok" || runsOn === "api_key" ? runsOn : null,
  };
}

function desktopTemplate(raw: unknown): DesktopTemplate | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const key = str(r.template);
  const name = str(r.name);
  if (!key || !name) return null;
  const shape = (r.shape ?? {}) as { nodes?: unknown };
  const nodes = Array.isArray(shape.nodes) ? shape.nodes : [];
  return {
    template: key,
    name,
    description: typeof r.description === "string" ? r.description : "",
    nodes: nodes.map(templateNode).filter((n): n is DesktopTemplateNode => n !== null),
  };
}

/**
 * The starter templates as Desktop setup shows them (`GET /api/templates?for=desktop`): the catalog
 * plus `spec_only`, each strip node with where it will run for this account. Throws when unreadable.
 */
export async function getDesktopTemplates(): Promise<{
  templates: DesktopTemplate[];
  blank: DesktopTemplate | null;
}> {
  const body = await apiRequest<{ templates?: unknown; blank?: unknown }>(
    "GET",
    "/api/templates?for=desktop",
  );
  const list = Array.isArray(body?.templates) ? body.templates : [];
  return {
    templates: list.map(desktopTemplate).filter((t): t is DesktopTemplate => t !== null),
    blank: desktopTemplate(body?.blank),
  };
}

/**
 * Create the account's first team from setup (`POST /api/teams {template, name, use_plans:true}`):
 * its model nodes use the plans in use on Desktop. Throws `ApiDetailError` (422 "A team name is
 * required.") or the fetch's TypeError when nothing answered.
 */
export async function createFirstTeam(
  template: string,
  name: string,
): Promise<{ team_graph_id: string }> {
  const body = await apiRequest<{ team_graph_id?: unknown }>("POST", "/api/teams", {
    template,
    name,
    use_plans: true,
  });
  return { team_graph_id: typeof body?.team_graph_id === "string" ? body.team_graph_id : "" };
}

/** How many library teams the account has (DT-37); null when that couldn't be read. */
export async function countLibraryTeams(): Promise<number | null> {
  try {
    const body = await apiRequest<{ teams?: unknown }>("GET", "/api/teams");
    return Array.isArray(body?.teams) ? body.teams.length : null;
  } catch {
    return null;
  }
}
