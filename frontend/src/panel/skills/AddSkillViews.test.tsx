import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import {
  bodyOf,
  CATALOGUE,
  edges,
  engineer,
  json,
  pm,
  reviewer,
  ship,
  stubFetch,
} from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The Skills sheets (G8; Web-AddSkill, Panel-FromRepo, Flow-Presets): write or edit a skill, add a
// GitHub repo, pick presets or library skills — each into the draft, first in the list, one Save.

const SKILLS = [
  { type: "inline", name: "house-style", content: "# House style", mode: "always" },
  { type: "library", id: "s-sec" },
];
const libraryItem = (id: string, name: string) => ({
  id,
  name,
  source: { type: "inline", name, content: "…", mode: "always" },
  created_at: "",
});
const preset = (key: string, name: string, title: string) => ({
  key,
  name,
  title,
  description: `${title} in short.`,
  access: "free",
  badge: "Free",
  attachable: true,
  source: { type: "inline", name, content: `# ${title}`, mode: "always" },
});
const PRESETS = [
  preset("tdd", "tdd-discipline", "TDD discipline"),
  preset("yagni", "yagni", "YAGNI"),
  preset("caveman", "caveman", "Caveman (terse)"),
];

let fetchMock: ReturnType<typeof vi.fn>;
let library: ReturnType<typeof libraryItem>[];
const node = (skills: unknown[] | null = SKILLS) => reviewer({ skills, tool_config: null });

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  library = [libraryItem("s-sec", "security-checklist"), libraryItem("s-yag", "yagni")];
  fetchMock = stubFetch(node, (url, init) => {
    if (url === "/api/skill-library" && init?.method === "POST") {
      const body = JSON.parse(init.body as string) as { name: string };
      return json({ ...libraryItem(`s-${body.name}`, body.name), source: {} });
    }
    if (url === "/api/skill-library") return json({ skills: library });
    if (url === "/api/skill-presets") return json({ skills: PRESETS });
    if (url === "/api/tool-library") return json({ tools: [] });
    if (url === "/api/secrets") return json({ secrets: [] });
    return undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderTab(saved: TeamGraphNode = node()) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: saved,
    nodes: [pm, engineer, saved, ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "skills",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onOpenToolkit: vi.fn(),
  };
  render(<NodeEditor {...props} />);
  return { props, drawer: screen.getByRole("complementary", { name: "Reviewer settings" }) };
}

async function openSheet(item: string) {
  await screen.findByText(/security-checklist|No skills yet/);
  fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

const skillNames = () =>
  within(screen.getByRole("region", { name: /^Skills/ }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".nd-skill__name")?.textContent ?? li.textContent);

async function savedSkills(drawer: HTMLElement) {
  fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
  await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toBeTruthy());
  return (bodyOf(fetchMock, "PATCH") as { skills: Record<string, unknown>[] }).skills;
}

describe("Write a new skill (Web-AddSkill)", () => {
  it("needs a name and content, and trigger words when triggered; adds it first", async () => {
    const { drawer } = renderTab();
    await openSheet("Write a new skill");
    const sheet = within(screen.getByRole("region", { name: "Write a new skill" }));
    expect(sheet.getByText("Adds to this agent. Save to keep it.")).toBeTruthy();
    // The sheet covers the Save footer.
    expect(within(drawer).queryByRole("button", { name: /^Save/ })).toBeNull();
    const add = sheet.getByRole<HTMLButtonElement>("button", { name: "Add skill" });
    expect(add.disabled).toBe(true);
    fireEvent.change(sheet.getByRole("textbox", { name: "Name" }), {
      target: { value: "security-review" },
    });
    fireEvent.change(sheet.getByRole("textbox", { name: "Skill content (SKILL.md)" }), {
      target: { value: "# Security review" },
    });
    expect(add.disabled).toBe(false);
    fireEvent.click(sheet.getByRole("button", { name: "When triggered" }));
    expect(
      sheet.getByText("Loads only when the conversation mentions one of the trigger words."),
    ).toBeTruthy();
    expect(add.disabled).toBe(true);
    fireEvent.change(sheet.getByRole("textbox", { name: "Trigger words" }), {
      target: { value: "auth, secrets, auth" },
    });
    fireEvent.click(add);

    expect(screen.queryByRole("region", { name: "Write a new skill" })).toBeNull();
    expect(skillNames()[0]).toBe("security-review");
    expect(within(drawer).getByText("1 unsaved change")).toBeTruthy();
    expect((await savedSkills(drawer))[0]).toEqual({
      type: "inline",
      name: "security-review",
      content: "# Security review",
      mode: "trigger",
      triggers: ["auth", "secrets"],
    });
  });

  it("warns when this agent already has a skill of that name", async () => {
    renderTab();
    await openSheet("Write a new skill");
    const sheet = within(screen.getByRole("region", { name: "Write a new skill" }));
    const name = sheet.getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "security-checklist" } });
    expect(sheet.getByRole("status").textContent).toBe(
      "This agent already has a skill called security-checklist. A run uses only the one higher in the list.",
    );
    fireEvent.change(name, { target: { value: "fresh" } });
    expect(sheet.queryByRole("status")).toBeNull();
  });

  it("edits a custom skill in its place", async () => {
    const { drawer } = renderTab();
    await screen.findByText("security-checklist");
    fireEvent.click(screen.getByRole("button", { name: "More actions for house-style" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    const sheet = within(screen.getByRole("region", { name: "Edit skill" }));
    // Its own name isn't a duplicate.
    expect(sheet.queryByRole("status")).toBeNull();
    fireEvent.change(sheet.getByRole("textbox", { name: "Skill content (SKILL.md)" }), {
      target: { value: "# House style, v2" },
    });
    fireEvent.click(sheet.getByRole("button", { name: "Update skill" }));
    expect(skillNames()).toEqual(["house-style", "security-checklist"]);
    expect((await savedSkills(drawer))[0]).toEqual({ ...SKILLS[0], content: "# House style, v2" });
  });

  it("Back and Cancel leave the draft as it was and return to the list", async () => {
    const { drawer } = renderTab();
    await openSheet("Write a new skill");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
    expect(screen.queryByRole("region", { name: "Write a new skill" })).toBeNull();
    expect(within(drawer).getByText("All changes saved")).toBeTruthy();
  });
});

describe("Add skills from a GitHub repo (Panel-FromRepo)", () => {
  it("sends main for a blank Version and the filter as comma globs", async () => {
    const { drawer } = renderTab();
    await openSheet("From a GitHub repo");
    const sheet = within(screen.getByRole("region", { name: "Add skills from a GitHub repo" }));
    expect(sheet.getByText("Skills load when the team runs.")).toBeTruthy();
    const repo = sheet.getByRole("textbox", { name: "Repository" });
    fireEvent.change(repo, { target: { value: "gitlab.com/org/skills" } });
    fireEvent.click(sheet.getByRole("button", { name: "Add repo" }));
    expect(sheet.getByRole("alert").textContent).toBe(
      "Use a GitHub repo URL, like https://github.com/org/skills.",
    );
    fireEvent.change(repo, { target: { value: "lazyxgenius/skills" } });
    fireEvent.change(sheet.getByRole("textbox", { name: /^Only these skills/ }), {
      target: { value: "review-*,pytest-*" },
    });
    fireEvent.keyDown(repo, { key: "Enter" });

    expect(skillNames()[0]).toBe("lazyxgenius/skills");
    expect((await savedSkills(drawer))[0]).toEqual({
      type: "repo",
      url: "https://github.com/lazyxgenius/skills",
      ref: "main",
      filter: "review-*, pytest-*",
    });
  });
});

describe("Add from presets (Flow-Presets)", () => {
  it("copies a new preset into the library, reuses one by name, and adds both first", async () => {
    const { drawer } = renderTab();
    await openSheet("From presets");
    const region = await screen.findByRole("region", { name: "Add from presets" });
    const sheet = within(region);
    await sheet.findByText("TDD discipline");
    const add = () => sheet.getByRole<HTMLButtonElement>("button", { name: /^Add/ });
    expect(add().textContent).toBe("Add skills");
    expect(add().disabled).toBe(true);
    fireEvent.click(sheet.getByRole("checkbox", { name: /TDD discipline/ }));
    fireEvent.click(sheet.getByRole("checkbox", { name: /YAGNI/ }));
    expect(add().textContent).toBe("Add 2 skills");
    fireEvent.change(sheet.getByRole("textbox", { name: "Search presets" }), {
      target: { value: "terse" },
    });
    expect(sheet.queryByText("YAGNI")).toBeNull();
    expect(sheet.getByText("Caveman (terse)")).toBeTruthy();
    fireEvent.click(add());

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Add from presets" })).toBeNull(),
    );
    // Only tdd-discipline was new; yagni was already in the library.
    const posts = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/skill-library" && (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(
      posts.map((c) => (JSON.parse((c[1] as RequestInit).body as string) as { name: string }).name),
    ).toEqual(["tdd-discipline"]);
    expect(skillNames()).toEqual(["tdd-discipline", "yagni", "house-style", "security-checklist"]);
    const row = screen.getByText("tdd-discipline").closest("li") as HTMLElement;
    expect(within(row).getByText("Preset")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Agent decides" })).toBeTruthy();
    const toast = document.querySelector(".nd-toast-host") as HTMLElement;
    expect(within(toast).getByText("2 skills added")).toBeTruthy();

    const skills = await savedSkills(drawer);
    expect(skills.slice(0, 2)).toEqual([
      { type: "library", id: "s-tdd-discipline", origin: "preset:tdd", mode: "agent" },
      { type: "library", id: "s-yag", origin: "preset:yagni", mode: "agent" },
    ]);
  });

  it("Undo takes the added presets out again", async () => {
    const { drawer } = renderTab();
    await openSheet("From presets");
    const sheet = within(await screen.findByRole("region", { name: "Add from presets" }));
    fireEvent.click(await sheet.findByRole("checkbox", { name: /YAGNI/ }));
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 skill" }));
    const toast = document.querySelector(".nd-toast-host") as HTMLElement;
    fireEvent.click(await within(toast).findByRole("button", { name: "Undo" }));
    expect(skillNames()).toEqual(["house-style", "security-checklist"]);
    expect(within(drawer).getByText("All changes saved")).toBeTruthy();
  });

  it("can't add a preset this agent already has", async () => {
    renderTab(node([...SKILLS, { type: "library", id: "s-yag", origin: "preset:yagni" }]));
    await openSheet("From presets");
    const sheet = within(await screen.findByRole("region", { name: "Add from presets" }));
    const yagni = await sheet.findByRole<HTMLInputElement>("checkbox", { name: /YAGNI/ });
    expect(yagni.disabled).toBe(true);
    expect(yagni.checked).toBe(true);
  });
});

describe("From your library", () => {
  it("disables skills already added and adds the picked ones first", async () => {
    const { drawer } = renderTab();
    await openSheet("From your library");
    const sheet = within(screen.getByRole("region", { name: "Add from your library" }));
    expect(
      sheet.getByRole<HTMLInputElement>("checkbox", { name: /security-checklist/ }).disabled,
    ).toBe(true);
    fireEvent.click(sheet.getByRole("checkbox", { name: /yagni/ }));
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 skill" }));
    expect(skillNames()[0]).toBe("yagni");
    expect((await savedSkills(drawer))[0]).toEqual({ type: "library", id: "s-yag" });
  });

  it("says so when the library can't load, and Try again loads it", async () => {
    let fail = true;
    fetchMock = stubFetch(node, (url) => {
      if (url === "/api/skill-library")
        return fail ? json({ detail: "boom" }, 500) : json({ skills: library });
      if (url === "/api/tool-library") return json({ tools: [] });
      if (url === "/api/secrets") return json({ secrets: [] });
      return undefined;
    });
    renderTab(node(null));
    await openSheet("From your library");
    const sheet = within(screen.getByRole("region", { name: "Add from your library" }));
    expect(await sheet.findByText("Couldn’t load your library.")).toBeTruthy();
    fail = false;
    fireEvent.click(sheet.getByRole("button", { name: "Try again" }));
    expect(await sheet.findByRole("checkbox", { name: /yagni/ })).toBeTruthy();
  });

  it("with an empty library, links to Toolkit", async () => {
    library = [];
    const { props } = renderTab(node(null));
    await openSheet("From your library");
    const sheet = within(screen.getByRole("region", { name: "Add from your library" }));
    expect(await sheet.findByText("No library skills yet.")).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Open Toolkit" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "skills", view: "mine" });
  });
});
