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
