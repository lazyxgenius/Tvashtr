// M-desk-4 — the Desktop boards of money, time and keys copy (Quality › Set-RunningDesktop,
// Cmp-RunningDesktop, Cmp-ResultsDesktop, Set-ResultsDesktop, Cmp-StartDesktop,
// Set-StartSetDesktop, Set-SaveCheckDesktop, Set-EditDesktop, Test-RunningDesktop,
// Test-ResultsDesktop, Test-ReplayDesktop; Runs › Live-DoneDesktop, Prob-FailedDesktop,
// Prob-PickDesktop, Prob-ConfirmDesktop; Team Setup › Ver-RunTagDesktop, Home-DesktopSpend,
// Home-OptionsDesktop, Home-LaunchDesktop, Home-KeysSavedDesktop, Eng-KeyUsedDesktop,
// Eng-ReplaceKeyDesktop, Eng-KeyReplacedDesktop, Desktop-FocusBackup, Desktop-ModelPickerCustom,
// Panel-WarningsDesktop). Each is the original board's Desktop scenario, its reads answered as
// the server answers the Desktop (`?desktop_target=1`: where each run's work really ran, the
// queued set cell, the turn-taking minutes); the website's reads are the original fixtures.
import agentTests from "./agent-tests.mjs";
import compare from "./compare.mjs";
import { desktopInit, enginesRoutes, key, KEYS } from "./engines-fixtures.mjs";
import home from "./home-runs.mjs";
import advanced from "./panel-advanced.mjs";
import model from "./panel-model.mjs";
import resume from "./runs-resume.mjs";
import live from "./runs-live.mjs";
import taskSets from "./task-sets.mjs";
import versions from "./versions.mjs";

const CLAUDE = { subscriptions: ["claude"], all: true };
const GROK = { subscriptions: ["grok"], all: true };
const BOTH = { subscriptions: ["claude", "grok"], all: true };
const NONE = { subscriptions: [], all: false };
const LINE = "Waiting for your Claude subscription — one job at a time.";
const PLAN_OF = { "Product manager": "claude", Engineer: "claude", Reviewer: "grok" };

const clone = (v) => JSON.parse(JSON.stringify(v));
const pick = (list, name) => {
  const s = list.find((x) => x.name === name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s;
};
/** The Desktop's read of `key` (any query with desktop_target=1) answers `edit(base)`. */
const desk = (routes, key, edit) => {
  const base = routes[key];
  if (base === undefined) throw new Error(`no route ${key}`);
  return {
    ...routes,
    [key]: async (req) => {
      const r = typeof base === "function" ? await base(req) : { json: base };
      const asked = new URL(req.url()).searchParams.get("desktop_target") === "1";
      return asked ? { ...r, json: edit(clone(r.json)) } : r;
    },
  };
};
/** The board's scenario: the original's Desktop render under the new board's name. */
const variant = (list, from, board, edit = (r) => r, over = {}) => {
  const s = pick(list, from);
  return { ...s, name: `${board}-desktop`, routes: edit(s.routes ?? {}), ...over };
};
const withRun = (routes, ran) =>
  desk(routes, "GET /api/runs/r-12", (s) => ({ ...s, run: { ...s.run, ran_on: ran } }));

// ---- Quality ----

const setRunning = variant(taskSets, "Set-Running-desktop", "Set-RunningDesktop", (r) =>
  desk(r, "GET /api/compares/cmp-set", (c) => {
    c.ran_on = CLAUDE;
    for (const row of c.items)
      for (const k of ["a", "b"])
        Object.assign(row[k], { queued: false, ran_on: row[k].run_id ? CLAUDE : NONE });
    const queued = (who) => ({ now: `${who} · ${LINE}`, queued: true });
    Object.assign(c.items[1].b, queued("Engineer"));
    Object.assign(c.items[2].a, queued("Reviewer"));
    Object.assign(c.items[2].b, queued("Engineer"));
    return c;
  }),
);

const cmpRunning = variant(compare, "Cmp-Running-desktop", "Cmp-RunningDesktop", (r) =>
  desk(r, "GET /api/compares/cmp-1", (c) => {
    c.ran_on = CLAUDE;
    for (const s of c.sides) s.ran_on = CLAUDE;
    return c;
  }),
);

const WORK =
  "On your Desktop, both versions share your subscription and take turns, so this counts working time only.";
const cmpResults = variant(compare, "Cmp-Results-desktop", "Cmp-ResultsDesktop", (r) =>
  desk(r, "GET /api/compares/cmp-1", (c) => {
    c.cost_usd = 0;
    c.ran_on = CLAUDE;
    for (const s of c.sides) Object.assign(s, { cost_usd: 0, ran_on: CLAUDE });
    for (const row of c.results.rows) {
      if (row.key === "cost")
        Object.assign(row, {
          a: "on your Claude subscription",
          b: "on your Claude subscription",
          better: null,
          difference: "same",
        });
      if (row.key === "time") row.label = "Work time";
    }
    Object.assign(c.results, { shared: true, note: WORK });
    return c;
  }),
);

const setResults = variant(taskSets, "Set-ResultsDesktop-desktop", "Set-ResultsDesktop", (r) =>
  desk(r, "GET /api/compares/cmp-set", (c) => {
    c.ran_on = CLAUDE;
    for (const row of c.items) for (const k of ["a", "b"]) row[k].ran_on = CLAUDE;
    for (const card of c.results.cards)
      if (card.key === "cost")
        Object.assign(card, { a: "on your Claude subscription", b: "on your Claude subscription" });
    return c;
  }),
);

/** The Compare tab read from the Desktop: v6 on Claude and Grok, v7 on Claude (they share Claude). */
const startDesk = (minutes) => (s) => {
  for (const v of s.versions)
    v.desktop = v.number === 6 ? BOTH : { subscriptions: ["claude"], all: true };
  if (s.estimate) s.estimate.minutes = minutes;
  return s;
};
const cmpStart = variant(compare, "Cmp-Start-desktop", "Cmp-StartDesktop", (r) =>
  desk(r, "GET /api/teams/t-ind/compare", startDesk(50)),
);
const setStart = variant(taskSets, "Set-StartSet-desktop", "Set-StartSetDesktop", (r) =>
  desk(
    desk(r, "GET /api/teams/t-ind/compare", startDesk(50)),
    "GET /api/teams/t-ind/task-sets",
    (body) => {
      for (const s of body.sets) {
        if (s.estimate) s.estimate.minutes = 80;
        s.desktop = BOTH;
      }
      return body;
    },
  ),
);

const saveCheck = (() => {
  const s = pick(taskSets, "Set-SaveCheckDesktop-desktop");
  const KEY = "GET /api/teams/t-ind/versions?desktop_target=1";
  const routes = { ...s.routes };
  const body = clone(routes[KEY]);
  for (const c of body.check_sets) c.estimate = { ...c.estimate, minutes: 80 };
  routes[KEY] = body;
  return { ...s, name: "Set-SaveCheckDesktop-desktop", routes };
})();

const setEdit = variant(taskSets, "Set-Edit-desktop", "Set-EditDesktop", (r) =>
  desk(r, "GET /api/teams/t-ind/task-sets", (body) => {
    for (const s of body.sets) {
      if (s.estimate) s.estimate.minutes = 80;
      s.desktop = BOTH;
    }
    return body;
  }),
);

const testsRead = "GET /api/teams/t-ind/nodes/n-rev/tests";
const testsRan = (r) =>
  desk(r, testsRead, (t) => {
    if (t.run) t.run.ran_on = GROK;
    return t;
  });
const testRunning = variant(agentTests, "Test-Running-desktop", "Test-RunningDesktop", testsRan);
const testResults = variant(agentTests, "Test-Results-desktop", "Test-ResultsDesktop", testsRan);
const testReplay = variant(agentTests, "Test-Replay-desktop", "Test-ReplayDesktop", (r) =>
  desk(testsRan(r), "GET /api/teams/t-ind/nodes/n-rev/tests/results/:id", (x) => ({
    ...x,
    ran_on: GROK,
  })),
);

// ---- Runs ----

const ranActivity = (r, edit = (a) => a) =>
  desk(r, "GET /api/runs/r-12/activity", (a) => {
    a.ran_on = BOTH;
    for (const ln of a.lines ?? [])
      if (ln.id === "run:done" || ln.kind === "done")
        ln.text = ln.text.replace(/ · \$\d+\.\d\d$/, " · on your Claude and Grok subscriptions");
    return edit(a);
  });
const liveDone = variant(live, "Live-Done-desktop", "Live-DoneDesktop", (r) =>
  ranActivity(withRun(r, BOTH)),
);
const probFailed = variant(resume, "Prob-Failed-desktop", "Prob-FailedDesktop", (r) =>
  ranActivity(withRun(r, BOTH)),
);
const planned = (info, confirm = false) => {
  for (const p of info.points ?? []) {
    p.plan = PLAN_OF[p.label] ?? null;
    if (confirm && p.confirm) Object.assign(p.confirm, { skips_ran_on: BOTH, again_ran_on: BOTH });
  }
  return info;
};
const probPick = variant(resume, "Prob-Pick-desktop", "Prob-PickDesktop", (r) =>
  desk(withRun(r, BOTH), "GET /api/runs/r-12/resume", (i) => planned(i)),
);
const probConfirm = variant(resume, "Prob-Confirm-desktop", "Prob-ConfirmDesktop", (r) =>
  desk(withRun(r, BOTH), "GET /api/runs/r-12/resume", (i) => planned(i, true)),
);

// ---- Team Setup ----

const runTag = variant(versions, "Ver-RunTag-desktop", "Ver-RunTagDesktop", (r) =>
  desk(r, "GET /api/teams/t-ind/runs", (body) => {
    body.runs.slice(0, 2).forEach((run) => (run.ran_on = BOTH));
    return body;
  }),
);

// D21/D22: Running now's budget and the Spend card's default budget (the board's $5.00).
const homeSpend = (() => {
  const s = pick(home, "home-desktop");
  const runs = s.routes["GET /api/runs"];
  return {
    ...s,
    name: "Home-DesktopSpend-desktop",
    routes: {
      ...s.routes,
      "GET /api/spend": { ...s.routes["GET /api/spend"], default_run_budget_usd: 5 },
      "GET /api/runs": async (req) => {
        const r = await runs(req);
        for (const run of r.json.runs ?? []) run.budget_cap_usd ??= 5;
        return r;
      },
    },
  };
})();
const homeOptions = {
  ...pick(home, "options-1"),
  name: "Home-OptionsDesktop-desktop",
  desktop: true,
};
// K8: on this Mac, Claude and Grok aren't connected, so the team can't run here yet.
const homeLaunch = (() => {
  const s = pick(home, "launch-2");
  const teams = clone(s.routes["GET /api/teams"]);
  for (const t of teams.teams)
    if (t.name === "Indicator sprint team")
      Object.assign(t.readiness, {
        desktop: {
          ready: false,
          missing_providers: ["anthropic", "xai"],
          missing_nodes: ["pm", "engineer"],
          routed_subscriptions: [],
        },
        subscriptions_connected: [],
      });
  return {
    ...s,
    name: "Home-LaunchDesktop-desktop",
    desktop: true,
    routes: { ...s.routes, "GET /api/teams": teams },
  };
})();
const homeSaved = {
  ...pick(home, "fixsetup-3"),
  name: "Home-KeysSavedDesktop-desktop",
  desktop: true,
};

// Engines › API keys: the boards' deepseek key and its Writer, as an anthropic key whose models
// run on Claude here (the Desktop).
const asAnthropic = (v) =>
  JSON.parse(
    JSON.stringify(v)
      .replaceAll("anthropic", "openai") // the team that used anthropic uses openai here
      .replaceAll("deepseek/deepseek-chat", "anthropic/claude-sonnet-4.5")
      .replaceAll("deepseek", "anthropic"),
  );
const anthropicRoutes = (over) =>
  Object.fromEntries(
    Object.entries(enginesRoutes({ domains: [], over })).map(([k, v]) => [
      k,
      typeof v === "function"
        ? async (req) => {
            const r = await v(req);
            return { ...r, json: asAnthropic(r.json) };
          }
        : asAnthropic(v),
    ]),
  );
const keysPage = "/#/engines/keys";
const tableReady = (p) => p.waitForSelector('[data-testid="engines-key-provider"]');
const menu = (p) => async (page) => {
  await tableReady(page);
  await page.click(`button[aria-label="More actions for ${p}"]`);
  await page.waitForSelector('[role="menu"]');
  await page.mouse.move(700, 860);
};
const item = (label) => (page) =>
  page.click(`[role="menu"] [role="menuitem"]:has-text("${label}")`);
const seq =
  (...fns) =>
  async (page) => {
    for (const f of fns) await f(page);
  };
const engines = (board, steps, over = {}) => ({
  name: `${board}-desktop`,
  path: keysPage,
  desktop: true,
  init: desktopInit(),
  routes: anthropicRoutes(over),
  steps,
});
const keyUsed = engines(
  "Eng-KeyUsedDesktop",
  seq(menu("anthropic"), item("See where it’s used"), (p) =>
    p.waitForSelector('[role="dialog"][aria-label="Where the anthropic key is used"]'),
  ),
);
const replaceKey = engines(
  "Eng-ReplaceKeyDesktop",
  seq(menu("anthropic"), item("Replace key"), async (p) => {
    await p.waitForSelector('[role="alertdialog"]');
    await p.fill('[role="alertdialog"] input', "••••••••••••••••••••Qm81");
  }),
);
const keyReplaced = engines(
  "Eng-KeyReplacedDesktop",
  seq(menu("anthropic"), item("Replace key"), async (p) => {
    await p.waitForSelector('[role="alertdialog"]');
    await p.fill('[role="alertdialog"] input', "sk-ant-e2e-Qm81");
    await p.click('[role="alertdialog"] button:has-text("Replace key")');
    await p.waitForSelector('[role="status"].ds-toast');
  }),
  {
    "POST /api/providers": {
      provider: "anthropic",
      key_last4: "Qm81",
      created_at: "2026-09-12T08:01:10+00:00", // the deepseek key's, now anthropic's
      updated_at: new Date().toISOString(),
      replaced: true,
    },
  },
);

// K2, several agents: the anthropic key saved, and the Writer's deepseek model is an anthropic one
// too, so two agents use the key ("Agents use the new one on their next website run.").
const replaceAgents = (() => {
  const routes = enginesRoutes({
    domains: [],
    over: {
      "GET /api/providers": {
        providers: [key("anthropic", "wQ3f", new Date().toISOString()), ...KEYS],
      },
    },
  });
  const usage = routes["GET /api/engines/usage"];
  return {
    name: "Eng-ReplaceKeyAgentsDesktop-desktop",
    path: keysPage,
    desktop: true,
    init: desktopInit(),
    routes: {
      ...routes,
      "GET /api/engines/usage": JSON.parse(
        JSON.stringify(usage)
          .replaceAll("deepseek/deepseek-chat", "anthropic/claude-sonnet-4.5")
          .replaceAll("deepseek", "anthropic"),
      ),
    },
    steps: seq(menu("anthropic"), item("Replace key"), async (p) => {
      await p.waitForSelector('[role="alertdialog"]');
      await p.evaluate(() => document.activeElement?.blur());
    }),
  };
})();

// K8, the team picker: on this Mac Claude and Grok aren't connected (Indicator sprint team needs
// both, Bugfix squad needs Grok).
const pickTeam = (() => {
  const s = pick(home, "pickteam-1");
  const teams = clone(s.routes["GET /api/teams"]);
  const gap = { "Indicator sprint team": ["anthropic", "xai"], "Bugfix squad": ["xai"] };
  for (const t of teams.teams)
    if (gap[t.name])
      Object.assign(t.readiness, {
        desktop: {
          ready: false,
          missing_providers: gap[t.name],
          missing_nodes: ["engineer"],
          routed_subscriptions: [],
        },
        subscriptions_connected: [],
      });
  return {
    ...s,
    name: "Home-PickTeamDesktop-desktop",
    desktop: true,
    routes: { ...s.routes, "GET /api/teams": teams },
  };
})();

const focusBackup = (() => {
  const s = pick(advanced, "Desktop-Focus-desktop");
  return {
    ...s,
    name: "Desktop-FocusBackup-desktop",
    steps: async (p) => {
      await s.steps(p);
      const adv = p.getByRole("button", { name: /^Advanced/ });
      if ((await adv.count()) && (await adv.first().getAttribute("aria-expanded")) !== "true")
        await adv.first().click();
      await p.mouse.move(700, 880);
    },
  };
})();

const pickerCustom = (() => {
  const s = pick(model, "Desktop-ModelPicker-desktop");
  return {
    ...s,
    name: "Desktop-ModelPickerCustom-desktop",
    steps: async (p) => {
      await s.steps(p);
      await p.getByRole("button", { name: "Use a custom model ID" }).click();
      await p.getByRole("textbox", { name: "Custom model ID" }).fill("anthropic/claude-opus-4.1");
      await p.evaluate(() => document.activeElement?.blur());
      await p.mouse.move(700, 880);
    },
  };
})();

const warnings = (() => {
  const s = pick(model, "Panel-Warnings-desktop");
  return {
    ...s,
    name: "Panel-WarningsDesktop-desktop",
    steps: async (p) => {
      // Panel-Warnings, the backup model a mistyped Grok one (it runs on the plan here).
      const fill = p.fill.bind(p);
      const loc = p.getByRole.bind(p);
      p.getByRole = (role, opts) => {
        const l = loc(role, opts);
        if (role === "textbox" && opts?.name === "Custom model ID") {
          const f = l.fill.bind(l);
          l.fill = () => f("xai/grok-4.7-mni");
        }
        return l;
      };
      try {
        await s.steps(p);
      } finally {
        p.getByRole = loc;
        p.fill = fill;
      }
    },
  };
})();

/** A string's proof shot: the board's scenario, scrolled to the string (the app lays it out below
 *  the fold where the board draws it in view). Parity uses the unscrolled shot. */
const proof = (s, text) => ({
  ...s,
  name: s.name.replace(/-desktop$/, "-proof-desktop"),
  steps: async (p) => {
    await s.steps?.(p);
    await p.getByText(text).first().scrollIntoViewIfNeeded();
    await p.mouse.move(700, 880);
  },
});

export default [
  setRunning,
  cmpRunning,
  cmpResults,
  setResults,
  cmpStart,
  setStart,
  saveCheck,
  setEdit,
  testRunning,
  testResults,
  testReplay,
  liveDone,
  probFailed,
  probPick,
  probConfirm,
  runTag,
  homeSpend,
  homeOptions,
  homeLaunch,
  homeSaved,
  keyUsed,
  replaceKey,
  keyReplaced,
  focusBackup,
  pickerCustom,
  warnings,
  replaceAgents,
  pickTeam,
  proof(homeSpend, /^Each run stops at/),
  // D21 without a budget: "$1.21 spent on keys".
  (() => {
    const s = proof(homeSpend, /^Each run stops at/);
    const runs = s.routes["GET /api/runs"];
    return {
      ...s,
      name: "Home-DesktopSpend-nocap-proof-desktop",
      routes: {
        ...s.routes,
        "GET /api/runs": async (req) => {
          const r = await runs(req);
          for (const run of r.json.runs ?? []) run.budget_cap_usd = null;
          return r;
        },
      },
    };
  })(),
  proof(focusBackup, /^Used once if the main model fails/),
  proof(warnings, /^No provider matches/),
  proof(probFailed, /^Next:/),
  // D2: a failed run's end line as the server words it for the Desktop (test_desk_4 (p) asserts
  // the server side); the Prob-Failed fixture, like its board, stops before the end line.
  (() => {
    const s = proof(probFailed, /^Failed after/);
    return {
      ...s,
      name: "Prob-FailedDesktop-endline-proof-desktop",
      routes: desk(s.routes, "GET /api/runs/r-12/activity", (a) => {
        const last = a.lines[a.lines.length - 1];
        a.lines.push({
          ...last,
          id: "run:done",
          node_id: null,
          iteration: null,
          kind: "done",
          tone: "danger",
          text: "Failed after 18m 40s · on your Claude and Grok subscriptions",
          refs: { elapsed_s: 1120, cost_usd: 0 },
        });
        return a;
      }),
    };
  })(),
];
