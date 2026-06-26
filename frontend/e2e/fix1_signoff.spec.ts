import { type Page, expect, test } from "@playwright/test";

// P1.8d-fix1 self-sign-off (scripted-Playwright FALLBACK for the Playwright MCP, whose CDP backend
// wedged on the React Flow canvas's huge accessibility tree). Same six high-reliability load/console/
// DOM-state checks the brief asks the MCP to drive, against the running dev stack, each with a
// screenshot artifact. The deep author-an-edge-and-run path stays in topology.spec.ts.
//
// Every check also carries the render-loop guard: any "Maximum update depth exceeded" console error
// or uncaught page exception during an authoring interaction fails the check (the hang's signature).

const SHOTS =
  "/private/tmp/claude-501/-Users-adimac-Desktop-Tvashtr/6244d7e6-995d-45a5-8ad1-7258fd16a42c/scratchpad/signoff";

let consoleErrors: string[] = [];
let pageErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));
});

function assertNoRenderLoop(): void {
  const loop = [...consoleErrors, ...pageErrors].filter((t) =>
    /Maximum update depth exceeded/i.test(t),
  );
  expect(loop, `render loop fired:\n${loop.join("\n")}`).toEqual([]);
  expect(pageErrors, `uncaught page error:\n${pageErrors.join("\n")}`).toEqual([]);
}

async function nodeCount(page: Page): Promise<number> {
  return page.locator(".react-flow__node").count();
}

// Select a rail team by its UNIQUE full name (timestamped) — prior-run teams of the same prefix
// accumulate in the rail, so a prefix match + `.first()` would act on the wrong team.
const re = (s: string): RegExp => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
async function selectTeam(page: Page, name: string): Promise<void> {
  await page
    .getByRole("button", { name: re(name) })
    .first()
    .click();
}

interface Graph {
  nodes: { id: string; role_name: string; kind: string; prompt: string | null }[];
  edges: { id: string }[];
}

// ── Check 1 ────────────────────────────────────────────────────────────────────────────────────
test("check1: selecting the multi-node 'My team' renders its nodes with NO render loop", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  // 'My team' auto-selects on mount; click it explicitly to exercise the select path that hung.
  await page
    .getByRole("button", { name: /My team/ })
    .first()
    .click();
  // (a) the team's nodes actually render — NOT the empty "Nothing on the loom yet" state.
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBeGreaterThan(1);
  await expect(page.getByText("Nothing on the loom yet")).toHaveCount(0);
  // (c) the page stays responsive — a follow-up node click registers (and would never return if the
  //     main thread were frozen by a loop).
  await page.locator(".react-flow__node").first().click();
  await page.waitForTimeout(1500); // give any loop a window to manifest in the console
  // (b) no "Maximum update depth exceeded" / uncaught React error.
  assertNoRenderLoop();
  await page.screenshot({ path: `${SHOTS}/check1-hang-fixed.png` });
  console.log(
    `[fix1-signoff] check1 PASS — ${await nodeCount(page)} nodes rendered, console clean`,
  );
});

// ── Check 2 ────────────────────────────────────────────────────────────────────────────────────
test("check2: the review_loop team renders the bounded rework arc (.rf-edge--rework)", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const name = `signoff-rework ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "review_loop", name } });
  expect(r.ok(), "create review_loop team").toBeTruthy();
  await page.goto("/");
  await selectTeam(page, name);
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBeGreaterThan(1);
  // exactly the calm dashed loop-back arc — the P1.8b regression guard.
  await expect(page.locator(".react-flow__edge.rf-edge--rework")).toHaveCount(1);
  assertNoRenderLoop();
  await page.screenshot({ path: `${SHOTS}/check2-rework-arc.png` });
  console.log("[fix1-signoff] check2 PASS — review_loop renders one .rf-edge--rework arc");
});

// ── Check 3 ────────────────────────────────────────────────────────────────────────────────────
test("check3: an invalid graph greys out Run with reasons + flags the node, then re-enables when fixed", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const name = `signoff-gate ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "blank", name } });
  const teamId = ((await r.json()) as { team_graph_id: string }).team_graph_id;
  await page.goto("/");
  await selectTeam(page, name);

  // A blank team is valid → Run enabled.
  const runBtn = page.getByRole("button", { name: "Run this team" });
  await expect(runBtn).toBeEnabled({ timeout: 30_000 });

  // Drop an UNCONNECTED worker → a second entry point → invalid.
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await expect(page.getByText(/Can.t run yet/)).toBeVisible({ timeout: 30_000 });
  await expect(runBtn).toBeDisabled();
  // a reasons list renders and the offending node is flagged (invalid/orphan red-ring class).
  await expect(page.locator(".tv-validity__lead")).toBeVisible();
  await expect
    .poll(() => page.locator(".tv-node--orphan, .tv-node--invalid").count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/check3a-run-disabled.png` });

  // FIX it: delete the unconnected worker via the same CRUD the canvas uses → Run re-enables.
  const g = (await (await request.get(`/api/teams/${teamId}/graph`)).json()) as Graph;
  const worker = g.nodes.find((n) => n.kind === "agent");
  expect(worker, "the dropped worker exists").toBeTruthy();
  await request.delete(`/api/teams/${teamId}/nodes/${worker!.id}`);
  await page.reload();
  await selectTeam(page, name);
  await expect(page.getByRole("button", { name: "Run this team" })).toBeEnabled({
    timeout: 30_000,
  });
  assertNoRenderLoop();
  await page.screenshot({ path: `${SHOTS}/check3b-run-reenabled.png` });
  console.log(
    "[fix1-signoff] check3 PASS — invalid→Run greyed+reasons+flagged; fixed→Run re-enabled",
  );
});

// ── Check 4 ────────────────────────────────────────────────────────────────────────────────────
test("check4: the palette drops a primitive (Worker) and a pre-filled preset (Engineer)", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const name = `signoff-palette ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "blank", name } });
  const teamId = ((await r.json()) as { team_graph_id: string }).team_graph_id;
  await page.goto("/");
  await selectTeam(page, name);
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBe(2); // blank skeleton: thinker→Ship

  // Primitive: a Worker chip adds a node.
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBe(3);

  // Preset: an Engineer chip adds a node pre-filled with the ENGINEER prompt (verified at the source).
  await page.getByRole("button", { name: "Engineer", exact: true }).click();
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBe(4);
  const g = (await (await request.get(`/api/teams/${teamId}/graph`)).json()) as Graph;
  const engineer = g.nodes.find((n) => n.role_name === "engineer");
  expect(engineer, "the Engineer preset node exists").toBeTruthy();
  expect((engineer!.prompt ?? "").length, "the Engineer preset is pre-filled").toBeGreaterThan(20);
  assertNoRenderLoop();
  await page.screenshot({ path: `${SHOTS}/check4-palette-drop.png` });
  console.log("[fix1-signoff] check4 PASS — Worker+Engineer dropped; Engineer preset pre-filled");
});

// ── Check 5 ────────────────────────────────────────────────────────────────────────────────────
test("check5: New → Blank team renders the 2-node thinker→Ship skeleton and Run is enabled", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: /New team/ }).click();
  const picker = page.getByLabel("New team from a template");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByText("Blank team").click();
  await picker.getByRole("textbox").fill(`signoff-blank ${Date.now()}`);
  await picker.getByRole("button", { name: "Create team" }).click();
  // the minimal valid skeleton: 2 nodes (root thinker → Ship), and Run is enabled (valid).
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBe(2);
  await expect(page.getByRole("button", { name: "Run this team" })).toBeEnabled({
    timeout: 30_000,
  });
  assertNoRenderLoop();
  await page.screenshot({ path: `${SHOTS}/check5-blank-skeleton.png` });
  console.log("[fix1-signoff] check5 PASS — blank skeleton = 2 nodes, Run enabled");
});

// ── Check 6 ────────────────────────────────────────────────────────────────────────────────────
test("check6: dragging a node persists its position across a reload (not reset to 0,0)", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const name = `signoff-layout ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "blank", name } });
  const teamId = ((await r.json()) as { team_graph_id: string }).team_graph_id;
  await page.goto("/");
  await selectTeam(page, name);
  const node = page.locator(".react-flow__node").first();
  await expect(node).toBeVisible({ timeout: 30_000 });

  // Real drag: grab the node and move it by a clear offset.
  const box = await node.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 180, box!.y + box!.height / 2 + 140, {
    steps: 12,
  });
  await page.mouse.up();

  // onNodeDragStop persists the new coords; read them back from the DB, then reload and assert the
  // node renders at the SAME persisted (non-zero) position — not reset/stacked at the origin.
  const draggedId = await node.getAttribute("data-id");
  await expect
    .poll(
      async () => {
        const g = (await (await request.get(`/api/teams/${teamId}/graph`)).json()) as {
          nodes: { id: string; position: { x: number; y: number } }[];
        };
        const n = g.nodes.find((x) => x.id === draggedId);
        return n ? Math.round(n.position.x) + Math.round(n.position.y) : 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  const persisted = (await (await request.get(`/api/teams/${teamId}/graph`)).json()) as {
    nodes: { id: string; position: { x: number; y: number } }[];
  };
  const moved = persisted.nodes.find((x) => x.id === draggedId)!;

  await page.reload();
  await selectTeam(page, name);
  const reloaded = page.locator(`.react-flow__node[data-id="${draggedId}"]`);
  await expect(reloaded).toBeVisible({ timeout: 30_000 });
  const transform = await reloaded.evaluate((el) => (el as HTMLElement).style.transform);
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform);
  expect(m, `node transform parsed from "${transform}"`).toBeTruthy();
  const onScreen = { x: Math.round(Number(m![1])), y: Math.round(Number(m![2])) };
  expect(
    onScreen.x !== 0 || onScreen.y !== 0,
    "node not reset to origin after reload",
  ).toBeTruthy();
  // and it matches the persisted DB coords (the canvas re-hydrated the dragged layout).
  expect(Math.abs(onScreen.x - Math.round(moved.position.x))).toBeLessThan(3);
  expect(Math.abs(onScreen.y - Math.round(moved.position.y))).toBeLessThan(3);
  assertNoRenderLoop();
  await page.screenshot({ path: `${SHOTS}/check6-layout-persists.png` });
  console.log(
    `[fix1-signoff] check6 PASS — dragged node persisted at (${onScreen.x},${onScreen.y}) across reload`,
  );
});
