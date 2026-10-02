/**
 * M7 — the words of the Tests tab and its dialogs (Test-* boards) that the client builds from the
 * API's numbers. The rest (metas, `last`, errors) comes from the server as is.
 */
import type {
  AiChecks,
  CheckKind,
  CheckResult,
  ColumnUse,
  FileCheck,
  TestEstimate,
  TestGets,
  TestRun,
} from "./api/agentTests";

export const CHECK_LABEL: Record<CheckKind, string> = {
  must_say: "Must say",
  must_not_say: "Must not say",
  must_name_file: "Must name a file",
  ai: "AI check",
};

/** "Add a check": the four kinds, in the menu's order. */
export const CHECK_KINDS: CheckKind[] = ["must_say", "must_not_say", "must_name_file", "ai"];

/** Test-AddCheck: what each kind checks (the menu's second line). */
export const CHECK_HINT: Record<CheckKind, string> = {
  must_say: "Words the answer must contain",
  must_not_say: "Words it must not contain",
  must_name_file: "A file it must name or change",
  ai: "A small model checks the answer",
};

/** A new check's empty value ("What it must not say"). */
export const CHECK_PLACEHOLDER: Record<CheckKind, string> = {
  must_say: "What it must say",
  must_not_say: "What it must not say",
  must_name_file: "A file it must name",
  ai: "What the answer must do",
};

/** Test-Upload's "Use it as" options, verbatim. */
export const COLUMN_USES: { value: ColumnUse; label: string }[] = [
  { value: "gets", label: "What the agent gets" },
  { value: "must_say", label: "Must say" },
  { value: "must_name_file", label: "Must name a file" },
  { value: "skip", label: "Don’t use" },
];

/** The file picker's types (Test-Empty: "CSV or JSON lines"). */
export const TEST_FILE_ACCEPT = ".csv,.jsonl,.json,text/csv";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dollars = (usd: number) => `$${usd.toFixed(2)}`;

/** "6 tests". */
export const testsCount = (n: number) => plural(n, "test");

/** The estimate box: "Replays only the Reviewer, on saved inputs. About $0.40 on your keys · 4 min.
 *  AI checks are included." (no numbers without an estimate; no AI line when they can't run). */
export function estimateText(
  agent: string,
  estimate: TestEstimate | null,
  ai: AiChecks | null,
): string {
  const about =
    estimate && typeof estimate.minutes === "number"
      ? ` About ${dollars(estimate.cost_usd)} on your keys · ${estimate.minutes} min.`
      : "";
  return `Replays only the ${agent}, on saved inputs.${about}${ai?.available === false ? "" : " AI checks are included."}`;
}

/** The New dialog's footer: "Replaying costs about $0.07 on your keys" (none without an estimate). */
export const replayCostText = (estimate: TestEstimate | null) =>
  estimate ? `Replaying costs about ${dollars(estimate.cost_usd)} on your keys` : null;

/** R7: "AI checks use a small model on Tvashtr’s key, …: 186 of 200 left this month. …". */
export function aiChecksText(ai: AiChecks | null): string {
  if (!ai?.available)
    return "AI checks aren’t available yet, so they’re skipped, not failed. The other checks still run.";
  return `AI checks use a small model on Tvashtr’s key, included in your plan: ${ai.left} of ${ai.limit} left this month. Check one against your own judgement before you rely on it.`;
}

/** The running header's timer: "40s", "1m 40s", "1h 2m". */
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "Running 3 of 6": the replay under way (the last one once all are done). */
export const runningTitle = (run: TestRun) =>
  `Running ${Math.min(run.done + 1, run.total)} of ${run.total}`;

/** "On v7 · $0.14 so far". */
export const runningSub = (run: TestRun) =>
  `${run.version != null ? `On v${run.version} · ` : ""}${dollars(run.cost_usd)} so far`;

/** "On v7 · just now · $0.38" (Test-Stopped: "On v7 · $0.14", no time). */
export const resultsSub = (run: TestRun, when: string) =>
  [run.version != null ? `On v${run.version}` : null, when || null, dollars(run.cost_usd)]
    .filter(Boolean)
    .join(" · ");

/** Test-Queued: "On v7 · 6 tests" while the owner's runs use every slot (R12). */
export const queuedSub = (run: TestRun) =>
  `${run.version != null ? `On v${run.version} · ` : ""}${testsCount(run.total)}`;

/** Test-Stopped: "Stopped · 2 of 6 ran". */
export const stoppedTitle = (run: TestRun) => `Stopped · ${run.done} of ${run.total} ran`;

/** Test-UploadError: a file the server couldn't read → the callout's words (null: another error). */
export function unreadable(detail: string): string | null {
  const m = /^This file can[’']t be read:\s*(.+)$/s.exec(detail.trim());
  if (!m) return null;
  const why = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return /JSON|header/i.test(why)
    ? `${why} Use CSV with a header row, or one JSON object per line.`
    : why;
}

/** "+1 since v6" / "−1 since v6"; none when nothing moved. */
export function sinceText(since: TestRun["since"]): { text: string; worse: boolean } | null {
  if (!since || since.delta === 0) return null;
  const n = Math.abs(since.delta);
  return {
    text: `${since.delta > 0 ? "+" : "−"}${n} since v${since.version}`,
    worse: since.delta < 0,
  };
}

/** The first check a replay didn't meet (an AI check that couldn't run is skipped, not failed). */
export const firstUnmet = (checks: CheckResult[]) => checks.find((c) => c.met === false) ?? null;

/** "The change" row: `core/indicators.py` +48 −3 · `tests/test_indicators.py` +31. */
export const changeCount = (c: TestGets["change"][number]) =>
  `+${c.added}${c.removed ? ` −${c.removed}` : ""}`;

/** "1 page". */
export const pagesText = (pages: number) => plural(pages, "page");

/** The Upload dialog's callout: "12 tests are ready" + what they check. */
export function readyText(ready: FileCheck["ready"], agent: string): [string, string] {
  const n = ready.tests;
  const who = (k: number) => (k === n ? (n === 1 ? "It" : `All ${n}`) : `${k}`);
  const verb = (k: number) => (k === 1 ? "checks" : "check");
  const say = ready.must_say;
  const file = ready.must_name_file;
  return [
    n === 1 ? "1 test is ready" : `${n} tests are ready`,
    [
      say > 0 ? `${who(say)} ${verb(say)} what the ${agent} must say.` : "",
      file > 0 ? `${who(file)}${say > 0 ? " also" : ""} ${verb(file)} a file it must name.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  ];
}

/** "Add 12 tests". */
export const addTestsLabel = (n: number) => `Add ${plural(n, "test")}`;
