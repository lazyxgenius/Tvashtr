import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import type { InstructionEntry } from "../lib/api/versions";
import { NodeEditor, type NodeEditorProps } from "./NodeEditor";
import { resetNodeTemplates } from "./setup/useNodeTemplates";

// M5 — the drawer's Instructions › History (Ver-AgentHistory): a History toggle between Templates
// and Open full editor, the instruction history under the card, and "Use this text" as a draft.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const V7_TEXT = "1. Inspect.\n4. Fail the round if any new indicator is not registered.";
const V6_TEXT = "1. Inspect.\n3. Compare the build with the spec, item by item.";
const reviewer: TeamGraphNode = {
  id: "n-rev",
  role_name: "reviewer",
  kind: "agent",
  model: "xai/grok-4.7",
  engine: "openhands",
  prompt: V7_TEXT,
  position: { x: 0, y: 0 },
  edits_allowed: false,
  config: { title: "Reviewer" },
  skills: null,
  tool_config: null,
  last_run: null,
};
const ENTRIES: InstructionEntry[] = [
  {
    number: 7,
    created_at: ago(2),
    author: "you",
    current: true,
    first: false,
    text: V7_TEXT,
    added: ["Fail the round if any new indicator is not registered on INDICATORS."],
    removed: ["Approve when the tests pass."],
  },
  {
    number: 6,
    created_at: ago(1440),
    author: "you",
    current: false,
    first: false,
    text: V6_TEXT,
    added: ["Compare the build with the spec, item by item."],
    removed: [],
  },
  {
    number: 4,
    created_at: ago(5 * 1440),
    author: "you",
    current: false,
    first: true,
    text: "The built-in text.",
    added: [],
    removed: [],
    from_builtin: "Reviewer",
  },
];
const HISTORY_URL = "/api/teams/t1/nodes/n-rev/instruction-history";

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));

beforeEach(() => {
  setProviderCatalogue([
    {
      provider: "xai",
      thinker_default: "xai/grok-4.7",
      worker_default: "xai/grok-4.7",
      thinker_presets: ["xai/grok-4.7"],
      worker_presets: ["xai/grok-4.7"],
      label: "xAI",
      model_labels: { "xai/grok-4.7": "Grok 4.7" },
    },
  ]);
  fetchMock = vi.fn((input: string) => {
    if (input === HISTORY_URL) return json({ count: 3, entries: ENTRIES });
    if (input.startsWith("/api/memories")) return json({ memories: [] });
    if (input === "/api/node-templates") return json({ templates: [] });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderEditor(over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: reviewer,
    nodes: [reviewer],
    edges: [],
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "setup",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    teamVersion: 7,
    ...over,
  };
  const view = render(<NodeEditor {...props} />);
  return { props, view, drawer: screen.getByRole("complementary", { name: /settings$/ }) };
}
const instructions = (drawer: HTMLElement) =>
  within(drawer).getByRole<HTMLTextAreaElement>("textbox", { name: /^Instructions/ });

describe("NodeEditor — M5 Instructions › History", () => {
  it("History sits between Templates and Open full editor; the drawer's footer is unchanged", () => {
    const { drawer } = renderEditor();
    const card = within(drawer).getByRole("region", { name: "Instructions" });
    const tools = [...card.querySelectorAll(".nd-card__tools > *")].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent,
    );
    expect(tools).toEqual(["Templates", "History", "Open full editor"]);
    const history = within(card).getByRole("button", { name: "History" });
    expect(history).toHaveAttribute("aria-pressed", "false");
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(HISTORY_URL, expect.anything());
  });

  it("opens the instruction history: each version's lines, Now, the built-in first text", async () => {
    const { drawer } = renderEditor();
    const history = within(drawer).getByRole("button", { name: "History" });
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-pressed", "true");
    expect(history).toHaveClass("ds-btn--tint");
    const section = within(drawer).getByRole("region", { name: "Instruction history" });
    expect(await within(section).findByText("3 versions")).toBeInTheDocument();
    const items = within(section).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("v7Now2m ago · you");
    expect(items[0]).toHaveTextContent(
      "+ Fail the round if any new indicator is not registered on INDICATORS.",
    );
    expect(within(items[0]).getByText("− Approve when the tests pass.")).toHaveClass(
      "nd-ihist__line--removed",
    );
    expect(within(items[0]).queryByRole("button", { name: "Use the v7 text" })).toBeNull();
    expect(items[1]).toHaveTextContent("v6yesterday · you");
    expect(items[2]).toHaveTextContent("v45 days ago");
    expect(items[2]).toHaveTextContent("First text, from the built-in Reviewer");
    expect(items[2]).not.toHaveTextContent("· you");
    expect(within(items[0]).queryByRole("button", { name: "Compare v7" })).toBeNull();
    // Each row's buttons are named with their version; the words on them stay as drawn.
    expect(within(items[1]).getByRole("button", { name: "Compare v6" })).toHaveTextContent(
      /^Compare$/,
    );
    expect(within(items[2]).getByRole("button", { name: "Use the v4 text" })).toHaveTextContent(
      /^Use this text$/,
    );
    expect(section).toHaveTextContent(
      "Using an older text changes only these instructions. It becomes a draft until you save.",
    );
    // The toggle puts it away.
    fireEvent.click(history);
    expect(within(drawer).queryByRole("region", { name: "Instruction history" })).toBeNull();
  });

  it("Use this text puts the v6 text in the editor as a draft, with Undo", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(within(drawer).getByRole("button", { name: "History" }));
    const section = within(drawer).getByRole("region", { name: "Instruction history" });
    const items = await within(section).findAllByRole("listitem");
    fireEvent.click(within(items[1]).getByRole("button", { name: "Use the v6 text" }));
    expect(instructions(drawer).value).toBe(V6_TEXT);
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    const toast = drawer.querySelector(".nd-toast-host") as HTMLElement;
    expect(toast).toHaveTextContent("Instructions set to the v6 text");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(instructions(drawer).value).toBe(V7_TEXT);
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
  });

  it("Compare (Ver-AgentCompare): the older text against the text now; Use this text", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(within(drawer).getByRole("button", { name: "History" }));
    const items = await within(
      within(drawer).getByRole("region", { name: "Instruction history" }),
    ).findAllByRole("listitem");
    fireEvent.click(within(items[1]).getByRole("button", { name: "Compare v6" }));
    const dialog = screen.getByRole("dialog", { name: "Compare v6 with the text now" });
    expect(dialog).toHaveTextContent("Reviewer’s instructions · v6 was saved yesterday by you");
    const section = within(dialog).getByRole("region", { name: "Reviewer › Instructions" });
    expect(section).toHaveTextContent("1 removed, 1 added");
    expect(
      [...section.querySelectorAll(".cv-diff__row")].map((r) => [r.className, r.textContent]),
    ).toEqual([
      ["cv-diff__row cv-diff__row--context", " 1. Inspect."],
      ["cv-diff__row cv-diff__row--removed", "−3. Compare the build with the spec, item by item."],
      [
        "cv-diff__row cv-diff__row--added",
        "+4. Fail the round if any new indicator is not registered.",
      ],
    ]);
    expect(dialog).toHaveTextContent(
      "− is in v6’s text, + is in the text now. Using v6’s text changes only these instructions. It becomes a draft until you save.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this text" }));
    expect(screen.queryByRole("dialog", { name: "Compare v6 with the text now" })).toBeNull();
    expect(instructions(drawer).value).toBe(V6_TEXT);
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("reads the history again when the team's latest version changes", async () => {
    const { drawer, props, view } = renderEditor();
    fireEvent.click(within(drawer).getByRole("button", { name: "History" }));
    await within(drawer).findByText("3 versions");
    const reads = () => fetchMock.mock.calls.filter(([u]) => u === HISTORY_URL).length;
    expect(reads()).toBe(1);
    view.rerender(<NodeEditor {...props} teamVersion={8} />);
    await waitFor(() => expect(reads()).toBe(2));
  });
});
