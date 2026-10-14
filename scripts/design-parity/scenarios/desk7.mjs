// M-desk-7 — F2: a running run's toolbar at 1440×900 with the film's live-length content (its
// version tag, the Desktop's subscriptions wording, a full `tvashtr/<uuid>` branch, one document —
// what V2's and M-desk-6's live runs showed) fits one row (Runs › Live-RunningLongDesktop,
// Live-RunningLong). S4: a Grok step that couldn't lock itself to its job's copy fails closed
// (Runs › Prob-GrokLockDesktop), worded as the server words it (backend test_activity.py
// `test_a_grok_step_that_couldnt_lock_itself_in_reads_its_reason_exactly`).
// Each render logs `TOOLBAR <name> <height>px` — one row is 56px.
import desk4 from "./desk4.mjs";
import desk6 from "./desk6.mjs";
import { TEAM_ID } from "./panel-fixtures.mjs";
import { DOCS } from "./panel-runs-docs.mjs";
import { clockAt, RUN_ID } from "./runs-fixtures.mjs";

const RUN = `GET /api/runs/${RUN_ID}`;
const ACTIVITY = `${RUN}/activity`;
const BOTH = { subscriptions: ["claude", "grok"], all: true };
const BRANCH = "tvashtr/86bff6c6-b372-417f-9914-2788f95bf1c0";
const GROK_LOCK_FAILED =
  "Grok Build couldn't lock itself to this job's copy of the repo on this Mac, so Tvashtr didn't " +
  "start it. Nothing on your Mac was opened, and nothing was used from your Grok plan. Update " +
  "Grok Build, or switch this step to Claude.";
const clone = (v) => JSON.parse(JSON.stringify(v));
const from = (list, name) => {
  const s = list.find((x) => x.name === name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s;
};
/** `routes[key]` answered as `edit(body)` — every read, or only the Desktop's (`?desktop_target=1`). */
const edit = (routes, key, fn, desktopOnly = false) => {
  const base = routes[key];
  if (base === undefined) throw new Error(`no route ${key}`);
  return {
    ...routes,
    [key]: async (req) => {
      const r = typeof base === "function" ? await base(req) : { json: base };
      const desk = new URL(req.url()).searchParams.get("desktop_target") === "1";
      return desktopOnly && !desk ? r : { ...r, json: fn(clone(r.json)) };
    },
  };
};
const measured = (s) => ({
  ...s,
  steps: async (page) => {
    if (s.steps) await s.steps(page);
    const bar = await page.getByRole("toolbar", { name: "Team" }).boundingBox();
    console.log(`TOOLBAR ${s.name} ${bar ? Math.round(bar.height * 10) / 10 : "none"}px`);
  },
});

// ---- F2: the running toolbar with the film's strings ----
const long = (routes) => {
  let r = edit(routes, RUN, (b) => ({
    ...b,
    run: { ...b.run, team_version_number: 1, ship_branch: BRANCH },
  }));
  r = edit(r, RUN, (b) => ({ ...b, run: { ...b.run, ran_on: BOTH } }), true);
  r = edit(r, `${RUN}/documents`, (b) => ({ ...b, documents: DOCS.documents.slice(0, 1) }));
  return r;
};
const running = [
  ["Live-TestsFailedDesktop-desktop", "Live-RunningLongDesktop-desktop"],
  ["Live-TestsFailed-web", "Live-RunningLong-web"],
].map(([src, name]) => {
  const s = from(desk6, src);
  return measured({ ...s, name, routes: long(s.routes) });
});

// ---- S4: the Reviewer (Grok) couldn't lock itself in, so it never started ----
const at = (hms) => clockAt(hms);
const line = (id, hms, kind, text, tone = "neutral", refs = {}) => ({
  id,
  at: at(hms),
  node_id: "n-rev",
  label: "Reviewer",
  iteration: 2,
  kind,
  text,
  tone,
  refs,
});
const grokLock = (a) => {
  const failing = new Set(["retry", "backup", "error"]);
  const kept = a.lines.filter((l) => !(l.node_id === "n-eng" && failing.has(l.kind)));
  const end = kept.pop(); // the run's own last line stays last
  a.lines = [
    ...kept,
    line("inv:106:start", "10:59:01", "started", "Started"),
    line(
      "ev:40",
      "10:59:04",
      "error",
      "Hit an error: Grok Build couldn't lock itself to this job's copy of the repo on this Mac, so Tvashtr didn't start it. Nothing on your Mac was opened, and nothing was used fr…",
      "danger",
      { message: GROK_LOCK_FAILED },
    ),
    line("inv:106:end", "10:59:05", "error", `Failed: ${GROK_LOCK_FAILED}`, "danger", {
      message: GROK_LOCK_FAILED,
    }),
    end,
  ];
  a.total = a.lines.length;
  for (const ag of a.agents) {
    if (ag.node_id === "n-eng") Object.assign(ag, { live_state: "done", activity: "Finished its step" });
    if (ag.node_id === "n-rev") {
      Object.assign(ag, {
        live_state: "failed",
        activity: `Failed: ${GROK_LOCK_FAILED}`,
        iteration: 2,
        last_event_at: at("10:59:05"),
      });
    }
  }
  a.pinned = {
    ...a.pinned,
    node_id: "n-rev",
    label: "Reviewer",
    title: "Reviewer failed",
    body: `Reviewer: ${GROK_LOCK_FAILED} Nothing was shipped.`,
    resume: { invocation_id: 106, label: "Reviewer, round 2" },
    safe: "your approved spec (v2) and the Engineer’s round 2 changes are saved",
  };
  return a;
};
const failed = from(desk4, "Prob-FailedDesktop-desktop");
const s4 = measured({
  ...failed,
  name: "Prob-GrokLockDesktop-desktop",
  routes: edit(edit(failed.routes, ACTIVITY, grokLock), `${RUN}/graph`, (g) => {
    for (const n of g.nodes) {
      if (n.id === "n-eng") Object.assign(n, { status: "done", iteration: 2 });
      if (n.id === "n-rev") Object.assign(n, { status: "failed", iteration: 2 });
    }
    return g;
  }),
});

// ---- F1: the Tests pass check titled by its type (Team Setup › Chk-TestsPass) ----
const chk = from(desk6, "Chk-TestsPass-desktop");
const f1 = {
  ...chk,
  routes: edit(chk.routes, `GET /api/teams/${TEAM_ID}/graph`, (g) => {
    for (const n of g.nodes) if (n.id === "n-chk") n.config = { ...n.config, title: "Tests pass" };
    return g;
  }),
};

export default [...running, s4, f1];
