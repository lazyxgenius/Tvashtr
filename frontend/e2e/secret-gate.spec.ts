import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for M-rails C8: a gate node's drawer is now EDITABLE and can be flipped to the
// `secret_leak_scan` guardrail. Register a fresh account, create a team that has a gate (the
// review_loop's PRD gate), open the gate on the canvas, pick "Secret leak scan" in the Gate type
// picker, Save, and assert the config PERSISTED (config.gate_kind === "secret_leak_scan" via a live
// /api/teams/{id}/graph read). Targeted selectors + node-by-id clicks (NOT a whole-tree a11y
// snapshot — that wedges on the React Flow canvas, HANDOVER §4). NO agent run is driven; the gate
// scan itself is proven deterministically in the backend suite. No NVIDIA key needed.

const SHOTS_DIR = process.env.TVASHTR_SECRET_GATE_SHOTS_DIR ?? "/tmp/tvashtr_secret_gate_shots";

interface Graph {
  nodes: { id: string; role_name: string; kind: string; config: Record<string, unknown> | null }[];
}

test("secret-gate: a gate is editable on the canvas and flips to the secret_leak_scan guardrail, persisted", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // --- Register a fresh account (M-accounts Slice A gates the whole app). Register via the API —
  //     `page.request` shares the browser's cookie jar, so the tv_session cookie it sets carries to
  //     the page — then load the app authenticated, straight to the dashboard (this skips the F3
  //     interactive sign-up wizard, which is UX not under test). ---
  const email = `secret-gate+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123" },
  });
  expect(reg.ok(), `register ${email} -> ${reg.status()}`).toBeTruthy();
  await page.goto("/");
  const newTeamBtn = page.getByRole("button", { name: /New team/ });
  await expect(newTeamBtn).toBeVisible({ timeout: 30_000 });
  console.log(`[secret-gate-e2e] registered ${email}`);

  // --- Create a review_loop team (it carries a PRD gate) via the API, then OPEN it from the
  //     dashboard so the canvas renders it (the picker UX itself isn't under test). ---
  expect(newTeamBtn, "the dashboard rendered (authenticated)").toBeTruthy();
  const teamName = `Secret-gate E2E ${Date.now()}`;
  const createRes = await page.request.post("/api/teams", {
    data: { template: "review_loop", name: teamName },
  });
  expect(createRes.ok(), `create team -> ${createRes.status()}`).toBeTruthy();
  const teamId = ((await createRes.json()) as { team_graph_id: string }).team_graph_id;
  console.log(`[secret-gate-e2e] created team ${teamId}`);

  await page.reload();
  await page.getByRole("button", { name: `Open ${teamName}` }).click();

  const graphOf = async (): Promise<Graph> =>
    (await (await page.request.get(`/api/teams/${teamId}/graph`)).json()) as Graph;

  // The PRD gate exists and starts as a human approval (gate_kind = "prd_approval").
  const before = await graphOf();
  const gate = before.nodes.find((n) => n.role_name === "prd_gate")!;
  expect(gate, "the review_loop team has a PRD gate").toBeTruthy();
  expect(gate.config?.gate_kind).toBe("prd_approval");

  // CHECK 1 — the gate node renders on the canvas.
  const gateNode = page.locator(`.react-flow__node[data-id="${gate.id}"]`);
  await expect(gateNode).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "check1-canvas-gate.png") });
  console.log("[secret-gate-e2e] CHECK 1 PASS — the gate node renders on the canvas");

  // CHECK 2 — clicking the gate opens its now-EDITABLE drawer (a Gate type picker + a Save).
  await gateNode.click();
  const guardrailBtn = page.getByRole("button", { name: "Secret leak scan" });
  await expect(guardrailBtn).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Human approval" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled(); // clean until an edit
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-gate-drawer-editable.png") });
  console.log("[secret-gate-e2e] CHECK 2 PASS — the gate drawer is editable (Gate type + Save)");

  // CHECK 3 — pick "Secret leak scan", Save, and assert it PERSISTED.
  await guardrailBtn.click();
  const patchResp = page.waitForResponse(
    (r) => r.url().includes(`/nodes/${gate.id}`) && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await patchResp).status()).toBe(200);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-saved-secret-leak-scan.png") });

  await expect
    .poll(async () => (await graphOf()).nodes.find((n) => n.id === gate.id)?.config?.gate_kind, {
      timeout: 15_000,
    })
    .toBe("secret_leak_scan");
  console.log(
    "[secret-gate-e2e] CHECK 3 PASS — gate flipped to secret_leak_scan and PERSISTED (config.gate_kind)",
  );

  for (const f of [
    "check1-canvas-gate.png",
    "check2-gate-drawer-editable.png",
    "check3-saved-secret-leak-scan.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});
