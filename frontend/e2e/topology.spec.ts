import { type APIRequestContext, expect, test } from "@playwright/test";

// P1.8d topology editing — author your own wiring. Two proofs:
//   (1) From a BLANK team, author a runnable graph from scratch (root thinker → Engineer worker →
//       Ship) using the canvas (the palette adds the worker; the edges are wired through the same
//       team CRUD endpoints the connect-gesture calls), then RUN it through the UI and assert it
//       ships — a real NIM run end-to-end on a graph the user built.
//   (2) A graph made invalid (an unconnected just-dropped node → two entry points) GREYS OUT Run with
//       the reason, AND the server refuses create_run with a 422 carrying the structured errors.
// The pure connect/role logic (which role a source may emit, loop detection, the emit-contract) is
// proven in the vitest unit suite (src/lib/topology.test.ts); this is the live wiring + run proof.

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

async function newBlankTeam(page: import("@playwright/test").Page, name: string): Promise<string> {
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /New team/ }).click();
  const picker = page.getByLabel("New team from a template");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByText("Blank team").click();
  await picker.getByRole("textbox").fill(name);
  await picker.getByRole("button", { name: "Create team" }).click();
  const teamId = ((await (await createResp).json()) as { team_graph_id: string }).team_graph_id;
  expect(teamId, "the Blank-team picker creates a team and returns its id").toBeTruthy();
  return teamId;
}

test("P1.8d: an invalid graph greys out Run with the reason and the server refuses the launch (422)", async ({
  page,
  request,
}) => {
  test.setTimeout(2 * 60 * 1000);
  await page.goto("/");
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
  request,
}) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto("/");
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

  // Reload so the UI reflects the authored graph, select the team in the rail, and confirm Run is
  // enabled (the UI mirrors the server verdict).
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp(`E2E topology`) })
    .first()
    .click();
  const runBtn = page.getByRole("button", { name: "Run this team" });
  await expect(runBtn).toBeEnabled({ timeout: 30_000 });

  // RUN through the UI → capture the run id from the launch, then poll for completion + a ship.
  const runResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  await runBtn.click();
  const runId = ((await (await runResp).json()) as { run_id: string }).run_id;
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
