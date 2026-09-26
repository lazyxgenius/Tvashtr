import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import { LIBRARY, inline, renderAt, skill, table } from "./skillsTestUtils";

const preset = (key: string, title: string, description: string) => ({
  key,
  name: key,
  title,
  description,
  access: "free",
  badge: "Free",
  attachable: true,
  source: { type: "inline", name: key, content: `# ${title}\n\n- rule`, mode: "always" },
});
const PRESETS = [
  preset(
    "caveman",
    "Caveman (terse)",
    "Ultra-compressed output style that keeps technical substance.",
  ),
  preset(
    "tdd",
    "TDD discipline",
    "Red → green → refactor. Smallest code that makes the failing test pass.",
  ),
  preset("yagni", "YAGNI", "Smallest change that solves the asked problem, no speculative extras."),
];

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("SkillsPage — Your skills", () => {
  it("lists skills by name with source badge, load mode, used by and updated", async () => {
    mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    renderAt("#/toolkit/skills");
    expect(await screen.findByRole("heading", { level: 1, name: "Skills" })).toBeTruthy();
    const rows = within(await screen.findByRole("table"))
      .getAllByRole("row")
      .slice(1);
    expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual([
      "house-style",
      "pytest-review",
      "security-checklist",
    ]);
    expect(within(rows[0]).getByText("Written here")).toBeTruthy();
    expect(within(rows[0]).getByText("Always on")).toBeTruthy();
    expect(within(rows[0]).getByText("2 agents · 1 team")).toBeTruthy();
    expect(within(rows[0]).getByText("Sep 23")).toBeTruthy();
    expect(within(rows[1]).getByText("org/skills @ main")).toBeTruthy();
    expect(within(rows[1]).getByText("Agent decides")).toBeTruthy();
    expect(within(rows[2]).getByText("auth, secrets")).toBeTruthy();
    expect(within(rows[2]).getByText("Not used yet")).toBeTruthy();
    expect(
      within(rows[2]).getByRole("button", { name: "More actions for security-checklist" }),
    ).toBeTruthy();
    // Header actions and the tab count; the nav badge follows the library.
    expect(screen.getByRole("button", { name: "Add from GitHub" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Your skills/ }).textContent).toBe("Your skills3");
    expect(screen.getByRole("status", { name: "skills badge" }).textContent).toBe("3");
  });

  it("opens a skill's editor from its row and New skill from the header", async () => {
    mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    renderAt("#/toolkit/skills");
    fireEvent.click(await within(await screen.findByRole("table")).findByText("Agent decides"));
    expect(window.location.hash).toBe("#/toolkit/skills/s2");
    act(() => {
      window.location.hash = "#/toolkit/skills";
    });
    fireEvent.click(await screen.findByRole("button", { name: "New skill" }));
    expect(window.location.hash).toBe("#/toolkit/skills/new");
  });

  it("filters by name as you type, with a no-match state that clears", async () => {
    mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    renderAt("#/toolkit/skills");
    await screen.findByRole("table");
    const search = screen.getByRole("textbox", { name: "Search skills" });
    fireEvent.change(search, { target: { value: "HOUSE" } });
    expect(within(table()).getAllByRole("row")).toHaveLength(2);

    fireEvent.change(search, { target: { value: "docker" } });
    const empty = screen.getByRole("region", { name: "No skills match “docker”" });
    expect(within(empty).getByText("Try another word, or write it as a new skill.")).toBeTruthy();
    fireEvent.click(within(empty).getByRole("button", { name: "Clear search" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(within(table()).getAllByRole("row")).toHaveLength(4);
  });

  it("shows No skills yet for an empty library, and Browse presets opens the Presets tab", async () => {
    mockApi({
      "GET /api/skill-library": { skills: [] },
      "GET /api/skill-presets": { skills: PRESETS },
    });
    renderAt("#/toolkit/skills");
    const empty = await screen.findByRole("region", { name: "No skills yet" });
    expect(
      within(empty).getByText(
        "Skills teach agents your team’s way of doing things. Start from a free preset, pull from GitHub, or write your own.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(empty).getByRole("button", { name: "Browse presets" }));
    expect(window.location.hash).toBe("#/toolkit/skills/presets");
    expect(await screen.findByRole("article", { name: "YAGNI" })).toBeTruthy();
  });

  it("shows the load error with Try again", async () => {
    let fail = true;
    mockApi({
      "GET /api/skill-library": () =>
        fail ? jsonError(500, "The database is down.") : { skills: LIBRARY },
    });
    renderAt("#/toolkit/skills");
    const err = await screen.findByRole("region", { name: "Couldn’t load your skills" });
    expect(within(err).getByText("The database is down.")).toBeTruthy();
    fail = false;
    fireEvent.click(within(err).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });
});

describe("SkillsPage — Presets", () => {
  const library = [skill("c", "caveman", inline("caveman")), skill("t", "tdd", inline("tdd"))];

  it("hides Add from GitHub and search; cards say In your skills by name", async () => {
    mockApi({
      "GET /api/skill-library": { skills: library },
      "GET /api/skill-presets": { skills: PRESETS },
    });
    renderAt("#/toolkit/skills");
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("tab", { name: /Presets/ }));
    expect(window.location.hash).toBe("#/toolkit/skills/presets");
    const yagni = await screen.findByRole("article", { name: "YAGNI" });
    expect(screen.queryByRole("button", { name: "Add from GitHub" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Search skills" })).toBeNull();
    expect(screen.getByRole("button", { name: "New skill" })).toBeTruthy();

    const caveman = screen.getByRole("article", { name: "Caveman (terse)" });
    expect(within(caveman).getByText("Free")).toBeTruthy();
    expect(
      within(caveman).getByText("Ultra-compressed output style that keeps technical substance."),
    ).toBeTruthy();
    expect(within(caveman).getByRole("button", { name: "In your skills" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(yagni).getByRole("button", { name: "Add" })).toHaveProperty("disabled", false);
  });

  it("Add creates the skill, flips the card, counts it and says so", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: library },
      "GET /api/skill-presets": { skills: PRESETS },
      "POST /api/skill-library": (_u: URL, body: { name: string; source: object }) =>
        skill("y", body.name, body.source, undefined, new Date().toISOString()),
    });
    renderAt("#/toolkit/skills/presets");
    const yagni = await screen.findByRole("article", { name: "YAGNI" });
    fireEvent.click(within(yagni).getByRole("button", { name: "Add" }));
    expect(await screen.findByText("YAGNI added to your skills.")).toBeTruthy();
    expect(within(yagni).getByRole("button", { name: "In your skills" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/api/skill-library",
      body: { name: "yagni", source: PRESETS[2].source },
    });
    expect(screen.getByRole("tab", { name: /Your skills/ }).textContent).toBe("Your skills3");
    expect(screen.getByRole("status", { name: "skills badge" }).textContent).toBe("3");
  });

  it("Preview opens the preset dialog; Add to your skills adds and closes it", async () => {
    mockApi({
      "GET /api/skill-library": { skills: library },
      "GET /api/skill-presets": { skills: PRESETS },
      "POST /api/skill-library": (_u: URL, body: { name: string; source: object }) =>
        skill("y", body.name, body.source),
    });
    renderAt("#/toolkit/skills/presets");
    const yagni = await screen.findByRole("article", { name: "YAGNI" });
    fireEvent.click(within(yagni).getByRole("button", { name: "Preview" }));
    const dialog = screen.getByRole("dialog", { name: "YAGNI preset" });
    expect(within(dialog).getByText("Free preset")).toBeTruthy();
    expect(within(dialog).getByText(/# YAGNI/).textContent).toBe("# YAGNI\n\n- rule");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to your skills" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("YAGNI added to your skills.")).toBeTruthy();

    // An added preset's preview has no Add button; Close and Escape close it.
    fireEvent.click(within(yagni).getByRole("button", { name: "Preview" }));
    const again = screen.getByRole("dialog", { name: "YAGNI preset" });
    expect(within(again).queryByRole("button", { name: "Add to your skills" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a name clash reloads the library and shows the backend's reason", async () => {
    let skills = library;
    mockApi({
      "GET /api/skill-library": () => ({ skills }),
      "GET /api/skill-presets": { skills: PRESETS },
      "POST /api/skill-library": () => {
        skills = [...library, skill("y", "yagni", inline("yagni"))];
        return jsonError(409, "You already have a skill called yagni.");
      },
    });
    renderAt("#/toolkit/skills/presets");
    const yagni = await screen.findByRole("article", { name: "YAGNI" });
    fireEvent.click(within(yagni).getByRole("button", { name: "Add" }));
    expect(await screen.findByText("You already have a skill called yagni.")).toBeTruthy();
    const card = await screen.findByRole("article", { name: "YAGNI" });
    await waitFor(() =>
      expect(within(card).getByRole("button", { name: "In your skills" })).toBeTruthy(),
    );
  });
});
