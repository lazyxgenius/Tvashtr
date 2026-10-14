#!/usr/bin/env node
/**
 * V2b's live smoke from the API (brief m-desk-7-v2b, Part B): what a take can't read on screen.
 *   node video/camera/smoke.mjs hero   # after 3.1 + 3.7: T1/T2, F1 (Activity), L1 launch→Done, L2, L3, the HERO line
 *   node video/camera/smoke.mjs s4     # after the runs: S4 on every run's Desktop jobs
 * Read-only: the film account's API (a node-side session), the hero recording, `gh api` for the PR's files.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { apiSession, loginApi, repoRoot } from "./desktop.mjs";
import { heroRun, MONEY, smoke } from "./flows.mjs";
import { loadRecording } from "./intercept.mjs";

const SHOTS = "video/takes/v2b";
const OWN = /REPORT\.md|REVIEW_VERDICT\.json|SPEC\.md|TVASHTR_REMEMBER|sandbox\.toml|prompt\.txt/;
// T2: a verdict asking for what no Desktop agent can produce (a heuristic: a hit is FAIL until the shot
// says otherwise).
const ASKS =
  /\b(run|re-?run|execute|paste|provide|share|include|attach)\b[^.\n]{0,50}\b(pytest|test output|test results|command output|output of)\b|\b(no|missing|without)\b[^.\n]{0,20}\b(pytest|test|command) (output|results?)\b/i;
const CITES = /Tvashtr|sandbox|\b\d+ passed\b|\btests? pass(ed)?\b/i;
const LOCK = {
  grok: "Grok Build is locked to this job's copy of the repo — it can't open your other files.",
  claude: "Claude Code is locked to this job's copy of the repo — it can't open your other files.",
};
const PATH_ARG = /"(?:path|paths|file|file_path|filePath|target_file|directory|dir|cwd)"\s*:\s*"([^"]+)"/g;
const body = (e) => Buffer.from(e.body, "base64").toString("utf8");

async function hero(api) {
  const get = async (p) => (await api("GET", p)).json ?? {};
  const { run_id: run, pr_url } = await heroRun(api);
  const act = await get(`/api/runs/${run}/activity?desktop_target=1`);
  const lines = act.lines ?? [];
  const rows = (await get(`/api/runs/${run}/trajectory`)).rows ?? [];
  const checks = lines.filter((l) => l.kind === "check");
  const idOf = (label) => lines.find((l) => l.label === label)?.node_id;
  const [eng, rev, tests] = [idOf("Engineer"), idOf("Reviewer"), checks[0]?.node_id];
  const rec = loadRecording(path.join(repoRoot, "video/recordings/hero")).entries;
  // T1: "Running the tests…" was on screen, then one result per visit (failed: back to the Engineer, ≤ 12 lines).
  const saw = rec.some((e) => /\/activity$/.test(e.path) && /"result":\s*"running"/.test(body(e)));
  const odd = checks.filter(
    (c) =>
      !(c.refs?.result === "passed" && c.text.startsWith("Tests passed")) &&
      !(c.refs?.result === "failed" && /^Tests failed — back to Engineer with the last \d+ lines$/.test(c.text) && (c.refs.output_tail?.length ?? 99) <= 12),
  );
  smoke(null, "Hero Tests check (T1)", saw && checks.length > 0 && !odd.length, `${SHOTS}/3.1/shots/`, `${saw ? "" : "no “Running the tests…” in the recording; "}${checks.map((c) => c.text).join(" → ")}`);
  // T2: each failed check's lines reach the Engineer's next round (its "revision" part); the Reviewer is
  // given the result ("check_result"), cites it, and never asks for command or test output.
  const failed = rows.filter((r) => r.node_id === tests && r.outcome === "rejected");
  const parts = (r) => (r.context_manifest?.parts ?? []).map((p) => p.name);
  const lost = failed.filter(
    (g) => !rows.some((r) => r.node_id === eng && r.started_at >= (g.ended_at ?? g.started_at) && parts(r).includes("revision")),
  );
  const given = rows.some((r) => r.node_id === rev && parts(r).includes("check_result"));
  // The verdict: its Activity line, the trajectory's detail, and the Reviewer's own words — its job's
  // messages and the REVIEW_VERDICT.json it wrote (the Activity line drops a `reasons` string).
  const revInv = new Set(rows.filter((r) => r.node_id === rev).map((r) => r.invocation_id));
  const events = (await get(`/api/spike/run-events/${run}`)).events ?? [];
  const own = events
    .filter((e) => revInv.has(e.invocation_id))
    .map((e) => (e.kind === "message" ? String(e.payload?.text ?? "") : /REVIEW_VERDICT\.json/.test(String(e.payload?.action ?? "")) ? String(e.payload.action) : ""))
    .filter(Boolean);
  // The reasons of each REVIEW_VERDICT.json the Reviewer wrote (its verdict proper).
  const verdictFiles = events
    .filter((e) => revInv.has(e.invocation_id) && e.kind === "action")
    .map((e) => {
      try {
        const a = JSON.parse(String(e.payload?.action ?? "{}"));
        if (!/REVIEW_VERDICT\.json$/.test(a.file_path ?? a.path ?? "")) return null;
        const v = JSON.parse(a.content ?? "{}");
        return [v.verdict, ...[v.reasons].flat()].filter(Boolean).join(" ");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const said = [
    ...lines.filter((l) => l.kind === "verdict").map((v) => [v.text, ...(v.refs?.reasons ?? [])].join(" ")),
    ...rows.filter((r) => r.node_id === rev).map((r) => r.outcome_detail ?? ""),
    ...own,
  ];
  const asks = said.filter((t) => ASKS.test(t));
  smoke(
    null,
    "Hero Tests reach the agents (T2)",
    !lost.length && given && !asks.length && said.some((t) => CITES.test(t)),
    `${SHOTS}/3.1/shots/reviewer-verdict.png`,
    `failed checks ${failed.length}, lines reached the Engineer ${failed.length - lost.length}; Reviewer given the result ${given}; cites it ${said.some((t) => CITES.test(t))}; asks for output: ${asks[0]?.slice(0, 120) ?? "none"}`,
  );
  smoke(null, "F1 (Activity)", checks.length > 0 && checks.every((c) => c.label === "Tests pass"), `${SHOTS}/3.1/shots/running-reviewer.png`, [...new Set(checks.map((c) => c.label))].join(", "));
  // L2 on what the verdict says (its line, its detail, its reasons) — not on the sidecar files it writes.
  const verdicts = [
    ...lines.filter((l) => l.kind === "verdict").map((v) => [v.text, ...(v.refs?.reasons ?? [])].join(" ")),
    ...rows.filter((r) => r.node_id === rev).map((r) => r.outcome_detail ?? ""),
    ...verdictFiles,
  ];
  const named = verdicts.filter((t) => OWN.test(t));
  smoke(null, "Hero L2 (no verdict names Tvashtr's files)", !named.length, `${SHOTS}/3.1/shots/reviewer-verdict.png`, named.map((t) => t.slice(0, 80)).join(" | "));
  // L1/H1 from launch to Done: no "$0.00 +"/"$0.0000" in the run's reads; no Desktop read saying it wasn't
  // all on subscriptions; the Done line names both.
  const money = rec.filter((e) => e.path.startsWith(`/api/runs/${run}`) && MONEY.test(body(e)));
  const mixed = rec.filter((e) => e.path === `/api/runs/${run}` && (e.search ?? "").includes("desktop_target=1") && /"all":\s*false/.test(body(e)));
  const done = lines.find((l) => l.kind === "done")?.text ?? "";
  smoke(
    null,
    "Hero L1/H1 (launch → Done)",
    !money.length && !mixed.length && done.endsWith("· on your Claude and Grok subscriptions"),
    `${SHOTS}/3.1/shots/done.png`,
    `${done}; ${money.length} money / ${mixed.length} mixed of ${rec.length} responses`,
  );
  // L3: Changes after Done = the PR's "Files changed".
  const ours = ((await get(`/api/runs/${run}/diff`)).files ?? []).map((f) => f.path).sort();
  const m = String(pr_url ?? "").match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  const theirs = m
    ? execFileSync("gh", ["api", `repos/${m[1]}/pulls/${m[2]}/files`, "--jq", ".[].filename"], { encoding: "utf8" }).trim().split("\n").sort()
    : [];
  smoke(null, "3.7 L3 (Changes = the PR's files)", m && ours.join() === theirs.join(), `${SHOTS}/3.7/shots/changes.png`, `${ours.join(", ")} vs PR ${theirs.join(", ")}`);
  const s = act.summary ?? {};
  const esc = lines.some((l) => /Couldn't satisfy the spec|Couldn’t satisfy the spec/.test(`${l.label ?? ""} ${l.text ?? ""}`));
  console.log(
    `HERO: run=${run} tests=${checks.map((c) => c.refs?.result).join("→") || "none"} rounds=${s.rounds} escalation=${esc ? "yes" : "no"} time=${done.match(/^Done in ([^·]+)/)?.[1]?.trim()} PR=${pr_url} recording=video/recordings/hero`,
  );
}

/** S4 on one run's Desktop jobs: the job's "Running on this computer…" line and its lock line; Grok's own
 *  profile `--sandbox tvashtr-j<6 hex>`; Claude's --restricted and apiKeySource: none; no Grok tool call
 *  with a path outside its --cwd that came back completed; no job that failed closed. */
function s4(events) {
  const jobs = new Map();
  for (const e of events) if (e.invocation_id != null) jobs.set(e.invocation_id, [...(jobs.get(e.invocation_id) ?? []), e]);
  const n = { grok: 0, claude: 0 };
  const bad = [];
  const norm = (p) => p.replace(/^\/private(?=\/(var|tmp)\/)/, "");
  for (const [inv, evs] of jobs) {
    const said = evs.map((e) => String(e.payload?.text ?? e.payload?.error ?? ""));
    if (said.some((t) => t.includes("couldn't lock itself"))) bad.push(`${String(inv).slice(0, 8)}: failed closed`);
    const ran = said.find((t) => t.startsWith("Running on this computer with your own "));
    if (!ran) continue; // not a Desktop job
    const who = ran.includes("own Grok Build:") ? "grok" : "claude";
    n[who] += 1;
    if (!said.includes(LOCK[who])) bad.push(`${String(inv).slice(0, 8)}: no ${who} lock line`);
    if (who === "claude") {
      if (!ran.includes(" --restricted ")) bad.push(`${String(inv).slice(0, 8)}: no --restricted`);
      if (!said.some((t) => t.includes("apiKeySource: none"))) bad.push(`${String(inv).slice(0, 8)}: apiKeySource not none`);
      continue;
    }
    if (!/ --sandbox tvashtr-j[0-9a-f]{6}$/.test(ran)) bad.push(`${String(inv).slice(0, 8)}: no job profile`);
    const ws = norm(ran.match(/ --cwd (\S+)/)?.[1] ?? "/nonexistent");
    const abs = (p) => norm(path.resolve(ws, p.replace(/^~(?=\/|$)/, os.homedir())));
    evs.forEach((e, i) => {
      if (e.kind !== "action") return;
      const out = [...JSON.stringify(e.payload ?? {}).matchAll(PATH_ARG)].map((x) => abs(x[1])).filter((p) => p !== ws && !p.startsWith(`${ws}/`));
      if (!out.length) return;
      const obs = evs.slice(i + 1).find((x) => x.kind === "observation");
      if (!obs || /^completed/.test(String(obs.payload?.observation ?? obs.payload?.status ?? ""))) bad.push(`${String(inv).slice(0, 8)}: opened ${out.join(", ")}`);
    });
  }
  return { n, bad };
}

async function s4All(api) {
  for (const r of (await api("GET", "/api/runs?limit=100")).json?.runs ?? []) {
    const { n, bad } = s4((await api("GET", `/api/spike/run-events/${r.run_id}`)).json?.events ?? []);
    smoke(
      null,
      `S4 run #${r.number ?? "?"} ${r.run_id.slice(0, 8)}`,
      !bad.length && n.grok + n.claude > 0,
      `${SHOTS}/3.1/shots/reviewer-raw-log.png`,
      `${(r.idea ?? "").slice(0, 40)}: ${n.grok} Grok · ${n.claude} Claude jobs${bad.length ? ` · ${bad.join("; ")}` : ""}`,
    );
  }
}

async function main() {
  const api = apiSession();
  if ((await loginApi(api)).status !== 200) throw new Error("sign-in failed");
  const what = process.argv[2] ?? "hero";
  if (what === "hero") await hero(api);
  else if (what === "s4") await s4All(api);
  else throw new Error("usage: smoke.mjs hero|s4");
}
if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
