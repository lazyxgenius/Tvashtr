import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// Focus-Skills (FOCUS-45..53): the drawer's lists on the left, the picked skill on the right.

const HOUSE_STYLE = "# House style\n\nWrite review notes in plain words.";
const SKILLS = [
  { type: "inline", name: "house-style", content: HOUSE_STYLE, mode: "always" },
  { type: "repo", url: "https://github.com/org/skills", ref: "main", filter: "pytest-review" },
  { type: "library", id: "s-sec" },
];
const LIBRARY = {
  skills: [
    {
      id: "s-sec",
      name: "security-checklist",
      source: {
        type: "inline",
        name: "security-checklist",
        content: "Check auth.",
        mode: "trigger",
        triggers: ["auth"],
      },
      created_at: "",
    },
  ],
};

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  stubFetch(
    () => reviewer({ skills: SKILLS }),
    (url) => (url === "/api/skill-library" ? json(LIBRARY) : undefined),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
  delete document.documentElement.dataset.tvashtrDesktop;
});

function renderSkills(over: Partial<NodeEditorProps> = {}) {
  const saved = reviewer({ skills: SKILLS });
  // The Engineer carries the same house-style skill; the Product manager doesn't.
  const eng: TeamGraphNode = { ...engineer, skills: [SKILLS[0]] };
  render(
    <NodeEditor
      teamId="t1"
      node={saved}
      nodes={[pm, eng, saved, ship]}
      edges={edges}
      isEntry={false}
      cover={{ byok: new Set(["xai"]), subs: {} }}
      tab="skills"
      onTabChange={vi.fn()}
      focus
      onFocusChange={vi.fn()}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...over}
    />,
  );
  return within(screen.getByRole("dialog", { name: "Reviewer in focus view" }));
}

describe("Focus view › Skills & tools", () => {
  it("shows the first skill in full: loads, size, who uses it, its SKILL.md and how it arrives", () => {
    const view = renderSkills();
    const detail = within(view.getByRole("region", { name: "house-style" }));
    expect(detail.getByText("Always on")).toBeInTheDocument();
    expect(detail.getByText(`${HOUSE_STYLE.length} characters`)).toBeInTheDocument();
    expect(detail.getByText("Reviewer, Engineer")).toBeInTheDocument();
    expect(detail.getByText(/Write review notes in plain words\./)).toBeInTheDocument();
    expect(
      detail.getByText(
        "Always-on skills go into every prompt in full. Reviewer is a worker agent, so it also gets this skill as context.",
      ),
    ).toBeInTheDocument();
    expect(detail.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("picks another row; a repo skill has no Edit and is fetched when the team runs", async () => {
    const view = renderSkills();
    fireEvent.click(view.getByRole("button", { name: "pytest-review" }));
    const detail = within(view.getByRole("region", { name: "pytest-review" }));
    expect(detail.getByText("Agent decides")).toBeInTheDocument();
    expect(detail.getByText("Fetched when the team runs")).toBeInTheDocument();
    expect(detail.getByText("Reviewer")).toBeInTheDocument();
    expect(detail.queryByRole("button", { name: "Edit" })).toBeNull();

    // A library skill shows its library content; Enter on a name picks it too.
    fireEvent.keyDown(await view.findByRole("button", { name: "security-checklist" }), {
      key: "Enter",
    });
    const lib = within(view.getByRole("region", { name: "security-checklist" }));
    expect(lib.getByText("11 characters")).toBeInTheDocument();
    expect(lib.getByText(/^Triggered skills load in full/)).toBeInTheDocument();
  });

  it("Edit opens the sheet of a skill written on this agent", () => {
    const view = renderSkills();
    fireEvent.click(
      within(view.getByRole("region", { name: "house-style" })).getByRole("button", {
        name: "Edit",
      }),
    );
    expect(view.getByRole("textbox", { name: /name/i })).toHaveValue("house-style");
  });

  it("removes the picked skill from ⋯, with Undo", () => {
    const view = renderSkills();
    const detail = within(view.getByRole("region", { name: "house-style" }));
    fireEvent.click(detail.getByRole("button", { name: "More actions" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Remove from this agent" }));
    expect(view.getByText("1 unsaved change")).toBeInTheDocument();
    expect(view.getByRole("region", { name: "pytest-review" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Undo" }));
    expect(view.getByRole("region", { name: "house-style" })).toBeInTheDocument();
    expect(view.getByText("All changes saved")).toBeInTheDocument();
  });

  it("on a Desktop subscription the skill is added to the agent's instructions", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const view = renderSkills({ cover: { byok: new Set(), subs: { grok: true } } });
    expect(
      view.getByText(
        "Always-on skills go into every prompt in full. Reviewer runs on your Grok subscription on this computer, so the skill is added to its instructions.",
      ),
    ).toBeInTheDocument();
  });
});
