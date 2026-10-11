/**
 * 6.2 History (SAMPLE): the film team at v8 after "Save and run tests" — History lists v8..v1 with
 * the summaries the server writes for the saves the live part's setup makes (scene 6.2 "save"), the
 * Reviewer's test pills, and What changed in v8 (its instructions + its backup model).
 *
 * Copied from scripts/design-parity/scenarios/{versions,agent-tests}.mjs and rewritten to the
 * story: the team, graph, account and keys are the live base (live-base.json); the versions are
 * shaped as backend/tvashtr/control_plane/versions.py listing()/detail() return them; the tests as
 * agent_tests.py version_rows() / the graph's tests chip. Nothing here shows money: History and What
 * changed carry no cost, and the base take opens no test results.
 *
 * The narrative (sample, see video/SCENES.md): v1 = the team with chapter 2's nodes (the domain
 * step, the guardrail gates), v2..v7 = chapter 2's agent edits saved one by one, the runs of
 * chapters 3–5 on v7, 6.1's 4 Reviewer tests run on v7 (3 passed: the AI check failed), 6.2 saved
 * v8 and its tests ran on the Grok subscription (4 of 4).
 */
import { ago, GRAPH, liveRoutes, NODE, story, TEAM_ID } from "./base.mjs";

const MIN = 60;
const DAY = 86400;
const T = `/api/teams/${TEAM_ID}`;
const REV = NODE.reviewer;

/** 6.2's edit: one line added to the Reviewer's instructions, and a backup model. */
export const LINE = "- In the reasons, name the file and line of each problem (for example core/indicators.py:118).";
export const NOTE = "Reviewer names the file and line of each problem";
export const V8_SUMMARY = "Reviewer: instructions and backup model changed";
/**
 * The Reviewer's tests: the 4 that 6.1 makes on camera (one from a round + its 3-row CSV). The live
 * setup uploads video/fixtures/files/history-reviewer-tests.csv: 6.1's CSV rows plus one row that
 * stands in for the round test (an AI check can't come from a file).
 */
export const TESTS = 4;

/**
 * v1..v7 as the server summarises the saves the live part's setup makes (versions.py summary());
 * the live setup checks each one against this list.
 */
export const SAVES = [
  "First version", // 2.1 the team from the template
  "PM: instructions changed", // 2.2
  "Engineer: skills and tools changed", // 2.4 the fetch tool, the mcp-builder skill
  "Engineer: added a backup model", // 2.5
  `Reviewer: model changed to ${story.agents.reviewer.model}`, // 2.5
  "Engineer: settings changed", // 2.6 Remember what it learns
  "Added the Fixer and 2 more changes", // 2.6 the Fixer on the failure path
];

/** When each version was saved (chapter 2 two days ago, v8 just now). */
const SAVED = { 1: 2 * DAY + 55 * MIN, 2: 2 * DAY + 48 * MIN, 3: 2 * DAY + 40 * MIN, 4: 2 * DAY + 31 * MIN,
  5: 2 * DAY + 29 * MIN, 6: 2 * DAY + 18 * MIN, 7: 2 * DAY + 12 * MIN, 8: 9 * MIN };
/** The runs on each version: chapters 3–5 (hero, TRIX, TRIX resumed, DEMA) ran on v7. */
const RUNS = { 7: 4 };
/** History's test pill: v7 = 6.1's run (the AI check failed), v8 = the save's run. */
const ROW_TESTS = { 7: { passed: TESTS - 1, total: TESTS, running: false }, 8: { passed: TESTS, total: TESTS, running: false } };

const row = (number, summary, note = null) => ({
  number,
  created_at: ago(SAVED[number]),
  author: "you",
  summary,
  note,
  runs: RUNS[number] ?? 0,
  source: number === 1 ? "first" : "save",
  restored_from: null,
  tests: ROW_TESTS[number] ?? null,
  check: null,
});

const VERSIONS = () => ({
  current: 8,
  saved_at: ago(SAVED[8]),
  changes: 0,
  next: 9,
  total: 8,
  versions: [row(8, V8_SUMMARY, NOTE), ...SAVES.map((s, i) => row(i + 1, s)).reverse()],
  tests: null, // nothing changed since v8: Save as v9 has nothing to offer
  check_sets: [], // the task set is made in 6.3, after this
});

/** What changed in v8 (versions.py detail()). */
const V8 = () => {
  const prompt = GRAPH().nodes.find((n) => n.id === REV).prompt.split("\n");
  return {
    ...row(8, V8_SUMMARY, NOTE),
    current: true,
    compared_with: 7,
    changes: [
      {
        node_id: REV,
        agent: "Reviewer",
        role: "reviewer",
        gate: false,
        key: `node:${REV}:prompt`,
        field: "Instructions",
        kind: "text",
        removed: 0,
        added: 1,
        lines: [
          { op: "context", text: prompt[prompt.length - 1] },
          { op: "added", text: LINE },
        ],
      },
      {
        node_id: REV,
        agent: "Reviewer",
        role: "reviewer",
        gate: false,
        key: `node:${REV}:fallback_model`,
        field: "Backup model",
        kind: "value",
        before: null,
        after: story.backup_model,
      },
    ],
    same: ["routes", "gates", "budget"],
    runs: [],
  };
};

/** The graph at v8: the Reviewer's new line, its backup model, its tests chip (4 of 4). */
function graph() {
  const g = GRAPH();
  const rev = g.nodes.find((n) => n.id === REV);
  rev.prompt = `${rev.prompt}\n${LINE}`;
  rev.config = { ...rev.config, fallback_model: story.backup_model };
  rev.tests = { total: TESTS, passed: TESTS, ran: TESTS, running: null, stopped: false };
  return g;
}

export default () => {
  const routes = liveRoutes();
  routes[`GET ${T}/graph`] = graph();
  routes[`GET ${T}/versions?desktop_target=1`] = VERSIONS();
  routes[`GET ${T}/versions/8`] = V8();
  return routes;
};
