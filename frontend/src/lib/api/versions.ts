/**
 * M5 — team versions (`docs/superpowers/plans/api/versions.md`, ruling R3): the header chip,
 * History › Versions, What changed, Restore and an agent's instruction history. Every word
 * (summaries, field names) is made server-side.
 */
import { apiRequest } from "./runs";

/** One version in History (newest first). Line 2 of its row is `note` when set, else `summary`. */
export interface TeamVersion {
  number: number;
  created_at: string;
  /** "you" for the caller. */
  author: string;
  summary: string;
  note: string | null;
  runs: number;
  source: "first" | "save" | "run" | "restore";
  restored_from: number | null;
}

/** The chip and History › Versions. */
export interface TeamVersions {
  /** The latest version's number. */
  current: number;
  saved_at: string;
  /** Changes since the latest version (0: the chip reads "saved …"). */
  changes: number;
  /** The number "Save as vN" (or a run) would make. */
  next: number;
  total: number;
  versions: TeamVersion[];
}

/** One changed thing: an agent's / gate's field, a whole agent / gate / end, a route, a team field. */
export interface VersionChange {
  key: string;
  node_id?: string | null;
  agent: string | null;
  role?: string | null;
  field: string | null;
  /** `changed`: a field with no values to show (Skills, Tools, Type, Gate, Settings). */
  kind: "text" | "value" | "changed" | "added" | "removed";
  /** A whole added / removed node is a gate. */
  gate?: boolean;
  removed?: number;
  added?: number;
  /** A text field's changed lines, with up to 1 line of context around each hunk. */
  lines?: { op: "context" | "removed" | "added"; text: string }[];
  before?: string | null;
  after?: string | null;
  /** A route's words ("Reviewer → Engineer · when changes requested · up to 3 rounds"). */
  text?: string | null;
}

/** What changed in vN (compared with vN-1). */
export interface VersionDetail {
  number: number;
  created_at: string;
  author: string;
  summary: string;
  note: string | null;
  source: TeamVersion["source"];
  restored_from: number | null;
  /** It's the latest version. */
  current: boolean;
  /** Null for v1 (nothing before it). */
  compared_with: number | null;
  changes: VersionChange[];
  /** Categories with no change ("models", "routes", "gates", "budget"). */
  same: string[];
  runs: { run_id: string; number: number | null; idea: string; status: string }[];
}

/** The Restore dialog: what restoring vN changes in the working copy. */
export interface RestorePreview {
  number: number;
  /** The new version restoring makes. */
  makes: number;
  current: number;
  /** Set when the working copy's changes are saved as their own version first. */
  draft_saved_as: number | null;
  changes: VersionChange[];
}

/** One version in which an agent's instructions changed (newest first). */
export interface InstructionEntry {
  number: number;
  created_at: string;
  author: string;
  /** This text is the one in the latest version. */
  current: boolean;
  first: boolean;
  text: string;
  added: string[];
  removed: string[];
  /** The first entry's text is this built-in role's default ("Reviewer"). */
  from_builtin?: string | null;
}

const team = (teamId: string) => `/api/teams/${encodeURIComponent(teamId)}`;

export function getVersions(teamId: string): Promise<TeamVersions> {
  return apiRequest("GET", `${team(teamId)}/versions`);
}

/** Save as vN. 409 "Nothing changed since v7." throws `ApiDetailError`. */
export function saveVersion(teamId: string): Promise<TeamVersion> {
  return apiRequest("POST", `${team(teamId)}/versions`, {});
}

export function getVersion(teamId: string, number: number): Promise<VersionDetail> {
  return apiRequest("GET", `${team(teamId)}/versions/${number}`);
}

export function getRestorePreview(teamId: string, number: number): Promise<RestorePreview> {
  return apiRequest("GET", `${team(teamId)}/versions/${number}/restore`);
}

/** Restore vN as a new version (the working copy changes in place). */
export function restoreVersion(
  teamId: string,
  number: number,
): Promise<{ number: number; restored_from: number; draft_saved_as: number | null }> {
  return apiRequest("POST", `${team(teamId)}/versions/${number}/restore`);
}

export function getInstructionHistory(
  teamId: string,
  nodeId: string,
): Promise<{ count: number; entries: InstructionEntry[] }> {
  return apiRequest(
    "GET",
    `${team(teamId)}/nodes/${encodeURIComponent(nodeId)}/instruction-history`,
  );
}
