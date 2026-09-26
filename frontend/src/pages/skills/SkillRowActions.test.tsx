import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import { LIBRARY, inline, renderAt, skill, table } from "./skillsTestUtils";

const TEAM = { team_id: "t1", team_name: "Indicator sprint team" };
const used = (role: string) => ({ node_id: `n-${role}`, role_name: role, title: null, ...TEAM });
const USED_BY = [used("reviewer"), used("engineer")];

const detail = (id: string, usedBy: object[]) => (u: URL) =>
  u.pathname.endsWith(`/${id}`)
    ? { ...LIBRARY.find((s) => s.id === id), used_by: usedBy }
    : jsonError(404, "skill not found in your library");

const rowOf = (name: string) => within(table()).getByRole("button", { name }).closest("tr")!;

async function openMenu(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `More actions for ${name}` }));
  return screen.getByRole("menu", { name: `More actions for ${name}` });
}

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("Skills row ⋯ menu (TkF-SkillMenu-1)", () => {
  it("opens Edit, Duplicate, Turn on for agents… and Delete skill; Edit opens the editor", async () => {
    mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    renderAt("#/toolkit/skills");
    const trigger = await screen.findByRole("button", { name: "More actions for house-style" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    const menu = await openMenu("house-style");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Edit", "Duplicate", "Turn on for agents…", "Delete skill"]);
    // Escape closes it without leaving the list.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(window.location.hash).toBe("#/toolkit/skills");

    fireEvent.click(within(await openMenu("house-style")).getByRole("menuitem", { name: "Edit" }));
    expect(window.location.hash).toBe("#/toolkit/skills/s1");
  });

  it("Duplicate makes a copy and opens the copy's editor", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/:id/duplicate": skill(
        "s9",
        "house-style-copy",
        inline("house-style-copy"),
      ),
    });
    renderAt("#/toolkit/skills");
    const menu = await openMenu("house-style");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/skills/s9"));
    expect(
      calls.some((c) => c.method === "POST" && c.path === "/api/skill-library/s1/duplicate"),
    ).toBe(true);
    expect(screen.getByRole("status", { name: "skills badge" }).textContent).toBe("4");
  });
});

describe("Delete skill (TkF-SkillMenu-2/3)", () => {
  it("shows who loses it, then removes the row with a toast and no undo", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id": detail("s1", USED_BY),
      "DELETE /api/skill-library/:id": { removed_from_agents: 2 },
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("house-style")).getByRole("menuitem", { name: "Delete skill" }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete house-style?" });
    expect(
      await within(dialog).findByText(
        "Reviewer and Engineer in Indicator sprint team use it. They lose it on their next run. You can’t undo this.",
      ),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete skill" }));
    expect(await screen.findByText("house-style deleted.")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(table()).queryByRole("button", { name: "house-style" })).toBeNull();
    expect(screen.getByRole("tab", { name: /Your skills/ }).textContent).toBe("Your skills2");
    expect(screen.getByRole("status", { name: "skills badge" }).textContent).toBe("2");
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/skill-library/s1")).toBe(
      true,
    );
  });

  it("says so when no agent uses it; Cancel keeps the skill", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id": detail("s3", []),
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("security-checklist")).getByRole("menuitem", { name: "Delete skill" }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete security-checklist?" });
    expect(await within(dialog).findByText("No agents use it. You can’t undo this.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rowOf("security-checklist")).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("falls back to the row's counts when the usage read fails", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id": () => jsonError(500, "boom"),
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("house-style")).getByRole("menuitem", { name: "Delete skill" }),
    );
    expect(
      await screen.findByText(
        "2 agents in 1 team use it. They lose it on their next run. You can’t undo this.",
      ),
    ).toBeTruthy();
  });

  it("keeps the dialog open with the reason when the delete fails", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id": detail("s1", USED_BY),
      "DELETE /api/skill-library/:id": () => jsonError(500, "The database is down."),
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("house-style")).getByRole("menuitem", { name: "Delete skill" }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete house-style?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete skill" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("The database is down.");
    expect(rowOf("house-style")).toBeTruthy();
  });
});

describe("Turn on for agents", () => {
  const agent = (role: string, extra: object = {}) => ({
    node_id: `n-${role}`,
    role_name: role,
    title: null,
    kind: "agent",
    edits_allowed: true,
    enabled: false,
    overridden: false,
    mode: null,
    triggers: null,
    ...extra,
  });
  const TEAMS = {
    teams: [
      {
        ...TEAM,
        agents: [
          agent("pm", { kind: "completion", edits_allowed: false }),
          agent("engineer", { enabled: true }),
          agent("reviewer", { enabled: true, edits_allowed: false }),
        ],
      },
      { team_id: "t2", team_name: "Docs team", agents: [agent("writer")] },
    ],
  };

  it("lists every agent by team, checked where it's on, and saves the chosen set", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id/agents": TEAMS,
      "PUT /api/skill-library/:id/agents": {
        agents: [used("reviewer"), { ...used("writer"), team_id: "t2", team_name: "Docs team" }],
        agent_count: 2,
        team_count: 2,
      },
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("house-style")).getByRole("menuitem", {
        name: "Turn on for agents…",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    expect(within(dialog).getByRole("heading", { name: "Turn house-style on for…" })).toBeTruthy();
    const box = async (name: RegExp) =>
      within(dialog).findByRole<HTMLInputElement>("checkbox", { name });
    expect((await box(/^Product manager/)).checked).toBe(false);
    expect((await box(/^Engineer/)).checked).toBe(true);
    expect((await box(/^Reviewer/)).checked).toBe(true);
    expect(within(dialog).getByText("Docs team")).toBeTruthy();
    // Agents that can't edit (the PM, this Reviewer) are tagged thinker.
    expect(within(dialog).getAllByText("thinker")).toHaveLength(2);

    // Nothing changed yet: the action states the current set and waits.
    const action = () => within(dialog).getByRole("button", { name: /^Turn (on|off) for/ });
    expect(action().textContent).toBe("Turn on for 2 agents");
    expect((action() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await box(/^Writer/));
    fireEvent.click(await box(/^Engineer/));
    expect(action().textContent).toBe("Turn on for 2 agents");
    expect((action() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(action());

    expect(await screen.findByText("house-style is on for 2 agents.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Turn on for agents" })).toBeNull();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe("/api/skill-library/s1/agents");
    expect([...(put?.body as { node_ids: string[] }).node_ids].sort()).toEqual([
      "n-reviewer",
      "n-writer",
    ]);
    expect(within(rowOf("house-style")).getByText("2 agents · 2 teams")).toBeTruthy();
  });

  it("clearing every box turns it off for all agents", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id/agents": TEAMS,
      "PUT /api/skill-library/:id/agents": { agents: [], agent_count: 0, team_count: 0 },
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("house-style")).getByRole("menuitem", {
        name: "Turn on for agents…",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /^Engineer/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^Reviewer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off for all agents" }));
    expect(await screen.findByText("house-style is off for every agent.")).toBeTruthy();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ node_ids: [] });
    expect(within(rowOf("house-style")).getByText("Not used yet")).toBeTruthy();
  });

  it("shows the load error with Try again", async () => {
    let fail = true;
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "GET /api/skill-library/:id/agents": () =>
        fail ? jsonError(500, "The database is down.") : TEAMS,
    });
    renderAt("#/toolkit/skills");
    fireEvent.click(
      within(await openMenu("house-style")).getByRole("menuitem", {
        name: "Turn on for agents…",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    expect((await within(dialog).findByRole("alert")).textContent).toBe("The database is down.");
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByRole("checkbox", { name: /^Writer/ })).toBeTruthy();
  });
});
