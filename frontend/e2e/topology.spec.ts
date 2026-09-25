import { type APIRequestContext, expect, test } from "@playwright/test";

import { runFromCanvas } from "./_composer";
import { registerFresh } from "./_home";
import { seedProviderKeys } from "./_keys";

// P1.8d topology editing — author your own wiring. Two proofs:
//   (1) From a BLANK team, author a runnable graph from scratch (root thinker → Engineer worker →
//       Ship) using the canvas (the palette adds the worker; the edges are wired through the same
//       team CRUD endpoints the connect-gesture calls), then RUN it through the UI and assert it
//       ships — a real NIM run end-to-end on a graph the user built.
//   (2) A graph made invalid (an unconnected just-dropped node → two entry points) GREYS OUT Run with
//       the reason, AND the server refuses create_run with a 422 carrying the structured errors.
// The pure connect/role logic (which role a source may emit, loop detection, the emit-contract) is
// proven in the vitest unit suite (src/lib/topology.test.ts); this is the live wiring + run proof.
// Revamp round 1: each test signs in as a fresh account, the Blank team comes from Home's New team
// dialog, and the run launches through Home's composer (the canvas's "Run this team" opens it).
// Authenticated API calls go through `page.request` (the bare `request` fixture has no session).

// The PM behaviour the root thinker needs to restate the pinned skeleton deliverable (kept in step
// with teams.PM_PROMPT — the blank thinker ships an empty prompt, so we author one here).
const PM_PROMPT =
  "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) for the feature " +
  "request below. You MUST restate, verbatim, the exact file path and the exact required file " +
  "contents (each clearly labelled on its own line), plus one sentence of context for the engineer.";

interface Graph {
  nodes: { id: string; role_name: string; kind: string }[];
  edges: { id: string; source_node_id: string; target_node_id: string }[];
}

const graphOf = async (request: APIRequestContext, teamId: string): Promise<Graph> =>
  (await (await request.get(`/api/teams/${teamId}/graph`)).json()) as Graph;

const isRunnable = async (request: APIRequestContext, teamId: string): Promise<boolean> =>
  ((await (await request.get(`/api/teams/${teamId}/validate`)).json()) as { runnable: boolean })
    .runnable;

const runStatusOf = async (
  request: APIRequestContext,
  runId: string,
): Promise<string | undefined> =>
  ((await (await request.get(`/api/runs/${runId}`)).json()) as { run: { status: string } | null })
    .run?.status;

// P1.8d-fix1: the authoring canvas once hung the tab with an infinite render loop ("Maximum update
// depth exceeded") the moment a multi-node team was selected. Capture the real browser's console
// errors + uncaught page exceptions for the whole authoring flow and fail the spec if the render-loop
// class ever fires — so a regression that reintroduces an inline `[]`/unstable prop in a hook dep
// array can never ship green again.
let consoleErrors: string[] = [];
let pageErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
});

test.afterEach(() => {
  const loop = [...consoleErrors, ...pageErrors].filter((t) =>
    /Maximum update depth exceeded/i.test(t),
  );
  expect(loop, `authoring triggered a render loop:\n${loop.join("\n")}`).toEqual([]);
  // Any uncaught exception during the authoring flow is also a hard fail (the hang surfaced as one).
  expect(pageErrors, `uncaught page error during authoring:\n${pageErrors.join("\n")}`).toEqual([]);
});

async function newBlankTeam(page: import("@playwright/test").Page, name: string): Promise<string> {
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New team", exact: true }).first().click();
  const picker = page.getByRole("dialog", { name: "New team" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker
    .locator("button.hm-tplcard", {
      has: page.locator(".hm-tplcard__name", { hasText: /^Blank$/ }),
    })
    .click();
  await picker.getByLabel("Name", { exact: true }).fill(name);
  await picker.getByRole("button", { name: "Create team" }).click();
  const teamId = ((await (await createResp).json()) as { team_graph_id: string }).team_graph_id;
  expect(teamId, "the Blank-team picker creates a team and returns its id").toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`#/teams/${teamId}$`), { timeout: 30_000 });
  return teamId;
}

test("P1.8d: an invalid graph greys out Run with the reason and the server refuses the launch (422)", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  await registerFresh(page, "topology-invalid");
  // A keyless account's canvas shows "Configure providers" in place of "Run this team"; hold a DUMMY
  // deepseek key (it serves both seats; this test never starts a run, so it is never used).
  const key = await page.request.post("/api/providers", {
    data: { provider: "deepseek", api_key: "dummy-deepseek-key-0000" },
  });
  expect(key.ok(), "store a dummy deepseek key").toBeTruthy();
  const request = page.request;
  const teamId = await newBlankTeam(page, `E2E invalid ${Date.now()}`);
  console.log(`[topology-e2e] created blank team ${teamId}`);

  // A blank team is runnable (thinker → Ship). Drop an UNCONNECTED worker from the palette → two
  // entry points → un-runnable.
  await expect(page.getByRole("button", { name: "Run this team" })).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Worker", exact: true }).click();

  // The Run gate greys out with the per-issue reason, and the server agrees (validate → not runnable).
  await expect(page.getByText(/Can.t run yet/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Run this team" })).toBeDisabled();
  await expect.poll(() => isRunnable(request, teamId), { timeout: 30_000 }).toBe(false);

  // The launch API refuses the broken graph with a 422 carrying the structured errors.
  const refused = await request.post("/api/runs", { data: { team_graph_id: teamId } });
  expect(refused.status(), "create_run refuses an invalid graph").toBe(422);
  const body = (await refused.json()) as { detail: { errors: unknown[] } };
  expect(
    body.detail.errors.length,
    "the 422 carries the structured validity errors",
  ).toBeGreaterThan(0);
  console.log("[topology-e2e] invalid graph: Run disabled in UI + create_run 422 from the server");
});

test("P1.8d: author root thinker → Engineer → Ship from a blank team, Run it, and it ships", async ({
  page,
}) => {
  test.setTimeout(5 * 60 * 1000);
  // The thinker is authored onto openai/gpt-4o-mini and the Engineer preset defaults to the held
  // provider's worker model, so the account holds both keys (from .env) before the team is made.
  await registerFresh(page, "topology-run");
  await seedProviderKeys(page, ["deepseek", "openai"]);
  const request = page.request;
  const teamId = await newBlankTeam(page, `E2E topology ${Date.now()}`);
  console.log(`[topology-e2e] created blank team ${teamId}`);

  // The blank skeleton: a root thinker → a Ship terminal. Give the thinker a real PM behaviour +
  // a non-reasoning model so it writes the pinned greeting spec the Engineer can build.
  const blank = await graphOf(request, teamId);
  const thinker = blank.nodes.find((n) => n.kind === "completion")!;
  const ship = blank.nodes.find((n) => n.kind === "terminal")!;
  await request.patch(`/api/teams/${teamId}/nodes/${thinker.id}`, {
    data: { prompt: PM_PROMPT, model: "openai/gpt-4o-mini" },
  });

  // Drop an Engineer worker from the canvas palette (a pre-filled worker preset).
  await page.getByRole("button", { name: "Engineer", exact: true }).click();
  await expect
    .poll(async () => (await graphOf(request, teamId)).nodes.length, { timeout: 30_000 })
    .toBe(3);
  const withWorker = await graphOf(request, teamId);
  const engineer = withWorker.nodes.find((n) => n.role_name === "engineer")!;

  // Wire root thinker → Engineer → Ship (the same team-edge endpoint the connect-gesture calls);
  // drop the blank skeleton's thinker → Ship edge so there's a single spec-first path.
  await request.delete(`/api/teams/${teamId}/edges/${withWorker.edges[0].id}`);
  await request.post(`/api/teams/${teamId}/edges`, {
    data: { source_node_id: thinker.id, target_node_id: engineer.id, role: "forward" },
  });
  await request.post(`/api/teams/${teamId}/edges`, {
    data: { source_node_id: engineer.id, target_node_id: ship.id, role: "forward" },
  });
  await expect.poll(() => isRunnable(request, teamId), { timeout: 30_000 }).toBe(true);
  console.log("[topology-e2e] authored thinker → Engineer → Ship; the graph validates runnable");

  // Reload so the UI reflects the authored graph (the canvas address keeps the team open), and
  // confirm Run is enabled (the UI mirrors the server verdict).
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/teams/${teamId}$`));
  const runBtn = page.getByRole("button", { name: "Run this team" });
  await expect(runBtn).toBeEnabled({ timeout: 30_000 });

  // RUN through the UI → Home's composer (the backend's skeleton idea) → capture the run id from
  // the launch, then poll for completion + a ship.
  const { runId } = await runFromCanvas(page);
  expect(runId, "the UI launches the authored team").toBeTruthy();
  console.log(`[topology-e2e] launched run ${runId} — polling for the ship…`);

  await expect
    .poll(() => runStatusOf(request, runId), { timeout: 4 * 60 * 1000, intervals: [2000] })
    .toBe("completed");
  const final = (await (await request.get(`/api/runs/${runId}`)).json()) as {
    run: { ship_tag: string | null };
  };
  expect(final.run.ship_tag, "the authored team shipped").toBeTruthy();
  console.log(`[topology-e2e] SHIPPED: run ${runId} completed with ship_tag ${final.run.ship_tag}`);
});
