import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import {
  bodyOf,
  CATALOGUE,
  edges,
  engineer,
  pm,
  reviewer,
  ship,
  stubFetch,
} from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "./useNodeTemplates";

// Flow-Schema-1..3 (PANEL-59/60): Advanced → Add JSON schema opens the Output format sub-view in
// the drawer body's and the Save footer's place; the JSON is checked as it's typed; Done writes it
// into the draft and Save sends it.

const BROKEN = [
  "{",
  '  "type": "object",',
  '  "required": ["verdict", "reasons"]',
  '  "properties": {',
  '    "verdict": { "enum": ["approved", "changes_requested"] },',
  '    "reasons": { "type": "string" }',
  "  }",
  "}",
].join("\n");
const FIXED = BROKEN.replace('"reasons"]\n', '"reasons"],\n');

let fetchMock: ReturnType<typeof vi.fn>;
let saved: TeamGraphNode;

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  saved = reviewer();
  fetchMock = stubFetch(() => saved);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderDrawer(node: TeamGraphNode = reviewer(), over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node,
    nodes: [pm, engineer, node, ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "setup",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  const view = render(<NodeEditor {...props} />);
  return { props, view, drawer: screen.getByRole("complementary", { name: "Reviewer settings" }) };
}

function openEditor(drawer: HTMLElement, button = "Add JSON schema") {
  const advanced = within(drawer).getByRole("button", { name: /^Advanced/ });
  if (advanced.getAttribute("aria-expanded") !== "true") fireEvent.click(advanced);
  fireEvent.click(within(drawer).getByRole("button", { name: button }));
  const sheet = within(drawer).getByRole("region", { name: "Output format" });
  return { sheet, editor: within(sheet).getByRole("textbox", { name: "Output format" }) };
}

describe("Output format — the sub-view", () => {
  it("opens under the header and tabs, in the body's and the Save footer's place", () => {
    const { drawer } = renderDrawer();
    const { sheet, editor } = openEditor(drawer);
    expect(within(drawer).getByRole("tab", { name: "Setup" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(drawer).queryByText("All changes saved")).toBeNull();
    expect(
      within(sheet).getByText(
        "Optional. If the output doesn’t match, the run logs a warning. It won’t fail.",
      ),
    ).toBeInTheDocument();
    expect(editor).toHaveValue("");
    expect(editor).toHaveFocus();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("says which line to fix and keeps Done off, then says it's valid", () => {
    const { drawer } = renderDrawer();
    const { sheet, editor } = openEditor(drawer);
    fireEvent.change(editor, { target: { value: BROKEN } });
    expect(within(sheet).getByText("Line 3: add a comma after the list.")).toBeInTheDocument();
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeDisabled();

    fireEvent.change(editor, { target: { value: FIXED } });
    expect(within(sheet).getByText("Valid JSON Schema")).toBeInTheDocument();
    expect(within(sheet).queryByText(/add a comma/)).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("Done puts the schema in the draft; Save sends it as an object", async () => {
    const { drawer } = renderDrawer();
    const { sheet, editor } = openEditor(drawer);
    fireEvent.change(editor, { target: { value: FIXED } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));

    expect(within(drawer).queryByRole("region", { name: "Output format" })).toBeNull();
    expect(within(drawer).getByRole("button", { name: /^Advanced/ })).toHaveTextContent(
      "Output format: set",
    );
    expect(within(drawer).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await waitFor(() =>
      expect(bodyOf(fetchMock, "PATCH")).toEqual({
        output_schema: {
          type: "object",
          required: ["verdict", "reasons"],
          properties: {
            verdict: { enum: ["approved", "changes_requested"] },
            reasons: { type: "string" },
          },
        },
      }),
    );
  });

  it("Cancel and Back leave the draft as it was, with Advanced still open", () => {
    const { drawer } = renderDrawer();
    let { sheet, editor } = openEditor(drawer);
    fireEvent.change(editor, { target: { value: FIXED } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /^Advanced/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    ({ sheet, editor } = openEditor(drawer));
    expect(editor).toHaveValue("");
    fireEvent.change(editor, { target: { value: FIXED } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /^Advanced/ })).toHaveTextContent(
      "Output format: none",
    );
  });

  it("Insert example writes the verdict file's schema for an agent that routes on a verdict", () => {
    const { drawer } = renderDrawer();
    const { sheet, editor } = openEditor(drawer);
    fireEvent.click(within(sheet).getByRole("button", { name: "Insert example" }));
    expect(editor).toHaveValue(FIXED);
    expect(within(sheet).getByText("Valid JSON Schema")).toBeInTheDocument();
  });

  it("Clear then Done removes a saved schema (Save sends null)", async () => {
    saved = reviewer({ config: { ...reviewer().config, output_schema: { type: "object" } } });
    const { drawer } = renderDrawer(saved);
    const { sheet, editor } = openEditor(drawer, "Edit");
    expect(editor).toHaveValue('{\n  "type": "object"\n}');
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear" }));
    expect(editor).toHaveValue("");
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toEqual({ output_schema: null }));
  });

  it("notes the keywords runs don't check", () => {
    const { drawer } = renderDrawer();
    const { sheet, editor } = openEditor(drawer);
    fireEvent.change(editor, {
      target: { value: '{ "type": "string", "minLength": 3 }' },
    });
    expect(within(sheet).getByText("Valid JSON Schema")).toBeInTheDocument();
    expect(
      within(sheet).getByText(
        "Runs check type, enum, required, properties and items only, so they skip “minLength”.",
      ),
    ).toBeInTheDocument();
  });

  it("⌘S doesn't save while the sheet covers the Save footer", () => {
    const { drawer } = renderDrawer();
    fireEvent.change(within(drawer).getByRole("textbox", { name: "Instructions" }), {
      target: { value: `${reviewer().prompt}\nMore.` },
    });
    const { editor } = openEditor(drawer);
    fireEvent.keyDown(editor, { key: "s", metaKey: true });
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    expect(bodyOf(fetchMock, "PATCH")).toBeUndefined();
  });

  it("keeps the sheet on Setup when another tab is visited", () => {
    const { drawer, props, view } = renderDrawer();
    const { editor } = openEditor(drawer);
    fireEvent.change(editor, { target: { value: BROKEN } });
    view.rerender(<NodeEditor {...props} tab="runs" />);
    expect(within(drawer).queryByRole("region", { name: "Output format" })).toBeNull();
    view.rerender(<NodeEditor {...props} tab="setup" />);
    expect(within(drawer).getByRole("textbox", { name: "Output format" })).toHaveValue(BROKEN);
  });
});
