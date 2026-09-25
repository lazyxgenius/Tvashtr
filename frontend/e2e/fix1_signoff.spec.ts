import fs from "node:fs";

import { type Page, expect, test } from "@playwright/test";

import { paletteAdd } from "./_canvas";
import { openTeamViaPalette, registerFresh } from "./_home";
import { openMyTeam } from "./_myTeam";

// P1.8d-fix1 self-sign-off (scripted-Playwright FALLBACK for the Playwright MCP, whose CDP backend
// wedged on the React Flow canvas's huge accessibility tree). Same six high-reliability load/console/
// DOM-state checks the brief asks the MCP to drive, against the running dev stack, each with a
// screenshot artifact. The deep author-an-edge-and-run path stays in topology.spec.ts.
//
// Every check also carries the render-loop guard: any "Maximum update depth exceeded" console error
// or uncaught page exception during an authoring interaction fails the check (the hang's signature).
//
// Revamp round 1: each check signs in as a fresh account (new accounts start with no team), and a
// team is opened the way a user reaches it from anywhere in the shell — the header's search palette.
// A reload keeps the canvas address, so the team reopens by itself. No driver script: run it against
// any live backend + Vite (e.g. the stack scripts/accounts_e2e.sh boots) with
// `TVASHTR_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/fix1_signoff.spec.ts`.

const SHOTS = process.env.TVASHTR_FIX1_SHOTS_DIR ?? "/tmp/tvashtr_fix1_signoff_shots";
fs.mkdirSync(SHOTS, { recursive: true });

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

// A keyless account's canvas shows "Configure providers" in place of "Run this team". The checks
// that assert Run's state hold a DUMMY deepseek key first (deepseek serves both seats, so every node
// the defaults stamp is covered; no run is launched, so the key is never used).
async function holdDummyKey(page: Page): Promise<void> {
  const res = await page.request.post("/api/providers", {
    data: { provider: "deepseek", api_key: "dummy-deepseek-key-0000" },
  });
  expect(res.ok(), "store a dummy deepseek key").toBeTruthy();
}

// Open a team by its UNIQUE full name (timestamped) from the shell's search palette.
async function selectTeam(page: Page, name: string): Promise<void> {
  await openTeamViaPalette(page, name);
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
  await registerFresh(page, "fix1-check1");
  // No team is seeded any more: create "My team" and open it (the select path that hung).
  await openMyTeam(page);
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
}) => {
  test.setTimeout(90_000);
  await registerFresh(page, "fix1-check2");
  const request = page.request;
  const name = `signoff-rework ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "review_loop", name } });
  expect(r.ok(), "create review_loop team").toBeTruthy();
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
}) => {
  test.setTimeout(120_000);
  await registerFresh(page, "fix1-check3");
  await holdDummyKey(page);
  const request = page.request;
  const name = `signoff-gate ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "blank", name } });
  const teamId = ((await r.json()) as { team_graph_id: string }).team_graph_id;
  await selectTeam(page, name);

  // A blank team is valid → Run enabled.
  const runBtn = page.getByRole("button", { name: "Run this team" });
  await expect(runBtn).toBeEnabled({ timeout: 30_000 });

  // Drop an UNCONNECTED worker → a second entry point → invalid.
  await paletteAdd(page, "Worker");
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
  await page.reload(); // the canvas address survives a reload — the same team reopens
  await expect(page).toHaveURL(new RegExp(`#/teams/${teamId}$`));
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
}) => {
  test.setTimeout(120_000);
  await registerFresh(page, "fix1-check4");
  const request = page.request;
  const name = `signoff-palette ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "blank", name } });
  const teamId = ((await r.json()) as { team_graph_id: string }).team_graph_id;
  await selectTeam(page, name);
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBe(2); // blank skeleton: thinker→Ship

  // Primitive: a Worker chip adds a node.
  await paletteAdd(page, "Worker");
  await expect.poll(() => nodeCount(page), { timeout: 30_000 }).toBe(3);

  // Preset: an Engineer chip adds a node pre-filled with the ENGINEER prompt (verified at the source).
  await paletteAdd(page, "Engineer");
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
  await registerFresh(page, "fix1-check5");
  await holdDummyKey(page);
  await page.getByRole("button", { name: "New team", exact: true }).first().click();
  const picker = page.getByRole("dialog", { name: "New team" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker
    .locator("button.hm-tplcard", {
      has: page.locator(".hm-tplcard__name", { hasText: /^Blank$/ }),
    })
    .click();
  await picker.getByLabel("Name", { exact: true }).fill(`signoff-blank ${Date.now()}`);
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
}) => {
  test.setTimeout(120_000);
  await registerFresh(page, "fix1-check6");
  const request = page.request;
  const name = `signoff-layout ${Date.now()}`;
  const r = await request.post("/api/teams", { data: { template: "blank", name } });
  const teamId = ((await r.json()) as { team_graph_id: string }).team_graph_id;
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

  await page.reload(); // the canvas address survives a reload — the same team reopens
  await expect(page).toHaveURL(new RegExp(`#/teams/${teamId}$`));
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
