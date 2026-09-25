import { type APIRequestContext, expect, test } from "@playwright/test";

import { registerFresh } from "./_home";

// P1.8c capability authoring, as the product has it since M-unify U3: a node's ONE capability
// distinction is the drawer's "Edits" toggle (`edits_allowed`: may it write files?) — the old
// Thinker/Worker buttons are gone and `kind` is vestigial. This is the toggle-plumbing + start-lock
// proof (no agent runs): flip a non-start THINKER (the plan_review Architect, edits off) to
// "Edits allowed", Save, and assert it persists, the card re-labels "Edits on", and the start node's
// toggle is locked. The team is made through Home's New team dialog (revamp round 1). The opposite
// direction (a worker turned read-only) is edits-toggle.spec.ts.

interface GraphNode {
  role_name: string;
  kind: string;
  edits_allowed?: boolean;
}

async function architectOf(
  request: APIRequestContext,
  teamId: string,
): Promise<GraphNode | undefined> {
  const res = await request.get(`/api/teams/${teamId}/graph`);
  const body = (await res.json()) as { nodes: GraphNode[] };
  return body.nodes.find((n) => n.role_name === "architect");
}

test("P1.8c: flip the Architect thinker→worker on a plan_review team — it persists, re-labels, and the start node is locked", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  const TEAM_NAME = `E2E capability team ${Date.now()}`;
  // The page's own request context carries the session cookie (the bare `request` fixture doesn't).
  const request = page.request;

  // Sign in as a fresh account (new accounts start with no team, so Home offers "New team").
  await registerFresh(page, "capability-edit");

  // 1. Home's New team dialog → the plan_review template (its Architect is a non-start thinker) →
  //    name → create. Capture the new team id from the POST /api/teams response.
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New team", exact: true }).first().click();
  const picker = page.getByRole("dialog", { name: "New team" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByRole("button", { name: /^PM → Architect → Engineer ⇄ Reviewer/ }).click();
  await expect(
    picker.getByRole("button", { name: /^PM → Architect → Engineer ⇄ Reviewer/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await picker.getByLabel("Name", { exact: true }).fill(TEAM_NAME);
  await picker.getByRole("button", { name: "Create team" }).click();
  const teamId = ((await (await createResp).json()) as { team_graph_id: string }).team_graph_id;
  expect(teamId, "the New team dialog creates a team and returns its id").toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`#/teams/${teamId}$`), { timeout: 30_000 });
  console.log(`[capability-edit-e2e] created plan_review team ${teamId}`);

  // The Architect seeds as a non-start thinker: a completion node that may not edit files.
  const before = await architectOf(request, teamId);
  expect(before?.kind, "the Architect seeds as a completion (thinker)").toBe("completion");
  expect(before?.edits_allowed, "a thinker seeds edits-off").toBe(false);

  // 2. Click the Architect node → the editable panel opens with the Edits toggle on "Not allowed".
  const architectNode = page.locator(".react-flow__node", { hasText: "Architect" }).first();
  await expect(architectNode).toBeVisible({ timeout: 30_000 });
  await expect(architectNode).toContainText("Edits off");
  await architectNode.click();
  const panel = page.getByLabel("Architect editor");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const edits = panel.getByRole("group", { name: "Edits" });
  await expect(edits.getByRole("button", { name: "Not allowed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 3. Flip it to "Edits allowed" (thinker → worker), then Save (PATCH the node-update endpoint).
  await edits.getByRole("button", { name: "Edits allowed" }).click();
  await expect(edits.getByRole("button", { name: "Edits allowed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
  console.log("[capability-edit-e2e] flipped the Architect to Edits allowed and saved");

  // (a) PERSISTED: the team graph now carries edits_allowed=true for the Architect.
  await expect
    .poll(async () => (await architectOf(request, teamId))?.edits_allowed, { timeout: 30_000 })
    .toBe(true);
  console.log("[capability-edit-e2e] persisted: the Architect is now edits_allowed=true");

  // (b) RE-LABELLED: the canvas card now reads "Edits on" (after the onSaved refetch).
  await expect(page.locator(".react-flow__node", { hasText: "Architect" }).first()).toContainText(
    "Edits on",
    { timeout: 30_000 },
  );

  // (c) START-LOCK: the PM (the start node) has both Edits buttons disabled.
  await page.locator(".react-flow__node", { hasText: "Product manager" }).first().click();
  const pmPanel = page.getByLabel("Product manager editor");
  await expect(pmPanel).toBeVisible({ timeout: 30_000 });
  const pmEdits = pmPanel.getByRole("group", { name: "Edits" });
  await expect(pmEdits.getByRole("button", { name: "Edits allowed" })).toBeDisabled();
  await expect(pmEdits.getByRole("button", { name: "Not allowed" })).toBeDisabled();
  console.log("[capability-edit-e2e] start-lock: the PM Edits toggle is disabled");
});
