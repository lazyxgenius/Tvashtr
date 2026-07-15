import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for M-endpoint-editable: a terminal (Ship) endpoint's drawer is EDITABLE and can
// be flipped to Stop. Register a fresh account, create a blank team (thinker → Ship), open the
// Ship endpoint on the canvas, click Stop, Save, assert config.terminal_kind + role_name persisted
// via a live /api/teams/{id}/graph read, and that the canvas card re-renders as Stop with its
// in-edge still attached. Reload proves durability. Targeted selectors + node-by-id clicks (NOT a
// whole-tree a11y snapshot — that wedges on the React Flow canvas, HANDOVER §4). NO agent run /
// NO provider key.

const SHOTS_DIR = process.env.TVASHTR_ENDPOINT_EDIT_SHOTS_DIR ?? "/tmp/tvashtr_endpoint_edit_shots";

interface Graph {
  nodes: {
    id: string;
    role_name: string;
    kind: string;
    config: Record<string, unknown> | null;
  }[];
  edges: {
    id: string;
    source_node_id: string;
    target_node_id: string;
  }[];
}

test("endpoint-edit: a Ship terminal flips to Stop in the drawer, persists, keeps edges, survives reload", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // --- Register a fresh account (M-accounts Slice A). Register via the API so the cookie carries
  //     to the page, then load the app authenticated. ---
  const email = `endpoint-edit+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123" },
  });
  expect(reg.ok(), `register ${email} -> ${reg.status()}`).toBeTruthy();
  await page.goto("/");
  const newTeamBtn = page.getByRole("button", { name: /New team/ });
  await expect(newTeamBtn).toBeVisible({ timeout: 30_000 });
  console.log(`[endpoint-edit-e2e] registered ${email}`);

  // --- Create a blank team (thinker → Ship) via the API, then OPEN it from the dashboard. ---
  const teamName = `Endpoint-edit E2E ${Date.now()}`;
  const createRes = await page.request.post("/api/teams", {
    data: { template: "blank", name: teamName },
  });
  expect(createRes.ok(), `create team -> ${createRes.status()}`).toBeTruthy();
  const teamId = ((await createRes.json()) as { team_graph_id: string }).team_graph_id;
  console.log(`[endpoint-edit-e2e] created team ${teamId}`);

  await page.reload();
  await page.getByRole("button", { name: `Open ${teamName}` }).click();

  const graphOf = async (): Promise<Graph> =>
    (await (await page.request.get(`/api/teams/${teamId}/graph`)).json()) as Graph;

  const before = await graphOf();
  const ship = before.nodes.find((n) => n.kind === "terminal")!;
  expect(ship, "the blank team has a Ship terminal").toBeTruthy();
  expect(ship.config?.terminal_kind).toBe("ship");
  expect(ship.role_name).toBe("ship");
  const inEdgesBefore = before.edges.filter((e) => e.target_node_id === ship.id);
  expect(inEdgesBefore.length).toBe(1);

  // CHECK 1 — the Ship endpoint card renders on the canvas.
  const shipNode = page.locator(`.react-flow__node[data-id="${ship.id}"]`);
  await expect(shipNode).toBeVisible({ timeout: 30_000 });
  await expect(shipNode.getByText("Ship", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "check1-canvas-ship.png") });
  console.log("[endpoint-edit-e2e] CHECK 1 PASS — the Ship endpoint renders on the canvas");

  // CHECK 2 — clicking the endpoint opens a LIVE drawer (Ship/Stop enabled, Save present, no
  //           delete-and-re-drop apology).
  await shipNode.click();
  const shipBtn = page.getByRole("button", { name: "Ship it" });
  const stopBtn = page.getByRole("button", { name: "Stop" });
  await expect(shipBtn).toBeVisible({ timeout: 15_000 });
  await expect(stopBtn).toBeVisible();
  await expect(shipBtn).toBeEnabled();
  await expect(stopBtn).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled(); // clean until edit
  await expect(page.getByText(/planned backend follow-on/i)).toHaveCount(0);
  await expect(page.getByText(/delete this endpoint/i)).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-drawer-live.png") });
  console.log("[endpoint-edit-e2e] CHECK 2 PASS — drawer is live (Ship/Stop enabled + Save)");

  // CHECK 3 — click Stop → Unsaved changes → Save → PATCH 200; config + role_name persist.
  await stopBtn.click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  const patchResp = page.waitForResponse(
    (r) => r.url().includes(`/nodes/${ship.id}`) && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await patchResp).status()).toBe(200);
  await expect(page.getByText("Saved — this drives the next run you launch.")).toBeVisible({
    timeout: 15_000,
  });
  // Drawer header flips Ship → Stop (local title follows the selected kind).
  await expect(page.getByLabel("Stop endpoint")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-saved-stop.png") });

  await expect
    .poll(
      async () => {
        const n = (await graphOf()).nodes.find((x) => x.id === ship.id);
        if (!n) return null;
        const kind = n.config?.terminal_kind;
        return typeof kind === "string" ? `${kind}|${n.role_name}` : null;
      },
      { timeout: 15_000 },
    )
    .toBe("stop|stop");
  console.log(
    "[endpoint-edit-e2e] CHECK 3 PASS — flipped to stop and PERSISTED (config + role_name)",
  );

  // CHECK 4 — canvas card re-renders as Stop; in-edges still attached.
  await expect(shipNode.getByText("Stop", { exact: true })).toBeVisible({ timeout: 15_000 });
  const afterFlip = await graphOf();
  const inEdgesAfter = afterFlip.edges.filter((e) => e.target_node_id === ship.id);
  expect(inEdgesAfter.map((e) => e.id).sort()).toEqual(inEdgesBefore.map((e) => e.id).sort());
  await page.screenshot({ path: path.join(SHOTS_DIR, "check4-canvas-stop-edges.png") });
  console.log("[endpoint-edit-e2e] CHECK 4 PASS — canvas shows Stop; in-edges unchanged");

  // CHECK 5 — reload (drops in-memory selection → dashboard) + re-open the team: still Stop.
  await page.reload();
  await expect(page.getByRole("button", { name: `Open ${teamName}` })).toBeVisible({
    timeout: 30_000,
  });
  // API durability first (independent of FE selection).
  await expect
    .poll(
      async () => {
        const n = (await graphOf()).nodes.find((x) => x.id === ship.id);
        const kind = n?.config?.terminal_kind;
        return typeof kind === "string" ? kind : null;
      },
      { timeout: 15_000 },
    )
    .toBe("stop");
  await page.getByRole("button", { name: `Open ${teamName}` }).click();
  const reopened = page.locator(`.react-flow__node[data-id="${ship.id}"]`);
  await expect(reopened).toBeVisible({ timeout: 30_000 });
  await expect(reopened.getByText("Stop", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "check5-reload-stop.png") });
  console.log("[endpoint-edit-e2e] CHECK 5 PASS — still Stop after reload + re-open");

  for (const f of [
    "check1-canvas-ship.png",
    "check2-drawer-live.png",
    "check3-saved-stop.png",
    "check4-canvas-stop-edges.png",
    "check5-reload-stop.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});
