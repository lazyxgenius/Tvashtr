import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { sampleDomains } from "../../pages/domains/domainsTestUtils";
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

// The Skills & tools tab (G7; Web-Skills, Panel-SkillsEmpty, Panel-AddMenu, Flow-LoadMode,
// Flow-SkillMenu, Flow-ToolMenu): rows, load modes and trigger words, the ⋯ menus, Remove + Undo,
// the switches and the empty state, all through the draft and one Save.

const SKILLS = [
  { type: "inline", name: "house-style", content: "# House style", mode: "always" },
  { type: "repo", url: "https://github.com/org/skills", ref: "main", filter: "pytest-review" },
  { type: "library", id: "s-sec" },
  { type: "project_rules" },
];
const TOOLS = {
  mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } },
  tvashtr: { library: ["t-gh"], domains: true },
};
const SHELVES: Record<string, unknown> = {
  "/api/skill-library": {
    skills: [
      {
        id: "s-sec",
        name: "security-checklist",
        source: {
          type: "inline",
          name: "security-checklist",
          content: "…",
          mode: "trigger",
          triggers: ["auth", "secrets", "tokens"],
        },
        created_at: "",
      },
    ],
  },
  "/api/tool-library": {
    tools: [
      {
        id: "t-gh",
        name: "github",
        server_config: {
          url: "https://api.githubcopilot.com/mcp",
          headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
        },
        created_at: "",
      },
    ],
  },
  "/api/secrets": { secrets: [] },
  // "Domains this agent can search" lists the account's domains (DM-105).
  "/api/domains": { domains: sampleDomains() },
};

let fetchMock: ReturnType<typeof vi.fn>;
const full = () => reviewer({ skills: SKILLS, tool_config: TOOLS });

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  fetchMock = stubFetch(full, (url) => (url in SHELVES ? json(SHELVES[url]) : undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  delete document.documentElement.dataset.tvashtrDesktop;
});

function renderTab(node: TeamGraphNode = full(), over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node,
    nodes: [pm, engineer, node, ship],
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
    ...over,
  };
  render(<NodeEditor {...props} />);
  const drawer = screen.getByRole("complementary", { name: "Reviewer settings" });
  return {
    props,
    drawer,
    skills: within(screen.getByRole("region", { name: /^Skills/ })),
    tools: within(screen.getByRole("region", { name: /^Tools/ })),
  };
}

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("Skills & tools — the lists", () => {
  it("shows each source's badge, load mode and words, the switches, and counts skills + servers", async () => {
    const { drawer, skills, tools } = renderTab();
    expect(await screen.findByText("security-checklist")).toBeTruthy();
    expect(within(drawer).getByRole("tab", { name: /^Skills & tools\s*5$/ })).toBeTruthy();
    expect(within(rowOf("house-style")).getByText("Custom")).toBeTruthy();
    expect(within(rowOf("house-style")).getByRole("button", { name: "Always on" })).toBeTruthy();
    expect(within(rowOf("pytest-review")).getByText("org/skills @ main")).toBeTruthy();
    expect(
      within(rowOf("pytest-review")).getByRole("button", { name: "Agent decides" }),
    ).toBeTruthy();
    const sec = rowOf("security-checklist");
    expect(within(sec).getByText("Library")).toBeTruthy();
    expect(within(sec).getByRole("button", { name: "When triggered" })).toBeTruthy();
    expect(within(sec).getByText("tokens")).toBeTruthy();
    expect(
      skills.getByRole<HTMLInputElement>("switch", { name: "Follow the repo’s rules files" })
        .checked,
    ).toBe(true);
    // `domains: true` (the round-1 switch) ticks every domain in the checklist (DM-105).
    for (const name of ["Support docs", "Vendor contracts", "Research papers", "Q3 filings"]) {
      expect(
        (await tools.findByRole<HTMLInputElement>("checkbox", { name: new RegExp(`^${name}`) }))
          .checked,
      ).toBe(true);
    }
    expect(within(rowOf("fetch")).getByText("Local")).toBeTruthy();
    expect(within(rowOf("fetch")).getByText("uvx mcp-server-fetch")).toBeTruthy();
    // ${GITHUB_TOKEN} isn't in Secrets, so the library server needs one.
    await waitFor(() => expect(within(rowOf("github")).getByText("Needs secret")).toBeTruthy());
    expect(
      within(rowOf("github")).getByText("https://api.githubcopilot.com/mcp · ${GITHUB_TOKEN}"),
    ).toBeTruthy();
  });

  it("offers Edit on custom skills only, Open in Toolkit on library items (Q13)", async () => {
    const { props } = renderTab();
    await screen.findByText("security-checklist");
    const items = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name: `More actions for ${name}` }));
      const menu = screen.getByRole("menu", { name: `More actions for ${name}` });
      const names = within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent);
      fireEvent.keyDown(menu, { key: "Escape" });
      return names;
    };
    expect(items("house-style")).toEqual(["Edit", "Remove from this agent"]);
    expect(items("pytest-review")).toEqual(["Remove from this agent"]);
    fireEvent.click(screen.getByRole("button", { name: "More actions for security-checklist" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Toolkit" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "skill", skillId: "s-sec" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for github" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Toolkit" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "tool", toolId: "t-gh" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for fetch" }));
    expect(screen.getByRole("menuitem", { name: "Edit connection" })).toBeTruthy();
  });
});

describe("Skills & tools — the Skills ⓘ", () => {
  it("says every agent gets its skills as context (team_run build_skills), folded in on Desktop", () => {
    const { skills } = renderTab();
    expect(
      skills.getByRole("img", {
        name: "Reusable know-how the agent gets as context. On a Desktop subscription they’re added to its instructions.",
      }),
    ).toBeInTheDocument();
  });
});

describe("Skills & tools — load mode (Flow-LoadMode)", () => {
  it("When triggered asks for words inline, then saves the mode on the repo source", async () => {
    const { drawer } = renderTab();
    await screen.findByText("security-checklist");
    fireEvent.click(within(rowOf("pytest-review")).getByRole("button", { name: "Agent decides" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^When triggered/ }));
    const words = screen.getByRole("textbox", { name: "Trigger words for pytest-review" });
    fireEvent.keyDown(words, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("Add at least one trigger word.");
    fireEvent.change(words, { target: { value: "pytest, tests" } });
    fireEvent.keyDown(words, { key: "Enter" });
    const row = rowOf("pytest-review");
    expect(within(row).getByRole("button", { name: "When triggered" })).toBeTruthy();
    expect(within(row).getByText("tests")).toBeTruthy();
    expect(within(drawer).getByText("1 unsaved change")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toBeTruthy());
    const body = bodyOf(fetchMock, "PATCH") as { skills: unknown[] };
    expect(Object.keys(body)).toEqual(["skills"]);
    expect(body.skills[1]).toEqual({
      ...SKILLS[1],
      mode: "trigger",
      triggers: ["pytest", "tests"],
    });
  });

  it("Escape leaves the mode as it was", async () => {
    renderTab();
    await screen.findByText("security-checklist");
    fireEvent.click(within(rowOf("house-style")).getByRole("button", { name: "Always on" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^When triggered/ }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Trigger words for house-style" }), {
      key: "Escape",
    });
    expect(within(rowOf("house-style")).getByRole("button", { name: "Always on" })).toBeTruthy();
    fireEvent.click(within(rowOf("house-style")).getByRole("button", { name: "Always on" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Agent decides/ }));
    expect(
      within(rowOf("house-style")).getByRole("button", { name: "Agent decides" }),
    ).toBeTruthy();
  });
});

describe("Skills & tools — remove with Undo (Flow-SkillMenu, Flow-ToolMenu)", () => {
  it("removes a skill with a Removed toast whose Undo puts it back", async () => {
    const { skills, drawer } = renderTab();
    await screen.findByText("security-checklist");
    fireEvent.click(screen.getByRole("button", { name: "More actions for pytest-review" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from this agent" }));
    expect(skills.queryByText("pytest-review")).toBeNull();
    expect(skills.getByRole("heading", { name: /^Skills\s*2/ })).toBeTruthy();
    const toast = drawer.querySelector(".nd-toast-host") as HTMLElement;
    expect(within(toast).getByText("Removed pytest-review")).toBeTruthy();
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(skills.getByText("pytest-review")).toBeTruthy();
    expect(within(drawer).getByText("All changes saved")).toBeTruthy();
  });

  it("removes a tool (and its switch), switches servers, unticks a domain, and saves tool_config", async () => {
    const { tools, drawer } = renderTab();
    await screen.findByText("github");
    fireEvent.click(tools.getByRole("switch", { name: "Enable fetch" }));
    // From "every domain", unticking one keeps the others as a list.
    fireEvent.click(await tools.findByRole("checkbox", { name: /^Q3 filings/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for github" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from this agent" }));
    expect(tools.queryByText("github")).toBeNull();
    const toast = drawer.querySelector(".nd-toast-host") as HTMLElement;
    expect(within(toast).getByText("Removed github")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toBeTruthy());
    expect(bodyOf(fetchMock, "PATCH")).toEqual({
      tool_config: {
        mcpServers: TOOLS.mcpServers,
        tvashtr: {
          servers: { fetch: { enabled: false } },
          domains: ["d-support", "d-vendor", "d-research"],
        },
      },
    });
  });

  it("ticks a domain into tool_config and saves it (DM-105)", async () => {
    const { tools, drawer } = renderTab(reviewer());
    const support = await tools.findByRole<HTMLInputElement>("checkbox", {
      name: /^Support docs/,
    });
    expect(support.checked).toBe(false);
    expect(tools.getByText(/During a run this agent gets two tools:/)).toBeTruthy();
    fireEvent.click(support);
    // Domains don't count in the tab.
    expect(within(drawer).getByRole("tab", { name: /^Skills & tools$/ })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toBeTruthy());
    expect(bodyOf(fetchMock, "PATCH")).toEqual({
      tool_config: { tvashtr: { domains: ["d-support"] } },
    });
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    // Unticking it again is a change of its own.
    fireEvent.click(tools.getByRole("checkbox", { name: /^Support docs/ }));
    expect(within(drawer).getByText("1 unsaved change")).toBeTruthy();
  });
});

describe("Skills & tools — empty state and switches", () => {
  it("shows the four ways in, the rules switch, and adds Web fetch inline (Q15)", async () => {
    const { skills, tools, drawer } = renderTab(reviewer());
    expect(skills.getByText("No skills yet")).toBeTruthy();
    for (const card of ["Write a new skill", "Presets", "Your library", "From a GitHub repo"]) {
      expect(skills.getByRole("button", { name: new RegExp(`^${card}`) })).toBeTruthy();
    }
    expect(within(drawer).getByRole("tab", { name: /^Skills & tools$/ })).toBeTruthy();
    fireEvent.click(skills.getByRole("switch", { name: "Follow the repo’s rules files" }));
    expect(tools.getByText(/^No servers yet/)).toBeTruthy();
    fireEvent.click(tools.getByRole("button", { name: "Add" }));
    expect(within(rowOf("fetch")).getByText("Local")).toBeTruthy();
    expect(tools.queryByText(/^No servers yet/)).toBeNull();
    // Rules files and Domains don't count; the fetch server does.
    expect(within(drawer).getByRole("tab", { name: /^Skills & tools\s*1$/ })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toBeTruthy());
    expect(bodyOf(fetchMock, "PATCH")).toEqual({
      skills: [{ type: "project_rules" }],
      tool_config: { mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } } },
    });
  });

  it("opens the Add skill and Add tool menus", async () => {
    const { skills, tools } = renderTab();
    await screen.findByText("security-checklist");
    fireEvent.click(skills.getByRole("button", { name: "Add skill" }));
    expect(
      within(screen.getByRole("menu", { name: "Add skill" }))
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Write a new skill", "From presets", "From your library", "From a GitHub repo"]);
    fireEvent.click(tools.getByRole("button", { name: "Add tool" }));
    expect(
      within(screen.getByRole("menu", { name: "Add tool" }))
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual([
      "Add a serverName, Local or Remote, command or URL",
      "From your library",
      "Paste mcp.json",
    ]);
  });
});

describe("Skills & tools — Desktop subscription agents (PANEL-103)", () => {
  it("says what an agent on a subscription doesn't use, on Desktop only", () => {
    const cover = { byok: new Set<string>(), subs: { grok: true } };
    document.documentElement.dataset.tvashtrDesktop = "true";
    renderTab(full(), { cover });
    expect(screen.getByRole("note").textContent).toMatch(
      /^Runs on your Grok subscription on this computer\. Its skills are added to its instructions, but tools, Domains and the repo’s rules files aren’t used there yet\.$/,
    );
  });

  it("shows no note on the website", () => {
    renderTab(full(), { cover: { byok: new Set<string>(), subs: { grok: true } } });
    expect(screen.queryByRole("note")).toBeNull();
  });
});
