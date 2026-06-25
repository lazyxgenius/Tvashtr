import { type APIRequestContext, expect, test } from "@playwright/test";

// P1.8c capability authoring: a node's capability (thinker ↔ worker) is editable on the team panel.
// This is the toggle-plumbing + start-lock proof (no agent runs). The "a graph with a non-start
// thinker runs correctly" proof is carried by the offline keystone + `make thinker-chain-e2e`.

interface GraphNode {
  role_name: string;
  kind: string;
  engine: string | null;
}

async function architectOf(
  request: APIRequestContext,
  teamId: string,
): Promise<GraphNode | undefined> {
  const res = await request.get(`/api/teams/${teamId}/graph`);
  const body = (await res.json()) as { nodes: GraphNode[] };
  return body.nodes.find((n) => n.role_name === "architect");
}

test("P1.8c: flip the Architect thinker→worker on a thinker_chain team — it persists, re-labels, and the start node is locked", async ({
  page,
  request,
}) => {
  test.setTimeout(3 * 60 * 1000);
  const TEAM_NAME = `E2E capability team ${Date.now()}`;

  await page.goto("/");

  // 1. New-team picker → the thinker_chain template → name → create. Capture the new team id from
  //    the POST /api/teams response.
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /New team/ }).click();
  const picker = page.getByLabel("New team from a template");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByText("PM → Architect → Engineer").click();
  await picker.getByRole("textbox").fill(TEAM_NAME);
  await picker.getByRole("button", { name: "Create team" }).click();
  const teamId = ((await (await createResp).json()) as { team_graph_id: string }).team_graph_id;
  expect(teamId, "the New-team picker creates a team and returns its id").toBeTruthy();
  console.log(`[capability-edit-e2e] created thinker_chain team ${teamId}`);

  // The Architect starts as a Thinker (a non-start completion node) — confirm via the API.
  const before = await architectOf(request, teamId);
  expect(before?.kind, "the Architect seeds as a completion (thinker)").toBe("completion");
  expect(before?.engine, "a thinker carries no engine").toBeNull();

  // 2. Click the Architect node → the editable panel opens with the capability toggle.
  const architectNode = page.locator(".react-flow__node", { hasText: "Architect" }).first();
  await expect(architectNode).toBeVisible({ timeout: 30_000 });
  await architectNode.click();
  const panel = page.getByLabel("Architect editor");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("button", { name: "Thinker" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 3. Flip thinker → worker, then Save (PATCH the node-update endpoint).
  await panel.getByRole("button", { name: "Worker" }).click();
  await expect(panel.getByRole("button", { name: "Worker" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
  console.log("[capability-edit-e2e] flipped Architect thinker→worker and saved");

  // (a) PERSISTED: the team graph now shows the Architect as kind=agent + engine=openhands.
  await expect
    .poll(async () => (await architectOf(request, teamId))?.kind, { timeout: 30_000 })
    .toBe("agent");
  const after = await architectOf(request, teamId);
  expect(after?.engine, "a worker carries the openhands engine").toBe("openhands");
  console.log("[capability-edit-e2e] persisted: Architect is now kind=agent / engine=openhands");

  // (b) RE-LABELLED: the canvas re-labels the Architect node as a Worker (after the onSaved refetch).
  await expect(page.locator(".react-flow__node", { hasText: "Architect" }).first()).toContainText(
    "Worker",
    { timeout: 30_000 },
  );

  // (c) START-LOCK: the PM (the start node) has its capability toggle disabled/locked.
  await page.locator(".react-flow__node", { hasText: "Product manager" }).first().click();
  const pmPanel = page.getByLabel("Product manager editor");
  await expect(pmPanel).toBeVisible({ timeout: 30_000 });
  await expect(pmPanel.getByRole("button", { name: "Worker" })).toBeDisabled();
  await expect(pmPanel.getByRole("button", { name: "Thinker" })).toBeDisabled();
  console.log("[capability-edit-e2e] start-lock: the PM capability toggle is disabled");
});
