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

    const preview = await within(dialog()).findByRole("region", {
      name: "Preview as the agent sees it",
    });
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

describe("Focus mode — Review changes (OQ-4)", () => {
  it("opens from the footer count, shows each change, undoes one at a time, then goes back", () => {
    renderEditor({ node: reviewer({ config: { title: "Reviewer", multimodal: true } }) });
    fireEvent.change(editor(), {
      target: { value: REVIEWER_PROMPT.replace("Run the tests first.", "Run pytest.\nSay which.") },
    });
    fireEvent.click(within(dialog()).getByRole("switch", { name: "Images" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "2 unsaved changes" }));

    const review = within(dialog()).getByRole("region", { name: "Review 2 changes" });
    expect(review).toHaveTextContent(
      "Nothing is saved yet. Saving changes the next run you launch.",
    );
    const instructions = within(review).getByRole("region", { name: "Instructions" });
    expect(instructions).toHaveTextContent("+2 −1 lines");
    expect(instructions.querySelector("del")).toHaveTextContent("Run the tests first.");
    expect([...instructions.querySelectorAll("ins")].map((n) => n.textContent)).toEqual([
      "Run pytest.",
      "Say which.",
    ]);
    const images = within(review).getByRole("region", { name: "Images" });
    expect(images).toHaveTextContent("Setup → Images");
    expect(images).toHaveTextContent("On");
    expect(images).toHaveTextContent("Off");
    expect(within(review).getByRole("button", { name: "Back to editing" })).toHaveFocus();

    fireEvent.click(within(images).getByRole("button", { name: "Undo this change" }));
    expect(within(dialog()).getByRole("region", { name: "Review 1 change" })).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Undo this change" }));
    // Nothing left to review: back on the editor, with the saved text.
    expect(editor()).toHaveValue(REVIEWER_PROMPT);
    expect(within(dialog()).getByText("All changes saved")).toBeInTheDocument();
  });

  it("opens on the Setup tab from any tab; Escape goes back to editing before it docks", () => {
    const { props, view } = renderEditor({ tab: "skills" });
    fireEvent.click(within(dialog()).getByRole("switch", { name: "Domains" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "1 unsaved change" }));
    expect(props.onTabChange).toHaveBeenCalledWith("setup");
    view.rerender(<NodeEditor {...props} tab="setup" />);

    const tools = within(dialog()).getByRole("region", { name: "Tools" });
    expect(tools).toHaveTextContent("Domains: Off → On");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onFocusChange).not.toHaveBeenCalled();
    expect(editor()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onFocusChange).toHaveBeenCalledWith(false);
  });
});

describe("Focus mode — Templates dialog", () => {
  const template = (key: string, title: string, summary: string, prompt: string) => ({
    key,
    title,
    description: "",
    summary,
    role_name: key,
    node_kind: "worker",
    edits_allowed: key === "engineer",
    writes_to: null,
    verdict_labels: [],
    prompt,
  });
  const TEMPLATES = [
    template("pm", "Product manager", "Turns your idea into a spec.", "You are the PM."),
    template(
      "engineer",
      "Engineer",
      "Builds the change the spec asks for.",
      "You are the engineer.",
    ),
    template("reviewer", "Reviewer", "Checks the build against the spec.", "You are the Reviewer!"),
  ];

  beforeEach(() => {
    fetchMock = stubFetch(
      () => reviewer(),
      (url) => (url === "/api/node-templates" ? json({ templates: TEMPLATES }) : undefined),
    );
  });

  it("starts on the agent's own template, previews another and applies it with a toast", async () => {
    const { props } = renderEditor();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Templates" }));
    const chooser = screen.getByRole("dialog", { name: "Choose a template" });
    const reviewerItem = await within(chooser).findByRole("button", { name: /^Reviewer/ });
    expect(reviewerItem).toHaveAttribute("aria-pressed", "true");
    const preview = within(chooser).getByRole("region", { name: "Preview" });
    expect(preview).toHaveTextContent("You are the Reviewer!");

    fireEvent.click(within(chooser).getByRole("button", { name: /^Engineer/ }));
    expect(preview).toHaveTextContent("You are the engineer.");
    // Escape closes only the dialog on top.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).toBeNull();
    expect(props.onFocusChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Templates" }));
    const again = screen.getByRole("dialog", { name: "Choose a template" });
    fireEvent.click(await within(again).findByRole("button", { name: /^Engineer/ }));
    fireEvent.click(within(again).getByRole("button", { name: "Use Engineer template" }));
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).toBeNull();
    expect(editor()).toHaveValue("You are the engineer.");
    const toast = dialog().querySelector(".nd-toast-host") as HTMLElement;
    expect(within(toast).getByText("Engineer template applied")).toBeInTheDocument();
    // Nothing is saved: the draft holds it (Discard brings the text back).
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PATCH")).toBe(false);
  });

  it("says when the templates can't load, and loads them again when it's reopened", async () => {
    fetchMock = stubFetch(
      () => reviewer(),
      (url) => (url === "/api/node-templates" ? json({ detail: "down" }, 500) : undefined),
    );
    renderEditor();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Templates" }));
    const chooser = screen.getByRole("dialog", { name: "Choose a template" });
    expect(await within(chooser).findByRole("alert")).toHaveTextContent(
      "Couldn’t load templates — try again.",
    );
    expect(within(chooser).getByRole("button", { name: "Use template" })).toBeDisabled();
    fireEvent.click(within(chooser).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Templates" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/node-templates")).toHaveLength(2),
    );
  });

  it("Cancel leaves the instructions as they were", async () => {
    renderEditor();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Templates" }));
    const chooser = screen.getByRole("dialog", { name: "Choose a template" });
    await within(chooser).findByRole("button", { name: /^Engineer/ });
    fireEvent.click(within(chooser).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Choose a template" })).toBeNull();
    expect(editor()).toHaveValue(REVIEWER_PROMPT);
  });
});

describe("Focus mode — Preview cards", () => {
  it("numbers the parts in the server's order, then the always-on skills; long parts fold", async () => {
    const long = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");
    fetchMock = stubFetch(
      () => reviewer(),
      (url) =>
        url.endsWith("/context-preview")
          ? json({
              ...PREVIEW,
              source_run: { run_id: "r1", idea: "Add RSI", created_at: "2026-09-27T09:00:00Z" },
              parts: [
                { ...PREVIEW.parts[0], text: long },
                { ...PREVIEW.parts[1], text: "--- ORIGINAL IDEA ---\nAdd RSI", placeholder: false },
              ],
              skills: [
                {
                  name: "house-style",
                  mode: "always",
                  triggers: [],
                  delivery: "context",
                  content: "# House style\nPlain words.",
                  tokens: 7,
                  source_type: "inline",
                  fetched_at_run_time: false,
                },
              ],
              skills_tokens: 7,
            })
          : undefined,
    );
    renderEditor();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Preview as the agent sees it" }));
    const preview = await within(dialog()).findByRole("region", {
      name: "Preview as the agent sees it",
    });
    await within(preview).findByRole("region", { name: "Always-on skills" });
    expect(preview).toHaveTextContent(
      "Read-only. Built from the last run’s idea, plus your current instructions and always-on skills.",
    );
    const cards = within(preview).getAllByRole("region");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Your instructions",
      "The idea",
      "Always-on skills",
    ]);
    // The section marker is the card's label, not its text.
    expect(cards[1].querySelector("pre")).toHaveTextContent(/^Add RSI$/);
    const yours = cards[0].querySelector("pre") as HTMLElement;
    expect(yours.textContent).toBe("line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n…");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Show all 9 lines" }));
    expect(yours.textContent).toBe(long);
    expect(cards[2]).toHaveTextContent("house-style");
    expect(cards[2]).toHaveTextContent("# House style Plain words.");
  });
});
