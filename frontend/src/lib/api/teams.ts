/**
 * Home › Teams API (B-TEAMS, docs/superpowers/plans/api/teams.md): the starter templates with their
 * pipeline strips, create / rename / duplicate / delete a team, and the account preferences that
 * hide the get-started checklist. Every call reports whether the backend answered, so the header's
 * "Connected" / "Can't reach backend" stays truthful.
 */
import { ApiError, apiUrl, type TeamShape, type TeamSummary } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";

/** One starting point in the New team dialog and the first-time "Start from a template". */
export interface TeamTemplate {
  /** The key POST /api/teams takes (`blank`, `two_node`, `review_loop`, …). */
  template: string;
  name: string;
  description: string;
  shape: TeamShape;
}

/** Blank is a frontend constant too, so the dialog can still offer it when templates fail to load. */
export const BLANK_TEMPLATE: TeamTemplate = {
  template: "blank",
  name: "Blank",
  description: "An empty canvas: one thinker into Ship. Wire the rest yourself.",
  shape: {
    nodes: [
      { id: "", kind: "thinker", role: "thinker", label: "Thinker" },
      { id: "", kind: "terminal", role: "ship", label: "Ship" },
    ],
    loops: [],
  },
};

export interface AccountPreferences {
  get_started_hidden: boolean;
  /** The Domains list's how-it-works strip is hidden (DM-6). */
  domains_howto_hidden?: boolean;
  /** R10: the run bar's bell asked once; then which runs notify (M2). */
  notify_asked?: boolean;
  notify_needs_you?: boolean;
  notify_stalls_fails?: boolean;
  notify_finishes?: boolean;
}

async function send(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(apiUrl(url), init);
  } catch (err) {
    reportFetchFailed();
    throw err;
  }
  // A 502/503/504 is the Desktop proxy (or Fly) saying the backend is away, not an answer.
  if (res.status >= 502 && res.status <= 504) reportFetchFailed();
  else reportFetchOk();
  return res;
}

/** Throw an ApiError carrying the server's `detail` (e.g. 422 "A team name is required."). */
async function fail(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) message = body.detail;
  } catch {
    // not JSON — keep the fallback
  }
  throw new ApiError(res.status, message);
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** The account's library teams, oldest first. `[]` for a new account (nothing is auto-created). */
export async function listTeams(): Promise<TeamSummary[]> {
  const res = await send("/api/teams");
  if (!res.ok) await fail(res, `GET /api/teams -> ${res.status}`);
  return ((await res.json()) as { teams: TeamSummary[] }).teams;
}

/** The starter templates (in order) and the Blank starting point. */
export async function getTeamTemplates(): Promise<{
  templates: TeamTemplate[];
  blank: TeamTemplate;
}> {
  const res = await send("/api/templates");
  if (!res.ok) await fail(res, `GET /api/templates -> ${res.status}`);
  const body = (await res.json()) as { templates?: TeamTemplate[]; blank?: TeamTemplate };
  const withShape = (t: TeamTemplate): TeamTemplate => ({
    ...t,
    shape: t.shape ?? { nodes: [], loops: [] },
  });
  return {
    templates: (body.templates ?? []).map(withShape),
    blank: body.blank ? withShape(body.blank) : BLANK_TEMPLATE,
  };
}

/** Create a library team. 422 "A team name is required." for a blank name. */
export async function createLibraryTeam(template: string, name: string): Promise<TeamSummary> {
  const res = await send("/api/teams", jsonInit("POST", { template, name }));
  if (!res.ok) await fail(res, `POST /api/teams -> ${res.status}`);
  return (await res.json()) as TeamSummary;
}

/** Rename a team; returns its updated summary. 422 for a blank name. */
export async function renameLibraryTeam(teamId: string, name: string): Promise<TeamSummary> {
  const res = await send(`/api/teams/${encodeURIComponent(teamId)}`, jsonInit("PATCH", { name }));
  if (!res.ok) await fail(res, `PATCH /api/teams/${teamId} -> ${res.status}`);
  return (await res.json()) as TeamSummary;
}

/** Copy a team (every node, edge and setting; no runs, no agent memories) as "{name} (copy)". */
export async function duplicateTeam(teamId: string, name?: string): Promise<TeamSummary> {
  const res = await send(
    `/api/teams/${encodeURIComponent(teamId)}/duplicate`,
    jsonInit("POST", name === undefined ? {} : { name }),
  );
  if (!res.ok) await fail(res, `POST /api/teams/${teamId}/duplicate -> ${res.status}`);
  return (await res.json()) as TeamSummary;
}

/** Delete a team. This stops and deletes its runs too. */
export async function deleteLibraryTeam(teamId: string): Promise<void> {
  const res = await send(`/api/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" });
  if (!res.ok) await fail(res, `DELETE /api/teams/${teamId} -> ${res.status}`);
}

// ---- M4: the team file (docs/superpowers/plans/api/team-file.md). The server renders the text and
// makes every word; the app never parses YAML. ----

export type TeamFileFormat = "yaml" | "json";

export interface TeamFile {
  filename: string;
  format: TeamFileFormat;
  content: string;
  lines: number;
  /** Connectors by provider key and secrets by NAME — never their values. */
  needs: { connectors: string[]; secrets: string[] };
}

/** Why a file can't be imported: "Line 12: `agents` should be a list of agents." */
export interface TeamFileError {
  line: number | null;
  message: string;
}

export interface ImportCheckRow {
  key: string;
  tone: "ok" | "warn";
  title: string;
  detail: string;
  /** Substrings of the title / detail the app sets in code style. */
  code?: string[];
}

export interface ImportCheck {
  ok: boolean;
  error: TeamFileError | null;
  filename: string;
  lines: number;
  /** The suggested name, "<name> (copy)". */
  name: string;
  counts: { agents: number; gates: number; routes: number };
  checks: ImportCheckRow[];
  /** The warn checks that need you after importing. */
  fixes: number;
}

export interface ImportFix {
  key: string;
  text: string;
  /** `open_team`: the team's graph can't run yet; it's changed on its own canvas. */
  action: "sign_in" | "open_toolkit" | "open_engines" | "open_domains" | "open_team";
  target: string | null;
  /** The new team's nodes that need it. */
  node_ids: string[];
}

export interface ImportedTeam {
  team_graph_id: string;
  name: string;
  fixes: ImportFix[];
  note: string;
}

/** The import was refused (422): the file can't be imported, with the line when there is one. */
export class TeamFileRefused extends ApiError {
  constructor(public readonly error: TeamFileError) {
    super(422, error.message);
    this.name = "TeamFileRefused";
  }
}

/** The team as one file (YAML or JSON). 404 unless the team is yours. */
export async function getTeamFile(teamId: string, format: TeamFileFormat): Promise<TeamFile> {
  const res = await send(`/api/teams/${encodeURIComponent(teamId)}/file?format=${format}`);
  if (!res.ok) await fail(res, `GET /api/teams/${teamId}/file -> ${res.status}`);
  return (await res.json()) as TeamFile;
}

/** A dry run of an import: nothing changes. */
export async function checkTeamImport(content: string, filename: string): Promise<ImportCheck> {
  const res = await send("/api/teams/import-check", jsonInit("POST", { content, filename }));
  if (!res.ok) await fail(res, `POST /api/teams/import-check -> ${res.status}`);
  return (await res.json()) as ImportCheck;
}

/** Import the file as a NEW team. A 422 with the file's error throws `TeamFileRefused`. */
export async function importTeam(content: string, name: string): Promise<ImportedTeam> {
  const res = await send("/api/teams/import", jsonInit("POST", { content, name }));
  if (res.status === 422) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as {
      detail?: { error?: TeamFileError };
    } | null;
    const error = body?.detail?.error;
    if (error && typeof error.message === "string") throw new TeamFileRefused(error);
  }
  if (!res.ok) await fail(res, `POST /api/teams/import -> ${res.status}`);
  return (await res.json()) as ImportedTeam;
}

export async function getAccountPreferences(): Promise<AccountPreferences> {
  const res = await send("/api/account/preferences");
  if (!res.ok) await fail(res, `GET /api/account/preferences -> ${res.status}`);
  return (await res.json()) as AccountPreferences;
}

export async function patchAccountPreferences(
  patch: Partial<AccountPreferences>,
): Promise<AccountPreferences> {
  const res = await send("/api/account/preferences", jsonInit("PATCH", patch));
  if (!res.ok) await fail(res, `PATCH /api/account/preferences -> ${res.status}`);
  return (await res.json()) as AccountPreferences;
}
