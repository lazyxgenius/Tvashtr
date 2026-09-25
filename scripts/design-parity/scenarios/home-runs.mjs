// Home (slice F1a): greeting, Start a run, Needs you, Running now, Recent runs, Spend — website and
// Desktop, plus the HmF-* flow frames. Fixtures (shared with home-teams.mjs) mirror the design's
// sample data and render the whole Home page, Teams included.
import {
  R,
  T,
  TEAMS,
  chip,
  desktopRepos,
  docsRun,
  homeRoutes,
  inboxItems,
  morning,
  rsiRun,
  run,
  runsRoute,
  scrollMain,
  tap,
  typeIdea,
} from "./home-fixtures.mjs";

// ---- Stateful flows: each scenario gets its own server state, changed by the POSTs it makes ----
function flow(start = {}) {
  const st = {
    keys: [], // providers saved via POST /api/providers
    approved: false,
    rejected: false,
    dismissed: [],
    launched: null, // { teamId, idea, retry }
    ...start,
  };
  const teamsNow = () =>
    TEAMS.map((t) => {
      const missing = t.readiness.website.missing_providers.filter(
        (p) => !st.keys.includes(p),
      );
      return {
        ...t,
        readiness: {
          ...t.readiness,
          website: {
            ...t.readiness.website,
            ready: missing.length === 0,
            missing_providers: missing,
          },
        },
      };
    });
  const inboxNow = () => {
    const items = inboxItems.filter((i) => {
      if (st.dismissed.includes(i.key)) return false;
      if (i.kind === "approval" && (st.approved || st.rejected)) return false;
      if (i.kind === "setup_gap")
        return i.missing_providers.some((p) => !st.keys.includes(p));
      if (i.kind === "run_failed" && st.launched?.retry) return false;
      return true;
    });
    return { count: items.length, items };
  };
  const activeNow = () => {
    const out = [];
    if (st.launched) {
      out.push(
        run(
          "4c1d0000-0000-4000-8000-00000000000a",
          st.launched.teamId,
          st.launched.teamName,
          st.launched.idea,
          "running",
          "running",
          0,
          {
            progress: [
              chip("p9", "PM", "pm", "completion", "active"),
              chip("a9", "Architect", "architect", "completion", "idle"),
              chip("g9", "Approval", "prd_gate", "gate", "idle"),
              chip("e9", "Engineer", "engineer", "agent", "idle"),
              chip("r9", "Reviewer", "reviewer", "agent", "idle", "e9"),
              chip("s9", "Ship", "ship", "terminal", "idle"),
            ],
          },
        ),
      );
    }
    if (st.approved) {
      out.push({
        ...rsiRun,
        status: "running",
        status_group: "running",
        awaiting: null,
        progress: rsiRun.progress.map((c) =>
          c.node_id === "g"
            ? { ...c, state: "done" }
            : c.node_id === "e"
              ? { ...c, state: "active" }
              : c,
        ),
      });
    } else if (!st.rejected) out.push(rsiRun);
    out.push(docsRun);
    return out;
  };
  const routes = homeRoutes({
    "GET /api/teams": () => ({ json: { teams: teamsNow() } }),
    "GET /api/inbox": () => ({ json: inboxNow() }),
    "GET /api/runs": (req) => {
      const u = new URL(req.url());
      if (u.searchParams.get("status") === "active")
        return { json: { runs: activeNow(), next_cursor: null } };
      return runsRoute()(req);
    },
    "POST /api/providers": (req) => {
      const body = JSON.parse(req.postData() ?? "{}");
      st.keys.push(body.provider);
      return { json: { provider: body.provider, key_last4: "wQ3f" } };
    },
    "POST /api/runs/:id/tasks/:task/resolve": (req) => {
      const body = JSON.parse(req.postData() ?? "{}");
      if (body.decision === "approve") st.approved = true;
      else st.rejected = true;
      return { json: { run_id: R.rsi, task_id: 812 } };
    },
    "POST /api/inbox/dismissals": (req) => {
      const body = JSON.parse(req.postData() ?? "{}");
      st.dismissed.push(body.key);
      return { json: { key: body.key, action: body.action, until: null } };
    },
    "POST /api/runs": async (req) => {
      const body = JSON.parse(req.postData() ?? "{}");
      if (st.slowLaunch) await new Promise((r) => setTimeout(r, 4000));
      const t = TEAMS.find((x) => x.team_graph_id === body.team_graph_id);
      st.launched = {
        teamId: body.team_graph_id,
        teamName: t?.name,
        idea: body.idea,
        retry: Boolean(body.retry_of_run_id),
      };
      return { json: { run_id: "4c1d0000-0000-4000-8000-00000000000a" } };
    },
  });
  return routes;
}

const saveKey = async (page, key) => {
  await page.getByPlaceholder("Paste the key").fill(key);
  await tap(page, page.getByRole("button", { name: "Save key" }));
  await page.waitForTimeout(250);
};
const openReview = async (page) =>
  tap(page, page.getByRole("button", { name: "Review" }).first());
const launchWithKeys = async (page) => {
  await typeIdea(page);
  await tap(page, page.getByRole("button", { name: "Launch" }));
  await tap(page, page.getByRole("button", { name: "Add keys" }));
};

// HmF-History: the page shifted up 800px (the design's margin-top), then a team card's ⋯ →
// Run history.
const openHistory = (teamName) => async (page) => {
  await page.waitForSelector(".hm-teams__title");
  await page.evaluate(() => {
    document.querySelector(".sh-main__inner").style.marginTop = "-800px";
  });
  await tap(
    page,
    page.getByRole("button", { name: `More actions for ${teamName}` }),
  );
  // The menu can open below the window's edge (the last card); click it without scrolling.
  await page
    .getByRole("menuitem", { name: "Run history" })
    .dispatchEvent("click");
};
const teamRuns = homeRoutes()["GET /api/teams/:id/runs"];

const flows = [
  {
    name: "history-1",
    routes: {
      "GET /api/teams/:id/runs": async () => {
        await new Promise((r) => setTimeout(r, 4000));
        return { json: teamRuns };
      },
    },
    steps: openHistory("Indicator sprint team"),
  },
  { name: "history-2", steps: openHistory("Indicator sprint team") },
  {
    name: "history-3",
    routes: {
      "GET /api/teams/:id/runs": () => ({
        status: 500,
        json: { detail: "boom" },
      }),
    },
    steps: openHistory("Indicator sprint team"),
  },
  {
    name: "history-4",
    routes: { "GET /api/teams/:id/runs": { runs: [] } },
    steps: openHistory("Landing page team"),
  },
  {
    name: "approve-3",
    steps: async (page) => {
      await openReview(page);
      await tap(
        page,
        page.getByRole("button", { name: "Approve and continue" }),
      );
    },
  },
  {
    name: "reject-2",
    steps: async (page) => {
      await openReview(page);
      await tap(page, page.getByRole("button", { name: "Reject…" }));
      await page
        .getByLabel(/What should change next time/)
        .fill(
          "Also cover the 14-period default and the overbought/oversold lines.",
        );
      await tap(
        page,
        page.getByRole("button", { name: "Reject and stop run" }),
      );
    },
  },
  {
    name: "dismiss-2",
    steps: async (page) => {
      await tap(
        page,
        page.getByRole("button", { name: "More for 2 new memories to review" }),
      );
      await tap(page, page.getByRole("menuitem", { name: "Dismiss" }));
    },
  },
  {
    name: "allclear-1",
    state: {
      dismissed: [
        "gate:812",
        `run_failed:${R.flaky}`,
        `setup:${T.indicator}:website`,
      ],
    },
    steps: async (page) => {
      await tap(
        page,
        page.getByRole("button", { name: "More for 2 new memories to review" }),
      );
      await tap(page, page.getByRole("menuitem", { name: "Dismiss" }));
    },
  },
  {
    name: "launch-4",
    steps: async (page) => {
      await launchWithKeys(page);
      await saveKey(page, "sk-ant-api03-wQ3f");
    },
  },
  {
    name: "launch-5",
    steps: async (page) => {
      await launchWithKeys(page);
      await saveKey(page, "sk-ant-api03-wQ3f");
      await saveKey(page, "xai-wQ3f");
    },
  },
  {
    name: "launch-6",
    state: { keys: ["anthropic", "xai"], slowLaunch: true },
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Launch" }));
    },
  },
  {
    name: "launch-7",
    state: { keys: ["anthropic", "xai"] },
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Launch" }));
      await page.waitForTimeout(400);
      await scrollMain(330)(page);
    },
  },
  {
    name: "retry-2",
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Retry" }));
      await page.waitForTimeout(300);
      await tap(page, page.locator(".hm-hint__fix"));
    },
  },
  {
    name: "retry-3",
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Retry" }));
      await page.waitForTimeout(300);
      await tap(page, page.locator(".hm-hint__fix"));
      await saveKey(page, "xai-wQ3f");
    },
  },
  {
    name: "retry-4",
    state: { keys: ["xai"] },
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Retry" }));
      await page.waitForTimeout(300);
      await tap(page, page.getByRole("button", { name: "Launch" }));
    },
  },
  {
    name: "fixsetup-1",
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Fix", exact: true }));
    },
  },
  {
    name: "fixsetup-2",
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Fix", exact: true }));
      await saveKey(page, "sk-ant-api03-wQ3f");
    },
  },
  {
    name: "fixsetup-3",
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Fix", exact: true }));
      await saveKey(page, "sk-ant-api03-wQ3f");
      await saveKey(page, "xai-wQ3f");
    },
  },
  { name: "stop-1", steps: scrollMain(330) },
  {
    name: "stop-3",
    steps: async (page) => {
      await scrollMain(330)(page);
      await tap(page, page.getByRole("button", { name: "Stop" }).nth(1));
      await tap(page, page.getByRole("button", { name: "Stop run" }));
    },
  },
  {
    name: "runsfilter-2",
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "All runs" }));
      await tap(page, page.getByRole("option", { name: "Failed" }));
    },
  },
].map((f) => {
  const routes = { ...flow(f.state), ...(f.routes ?? {}) };
  if (f.name === "stop-3") {
    routes["POST /api/runs/:id/cancel"] = {
      run_id: R.docs,
      status: "cancelled",
      workflow_status: "CANCELLED",
    };
  }
  return { path: "/#/home", init: morning, ...f, routes };
});

export default [
  { name: "home-web", path: "/#/home", routes: homeRoutes(), init: morning },
  {
    name: "home-desktop",
    path: "/#/home",
    desktop: true,
    routes: homeRoutes({ "GET /api/teams": { teams: TEAMS } }),
    init: desktopRepos,
  },
  {
    name: "home-1024",
    path: "/#/home",
    width: 1024,
    height: 768,
    routes: homeRoutes(),
    init: morning,
  },
  {
    name: "home-full",
    path: "/#/home",
    height: 1560,
    routes: homeRoutes(),
    init: morning,
  },
  {
    name: "home-loading",
    path: "/#/home",
    routes: homeRoutes(),
    init: () => {
      const real = window.fetch;
      window.fetch = (input, opts) => {
        const url = String(input instanceof Request ? input.url : input);
        if (/\/api\/(teams|inbox|runs|spend)/.test(url))
          return new Promise(() => {});
        return real(input, opts);
      };
    },
  },
  {
    name: "home-allcaughtup",
    path: "/#/home",
    init: morning,
    routes: homeRoutes({
      "GET /api/inbox": { count: 0, items: [] },
      "GET /api/runs": runsRoute({ active: [docsRun] }),
    }),
  },
  // ---- flows ----
  {
    name: "pickteam-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.locator(".hm-picker--team"));
    },
  },
  {
    name: "pickteam-2",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.locator(".hm-picker--team"));
      await tap(page, page.getByRole("option", { name: /Docs team/ }));
      await page.mouse.click(700, 120);
    },
  },
  {
    name: "idea-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await page
        .getByRole("textbox", { name: "What should the team build?" })
        .focus();
    },
  },
  {
    name: "idea-2",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: typeIdea,
  },
  {
    name: "pickrepo-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
    },
  },
  {
    name: "pickrepo-2",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
      await tap(
        page,
        page.getByRole("option", { name: /No repo · build a fresh app/ }),
      );
    },
  },
  {
    name: "pickfolder-1",
    path: "/#/home",
    desktop: true,
    init: desktopRepos,
    routes: homeRoutes({ "GET /api/teams": { teams: TEAMS } }),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
    },
  },
  {
    name: "pickfolder-2",
    path: "/#/home",
    desktop: true,
    init: desktopRepos,
    routes: homeRoutes({ "GET /api/teams": { teams: TEAMS } }),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
      await tap(
        page,
        page.getByRole("option", { name: /~\/code\/cryptoground-mcp/ }),
      );
    },
  },
  {
    name: "options-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Options" }));
    },
  },
  {
    name: "launch-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Launch" }));
    },
  },
  {
    name: "launch-2",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Launch" }));
    },
  },
  {
    name: "launch-3",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Launch" }));
      await tap(page, page.getByRole("button", { name: "Add keys" }));
    },
  },
  {
    name: "approve-2",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Review" }).first());
    },
  },
  {
    name: "reject-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Review" }).first());
      await tap(page, page.getByRole("button", { name: "Reject…" }));
    },
  },
  {
    name: "dismiss-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(
        page,
        page.getByRole("button", { name: "More for 2 new memories to review" }),
      );
    },
  },
  {
    name: "retry-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Retry" }));
      await page.evaluate(() =>
        document.querySelector(".sh-main")?.scrollTo(0, 0),
      );
    },
  },
  {
    name: "stop-2",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await scrollMain(330)(page);
      await tap(page, page.getByRole("button", { name: "Stop" }).nth(1));
    },
  },
  {
    name: "runsfilter-1",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "All runs" }));
    },
  },
  {
    name: "runsfilter-3",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "All runs" }));
      await tap(page, page.getByRole("option", { name: "Stopped" }));
    },
  },
  {
    name: "runsfilter-4",
    path: "/#/home",
    init: morning,
    routes: homeRoutes(),
    steps: async (page) => {
      await page.getByRole("link", { name: /PR #42/ }).hover();
    },
  },
  ...flows,
];
