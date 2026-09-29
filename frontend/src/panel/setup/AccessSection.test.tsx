import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import { AccessSection } from "./AccessSection";
import type { ReadsValue } from "./documents";

// Access & documents (G5): the File access confirm for verdict agents (Q6), the Reads picker and
// chips (Q4), the Writes picker and its new-document toast, Writes off on verdict agents (Q3).

const agent = (id: string, title: string, config: Record<string, unknown> = {}): TeamGraphNode => ({
  id,
  role_name: id,
  kind: "agent",
  model: "xai/grok-4.7",
  engine: null,
  prompt: "x",
  position: { x: 0, y: 0 },
  config: { title, ...config },
  last_run: null,
});
const edge = (s: string, t: string): GraphEdge => ({
  id: `${s}-${t}`,
  source_node_id: s,
  target_node_id: t,
  edge_type: "default",
  conditions: null,
});
const nodes = [
  agent("pm", "Product manager"),
  agent("eng", "Engineer", { writes_to: "build-notes", reads_from: ["spec", "design"] }),
  agent("rev", "Reviewer"),
];
const edges = [edge("pm", "eng"), edge("eng", "rev")];

afterEach(cleanup);

function Harness({
  verdict = true,
  isEntry = false,
  editsAllowed: initialEdits = false,
  reads: initialReads = { readsFrom: [], readsDefault: true },
  writesTo: initialWrites = "",
  spy,
}: {
  verdict?: boolean;
  isEntry?: boolean;
  editsAllowed?: boolean;
  reads?: ReadsValue;
  writesTo?: string;
  spy: {
    edits: (v: boolean) => void;
    reads: (v: ReadsValue) => void;
    writes: (v: string) => void;
    newDoc: () => void;
  };
}) {
  const [editsAllowed, setEdits] = useState(initialEdits);
  const [reads, setReads] = useState(initialReads);
  const [writesTo, setWrites] = useState(initialWrites);
  return (
    <AccessSection
      agentName="Reviewer"
      nodeId="rev"
      nodes={nodes}
      edges={edges}
      editsAllowed={editsAllowed}
      onEditsChange={(v) => {
        spy.edits(v);
        setEdits(v);
      }}
      isEntry={isEntry}
      verdict={verdict}
      reads={reads}
      onReadsChange={(v) => {
        spy.reads(v);
        setReads(v);
      }}
      writesTo={writesTo}
      onWritesChange={(v) => {
        spy.writes(v);
        setWrites(v);
      }}
      onNewDocument={spy.newDoc}
    />
  );
}

function renderSection(props: Omit<Parameters<typeof Harness>[0], "spy"> = {}) {
  const spy = { edits: vi.fn(), reads: vi.fn(), writes: vi.fn(), newDoc: vi.fn() };
  render(<Harness {...props} spy={spy} />);
  return { spy, section: screen.getByRole("region", { name: "Access & documents" }) };
}

describe("File access (Q6)", () => {
  it("a verdict agent asks first; Keep read-only leaves it read-only", () => {
    const { spy, section } = renderSection();
    fireEvent.click(within(section).getByRole("button", { name: "Can edit files" }));
    const dialog = within(section).getByRole("alertdialog", { name: "Let Reviewer change files?" });
    expect(dialog).toHaveTextContent(/only its verdict leaves/);
    expect(within(dialog).getByRole("button", { name: "Keep read-only" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep read-only" }));
    expect(within(section).queryByRole("alertdialog")).toBeNull();
    expect(spy.edits).not.toHaveBeenCalled();
    expect(within(section).getByRole("button", { name: "Read-only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Escape keeps it read-only and gives focus back to Can edit files", () => {
    const { spy, section } = renderSection();
    const edit = within(section).getByRole("button", { name: "Can edit files" });
    fireEvent.click(edit);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(section).queryByRole("alertdialog")).toBeNull();
    expect(spy.edits).not.toHaveBeenCalled();
    expect(edit).toHaveFocus();
  });

  it("Allow edits switches it, and the hint says its edits stay in the sandbox", () => {
    const { spy, section } = renderSection();
    fireEvent.click(within(section).getByRole("button", { name: "Can edit files" }));
    fireEvent.click(within(section).getByRole("button", { name: "Allow edits" }));
    expect(spy.edits).toHaveBeenCalledWith(true);
    expect(within(section).getByRole("button", { name: "Can edit files" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(section).getByText(
        "Full agent loop. Its edits stay in the sandbox. Memory → Remember what it learns is now available.",
      ),
    ).toBeInTheDocument();
  });

  it("an agent that doesn't route on a verdict switches straight away", () => {
    const { spy, section } = renderSection({ verdict: false });
    fireEvent.click(within(section).getByRole("button", { name: "Can edit files" }));
    expect(within(section).queryByRole("alertdialog")).toBeNull();
    expect(spy.edits).toHaveBeenCalledWith(true);
    expect(within(section).getByText(/It can change files in the repo\./)).toBeInTheDocument();
  });
});

describe("Reads (PANEL-52/53, Q4)", () => {
  const openPicker = (section: HTMLElement) => {
    fireEvent.click(within(section).getByRole("button", { name: "Add" }));
    return within(section).getByRole("dialog", { name: "Documents it reads, in order" });
  };
  const rowNames = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole("checkbox")
      .map((c) => c.closest("label")?.querySelector(".nd-pop__name")?.textContent);

  it("lists every document with who writes it, the spec checked by default", () => {
    const { section } = renderSection();
    const dialog = openPicker(section);
    expect(rowNames(dialog)).toEqual(["Shared spec", "build-notes", "design"]);
    expect(within(dialog).getByRole("checkbox", { name: /Shared spec/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /build-notes/ })).not.toBeChecked();
    expect(within(dialog).getByText("Product manager")).toBeInTheDocument();
    expect(within(dialog).getByText("Engineer")).toBeInTheDocument();
    expect(within(dialog).getByText("no one writes this yet")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Drag to change the order. It reads them top to bottom."),
    ).toBeInTheDocument();
  });

  it("checking a document reads it after the spec; the chips follow (Flow-Reads-2)", () => {
    const { spy, section } = renderSection();
    const dialog = openPicker(section);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /build-notes/ }));
    expect(spy.reads).toHaveBeenLastCalledWith({
      readsFrom: ["spec", "build-notes"],
      readsDefault: true,
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(section).queryByRole("dialog")).toBeNull();
    expect(within(section).getByRole("button", { name: "Remove spec" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Remove build-notes" })).toBeInTheDocument();
  });

  it("a new name (Enter) is added at the end and checked", () => {
    const { spy, section } = renderSection();
    const dialog = openPicker(section);
    const field = within(dialog).getByRole("textbox", { name: "New document name" });
    fireEvent.change(field, { target: { value: " api-notes " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(spy.reads).toHaveBeenLastCalledWith({
      readsFrom: ["spec", "api-notes"],
      readsDefault: true,
    });
    expect(field).toHaveValue("");
    expect(rowNames(dialog)).toEqual(["Shared spec", "build-notes", "design", "api-notes"]);
    expect(within(dialog).getByRole("checkbox", { name: /api-notes/ })).toBeChecked();
  });

  it("dragging a row changes the order it reads them in", () => {
    const { spy, section } = renderSection({
      reads: { readsFrom: ["spec", "build-notes"], readsDefault: true },
    });
    const dialog = openPicker(section);
    const label = (name: RegExp) =>
      within(dialog).getByRole("checkbox", { name }).closest("label") as HTMLElement;
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragStart(label(/build-notes/), { dataTransfer });
    fireEvent.dragOver(label(/Shared spec/), { dataTransfer });
    fireEvent.drop(label(/build-notes/), { dataTransfer });
    expect(spy.reads).toHaveBeenLastCalledWith({
      readsFrom: ["build-notes", "spec"],
      readsDefault: true,
    });
    expect(rowNames(dialog)).toEqual(["build-notes", "Shared spec", "design"]);
  });

  it("Alt+↓ on a checkbox moves that document down", () => {
    const { spy, section } = renderSection({
      reads: { readsFrom: ["spec", "build-notes"], readsDefault: true },
    });
    const dialog = openPicker(section);
    fireEvent.keyDown(within(dialog).getByRole("checkbox", { name: /Shared spec/ }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(spy.reads).toHaveBeenLastCalledWith({
      readsFrom: ["build-notes", "spec"],
      readsDefault: true,
    });
  });

  it("removing the only (default) spec chip reads nothing", () => {
    const { spy, section } = renderSection();
    fireEvent.click(within(section).getByRole("button", { name: "Remove spec" }));
    expect(spy.reads).toHaveBeenCalledWith({ readsFrom: [], readsDefault: false });
    expect(within(section).getAllByText("Nothing")).toHaveLength(2);
  });
});

describe("Writes (PANEL-54..56, Q3)", () => {
  it("lists Nothing and what others write; picking one closes the picker without a toast", () => {
    const { spy, section } = renderSection({ verdict: false });
    fireEvent.click(within(section).getByRole("button", { name: "Choose" }));
    const dialog = within(section).getByRole("dialog", { name: "The one document it writes" });
    expect(within(dialog).getByRole("radio", { name: /Nothing/ })).toBeChecked();
    expect(within(dialog).getByText("Engineer writes this")).toBeInTheDocument();
    expect(within(dialog).queryByText("Shared spec")).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: /build-notes/ }));
    expect(spy.writes).toHaveBeenCalledWith("build-notes");
    expect(spy.newDoc).not.toHaveBeenCalled();
    expect(within(section).queryByRole("dialog")).toBeNull();
    expect(within(section).getByRole("button", { name: "Remove build-notes" })).toBeInTheDocument();
  });

  it("a new name: 'Use <name>' writes it and says it's new (Flow-Writes-2)", () => {
    const { spy, section } = renderSection({ verdict: false });
    fireEvent.click(within(section).getByRole("button", { name: "Choose" }));
    const dialog = within(section).getByRole("dialog", { name: "The one document it writes" });
    expect(within(dialog).queryByRole("button", { name: /^Use/ })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "New document name" }), {
      target: { value: "review-notes" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use review-notes" }));
    expect(spy.writes).toHaveBeenCalledWith("review-notes");
    expect(spy.newDoc).toHaveBeenCalledTimes(1);
    // Its chip has a remove X, which puts Nothing + Choose back.
    fireEvent.click(within(section).getByRole("button", { name: "Remove review-notes" }));
    expect(spy.writes).toHaveBeenLastCalledWith("");
    expect(within(section).getByRole("button", { name: "Choose" })).toBeInTheDocument();
  });

  it("typing a name the team already uses isn't new", () => {
    const { spy, section } = renderSection({ verdict: false });
    fireEvent.click(within(section).getByRole("button", { name: "Choose" }));
    const field = within(section).getByRole("textbox", { name: "New document name" });
    fireEvent.change(field, { target: { value: "design" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(spy.writes).toHaveBeenCalledWith("design");
    expect(spy.newDoc).not.toHaveBeenCalled();
  });

  it("an agent that routes on a verdict can't choose one: its verdict goes to Runs", () => {
    const { section } = renderSection();
    expect(within(section).getByRole("button", { name: "Choose" })).toBeDisabled();
    expect(within(section).getByText("Its verdict goes to Runs.")).toBeInTheDocument();
  });

  it("a verdict agent that still has a Writes name is told it isn't written, and can remove it", () => {
    const { spy, section } = renderSection({ writesTo: "review-notes" });
    expect(
      within(section).getByText(
        "It routes on a verdict, so it can’t write a document. Its verdict goes to Runs.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Remove review-notes" }));
    expect(spy.writes).toHaveBeenCalledWith("");
  });

  it("the entry agent writes the spec and starts from the idea (Q5)", () => {
    const { section } = renderSection({ isEntry: true, verdict: false });
    expect(within(section).getByText("The idea you type when you press Run")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Choose" })).toBeNull();
    expect(within(section).getByRole("button", { name: "Can edit files" })).toBeDisabled();
  });
});
