import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import {
  bodyOf,
  CATALOGUE,
  edges,
  engineer,
  json,
  pm,
  REVIEWER_PROMPT,
  reviewer,
  ship,
  stubFetch,
} from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// Focus mode (Desktop-Focus, PANEL-100/101): the same draft as the drawer in a 1240px dialog, the
// full editor with line numbers and a caret/size status line, the settings column, and "Preview
// as the agent sees it".

const PREVIEW = {
  source_run: null,
  parts: [
    {
      key: "node_prompt",
      label: "Your instructions",
      text: "You are the Reviewer.",
      tokens: 6,
      source: { label: "Setup → Instructions" },
      placeholder: false,
    },
    {
      key: "idea",
      label: "The idea",
      text: "\n\n--- ORIGINAL IDEA ---\n<the idea you type when you press Run>",
      tokens: 12,
      source: { label: "No run yet" },
      placeholder: true,
    },
  ],
  skills: [],
  skills_tokens: 0,
  total_tokens: 18,
  budget: 32000,
  over_budget: false,
  handle_used: false,
  notes: ["Repo map is added at run time when working on a real folder."],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  fetchMock = stubFetch(
    () => reviewer(),
    (url) => (url.endsWith("/context-preview") ? json(PREVIEW) : undefined),
  );
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
    node: reviewer(),
    nodes: [pm, engineer, reviewer(), ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "setup",
    onTabChange: vi.fn(),
    focus: true,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  const view = render(<NodeEditor {...props} />);
  return { props, view };
}

const dialog = () => screen.getByRole("dialog", { name: "Reviewer in focus view" });
const editor = () => within(dialog()).getByRole("textbox", { name: "Instructions" });

describe("Focus mode — the dialog", () => {
  it("shows the header badges, the tabs and the Save footer; Dock, Close and Escape", () => {
    const { props } = renderEditor();
    const d = dialog();
    expect(screen.queryByRole("complementary", { name: "Reviewer settings" })).toBeNull();
    expect(within(d).getByRole("heading", { name: "Reviewer" })).toBeInTheDocument();
    const head = d.querySelector(".fx-head") as HTMLElement;
    expect(within(head).getByText("Read-only")).toBeInTheDocument();
    expect(within(head).getByText("Grok 4.7")).toBeInTheDocument();
    expect(within(d).getByRole("tab", { name: "Setup" })).toHaveAttribute("aria-selected", "true");
    expect(within(d).getByText("All changes saved")).toBeInTheDocument();

    fireEvent.click(within(d).getByRole("button", { name: "Dock to the side" }));
    expect(props.onFocusChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(within(d).getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onFocusChange).toHaveBeenCalledTimes(2);
  });

  it("keeps the draft when it docks back to the drawer, and the other way round", async () => {
    const { props, view } = renderEditor({ focus: false });
    const drawer = screen.getByRole("complementary", { name: "Reviewer settings" });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "Instructions" }), {
      target: { value: `${REVIEWER_PROMPT}\nOne.` },
    });

    view.rerender(<NodeEditor {...props} focus />);
    expect(editor()).toHaveValue(`${REVIEWER_PROMPT}\nOne.`);
    expect(within(dialog()).getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.change(editor(), { target: { value: `${REVIEWER_PROMPT}\nOne.\nTwo.` } });

    view.rerender(<NodeEditor {...props} focus={false} />);
    const docked = screen.getByRole("complementary", { name: "Reviewer settings" });
    expect(within(docked).getByRole("textbox", { name: "Instructions" })).toHaveValue(
      `${REVIEWER_PROMPT}\nOne.\nTwo.`,
    );
    fireEvent.click(within(docked).getByRole("button", { name: /^Save/ }));
    await waitFor(() =>
      expect(bodyOf(fetchMock, "PATCH")).toEqual({ prompt: `${REVIEWER_PROMPT}\nOne.\nTwo.` }),
    );
  });
});

describe("Focus mode — Setup", () => {
  it("numbers each line of the instructions and starts with the caret in them", async () => {
    const { view } = renderEditor();
    const numbers = [...view.container.querySelectorAll(".fx-row__n")].map((n) => n.textContent);
    expect(numbers).toEqual(["1", "2", "3"]);
    await waitFor(() => expect(editor()).toHaveFocus());
    expect(
      within(dialog()).getByText(
        "Added at run time, after your instructions: the idea + the latest spec",
      ),
    ).toBeInTheDocument();
  });

  it("says where the caret is and how long the instructions are", () => {
    renderEditor();
    const text = editor() as HTMLTextAreaElement;
    expect(within(dialog()).getByText("Line 1, column 1")).toBeInTheDocument();
    const n = REVIEWER_PROMPT.length;
    expect(
      within(dialog()).getByText(`${n} characters · about ${Math.floor(n / 4)} tokens`),
    ).toBeInTheDocument();

    // Line 2, column 7: after 'Write '.
    const offset = REVIEWER_PROMPT.indexOf("\n") + 1 + 6;
    text.setSelectionRange(offset, offset);
    fireEvent.select(text);
    expect(within(dialog()).getByText("Line 2, column 7")).toBeInTheDocument();

    fireEvent.change(text, { target: { value: "x".repeat(1284) } });
    expect(within(dialog()).getByText("1,284 characters · about 320 tokens")).toBeInTheDocument();
  });

  it("lays Routing, Model, Access & documents and Advanced (open) beside the editor", () => {
    renderEditor();
    const settings = within(dialog()).getByRole("group", { name: "Settings" });
    const routing = within(settings).getByRole("region", { name: "Routing" });
    expect(routing).toHaveTextContent("Says “approved” → Ship. Anything else → back to Engineer.");
    expect(within(routing).getByText("Instructions match your arrows")).toBeInTheDocument();
    expect(within(settings).getByRole("region", { name: "Model" })).toBeInTheDocument();
    expect(
      within(settings).getByRole("region", { name: "Access & documents" }),
    ).toBeInTheDocument();
    expect(within(settings).getByRole("button", { name: /^Advanced/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // The Templates menu here has no "Open in focus view": this is the focus view.
    fireEvent.click(within(dialog()).getByRole("button", { name: "Templates" }));
    expect(screen.queryByRole("menuitem", { name: "Open in focus view" })).toBeNull();
  });

  it("previews what the agent sees, with the unsaved instructions, then goes back to editing", async () => {
    renderEditor();
    fireEvent.change(editor(), { target: { value: "You are the Reviewer. Be brief." } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Preview as the agent sees it" }));

    const preview = await within(dialog()).findByRole("region", { name: "What the agent sees" });
    expect(bodyOf(fetchMock, "POST", "/context-preview")).toMatchObject({
      prompt: "You are the Reviewer. Be brief.",
      model: "xai/grok-4.7",
      edits_allowed: false,
      // No skills in the draft is sent as an empty list: an absent key would mean the saved ones.
      skills: [],
    });
    expect(within(preview).getByRole("region", { name: "Your instructions" })).toHaveTextContent(
      "Setup → Instructions",
    );
    expect(within(preview).getByRole("region", { name: "The idea" })).toHaveTextContent(
      "Placeholder",
    );
    expect(
      within(preview).getByText("Repo map is added at run time when working on a real folder."),
    ).toBeInTheDocument();
    expect(preview).toHaveTextContent("About 18 tokens of its 32,000 tokens budget.");

    fireEvent.click(within(dialog()).getByRole("button", { name: "Back to editing" }));
    expect(editor()).toHaveValue("You are the Reviewer. Be brief.");
  });

  it("says so when the preview can't be built, and tries again", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/context-preview")
        ? json({ detail: "Only agents have a context to preview." }, 422)
        : json({ memories: [], templates: [] }),
    );
    renderEditor();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Preview as the agent sees it" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Only agents have a context to preview.",
    );
    fireEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/context-preview")),
      ).toHaveLength(2),
    );
  });

  it("opens the Output format editor in the settings column; Save stays but is off while it's broken", () => {
    renderEditor();
    fireEvent.change(editor(), { target: { value: `${REVIEWER_PROMPT}\nMore.` } });
    const settings = within(dialog()).getByRole("group", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("button", { name: "Add JSON schema" }));
    const sheet = within(settings).getByRole("region", { name: "Output format" });
    const save = within(dialog()).getByRole("button", { name: /^Save/ });

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Output format" }), {
      target: { value: '{ "type": "object"' },
    });
    expect(within(sheet).getByText("Line 1: close the { from line 1 with }.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(within(sheet).getByRole("textbox", { name: "Output format" }), {
      target: { value: '{ "type": "object" }' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(within(settings).getByRole("region", { name: "Routing" })).toBeInTheDocument();
    expect(within(dialog()).getByText("2 unsaved changes")).toBeInTheDocument();
  });
});
