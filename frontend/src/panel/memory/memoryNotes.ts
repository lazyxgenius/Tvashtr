/**
 * The Memory tab's pure pieces (PANEL-63..71): the force options, the repo groups and each note's
 * origin line. No JSX, so the tab and its tests import them freely.
 */
import type { Memory } from "../../lib/api/memory";
import { POLARITY_META, POLARITY_ORDER } from "../../lib/memory";

/** MUST … MUST NOT, strongest first (the inline edit's force select). */
export const FORCE_OPTIONS = POLARITY_ORDER.map((value) => ({
  value,
  label: POLARITY_META[value].label,
}));

export const NO_REPO_LABEL = "Not repo-specific";

export interface NoteGroup {
  key: string;
  label: string;
  /** Learned on a repo (the group shows the GitHub mark). */
  repo: boolean;
  notes: Memory[];
}

/** The active notes by repo (first seen first), then the ones not tied to a repo. */
export function noteGroups(notes: readonly Memory[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const note of notes) {
    const key = note.repo_key ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: note.repo_key === null ? NO_REPO_LABEL : (note.repo_label ?? note.repo_key),
        repo: note.repo_key !== null,
        notes: [],
      };
      groups.set(key, group);
    }
    group.notes.push(note);
  }
  return [...groups.values()].sort((a, b) => Number(b.repo) - Number(a.repo));
}

const shortDate = (iso: string): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/** "Learned in round 2 · Sep 22" or "Added by you · Sep 22". */
export function noteOrigin(note: Memory): string {
  const what =
    note.source.kind === "manual"
      ? "Added by you"
      : note.source.round !== null
        ? `Learned in round ${note.source.round}`
        : "Learned in a run";
  const date = shortDate(note.created_at);
  return date ? `${what} · ${date}` : what;
}

/**
 * Focus-Memory's provenance line (FOCUS-58): "Learned in round 2 · confirmed 3× · pinned" or
 * "Added by you · Sep 20".
 */
export function noteProvenance(note: Memory): string {
  const parts =
    note.source.kind === "manual"
      ? ["Added by you", shortDate(note.created_at)]
      : [
          note.source.round !== null ? `Learned in round ${note.source.round}` : "Learned in a run",
          `confirmed ${note.confirmation_count}×`,
        ];
  if (note.pinned) parts.push("pinned");
  return parts.filter(Boolean).join(" · ");
}

/** A suggestion's origin (FOCUS-57): "Suggested after round 3 of “Add an RSI indicator”". */
export function suggestedLine(note: Memory): string {
  const round = note.source.round !== null ? `round ${note.source.round}` : "a round";
  const run = note.source.run_title;
  return run ? `Suggested after ${round} of “${run}”` : `Suggested after ${round}`;
}
