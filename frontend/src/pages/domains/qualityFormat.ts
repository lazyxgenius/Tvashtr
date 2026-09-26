/**
 * The Quality tab's words (DM-72…DM-77, OQ-16): scores, the run line, "Compare with" labels and
 * deltas, the changed-result marks, the running estimate and the miss hint. Pure and tested.
 */
import type { DomainTestCase, DomainTestResult, DomainTestRun } from "../../lib/api/domains";
import { formatNumber, formatShortDate, formatUpdated } from "./domainFormat";
import { readingModel } from "./readingModels";

const MODES: Record<string, string> = { dense: "Meaning", lexical: "Exact words", hybrid: "Both" };

/** "Meaning" / "Exact words" / "Both" for a retrieval mode. */
export function modeLabel(mode: string | null | undefined): string {
  return MODES[mode ?? ""] ?? MODES.dense;
}

/** "83%", or "—" before any run / with nothing scored. */
export function percent(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** "+8 vs previous run" / "−5 vs Run 3"; nothing when equal or either side has no score. */
export function scoreDelta(now: number | null, then: number | null, vs: string): string | null {
  if (now === null || then === null) return null;
  const d = Math.round(now * 100) - Math.round(then * 100);
  if (d === 0) return null;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} vs ${vs}`;
}

/** The Test questions card's line: "Last run 2 hours ago · Meaning search · 8 passages". */
export function runLine(run: DomainTestRun | null, now: Date = new Date()): string {
  if (!run) return "Not run yet";
  const at = run.completed_at ?? run.created_at;
  const when =
    now.getTime() - new Date(at).getTime() < 60_000
      ? "Ran just now"
      : `Last run ${formatUpdated(at, now)}`;
  return `${when} · ${modeLabel(run.retrieval_mode)} search · ${run.top_k ?? 8} passages`;
}

const cfg = (run: DomainTestRun, block: string, key: string): unknown => {
  const b = run.config[block];
  return b && typeof b === "object" ? (b as Record<string, unknown>)[key] : undefined;
};

/** What set `run` apart from `latest` (DM-73), else its search mode. */
function differs(run: DomainTestRun, latest: DomainTestRun): string {
  if (run.retrieval_mode !== latest.retrieval_mode)
    return `${modeLabel(run.retrieval_mode)} search`;
  const size = cfg(run, "chunking", "size");
  if (typeof size === "number" && size !== cfg(latest, "chunking", "size")) {
    return `${formatNumber(size)}-character pieces`;
  }
  const modelOf = (r: DomainTestRun) => {
    const m = cfg(r, "embedding", "model");
    return typeof m === "string" ? m : "";
  };
  const model = modelOf(run);
  const was = readingModel(model);
  if (model && was.slug !== readingModel(modelOf(latest)).slug) {
    return was.label;
  }
  if (run.top_k !== latest.top_k && run.top_k !== null) return `${run.top_k} passages`;
  return `${modeLabel(run.retrieval_mode)} search`;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * "Compare with" options: every finished run before `latest`, newest first —
 * "Previous run · Sep 24, 10:02", then "Run 3 · Sep 22 · Meaning search".
 */
export function compareOptions(
  older: DomainTestRun[],
  latest: DomainTestRun,
  now: Date = new Date(),
): { value: string; label: string; vs: string }[] {
  return older.map((run, i) => {
    const at = run.completed_at ?? run.created_at;
    return i === 0
      ? {
          value: run.run_id,
          label: `Previous run · ${formatShortDate(at, now)}, ${clock(at)}`,
          vs: "previous run",
        }
      : {
          value: run.run_id,
          label: `Run ${run.number} · ${formatShortDate(at, now)} · ${differs(run, latest)}`,
          vs: `Run ${run.number}`,
        };
  });
}

/** A result that changed against the compared run: "fixed" or "new miss" (DM-76). */
export function changeMark(now: boolean | null, then: boolean | null | undefined) {
  if (now === true && then === false) return "fixed";
  if (now === false && then === true) return "new miss";
  return null;
}

/** Seconds a test takes before any has finished (the design's 8 tests ≈ 20 seconds). */
const FIRST_GUESS_S = 2.5;

/** "Running 8 tests… about 20 seconds": the rest at the pace so far. */
export function runningText(
  run: DomainTestRun,
  now: Date = new Date(),
  /** The last finished run's search mode: a run with a new mode says so instead (DmF-Tune-3). */
  previousMode?: string | null,
): string {
  const { done, total } = run.progress;
  const tests = `${total} test${total === 1 ? "" : "s"}`;
  if (previousMode && run.retrieval_mode && run.retrieval_mode !== previousMode) {
    return `Running ${tests} with ${modeLabel(run.retrieval_mode)} search…`;
  }
  const elapsed = Math.max(0, now.getTime() - new Date(run.created_at).getTime()) / 1000;
  const each = done > 0 ? elapsed / done : FIRST_GUESS_S;
  const s = Math.max(5, Math.ceil(((total - done) * each) / 5) * 5);
  const about =
    s < 60 ? `about ${s} seconds` : `about ${Math.round(s / 60)} minute${s < 90 ? "" : "s"}`;
  return `Running ${tests}… ${about}`;
}

/** The expected files as the table shows them: "refund-policy.md", "a.md +1". */
export function expectedLabel(c: DomainTestCase): string {
  const [first, ...rest] = c.expected_files;
  if (!first) return "—";
  const name = first.filename ?? "Deleted file";
  return rest.length ? `${name} +${rest.length}` : name;
}

/** The miss hint (DM-77 with OQ-16): which file wasn't found, and "Both" when it wasn't used. */
export function missHint(c: DomainTestCase, r: DomainTestResult, run: DomainTestRun): string {
  const parts: string[] = [];
  if (r.hit === false) {
    const names = c.expected_files.map((f) => f.filename ?? "a deleted file").join(" or ");
    parts.push(`${names} wasn’t in the top ${run.top_k ?? 8}.`);
  }
  if (run.retrieval_mode !== "hybrid") parts.push("Try “Both” search.");
  return parts.join(" ");
}

/** A row opens to show what search found when it has a miss. */
export function isMiss(r: DomainTestResult | undefined): boolean {
  return r?.hit === false || r?.keyword_hit === false;
}

/** "signature, secret" → ["signature", "secret"]. */
export function splitKeywords(text: string): string[] {
  return text
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}
