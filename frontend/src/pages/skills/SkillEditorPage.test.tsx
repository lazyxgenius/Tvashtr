import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import { __resetSkillsHandoffForTests } from "./skillsHandoff";
import { LIBRARY, renderAt, skill, table } from "./skillsTestUtils";

const API_MD =
  "# API conventions\n\n- Routes are nouns: /api/runs, /api/teams.\n- Every new endpoint checks the session first.";
const HOUSE_MD = "# House style\n\nWrite review notes in plain words.";

const TEAM = { team_id: "t1", team_name: "Indicator sprint team" };
const used = (role: string) => ({ node_id: `n-${role}`, role_name: role, title: null, ...TEAM });
const HOUSE = skill(
  "s1",
  "house-style",
  { type: "inline", name: "house-style", content: HOUSE_MD, mode: "always" },
  { agents: 2, teams: 1 },
);

const nameInput = () => screen.getByRole("textbox", { name: "Skill name" });
const editor = () => screen.getByRole("textbox", { name: "SKILL.md" });
const saveSkill = () => screen.getByRole("button", { name: "Save skill" });
const modeGroup = () => screen.getByRole("group", { name: "Default load mode" });
const sourceGroup = () => screen.getByRole("group", { name: "Source" });
/** The toast that says `text` (its action buttons sit beside the words). */
const toastWith = async (text: string) =>
  (await screen.findByText(text)).closest<HTMLElement>(".ds-toast")!;

/** New skill with a name and SKILL.md typed in. */
async function writeNew(name = "api-conventions", content = API_MD) {
  renderAt("#/toolkit/skills/new");
  await screen.findByRole("textbox", { name: "Skill name" });
  fireEvent.change(nameInput(), { target: { value: name } });
  fireEvent.change(editor(), { target: { value: content } });
}

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  __resetSkillsHandoffForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("New skill (TkF-NewSkill-1…4, SKILL-21…29)", () => {
  it("starts empty: breadcrumb, name field, Always on, Written here, Save skill off (NewSkill-1)", async () => {
    mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    renderAt("#/toolkit/skills/new");
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("SkillsNew skill");
    expect(nameInput().getAttribute("placeholder")).toBe("name (e.g. house-style)");
    expect(editor().getAttribute("placeholder")).toBe("SKILL.md content…");
    expect(
      within(modeGroup()).getByRole("button", { name: "Always on" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(sourceGroup())
        .getByRole("button", { name: "Written here" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("The full skill goes into every prompt.")).toBeTruthy();
    expect(saveSkill()).toHaveProperty("disabled", true);
    // Five numbered lines while empty; four past the text once written.
    expect(document.querySelectorAll(".sk-md__gutter > div")).toHaveLength(5);

    fireEvent.change(nameInput(), { target: { value: "api-conventions" } });
    expect(saveSkill()).toHaveProperty("disabled", true);
    fireEvent.change(editor(), { target: { value: API_MD } });
    expect(saveSkill()).toHaveProperty("disabled", false);
    expect(document.querySelectorAll(".sk-md__gutter > div")).toHaveLength(8);
  });

  it("Preview renders the markdown as a heading and bullets (NewSkill-3)", async () => {
    mockApi({});
    await writeNew();
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    const preview = screen.getByLabelText("SKILL.md preview");
    expect(within(preview).getByRole("heading", { level: 1 }).textContent).toBe("API conventions");
    expect(within(preview).getByText("Routes are nouns: /api/runs, /api/teams.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "SKILL.md" })).toBeNull();
    // Back to Edit keeps the text.
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect((editor() as HTMLTextAreaElement).value).toBe(API_MD);
  });

  it("When triggered shows Trigger words and needs one before saving (NewSkill-4, Q16)", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library": (_u: URL, b: unknown) => {
        const body = b as { name: string; source: object };
        return skill("s9", body.name, body.source);
      },
    });
    await writeNew();
    fireEvent.click(within(modeGroup()).getByRole("button", { name: "When triggered" }));
    expect(
      screen.getByText("Loads only when the conversation mentions a trigger word."),
    ).toBeTruthy();
    const words = screen.getByRole("textbox", { name: "Trigger words" });
    expect(screen.getByText("Separate with commas.")).toBeTruthy();

    fireEvent.click(saveSkill());
    expect(await screen.findByText("Add at least one trigger word.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(words, { target: { value: "endpoint, route,, api " } });
    expect(screen.queryByText("Add at least one trigger word.")).toBeNull();
    fireEvent.click(saveSkill());
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/skills"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "api-conventions",
      source: {
        type: "inline",
        name: "api-conventions",
        content: API_MD,
        mode: "trigger",
        triggers: ["endpoint", "route", "api"],
      },
    });
  });

  it("a name that isn't kebab-case is refused before saving", async () => {
    const calls = mockApi({});
    await writeNew("API Conventions");
    fireEvent.click(saveSkill());
    expect(
      await screen.findByText(
        "Use lowercase letters, numbers and single hyphens, like house-style.",
      ),
    ).toBeTruthy();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(document.activeElement).toBe(nameInput());
    // Typing clears it, and the field keeps focus while it does.
    const field = nameInput();
    fireEvent.change(field, { target: { value: "api-conventions" } });
    expect(nameInput().getAttribute("aria-invalid")).toBeNull();
    expect(nameInput()).toBe(field);
    expect(document.activeElement).toBe(field);
  });

  it("a taken name shows the backend's 409 under the name (SKILL-36)", async () => {
    mockApi({
      "POST /api/skill-library": jsonError(409, "You already have a skill called house-style."),
    });
    await writeNew("house-style");
    fireEvent.click(saveSkill());
    expect(await screen.findByText("You already have a skill called house-style.")).toBeTruthy();
    expect(window.location.hash).toBe("#/toolkit/skills/new");
    expect(document.activeElement).toBe(nameInput());
  });

  it("GitHub repo swaps in the repo card and saves a repo source (TkF-SkillSource-1)", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library": (_u: URL, b: unknown) => {
        const body = b as { name: string; source: object };
        return skill("s9", body.name, body.source);
      },
    });
    renderAt("#/toolkit/skills/new");
    fireEvent.change(await screen.findByRole("textbox", { name: "Skill name" }), {
      target: { value: "team-skills" },
    });
    fireEvent.click(within(sourceGroup()).getByRole("button", { name: "GitHub repo" }));
    const card = screen.getByRole("region", { name: "From a GitHub repo" });
    expect(screen.queryByRole("textbox", { name: "SKILL.md" })).toBeNull();
    const repo = within(card).getByRole("textbox", { name: "Repository" });
    expect(repo.getAttribute("placeholder")).toBe("https://github.com/org/skills");
    expect(within(card).getByRole<HTMLInputElement>("textbox", { name: /^Version/ }).value).toBe(
      "main",
    );
    expect(
      within(card).getByText("A branch, tag or commit. Pinning keeps runs repeatable."),
    ).toBeTruthy();
    expect(within(card).getByText("Leave empty to add every skill in the repo.")).toBeTruthy();
    expect(saveSkill()).toHaveProperty("disabled", true);

    fireEvent.change(repo, { target: { value: "https://github.com/lazyxgenius/skills" } });
    fireEvent.change(within(card).getByRole("textbox", { name: /^Only these skills/ }), {
      target: { value: "review-*, pytest-*" },
    });
    fireEvent.click(saveSkill());
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/skills"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "team-skills",
      source: {
        type: "repo",
        url: "https://github.com/lazyxgenius/skills",
        ref: "main",
        filter: "review-*, pytest-*",
        mode: "always",
      },
    });
  });

  it("a bad repo URL shows the backend's words under Repository", async () => {
    mockApi({
      "POST /api/skill-library": jsonError(
        422,
        "Use a GitHub repo URL, like https://github.com/org/skills.",
      ),
    });
    renderAt("#/toolkit/skills/new");
    fireEvent.change(await screen.findByRole("textbox", { name: "Skill name" }), {
      target: { value: "team-skills" },
    });
    fireEvent.click(within(sourceGroup()).getByRole("button", { name: "GitHub repo" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository" }), {
      target: { value: "gitlab.com/x/y" },
    });
    fireEvent.click(saveSkill());
    const repo = await screen.findByRole("textbox", { name: "Repository" });
    await waitFor(() => expect(repo.getAttribute("aria-invalid")).toBe("true"));
    expect(
      screen.getByText("Use a GitHub repo URL, like https://github.com/org/skills."),
    ).toBeTruthy();
  });

  it("switching the source back keeps what was written", async () => {
    mockApi({});
    await writeNew();
    fireEvent.click(within(sourceGroup()).getByRole("button", { name: "GitHub repo" }));
    fireEvent.click(within(sourceGroup()).getByRole("button", { name: "Written here" }));
    expect((editor() as HTMLTextAreaElement).value).toBe(API_MD);
  });

  it("Cancel drops the draft and goes back to the list (SKILL-31)", async () => {
    const calls = mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    await writeNew();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.location.hash).toBe("#/toolkit/skills");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    // The breadcrumb goes back too.
    window.location.hash = "#/toolkit/skills/new";
    fireEvent.click(await screen.findByRole("link", { name: "Skills" }));
    expect(window.location.hash).toBe("#/toolkit/skills");
  });
});

describe("Save skill → the list (TkF-NewSkill-5, SKILL-30)", () => {
  it("returns to Your skills with the row tinted and the toast; Choose agents opens the picker", async () => {
    const library = [...LIBRARY];
    mockApi({
      "GET /api/skill-library": () => ({ skills: library }),
      "POST /api/skill-library": (_u: URL, b: unknown) => {
        const body = b as { name: string; source: object };
        const created = skill("s9", body.name, body.source, undefined, new Date().toISOString());
        library.push(created);
        return created;
      },
      "GET /api/skill-library/:id/agents": {
        teams: [
          {
            ...TEAM,
            agents: [
              {
                node_id: "n-reviewer",
                role_name: "reviewer",
                title: null,
                kind: "agent",
                edits_allowed: false,
                enabled: false,
                overridden: false,
                mode: null,
                triggers: null,
              },
            ],
          },
        ],
      },
    });
    await writeNew();
    fireEvent.click(saveSkill());
    const row = (await screen.findByRole("button", { name: "api-conventions" })).closest("tr")!;
    expect(row.className).toContain("sk-row--new");
    expect(within(row).getByText("Not used yet")).toBeTruthy();
    expect(within(row).getByText("Just now")).toBeTruthy();
    expect(
      within(table())
        .getAllByRole("row")
        .filter((r) => r.className.includes("sk-row--new")),
    ).toHaveLength(1);

    const toast = await toastWith(
      "api-conventions saved. Add it to agents from their Skills & tools tab.",
    );
    fireEvent.click(within(toast).getByRole("button", { name: "Choose agents" }));
    expect(await screen.findByRole("dialog", { name: "Turn on for agents" })).toBeTruthy();
    expect(screen.getByText("Turn api-conventions on for…")).toBeTruthy();
  });

  it("Choose agents from another page goes back to the list and opens the picker", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library": skill("s9", "api-conventions", {
        type: "inline",
        name: "api-conventions",
        content: API_MD,
        mode: "always",
      }),
      "GET /api/skill-library/:id/agents": { teams: [] },
    });
    await writeNew();
    fireEvent.click(saveSkill());
    const toast = await toastWith(
      "api-conventions saved. Add it to agents from their Skills & tools tab.",
    );
    window.location.hash = "#/home";
    expect(await screen.findByText("elsewhere")).toBeTruthy();
    fireEvent.click(within(toast).getByRole("button", { name: "Choose agents" }));
    expect(await screen.findByRole("dialog", { name: "Turn on for agents" })).toBeTruthy();
    expect(window.location.hash).toBe("#/toolkit/skills");
  });
});

describe("Existing skill (Toolkit-SkillEditor, SKILL-32…35)", () => {
  const detail = { ...HOUSE, used_by: [used("reviewer"), used("engineer")] };

  it("loads the skill: code-font title, filled editor, override helper and Used by badges", async () => {
    mockApi({ "GET /api/skill-library/:id": detail });
    renderAt("#/toolkit/skills/s1");
    const title = await screen.findByRole("heading", { level: 1, name: "house-style" });
    expect(title.className).toContain("sk-ed-title");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe(
      "Skillshouse-style",
    );
    expect(screen.queryByRole("textbox", { name: "Skill name" })).toBeNull();
    expect((editor() as HTMLTextAreaElement).value).toBe(HOUSE_MD);
    expect(
      screen.getByText("Each agent can change this in its own Skills & tools tab."),
    ).toBeTruthy();
    const side = screen.getByRole("region", { name: "Skill settings" });
    expect(within(side).getByText("Reviewer · Indicator sprint team")).toBeTruthy();
    expect(within(side).getByText("Engineer · Indicator sprint team")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false);
  });

  it("Save changes sends the edited source and says when agents get it (SKILL-34)", async () => {
    const calls = mockApi({
      "GET /api/skill-library/:id": detail,
      "PATCH /api/skill-library/:id": (_u: URL, b: unknown) => ({
        ...HOUSE,
        ...(b as object),
      }),
    });
    renderAt("#/toolkit/skills/s1");
    await screen.findByRole("heading", { name: "house-style" });
    fireEvent.change(editor(), { target: { value: `${HOUSE_MD}\n- One reason per line.` } });
    fireEvent.click(within(modeGroup()).getByRole("button", { name: "Agent decides" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await toastWith("house-style saved. Agents use it from their next run.")).toBeTruthy();
    expect(calls.find((c) => c.method === "PATCH")).toEqual({
      method: "PATCH",
      path: "/api/skill-library/s1",
      body: {
        name: "house-style",
        source: {
          type: "inline",
          name: "house-style",
          content: `${HOUSE_MD}\n- One reason per line.`,
          mode: "agent",
        },
      },
    });
    // It stays on the editor, now clean: Discard leaves.
    expect(window.location.hash).toBe("#/toolkit/skills/s1");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(window.location.hash).toBe("#/toolkit/skills");
  });

  it("a legacy name the old shelf allowed still saves (the backend keeps an unchanged name)", async () => {
    const legacy = {
      ...skill("s9", "House Style", {
        type: "inline",
        name: "House Style",
        content: HOUSE_MD,
        mode: "always",
      }),
      used_by: [],
    };
    const calls = mockApi({
      "GET /api/skill-library/:id": legacy,
      "PATCH /api/skill-library/:id": (_u: URL, b: unknown) => ({ ...legacy, ...(b as object) }),
    });
    renderAt("#/toolkit/skills/s9");
    await screen.findByRole("heading", { name: "House Style" });
    fireEvent.change(editor(), { target: { value: `${HOUSE_MD}\n- Short lines.` } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await toastWith("House Style saved. Agents use it from their next run.")).toBeTruthy();
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ name: "House Style" });
  });

  it("a name the backend refuses on an existing skill shows under its title", async () => {
    mockApi({
      "GET /api/skill-library/:id": detail,
      "PATCH /api/skill-library/:id": () =>
        jsonError(422, "Use lowercase letters, numbers and single hyphens, like house-style."),
    });
    renderAt("#/toolkit/skills/s1");
    await screen.findByRole("heading", { name: "house-style" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Use lowercase letters, numbers and single hyphens, like house-style.",
    );
  });

  it("Discard reverts unsaved edits first, then leaves (SKILL-35)", async () => {
    const calls = mockApi({
      "GET /api/skill-library/:id": detail,
      "GET /api/skill-library": { skills: LIBRARY },
    });
    renderAt("#/toolkit/skills/s1");
    await screen.findByRole("heading", { name: "house-style" });
    fireEvent.change(editor(), { target: { value: "scratch" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((editor() as HTMLTextAreaElement).value).toBe(HOUSE_MD);
    expect(window.location.hash).toBe("#/toolkit/skills/s1");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(window.location.hash).toBe("#/toolkit/skills");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("a skill no agent uses says so", async () => {
    mockApi({ "GET /api/skill-library/:id": { ...HOUSE, used_by: [] } });
    renderAt("#/toolkit/skills/s1");
    expect(await screen.findByText("No agents use it yet.")).toBeTruthy();
  });

  it("a repo skill opens on its repo card; one without a mode reads Agent decides", async () => {
    mockApi({
      "GET /api/skill-library/:id": {
        ...skill("s2", "pytest-review", {
          type: "repo",
          url: "https://github.com/org/skills",
          ref: "v1.2",
          filter: "pytest-review",
        }),
        used_by: [],
      },
    });
    renderAt("#/toolkit/skills/s2");
    const card = await screen.findByRole("region", { name: "From a GitHub repo" });
    expect(within(card).getByRole<HTMLInputElement>("textbox", { name: "Repository" }).value).toBe(
      "https://github.com/org/skills",
    );
    expect(within(card).getByRole<HTMLInputElement>("textbox", { name: /^Version/ }).value).toBe(
      "v1.2",
    );
    expect(
      within(modeGroup())
        .getByRole("button", { name: "Agent decides" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("an unknown id says it isn't in the library, with a way back", async () => {
    mockApi({
      "GET /api/skill-library/:id": jsonError(404, "skill not found in your library"),
      "GET /api/skill-library": { skills: LIBRARY },
    });
    renderAt("#/toolkit/skills/gone");
    expect(await screen.findByText("This skill isn’t in your library")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
    expect(window.location.hash).toBe("#/toolkit/skills");
  });

  it("a failed load offers Try again", async () => {
    let fail = true;
    mockApi({
      "GET /api/skill-library/:id": () => (fail ? jsonError(500, "database unavailable") : detail),
    });
    renderAt("#/toolkit/skills/s1");
    expect(await screen.findByText("Couldn’t load the skill")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "house-style" })).toBeTruthy();
  });
});
